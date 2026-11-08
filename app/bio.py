"""Pianificatore esobiologia: il tuo Codex biologico dai journal e i pianeti con vita vicini (Spansh).

Dai journal (tutti i file, in cache per nome + dimensione + data di modifica):
- ScanOrganic con ScanType "Analyse": le specie che hai analizzato (Species_Localised, Variant_Localised,
  SystemAddress + Body per sapere su quale corpo);
- CodexEntry della categoria Biology (sottocategoria Organic_Structures): le varianti registrate nel Codex,
  con IsNewEntry quando sei stato il primo a registrarle tu;
- SellOrganicData: crediti incassati (Value) e bonus prima scoperta (Bonus).

Da Spansh (/api/bodies/search) i corpi atterrabili con segnali biologici. Spansh salva le specie già
segnalate dai giocatori come "landmarks" (type = genere, subtype = specie, value = valore base) e i generi
visti con le sonde DSS in "genuses" (con nomi diversi dal journal: "Bacterial", "Shrubs", "Conchas"...).
Le specie su Spansh sono state quindi già registrate da qualcuno: lì il bonus prima scoperta è
molto improbabile. Il bonus (Bonus = 4 x Value in SellOrganicData, quindi 5x in totale) si ottiene sui corpi
senza footfall di altri: stessa regola usata da EDMC-BioScan (load.py: value * 4 se il corpo non ha footfall).
"""

import json
import os
import threading
import time
import urllib.error

from . import journal
from .gamedata import GENUS_DISTANCE, SPECIES_VALUES
from .lang import pick
from .spansh import http_json

BODIES_URL = "https://spansh.co.uk/api/bodies/search"
CACHE_TTL = 900
FIRST_BONUS = 5  # moltiplicatore totale (valore + bonus 4x), fonte nella docstring

# Nomi dei generi su Spansh ("genuses", dalle sonde DSS) -> nome del genere nel journal e in SPECIES_VALUES.
SPANSH_GENUS = {
    "Bacterial": "Bacterium", "Tussocks": "Tussock", "Shrubs": "Frutexa", "Fungoids": "Fungoida",
    "Cactoids": "Cactoida", "Conchas": "Concha", "Aleoids": "Aleoida", "Fumerolas": "Fumerola",
    "Fonticulus": "Fonticulua", "Anemones": "Anemone", "Brain Trees": "Brain Tree", "Tubers": "Sinuous Tubers",
}
# Generi rari con una sola "specie" che coincide col nome del genere.
_SINGLE = {"Amphora Plant", "Bark Mounds", "Crystalline Shards"}

_RELEVANT = ('"event":"ScanOrganic"', '"event":"CodexEntry"', '"event":"SellOrganicData"')
_file_cache, _search_cache = {}, {}
_lock = threading.Lock()


def genus_of(species):
    if species in _SINGLE:
        return species
    if species and species.endswith(("Anemone", "Brain Tree", "Sinuous Tubers")):
        return next(g for g in ("Anemone", "Brain Tree", "Sinuous Tubers") if species.endswith(g))
    return (species or "").split(" ")[0]


def genus_range(genus, values=None):
    vals = [v for s, v in {**SPECIES_VALUES, **(values or {})}.items() if genus_of(s) == genus and v]
    return (min(vals), max(vals)) if vals else (None, None)


# --- journal ---------------------------------------------------------------------------------------------

def _events(path):
    """Solo gli eventi biologici del file; in cache finché nome, dimensione e data non cambiano."""
    try:
        st = os.stat(path)
    except OSError:
        return []
    key = (st.st_size, st.st_mtime)
    with _lock:
        hit = _file_cache.get(path)
        if hit and hit[0] == key:
            return hit[1]
    out = []
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            if not any(tag in line for tag in _RELEVANT):
                continue
            try:
                e = json.loads(line)
            except ValueError:
                continue
            ev = e.get("event")
            if ev == "ScanOrganic" and e.get("ScanType") != "Analyse":
                continue
            if ev == "CodexEntry" and e.get("Category") != "$Codex_Category_Biology;":
                continue
            out.append(e)
    with _lock:
        _file_cache[path] = (key, out)
    return out


def _species_name(e):
    return e.get("Species_Localised") or e.get("Species")


