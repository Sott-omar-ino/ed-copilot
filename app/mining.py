"""Estrazione mineraria: core (motherlode), sessioni con tonnellate e crediti all'ora, storico dai journal.

Tutto viene ricostruito dai journal (stessa cartella letta da app/journal.py, SOLO lettura), come in app/bounty.py:
di ogni file si tengono solo gli eventi utili, in cache per nome + dimensione + data di modifica, così si rilegge
solo il journal che sta crescendo. Il pannello "Analisi degli asteroidi" in diretta resta in app/state.py (S.mining).

Campi del journal (manuale ufficiale Frontier, trascritto su https://elite-journal.readthedocs.io , pagine
"Other Events" e "Trade"; tipi in https://kayahr.github.io/ed-journal/interfaces/<Evento>.html):
  - ProspectedAsteroid: Materials [{Name, Name_Localised?, Proportion}], Content / Content_Localised
    ("High/Medium/Low"), MotherlodeMaterial? / MotherlodeMaterial_Localised? ("if it's a motherlode"), Remaining (%).
  - MiningRefined: Type, Type_Localised? (scritto quando la refinery produce 1 unità di cargo, cioè 1 t).
  - AsteroidCracked: Body ("when the player has broken up a 'Motherlode' asteroid for mining").
  - LaunchDrone: Type = Hatchbreaker, FuelTransfer, Collection, Prospector, Repair, Research, Decontamination.
  - MarketSell: Type, Count, SellPrice, TotalSale, AvgPricePaid. EjectCargo: Type, Count. Died.
  - Cargo.json: Inventory [{Name, Name_Localised, Count, Stolen}]; Market.json: StationName, StarSystem,
    Items [{Name "$platinum_name;", SellPrice, Demand}] (verificati sui file reali dell'utente, novembre 2026).
Nomi interni delle merci -> nomi inglesi: EDCD FDevIDs commodity.csv
(https://github.com/EDCD/FDevIDs/blob/master/commodity.csv), es. Opal = Void Opal, LowTemperatureDiamond =
Low Temperature Diamonds.

Definizioni di questa scheda (scelte dell'interfaccia, non regole del gioco):
  - una sessione va da un LoadGame al successivo (o allo Shutdown); compare solo se c'è attività di estrazione
    (ProspectedAsteroid, MiningRefined, AsteroidCracked, LaunchDrone Prospector); "limpet usati" conta tutti i
    LaunchDrone della sessione (anche Collector usati per altro);
  - "tempo attivo": somma delle pause fra due eventi di estrazione consecutivi, escluse quelle oltre 15 minuti;
    le tonnellate all'ora si calcolano su questo;
  - "durata": dal primo evento di estrazione all'ultimo evento di estrazione o di vendita di merce estratta
    (comprende il viaggio per vendere): i crediti all'ora si calcolano su questa;
  - merce estratta venduta: un MarketSell conta come estrazione solo fino alle tonnellate raffinate e non ancora
    vendute/espulse di quella merce (anche se vendi dopo aver chiuso il gioco); il ricavo va alla sessione in cui
    è stata raffinata. La morte (Died) azzera la merce estratta in stiva. Il trasferimento verso un Fleet Carrier
    non è seguito.
"""

import calendar
import json
import os
import re
import threading
import time

from . import journal, paths, storage, voice
from .journal import STATE
from .lang import pick, pick_d

CACHE_FILE = paths.cache_file("mining.json")
CONFIG_FILE = paths.user_file("mining_config.json")
VERSION = 1
DEFAULT_CONFIG = {"voice_core": True}
IDLE = 900            # scelta dell'interfaccia: pause oltre 15 minuti non contano nel tempo attivo
HISTORY_MAX = 30
CORES_MAX = 40

