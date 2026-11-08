"""Tecnologia Guardian: cosa serve al Guardian Technology Broker, dove trovarlo e cosa ti manca.

FONTI (verificate a novembre 2026; tutto ciò che non era confermabile è stato tolto):
- Ricette del Technology Broker: tabella "Technology broker" di Inara (inara.cz/elite/techbroker/),
  incrociata voce per voce con blueprints.json di EDEngineer (github.com/msarilar/EDEngineer,
  EDEngineer/Resources/Data/blueprints.json, voci "Engineers": ["@Technology"]). Le due fonti coincidono su tutto
  tranne due quantità di Guardian Power Conduit (Guardian Plasma Charger Fixed Medium: 18 vs 19; Turreted Large:
  20 vs 26): lì usiamo il valore più alto (così "ti manca" non sottostima) e lo segnaliamo con "note".
- Nomi interni dei materiali/dati e dei commodity (come compaiono nei journal e in Cargo.json, in minuscolo):
  EDCD FDevIDs material.csv e commodity.csv (github.com/EDCD/FDevIDs). Il nome mostrato dei blueprint è
  "Fragment" come nel Name_Localised del journal reale (evento Materials, "guardian_moduleblueprint" ->
  "Guardian Module Blueprint Fragment"); FDevIDs lo chiama ancora "Segment".
- Nomi interni dei moduli (per riconoscere gli sblocchi già fatti dall'evento TechnologyBroker -> ItemsUnlocked):
  EDCD FDevIDs outfitting.csv. Formato dell'evento: EDDiscovery EliteDangerousCore,
  JournalTechBrokerSciResearchSAndR.cs (BrokerType, ItemsUnlocked[].Name, Commodities, Materials).
  Per le versioni "Modified" e per i fighter il nome interno non è documentato: niente rilevamento automatico.
- Tipi di struttura e blueprint che danno: Turtle = Module; Bear, Hammerbot, Bowl = Weapon;
  Robolobster, Squid, Stickyhand = Vessel. Stessa mappatura in due programmi indipendenti: SrvSurvey
  (github.com/njthomson/SrvSurvey, game/GuardianSiteData.cs) ed ED Odyssey Materials Helper
  (github.com/jixxed/ed-odyssey-materials-helper, HorizonsBlueprintContent.java).
- Elenco dei siti (sistema, corpo, tipo, coordinate): SrvSurvey allStructures.json / allRuins.json /
  allBeacons.json (dati dei rilevamenti Canonn/SrvSurvey). I siti consigliati e la procedura vengono dalla guida
  dell'Anti-Xeno Initiative (wiki.antixenoinitiative.com, pagine "guardianunlocks" ed "engineering-materials").
- Ancient Key dai Guardian Beacon per i siti Vessel: guide dei giocatori sul forum Frontier ("Walkthrough: Guardian
  Vessel Blueprints", "Quick-Guide to Guardian Fighters"); la coppia beacon Synuefe KU-F b44-4 -> struttura
  Synuefe EU-Q c21-15 A 1 compare uguale in quelle guide e in SrvSurvey allBeacons.json (relatedStructure).
"""

import json
import math
import os
import threading

from . import journal
from .lang import pick_d

