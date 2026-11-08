"""Comandi alla nave: pressione di tasti nel gioco tramite SendInput (scan code, come una tastiera vera).

Sicurezza: i tasti vengono inviati solo se la finestra di Elite Dangerous è (o può essere portata) in primo piano,
così un comando non finisce mai per sbaglio in un altro programma.
I tasti vengono letti dalle assegnazioni del gioco (bindings.py): nelle sequenze "@NomeComando" indica il tasto
assegnato in gioco a quel comando, "LSHIFT+J" una combinazione.
"""

import ctypes
import threading
import time
from ctypes import wintypes

from . import bindings, kblayout, lang, paths, storage
from .lang import pick
from .journal import read_status

ED_WINDOW_TITLES = ("Elite - Dangerous (CLIENT)", "Elite - Dangerous")
MAX_WAIT_MS = 5000

SCAN_CODES = {
    "1": (0x02, False), "2": (0x03, False), "3": (0x04, False), "4": (0x05, False),
    "5": (0x06, False), "6": (0x07, False), "7": (0x08, False), "8": (0x09, False),
    "9": (0x0A, False), "0": (0x0B, False),
    "A": (0x1E, False), "B": (0x30, False), "C": (0x2E, False), "D": (0x20, False),
    "E": (0x12, False), "F": (0x21, False), "G": (0x22, False), "H": (0x23, False),
    "I": (0x17, False), "J": (0x24, False), "K": (0x25, False), "L": (0x26, False),
    "M": (0x32, False), "N": (0x31, False), "O": (0x18, False), "P": (0x19, False),
    "Q": (0x10, False), "R": (0x13, False), "S": (0x1F, False), "T": (0x14, False),
    "U": (0x16, False), "V": (0x2F, False), "W": (0x11, False), "X": (0x2D, False),
    "Y": (0x15, False), "Z": (0x2C, False),
    "SPACE": (0x39, False), "ENTER": (0x1C, False), "TAB": (0x0F, False), "ESC": (0x01, False),
    "UP": (0x48, True), "DOWN": (0x50, True), "LEFT": (0x4B, True), "RIGHT": (0x4D, True),
    "HOME": (0x47, True), "INSERT": (0x52, True), "DELETE": (0x53, True), "END": (0x4F, True),
    "PAGEUP": (0x49, True), "PAGEDOWN": (0x51, True),
    "COMMA": (0x33, False), "PERIOD": (0x34, False), "SEMICOLON": (0x27, False),
    "MINUS": (0x0C, False), "EQUALS": (0x0D, False), "BACKSPACE": (0x0E, False),
    "LSHIFT": (0x2A, False), "RSHIFT": (0x36, False), "LCONTROL": (0x1D, False), "RCONTROL": (0x1D, True),
    "LALT": (0x38, False), "RALT": (0x38, True),
    "F1": (0x3B, False), "F2": (0x3C, False), "F3": (0x3D, False), "F4": (0x3E, False),
    "F5": (0x3F, False), "F6": (0x40, False), "F7": (0x41, False), "F8": (0x42, False),
    "F9": (0x43, False), "F10": (0x44, False), "F11": (0x57, False), "F12": (0x58, False),
    "APOSTROPHE": (0x28, False), "SLASH": (0x35, False), "BACKSLASH": (0x2B, False), "GRAVE": (0x29, False),
    "LBRACKET": (0x1A, False), "RBRACKET": (0x1B, False),
    "NUMPAD_7": (0x47, False), "NUMPAD_8": (0x48, False), "NUMPAD_9": (0x49, False), "NUMPAD_4": (0x4B, False),
    "NUMPAD_5": (0x4C, False), "NUMPAD_6": (0x4D, False), "NUMPAD_1": (0x4F, False), "NUMPAD_2": (0x50, False),
    "NUMPAD_3": (0x51, False), "NUMPAD_0": (0x52, False), "NUMPAD_DECIMAL": (0x53, False),
    "NUMPAD_SUBTRACT": (0x4A, False), "NUMPAD_ADD": (0x4E, False), "NUMPAD_MULTIPLY": (0x37, False),
    "NUMPAD_DIVIDE": (0x35, True), "NUMPAD_ENTER": (0x1C, True),
}


