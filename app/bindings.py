"""Assegnazioni dei tasti del gioco (file .binds di Elite Dangerous).

Il gioco salva i controlli in %LOCALAPPDATA%\\Frontier Developments\\Elite Dangerous\\Options\\Bindings:
StartPreset.4.start dice quale preset usa ogni categoria (generale, nave, SRV, a piedi) e i file <preset>.x.y.binds
contengono i comandi. I preset di fabbrica stanno nella cartella del gioco (ControlSchemes).

Da qui i comandi dell'app sanno quale tasto della TASTIERA premere. Un comando assegnato solo a cloche o
gamepad non si può simulare: in quel caso lo segnaliamo e, se lo chiedi, aggiungiamo un tasto libero della tastiera
nello slot vuoto (con copia di sicurezza del file).
"""

import glob
import os
import re
import shutil
import threading
import time
import winreg
import xml.etree.ElementTree as ET

from . import kblayout, paths
from .lang import pick

BINDINGS_DIR = os.path.join(os.environ.get("LOCALAPPDATA", ""), "Frontier Developments", "Elite Dangerous",
                            "Options", "Bindings")
CONTROL_SCHEMES = os.path.join("Products", "elite-dangerous-odyssey-64", "ControlSchemes")

# Comandi usati dall'app: nome nel file .binds -> (descrizione, tasto predefinito del preset tastiera)
USED = {
    "LandingGearToggle": ("Carrello", "Key_L"),
    "ShipSpotLightToggle": ("Fari", "Key_Insert"),
    "ToggleCargoScoop": ("Cargo scoop", "Key_Home"),
    "DeployHardpointToggle": ("Hardpoint (armi)", "Key_U"),
    "NightVisionToggle": ("Visione notturna", "Key_N"),
    "ToggleButtonUpInput": ("Silent running", "Key_Delete"),
    "FireChaffLauncher": ("Chaff", "Key_C"),
    "DeployHeatSink": ("Heat sink", "Key_V"),
    "UseShieldCell": ("Shield cell", "Key_B"),
    "SetSpeedZero": ("Manetta a zero", "Key_X"),
    "SetSpeed75": ("Manetta al 75%", "Key_7"),
    "HyperSuperCombination": ("Salto FSD (combinato)", "Key_J"),
    "GalaxyMapOpen": ("Mappa galattica", "Key_M"),
    "SystemMapOpen": ("Mappa del sistema", "Key_SemiColon"),
    "IncreaseSystemsPower": ("Energia a SYS", "Key_LeftArrow"),
    "IncreaseEnginesPower": ("Energia a ENG", "Key_UpArrow"),
    "IncreaseWeaponsPower": ("Energia a WEP", "Key_RightArrow"),
    "ResetPowerDistribution": ("Ribilancia energia", "Key_DownArrow"),
    "UseBoostJuice": ("Boost", "Key_Tab"),
    "FocusLeftPanel": ("Pannello sinistro", "Key_1"),
    "CycleNextPanel": ("Scheda successiva", "Key_E"),
    "CyclePreviousPanel": ("Scheda precedente", "Key_Q"),
    "UI_Select": ("Interfaccia: seleziona", "Key_Space"),
    "UI_Back": ("Interfaccia: indietro", "Key_Backspace"),
    "UI_Up": ("Interfaccia: su", "Key_W"),
    "UI_Down": ("Interfaccia: giù", "Key_S"),
    "UI_Left": ("Interfaccia: sinistra", "Key_A"),
    "UI_Right": ("Interfaccia: destra", "Key_D"),
}
# Descrizioni in inglese (USED resta una tupla: keys.py ne legge il primo elemento).
LABEL_EN = {
    "LandingGearToggle": "Landing gear", "ShipSpotLightToggle": "Ship lights", "ToggleCargoScoop": "Cargo scoop",
    "DeployHardpointToggle": "Hardpoints (weapons)", "NightVisionToggle": "Night vision",
    "ToggleButtonUpInput": "Silent running", "FireChaffLauncher": "Chaff", "DeployHeatSink": "Heat sink",
    "UseShieldCell": "Shield cell", "SetSpeedZero": "Throttle to zero", "SetSpeed75": "Throttle to 75%",
    "HyperSuperCombination": "FSD jump (combined)", "GalaxyMapOpen": "Galaxy map", "SystemMapOpen": "System map",
    "IncreaseSystemsPower": "Power to SYS", "IncreaseEnginesPower": "Power to ENG",
    "IncreaseWeaponsPower": "Power to WEP", "ResetPowerDistribution": "Balance power", "UseBoostJuice": "Boost",
    "FocusLeftPanel": "Left panel", "CycleNextPanel": "Next tab", "CyclePreviousPanel": "Previous tab",
    "UI_Select": "UI: select", "UI_Back": "UI: back", "UI_Up": "UI: up", "UI_Down": "UI: down",
    "UI_Left": "UI: left", "UI_Right": "UI: right",
}


