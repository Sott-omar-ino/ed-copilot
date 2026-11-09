"""Ricerche online: stazioni e mercati (Spansh), rotte, hotspot, coordinate (EDSM), obiettivi della comunità."""

import json
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from . import gamedata, paths, spansh, storage
from .journal import STATE
from .lang import pick
from .spansh import http_json

ROUTE_FILE = paths.user_file("route.json")
COORDS_FILE = paths.cache_file("coords.json")
COORDS = {}
COORDS_LOCK = threading.Lock()

NON_CARRIER_TYPES = ["Coriolis Starport", "Orbis Starport", "Ocellus Starport", "Asteroid base",
                     "Outpost", "Planetary Outpost", "Planetary Port", "Settlement", "Mega ship",
                     "Dodec Starport", "Space Construction Depot", "Planetary Construction Depot"]

CARRIER_TYPE = "Drake-Class Carrier"
CALLSIGN_RE = re.compile(r"^[A-Z0-9]{3}-[A-Z0-9]{3}$")


def callsign(text):
    """'k3n 98f', 'K3N-98F', 'k 3 n 9 8 f' -> 'K3N-98F' (codice di un fleet carrier), altrimenti None."""
    raw = re.sub(r"[^A-Za-z0-9]", "", str(text or "")).upper()
    return f"{raw[:3]}-{raw[3:]}" if len(raw) == 6 and re.search(r"\d", raw) else None


def _recent(days):
    """Filtro "visto negli ultimi N giorni": la posizione di un carrier è quella dell'ultimo dato ricevuto."""
    now = time.time()
    fmt = "%Y-%m-%dT%H:%M:%SZ"
    return {"comparison": "<=>", "value": [time.strftime(fmt, time.gmtime(now - days * 86400)),
                                           time.strftime(fmt, time.gmtime(now + 86400))]}


# Nomi delle merci scritti in modi diversi -> nome usato da Spansh.
COMMODITY_ALIASES = {
    "cmm composites": "CMM Composite", "cmm composite": "CMM Composite", "liquid oxygen": "Liquid oxygen",
    "micro-controllers": "Micro Controllers", "micro controllers": "Micro Controllers",
    "micro-controller": "Micro Controllers", "micro controller": "Micro Controllers",
    "meta alloys": "Meta-Alloys", "metaalloys": "Meta-Alloys", "meta-alloys": "Meta-Alloys",
    "cooling hoses": "Micro-Weave Cooling Hoses", "micro-weave cooling hoses": "Micro-Weave Cooling Hoses",
    "micro weave cooling hoses": "Micro-Weave Cooling Hoses",
}

# Correzioni a dati sbagliati della comunità, verificate in gioco: (stazione, sistema) -> campi corretti.
KNOWN_FIXES = {("Wellington Vision", "ICZ HW-V b2-0"): {"technology_broker": "Human"},
               # Spansh lo dà Guardian; in gioco il 09/11/2026 non lo è (il journal Docked ha "techBroker").
               ("Shaw Vista", "Col 285 Sector GL-U b17-8"): {"technology_broker": "Human"}}


def _search_json(url, payload, ref):
    """Ricerca in background con messaggi d'errore senza nomi di servizi esterni (il programma è pubblico)."""
    try:
        return http_json(url, payload)
    except urllib.error.HTTPError as exc:
        if exc.code == 400:
            raise ValueError(pick(f"Sistema «{ref}» non trovato: controlla il nome", f"System «{ref}» not found: check the name")) from None
        raise ValueError(pick("Il servizio di ricerca ha risposto con un errore: riprova tra poco", "The search service returned an error: try again shortly")) from None
    except (urllib.error.URLError, OSError):
        raise ValueError(pick("Servizio di ricerca non raggiungibile: controlla la connessione e riprova", "Search service unreachable: check your connection and try again")) from None


def current_system(default="Sol"):
    return STATE.location.get("system") or default


