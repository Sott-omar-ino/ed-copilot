"""Push-to-talk globale: funziona anche mentre il gioco ha il focus.

Un thread legge (circa 60 volte al secondo) il tasto della tastiera o il pulsante della cloche/manetta scelto;
finché è premuto (o tra due pressioni, in modalità "toggle") registra il microfono qui in Python, poi trascrive
con Whisper (voice.transcribe) e mette il testo in remote_voice: l'interfaccia lo esegue come i comandi dal telefono.

- Tastiera: user32.GetAsyncKeyState (codici virtual-key), anche combinazioni (es. Ctrl+F13).
- Cloche/manetta: winmm joyGetPosEx (fino a 32 pulsanti e il cappellino POV), nomi dal registro di Windows.
- Microfono: sounddevice (PortAudio), 16 kHz mono 16 bit, WAV in memoria.

Le impostazioni sono in ptt.json nella cartella dati. Tutto opzionale: senza sounddevice il resto dell'app funziona.
"""

import array
import collections
import ctypes
import io
import re
import threading
import time
import wave
from ctypes import wintypes

from . import lang, noise_filter, paths, remote_voice, storage, voice
from .lang import pick

CONFIG_FILE = paths.user_file("ptt.json")
DEFAULT_CONFIG = {"enabled": False, "binding": None, "mode": "hold", "mic": "", "beep": True,
                  "noise_floor_db": None}  # rumore di fondo del microfono scelto (Calibra rumore di fondo)
MIN_SECONDS = 0.3
MAX_SECONDS = 15.0
LEARN_TIMEOUT = 10.0
POLL_INTERVAL = 1 / 60
IDLE_INTERVAL = 0.5          # spento: il thread controlla solo se va riacceso
ENUM_INTERVAL = 4.0          # ogni quanto cercare cloche collegate/scollegate
SAMPLE_RATE = 16000
SILENCE_PEAK = 700           # picco sotto circa -33 dBFS: solo rumore di fondo, Whisper "tiny" inventerebbe parole

_lock = threading.RLock()
_wake = threading.Event()
_transcribe_lock = threading.Lock()
_cfg = None
_thread = None
_joys = []                   # [{"id", "name", "mid", "pid", "buttons", "pov"}]
_joys_ts = 0.0
_rt = {"recording": False, "rec_started": 0.0, "busy": False, "last": None, "last_error": None,
       "learning": False, "learn_until": 0.0, "learn_result": None, "audio_error": None}


# --- Configurazione --------------------------------------------------------------

def load_config():
    global _cfg
    with _lock:
        if _cfg is None:
            data = storage.load_json(CONFIG_FILE, {})
            _cfg = {**DEFAULT_CONFIG, **(data if isinstance(data, dict) else {})}
        return dict(_cfg)


def _clean_binding(b):
    if not isinstance(b, dict):
        return None
    if b.get("type") == "key" and isinstance(b.get("vk"), int) and 0 < b["vk"] < 256:
        mods = [m for m in (b.get("mods") or []) if isinstance(m, int) and 0 < m < 256][:3]
        return {"type": "key", "vk": b["vk"], "mods": mods, "name": str(b.get("name") or key_name(b["vk"], mods))[:60]}
    if b.get("type") == "joy" and isinstance(b.get("device"), int):
        out = {"type": "joy", "device": b["device"], "name": str(b.get("name") or "Joystick")[:60],
               "mid": int(b.get("mid") or 0), "pid": int(b.get("pid") or 0)}
        if isinstance(b.get("button"), int) and 1 <= b["button"] <= 32:
            out["button"] = b["button"]
        elif isinstance(b.get("pov"), int) and 0 <= b["pov"] < 36000:
            out["pov"] = b["pov"]
        else:
            return None
        return out
    return None


