"""Server HTTP locale dell'app: serve l'interfaccia (web/) e le API usate dall'interfaccia e dal companion.

Sicurezza:
- il server principale ascolta solo su 127.0.0.1; le API rispondono solo se la richiesta arriva dall'app
  (intestazione X-ED-Copilot, che un sito esterno non può aggiungere) e con un Host locale (niente DNS rebinding);
- il companion per telefono usa un secondo server sulla rete locale, acceso solo se lo attivi nelle impostazioni,
  che accetta esclusivamente richieste con il codice segreto (contenuto nel QR) e solo per le API del companion.
"""

import io
import json
import os
import secrets
import socket
import subprocess
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from . import (advisor, alerts, backup, bindings, bio, colonisation, coriolis, diary, discord, gamedata, inara, keys,
               missions, overlay, paths, powerplay, ptt, remote_voice, search, shipimages, stats, storage, tls,
               updater, upload, voice)
from .journal import STATE
from .lang import pick
# Funzioni con le proprie API: ogni modulo espone GET, POST e LAN (vedi sotto).
from . import (bounty, briefing, buildshare, colonia, combat, construction, engineering, engineers, exploration, fuel, guardian,
    lang, notify, onfoot, ranks, squadron, thargoid, travelmap)
from . import mining  # scheda Estrazione: core e sessioni di estrazione

FEATURES = (bounty, briefing, buildshare, colonia, combat, construction, engineering, engineers, exploration, fuel, guardian, lang, notify,
            onfoot, ranks, squadron, thargoid, travelmap)
# Voce e push-to-talk espongono anche loro GET/POST (elenco voci, effetti, filtro rumori, calibrazione).
FEATURES += (voice, ptt)
# Previsione delle specie esobiologiche nel sistema attuale (scheda Esobiologia).
from . import bio_predict  # noqa: E402
FEATURES += (bio_predict,)
FEATURES += (mining,)

APP_ID = "ed-copilot"
MAX_JSON = 2 * 1024 * 1024
CONTENT_TYPES = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
                 ".css": "text/css; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
                 ".ico": "image/x-icon", ".woff2": "font/woff2"}

APP_CONFIG_FILE = paths.user_file("app_config.json")
_app_config_lock = threading.Lock()
REMOTE_NAV = {"view": None, "ts": 0.0}
RUNTIME = {"port": None, "lan_port": None, "lan_server": None, "on_focus": None,
           "lan_https": False, "lan_fingerprint": None}
# Siti che l'app può aprire nel browser (link "apri su Inara" ecc.).
OPEN_HOSTS = ("inara.cz", "spansh.co.uk", "www.edsm.net", "edsm.net", "github.com", "coriolis.io", "edsy.org",
              "discord.gg", "www.reddit.com", "math.edomh.nl", "elite-dangerous.fandom.com",  # ultimi: scheda Colonia
              "fuelrats.com", "edtools.cc", "canonn.science", "wiki.antixenoinitiative.com", "www.elitedangerous.com",
              "discord.com")  # Luoghi utili e impostazioni


def app_config():
    with _app_config_lock:
        cfg = storage.load_json(APP_CONFIG_FILE, {}) or {}
        if not cfg.get("lan_token"):
            cfg["lan_token"] = secrets.token_urlsafe(16)
            storage.save_json(APP_CONFIG_FILE, cfg)
        return cfg


def set_app_config(**changes):
    with _app_config_lock:
        cfg = {**(storage.load_json(APP_CONFIG_FILE, {}) or {}), **changes}
        storage.save_json(APP_CONFIG_FILE, cfg)
        return cfg


def local_ip():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("10.255.255.255", 1))  # nessun pacchetto viene inviato: serve solo a scegliere l'interfaccia
            return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"


def companion_url():
    if not RUNTIME["lan_port"]:
        return None
    scheme = "https" if RUNTIME.get("lan_https") else "http"
    return f"{scheme}://{local_ip()}:{RUNTIME['lan_port']}/companion?t={app_config()['lan_token']}"


