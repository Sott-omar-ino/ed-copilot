"""Notifiche sul telefono (companion).

Gli eventi importanti del journal (e alcune condizioni lette da Status.json) finiscono in un piccolo buffer circolare
con id crescenti. Il companion sul telefono interroga GET /api/notify/feed?since=<id> e mostra le novità (avviso,
vibrazione, suono e, se il browser lo consente, una notifica di sistema). Quali tipi inviare si sceglie dal PC.
"""

import collections
import datetime
import threading
import time

from . import journal, paths, storage
from .journal import STATE
from .lang import pick, pick_d
from .state import station_name

CONFIG_FILE = paths.user_file("notify_config.json")
# tipo -> ({"it", "en"} etichetta per le impostazioni, acceso di default)
TYPES = {
    "carrier": ({"it": "Fleet Carrier: salto programmato, partenza imminente e arrivo (se sei a bordo)",
                 "en": "Fleet Carrier: jump scheduled, departure imminent and arrival (if you are aboard)"}, True),
    "shields": ({"it": "Scudi abbassati", "en": "Shields down"}, True),
    "hull": ({"it": "Danni allo scafo", "en": "Hull damage"}, True),
    "interdiction": ({"it": "Interdizione", "en": "Interdiction"}, True),
    "attack": ({"it": "Sotto attacco", "en": "Under attack"}, True),
    "fuel": ({"it": "Carburante critico e serbatoio vuoto", "en": "Fuel critical and tank empty"}, True),
    "mission_expiring": ({"it": "Missione in scadenza entro un'ora", "en": "Mission expiring within an hour"}, True),
    "mission_done": ({"it": "Missione completata o fallita", "en": "Mission completed or failed"}, True),
    "docking": ({"it": "Attracco concesso o negato", "en": "Docking granted or denied"}, True),
    "death": ({"it": "Nave distrutta", "en": "Ship destroyed"}, True),
}
DEFAULT_CONFIG = {"enabled": True, "types": {k: v[1] for k, v in TYPES.items()}}
MAX_ITEMS = 100
FUEL_CRITICAL = 0.10           # frazione del serbatoio principale
COUNTDOWN_S = 5 * 60           # avviso prima della partenza del Fleet Carrier
MISSION_WARN_S = 3600
RATE = {"hull": 20, "attack": 60, "shields": 15, "interdiction": 20}  # secondi minimi fra due notifiche dello stesso tipo

_lock = threading.Lock()
_items = collections.deque(maxlen=MAX_ITEMS)
_next_id = [int(time.time() * 1000)]   # cresce anche fra un riavvio e l'altro: il telefono non si confonde
_last_by_type = {}
_mission_warned = set()
_carrier = {"departure": None, "dest": None, "countdown_sent": False}
_fuel = {"critical": False, "empty": False}
_started = False


# --- Configurazione ----------------------------------------------------------------

def load_config():
    data = storage.load_json(CONFIG_FILE, {})
    data = data if isinstance(data, dict) else {}
    types = {**DEFAULT_CONFIG["types"], **{k: bool(v) for k, v in (data.get("types") or {}).items() if k in TYPES}}
    return {"enabled": bool(data.get("enabled", True)), "types": types}


def save_config(body):
    body = body or {}
    cfg = load_config()
    if "enabled" in body:
        cfg["enabled"] = bool(body["enabled"])
    for k, v in (body.get("types") or {}).items():
        if k in TYPES:
            cfg["types"][k] = bool(v)
    storage.save_json(CONFIG_FILE, cfg)
    return public_config()


def public_config():
    cfg = load_config()
    return {**cfg, "labels": {k: pick_d(v[0]) for k, v in TYPES.items()}}


# --- Buffer ------------------------------------------------------------------------

def push(kind, title, text="", level="info", force=False):
    """Aggiunge una notifica (se il tipo è acceso). level: info | ok | warn | bad."""
    cfg = load_config()
    if not force and (not cfg["enabled"] or not cfg["types"].get(kind, True)):
        return None
    now = time.time()
    with _lock:
        gap = RATE.get(kind)
        if not force and gap and now - _last_by_type.get(kind, 0) < gap:
            return None
        _last_by_type[kind] = now
        _next_id[0] += 1
        item = {"id": _next_id[0], "t": now, "type": kind, "title": title, "text": text, "level": level}
        _items.append(item)
    return item


def feed(q):
    try:
        since = int(q.get("since"))
    except (TypeError, ValueError):
        since = None
    with _lock:
        items = list(_items)
        last = _next_id[0]
    if since is None:   # primo collegamento: lo storico recente, senza far suonare il telefono
        return {"items": items[-20:], "last": last, "initial": True}
    return {"items": [i for i in items if i["id"] > since], "last": last, "initial": False}


# --- Eventi del journal ----------------------------------------------------------------

def _ts(s):
    if not s:
        return None
    try:
        return datetime.datetime.fromisoformat(str(s).replace("Z", "+00:00")).timestamp()
    except (TypeError, ValueError):
        return None


