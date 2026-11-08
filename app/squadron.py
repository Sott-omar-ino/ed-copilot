"""Squadriglia: posizione, attività e obiettivi condivisi tra le app dei comandanti, senza server esterni.

Come funziona (da pari a pari):
- un'istanza fa da HOST: le API /api/squad/* rispondono sul suo server di rete locale HTTPS (lo stesso del companion
  per telefono, app/server.py start_lan + app/tls.py), ma con un'autorizzazione tutta loro (vedi lan_request):
  il codice del telefono NON vale qui e il codice della squadriglia non vale per le API del telefono;
- gli altri fanno JOIN con indirizzo + codice di accesso. Il codice contiene un segreto casuale (80 bit) e l'impronta
  SHA-256 (primi 128 bit) del certificato dell'host: chi entra verifica il certificato confrontando l'impronta
  (certificate pinning), quindi nessuno in mezzo può fingersi l'host anche se il certificato è autofirmato;
- con il codice giusto l'host consegna un gettone personale (salvato dall'host solo come hash SHA-256); da lì ogni
  membro invia il proprio stato ogni POLL secondi e riceve in risposta lo stato della squadriglia;
- si scambiano SOLO dati di stato validati campo per campo (testi corti, numeri limitati): niente file, niente comandi.
  Limiti: dimensione delle richieste, richieste al minuto per IP, tentativi di codice sbagliato, membri massimi.
- l'host può espellere un membro (gettone revocato, nome bloccato finché non rigenera il codice) e rigenerare il codice;
  ogni membro può uscire. Ogni dato condiviso ha un interruttore (privacy), applicato PRIMA dell'invio.

L'attività corrente è una stima semplice: la categoria con più eventi del journal negli ultimi 10 minuti.
Nomi degli eventi dal manuale ufficiale del Player Journal di Frontier (Elite Dangerous Journal, v4.x):
MiningRefined, ProspectedAsteroid, AsteroidCracked, LaunchDrone(Type), Bounty, FactionKillBond, CapShipBond,
UnderAttack, Died, FSSDiscoveryScan, FSSAllBodiesFound, Scan, SAAScanComplete, CodexEntry, ScanOrganic, MarketBuy,
MarketSell, ColonisationContribution, FSDJump.
"""

import base64
import collections
import hashlib
import http.client
import json
import math
import re
import secrets
import ssl
import threading
import time

from . import construction, paths, storage
from .journal import STATE, add_listener
from .lang import pick, pick_d

GET = {}
POST = {}
LAN = set()  # le API della squadriglia NON sono tra quelle del telefono: hanno la loro autorizzazione

FILE = paths.user_file("squadriglia.json")
PREFIX = "/api/squad/"
MAX_MEMBERS = 8          # host compreso
MAX_BODY = 8 * 1024      # byte per richiesta in arrivo
MAX_REPLY = 256 * 1024   # byte accettati in risposta dall'host
POLL = 5                 # secondi tra un invio e l'altro
OFFLINE_AFTER = 20       # secondi senza notizie -> offline
FORGET_AFTER = 3600      # membro offline da un'ora: tolto dall'elenco (rientra da solo con il codice)
RATE_PER_MIN = 120       # richieste al minuto per IP
BAD_CODE_PER_10MIN = 5   # codici sbagliati per IP ogni 10 minuti
BAD_CODE_GLOBAL = 30     # codici sbagliati in totale ogni 10 minuti (poi i join sono sospesi)
MAX_TODOS = 50
PRIVACY_KEYS = ("location", "ship", "fuel", "activity", "route", "sites")
ACTIVITIES = {"mining": {"it": "Mining", "en": "Mining"}, "combat": {"it": "Combattimento", "en": "Combat"},
              "exploring": {"it": "Esplorazione", "en": "Exploration"}, "exobiology": {"it": "Esobiologia", "en": "Exobiology"},
              "trading": {"it": "Commercio", "en": "Trading"}, "colonisation": {"it": "Colonizzazione", "en": "Colonisation"},
              "travelling": {"it": "In viaggio", "en": "Travelling"}}
