"""Avvisi materiali per gli ingegneri e calcolatore del material trader.

- La wishlist (progetti di "Sblocchi e progetti") arriva dall'interfaccia con POST /api/engineering/wishlist:
  i progetti sono definiti nel frontend (web/js/views/materiali.js, BLUEPRINTS), qui si salva solo l'elenco
  degli obiettivi con i materiali richiesti.
- A ogni evento che cambia i materiali (o la stiva) si ricontrolla la wishlist: quando un progetto diventa
  completo lo si annuncia una volta (voce + ticker); quando un singolo materiale raggiunge la quantità
  richiesta si avvisa anche per quello.
- Calcolatore del material trader: lo scambio più conveniente per ottenere N unità di un materiale.

Regole del material trader (verificate sul codice di EDDiscovery, UserControlMaterialTrader.cs,
https://github.com/EDDiscovery/EDDiscovery, e sugli scambi MaterialTrade nel journal dell'utente):
  - si scambia solo dentro lo stesso tipo (Raw / Manufactured / Encoded: tre trader diversi);
  - salire di N gradi nella stessa categoria costa 6^N : 1;
  - scendere di N gradi nella stessa categoria rende 1 : 3^N;
  - cambiare categoria allo stesso grado costa 6 : 1;
  - cambiare categoria e salire di N gradi costa 6^(N+1) : 1;
  - cambiare categoria e scendere di N gradi: 6 : 3^N, ridotto (2:1, 2:3, 2:9, 2:27).
  Esempi dal journal: 10 Atypical Encryption Archives (G4) -> 45 Atypical Disrupted Wake Echoes (G1),
  50 AEA (G4) -> 25 Strange Wake Solutions (G3), 30 Adaptive Encryptors Capture (G5) -> 15 EHT (G4).
Tabella materiali (categorie e gradi) da EliteDangerousCore/MCMRType.cs (EDDiscovery).
"""

import math
import os
import re
import threading
import time

from . import journal, paths, storage, voice
from .gamedata import GRADE_CAP
from .journal import STATE
from .lang import pick

