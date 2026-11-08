"""Viaggi tra la Bolla e Colonia: confronto dei mezzi e viaggio a bordo di un fleet carrier.

Fonti (ricerca di novembre 2026):
- Fleet Carrier Owners Club (FCOC): la comunità vive su Discord https://discord.gg/fcoc e su https://www.reddit.com/r/FCOC
  (FAQ: https://www.reddit.com/r/FCOC/comments/wiqqrs/welcome_and_faqs). Non ha un sito ufficiale né un calendario
  pubblico leggibile da programma (niente API, JSON o fogli condivisi): i proprietari annunciano i viaggi (es. "Bubble >
  Colonia", orari UTC = orario di gioco) nel canale dei viaggi del Discord. Leggere Discord in automatico è vietato
  dalle sue regole (niente self-bot/scraping), quindi qui NON si legge nessun calendario: si aprono solo le loro pagine.
  I passaggi sono quasi sempre gratuiti; una donazione di trizio è gradita.
- Colonia Bridge: catena di ~56 megaship ferme da Alcor a Colonia (3307-3308), non un servizio di carrier.
  https://www.elitedangerous.com/news/galnet/final-week-colonia-bridge-project
- Colonia a ~22.000 al da Sol (EDSM: 22.000,47) https://www.edsm.net/en/system/id/3384966/name/Colonia
- Trizio per salto (ED-math): round(5 + d * (carico + trizio nel serbatoio + 25000) / 200000)
  https://math.edomh.nl/pages/fleet-carrier-jump/
- Tempi: 15 min di preparazione + 5 min di cooldown; dall'Update 11 (2022) Frontier aggiunge ritardi di coda casuali,
  i giocatori vedono 20-60+ min per salto. https://elite-dangerous.fandom.com/wiki/Drake-Class_Carrier
- Evento CarrierJump: scritto solo se sei in gioco e attraccato al carrier quando salta (journal v37, Update 14);
  stessi campi di Location (StarSystem, StarPos, Docked, StationName, StationType, MarketID, Body).
  https://elite-journal.readthedocs.io/
- Router Spansh: https://spansh.co.uk/fleet-carrier e https://spansh.co.uk/plotter
"""

import math
import re
import threading
import time

from . import gamedata, paths, search, spansh, storage, voice
from .journal import STATE, add_listener
from .lang import pick

TRIP_FILE = paths.user_file("colonia_trip.json")

# Coordinate fisse (EDSM): servono anche senza rete.
SOL = ("Sol", [0.0, 0.0, 0.0])
COLONIA = ("Colonia", [-9530.5, -910.28125, 19808.125])
COLONIA_RADIUS = 1500          # entro questa distanza da Colonia si è "nella regione di Colonia"
BUBBLE_RADIUS = 500            # entro questa distanza da Sol si è "nella Bolla" (in senso largo)

CARRIER_JUMP_LY = 500          # salto massimo di un fleet carrier
CARRIER_HOP_LY = 495           # distanza media usata per stimare i salti (le stelle non sono mai esattamente a 500 al)
CARRIER_HOP_MIN = 20           # 15 min di preparazione + 5 min di cooldown (minimo: la coda di Frontier può allungarlo)
NEUTRON_SEC_PER_JUMP = 75      # STIMA (non da fonte): salto + rifornimento/supercharge medio; in UI è indicata come stima

CALLSIGN = re.compile(r"^[A-Z0-9]{3}-[A-Z0-9]{3}$")

# Niente link esterni nella scheda (il programma è pubblico: i link stanno solo in "Luoghi utili").

_lock = threading.Lock()
_started = False


def _dist(a, b):
    if not a or not b or None in a or None in b:
        return None
    return math.dist(a, b)


def _now_iso():
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _ts(iso):
    try:
        return time.mktime(time.strptime(iso[:19], "%Y-%m-%dT%H:%M:%S")) - time.timezone
    except (TypeError, ValueError):
        return None


def _target_pos(name):
    if name == COLONIA[0]:
        return COLONIA[1]
    if name == SOL[0]:
        return SOL[1]
    pos = search.ensure_coords([name]).get(name)
    return pos


def where(pos):
    """Dove si trova il comandante e in che direzione conviene andare."""
    d_col, d_sol = _dist(pos, COLONIA[1]), _dist(pos, SOL[1])
    if d_col is None:
        return {"region": "unknown", "direction": "to_colonia", "destination": COLONIA[0], "d_colonia": None, "d_sol": None}
    if d_col <= COLONIA_RADIUS:
        region = "colonia"
    elif d_sol <= BUBBLE_RADIUS:
        region = "bubble"
    else:
        region = "deep"
    to_bubble = d_col < d_sol
    return {"region": region, "direction": "to_bubble" if to_bubble else "to_colonia",
            "destination": SOL[0] if to_bubble else COLONIA[0], "d_colonia": d_col, "d_sol": d_sol}


