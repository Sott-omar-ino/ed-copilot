"""EDDN (Elite Dangerous Data Network): dati di gioco anonimi (sistemi, corpi celesti, mercati) per tutta la comunità.

Regole seguite (docs/Developers.md e i README degli schemi nel ramo live di github.com/EDCD/EDDN):
- solo dati del gioco live: niente beta né Legacy (lo controlla __init__ prima di chiamare build);
- si tolgono tutte le chiavi *_Localised e i dati personali (multe, carburante, latitudine/longitudine, reputazione...);
- StarSystem/StarPos aggiunti solo dopo il controllo incrociato del SystemAddress con l'ultimo
  Location/FSDJump/CarrierJump: se non coincide il messaggio non parte (meglio nessun dato che un dato sbagliato);
- horizons/odyssey solo se presenti nel LoadGame (mai null), gameversion/gamebuild dal Fileheader;
- dopo un errore si riprova non prima di un minuto; mai di nuovo dopo un 400 o un 426 (messaggio non valido).
"""

import json
import os
import re
import time

from .. import VERSION
from ..lang import pick
from .outbox import Sender, backoff, post
from .tracker import LOCATION_EVENTS, NOT_REAL_SYSTEMS

UPLOAD_URL = "https://eddn.edcd.io:4430/upload/"
SOFTWARE = "ED Copilot"
# ED_COPILOT_EDDN_TEST=1: tutti i messaggi vanno agli schemi di prova (…/test), per provare l'invio senza sporcare i dati.
TEST = os.environ.get("ED_COPILOT_EDDN_TEST") == "1"
MAX_AGE = 3 * 86400
NO_RETRY = (400, 413, 426)

JOURNAL_EVENTS = {"Docked", "FSDJump", "Scan", "Location", "SAASignalsFound", "CarrierJump"}
PERSONAL = ("ActiveFine", "CockpitBreach", "BoostUsed", "FuelLevel", "FuelUsed", "JumpDist", "Latitude", "Longitude",
            "Wanted", "IsNewEntry", "NewTraitsDiscovered", "Traits", "VoucherAmount")
FACTION_PERSONAL = ("HappiestSystem", "HomeSystem", "MyReputation", "SquadronFaction")
FLAGS = ("horizons", "odyssey")

# Schemi con "additionalProperties": false: solo queste chiavi (le altre farebbero rifiutare il messaggio),
# poi le obbligatorie. Copiati dagli schemi live.
STRICT = {
    "fssdiscoveryscan/1": (("SystemName", "StarPos", "SystemAddress", "BodyCount", "NonBodyCount"), ()),
    "fssallbodiesfound/1": (("SystemName", "StarPos", "SystemAddress", "Count"), ()),
    "fssbodysignals/1": (("StarSystem", "StarPos", "SystemAddress", "BodyID", "Signals"), ("BodyName",)),
    "navbeaconscan/1": (("StarSystem", "StarPos", "SystemAddress", "NumBodies"), ()),
    "scanbarycentre/1": (("StarSystem", "StarPos", "SystemAddress", "BodyID"),
                         ("SemiMajorAxis", "Eccentricity", "OrbitalInclination", "Periapsis", "OrbitalPeriod",
                          "AscendingNode", "MeanAnomaly")),
    "approachsettlement/1": (("StarSystem", "StarPos", "SystemAddress", "Name", "BodyID", "BodyName", "Latitude", "Longitude"),
                             ("StationGovernment", "StationAllegiance", "StationEconomies", "StationFaction",
                              "StationServices", "StationEconomy", "MarketID")),
    "codexentry/1": (("System", "StarPos", "SystemAddress", "EntryID"),
                     ("Name", "Region", "Category", "Latitude", "Longitude", "SubCategory", "NearestDestination",
                      "VoucherAmount", "Traits", "BodyID", "BodyName")),
    "navroute/1": (("Route",), ()),
}
EVENT_SCHEMA = {"FSSDiscoveryScan": "fssdiscoveryscan/1", "FSSAllBodiesFound": "fssallbodiesfound/1",
                "FSSBodySignals": "fssbodysignals/1", "NavBeaconScan": "navbeaconscan/1",
                "ScanBaryCentre": "scanbarycentre/1", "ApproachSettlement": "approachsettlement/1",
                "CodexEntry": "codexentry/1"}
