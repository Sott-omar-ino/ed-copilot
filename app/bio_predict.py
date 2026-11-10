"""Previsione delle specie esobiologiche nei corpi del sistema attuale, e avviso quando conviene atterrare.

Le regole (dove può crescere ogni specie) sono in app/bio_rules.py, convertite da EDMC-BioScan (Silarn,
GPL v2 o successiva, vedi l'intestazione di quel file). La logica di valutazione qui sotto è riscritta seguendo la
funzione value_estimate() di BioScan (src/load.py, commit fc6b85c3), regola per regola:
  atmosphere          AtmosphereType del corpo nell'elenco ('Any' = qualunque atmosfera tranne nessuna)
  atmosphere_component  percentuale minima di un gas (AtmosphereComposition)
  min/max_gravity     SurfaceGravity / 9.797759 (g)
  min/max_temperature SurfaceTemperature (K); ignorata se manca
  min/max_pressure    SurfacePressure / 101231.65625 (atm); ignorata se manca; il massimo è escluso (>=)
  max_orbital_period  OrbitalPeriod (s), escluso
  volcanism           'None' = niente vulcanismo, 'Any' = qualunque, lista = una delle parole nel testo
                      ('=' davanti = testo identico), '!x' = vulcanismo presente ma non di tipo x
  body_type           PlanetClass
  regions             regione galattica (dalle coordinate, app/regionmap.py), '!' davanti = esclusa
  guardian / tuber    distanza dalle zone Guardian / dei Sinuous Tubers
  bodies              nel sistema c'è almeno un corpo di questi tipi
  star                nel sistema c'è una stella di questa classe (eventualmente con luminosità)
  parent_star         la stella principale o una stella madre del corpo è di questa classe
  nebula              vicino a una nebulosa: NON controllata qui (servirebbe l'elenco delle nebulose), la specie
                      resta "da verificare"
  distance            DistanceFromArrivalLS minima
  system              nome del sistema
  (la chiave 'region' al singolare, presente in alcune regole dei Brain Tree, BioScan la ignora: idem qui)
Poi, come BioScan, si scartano le specie senza un colore possibile: i colori dipendono dalla classe della stella
madre (o della stella principale) o da un materiale del corpo (GENERA[...]['colors'] in bio_rules.py).

Differenze volute rispetto a BioScan, tutte prudenti (al massimo lasciano una specie in più, mai una in meno):
- se la regola dipende da stelle/corpi e il sistema non è ancora stato scansionato tutto, la specie resta
  "da verificare" invece di sparire; idem senza coordinate (regione, zone) e per le nebulose;
- il controllo dei colori si salta se una stella madre non è stata scansionata, se nel sistema c'è un buco nero
  (BioScan in quel caso guarda anche le stelle che gli orbitano attorno) o se mancano i materiali del corpo;
- nelle regole 'star' alcune coppie (classe, luminosità) sono scritte come liste nei sorgenti di BioScan, che
  così non le riconosce mai: qui valgono come coppie.

Valore: valore base della specie (stessi numeri di gamedata.SPECIES_VALUES) x5 se nessuno ha mai messo piede sul
corpo (WasFootfalled = false) e il sistema non è abitato: è la regola di BioScan (load.py get_bodies_summary:
mult = 5 if was_footfalled is False and not system_populated), coerente con app/bio.py (Bonus = 4 x Value).
Stima per corpo con N segnali: minimo = somma dei N generi possibili meno ricchi (valore della specie più povera),
massimo = somma dei N generi più ricchi (specie più ricca). Dopo il DSS i generi sono quelli rilevati.
Su un corpo cresce al massimo una specie per genere (come assume BioScan: una stima per genere).
"""

import json
import math
import os
import re
import threading
import time

from . import bio_rules, journal, paths, storage, voice
from .journal import STATE
from .lang import pick

CONFIG_FILE = paths.user_file("bio_predict_config.json")
DEFAULT_CONFIG = {"voice": True, "feed": True, "min_value": 10_000_000}
G = 9.797759            # m/s² per g, come BioScan
ATM = 101231.656250     # Pa per atm, come BioScan
QUIET_S = 4.0           # attesa dopo l'ultima scansione prima di parlare (raggruppa gli annunci)
MAX_FILES = 8           # journal da leggere all'indietro per ricostruire la visita al sistema attuale