def static_file(path):
    """Solo file dentro web/ (anche sottocartelle), senza uscire dalla cartella."""
    name = {"/": "index.html", "": "index.html", "/companion": "companion.html", "/companion/": "companion.html"}.get(path)
    name = name or urllib.parse.unquote(path).lstrip("/")
    ext = os.path.splitext(name)[1].lower()
    if ext not in CONTENT_TYPES or ".." in name.replace("\\", "/").split("/") or name.startswith((".", "/")):
        return None
    full = os.path.normpath(os.path.join(paths.WEB_DIR, name))
    if not full.startswith(os.path.normpath(paths.WEB_DIR) + os.sep) or not os.path.isfile(full):
        return None
    return full, CONTENT_TYPES[ext]


def _query(path):
    return {k: v[0] for k, v in urllib.parse.parse_qs(urllib.parse.urlparse(path).query).items()}


def _int(v, default, lo=0, hi=100):
    try:
        return max(lo, min(hi, int(v)))
    except (TypeError, ValueError):
        return default


# --- Gestori delle API -------------------------------------------------------------
# GET: funzione(query) -> dati. POST: funzione(body, query) -> dati.

def _state(q):
    snap = STATE.snapshot()
    snap["voice_config"] = voice.load_config()
    snap["remote_nav"] = dict(REMOTE_NAV)
    snap["lan"] = {"enabled": bool(RUNTIME["lan_port"]), "url": companion_url(),
                   "https": bool(RUNTIME.get("lan_https")), "fingerprint": RUNTIME.get("lan_fingerprint")}
    snap["remote_voice"] = remote_voice.recent()
    snap["overlay"] = overlay.status()
    return snap


def _static(q):
    return {
        "engineers": [{"name": n, "system": v[0], "base": v[1], "kind": v[2], "specialty": v[3]}
                      for n, v in gamedata.ENGINEERS.items()],
        "places": [{"category": c, "items": [{"system": s, "text": t} for s, t in items]} for c, items in gamedata.PLACES],
        "services": [{"value": v, "label": l} for v, l in gamedata.SERVICES],
        "ranks": gamedata.RANKS, "ranks_en": gamedata.RANKS_EN, "rank_labels": gamedata.RANK_LABELS,
        "ships": sorted(set(gamedata.SHIP_NAMES.values())), "mining_commodities": gamedata.MINING_COMMODITIES,
        "journal_dir": paths.JOURNAL_DIR, "data_dir": paths.DATA_DIR,
        "catalog_updated": (coriolis._catalog or {}).get("updated"), "coords": search.coords(),
    }


def _speak_report(q):
    text = q.get("text") or voice.report(q.get("type", "all"))
    voice.say(text, q.get("voice"), q.get("volume"))
    return {"status": "ok", "played": text}


def _ship_control(q):
    done, phrase = keys.ship_action((q.get("action") or "").strip().lower())
    voice.say(phrase, q.get("voice"), q.get("volume"))
    return {"status": "ok" if done else "skipped", "action": q.get("action"), "played": phrase}


def _run_macro(q):
    done, phrase = keys.run_macro(q.get("id", ""))
    voice.say(phrase, q.get("voice"), q.get("volume"))
    return {"status": "ok" if done else "skipped", "played": phrase}


def _copy_next(q):
    route = STATE.snapshot().get("route") or []
    nxt = route[0].get("StarSystem") if route else None
    if not nxt:
        saved = search.load_route()
        here = STATE.location.get("system")
        jumps = [j["system"] for j in (saved or {}).get("jumps", [])]
        if here in jumps and jumps.index(here) + 1 < len(jumps):
            nxt = jumps[jumps.index(here) + 1]
    if not nxt:
        text = pick("Nessun prossimo salto in rotta.", "No next jump on the route.")
    else:
        subprocess.run(["clip.exe"], input=nxt.encode("utf-16le"), check=False, creationflags=0x08000000)
        text = pick(f"Sistema {nxt} copiato negli appunti.", f"System {nxt} copied to clipboard.")
    if q.get("play") == "1":
        voice.say(text, q.get("voice"), q.get("volume"))
    return {"text": text, "system": nxt}