def stations(q):
    """Traduce una ricerca semplice dell'interfaccia in una query Spansh /api/stations/search."""
    mode = q.get("mode")
    ref = (q.get("reference") or current_system()).strip()
    filters, sort = {}, [{"distance": {"direction": "asc"}}]
    commodity = (q.get("commodity") or "").strip()
    commodity = COMMODITY_ALIASES.get(commodity.lower(), commodity)

    if mode == "service":
        filters["services"] = [{"name": q.get("service")}]
        if q.get("trader"):
            filters["material_trader"] = {"value": [q["trader"]]}
        if q.get("broker"):
            filters["technology_broker"] = {"value": [q["broker"]]}
    elif mode in ("buy", "sell"):
        if not commodity:
            raise ValueError(pick("Specifica una merce", "Specify a commodity"))
        field = "supply" if mode == "buy" else "demand"
        filters["market"] = [{"name": commodity, field: {
            "value": [str(int(q.get("min_qty") or 1)), "999999999"], "comparison": "<=>"}}]
        if q.get("sort") == "price":
            key = "market_buy_price" if mode == "buy" else "market_sell_price"
            sort = [{key: [{"name": commodity, "direction": "asc" if mode == "buy" else "desc"}]}]
    elif mode == "ship":
        filters["ships"] = {"value": [q.get("ship")]}
    elif mode == "carrier":
        # Fleet carrier: per vicinanza, per servizio, per codice (XXX-XXX) o per nome; solo quelli visti di recente.
        filters["type"] = {"value": [CARRIER_TYPE]}
        name = (q.get("name") or "").strip()
        if name:
            cs = callsign(name)
            filters["name" if cs else "carrier_name"] = {"value": [cs or name.upper()]}
        if q.get("service"):
            filters["services"] = [{"name": q.get("service")}]
        days = int(q.get("max_age_days") or (0 if name else 7))
        if days > 0:
            filters["updated_at"] = _recent(days)
    elif mode == "module":
        mod = {"name": [q.get("module")]}
        if q.get("cls"):
            mod["class"] = [str(q["cls"])]
        if q.get("rating"):
            mod["rating"] = [q["rating"]]
        filters["modules"] = [mod]
    else:
        raise ValueError(pick("Ricerca non valida", "Invalid search"))

    if q.get("large_pad"):
        filters["has_large_pad"] = {"value": True}
    if q.get("max_dist"):
        filters["distance"] = {"min": "0", "max": str(float(q["max_dist"]))}
    if q.get("no_carriers", True) and mode != "carrier":
        filters["type"] = {"value": NON_CARRIER_TYPES}

    # Con il montaggio il filtro finale è nostro: si chiedono più stazioni per averne abbastanza dopo il controllo.
    size = 60 if mode == "module" and q.get("mount") else 25
    res = _search_json("https://spansh.co.uk/api/stations/search", {
        "filters": filters, "sort": sort, "size": size, "page": 0, "reference_system": ref}, ref)
    if res.get("error"):
        raise ValueError(res["error"])

    out = []
    for r in res.get("results", []):
        item = {
            "station": r.get("name"), "system": r.get("system_name"), "type": r.get("type"),
            "distance": r.get("distance"), "dist_ls": r.get("distance_to_arrival"),
            "large_pad": r.get("has_large_pad"), "medium_pad": (r.get("medium_pads") or 0) > 0,
            "planetary": r.get("is_planetary"), "updated": (r.get("updated_at") if mode == "carrier" else r.get("market_updated_at") or r.get("updated_at")),
            "material_trader": r.get("material_trader"), "technology_broker": r.get("technology_broker"),
            "power": r.get("system_power"), "allegiance": r.get("allegiance"),
            "carrier_name": r.get("carrier_name"), "market_id": r.get("market_id"),
            "pads": [r.get("large_pads") or 0, r.get("medium_pads") or 0, r.get("small_pads") or 0],
            "services": [x.get("name") for x in (r.get("services") or []) if x.get("name")] if mode == "carrier" else None,
        }
        item.update(KNOWN_FIXES.get((item["station"], item["system"]), {}))
        if q.get("broker") and item.get("technology_broker") != q.get("broker"):
            continue
        if mode in ("buy", "sell"):
            for m in r.get("market", []):
                if m.get("commodity", "").lower() == commodity.lower():
                    item.update(buy=m.get("buy_price"), sell=m.get("sell_price"),
                                supply=m.get("supply"), demand=m.get("demand"))
        elif mode == "ship":
            for s in r.get("ships", []):
                if s.get("name") == q.get("ship"):
                    item["price"] = s.get("price")
        elif mode == "module":
            # Il servizio di ricerca filtra per nome, classe e rating ma non per montaggio (weapon_mode): il controllo
            # completo si fa qui sui moduli in vendita, e si mostra il prezzo di quello che corrisponde.
            want_cls, want_rat, want_mount = str(q.get("cls") or ""), (q.get("rating") or ""), (q.get("mount") or "")
            match = [m for m in r.get("modules", []) if m.get("name") == q.get("module")
                     and (not want_cls or str(m.get("class")) == want_cls) and (not want_rat or m.get("rating") == want_rat)
                     and (not want_mount or m.get("weapon_mode") == want_mount)]
            if not match:
                continue
            m = min(match, key=lambda x: x.get("price") or 0)
            item.update(price=m.get("price"), module=f"{m.get('class')}{m.get('rating')} {m.get('name')}"
                        + (f" ({m.get('weapon_mode')})" if m.get("weapon_mode") else ""))
        out.append(item)
    _add_bodies(out)
    return {"reference": res.get("reference"), "count": res.get("count"), "results": out}


