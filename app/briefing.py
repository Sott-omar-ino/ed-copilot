"""Briefing vocale all'avvio del gioco.

Quando il gioco carica una sessione (LoadGame seguito da Location nel journal) il copilota riassume in poche frasi
dove sei, con che nave, cosa hai fatto l'ultima volta, missioni in scadenza, dati da vendere, Fleet Carrier e
obiettivi della comunità che stanno per finire. Se l'app viene aperta a gioco già avviato, il briefing parte una
volta sola appena la sessione in corso viene riconosciuta. La voce è quella degli altri avvisi del backend (voice.say).
"""

import datetime
import threading
import time

from . import journal, paths, storage, voice
from .journal import STATE
from .lang import is_en, pick


def parse_ts(ts):
    """Data ISO del journal, di Frontier o di Inara -> epoch (None se non si capisce)."""
    if not ts:
        return None
    try:
        d = datetime.datetime.fromisoformat(str(ts).strip().replace(" ", "T").replace("Z", "+00:00"))
    except ValueError:
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=datetime.timezone.utc)
    return d.timestamp()

CONFIG_FILE = paths.user_file("briefing_config.json")
DEFAULT_CONFIG = {"enabled": True}
SETTLE_S = 8          # dopo Location il gioco scrive ancora Missions, Loadout, Cargo...: si aspetta un attimo
NO_LOCATION_S = 25    # LoadGame senza Location (raro): si parla comunque dopo così
URGENT_H = 6
CG_SOON_H = 24
MAX_CHARS = 520       # circa 30 secondi di voce

_lock = threading.Lock()
_status = {"pending_since": None, "due": None, "session": None, "last": None, "last_spoken": None}
_started = False


# --- Configurazione -----------------------------------------------------------------

def load_config():
    data = storage.load_json(CONFIG_FILE, {})
    return {**DEFAULT_CONFIG, **(data if isinstance(data, dict) else {})}


def save_config(changes):
    cfg = {**load_config(), **{k: v for k, v in (changes or {}).items() if k in DEFAULT_CONFIG}}
    cfg["enabled"] = bool(cfg["enabled"])
    storage.save_json(CONFIG_FILE, cfg)
    return cfg


# --- Frasi ---------------------------------------------------------------------------

def _money(v):
    """Crediti detti a voce: 12,5 milioni, 1,2 miliardi, 850 mila."""
    v = float(v or 0)
    if is_en():
        for div, word in ((1e9, "billion"), (1e6, "million")):
            if abs(v) >= div:
                x = v / div
                txt = f"{x:.1f}".replace(".0", "") if x < 100 else f"{x:.0f}"
                return f"{txt} {word}"
        if abs(v) >= 1000:
            return f"{round(v / 1000)} thousand"
        return f"{int(v)}"
    for div, one, many in ((1e9, "miliardo", "miliardi"), (1e6, "milione", "milioni")):
        if abs(v) >= div:
            x = v / div
            txt = f"{x:.1f}".replace(".", ",").replace(",0", "") if x < 100 else f"{x:.0f}"
            return f"{txt} {one if txt == '1' else many}"
    if abs(v) >= 1000:
        return f"{round(v / 1000)} mila"
    return f"{int(v)}"


def _cr(v):
    s = _money(v)
    if is_en():
        return s + " credits"
    return s + (" di crediti" if s.endswith(("milioni", "miliardi", "milione", "miliardo")) else " crediti")


def _hours(sec):
    sec = max(0, int(sec))
    if sec < 3600:
        m = max(1, round(sec / 60))
        return pick("un minuto", "one minute") if m == 1 else pick(f"{m} minuti", f"{m} minutes")
    h = round(sec / 3600)
    return pick("un'ora", "one hour") if h == 1 else pick(f"{h} ore", f"{h} hours")


def _when(t, now):
    days = (datetime.date.fromtimestamp(now) - datetime.date.fromtimestamp(t)).days
    if days <= 0:
        return pick("oggi", "today")
    if days == 1:
        return pick("ieri", "yesterday")
    if days < 14:
        return pick(f"{days} giorni fa", f"{days} days ago")
    return pick("qualche tempo fa", "a while ago")