_EVENTS = ("FSDJump", "CarrierJump", "Location", "Scan", "FSSBodySignals", "SAASignalsFound", "ScanOrganic",
           "FSSAllBodiesFound", "FSSDiscoveryScan")
_TAGS = tuple(f'"event":"{e}"' for e in _EVENTS)
_lock = threading.Lock()
_file_cache = {}
_announced = {}         # indirizzo del sistema -> {(BodyID, fase)}
_pending = {"since": 0.0}
_wake = threading.Event()
_started = False

GENUS_NAME = {gid: g["name"] for gid, g in bio_rules.GENERA.items()}
# Nomi con cui il journal chiama alcuni generi "singoli" (Species_Localised): stessi oggetti di BioScan.
_ALIAS = {"Bark Mounds": "Bark Mound"}


# --- Config ------------------------------------------------------------------------------------

def load_config():
    data = storage.load_json(CONFIG_FILE, {})
    cfg = {**DEFAULT_CONFIG, **(data if isinstance(data, dict) else {})}
    try:
        cfg["min_value"] = max(0, min(500_000_000, int(float(cfg["min_value"]))))
    except (TypeError, ValueError):
        cfg["min_value"] = DEFAULT_CONFIG["min_value"]
    cfg["voice"], cfg["feed"] = bool(cfg["voice"]), bool(cfg["feed"])
    return cfg


def save_config(changes):
    cfg = {**load_config(), **{k: v for k, v in (changes or {}).items() if k in DEFAULT_CONFIG}}
    storage.save_json(CONFIG_FILE, cfg)
    return status()


# --- Lettura dei journal -----------------------------------------------------------------------

def _file_events(path):
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
            if any(t in line for t in _TAGS):
                try:
                    out.append(json.loads(line))
                except ValueError:
                    pass
    with _lock:
        _file_cache[path] = (key, out)
        for p in [p for p in _file_cache if p != path][:-MAX_FILES]:
            _file_cache.pop(p, None)
    return out


def current_visit():
    """Eventi del sistema attuale negli ultimi journal, in ordine. Anche le visite precedenti: i dati dei corpi
    non cambiano e così restano validi i corpi scansionati un'altra volta (le scansioni più recenti prevalgono)."""
    files = journal.journal_files()[-MAX_FILES:]
    evs = [e for path in files for e in _file_events(path)]
    last = next((e for e in reversed(evs) if e.get("event") in ("FSDJump", "CarrierJump", "Location")
                 and e.get("SystemAddress") is not None), None)
    if not last:
        return []
    addr = last["SystemAddress"]
    out = [e for e in evs if e.get("SystemAddress") == addr and e.get("event") not in ("FSDJump", "CarrierJump", "Location")]
    return [last] + out


# --- Modello del sistema -----------------------------------------------------------------------

def _short(name, system):
    """Come ExploData get_body_name: il nome senza il prefisso del sistema."""
    if name and system and name.startswith(system + " "):
        return name[len(system) + 1:]
    return name or ""


