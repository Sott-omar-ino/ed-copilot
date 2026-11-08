"""Inara (inara.cz): aggiornamento del profilo del comandante con gli eventi di scrittura dell'INAPI.

Usa la stessa chiave API personale della lettura (app/inara.py). Regole della guida per sviluppatori di Inara:
- solo dati del gioco live (niente beta né Legacy 3.8);
- eventi a gruppi e poche richieste: qui al massimo una ogni MIN_INTERVAL secondi; gli eventi che sovrascrivono
  tutto (materiali, stiva, moduli in deposito, statistiche...) si sostituiscono in coda invece di accumularsi;
- l'app deve essere approvata (white-list) dall'autore di Inara: finché non lo è, Inara rifiuta tutto il gruppo
  e il testo dell'errore compare nello stato dell'invio. Gli eventi restano in coda (fino a 30 giorni).
"""

import json
import os
import time
from datetime import datetime, timezone

from .. import VERSION
from ..lang import pick
from .outbox import Sender, backoff, post

ENDPOINT = "https://inara.cz/inapi/v1/"
APP_NAME = "ED Copilot"
DEV = os.environ.get("ED_COPILOT_INARA_DEV") == "1"   # isBeingDeveloped: per le prove su un account di test
MIN_INTERVAL, BATCH_WAIT, BATCH_MAX = 45, 10, 200
MAX_AGE = 30 * 86400                                   # Inara non accetta eventi più vecchi di 30 giorni
RANK_NAMES = ("Combat", "Trade", "Explore", "Soldier", "Exobiologist", "Empire", "Federation", "CQC")
ENGINEER_STAGES = ("Invited", "Acquainted", "Unlocked", "Barred")


def _event(name, ts, data):
    return {"eventName": name, "eventTimestamp": ts, "eventData": data}


def _merge(old, new):
    """Per setCommanderShip: le proprietà nuove si aggiungono a quelle già in coda per la stessa nave."""
    return {**new, "eventData": {**old["eventData"], **new["eventData"]}}


def _same(a, b):
    return json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)