# Nomi inglesi (FDevIDs commodity.csv) delle merci che si estraggono negli anelli; chiave = nome interno minuscolo.
NAMES = {
    "alexandrite": "Alexandrite", "bauxite": "Bauxite", "benitoite": "Benitoite", "bertrandite": "Bertrandite",
    "bromellite": "Bromellite", "cobalt": "Cobalt", "coltan": "Coltan", "gallite": "Gallite", "gold": "Gold",
    "grandidierite": "Grandidierite", "hydrogenperoxide": "Hydrogen Peroxide", "indite": "Indite",
    "lepidolite": "Lepidolite", "liquidoxygen": "Liquid oxygen", "lithiumhydroxide": "Lithium Hydroxide",
    "lowtemperaturediamond": "Low Temperature Diamonds", "methaneclathrate": "Methane Clathrate",
    "monazite": "Monazite", "musgravite": "Musgravite", "opal": "Void Opal", "osmium": "Osmium",
    "painite": "Painite", "palladium": "Palladium", "platinum": "Platinum", "praseodymium": "Praseodymium",
    "rhodplumsite": "Rhodplumsite", "rutile": "Rutile", "samarium": "Samarium", "serendibite": "Serendibite",
    "silver": "Silver", "tritium": "Tritium", "uraninite": "Uraninite", "water": "Water",
}

# Merci che si trovano nei core (motherlode) di almeno un tipo di anello.
# Fonte: wiki Elite Dangerous, pagina "Mining", tabella per tipo di anello con le colonne "Core" e
# "Laser/Abrasion/Sub-surface" (https://elite-dangerous.fandom.com/wiki/Mining, letta a novembre 2026).
# Platinum e Painite: core solo negli anelli Metal Rich secondo le pagine "Platinum" e "Painite" della stessa wiki
# (negli anelli Metallic si estraggono col laser); su Platinum concordano le discussioni dei giocatori.
# Tritium NON è nella colonna Core (solo laser negli anelli Icy).
CORE_MATERIALS = ["Alexandrite", "Benitoite", "Bromellite", "Grandidierite", "Low Temperature Diamonds", "Monazite",
                  "Musgravite", "Painite", "Platinum", "Rhodplumsite", "Serendibite", "Void Opal"]

# Consigli per il core mining, tutti dalla wiki Elite Dangerous (che a sua volta cita il resoconto ufficiale
# "Content Recap: Beyond - Chapter Four Livestream - Mining and Squadrons" sul forum Frontier):
#   pagine "Pulse Wave Analyser", "Seismic Charge Launcher", "Abrasion Blaster", "Mining" (sezioni Probe e
#   Seismic Charge, tabella dei moduli), "Painite".
TIPS = [
    {"it": "Pulse Wave Analyser: un asteroide colorato in modo brillante e opaco ha un core; un colore spento e "
           "trasparente indica solo depositi di superficie.",
     "en": "Pulse Wave Analyser: a bright, opaque coloured asteroid has a core; a dull, transparent colour means "
           "surface deposits only."},
    {"it": "Prospector Limpet: serve al Seismic Charge Launcher per funzionare; conferma la composizione e rende "
           "puntabili le fessure (Fissures).",
     "en": "Prospector Limpet: the Seismic Charge Launcher needs it to work; it confirms the composition and makes "
           "the Fissures targetable."},
    {"it": "Seismic Charge Launcher: tieni premuto il grilletto per scegliere la potenza, poi pianta le cariche nelle "
           "fessure. Dopo 120 secondi esplodono insieme: troppo poche non rompono l'asteroide, troppe distruggono "
           "parte del materiale.",
     "en": "Seismic Charge Launcher: hold the trigger to set the strength, then plant the charges in the Fissures. "
           "After 120 seconds they detonate together: too few won't crack the asteroid, too many destroy part of "
           "the material."},
    {"it": "Allontanati oltre 2 km prima dell'esplosione: l'onda d'urto danneggia scudi e scafo e disturba sensori "
           "e HUD.",
     "en": "Move more than 2 km away before the detonation: the shockwave damages shields and hull and disrupts "
           "sensors and HUD."},
    {"it": "Abrasion Blaster per i depositi di superficie, Sub-surface Displacement Missile per quelli sotto la "
           "superficie. Per tutto serve una Refinery.",
     "en": "Abrasion Blaster for surface deposits, Sub-surface Displacement Missile for sub-surface ones. "
           "Everything needs a Refinery."},
    {"it": "Painite: negli anelli Metal Rich solo nei core (Seismic Charge), negli anelli Metallic solo in superficie "
           "(Mining Laser).",
     "en": "Painite: in Metal Rich rings only in cores (Seismic Charge), in Metallic rings only on the surface "
           "(Mining Laser)."},
    {"it": "Night Vision aiuta a vedere asteroidi e frammenti nella nube di detriti dopo l'esplosione di un core.",
     "en": "Night Vision helps you spot asteroids and fragments in the debris cloud after a core detonates."},
]