def build_system(events):
    """Dati del sistema dagli eventi del journal (Scan, segnali, ScanOrganic)."""
    sy = {"name": None, "address": None, "pos": None, "population": 0, "all_found": False,
          "stars": {}, "planets": {}, "classes": set()}
    for e in events:
        ev = e.get("event")
        if ev in ("FSDJump", "CarrierJump", "Location"):
            sy.update(name=e.get("StarSystem") or sy["name"], address=e.get("SystemAddress"),
                      pos=e.get("StarPos") or sy["pos"], population=e.get("Population") or 0)
        elif ev == "FSSAllBodiesFound":
            sy["all_found"] = True
        elif ev == "Scan":
            sysname = e.get("StarSystem") or sy["name"]
            short = _short(e.get("BodyName"), sysname)
            if e.get("StarType"):
                # Nome breve della stella ("A", "B"...); la stella principale si chiama come il sistema.
                sy["stars"][short] = {"type": e["StarType"], "lum": e.get("Luminosity") or "",
                                      "dist": e.get("DistanceFromArrivalLS") or 0}
                sy["classes"].add(e["StarType"])
            elif e.get("PlanetClass"):
                sy["classes"].add(e["PlanetClass"])
                p = sy["planets"].setdefault(e.get("BodyID"), {"bio": 0, "genera": [], "found": {}})
                m = re.match(r"^([A-Z]+) .+$", short)  # stelle madri dal nome, come ExploData
                p.update(id=e.get("BodyID"), name=e.get("BodyName"), short=short, cls=e["PlanetClass"],
                         landable=bool(e.get("Landable")), atmo=e.get("AtmosphereType") or "None",
                         gases={g.get("Name"): g.get("Percent") or 0 for g in e.get("AtmosphereComposition") or []},
                         volcanism=e.get("Volcanism") or "",
                         gravity=(e.get("SurfaceGravity") or 0) / G, temp=e.get("SurfaceTemperature"),
                         pressure=(e["SurfacePressure"] / ATM) if e.get("SurfacePressure") else None,
                         dist=e.get("DistanceFromArrivalLS") or 0, period=e.get("OrbitalPeriod") or 0,
                         materials={x.get("Name") for x in e.get("Materials") or []} if "Materials" in e else None,
                         footfall=e.get("WasFootfalled"),
                         parents=list(m.group(1)) if m else [sysname])
        elif ev in ("FSSBodySignals", "SAASignalsFound"):
            p = sy["planets"].setdefault(e.get("BodyID"), {"bio": 0, "genera": [], "found": {}})
            p.setdefault("name", e.get("BodyName"))
            for s in e.get("Signals") or []:
                if s.get("Type") == "$SAA_SignalType_Biological;":
                    p["bio"] = s.get("Count") or 0
            if e.get("Genuses"):
                p["genera"] = [GENUS_NAME.get(g.get("Genus"), g.get("Genus_Localised")) for g in e["Genuses"]]
        elif ev == "ScanOrganic":
            p = sy["planets"].setdefault(e.get("Body"), {"bio": 0, "genera": [], "found": {}})
            genus = GENUS_NAME.get(e.get("Genus"), e.get("Genus_Localised"))
            p["found"][genus] = {"id": e.get("Species"), "name": e.get("Species_Localised"),
                                 "done": e.get("ScanType") == "Analyse" or p["found"].get(genus, {}).get("done", False)}
    if sy["pos"]:
        from .regionmap import findRegion  # 230 kB di dati: solo quando serve
        r = findRegion(*sy["pos"])
        sy["region"] = r[0] if r else None
    else:
        sy["region"] = None
    sy["main_star"] = next((s for s in sy["stars"].values() if not s["dist"]), None)
    return sy


# --- Regole ------------------------------------------------------------------------------------

def star_check(query, star_type):
    """BioScan body_data/util.py star_check: classe semplice contro StarType del journal."""
    star_type = star_type or ""
    if query == "A":
        return star_type in ("A", "A_BlueWhiteSuperGiant")
    if query == "B":
        return star_type in ("B", "B_BlueWhiteSuperGiant")
    if query == "F":
        return star_type in ("F", "F_WhiteSuperGiant")
    if query == "G":
        return star_type in ("G", "G_WhiteSuperGiant")
    if query == "K":
        return star_type in ("K", "K_OrangeGiant")
    if query == "M":
        return star_type in ("M", "M_RedGiant", "M_RedSuperGiant")
    if query in ("D", "C", "W"):
        return star_type.startswith(query)
    return star_type == query


def _star_match(info, star):
    if isinstance(info, list):  # (classe, luminosità): la luminosità può avere a, b, ab, z in coda
        return star_check(info[0], star["type"]) and any(info[1] + f == star["lum"] for f in ("", "a", "b", "ab", "z"))
    return star_check(info, star["type"])


def _dist(a, b):
    return math.dist(a, b)