class Builder:
    """Evento del journal -> eventi Inara: lista di (dati, chiave per sostituire in coda, funzione di unione)."""

    def __init__(self, journal_dir):
        self.journal_dir = journal_dir
        self.reset()

    def reset(self):
        self.undocked = False         # ripartito senza entrare in supercruise: un nuovo Docked non va nel diario
        self.suppress_docked = False  # attracco già noto (inizio sessione, salto del carrier, cambio nave)
        self.sent = {}                # ultimo contenuto accodato per gli eventi "completi" (niente doppioni)

    def _once(self, key, data):
        if key in self.sent and _same(self.sent[key], data):
            return False
        self.sent[key] = data
        return True

    def _ship(self, t):
        return {"shipType": t.ship_type, "shipGameID": t.ship_id} if t.ship_type and t.ship_id is not None else {}

    def _travel_ship(self, e, t):
        if e.get("Taxi") or t.taxi:
            return {"isTaxiDropship": True} if t.dropship else {"isTaxiShuttle": True}
        return self._ship(t)

    def build(self, e, t):
        ev, ts = e.get("event"), e.get("timestamp")
        if not ev or not ts or not t.cmdr:
            return []
        fn = getattr(self, "on_" + ev, None)
        out = fn(e, t, ts) if fn else None
        return [x if isinstance(x, tuple) else (x, None, None) for x in out or []]

    # --- sessione, crediti, ranghi --------------------------------------------
    def on_LoadGame(self, e, t, ts):
        self.reset()

    def on_Statistics(self, e, t, ts):
        stats = {k: v for k, v in e.items() if isinstance(v, dict)}
        out = [(_event("setCommanderGameStatistics", ts, stats), "stats", None)]
        if t.credits is not None:
            credits = {"commanderCredits": t.credits, "commanderLoan": t.loan or 0}
            wealth = (stats.get("Bank_Account") or {}).get("Current_Wealth")
            if isinstance(wealth, int):
                credits["commanderAssets"] = wealth
            out.append((_event("setCommanderCredits", ts, credits), "credits", None))
        return out

    def on_Progress(self, e, t, ts):
        ranks = []
        for name in RANK_NAMES:
            if isinstance(e.get(name), (int, float)):
                r = {"rankName": name.lower(), "rankProgress": round(e[name] / 100, 4)}
                if isinstance(t.ranks.get(name), int):
                    r["rankValue"] = t.ranks[name]
                ranks.append(r)
        return [(_event("setCommanderRankPilot", ts, ranks), "ranks", None)] if ranks else []

    def on_Promotion(self, e, t, ts):
        ranks = [{"rankName": n.lower(), "rankValue": e[n], "rankProgress": 0} for n in RANK_NAMES if isinstance(e.get(n), int)]
        return [_event("setCommanderRankPilot", ts, ranks)] if ranks else []

    def on_Reputation(self, e, t, ts):
        rep = [{"majorfactionName": k.lower(), "majorfactionReputation": round(e[k] / 100, 4)}
               for k in ("Federation", "Empire", "Alliance", "Independent") if isinstance(e.get(k), (int, float))]
        return [(_event("setCommanderReputationMajorFaction", ts, rep), "reputation", None)] if rep else []

    def on_EngineerProgress(self, e, t, ts):
        rows = e.get("Engineers") if isinstance(e.get("Engineers"), list) else [e]
        data = []
        for r in rows:
            if not r.get("Engineer"):
                continue
            d = {"engineerName": r["Engineer"]}
            if r.get("Progress") in ENGINEER_STAGES:
                d["rankStage"] = r["Progress"]
            if isinstance(r.get("Rank"), int):
                d["rankValue"] = r["Rank"]
            if len(d) > 1:
                data.append(d)
        if not data:
            return []
        return [_event("setCommanderRankEngineer", ts, data if len(rows) > 1 else data[0])]

    # --- navi -------------------------------------------------------------------
    def on_Loadout(self, e, t, ts):
        if not e.get("Ship") or e.get("ShipID") is None:
            return []
        sid = e["ShipID"]
        ship = {"shipType": e["Ship"], "shipGameID": sid, "isCurrentShip": True}
        for k, src in (("shipName", "ShipName"), ("shipIdent", "ShipIdent"), ("shipMaxJumpRange", "MaxJumpRange"),
                       ("shipCargoCapacity", "CargoCapacity"), ("shipHullValue", "HullValue"),
                       ("shipModulesValue", "ModulesValue"), ("shipRebuyCost", "Rebuy")):
            if e.get(src) not in (None, ""):
                ship[k] = e[src]
        out = []
        if self._once(f"ship:{sid}", ship):
            out.append((_event("setCommanderShip", ts, ship), f"ship:{sid}", _merge))
        loadout = {"shipType": e["Ship"], "shipGameID": sid, "shipLoadout": [self._module(m) for m in e.get("Modules") or []]}
        if self._once(f"loadout:{sid}", loadout):
            out.append((_event("setCommanderShipLoadout", ts, loadout), f"loadout:{sid}", None))
        return out

    @staticmethod
    def _module(m):
        out = {"slotName": m.get("Slot"), "itemName": m.get("Item")}
        for k, src in (("itemHealth", "Health"), ("isOn", "On"), ("itemPriority", "Priority"), ("itemValue", "Value"),
                       ("itemAmmoClip", "AmmoInClip"), ("itemAmmoHopper", "AmmoInHopper"), ("isHot", "Hot")):
            if src in m:
                out[k] = m[src]
        eng = m.get("Engineering")
        if isinstance(eng, dict):
            ed = {"blueprintName": eng.get("BlueprintName"), "blueprintLevel": eng.get("Level"),
                  "blueprintQuality": eng.get("Quality")}
            if eng.get("ExperimentalEffect"):
                ed["experimentalEffect"] = eng["ExperimentalEffect"]
            mods = []
            for mod in eng.get("Modifiers") or []:
                x = {"name": mod.get("Label")}
                if "OriginalValue" in mod:
                    x.update(value=mod.get("Value"), originalValue=mod["OriginalValue"], lessIsGood=bool(mod.get("LessIsGood")))
                else:
                    x["value"] = mod.get("ValueStr", mod.get("Value"))
                mods.append(x)
            ed["modifiers"] = mods
            out["engineering"] = ed
        return out

    def on_SetUserShipName(self, e, t, ts):
        if not e.get("Ship") or e.get("ShipID") is None:
            return []
        sid = e["ShipID"]
        return [(_event("setCommanderShip", ts, {"shipType": e["Ship"], "shipGameID": sid, "shipName": e.get("UserShipName"),
                                                 "shipIdent": e.get("UserShipId")}), f"ship:{sid}", _merge)]

    def _here(self, t):
        d = {"starsystemName": t.system, "stationName": t.station, "marketID": t.market_id}
        return {k: v for k, v in d.items() if v is not None}

    def on_ShipyardSwap(self, e, t, ts):
        self.suppress_docked = True
        if e.get("StoreShipID") is None or not e.get("StoreOldShip"):
            return []
        sid = e["StoreShipID"]
        return [(_event("setCommanderShip", ts, {"shipType": e["StoreOldShip"], "shipGameID": sid, **self._here(t)}),
                 f"ship:{sid}", _merge)]

    def on_ShipyardNew(self, e, t, ts):
        self.suppress_docked = True
        if not e.get("ShipType") or e.get("NewShipID") is None:
            return []
        return [_event("addCommanderShip", ts, {"shipType": e["ShipType"], "shipGameID": e["NewShipID"]})]

    def on_ShipyardBuy(self, e, t, ts):
        if e.get("StoreShipID") is not None and e.get("StoreOldShip"):
            return [_event("setCommanderShip", ts, {"shipType": e["StoreOldShip"], "shipGameID": e["StoreShipID"], **self._here(t)})]
        if e.get("SellShipID") is not None and e.get("SellOldShip"):
            return [_event("delCommanderShip", ts, {"shipType": e["SellOldShip"], "shipGameID": e["SellShipID"]})]
        return []

    def on_ShipyardSell(self, e, t, ts):
        if e.get("SellShipID") is None or not e.get("ShipType"):
            return []
        return [_event("delCommanderShip", ts, {"shipType": e["ShipType"], "shipGameID": e["SellShipID"]})]

    def on_ShipyardTransfer(self, e, t, ts):
        if not e.get("ShipType") or e.get("ShipID") is None:
            return []
        data = {"shipType": e["ShipType"], "shipGameID": e["ShipID"], **self._here(t)}
        if isinstance(e.get("TransferTime"), int):
            data["transferTime"] = e["TransferTime"]
        return [_event("setCommanderShipTransfer", ts, data)]

    def on_StoredShips(self, e, t, ts):
        here = {"starsystemName": e.get("StarSystem"), "stationName": e.get("StationName"), "marketID": e.get("MarketID")}
        out = []
        for remote, ships in ((False, e.get("ShipsHere") or []), (True, e.get("ShipsRemote") or [])):
            for s in ships:
                if not s.get("ShipType") or s.get("ShipID") is None:
                    continue
                d = {"shipType": s["ShipType"], "shipGameID": s["ShipID"], "isHot": bool(s.get("Hot"))}
                if s.get("Name"):
                    d["shipName"] = s["Name"]
                loc = {"starsystemName": s.get("StarSystem"), "marketID": s.get("ShipMarketID")} if remote else here
                d.update({k: v for k, v in loc.items() if v is not None})
                key = f"ship:{s['ShipID']}"
                if self._once(f"stored:{s['ShipID']}", d):
                    out.append((_event("setCommanderShip", ts, d), key, _merge))
        return out

    # --- viaggi -------------------------------------------------------------
    def on_FSDJump(self, e, t, ts):
        self.undocked = False
        if not e.get("StarSystem"):
            return []
        d = {"starsystemName": e["StarSystem"], **self._travel_ship(e, t)}
        if isinstance(e.get("StarPos"), list):
            d["starsystemCoords"] = e["StarPos"]
        if isinstance(e.get("JumpDist"), (int, float)):
            d["jumpDistance"] = e["JumpDist"]
        return [_event("addCommanderTravelFSDJump", ts, d)] + self._materials_cargo(t, ts)

    def on_CarrierJump(self, e, t, ts):
        self.suppress_docked = True
        if not e.get("StarSystem"):
            return []
        d = {"starsystemName": e["StarSystem"], **self._ship(t)}
        for k, src in (("starsystemCoords", "StarPos"), ("stationName", "StationName"), ("marketID", "MarketID")):
            if e.get(src) is not None:
                d[k] = e[src]
        return [_event("addCommanderTravelCarrierJump", ts, d)]

    def on_Location(self, e, t, ts):
        if e.get("Docked"):
            self.suppress_docked = True  # all'avvio da attraccati: il Docked c'è già nel diario della sessione prima
        if not e.get("StarSystem"):
            return []
        d = {"starsystemName": e["StarSystem"]}
        if isinstance(e.get("StarPos"), list):
            d["starsystemCoords"] = e["StarPos"]
        if e.get("Docked"):
            d.update({k: v for k, v in (("stationName", e.get("StationName")), ("marketID", e.get("MarketID"))) if v is not None})
        if e.get("BodyType") == "Planet" and e.get("Body"):
            d["starsystemBodyName"] = e["Body"]
        return [(_event("setCommanderTravelLocation", ts, d), "location", None)]

    def on_Docked(self, e, t, ts):
        if self.undocked or self.suppress_docked:
            self.undocked = self.suppress_docked = False
            return self._materials_cargo(t, ts)
        if not e.get("StarSystem") or not e.get("StationName"):
            return []
        d = {"starsystemName": e["StarSystem"], "stationName": e["StationName"], **self._travel_ship(e, t)}
        if e.get("MarketID") is not None:
            d["marketID"] = e["MarketID"]
        return [_event("addCommanderTravelDock", ts, d)] + self._materials_cargo(t, ts)

    def on_Undocked(self, e, t, ts):
        self.undocked = True

    def on_SupercruiseEntry(self, e, t, ts):
        self.undocked = False

    # --- inventario -----------------------------------------------------------
    def _materials_cargo(self, t, ts):
        """Materiali: inventario completo ricostruito dagli eventi, inviato solo se è cambiato."""
        mats = [{"itemName": k, "itemCount": v} for k, v in sorted(t.materials.items()) if v > 0]
        if not t.materials or not self._once("materials", mats):
            return []
        return [(_event("setCommanderInventoryMaterials", ts, mats), "materials", None)]

    def on_Materials(self, e, t, ts):
        return self._materials_cargo(t, ts)

    def on_Cargo(self, e, t, ts):
        if e.get("Vessel", "Ship") != "Ship":
            return []
        inv = e.get("Inventory")
        if inv is None:  # senza Inventory il contenuto è in Cargo.json
            try:
                with open(os.path.join(self.journal_dir, "Cargo.json"), encoding="utf-8") as f:
                    data = json.load(f)
                inv = data.get("Inventory") if data.get("Vessel", "Ship") == "Ship" else None
            except (OSError, ValueError):
                inv = None
        if not isinstance(inv, list):
            return []
        cargo = []
        for i in inv:
            name, count, stolen = i.get("Name"), i.get("Count") or 0, i.get("Stolen") or 0
            if not name:
                continue
            extra = {"missionGameID": i["MissionID"]} if i.get("MissionID") else {}
            if count - stolen > 0:
                cargo.append({"itemName": name, "itemCount": count - stolen, **extra})
            if stolen > 0:
                cargo.append({"itemName": name, "itemCount": stolen, "isStolen": True, **extra})
        if not self._once("cargo", cargo):
            return []
        return [(_event("setCommanderInventoryCargo", ts, cargo), "cargo", None)]

    def on_StoredModules(self, e, t, ts):
        mods = []
        for m in sorted(e.get("Items") or [], key=lambda m: m.get("StorageSlot") or 0):
            if not m.get("Name"):
                continue
            d = {"itemName": m["Name"]}
            for k, src in (("itemValue", "BuyPrice"), ("isHot", "Hot"), ("starsystemName", "StarSystem"), ("marketID", "MarketID")):
                if m.get(src) is not None:
                    d[k] = m[src]
            if m.get("EngineerModifications"):
                d["engineering"] = {"blueprintName": m["EngineerModifications"]}
                for k, src in (("blueprintLevel", "Level"), ("blueprintQuality", "Quality")):
                    if m.get(src) is not None:
                        d["engineering"][k] = m[src]
            mods.append(d)
        if not self._once("storage", mods):
            return []
        return [(_event("setCommanderStorageModules", ts, mods), "storage", None)]

    # --- missioni ------------------------------------------------------------
    def on_MissionAccepted(self, e, t, ts):
        if not e.get("Name") or e.get("MissionID") is None:
            return []
        d = {"missionName": e["Name"], "missionGameID": e["MissionID"]}
        for k, src in (("missionExpiry", "Expiry"), ("influenceGain", "Influence"), ("reputationGain", "Reputation"),
                       ("minorfactionNameOrigin", "Faction"), ("starsystemNameTarget", "DestinationSystem"),
                       ("stationNameTarget", "DestinationStation"), ("minorfactionNameTarget", "TargetFaction"),
                       ("commodityName", "Commodity"), ("commodityCount", "Count"), ("targetName", "Target"),
                       ("targetType", "TargetType"), ("killCount", "KillCount"), ("passengerType", "PassengerType"),
                       ("passengerCount", "PassengerCount"), ("passengerIsVIP", "PassengerVIPs"),
                       ("passengerIsWanted", "PassengerWanted")):
            if e.get(src) is not None:
                d[k] = e[src]
        if t.system:
            d["starsystemNameOrigin"] = t.system
        if t.station:
            d["stationNameOrigin"] = t.station
        return [_event("addCommanderMission", ts, d)]

    def on_MissionCompleted(self, e, t, ts):
        if e.get("MissionID") is None:
            return []
        d = {"missionGameID": e["MissionID"]}
        if isinstance(e.get("Reward"), int):
            d["rewardCredits"] = e["Reward"]
        if isinstance(e.get("Donated"), int) or isinstance(e.get("Donation"), (int, str)):
            try:
                d["donationCredits"] = int(e.get("Donated", e.get("Donation")))
            except (TypeError, ValueError):
                pass
        if e.get("PermitsAwarded"):
            d["rewardPermits"] = [{"starsystemName": p} for p in e["PermitsAwarded"]]
        for k, src in (("rewardCommodities", "CommodityReward"), ("rewardMaterials", "MaterialsReward")):
            if e.get(src):
                d[k] = [{"itemName": x.get("Name"), "itemCount": x.get("Count")} for x in e[src]]
        effects = []
        for f in e.get("FactionEffects") or []:
            eff = {"minorfactionName": f.get("Faction")}
            gains = [i.get("Influence") for i in f.get("Influence") or [] if i.get("Influence")]
            if gains:
                eff["influenceGain"] = max(gains, key=len)
            if f.get("Reputation"):
                eff["reputationGain"] = f["Reputation"]
            if eff["minorfactionName"]:
                effects.append(eff)
        if effects:
            d["minorfactionEffects"] = effects
        return [_event("setCommanderMissionCompleted", ts, d)] + self._materials_cargo(t, ts)

    def on_MissionFailed(self, e, t, ts):
        return [_event("setCommanderMissionFailed", ts, {"missionGameID": e["MissionID"]})] if e.get("MissionID") is not None else []

    def on_MissionAbandoned(self, e, t, ts):
        return [_event("setCommanderMissionAbandoned", ts, {"missionGameID": e["MissionID"]})] if e.get("MissionID") is not None else []