# ---------------------------------------------------------------------------------------------------------------
# Oggetti: chiave = nome interno in minuscolo (journal / Cargo.json). kind: material (Materials Raw/Manufactured),
# data (Materials Encoded), commodity (stiva della nave, Cargo.json). Nomi: FDevIDs, salvo i blueprint (vedi sopra).
ITEMS = {
    # Guardian, manufactured (FDevIDs material.csv)
    "guardian_powercell": ("Guardian Power Cell", "material"),
    "guardian_powerconduit": ("Guardian Power Conduit", "material"),
    "guardian_techcomponent": ("Guardian Technology Component", "material"),
    "guardian_sentinel_weaponparts": ("Guardian Sentinel Weapon Parts", "material"),
    "guardian_sentinel_wreckagecomponents": ("Guardian Wreckage Components", "material"),
    # Guardian, encoded
    "guardian_moduleblueprint": ("Guardian Module Blueprint Fragment", "data"),
    "guardian_weaponblueprint": ("Guardian Weapon Blueprint Fragment", "data"),
    "guardian_vesselblueprint": ("Guardian Vessel Blueprint Fragment", "data"),
    "ancientbiologicaldata": ("Pattern Alpha Obelisk Data", "data"),
    "ancientculturaldata": ("Pattern Beta Obelisk Data", "data"),
    "ancienthistoricaldata": ("Pattern Gamma Obelisk Data", "data"),
    "ancientlanguagedata": ("Pattern Delta Obelisk Data", "data"),
    "ancienttechnologicaldata": ("Pattern Epsilon Obelisk Data", "data"),
    # Materiali normali usati dalle ricette
    "carbon": ("Carbon", "material"), "manganese": ("Manganese", "material"), "chromium": ("Chromium", "material"),
    "germanium": ("Germanium", "material"), "arsenic": ("Arsenic", "material"), "niobium": ("Niobium", "material"),
    "focuscrystals": ("Focus Crystals", "material"), "phasealloys": ("Phase Alloys", "material"),
    "heatresistantceramics": ("Heat Resistant Ceramics", "material"),
    # Commodity (FDevIDs commodity.csv: symbol -> nome)
    "hnshockmount": ("HN Shock Mount", "commodity"),
    "reinforcedmountingplate": ("Reinforced Mounting Plate", "commodity"),
    "heatsinkinterlink": ("Heatsink Interlink", "commodity"),
    "powergridassembly": ("Energy Grid Assembly", "commodity"),
    "diagnosticsensor": ("Hardware Diagnostic Sensor", "commodity"),
    "magneticemittercoil": ("Magnetic Emitter Coil", "commodity"),
    "coolinghoses": ("Micro-weave Cooling Hoses", "commodity"),
    "articulationmotors": ("Articulation Motors", "commodity"),
    "microcontrollers": ("Micro Controllers", "commodity"),
    "powertransferconduits": ("Power Transfer Bus", "commodity"),
    "thermalcoolingunits": ("Thermal Cooling Units", "commodity"),
    "powerconverter": ("Power Converter", "commodity"),
}

# Materiali Guardian da mostrare nel riepilogo del comandante.
GUARDIAN_ITEMS = [k for k in ITEMS if k.startswith(("guardian_", "ancient"))]


def _u(uid, name, group, cost, match=None, note=None):
    return {"id": uid, "name": name, "group": group, "cost": cost, "match": match, "note": note}