MINING_EVENTS = {"ProspectedAsteroid", "MiningRefined", "AsteroidCracked"}
# Solo il Prospector Limpet indica estrazione: i Collector servono anche per il recupero di carichi (salvage).
MINING_DRONES = {"Prospector"}
WANTED = MINING_EVENTS | {"LoadGame", "Shutdown", "LaunchDrone", "MarketSell", "EjectCargo", "Died",
                          "Location", "FSDJump", "CarrierJump"}
HEAD = re.compile(r'"event"\s*:\s*"([^"]+)"')
CONTENT = re.compile(r"AsteroidMaterialContent_(\w+);")

LOCK = threading.Lock()
FILES = None
_LAST = {"t": 0, "data": None}


def key(name):
    """'$lowtemperaturediamond_name;' / 'LowTemperatureDiamond' / 'Low Temperature Diamond' -> 'lowtemperaturediamond'."""
    s = str(name or "").strip().lower()
    if s.startswith("$"):
        s = s[1:]
    s = s.replace("_name;", "").rstrip(";").replace(" ", "")
    if s == "lowtemperaturediamonds":
        s = "lowtemperaturediamond"
    if s in ("voidopal", "voidopals"):
        s = "opal"
    return s


def display(name, localised=None):
    k = key(name)
    return NAMES.get(k) or localised or str(name or "?").strip("$;").replace("_name", "").title()