ACTIVITY_WINDOW = 600
_EVENT_ACTIVITY = {
    "MiningRefined": "mining", "ProspectedAsteroid": "mining", "AsteroidCracked": "mining",
    "Bounty": "combat", "FactionKillBond": "combat", "CapShipBond": "combat", "UnderAttack": "combat", "Died": "combat",
    "FSSDiscoveryScan": "exploring", "FSSAllBodiesFound": "exploring", "Scan": "exploring",
    "SAAScanComplete": "exploring", "CodexEntry": "exploring",
    "ScanOrganic": "exobiology",
    "MarketBuy": "trading", "MarketSell": "trading",
    "ColonisationContribution": "colonisation",
    "FSDJump": "travelling",
}
_CTRL = re.compile(r"[\x00-\x1f\x7f​-‏‪-‮⁦-⁩]")

_lock = threading.Lock()
_cfg_lock = threading.RLock()  # leggi-modifica-salva della configurazione
_events = collections.deque(maxlen=500)   # (istante, categoria) degli eventi recenti
_members = {}      # host: id -> {name, token_hash, status, last_seen, joined}
_kicked = set()    # host: hash dei gettoni espulsi
_rate = {}         # ip -> deque di istanti
_bad = {}          # ip -> deque di istanti con codice sbagliato
_bad_all = collections.deque()
_link = {"state": None, "at": 0.0, "ok_at": 0.0, "error": None}   # membro: ultima risposta dell'host
_notice = {"text": None}
_wake = threading.Event()


class PinError(Exception):
    pass


class Refused(ValueError):
    """L'host ha rifiutato l'ingresso (codice sbagliato, espulso, squadriglia piena)."""
    def __init__(self, msg, reason):
        super().__init__(msg)
        self.reason = reason


# --- Configurazione -------------------------------------------------------------------

def _cfg():
    cfg = storage.load_json(FILE, {}) or {}
    cfg.setdefault("role", "none")
    cfg["privacy"] = {k: bool((cfg.get("privacy") or {}).get(k, True)) for k in PRIVACY_KEYS}
    return cfg


def _save(cfg):
    storage.save_json(FILE, cfg)


def _server():
    from . import server  # import pigro: server importa questo modulo
    return server


# --- Validazione ----------------------------------------------------------------------

def _txt(v, n):
    if not isinstance(v, str):
        return None
    v = _CTRL.sub("", v).strip()[:n]
    return v or None


def _numv(v, lo, hi):
    if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
        return None
    return max(lo, min(hi, v))


def clean_status(d):
    """Solo i campi previsti, con tipi e lunghezze limitati. Tutto il resto viene scartato."""
    d = d if isinstance(d, dict) else {}
    out = {"name": _txt(d.get("name"), 40) or pick("CMDR sconosciuto", "Unknown CMDR")}
    for k, n in (("ship", 60), ("ship_name", 40), ("system", 80), ("station", 80), ("next_jump", 80),
                 ("destination", 80)):
        out[k] = _txt(d.get(k), n)
    out["docked"] = d.get("docked") is True
    fuel = _numv(d.get("fuel_pct"), 0, 100)
    out["fuel_pct"] = round(fuel, 1) if fuel is not None else None
    jl = _numv(d.get("jumps_left"), 0, 1000)
    out["jumps_left"] = int(jl) if jl is not None else None
    act = d.get("activity")
    out["activity"] = act if isinstance(act, str) and act in ACTIVITIES else None
    sites = []
    for s in (d.get("sites") if isinstance(d.get("sites"), list) else [])[:5]:
        if not isinstance(s, dict):
            continue
        mid = _numv(s.get("market_id"), 0, 2 ** 53)
        prog = _numv(s.get("progress"), 0, 1)
        sites.append({"market_id": int(mid) if mid is not None else None, "system": _txt(s.get("system"), 80),
                      "station": _txt(s.get("station"), 80), "progress": prog,
                      "remaining": int(_numv(s.get("remaining"), 0, 10 ** 8) or 0),
                      "updated": _txt(s.get("updated"), 25)})
    out["sites"] = sites
    hidden = d.get("hidden") if isinstance(d.get("hidden"), list) else []
    out["hidden"] = [h for h in hidden if isinstance(h, str) and h in PRIVACY_KEYS][:len(PRIVACY_KEYS)]
    return out


def _clean_todo_text(v):
    return _txt(v, 140)


# --- Attività e stato locale ----------------------------------------------------------