def save_config(changes):
    global _cfg
    changes = changes if isinstance(changes, dict) else {}
    with _lock:
        cfg = load_config()
        if "enabled" in changes:
            cfg["enabled"] = bool(changes["enabled"])
        if changes.get("mode") in ("hold", "toggle"):
            cfg["mode"] = changes["mode"]
        if "beep" in changes:
            cfg["beep"] = bool(changes["beep"])
        if "mic" in changes:
            if str(changes["mic"] or "")[:200] != cfg["mic"]:
                cfg["noise_floor_db"] = None  # altro microfono: la calibrazione non vale più
            cfg["mic"] = str(changes["mic"] or "")[:200]
        if "binding" in changes:
            cfg["binding"] = _clean_binding(changes["binding"])
        _cfg = cfg
        storage.save_json(CONFIG_FILE, cfg)
    if cfg["enabled"]:
        threading.Thread(target=voice.whisper_model, daemon=True).start()  # Whisper pronto al primo comando
    _wake.set()
    return status()


# --- Tastiera ----------------------------------------------------------------------

_user32 = ctypes.WinDLL("user32", use_last_error=True)
_user32.GetAsyncKeyState.argtypes = [ctypes.c_int]
_user32.GetAsyncKeyState.restype = ctypes.c_short
_user32.MapVirtualKeyW.argtypes = [wintypes.UINT, wintypes.UINT]
_user32.MapVirtualKeyW.restype = wintypes.UINT
_user32.GetKeyNameTextW.argtypes = [wintypes.LONG, wintypes.LPWSTR, ctypes.c_int]
_user32.GetKeyNameTextW.restype = ctypes.c_int

MODIFIERS = {0x10: "Shift", 0x11: "Ctrl", 0x12: "Alt", 0xA0: "Shift sinistro", 0xA1: "Shift destro",
             0xA2: "Ctrl sinistro", 0xA3: "Ctrl destro", 0xA4: "Alt sinistro", 0xA5: "Alt destro (AltGr)",
             0x5B: "Win sinistro", 0x5C: "Win destro"}
MODIFIERS_EN = {0x10: "Shift", 0x11: "Ctrl", 0x12: "Alt", 0xA0: "Left Shift", 0xA1: "Right Shift",
                0xA2: "Left Ctrl", 0xA3: "Right Ctrl", 0xA4: "Left Alt", 0xA5: "Right Alt (AltGr)",
                0x5B: "Left Win", 0x5C: "Right Win"}
_GENERIC_MOD = {0xA0: 0x10, 0xA1: 0x10, 0xA2: 0x11, 0xA3: 0x11, 0xA4: 0x12, 0xA5: 0x12}
_KEY_NAMES = {0x05: "Mouse X1", 0x06: "Mouse X2", 0x08: "Backspace", 0x09: "Tab", 0x0D: "Invio", 0x13: "Pausa",
              0x14: "Bloc Maiusc", 0x1B: "Esc", 0x20: "Spazio", 0x21: "Pag Su", 0x22: "Pag Giù", 0x23: "Fine",
              0x24: "Home", 0x25: "Freccia sinistra", 0x26: "Freccia su", 0x27: "Freccia destra", 0x28: "Freccia giù",
              0x2C: "Stamp", 0x2D: "Ins", 0x2E: "Canc", 0x5D: "Menu", 0x6A: "Num *", 0x6B: "Num +", 0x6D: "Num -",
              0x6E: "Num .", 0x6F: "Num /", 0x90: "Bloc Num", 0x91: "Bloc Scorr"}
_KEY_NAMES_EN = {**_KEY_NAMES, 0x0D: "Enter", 0x13: "Pause", 0x14: "Caps Lock", 0x20: "Space", 0x21: "Page Up",
                 0x22: "Page Down", 0x23: "End", 0x25: "Left Arrow", 0x26: "Up Arrow", 0x27: "Right Arrow",
                 0x28: "Down Arrow", 0x2C: "Print Screen", 0x2D: "Insert", 0x2E: "Delete", 0x90: "Num Lock",
                 0x91: "Scroll Lock"}
