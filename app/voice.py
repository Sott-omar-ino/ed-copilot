"""Copilota vocale: sintesi (voci neurali Microsoft via edge-tts), riproduzione in coda, riconoscimento (Whisper locale).

Tutto opzionale: se le librerie mancano o la rete non c'è, l'app continua a funzionare senza voce.
"""

import asyncio
import ctypes
import hashlib
import io
import os
import queue
import re
import threading
import time
import uuid

from . import lang, noise_filter, paths, storage, voice_fx
from .lang import pick
from .journal import STATE

CONFIG_FILE = paths.user_file("voice_config.json")
DEFAULT_CONFIG = {"enabled": False, "mode": "ptt", "ptt_key_code": "Space", "ptt_key_name": "SPAZIO (Space)",
                  "ptt_behavior": "hold", "voice": "elsa", "volume": 100,
                  # Filtro rumori 0-100 (noise_filter.py), uguale per microfono dell'app, push-to-talk e telefono.
                  "noise_filter": 50,
                  # Voce: velocità (%) e tono (Hz) di edge-tts, effetto (voice_fx.PRESETS) e quanto effetto (0-100).
                  "tts_rate": 0, "tts_pitch": 0, "tts_effect": "naturale", "tts_fx_amount": 70,
                  # Voce scelta con l'interfaccia in inglese ("" = predefinita inglese, vedi resolve_voice).
                  "voice_en": "",
                  # Modello di riconoscimento (faster-whisper): "tiny" veloce, "base" bilanciato, "small" preciso.
                  "stt_model": "base"}
STT_MODELS = ("tiny", "base", "small")
# Nomi brevi usati dalle versioni precedenti (restano validi). Le altre voci si indicano col nome edge-tts completo.
VOICES = {"elsa": "it-IT-ElsaNeural", "diego": "it-IT-DiegoNeural",
          "isabella": "it-IT-IsabellaNeural", "giuseppe": "it-IT-GiuseppeNeural"}
# Voci accettate: italiane, inglesi (en-GB/en-US, per l'interfaccia in inglese) o "Multilingual" (parlano anche
# italiano). Elenco vero: list_voices() più sotto.
_VOICE_RE = re.compile(r"^(?:it-IT-[A-Za-z]+Neural|en-(?:GB|US)-[A-Za-z]+Neural|[a-z]{2,3}-[A-Z]{2}-[A-Za-z]+MultilingualNeural)$")
# Voce inglese predefinita (in ordine di preferenza): la prima presente nell'elenco del servizio (list_voices).
# Verificate con edge_tts.list_voices() il 2026-11-08: en-GB-SoniaNeural, en-GB-RyanNeural, en-US-AriaNeural, en-US-GuyNeural.
EN_DEFAULTS = ("en-GB-SoniaNeural", "en-GB-RyanNeural", "en-US-AriaNeural", "en-US-GuyNeural")
VOICES_FILE = paths.cache_file("voci_tts.json")
VOICES_CACHE_VERSION = 2  # 2: l'elenco in cache include anche le voci en-GB/en-US
VOICES_MAX_AGE = 7 * 86400
MAX_CACHE_FILES = 400
MAX_UPLOAD = 10 * 1024 * 1024

_config_lock = threading.Lock()
_tts_locks = {}
_tts_locks_guard = threading.Lock()
_speaking_until = 0.0


# --- Configurazione ------------------------------------------------------------

def _raw_config():
    with _config_lock:
        data = storage.load_json(CONFIG_FILE, {})
        return {**DEFAULT_CONFIG, **(data if isinstance(data, dict) else {})}


def load_config():
    """Impostazioni vocali. "voice" è la voce in uso nella lingua dell'interfaccia (in inglese: voice_en o la
    predefinita inglese, vedi resolve_voice); la scelta italiana resta in "voice_it"."""
    cfg = _raw_config()
    cfg["voice_it"] = cfg["voice"]
    if lang.current() == "en":
        cfg["voice"] = resolve_voice(cfg.get("voice_en") or cfg["voice"], cfg)
    return cfg


