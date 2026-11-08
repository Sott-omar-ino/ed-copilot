"""Percorsi dell'applicazione.

Due tipi di file:
- risorse incluse nel programma (interfaccia web, valori predefiniti, catalogo iniziale): sola lettura,
  dentro l'eseguibile quando è compilato;
- dati dell'utente (cose da fare, rotte, macro, impostazioni, cache): sempre in una cartella scrivibile.

I dati stanno nella cartella "ED Copilot - dati" accanto all'eseguibile (o nella radice del progetto se si
avvia dai sorgenti): copiando l'exe insieme alla cartella si porta via tutto. Se lì non si può scrivere si usa %APPDATA%.
"""

import os
import shutil
import sys

FROZEN = bool(getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"))
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUNDLE_DIR = sys._MEIPASS if FROZEN else ROOT_DIR
# Cartella in cui si trova l'app: quella dell'exe, oppure la radice del progetto.
APP_DIR = os.path.dirname(sys.executable) if FROZEN else ROOT_DIR

WEB_DIR = os.path.join(BUNDLE_DIR, "web")
DEFAULTS_DIR = os.path.join(BUNDLE_DIR, "defaults")
SEED_DATA_DIR = os.path.join(BUNDLE_DIR, "data")
ICON_FILE = os.path.join(BUNDLE_DIR, "assets", "app_icon.ico")

JOURNAL_DIR = os.environ.get(
    "ED_JOURNAL_DIR",
    os.path.join(os.path.expanduser("~"), "Saved Games", "Frontier Developments", "Elite Dangerous"),
)


def _writable(path):
    try:
        os.makedirs(path, exist_ok=True)
        probe = os.path.join(path, ".scrivibile")
        with open(probe, "w") as f:
            f.write("ok")
        os.remove(probe)
        return True
    except OSError:
        return False


def _pick_data_dir():
    if os.environ.get("ED_COPILOT_DATA"):
        return os.environ["ED_COPILOT_DATA"]
    candidate = os.path.join(APP_DIR, "ED Copilot - dati")
    if _writable(candidate):
        return candidate
    return os.path.join(os.environ.get("APPDATA", os.path.expanduser("~")), "ED Copilot")


DATA_DIR = _pick_data_dir()
CACHE_DIR = os.path.join(DATA_DIR, "cache")
TTS_CACHE_DIR = os.path.join(CACHE_DIR, "voce")
os.makedirs(TTS_CACHE_DIR, exist_ok=True)


def user_file(name):
    return os.path.join(DATA_DIR, name)


def cache_file(name):
    return os.path.join(CACHE_DIR, name)


def default_file(name):
    return os.path.join(DEFAULTS_DIR, name)


def migrate_legacy_files():
    """Sposta i file delle versioni precedenti (salvati accanto al programma) nella cartella dati."""
    if os.environ.get("ED_COPILOT_DATA"):
        return
    moves = {
        "todo.json": user_file("todo.json"), "route.json": user_file("route.json"),
        "macros.json": user_file("macros.json"), "controls.json": user_file("controls.json"),
        "telemetry.json": user_file("telemetry.json"), "voice_config.json": user_file("voice_config.json"),
        "coords_cache.json": cache_file("coords.json"),
    }
    for old, new in moves.items():
        src = os.path.join(APP_DIR, old)
        if os.path.isfile(src) and not os.path.exists(new):
            try:
                shutil.move(src, new)
            except OSError:
                pass