def check_rule(rule, p, sy):
    """'ok', 'no' oppure ('?', motivo) per una regola su un corpo."""
    unsure = []
    for key, val in rule.items():
        if key == "atmosphere":
            if val == "Any":
                if p["atmo"] in ("", "None"):
                    return "no"
            elif p["atmo"] not in val:
                return "no"
        elif key == "atmosphere_component":
            if any((p["gases"].get(gas) or 0) < pct for gas, pct in val.items()):
                return "no"
        elif key == "max_gravity":
            if p["gravity"] > val:
                return "no"
        elif key == "min_gravity":
            if p["gravity"] < val:
                return "no"
        elif key == "max_temperature":
            if p["temp"] and p["temp"] > val:
                return "no"
        elif key == "min_temperature":
            if p["temp"] and p["temp"] < val:
                return "no"
        elif key == "min_pressure":
            if p["pressure"] and p["pressure"] < val:
                return "no"
        elif key == "max_pressure":
            if p["pressure"] and p["pressure"] >= val:
                return "no"
        elif key == "max_orbital_period":
            if p["period"] >= val:
                return "no"
        elif key == "volcanism":
            v = p["volcanism"]
            if isinstance(val, list):
                if not any((v == t[1:]) if t.startswith("=") else (t in v) for t in val):
                    return "no"
            elif val == "Any":
                if not v:
                    return "no"
            elif val == "None":
                if v:
                    return "no"
            elif val.startswith("!"):
                if not v or val[1:] in v:
                    return "no"
        elif key == "body_type":
            if p["cls"] not in val:
                return "no"
        elif key == "regions":
            if sy["region"] is None:
                unsure.append(pick("regione", "region"))
                continue
            groups = bio_rules.REGION_GROUPS
            if any(r.startswith("!") and sy["region"] in groups[r[1:]] for r in val):
                return "no"
            wanted = [r for r in val if not r.startswith("!")]
            if wanted and not any(sy["region"] in groups[r] for r in wanted):
                return "no"
        elif key == "guardian":
            if not sy["pos"]:
                unsure.append(pick("zona", "zone"))
                continue
            inside = any(_dist(sy["pos"], c) < d for d, c in bio_rules.GUARDIAN_ZONES.values())
            if val and not inside:
                return "no"
        elif key == "tuber":
            if not sy["pos"]:
                unsure.append(pick("zona", "zone"))
                continue
            if not any(lo <= _dist(sy["pos"], c) <= hi for z, ((lo, hi), c) in bio_rules.TUBER_ZONES.items()
                       if val == "Any" or z in val):
                return "no"
        elif key == "bodies":
            if not any(c in sy["classes"] for c in val):
                if not sy["all_found"]:
                    unsure.append(pick("corpi del sistema", "system bodies"))
                    continue
                return "no"
        elif key in ("star", "parent_star"):
            if key == "star":
                stars = list(sy["stars"].values())
                vals = val if isinstance(val, list) else [val]
            else:
                stars = [s for s in [sy["main_star"]] + [sy["stars"].get(x) for x in p["parents"]] if s]
                vals = val
            if not any(_star_match(i, s) for s in stars for i in vals):
                missing = key == "parent_star" and any(x not in sy["stars"] for x in p["parents"])
                if missing or not sy["all_found"]:
                    unsure.append(pick("stelle", "stars"))
                    continue
                return "no"
        elif key == "nebula":
            unsure.append(pick("nebulosa", "nebula"))
        elif key == "distance":
            if p["dist"] < val:
                return "no"
        elif key == "system":
            if sy["name"] != val:
                return "no"
    return ("?", ", ".join(dict.fromkeys(unsure))) if unsure else "ok"


def _colors_ok(species, p, sy):
    """Come BioScan: una specie senza colori possibili non c'è. None = controllo non fattibile."""
    colors = bio_rules.GENERA.get(species["genus"], {}).get("colors")
    if not colors:
        return True
    spec = colors["species"].get(species["id"]) if "species" in colors else colors
    if not spec:
        return True
    if "element" in spec:
        if p["materials"] is None:
            return None
        return any(el in p["materials"] for el in spec["element"])
    if "star" in spec:
        if any(x not in sy["stars"] for x in p["parents"]) or any(s["type"] == "H" for s in sy["stars"].values()):
            return None
        stars = [sy["stars"][x] for x in p["parents"]] + [s for s in sy["stars"].values() if not s["dist"]]
        return any(star_check(q, s["type"]) for s in stars for q in spec["star"])
    return True


