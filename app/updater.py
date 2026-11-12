"""Aggiornamento automatico dell'exe dalle release di GitHub.

La fonte è un repository GitHub ("utente/repo") impostato nelle Impostazioni. Una release è valida se contiene
l'asset "Voidwatch ED.exe" con la sua impronta SHA-256 (quella che GitHub calcola da sé, oppure un file
"Voidwatch ED.exe.sha256" allegato): senza impronta l'aggiornamento non viene installato. Si accetta anche il nome
delle versioni precedenti ("ED Copilot.exe"). L'exe scaricato prende il posto di quello in uso con il suo nome attuale:
chi aggiorna una vecchia copia continua ad avere "ED Copilot.exe", e va bene così.

Installazione: il nuovo exe viene scaricato accanto a quello attuale, verificato, poi l'exe in uso viene rinominato
(Windows lo permette anche mentre è in esecuzione), il nuovo prende il suo posto e si riavvia.
"""

import hashlib
import json
import os
import re
import subprocess
import sys
import threading
import time
import urllib.request

from . import VERSION, paths
from .lang import pick

DEFAULT_REPO = "Sott-omar-ino/voidwatch-ed"
# Il repository si chiamava così (GitHub reindirizza il vecchio nome): chi l'ha salvato nelle impostazioni passa al nuovo.
LEGACY_REPOS = {"sott-omar-ino/ed-copilot"}

ASSET = "Voidwatch ED.exe"
LEGACY_ASSET = "ED Copilot.exe"
# GitHub sostituisce gli spazi nei nomi dei file allegati con punti ("Voidwatch.ED.exe").
ASSET_NAMES = {n for a in (ASSET, LEGACY_ASSET) for n in (a, a.replace(" ", "."))}
SHA_NAMES = {n + ".sha256" for n in ASSET_NAMES}
_state = {"checked": None, "latest": None, "error": None, "progress": None, "busy": False}
_lock = threading.Lock()


def _cfg():
    from .server import app_config
    cfg = app_config()
    # Repository ufficiale delle release: si può cambiare nelle impostazioni.
    return {"repo": normalize_repo(cfg.get("update_repo")), "auto": cfg.get("update_auto", True)}


def normalize_repo(repo):
    """Repository da usare: quello salvato, con il vecchio nome di quello ufficiale sostituito dal nuovo."""
    repo = (repo or "").strip() or DEFAULT_REPO
    return DEFAULT_REPO if repo.lower() in LEGACY_REPOS else repo


def _plain(name):
    return (name or "").replace(".", " ").lower()


def pick_assets(assets):
    """(exe, file .sha256) di una release. Il nome nuovo ha la precedenza su quello delle versioni precedenti; l'impronta
    è quella con lo stesso nome dell'exe scelto."""
    assets = [a for a in assets or [] if isinstance(a, dict)]
    exes = sorted((a for a in assets if a.get("name") in ASSET_NAMES),
                  key=lambda a: _plain(a["name"]) != _plain(ASSET))
    exe = exes[0] if exes else None
    sha = exe and next((a for a in assets if a.get("name") in SHA_NAMES
                        and _plain(a["name"]) == _plain(exe["name"] + ".sha256")), None)
    return exe, sha


def _version_tuple(v):
    return tuple(int(n) for n in re.findall(r"\d+", v or "0")[:4]) or (0,)


def _get(url, timeout=15):
    req = urllib.request.Request(url, headers={"User-Agent": f"Voidwatch-ED/{VERSION}",
                                               "Accept": "application/vnd.github+json"})
    return urllib.request.urlopen(req, timeout=timeout)


def check():
    """Controlla l'ultima release. Non scarica nulla."""
    repo = _cfg()["repo"]
    if not re.fullmatch(r"[\w.-]+/[\w.-]+", repo):
        _state.update(latest=None, error=pick("Fonte degli aggiornamenti non impostata", "Update source not set"), checked=time.time())
        return status()
    try:
        with _get(f"https://api.github.com/repos/{repo}/releases/latest") as r:
            rel = json.loads(r.read())
        asset, sha_asset = pick_assets(rel.get("assets"))
        digest = (asset or {}).get("digest") or ""
        _state.update(error=None, checked=time.time(), latest={
            "version": rel.get("tag_name", "").lstrip("vV"), "name": rel.get("name"), "notes": (rel.get("body") or "")[:3000],
            "url": rel.get("html_url"), "published": rel.get("published_at"),
            "download": asset and asset.get("browser_download_url"), "size": asset and asset.get("size"),
            "sha256": digest.split(":", 1)[1] if digest.startswith("sha256:") else None,
            "sha256_url": sha_asset and sha_asset.get("browser_download_url")})
    except Exception as exc:
        _state.update(error=pick(f"Controllo non riuscito: {exc}", f"Check failed: {exc}"), checked=time.time())
    return status()


