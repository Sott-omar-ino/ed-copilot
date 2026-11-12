"""Colonizzazione: sistemi candidati, verifica di un sistema, fornitori dei materiali da costruzione.

Regole verificabili dai dati pubblici (Spansh):
- il sistema deve essere disabitato e senza stazioni;
- non deve richiedere un permesso;
- deve trovarsi entro 15 anni luce da un sistema abitato (regola di gioco per avviare una colonia: portata da 10 a
  15 al durante la beta di System Colonisation, thread Frontier "System Colonisation Beta Details & Feedback",
  forums.frontier.co.uk/threads/634055; la rivendicazione si fa dal Colonisation Contact, pagina Frontier
  "Elite Dangerous: Trailblazers – Available Now", update 4.1.0.0).
Che il sistema non sia già stato rivendicato da un altro giocatore si vede solo in gioco.
Non c'è un numero minimo di corpi per tipo di stazione verificato su una fonte: i candidati non vengono filtrati così.
"""

import concurrent.futures
import threading
import time

from . import lang, search
from .lang import pick, pick_d
from .spansh import http_json

MAX_COLONY_RANGE = 15.0
SYSTEMS_URL = "https://spansh.co.uk/api/systems/search"

STATION_TYPES = {
    "coriolis": {"it": "Spazioporto Coriolis", "en": "Coriolis Starport"},
    "orbis": {"it": "Spazioporto Orbis / Ocellus", "en": "Orbis / Ocellus Starport"},
    "ocellus": {"it": "Spazioporto Orbis / Ocellus", "en": "Orbis / Ocellus Starport"},
    "asteroid": {"it": "Base asteroidale", "en": "Asteroid Base"},
    "outpost": {"it": "Avamposto orbitale", "en": "Orbital Outpost"},
    "surface": {"it": "Avamposto planetario", "en": "Planetary Outpost"},
}

_verify_cache, _suppliers_cache = {}, {}
_lock = threading.Lock()


def _cached(cache, key):
    with _lock:
        hit = cache.get(key)
        return hit[0] if hit and time.time() < hit[1] else None


def _store(cache, key, value, ttl):
    with _lock:
        cache[key] = (value, time.time() + ttl)
        if len(cache) > 300:
            for k in sorted(cache, key=lambda k: cache[k][1])[:100]:
                cache.pop(k, None)


def candidates(ref="Sol", station_type="coriolis", limit=12, radius=40):
    """Sistemi disabitati vicini, già filtrati sulla regola dei 15 al."""
    st = station_type if station_type in STATION_TYPES else "coriolis"
    label = pick_d(STATION_TYPES[st])
    payload = {"filters": {"population": {"value": [0, 0], "comparison": "<=>"},
                           "distance": {"min": "0", "max": str(radius)}},
               "sort": [{"distance": {"direction": "asc"}}], "size": 60, "page": 0, "reference_system": ref}
    try:
        res = http_json(SYSTEMS_URL, payload, timeout=40)
    except Exception as exc:
        msg = (pick("Servizio di ricerca non raggiungibile: riprova tra poco", "Search service unreachable: try again shortly")
               if not getattr(exc, "code", None) == 400
               else pick(f"Sistema «{ref}» non trovato: controlla il nome", f"System «{ref}» not found: check the name"))
        return {"reference": ref, "station_type": st, "station_label": label, "candidates": [], "error": msg}
    out = []
    for s in res.get("results", []):
        near = s.get("nearest_populated_distance")
        if s.get("needs_permit") or s.get("stations") or near is None or near > MAX_COLONY_RANGE:
            continue
        out.append({"name": s.get("name"), "distance": round(s.get("distance", 0), 1), "body_count": s.get("body_count", 0),
                    "nearest_populated": round(near, 1), "needs_permit": False})
        if len(out) >= limit:
            break
    return {"reference": ref, "station_type": st, "station_label": label, "candidates": out,
            "note": pick(f"Sistemi disabitati entro {radius:g} al da {ref} e a meno di {MAX_COLONY_RANGE:g} al da un sistema abitato.",
                         f"Unpopulated systems within {radius:g} ly of {ref} and less than {MAX_COLONY_RANGE:g} ly from a populated system.")}


def _check(id_, title, ok, val, desc, required=True):
    return {"id": id_, "title": title, "ok": ok, "val": val, "desc": desc, "required": required}