def label(name):
    """Descrizione di un comando nella lingua dell'interfaccia (il nome stesso se sconosciuto)."""
    it = USED.get(name, (name,))[0]
    return pick(it, LABEL_EN.get(name, it))


# Comandi della categoria "Generali" (gli altri sono "Nave").
GENERAL = {"UI_Select", "UI_Back", "UI_Up", "UI_Down", "UI_Left", "UI_Right", "CycleNextPanel", "CyclePreviousPanel"}

# Tasti liberi da proporre se quello predefinito è già occupato.
SPARE_KEYS = ["Key_F5", "Key_F6", "Key_F7", "Key_F8", "Key_F9", "Key_F11", "Key_F12",
              "Key_Numpad_Divide", "Key_Numpad_Multiply", "Key_Numpad_Subtract", "Key_Numpad_Add",
              "Key_Numpad_Decimal", "Key_Numpad_0", "Key_PageUp", "Key_PageDown", "Key_End", "Key_Insert",
              "Key_Delete", "Key_Home", "Key_I", "Key_J", "Key_K", "Key_L", "Key_P", "Key_Y", "Key_H"]

# Nome del tasto nel file .binds -> nome usato dall'app (keys.SCAN_CODES)
_SPECIAL = {
    "Space": "SPACE", "Enter": "ENTER", "Tab": "TAB", "Escape": "ESC", "Backspace": "BACKSPACE",
    "UpArrow": "UP", "DownArrow": "DOWN", "LeftArrow": "LEFT", "RightArrow": "RIGHT",
    "Home": "HOME", "End": "END", "Insert": "INSERT", "Delete": "DELETE", "PageUp": "PAGEUP", "PageDown": "PAGEDOWN",
    "Comma": "COMMA", "Period": "PERIOD", "SemiColon": "SEMICOLON", "Minus": "MINUS", "Equals": "EQUALS",
    "Apostrophe": "APOSTROPHE", "Slash": "SLASH", "BackSlash": "BACKSLASH", "LeftBracket": "LBRACKET",
    "RightBracket": "RBRACKET", "Grave": "GRAVE",
    "LeftShift": "LSHIFT", "RightShift": "RSHIFT", "LeftControl": "LCONTROL", "RightControl": "RCONTROL",
    "LeftAlt": "LALT", "RightAlt": "RALT",
    "Numpad_Divide": "NUMPAD_DIVIDE", "Numpad_Multiply": "NUMPAD_MULTIPLY", "Numpad_Subtract": "NUMPAD_SUBTRACT",
    "Numpad_Add": "NUMPAD_ADD", "Numpad_Decimal": "NUMPAD_DECIMAL", "Numpad_Enter": "NUMPAD_ENTER",
}

_lock = threading.Lock()
_cache = {"key": None, "data": None}


def to_token(ed_key):
    """'Key_LeftShift' -> 'LSHIFT', 'Key_Numpad_4' -> 'NUMPAD_4'. None se il tasto non è gestito."""
    if not ed_key or not ed_key.startswith("Key_"):
        return None
    name = ed_key[4:]
    if name in _SPECIAL:
        return _SPECIAL[name]
    if re.fullmatch(r"[A-Z0-9]", name) or re.fullmatch(r"F([1-9]|1[0-2])", name):
        return name
    if re.fullmatch(r"Numpad_[0-9]", name):
        return name.upper()
    if len(name) == 1 and not name.isascii():
        return "CHR_" + name  # tasti del layout locale, es. "Key_à" con la tastiera italiana (vedi kblayout.py)
    return None


# Tasti che il gioco usa per sé: F10 scatta lo screenshot (Alt+F10 quello ad alta risoluzione), quindi un comando
# su F10 farebbe anche una foto ogni volta.
RESERVED = {"F10"}


def usable(token):
    """Il token esiste, non è riservato dal gioco e si preme con un solo tasto nel layout della tastiera."""
    return bool(token) and token not in RESERVED and all(kblayout.reachable(t) for t in token.split("+"))


def _game_dirs():
    """Cartelle di installazione possibili (Steam, Epic, launcher Frontier)."""
    roots = []
    try:
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Valve\Steam") as k:
            steam = winreg.QueryValueEx(k, "SteamPath")[0]
        roots.append(steam)
        vdf = os.path.join(steam, "steamapps", "libraryfolders.vdf")
        with open(vdf, encoding="utf-8", errors="ignore") as f:
            roots += [p.replace("\\\\", "\\") for p in re.findall(r'"path"\s+"([^"]+)"', f.read())]
    except OSError:
        pass
    found = [os.path.join(r, "steamapps", "common", "Elite Dangerous") for r in roots]
    found += [r"C:\Program Files\Epic Games\EliteDangerous", r"C:\Program Files (x86)\Frontier\EDLaunch",
              r"C:\Program Files (x86)\Frontier"]
    return [d for d in dict.fromkeys(found) if os.path.isdir(d)]


