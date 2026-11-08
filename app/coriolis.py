"""Catalogo di navi e moduli per il configuratore, dai dati open source di Coriolis (EDCD/coriolis-data, MIT).

Scarica l'archivio del repository una volta, ne estrae solo i file JSON di navi e moduli
e salva un catalogo compatto in data/catalog.json. Si riaggiorna ogni 14 giorni.
Dal file modifications/ tiene anche le ricette di ingegneria (materiali per grado, effetti sperimentali,
ingegneri che applicano ogni blueprint) per la "lista della spesa" del cantiere.
"""

import io
import json
import os
import tarfile
import threading
import time
import urllib.request

from . import paths
from .gamedata import _GRADES, BLUEPRINTS, ENGINEER_ALIASES, MATERIAL_GRADE

# Il catalogo aggiornato sta nella cache dell'utente; quello incluso nel programma serve solo al primo avvio.
CATALOG_FILE = paths.cache_file("catalog.json")
SEED_FILE = os.path.join(paths.SEED_DATA_DIR, "catalog.json")
SOURCE = "https://codeload.github.com/EDCD/coriolis-data/tar.gz/refs/heads/master"
MAX_AGE = 14 * 86400
# Versione dello schema: un catalogo salvato con una versione inferiore va rigenerato.
# 3: blueprint con gli effetti per grado ("features"), effetti sperimentali ("actions") e metodo di ogni modificatore.
SCHEMA = 3

# Simbolo della nave nel journal -> chiave nel repository di Coriolis.
JOURNAL_TO_CORIOLIS = {
    "sidewinder": "sidewinder", "eagle": "eagle", "hauler": "hauler", "adder": "adder", "empire_eagle": "imperial_eagle",
    "viper": "viper", "cobramkiii": "cobra_mk_iii", "viper_mkiv": "viper_mk_iv", "diamondback": "diamondback",
    "cobramkiv": "cobra_mk_iv", "type6": "type_6_transporter", "dolphin": "dolphin", "diamondbackxl": "diamondback_explorer",
    "empire_courier": "imperial_courier", "independant_trader": "keelback", "asp_scout": "asp_scout", "vulture": "vulture",
    "asp": "asp", "federation_dropship": "federal_dropship", "type7": "type_7_transport", "typex": "alliance_chieftain",
    "federation_dropship_mkii": "federal_assault_ship", "empire_trader": "imperial_clipper", "typex_2": "alliance_crusader",
    "typex_3": "alliance_challenger", "federation_gunship": "federal_gunship", "krait_light": "krait_phantom",
    "krait_mkii": "krait_mkii", "orca": "orca", "ferdelance": "fer_de_lance", "mamba": "mamba", "python": "python",
    "python_nx": "python_nx", "type9": "type_9_heavy", "belugaliner": "beluga", "type9_military": "type_10_defender",
    "anaconda": "anaconda", "federation_corvette": "federal_corvette", "cutter": "imperial_cutter",
    "type8": "type_8_transport", "mandalay": "mandalay", "cobramkv": "cobramkv", "corsair": "imperial_corsair",
    "lakonminer": "type_11_prospector", "panthermkii": "panthermkii", "explorer_nx": "explorer_nx",
    "smallcombat01_nx": "kestrel",
}

# Statistiche dei moduli che il configuratore usa.
KEEP = ("optmass", "maxfuel", "fuelmul", "fuelpower", "pgen", "fuel", "cargo", "jumpboost", "minmass", "maxmass",
        "minmul", "optmul", "maxmul", "shieldboost", "hullreinforcement", "passengers", "rate", "bays", "bins",
        "shieldaddition", "protection", "engcap", "syscap", "wepcap", "engrate", "sysrate", "weprate", "eff",
        "range", "maximum", "mount", "damage", "ship", "restriction", "regen", "explres", "kinres", "thermres",
        "optmulspeed", "minmulspeed", "maxmulspeed", "boot", "ammo", "repair", "proberadius")