_EXTENDED = {0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x2D, 0x2E, 0x6F, 0x90}
# Tasti controllati in modalità "assegna": niente click sinistro/destro/centrale (servono per usare l'app)
# né i modificatori generici (si usano le versioni sinistra/destra, più precise).
_SCAN_VKS = [vk for vk in range(0x05, 0xFF) if vk not in (0x10, 0x11, 0x12, 0x07, 0x0A, 0x0B, 0x0E, 0x0F, 0xFF)]
VK_ESCAPE = 0x1B


def key_down(vk):
    return bool(_user32.GetAsyncKeyState(vk) & 0x8000)


def key_name(vk, mods=()):
    en = lang.current() == "en"
    mod_names, key_names = (MODIFIERS_EN, _KEY_NAMES_EN) if en else (MODIFIERS, _KEY_NAMES)
    if vk in mod_names:
        name = mod_names[vk]
    elif 0x70 <= vk <= 0x87:
        name = f"F{vk - 0x6F}"
    elif 0x30 <= vk <= 0x39 or 0x41 <= vk <= 0x5A:
        name = chr(vk)
    elif 0x60 <= vk <= 0x69:
        name = f"Num {vk - 0x60}"
    elif vk in key_names:
        name = key_names[vk]
    else:
        name = ""
        scan = _user32.MapVirtualKeyW(vk, 0)
        if scan:
            buf = ctypes.create_unicode_buffer(64)
            if _user32.GetKeyNameTextW((scan << 16) | ((1 << 24) if vk in _EXTENDED else 0), buf, 64):
                name = buf.value
        name = name or pick(f"Tasto 0x{vk:02X}", f"Key 0x{vk:02X}")
    return "+".join([mod_names.get(m, f"0x{m:02X}") for m in mods] + [name])


# --- Cloche e manetta (winmm) ------------------------------------------------------

class JOYINFOEX(ctypes.Structure):
    _fields_ = [(n, wintypes.DWORD) for n in ("dwSize", "dwFlags", "dwXpos", "dwYpos", "dwZpos", "dwRpos", "dwUpos",
                                              "dwVpos", "dwButtons", "dwButtonNumber", "dwPOV", "dwReserved1",
                                              "dwReserved2")]


class JOYCAPSW(ctypes.Structure):
    _fields_ = [("wMid", wintypes.WORD), ("wPid", wintypes.WORD), ("szPname", wintypes.WCHAR * 32)] + \
               [(n, wintypes.UINT) for n in ("wXmin", "wXmax", "wYmin", "wYmax", "wZmin", "wZmax", "wNumButtons",
                                             "wPeriodMin", "wPeriodMax", "wRmin", "wRmax", "wUmin", "wUmax", "wVmin",
                                             "wVmax", "wCaps", "wMaxAxes", "wNumAxes", "wMaxButtons")] + \
               [("szRegKey", wintypes.WCHAR * 32), ("szOEMVxD", wintypes.WCHAR * 260)]


JOY_RETURNALL = 0xFF
JOY_RETURNPOVCTS = 0x200
JOY_POVCENTERED = 0xFFFF
_winmm = ctypes.WinDLL("winmm")
_winmm.joyGetNumDevs.restype = wintypes.UINT
_winmm.joyGetPosEx.argtypes = [wintypes.UINT, ctypes.POINTER(JOYINFOEX)]
_winmm.joyGetPosEx.restype = wintypes.UINT
_winmm.joyGetDevCapsW.argtypes = [ctypes.c_size_t, ctypes.POINTER(JOYCAPSW), wintypes.UINT]
_winmm.joyGetDevCapsW.restype = wintypes.UINT
_oem_names = {}


def _oem_name(mid, pid):
    """Nome vero del dispositivo ("T.16000M"): winmm spesso dice solo "Joystick" o il nome del driver."""
    key = (mid, pid)
    if key not in _oem_names:
        import winreg
        name = ""
        sub = rf"System\CurrentControlSet\Control\MediaProperties\PrivateProperties\Joystick\OEM\VID_{mid:04X}&PID_{pid:04X}"
        for hive in (winreg.HKEY_CURRENT_USER, winreg.HKEY_LOCAL_MACHINE):
            try:
                with winreg.OpenKey(hive, sub) as k:
                    name = str(winreg.QueryValueEx(k, "OEMName")[0]).strip()
                    if name:
                        break
            except OSError:
                pass
        _oem_names[key] = name
    return _oem_names[key]