def _on_event(e):
    ev = e.get("event")
    cat = _EVENT_ACTIVITY.get(ev)
    if ev == "LaunchDrone" and e.get("Type") in ("Prospector", "Collection"):
        cat = "mining"
    if ev == "Scan" and not e.get("BodyName"):
        cat = None
    if cat:
        with _lock:
            _events.append((time.time(), cat))


def activity():
    """Stima: la categoria con più eventi negli ultimi 10 minuti (il viaggio conta solo se non c'è altro)."""
    now = time.time()
    with _lock:
        counts = collections.Counter(c for t, c in _events if now - t <= ACTIVITY_WINDOW)
    other = {k: v for k, v in counts.items() if k != "travelling"}
    if other:
        key = max(other, key=other.get)
    elif counts.get("travelling"):
        key = "travelling"
    else:
        key = None
    return {"key": key, "label": pick_d(ACTIVITIES.get(key)), "counts": dict(counts)}


def local_status(cfg=None):
    cfg = cfg or _cfg()
    priv = cfg["privacy"]
    snap = STATE.snapshot()
    loc, ship, fuel, route = snap.get("location") or {}, snap.get("ship") or {}, snap.get("fuel") or {}, snap.get("route") or []
    st = {"name": (snap.get("cmdr") or {}).get("name") or pick("CMDR sconosciuto", "Unknown CMDR"), "hidden": [k for k in PRIVACY_KEYS if not priv[k]]}
    if priv["location"]:
        st.update(system=loc.get("system"), docked=bool(loc.get("docked")), station=loc.get("station") if loc.get("docked") else None)
    if priv["ship"]:
        st.update(ship=ship.get("type"), ship_name=ship.get("name"))
    if priv["fuel"] and fuel.get("level") is not None and fuel.get("cap"):
        st["fuel_pct"] = fuel["level"] / fuel["cap"] * 100
    if priv["activity"]:
        st["activity"] = activity()["key"]
    if priv["route"] and route:
        st.update(next_jump=route[0].get("StarSystem"), destination=route[-1].get("StarSystem"), jumps_left=len(route))
    if priv["sites"]:
        try:
            deps = [d for d in construction.depots()["depots"] if not d.get("complete") and not d.get("failed")]
        except Exception:
            deps = []
        st["sites"] = [{"market_id": d.get("market_id"), "system": d.get("system"), "station": d.get("station"),
                        "progress": d.get("progress"), "remaining": d.get("remaining_total"),
                        "updated": d.get("updated")} for d in deps[:3]]
    return clean_status(st)


# --- Codice di accesso ----------------------------------------------------------------

def _fp_bytes(fp):
    return bytes.fromhex((fp or "").replace(":", ""))[:16]


def make_code(secret_hex, fp):
    raw = bytes.fromhex(secret_hex) + _fp_bytes(fp)
    s = base64.b32encode(raw).decode().rstrip("=")
    return "-".join(s[i:i + 6] for i in range(0, len(s), 6))


def parse_code(code):
    s = re.sub(r"[^A-Za-z2-7]", "", str(code or "")).upper()
    if len(s) != 42:
        raise ValueError(pick("Codice di accesso non valido: controlla di averlo copiato tutto", "Invalid access code: make sure you copied all of it"))
    try:
        raw = base64.b32decode(s + "=" * (-len(s) % 8))
    except Exception:
        raise ValueError(pick("Codice di accesso non valido", "Invalid access code"))
    return raw[:10].hex(), raw[10:26]


def parse_address(addr):
    addr = str(addr or "").strip()
    addr = re.sub(r"^https?://", "", addr).split("/")[0]
    m = re.fullmatch(r"\[([0-9A-Fa-f:.]+)\](?::(\d{1,5}))?", addr) or re.fullmatch(r"([A-Za-z0-9.-]{1,253})(?::(\d{1,5}))?", addr)
    if not m:
        raise ValueError(pick("Indirizzo non valido: scrivi IP:porta, per esempio 192.168.1.20:8766", "Invalid address: enter IP:port, for example 192.168.1.20:8766"))
    port = int(m.group(2) or 8766)
    if not 1 <= port <= 65535:
        raise ValueError(pick("Porta non valida", "Invalid port"))
    return m.group(1), port


# --- Lato host: richieste dalla rete --------------------------------------------------

