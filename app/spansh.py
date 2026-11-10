"""Chiamate a Spansh: ricerche e tutti i plotter di rotta, con risultati in un formato comune."""

import http.client
import json
import math
import time
import urllib.error
import urllib.parse
import urllib.request

from . import VERSION
from .lang import pick

USER_AGENT = f"Voidwatch-ED/{VERSION} (local companion app)"
BASE = "https://spansh.co.uk/api/"


def http_json(url, payload=None, timeout=20):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(url, data=data, headers={"User-Agent": USER_AGENT, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


def http_form(url, params, timeout=30):
    data = urllib.parse.urlencode(params, doseq=True).encode()
    req = urllib.request.Request(url, data=data, headers={"User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read().decode("utf-8"))
        except ValueError:
            body = {}
        raise ValueError(body.get("error") or pick(f"Il servizio di ricerca ha risposto con errore {e.code}", f"The search service returned error {e.code}"))


def job(endpoint, params, max_wait=180):
    """Avvia un calcolo asincrono su Spansh e aspetta il risultato (con qualche nuovo tentativo di rete)."""
    started = http_form(BASE + endpoint, params)
    if started.get("error"):
        raise ValueError(started["error"])
    deadline, failures = time.time() + max_wait, 0
    while time.time() < deadline:
        time.sleep(1.5)
        try:
            res = http_json(BASE + "results/" + started["job"])
        except (urllib.error.URLError, http.client.HTTPException, ConnectionError, TimeoutError):
            failures += 1
            if failures > 5:
                raise
            continue
        if res.get("error"):
            raise ValueError(res["error"])
        if res.get("status") == "ok":
            return res.get("result")
    raise ValueError(pick("Il calcolo sta richiedendo troppo tempo, riprova tra poco", "The calculation is taking too long, try again shortly"))


def _pos(j):
    return [j.get("x"), j.get("y"), j.get("z")]


def _route(tool, src, dst, rng, jumps, **extra):
    total = sum(j.get("jumps") or 0 for j in jumps)
    dist = sum(j.get("distance_jumped") or 0 for j in jumps)
    return {"tool": tool, "from": src, "to": dst, "range": rng, "distance": extra.pop("distance", None) or dist,
            "total_jumps": total, "created": time.strftime("%Y-%m-%dT%H:%M:%S"), "jumps": jumps, **extra}


def _bodies(bodies):
    out = []
    for b in bodies or []:
        out.append({"name": b.get("name"), "type": b.get("subtype") or b.get("type"), "dist_ls": b.get("distance_to_arrival"),
                    "scan": b.get("estimated_scan_value"), "mapping": b.get("estimated_mapping_value"),
                    "terraformable": b.get("is_terraformable"), "bio_value": b.get("landmark_value"),
                    "species": [{"name": l.get("subtype"), "genus": l.get("type"), "count": l.get("count"), "value": l.get("value")}
                                for l in b.get("landmarks") or []]})
    return out


def neutron(q, ctx):
    src, dst = q["from"], q["to"]
    rng = float(q.get("range") or ctx["jump_range"] or 30)
    r = job("route", {"from": src, "to": dst, "range": round(rng, 2), "efficiency": int(q.get("efficiency") or 60)})
    jumps = [{"system": j.get("system"), "jumps": j.get("jumps"), "neutron": j.get("neutron_star"),
              "distance_jumped": j.get("distance_jumped"), "distance_left": j.get("distance_left"), "pos": _pos(j)}
             for j in r.get("system_jumps", [])]
    return _route("neutron", r.get("source_system"), r.get("destination_system"), rng, jumps, distance=r.get("distance"))


def galaxy(q, ctx):
    fsd = q.get("fsd") or {}
    need = ("optimal_mass", "max_fuel_per_jump", "fuel_multiplier", "fuel_power", "base_mass", "tank_size")
    if not all(fsd.get(k) for k in need):
        raise ValueError(pick("Servono i dati dell'FSD: scegli la nave nel configuratore", "FSD data is needed: pick the ship in the outfitting tool"))
    params = {"source": q["from"], "destination": q["to"], "is_supercharged": 1 if q.get("supercharged") else 0,
              "use_supercharge": 1 if q.get("use_neutrons", True) else 0, "use_injections": 1 if q.get("injections") else 0,
              "exclude_secondary": 1 if q.get("exclude_secondary") else 0, "refuel_every_scoopable": 1 if q.get("refuel_every") else 0,
              "fuel_power": fsd["fuel_power"], "fuel_multiplier": fsd["fuel_multiplier"], "optimal_mass": fsd["optimal_mass"],
              "base_mass": fsd["base_mass"], "tank_size": fsd["tank_size"], "internal_tank_size": fsd.get("internal_tank_size", 0.5),
              "reserve_size": 0, "max_fuel_per_jump": fsd["max_fuel_per_jump"], "range_boost": fsd.get("range_boost", 0),
              "cargo": int(q.get("cargo") or 0), "algorithm": q.get("algorithm") or "optimistic"}
    r = job("generic/route", params)
    jumps, prev = [], None
    for j in r.get("jumps", []):
        jumps.append({"system": j.get("name"), "jumps": 1 if prev else 0, "neutron": j.get("has_neutron"),
                      "scoopable": j.get("is_scoopable"), "refuel": j.get("must_refuel"), "inject": j.get("must_inject"),
                      "fuel": j.get("fuel_in_tank"), "distance_jumped": j.get("distance"),
                      "distance_left": j.get("distance_to_destination"), "pos": _pos(j)})
        prev = j
    return _route("galaxy", q["from"], q["to"], None, jumps)


def _riches(endpoint, tool, q, ctx, extra=None):
    rng = float(q.get("range") or ctx["jump_range"] or 30)
    params = {"from": q["from"], "range": round(rng, 2), "radius": int(q.get("radius") or 25),
              "max_results": int(q.get("max_results") or 50), "max_distance": int(q.get("max_distance") or 5000),
              "min_value": int(q.get("min_value") or 1), "loop": 1 if q.get("loop", True) else 0,
              "avoid_thargoids": 1 if q.get("avoid_thargoids", True) else 0}
    if q.get("to"):
        params["to"] = q["to"]
    params.update(extra or {})
    systems = job(endpoint, params) or []
    jumps, prev = [], None
    for s in systems:
        pos = _pos(s)
        d = (sum((a - b) ** 2 for a, b in zip(pos, prev)) ** .5) if prev and None not in pos else 0
        bodies = _bodies(s.get("bodies"))
        jumps.append({"system": s.get("name"), "jumps": s.get("jumps"), "distance_jumped": d, "pos": pos,
                      "bodies": bodies, "value": sum((b["mapping"] or 0) if tool != "exobio" else (b["bio_value"] or 0) for b in bodies)})
        prev = pos
    return _route(tool, q["from"], q.get("to") or q["from"], rng, jumps,
                  value=sum(j["value"] for j in jumps), bodies=sum(len(j["bodies"]) for j in jumps))


def riches(q, ctx):
    return _riches("riches/route", "riches", q, ctx, {"use_mapping_value": 1 if q.get("use_mapping_value", True) else 0})


def exobio(q, ctx):
    if q.get("mode") == "predict":
        return exobio_predict(q, ctx)
    return _riches("exobiology/route", "exobio", q, ctx)


def exobio_predict(q, ctx):
    """Pianeti con segnali biologici di cui nessuno ha registrato le specie (niente landmarks su Spansh), con la
    previsione delle specie di app/bio_predict.py; tappe raggruppate per sistema in ordine di vicinanza."""
    from . import bio_predict
    rng = float(q.get("range") or ctx["jump_range"] or 30)
    radius, max_ls = int(q.get("area") or 100), int(q.get("max_distance") or 5000)
    # Predefiniti uguali a quelli mostrati nel modulo (web/js/views/rotte.js): il modulo manda solo i campi toccati.
    min_value, max_systems = int(q.get("min_value") or 5_000_000), int(q.get("max_results") or 50)
    filters = {"is_landable": {"value": True}, "signals": [{"comparison": "<=>", "count": [1, 99], "name": "Biological"}],
               "distance": {"min": "0", "max": str(radius)},
               "distance_to_arrival": {"comparison": "<=>", "value": [0, max_ls]}}
    systems, start = {}, None
    for page in range(4):  # 500 pianeti per pagina, dai più vicini: quasi tutti sono già campionati
        try:
            res = http_json(BASE + "bodies/search", {"filters": filters, "sort": [{"distance": {"direction": "asc"}}],
                                                     "size": 500, "page": page, "reference_system": q["from"]}, timeout=60)
        except urllib.error.HTTPError as e:  # sistema sconosciuto: 400 "Invalid request"
            raise ValueError(pick(f"Il servizio di ricerca ha risposto con errore {e.code}: controlla il sistema di partenza",
                                  f"The search service returned error {e.code}: check the starting system"))
        ref = res.get("search", {}).get("reference_system_details") or {}
        start = start or [ref.get("x"), ref.get("y"), ref.get("z")]
        for b in res.get("results") or []:
            if any(l.get("subtype") in bio_predict.SPECIES_NAMES for l in b.get("landmarks") or []):
                continue
            p, sy = bio_predict.from_spansh(b)
            pred = bio_predict.predict_body(p, sy)
            if pred["max"] < min_value or not sy["pos"]:
                continue
            s = systems.setdefault(b.get("system_name"), {"system": b.get("system_name"), "pos": sy["pos"],
                                                          "from_start": b.get("distance") or 0, "bodies": []})
            s["bodies"].append({"name": b.get("name"), "type": b.get("subtype"), "dist_ls": b.get("distance_to_arrival"),
                                "predicted": True, "signals": pred["bio"], "dss": pred["dss"], "bio_min": pred["min"],
                                "bio_max": pred["max"], "genera": [{"genus": g["genus"], "species": [
                                    {"name": x["name"], "value": x["value"], "sure": x["sure"]} for x in g["species"]]}
                                    for g in pred["genera"]]})
        if len(systems) >= max_systems or len(res.get("results") or []) < 500:
            break
    if None in (start or [None]):
        raise ValueError(pick("Sistema di partenza non trovato", "Starting system not found"))
    left = sorted(systems.values(), key=lambda s: s["from_start"])[:max_systems]
    if not left:
        raise ValueError(pick("Nessun pianeta da scoprire sopra il valore minimo: aumenta il raggio o abbassa il valore",
                              "No undiscovered planet above the minimum value: increase the radius or lower the value"))
    # Ordine: ogni volta il sistema più vicino a quello attuale.
    jumps, pos = [{"system": q["from"], "jumps": 0, "distance_jumped": 0, "pos": start, "bodies": []}], start
    while left:
        nxt = min(left, key=lambda s: sum((a - b) ** 2 for a, b in zip(s["pos"], pos)))
        left.remove(nxt)
        d = sum((a - b) ** 2 for a, b in zip(nxt["pos"], pos)) ** .5
        jumps.append({"system": nxt["system"], "jumps": max(1, math.ceil(d / rng)), "distance_jumped": d, "pos": nxt["pos"],
                      "bodies": nxt["bodies"], "value": sum(b["bio_max"] for b in nxt["bodies"]),
                      "value_min": sum(b["bio_min"] for b in nxt["bodies"])})
        pos = nxt["pos"]
    loop = q.get("loop", True)
    if loop:
        d = sum((a - b) ** 2 for a, b in zip(start, pos)) ** .5
        jumps.append({"system": q["from"], "jumps": max(1, math.ceil(d / rng)), "distance_jumped": d, "pos": start, "bodies": []})
    return _route("exobio", q["from"], q["from"] if loop else jumps[-1]["system"], rng, jumps, predicted=True,
                  value=sum(j.get("value") or 0 for j in jumps), value_min=sum(j.get("value_min") or 0 for j in jumps),
                  bodies=sum(len(j["bodies"]) for j in jumps))


def ammonia(q, ctx):
    return _riches("riches/route", "ammonia", {**q, "min_value": 1}, ctx, {"body_types": ["Ammonia world"]})


def earthlike(q, ctx):
    return _riches("riches/route", "earthlike", {**q, "min_value": 1}, ctx, {"body_types": ["Earth-like world"]})


def rocky(q, ctx):
    return _riches("riches/route", "rocky", {**q, "min_value": 1}, ctx, {"body_types": ["Rocky body", "High metal content world"]})


def tourist(q, ctx):
    dests = [d.strip() for d in str(q.get("destinations") or "").replace(";", "\n").splitlines() if d.strip()]
    if not dests:
        raise ValueError(pick("Scrivi almeno una destinazione (una per riga)", "Enter at least one destination (one per line)"))
    rng = float(q.get("range") or ctx["jump_range"] or 30)
    params = {"range": round(rng, 2), "source": q["from"], "destination": dests, "loop": 1 if q.get("loop") else 0}
    if q.get("to"):
        params["final_destination"] = q["to"]
    r = job("tourist/route", params)
    jumps = [{"system": j.get("system"), "jumps": j.get("jumps"), "distance_jumped": j.get("distance"), "pos": _pos(j),
              "waypoint": j.get("system") in dests} for j in r.get("system_jumps", [])]
    return _route("tourist", q["from"], q.get("to") or dests[-1], rng, jumps, destinations=dests)


def carrier(q, ctx):
    dests = [d.strip() for d in str(q.get("to") or "").replace(";", "\n").splitlines() if d.strip()]
    if not dests:
        raise ValueError(pick("Scrivi la destinazione del carrier", "Enter the carrier destination"))
    params = {"source": q["from"], "destinations": dests, "refuel_destinations": [],
              "capacity_used": int(q.get("capacity_used") or 0), "calculate_starting_fuel": 1}
    r = job("fleetcarrier/route", params)
    jumps, prev = [], None
    for j in r.get("jumps", []):
        jumps.append({"system": j.get("name"), "jumps": 1 if prev else 0, "distance_jumped": j.get("distance"),
                      "distance_left": j.get("distance_to_destination"), "fuel": j.get("fuel_in_tank"),
                      "tritium_used": j.get("fuel_used"), "restock": j.get("must_restock"), "restock_amount": j.get("restock_amount"),
                      "icy_ring": j.get("has_icy_ring"), "pristine": j.get("is_system_pristine"), "pos": _pos(j)})
        prev = j
    return _route("carrier", q["from"], dests[-1], 500, jumps, tritium=sum(j["tritium_used"] or 0 for j in jumps))


PLOTTERS = {"neutron": neutron, "galaxy": galaxy, "riches": riches, "exobio": exobio, "ammonia": ammonia,
            "earthlike": earthlike, "rocky": rocky, "tourist": tourist, "carrier": carrier}


def plot(tool, q, ctx):
    if tool not in PLOTTERS:
        raise ValueError(pick("Strumento sconosciuto", "Unknown tool"))
    q = dict(q)
    q["from"] = (q.get("from") or ctx["system"] or "").strip()
    if not q["from"]:
        raise ValueError(pick("Specifica il sistema di partenza", "Specify the starting system"))
    if tool in ("neutron", "galaxy") and not (q.get("to") or "").strip():
        raise ValueError(pick("Specifica la destinazione", "Specify the destination"))
    q["to"] = (q.get("to") or "").strip()
    return PLOTTERS[tool](q, ctx)