def _read_joy(jid):
    info = JOYINFOEX(dwSize=ctypes.sizeof(JOYINFOEX), dwFlags=JOY_RETURNALL | JOY_RETURNPOVCTS)
    if _winmm.joyGetPosEx(jid, ctypes.byref(info)) != 0:
        return None
    return info.dwButtons, (None if info.dwPOV == JOY_POVCENTERED or info.dwPOV > 35999 else int(info.dwPOV))


def enumerate_joysticks():
    """Cloche, manette e pad collegati (lento-ish: chiamato ogni qualche secondo, non a ogni lettura)."""
    out = []
    for jid in range(min(int(_winmm.joyGetNumDevs()), 16)):
        state = _read_joy(jid)
        if state is None:
            continue
        caps = JOYCAPSW()
        mid = pid = 0
        name, buttons = f"Joystick {jid + 1}", 0
        if _winmm.joyGetDevCapsW(jid, ctypes.byref(caps), ctypes.sizeof(JOYCAPSW)) == 0:
            mid, pid, buttons = caps.wMid, caps.wPid, caps.wNumButtons
            name = _oem_name(mid, pid) or caps.szPname.strip() or name
        out.append({"id": jid, "name": name, "mid": mid, "pid": pid, "vid_pid": f"{mid:04X}:{pid:04X}",
                    "buttons": min(buttons, 32), "pov": bool(caps.wCaps & 0x10)})  # JOYCAPS_HASPOV
    return out


def _refresh_joys(force=False):
    global _joys, _joys_ts
    now = time.time()
    if force or now - _joys_ts > ENUM_INTERVAL:
        try:
            _joys = enumerate_joysticks()
        except Exception as exc:
            print(f"[PTT] Lettura joystick non riuscita: {exc}")
            _joys = []
        _joys_ts = now
    return _joys


def _resolve_joy(b):
    """Id winmm attuale del dispositivo assegnato (gli id cambiano se scolleghi e ricolleghi)."""
    same = [j for j in _joys if b.get("mid") and (j["mid"], j["pid"]) == (b["mid"], b["pid"])]
    if any(j["id"] == b["device"] for j in same) or not same:
        return b["device"]
    return same[0]["id"]


def _pov_match(pov, target):
    """Il cappellino conta anche in diagonale (es. "su" vale anche per su-destra e su-sinistra)."""
    if pov is None:
        return False
    diff = abs(pov - target) % 36000
    return min(diff, 36000 - diff) <= 4500


def _pov_name(angle):
    if lang.current() == "en":
        return {0: "up", 4500: "up-right", 9000: "right", 13500: "down-right", 18000: "down", 22500: "down-left",
                27000: "left", 31500: "up-left"}.get(angle, f"{angle / 100:.0f}°")
    return {0: "su", 4500: "su-destra", 9000: "destra", 13500: "giù-destra", 18000: "giù", 22500: "giù-sinistra",
            27000: "sinistra", 31500: "su-sinistra"}.get(angle, f"{angle / 100:.0f}°")


def binding_pressed(b):
    if not b:
        return False
    if b["type"] == "key":
        return key_down(b["vk"]) and all(key_down(m) for m in b.get("mods") or [])
    jid = _resolve_joy(b)
    if not any(j["id"] == jid for j in _joys):  # scollegato: non interrogarlo 60 volte al secondo (winmm è lento)
        return False
    state = _read_joy(jid)
    if state is None:
        return False
    buttons, pov = state
    if "button" in b:
        return bool(buttons & (1 << (b["button"] - 1)))
    return _pov_match(pov, b["pov"])


# --- Modalità "assegna pulsante" ------------------------------------------------------