# Nome del materiale in Coriolis -> simbolo del journal, quando non basta togliere spazi e maiuscole.
MATERIAL_SYMBOLS = {
    "Atypical Disrupted Wake Echoes": "disruptedwakeechoes", "Anomalous FSD Telemetry": "fsdtelemetry",
    "Strange Wake Solutions": "wakesolutions", "Eccentric Hyperspace Trajectories": "hyperspacetrajectories",
    "Datamined Wake Exceptions": "dataminedwake", "Exceptional Scrambled Emission Data": "scrambledemissiondata",
    "Irregular Emission Data": "archivedemissiondata", "Unexpected Emission Data": "emissiondata",
    "Abnormal Compact Emissions Data": "compactemissionsdata", "Distorted Shield Cycle Recordings": "shieldcyclerecordings",
    "Inconsistent Shield Soak Analysis": "shieldsoakanalysis", "Untypical Shield Scans": "shielddensityreports",
    "Aberrant Shield Pattern Analysis": "shieldpatternanalysis", "Peculiar Shield Frequency Data": "shieldfrequencydata",
    "Unusual Encrypted Files": "encryptedfiles", "Tagged Encryption Codes": "encryptioncodes",
    "Open Symmetric Keys": "symmetrickeys", "Atypical Encryption Archives": "encryptionarchives",
    "Adaptive Encryptors Capture": "adaptiveencryptors", "Adaptive Encyptors Capture": "adaptiveencryptors",
    "Anomalous Bulk Scan Data": "bulkscandata", "Unidentified Scan Archives": "scanarchives",
    "Classified Scan Databanks": "scandatabanks", "Divergent Scan Data": "encodedscandata",
    "Classified Scan Fragment": "classifiedscandata", "Specialised Legacy Firmware": "legacyfirmware",
    "Modified Consumer Firmware": "consumerfirmware", "Cracked Industrial Firmware": "industrialfirmware",
    "Security Firmware Patch": "securityfirmware", "Modified Embedded Firmware": "embeddedfirmware",
    "Proprietary Composites": "fedproprietarycomposites", "Core Dynamics Composites": "fedcorecomposites",
    "Flawed Focus Crystals": "uncutfocuscrystals",
}
# Refusi nei nomi degli ingegneri di Coriolis -> nomi usati dal journal e da gamedata.ENGINEERS.
ENGINEER_FIX = {"Felicty Farseer": "Felicity Farseer", 'Tod "The Blaster" McQuinn': "Tod 'The Blaster' McQuinn",
                **ENGINEER_ALIASES}
_CATEGORY = {n: cat for cat, rows in _GRADES.items() for row in rows for n in row.split()}

_lock = threading.Lock()
_catalog = None


def _material(name):
    """Nome Coriolis -> [simbolo journal, categoria, grado] (None se sconosciuto)."""
    sym = MATERIAL_SYMBOLS.get(name) or "".join(c for c in name.lower() if c.isalnum())
    return [sym, _CATEGORY.get(sym), MATERIAL_GRADE.get(sym)] if sym in MATERIAL_GRADE else None


def _engineering(files):
    """Ricette compatte: blueprint -> materiali per grado, sperimentali, e per gruppo di modulo gli ingegneri
    con il grado massimo che sanno applicare (chi applica il grado N applica anche quelli inferiori)."""
    bps, sps, mods = files.get("blueprints", {}), files.get("specials", {}), files.get("modules", {})
    actions, defs = files.get("modifierActions", {}), files.get("modifications", {})
    # features: {grado: {attributo: [minimo, massimo]}} = effetto del grado dal tiro peggiore al migliore
    # (modifications/blueprints.json); actions: effetto fisso dello sperimentale (modifications/modifierActions.json).
    blueprints = {k: {"name": b.get("name"), "grades": {g: d.get("components", {}) for g, d in b.get("grades", {}).items()},
                      "features": {g: {a: v for a, v in (d.get("features") or {}).items()
                                       if isinstance(v, list) and len(v) == 2 and all(isinstance(x, (int, float)) for x in v)}
                                   for g, d in b.get("grades", {}).items()}}
                  for k, b in bps.items()}
    specials = {k: {"name": sp.get("name"), "components": sp.get("components", {}),
                    "actions": {a: v for a, v in (actions.get(k) or {}).items() if isinstance(v, (int, float))}}
                for k, sp in sps.items()}
    # Come si combina ogni modificatore col valore di base (modifications/modifications.json):
    # "multiplicative" = base * (1 + mod), "additive" = base + mod, "overwrite" = mod.
    methods = {k: d.get("method") for k, d in defs.items() if isinstance(d, dict) and d.get("type") in ("percentage", "numeric")}
    by_grp = {}
    for grp, m in mods.items():
        entry = {"bp": {}, "sp": [k for k in m.get("specials") or [] if k in specials]}
        for bp, d in (m.get("blueprints") or {}).items():
            eng = {}
            for g, gd in d.get("grades", {}).items():
                for e in gd.get("engineers", []):
                    e = ENGINEER_FIX.get(e, e)
                    eng[e] = max(eng.get(e, 0), int(g))
            entry["bp"][bp] = eng
        if entry["bp"] or entry["sp"]:
            by_grp[grp] = entry
    names = {n for b in blueprints.values() for comp in b["grades"].values() for n in comp}
    names |= {n for sp in specials.values() for n in sp["components"]}
    materials = {n: _material(n) for n in sorted(names)}
    unknown = [n for n, v in materials.items() if v is None]
    if unknown:
        print("Materiali Coriolis senza simbolo:", ", ".join(unknown))
    return {"blueprints": blueprints, "specials": specials, "engineering": by_grp, "bp_labels": BLUEPRINTS, "mod_methods": methods,
            "materials": {n: v for n, v in materials.items() if v}}