def save_config(changes):
    allowed = {k: v for k, v in (changes or {}).items() if k in DEFAULT_CONFIG}
    raw = _raw_config()
    if lang.current() == "en" and "voice" in allowed:
        # Interfaccia in inglese: la voce scelta vale per l'inglese, quella italiana resta com'era.
        v = allowed.pop("voice")
        if v != resolve_voice(raw.get("voice_en") or raw["voice"], raw):
            allowed["voice_en"] = v
    cfg = {**raw, **allowed}
    cfg["volume"] = _clamp(cfg.get("volume"), 0, 100, 100)
    cfg["noise_filter"] = _clamp(cfg.get("noise_filter"), 0, 100, 50)
    cfg["tts_rate"] = _clamp(cfg.get("tts_rate"), -50, 50, 0)
    cfg["tts_pitch"] = _clamp(cfg.get("tts_pitch"), -30, 30, 0)
    cfg["tts_effect"] = voice_fx.preset(cfg.get("tts_effect"))
    cfg["tts_fx_amount"] = _clamp(cfg.get("tts_fx_amount"), 0, 100, 70)
    if cfg.get("stt_model") not in STT_MODELS:
        cfg["stt_model"] = DEFAULT_CONFIG["stt_model"]
    if cfg["stt_model"] != raw.get("stt_model"):
        _reset_whisper()
    if not isinstance(cfg.get("voice"), str) or not (cfg["voice"] in VOICES or _VOICE_RE.match(cfg["voice"])):
        cfg["voice"] = "elsa"
    if not isinstance(cfg.get("voice_en"), str) or not (cfg["voice_en"] == "" or _VOICE_RE.match(cfg["voice_en"])):
        cfg["voice_en"] = ""
    with _config_lock:
        storage.save_json(CONFIG_FILE, cfg)
    if cfg.get("enabled"):
        threading.Thread(target=whisper_model, daemon=True).start()
    return load_config()


def _clamp(v, lo, hi, default):
    try:
        return max(lo, min(hi, int(round(float(v)))))
    except (TypeError, ValueError):
        return default


# --- Sintesi vocale ---------------------------------------------------------------

def _voice(key):
    v = VOICES.get(key, key)
    return v if isinstance(v, str) and _VOICE_RE.match(v) else VOICES["elsa"]


def speaks(voice_id, lng):
    """Vero se la voce (nome edge-tts completo) sa parlare la lingua: "it" o "en"."""
    if not isinstance(voice_id, str):
        return False
    if "Multilingual" in voice_id:
        return True
    return voice_id.startswith("it-IT-") if lng == "it" else voice_id.startswith(("en-GB-", "en-US-"))


def default_en_voice():
    """La prima voce di EN_DEFAULTS presente nell'elenco del servizio (in cache), altrimenti la prima inglese."""
    cached = storage.load_json(VOICES_FILE, {})
    ids = [v.get("id") for v in (cached.get("voices") or [])] if isinstance(cached, dict) else []
    if not ids or not any(isinstance(v, str) and v.startswith("en-") for v in ids):
        return EN_DEFAULTS[0]  # elenco non ancora scaricato (o di una versione senza voci inglesi)
    for v in EN_DEFAULTS:
        if v in ids:
            return v
    return next((v for v in ids if isinstance(v, str) and v.startswith(("en-GB-", "en-US-")) and "Multilingual" not in v),
                EN_DEFAULTS[0])


def resolve_voice(key, cfg=None):
    """Voce da usare davvero nella lingua dell'interfaccia. Se quella richiesta non sa parlare la lingua (es. Elsa
    con l'interfaccia in inglese) si usa quella scelta per quella lingua, poi la predefinita (Elsa / inglese)."""
    lng = lang.current()
    v = _voice(key)
    if speaks(v, lng):
        return v
    cfg = cfg or _raw_config()
    if lng == "en":
        own = _voice(cfg.get("voice_en")) if cfg.get("voice_en") else None
        return own if own and speaks(own, "en") else default_en_voice()
    own = _voice(cfg.get("voice"))
    return own if speaks(own, "it") else VOICES["elsa"]