def species_for(p, sy):
    """{genere: [specie possibili]}, ognuna con lo stato 'ok' (condizioni tutte verificate) o '?'."""
    out = {}
    for s in bio_rules.SPECIES:
        best = None
        for rule in s["rules"]:
            r = check_rule(rule, p, sy)
            if r == "ok":
                best = r
                break
            if r != "no" and best is None:
                best = r
        if best is None:
            continue
        col = _colors_ok(s, p, sy)
        if col is False:
            continue
        why = best[1] if isinstance(best, tuple) else ""
        if col is None and best == "ok":
            why = pick("colore", "colour")
        genus = GENUS_NAME.get(s["genus"], s["genus"])
        out.setdefault(genus, []).append({"name": s["name"], "value": s["value"], "sure": not why, "why": why})
    for g in out.values():
        g.sort(key=lambda x: -x["value"])
    return out


def _genus_all(genus):
    return sorted(({"name": s["name"], "value": s["value"], "sure": False, "why": pick("fuori dalle regole", "outside the rules")}
                   for s in bio_rules.SPECIES if GENUS_NAME.get(s["genus"]) == genus and s["rules"]),
                  key=lambda x: -x["value"])


def predict_body(p, sy, codex_species=()):
    mult = 5 if p.get("footfall") is False and not sy["population"] else 1
    cand = species_for(p, sy)
    detected = list(dict.fromkeys(p.get("genera") or []))
    genera = []
    names = detected or sorted(cand)
    for g in names:
        found = p["found"].get(g)
        if found:
            name = _ALIAS.get(found["name"], found["name"])
            val = next((s["value"] for s in bio_rules.SPECIES if s["id"] == found["id"] or s["name"] == name), 0)
            sp = [{"name": name, "value": val, "sure": True, "why": "", "scanned": True, "done": found["done"]}]
        else:
            sp = cand.get(g) or (_genus_all(g) if detected else [])
        if not sp:
            continue
        for s in sp:
            s["new"] = bool(codex_species) and s["name"] not in codex_species
        vals = [s["value"] for s in sp]
        genera.append({"genus": g, "species": sp, "min": min(vals) * mult, "max": max(vals) * mult,
                       "detected": bool(detected), "outside": not found and g not in cand})
    n = max(p.get("bio") or 0, len(p["found"]))  # specie già trovate anche senza FSS/DSS
    if detected:
        lo, hi = sum(g["min"] for g in genera), sum(g["max"] for g in genera)
    else:
        # I generi già trovati col campionatore ci sono di sicuro; gli altri segnali si riempiono con i possibili.
        sure = [g for g in genera if g["genus"] in p["found"]]
        rest = [g for g in genera if g["genus"] not in p["found"]]
        k = min(max(0, n - len(sure)), len(rest))
        lo = sum(g["min"] for g in sure) + sum(sorted(g["min"] for g in rest)[:k])
        hi = sum(g["max"] for g in sure) + sum(sorted((g["max"] for g in rest), reverse=True)[:k])
    genera.sort(key=lambda g: -g["max"])
    return {"id": p.get("id"), "name": p.get("name"), "short": p.get("short") or _short(p.get("name"), sy["name"]),
            "cls": p.get("cls"), "atmo": p.get("atmo"), "gravity": round(p["gravity"], 3) if p.get("gravity") else None,
            "temp": round(p["temp"]) if p.get("temp") else None, "volcanism": p.get("volcanism"),
            "dist": round(p["dist"]) if p.get("dist") is not None else None, "landable": p.get("landable"),
            "bio": n, "dss": bool(detected), "footfall": p.get("footfall"), "mult": mult,
            "genera": genera, "min": lo, "max": hi, "unexplained": max(0, n - len(genera)),
            "scanned": "cls" in p}