CATS_IT = {"trade": "il commercio", "mining": "l'estrazione mineraria", "missions": "le missioni",
           "combat": "il combattimento", "exploration": "l'esplorazione", "exobiology": "l'esobiologia"}
CATS_EN = {"trade": "trading", "mining": "mining", "missions": "missions",
           "combat": "combat", "exploration": "exploration", "exobiology": "exobiology"}


def _last_session(now):
    try:
        from . import stats
        sessions = stats.summary()["sessions"]  # dalla più recente
    except Exception as exc:
        print(f"[Briefing] Statistiche non disponibili: {exc!r}")
        return None
    for s in sessions:
        if s.get("live"):
            continue
        bits = []
        if s.get("jumps"):
            bits.append(pick(f"{s['jumps']} salti", f"made {s['jumps']} jumps") if s["jumps"] > 1
                        else pick("un salto", "made one jump"))
        earned = s.get("earned") or 0
        if earned > 0:
            cats = sorted(((v, k) for k, v in (s.get("earn") or {}).items() if v > 0 and k in CATS_IT), reverse=True)
            main = (pick(f", soprattutto con {CATS_IT[cats[0][1]]}", f", mostly from {CATS_EN[cats[0][1]]}")
                    if cats and cats[0][0] >= earned * 0.5 else "")
            bits.append(pick(f"guadagnato {_cr(earned)}{main}", f"earned {_cr(earned)}{main}"))
        if s.get("bio"):
            bits.append(pick(f"analizzato {s['bio']} specie", f"analysed {s['bio']} species") if s["bio"] > 1
                        else pick("analizzato una specie", "analysed one species"))
        when = _when(s.get("end") or s.get("start") or now, now)
        if not bits:
            return pick(f"L'ultima sessione, {when}, è stata breve.", f"Your last session, {when}, was a short one.")
        if is_en():
            return f"In your last session, {when}, you {', '.join(bits[:-1]) + ' and ' + bits[-1] if len(bits) > 1 else bits[0]}."
        verb = "hai fatto " if bits[0].endswith(("salti", "salto")) else "hai "
        return f"Nell'ultima sessione, {when}, {verb}{', '.join(bits[:-1]) + ' e ' + bits[-1] if len(bits) > 1 else bits[0]}."
    return None


def _missions(snap, now):
    ms = snap.get("missions") or []
    if not ms:
        return None
    urgent = []
    for m in ms:
        exp = parse_ts(m.get("expiry"))
        if exp and 0 < exp - now < URGENT_H * 3600:
            urgent.append((exp, m))
    urgent.sort(key=lambda x: x[0])
    n = len(ms)
    head = pick("Hai una missione attiva", "You have one active mission") if n == 1 \
        else pick(f"Hai {n} missioni attive", f"You have {n} active missions")
    if not urgent:
        return head + pick(", nessuna in scadenza a breve.", ", none expiring soon.")
    exp, m = urgent[0]
    name = (m.get("name") or pick("missione", "mission")).strip()
    if len(name) > 50:
        name = name[:50].rsplit(" ", 1)[0]
    if len(urgent) == 1:
        return pick(f"{head}: {name} scade tra {_hours(exp - now)}.", f"{head}: {name} expires in {_hours(exp - now)}.")
    return pick(f"{head}, {len(urgent)} scadono entro {URGENT_H} ore. La prima, {name}, tra {_hours(exp - now)}.",
                f"{head}, {len(urgent)} expiring within {URGENT_H} hours. The first, {name}, in {_hours(exp - now)}.")