# Tipo -> [(categoria del trader, [nome interno G1, G2, ...]), ...]. Nomi inglesi in NAMES.
TRADE_GROUPS = {
    "Raw": [
        ("Raw category 1", "carbon vanadium niobium yttrium"),
        ("Raw category 2", "phosphorus chromium molybdenum technetium"),
        ("Raw category 3", "sulphur manganese cadmium ruthenium"),
        ("Raw category 4", "iron zinc tin selenium"),
        ("Raw category 5", "nickel germanium tungsten tellurium"),
        ("Raw category 6", "rhenium arsenic mercury polonium"),
        ("Raw category 7", "lead zirconium boron antimony"),
    ],
    "Manufactured": [
        ("Chemical", "chemicalstorageunits chemicalprocessors chemicaldistillery chemicalmanipulators "
                     "pharmaceuticalisolators"),
        ("Thermic", "temperedalloys heatresistantceramics precipitatedalloys thermicalloys militarygradealloys"),
        ("Heat", "heatconductionwiring heatdispersionplate heatexchangers heatvanes protoheatradiators"),
        ("Conductive", "basicconductors conductivecomponents conductiveceramics conductivepolymers biotechconductors"),
        ("Mechanical Components", "mechanicalscrap mechanicalequipment mechanicalcomponents configurablecomponents "
                                  "improvisedcomponents"),
        ("Capacitors", "gridresistors hybridcapacitors electrochemicalarrays polymercapacitors "
                       "militarysupercapacitors"),
        ("Shielding", "wornshieldemitters shieldemitters shieldingsensors compoundshielding imperialshielding"),
        ("Composite", "compactcomposites filamentcomposites highdensitycomposites fedproprietarycomposites "
                      "fedcorecomposites"),
        ("Crystals", "crystalshards uncutfocuscrystals focuscrystals refinedfocuscrystals exquisitefocuscrystals"),
        ("Alloys", "salvagedalloys galvanisingalloys phasealloys protolightalloys protoradiolicalloys"),
    ],
    "Encoded": [
        ("Emission Data", "scrambledemissiondata archivedemissiondata emissiondata decodedemissiondata "
                          "compactemissionsdata"),
        ("Wake Scans", "disruptedwakeechoes fsdtelemetry wakesolutions hyperspacetrajectories dataminedwake"),
        ("Shield Data", "shieldcyclerecordings shieldsoakanalysis shielddensityreports shieldpatternanalysis "
                        "shieldfrequencydata"),
        ("Encryption Files", "encryptedfiles encryptioncodes symmetrickeys encryptionarchives adaptiveencryptors"),
        ("Data Archives", "bulkscandata scanarchives scandatabanks encodedscandata classifiedscandata"),
        ("Encoded Firmware", "legacyfirmware consumerfirmware industrialfirmware securityfirmware embeddedfirmware"),
    ],
}
NAMES = {
    "carbon": "Carbon", "vanadium": "Vanadium", "niobium": "Niobium", "yttrium": "Yttrium",
    "phosphorus": "Phosphorus", "chromium": "Chromium", "molybdenum": "Molybdenum", "technetium": "Technetium",
    "sulphur": "Sulphur", "manganese": "Manganese", "cadmium": "Cadmium", "ruthenium": "Ruthenium",
    "iron": "Iron", "zinc": "Zinc", "tin": "Tin", "selenium": "Selenium",
    "nickel": "Nickel", "germanium": "Germanium", "tungsten": "Tungsten", "tellurium": "Tellurium",
    "rhenium": "Rhenium", "arsenic": "Arsenic", "mercury": "Mercury", "polonium": "Polonium",
    "lead": "Lead", "zirconium": "Zirconium", "boron": "Boron", "antimony": "Antimony",
    "chemicalstorageunits": "Chemical Storage Units", "chemicalprocessors": "Chemical Processors",
    "chemicaldistillery": "Chemical Distillery", "chemicalmanipulators": "Chemical Manipulators",
    "pharmaceuticalisolators": "Pharmaceutical Isolators", "temperedalloys": "Tempered Alloys",
    "heatresistantceramics": "Heat Resistant Ceramics", "precipitatedalloys": "Precipitated Alloys",
    "thermicalloys": "Thermic Alloys", "militarygradealloys": "Military Grade Alloys",
    "heatconductionwiring": "Heat Conduction Wiring", "heatdispersionplate": "Heat Dispersion Plate",
    "heatexchangers": "Heat Exchangers", "heatvanes": "Heat Vanes", "protoheatradiators": "Proto Heat Radiators",
    "basicconductors": "Basic Conductors", "conductivecomponents": "Conductive Components",
    "conductiveceramics": "Conductive Ceramics", "conductivepolymers": "Conductive Polymers",
    "biotechconductors": "Biotech Conductors", "mechanicalscrap": "Mechanical Scrap",
    "mechanicalequipment": "Mechanical Equipment", "mechanicalcomponents": "Mechanical Components",
    "configurablecomponents": "Configurable Components", "improvisedcomponents": "Improvised Components",
    "gridresistors": "Grid Resistors", "hybridcapacitors": "Hybrid Capacitors",
    "electrochemicalarrays": "Electrochemical Arrays", "polymercapacitors": "Polymer Capacitors",
    "militarysupercapacitors": "Military Supercapacitors", "wornshieldemitters": "Worn Shield Emitters",
    "shieldemitters": "Shield Emitters", "shieldingsensors": "Shielding Sensors",
    "compoundshielding": "Compound Shielding", "imperialshielding": "Imperial Shielding",
    "compactcomposites": "Compact Composites", "filamentcomposites": "Filament Composites",
    "highdensitycomposites": "High Density Composites", "fedproprietarycomposites": "Proprietary Composites",
    "fedcorecomposites": "Core Dynamics Composites", "crystalshards": "Crystal Shards",
    "uncutfocuscrystals": "Flawed Focus Crystals", "focuscrystals": "Focus Crystals",
    "refinedfocuscrystals": "Refined Focus Crystals", "exquisitefocuscrystals": "Exquisite Focus Crystals",
    "salvagedalloys": "Salvaged Alloys", "galvanisingalloys": "Galvanising Alloys", "phasealloys": "Phase Alloys",
    "protolightalloys": "Proto Light Alloys", "protoradiolicalloys": "Proto Radiolic Alloys",
    "scrambledemissiondata": "Exceptional Scrambled Emission Data", "archivedemissiondata": "Irregular Emission Data",
    "emissiondata": "Unexpected Emission Data", "decodedemissiondata": "Decoded Emission Data",
    "compactemissionsdata": "Abnormal Compact Emissions Data", "disruptedwakeechoes": "Atypical Disrupted Wake Echoes",
    "fsdtelemetry": "Anomalous FSD Telemetry", "wakesolutions": "Strange Wake Solutions",
    "hyperspacetrajectories": "Eccentric Hyperspace Trajectories", "dataminedwake": "Datamined Wake Exceptions",
    "shieldcyclerecordings": "Distorted Shield Cycle Recordings", "shieldsoakanalysis": "Inconsistent Shield Soak Analysis",
    "shielddensityreports": "Untypical Shield Scans", "shieldpatternanalysis": "Aberrant Shield Pattern Analysis",
    "shieldfrequencydata": "Peculiar Shield Frequency Data", "encryptedfiles": "Unusual Encrypted Files",
    "encryptioncodes": "Tagged Encryption Codes", "symmetrickeys": "Open Symmetric Keys",
    "encryptionarchives": "Atypical Encryption Archives", "adaptiveencryptors": "Adaptive Encryptors Capture",
    "bulkscandata": "Anomalous Bulk Scan Data", "scanarchives": "Unidentified Scan Archives",
    "scandatabanks": "Classified Scan Databanks", "encodedscandata": "Divergent Scan Data",
    "classifiedscandata": "Classified Scan Fragment", "legacyfirmware": "Specialised Legacy Firmware",
    "consumerfirmware": "Modified Consumer Firmware", "industrialfirmware": "Cracked Industrial Firmware",
    "securityfirmware": "Security Firmware Patch", "embeddedfirmware": "Modified Embedded Firmware",
}
# Materiali che non passano dal trader standard: servono solo per riconoscere i nomi della wishlist
# ("... Segment" è il nome usato in web/js/views/materiali.js; il journal scrive "... Fragment").
EXTRA_NAMES = {
    "guardian_moduleblueprint": ["Guardian Module Blueprint Fragment", "Guardian Module Blueprint Segment"],
    "guardian_weaponblueprint": ["Guardian Weapon Blueprint Fragment", "Guardian Weapon Blueprint Segment"],
    "guardian_vesselblueprint": ["Guardian Vessel Blueprint Fragment"],
    "guardian_powercell": ["Guardian Power Cell"], "guardian_powerconduit": ["Guardian Power Conduit"],
    "guardian_techcomponent": ["Guardian Technology Component"],
    "guardian_sentinel_weaponparts": ["Guardian Sentinel Weapon Parts"],
    "guardian_sentinel_wreckagecomponents": ["Guardian Wreckage Components"],
    "ancientbiologicaldata": ["Pattern Alpha Obelisk Data"], "ancientculturaldata": ["Pattern Beta Obelisk Data"],
    "ancienthistoricaldata": ["Pattern Gamma Obelisk Data"], "ancientlanguagedata": ["Pattern Delta Obelisk Data"],
    "ancienttechnologicaldata": ["Pattern Epsilon Obelisk Data"],
}