# match: ("prefix", s) oppure ("exact", s) sul nome interno in ItemsUnlocked (minuscolo); None = non rilevabile.
UNLOCKS = [
    # --- Moduli (Guardian Module Blueprint Fragment) ---
    _u("fsdbooster", "Guardian FSD Booster", "module",
       {"guardian_moduleblueprint": 1, "guardian_powercell": 21, "guardian_techcomponent": 21, "focuscrystals": 24,
        "hnshockmount": 8}, ("prefix", "int_guardianfsdbooster_")),
    _u("hullreinf", "Guardian Hull Reinforcement", "module",
       {"guardian_moduleblueprint": 1, "guardian_sentinel_wreckagecomponents": 21, "ancientculturaldata": 16,
        "ancienthistoricaldata": 16, "reinforcedmountingplate": 12}, ("prefix", "int_guardianhullreinforcement_")),
    _u("modulereinf", "Guardian Module Reinforcement", "module",
       {"guardian_moduleblueprint": 1, "guardian_sentinel_wreckagecomponents": 18, "ancienttechnologicaldata": 15,
        "guardian_powerconduit": 20, "reinforcedmountingplate": 9}, ("prefix", "int_guardianmodulereinforcement_")),
    _u("shieldreinf", "Guardian Shield Reinforcement", "module",
       {"guardian_moduleblueprint": 1, "guardian_powercell": 17, "guardian_techcomponent": 20,
        "ancientlanguagedata": 24, "diagnosticsensor": 8}, ("prefix", "int_guardianshieldreinforcement_")),
    _u("powerplant", "Guardian Hybrid Power Plant", "module",
       {"guardian_moduleblueprint": 1, "guardian_powerconduit": 18, "ancienttechnologicaldata": 21,
        "heatresistantceramics": 15, "powergridassembly": 10}, ("prefix", "int_guardianpowerplant_")),
    _u("powerdist", "Guardian Hybrid Power Distributor", "module",
       {"guardian_moduleblueprint": 1, "ancientbiologicaldata": 20, "guardian_powercell": 24, "phasealloys": 18,
        "heatsinkinterlink": 6}, ("prefix", "int_guardianpowerdistributor_")),

    # --- Armi (Guardian Weapon Blueprint Fragment) ---
    _u("gauss_f_s", "Guardian Gauss Cannon · Fixed Small", "weapon",
       {"guardian_weaponblueprint": 1, "guardian_powerconduit": 12, "guardian_sentinel_wreckagecomponents": 12,
        "guardian_sentinel_weaponparts": 15}, ("exact", "hpt_guardian_gausscannon_fixed_small")),
    _u("gauss_f_m", "Guardian Gauss Cannon · Fixed Medium", "weapon",
       {"guardian_weaponblueprint": 1, "guardian_powercell": 18, "guardian_techcomponent": 20, "manganese": 15,
        "magneticemittercoil": 6}, ("exact", "hpt_guardian_gausscannon_fixed_medium")),
    _u("plasma_f_s", "Guardian Plasma Charger · Fixed Small", "weapon",
       {"guardian_weaponblueprint": 1, "guardian_powercell": 12, "guardian_sentinel_weaponparts": 12,
        "guardian_techcomponent": 15}, ("exact", "hpt_guardian_plasmalauncher_fixed_small")),
    _u("plasma_f_m", "Guardian Plasma Charger · Fixed Medium", "weapon",
       {"guardian_weaponblueprint": 1, "guardian_powerconduit": 19, "guardian_sentinel_weaponparts": 16,
        "chromium": 14, "coolinghoses": 8}, ("exact", "hpt_guardian_plasmalauncher_fixed_medium"),
       {"it": "Guardian Power Conduit: le fonti indicano 18 o 19, qui contiamo 19.",
        "en": "Guardian Power Conduit: sources say 18 or 19, we count 19 here."}),
    _u("plasma_f_l", "Guardian Plasma Charger · Fixed Large", "weapon",
       {"guardian_weaponblueprint": 1, "guardian_powerconduit": 28, "guardian_sentinel_weaponparts": 20,
        "chromium": 28, "coolinghoses": 10}, ("exact", "hpt_guardian_plasmalauncher_fixed_large")),
    _u("plasma_t_s", "Guardian Plasma Charger · Turreted Small", "weapon",
       {"guardian_weaponblueprint": 1, "guardian_powercell": 12, "guardian_techcomponent": 12,
        "guardian_sentinel_weaponparts": 15}, ("exact", "hpt_guardian_plasmalauncher_turret_small")),
    _u("plasma_t_m", "Guardian Plasma Charger · Turreted Medium", "weapon",
       {"guardian_weaponblueprint": 2, "guardian_powerconduit": 21, "guardian_sentinel_weaponparts": 20,
        "chromium": 16, "articulationmotors": 8}, ("exact", "hpt_guardian_plasmalauncher_turret_medium")),
    _u("plasma_t_l", "Guardian Plasma Charger · Turreted Large", "weapon",
       {"guardian_weaponblueprint": 2, "guardian_powerconduit": 26, "guardian_sentinel_weaponparts": 24,
        "chromium": 26, "articulationmotors": 10}, ("exact", "hpt_guardian_plasmalauncher_turret_large"),
       {"it": "Guardian Power Conduit: le fonti indicano 20 o 26, qui contiamo 26.",
        "en": "Guardian Power Conduit: sources say 20 or 26, we count 26 here."}),
    _u("shard_f_s", "Guardian Shard Cannon · Fixed Small", "weapon",
       {"guardian_weaponblueprint": 1, "guardian_powerconduit": 12, "guardian_techcomponent": 12,
        "guardian_sentinel_weaponparts": 15}, ("exact", "hpt_guardian_shardcannon_fixed_small")),
    _u("shard_f_m", "Guardian Shard Cannon · Fixed Medium", "weapon",
       {"guardian_weaponblueprint": 1, "guardian_sentinel_wreckagecomponents": 20, "guardian_techcomponent": 18,
        "carbon": 14, "powertransferconduits": 12}, ("exact", "hpt_guardian_shardcannon_fixed_medium")),
    _u("shard_f_l", "Guardian Shard Cannon · Fixed Large", "weapon",
       {"guardian_weaponblueprint": 1, "guardian_sentinel_wreckagecomponents": 20, "guardian_techcomponent": 28,
        "carbon": 20, "microcontrollers": 18}, ("exact", "hpt_guardian_shardcannon_fixed_large")),
    _u("shard_t_s", "Guardian Shard Cannon · Turreted Small", "weapon",
       {"guardian_weaponblueprint": 1, "guardian_powerconduit": 12, "guardian_techcomponent": 15,
        "guardian_sentinel_weaponparts": 12}, ("exact", "hpt_guardian_shardcannon_turret_small")),
    _u("shard_t_m", "Guardian Shard Cannon · Turreted Medium", "weapon",
       {"guardian_weaponblueprint": 2, "guardian_sentinel_wreckagecomponents": 16, "guardian_techcomponent": 20,
        "carbon": 15, "microcontrollers": 12}, ("exact", "hpt_guardian_shardcannon_turret_medium")),
    _u("shard_t_l", "Guardian Shard Cannon · Turreted Large", "weapon",
       {"guardian_weaponblueprint": 2, "guardian_sentinel_wreckagecomponents": 20, "guardian_techcomponent": 26,
        "carbon": 28, "microcontrollers": 12}, ("exact", "hpt_guardian_shardcannon_turret_large")),

    # --- Versioni Modified (stesse quantità nelle due fonti) ---
    _u("mgauss_f_s", "Modified Guardian Gauss Cannon · Fixed Small", "modified",
       {"guardian_weaponblueprint": 1, "guardian_powerconduit": 3, "guardian_sentinel_wreckagecomponents": 3,
        "guardian_sentinel_weaponparts": 4, "niobium": 2}),
    _u("mgauss_f_m", "Modified Guardian Gauss Cannon · Fixed Medium", "modified",
       {"guardian_weaponblueprint": 1, "guardian_powercell": 5, "guardian_techcomponent": 5, "niobium": 4,
        "thermalcoolingunits": 2}),
    _u("mplasma_f_s", "Modified Guardian Plasma Charger · Fixed Small", "modified",
       {"guardian_weaponblueprint": 1, "guardian_powercell": 3, "guardian_sentinel_weaponparts": 3,
        "guardian_techcomponent": 4, "arsenic": 2}),
    _u("mplasma_f_m", "Modified Guardian Plasma Charger · Fixed Medium", "modified",
       {"guardian_weaponblueprint": 1, "guardian_powerconduit": 5, "guardian_sentinel_weaponparts": 5, "arsenic": 4,
        "powertransferconduits": 2}),
    _u("mshard_f_s", "Modified Guardian Shard Cannon · Fixed Small", "modified",
       {"guardian_weaponblueprint": 1, "guardian_powerconduit": 3, "guardian_sentinel_wreckagecomponents": 3,
        "guardian_sentinel_weaponparts": 4, "germanium": 2}),
    _u("mshard_f_m", "Modified Guardian Shard Cannon · Fixed Medium", "modified",
       {"guardian_weaponblueprint": 1, "guardian_sentinel_wreckagecomponents": 5, "guardian_techcomponent": 5,
        "germanium": 4, "powerconverter": 2}),

    # --- Fighter (Guardian Vessel Blueprint Fragment) ---
    _u("trident", "XG7 Trident (fighter)", "fighter",
       {"guardian_vesselblueprint": 1, "guardian_powercell": 25, "ancienttechnologicaldata": 26,
        "ancientculturaldata": 18, "guardian_techcomponent": 25}),
    _u("javelin", "XG8 Javelin (fighter)", "fighter",
       {"guardian_vesselblueprint": 1, "guardian_powercell": 25, "ancienttechnologicaldata": 26,
        "guardian_sentinel_wreckagecomponents": 18, "guardian_techcomponent": 25}),
    _u("lance", "XG9 Lance (fighter)", "fighter",
       {"guardian_vesselblueprint": 1, "guardian_powercell": 25, "ancienttechnologicaldata": 26,
        "guardian_sentinel_weaponparts": 18, "guardian_techcomponent": 25}),
]