def _hm(t):
    return time.strftime("%H:%M", time.localtime(t))


def _mission_name(e):
    return (e.get("LocalisedName") or e.get("Name") or pick("Missione", "Mission")).strip()


def _fmt_cr(v):
    return f"{int(v):,}".replace(",", ".") + " CR"


def _on_event(e):
    ev = e.get("event")
    if ev == "CarrierJumpRequest":
        dep = _ts(e.get("DepartureTime"))
        dest = e.get("SystemName") or "?"
        body = e.get("Body")
        _carrier.update(departure=dep, dest=dest, countdown_sent=False)
        when = pick(f" Partenza alle {_hm(dep)}.", f" Departure at {_hm(dep)}.") if dep else ""
        where = f"{dest}{' (' + body + ')' if body and body != dest else ''}"
        push("carrier", pick("Fleet Carrier: salto programmato", "Fleet Carrier: jump scheduled"),
             pick(f"Destinazione {where}.{when}", f"Destination {where}.{when}"), "info")
    elif ev == "CarrierJumpCancelled":
        _carrier.update(departure=None, dest=None)
        push("carrier", pick("Fleet Carrier: salto annullato", "Fleet Carrier: jump cancelled"), "", "warn")
    elif ev == "CarrierJump":
        _carrier.update(departure=None)
        push("carrier", pick("Fleet Carrier arrivato", "Fleet Carrier arrived"),
             pick(f"Salto completato: ora sei a {e.get('StarSystem') or '?'}.",
                  f"Jump complete: you are now in {e.get('StarSystem') or '?'}."), "ok")
    elif ev == "ShieldState" and e.get("ShieldsUp") is False:
        push("shields", pick("Scudi abbassati!", "Shields down!"), pick("Gli scudi sono crollati.", "Your shields have collapsed."), "bad")
    elif ev == "HullDamage" and e.get("PlayerPilot", True) and not e.get("Fighter"):
        pct = round((e.get("Health") or 0) * 100)
        push("hull", pick(f"Scafo al {pct}%", f"Hull at {pct}%"),
             pick("La nave sta subendo danni allo scafo.", "Your ship is taking hull damage."), "bad" if pct < 50 else "warn")
    elif ev == "Interdicted":
        who = e.get("Interdictor_Localised") or e.get("Interdictor") or pick("sconosciuto", "unknown")
        kind = pick("un giocatore", "a player") if e.get("IsPlayer") else pick("un NPC", "an NPC")
        push("interdiction", pick("Interdizione!", "Interdiction!"),
             pick(f"Interdetto da {who} ({kind}).", f"Interdicted by {who} ({kind})."), "bad")
    elif ev == "EscapeInterdiction":
        push("interdiction", pick("Interdizione evitata", "Interdiction evaded"),
             pick(f"Sei sfuggito a {e.get('Interdictor') or 'un inseguitore'}.",
                  f"You escaped {e.get('Interdictor') or 'a pursuer'}."), "ok")
    elif ev == "UnderAttack" and e.get("Target") in (None, "You"):
        push("attack", pick("Sotto attacco!", "Under attack!"), pick("La tua nave è sotto attacco.", "Your ship is under attack."), "bad")
    elif ev == "MissionCompleted":
        reward = e.get("Reward")
        push("mission_done", pick("Missione completata", "Mission completed"), _mission_name(e) + (f" · {_fmt_cr(reward)}" if reward else ""), "ok")
        _mission_warned.discard(e.get("MissionID"))
    elif ev == "MissionFailed":
        push("mission_done", pick("Missione fallita", "Mission failed"), _mission_name(e), "bad")
    elif ev == "DockingGranted":
        push("docking", pick("Attracco concesso", "Docking granted"), f"Pad {e.get('LandingPad')} · {station_name(e.get('StationName'), e.get('StationName_Localised')) or ''}".strip(" ·"), "ok")
    elif ev == "DockingDenied":
        reasons = {"NoSpace": pick("nessun pad libero", "no free pad"), "TooLarge": pick("nave troppo grande", "ship too large"),
                   "Hostile": pick("stazione ostile", "hostile station"),
                   "Offences": pick("hai reati in sospeso", "you have outstanding offences"),
                   "Distance": pick("troppo lontano", "too far away"), "ActiveFighter": pick("fighter in volo", "fighter deployed"),
                   "NoReason": pick("nessun motivo indicato", "no reason given")}
        r = reasons.get(e.get("Reason"), e.get("Reason") or "")
        push("docking", pick("Attracco negato", "Docking denied"), f"{station_name(e.get('StationName'), e.get('StationName_Localised')) or ''}: {r}".strip(": "), "bad")
    elif ev == "DockingTimeout":
        st_name = station_name(e.get('StationName'), e.get('StationName_Localised')) or ''
        push("docking", pick("Attracco scaduto", "Docking timed out"),
             pick(f"{st_name}: richiedi di nuovo.", f"{st_name}: request again."), "warn")
    elif ev == "Died":
        push("death", pick("Nave distrutta", "Ship destroyed"), pick("Sei stato ucciso. Ricordati del rebuy.",
                                                                    "You have been killed. Mind the rebuy."), "bad")


