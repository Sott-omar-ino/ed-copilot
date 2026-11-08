"""Avvio di Voidwatch ED: server locale + finestra nativa dell'applicazione (WebView2, niente browser).

Opzioni:
  --browser   apre l'interfaccia nel browser invece che nella finestra dell'app (utile per lo sviluppo)
  --headless  solo server, senza finestra
"""

import json
import os
import sys
import threading
import time
import urllib.request

from . import paths
from .lang import pick

LOG_FILE = paths.user_file("registro.log")
# VOIDWATCH_PORT (o il vecchio ED_COPILOT_PORT): porta di partenza diversa (per provare i sorgenti mentre l'exe è aperto).
_BASE_PORT = int(paths.env("PORT") or 8765)
# Risposte di /api/ping che indicano l'app già aperta: anche una versione precedente, che si chiamava "ED Copilot".
_APP_IDS = ("voidwatch-ed", "ed-copilot")
PORTS = range(_BASE_PORT, _BASE_PORT + 11)


def _setup_logging():
    """Nell'exe senza console stdout/stderr non esistono: li mandiamo su un file di registro."""
    if paths.FROZEN or sys.stdout is None:
        try:
            if os.path.exists(LOG_FILE) and os.path.getsize(LOG_FILE) > 1_000_000:
                os.replace(LOG_FILE, LOG_FILE + ".1")
            log = open(LOG_FILE, "a", encoding="utf-8", buffering=1)
            sys.stdout = sys.stderr = log
            print(f"\n=== Avvio {time.strftime('%Y-%m-%d %H:%M:%S')} ===")
        except OSError:
            sys.stdout = sys.stderr = open(os.devnull, "w")


def _ping(port):
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/ping", timeout=0.6) as r:
            return json.loads(r.read()).get("app") in _APP_IDS
    except Exception:
        return False


def _already_running():
    """Se l'app è già aperta la riporta in primo piano e restituisce True."""
    for port in PORTS:
        if _ping(port):
            try:
                req = urllib.request.Request(f"http://127.0.0.1:{port}/api/app/focus", data=b"{}", method="POST",
                                             # X-ED-Copilot: intestazione interna, vecchio nome voluto (app/server.py)
                                             headers={"X-ED-Copilot": "1", "Content-Type": "application/json"})
                urllib.request.urlopen(req, timeout=2).close()
            except Exception:
                pass
            return True
    return False


def _message(text):
    try:
        import ctypes
        ctypes.windll.user32.MessageBoxW(None, text, paths.APP_NAME, 0x40)
    except Exception:
        print(text)


def main():
    _setup_logging()
    for note in paths.NOTES:  # migrazione della cartella dati dal vecchio nome (app/paths.py)
        print(note)
    from . import updater
    updater.cleanup_after_update()  # dopo un aggiornamento aspetta che la vecchia versione sia chiusa
    if _already_running():
        return

    paths.migrate_legacy_files()
    from . import alerts, coriolis, diary, discord, journal, ptt, search, server, upload, voice

    port = None
    for p in PORTS:
        try:
            server.start_local(p)
            port = p
            break
        except OSError:
            continue
    if not port:
        _message(pick(f"Impossibile avviare Voidwatch ED: le porte {PORTS[0]}-{PORTS[-1]} sono tutte occupate.",
                      f"Can't start Voidwatch ED: ports {PORTS[0]}-{PORTS[-1]} are all in use."))
        return

    for task in (journal.watch, search.load_coords, coriolis.load, voice.preload_if_enabled, updater.check_on_start,
                 alerts.start, ptt.start, upload.start):
        threading.Thread(target=task, daemon=True).start()
    for mod in server.FEATURES:  # le funzioni che lavorano in background hanno start()
        if hasattr(mod, "start"):
            threading.Thread(target=mod.start, daemon=True).start()
    discord.start()
    diary.start()
    if server.app_config().get("lan_enabled"):
        server.start_lan()

    url = f"http://127.0.0.1:{port}/"
    print(f"Voidwatch ED su {url}  (dati in {paths.DATA_DIR})")

    if "--headless" in sys.argv:
        _wait_forever()
    elif "--browser" in sys.argv or not _open_window(url, server):
        import webbrowser
        webbrowser.open(url)
        _wait_forever()


def _wait_forever():
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        pass


def _open_window(url, server):
    """Finestra nativa con WebView2. Restituisce False se non è disponibile."""
    try:
        import webview
    except ImportError:
        print("pywebview non installato: apro il browser.")
        return False
    # Mentre si gioca la finestra dell'app sta dietro al gioco: senza questi argomenti WebView2 (Chromium) rallenta i
    # timer della pagina a ~1 al secondo e il microfono del copilota (filtro rumori, ascolto continuo) smette di funzionare.
    # (la variabile d'ambiente prevale sugli argomenti di pywebview: si ripete anche il suo --disable-features)
    flags = ("--disable-features=ElasticOverscroll --disable-background-timer-throttling "
             "--disable-backgrounding-occluded-windows --disable-renderer-backgrounding")
    extra = os.environ.get("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "")
    if "--disable-background-timer-throttling" not in extra:
        os.environ["WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS"] = (extra + " " + flags).strip()
    window = webview.create_window(paths.APP_NAME, url, width=1520, height=940, min_size=(1000, 680),
                                   background_color="#030100", text_select=True, maximized=True)

    def focus():
        try:
            window.restore()
            window.on_top = True
            window.on_top = False
        except Exception:
            pass

    server.RUNTIME["on_focus"] = focus
    from . import overlay
    # Chiusa la finestra principale si chiude anche l'overlay, così l'app termina.
    def close_overlay():
        overlay.hide(remember=False)

    window.events.closed += close_overlay
    try:
        # private_mode=False: conserva le impostazioni dell'interfaccia (localStorage) tra un avvio e l'altro.
        webview.start(lambda: overlay.setup(webview, url), gui="edgechromium", private_mode=False,
                      storage_path=paths.cache_file("finestra"),
                      icon=paths.ICON_FILE if os.path.exists(paths.ICON_FILE) else None)
    except Exception as exc:
        print(f"Finestra dell'app non disponibile ({exc}).")
        if paths.FROZEN:
            _message(pick("Per la finestra dell'app serve Microsoft Edge WebView2 (già presente in Windows 11).\n"
                          "Apro l'interfaccia nel browser.",
                          "The app window needs Microsoft Edge WebView2 (already included in Windows 11).\n"
                          "Opening the interface in the browser."))
        return False
    return True  # la finestra è stata chiusa: l'app termina


if __name__ == "__main__":
    main()