def _n(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else 0


def _epoch(ts):
    try:
        return calendar.timegm(time.strptime(ts[:19], "%Y-%m-%dT%H:%M:%S"))
    except (TypeError, ValueError):
        return None


def _content(e):
    m = CONTENT.search(e.get("Content") or "")
    if m:
        return m.group(1)
    return (e.get("Content_Localised") or "").replace("Material Content:", "").strip() or None


# --- Lettura dei journal (cache per file) ------------------------------------------

def _compact(e):
    keep = ("timestamp", "event", "Type", "Type_Localised", "Count", "SellPrice", "TotalSale", "AvgPricePaid",
            "MotherlodeMaterial", "MotherlodeMaterial_Localised", "Content", "Content_Localised", "Remaining",
            "Materials", "Body", "StarSystem", "Commander")
    return {k: e[k] for k in keep if k in e}


def _read_file(path):
    events = []
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            m = HEAD.search(line, 0, 200)
            if not m or m.group(1) not in WANTED:
                continue
            try:
                events.append(_compact(json.loads(line)))
            except ValueError:
                continue
    return events


def _load_files():
    global FILES
    if FILES is None:
        data = storage.load_json(CACHE_FILE, {}) or {}
        FILES = data.get("files", {}) if data.get("version") == VERSION else {}
    changed, seen = False, []
    for path in journal.journal_files():
        name = os.path.basename(path)
        try:
            st = os.stat(path)
        except OSError:
            continue
        sig = [st.st_size, int(st.st_mtime)]
        seen.append(name)
        cur = FILES.get(name)
        if cur and cur.get("sig") == sig:
            continue
        try:
            FILES[name] = {"sig": sig, "events": _read_file(path)}
            changed = True
        except OSError:
            pass
    for name in list(FILES):
        if name not in seen:
            del FILES[name]
            changed = True
    if changed:
        storage.save_json(CACHE_FILE, {"version": VERSION, "files": FILES})
    return [FILES[n] for n in seen if n in FILES]


# --- Sessioni ------------------------------------------------------------------------

def _session(ts):
    return {"start": ts, "end": ts, "first": None, "last": None, "last_t": None, "active": 0, "last_sale": None,
            "prospected": 0, "cores": [], "cracked": 0, "refined": {}, "sold": {}, "limpets": {}, "systems": [],
            "bodies": [], "ended": False}


def _fold(files):
    sessions, cur = [], None
    system = None
    stock = {}       # merce estratta in stiva non ancora venduta: chiave -> [[sessione, tonnellate], ...]

    def sess(ts):
        nonlocal cur
        if cur is None or cur["ended"]:
            cur = _session(ts)
            sessions.append(cur)
        return cur

    def mined(s, ts):
        t = _epoch(ts)
        if t is not None:
            if s["last_t"] is not None and 0 <= t - s["last_t"] <= IDLE:
                s["active"] += t - s["last_t"]
            s["last_t"] = t
        s["first"] = s["first"] or ts
        s["last"] = ts
        if system and system not in s["systems"]:
            s["systems"].append(system)

    for f in files:
        for e in f["events"]:
            ev, ts = e.get("event"), e.get("timestamp")
            if ev == "LoadGame":
                if cur is not None:
                    cur["ended"] = True
                cur = _session(ts)
                sessions.append(cur)
                continue
            if ev == "Shutdown":
                if cur is not None:
                    cur["end"] = ts
                    cur["ended"] = True
                continue
            if ev in ("Location", "FSDJump", "CarrierJump"):
                system = e.get("StarSystem") or system
                continue
            s = sess(ts)
            s["end"] = ts
            if ev == "ProspectedAsteroid":
                mined(s, ts)
                s["prospected"] += 1
                if e.get("MotherlodeMaterial"):
                    s["cores"].append({
                        "ts": ts, "key": key(e["MotherlodeMaterial"]),
                        "name": display(e["MotherlodeMaterial"], e.get("MotherlodeMaterial_Localised")),
                        "content": _content(e), "remaining": e.get("Remaining"), "system": system,
                        "materials": sorted(({"name": display(m.get("Name"), m.get("Name_Localised")),
                                              "pct": _n(m.get("Proportion"))} for m in e.get("Materials") or []),
                                            key=lambda m: -m["pct"])})
                    del s["cores"][:-CORES_MAX]
            elif ev == "MiningRefined":
                mined(s, ts)
                k = key(e.get("Type"))
                s["refined"][k] = s["refined"].get(k, 0) + 1
                lots = stock.setdefault(k, [])
                if lots and lots[-1][0] is s:
                    lots[-1][1] += 1
                else:
                    lots.append([s, 1])
            elif ev == "AsteroidCracked":
                mined(s, ts)
                s["cracked"] += 1
                if e.get("Body") and e["Body"] not in s["bodies"]:
                    s["bodies"].append(e["Body"])
            elif ev == "LaunchDrone":
                t = e.get("Type") or "?"
                if t in MINING_DRONES:
                    mined(s, ts)
                s["limpets"][t] = s["limpets"].get(t, 0) + 1   # tutti i limpet della sessione
            elif ev in ("MarketSell", "EjectCargo"):
                k = key(e.get("Type"))
                left = int(_n(e.get("Count")))
                price = _n(e.get("SellPrice"))
                lots = stock.get(k) or []
                while left > 0 and lots:   # la merce più vecchia esce per prima
                    origin, tons = lots[0]
                    used = min(left, tons)
                    if ev == "MarketSell":
                        sold = origin["sold"].setdefault(k, {"t": 0, "cr": 0})
                        sold["t"] += used
                        sold["cr"] += used * price
                        origin["last_sale"] = ts
                    left -= used
                    lots[0][1] -= used
                    if lots[0][1] <= 0:
                        lots.pop(0)
            elif ev == "Died":
                stock.clear()
    in_hold = {k: sum(t for _, t in lots) for k, lots in stock.items() if lots}
    return sessions, in_hold


def _is_mining(s):
    return bool(s["first"])


def _span(s):
    a, b = _epoch(s["first"]), _epoch(max(x for x in (s["last"], s["last_sale"]) if x))
    return max(0, b - a) if a is not None and b is not None else 0


def _out(s):
    tons = sum(s["refined"].values())
    sold_cr = sum(x["cr"] for x in s["sold"].values())
    sold_t = sum(x["t"] for x in s["sold"].values())
    span, active = _span(s), s["active"]
    keys = sorted(set(s["refined"]) | set(s["sold"]), key=lambda k: -s["refined"].get(k, 0))
    return {
        "start": s["start"], "first": s["first"], "last": s["last"], "last_sale": s["last_sale"], "end": s["end"],
        "ended": s["ended"], "span": span, "active": active,
        "tons": tons, "sold_t": sold_t, "sold_cr": sold_cr,
        # Tonnellate all'ora sul tempo attivo; crediti all'ora sulla durata (viaggio per vendere compreso).
        "tph": round(tons / (active / 3600), 1) if active >= 300 and tons else None,
        "crh": round(sold_cr / (span / 3600)) if span >= 300 and sold_cr else None,
        "prospected": s["prospected"], "cores_found": len(s["cores"]), "cracked": s["cracked"],
        "cores": list(reversed(s["cores"])), "limpets": s["limpets"], "limpets_total": sum(s["limpets"].values()),
        "systems": s["systems"][:6], "bodies": s["bodies"][:6],
        "commodities": [{"key": k, "name": NAMES.get(k, k.title()), "refined": s["refined"].get(k, 0),
                         "sold_t": s["sold"].get(k, {}).get("t", 0), "sold_cr": s["sold"].get(k, {}).get("cr", 0)}
                        for k in keys],
    }


def _read_game_json(name):
    try:
        with open(os.path.join(paths.JOURNAL_DIR, name), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def _cargo(in_hold):
    """Merce estratta ora in stiva (Cargo.json), limitata alle tonnellate raffinate e non ancora vendute."""
    out = []
    for i in _read_game_json("Cargo.json").get("Inventory") or []:
        k = key(i.get("Name"))
        if in_hold.get(k):
            out.append({"key": k, "name": NAMES.get(k) or i.get("Name_Localised") or k.title(),
                        "count": min(int(_n(i.get("Count"))), in_hold[k])})
    return out


def _market(keys):
    """Prezzi del mercato dove sei attraccato (Market.json scritto dal gioco), solo se è la stazione attuale."""
    loc = STATE.location
    m = _read_game_json("Market.json")
    if not keys or not loc.get("docked") or not m or m.get("StationName") != loc.get("station"):
        return None
    prices = {}
    for it in m.get("Items") or []:
        k = key(it.get("Name"))
        if k in keys and _n(it.get("SellPrice")) > 0:
            prices[k] = {"sell": it["SellPrice"], "demand": it.get("Demand")}
    return {"station": m.get("StationName"), "system": m.get("StarSystem"), "ts": m.get("timestamp"),
            "prices": prices}


# --- Configurazione -------------------------------------------------------------------

def load_config():
    cfg = {**DEFAULT_CONFIG, **(storage.load_json(CONFIG_FILE, {}) or {})}
    cfg["voice_core"] = bool(cfg["voice_core"])
    return cfg


def save_config(body):
    cfg = load_config()
    if "voice_core" in (body or {}):
        cfg["voice_core"] = bool(body["voice_core"])
    storage.save_json(CONFIG_FILE, {k: cfg[k] for k in DEFAULT_CONFIG})
    _LAST["t"] = 0
    return overview()


# --- API ------------------------------------------------------------------------------

def overview(force=False):
    with LOCK:
        if not force and _LAST["data"] is not None and time.time() - _LAST["t"] < 2:
            return _LAST["data"]
        sessions, in_hold = _fold(_load_files())
    last = sessions[-1] if sessions else None
    current = last if last and not last["ended"] and _is_mining(last) else None
    past = [s for s in sessions if _is_mining(s) and s is not current]
    cargo = _cargo(in_hold)
    data = {
        "current": _out(current) if current else None,
        "history": [_out(s) for s in reversed(past[-HISTORY_MAX:])],
        "cargo": cargo,
        "market": _market({c["key"] for c in cargo}),
        "config": load_config(),
        "core_materials": CORE_MATERIALS,
        "tips": [pick_d(t) for t in TIPS],
        "voice_enabled": bool(voice.load_config().get("enabled")),
    }
    with LOCK:
        _LAST.update(t=time.time(), data=data)
    return data


def _on_event(e):
    if e.get("event") != "ProspectedAsteroid" or not e.get("MotherlodeMaterial"):
        return
    if not load_config()["voice_core"] or not voice.load_config().get("enabled"):
        return
    name = display(e["MotherlodeMaterial"], e.get("MotherlodeMaterial_Localised"))
    content = _content(e)
    extra = {"High": pick(" Contenuto alto.", " High content."), "Medium": pick(" Contenuto medio.", " Medium content."),
             "Low": pick(" Contenuto basso.", " Low content.")}.get(content, "")
    voice.say(pick(f"Core di {name}!{extra}", f"{name} core!{extra}"))


def start():
    try:
        overview(force=True)   # prima lettura in background: crea la cache
    except Exception as exc:
        print(f"[Estrazione] {exc!r}")


journal.add_listener(_on_event)

GET = {"/api/mining/session": lambda q: overview()}
POST = {"/api/mining/config": lambda body, q: save_config(body)}
LAN = set()