def _age(item):
    try:
        ts = datetime.strptime(item["data"]["eventTimestamp"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp()
    except (KeyError, TypeError, ValueError):
        return 0
    return time.time() - ts


class InaraSender(Sender):
    name = "inara"

    def __init__(self, box, config):
        super().__init__(box, config)
        self.last_try = 0.0

    def tick(self):
        cfg = self.config()
        if not cfg.get("upload_inara"):
            return
        key = (cfg.get("inara_api_key") or "").strip()
        if not key:
            self.last_error = pick("Manca la chiave API di Inara (pannello Inara qui sopra)", "Inara API key missing (Inara panel above)")
            return
        now = time.time()
        if self.check_pause(key) or now - self.last_try < MIN_INTERVAL:
            return
        items = self.box.ready("inara", BATCH_MAX, now)
        old = [i["id"] for i in items if _age(i) > MAX_AGE]
        if old:
            self.box.remove("inara", old)
            items = [i for i in items if i["id"] not in old]
        if not items or now - items[0]["ts"] < BATCH_WAIT:
            return
        meta = items[0]["meta"]
        batch = []
        for i in items:  # una richiesta = un comandante
            if i["meta"] != meta:
                break
            batch.append(i)
        self.last_try = now
        self.send(batch, meta, key)

    def send(self, batch, meta, key):
        ids = [i["id"] for i in batch]
        header = {"appName": APP_NAME, "appVersion": VERSION, "isBeingDeveloped": DEV, "APIkey": key}
        if meta.get("cmdr"):
            header["commanderName"] = meta["cmdr"]
        if meta.get("fid"):
            header["commanderFrontierID"] = meta["fid"]
        events = [{**i["data"], "eventCustomID": n} for n, i in enumerate(batch)]
        body = json.dumps({"header": header, "events": events}, ensure_ascii=False).encode("utf-8")
        code, text, _ = post(ENDPOINT, body, timeout=30)
        try:
            reply = json.loads(text) if code == 200 else None
            head = (reply or {}).get("header") or {}
            status = int(head.get("eventStatus") or 0)
        except (ValueError, TypeError, AttributeError):
            reply, status = None, 0
        if not reply:
            self.box.postpone("inara", ids, backoff(batch[0]["tries"]))
            self.error(pick(f"Inara non raggiungibile ({code or text}): riprovo più tardi",
                            f"Inara unreachable ({code or text}): retrying later"))
            return
        if status // 100 != 2:
            # Tutto il gruppo è stato rifiutato: chiave non valida, app non ancora approvata da Inara, ecc.
            # Gli eventi restano in coda; si riprova quando cambi la chiave o riavvii l'app.
            text = head.get("eventStatusText") or ""
            if "no access allowed" in text.lower():  # nome dell'app non ancora approvato da Inara
                from ..inara import not_approved
                self.pause(not_approved().split(": ")[0] + ".", key)
            else:
                self.pause(f"Inara {status}: {text or pick('richiesta rifiutata', 'request rejected')}", key)
            return
        self.box.remove("inara", ids)
        self.ok(len(ids))
        for sent, r in zip(events, reply.get("events") or []):
            if isinstance(r, dict) and int(r.get("eventStatus") or 200) == 400:
                why = r.get('eventStatusText') or pick('errore', 'error')
                self.error(pick(f"Inara ha rifiutato {sent['eventName']}: {why}", f"Inara rejected {sent['eventName']}: {why}"))