def _hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def _limited(bucket, key, limit, window, now):
    q = bucket.setdefault(key, collections.deque())
    while q and now - q[0] > window:
        q.popleft()
    if len(bucket) > 2000:  # niente crescita senza limiti con tanti IP diversi
        for k in [k for k, v in bucket.items() if not v or now - v[-1] > window]:
            bucket.pop(k, None)
    return q, len(q) >= limit


def _squad_view(cfg, viewer=None):
    """Stato della squadriglia così come lo vede chi lo chiede (host o membro)."""
    me = local_status(cfg)  # fuori dal lock: local_status lo usa a sua volta
    now = time.time()
    with _lock:
        for mid in [m for m, v in _members.items() if now - v["last_seen"] > FORGET_AFTER]:
            _members.pop(mid)
        rows = [{"id": "host", "host": True, "age": 0, "online": True, "status": me}]
        for mid, m in _members.items():
            age = now - m["last_seen"]
            rows.append({"id": mid, "host": False, "age": round(age), "online": age <= OFFLINE_AFTER,
                         "status": m["status"]})
    for r in rows:
        r["you"] = r["id"] == viewer
    todos = [{k: t.get(k) for k in ("id", "text", "by", "done", "done_by")} for t in cfg.get("host", {}).get("todos", [])]
    return {"members": rows, "todos": todos, "max": MAX_MEMBERS, "poll": POLL, "you": viewer}


def _auth(headers):
    token = headers.get("X-ED-Squad") or ""
    if not token or len(token) > 100:
        return None, "auth"
    h = _hash(token)
    with _lock:
        if h in _kicked:
            return None, "kicked"
        for mid, m in _members.items():
            if secrets.compare_digest(m["token_hash"], h):
                return mid, None
    return None, "auth"


def _todo_op(body, who):
    with _cfg_lock:
        _todo_apply(_cfg(), body, who)


def _todo_apply(cfg, body, who):
    todos = cfg.setdefault("host", {}).setdefault("todos", [])
    op = body.get("op")
    if op == "add":
        text = _clean_todo_text(body.get("text"))
        if not text:
            raise ValueError(pick("Scrivi l'obiettivo", "Enter the objective"))
        if len(todos) >= MAX_TODOS:
            raise ValueError(pick(f"Massimo {MAX_TODOS} obiettivi: togli quelli completati", f"Maximum {MAX_TODOS} objectives: remove the completed ones"))
        todos.append({"id": secrets.token_hex(4), "text": text, "by": who, "done": False, "done_by": None})
    elif op in ("done", "undo", "delete"):
        tid = body.get("id")
        item = next((t for t in todos if t["id"] == tid), None) if isinstance(tid, str) else None
        if not item:
            raise ValueError(pick("Obiettivo non trovato", "Objective not found"))
        if op == "delete":
            todos.remove(item)
        else:
            item.update(done=op == "done", done_by=who if op == "done" else None)
    elif op == "clear_done":
        todos[:] = [t for t in todos if not t["done"]]
    else:
        raise ValueError(pick("Operazione non valida", "Invalid operation"))
    _save(cfg)