_station_cache = {}  # market_id -> (quando, dettagli del corpo)


def _station_body(market_id):
    """Pianeta, gravità e coordinate di una stazione di superficie: l'elenco della ricerca non li contiene,
    il dettaglio della singola stazione sì (cache di un giorno)."""
    hit = _station_cache.get(market_id)
    if hit and time.time() - hit[0] < 86400:
        return hit[1]
    req = urllib.request.Request(f"https://spansh.co.uk/api/station/{int(market_id)}",
                                 headers={"User-Agent": spansh.USER_AGENT})
    with urllib.request.urlopen(req, timeout=15) as r:
        rec = (json.loads(r.read().decode("utf-8")) or {}).get("record") or {}
    info = {"body": rec.get("body_name"), "gravity": rec.get("body_gravity"),
            "lat": rec.get("latitude"), "lon": rec.get("longitude")}
    _station_cache[market_id] = (time.time(), info)
    return info


def _add_bodies(items, limit=12):
    """Aggiunge il pianeta alle prime stazioni di superficie dei risultati (richieste in parallelo)."""
    todo = [it for it in items if it.get("planetary") and it.get("market_id")][:limit]
    if not todo:
        return
    from concurrent.futures import ThreadPoolExecutor

    def one(it):
        try:
            it.update(_station_body(it["market_id"]))
        except Exception:
            pass
    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(one, todo))


def trade_route(q):
    system = (q.get("system") or STATE.location.get("system") or "").strip()
    docked_at = STATE.location.get("station") if STATE.location.get("docked") else ""
    station = (q.get("station") or docked_at or "").strip()
    if not system or not station:
        raise ValueError(pick("Serve una stazione di partenza: attraccati o scrivila nel modulo", "A starting station is needed: dock or enter it in the form"))
    params = {
        "max_hops": int(q.get("hops") or 4),
        "max_hop_distance": float(q.get("hop_distance") or STATE.ship.get("jump_range") or 20),
        "system": system, "station": station,
        "starting_capital": int(float(q.get("capital") or STATE.cmdr.get("credits") or 1000000)),
        "max_cargo": int(q.get("cargo") or STATE.ship.get("cargo") or 100),
        "max_system_distance": int(q.get("max_ls") or 5000),
        "requires_large_pad": 1 if q.get("large_pad") else 0, "allow_prohibited": 0,
        "allow_planetary": 1 if q.get("planetary", True) else 0, "allow_player_owned": 1 if q.get("carriers") else 0,
        "unique": 0, "permit": 0, "max_price_age": int(q.get("max_age_h") or 48) * 3600,
    }
    hops = spansh.job("trade/route", params)
    return {"params": params, "hops": [{
        "from_system": h["source"]["system"], "from_station": h["source"]["station"],
        "to_system": h["destination"]["system"], "to_station": h["destination"]["station"],
        "to_ls": h["destination"].get("distance_to_arrival"), "distance": h.get("distance"),
        "profit": h.get("total_profit"), "cumulative": h.get("cumulative_profit"),
        "updated": h["destination"].get("market_updated_at"),
        "commodities": [{"name": c["name"], "amount": c["amount"], "profit": c["profit"], "total": c["total_profit"],
                         "buy": c["source_commodity"]["buy_price"], "sell": c["destination_commodity"]["sell_price"]}
                        for c in h.get("commodities", [])],
    } for h in hops or []]}


def hotspots(q):
    commodity = (q.get("commodity") or "Painite").strip()
    ref = (q.get("reference") or current_system()).strip()
    filters = {"ring_signals": [{"name": commodity, "value": [str(int(q.get("min_count") or 1)), "99"],
                                 "comparison": "<=>"}]}
    if q.get("max_dist"):
        filters["distance"] = {"min": "0", "max": str(float(q["max_dist"]))}
    res = _search_json("https://spansh.co.uk/api/bodies/search", {
        "filters": filters, "sort": [{"distance": {"direction": "asc"}}], "size": 25, "page": 0,
        "reference_system": ref}, ref)
    if res.get("error"):
        raise ValueError(res["error"])
    out = []
    for b in res.get("results", []):
        for ring in b.get("rings") or []:
            sig = {x["name"]: x["count"] for x in ring.get("signals") or []}
            if commodity in sig:
                out.append({"system": b.get("system_name"), "body": b.get("name"), "ring": ring.get("name"),
                            "type": ring.get("type"), "count": sig[commodity], "signals": sig,
                            "distance": b.get("distance"), "dist_ls": b.get("distance_to_arrival"),
                            "reserve": b.get("reserve_level"), "updated": ring.get("signals_updated_at")})
    return {"reference": res.get("reference"), "commodity": commodity, "results": out}