def predict(events=None, cfg=None, codex_species=None):
    cfg = cfg or load_config()
    sy = build_system(current_visit() if events is None else events)
    if codex_species is None:
        try:
            from . import bio
            codex_species = set(bio._codex_raw()[0])
        except Exception:
            codex_species = set()
    bodies = []
    for p in sy["planets"].values():
        if not p.get("bio") and not p.get("found"):
            continue
        if "cls" not in p:  # segnali senza la scansione del corpo: si sa solo quanti sono
            bodies.append({"id": p.get("id"), "name": p.get("name"), "short": _short(p.get("name"), sy["name"]),
                           "bio": p["bio"], "scanned": False, "genera": [], "min": 0, "max": 0, "dss": bool(p["genera"]),
                           "unexplained": p["bio"], "mult": 1})
            continue
        bodies.append(predict_body(p, sy, codex_species))
    thr = cfg["min_value"]
    for b in bodies:
        b["worth"] = "si" if b["min"] >= thr and b["min"] else "forse" if b["max"] >= thr and b["max"] else "no"
    bodies.sort(key=lambda b: (-b["max"], -b["min"]))
    from .regionmap import regions
    return {"system": sy["name"], "address": sy["address"], "region": regions[sy["region"]] if sy["region"] else None,
            "populated": bool(sy["population"]), "all_found": sy["all_found"], "bodies": bodies,
            "total_min": sum(b["min"] for b in bodies), "total_max": sum(b["max"] for b in bodies),
            "stars": len(sy["stars"]), "threshold": thr}


def status():
    return {"config": load_config(), **predict()}


# --- Pianeti da Spansh (rotta esobiologica con previsione, app/spansh.py) -----------------------
# Spansh (api/bodies/search) scrive i dati con i nomi di EDSM, non con quelli del journal: qui si riportano al formato
# di build_system. Nomi e unità controllati sulle risposte di Spansh del 10/11/2026 (circa 3500 pianeti con segnali
# biologici) e verificati con tools/test_bio_spansh.py: gravità già in g, pressione già in atm, temperatura in K,
# periodo orbitale in giorni (il journal lo dà in secondi), materiali con l'iniziale maiuscola.
_SP_BODY = {"High metal content world": "High metal content body", "Rocky Ice world": "Rocky ice body",
            "Metal-rich body": "Metal rich body", "Earth-like world": "Earthlike body",
            "Gas giant with water-based life": "Gas giant with water based life",
            "Gas giant with ammonia-based life": "Gas giant with ammonia based life",
            "Helium-rich gas giant": "Helium rich gas giant"}
# Classi delle stelle: le lettere semplici ("G (White-Yellow) Star"), poi le altre come StarType del journal.
_SP_STAR = {"T Tauri Star": "TTS", "Herbig Ae/Be Star": "AeBe", "Neutron Star": "N", "Black Hole": "H",
            "Supermassive Black Hole": "SupermassiveBlackHole", "MS-type Star": "MS", "S-type Star": "S",
            "C Star": "C", "CN Star": "CN", "CJ Star": "CJ", "Wolf-Rayet Star": "W", "Wolf-Rayet N Star": "WN",
            "Wolf-Rayet NC Star": "WNC", "Wolf-Rayet C Star": "WC", "Wolf-Rayet O Star": "WO",
            "K (Yellow-Orange giant) Star": "K_OrangeGiant", "M (Red giant) Star": "M_RedGiant",
            "M (Red super giant) Star": "M_RedSuperGiant", "A (Blue-White super giant) Star": "A_BlueWhiteSuperGiant",
            "B (Blue-White super giant) Star": "B_BlueWhiteSuperGiant", "F (White super giant) Star": "F_WhiteSuperGiant",
            "G (White-Yellow super giant) Star": "G_WhiteSuperGiant"}
# Generi rilevati col DSS ("genuses"): Spansh usa la parola dell'identificativo del Codex ($Codex_Ent_Bacterial_...).
_SP_GENUS = {"Bacterial": "Bacterium", "Fonticulus": "Fonticulua", "Tussocks": "Tussock", "Stratum": "Stratum",
             "Fungoids": "Fungoida", "Shrubs": "Frutexa", "Osseus": "Osseus", "Tubus": "Tubus", "Cactoids": "Cactoida",
             "Conchas": "Concha", "Electricae": "Electricae", "Aleoids": "Aleoida", "Brain Trees": "Brain Tree",
             "Fumerolas": "Fumerola", "Tubers": "Sinuous Tubers", "Clypeus": "Clypeus", "Recepta": "Recepta",
             "Crystalline Shards": "Crystalline Shards"}
SPECIES_NAMES = {s["name"] for s in bio_rules.SPECIES} | set(_ALIAS)