class KEYBDINPUT(ctypes.Structure):
    _fields_ = [("wVk", wintypes.WORD), ("wScan", wintypes.WORD), ("dwFlags", wintypes.DWORD),
                ("time", wintypes.DWORD), ("dwExtraInfo", ctypes.c_size_t)]


class _INPUT_UNION(ctypes.Union):
    _fields_ = [("ki", KEYBDINPUT), ("pad", ctypes.c_byte * 32)]


class INPUT(ctypes.Structure):
    _fields_ = [("type", wintypes.DWORD), ("u", _INPUT_UNION)]


_send_lock = threading.Lock()


def _send(scan, extended, up):
    flags = 0x0008 | (0x0002 if up else 0) | (0x0001 if extended else 0)  # SCANCODE | KEYUP | EXTENDEDKEY
    inp = INPUT(type=1, u=_INPUT_UNION(ki=KEYBDINPUT(0, scan, flags, 0, 0)))
    ctypes.windll.user32.SendInput(1, ctypes.byref(inp), ctypes.sizeof(INPUT))


def _ed_window():
    user32 = ctypes.windll.user32
    for title in ED_WINDOW_TITLES:
        hwnd = user32.FindWindowW(None, title)
        if hwnd:
            return hwnd
    return None


def focus_game():
    """Porta in primo piano la finestra di Elite. Restituisce True se è in primo piano.

    Windows permette SetForegroundWindow solo in certe condizioni: ci si "aggancia" per un attimo al thread della
    finestra in primo piano (AttachThreadInput), come fanno i programmi di macro, e si aspetta che il gioco arrivi
    davvero davanti (in finestra senza bordi può servire qualche centinaio di millisecondi).
    """
    try:
        user32, kernel32 = ctypes.windll.user32, ctypes.windll.kernel32
        hwnd = _ed_window()
        if not hwnd:
            return False
        if user32.GetForegroundWindow() == hwnd:
            return True
        if user32.IsIconic(hwnd):
            user32.ShowWindow(hwnd, 9)  # SW_RESTORE solo se è ridotto a icona
        fg = user32.GetForegroundWindow()
        fg_thread = user32.GetWindowThreadProcessId(fg, None) if fg else 0
        me = kernel32.GetCurrentThreadId()
        attached = bool(fg_thread and fg_thread != me and user32.AttachThreadInput(me, fg_thread, True))
        try:
            user32.BringWindowToTop(hwnd)
            user32.SetForegroundWindow(hwnd)
        finally:
            if attached:
                user32.AttachThreadInput(me, fg_thread, False)
        for _ in range(40):  # fino a 2 secondi
            if user32.GetForegroundWindow() == hwnd:
                time.sleep(0.15)  # il gioco deve anche "accorgersi" di essere davanti prima di ricevere i tasti
                return True
            time.sleep(0.05)
        return False
    except Exception:
        return False


def _scan(part, hwnd=None):
    """Scan code di un tasto: lettere e simboli secondo il layout del gioco (kblayout.py), gli altri dalla tabella."""
    ch = kblayout.char_of(part)
    if ch is not None:
        return kblayout.scan_for(ch, hwnd)
    return SCAN_CODES.get(part.upper())


def valid(key):
    k = str(key).strip()
    return k.upper().startswith(("WAIT:", "@")) or all(
        p.upper() in SCAN_CODES or kblayout.char_of(p) is not None for p in k.split("+"))


def resolve(key):
    """'@LandingGearToggle' -> tasto assegnato in gioco (o None); gli altri tasti restano come sono."""
    k = str(key).strip()
    if k.startswith("@"):
        return bindings.token(k[1:])
    return k if k.upper().startswith("CHR_") else k.upper()


def unbound(keys):
    """Comandi del gioco usati nella sequenza che non hanno un tasto della tastiera."""
    names = [str(k).strip()[1:] for k in keys if str(k).strip().startswith("@")]
    return [n for n in dict.fromkeys(names) if not bindings.token(n)]