def carrier_estimate(distance, cargo=0):
    """Stima rapida senza rete. Il trizio esatto lo dà il router Spansh (dipende da massa e carico)."""
    if distance is None:
        return None
    jumps = max(1, math.ceil(distance / CARRIER_HOP_LY)) if distance > 1 else 0
    # Formula ED-math (vedi in cima): 5 + d * (carico + trizio + 25000) / 200000; qui il serbatoio è considerato
    # pieno (1000 t), quindi la stima è leggermente per eccesso.
    per_jump = 5 + CARRIER_HOP_LY * (25000 + cargo + 1000) / 200000
    return {"jumps": jumps, "tritium": math.ceil(per_jump * jumps), "minutes": jumps * CARRIER_HOP_MIN,
            "refills": max(0, math.ceil(per_jump * jumps / 1000) - 1)}


def neutron_estimate(distance, jump_range):
    """Senza rotta Spansh: con la neutron highway un salto vale circa 4 volte la gittata (supercharge),
    ma servono salti normali tra un neutrone e l'altro: in media ~2,2x (Sol-Colonia con Spansh, 42 al -> 239 salti)."""
    if distance is None or not jump_range:
        return None
    jumps = math.ceil(distance / (jump_range * 2.2))
    return {"jumps": jumps, "minutes": round(jumps * NEUTRON_SEC_PER_JUMP / 60)}


# --- Viaggio da passeggero -------------------------------------------------------------

def _load_trip():
    return storage.load_json(TRIP_FILE, {}) or {}


def _save_trip(t):
    storage.save_json(TRIP_FILE, t)


def _remaining(trip, pos):
    tpos = trip.get("target_pos")
    return _dist(pos, tpos)


def _eta(trip, remaining):
    """Minuti stimati: salti che mancano x intervallo medio osservato tra i salti (o 20 min se non ne abbiamo)."""
    if remaining is None:
        return None, None, None
    times = [_ts(j["ts"]) for j in trip.get("jumps", []) if j.get("ts")]
    times = [t for t in times if t]
    gaps = [b - a for a, b in zip(times, times[1:]) if 0 < b - a < 3 * 3600]   # pause lunghe non contano
    avg_min = (sum(gaps) / len(gaps) / 60) if gaps else CARRIER_HOP_MIN
    jumps_left = math.ceil(remaining / CARRIER_HOP_LY) if remaining > 25 else 0
    return jumps_left, round(jumps_left * avg_min), round(avg_min, 1)


def trip_view():
    t = _load_trip()
    if not t:
        return None
    pos = STATE.location.get("star_pos")
    rem = _remaining(t, pos) if t.get("active") else t.get("remaining")
    jl, eta, avg = _eta(t, rem)
    total = t.get("total_ly")
    return {**t, "remaining": rem, "jumps_left": jl, "eta_min": eta, "avg_gap_min": avg,
            "jumps_done": len(t.get("jumps", [])),
            "pct": round(max(0, min(100, (1 - rem / total) * 100)), 1) if rem is not None and total else None}


def start_trip(destination=None, carrier=None, auto=False):
    pos = STATE.location.get("star_pos")
    dest = (destination or where(pos)["destination"]).strip()
    tpos = _target_pos(dest)
    if not tpos:
        raise ValueError(pick(f"Coordinate di {dest} non trovate nei dati online: controlla il nome del sistema",
                             f"Coordinates of {dest} not found in the online data: check the system name"))
    total = _dist(pos, tpos)
    t = {"active": True, "auto": auto, "destination": dest, "target_pos": tpos, "start_system": STATE.location.get("system"),
         "start_pos": pos, "started": _now_iso(), "total_ly": total, "carrier": carrier or _carrier_here(),
         "jumps": [], "aboard": bool(_carrier_here())}
    _save_trip(t)
    return trip_view()


def stop_trip():
    t = _load_trip()
    if t:
        t["active"] = False
        t["remaining"] = _remaining(t, STATE.location.get("star_pos"))
        t["ended"] = _now_iso()
        _save_trip(t)
    return trip_view()


def clear_trip():
    _save_trip({})
    return None


def _carrier_here():
    """Se sei attraccato a un fleet carrier: il suo callsign (il nome della 'stazione' di un carrier è il callsign)."""
    st = STATE.location.get("station") or ""
    if STATE.location.get("docked") and CALLSIGN.match(st):
        return {"callsign": st, "name": _CARRIER_NAMES.get(st)}
    return None