def list_voices(refresh=False):
    """Voci che sanno parlare italiano, lette dal servizio di edge-tts (edge_tts.list_voices) e tenute in cache
    per una settimana: solo quelle che esistono davvero, italiane (it-IT) e "Multilingual"."""
    cached = storage.load_json(VOICES_FILE, {})
    cached = cached if isinstance(cached, dict) else {}
    if cached.get("version") != VOICES_CACHE_VERSION:
        refresh = True  # cache di una versione precedente: senza le voci inglesi
    if cached.get("voices") and not refresh and time.time() - (cached.get("ts") or 0) < VOICES_MAX_AGE:
        return {"voices": _for_lang(cached["voices"]), "source": "cache", "ts": cached["ts"]}
    try:
        import edge_tts

        async def fetch():
            return await edge_tts.list_voices()

        loop = asyncio.new_event_loop()
        try:
            raw = loop.run_until_complete(fetch())
        finally:
            loop.close()
        voices = []
        for v in raw:
            sn = v.get("ShortName") or ""
            if not _VOICE_RE.match(sn):
                continue
            multi = "Multilingual" in sn
            voices.append({"id": sn, "name": sn.split("-", 2)[2].replace("MultilingualNeural", "").replace("Neural", ""),
                           "gender": v.get("Gender") or "", "locale": v.get("Locale") or "",
                           "group": "Multilingue" if multi else ("Italiane" if sn.startswith("it-IT-") else "Inglesi"),
                           "personalities": (v.get("VoiceTag") or {}).get("VoicePersonalities") or []})
        voices.sort(key=lambda x: (x["group"] != "Italiane", x["group"] != "Inglesi",
                                   x["locale"] not in ("it-IT", "en-GB"), x["name"]))
        if voices:
            now = time.time()
            storage.save_json(VOICES_FILE, {"ts": now, "voices": voices, "version": VOICES_CACHE_VERSION})
            return {"voices": _for_lang(voices), "source": "online", "ts": now}
    except Exception as exc:
        print(f"[Voce] Elenco voci non disponibile: {exc}")
    if cached.get("voices"):
        return {"voices": _for_lang(cached["voices"]), "source": "cache", "ts": cached.get("ts")}
    # Mai scaricato e niente rete: le voci italiane già usate dall'app (in inglese: le predefinite inglesi).
    if lang.current() == "en":
        return {"voices": [{"id": v, "name": v.split("-")[2].replace("Neural", ""), "gender": "", "locale": v[:5],
                            "group": "Inglesi", "personalities": []} for v in EN_DEFAULTS], "source": "offline"}
    return {"voices": [{"id": v, "name": v.split("-")[2].replace("Neural", ""), "gender": "", "locale": "it-IT",
                        "group": "Italiane", "personalities": []} for v in VOICES.values()], "source": "offline"}


def _for_lang(voices):
    """Voci da mostrare: italiane e multilingue; con l'interfaccia in inglese inglesi e multilingue."""
    keep = "Inglesi" if lang.current() == "en" else "Italiane"
    return [v for v in voices if v.get("group") in (keep, "Multilingue")]


def prosody(cfg=None, rate=None, pitch=None):
    """Velocità e tono nel formato di edge-tts ("+10%", "-8Hz"). Il tono include quello dell'effetto scelto."""
    cfg = cfg or load_config()
    r = _clamp(cfg.get("tts_rate") if rate is None else rate, -50, 50, 0)
    p = _clamp(cfg.get("tts_pitch") if pitch is None else pitch, -30, 30, 0)
    if _clamp(cfg.get("tts_fx_amount"), 0, 100, 70) > 0:
        p += voice_fx.PRESETS[voice_fx.preset(cfg.get("tts_effect"))]["pitch_hz"]
    return f"{r:+d}%", f"{p:+d}Hz"