# ---------------------------------------------------------------------------------------------------------------
# Siti. Sistema, corpo e tipo da SrvSurvey (allStructures/allRuins/allBeacons.json); "rec" = consigliato dalla
# guida AXI. Scelti tra i più vicini al gruppo di Synuefe, dove si trova la maggior parte dei siti.
SITES = {
    "weapon": {
        "title": "Weapon Blueprint", "item": "guardian_weaponblueprint",
        "layouts": "Bear, Hammerbot, Bowl", "needs": "Guardian Relic",
        "list": [
            {"system": "Synuefe GV-T b50-4", "body": "B 1", "type": "Bear", "rec": True},
            {"system": "Synuefe EU-Q c21-10", "body": "A 3", "type": "Bear"},
            {"system": "Synuefe PM-L c24-24", "body": "C 6", "type": "Bear"},
            {"system": "Synuefe FK-P c22-2", "body": "E 1", "type": "Hammerbot"},
        ],
    },
    "module": {
        "title": "Module Blueprint", "item": "guardian_moduleblueprint",
        "layouts": "Turtle", "needs": "Guardian Relic",
        "list": [
            {"system": "Synuefe LQ-T b50-1", "body": "B 2", "type": "Turtle", "rec": True},
            {"system": "Synuefe GT-H b43-1", "body": "C 4", "type": "Turtle"},
            {"system": "Synuefe NL-N c23-4", "body": "B 3", "type": "Turtle"},
            {"system": "Synuefe PX-J c25-8", "body": "7 a", "type": "Turtle"},
        ],
    },
    "vessel": {
        "title": "Vessel Blueprint (fighter)", "item": "guardian_vesselblueprint",
        "layouts": "Robolobster, Squid, Stickyhand", "needs": "Ancient Key",
        "list": [
            {"system": "Synuefe EU-Q c21-15", "body": "A 1", "type": "Squid", "beacon": "Synuefe KU-F b44-4"},
            {"system": "Synuefe NB-B b47-10", "body": "B 2", "type": "Robolobster"},
            {"system": "Synuefe GQ-N c23-21", "body": "B 3", "type": "Stickyhand"},
            {"system": "Synuefe DK-D b46-4", "body": "C 1", "type": "Squid"},
        ],
    },
}
# Altri siti utili (guida AXI; tipo e corpo confermati in SrvSurvey).
EXTRA_SITES = [
    {"system": "Synuefe XR-H d11-102", "body": "1 b", "type": "Ancient Ruins (Beta)",
     "what": {"it": "Pattern Obelisk Data: 4 obelischi attivi vicini tra loro",
              "en": "Pattern Obelisk Data: 4 active obelisks close together"}},
    {"system": "Synuefe HT-F d12-29", "body": "C 3", "type": "Guardian Structure (Crossroads)",
     "what": {"it": "Guardian Technology Component: 8 punti di raccolta, circa 24 a giro",
              "en": "Guardian Technology Component: 8 collection points, about 24 per run"}},
    {"system": "Synuefe KU-F b44-4", "body": "4", "type": "Guardian Beacon",
     "what": {"it": "Ancient Key per i siti Vessel (si può ripetere)",
              "en": "Ancient Key for the Vessel sites (repeatable)"}},
]
# StarPos dei sistemi sopra (SrvSurvey, campo starPos): solo per la distanza dal comandante.
POS = {
    "Synuefe GV-T b50-4": [663.46875, -127.5625, 27.25],
    "Synuefe EU-Q c21-10": [758.65625, -176.90625, -133.21875],
    "Synuefe PM-L c24-24": [706.6875, -158.875, 10.5],
    "Synuefe FK-P c22-2": [809.75, -104.96875, -104.5625],
    "Synuefe LQ-T b50-1": [728.5, -155.65625, 19.3125],
    "Synuefe GT-H b43-1": [749.0, -163.09375, -128.0625],
    "Synuefe NL-N c23-4": [860.125, -124.59375, -61.0625],
    "Synuefe PX-J c25-8": [649.6875, -124.25, 32.4375],
    "Synuefe EU-Q c21-15": [754.15625, -171.84375, -138.09375],
    "Synuefe NB-B b47-10": [643.4375, -113.84375, -61.5625],
    "Synuefe GQ-N c23-21": [655.53125, -66.34375, -62.1875],
    "Synuefe DK-D b46-4": [652.9375, -63.90625, -80.78125],
    "Synuefe XR-H d11-102": [357.34375, -49.34375, -74.75],
    "Synuefe HT-F d12-29": [665.78125, -131.96875, 38.65625],
    "Synuefe KU-F b44-4": [714.34375, -173.84375, -113.59375],
}