def _qrcode(q):
    url = companion_url()
    if not url:
        raise ValueError(pick("Accesso dal telefono non attivo", "Phone access is not enabled"))
    import qrcode
    qr = qrcode.QRCode(box_size=6, border=2)
    qr.add_data(url)
    qr.make(fit=True)
    buf = io.BytesIO()
    qr.make_image(fill_color="#ff8a1f", back_color="#0c0500").save(buf, format="PNG")
    return buf.getvalue(), "image/png"


def _tts(q):
    path = voice.synthesize(q.get("text", ""), q.get("voice") or voice.load_config()["voice"])
    voice.mark_speaking(len(q.get("text", "")) * 0.08 + 1.5)
    with open(path, "rb") as f:
        return f.read(), "audio/mpeg"


def _set_lan(body, q):
    enabled = bool((body or {}).get("enabled"))
    set_app_config(lan_enabled=enabled)
    start_lan() if enabled else stop_lan()
    return {"enabled": bool(RUNTIME["lan_port"]), "url": companion_url()}


def _remote_nav(body, q):
    REMOTE_NAV.update(view=(body or {}).get("view"), ts=time.time())
    return {"status": "ok"}


def _focus(body, q):
    if RUNTIME["on_focus"]:
        RUNTIME["on_focus"]()
    return {"status": "ok"}


def _open_url(body, q):
    url = str((body or {}).get("url") or "")
    host = urllib.parse.urlparse(url).hostname or ""
    if not url.startswith("https://") or host not in OPEN_HOSTS:
        raise ValueError(pick("Indirizzo non consentito", "Address not allowed"))
    import webbrowser
    webbrowser.open(url)
    return {"status": "ok"}


def _inara_key(body, q):
    key = str((body or {}).get("key") or "").strip()
    if key and not key.isalnum():
        raise ValueError(pick("La chiave API di Inara contiene solo lettere e numeri", "The Inara API key contains only letters and numbers"))
    set_app_config(inara_api_key=key)
    inara.reset()
    return inara.profile()


def _settings(q):
    cfg = app_config()
    return {"inara": {"configured": inara.configured()}, "update": updater.status(), "overlay": overlay.status(),
            "discord": discord.status(),
            "lan": {"enabled": bool(RUNTIME["lan_port"]), "url": companion_url(), "https": bool(RUNTIME.get("lan_https")),
                    "fingerprint": RUNTIME.get("lan_fingerprint"), "tls_available": tls.available()},
            "version": updater.VERSION, "ui_lang": lang.current(), "data_dir": paths.DATA_DIR, "update_repo": cfg.get("update_repo") or updater.DEFAULT_REPO,
            # Guida al primo avvio (web/js/views/benvenuto.js): già vista? Il journal c'è?
            "welcome_seen": bool(cfg.get("welcome_seen")),
            "journal": {"dir": paths.JOURNAL_DIR, "found": os.path.isdir(paths.JOURNAL_DIR),
                        "files": sum(1 for f in os.listdir(paths.JOURNAL_DIR) if f.startswith("Journal.") and f.endswith(".log"))
                        if os.path.isdir(paths.JOURNAL_DIR) else 0}}


def _route_plot(tool):
    return lambda body, q: search.plot_route(tool, body or {})


