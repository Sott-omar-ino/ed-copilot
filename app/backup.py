"""Backup ed esportazione dei dati: uno zip con le impostazioni e le liste dell'utente, da riportare su un altro PC.

Nello zip: i file .json della cartella dati (cose da fare, macro, controlli, avvisi, voce, impostazioni dell'app,
rotta, diario, ...) e le impostazioni dell'interfaccia (allestimenti salvati, aspetto), che vivono nel localStorage
della finestra e arrivano dall'interfaccia stessa. Esclusi: cache, registro, certificati.
"""

import io
import json
import os
import shutil
import subprocess
import time
import zipfile

from . import paths
from .lang import pick

UI_FILE = "interfaccia.json"
MAX_ZIP = 20 * 1024 * 1024
MAX_FILE = 5 * 1024 * 1024
# Impostazioni legate a questo PC: non si portano altrove.
PC_KEYS = {"lan_token", "lan_enabled", "overlay_x", "overlay_y", "overlay_w", "overlay_h"}


def _user_files():
    return sorted(f for f in os.listdir(paths.DATA_DIR)
                  if f.endswith(".json") and os.path.isfile(os.path.join(paths.DATA_DIR, f)))


def _downloads():
    d = os.path.join(os.path.expanduser("~"), "Downloads")
    return d if os.path.isdir(d) else paths.DATA_DIR


def export(body):
    """Crea lo zip nella cartella Download e la apre in Esplora risorse."""
    ui = (body or {}).get("ui") or {}
    name = f"Voidwatch ED backup {time.strftime('%Y-%m-%d %H-%M')}.zip"
    out = os.path.join(_downloads(), name)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for f in _user_files():
            path = os.path.join(paths.DATA_DIR, f)
            if f == "app_config.json":
                with open(path, encoding="utf-8") as fh:
                    cfg = {k: v for k, v in json.load(fh).items() if k not in PC_KEYS}
                z.writestr(f, json.dumps(cfg, ensure_ascii=False, indent=1))
            else:
                z.write(path, f)
        z.writestr(UI_FILE, json.dumps({k: v for k, v in ui.items() if isinstance(v, str)}, ensure_ascii=False))
        z.writestr("LEGGIMI.txt", pick("Backup di Voidwatch ED. Per ripristinarlo: Impostazioni -> Backup -> Importa.\n",
                                         "Voidwatch ED backup. To restore it: Settings -> Backup -> Import.\n"))
    try:
        subprocess.Popen(["explorer", "/select,", out])
    except OSError:
        pass
    return {"path": out, "files": len(_user_files()) + 1}


def restore(raw):
    """Ripristina uno zip creato da export(). Prima salva una copia dei dati attuali."""
    if not raw or len(raw) > MAX_ZIP:
        raise ValueError(pick("File mancante o troppo grande", "File missing or too large"))
    try:
        z = zipfile.ZipFile(io.BytesIO(raw))
    except zipfile.BadZipFile:
        raise ValueError(pick("Non è uno zip di backup di Voidwatch ED", "Not a Voidwatch ED backup zip"))
    names = [n for n in z.namelist() if n.endswith(".json") and "/" not in n and "\\" not in n and not n.startswith(".")]
    if UI_FILE not in names:
        raise ValueError(pick("Non è uno zip di backup di Voidwatch ED", "Not a Voidwatch ED backup zip"))
    data = {}
    for n in names:
        info = z.getinfo(n)
        if info.file_size > MAX_FILE:
            raise ValueError(pick(f"{n} è troppo grande", f"{n} is too large"))
        try:
            data[n] = json.loads(z.read(n).decode("utf-8"))
        except ValueError:
            raise ValueError(pick(f"{n} non è valido", f"{n} is not valid"))

    # Copia di sicurezza dei dati attuali.
    safe = paths.cache_file(f"prima-del-ripristino-{time.strftime('%Y%m%d-%H%M%S')}")
    os.makedirs(safe, exist_ok=True)
    for f in _user_files():
        shutil.copy2(os.path.join(paths.DATA_DIR, f), safe)

    from . import storage
    restored = []
    for n, content in data.items():
        if n == UI_FILE:
            continue
        if n == "app_config.json":
            # Le impostazioni legate a questo PC (codice del telefono, posizione dell'overlay) restano quelle attuali.
            cur = storage.load_json(os.path.join(paths.DATA_DIR, n), {}) or {}
            content = {**{k: v for k, v in content.items() if k not in PC_KEYS},
                       **{k: v for k, v in cur.items() if k in PC_KEYS}}
        storage.save_json(os.path.join(paths.DATA_DIR, n), content)
        restored.append(n)
    return {"restored": restored, "ui": data.get(UI_FILE) or {}, "safety_copy": safe,
            "restart": True}