# ---------------------------------------------------------------------------------------------------------------
# Sblocchi già fatti: eventi TechnologyBroker nei journal (cache per file: nome -> (dimensione, mtime, nomi)).
_cache = {}
_lock = threading.Lock()


def _unlocked_names():
    names = set()
    with _lock:
        for path in journal.journal_files():
            try:
                st = os.stat(path)
            except OSError:
                continue
            key = (st.st_size, st.st_mtime)
            hit = _cache.get(path)
            if not hit or hit[0] != key:
                found = []
                try:
                    with open(path, encoding="utf-8", errors="replace") as f:
                        for line in f:
                            if '"TechnologyBroker"' not in line:
                                continue
                            try:
                                e = json.loads(line)
                            except ValueError:
                                continue
                            if e.get("event") != "TechnologyBroker":
                                continue
                            for it in e.get("ItemsUnlocked") or []:
                                n = (it.get("Name") or "").lower()
                                if n:
                                    found.append(n)
                except OSError:
                    pass
                hit = _cache[path] = (key, found)
            names.update(hit[1])
    return names


def _is_unlocked(match, names):
    if not match:
        return None  # non rilevabile
    how, s = match
    if how == "exact":
        return s in names
    return any(n.startswith(s) for n in names)


def _inventory():
    """Quantità possedute: materiali/dati dallo stato, commodity dalla stiva (Cargo.json)."""
    have = {}
    st = journal.STATE
    with st.lock:
        for k, m in st.materials.items():
            have[k] = m.get("count", 0)
        star_pos = (st.location or {}).get("star_pos")
        system = (st.location or {}).get("system")
        jdir = st.journal_dir
    try:
        with open(os.path.join(jdir, "Cargo.json"), encoding="utf-8") as f:
            cargo = json.load(f)
    except (OSError, ValueError):
        cargo = {}
    if (cargo.get("Vessel") or "Ship") == "Ship":
        for i in cargo.get("Inventory") or []:
            n = (i.get("Name") or "").lower()
            if n in ITEMS and ITEMS[n][1] == "commodity":
                have[n] = have.get(n, 0) + (i.get("Count") or 0)
    return have, star_pos, system