def _sp_star(subtype):
    if subtype in _SP_STAR:
        return _SP_STAR[subtype]
    m = re.match(r"^White Dwarf \((D[A-Z]*)\) Star$", subtype or "")
    if m:
        return m.group(1)
    m = re.match(r"^([OBAFGKMLTY]) \([^)]*\) Star$", subtype or "")
    return m.group(1) if m and "giant" not in subtype else None  # sconosciuta: la stella resta "da verificare"


def _sp_atmo(text):
    """'Thin Carbon dioxide-rich' -> 'CarbonDioxideRich', 'No atmosphere' -> 'None' (AtmosphereType del journal)."""
    if not text or text == "No atmosphere":
        return "None"
    words = re.sub(r"^((hot|thin|thick)\s+)+", "", text, flags=re.I).replace("-rich", " rich").split()
    return "".join(w[:1].upper() + w[1:] for w in words)


def from_spansh(b):
    """(corpo, sistema) nel formato di build_system per un pianeta di api/bodies/search."""
    pos = [b.get("system_x"), b.get("system_y"), b.get("system_z")]
    pos = pos if None not in pos else None
    sy = {"name": b.get("system_name"), "address": b.get("system_id64"), "pos": pos, "population": 0,
          "all_found": False, "stars": {}, "planets": {}, "classes": {_SP_BODY.get(b.get("subtype"), b.get("subtype"))}}
    parents = []
    for par in b.get("parents") or []:
        if par.get("type") == "Planet":
            sy["classes"].add(_SP_BODY.get(par.get("subtype"), par.get("subtype")))
        elif par.get("type") == "Star":
            star = _sp_star(par.get("subtype"))
            if star:
                # La stella principale ha l'id64 del sistema (BodyID 0); delle altre non si sa la distanza.
                sy["stars"][str(par.get("id64"))] = {"type": star, "lum": "", "dist": 0 if par.get("id64") == b.get("system_id64") else 1}
            parents.append(str(par.get("id64")))
    sy["main_star"] = next((s for s in sy["stars"].values() if not s["dist"]), None)
    if not sy["main_star"]:
        parents.append("?")  # stella principale non nota: le regole che la guardano restano "da verificare"
    if pos:
        from .regionmap import findRegion
        r = findRegion(*pos)
        sy["region"] = r[0] if r else None
    else:
        sy["region"] = None
    vol = b.get("volcanism_type")
    p = {"id": b.get("body_id"), "name": b.get("name"), "short": _short(b.get("name"), sy["name"]),
         "cls": _SP_BODY.get(b.get("subtype"), b.get("subtype")), "landable": bool(b.get("is_landable")),
         "atmo": _sp_atmo(b.get("atmosphere")),
         "gases": {_sp_atmo(g.get("name")): g.get("share") or 0 for g in b.get("atmosphere_composition") or []},
         "volcanism": "" if not vol or vol == "No volcanism" else vol.lower() + " volcanism",
         "gravity": b.get("gravity") or 0, "temp": b.get("surface_temperature"), "pressure": b.get("surface_pressure"),
         "dist": b.get("distance_to_arrival") or 0, "period": (b.get("orbital_period") or 0) * 86400,
         "materials": {m.get("name", "").lower() for m in b["materials"]} if b.get("materials") else None,
         "footfall": None, "parents": parents, "found": {},
         "bio": next((s.get("count") or 0 for s in b.get("signals") or [] if s.get("name") == "Biological"), 0)}
    genera = [_SP_GENUS.get(g.get("name")) for g in b.get("genuses") or []]
    p["genera"] = genera if None not in genera else []  # un genere che non riconosco: meglio non restringere
    return p, sy


# --- Annunci -----------------------------------------------------------------------------------

def _mcr(v, dot=False):
    m = v / 1e6
    return f"{m:.0f}" if m >= 10 else f"{m:.1f}" if dot else f"{m:.1f}".replace(".", ",")