def _pronounce(text):
    """Piccole correzioni di pronuncia per i termini inglesi del gioco (solo per le frasi italiane)."""
    if lang.current() == "en":
        return re.sub(r"\bCMDR\b", "Commander", text)  # scritto come in gioco, detto per intero
    return text.replace("scoopabil", "scupabil").replace("scoop", "scup")


def _trim_cache():
    files = [os.path.join(paths.TTS_CACHE_DIR, f) for f in os.listdir(paths.TTS_CACHE_DIR) if f.endswith((".mp3", ".wav"))]
    if len(files) <= MAX_CACHE_FILES:
        return
    files.sort(key=os.path.getatime)
    for f in files[:len(files) - MAX_CACHE_FILES]:
        try:
            os.remove(f)
        except OSError:
            pass


def synthesize(text, voice_key="elsa", rate=None, pitch=None):
    """Restituisce il percorso dell'mp3 (dalla cache o generato). Solleva un'eccezione se non si può.
    Velocità e tono: quelli delle impostazioni (più il tono dell'effetto), se non indicati."""
    text = _pronounce((text or "").strip())[:600]
    if not text:
        raise ValueError(pick("Testo vuoto", "Empty text"))
    voice = resolve_voice(voice_key)
    rate, pitch = prosody(None, rate, pitch)
    key = f"{voice}:{text}" if (rate, pitch) == ("+0%", "+0Hz") else f"{voice}:{rate}:{pitch}:{text}"
    h = hashlib.md5(key.encode("utf-8")).hexdigest()
    path = os.path.join(paths.TTS_CACHE_DIR, h + ".mp3")
    with _tts_locks_guard:
        lock = _tts_locks.setdefault(h, threading.Lock())
    with lock:
        if os.path.exists(path) and os.path.getsize(path) > 0:
            return path
        import edge_tts  # importato qui: senza la libreria l'app parte lo stesso
        tmp = path + ".tmp"

        async def fetch():
            await edge_tts.Communicate(text, voice, rate=rate, pitch=pitch).save(tmp)

        loop = asyncio.new_event_loop()
        try:
            loop.run_until_complete(fetch())
        finally:
            loop.close()
        if not os.path.exists(tmp) or os.path.getsize(tmp) == 0:
            raise RuntimeError(pick("Sintesi vocale non riuscita (rete?)", "Speech synthesis failed (network?)"))
        os.replace(tmp, path)
    with _tts_locks_guard:
        _tts_locks.pop(h, None)
    _trim_cache()
    return path


def mark_speaking(seconds):
    global _speaking_until
    _speaking_until = max(_speaking_until, time.time() + seconds)


def is_speaking():
    return time.time() < _speaking_until


# --- Riproduzione in coda (un messaggio alla volta) -------------------------------

_queue = queue.Queue(maxsize=20)


def _player():
    while True:
        path, volume = _queue.get()
        alias = "edc_" + uuid.uuid4().hex[:8]
        try:
            mark_speaking(30)
            mci = ctypes.windll.winmm.mciSendStringW
            mci(f'open "{path}" type mpegvideo alias {alias}', None, 0, 0)
            mci(f"setaudio {alias} volume to {max(0, min(1000, volume * 10))}", None, 0, 0)
            mci(f"play {alias} wait", None, 0, 0)
            mci(f"close {alias}", None, 0, 0)
        except Exception as exc:
            print(f"[Voce] Riproduzione non riuscita: {exc}")
        finally:
            global _speaking_until
            _speaking_until = time.time() + 1.2  # coda del riverbero: il microfono resta sordo ancora un attimo


threading.Thread(target=_player, daemon=True).start()


def render_with_effect(mp3_path, cfg=None):
    """Applica l'effetto scelto (voice_fx) all'mp3: lo stesso che l'interfaccia applica con WebAudio (tts.js)."""
    cfg = cfg or load_config()
    try:
        return voice_fx.render(mp3_path, cfg.get("tts_effect"), _clamp(cfg.get("tts_fx_amount"), 0, 100, 70) / 100)
    except Exception as exc:
        print(f"[Voce] Effetto non applicato: {exc}")
        return mp3_path