_CARRIER_NAMES = {}   # callsign -> nome visualizzato, se il journal lo dice


def _announce(text, spoken=None):
    with STATE.lock:
        STATE.note(_now_iso(), text, "gold")
    try:
        if voice.load_config().get("enabled"):
            voice.say(spoken or text)
    except Exception as exc:
        print(f"[Colonia] voce non disponibile: {exc}")


def _fmt_ly(v):
    return f"{round(v):,}".replace(",", ".")


def _on_event(e):
    ev = e.get("event")
    if ev in ("Docked", "Location") and e.get("StationType") == "FleetCarrier" and (ev == "Docked" or e.get("Docked")):
        cs = e.get("StationName")
        name = e.get("StationName_Localised")
        if name and name != cs:
            _CARRIER_NAMES[cs] = name
        t = _load_trip()
        if t.get("active"):
            t["aboard"] = True
            t["carrier"] = {"callsign": cs, "name": _CARRIER_NAMES.get(cs)}
            _save_trip(t)
        elif _is_bubble_colonia_leg():
            # Attraccato a un carrier lontano dalla meta: prepara il viaggio (si può annullare dalla scheda).
            start_trip(carrier={"callsign": cs, "name": _CARRIER_NAMES.get(cs)}, auto=True)
    elif ev == "Undocked":
        t = _load_trip()
        if t.get("active") and t.get("aboard"):
            if t.get("auto") and not t.get("jumps"):
                clear_trip()   # eri solo passato dal carrier: niente viaggio
                return
            t["aboard"] = False
            rem = _remaining(t, STATE.location.get("star_pos"))
            _save_trip(t)
            if rem is not None and rem < 1000:
                stop_trip()
    elif ev == "CarrierJump" and e.get("Docked"):
        t = _load_trip()
        if not t.get("active"):
            return
        pos = e.get("StarPos")
        rem = _dist(pos, t.get("target_pos"))
        t.setdefault("jumps", []).append({"system": e.get("StarSystem"), "ts": e.get("timestamp") or _now_iso(),
                                          "remaining": rem})
        t["aboard"] = True
        _save_trip(t)
        dest = t["destination"]
        if rem is not None and rem < 25:
            text = pick(f"Carrier arrivato a {e.get('StarSystem')}: sei a destinazione ({dest}).",
                        f"Carrier arrived at {e.get('StarSystem')}: you've reached your destination ({dest}).")
            _announce(text, pick(f"Il carrier è arrivato a {e.get('StarSystem')}. Sei a destinazione, {dest}.",
                                 f"The carrier has arrived at {e.get('StarSystem')}. You've reached your destination, {dest}."))
            stop_trip()
            return
        jl, eta, _avg = _eta(t, rem)
        tail = (pick(f", circa {jl} {'salto' if jl == 1 else 'salti'}", f", about {jl} {'jump' if jl == 1 else 'jumps'}")
                + (pick(f" e {_spoken_time(eta)}", f" and {_spoken_time(eta)}") if eta else "")) if jl else ""
        _announce(pick(f"Carrier a {e.get('StarSystem')} · mancano {_fmt_ly(rem)} al a {dest}{tail}",
                       f"Carrier at {e.get('StarSystem')} · {_fmt_ly(rem)} ly to {dest}{tail}"),
                  pick(f"Il carrier è arrivato a {e.get('StarSystem')}, mancano {_fmt_ly(rem)} anni luce a {dest}{tail}.",
                       f"The carrier has arrived at {e.get('StarSystem')}, {round(rem):,} light years to {dest}{tail}."))


def _spoken_time(minutes):
    h, m = divmod(int(minutes), 60)
    parts = (([pick(f"{h} {'ora' if h == 1 else 'ore'}", f"{h} {'hour' if h == 1 else 'hours'}")] if h else [])
             + ([pick(f"{m} {'minuto' if m == 1 else 'minuti'}", f"{m} {'minute' if m == 1 else 'minutes'}")] if m else []))
    return pick(" e ", " and ").join(parts) or pick("pochi minuti", "a few minutes")


def _is_bubble_colonia_leg():
    """Vero se sei nella Bolla o nella regione di Colonia (da lì un carrier probabilmente fa la tratta)."""
    w = where(STATE.location.get("star_pos"))
    return w["region"] in ("bubble", "colonia")


def start():
    global _started
    with _lock:
        if _started:
            return
        _started = True
    add_listener(_on_event)


# --- API -------------------------------------------------------------------------------