def press(key, hold=0.08):
    """Preme un tasto o una combinazione ("LSHIFT+J": i modificatori restano premuti)."""
    hwnd = _ed_window()
    parts = [_scan(p, hwnd) for p in str(key).strip().split("+")]
    if not parts or None in parts:
        print(f"[Comandi] il tasto {key} non esiste con il layout della tastiera del gioco: non premuto")
        return False
    for scan, ext in parts:
        _send(scan, ext, False)
        time.sleep(0.02)
    time.sleep(hold)
    for scan, ext in reversed(parts):
        _send(scan, ext, True)
    return True


def run_sequence(keys, hold_ms=60, gap_ms=120):
    """Esegue una sequenza di tasti; "WAIT:ms" inserisce una pausa (max 5 secondi)."""
    resolved = [resolve(k) or "?" for k in keys]
    if not focus_game():
        print(f"[Comandi] {' '.join(resolved)}: Elite non è in primo piano, nessun tasto premuto")
        return False
    print(f"[Comandi] tasti inviati a Elite: {' '.join(resolved)}")
    with _send_lock:
        for k in keys:
            k = resolve(k) or ""
            if k.startswith("WAIT:"):
                try:
                    ms = min(MAX_WAIT_MS, max(0, int(k.split(":", 1)[1])))
                except ValueError:
                    ms = 200
                time.sleep(ms / 1000)
                continue
            if press(k, hold_ms / 1000):
                time.sleep(gap_ms / 1000)
    return True


# --- Azioni della nave --------------------------------------------------------------
# Ogni azione: tasti, frase detta, e facoltativamente il flag di Status.json che dice se è già attiva.
FLAG_GEAR, FLAG_LIGHTS, FLAG_HARDPOINTS, FLAG_CARGO = 4, 256, 64, 512

# Pannello sinistro -> scheda Contatti -> stazione -> "Richiedi attracco" -> chiudi.
DOCKING = ["@FocusLeftPanel", "WAIT:250", "@CycleNextPanel", "WAIT:130", "@CycleNextPanel", "WAIT:130", "@UI_Select",
           "WAIT:130", "@UI_Right", "WAIT:130", "@UI_Select", "WAIT:160", "@FocusLeftPanel"]