GET = {
    "/api/ping": lambda q: {"app": APP_ID},
    "/api/state": _state,
    "/api/static": _static,
    "/api/todos": lambda q: storage.TODOS.load(),
    "/api/controls": lambda q: storage.CONTROLS.load(),
    "/api/telemetry_rules": lambda q: storage.TELEMETRY.load(),
    "/api/macros": lambda q: storage.MACROS.load(),
    "/api/route": lambda q: search.load_route(),
    "/api/catalog": lambda q: coriolis.load() or {"error": pick("catalogo non disponibile", "catalogue not available")},
    "/api/advice": lambda q: advisor.advise(STATE.snapshot(), search.coords(), q.get("lang", "mixed")),
    "/api/community_goals": lambda q: search.community_goals(),
    "/api/colonisation/candidate_systems": lambda q: colonisation.candidates(q.get("ref") or search.current_system(), q.get("type", "coriolis")),
    "/api/colonisation/verify_system": lambda q: colonisation.verify(q.get("system", ""), q.get("ref") or search.current_system(), q.get("type", "coriolis")),
    "/api/colonisation/nearest_materials": lambda q: colonisation.suppliers(
        q.get("ref") or search.current_system(), [c for c in q.get("commodities", "").split(",") if c.strip()]),
    "/api/voice/config": lambda q: voice.load_config(),
    "/api/voice/report": lambda q: {"text": voice.report(q.get("type", "all"))},
    "/api/voice/status": lambda q: {"text": voice.report(q.get("type", "all"))},
    "/api/voice/play": _speak_report,
    "/api/voice/ship_control": _ship_control,
    "/api/voice/macro": _run_macro,
    "/api/voice/copy-next": _copy_next,
    "/api/remote_nav": lambda q: dict(REMOTE_NAV),
    "/api/lan": lambda q: {"enabled": bool(RUNTIME["lan_port"]), "url": companion_url()},
    "/api/settings": _settings,
    "/api/bindings": lambda q: bindings.summary(),
    "/api/stats": lambda q: stats.summary(),
    "/api/powerplay/status": lambda q: powerplay.status(),
    "/api/powerplay/nearby": lambda q: powerplay.nearby(q.get("power", ""), q.get("state", "Acquisition"),
                                                        q.get("ref") or search.current_system(), q.get("radius", 30)),
    "/api/inara/profile": lambda q: inara.profile(),
    "/api/update": lambda q: updater.status(),
    "/api/missions/plan": lambda q: missions.plan(),
    "/api/bio/codex": lambda q: bio.codex(),
    "/api/price_alerts": lambda q: alerts.status(),
    "/api/ptt/status": lambda q: ptt.status(),
    "/api/upload/status": lambda q: upload.status(),
    "/api/diary": diary.list_sessions,
    "/api/diary/session": diary.session,
    "/api/ptt/mics": lambda q: ptt.list_mics(),
    "/api/bio/nearby": lambda q: bio.nearby(q.get("ref") or search.current_system(), q.get("radius", 50),
                                            q.get("min_value", 0), q.get("max_gravity"), q.get("only_new"), q.get("max_arrival")),
}
BINARY_GET = {"/api/qrcode": _qrcode, "/api/tts": _tts, "/api/diary/thumb": diary.thumbnail}
POST = {
    "/api/todos": lambda b, q: storage.TODOS.save(b),
    "/api/controls": lambda b, q: storage.CONTROLS.save(b),
    "/api/telemetry_rules": lambda b, q: storage.TELEMETRY.save(b),
    "/api/macros": lambda b, q: storage.MACROS.save(b),
    "/api/search": lambda b, q: search.stations(b or {}),
    "/api/route": lambda b, q: search.plot_route((b or {}).get("tool") or "neutron", b or {}),
    "/api/route/clear": lambda b, q: search.clear_route(),
    "/api/trade": lambda b, q: search.trade_route(b or {}),
    "/api/hotspots": lambda b, q: search.hotspots(b or {}),
    "/api/voice/config": lambda b, q: voice.save_config(b),
    "/api/remote_nav": _remote_nav,
    "/api/lan": _set_lan,
    "/api/app/focus": _focus,
    "/api/open": _open_url,
    "/api/bindings/assign": lambda b, q: bindings.assign_missing((b or {}).get("names")),
    "/api/overlay": lambda b, q: overlay.configure(b),
    "/api/inara/key": _inara_key,
    "/api/update/config": lambda b, q: updater.configure(b),
    "/api/discord": lambda b, q: discord.configure(b),
    "/api/welcome": lambda b, q: {"welcome_seen": bool(set_app_config(welcome_seen=bool((b or {}).get("seen", True)))["welcome_seen"])},
    "/api/price_alerts/rule": lambda b, q: alerts.save_rule(b or {}),
    "/api/price_alerts/delete": lambda b, q: alerts.delete_rule((b or {}).get("id", "")),
    "/api/price_alerts/check": lambda b, q: alerts.check_now((b or {}).get("id") or None),
    "/api/price_alerts/config": lambda b, q: alerts.save_config(b),
    "/api/price_alerts/clear": lambda b, q: alerts.clear_recent(),
    "/api/ptt/config": lambda b, q: ptt.save_config(b),
    "/api/upload/config": lambda b, q: upload.configure(b),
    "/api/diary/notes": diary.add_note,
    "/api/diary/notes/delete": diary.delete_note,
    "/api/diary/settings": diary.save_settings,
    "/api/diary/convert": diary.convert_existing,
    "/api/diary/export": diary.export,
    "/api/diary/open": diary.open_item,
    "/api/ptt/learn": lambda b, q: ptt.learn(),
    "/api/ptt/learn/cancel": lambda b, q: ptt.cancel_learn(),
    "/api/backup/export": lambda b, q: backup.export(b),
    "/api/update/check": lambda b, q: updater.check(),
    "/api/update/install": lambda b, q: updater.install(),
    "/api/voice/remote_result": lambda b, q: {"ok": remote_voice.set_result(_int((b or {}).get("id"), 0, 0, 10**9),
                                                                            (b or {}).get("result"))},
}
# Il companion sul telefono può usare solo queste.
LAN_ALLOWED = {"/api/ping", "/api/state", "/api/macros", "/api/voice/ship_control", "/api/voice/macro",
               "/api/voice/config", "/api/voice/play", "/api/voice/report", "/api/voice/transcribe", "/api/remote_nav",
               "/api/voice/remote"}