# --- Rotta attiva ---------------------------------------------------------------

def plot_route(tool, q):
    ctx = {"system": STATE.location.get("system"), "jump_range": STATE.ship.get("jump_range")}
    route = spansh.plot(tool, q or {}, ctx)
    storage.save_json(ROUTE_FILE, route)
    return route


def load_route():
    return storage.load_json(ROUTE_FILE)


def clear_route():
    if os.path.exists(ROUTE_FILE):
        os.remove(ROUTE_FILE)


# --- Coordinate di ingegneri e luoghi (EDSM) --------------------------------------

def load_coords():
    cached = storage.load_json(COORDS_FILE, {}) or {}
    with COORDS_LOCK:
        COORDS.update(cached)
    wanted = {v[0] for v in gamedata.ENGINEERS.values()} | {p[0] for _, places in gamedata.PLACES for p in places}
    missing = sorted(wanted - set(cached))
    if not missing:
        return
    try:
        qs = "&".join("systemName[]=" + urllib.parse.quote(s) for s in missing)
        res = http_json("https://www.edsm.net/api-v1/systems?showCoordinates=1&" + qs)
        with COORDS_LOCK:
            for s in res or []:
                if s.get("coords"):
                    c = s["coords"]
                    COORDS[s["name"]] = [c["x"], c["y"], c["z"]]
            storage.save_json(COORDS_FILE, COORDS)
    except Exception as exc:
        print(f"EDSM non raggiungibile ({exc}): niente distanze per ingegneri e luoghi.")


def coords():
    with COORDS_LOCK:
        return dict(COORDS)


def ensure_coords(names):
    """Coordinate di sistemi qualsiasi (da EDSM, poi in cache). Restituisce {nome: [x, y, z]} per quelli noti."""
    names = {n for n in names if n}
    with COORDS_LOCK:
        missing = sorted(n for n in names if n not in COORDS)
    if missing:
        try:
            qs = "&".join("systemName[]=" + urllib.parse.quote(s) for s in missing[:50])
            res = http_json("https://www.edsm.net/api-v1/systems?showCoordinates=1&" + qs)
            with COORDS_LOCK:
                for s in res or []:
                    if s.get("coords"):
                        c = s["coords"]
                        COORDS[s["name"]] = [c["x"], c["y"], c["z"]]
                storage.save_json(COORDS_FILE, COORDS)
        except Exception as exc:
            print(f"EDSM non raggiungibile ({exc}): distanze delle missioni non disponibili.")
    with COORDS_LOCK:
        return {n: COORDS[n] for n in names if n in COORDS}


# --- Obiettivi della comunità (feed pubblico di Frontier) ---------------------------

_CG = {"data": [], "updated": 0.0}


def community_goals():
    """Da Inara se c'è la chiave API (più dettagli: tier, ricompense), altrimenti dal feed pubblico di Frontier."""
    from . import inara
    if inara.configured():
        try:
            return inara.community_goals()
        except Exception as exc:
            print(f"Obiettivi della comunità da Inara non disponibili ({exc}): uso il feed di Frontier.")
    now = time.time()
    if _CG["data"] and now - _CG["updated"] < 600:
        return _CG["data"]
    try:
        req = urllib.request.Request("https://api.orerve.net/2.0/website/initiatives/list?lang=en",
                                     headers={"Accept": "application/json", "User-Agent": spansh.USER_AGENT})
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        out = []
        for item in data.get("activeInitiatives", []):
            qty, target = int(item.get("qty") or 0), int(item.get("target_qty") or 1)
            out.append({"id": str(item.get("id")), "title": item.get("title"), "system": item.get("starsystem_name"),
                        "station": item.get("market_name"), "activity": item.get("activityType"),
                        "objective": item.get("objective") or item.get("target_commodity_list"),
                        "expiry": item.get("expiry"), "qty": qty, "target_qty": target,
                        "pct": round(qty / max(1, target) * 100, 2)})
        if out:
            _CG.update(data=out, updated=now)
    except Exception as exc:
        print(f"Obiettivi della comunità non disponibili ({exc}).")
    return _CG["data"]