ACTIONS = {
    "pips_sys": (["@IncreaseSystemsPower"] * 4, "Massima energia agli scudi."),
    "pips_eng": (["@IncreaseEnginesPower"] * 4, "Massima energia ai motori."),
    "pips_wep": (["@IncreaseWeaponsPower"] * 4, "Massima energia alle armi."),
    "pips_reset": (["@ResetPowerDistribution"], "Energia ribilanciata."),
    "docking_request": (DOCKING, "Richiesta di attracco inviata."),
    "gear": (["@LandingGearToggle"], "Carrello commutato."),
    "cargo": (["@ToggleCargoScoop"], "Boccaporto di carico commutato."),
    "lights": (["@ShipSpotLightToggle"], "Fari commutati."),
    "hardpoints": (["@DeployHardpointToggle"], "Armi commutate."),
    "night_vision": (["@NightVisionToggle"], "Visione notturna commutata."),
    "silent_running": (["@ToggleButtonUpInput"], "Navigazione silenziosa commutata. Attenzione al calore."),
    "chaff": (["@FireChaffLauncher"], "Chaff lanciato."),
    "heatsink": (["@DeployHeatSink"], "Dissipatore espulso."),
    "shield_cell": (["@UseShieldCell"], "Cella scudo attivata."),
    "stop": (["@SetSpeedZero"], "Manetta a zero."),
    "throttle75": (["@SetSpeed75"], "Manetta al settantacinque percento."),
    "fsd_jump": (["@HyperSuperCombination"], "Motore FSD attivato."),
    "galmap": (["@GalaxyMapOpen"], "Mappa galattica."),
    "sysmap": (["@SystemMapOpen"], "Mappa del sistema."),
    "boost": (["@UseBoostJuice"], "Boost."),
}
# Macro predefinite scritte con i tasti di fabbrica: le traduciamo nei comandi del gioco.
LEGACY_MACROS = {
    ("1", "WAIT:250", "E", "E", "SPACE", "RIGHT", "SPACE", "1"): DOCKING,
    ("LEFT",) * 4: ["@IncreaseSystemsPower"] * 4, ("UP",) * 4: ["@IncreaseEnginesPower"] * 4,
    ("RIGHT",) * 4: ["@IncreaseWeaponsPower"] * 4, ("DOWN",): ["@ResetPowerDistribution"], ("V",): ["@DeployHeatSink"],
    ("LEFT", "LEFT", "UP", "UP", "TAB"): ["@IncreaseSystemsPower"] * 2 + ["@IncreaseEnginesPower"] * 2 + ["@UseBoostJuice"],
}
# Versioni "accendi/spegni" che controllano lo stato reale prima di premere.
STATEFUL = {
    "gear_down": ("gear", FLAG_GEAR, True, "Il carrello è già abbassato."),
    "gear_up": ("gear", FLAG_GEAR, False, "Il carrello è già ritirato."),
    "cargo_open": ("cargo", FLAG_CARGO, True, "Il boccaporto è già aperto."),
    "cargo_close": ("cargo", FLAG_CARGO, False, "Il boccaporto è già chiuso."),
    "lights_on": ("lights", FLAG_LIGHTS, True, "I fari sono già accesi."),
    "lights_off": ("lights", FLAG_LIGHTS, False, "I fari sono già spenti."),
    "hardpoints_deploy": ("hardpoints", FLAG_HARDPOINTS, True, "Le armi sono già estratte."),
    "hardpoints_retract": ("hardpoints", FLAG_HARDPOINTS, False, "Le armi sono già ritirate."),
}
# Frasi in inglese (interfaccia in inglese): stesse chiavi di ACTIONS e STATEFUL.
ACTIONS_EN = {
    "pips_sys": "Maximum power to shields.", "pips_eng": "Maximum power to engines.",
    "pips_wep": "Maximum power to weapons.", "pips_reset": "Power distribution balanced.",
    "docking_request": "Docking request sent.", "gear": "Landing gear toggled.", "cargo": "Cargo scoop toggled.",
    "lights": "Lights toggled.", "hardpoints": "Hardpoints toggled.", "night_vision": "Night vision toggled.",
    "silent_running": "Silent running toggled. Watch your heat.", "chaff": "Chaff launched.",
    "heatsink": "Heat sink deployed.", "shield_cell": "Shield cell activated.", "stop": "Throttle to zero.",
    "throttle75": "Throttle at seventy-five percent.", "fsd_jump": "Frame Shift Drive engaged.",
    "galmap": "Galaxy map.", "sysmap": "System map.", "boost": "Boost.",
}
STATEFUL_EN = {
    "gear_down": "Landing gear is already down.", "gear_up": "Landing gear is already up.",
    "cargo_open": "Cargo scoop is already open.", "cargo_close": "Cargo scoop is already closed.",
    "lights_on": "Lights are already on.", "lights_off": "Lights are already off.",
    "hardpoints_deploy": "Hardpoints are already deployed.", "hardpoints_retract": "Hardpoints are already retracted.",
}
# Risposte inglesi dei controlli e delle macro predefiniti (defaults/controls.json, defaults/macros.json): usate
# solo se la frase dell'utente è ancora quella italiana di fabbrica, altrimenti si dice la sua.
BUILTIN_VOICE_EN = {
    "landing_gear": "Landing gear toggled, CMDR.", "ship_lights": "Ship lights toggled.",
    "cargo_scoop": "Cargo scoop toggled.", "night_vision": "Night vision toggled.",
    "silent_running": "Silent running toggled. Keep an eye on your heat.",
    "fsd_jump": "Frame Shift Drive engaged.", "hardpoints": "Hardpoints toggled.",
    "heatsink": "Heat sink deployed. Temperature dropping fast.",
    "shield_cell": "Shield cell activated. Shields recharging.", "chaff": "Chaff deployed.",
    "stop_ship": "Throttle to zero. Ship stopping.",
    "throttle_75": "Throttle set to seventy-five percent for the optimal approach.",
    "galmap": "Galaxy map open.", "sysmap": "System map open.",
    # macro
    "docking_request": "Docking request sent to the station.",
    "pips_shields": "Four pips to systems.", "pips_engines": "Four pips to engines.",
    "pips_weapons": "Four pips to weapons.", "pips_reset": "Power distribution balanced across all systems.",
    "emergency_boost": "Evasive manoeuvre and boost engaged.",
}
_builtin_cache = {}