def verify(name, ref="Sol", station_type="coriolis"):
    name = (name or "").strip()
    if not name:
        return {"found": False, "error": pick("Nome del sistema non specificato.", "System name not specified.")}
    key = (name.lower(), (ref or "Sol").lower(), station_type, lang.current())  # i testi dipendono dalla lingua
    hit = _cached(_verify_cache, key)
    if hit:
        return hit
    try:
        res = http_json(SYSTEMS_URL, {"filters": {"name": {"value": name}}, "reference_system": ref or "Sol",
                                      "size": 10, "page": 0}, timeout=30)
    except Exception as exc:
        return {"found": False, "error": pick("Servizio di ricerca non raggiungibile: riprova tra poco", "Search service unreachable: try again shortly")}
    s = next((r for r in res.get("results", []) if (r.get("name") or "").lower() == name.lower()), None)
    if not s:
        data = {"found": False, "error": pick(f"Il sistema «{name}» non risulta nei dati online.", f"System «{name}» isn't in the online data.")}
        _store(_verify_cache, key, data, 300)
        return data

    pop = s.get("population") or 0
    permit = bool(s.get("needs_permit"))
    npc = [st["name"] for st in s.get("stations") or [] if st.get("type") != "Drake-Class Carrier"]
    bodies = s.get("bodies") or []
    planets = [b for b in bodies if b.get("type") == "Planet"]
    near = s.get("nearest_populated_distance")
    thargoid = s.get("thargoid_war_state") not in (None, "", "None")

    checks = [
        _check("pop", pick("Popolazione", "Population"), pop == 0,
               pick("Disabitato", "Unpopulated") if pop == 0 else pick(f"{pop:,} abitanti".replace(",", "."), f"{pop:,} inhabitants".replace(",", ".")),
               pick("Si possono colonizzare solo sistemi senza popolazione.", "Only systems with no population can be colonised.")),
        _check("permit", pick("Permesso", "Permit"), not permit,
               pick("Accesso libero", "Open access") if not permit else pick("Serve un permesso", "Permit required"),
               pick("I sistemi con permesso non si possono colonizzare.", "Permit-locked systems can't be colonised.")),
        _check("stations", pick("Stazioni esistenti", "Existing stations"), not npc,
               pick("Nessuna", "None") if not npc else f"{len(npc)}: {', '.join(npc[:3])}",
               pick("Il sistema non deve avere già stazioni o insediamenti.", "The system must not already have stations or settlements.")),
        _check("range", pick("Distanza da un sistema abitato", "Distance from a populated system"), near is not None and near <= MAX_COLONY_RANGE,
               pick(f"{near:.1f} al", f"{near:.1f} ly") if near is not None else pick("sconosciuta", "unknown"),
               pick(f"Per avviare una colonia il sistema deve essere entro {MAX_COLONY_RANGE:g} al da un sistema abitato.",
                    f"To start a colony the system must be within {MAX_COLONY_RANGE:g} ly of a populated system.")),
        _check("bodies", pick("Corpi celesti", "Bodies"), bool(planets),
               pick(f"{len(planets)} pianeti, {len(bodies)} corpi in totale", f"{len(planets)} planets, {len(bodies)} bodies in total"),
               pick("Informativo: più corpi significano più spazio per costruire.", "Info only: more bodies mean more room to build."), required=False),
        _check("thargoid", "Thargoid", not thargoid,
               pick("Nessuna attività", "No activity") if not thargoid else str(s.get("thargoid_war_state")),
               pick("Informativo: stato della guerra Thargoid nel sistema.", "Info only: Thargoid war state in the system."), required=False),
    ]
    eligible = all(c["ok"] for c in checks if c["required"])
    data = {
        "found": True, "name": s.get("name"), "distance": round(s.get("distance") or 0, 1), "reference": ref,
        "nearest_populated": round(near, 1) if near is not None else None,
        "body_count": s.get("body_count", len(bodies)), "planets_count": len(planets),
        "stars_count": sum(1 for b in bodies if b.get("type") == "Star"),
        "bodies_list": [{"name": b.get("name"), "type": b.get("subtype") or b.get("type"),
                         "dist_ls": round(b.get("distance_to_arrival") or 0)} for b in planets][:15],
        "eligible": eligible,
        "status_title": pick("IDONEO SECONDO I DATI DISPONIBILI", "ELIGIBLE BASED ON AVAILABLE DATA") if eligible
                        else pick("NON IDONEO", "NOT ELIGIBLE"),
        "status_label": pick("Rispetta i requisiti verificabili. Controlla in gioco, dal menu di colonizzazione, "
                             "che nessuno l'abbia già rivendicato.",
                             "Meets the checkable requirements. Check in game, from the colonisation menu, "
                             "that nobody has already claimed it.") if eligible else
                        pick("Almeno un requisito obbligatorio non è soddisfatto (vedi sotto).",
                             "At least one mandatory requirement isn't met (see below)."),
        "checks": checks,
    }
    _store(_verify_cache, key, data, 600)
    return data


