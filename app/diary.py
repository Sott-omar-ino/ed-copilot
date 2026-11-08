"""Diario di bordo: per ogni sessione (le stesse delle statistiche) una cronologia leggibile ricavata dai journal,
con le note del comandante e gli screenshot del gioco convertiti in PNG.

- Le sessioni e i loro numeri (durata, guadagni, salti) vengono da stats.summary(): niente logica duplicata.
- Gli eventi utili di ogni journal restano in cache (nome + dimensione + data di modifica), come nelle statistiche.
- Note e impostazioni stanno in diario.json nella cartella dati; le miniature in cache/thumbs.
- Gli screenshot (BMP scritti dal gioco in Immagini\\Frontier Developments\\Elite Dangerous) vengono convertiti
  in PNG "<Sistema> - <Corpo> - <data ora>.png" in un thread separato, appena il file è completo.
"""

import bisect
import calendar
import hashlib
import io
import json
import os
import queue
import re
import threading
import time
import uuid

from . import journal, paths, stats, storage
from .gamedata import MATERIAL_GRADE, RANKS_EN
from .lang import is_en, pick
from .ships import blueprint_name, module_info
from .state import rank_label, ship_name, station_name

DIARY_FILE = paths.user_file("diario.json")
CACHE_FILE = paths.cache_file("diary.json")
THUMBS_DIR = paths.cache_file("thumbs")
VERSION = 4  # 4: niente testi italiani nella cache (si traducono quando si costruisce la cronologia)
THUMB_SIZE = 360
SHOT_TOLERANCE = 600  # secondi fra l'evento Screenshot e la data del BMP: oltre, il file è un altro
DEFAULT_SETTINGS = {"convert": True, "out_dir": "", "delete_bmp": False}

NEEDED = {"Location", "FSDJump", "CarrierJump", "Docked", "Undocked", "Touchdown", "Liftoff", "SupercruiseEntry",
          "SupercruiseExit", "ApproachBody", "Scan", "SAAScanComplete", "SAASignalsFound", "ScanOrganic", "CodexEntry", "MaterialCollected",
          "MissionAccepted", "MissionCompleted", "MissionFailed", "MissionAbandoned", "Bounty", "FactionKillBond",
          "RedeemVoucher", "SellExplorationData", "MultiSellExplorationData", "SellOrganicData", "MarketSell", "MarketBuy",
          "Died", "Resurrect", "ShipyardBuy", "ShipyardSell", "ShipyardSwap", "EngineerCraft", "Promotion",
          "CommunityGoalJoin", "CommunityGoalReward", "Screenshot"}

PLANETS = {"Earthlike body": "Earth-like world", "Water world": "Water world", "Ammonia world": "Ammonia world",
           "Gas giant with water based life": "Gas giant with water-based life",
           "Gas giant with ammonia based life": "Gas giant with ammonia-based life"}
PLANET_NAMES = {"High metal content body": "High Metal Content world", "Metal rich body": "Metal-rich body",
                "Rocky body": "Rocky body", "Icy body": "Icy body", "Rocky ice body": "Rocky ice body"}
STARS = {"N": "Neutron star", "H": "Black hole", "SupermassiveBlackHole": "Supermassive black hole", "W": "Wolf-Rayet",
         "WN": "Wolf-Rayet", "WNC": "Wolf-Rayet", "WC": "Wolf-Rayet", "WO": "Wolf-Rayet", "D": "White dwarf"}
CATS_IT = {"trade": "commercio", "mining": "estrazione", "missions": "missioni", "combat": "combattimento",
           "exploration": "esplorazione", "exobiology": "exobiologia", "other": "altro"}
CATS_EN = {"trade": "trade", "mining": "mining", "missions": "missions", "combat": "combat",
           "exploration": "exploration", "exobiology": "exobiology", "other": "other"}
WEEKDAYS = ("lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato", "domenica")
MONTHS = ("gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre",
          "novembre", "dicembre")
WEEKDAYS_EN = ("Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday")
MONTHS_EN = ("January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
             "November", "December")
BAD_CHARS = re.compile(r'[<>:"/\\|?*\x00-\x1f]+')

LOCK = threading.Lock()       # cache dei journal
DATA_LOCK = threading.Lock()  # diario.json
FILES = None
JOB = {"running": False, "total": 0, "done": 0, "converted": 0, "skipped": 0, "errors": 0, "last_error": None}
_QUEUE = queue.Queue()
_STARTED = False


# ============================================================================
# Percorsi
# ============================================================================
def _known_folder(guid, fallback):
    try:
        import ctypes
        import uuid as _uuid
        buf = (ctypes.c_byte * 16).from_buffer_copy(_uuid.UUID(guid).bytes_le)
        out = ctypes.c_wchar_p()
        if ctypes.windll.shell32.SHGetKnownFolderPath(ctypes.byref(buf), 0, None, ctypes.byref(out)) == 0:
            value = out.value
            ctypes.windll.ole32.CoTaskMemFree(out)
            if value:
                return value
    except Exception:
        pass
    return os.path.join(os.path.expanduser("~"), fallback)


PICTURES_DIR = os.path.normpath(os.environ.get("ED_PICTURES_DIR") or os.path.join(
    _known_folder("33E28130-4E1E-4676-835A-98395C3BC3BB", "Pictures"), "Frontier Developments", "Elite Dangerous"))
DOCUMENTS_DIR = _known_folder("FDD39AD0-238F-46AF-ADB4-6C85480369C7", "Documents")
# Cartella predefinita dei PNG. Se esiste già quella del vecchio nome (con le immagini convertite dalle versioni
# precedenti, che il diario collega per nome file) e non quella nuova, si continua a usare la vecchia.
DEFAULT_OUT = os.path.join(PICTURES_DIR, "Voidwatch ED")
if not os.path.exists(DEFAULT_OUT) and os.path.isdir(os.path.join(PICTURES_DIR, "ED Copilot")):
    DEFAULT_OUT = os.path.join(PICTURES_DIR, "ED Copilot")


# ============================================================================
# Dati dell'utente (note, impostazioni, screenshot convertiti)
# ============================================================================
def _load():
    data = storage.load_json(DIARY_FILE, {})
    if not isinstance(data, dict):
        data = {}
    data.setdefault("notes", [])
    data["settings"] = {**DEFAULT_SETTINGS, **(data.get("settings") or {})}
    data.setdefault("shots", {})
    return data


def _save(data):
    storage.save_json(DIARY_FILE, data)


def settings():
    with DATA_LOCK:
        s = _load()["settings"]
    return {**s, "out_dir_effective": out_dir(s), "default_out": DEFAULT_OUT, "pictures_dir": PICTURES_DIR}


def out_dir(s=None):
    if s is None:
        with DATA_LOCK:
            s = _load()["settings"]
    return os.path.normpath(s.get("out_dir") or DEFAULT_OUT)


def save_settings(body, q=None):
    body = body or {}
    with DATA_LOCK:
        data = _load()
        s = data["settings"]
        if "convert" in body:
            s["convert"] = bool(body["convert"])
        if "delete_bmp" in body:
            s["delete_bmp"] = bool(body["delete_bmp"])
        if "out_dir" in body:
            folder = str(body.get("out_dir") or "").strip().strip('"')
            if folder:
                folder = os.path.normpath(os.path.expandvars(os.path.expanduser(folder)))
                if not os.path.isabs(folder):
                    raise ValueError(pick("Indica un percorso completo, per esempio C:\\Users\\nome\\Pictures\\ED",
                                          "Enter a full path, e.g. C:\\Users\\name\\Pictures\\ED"))
                try:
                    os.makedirs(folder, exist_ok=True)
                except OSError as exc:
                    raise ValueError(pick(f"Cartella non utilizzabile: {exc.strerror or exc}", f"Folder not usable: {exc.strerror or exc}"))
                if os.path.normcase(folder) == os.path.normcase(DEFAULT_OUT):
                    folder = ""
            s["out_dir"] = folder
        _save(data)
    return settings()