def _codex_raw():
    """Specie analizzate, varianti registrate e vendite da tutti i journal (dal più vecchio)."""
    species, done_on, logged, values = {}, set(), {}, {}
    earned = bonus = sold = 0
    for path in journal.journal_files():
        for e in _events(path):
            ev, ts = e.get("event"), e.get("timestamp")
            if ev == "ScanOrganic":
                name = _species_name(e)
                if not name:
                    continue
                s = species.setdefault(name, {"name": name, "genus": e.get("Genus_Localised") or genus_of(name),
                                              "analysed": 0, "variants": [], "first": ts, "last": ts,
                                              "sold": 0, "earned": 0, "bonus": 0})
                s["analysed"] += 1
                s["last"] = ts
                v = e.get("Variant_Localised")
                if v and v not in s["variants"]:
                    s["variants"].append(v)
                if e.get("SystemAddress") is not None and e.get("Body") is not None:
                    done_on.add((e["SystemAddress"], e["Body"], name))
            elif ev == "CodexEntry":
                if "Organic_Structures" not in (e.get("SubCategory") or ""):
                    continue
                variant = e.get("Name_Localised") or e.get("Name")
                if variant and variant not in logged:
                    logged[variant] = {"variant": variant, "species": variant.split(" - ")[0], "first": ts,
                                       "system": e.get("System"), "region": e.get("Region_Localised"),
                                       "new": bool(e.get("IsNewEntry"))}
            elif ev == "SellOrganicData":
                for item in e.get("BioData") or []:
                    name = _species_name(item)
                    val, bon = item.get("Value") or 0, item.get("Bonus") or 0
                    earned += val + bon
                    bonus += bon
                    sold += 1
                    if name and val:
                        values[name] = val
                    s = species.get(name)
                    if s:
                        s["sold"] += 1
                        s["earned"] += val + bon
                        s["bonus"] += bon
    return species, done_on, logged, values, {"earned": earned, "bonus": bonus, "sold": sold}


def codex():
    species, _, logged, values, totals = _codex_raw()
    rows = []
    for s in species.values():
        rows.append({**s, "value": values.get(s["name"]) or SPECIES_VALUES.get(s["name"])})
    rows.sort(key=lambda s: (s["genus"], s["name"]))
    genera = {}
    for g in sorted({genus_of(n) for n in SPECIES_VALUES} | {s["genus"] for s in rows}):
        known = [s for s in rows if s["genus"] == g]
        total = sum(1 for n in SPECIES_VALUES if genus_of(n) == g)
        if known or total:
            genera[g] = {"genus": g, "species": len(known), "total": total, "analysed": sum(s["analysed"] for s in known),
                         "min_dist": GENUS_DISTANCE.get(g)}
    only_logged = sorted({v["species"] for v in logged.values()} - set(species))
    return {"species": rows, "species_count": len(rows), "analysed": sum(s["analysed"] for s in rows),
            "known_total": len(SPECIES_VALUES), "genera": list(genera.values()),
            "variants_logged": len(logged), "variants_new": sum(1 for v in logged.values() if v["new"]),
            "logged_only": only_logged, "earned": totals["earned"], "bonus": totals["bonus"], "sold": totals["sold"],
            "genus_distance": GENUS_DISTANCE, "first_bonus": FIRST_BONUS}


# --- Spansh ----------------------------------------------------------------------------------------------

def _cached(key):
    with _lock:
        hit = _search_cache.get(key)
        return hit[0] if hit and time.time() < hit[1] else None


def _store(key, value):
    with _lock:
        _search_cache[key] = (value, time.time() + CACHE_TTL)
        if len(_search_cache) > 100:
            for k in sorted(_search_cache, key=lambda k: _search_cache[k][1])[:30]:
                _search_cache.pop(k, None)


def _is_bio(lm):
    t = lm.get("type")
    return lm.get("subtype") in SPECIES_VALUES or t in GENUS_DISTANCE or t in ("Electricae", "Anemone", "Brain Tree")


def _body(b):
    """Corpo Spansh -> riga compatta, senza i dati del comandante (quelli si aggiungono dopo la cache)."""
    species = {}
    for lm in b.get("landmarks") or []:
        if not _is_bio(lm) or not lm.get("subtype"):
            continue
        s = species.setdefault(lm["subtype"], {"name": lm["subtype"], "genus": lm.get("type") or genus_of(lm["subtype"]),
                                               "spansh_value": lm.get("value"), "variants": []})
        if lm.get("variant") and lm["variant"] not in s["variants"]:
            s["variants"].append(lm["variant"])
    genera = [SPANSH_GENUS.get(g.get("name"), g.get("name")) for g in b.get("genuses") or [] if g.get("name")]
    bio = next((s.get("count") for s in b.get("signals") or [] if s.get("name") == "Biological"), None)
    return {"system": b.get("system_name"), "system_id64": b.get("system_id64"), "body": b.get("name"),
            "body_id": b.get("body_id"), "distance": round(b.get("distance") or 0, 2),
            "arrival": round(b["distance_to_arrival"]) if b.get("distance_to_arrival") is not None else None,
            "gravity": round(b["gravity"], 3) if b.get("gravity") is not None else None,
            "atmosphere": b.get("atmosphere") or "No atmosphere", "type": b.get("subtype"),
            "temperature": round(b["surface_temperature"]) if b.get("surface_temperature") is not None else None,
            "bio": bio, "species": list(species.values()), "genera": genera,
            "updated": b.get("signals_updated_at") or b.get("updated_at")}