def _presets():
    try:
        with open(os.path.join(BINDINGS_DIR, "StartPreset.4.start"), encoding="utf-8-sig") as f:
            lines = [l.strip() for l in f if l.strip()]
    except OSError:
        try:
            with open(os.path.join(BINDINGS_DIR, "StartPreset.start"), encoding="utf-8-sig") as f:
                lines = [f.read().strip()]
        except OSError:
            lines = []
    lines = lines or ["KeyboardMouseOnly"]
    general = lines[0]
    ship = lines[1] if len(lines) > 1 else general
    return general, ship


def _version(path):
    m = re.search(r"\.(\d+)\.(\d+)\.binds$", path)
    return (int(m.group(1)), int(m.group(2))) if m else (0, 0)


def preset_file(name):
    """(percorso, modificabile). I file dell'utente hanno la precedenza su quelli di fabbrica."""
    user = [p for p in glob.glob(os.path.join(BINDINGS_DIR, glob.escape(name) + "*.binds"))
            if re.fullmatch(re.escape(name) + r"(\.\d+\.\d+)?\.binds", os.path.basename(p))]
    if user:
        return max(user, key=_version), True
    for d in _game_dirs():
        p = os.path.join(d, CONTROL_SCHEMES, name + ".binds")
        if os.path.isfile(p):
            return p, False
    return None, False


def _parse(path):
    root = ET.parse(path).getroot()
    out, used = {}, {}
    for el in root:
        slots = []
        for slot in ("Primary", "Secondary"):
            s = el.find(slot)
            if s is None:
                continue
            mods = [m.get("Key") for m in s.findall("Modifier") if m.get("Device") == "Keyboard"]
            slots.append({"slot": slot, "device": s.get("Device"), "key": s.get("Key") or "", "mods": mods})
            if s.get("Device") == "Keyboard" and s.get("Key") and not mods:
                used.setdefault(s.get("Key"), []).append(el.tag)
        if slots:
            out[el.tag] = slots
    return out, used


def load():
    """Assegnazioni attive: {comando: {...}} più l'elenco dei tasti già usati."""
    general, ship = _presets()
    files = {"general": preset_file(general), "ship": preset_file(ship)}
    sig = tuple((p, os.path.getmtime(p)) for p, _ in files.values() if p)
    with _lock:
        if _cache["key"] == sig:
            return _cache["data"]
    parsed = {}
    for cat, (path, _) in files.items():
        try:
            parsed[cat] = _parse(path) if path else ({}, {})
        except (OSError, ET.ParseError) as exc:
            print(f"[Tasti] File dei controlli illeggibile ({path}): {exc}")
            parsed[cat] = ({}, {})
    commands = {}
    for name, (label, default) in USED.items():
        cat = "general" if name in GENERAL else "ship"
        slots = parsed[cat][0].get(name)
        kb = next((s for s in slots or [] if s["device"] == "Keyboard" and usable(to_token(s["key"]))
                   and all(to_token(m) for m in s["mods"])), None)
        # Tasto assegnato ma impossibile da premere con questo layout (es. "Key_SemiColon" sulla tastiera italiana).
        bad = next((s["key"] for s in slots or [] if s["device"] == "Keyboard" and s["key"] and not s["mods"]
                    and not usable(to_token(s["key"]))), None)
        other = [s for s in slots or [] if s["device"] not in ("Keyboard", "{NoDevice}") and s["key"]]
        token = "+".join([to_token(m) for m in kb["mods"]] + [to_token(kb["key"])]) if kb else None
        commands[name] = {
            "name": name, "label": label, "category": cat, "token": token,
            "keyboard": ("+".join(kb["mods"] + [kb["key"]]).replace("Key_", "") if kb else None),
            "other": [f"{s['device']} {s['key']}" for s in other],
            "free_slot": any(s["device"] == "{NoDevice}" for s in slots or []),
            "bad_keyboard": bad if not kb else None,
            # File senza il comando (preset molto vecchio): usiamo il tasto predefinito del gioco.
            "missing": slots is None,
        }
        if slots is None and default:
            commands[name]["token"] = to_token(default)
    data = {
        "presets": {"general": general, "ship": ship},
        "files": {cat: {"path": p, "editable": e} for cat, (p, e) in files.items()},
        "commands": commands, "used": {**parsed["general"][1], **parsed["ship"][1]},
    }
    with _lock:
        _cache.update(key=sig, data=data)
    return data