# --- Controlli periodici (carburante, scadenze, conto alla rovescia) --------------------

def _check_fuel():
    st = journal.read_status() or {}
    fuel = (st.get("Fuel") or {}).get("FuelMain")
    cap = STATE.cmdr.get("fuel_cap")
    cap = (cap or {}).get("Main") if isinstance(cap, dict) else cap
    flags = st.get("Flags") or 0
    if fuel is None or not cap or flags & 1 or flags & 2:   # attraccato o atterrato: niente allarmi
        return
    frac = fuel / cap
    if frac <= 0.001 and (st.get("Fuel") or {}).get("FuelReservoir", 1) < 0.05:
        if not _fuel["empty"]:
            _fuel["empty"] = True
            push("fuel", pick("Serbatoio vuoto!", "Fuel tank empty!"), pick("Il serbatoio principale è a zero.",
                                                                           "The main tank is at zero."), "bad")
    elif frac > 0.05:
        _fuel["empty"] = False
    if frac < FUEL_CRITICAL:
        if not _fuel["critical"] and not _fuel["empty"]:
            _fuel["critical"] = True
            push("fuel", pick("Carburante critico", "Fuel critical"),
                 pick(f"Restano {fuel:.1f} t ({round(frac * 100)}%). Fai rifornimento.",
                      f"{fuel:.1f} t left ({round(frac * 100)}%). Refuel."), "bad")
    elif frac > FUEL_CRITICAL + 0.05:
        _fuel["critical"] = False


def _check_missions(now):
    with STATE.lock:
        missions = list(STATE.missions.values())
    for m in missions:
        exp = _ts(m.get("expiry"))
        if exp and 0 < exp - now <= MISSION_WARN_S and m.get("id") not in _mission_warned:
            _mission_warned.add(m.get("id"))
            mins = max(1, round((exp - now) / 60))
            name = m.get('name') or pick('Missione', 'Mission')
            push("mission_expiring", pick("Missione in scadenza", "Mission expiring"),
                 pick(f"{name}: scade tra {mins} minuti.",
                      f"{name}: expires in {mins} minute{'s' if mins != 1 else ''}."), "warn")


def _check_carrier(now):
    dep = _carrier["departure"]
    if not dep:
        return
    if not _carrier["countdown_sent"] and 0 < dep - now <= COUNTDOWN_S:
        _carrier["countdown_sent"] = True
        mins = max(1, round((dep - now) / 60))
        push("carrier", pick("Fleet Carrier: partenza imminente", "Fleet Carrier: departure imminent"),
             pick(f"Salto verso {_carrier['dest']} tra {mins} minuti. Se sei a bordo, resta attraccato.",
                  f"Jump to {_carrier['dest']} in {mins} minute{'s' if mins != 1 else ''}. "
                  "If you are aboard, stay docked."), "warn")
    if now > dep:   # l'arrivo si notifica solo con l'evento CarrierJump reale (sei a bordo), niente stime
        _carrier["departure"] = None


def _loop():
    while not STATE.live:
        time.sleep(1)
    # Un salto del carrier programmato prima dell'avvio dell'app (letto dallo storico) resta da seguire.
    with STATE.lock:
        dep, dest = _ts(STATE.carrier.get("departure_time")), STATE.carrier.get("destination_system")
    if dep and dep > time.time() and not _carrier["departure"]:
        _carrier.update(departure=dep, dest=dest, countdown_sent=dep - time.time() <= COUNTDOWN_S)
    # Le missioni già vicine alla scadenza all'avvio vengono segnalate una volta sola, come le altre.
    while True:
        now = time.time()
        for fn in (_check_fuel, lambda: _check_missions(now), lambda: _check_carrier(now)):
            try:
                fn()
            except Exception as exc:
                print(f"[Notifiche] {exc!r}")
        time.sleep(3)


def start():
    global _started
    with _lock:
        if _started:
            return
        _started = True
    journal.add_listener(_on_event)
    threading.Thread(target=_loop, name="notify", daemon=True).start()


def test(body=None, q=None):
    item = push("test", pick("Notifica di prova", "Test notification"),
                pick("Se la vedi sul telefono, le notifiche funzionano.", "If you can see this on your phone, notifications work."),
                "info", force=True)
    return {"ok": True, "item": item}


def _clear(body, q):
    with _lock:
        _items.clear()
    return {"ok": True}


GET = {"/api/notify/feed": feed,
       "/api/notify/config": lambda q: public_config()}
POST = {"/api/notify/config": lambda body, q: save_config(body),
        "/api/notify/test": test,
        "/api/notify/clear": _clear}
LAN = {"/api/notify/feed"}