# ============================================================================
# Lettura dei journal: eventi utili, in cache per file
# ============================================================================
def _num(v):
    return stats._n(v)


class _Reader:
    """Riduce un journal agli elementi del diario: [{"t": epoca, "k": tipo, ...}]."""

    def __init__(self):
        self.items = []
        self.system = None
        self.bodies = {}     # (SystemAddress, BodyID) -> nome
        self.seen = set()
        self.unmapped = set()  # corpi mai mappati da nessuno (WasMapped false)

    def add(self, t, k, **data):
        self.items.append({"t": t, "k": k, **{a: b for a, b in data.items() if b not in (None, "", [], 0)}})

    def remember(self, e, key):
        if e.get(key) and e.get("BodyID") is not None:
            self.bodies[(e.get("SystemAddress"), e["BodyID"])] = e[key]

    def feed(self, t, ev, e):
        fn = getattr(self, "on_" + ev, None)
        if fn:
            fn(t, e)

    # --- posizione --------------------------------------------------------------
    def on_Location(self, t, e):
        self.system = e.get("StarSystem") or self.system
        self.remember(e, "Body")
        self.add(t, "loc", sys=self.system, st=station_name(e.get("StationName"), e.get("StationName_Localised")) if e.get("Docked") else None,
                 body=e.get("Body") if e.get("BodyType") == "Planet" else None, mc=bool(e.get("Multicrew")))

    def on_FSDJump(self, t, e):
        self.system = e.get("StarSystem") or self.system
        self.add(t, "jump", sys=self.system, ly=round(_num(e.get("JumpDist")), 2))

    def on_CarrierJump(self, t, e):
        self.system = e.get("StarSystem") or self.system
        self.add(t, "cjump", sys=self.system)

    def on_Docked(self, t, e):
        self.system = e.get("StarSystem") or self.system
        self.add(t, "dock", st=station_name(e.get("StationName"), e.get("StationName_Localised")), sys=self.system,
                 fc=e.get("StationType") == "FleetCarrier")

    def on_Undocked(self, t, e):
        self.add(t, "undock")

    def on_Touchdown(self, t, e):
        self.remember(e, "Body")
        # In multicrew la nave è di un altro comandante: PlayerControlled è falso ma l'atterraggio è nostro.
        if (e.get("PlayerControlled") or e.get("Multicrew")) and not e.get("Taxi"):
            self.add(t, "land", body=e.get("Body"), sys=e.get("StarSystem") or self.system)

    def on_Liftoff(self, t, e):
        if e.get("PlayerControlled") or e.get("Multicrew"):
            self.add(t, "liftoff")

    def on_SupercruiseEntry(self, t, e):
        self.system = e.get("StarSystem") or self.system
        self.add(t, "sc", sys=e.get("StarSystem"))

    def on_SupercruiseExit(self, t, e):
        self.system = e.get("StarSystem") or self.system
        self.remember(e, "Body")

    def on_ApproachBody(self, t, e):
        self.remember(e, "Body")

    def on_SAASignalsFound(self, t, e):
        self.remember(e, "BodyName")

    # --- esplorazione --------------------------------------------------------------
    def on_Scan(self, t, e):
        self.remember(e, "BodyName")
        name = e.get("BodyName")
        if not name or name in self.seen:
            return
        self.seen.add(name)
        if e.get("WasMapped") is False:
            self.unmapped.add(name)
        first = e.get("WasDiscovered") is False and e.get("ScanType") != "NavBeaconDetail"
        label = None
        cls, star = e.get("PlanetClass"), e.get("StarType")
        if cls in PLANETS:
            label = PLANETS[cls]
        elif e.get("TerraformState") == "Terraformable" and cls:
            label = PLANET_NAMES.get(cls, cls)  # "terraformabile" si aggiunge nel testo (tfl), nella lingua scelta
        elif star:
            label = STARS.get(star) or (STARS["D"] if star.startswith("D") else None)
        if label or first:
            self.add(t, "body", name=name, label=label, first=first,
                     tf=bool(label and cls in PLANETS and e.get("TerraformState") == "Terraformable"),
                     tfl=bool(label and cls not in PLANETS and not star))

    def on_SAAScanComplete(self, t, e):
        name = e.get("BodyName")
        self.add(t, "map", name=name, first=name in self.unmapped)

    def on_ScanOrganic(self, t, e):
        if e.get("ScanType") == "Analyse":
            body = self.bodies.get((e.get("SystemAddress"), e.get("Body")))  # qui "Body" è il numero del corpo
            self.add(t, "bio", sp=e.get("Species_Localised") or e.get("Genus_Localised"),
                     body=body or self.system)

    def on_CodexEntry(self, t, e):
        # Stelle e pianeti "nuovi" nel Codex sono quasi sempre ovvi: restano biologia, geologia e xeno.
        if e.get("IsNewEntry") and "StellarBodies" not in str(e.get("Category") or ""):
            self.add(t, "codex", name=e.get("Name_Localised") or e.get("Name"))

    def on_MaterialCollected(self, t, e):
        grade = MATERIAL_GRADE.get(str(e.get("Name") or "").lower())
        if grade and grade >= 4:
            self.add(t, "mat", name=e.get("Name_Localised") or str(e.get("Name")).title(), n=_num(e.get("Count")) or 1)

    # --- missioni, combattimento, commercio -----------------------------------------
    def on_MissionAccepted(self, t, e):
        self.add(t, "macc")

    def on_MissionCompleted(self, t, e):
        self.add(t, "mok", name=e.get("LocalisedName") or e.get("Name"), cr=_num(e.get("Reward")))

    def on_MissionFailed(self, t, e):
        self.add(t, "mko", name=e.get("LocalisedName") or e.get("Name"))

    def on_MissionAbandoned(self, t, e):
        self.add(t, "mab", name=e.get("LocalisedName") or e.get("Name"))

    def on_Bounty(self, t, e):
        self.add(t, "bounty", cr=_num(e.get("TotalReward")) or _num(e.get("Reward")))

    def on_FactionKillBond(self, t, e):
        self.add(t, "bond", cr=_num(e.get("Reward")))

    def on_RedeemVoucher(self, t, e):
        self.add(t, "voucher", type=str(e.get("Type") or "").lower(), cr=_num(e.get("Amount")))

    def on_SellExplorationData(self, t, e):
        self.add(t, "sexpl", cr=_num(e.get("TotalEarnings")))

    on_MultiSellExplorationData = on_SellExplorationData

    def on_SellOrganicData(self, t, e):
        data = e.get("BioData") if isinstance(e.get("BioData"), list) else []
        self.add(t, "sbio", cr=sum(_num(b.get("Value")) + _num(b.get("Bonus")) for b in data if isinstance(b, dict)),
                 n=len(data))

    def on_MarketSell(self, t, e):
        self.add(t, "msell", n=_num(e.get("Count")), cr=_num(e.get("TotalSale")),
                 name=e.get("Type_Localised") or str(e.get("Type") or "").title())

    def on_MarketBuy(self, t, e):
        self.add(t, "mbuy", n=_num(e.get("Count")), cr=_num(e.get("TotalCost")),
                 name=e.get("Type_Localised") or str(e.get("Type") or "").title())

    # --- nave e comandante --------------------------------------------------------
    def on_Died(self, t, e):
        killer = e.get("KillerName_Localised") or e.get("KillerName")
        if not killer and isinstance(e.get("Killers"), list) and e["Killers"]:
            killer = e["Killers"][0].get("Name")
        self.add(t, "died", by=killer if killer and not str(killer).startswith("$") else None)

    def on_Resurrect(self, t, e):
        self.add(t, "rebuy", cr=_num(e.get("Cost")))

    def on_ShipyardBuy(self, t, e):
        self.add(t, "sbuy", ship=ship_name(e.get("ShipType"), e.get("ShipType_Localised")), cr=_num(e.get("ShipPrice")))

    def on_ShipyardSell(self, t, e):
        self.add(t, "ssell", ship=ship_name(e.get("ShipType"), e.get("ShipType_Localised")), cr=_num(e.get("ShipPrice")))

    def on_ShipyardSwap(self, t, e):
        self.add(t, "swap", ship=ship_name(e.get("ShipType"), e.get("ShipType_Localised")))

    def on_EngineerCraft(self, t, e):
        mod = module_info(e.get("Module")).get("name") if e.get("Module") else e.get("Slot")
        self.add(t, "eng", who=e.get("Engineer"), mod=mod, bp=blueprint_name(e.get("BlueprintName")) or e.get("BlueprintName"),
                 lv=_num(e.get("Level")))

    def on_Promotion(self, t, e):
        for k, names in RANKS_EN.items():
            if isinstance(e.get(k), int) and 0 <= e[k] < len(names):
                self.add(t, "promo", rk=k, name=names[e[k]])

    def on_CommunityGoalJoin(self, t, e):
        self.add(t, "cgjoin", name=e.get("Name"), sys=e.get("System"))

    def on_CommunityGoalReward(self, t, e):
        self.add(t, "cgrew", name=e.get("Name"), cr=_num(e.get("Reward")))

    def on_Screenshot(self, t, e):
        self.add(t, "shot", key=_shot_key(e), file=_bmp_name(e.get("Filename")), sys=e.get("System") or self.system,
                 body=e.get("Body"), ts=e.get("timestamp"))