MATERIALS = {}   # nome interno -> {key, name, type, group, grade}
for _type, _groups in TRADE_GROUPS.items():
    for _group, _row in _groups:
        for _g, _key in enumerate(_row.split(), start=1):
            MATERIALS[_key] = {"key": _key, "name": NAMES[_key], "type": _type, "group": _group, "grade": _g}


def _norm(s):
    return re.sub(r"[^a-z0-9]", "", str(s or "").lower())


NAME_INDEX = {_norm(m["name"]): k for k, m in MATERIALS.items()}
NAME_INDEX.update({_norm(k): k for k in MATERIALS})
for _key, _names in EXTRA_NAMES.items():
    NAME_INDEX[_norm(_key)] = _key
    for _n in _names:
        NAME_INDEX[_norm(_n)] = _key

WISHLIST_FILE = paths.user_file("engineering_wishlist.json")
MEMORY_FILE = paths.cache_file("engineering_alerts_sent.json")
MAX_ITEMS = 40
WATCH_EVENTS = {"MaterialCollected", "MaterialTrade", "MaterialDiscarded", "EngineerCraft", "Synthesis",
                "TechnologyBroker", "MissionCompleted", "Materials", "Cargo", "MarketBuy", "MarketSell",
                "CollectCargo", "EjectCargo"}