class _Learner:
    def __init__(self):
        self.held_keys = {vk for vk in _SCAN_VKS if key_down(vk)}   # già premuti all'inizio: ignorati finché rilasciati
        self.held_joy = {}
        for j in _refresh_joys(force=True):
            st = _read_joy(j["id"])
            if st:
                self.held_joy[j["id"]] = (st[0], st[1] is not None)
        self.mod_candidate = None
        self.other_key_seen = False

    def step(self):
        """None finché non premi qualcosa; poi il binding (o {"cancel": True} con Esc)."""
        down = {vk for vk in _SCAN_VKS if key_down(vk)}
        self.held_keys &= down
        down -= self.held_keys
        others = sorted(vk for vk in down if vk not in MODIFIERS)
        if others:
            vk = others[0]
            if vk == VK_ESCAPE:
                return {"cancel": True}
            mods = sorted({_GENERIC_MOD.get(m, m) for m in down if m in MODIFIERS})
            return {"type": "key", "vk": vk, "mods": mods, "name": key_name(vk, mods)}
        mods_down = [vk for vk in down if vk in MODIFIERS]
        if self.mod_candidate is None and mods_down:
            self.mod_candidate = mods_down[0]
        elif self.mod_candidate is not None and not mods_down:
            vk = self.mod_candidate  # premuto e rilasciato da solo: il PTT è il modificatore stesso
            return {"type": "key", "vk": vk, "mods": [], "name": key_name(vk)}
        for j in _refresh_joys():
            st = _read_joy(j["id"])
            if st is None:
                continue
            buttons, pov = st
            old_buttons, old_pov = self.held_joy.get(j["id"], (0, False))
            old_buttons &= buttons
            old_pov = old_pov and pov is not None
            self.held_joy[j["id"]] = (old_buttons, old_pov)
            new = buttons & ~old_buttons
            base = {"type": "joy", "device": j["id"], "mid": j["mid"], "pid": j["pid"]}
            if new:
                n = (new & -new).bit_length()
                return {**base, "button": n, "name": pick(f"{j['name']} · pulsante {n}", f"{j['name']} · button {n}")}
            if pov is not None and not old_pov:
                angle = int(round(pov / 4500.0)) * 4500 % 36000
                return {**base, "pov": angle, "name": pick(f"{j['name']} · cappellino {_pov_name(angle)}",
                                             f"{j['name']} · hat {_pov_name(angle)}")}
        return None


def learn(wait=True, save=True):
    """Aspetta il prossimo tasto/pulsante premuto (massimo 10 s). Esc annulla."""
    with _lock:
        if _rt["recording"]:
            _stop_recording(discard=True)
        _rt.update(learning=True, learn_until=time.time() + LEARN_TIMEOUT, learn_result=None)
    _wake.set()
    if not wait:
        return {"learning": True}
    deadline = time.time() + LEARN_TIMEOUT + 1
    while time.time() < deadline:
        with _lock:
            if not _rt["learning"]:
                break
        time.sleep(0.05)
    with _lock:
        res = _rt["learn_result"] or {"error": pick("Nessun pulsante premuto entro 10 secondi.", "No button pressed within 10 seconds.")}
    if save and res.get("type"):
        save_config({"binding": res})
    return {**res, "status": status()} if res.get("type") else res


def cancel_learn():
    with _lock:
        if _rt["learning"]:
            _rt.update(learning=False, learn_result={"error": pick("Annullato.", "Cancelled.")})
    return status()


# --- Microfono -------------------------------------------------------------------------

def _sd():
    try:
        import sounddevice
        _rt["audio_error"] = None
        return sounddevice
    except Exception as exc:  # manca il pacchetto o la DLL di PortAudio
        _rt["audio_error"] = pick(f"Registrazione non disponibile: {exc}", f"Recording not available: {exc}")
        return None