def _unsold(snap):
    carto, bio = snap.get("carto_unsold_total") or 0, snap.get("bio_unsold_total") or 0
    parts = []
    if carto >= 100000:
        parts.append(pick(f"dati di esplorazione per {_cr(carto)}", f"exploration data worth {_cr(carto)}"))
    if bio >= 100000:
        n = len(snap.get("bio_unsold") or [])
        parts.append(pick(f"{n} campioni biologici per {_cr(bio)}", f"{n} biological samples worth {_cr(bio)}") if n > 1
                     else pick(f"campioni biologici per {_cr(bio)}", f"biological samples worth {_cr(bio)}"))
    if not parts:
        return None
    return pick("Da vendere hai " + " e ".join(parts) + ".", "You have " + " and ".join(parts) + " to sell.")


def _carrier(snap, now):
    c = snap.get("carrier") or {}
    if not c.get("callsign") and not c.get("name"):
        return None
    name = c.get("name") or c.get("callsign")
    out = pick(f"Il tuo Fleet Carrier {name}", f"Your Fleet Carrier {name}")
    dep = parse_ts(c.get("departure_time"))
    if dep and c.get("destination_system") and dep > now - 120:
        if dep > now:
            out += pick(f" ha un salto programmato verso {c['destination_system']} tra {_hours(dep - now)}",
                        f" has a jump scheduled to {c['destination_system']} in {_hours(dep - now)}")
        else:
            out += pick(f" sta saltando verso {c['destination_system']}", f" is jumping to {c['destination_system']}")
    elif c.get("system"):
        out += pick(f" è a {c['system']}", f" is in {c['system']}")
    else:
        out += pick(" è operativo", " is operational")
    fuel = c.get("fuel")
    if fuel is not None:
        out += pick(f", Tritium a {fuel} tonnellate", f", Tritium at {fuel} tonnes")
    return out + "."


def _community_goals(now):
    try:
        from . import search
        cgs = search.community_goals() or []
    except Exception:
        return None
    soon = []
    for g in cgs:
        exp = parse_ts(g.get("expiry"))
        if exp and 0 < exp - now < CG_SOON_H * 3600:
            soon.append((exp, g))
    if not soon:
        return None
    soon.sort(key=lambda x: x[0])
    exp, g = soon[0]
    more = pick(f" e altri {len(soon) - 1}", f" (plus {len(soon) - 1} more)") if len(soon) > 1 else ""
    return pick(f"L'obiettivo della comunità {g.get('title') or ''}{more} termina tra {_hours(exp - now)}.",
                f"The community goal {g.get('title') or ''}{more} ends in {_hours(exp - now)}.").replace("  ", " ")


def build(with_cg=True):
    """Il briefing: testo intero e frasi separate (per l'interfaccia)."""
    snap = STATE.snapshot()
    now = time.time()
    cmdr = (snap.get("cmdr") or {}).get("name")
    loc, ship = snap.get("location") or {}, snap.get("ship") or {}
    system = loc.get("system") or (snap.get("system") or {}).get("name")
    parts = []

    # In inglese "Commander" per esteso: il testo viene letto dalla voce.
    greet = pick(f"Bentornato, comandante {cmdr}.", f"Welcome back, Commander {cmdr}.") if cmdr \
        else pick("Bentornato, comandante.", "Welcome back, Commander.")
    if system:
        if loc.get("docked") and loc.get("station"):
            where = pick(f"Sei attraccato a {loc['station']}, nel sistema {system}",
                         f"You're docked at {loc['station']}, in the {system} system")
        elif loc.get("body") and loc.get("body") != system:
            where = pick(f"Sei nel sistema {system}, vicino a {loc['body']}",
                         f"You're in the {system} system, near {loc['body']}")
        else:
            where = pick(f"Sei nello spazio, nel sistema {system}", f"You're in space, in the {system} system")
    else:
        where = pick("Posizione non ancora nota", "Location not known yet")
    sname = (ship.get("name") or "").strip()
    stype = ship.get("type")
    if stype:
        where += pick(f", con la tua {stype}", f", with your {stype}") + (f" {sname}" if sname and sname.lower() != stype.lower() else "")
    parts.append({"key": "where", "label": pick("Posizione", "Location"), "text": f"{greet} {where}."})

    for key, label, fn in (("last", pick("Ultima sessione", "Last session"), lambda: _last_session(now)),
                           ("missions", pick("Missioni", "Missions"), lambda: _missions(snap, now)),
                           ("unsold", pick("Dati da vendere", "Data to sell"), lambda: _unsold(snap)),
                           ("carrier", "Fleet Carrier", lambda: _carrier(snap, now)),
                           ("cg", pick("Obiettivi della comunità", "Community goals"), lambda: _community_goals(now) if with_cg else None)):
        try:
            text = fn()
        except Exception as exc:
            print(f"[Briefing] {key}: {exc!r}")
            text = None
        if text:
            parts.append({"key": key, "label": label, "text": text})

    # Massimo ~30 secondi: le frasi meno importanti (in fondo) cadono per prime.
    order = ["where", "missions", "unsold", "last", "carrier", "cg"]
    keep = list(parts)
    while len(keep) > 1 and sum(len(p["text"]) + 1 for p in keep) > MAX_CHARS:
        drop = max(keep[1:], key=lambda p: order.index(p["key"]))
        keep.remove(drop)
    text = " ".join(p["text"] for p in keep)
    return {"text": text, "parts": keep, "generated": now, "live": snap.get("live")}