GAIN_EVENTS = {"MaterialCollected", "MaterialTrade", "MissionCompleted", "MarketBuy", "CollectCargo"}

_lock = threading.Lock()
_prev = {}          # id progetto -> {"affordable": bool, "ok": set(nomi pronti)}
_announced = set()  # progetti già annunciati come completi (finché restano completi)
_ready = {"done": False}


# --- Wishlist -----------------------------------------------------------------------

def _clean_item(it):
    if not isinstance(it, dict) or not str(it.get("name") or "").strip():
        return None
    reqs = []
    for r in it.get("items") or []:
        try:
            count = int(r.get("count") or 0)
        except (TypeError, ValueError, AttributeError):
            continue
        if isinstance(r, dict) and r.get("name") and count > 0:
            reqs.append({"name": str(r["name"])[:80], "cat": str(r.get("cat") or "")[:20], "count": min(count, 9999)})
    if not reqs:
        return None
    return {"id": str(it.get("id") or it["name"])[:60], "name": str(it["name"])[:120], "items": reqs[:30]}


def load_wishlist():
    data = storage.load_json(WISHLIST_FILE, {}) or {}
    return data.get("items") or [] if isinstance(data, dict) else []


def save_wishlist(body):
    items = body.get("items") if isinstance(body, dict) else body
    if not isinstance(items, list):
        raise ValueError(pick("Lista di progetti attesa", "Expected a list of projects"))
    clean = [c for c in (_clean_item(i) for i in items) if c][:MAX_ITEMS]
    storage.save_json(WISHLIST_FILE, {"items": clean, "updated": time.strftime("%Y-%m-%dT%H:%M:%S")})
    with _lock:
        _refresh(announce=False)   # cambiare obiettivo non deve far parlare il copilota
    return status()


# --- Stato dei materiali --------------------------------------------------------------

def _stock():
    """Conteggi attuali: materiali per nome interno, etichette localizzate, stiva per nome normalizzato."""
    with STATE.lock:
        mats = {k: dict(v) for k, v in STATE.materials.items()}
    labels = {_norm(m.get("label")): k for k, m in mats.items() if m.get("label")}
    cargo = {}
    data = storage.load_json(os.path.join(paths.JOURNAL_DIR, "Cargo.json"), {}) or {}
    for i in data.get("Inventory", []) or []:
        n = i.get("Count") or 0
        for name in (i.get("Name_Localised"), i.get("Name")):
            if name:
                cargo[_norm(name)] = cargo.get(_norm(name), 0) + n
    return {k: m.get("count", 0) for k, m in mats.items()}, labels, cargo


def resolve(name):
    """Nome della wishlist (inglese o interno) -> nome interno del materiale, se è un materiale."""
    return NAME_INDEX.get(_norm(name))


def _have(req, counts, labels, cargo):
    key = resolve(req["name"]) or labels.get(_norm(req["name"]))
    if key and req.get("cat") != "Commodity":
        return key, counts.get(key, 0)
    n = cargo.get(_norm(req["name"]), 0)
    if not n and key:
        n = counts.get(key, 0)
    return key, n