def say(text, voice_key=None, volume=None):
    """Parla dalle casse del PC, con l'effetto scelto. Restituisce subito; la sintesi avviene in background.
    È la strada di tutti gli avvisi del backend (avvisi prezzi, carburante, briefing, colonia...) e delle risposte
    ai comandi vocali (/api/voice/play, ship_control, macro)."""
    cfg = load_config()
    voice_key = voice_key if voice_key and voice_key != "sapi" else cfg["voice"]
    volume = cfg["volume"] if volume in (None, "") else _clamp(volume, 0, 100, cfg["volume"])

    def work():
        try:
            _queue.put_nowait((render_with_effect(synthesize(text, voice_key), cfg), volume))
        except queue.Full:
            pass
        except Exception as exc:
            import traceback
            print(f"[Voce] Risposta vocale non riuscita ({voice_key}): {exc!r}")
            print("".join(traceback.format_exc().splitlines(True)[-6:]))

    threading.Thread(target=work, daemon=True).start()
    return text


# --- Rapporti vocali ----------------------------------------------------------------

def report(kind="all"):
    snap = STATE.snapshot()
    loc, fuel, bio = snap.get("location") or {}, snap.get("fuel") or {}, snap.get("bio_current")
    route = snap.get("route") or []
    level, cap = fuel.get("level"), fuel.get("cap")
    fuel_pct = round(level / cap * 100) if level is not None and cap else None
    fuel_txt = (pick(f"Carburante al {fuel_pct} percento.", f"Fuel at {fuel_pct} percent.") if fuel_pct is not None
                else pick("Livello del carburante non disponibile.", "Fuel level not available."))
    if kind == "fuel":
        return fuel_txt
    if kind == "bio":
        if not bio:
            return pick("Nessun campionamento esobiologico in corso.", "No exobiology sampling in progress.")
        if not bio.get("distances"):
            return pick(f"Campionamento di {bio['species']}: distanza dal campione precedente non ancora misurata.",
                        f"Sampling {bio['species']}: distance from the previous sample not measured yet.")
        d = min(bio["distances"])
        if bio.get("far_enough"):
            return pick(f"Sei a {d} metri dall'ultimo campione: puoi campionare.",
                        f"You are {d} metres from the last sample: you can sample.")
        return pick(f"Sei a {d} metri dall'ultimo campione. Mancano {bio['min_dist'] - d} metri.",
                    f"You are {d} metres from the last sample. {bio['min_dist'] - d} metres to go.")
    if kind == "route":
        if not route:
            return pick("Nessuna rotta tracciata.", "No route plotted.")
        n = route[0]
        if lang.current() == "en":
            scoop = "scoopable" if n.get("scoopable") else "not scoopable"
            return f"Next jump: {n.get('StarSystem')}. Class {n.get('StarClass')} star, {scoop}."
        scoop = "scupabile" if n.get("scoopable") else "non scupabile"
        return f"Prossimo salto: {n.get('StarSystem')}. Stella di classe {n.get('StarClass')}, {scoop}."
    if kind in ("fsd", "damage"):
        return pick(f"Integrità del motore FSD al {snap.get('fsd_health', 100)} percento.",
                    f"FSD integrity at {snap.get('fsd_health', 100)} percent.")
    if kind == "cargo":
        cargo = snap.get("cargo") or []
        if not cargo:
            return pick("La stiva è vuota.", "The cargo hold is empty.")
        total = sum(c.get("count") or 0 for c in cargo)
        top = ", ".join(f"{c['count']} {c['name']}" for c in sorted(cargo, key=lambda c: -(c.get("count") or 0))[:3])
        return pick(f"In stiva {total} tonnellate: {top}.", f"{total} tonnes in the hold: {top}.")
    if kind == "advice":
        from . import advisor, search
        tips = advisor.advise(snap, search.coords())
        return tips[0]["text"] + "." if tips else pick("Nessun consiglio in questo momento, comandante.",
                                                        "No advice right now, CMDR.")
    name = snap.get("cmdr", {}).get("name") or ""
    if lang.current() == "en":
        ship = (snap.get("ship") or {}).get("type") or "ship"
        return f"CMDR {name}, system {loc.get('system') or 'unknown'}. Ship: {ship}. {fuel_txt}".replace("  ", " ")
    ship = (snap.get("ship") or {}).get("type") or "nave"
    return f"Comandante {name}, sistema {loc.get('system') or 'sconosciuto'}. Nave: {ship}. {fuel_txt}".replace("  ", " ")