def suppliers(ref="Sol", commodities=None, min_qty=50):
    """Per ogni merce, la stazione con pad grande più vicina che la vende."""
    ref = (ref or "Sol").strip()
    results, needed = {}, []
    for c in commodities or []:
        c = c.strip()
        hit = _cached(_suppliers_cache, (ref.lower(), c.lower()))
        if hit:
            results[c] = hit
        elif c:
            needed.append(c)

    def fetch(comm):
        variants = [comm, comm[:-1] if comm.endswith("s") else comm + "s"]
        for variant in variants:
            try:
                r = search.stations({"mode": "buy", "commodity": variant, "reference": ref, "large_pad": True,
                                     "min_qty": min_qty, "no_carriers": True})
            except Exception:
                return comm, None  # errore di rete: non lo mettiamo in cache
            best = (r.get("results") or [None])[0]
            if best:
                return comm, {"commodity": comm, "found": True, "system": best.get("system"), "station": best.get("station"),
                              "distance": round(best.get("distance") or 0, 1), "dist_ls": round(best.get("dist_ls") or 0),
                              "large_pad": best.get("large_pad", True), "planetary": best.get("planetary", False),
                              "buy": best.get("buy"), "supply": best.get("supply")}
        return comm, {"commodity": comm, "found": False}

    if needed:
        with concurrent.futures.ThreadPoolExecutor(max_workers=min(6, len(needed))) as ex:
            for comm, item in ex.map(fetch, needed):
                if item is None:
                    results[comm] = {"commodity": comm, "found": False, "error": "rete"}
                    continue
                _store(_suppliers_cache, (ref.lower(), comm.lower()), item, 900)
                results[comm] = item
    return results


DUMP_URL = "https://spansh.co.uk/api/dump/{}"
_bodies_cache = {}


def system_bodies(name):
    """Corpi di un sistema per il piano di colonizzazione (Spansh: ricerca del sistema, poi /api/dump/<id64>).
    Campi del dump (bodyId, name, type, subType, isLandable, distanceToArrival, rings, stations) verificati su una
    risposta reale il 12/11/2026."""
    name = (name or "").strip()
    if not name:
        return {"error": pick("Indica il sistema", "Enter the system")}
    hit = _cached(_bodies_cache, name.lower())
    if hit:
        return hit
    try:
        res = http_json(SYSTEMS_URL, {"filters": {"name": {"value": name}}, "size": 1}, timeout=30)
        found = (res.get("results") or [None])[0]
        if not found or found.get("name", "").lower() != name.lower():
            return {"system": name, "bodies": [], "error": pick(f"Sistema «{name}» non trovato su Spansh", f"System «{name}» not found on Spansh")}
        dump = http_json(DUMP_URL.format(found["id64"]), timeout=40).get("system") or {}
    except Exception:
        return {"system": name, "bodies": [], "error": pick("Spansh non raggiungibile: riprova tra poco", "Spansh unreachable: try again shortly")}
    sys_name = dump.get("name") or found.get("name")
    bodies = []
    for b in dump.get("bodies") or []:
        if b.get("type") == "Barycentre":
            continue
        full = b.get("name") or ""
        short = full[len(sys_name):].strip() if full.lower().startswith(sys_name.lower()) else full
        bodies.append({"id": b.get("bodyId"), "name": short or full, "type": b.get("type"), "subtype": b.get("subType"),
                       "landable": bool(b.get("isLandable")), "dist_ls": b.get("distanceToArrival"),
                       "rings": len(b.get("rings") or []), "stations": len(b.get("stations") or [])})
    data = {"system": sys_name, "id64": found["id64"], "population": dump.get("population") or 0,
            "stations": [{"name": s.get("name"), "type": s.get("type")} for s in dump.get("stations") or []], "bodies": bodies}
    _store(_bodies_cache, name.lower(), data, 600)
    return data