def _evaluate():
    counts, labels, cargo = _stock()
    out = []
    for it in load_wishlist():
        reqs = []
        for r in it["items"]:
            key, have = _have(r, counts, labels, cargo)
            m = MATERIALS.get(key) or {}
            reqs.append({"name": r["name"], "cat": r.get("cat"), "need": r["count"], "have": have,
                         "missing": max(0, r["count"] - have), "key": key,
                         "type": m.get("type"), "grade": m.get("grade"), "group": m.get("group"),
                         "tradeable": bool(m)})
        missing = [r for r in reqs if r["missing"]]
        out.append({"id": it["id"], "name": it["name"], "affordable": not missing, "items": reqs,
                    "missing": missing, "ready": len(reqs) - len(missing), "total": len(reqs)})
    return out


def _load_memory():
    data = storage.load_json(MEMORY_FILE, {}) or {}
    _announced.update(data.get("announced") or [])


def _save_memory():
    try:
        storage.save_json(MEMORY_FILE, {"announced": sorted(_announced)})
    except OSError:
        pass


def _say(text, spoken=None):
    ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    with STATE.lock:
        STATE.note(ts, text, "gold")
    if voice.load_config().get("enabled"):
        voice.say(spoken or text)
    print(f"[Ingegneri] {text}")


def _refresh(announce=True, gain=False):
    """Ricalcola la wishlist e annuncia i cambiamenti (da chiamare con _lock)."""
    items = _evaluate()
    changed = False
    for it in items:
        ok = {r["name"] for r in it["items"] if not r["missing"]}
        prev = _prev.get(it["id"])
        if it["affordable"]:
            if it["id"] not in _announced:
                _announced.add(it["id"])
                changed = True
                if announce:
                    _say(pick(f"Hai tutti i materiali per {it['name']}", f"You have all the materials for {it['name']}"))
        else:
            if it["id"] in _announced:
                _announced.discard(it["id"])
                changed = True
            if announce and gain and prev is not None:
                for name in sorted(ok - prev["ok"]):
                    left = len(it["missing"])
                    rest = "manca ancora 1 componente" if left == 1 else f"mancano ancora {left} componenti"
                    rest_en = "1 component still missing" if left == 1 else f"{left} components still missing"
                    _say(pick(f"Raccolto abbastanza {name} per {it['name']}: {rest}",
                              f"Collected enough {name} for {it['name']}: {rest_en}"),
                         pick(f"Hai abbastanza {name} per {it['name']}. {rest[0].upper() + rest[1:]}.",
                              f"You have enough {name} for {it['name']}. {rest_en[0].upper() + rest_en[1:]}."))
        _prev[it["id"]] = {"affordable": it["affordable"], "ok": ok}
    for gone in set(_prev) - {it["id"] for it in items}:
        _prev.pop(gone, None)
    if changed:
        _save_memory()
    return items


def _on_event(e):
    ev = e.get("event")
    if ev not in WATCH_EVENTS or not _ready["done"]:
        return
    with _lock:
        _refresh(announce=True, gain=ev in GAIN_EVENTS)


def start():
    _load_memory()
    journal.add_listener(_on_event)
    deadline = time.time() + 120
    while not STATE.live and time.time() < deadline:
        time.sleep(1)
    with _lock:
        _refresh(announce=False)
        _ready["done"] = True


def status():
    items = _evaluate()
    return {"items": items, "wishlist": load_wishlist()}


# --- Calcolatore del material trader ------------------------------------------------------

def trade_ratio(src, dst):
    """(dai, ricevi) per uno scambio da src a dst (dict di MATERIALS), oppure None se non si può."""
    if src["type"] != dst["type"] or src["key"] == dst["key"]:
        return None
    cross = src["group"] != dst["group"]
    d = dst["grade"] - src["grade"]
    if d > 0:
        return 6 ** (d + (1 if cross else 0)), 1
    if d < 0:
        offer, receive = (6 if cross else 1), 3 ** (-d)
        while offer % 3 == 0 and receive % 3 == 0:
            offer //= 3
            receive //= 3
        return offer, receive
    return (6, 1) if cross else None