def status(q=None):
    have, star_pos, system = _inventory()
    names = _unlocked_names()
    unlocks = []
    for u in UNLOCKS:
        rows, missing = [], 0
        for k, need in u["cost"].items():
            name, kind = ITEMS[k]
            h = have.get(k, 0)
            short = max(0, need - h)
            missing += short
            rows.append({"key": k, "name": name, "kind": kind, "need": need, "have": h, "missing": short})
        unlocks.append({"id": u["id"], "name": u["name"], "group": u["group"], "note": pick_d(u["note"]),
                        "items": rows, "ready": missing == 0, "missing_total": missing,
                        "done": _is_unlocked(u["match"], names)})

    def dist(s):
        p = POS.get(s)
        return round(math.dist(p, star_pos), 1) if p and star_pos else None

    sites = {}
    for k, g in SITES.items():
        sites[k] = {**{x: g[x] for x in ("title", "layouts", "needs")}, "have": have.get(g["item"], 0),
                    "list": [{**s, "dist": dist(s["system"])} for s in g["list"]]}
    extra = [{**s, "what": pick_d(s["what"]), "dist": dist(s["system"])} for s in EXTRA_SITES]
    inv = [{"key": k, "name": ITEMS[k][0], "kind": ITEMS[k][1], "count": have.get(k, 0)} for k in GUARDIAN_ITEMS]
    return {"unlocks": unlocks, "sites": sites, "extra_sites": extra, "inventory": inv, "system": system}


GET = {"/api/guardian": status}
POST = {}
LAN = {"/api/guardian"}