def lan_request(method, path, headers, read, ip):
    """Unico ingresso per /api/squad/* dalla rete (chiamato da server.Handler). Restituisce (codice HTTP, dati)."""
    now = time.time()
    with _lock:
        _, over = _limited(_rate, ip, RATE_PER_MIN, 60, now)
        if over:
            return 429, {"error": pick("Troppe richieste, riprova tra poco", "Too many requests, try again shortly"), "reason": "rate"}
        _rate[ip].append(now)
    srv = _server()
    cfg = _cfg()
    if cfg["role"] != "host" or not srv.RUNTIME.get("lan_https"):
        return 503, {"error": pick("Nessuna squadriglia attiva su questo PC", "No squad active on this PC"), "reason": "closed"}
    body = {}
    if method == "POST":
        try:
            raw = read(MAX_BODY)
        except ValueError:
            return 413, {"error": pick("Richiesta troppo grande", "Request too large"), "reason": "size"}
        try:
            body = json.loads(raw) if raw else {}
        except ValueError:
            return 400, {"error": pick("Dati non validi", "Invalid data"), "reason": "payload"}
        if not isinstance(body, dict):
            return 400, {"error": pick("Dati non validi", "Invalid data"), "reason": "payload"}
    elif method != "GET":
        return 405, {"error": pick("Metodo non consentito", "Method not allowed")}
    name = path[len(PREFIX):]

    if name == "join" and method == "POST":
        with _lock:
            q, over = _limited(_bad, ip, BAD_CODE_PER_10MIN, 600, now)
            while _bad_all and now - _bad_all[0] > 600:
                _bad_all.popleft()
            if over or len(_bad_all) >= BAD_CODE_GLOBAL:
                return 429, {"error": pick("Troppi codici sbagliati: riprova più tardi", "Too many wrong codes: try again later"), "reason": "rate"}
        secret = body.get("secret")
        expected = cfg.get("host", {}).get("secret") or ""
        if not isinstance(secret, str) or len(secret) > 64 or not expected or not secrets.compare_digest(secret, expected):
            with _lock:
                q.append(now)
                _bad_all.append(now)
            return 403, {"error": pick("Codice di accesso sbagliato o non più valido", "Access code wrong or no longer valid"), "reason": "code"}
        status = clean_status(body.get("status"))
        blocked = {n.lower() for n in cfg.get("host", {}).get("blocked", [])}
        if status["name"].lower() in blocked:
            return 403, {"error": pick("L'host ti ha rimosso dalla squadriglia", "The host removed you from the squad"), "reason": "kicked"}
        token = secrets.token_urlsafe(24)
        with _lock:
            for mid in [m for m, v in _members.items() if v["status"]["name"].lower() == status["name"].lower()]:
                _members.pop(mid)  # stesso comandante che rientra: sostituisce la vecchia voce
            if len(_members) >= MAX_MEMBERS - 1:
                return 409, {"error": pick(f"La squadriglia è al completo ({MAX_MEMBERS} comandanti)", f"The squad is full ({MAX_MEMBERS} CMDRs)"), "reason": "full"}
            mid = secrets.token_hex(4)
            _members[mid] = {"token_hash": _hash(token), "status": status, "last_seen": now, "joined": now}
        print(f"[Squadriglia] {status['name']} è entrato ({ip})")
        return 200, {"token": token, "id": mid, **_squad_view(cfg, mid)}

    mid, reason = _auth(headers)
    if not mid:
        return 401, {"error": pick("L'host ti ha rimosso dalla squadriglia", "The host removed you from the squad") if reason == "kicked"
                     else pick("Accesso scaduto", "Access expired"),
                     "reason": reason}
    if name == "push" and method == "POST":
        status = clean_status(body.get("status"))
        with _lock:
            m = _members.get(mid)
            if m:
                m.update(status=status, last_seen=now)
        return 200, _squad_view(cfg, mid)
    if name == "state" and method == "GET":
        with _lock:
            if mid in _members:
                _members[mid]["last_seen"] = now
        return 200, _squad_view(cfg, mid)
    if name == "todo" and method == "POST":
        with _lock:
            who = (_members.get(mid) or {"status": {"name": "?"}})["status"]["name"]
        try:
            _todo_op(body, who)
        except ValueError as exc:
            return 400, {"error": str(exc), "reason": "payload"}
        return 200, _squad_view(_cfg(), mid)
    if name == "leave" and method == "POST":
        with _lock:
            m = _members.pop(mid, None)
        if m:
            print(f"[Squadriglia] {m['status']['name']} è uscito")
        return 200, {"status": "ok"}
    return 404, {"error": pick("non trovato", "not found")}


# --- Lato membro: connessione all'host ------------------------------------------------