def status():
    latest = _state["latest"]
    newer = bool(latest and latest.get("version") and _version_tuple(latest["version"]) > _version_tuple(VERSION))
    return {"current": VERSION, "repo": _cfg()["repo"], "auto": _cfg()["auto"], "frozen": paths.FROZEN,
            "latest": latest, "available": newer and bool(latest.get("download")),
            "error": _state["error"], "checked": _state["checked"], "progress": _state["progress"],
            "busy": _state["busy"]}


def check_on_start():
    if _cfg()["auto"] and _cfg()["repo"]:
        time.sleep(20)  # non rallentiamo l'avvio
        check()


def install():
    """Scarica, verifica e installa. Restituisce subito: l'avanzamento si legge con status()."""
    st = status()
    if not st["available"]:
        raise ValueError(pick("Nessun aggiornamento disponibile", "No update available"))
    if not paths.FROZEN:
        raise ValueError(pick("L'aggiornamento automatico vale per l'exe; dai sorgenti aggiorna i file a mano",
                              "Auto-update only works for the exe; when running from source, update the files by hand"))
    with _lock:
        if _state["busy"]:
            raise ValueError(pick("Aggiornamento già in corso", "Update already in progress"))
        _state.update(busy=True, progress=0, error=None)
    threading.Thread(target=_install, args=(st["latest"],), daemon=True).start()
    return status()


def _install(latest):
    exe = sys.executable
    new = exe + ".new"
    try:
        expected = latest.get("sha256")
        if not expected and latest.get("sha256_url"):
            with _get(latest["sha256_url"]) as r:
                expected = r.read().decode("ascii", "ignore").split()[0]
        if not expected or not re.fullmatch(r"[0-9a-fA-F]{64}", expected):
            raise RuntimeError(pick("la release non ha l'impronta SHA-256: aggiornamento non sicuro",
                                     "the release has no SHA-256 hash: update not safe"))
        h = hashlib.sha256()
        with _get(latest["download"], timeout=60) as r, open(new, "wb") as f:
            total, done = int(r.headers.get("Content-Length") or latest.get("size") or 0), 0
            while chunk := r.read(1 << 16):
                f.write(chunk)
                h.update(chunk)
                done += len(chunk)
                _state["progress"] = round(done / total * 100) if total else None
        if h.hexdigest().lower() != expected.lower():
            raise RuntimeError(pick("il file scaricato non corrisponde all'impronta SHA-256",
                                     "the downloaded file doesn't match the SHA-256 hash"))
        old = exe + ".old"
        if os.path.exists(old):
            os.remove(old)
        os.replace(exe, old)  # l'exe in esecuzione si può rinominare, non cancellare
        os.replace(new, exe)
        print(f"[Aggiornamento] Installata la versione {latest['version']}: riavvio.")
        # Ambiente ripulito dalle variabili di PyInstaller di questo processo, altrimenti il nuovo exe usa la nostra
        # cartella temporanea, che sparisce quando usciamo (vedi run.py).
        env = dict(os.environ, PYINSTALLER_RESET_ENVIRONMENT="1", VOIDWATCH_CLEAN_ENV="1")
        subprocess.Popen([exe, "--wait-pid", str(os.getpid())], close_fds=True, env=env,
                         creationflags=0x00000008 | 0x00000200)  # DETACHED_PROCESS | NEW_PROCESS_GROUP
        time.sleep(0.5)
        os._exit(0)
    except Exception as exc:
        print(f"[Aggiornamento] Non riuscito: {exc}")
        try:
            if os.path.exists(new):
                os.remove(new)
        except OSError:
            pass
        _state.update(busy=False, progress=None, error=pick(f"Aggiornamento non riuscito: {exc}", f"Update failed: {exc}"))


def cleanup_after_update():
    """All'avvio: aspetta che la vecchia istanza sia chiusa e rimuove l'exe precedente."""
    paths.wait_previous_instance()  # di solito è già successo in paths, prima di scegliere la cartella dati
    old = sys.executable + ".old"
    if paths.FROZEN and os.path.exists(old):
        try:
            os.remove(old)
        except OSError:
            pass


def configure(body):
    from .server import set_app_config
    body = body or {}
    changes = {}
    if "repo" in body:
        repo = str(body["repo"] or "").strip().removeprefix("https://github.com/").strip("/")
        if repo and not re.fullmatch(r"[\w.-]+/[\w.-]+", repo):
            raise ValueError(pick("Scrivi il repository come utente/nome", "Enter the repository as user/name"))
        changes["update_repo"] = repo
    if "auto" in body:
        changes["update_auto"] = bool(body["auto"])
    set_app_config(**changes)
    return check() if changes.get("update_repo") else status()