# Dove il nome del sistema sta in una chiave diversa da StarSystem.
NAME_KEY = {"fssdiscoveryscan/1": "SystemName", "fssallbodiesfound/1": "SystemName", "codexentry/1": "System"}
MODULE_RE = re.compile(r"^Hpt_|^Int_|Armour_", re.IGNORECASE)
COMMODITY_RE = re.compile(r"^\$(.+)_name;$", re.IGNORECASE)
HORIZONS_SKU = "ELITE_HORIZONS_V_PLANETARY_LANDINGS"


def schema_ref(schema):
    return f"https://eddn.edcd.io/schemas/{schema}{'/test' if TEST else ''}"


def strip_localised(o):
    if isinstance(o, dict):
        return {k: strip_localised(v) for k, v in o.items() if not k.endswith("_Localised")}
    if isinstance(o, list):
        return [strip_localised(v) for v in o]
    return o


def read_json(folder, name):
    try:
        with open(os.path.join(folder, name), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


class Builder:
    """Trasforma un evento del journal nei messaggi EDDN corrispondenti (zero, uno o più)."""

    def __init__(self, journal_dir, status_body=None):
        self.journal_dir = journal_dir
        self.status_body = status_body or (lambda: None)  # BodyName da Status.json (per CodexEntry)
        self.last_station = {}  # schema -> (marketId, contenuto) dell'ultimo invio: non si rimanda lo stesso mercato

    def header(self, t):
        return {"uploaderID": t.cmdr or "", "gameversion": t.gameversion or "", "gamebuild": t.gamebuild or "",
                "softwareName": SOFTWARE, "softwareVersion": VERSION}

    def wrap(self, schema, msg, t):
        for flag in FLAGS:
            v = getattr(t, flag)
            if isinstance(v, bool):
                msg[flag] = v
            else:
                msg.pop(flag, None)
        return {"$schemaRef": schema_ref(schema), "header": self.header(t), "message": msg}

    def build(self, e, t):
        ev = e.get("event")
        if not t.cmdr:
            return []
        if ev in JOURNAL_EVENTS:
            msg = self.journal(e, t)
            return [self.wrap("journal/1", msg, t)] if msg else []
        if ev in EVENT_SCHEMA:
            schema = EVENT_SCHEMA[ev]
            msg = self.single(schema, e, t)
            return [self.wrap(schema, msg, t)] if msg else []
        if ev == "NavRoute":
            msg = self.navroute(e)
            return [self.wrap("navroute/1", msg, t)] if msg else []
        if ev in ("Market", "Outfitting", "Shipyard"):
            built = getattr(self, ev.lower())(e)
            if not built:
                return []
            schema, msg = built
            key = (msg["marketId"], json.dumps(msg, sort_keys=True, default=str).replace(msg["timestamp"], ""))
            if self.last_station.get(schema) == key:
                return []
            self.last_station[schema] = key
            return [self.wrap(schema, msg, t)]
        return []

    # --- schema journal/1 ----------------------------------------------------
    def journal(self, e, t):
        msg = strip_localised(e)
        for k in PERSONAL:
            msg.pop(k, None)
        if isinstance(msg.get("Factions"), list):
            msg["Factions"] = [{k: v for k, v in f.items() if k not in FACTION_PERSONAL}
                               for f in msg["Factions"] if isinstance(f, dict)]
        if msg.get("StarSystem") in NOT_REAL_SYSTEMS or not isinstance(msg.get("SystemAddress"), int):
            return None
        if msg["event"] in LOCATION_EVENTS:
            if not isinstance(msg.get("StarPos"), list) or not msg.get("StarSystem"):
                return None
        else:
            if not t.location_matches(msg):  # per esempio uno Scan in ritardo dopo un salto
                return None
            msg.setdefault("StarSystem", t.system)
            msg.setdefault("StarPos", list(t.starpos))
        return msg

    # --- schemi dedicati a un evento ---------------------------------------
    def single(self, schema, e, t):
        required, optional = STRICT[schema]
        name_key = NAME_KEY.get(schema, "StarSystem")
        if schema == "approachsettlement/1" and ("Latitude" not in e or "Longitude" not in e):
            return None  # per esempio le boe dei visitatori: niente coordinate, niente messaggio
        src = strip_localised(e)
        if not t.location_matches(src, name_key):
            return None
        src.setdefault(name_key, t.system)
        src.setdefault("StarPos", list(t.starpos))
        if schema == "codexentry/1":
            for k in ("BodyName", "BodyID"):
                src.pop(k, None)
            body = self.status_body()
            if body:  # BodyID solo se il corpo di Status.json coincide con quello dell'ultimo ApproachBody
                src["BodyName"] = body
                if t.journal_body and t.journal_body[0] == body:
                    src["BodyID"] = t.journal_body[1]
        if schema == "approachsettlement/1":
            if isinstance(src.get("StationFaction"), dict):
                src["StationFaction"] = {k: v for k, v in src["StationFaction"].items() if k in ("Name", "FactionState")}
            if isinstance(src.get("StationEconomies"), list):
                src["StationEconomies"] = [{k: v for k, v in x.items() if k in ("Name", "Proportion")}
                                           for x in src["StationEconomies"] if isinstance(x, dict)]
        if schema == "fssbodysignals/1":
            src["Signals"] = [{"Type": s.get("Type"), "Count": s.get("Count")} for s in src.get("Signals") or []
                              if isinstance(s, dict) and isinstance(s.get("Type"), str) and isinstance(s.get("Count"), int)]
        return self.pick(src, required, optional)

    @staticmethod
    def pick(src, required, optional):
        msg = {"timestamp": src.get("timestamp"), "event": src.get("event")}
        for k in required:
            if src.get(k) in (None, "", []) and k != "Signals":
                return None
            msg[k] = src[k]
        for k in optional:
            v = src.get(k)
            if v not in (None, "") and not (isinstance(v, list) and not v) and not (isinstance(v, list) and "" in v):
                msg[k] = v
        return msg if msg["timestamp"] and msg["event"] else None

    def navroute(self, e):
        data = read_json(self.journal_dir, "NavRoute.json")
        if not data or data.get("event") != "NavRoute" or data.get("timestamp") != e.get("timestamp"):
            return None
        route = [{k: r.get(k) for k in ("StarSystem", "SystemAddress", "StarPos", "StarClass")}
                 for r in data.get("Route") or [] if isinstance(r, dict)]
        if not route or any(not r["StarSystem"] or not isinstance(r["SystemAddress"], int) or not r["StarClass"]
                            or not isinstance(r["StarPos"], list) or len(r["StarPos"]) != 3 for r in route):
            return None
        return {"timestamp": data["timestamp"], "event": "NavRoute", "Route": route}

    # --- mercato, equipaggiamento e cantiere (Market.json, Outfitting.json, Shipyard.json) ---
    def _station_file(self, e, name):
        data = read_json(self.journal_dir, name)
        # Il file dev'essere quello scritto per questo evento (stesso mercato e stesso istante).
        if (not data or data.get("MarketID") != e.get("MarketID") or data.get("timestamp") != e.get("timestamp")
                or not data.get("StarSystem") or not data.get("StationName")):
            return None
        return data

    @staticmethod
    def _station_msg(data):
        return {"timestamp": data["timestamp"], "systemName": data["StarSystem"], "stationName": data["StationName"],
                "marketId": data["MarketID"]}

    def market(self, e):
        data = self._station_file(e, "Market.json")
        if not data:
            return None
        commodities = []
        for i in data.get("Items") or []:
            if "nonmarketable" in (i.get("Category") or "").lower() or i.get("Legality"):
                continue  # limpet e merci non commerciate normalmente in questo mercato
            m = COMMODITY_RE.match(i.get("Name") or "")
            try:
                c = {"name": m.group(1) if m else i["Name"], "meanPrice": int(i["MeanPrice"]), "buyPrice": int(i["BuyPrice"]),
                     "stock": int(i["Stock"]), "stockBracket": i["StockBracket"], "sellPrice": int(i["SellPrice"]),
                     "demand": int(i["Demand"]), "demandBracket": i["DemandBracket"]}
            except (KeyError, TypeError, ValueError):
                continue
            if not c["name"] or c["stockBracket"] not in (0, 1, 2, 3, "") or c["demandBracket"] not in (0, 1, 2, 3, ""):
                continue
            flags = [f for f in ("Consumer", "Producer", "Rare") if i.get(f) is True]
            if flags:
                c["statusFlags"] = flags
            commodities.append(c)
        msg = self._station_msg(data)
        msg["commodities"] = sorted(commodities, key=lambda c: c["name"])
        if data.get("StationType"):
            msg["stationType"] = data["StationType"]
        if data.get("CarrierDockingAccess"):
            msg["carrierDockingAccess"] = data["CarrierDockingAccess"]
        return "commodity/3", msg

    def outfitting(self, e):
        data = self._station_file(e, "Outfitting.json")
        if not data:
            return None
        names = {MODULE_RE.sub(lambda m: m.group(0).capitalize(), i["Name"]) for i in data.get("Items") or []
                 if isinstance(i.get("Name"), str) and MODULE_RE.search(i["Name"])
                 and i["Name"].lower() != "int_planetapproachsuite" and i.get("sku") in (None, HORIZONS_SKU)}
        names = {n for n in names if re.search(r"^Hpt_|^Int_|_Armour_", n)}
        if not names:
            return None
        msg = self._station_msg(data)
        msg["modules"] = sorted(names)
        return "outfitting/2", msg

    def shipyard(self, e):
        data = self._station_file(e, "Shipyard.json")
        if not data:
            return None
        ships = {s["ShipType"] for s in data.get("PriceList") or data.get("Pricelist") or []
                 if isinstance(s, dict) and s.get("ShipType")}
        if not ships:
            return None
        msg = self._station_msg(data)
        msg["ships"] = sorted(ships)
        return "shipyard/2", msg


class EddnSender(Sender):
    name = "eddn"

    def tick(self):
        if not self.config().get("upload_eddn"):
            return
        now = time.time()
        for item in self.box.ready("eddn", 20, now):
            if now - item["ts"] > MAX_AGE:
                self.box.remove("eddn", [item["id"]])
                continue
            body = json.dumps(item["data"], ensure_ascii=False).encode("utf-8")
            code, text, _ = post(UPLOAD_URL, body, gzip_over=4096)
            schema = item["data"].get("$schemaRef", "").removeprefix("https://eddn.edcd.io/schemas/")
            if code == 200:
                self.box.remove("eddn", [item["id"]])
                self.ok()
            elif code in NO_RETRY:  # messaggio non valido: non va mai rimandato
                self.box.remove("eddn", [item["id"]])
                self.error(pick(f"EDDN ha scartato un messaggio {schema} ({code}): {text.strip()[:300]}",
                                f"EDDN rejected a {schema} message ({code}): {text.strip()[:300]}"))
            else:
                self.box.postpone("eddn", [item["id"]], backoff(item["tries"]))
                self.error(pick(f"EDDN non raggiungibile ({code or text}): riprovo più tardi",
                                f"EDDN unreachable ({code or text}): retrying later"))
                break