def _value(m):
    """Euristica dell'app (non una regola del gioco): quanto 'vale' una unità, per scegliere cosa cedere: i gradi alti valgono di più (3 per grado),
    i materiali vicini al limite valgono meno (tanto ne raccoglieresti di più del massimo)."""
    return 3 ** (m["grade"] - 1)


def materials_list():
    counts, _, _ = _stock()
    out = []
    for t, groups in TRADE_GROUPS.items():
        for g, row in groups:
            for k in row.split():
                m = MATERIALS[k]
                out.append({**m, "count": counts.get(k, 0), "cap": GRADE_CAP.get(m["grade"])})
    return {"materials": out}


def _reserved():
    """Quantità che servono alla wishlist: il calcolatore non le propone come merce di scambio."""
    res = {}
    for it in load_wishlist():
        for r in it["items"]:
            k = resolve(r["name"])
            if k:
                res[k] = res.get(k, 0) + r["count"]
    return res


def plan(q):
    key = resolve(q.get("material"))
    dst = MATERIALS.get(key)
    if not dst:
        raise ValueError(pick("Materiale non scambiabile al material trader", "This material can't be traded at a Material Trader"))
    try:
        qty = max(1, min(1000, int(float(q.get("qty") or 1))))
    except ValueError:
        qty = 1
    keep_wishlist = str(q.get("keep", "1")) != "0"
    counts, _, _ = _stock()
    reserved = _reserved() if keep_wishlist else {}
    cap = GRADE_CAP.get(dst["grade"]) or 0
    have = counts.get(key, 0)

    options = []
    for src in MATERIALS.values():
        r = trade_ratio(src, dst)
        count = counts.get(src["key"], 0)
        if not r or count <= 0:
            continue
        offer, receive = r
        avail = max(0, count - reserved.get(src["key"], 0))
        trades = math.ceil(qty / receive)
        give = trades * offer
        src_cap = GRADE_CAP.get(src["grade"]) or 1
        fill = min(1.0, count / src_cap)
        cost = give * _value(src) * (1 - 0.6 * fill)   # materiale quasi al limite: costa meno cederlo
        options.append({
            "from": {**src, "count": count, "reserved": reserved.get(src["key"], 0), "available": avail,
                     "cap": src_cap},
            "offer": offer, "receive": receive, "trades": trades, "give": give, "get": trades * receive,
            "enough": avail >= give, "max_get": (avail // offer) * receive,
            "cross": src["group"] != dst["group"],
            "direction": "up" if src["grade"] < dst["grade"] else "down" if src["grade"] > dst["grade"] else "same",
            "cost": round(cost, 2)})
    options.sort(key=lambda o: (not o["enough"], o["cost"]))

    # Se nessuno da solo basta: combinazione golosa, dal più conveniente per unità ricevuta.
    combo, still = [], qty
    if options and not options[0]["enough"]:
        for o in sorted(options, key=lambda o: o["cost"] / max(1, o["get"])):
            if still <= 0:
                break
            n_trades = min(o["from"]["available"] // o["offer"], math.ceil(still / o["receive"]))
            if n_trades <= 0:
                continue
            combo.append({"from": o["from"], "offer": o["offer"], "receive": o["receive"], "trades": n_trades,
                          "give": n_trades * o["offer"], "get": n_trades * o["receive"]})
            still -= n_trades * o["receive"]
    best = next((o for o in options if o["enough"]), None)
    return {
        "target": {**dst, "count": have, "cap": cap}, "qty": qty, "keep_wishlist": keep_wishlist,
        "over_cap": have + (best["get"] if best else qty) > cap if cap else False,
        "best": best, "options": options[:8], "combo": combo if not best else [],
        "combo_short": max(0, still) if not best else 0, "trader": dst["type"],
    }


GET = {
    "/api/engineering/wishlist": lambda q: {"items": load_wishlist()},
    "/api/engineering/status": lambda q: status(),
    "/api/trader/materials": lambda q: materials_list(),
    "/api/trader/plan": plan,
}
POST = {"/api/engineering/wishlist": lambda body, q: save_wishlist(body)}
LAN = set()