def token(name):
    """Tasto da premere per un comando del gioco, o None se non è assegnato alla tastiera."""
    cmd = load()["commands"].get(name)
    return cmd["token"] if cmd else None


def summary():
    data = load()
    cmds = list(data["commands"].values())
    return {**{k: v for k, v in data.items() if k != "used"},
            "commands": [{**c, "label": label(c["name"])} for c in cmds], "dir": BINDINGS_DIR,
            "missing_keyboard": [c["name"] for c in cmds if not c["token"]]}


def _pick_key(name, used, taken):
    default = USED.get(name, (None, None))[1]
    for k in ([default] if default else []) + SPARE_KEYS:
        if k and k not in used and k not in taken and usable(to_token(k)):
            return k
    return None


def assign_missing(names=None):
    """Aggiunge un tasto della tastiera libero ai comandi che non ne hanno uno (solo negli slot vuoti).

    Modifica solo i file dell'utente, dopo averne fatto una copia di sicurezza. Il gioco legge i controlli
    all'avvio: va riavviato (o ricaricato il preset dalle Opzioni) per vedere i nuovi tasti.
    """
    # Le copie di prova dell'app (cartella dati alternativa, VOIDWATCH_DATA o il vecchio ED_COPILOT_DATA) non devono
    # mai toccare i controlli veri.
    if paths.env("DATA") and os.path.normcase(BINDINGS_DIR).startswith(
            os.path.normcase(os.environ.get("LOCALAPPDATA", "") or "?")):
        return {"done": [], "skipped": [], "error": pick("Istanza di prova: i controlli del gioco non vengono modificati.",
                                                         "Test instance: the game controls are not modified.")}
    data = load()
    todo = [c for c in data["commands"].values()
            if not c["token"] and (c["free_slot"] or c.get("bad_keyboard")) and (names is None or c["name"] in names)]
    done, skipped = [], []
    by_file = {}
    for c in todo:
        f = data["files"][c["category"]]
        if not f["path"] or not f["editable"]:
            skipped.append({"name": c["name"], "label": label(c["name"]),
                            "reason": pick("il preset è quello di fabbrica: cambialo in gioco e salvalo come Custom",
                                           "it's the default preset: change it in game and save it as Custom")})
            continue
        by_file.setdefault(f["path"], []).append(c)
    used = dict(data["used"])
    taken = set()
    for path, cmds in by_file.items():
        with open(path, "rb") as fh:
            raw = fh.read()
        bom = raw.startswith(b"\xef\xbb\xbf")
        text = raw.decode("utf-8-sig")
        for c in cmds:
            key = _pick_key(c["name"], used, taken)
            block = re.search(rf"(<{c['name']}>)(.*?)(</{c['name']}>)", text, re.S)
            if not key or not block:
                skipped.append({"name": c["name"], "label": label(c["name"]),
                                "reason": pick("nessun tasto libero", "no free key")})
                continue
            inner = block.group(2)
            # Meglio lo slot secondario: il primario di solito è la cloche.
            placed = False
            for slot in ("Secondary", "Primary"):
                pat = re.compile(rf'<{slot} Device="\{{NoDevice\}}" Key=""\s*/>')
                if pat.search(inner):
                    inner = pat.sub(f'<{slot} Device="Keyboard" Key="{key}" />', inner, count=1)
                    placed = True
                    break
            bad = c.get("bad_keyboard")
            if not placed and bad:
                # Nessuno slot vuoto: si sostituisce il tasto della tastiera che non si può premere con questo layout.
                pat = re.compile(rf'<(Primary|Secondary) Device="Keyboard" Key="{re.escape(bad)}"\s*/>')
                if pat.search(inner):
                    inner = pat.sub(lambda m: f'<{m.group(1)} Device="Keyboard" Key="{key}" />', inner, count=1)
                    placed = True
            if not placed:
                skipped.append({"name": c["name"], "label": label(c["name"]),
                                "reason": pick("nessuno slot vuoto", "no empty slot")})
                continue
            text = text[:block.start(2)] + inner + text[block.end(2):]
            taken.add(key)
            used[key] = [c["name"]]
            done.append({"name": c["name"], "label": label(c["name"]), "key": key.replace("Key_", "")})
        if any(d["name"] in {c["name"] for c in cmds} for d in done):
            backup = f"{path}.voidwatch-{time.strftime('%Y%m%d-%H%M%S')}.backup"
            shutil.copy2(path, backup)
            tmp = path + ".tmp"
            with open(tmp, "wb") as fh:
                fh.write((b"\xef\xbb\xbf" if bom else b"") + text.encode("utf-8"))
            os.replace(tmp, path)
            print(f"[Tasti] Aggiunti {len(done)} tasti in {path} (copia: {backup})")
    with _lock:
        _cache.update(key=None, data=None)
    return {"done": done, "skipped": skipped}