# --- Riconoscimento vocale (Whisper locale, caricato solo quando serve) ------------

_whisper = None
_whisper_lock = threading.Lock()


_whisper_name = None


def _reset_whisper():
    """Il modello cambia alla prossima trascrizione (viene caricato, e la prima volta scaricato, in background)."""
    global _whisper, _whisper_name
    with _whisper_lock:
        _whisper, _whisper_name = None, None
    if load_config().get("enabled"):
        threading.Thread(target=whisper_model, daemon=True).start()


def whisper_model():
    global _whisper, _whisper_name
    with _whisper_lock:
        if _whisper is None:
            name = load_config().get("stt_model") if load_config().get("stt_model") in STT_MODELS else "base"
            try:
                for var in ("HF_HUB_DISABLE_PROGRESS_BARS", "HF_HUB_DISABLE_SYMLINKS_WARNING", "HF_HUB_DISABLE_TELEMETRY"):
                    os.environ.setdefault(var, "1")
                # Il modello (tiny ~75 MB, base ~145 MB, small ~480 MB, scaricato al primo uso) resta nella cartella
                # dati: l'app rimane portatile.
                os.environ.setdefault("HF_HOME", paths.cache_file("modelli"))
                from faster_whisper import WhisperModel
                print(f"[Voce] Carico il modello di riconoscimento \"{name}\" (la prima volta va scaricato)...")
                _whisper = WhisperModel(name, device="cpu", compute_type="int8", cpu_threads=max(2, (os.cpu_count() or 4) // 2))
                _whisper_name = name
                print(f"[Voce] Riconoscimento vocale pronto (modello {name}).")
            except Exception as exc:
                print(f"[Voce] Riconoscimento vocale non disponibile: {exc}")
                _whisper = False
    return _whisper or None


def _command_prompt():
    """Suggerimento per Whisper (initial_prompt): poche parole chiave dei comandi, così i termini del gioco vengono
    riconosciuti meglio. Breve apposta: un testo lungo rallenta molto la trascrizione (provato: 0,8 s contro 6 s)."""
    words = []
    for item in (storage.CONTROLS.load() or []) + (storage.MACROS.load() or []):
        name = str(item.get("name") or "").strip()
        if name and name.lower() not in (w.lower() for w in words):
            words.append(name)
    return (pick("Elite Dangerous: ", "Elite Dangerous: ") + ", ".join(words))[:260]


_last_filter = {}


def last_filter():
    """Esito del filtro rumori sull'ultima registrazione (per il pannello Audio)."""
    return dict(_last_filter)


def _decode(data):
    """Audio caricato (webm/ogg/mp4 dal browser o dal telefono, wav dal push-to-talk) → float32 mono 16 kHz
    (faster_whisper.audio.decode_audio, che usa PyAV e accetta anche un file in memoria)."""
    from faster_whisper.audio import decode_audio
    return decode_audio(io.BytesIO(data), sampling_rate=16000)


def filter_noise(audio, source="", floor_db=None, strength=None):
    """Filtro rumori (noise_filter.py) con il cursore delle impostazioni. Restituisce l'esito completo."""
    strength = load_config()["noise_filter"] if strength is None else strength
    res = noise_filter.analyze(audio, 16000, strength, floor_db)
    dropped = [e for e in res["events"] if e.get("drop")]
    _last_filter.clear()
    _last_filter.update(ts=time.time(), source=source, speech=res["speech"], kept_ms=res["kept_ms"],
                        dropped=len(dropped), dropped_short=sum(e["drop"] == "breve" for e in dropped),
                        floor_db=res.get("floor_db"), threshold_db=res.get("threshold_db"), strength=strength)
    return res


def transcribe(data, content_type="", source="", floor_db=None):
    """Trascrive un comando. source: "app", "ptt" o "phone"; floor_db: rumore di fondo calibrato, se c'è."""
    if not data or is_speaking():
        return ""
    if len(data) > MAX_UPLOAD:
        raise ValueError(pick("Audio troppo lungo", "Audio too long"))
    model = whisper_model()
    if not model:
        return ""
    strength = load_config()["noise_filter"]
    try:
        audio = _decode(data)
    except Exception as exc:
        print(f"[Voce] Audio non leggibile: {exc}")
        return ""
    try:
        if noise_filter.available():
            res = filter_noise(audio, source or ("ptt" if "wav" in content_type else "app"), floor_db, strength)
            if not res["speech"]:
                return ""  # solo clic, tasti o fruscio: Whisper non viene chiamato (così non "inventa" frasi)
            audio = res["audio"]
        # Volume: con un microfono che registra piano Whisper sbaglia di più. Si porta il picco a circa -1 dBFS
        # (guadagno massimo x30, per non gonfiare il fruscio di una registrazione quasi vuota).
        try:
            import numpy as np
            peak = float(np.max(np.abs(audio))) if len(audio) else 0.0
            if 0 < peak < 0.89:
                audio = (audio * min(30.0, 0.89 / peak)).astype(np.float32)
        except Exception:
            pass
        # Poi il VAD di Whisper (Silero) toglie il resto del silenzio; i parametri seguono lo stesso cursore.
        # Lingua dell'interfaccia: Whisper (modello multilingue "tiny") trascrive in italiano o in inglese.
        segments, _ = model.transcribe(audio, language=lang.current(), beam_size=1, temperature=0.0, vad_filter=True,
                                       initial_prompt=_command_prompt(), without_timestamps=True,
                                       vad_parameters=noise_filter.vad_parameters(strength),
                                       condition_on_previous_text=False)
        text = " ".join(s.text for s in segments).strip()
        # Nel registro ciò che è stato capito: serve per capire dove il riconoscimento sbaglia (resta solo sul PC).
        print(f"[Voce] capito ({source or 'app'}, {_whisper_name}): {text!r}")
        return text if re.search(r"\w", text) else ""  # "..." e simili: Whisper non ha sentito parole
    except Exception as exc:
        print(f"[Voce] Trascrizione non riuscita: {exc}")
        return ""


def preload_if_enabled():
    if load_config().get("enabled"):
        whisper_model()


# --- API (registrate da server.FEATURES) --------------------------------------------

def _test_voice(q):
    """Prova di voce ed effetto dalle casse del PC: la stessa strada degli avvisi del backend."""
    text = (q.get("text") or pick("Sistemi di bordo attivi. Copilota vocale operativo, comandante.",
                                  "Onboard systems online. Voice copilot operational, CMDR."))[:200]
    return {"played": say(text, q.get("voice") or None, q.get("volume"))}


def _noise_status(q):
    strength = load_config()["noise_filter"]
    return {"last": last_filter(), "available": noise_filter.available(),
            "params": noise_filter.params(strength), "vad": noise_filter.vad_parameters(strength)}


GET = {
    "/api/voice/voices": lambda q: list_voices(q.get("refresh") == "1"),
    "/api/voice/fx": lambda q: {"available": voice_fx.available(),
                                "presets": voice_fx.presets()},
    "/api/voice/noise": _noise_status,
    "/api/voice/test": _test_voice,
}
POST = {}
LAN = set()