def _build(raw):
    ships, modules, eng_files = {}, [], {}
    with tarfile.open(fileobj=io.BytesIO(raw), mode="r:gz") as tar:
        for member in tar.getmembers():
            name = member.name.replace("\\", "/")
            if member.isfile() and "/modifications/" in name and name.endswith(".json"):
                key = name.rsplit("/", 1)[1][:-5]
                if key in ("blueprints", "specials", "modules", "modifierActions", "modifications"):
                    eng_files[key] = json.load(tar.extractfile(member))
                continue
            if not member.isfile() or not name.endswith(".json") or ("/ships/" not in name and "/modules/" not in name):
                continue
            data = json.load(tar.extractfile(member))
            if "/ships/" in name:
                for key, s in data.items():
                    p = s["properties"]
                    ships[key] = {
                        "key": key, "name": p["name"], "manufacturer": p.get("manufacturer"), "size": p.get("class"),
                        "hullMass": p.get("hullMass"), "reserveFuel": p.get("reserveFuelCapacity", 0),
                        "hullCost": p.get("hullCost") or s.get("retailCost"), "speed": p.get("speed"), "boost": p.get("boost"),
                        "baseShield": p.get("baseShieldStrength"), "baseArmour": p.get("baseArmour"),
                        "masslock": p.get("masslock"), "crew": p.get("crew"),
                        "slots": s["slots"], "defaults": s["defaults"],
                        "bulkheads": [{"id": b.get("id"), "name": b.get("name"), "mass": b.get("mass", 0),
                                       "cost": b.get("cost", 0), "hullboost": b.get("hullboost")} for b in s.get("bulkheads", [])],
                    }
            else:
                section = name.split("/modules/")[1].split("/")[0]
                for grp, items in data.items():
                    if not isinstance(items, list):
                        continue
                    for m in items:
                        if not isinstance(m, dict) or "id" not in m:
                            continue
                        entry = {"uid": section[0] + ":" + str(m["id"]), "id": m["id"], "grp": m.get("grp", grp), "section": section, "class": m.get("class"),
                                 "rating": m.get("rating"), "mass": m.get("mass", 0), "power": m.get("power", 0),
                                 # Coriolis mette costo 0 quando non conosce il prezzo (moduli pre-ingegnerizzati):
                                 # None = prezzo sconosciuto, non "gratis".
                                 "cost": m.get("cost") or (None if m.get("preEngineered") else 0), "symbol": (m.get("symbol") or "").lower(),
                                 "name": m.get("name") or m.get("ukName"), "pre": bool(m.get("preEngineered"))}
                        entry.update({k: m[k] for k in KEEP if k in m})
                        modules.append(entry)
    by_ship = {j: c for j, c in JOURNAL_TO_CORIOLIS.items() if c in ships}
    return {"updated": time.time(), "schema": SCHEMA, "ships": ships, "modules": modules, "journal_ships": by_ship,
            **_engineering(eng_files)}


def _download():
    req = urllib.request.Request(SOURCE, headers={"User-Agent": "ED-Helper/1.0"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def load(force=False):
    """Restituisce il catalogo, scaricandolo se manca o è vecchio. Non solleva eccezioni."""
    global _catalog
    with _lock:
        if _catalog is None:
            for candidate in (CATALOG_FILE, SEED_FILE):
                try:
                    with open(candidate, encoding="utf-8") as f:
                        _catalog = json.load(f)
                    break
                except (OSError, ValueError):
                    _catalog = None
        stale = (_catalog is None or time.time() - _catalog.get("updated", 0) > MAX_AGE
                 or _catalog.get("schema", 1) < SCHEMA)
        if not (stale or force):
            return _catalog
    try:
        catalog = _build(_download())
        os.makedirs(os.path.dirname(CATALOG_FILE), exist_ok=True)
        tmp = CATALOG_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(catalog, f, separators=(",", ":"))
        os.replace(tmp, CATALOG_FILE)
        with _lock:
            _catalog = catalog
    except Exception as exc:
        print(f"Catalogo Coriolis non aggiornato ({exc}).")
    return _catalog