def list_mics(refresh=True):
    """Microfoni dell'API audio predefinita (MME su Windows: niente doppioni, converte da sola a 16 kHz)."""
    sd = _sd()
    if not sd:
        return {"error": _rt["audio_error"], "devices": []}
    try:
        if refresh and not _rt["recording"]:
            sd._terminate()   # PortAudio legge l'elenco solo all'avvio: così compaiono i microfoni collegati dopo
            sd._initialize()
        default_in = sd.default.device[0]
        devices = sd.query_devices()
        api = devices[default_in]["hostapi"] if default_in is not None and default_in >= 0 else 0
        out = [{"name": d["name"], "default": i == default_in, "channels": d["max_input_channels"]}
               for i, d in enumerate(devices) if d["max_input_channels"] > 0 and d["hostapi"] == api
               and not d["name"].startswith("Microsoft Sound Mapper")]  # è già la voce "predefinito di sistema"
        return {"devices": out, "hostapi": sd.query_hostapis(api)["name"]}
    except Exception as exc:
        return {"error": pick(f"Elenco microfoni non disponibile: {exc}", f"Microphone list not available: {exc}"), "devices": []}


def _mic_index(sd, name):
    if not name:
        return None
    try:
        default_in = sd.default.device[0]
        devices = sd.query_devices()
        api = devices[default_in]["hostapi"] if default_in is not None and default_in >= 0 else 0
        for i, d in enumerate(devices):
            if d["max_input_channels"] > 0 and d["name"] == name and d["hostapi"] == api:
                return i
    except Exception:
        pass
    return None  # microfono scollegato: si usa quello predefinito


_rec = {"stream": None, "chunks": [], "rate": SAMPLE_RATE, "spoke": False}


def _start_recording():
    sd = _sd()
    if not sd:
        _rt["last_error"] = _rt["audio_error"]
        _beep("error")
        return False
    cfg = load_config()
    device = _mic_index(sd, cfg.get("mic"))
    chunks = []
    _rec["spoke"] = voice.is_speaking()

    def callback(indata, frames, t, status):
        chunks.append(bytes(indata))
        if voice.is_speaking():
            _rec["spoke"] = True

    stream = None
    for rate in (SAMPLE_RATE, None):  # se il microfono non accetta 16 kHz usa la sua frequenza (Whisper ricampiona)
        try:
            if rate is None:
                rate = int(sd.query_devices(device if device is not None else sd.default.device[0])["default_samplerate"])
            stream = sd.RawInputStream(samplerate=rate, channels=1, dtype="int16", device=device, callback=callback,
                                       blocksize=0, latency="low")
            stream.start()
            break
        except Exception as exc:
            stream = None
            err = exc
    if stream is None:
        _rt["last_error"] = pick(f"Microfono non disponibile: {err}", f"Microphone not available: {err}")
        _beep("error")
        return False
    _rec.update(stream=stream, chunks=chunks, rate=rate)
    _rt.update(recording=True, rec_started=time.time(), last_error=None)
    _beep("start")
    return True


def _stop_recording(discard=False):
    stream = _rec["stream"]
    _rec["stream"] = None
    _rt["recording"] = False
    if stream is None:
        return
    try:
        stream.stop()
        stream.close()
    except Exception:
        pass
    pcm = b"".join(_rec["chunks"])
    seconds = len(pcm) / 2 / _rec["rate"]
    if discard:
        return
    if seconds < MIN_SECONDS:
        _rt["last_error"] = pick("Troppo breve: tieni premuto mentre parli.", "Too short: hold the button while you speak.")
        _beep("error")
        return
    if _rec["spoke"] or voice.is_speaking():
        _rt["last_error"] = pick("Scartato: il copilota stava parlando.", "Discarded: the copilot was speaking.")
        _beep("error")
        return
    if peak(pcm) < SILENCE_PEAK:
        _rt["last_error"] = pick("Non ti ho sentito: microfono muto o troppo basso?", "I didn't hear you: is the mic muted or too quiet?")
        _beep("error")
        return
    _beep("stop")
    threading.Thread(target=_transcribe, args=(to_wav(pcm, _rec["rate"]), seconds), daemon=True).start()


CALIBRATE_SECONDS = 2.0