def _scan_file(path, events=NEEDED):
    """Generatore (t, nome evento, evento) dei soli eventi richiesti; le altre righe non vengono decodificate."""
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            for line in f:
                m = stats.HEAD.match(line)
                if m and m.group(2) not in events:
                    continue
                try:
                    e = json.loads(line)
                except ValueError:
                    continue
                if not isinstance(e, dict) or e.get("event") not in events:
                    continue
                t = stats._epoch(e.get("timestamp"))
                if t is not None:
                    yield t, e["event"], e
    except OSError:
        return


def parse_file(path):
    r = _Reader()
    for t, ev, e in _scan_file(path):
        try:
            r.feed(t, ev, e)
        except Exception as exc:  # un evento strano non deve rovinare il diario
            print(f"Diario, errore evento {ev}: {exc!r}")
    return r.items


def _items():
    """Elementi del diario di tutti i journal, in ordine di tempo (rilegge solo i file cambiati)."""
    global FILES
    with LOCK:
        if FILES is None:
            data = storage.load_json(CACHE_FILE, {})
            FILES = data.get("files", {}) if isinstance(data, dict) and data.get("v") == VERSION else {}
        seen, changed, out = set(), False, []
        for path in journal.journal_files():
            name = os.path.basename(path)
            try:
                st = os.stat(path)
            except OSError:
                continue
            sig = [st.st_size, int(st.st_mtime)]
            seen.add(name)
            entry = FILES.get(name)
            if not entry or entry.get("sig") != sig:
                entry = FILES[name] = {"sig": sig, "items": parse_file(path)}
                changed = True
            out.extend(entry["items"])
        for name in set(FILES) - seen:
            del FILES[name]
            changed = True
        if changed:
            try:
                storage.save_json(CACHE_FILE, {"v": VERSION, "files": FILES})
            except OSError:
                pass
    out.sort(key=lambda i: i["t"])
    return out


# ============================================================================
# Testo
# ============================================================================
def fmt_cr(v):
    v = v or 0
    a = abs(v)
    if a >= 1e9:
        s = f"{v / 1e9:.2f}".replace(".", ",").rstrip("0").rstrip(",") + pick(" mld", " bn")
    elif a >= 1e6:
        s = f"{v / 1e6:.1f}".replace(".", ",").removesuffix(",0") + "M"
    else:
        s = f"{round(v):,}".replace(",", ".")
    return s + " CR"


def fmt_n(v):
    return f"{round(v or 0):,}".replace(",", ".")


def fmt_ly(v):
    return (f"{v:,.1f}" if v < 100 else f"{v:,.0f}").replace(",", "\x00").replace(".", ",").replace("\x00", ".") + pick(" al", " ly")