def _engineers_colonia():
    co = search.coords()
    out = []
    for name, (system, base, kind, spec) in gamedata.ENGINEERS.items():
        d = _dist(co.get(system), COLONIA[1])
        if d is not None and d <= COLONIA_RADIUS:
            out.append({"name": name, "system": system, "base": base, "kind": kind, "spec": spec, "d_colonia": d})
    return sorted(out, key=lambda x: (x["kind"], x["d_colonia"]))


def status(q=None):
    loc = STATE.location
    pos = loc.get("star_pos")
    w = where(pos)
    want = (q or {}).get("dest")
    if want in (COLONIA[0], SOL[0]):          # direzione scelta a mano nella scheda
        w = {**w, "destination": want, "direction": "to_colonia" if want == COLONIA[0] else "to_bubble", "manual": True}
    target = COLONIA if w["destination"] == COLONIA[0] else SOL
    distance = _dist(pos, target[1])
    cargo = int(STATE.carrier.get("space_usage", {}).get("Cargo") or 0) if isinstance(STATE.carrier.get("space_usage"), dict) else 0
    c = STATE.carrier
    own = bool(c.get("callsign") or c.get("carrier_id"))
    own_carrier = None
    if own:
        cpos = search.ensure_coords([c["system"]]).get(c["system"]) if c.get("system") else None
        cd = _dist(cpos, target[1])
        own_carrier = {"name": c.get("name"), "callsign": c.get("callsign"), "system": c.get("system"),
                       "fuel": c.get("fuel"), "distance": cd, "estimate": carrier_estimate(cd, cargo),
                       "docking_access": c.get("docking_access")}
    return {
        "system": loc.get("system"), "pos": pos, **w,
        "distance": distance, "jump_range": STATE.ship.get("jump_range"), "ship": STATE.ship.get("type"),
        "neutron_estimate": neutron_estimate(distance, STATE.ship.get("jump_range")),
        "carrier_estimate": carrier_estimate(distance),
        "carrier_here": _carrier_here(), "own_carrier": own_carrier,
        "trip": trip_view(), "engineers": _engineers_colonia(),
        "colonia_to_sol": _dist(COLONIA[1], SOL[1]),
        "facts": {"carrier_jump_ly": CARRIER_JUMP_LY, "carrier_hop_min": CARRIER_HOP_MIN},
    }


def plan(body, q):
    """Calcola su Spansh la rotta neutron (nave) o la rotta del fleet carrier, senza toccare la rotta attiva
    (a meno che save sia vero)."""
    b = body or {}
    tool = b.get("tool") if b.get("tool") in ("neutron", "carrier") else "neutron"
    pos = STATE.location.get("star_pos")
    src = (b.get("from") or STATE.location.get("system") or "").strip()
    dst = (b.get("to") or where(pos)["destination"]).strip()
    ctx = {"system": STATE.location.get("system"), "jump_range": STATE.ship.get("jump_range")}
    params = {"from": src, "to": dst}
    if tool == "neutron":
        params.update(range=b.get("range") or ctx["jump_range"] or 30, efficiency=b.get("efficiency") or 60)
    else:
        params.update(capacity_used=b.get("capacity_used") or 0)
    route = spansh.plot(tool, params, ctx)
    if b.get("save"):
        storage.save_json(search.ROUTE_FILE, route)
    jumps = route.get("jumps") or []
    out = {"tool": tool, "from": route.get("from"), "to": route.get("to"), "distance": route.get("distance"),
           "saved": bool(b.get("save"))}
    if tool == "neutron":
        total = route.get("total_jumps") or 0
        out.update(jumps=total, waypoints=len(jumps), neutrons=sum(1 for j in jumps if j.get("neutron")),
                   minutes=round(total * NEUTRON_SEC_PER_JUMP / 60), range=route.get("range"))
    else:
        hops = max(0, len(jumps) - 1)
        out.update(jumps=hops, tritium=route.get("tritium"), minutes=hops * CARRIER_HOP_MIN,
                   restock=[j["system"] for j in jumps if j.get("restock")],
                   hops=[{"system": j["system"], "distance": j.get("distance_jumped"), "tritium": j.get("tritium_used"),
                          "fuel": j.get("fuel"), "icy": j.get("icy_ring")} for j in jumps])
    return out


def trip(body, q):
    b = body or {}
    action = b.get("action")
    if action == "start":
        return {"trip": start_trip(b.get("destination"))}
    if action == "stop":
        return {"trip": stop_trip()}
    if action == "clear":
        return {"trip": clear_trip()}
    raise ValueError(pick("Azione non valida", "Invalid action"))


# API registrate dal server (stesse firme di server.GET / server.POST).
GET = {"/api/colonia/status": status}
POST = {"/api/colonia/plan": plan, "/api/colonia/trip": trip}
# Percorsi che il companion sul telefono può usare.
LAN = {"/api/colonia/status"}