# --- Parlato --------------------------------------------------------------------------

def speak(auto=False):
    b = build()
    voice.say(b["text"])
    with _lock:
        _status["last"] = b
        _status["last_spoken"] = time.time()
    if auto:
        ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        with STATE.lock:
            STATE.note(ts, pick("Briefing di bordo: ", "Ship briefing: ") + b["parts"][0]["text"], "info")
    print(f"[Briefing] {b['text']}")
    return b


def _session_key():
    return STATE.session.get("start") or STATE.cmdr.get("name") or "?"


def _on_event(e):
    ev = e.get("event")
    now = time.time()
    with _lock:
        if ev == "LoadGame":
            _status["pending_since"], _status["due"] = now, now + NO_LOCATION_S
        elif ev == "Location" and _status["pending_since"]:
            _status["due"] = now + SETTLE_S
        elif ev in ("Shutdown",):
            _status["pending_since"] = _status["due"] = None


def _game_running_now():
    """App aperta a gioco già avviato: c'è una sessione in corso nel journal?"""
    try:
        from . import stats
        cur = stats.summary().get("current")
    except Exception:
        return False
    return bool(cur and time.time() - (cur.get("end") or 0) < 15 * 60)


def _loop():
    deadline = time.time() + 120
    while not STATE.live and time.time() < deadline:
        time.sleep(1)
    time.sleep(3)
    with _lock:
        fresh = _status["pending_since"] is not None
    if not fresh and _game_running_now():
        with _lock:
            _status["due"] = time.time()
            _status["pending_since"] = time.time()
    while True:
        time.sleep(1)
        with _lock:
            due = _status["due"]
            if not due or time.time() < due:
                continue
            _status["due"] = _status["pending_since"] = None
            key = _session_key()
            if _status["session"] == key:
                continue
            _status["session"] = key
        if not load_config()["enabled"]:
            continue
        try:
            speak(auto=True)
        except Exception as exc:
            print(f"[Briefing] {exc!r}")


def start():
    global _started
    with _lock:
        if _started:
            return
        _started = True
    journal.add_listener(_on_event)
    threading.Thread(target=_loop, name="briefing", daemon=True).start()


# --- API -------------------------------------------------------------------------------

def _get(q):
    b = build()
    with _lock:
        b["last_spoken"] = _status["last_spoken"]
    b["config"] = load_config()
    return b


def _speak(body, q):
    b = speak()
    with _lock:
        last = _status["last_spoken"]
    return {**b, "ok": True, "last_spoken": last, "config": load_config()}


GET = {"/api/briefing": _get,
       "/api/briefing/config": lambda q: load_config()}
POST = {"/api/briefing/speak": _speak,
        "/api/briefing/config": lambda body, q: save_config(body)}
LAN = set()