def compose(body):
    """Testo parlato e testo del ticker per un corpo che vale la pena."""
    # Si nominano le specie più ricche (valore base >= 5 M Cr), prima quelle con tutte le condizioni verificate.
    sp = sorted((s for g in body["genera"] for s in g["species"]), key=lambda s: (not s["sure"], -s["value"]))
    names = [s["name"] for s in sp if s["value"] >= 5_000_000][:3] or [s["name"] for s in sp][:2]
    sig = (pick("un segnale biologico", "one biological signal") if body["bio"] == 1
           else pick(f"{body['bio']} segnali biologici", f"{body['bio']} biological signals"))
    lead = pick(f"Pianeta {body['short']}: {sig}", f"Planet {body['short']}: {sig}")
    if body["dss"]:
        lead += pick(f", generi rilevati {', '.join(g['genus'] for g in body['genera'])}",
                     f", genera detected {', '.join(g['genus'] for g in body['genera'])}")
    if names:
        lead += pick(f", {'specie possibili' if len(names) > 1 else 'specie possibile'} {', '.join(names)}",
                     f", possible species {', '.join(names)}")
    # In inglese il decimale col punto: il testo viene letto dalla voce inglese.
    value = pick(f"fino a {_mcr(body['max'])} milioni" if body["min"] < body["max"] else f"{_mcr(body['max'])} milioni",
                 f"up to {_mcr(body['max'], True)} million" if body["min"] < body["max"] else f"{_mcr(body['max'], True)} million")
    bonus = pick(" con il bonus prima impronta", " with the first footfall bonus") if body["mult"] == 5 else ""
    verdict = (pick("vale la pena atterrare", "worth landing") if body.get("worth") == "si"
               else pick("potrebbe valere la pena atterrare", "might be worth landing"))
    spoken = pick(f"{lead}. Valore {value}{bonus}: {verdict}.", f"{lead}. Value {value} credits{bonus}: {verdict}.")
    rng = _mcr(body["max"]) if body["min"] == body["max"] else f"{_mcr(body['min'])}–{_mcr(body['max'])}"
    text = pick(f"Esobiologia · {lead} · {rng} M Cr{' (×5 prima impronta)' if body['mult'] == 5 else ''}",
                f"Exobiology · {lead} · {rng} M Cr{' (×5 first footfall)' if body['mult'] == 5 else ''}")
    return spoken, text


def _announce_now():
    cfg = load_config()
    if not (cfg["voice"] or cfg["feed"]):
        return
    rep = predict(cfg=cfg)
    addr = rep["address"]
    if addr is None:
        return
    todo = []
    with _lock:
        done = _announced.setdefault(addr, set())
        for b in rep["bodies"]:
            key = (b["id"], "dss" if b["dss"] else "fss")
            if b["worth"] != "no" and key not in done:
                done.add(key)
                todo.append(b)
        if len(_announced) > 50:
            for k in list(_announced)[:-50]:
                del _announced[k]
    for b in todo[:3]:
        spoken, text = compose(b)
        if cfg["feed"]:
            with STATE.lock:
                STATE.note(time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), text, "gold")
        if cfg["voice"] and voice.load_config().get("enabled"):
            voice.say(spoken)
        print(f"[Esobiologia] {text}")


def _on_event(e):
    ev = e.get("event")
    if ev in ("Scan", "FSSBodySignals", "SAASignalsFound"):
        _pending["since"] = time.time()
        _wake.set()
    elif ev in ("FSDJump", "CarrierJump"):
        _pending["since"] = 0.0


def _loop():
    while True:
        _wake.wait(timeout=30)
        _wake.clear()
        while _pending["since"]:
            wait = _pending["since"] + QUIET_S - time.time()
            if wait > 0:
                time.sleep(min(wait, QUIET_S))
                continue
            _pending["since"] = 0.0
            try:
                _announce_now()
            except Exception as exc:
                print(f"[Esobiologia] {exc!r}")


def start():
    global _started
    with _lock:
        if _started:
            return
        _started = True
    # Non annunciare quello che era già nei journal all'avvio: solo le scansioni nuove.
    deadline = time.time() + 90
    while not STATE.live and time.time() < deadline:
        time.sleep(1)
    try:
        rep = predict()
        if rep["address"] is not None:
            with _lock:
                _announced[rep["address"]] = {(b["id"], "dss" if b["dss"] else "fss") for b in rep["bodies"]}
    except Exception as exc:
        print(f"[Esobiologia] {exc!r}")
    journal.add_listener(_on_event)
    threading.Thread(target=_loop, name="bio-predict", daemon=True).start()


GET = {"/api/bio/predict": lambda q: status()}
POST = {"/api/bio/predict/config": lambda body, q: save_config(body)}
LAN = {"/api/bio/predict"}