def _search(ref, radius, min_value, max_gravity, max_arrival):
    key = (ref.lower(), radius, min_value, max_gravity, max_arrival)
    hit = _cached(key)
    if hit:
        return hit
    filters = {"distance": {"min": "0", "max": str(radius)}, "is_landable": {"value": True},
               "signals": [{"name": "Biological", "comparison": "<=>", "count": [1, 99]}]}
    if min_value > 0:
        filters["landmark_value"] = {"min": str(int(min_value)), "max": "999999999999"}
    if max_gravity:
        filters["gravity"] = {"min": "0", "max": str(max_gravity)}
    if max_arrival:
        filters["distance_to_arrival"] = {"min": "0", "max": str(int(max_arrival))}
    # Con un valore minimo si vogliono i corpi più ricchi; senza, i più vicini (anche quelli con specie
    # non ancora segnalate, che su Spansh non hanno landmark_value e finirebbero in fondo).
    sort = ([{"landmark_value": {"direction": "desc"}}, {"distance": {"direction": "asc"}}] if min_value > 0
            else [{"distance": {"direction": "asc"}}])
    payload = {"filters": filters, "sort": sort,
               "size": 200, "page": 0, "reference_system": ref}
    res = http_json(BODIES_URL, payload, timeout=45)  # gli errori salgono: niente cache
    rows = [_body(b) for b in res.get("results", [])]
    # Spansh è un po' largo sui limiti: si ricontrolla qui.
    if max_gravity:
        rows = [r for r in rows if r["gravity"] is None or r["gravity"] <= max_gravity]
    if max_arrival:
        rows = [r for r in rows if r["arrival"] is None or r["arrival"] <= max_arrival]
    data = {"rows": rows, "count": res.get("count", len(rows))}
    _store(key, data)
    return data


def _num(v):
    try:
        return float(str(v).replace(",", ".")) if v not in (None, "") else None
    except ValueError:
        return None


def nearby(ref="Sol", radius=50, min_value=0, max_gravity=None, only_new=False, max_arrival=None):
    """Pianeti con segnali biologici vicini a `ref`, con valore stimato e specie nuove per il comandante."""
    ref = (ref or "Sol").strip()
    radius = max(5, min(_num(radius) or 50, 500))
    min_value = max(0, _num(min_value) or 0)
    max_gravity = _num(max_gravity) or None  # 0 o vuoto = nessun limite
    max_arrival = _num(max_arrival) or None
    only_new = str(only_new).lower() in ("1", "true", "on", "yes")
    base = {"reference": ref, "radius": radius, "min_value": min_value, "max_gravity": max_gravity,
            "max_arrival": max_arrival, "only_new": only_new}
    try:
        found = _search(ref, radius, min_value, max_gravity, max_arrival)
    except Exception as exc:
        msg = (pick(f"Sistema «{ref}» non trovato: controlla il nome", f"System “{ref}” not found: check the name")
               if isinstance(exc, urllib.error.HTTPError) and exc.code == 400
               else pick("Servizio di ricerca non raggiungibile: riprova tra poco", "Search service unreachable: try again shortly"))
        return {**base, "results": [], "count": 0, "error": msg}

    species_done, done_on, _, values, _ = _codex_raw()
    out = []
    for r in found["rows"]:
        row = dict(r)
        sp, value, value_new = [], 0, 0
        for s in r["species"]:
            v = values.get(s["name"]) or SPECIES_VALUES.get(s["name"]) or s["spansh_value"] or 0
            new = s["name"] not in species_done
            done = (r["system_id64"], r["body_id"], s["name"]) in done_on
            sp.append({**s, "value": v, "new": new, "done_here": done})
            if not done:
                value += v
                value_new += v if new else 0
        sp.sort(key=lambda s: -s["value"])
        known_genera = {s["genus"] for s in sp}
        unknown = []
        for g in r["genera"]:
            if g in known_genera:
                continue
            lo, hi = genus_range(g, values)
            missing = [n for n in SPECIES_VALUES if genus_of(n) == g and n not in species_done]
            unknown.append({"genus": g, "min": lo, "max": hi, "new_possible": bool(missing)})
        # Segnali senza specie né generi noti: si sa solo quanti sono.
        unidentified = max(0, (r["bio"] or 0) - len(sp) - len(unknown))
        row.update(species=sp, unknown_genera=unknown, unidentified=unidentified, value=value, value_new=value_new,
                   value_max=value + sum(u["max"] or 0 for u in unknown),
                   new_count=sum(1 for s in sp if s["new"] and not s["done_here"]),
                   complete=bool(r["bio"]) and len(sp) >= r["bio"])
        if only_new and not (row["new_count"] or any(u["new_possible"] for u in unknown) or unidentified):
            continue
        out.append(row)
    out.sort(key=lambda x: ((-x["value_new"],) if only_new else ()) + (-x["value"], -x["value_max"], x["distance"]))
    return {**base, "results": out[:80], "count": len(out), "spansh_count": found["count"],
            "truncated": found["count"] > len(found["rows"]), "fetched": time.time()}