def _builtin_voice(item_id, voice_text, default_name):
    """La frase da dire per un controllo/una macro: in inglese, se è ancora quella di fabbrica, la sua traduzione."""
    if lang.current() != "en" or item_id not in BUILTIN_VOICE_EN:
        return voice_text
    if default_name not in _builtin_cache:
        _builtin_cache[default_name] = {i.get("id"): i.get("voice") for i in (storage.load_json(paths.default_file(default_name), []) or [])
                                        if isinstance(i, dict)}
    default = _builtin_cache[default_name].get(item_id)
    return BUILTIN_VOICE_EN[item_id] if not voice_text or voice_text == default else voice_text


ALIASES = {"pip_sys": "pips_sys", "sys": "pips_sys", "pip_eng": "pips_eng", "eng": "pips_eng", "pip_wep": "pips_wep",
           "wep": "pips_wep", "pip_reset": "pips_reset", "reset_pips": "pips_reset", "docking": "docking_request",
           "landing_gear": "gear", "gear_toggle": "gear", "landing_gear_down": "gear_down", "landing_gear_up": "gear_up",
           "cargo_scoop": "cargo", "cargo_toggle": "cargo", "ship_lights": "lights", "lights_toggle": "lights",
           "armi": "hardpoints", "hardpoints_toggle": "hardpoints", "nv": "night_vision", "silent": "silent_running",
           "scb": "shield_cell", "stop_ship": "stop", "throttle_75": "throttle75", "jump": "fsd_jump", "fsd": "fsd_jump"}


def ship_action(action):
    """Esegue un'azione della nave. Restituisce (eseguita, frase da dire)."""
    act = ALIASES.get(action, action)
    if act in STATEFUL:
        base, flag, want_on, already = STATEFUL[act]
        if bool(read_status().get("Flags", 0) & flag) == want_on:
            return False, pick(already, STATEFUL_EN[act])
        act = base
    if act in ACTIONS:
        keys, phrase = ACTIONS[act]
        phrase = pick(phrase, ACTIONS_EN[act])
    else:
        ctrl = next((c for c in storage.CONTROLS.load() if c.get("id") == act or c.get("name", "").lower() == act), None)
        if not ctrl:
            return False, pick("Comando non riconosciuto.", "Command not recognised.")
        keys = [ctrl.get("key", "")]
        phrase = (_builtin_voice(ctrl.get("id"), ctrl.get("voice"), "controls.json")
                  or pick(f"{ctrl.get('name')} eseguito.", f"{ctrl.get('name')} done."))
    missing = unbound(keys)
    if missing:
        return False, _unbound_phrase(missing)
    if not run_sequence(keys, hold_ms=40 if act.startswith("pips") else 80, gap_ms=40 if act.startswith("pips") else 120):
        return False, pick("Elite Dangerous non è aperto o non si riesce a portarlo in primo piano.",
                           "Elite Dangerous isn't running or can't be brought to the foreground.")
    return True, phrase


def _unbound_phrase(names):
    labels = ", ".join(bindings.label(n) for n in names)
    return pick(f"Non posso farlo: {labels} non ha un tasto della tastiera assegnato in gioco. "
                "Aggiungilo dalla scheda Voce e comandi.",
                f"I can't do that: {labels} has no keyboard key bound in game. "
                "Add one from the Voice and controls tab.")


def run_macro(macro_id):
    macro = next((m for m in storage.MACROS.load() if m.get("id") == macro_id), None)
    if not macro:
        return False, pick("Macro non trovata.", "Macro not found.")
    keys = [k for k in macro.get("keys", []) if valid(k)]
    keys = LEGACY_MACROS.get(tuple(str(k).strip().upper() for k in keys), keys)
    missing = unbound(keys)
    if missing:
        return False, _unbound_phrase(missing)
    if not run_sequence(keys):
        return False, pick("Elite Dangerous non è aperto o non si riesce a portarlo in primo piano.",
                           "Elite Dangerous isn't running or can't be brought to the foreground.")
    return True, (_builtin_voice(macro.get("id"), macro.get("voice"), "macros.json")
                  or pick(f"Macro {macro.get('name')} eseguita.", f"Macro {macro.get('name')} done."))