def _call(member, method, path, body=None, token=None):
    """Richiesta HTTPS all'host con verifica dell'impronta del certificato (pinning)."""
    host, port = parse_address(member["address"])
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.minimum_version = ssl.TLSVersion.TLSv1_2
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE  # certificato autofirmato: lo verifichiamo con l'impronta qui sotto
    conn = http.client.HTTPSConnection(host, port, timeout=8, context=ctx)
    try:
        conn.connect()
        der = conn.sock.getpeercert(binary_form=True) or b""
        if not secrets.compare_digest(hashlib.sha256(der).digest()[:16], bytes.fromhex(member["fp"])):
            raise PinError(pick("Il certificato dell'host non corrisponde al codice: chiedi all'host un codice nuovo "
                                "(cambia se cambia il suo indirizzo di rete)",
                                "The host's certificate doesn't match the code: ask the host for a new code "
                                "(it changes if their network address changes)"))
        data = json.dumps(body).encode() if body is not None else None
        hdrs = {"Content-Type": "application/json", "Host": f"{host}:{port}"}
        if token:
            hdrs["X-ED-Squad"] = token
        conn.request(method, PREFIX + path, body=data, headers=hdrs)
        resp = conn.getresponse()
        raw = resp.read(MAX_REPLY + 1)
        if len(raw) > MAX_REPLY:
            raise ValueError(pick("Risposta dell'host troppo grande", "Host reply too large"))
        try:
            out = json.loads(raw) if raw else {}
        except ValueError:
            out = {}
        if not isinstance(out, dict):
            out = {}
        return resp.status, out
    finally:
        conn.close()


def _clean_view(v):
    """Anche ciò che arriva dall'host è validato (l'interfaccia lo mostra sempre con escape)."""
    rows = []
    for r in (v.get("members") if isinstance(v.get("members"), list) else [])[:MAX_MEMBERS]:
        if isinstance(r, dict):
            age = _numv(r.get("age"), 0, 10 ** 7)
            rows.append({"id": _txt(r.get("id"), 16), "host": r.get("host") is True, "you": r.get("you") is True,
                         "age": age or 0, "online": r.get("online") is True, "status": clean_status(r.get("status"))})
    todos = []
    for t in (v.get("todos") if isinstance(v.get("todos"), list) else [])[:MAX_TODOS]:
        if isinstance(t, dict) and _txt(t.get("text"), 140):
            todos.append({"id": _txt(t.get("id"), 16), "text": _txt(t.get("text"), 140), "by": _txt(t.get("by"), 40),
                          "done": t.get("done") is True, "done_by": _txt(t.get("done_by"), 40)})
    return {"members": rows, "todos": todos, "you": _txt(v.get("you"), 16)}


def _drop_membership(cfg, notice):
    cfg["role"] = "none"
    cfg.pop("member", None)
    _save(cfg)
    _link.update(state=None, error=None)
    _notice["text"] = notice


def _join(member, cfg):
    code, out = _call(member, "POST", "join", {"secret": member["secret"], "status": local_status(cfg)})
    if code != 200 or not isinstance(out.get("token"), str):
        raise Refused(out.get("error") or pick(f"L'host ha risposto con errore {code}", f"The host replied with error {code}"), out.get("reason"))
    member.update(token=out["token"][:100], id=_txt(out.get("id"), 16))
    _link.update(state=_clean_view(out), at=time.time(), ok_at=time.time(), error=None)


def _push_once():
    cfg = _cfg()
    member = cfg.get("member")
    if cfg["role"] != "member" or not member:
        return
    try:
        code, out = _call(member, "POST", "push", {"status": local_status(cfg)}, member.get("token"))
        if code == 401 and out.get("reason") == "auth":
            try:
                _join(member, cfg)  # l'host si è riavviato o ci ha dimenticati: rientriamo con il codice salvato
            except Refused as exc:
                if exc.reason in ("code", "kicked"):
                    return _drop_membership(cfg, str(exc))
                raise
            _save(cfg)
            return
        if code in (401, 403) and out.get("reason") in ("kicked", "code"):
            return _drop_membership(cfg, out.get("error") or pick("Non fai più parte della squadriglia", "You are no longer part of the squad"))
        if code != 200:
            raise ValueError(out.get("error") or pick(f"errore {code}", f"error {code}"))
        _link.update(state=_clean_view(out), at=time.time(), ok_at=time.time(), error=None)
    except (OSError, http.client.HTTPException) as exc:  # ssl.SSLError è un OSError
        _link.update(error=pick("Host non raggiungibile: forse ha chiuso la squadriglia o l'app, oppure la rete non "
                                 f"lo consente ({exc.__class__.__name__})",
                                 "Host unreachable: they may have closed the squad or the app, or the network "
                                 f"doesn't allow it ({exc.__class__.__name__})"), at=time.time())
    except (ValueError, PinError) as exc:
        _link.update(error=str(exc) or exc.__class__.__name__, at=time.time())