for _mod in FEATURES:
    GET.update(getattr(_mod, "GET", {}))
    POST.update(getattr(_mod, "POST", {}))
    LAN_ALLOWED.update(getattr(_mod, "LAN", ()))


class Handler(BaseHTTPRequestHandler):
    lan = False
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def _send(self, code, body, ctype="application/json; charset=utf-8", extra=None):
        if not isinstance(body, bytes):
            body = json.dumps(body, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(body)

    def _read(self, limit):
        try:
            n = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            n = -1
        if n < 0 or n > limit:
            raise ValueError(pick("Richiesta troppo grande", "Request too large"))
        return self.rfile.read(n) if n else b""

    def _allowed(self, path):
        """Le API rispondono solo all'app (o al companion con il codice giusto)."""
        # Immagini mostrate con <img> (navi, QR): un sito esterno può farle caricare ma non può leggerne il contenuto.
        if not path.startswith("/api/") or path.startswith("/api/shipimg/") or path == "/api/ping":
            return True
        if path in ("/api/qrcode", "/api/diary/thumb") and not self.lan and self.command == "GET":
            return (self.headers.get("Host") or "").split(":")[0] in ("127.0.0.1", "localhost")
        if self.lan:
            token = self.headers.get("X-ED-Token") or _query(self.path).get("t")
            return path in LAN_ALLOWED and secrets.compare_digest(token or "", app_config()["lan_token"])
        host = (self.headers.get("Host") or "").split(":")[0]
        return host in ("127.0.0.1", "localhost") and self.headers.get("X-ED-Copilot") == "1"

    def _dispatch(self, method):
        path = urllib.parse.urlparse(self.path).path
        if path.startswith(squadron.PREFIX):
            # Squadriglia: solo dalla rete, con l'autorizzazione propria del modulo (codice della squadriglia e
            # gettone del membro), mai con il codice del telefono. Nessun'altra API cambia regole.
            if not self.lan:
                return self._send(404, {"error": pick("non trovato", "not found")})
            self.connection.settimeout(15)  # un membro lento non tiene occupato il server
            try:
                code, body = squadron.lan_request(method, path, self.headers, self._read, self.client_address[0])
            except Exception as exc:
                print(f"[Server] squadriglia {method} {path}: {exc!r}")
                code, body = 500, {"error": pick("errore interno", "internal error")}
            self.close_connection = True  # una richiesta per connessione: niente resti di corpi non letti
            return self._send(code, body, extra={"Connection": "close"})
        if not self._allowed(path):
            return self._send(403, {"error": pick("accesso negato", "access denied")})
        q = _query(self.path)
        try:
            if method == "GET":
                if path == "/" and self.lan:
                    return self._send(302, b"", extra={"Location": "/companion"})
                if path in GET:
                    return self._send(200, GET[path](q))
                if path in BINARY_GET:
                    data, ctype = BINARY_GET[path](q)
                    return self._send(200, data, ctype)
                if path.startswith("/api/shipimg/"):
                    target = shipimages.url(path.rsplit("/", 1)[1])
                    if target:
                        return self._send(302, b"", extra={"Location": target, "Cache-Control": "max-age=86400"})
                    return self._send(404, {"error": pick("immagine non disponibile", "image not available")})
                found = None if path.startswith("/api/") else static_file(path)
                if found and (not self.lan or found[0].endswith(("companion.html", ".svg", ".ico", ".css"))):
                    with open(found[0], "rb") as f:
                        return self._send(200, f.read(), found[1])
                return self._send(404, {"error": pick("non trovato", "not found")})
            if path == "/api/voice/transcribe":
                raw = self._read(voice.MAX_UPLOAD)
                return self._send(200, {"status": "ok", "text": voice.transcribe(raw, self.headers.get("Content-Type", ""))})
            if path == "/api/backup/import":
                return self._send(200, backup.restore(self._read(backup.MAX_ZIP)))
            if path == "/api/voice/remote":  # voce dal telefono: trascritta qui, eseguita dall'interfaccia sul PC
                raw = self._read(voice.MAX_UPLOAD)
                text = voice.transcribe(raw, self.headers.get("Content-Type", ""), source="phone")
                item = remote_voice.push(text) if text else None
                return self._send(200, {"status": "ok" if text else "empty", "text": text,
                                        "id": item["id"] if item else None})
            if path.startswith("/api/plot/"):
                handler = _route_plot(path.rsplit("/", 1)[1])
            else:
                handler = POST.get(path)
            if not handler:
                return self._send(404, {"error": pick("non trovato", "not found")})
            raw = self._read(MAX_JSON)
            body = json.loads(raw) if raw else None
            return self._send(200, handler(body, q))
        except ValueError as exc:
            self._send(400, {"error": str(exc)})
        except Exception as exc:
            print(f"[Server] {method} {path}: {exc!r}")
            self._send(502, {"error": pick(f"Operazione non riuscita: {exc}", f"Operation failed: {exc}")})

    def do_GET(self):
        self._dispatch("GET")

    def do_POST(self):
        self._dispatch("POST")


class LanHandler(Handler):
    lan = True


def _serve(server):
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def start_local(port):
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    server.daemon_threads = True
    RUNTIME["port"] = port
    return _serve(server)


def start_lan():
    if RUNTIME["lan_server"]:
        return True
    for port in range(RUNTIME["port"] + 1, RUNTIME["port"] + 10):
        try:
            server = ThreadingHTTPServer(("0.0.0.0", port), LanHandler)
        except OSError:
            continue
        server.daemon_threads = True
        fp = None
        if tls.available():  # HTTPS: sul telefono il microfono funziona solo su connessioni sicure
            try:
                fp = tls.wrap(server, local_ip())
            except Exception as exc:
                print(f"[TLS] HTTPS non disponibile, companion in HTTP: {exc!r}")
        RUNTIME.update(lan_server=_serve(server), lan_port=port, lan_https=bool(fp), lan_fingerprint=fp)
        print(f"Companion per telefono attivo: {companion_url()}")
        return True
    return False


def stop_lan():
    server = RUNTIME.get("lan_server")
    if server:
        threading.Thread(target=lambda: (server.shutdown(), server.server_close()), daemon=True).start()
    RUNTIME.update(lan_server=None, lan_port=None, lan_https=False, lan_fingerprint=None)