def calibrate(seconds=CALIBRATE_SECONDS):
    """Misura per ~2 s il rumore di fondo del microfono del push-to-talk (stai zitto) e lo salva in ptt.json:
    il filtro rumori (noise_filter.py) parte da qui per decidere la soglia."""
    if not noise_filter.available():
        return {"error": pick("Calibrazione non disponibile (manca numpy).", "Calibration not available (numpy missing).")}
    sd = _sd()
    if not sd:
        return {"error": _rt["audio_error"]}
    if _rt["recording"]:
        return {"error": pick("Sto registrando un comando: riprova tra un attimo.", "Recording a command: try again in a moment.")}
    device = _mic_index(sd, load_config().get("mic"))
    try:
        rate = SAMPLE_RATE
        try:
            data = sd.rec(int(seconds * rate), samplerate=rate, channels=1, dtype="int16", device=device, blocking=True)
        except Exception:
            rate = int(sd.query_devices(device if device is not None else sd.default.device[0])["default_samplerate"])
            data = sd.rec(int(seconds * rate), samplerate=rate, channels=1, dtype="int16", device=device, blocking=True)
    except Exception as exc:
        return {"error": pick(f"Microfono non disponibile: {exc}", f"Microphone not available: {exc}")}
    floor = noise_filter.noise_floor_db(noise_filter.to_float(data.tobytes()), rate)
    if floor is None:
        return {"error": pick("Registrazione vuota.", "Empty recording.")}
    with _lock:
        cfg = load_config()
        cfg["noise_floor_db"] = round(floor, 1)
        _cfg.update(cfg)
        storage.save_json(CONFIG_FILE, _cfg)
    return {"floor_db": round(floor, 1), "status": status()}