def _loop():
    while True:
        _wake.wait(POLL)
        _wake.clear()
        try:
            with _cfg_lock:
                _push_once()
        except Exception as exc:
            print(f"[Squadriglia] {exc!r}")


def start():
    add_listener(_on_event)
    cfg = _cfg()
    if cfg["role"] == "host":
        time.sleep(3)  # main.py accende il server di rete subito dopo, se attivo: evitiamo di farlo in due
        srv = _server()
        if not srv.RUNTIME.get("lan_server"):
            srv.start_lan()
    _loop()


# --- API locali (interfaccia dell'app) ------------------------------------------------

def _locked(fn):
    def wrapper(body, q):
        with _cfg_lock:
            return fn(body, q)
    return wrapper

def _host_info(cfg):
    srv = _server()
    h = cfg.get("host") or {}
    fp = srv.RUNTIME.get("lan_fingerprint")
    running = bool(srv.RUNTIME.get("lan_port")) and bool(srv.RUNTIME.get("lan_https"))
    code = make_code(h["secret"], fp) if running and h.get("secret") and fp else None
    return {"running": running, "code": code, "address": f"{srv.local_ip()}:{srv.RUNTIME['lan_port']}" if running else None,
            "port": srv.RUNTIME.get("lan_port"), "fingerprint": fp, "blocked": h.get("blocked", [])}


def status(q=None):
    cfg = _cfg()
    out = {"role": cfg["role"], "privacy": cfg["privacy"], "activity": activity(), "notice": _notice["text"],
           "tls_available": _server().tls.available(), "max": MAX_MEMBERS, "poll": POLL,
           "offline_after": OFFLINE_AFTER, "me": local_status(cfg)}
    if cfg["role"] == "host":
        out["host"] = _host_info(cfg)
        out["squad"] = _squad_view(cfg, "host")
    elif cfg["role"] == "member":
        m = cfg.get("member") or {}
        now = time.time()
        out["member"] = {"address": m.get("address"), "error": _link["error"],
                         "last_ok_age": round(now - _link["ok_at"]) if _link["ok_at"] else None,
                         "connected": bool(_link["ok_at"]) and now - _link["ok_at"] <= OFFLINE_AFTER}
        st = _link["state"]
        if st:
            age_extra = now - _link["ok_at"]
            out["squad"] = {**st, "members": [{**r, "age": r["age"] + age_extra,
                                                "online": r["online"] and r["age"] + age_extra <= OFFLINE_AFTER}
                                               for r in st["members"]]}
    return out


def _host(body, q):
    cfg = _cfg()
    srv = _server()
    if (body or {}).get("enable"):
        if cfg["role"] == "member":
            raise ValueError(pick("Prima esci dalla squadriglia di cui fai parte", "First leave the squad you are in"))
        if not srv.tls.available():
            raise ValueError(pick("Per ospitare una squadriglia serve la connessione cifrata (HTTPS), non disponibile qui", "Hosting a squad needs an encrypted connection (HTTPS), not available here"))
        if not srv.RUNTIME.get("lan_server") and not srv.start_lan():
            raise ValueError(pick("Non riesco ad aprire il server di rete: porte occupate", "Can't open the network server: ports in use"))
        if not srv.RUNTIME.get("lan_https"):
            raise ValueError(pick("Il server di rete è attivo senza HTTPS: la squadriglia richiede la connessione cifrata", "The network server is running without HTTPS: the squad needs an encrypted connection"))
        h = cfg.setdefault("host", {})
        h.setdefault("secret", secrets.token_hex(10))
        h.setdefault("todos", [])
        h.setdefault("blocked", [])
        cfg["role"] = "host"
        _notice["text"] = None
        _save(cfg)
    elif cfg["role"] == "host":
        cfg["role"] = "none"
        _save(cfg)
        with _lock:
            _members.clear()
            _kicked.clear()
        if not srv.app_config().get("lan_enabled"):
            srv.stop_lan()  # acceso solo per la squadriglia: lo spegniamo
    return status()


def _regen(body, q):
    cfg = _cfg()
    if cfg["role"] != "host":
        raise ValueError(pick("Non stai ospitando una squadriglia", "You are not hosting a squad"))
    cfg["host"]["secret"] = secrets.token_hex(10)
    cfg["host"]["blocked"] = []
    if (body or {}).get("drop_members"):
        with _lock:
            _kicked.update(m["token_hash"] for m in _members.values())
            _members.clear()
    _save(cfg)
    return status()