def fmt_dur(sec):
    h, m = int(sec // 3600), int(sec % 3600 // 60)
    return f"{h}h {m:02d}m" if h else f"{m} min"


def _hm(t):
    return time.strftime("%H:%M", time.localtime(t))


def _date_title(t):
    lt = time.localtime(t)
    if is_en():
        return f"{WEEKDAYS_EN[lt.tm_wday]} {lt.tm_mday} {MONTHS_EN[lt.tm_mon - 1]} {lt.tm_year}"
    return f"{WEEKDAYS[lt.tm_wday].capitalize()} {lt.tm_mday} {MONTHS[lt.tm_mon - 1]} {lt.tm_year}"


def _list(names, limit=5):
    names = list(dict.fromkeys(n for n in names if n))
    if len(names) > limit:
        return ", ".join(names[:limit]) + pick(f" e altri {len(names) - limit}", f" and {len(names) - limit} more")
    if len(names) > 1:
        return ", ".join(names[:-1]) + pick(" e ", " and ") + names[-1]
    return names[0] if names else ""


def _plural(n, one, many):
    return f"{fmt_n(n)} {one if n == 1 else many}"


# Aggregati dentro una voce della cronologia: chiave -> funzione che produce la riga di testo.
def _render_agg(key, a):
    kind = key.split(":")[0]
    en = is_en()
    if kind == "bodies":
        out = []
        for b in a:
            tf = b.get("tf") or (b.get("tfl") and en)
            tags = [x for x in (pick("terraformabile", "terraformable") if tf else None,
                                pick("prima scoperta", "first discovery") if b.get("first") else None) if x]
            if b.get("tfl") and not en:
                label = f"{b['label']} terraformabile"
            else:
                label = b["label"]
            out.append(f"{label} {b['name']}" + (f" ({', '.join(tags)})" if tags else ""))
        return pick("Corpi notevoli: ", "Notable bodies: ") + _list(out, 6)
    if kind in ("firsts", "firsts+"):
        if en:
            return f"First to discover {_plural(a, 'body', 'bodies')}" + (" (besides the notable ones)" if key == "firsts+" else "")
        return f"Primo a scoprire {_plural(a, 'corpo', 'corpi')}" + (" (oltre a quelli notevoli)" if key == "firsts+" else "")
    if kind == "map":
        firsts = sum(1 for m in a if m.get("first"))
        names = [m.get("name") for m in a]
        if en:
            txt = f"Mapped {names[0]}" if len(a) == 1 else f"Mapped {len(a)} bodies" + (f": {_list(names, 4)}" if len(a) <= 4 else "")
            return txt + (" (first to map it)" if len(a) == 1 and firsts else f" (first to map {firsts})" if firsts else "")
        txt = f"Mappato {names[0]}" if len(a) == 1 else f"Mappati {len(a)} corpi" + (f": {_list(names, 4)}" if len(a) <= 4 else "")
        return txt + (" (primo a mapparlo)" if len(a) == 1 and firsts else f" ({firsts} per primo)" if firsts else "")
    if kind == "bio":
        unknown = pick("specie sconosciuta", "unknown species")
        sp = [b.get("sp") or unknown for b in a]
        if len(a) == 1:
            return pick(f"Analizzata {sp[0]} su {a[0]['body']}", f"Analysed {sp[0]} on {a[0]['body']}")
        return (pick(f"Analizzate {len(a)} specie: ", f"Analysed {len(a)} species: ")
                + _list([f"{n} ({b['body']})" for n, b in zip(sp, a)], 6))
    if kind == "codex":
        if len(a) == 1:
            return pick("Nuova voce del Codex: ", "New Codex entry: ") + _list(a, 5)
        return pick("Nuove voci del Codex: ", "New Codex entries: ") + _list(a, 5)
    if kind == "mat":
        return pick("Materiali pregiati raccolti: ", "High-grade materials collected: ") + _list(
            [f"{n} ×{c}" if c > 1 else n for n, c in a.items()], 6)
    if kind == "bounty":
        if en:
            return (f"Destroyed a wanted target (bounty {fmt_cr(a['cr'])})" if a["n"] == 1
                    else f"Destroyed {a['n']} wanted targets (bounties worth {fmt_cr(a['cr'])})")
        return (f"Abbattuto un bersaglio ricercato (bounty {fmt_cr(a['cr'])})" if a["n"] == 1
                else f"Abbattuti {a['n']} bersagli ricercati (bounty per {fmt_cr(a['cr'])})")
    if kind == "bond":
        if en:
            return f"{_plural(a['n'], 'combat bond', 'combat bonds')} earned ({fmt_cr(a['cr'])})"
        return f"{_plural(a['n'], 'combat bond', 'combat bond')} guadagnati ({fmt_cr(a['cr'])})"
    if kind == "voucher":
        sub = key.split(":")[1]
        if en:
            what = {"bounty": "bounty vouchers", "combatbond": "combat bonds", "trade": "trade vouchers",
                    "codex": "Codex vouchers", "scannable": "scan data", "settlement": "vouchers"}.get(sub, "vouchers")
            return f"Redeemed {fmt_cr(a)} in {what}"
        what = {"bounty": "bounty", "combatbond": "combat bond", "trade": "voucher commerciali",
                "codex": "voucher del Codex", "scannable": "dati scansionati", "settlement": "voucher"}.get(sub, "voucher")
        return f"Incassati {fmt_cr(a)} di {what}"
    if kind == "sexpl":
        return pick(f"Venduti dati di esplorazione per {fmt_cr(a)}", f"Sold exploration data for {fmt_cr(a)}")
    if kind == "sbio":
        if en:
            return f"Sold organic data ({_plural(a['n'], 'sample', 'samples')}) for {fmt_cr(a['cr'])}"
        return f"Venduti dati biologici ({_plural(a['n'], 'campione', 'campioni')}) per {fmt_cr(a['cr'])}"
    if kind in ("msell", "mbuy"):
        goods = _list(list(a["names"]), 3)
        if en:
            verb = "Sold" if kind == "msell" else "Bought"
            return f"{verb} {fmt_n(a['n'])} t of goods ({goods}) for {fmt_cr(a['cr'])}"
        verb = ("Venduta" if a["n"] == 1 else "Vendute") if kind == "msell" else ("Acquistata" if a["n"] == 1 else "Acquistate")
        return f"{verb} {fmt_n(a['n'])} t di merci ({goods}) per {fmt_cr(a['cr'])}"
    if kind == "macc":
        if en:
            return "Accepted 1 mission" if a == 1 else f"Accepted {a} missions"
        return "Accettata 1 missione" if a == 1 else f"Accettate {a} missioni"
    if kind == "mok":
        tot = sum(m["cr"] for m in a)
        gain = f" (+{fmt_cr(tot)})" if tot else ""
        if len(a) == 1:
            return pick(f"Missione completata: {a[0]['name']}", f"Mission completed: {a[0]['name']}") + gain
        return pick(f"{len(a)} missioni completate", f"{len(a)} missions completed") + gain + ": " + _list([m["name"] for m in a], 4)
    if kind in ("mko", "mab"):
        if en:
            what = "failed" if kind == "mko" else "abandoned"
            return (f"Mission {what}: " if len(a) == 1 else f"Missions {what}: ") + _list(a, 4)
        what = "fallit" if kind == "mko" else "abbandonat"
        return (f"Missione {what}a: " if len(a) == 1 else f"Missioni {what}e: ") + _list(a, 4)
    if kind == "eng":
        lo, hi = min(a["lv"]), max(a["lv"])
        grade = f"G{lo}" if lo == hi else f"G{lo}→G{hi}"
        rolls = len(a["lv"])
        if en:
            return (f"Engineering{' by ' + a['who'] if a.get('who') else ''}: {a['mod']} · {a['bp']} {grade}"
                    + (f" ({rolls} rolls)" if rolls > 1 else ""))
        return (f"Engineering{' da ' + a['who'] if a.get('who') else ''}: {a['mod']} · {a['bp']} {grade}"
                + (f" ({rolls} applicazioni)" if rolls > 1 else ""))
    if kind == "line":
        return a
    return str(a)


def _entry(it, kind, text):
    return {"t": it["t"], "end": it["t"], "kind": kind, "text": text, "agg": {}, "shots": []}


class _Builder:
    """Costruisce la cronologia di una sessione: salti consecutivi raccolti, soste in stazione e atterraggi
    come contesti che raccolgono ciò che succede finché si riparte."""

    def __init__(self):
        self.entries = []
        self.open = None      # voce aperta: salti, attracco, atterraggio o "nel sistema"
        self.system = None
        self.after_death = False

    def push(self, e):
        self.entries.append(e)
        return e

    def close(self):
        self.open = None

    def target(self, it):
        if self.open is None:
            self.open = self.push(_entry(it, "space", pick(f"Nel sistema {self.system}", f"In the {self.system} system") if self.system
                                              else pick("Nello spazio", "In space")))
        self.open["end"] = it["t"]
        return self.open

    def agg_list(self, it, key, value):
        self.target(it)["agg"].setdefault(key, []).append(value)

    def agg_sum(self, it, key, **values):
        a = self.target(it)["agg"].setdefault(key, dict.fromkeys(values, 0))
        for k, v in values.items():
            a[k] += v

    def line(self, it, text):
        e = self.target(it)
        e["agg"][f"line:{len(e['agg'])}"] = text

    def feed(self, it):
        k = it["k"]
        fn = getattr(self, "on_" + k, None)
        if fn:
            fn(it)

    # --- movimento ---------------------------------------------------------------
    def on_loc(self, it):
        moved = it.get("sys") != self.system or (it.get("st") and not (self.open and self.open.get("st") == it.get("st")))
        self.system = it.get("sys") or self.system
        if is_en():
            where = (f"at {it['st']} ({self.system})" if it.get("st") else f"on {it['body']}" if it.get("body")
                     else f"in the {self.system} system")
            if not self.entries:
                text = "Session started " + ("docked " if it.get("st") else "") + where
            elif self.after_death:
                text = "Respawned " + where
            elif moved:  # multicrew, taxi o ripresa del gioco in un altro punto
                text = ("In multicrew " if it.get("mc") else "Now ") + where
            else:
                return
        else:
            where = (f"a {it['st']} ({self.system})" if it.get("st") else f"su {it['body']}" if it.get("body")
                     else f"nel sistema {self.system}")
            if not self.entries:
                text = "Inizio sessione " + ("attraccato " if it.get("st") else "") + where
            elif self.after_death:
                text = "Ripartenza " + ("da " + where[2:] if it.get("st") else where)
            elif moved:  # multicrew, taxi o ripresa del gioco in un altro punto
                text = ("In multicrew " if it.get("mc") else "Ora ") + where
            else:
                return
        if it.get("mc") and not text.startswith("In multicrew"):
            text += " (multicrew)"
        self.after_death = False
        self.close()
        self.open = self.push({**_entry(it, "dock" if it.get("st") else "start", text), "st": it.get("st")})

    def on_jump(self, it):
        prev = self.system
        self.system = it.get("sys") or self.system
        run = self.open
        if run and run["kind"] == "jump":
            run.update(end=it["t"], to=self.system, n=run["n"] + 1, ly=run["ly"] + it.get("ly", 0))
            return
        self.close()
        self.open = self.push({**_entry(it, "jump", ""), "from": prev, "to": self.system, "n": 1, "ly": it.get("ly", 0)})

    def on_cjump(self, it):
        self.system = it.get("sys") or self.system
        self.close()
        self.open = self.push(_entry(it, "carrier", pick(f"Salto del fleet carrier verso {self.system}",
                                                                  f"Fleet Carrier jump to {self.system}")))

    def on_dock(self, it):
        self.system = it.get("sys") or self.system
        last = self.entries[-1] if self.entries else None
        if last and last["kind"] == "dock" and last.get("st") == it.get("st") and self.open in (None, last):
            last["end"] = it["t"]  # ripartito e riattraccato subito alla stessa stazione: una voce sola
            self.open = last
            return
        self.close()
        if is_en():
            text = f"Docked at {'Fleet Carrier ' if it.get('fc') else ''}{it.get('st')} ({self.system})"
        else:
            what = f"al fleet carrier {it.get('st')}" if it.get("fc") else f"a {it.get('st')}"
            text = f"Attraccato {what} ({self.system})"
        self.open = self.push({**_entry(it, "dock", text), "st": it.get("st")})

    def on_undock(self, it):
        if self.open and self.open["kind"] == "dock":
            self.open["end"] = it["t"]
            self.close()

    def on_land(self, it):
        self.system = it.get("sys") or self.system
        body = it.get("body") or self.system
        last = self.entries[-1] if self.entries else None
        if last and last["kind"] == "land" and last.get("body") == body and self.open in (None, last):
            last["landings"] += 1  # atterraggi ripetuti sullo stesso corpo: una voce sola
            last["end"] = it["t"]
            self.open = last
            return
        self.close()
        self.open = self.push({**_entry(it, "land", ""), "body": body, "landings": 1})

    def on_liftoff(self, it):
        if self.open and self.open["kind"] == "land":
            self.open["end"] = it["t"]
            self.close()

    def on_sc(self, it):
        self.system = it.get("sys") or self.system
        if self.open and self.open["kind"] in ("dock", "land", "space", "start"):
            self.close()

    # --- esplorazione --------------------------------------------------------------
    def on_body(self, it):
        if it.get("label"):
            self.agg_list(it, "bodies", it)
        if it.get("first") and not it.get("label"):  # le prime scoperte notevoli sono già nell'elenco sopra
            e = self.target(it)
            e["agg"]["firsts"] = e["agg"].get("firsts", 0) + 1

    def on_map(self, it):
        self.agg_list(it, "map", it)

    def on_bio(self, it):
        self.agg_list(it, "bio", it)

    def on_codex(self, it):
        self.agg_list(it, "codex", it.get("name"))

    def on_mat(self, it):
        a = self.target(it)["agg"].setdefault("mat", {})
        a[it["name"]] = a.get(it["name"], 0) + it.get("n", 1)

    # --- missioni, combattimento, commercio -----------------------------------------
    def on_macc(self, it):
        e = self.target(it)
        e["agg"]["macc"] = e["agg"].get("macc", 0) + 1

    def on_mok(self, it):
        self.agg_list(it, "mok", {"name": it.get("name") or pick("missione", "mission"), "cr": it.get("cr", 0)})

    def on_mko(self, it):
        self.agg_list(it, "mko", it.get("name") or pick("missione", "mission"))

    def on_mab(self, it):
        self.agg_list(it, "mab", it.get("name") or pick("missione", "mission"))

    def on_bounty(self, it):
        self.agg_sum(it, "bounty", n=1, cr=it.get("cr", 0))

    def on_bond(self, it):
        self.agg_sum(it, "bond", n=1, cr=it.get("cr", 0))

    def on_voucher(self, it):
        e = self.target(it)
        key = "voucher:" + (it.get("type") or "")
        e["agg"][key] = e["agg"].get(key, 0) + it.get("cr", 0)

    def on_sexpl(self, it):
        e = self.target(it)
        e["agg"]["sexpl"] = e["agg"].get("sexpl", 0) + it.get("cr", 0)

    def on_sbio(self, it):
        self.agg_sum(it, "sbio", n=it.get("n", 0), cr=it.get("cr", 0))

    def _market(self, it):
        a = self.target(it)["agg"].setdefault(it["k"], {"n": 0, "cr": 0, "names": {}})
        a["n"] += it.get("n", 0)
        a["cr"] += it.get("cr", 0)
        a["names"][it.get("name")] = 1

    on_msell = on_mbuy = _market

    # --- nave e comandante --------------------------------------------------------
    def on_died(self, it):
        self.close()
        if is_en():
            text = ("Ship destroyed" + (f" by {it['by']}" if it.get("by") else "")
                    + (f" in the {self.system} system" if self.system else ""))
        else:
            text = ("Nave distrutta" + (f" da {it['by']}" if it.get("by") else "")
                    + (f" nel sistema {self.system}" if self.system else ""))
        self.push(_entry(it, "death", text))
        self.after_death = True

    def on_rebuy(self, it):
        last = self.entries[-1] if self.entries else None
        if last and last["kind"] == "death":
            last["agg"]["line:rebuy"] = (pick(f"Rebuy pagato: {fmt_cr(it['cr'])}", f"Rebuy paid: {fmt_cr(it['cr'])}") if it.get("cr")
                                      else pick("Nessun rebuy da pagare", "No rebuy to pay"))

    def on_sbuy(self, it):
        self.line(it, pick(f"Acquistata una nuova nave: {it.get('ship')}", f"Bought a new ship: {it.get('ship')}")
                  + (f" ({fmt_cr(it['cr'])})" if it.get("cr") else ""))

    def on_ssell(self, it):
        self.line(it, pick(f"Venduta la {it.get('ship')}", f"Sold the {it.get('ship')}")
                  + (f" ({fmt_cr(it['cr'])})" if it.get("cr") else ""))

    def on_swap(self, it):
        self.line(it, pick(f"Cambio nave: ai comandi della {it.get('ship')}", f"Ship swap: now flying the {it.get('ship')}"))

    def on_eng(self, it):
        key = f"eng:{it.get('who')}:{it.get('mod')}:{it.get('bp')}"
        a = self.target(it)["agg"].setdefault(key, {"who": it.get("who"), "mod": it.get("mod"), "bp": it.get("bp"), "lv": []})
        a["lv"].append(it.get("lv") or 1)

    def on_promo(self, it):
        rank = rank_label(it["rk"]) if it.get("rk") else it.get("rank")
        self.line(it, pick(f"Promozione: {rank} {it.get('name')}", f"Promotion: {rank} {it.get('name')}"))

    def on_cgjoin(self, it):
        self.line(it, pick(f"Iscritto al Community Goal «{it.get('name')}»", f"Joined the Community Goal “{it.get('name')}”")
                  + (f" ({it['sys']})" if it.get("sys") else ""))

    def on_cgrew(self, it):
        self.line(it, pick(f"Ricompensa del Community Goal «{it.get('name')}»: {fmt_cr(it.get('cr'))}",
                           f"Community Goal “{it.get('name')}” reward: {fmt_cr(it.get('cr'))}"))

    def on_shot(self, it):
        self.target(it)["shots"].append(it)

    # --- risultato ----------------------------------------------------------------
    def finish(self, shots_db):
        out = []
        for e in self.entries:
            if e["kind"] == "land":
                e["text"] = (pick(f"Atterrato su {e['body']}", f"Landed on {e['body']}")
                             + (pick(f" ({e['landings']} atterraggi)", f" ({e['landings']} landings)") if e["landings"] > 1 else ""))
            if e["kind"] == "jump":
                if e["n"] == 1:
                    e["text"] = pick(f"Salto verso {e['to']} ({fmt_ly(e['ly'])})", f"Jump to {e['to']} ({fmt_ly(e['ly'])})")
                else:
                    e["text"] = pick(f"{e['n']} salti da {e['from'] or '?'} a {e['to']} ({fmt_ly(e['ly'])})",
                                     f"{e['n']} jumps from {e['from'] or '?'} to {e['to']} ({fmt_ly(e['ly'])})")
            agg = e["agg"]
            if "firsts" in agg and any(b.get("first") for b in agg.get("bodies", [])):
                agg = {("firsts+" if k == "firsts" else k): v for k, v in agg.items()}
            details = [_render_agg(k, v) for k, v in agg.items() if v]
            shots = [_shot_public(s, shots_db) for s in e["shots"]]
            if e["kind"] == "space" and not details and not shots:
                continue
            item = {"t": e["t"], "end": e["end"], "time": _hm(e["t"]), "kind": e["kind"], "text": e["text"],
                    "details": details, "shots": shots}
            if e["end"] - e["t"] >= 120:
                item["until"] = _hm(e["end"])
            out.append(item)
        return out


# ============================================================================
# Sessioni
# ============================================================================
def _sessions():
    return stats.summary()["sessions"]  # dalla più recente


def _slice(items, times, s):
    lo = bisect.bisect_left(times, s["start"])
    hi = bisect.bisect_right(times, s["end"])
    return items[lo:hi]


def _notes_for(notes, s, sessions):
    out = []
    for n in notes:
        if n.get("session"):
            if n["session"] == s["id"]:
                out.append(n)
        elif s["start"] <= n.get("t", 0) <= s["end"] + stats.IDLE:
            out.append(n)
    return sorted(out, key=lambda n: n.get("t", 0))


def _summary(s, its):
    """Poche frasi che riassumono la sessione (frasi intere per lingua)."""
    en = is_en()
    systems = [i.get("sys") for i in its if i["k"] in ("loc", "jump", "cjump", "dock") and i.get("sys")]
    lines = []
    ships = s.get("ships") or []
    if en:
        lines.append(f"{fmt_dur(s['active'])} session" + (f" flying the {_list(ships, 3)}" if ships else "") + ".")
    else:
        lines.append(f"Sessione di {fmt_dur(s['active'])}" + (f" a bordo di {_list(ships, 3)}" if ships else "") + ".")
    if s["jumps"]:
        moved = systems and systems[0] != systems[-1]
        if en:
            route = f" from {systems[0]} to {systems[-1]}" if moved else ""
            lines.append(f"{_plural(s['jumps'], 'jump', 'jumps')} ({fmt_ly(s['ly'])}){route}.")
        else:
            route = f" da {systems[0]} a {systems[-1]}" if moved else ""
            lines.append(f"{_plural(s['jumps'], 'salto', 'salti')} ({fmt_ly(s['ly'])}){route}.")
    elif systems:
        if len(set(systems)) == 1:
            lines.append(pick(f"Sempre nel sistema {systems[-1]}.", f"Stayed in the {systems[-1]} system."))
        else:
            lines.append(pick(f"Sistemi visitati: {_list(systems, 4)}.", f"Systems visited: {_list(systems, 4)}."))
    explo = []
    if s["scans"]:
        explo.append(_plural(s["scans"], *(("body scanned", "bodies scanned") if en else ("corpo scansionato", "corpi scansionati"))))
    if s["mapped"]:
        explo.append(_plural(s["mapped"], *(("body mapped", "bodies mapped") if en else ("corpo mappato", "corpi mappati"))))
    if s["bio"]:
        explo.append(_plural(s["bio"], *(("species analysed", "species analysed") if en else ("specie analizzata", "specie analizzate"))))
    firsts = sum(1 for i in its if i["k"] == "body" and i.get("first"))
    if firsts:
        explo.append(_plural(firsts, *(("first discovery", "first discoveries") if en else ("prima scoperta", "prime scoperte"))))
    if explo:
        lines.append(_list(explo, 4).capitalize() + ".")
    docks = list(dict.fromkeys(i.get("st") for i in its if i["k"] == "dock" and i.get("st")))
    if docks:
        if en:
            lines.append("Docked at " + _list(docks, 4) + ".")
        else:
            lines.append(("Attracchi: " if len(docks) > 1 else "Attracco: ") + _list(docks, 4) + ".")
    if s["earned"]:
        cats = sorted(((v, k) for k, v in s["earn"].items() if v > 0), reverse=True)
        names = CATS_EN if en else CATS_IT
        parts = ", ".join(f"{names.get(k, k)} {fmt_cr(v)}" for v, k in cats[:3])
        rate = f" · {fmt_cr(s['cr_h'])}/h" if s.get("cr_h") else ""
        lines.append(pick(f"Guadagnati {fmt_cr(s['earned'])}", f"Earned {fmt_cr(s['earned'])}")
                     + (f" ({parts})" if parts else "") + rate + ".")
    if s["spent"]:
        lines.append(pick(f"Spesi {fmt_cr(s['spent'])}.", f"Spent {fmt_cr(s['spent'])}."))
    if s["deaths"]:
        if en:
            lines.append("Ship lost once." if s["deaths"] == 1 else f"Ship lost {s['deaths']} times.")
        else:
            lines.append("Nave persa una volta." if s["deaths"] == 1 else f"Nave persa {s['deaths']} volte.")
    if len(lines) == 1 and not s["earned"]:
        lines.append(pick("Nessun evento di rilievo.", "Nothing notable happened."))
    return lines


def _title(s):
    return f"{_date_title(s['start'])} · {_hm(s['start'])}–{_hm(s['end'])}"


def list_sessions(q=None):
    items = _items()
    times = [i["t"] for i in items]
    with DATA_LOCK:
        data = _load()
    out = []
    sessions = _sessions()
    for s in sessions:
        its = _slice(items, times, s)
        out.append({"id": s["id"], "start": s["start"], "end": s["end"], "active": s["active"], "ships": s["ships"],
                    "earned": s["earned"], "jumps": s["jumps"], "ly": s["ly"], "live": s["live"], "title": _title(s),
                    "commander": s["commander"], "shots": sum(1 for i in its if i["k"] == "shot"),
                    "notes": len(_notes_for(data["notes"], s, sessions))})
    return {"sessions": out, "settings": settings(), "job": dict(JOB)}


def _find(sessions, sid):
    if not sessions:
        raise ValueError(pick("Nessuna sessione nei journal", "No sessions in the journals"))
    if not sid:
        return sessions[0]
    for s in sessions:
        if s["id"] == sid:
            return s
    raise ValueError(pick("Sessione non trovata", "Session not found"))


def _build(s, items, times, data, sessions):
    its = _slice(items, times, s)
    b = _Builder()
    for it in its:
        try:
            b.feed(it)
        except Exception as exc:
            print(f"Diario, errore voce {it.get('k')}: {exc!r}")
    timeline = b.finish(data["shots"])
    notes = _notes_for(data["notes"], s, sessions)
    for n in notes:
        if n.get("kind") == "time":
            timeline.append({"t": n["t"], "end": n["t"], "time": _hm(n["t"]), "kind": "note", "text": n["text"],
                             "details": [], "shots": [], "note": n["id"]})
    timeline.sort(key=lambda e: e["t"])
    shots = [sh for e in timeline for sh in e["shots"]]
    return {"session": s, "title": _title(s), "summary": _summary(s, its), "timeline": timeline,
            "notes": [{**n, "time": _hm(n["t"]), "date": time.strftime("%d/%m/%Y %H:%M", time.localtime(n["t"]))} for n in notes],
            "shots": shots}


def session(q):
    sessions = _sessions()
    s = _find(sessions, (q or {}).get("id"))
    items = _items()
    with DATA_LOCK:
        data = _load()
    return _build(s, items, [i["t"] for i in items], data, sessions)


# ============================================================================
# Note
# ============================================================================
def add_note(body, q=None):
    body = body or {}
    text = str(body.get("text") or "").strip()[:4000]
    if not text:
        raise ValueError(pick("La nota è vuota", "The note is empty"))
    sid = str(body.get("session") or "")[:200] or None
    now = time.time()
    sessions = _sessions()
    if sid:
        s = _find(sessions, sid)
        note = {"id": uuid.uuid4().hex[:10], "t": now, "session": sid,
                "kind": "session", "text": text}
    else:
        live = next((s for s in sessions if s["live"]), None)
        target = live or (sessions[0] if sessions else None)
        note = {"id": uuid.uuid4().hex[:10], "t": now, "session": target["id"] if target else None, "kind": "time", "text": text}
    with DATA_LOCK:
        data = _load()
        data["notes"].append(note)
        _save(data)
    return note


def delete_note(body, q=None):
    nid = str((body or {}).get("id") or "")
    with DATA_LOCK:
        data = _load()
        before = len(data["notes"])
        data["notes"] = [n for n in data["notes"] if n.get("id") != nid]
        if len(data["notes"]) == before:
            raise ValueError(pick("Nota non trovata", "Note not found"))
        _save(data)
    return {"status": "ok"}


# ============================================================================
# Screenshot
# ============================================================================
def _shot_key(e):
    return f"{e.get('timestamp')}|{e.get('Filename')}"


def _bmp_name(filename):
    """'\\ED_Pictures\\Screenshot_0001.bmp' -> 'Screenshot_0001.bmp' (solo il nome: niente percorsi dal journal)."""
    name = re.split(r"[\\/]", str(filename or ""))[-1]
    return name if name.lower().endswith(".bmp") and not name.startswith(".") else None


def safe_name(text, limit=80):
    s = BAD_CHARS.sub("_", str(text or "")).strip().strip(".")
    return s[:limit].strip() or "Sconosciuto"


def _png_name(it):
    t = stats._epoch(it.get("ts")) or it["t"]
    stamp = time.strftime("%Y-%m-%d %H-%M-%S", time.localtime(t))
    system = safe_name(it.get("sys") or "Sistema sconosciuto")
    body = it.get("body")
    parts = [system]
    if body and body != it.get("sys"):
        # "Arvirisa C 4" nel sistema Arvirisa: il nome del corpo resta completo, è quello che si cerca.
        parts.append(safe_name(body))
    parts.append(stamp)
    return " - ".join(parts) + ".png"


def _shot_public(it, shots_db):
    rec = shots_db.get(it.get("key")) or {}
    png = rec.get("png")
    folder = out_dir()
    if png and not os.path.isfile(os.path.join(folder, png)):
        png = None
    bmp = os.path.join(PICTURES_DIR, it["file"]) if it.get("file") else None
    return {"key": it.get("key"), "time": _hm(it["t"]), "system": it.get("sys"), "body": it.get("body"), "png": png,
            "bmp": bool(bmp and not png and os.path.isfile(bmp) and _bmp_matches(bmp, it["t"]))}


def _bmp_matches(path, t):
    try:
        return abs(os.path.getmtime(path) - t) <= SHOT_TOLERANCE
    except OSError:
        return False


def _wait_stable(path, timeout=60):
    last, stable = -1, 0
    end = time.time() + timeout
    while time.time() < end:
        try:
            size = os.path.getsize(path)
        except OSError:
            size = -1
        if size > 0 and size == last:
            stable += 1
            if stable >= 2:
                return True
        else:
            stable = 0
        last = size
        time.sleep(0.5)
    return False


def convert(it, cfg=None, live=False):
    """Converte lo screenshot di un elemento 'shot'. Restituisce il nome del PNG, None se non c'è nulla da fare."""
    from PIL import Image
    if not it.get("file"):
        return None
    with DATA_LOCK:
        data = _load()
        rec = data["shots"].get(it["key"])
    cfg = cfg or data["settings"]
    folder = out_dir(cfg)
    if rec and rec.get("png") and os.path.isfile(os.path.join(folder, rec["png"])):
        return None
    bmp = os.path.join(PICTURES_DIR, it["file"])
    if live:
        if not _wait_stable(bmp):
            raise OSError(pick(f"{it['file']} non trovato o incompleto", f"{it['file']} not found or incomplete"))
    elif not os.path.isfile(bmp) or not _bmp_matches(bmp, it["t"]):
        return None
    os.makedirs(folder, exist_ok=True)
    name = _png_name(it)
    base, n = name[:-4], 2
    while os.path.exists(os.path.join(folder, name)):
        name = f"{base} ({n}).png"
        n += 1
    target = os.path.join(folder, name)
    tmp = target + ".tmp"
    for attempt in range(5):  # il gioco può tenere il file aperto ancora per un attimo
        try:
            with Image.open(bmp) as img:
                img.load()
                size = img.size
                img.save(tmp, format="PNG")
            break
        except (OSError, PermissionError):
            if attempt == 4:
                raise
            time.sleep(1)
    os.replace(tmp, target)
    try:
        os.utime(target, (it["t"], it["t"]))
    except OSError:
        pass
    deleted = False
    if cfg.get("delete_bmp"):
        try:
            with Image.open(target) as check:  # il BMP si cancella solo se il PNG è leggibile e completo
                ok = check.size == size
            if ok:
                os.remove(bmp)
                deleted = True
        except OSError as exc:
            print(f"Diario, BMP non cancellato: {exc!r}")
    with DATA_LOCK:
        data = _load()
        data["shots"][it["key"]] = {"png": name, "t": it["t"], "system": it.get("sys"), "body": it.get("body"),
                                    "bmp": it["file"], "bmp_deleted": deleted}
        _save(data)
    return name


def _worker():
    while True:
        it = _QUEUE.get()
        try:
            name = convert(it, live=True)
            if name:
                print(f"Screenshot convertito: {name}")
        except Exception as exc:
            print(f"Diario, screenshot non convertito: {exc!r}")


def _on_event(e):
    if e.get("event") != "Screenshot":
        return
    with DATA_LOCK:
        enabled = _load()["settings"].get("convert")
    if not enabled:
        return
    t = stats._epoch(e.get("timestamp")) or time.time()
    _QUEUE.put({"t": t, "k": "shot", "key": _shot_key(e), "file": _bmp_name(e.get("Filename")),
                "sys": e.get("System") or journal.STATE.location.get("system"), "body": e.get("Body"), "ts": e.get("timestamp")})


def start():
    """Da chiamare una volta all'avvio: converte gli screenshot nuovi mentre si gioca."""
    global _STARTED
    if _STARTED:
        return
    _STARTED = True
    journal.add_listener(_on_event)
    threading.Thread(target=_worker, daemon=True, name="diario-screenshot").start()


def convert_existing(body=None, q=None):
    """Converte in sottofondo gli screenshot passati il cui BMP esiste ancora."""
    if JOB["running"]:
        return dict(JOB)
    shots = [i for i in _items() if i["k"] == "shot" and i.get("file")]
    JOB.update(running=True, total=len(shots), done=0, converted=0, skipped=0, errors=0, last_error=None)

    def work():
        try:
            with DATA_LOCK:
                cfg = _load()["settings"]
            for it in shots:
                try:
                    if convert(it, cfg):
                        JOB["converted"] += 1
                    else:
                        JOB["skipped"] += 1
                except Exception as exc:
                    JOB["errors"] += 1
                    JOB["last_error"] = str(exc)
                JOB["done"] += 1
        finally:
            JOB["running"] = False

    threading.Thread(target=work, daemon=True, name="diario-converti").start()
    return dict(JOB)


def _in_out_dir(name):
    """Percorso di un PNG della cartella di uscita, oppure None (niente percorsi, niente '..', solo .png)."""
    name = str(name or "")
    if not name or name != os.path.basename(name) or "/" in name or "\\" in name or name.startswith(".") \
            or not name.lower().endswith(".png"):
        return None
    folder = os.path.realpath(out_dir())
    full = os.path.realpath(os.path.join(folder, name))
    if os.path.dirname(full) != folder or not os.path.isfile(full):
        return None
    return full


def thumbnail(q):
    """Miniatura JPEG di un PNG della cartella di uscita: (bytes, tipo)."""
    from PIL import Image
    full = _in_out_dir((q or {}).get("name"))
    if not full:
        raise ValueError(pick("Immagine non disponibile", "Image not available"))
    st = os.stat(full)
    key = hashlib.sha1(f"{full}|{st.st_size}|{int(st.st_mtime)}".encode("utf-8")).hexdigest()
    cached = os.path.join(THUMBS_DIR, key + ".jpg")
    try:
        with open(cached, "rb") as f:
            return f.read(), "image/jpeg"
    except OSError:
        pass
    with Image.open(full) as img:
        img.thumbnail((THUMB_SIZE, THUMB_SIZE))
        buf = io.BytesIO()
        img.convert("RGB").save(buf, format="JPEG", quality=80)
    data = buf.getvalue()
    try:
        os.makedirs(THUMBS_DIR, exist_ok=True)
        with open(cached + ".tmp", "wb") as f:
            f.write(data)
        os.replace(cached + ".tmp", cached)
    except OSError:
        pass
    return data, "image/jpeg"


def open_item(body, q=None):
    """Apre con il programma di Windows uno screenshot convertito, oppure la cartella di uscita."""
    name = (body or {}).get("name")
    if name:
        full = _in_out_dir(name)
        if not full:
            raise ValueError(pick("Immagine non disponibile", "Image not available"))
    else:
        full = out_dir()
        os.makedirs(full, exist_ok=True)
    os.startfile(full)
    return {"status": "ok"}


# ============================================================================
# Esportazione in Markdown
# ============================================================================
def _md_session(d):
    lines = [f"## {d['title']}", ""]
    lines += [" ".join(d["summary"]), ""]
    if d["timeline"]:
        lines += [pick("### Cronologia", "### Timeline"), ""]
        for e in d["timeline"]:
            when = e["time"] + (f"–{e['until']}" if e.get("until") else "")
            text = pick(f"Nota: {e['text']}", f"Note: {e['text']}") if e["kind"] == "note" else e["text"]
            lines.append(f"- **{when}** {text}")
            lines += [f"  - {x}" for x in e["details"]]
            for sh in e["shots"]:
                label = " · ".join(x for x in (sh.get("system"), sh.get("body")) if x) or "Screenshot"
                lines.append(f"  - ![{label}](<{sh['png']}>)" if sh.get("png") else pick(f"  - Screenshot ({label}, non convertito)", f"  - Screenshot ({label}, not converted)"))
        lines.append("")
    session_notes = [n for n in d["notes"] if n.get("kind") != "time"]
    if session_notes:
        lines += [pick("### Note", "### Notes"), ""] + [f"- *{n['date']}* — {n['text']}" for n in session_notes] + [""]
    return lines


def export(body=None, q=None):
    sid = str((body or {}).get("session") or "")
    sessions = _sessions()
    items = _items()
    times = [i["t"] for i in items]
    with DATA_LOCK:
        data = _load()
    chosen = sessions[::-1] if sid == "all" else [_find(sessions, sid)]
    cmdr = next((s["commander"] for s in chosen if s.get("commander")), None)
    lines = [pick("# Diario di bordo", "# Logbook") + (f" — CMDR {cmdr}" if cmdr else ""), "",
             pick(f"*Generato da Voidwatch ED il {time.strftime('%d/%m/%Y %H:%M')}*",
                  f"*Generated by Voidwatch ED on {time.strftime('%d/%m/%Y %H:%M')}*"), ""]
    for s in chosen:
        lines += _md_session(_build(s, items, times, data, sessions))
    if sid == "all":
        name = pick("Diario di bordo - completo.md", "Logbook - full.md")
    else:
        name = pick("Diario di bordo", "Logbook") + f" - {time.strftime('%Y-%m-%d %H-%M', time.localtime(chosen[0]['start']))}.md"
    text = "\n".join(lines).rstrip() + "\n"
    for folder in (out_dir(data["settings"]), DOCUMENTS_DIR):
        try:
            os.makedirs(folder, exist_ok=True)
            path = os.path.join(folder, name)
            with open(path + ".tmp", "w", encoding="utf-8") as f:
                f.write(text)
            os.replace(path + ".tmp", path)
            return {"path": path, "sessions": len(chosen)}
        except OSError:
            continue
    raise ValueError(pick("Impossibile salvare il file del diario", "Couldn't save the logbook file"))
