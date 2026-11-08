"""Percorsi dell'applicazione.

Due tipi di file:
- risorse incluse nel programma (interfaccia web, valori predefiniti, catalogo iniziale): sola lettura,
  dentro l'eseguibile quando è compilato;
- dati dell'utente (cose da fare, rotte, macro, impostazioni, cache): sempre in una cartella scrivibile.

I dati stanno nella cartella "Voidwatch ED - dati" accanto all'eseguibile (o nella radice del progetto se si
avvia dai sorgenti): copiando l'exe insieme alla cartella si porta via tutto. Se lì non si può scrivere si usa %APPDATA%.

L'app si chiamava "ED Copilot": all'avvio la vecchia cartella "ED Copilot - dati" (o %APPDATA%\ED Copilot) viene
rinominata con il nome nuovo. Se non si può (un file è ancora aperto, per esempio dalla vecchia versione che si sta
chiudendo) si continua a usare la vecchia cartella e si riprova al prossimo avvio.
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

APP_NAME = "Voidwatch ED"
LEGACY_NAME = "ED Copilot"          # nome delle versioni fino alla 6.0
DATA_FOLDER = f"{APP_NAME} - dati"
LEGACY_DATA_FOLDER = f"{LEGACY_NAME} - dati"
# Messaggi della migrazione: il registro (main._setup_logging) si apre dopo, quindi li stampa main.
NOTES = []


def env(name, default=None):
    """Variabile d'ambiente per le prove: VOIDWATCH_<name>, oppure il vecchio ED_COPILOT_<name>."""
    return os.environ.get("VOIDWATCH_" + name) or os.environ.get("ED_COPILOT_" + name) or default


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


def wait_previous_instance():
    """Dopo un aggiornamento (--wait-pid) aspetta che la vecchia istanza sia chiusa: tiene aperti i file della cartella
    dati (il registro), che altrimenti non si potrebbe rinominare."""
    if "--wait-pid" not in sys.argv:
        return
    try:
        import ctypes
        pid = int(sys.argv[sys.argv.index("--wait-pid") + 1])
        handle = ctypes.windll.kernel32.OpenProcess(0x00100000, False, pid)  # SYNCHRONIZE
        if handle:
            ctypes.windll.kernel32.WaitForSingleObject(handle, 15000)
            ctypes.windll.kernel32.CloseHandle(handle)
    except (ValueError, IndexError, OSError, AttributeError):
        pass


def migrate_folder(new, old):
    """Rinomina la cartella del vecchio nome in quella nuova. Restituisce la cartella da usare: la nuova, oppure la
    vecchia se non si è potuta rinominare (file bloccati)."""
    if os.path.exists(new) or not os.path.isdir(old):
        return new
    try:
        os.replace(old, new)
        NOTES.append(f"[Dati] Cartella rinominata: {old} -> {new}")
        return new
    except OSError as exc:
        NOTES.append(f"[Dati] Non riesco a rinominare {old} in {new} ({exc}): per ora uso la vecchia cartella")
        return old


def _pick_data_dir():
    if env("DATA"):
        return env("DATA")
    wait_previous_instance()
    candidate = migrate_folder(os.path.join(APP_DIR, DATA_FOLDER), os.path.join(APP_DIR, LEGACY_DATA_FOLDER))
    if _writable(candidate):
        return candidate
    roaming = os.environ.get("APPDATA", os.path.expanduser("~"))
    return migrate_folder(os.path.join(roaming, APP_NAME), os.path.join(roaming, LEGACY_NAME))


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
    if env("DATA"):
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