def _kick(body, q):
    cfg = _cfg()
    mid = (body or {}).get("id")
    if cfg["role"] != "host":
        raise ValueError(pick("Non stai ospitando una squadriglia", "You are not hosting a squad"))
    with _lock:
        m = _members.pop(mid, None) if isinstance(mid, str) else None
        if not m:
            raise ValueError(pick("Membro non trovato", "Member not found"))
        _kicked.add(m["token_hash"])
    blocked = cfg["host"].setdefault("blocked", [])
    if m["status"]["name"] not in blocked:
        blocked.append(m["status"]["name"])
    _save(cfg)
    return status()


def _unblock(body, q):
    cfg = _cfg()
    name = (body or {}).get("name")
    if cfg["role"] == "host" and name in cfg["host"].get("blocked", []):
        cfg["host"]["blocked"].remove(name)
        _save(cfg)
    return status()


def _join_local(body, q):
    cfg = _cfg()
    if cfg["role"] == "host":
        raise ValueError(pick("Stai ospitando una squadriglia: chiudila prima di entrare in un'altra", "You are hosting a squad: close it before joining another"))
    body = body or {}
    addr, code = str(body.get("address") or "").strip(), str(body.get("code") or "").strip()
    if " " in addr and not code:  # invito incollato tutto insieme: "indirizzo codice"
        addr, code = addr.split(None, 1)
    parse_address(addr)
    secret, fp = parse_code(code)
    member = {"address": addr, "secret": secret, "fp": fp.hex()}
    try:
        _join(member, cfg)
    except PinError as exc:
        raise ValueError(str(exc))
    except (OSError, ssl.SSLError, http.client.HTTPException) as exc:
        raise ValueError(pick(f"Host non raggiungibile ({exc.__class__.__name__}): controlla indirizzo, porta e che l'host "
                              "stia ospitando la squadriglia",
                              f"Host unreachable ({exc.__class__.__name__}): check the address, the port and that the host "
                              "is hosting the squad"))
    cfg.update(role="member", member=member)
    _notice["text"] = None
    _save(cfg)
    return status()


def _leave(body, q):
    cfg = _cfg()
    member = cfg.get("member")
    if cfg["role"] == "member" and member:
        try:
            _call(member, "POST", "leave", {}, member.get("token"))
        except Exception:
            pass  # host irraggiungibile: usciamo comunque (dopo un'ora ci dimentica)
    _drop_membership(cfg, None)
    return status()


def _privacy(body, q):
    cfg = _cfg()
    for k, v in (body or {}).items():
        if k in PRIVACY_KEYS:
            cfg["privacy"][k] = bool(v)
    _save(cfg)
    _wake.set()  # invia subito lo stato aggiornato
    return status()


def _todo_local(body, q):
    cfg = _cfg()
    body = body if isinstance(body, dict) else {}
    if cfg["role"] == "host":
        _todo_op(body, local_status(cfg)["name"])
    elif cfg["role"] == "member" and cfg.get("member"):
        m = cfg["member"]
        try:
            code, out = _call(m, "POST", "todo", {k: body.get(k) for k in ("op", "id", "text")}, m.get("token"))
        except (OSError, ssl.SSLError, http.client.HTTPException, PinError) as exc:
            raise ValueError(pick(f"Host non raggiungibile: {exc}", f"Host unreachable: {exc}"))
        if code != 200:
            raise ValueError(out.get("error") or pick(f"errore {code}", f"error {code}"))
        _link.update(state=_clean_view(out), at=time.time(), ok_at=time.time(), error=None)
    else:
        raise ValueError(pick("Non fai parte di una squadriglia", "You are not in a squad"))
    return status()


GET["/api/squadron/status"] = status
POST.update({
    "/api/squadron/host": _locked(_host),
    "/api/squadron/regen": _locked(_regen),
    "/api/squadron/kick": _locked(_kick),
    "/api/squadron/unblock": _locked(_unblock),
    "/api/squadron/join": _locked(_join_local),
    "/api/squadron/leave": _locked(_leave),
    "/api/squadron/privacy": _locked(_privacy),
    "/api/squadron/todo": _todo_local,
})