def peak(pcm):
    samples = array.array("h", pcm[:len(pcm) // 2 * 2])
    return max((abs(x) for x in samples), default=0)


HALLUCINATIONS = {"sottotitoli a cura di qtss", "grazie per la visione", "grazie a tutti",
                  "thank you for watching", "thanks for watching", "thank you so much for watching",
                  "please subscribe", "subscribe to my channel", "you"}


def looks_hallucinated(text):
    """Whisper sul rumore ripete la stessa parola all'infinito ("sì, sì, sì...") o chiude con frasi fatte."""
    words = re.findall(r"\w+", text.lower())
    if len(words) >= 6 and collections.Counter(words).most_common(1)[0][1] / len(words) > 0.4:
        return True
    # Frasi fatte che Whisper "sente" nel silenzio, in italiano e in inglese (sottotitoli dei video di addestramento).
    return text.strip().lower().rstrip(".!") in HALLUCINATIONS


def to_wav(pcm, rate=SAMPLE_RATE):
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)
    return buf.getvalue()


def _transcribe(wav, seconds):
    with _transcribe_lock:
        _rt["busy"] = True
        try:
            text = voice.transcribe(wav, "audio/wav", source="ptt", floor_db=load_config().get("noise_floor_db"))
            filt = voice.last_filter()
            if not text and filt.get("source") == "ptt" and filt.get("speech") is False:
                _rt["last_error"] = pick(f"Filtro rumori: scartati {filt.get('dropped', 0)} rumori brevi o non vocali "
                                         "(tasti, clic), nessuna voce.",
                                         f"Noise filter: discarded {filt.get('dropped', 0)} short or non-voice sounds "
                                         "(keys, clicks), no voice.")
                return
            if not text or looks_hallucinated(text):
                _rt["last_error"] = pick("Non ho capito (nessuna parola riconosciuta).", "I didn't get that (no words recognised).")
                return
            text = text[:200]
            item = remote_voice.push(text, source="ptt")
            _rt["last"] = {"id": item["id"], "text": text, "ts": item["ts"], "seconds": round(seconds, 1)}
        except Exception as exc:
            _rt["last_error"] = pick(f"Trascrizione non riuscita: {exc}", f"Transcription failed: {exc}")
        finally:
            _rt["busy"] = False


# --- Segnali acustici --------------------------------------------------------------

_BEEPS = {"start": ((880, 60),), "stop": ((660, 60),), "error": ((300, 90), (250, 120)), "learned": ((990, 50), (1320, 70))}


def _beep(kind):
    if not load_config().get("beep"):
        return

    def play():
        try:
            import winsound
            for freq, ms in _BEEPS[kind]:
                winsound.Beep(freq, ms)
        except Exception:
            pass

    threading.Thread(target=play, daemon=True).start()


# --- Ciclo principale ---------------------------------------------------------------

def _loop():
    was_pressed = False
    wait_release = False
    learner = None
    while True:
        try:
            with _lock:
                learning = _rt["learning"]
            if learning:
                learner = learner or _Learner()
                res = learner.step()
                if res is None and time.time() > _rt["learn_until"]:
                    res = {"error": pick("Nessun pulsante premuto entro 10 secondi.", "No button pressed within 10 seconds.")}
                elif res and res.get("cancel"):
                    res = {"error": pick("Annullato.", "Cancelled.")}
                if res is not None:
                    with _lock:
                        _rt.update(learning=False, learn_result=res)
                    if res.get("type"):
                        _beep("learned")
                    learner, was_pressed, wait_release = None, True, True  # aspetta il rilascio prima di registrare
                time.sleep(POLL_INTERVAL)
                continue
            learner = None
            cfg = load_config()
            b = cfg.get("binding")
            if not cfg.get("enabled") or not b:
                if _rt["recording"]:
                    _stop_recording(discard=True)
                _wake.wait(IDLE_INTERVAL)
                _wake.clear()
                continue
            if b["type"] == "joy":
                _refresh_joys()
            pressed = binding_pressed(b)
            edge = pressed and not was_pressed
            was_pressed = pressed
            if wait_release:
                wait_release = pressed
            elif cfg.get("mode") == "toggle":
                if edge:
                    _stop_recording() if _rt["recording"] else _start_recording()
            elif pressed and not _rt["recording"]:
                if not _start_recording():
                    wait_release = True  # niente microfono: non riprovare a ogni giro finché non rilasci
            elif not pressed and _rt["recording"]:
                _stop_recording()
            if _rt["recording"] and time.time() - _rt["rec_started"] > MAX_SECONDS:
                _stop_recording()
                wait_release = pressed
            time.sleep(POLL_INTERVAL)
        except Exception as exc:
            print(f"[PTT] {exc!r}")
            _rt["last_error"] = str(exc)
            time.sleep(1)


def start():
    """Avvia il thread (una volta sola). Legge i dispositivi solo se il PTT è acceso o stai assegnando un pulsante."""
    global _thread
    with _lock:
        if _thread is None:
            load_config()
            _thread = threading.Thread(target=_loop, name="ptt", daemon=True)
            _thread.start()
            if _cfg.get("enabled"):
                threading.Thread(target=voice.whisper_model, daemon=True).start()
    return status()


def status():
    cfg = load_config()
    _refresh_joys()  # al massimo ogni ENUM_INTERVAL secondi: così il pannello mostra cloche e manetta collegate
    last = dict(_rt["last"]) if _rt["last"] else None
    if last:  # esito scritto dall'interfaccia dopo aver eseguito il comando
        last["result"] = next((i["result"] for i in remote_voice.recent() if i["id"] == last["id"]), None)
    return {
        "enabled": cfg["enabled"], "binding": cfg["binding"], "mode": cfg["mode"], "mic": cfg["mic"],
        "beep": cfg["beep"], "running": _thread is not None and _thread.is_alive(),
        "recording": _rt["recording"],
        "recording_for": round(time.time() - _rt["rec_started"], 1) if _rt["recording"] else 0,
        "transcribing": _rt["busy"], "last": last, "last_error": _rt["last_error"],
        "learning": _rt["learning"], "learn_left": max(0, round(_rt["learn_until"] - time.time(), 1)) if _rt["learning"] else 0,
        "learn_result": _rt["learn_result"], "audio_error": _rt["audio_error"],
        "joysticks": [{k: j[k] for k in ("id", "name", "vid_pid", "buttons")} for j in _joys],
        "max_seconds": MAX_SECONDS, "noise_floor_db": cfg.get("noise_floor_db"),
    }


def joysticks():
    return _refresh_joys(force=True)


GET = {}
POST = {"/api/ptt/calibrate": lambda b, q: calibrate()}
LAN = set()
