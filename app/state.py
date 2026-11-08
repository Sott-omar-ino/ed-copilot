"""Stato del comandante ricostruito dagli eventi del journal."""

import json
import math
import os
import threading
import time
from datetime import datetime, timezone

from .gamedata import (ENGINEER_ALIASES, GENUS_DISTANCE, GRADE_CAP, MATERIAL_GRADE, RANK_LABELS, RANKS, RANKS_EN,
                      SCOOPABLE, SHIP_NAMES, SPECIES_VALUES)
from .lang import is_en, pick
from .ships import parse_loadout

# Nomi dei rank in inglese (le chiavi di RANK_LABELS sono i nomi del journal).
RANK_LABELS_EN = {"Combat": "Combat", "Trade": "Trade", "Explore": "Exploration", "Soldier": "Mercenary",
                  "Exobiologist": "Exobiologist", "Empire": "Empire", "Federation": "Federation"}


def rank_label(k):
    return pick(RANK_LABELS.get(k, k), RANK_LABELS_EN.get(k, k))


def body_value(b, mapped=False, efficient=False):
    """Stima del valore cartografico (formula usata da EDDiscovery/EDMC)."""
    first = not b.get("was_discovered", True)
    if b["kind"] == "star":
        sc = b.get("class") or ""
        k = 1200
        if sc in ("N", "H"):
            k = 22628
        elif sc.startswith("D"):
            k = 14057
        elif sc == "SupermassiveBlackHole":
            k = 33.5678
        v = k + b.get("mass", 0) * k / 66.25
        return round(v * (2.6 if first else 1))

    pc, tf = b.get("class") or "", b.get("terraformable", False)
    k, tf_bonus = 300, 93328
    if pc == "Metal rich body":
        k, tf_bonus = 21790, 65631
    elif pc == "Ammonia world":
        k, tf_bonus = 96932, 0
    elif pc == "Sudarsky class I gas giant":
        k, tf_bonus = 1656, 0
    elif pc in ("Sudarsky class II gas giant", "High metal content body"):
        k, tf_bonus = 9654, 100677
    elif pc in ("Water world", "Earthlike body"):
        k, tf_bonus = 64831, 116295
        if pc == "Earthlike body":
            tf = True
    if tf:
        k += tf_bonus

    q = 0.56591828
    v = k + k * q * max(b.get("mass", 0), 0) ** 0.2
    if mapped:
        if first and not b.get("was_mapped"):
            v *= 3.699622554
        elif not b.get("was_mapped"):
            v *= 8.0956
        else:
            v *= 3.3333333333
        v += max(v * 0.3, 555)  # bonus Odyssey
        if efficient:
            v *= 1.25
    v = max(500, v)
    if first:
        v *= 2.6
    return round(v)


def haversine(lat1, lon1, lat2, lon2, radius):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(min(1, a)))


def read_json(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def parse_ts(ts):
    try:
        return datetime.strptime(ts, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp()
    except (TypeError, ValueError):
        return time.time()


def ship_name(symbol, localised=None):
    if localised and not localised.startswith("$"):
        return localised
    return SHIP_NAMES.get((symbol or "").lower(), symbol)


def station_name(name, localised=None):
    """Nome della stazione da mostrare. Alcune stazioni (es. la Colonisation Ship) hanno nel journal un segnaposto
    di localizzazione come "$EXT_PANEL_ColonisationShip; Nome": si usa la parte leggibile o StationName_Localised."""
    if not name or not str(name).startswith("$"):
        return name or (localised if localised and not localised.startswith("$") else None)
    if "; " in name and name.split("; ")[-1].strip():
        return name.split("; ")[-1].strip()
    if localised and not localised.startswith("$"):
        return localised
    if name.startswith("$EXT_PANEL_ColonisationShip"):
        return "Colonisation Ship"
    return name.strip("$;").split(":")[0].replace("_", " ")


class State:
    def __init__(self, journal_dir):
        self.journal_dir = journal_dir
        self.lock = threading.Lock()
        self.live = False
        self.cmdr = {}
        self.ranks = {}
        self.progress = {}
        self.reputation = {}
        self.statistics = {}
        self.location = {}
        self.system = self._new_system(None, None)
        # Sistemi visitati con i corpi già scansionati: tornando in un sistema il gioco non riscrive le scansioni nel
        # journal, quindi si riprendono da qui (al massimo gli ultimi 300 sistemi).
        self.systems_seen = {}
        self.bio_current = None
        self.fsd_health = 100
        self.jump = None  # ultimo salto iperspaziale: per l'animazione del salto nell'interfaccia
        self.bio_unsold = []
        self.carto_unsold = {}      # sistema -> {body_id: valore}
        self.learned_values = {}
        self.materials = {}         # nome -> {name, category, count}
        self.engineers = {}         # nome -> {progress, rank}
        self.missions = {}          # id -> dettagli
        self.ship = {}
        self.ships = {}             # ShipID -> posizione e dati base di ogni nave posseduta
        self.loadouts = {}          # ShipID -> build (dall'ultimo Loadout)
        self.current_ship_id = None
        self.fleet_updated = None
        self.mining = self._new_mining()
        self.trades = []
        self.feed = []
        self.session = {"jumps": 0, "ly": 0.0, "start": None}
        self.carrier = {}
        self.suits = {}             # SuitID -> {name, class, mods} (Odyssey)
        self.weapons = {}           # SuitModuleID -> {name, class, mods}
        self.suit_loadout = {}      # loadout attuale: {suit, name, weapons}
        self.onfoot_costs = {}      # "nome:classe" -> crediti pagati in un UpgradeSuit/UpgradeWeapon

    @staticmethod
    def _new_mining():
        return {"prospected": [], "refined": {}, "limpets": {}, "cracked": 0, "start": None}

    @staticmethod
    def _new_system(name, address):
        return {"name": name, "address": address, "body_count": None, "all_found": False,
                "bodies": {}, "non_bodies": None}

    def note(self, ts, text, kind="info"):
        if self.live:
            self.feed.insert(0, {"ts": ts, "text": text, "kind": kind})
            del self.feed[30:]

    def species_value(self, species):
        return self.learned_values.get(species) or SPECIES_VALUES.get(species, 0)

    def handle(self, e):
        ev = e.get("event")
        fn = getattr(self, "on_" + ev, None) if ev else None
        if fn:
            fn(e)

    # --- comandante e nave ---------------------------------------------------
    def on_LoadGame(self, e):
        self.cmdr.update(name=e.get("Commander"), credits=e.get("Credits"), mode=e.get("GameMode"),
                         group=e.get("Group"), fuel_cap=e.get("FuelCapacity"), fid=e.get("FID"))
        self.ship.update(type=ship_name(e.get("Ship"), e.get("Ship_Localised")),
                         name=e.get("ShipName"), ident=e.get("ShipIdent"), id=e.get("ShipID"))
        self.current_ship_id = e.get("ShipID")
        self.session = {"jumps": 0, "ly": 0.0, "start": e.get("timestamp")}
        self.mining = self._new_mining()
        self.trades = []

    def on_Loadout(self, e):
        self.ship.update(
            id=e.get("ShipID"), type=ship_name(e.get("Ship")), name=e.get("ShipName"),
            ident=e.get("ShipIdent"), hull_value=e.get("HullValue"), modules_value=e.get("ModulesValue"),
            rebuy=e.get("Rebuy"), jump_range=e.get("MaxJumpRange"), cargo=e.get("CargoCapacity"),
            modules=[{
                "slot": m.get("Slot"), "item": m.get("Item"),
                "engineering": (m.get("Engineering") or {}).get("BlueprintName"),
                "level": (m.get("Engineering") or {}).get("Level"),
                "effect": (m.get("Engineering") or {}).get("ExperimentalEffect_Localised"),
            } for m in e.get("Modules", [])])
        self.cmdr["fuel_cap"] = (e.get("FuelCapacity") or {}).get("Main", self.cmdr.get("fuel_cap"))
        sid = e.get("ShipID")
        for m in e.get("Modules", []):
            if "frameshiftdrive" in (m.get("Slot") or "").lower():
                h = m.get("Health")
                self.fsd_health = round(h * 100) if h is not None else 100
        self.current_ship_id = sid
        self.loadouts[sid] = parse_loadout(e, ship_name)
        entry = self.ships.setdefault(sid, {"id": sid})
        entry.update(symbol=(e.get("Ship") or "").lower(), type=ship_name(e.get("Ship")),
                     name=e.get("ShipName"), ident=e.get("ShipIdent"), in_transit=False,
                     value=(e.get("HullValue") or 0) + (e.get("ModulesValue") or 0))

    def on_SetUserShipName(self, e):
        if e.get("ShipID") == self.ship.get("id"):
            self.ship.update(name=e.get("UserShipName"), ident=e.get("UserShipId"))

    def on_StoredShips(self, e):
        keep = {self.current_ship_id}
        for here, items in ((True, e.get("ShipsHere", [])), (False, e.get("ShipsRemote", []))):
            for item in items:
                sid = item.get("ShipID")
                keep.add(sid)
                entry = self.ships.setdefault(sid, {"id": sid})
                if entry.get("symbol") and entry["symbol"] != (item.get("ShipType") or "").lower():
                    self.loadouts.pop(sid, None)  # ID riciclato da una nave venduta
                entry.update(symbol=(item.get("ShipType") or "").lower(),
                             type=ship_name(item.get("ShipType"), item.get("ShipType_Localised")),
                             name=item.get("Name") or entry.get("name"), value=item.get("Value") or entry.get("value"),
                             hot=item.get("Hot", False),
                             system=e.get("StarSystem") if here else item.get("StarSystem"),
                             station=station_name(e.get("StationName"), e.get("StationName_Localised")) if here else None,
                             in_transit=item.get("InTransit", False), arrival=None,
                             transfer_price=item.get("TransferPrice"), transfer_time=item.get("TransferTime"))
        for sid in list(self.ships):
            if sid not in keep:
                self._remove_ship(sid)
        self.fleet_updated = {"ts": e.get("timestamp"), "station": station_name(e.get("StationName"), e.get("StationName_Localised")), "system": e.get("StarSystem")}

    def _store_here(self, sid):
        if sid is None:
            return
        entry = self.ships.setdefault(sid, {"id": sid})
        entry.update(system=self.location.get("system"), station=self.location.get("station"), in_transit=False)

    def on_ShipyardSwap(self, e):
        self._store_here(e.get("StoreShipID"))
        self.current_ship_id = e.get("ShipID")
        if e.get("SellShipID") is not None:
            self._remove_ship(e["SellShipID"])

    def on_ShipyardBuy(self, e):
        if e.get("StoreShipID") is not None:
            self._store_here(e["StoreShipID"])
        if e.get("SellShipID") is not None:
            self._remove_ship(e["SellShipID"])

    def on_ShipyardNew(self, e):
        sid = e.get("NewShipID")
        self.loadouts.pop(sid, None)
        self.ships[sid] = {"id": sid, "symbol": (e.get("ShipType") or "").lower(),
                           "type": ship_name(e.get("ShipType"), e.get("ShipType_Localised"))}
        self.current_ship_id = sid

    def _remove_ship(self, sid):
        self.ships.pop(sid, None)
        self.loadouts.pop(sid, None)

    def on_ShipyardSell(self, e):
        self._remove_ship(e.get("SellShipID"))

    def on_SellShipOnRebuy(self, e):
        self._remove_ship(e.get("SellShipId") or e.get("SellShipID"))

    def on_ShipyardTransfer(self, e):
        sid = e.get("ShipID")
        entry = self.ships.setdefault(sid, {"id": sid, "symbol": (e.get("ShipType") or "").lower(),
                                            "type": ship_name(e.get("ShipType"), e.get("ShipType_Localised"))})
        arrival = parse_ts(e.get("timestamp")) + (e.get("TransferTime") or 0)
        entry.update(system=self.location.get("system"), station=self.location.get("station"),
                     in_transit=True, arrival=arrival)

    # --- mining e commercio --------------------------------------------------
    def _mining_start(self, e):
        if not self.mining["start"]:
            self.mining["start"] = e.get("timestamp")

    def on_ProspectedAsteroid(self, e):
        self._mining_start(e)
        mats = sorted(({"name": m.get("Name_Localised") or m.get("Name", "").title(), "pct": m.get("Proportion", 0)}
                       for m in e.get("Materials", [])), key=lambda m: -m["pct"])
        content = (e.get("Content_Localised") or e.get("Content") or "").replace("Material Content:", "").strip()
        motherlode = e.get("MotherlodeMaterial_Localised") or e.get("MotherlodeMaterial")
        self.mining["prospected"].insert(0, {"ts": e.get("timestamp"), "materials": mats, "content": content,
                                             "motherlode": motherlode, "remaining": e.get("Remaining")})
        del self.mining["prospected"][15:]
        if motherlode:
            self.note(e["timestamp"], f"Motherlode: {motherlode}!", "gold")

    def on_MiningRefined(self, e):
        self._mining_start(e)
        name = e.get("Type_Localised") or e.get("Type", "").strip("$;").replace("_name", "").title()
        self.mining["refined"][name] = self.mining["refined"].get(name, 0) + 1

    def on_LaunchDrone(self, e):
        t = e.get("Type", "?")
        self.mining["limpets"][t] = self.mining["limpets"].get(t, 0) + 1

    def on_AsteroidCracked(self, e):
        self._mining_start(e)
        self.mining["cracked"] += 1

    def on_MarketBuy(self, e):
        self.trades.insert(0, {"ts": e.get("timestamp"), "kind": "buy",
                               "commodity": e.get("Type_Localised") or e.get("Type"),
                               "count": e.get("Count"), "price": e.get("BuyPrice"), "total": -(e.get("TotalCost") or 0)})
        del self.trades[40:]

    def on_MarketSell(self, e):
        profit = (e.get("TotalSale") or 0) - (e.get("AvgPricePaid") or 0) * (e.get("Count") or 0)
        self.trades.insert(0, {"ts": e.get("timestamp"), "kind": "sell",
                               "commodity": e.get("Type_Localised") or e.get("Type"),
                               "count": e.get("Count"), "price": e.get("SellPrice"), "total": e.get("TotalSale"),
                               "profit": profit, "stolen": e.get("StolenGoods", False)})
        del self.trades[40:]

    def on_Rank(self, e):
        self.ranks.update({k: e.get(k) for k in RANKS})

    def on_Promotion(self, e):
        for k in RANKS:
            if k in e:
                self.ranks[k] = e[k]
                self.progress[k] = 0
                self.note(e["timestamp"], pick(f"Promozione: {rank_label(k)} {RANKS_EN[k][e[k]]}",
                                               f"Promotion: {rank_label(k)} {RANKS_EN[k][e[k]]}"), "gold")

    def on_Progress(self, e):
        self.progress.update({k: e.get(k) for k in RANKS})

    def on_Reputation(self, e):
        self.reputation = {k: e.get(k) for k in ("Empire", "Federation", "Alliance", "Independent")}

    def on_Statistics(self, e):
        self.statistics = {k: v for k, v in e.items() if isinstance(v, dict)}

    # --- materiali -----------------------------------------------------------
    def _mat(self, name, delta, category=None, localised=None):
        key = (name or "").lower()
        m = self.materials.setdefault(key, {"name": key, "category": category, "count": 0})
        if category:
            m["category"] = category
        if localised:
            m["label"] = localised
        m["count"] = max(0, m["count"] + delta)

    def on_Materials(self, e):
        self.materials = {}
        for cat in ("Raw", "Manufactured", "Encoded"):
            for m in e.get(cat, []):
                self._mat(m["Name"], m.get("Count", 0), cat, m.get("Name_Localised"))

    def on_MaterialCollected(self, e):
        self._mat(e.get("Name"), e.get("Count", 1), e.get("Category"), e.get("Name_Localised"))

    def on_MaterialDiscarded(self, e):
        self._mat(e.get("Name"), -e.get("Count", 1), e.get("Category"))

    def on_MaterialTrade(self, e):
        p, r = e.get("Paid", {}), e.get("Received", {})
        self._mat(p.get("Material"), -p.get("Quantity", 0), p.get("Category"), p.get("Material_Localised"))
        self._mat(r.get("Material"), r.get("Quantity", 0), r.get("Category"), r.get("Material_Localised"))

    def on_EngineerCraft(self, e):
        for i in e.get("Ingredients", []):
            if i.get("Name", "").lower() in self.materials:
                self._mat(i["Name"], -i.get("Count", 0))

    def on_Synthesis(self, e):
        for i in e.get("Materials", []):
            self._mat(i.get("Name"), -i.get("Count", 0))

    def on_TechnologyBroker(self, e):
        for i in e.get("Materials", []):
            self._mat(i.get("Name"), -i.get("Count", 0), i.get("Category"))

    # --- ingegneri -----------------------------------------------------------
    def on_EngineerProgress(self, e):
        items = e.get("Engineers") or [e]
        for i in items:
            name = ENGINEER_ALIASES.get(i.get("Engineer"), i.get("Engineer"))
            if not name:
                continue
            cur = self.engineers.setdefault(name, {})
            cur.update({k.lower(): i[k] for k in ("Progress", "Rank", "RankProgress") if k in i})
            if e.get("Engineers") is None and i.get("Progress") == "Unlocked":
                self.note(e["timestamp"], pick(f"Ingegnere sbloccato: {name}", f"Engineer unlocked: {name}"), "gold")

    # --- tute e armi (Odyssey) -----------------------------------------------
    @staticmethod
    def _suit_base(name):
        """"ExplorationSuit_Class2" -> ("explorationsuit", 2); "FlightSuit" -> ("flightsuit", 1)."""
        n = (name or "").lower()
        base, _, cls = n.partition("_class")
        return base, int(cls) if cls.isdigit() else 1

    def _set_suit(self, sid, name, mods=None, cls=None):
        if sid is None or not name:
            return
        base, ncls = self._suit_base(name)
        cur = self.suits.setdefault(sid, {"name": base, "class": 1, "mods": []})
        cur["name"] = base
        cur["class"] = max(cur["class"], ncls, cls or 0)
        if mods is not None:
            cur["mods"] = [m.lower() for m in mods]

    def _set_weapon(self, wid, name, cls=None, mods=None):
        if wid is None or not name:
            return
        cur = self.weapons.setdefault(wid, {"name": name.lower(), "class": 1, "mods": []})
        cur["name"] = name.lower()
        if cls:
            cur["class"] = max(cur["class"], cls)
        if mods is not None:
            cur["mods"] = [m.lower() for m in mods]

    def on_BuySuit(self, e):
        self._set_suit(e.get("SuitID"), e.get("Name"), e.get("SuitMods") or [])

    def on_SellSuit(self, e):
        self.suits.pop(e.get("SuitID"), None)

    def on_UpgradeSuit(self, e):
        self._set_suit(e.get("SuitID"), e.get("Name"), cls=e.get("Class"))
        if e.get("Cost") and e.get("Class"):
            self.onfoot_costs[f"{self._suit_base(e.get('Name'))[0]}:{e['Class']}"] = e["Cost"]

    def on_BuyWeapon(self, e):
        self._set_weapon(e.get("SuitModuleID"), e.get("Name"), e.get("Class"), e.get("WeaponMods") or [])

    def on_SellWeapon(self, e):
        self.weapons.pop(e.get("SuitModuleID"), None)

    def on_UpgradeWeapon(self, e):
        self._set_weapon(e.get("SuitModuleID"), e.get("Name"), e.get("Class"))
        if e.get("Cost") and e.get("Class"):
            self.onfoot_costs[f"{(e.get('Name') or '').lower()}:{e['Class']}"] = e["Cost"]

    def on_SuitLoadout(self, e):
        self._set_suit(e.get("SuitID"), e.get("SuitName"), e.get("SuitMods") or [])
        for m in e.get("Modules") or []:
            self._set_weapon(m.get("SuitModuleID"), m.get("ModuleName"), m.get("Class"), m.get("WeaponMods") or [])
        self.suit_loadout = {"suit": e.get("SuitID"), "name": e.get("LoadoutName"),
                             "weapons": [m.get("SuitModuleID") for m in e.get("Modules") or []]}

    on_SwitchSuitLoadout = on_SuitLoadout

    def on_CreateSuitLoadout(self, e):
        self._set_suit(e.get("SuitID"), e.get("SuitName"), e.get("SuitMods") or [])
        for m in e.get("Modules") or []:
            self._set_weapon(m.get("SuitModuleID"), m.get("ModuleName"), m.get("Class"), m.get("WeaponMods") or [])

    # --- missioni ------------------------------------------------------------
    def on_MissionAccepted(self, e):
        self.missions[e["MissionID"]] = {
            "id": e["MissionID"], "name": e.get("LocalisedName") or e.get("Name"),
            "faction": e.get("Faction"), "system": e.get("DestinationSystem"),
            "station": station_name(e.get("DestinationStation"), e.get("DestinationStation_Localised")), "expiry": e.get("Expiry"),
            "reward": e.get("Reward"), "wing": e.get("Wing", False),
            "commodity": e.get("Commodity_Localised"), "count": e.get("Count") or e.get("KillCount"),
            "target": e.get("TargetFaction") or e.get("Target_Localised") or e.get("Target"),
            "passengers": e.get("PassengerCount"), "accepted": e.get("timestamp"),
            "kind": e.get("Name"), "commodity_id": e.get("Commodity")}
        if "massacre" in (e.get("Name") or "").lower():
            # Uccisioni stimate dai Bounty (vedi _massacre_kill): il gioco non scrive il progresso nel journal.
            self.missions[e["MissionID"]].update(
                kills=0, target_system=e.get("DestinationSystem"),
                target_type=e.get("TargetType_Localised") or e.get("TargetType"))

    def _massacre_kill(self, victim):
        """Una uccisione della fazione bersaglio vale per UNA missione per ogni fazione che l'ha data.
        Fonti e limiti in app/combat.py. L'ordine di accettazione tra missioni dello stesso committente è
        un'ipotesi: cambia solo come si divide il progresso fra quelle missioni, non il totale."""
        here = self.location.get("system")
        oldest = {}
        for m in self.missions.values():
            if ("kills" not in m or m.get("redirected") or m["target"] != victim
                    or m["kills"] >= (m.get("count") or 0)
                    or (here and m.get("target_system") and m["target_system"] != here)):
                continue
            cur = oldest.get(m.get("faction"))
            if cur is None or (m.get("accepted") or "") < (cur.get("accepted") or ""):
                oldest[m.get("faction")] = m
        for m in oldest.values():
            m["kills"] += 1

    def on_Bounty(self, e):
        if e.get("VictimFaction"):
            self._massacre_kill(e["VictimFaction"])

    def on_Missions(self, e):
        active = {m["MissionID"]: m for m in e.get("Active", [])}
        for mid in list(self.missions):
            if mid not in active:
                del self.missions[mid]
        for mid, m in active.items():
            self.missions.setdefault(mid, {"id": mid, "name": m.get("Name"), "expires_in": m.get("Expires")})

    def on_MissionRedirected(self, e):
        m = self.missions.get(e.get("MissionID"))
        if m:
            m.update(system=e.get("NewDestinationSystem"), station=station_name(e.get("NewDestinationStation")),
                     redirected=True)
            if "kills" in m:
                m["kills"] = m.get("count") or m["kills"]   # massacro: obiettivo raggiunto, conta certa

    def _end_mission(self, e):
        self.missions.pop(e.get("MissionID"), None)

    on_MissionFailed = on_MissionAbandoned = _end_mission

    def on_MissionCompleted(self, e):
        self._end_mission(e)
        for m in e.get("MaterialsReward", []):
            self._mat(m.get("Name"), m.get("Count", 0), m.get("Category"), m.get("Name_Localised"))

    # --- posizione -----------------------------------------------------------
    def on_Location(self, e):
        self._enter_system(e)
        self.location.update(docked=e.get("Docked", False), station=station_name(e.get("StationName"), e.get("StationName_Localised")))

    def on_JetConeDamage(self, e):
        self.fsd_health = max(0, self.fsd_health - 1)

    def on_Repair(self, e):
        if "frameshiftdrive" in (e.get("Item") or "").lower():
            self.fsd_health = 100

    def on_RepairAll(self, e):
        self.fsd_health = 100

    def on_AfmuRepairs(self, e):
        if "frameshiftdrive" in (e.get("Item") or "").lower() or "frameshiftdrive" in (e.get("Module") or "").lower():
            self.fsd_health = round((e.get("Health") or 1.0) * 100)

    def on_StartJump(self, e):
        # Scritto all'inizio del conto alla rovescia; StarClass è la stella di arrivo (solo per Hyperspace).
        if e.get("JumpType") == "Hyperspace":
            self.jump = {"id": e.get("timestamp"), "ts": e.get("timestamp"), "system": e.get("StarSystem"),
                         "star_class": e.get("StarClass"), "done": None}

    def on_FSDJump(self, e):
        if self.jump and not self.jump.get("done"):
            self.jump["done"] = e.get("timestamp")
        self._enter_system(e)
        self.location.update(docked=False, station=None)
        self.session["jumps"] += 1
        self.session["ly"] += e.get("JumpDist", 0)

    def on_CarrierStats(self, e):
        self.carrier.update(
            carrier_id=e.get("CarrierID"),
            callsign=e.get("Callsign"),
            name=e.get("Name"),
            fuel=e.get("FuelLevel"),
            jump_range_curr=e.get("JumpRangeCurr"),
            jump_range_max=e.get("JumpRangeMax"),
            pending_decommission=e.get("PendingDecommission"),
            space_usage=e.get("SpaceUsage"),
            finance=e.get("Finance"),
            crew=e.get("Crew"),
            docking_access=e.get("DockingAccess"),
        )

    def on_CarrierJumpRequest(self, e):
        self.carrier["destination_system"] = e.get("SystemName")
        self.carrier["destination_body"] = e.get("Body")
        self.carrier["departure_time"] = e.get("DepartureTime")

    def on_CarrierJump(self, e):
        self._enter_system(e)
        self.carrier["system"] = e.get("StarSystem")
        self.carrier["body"] = e.get("Body")
        self.carrier["destination_system"] = None
        self.carrier["departure_time"] = None

    def on_CarrierDepositFuel(self, e):
        self.carrier["fuel"] = e.get("Total")

    def on_CarrierFinance(self, e):
        if "finance" not in self.carrier:
            self.carrier["finance"] = {}
        self.carrier["finance"].update(
            balance=e.get("CarrierBalance"),
            reserve=e.get("ReserveBalance"),
            available=e.get("AvailableBalance"),
            tax_rate=e.get("TaxRate"),
        )

    def _enter_system(self, e):
        name, addr = e.get("StarSystem"), e.get("SystemAddress")
        if addr != self.system["address"]:
            if self.system["address"] and (self.system["bodies"] or self.system["body_count"]):
                self.systems_seen.pop(self.system["address"], None)
                self.systems_seen[self.system["address"]] = self.system
                while len(self.systems_seen) > 300:
                    self.systems_seen.pop(next(iter(self.systems_seen)))
            self.system = self.systems_seen.pop(addr, None) or self._new_system(name, addr)
        self.location.update(system=name, star_pos=e.get("StarPos"), body=e.get("Body"),
                             population=e.get("Population"),
                             allegiance=e.get("SystemAllegiance"),
                             economy=e.get("SystemEconomy_Localised"),
                             government=e.get("SystemGovernment_Localised"),
                             security=e.get("SystemSecurity_Localised"),
                             power=e.get("ControllingPower"))

    def on_Docked(self, e):
        self.location.update(docked=True, station=station_name(e.get("StationName"), e.get("StationName_Localised")))

    def on_Undocked(self, e):
        self.location.update(docked=False, station=None)

    def on_ApproachBody(self, e):
        self.location["body"] = e.get("Body")

    # --- esplorazione --------------------------------------------------------
    def on_FSSDiscoveryScan(self, e):
        if e.get("SystemAddress") == self.system["address"]:
            self.system["body_count"] = e.get("BodyCount")
            self.system["non_bodies"] = e.get("NonBodyCount")

    def on_FSSAllBodiesFound(self, e):
        if e.get("SystemAddress") == self.system["address"]:
            self.system["all_found"] = True
            self.system["body_count"] = e.get("Count", self.system["body_count"])

    def _body(self, e):
        if e.get("SystemAddress") != self.system["address"]:
            return None
        return self.system["bodies"].setdefault(e.get("BodyID"), {
            "id": e.get("BodyID"), "name": e.get("BodyName"), "kind": "unknown", "bio": 0, "geo": 0,
            "genuses": [], "mapped_by_me": False, "efficient": False})

    def on_Scan(self, e):
        if e.get("StarType"):
            kind, cls, mass = "star", e["StarType"], e.get("StellarMass", 0)
        elif e.get("PlanetClass"):
            kind, cls, mass = "planet", e["PlanetClass"], e.get("MassEM", 0)
        else:
            return
        system = e.get("StarSystem") or self.system["name"]
        b = self._body(e)
        if b is None:
            b = {"id": e.get("BodyID"), "bio": 0, "geo": 0, "genuses": [], "mapped_by_me": False,
                 "efficient": False}
        b.update(name=e.get("BodyName"), kind=kind, cls=cls, mass=mass,
                 terraformable=e.get("TerraformState") == "Terraformable",
                 landable=e.get("Landable", False), dist=e.get("DistanceFromArrivalLS", 0),
                 was_discovered=e.get("WasDiscovered", True), was_mapped=e.get("WasMapped", False),
                 was_footfalled=e.get("WasFootfalled", True), atmosphere=e.get("Atmosphere"),
                 gravity=(e.get("SurfaceGravity") or 0) / 9.80665, temp=e.get("SurfaceTemperature"))
        b["class"] = cls
        b["value"] = body_value(b, b["mapped_by_me"], b["efficient"])
        b["value_mapped"] = body_value(b, True, True) if kind == "planet" else None
        self.carto_unsold.setdefault(system, {})[b["id"]] = b["value"]

        if kind == "planet" and (b["value_mapped"] >= 1_000_000
                                 or cls in ("Earthlike body", "Water world", "Ammonia world")):
            short, value = self._short(b['name']), f"{b['value_mapped']:,}".replace(",", ".")
            if is_en():
                label = {"Earthlike body": "Earth-like world", "Water world": "Water world", "Ammonia world": "Ammonia world",
                         "High metal content body": "High metal content body", "Metal rich body": "Metal-rich body"}.get(cls, cls)
                tag = " (undiscovered!)" if not b["was_discovered"] else ""
                text = f"{short}: {'terraformable ' if b['terraformable'] else ''}{label} ~{value} Cr if mapped{tag}"
            else:
                tag = " (non scoperto!)" if not b["was_discovered"] else ""
                label = {"Earthlike body": "mondo terrestre", "Water world": "mondo d'acqua", "Ammonia world": "mondo d'ammoniaca",
                         "High metal content body": "alto contenuto metallico", "Metal rich body": "ricco di metalli"}.get(cls, cls)
                text = f"{short}: {label}{' terraformabile' if b['terraformable'] else ''} ~{value} Cr se mappato{tag}"
            self.note(e["timestamp"], text, "gold")

    def on_FSSBodySignals(self, e):
        self._signals(e)

    def on_SAASignalsFound(self, e):
        b = self._signals(e)
        if b is not None and e.get("Genuses"):
            b["genuses"] = [g.get("Genus_Localised") or g.get("Genus") for g in e["Genuses"]]

    def _signals(self, e):
        b = self._body(e)
        if b is None:
            return None
        b["name"] = b.get("name") or e.get("BodyName")
        for s in e.get("Signals", []):
            t = s.get("Type", "")
            if "Biological" in t:
                if s.get("Count", 0) and not b["bio"]:
                    self.note(e["timestamp"], pick(f"{self._short(b['name'])}: {s['Count']} segnali biologici",
                                                   f"{self._short(b['name'])}: {s['Count']} biological signal"
                                                   + ("" if s['Count'] == 1 else "s")), "bio")
                b["bio"] = s.get("Count", 0)
            elif "Geological" in t:
                b["geo"] = s.get("Count", 0)
        return b

    def on_SAAScanComplete(self, e):
        b = self._body(e)
        if b is None or b.get("kind") == "unknown":
            return
        b["mapped_by_me"] = True
        b["efficient"] = e.get("ProbesUsed", 99) <= e.get("EfficiencyTarget", 0)
        b["value"] = body_value(b, True, b["efficient"])
        self.carto_unsold.setdefault(self.system["name"], {})[b["id"]] = b["value"]

    def on_ScanOrganic(self, e):
        species = e.get("Species_Localised") or e.get("Species")
        genus = e.get("Genus_Localised") or e.get("Genus")
        st = e.get("ScanType")
        cur = self.bio_current
        if st == "Log" or cur is None or cur["species"] != species:
            cur = self.bio_current = {
                "species": species, "genus": genus, "variant": e.get("Variant_Localised"),
                "step": 0, "samples": [], "min_dist": GENUS_DISTANCE.get(genus, 100),
                "value": self.species_value(species), "body_id": e.get("Body"),
                "system": e.get("SystemAddress")}
        cur["step"] = {"Log": 1, "Sample": 2, "Analyse": 3}.get(st, cur["step"])
        if self.live and st in ("Log", "Sample"):
            status = read_json(os.path.join(self.journal_dir, "Status.json")) or {}
            if "Latitude" in status:
                cur["samples"].append({"lat": status["Latitude"], "lon": status["Longitude"]})
        if st == "Analyse":
            self.bio_unsold.append({"species": species, "variant": e.get("Variant_Localised"),
                                    "value": self.species_value(species), "ts": e.get("timestamp")})
            self.note(e["timestamp"], pick(f"Analisi completata: {species} ({self.species_value(species):,} Cr)",
                                           f"Analysis complete: {species} ({self.species_value(species):,} Cr)").replace(",", "."), "bio")
            self.bio_current = None

    def on_SellOrganicData(self, e):
        for item in e.get("BioData", []):
            sp = item.get("Species_Localised") or item.get("Species")
            if item.get("Value"):
                self.learned_values[sp] = item["Value"]
            for i, u in enumerate(self.bio_unsold):
                if u["species"] == sp:
                    del self.bio_unsold[i]
                    break

    def on_SellExplorationData(self, e):
        for s in e.get("Systems", []):
            self.carto_unsold.pop(s, None)

    def on_MultiSellExplorationData(self, e):
        for s in e.get("Discovered", []):
            self.carto_unsold.pop(s.get("SystemName"), None)

    def on_Died(self, e):
        self.bio_unsold.clear()
        self.carto_unsold.clear()
        self.bio_current = None
        self.note(e["timestamp"], pick("Morto: dati non venduti persi", "Ship destroyed: unsold data lost"), "bad")

    def _short(self, name):
        sysname = self.system.get("name") or ""
        if name and sysname and name.startswith(sysname) and name != sysname:
            return name[len(sysname):].strip()
        return name

    def _genus_range(self, genus):
        vals = [self.species_value(s) for s in set(SPECIES_VALUES) | set(self.learned_values)
                if s.split(" ")[0] == genus.split(" ")[0]]
        return {"min": min(vals), "max": max(vals)} if vals else {"min": None, "max": None}

    # --- snapshot per la UI --------------------------------------------------
    def snapshot(self):
        status = read_json(os.path.join(self.journal_dir, "Status.json")) or {}
        route = read_json(os.path.join(self.journal_dir, "NavRoute.json")) or {}
        cargo = read_json(os.path.join(self.journal_dir, "Cargo.json")) or {}
        locker = read_json(os.path.join(self.journal_dir, "ShipLocker.json")) or {}
        with self.lock:
            bodies = []
            for b in self.system["bodies"].values():
                if b.get("kind") == "unknown" and not b["bio"]:
                    continue
                d = dict(b)
                d["short"] = self._short(b.get("name"))
                d["genus_info"] = [{"genus": g, "min_dist": GENUS_DISTANCE.get(g, 100),
                                    **self._genus_range(g)} for g in b["genuses"]]
                bodies.append(d)
            bodies.sort(key=lambda x: -(x.get("value_mapped") or x.get("value") or 0))
            scanned = sum(1 for b in self.system["bodies"].values() if b.get("kind") != "unknown")

            bio = None
            if self.bio_current:
                bio = dict(self.bio_current)
                bio["distances"] = []
                if "Latitude" in status and status.get("PlanetRadius"):
                    for s in bio["samples"]:
                        bio["distances"].append(round(haversine(
                            s["lat"], s["lon"], status["Latitude"], status["Longitude"],
                            status["PlanetRadius"])))
                bio["far_enough"] = (all(d >= bio["min_dist"] for d in bio["distances"])
                                     if bio["distances"] else None)

            cur_sys = self.location.get("system")
            jumps = route.get("Route", [])
            names = [r.get("StarSystem") for r in jumps]
            if cur_sys in names:
                jumps = jumps[names.index(cur_sys) + 1:]
            for r in jumps:
                sc = r.get("StarClass") or ""
                r["scoopable"] = sc[:1] in SCOOPABLE and len(sc) <= 2

            materials = []
            for m in self.materials.values():
                if not m["category"] or (m["count"] == 0 and m["name"] not in MATERIAL_GRADE):
                    continue
                g = MATERIAL_GRADE.get(m["name"])
                materials.append({**m, "grade": g, "cap": GRADE_CAP.get(g),
                                  "label": m.get("label") or m["name"].capitalize()})

            fuel = (status.get("Fuel") or {}).get("FuelMain")
            now = time.time()
            fleet = []
            for sid, sh in self.ships.items():
                d = dict(sh)
                d["current"] = sid == self.current_ship_id
                if d["current"]:
                    d.update(system=self.location.get("system"), in_transit=False,
                             station=self.location.get("station") if self.location.get("docked") else None)
                if d.get("arrival"):
                    d["in_transit"] = now < d["arrival"]
                    d["arrival_in"] = max(0, round(d["arrival"] - now))
                build = self.loadouts.get(sid)
                d["build"] = build if build and build["symbol"] == d.get("symbol") else None
                fleet.append(d)
            fleet.sort(key=lambda x: (not x["current"], -(x.get("value") or 0)))

            m = self.mining
            tons = sum(m["refined"].values())
            hours = (now - parse_ts(m["start"])) / 3600 if m["start"] else 0
            mining = {**m, "tons": tons, "tph": round(tons / hours, 1) if hours > 0.05 else None}
            return {
                "live": self.live,
                "cmdr": self.cmdr,
                "ship": self.ship,
                "fleet": fleet,
                "fleet_updated": self.fleet_updated,
                "mining": mining,
                "trades": self.trades,
                "trade_profit": sum(t.get("profit") or 0 for t in self.trades if t["kind"] == "sell"),
                "locker": {k: [{"name": i.get("Name_Localised") or i.get("Name"), "count": i.get("Count"),
                                "id": (i.get("Name") or "").lower()}
                               for i in locker.get(k, [])] for k in ("Items", "Components", "Consumables", "Data")},
                "onfoot": {"suits": [{"id": k, **v} for k, v in self.suits.items()],
                           "weapons": [{"id": k, **v} for k, v in self.weapons.items()],
                           "loadout": self.suit_loadout, "costs": self.onfoot_costs},
                "ranks": self.ranks,
                "progress": self.progress,
                "reputation": self.reputation,
                "statistics": self.statistics,
                "carrier": self.carrier,
                "location": {**self.location, "status_body": status.get("BodyName")},
                "fuel": {"level": fuel, "cap": self.cmdr.get("fuel_cap")},
                "cargo": [{"name": i.get("Name_Localised") or i.get("Name"), "count": i.get("Count")}
                          for i in cargo.get("Inventory", [])],
                "system": {"name": self.system["name"], "body_count": self.system["body_count"],
                           "all_found": self.system["all_found"], "scanned": scanned,
                           "non_bodies": self.system["non_bodies"], "bodies": bodies},
                "route": jumps,
                "bio_current": bio,
                "fsd_health": self.fsd_health,
                "jump": dict(self.jump) if self.jump else None,
                "bio_unsold": self.bio_unsold,
                "bio_unsold_total": sum(u["value"] for u in self.bio_unsold),
                "carto_unsold_total": sum(sum(v.values()) for v in self.carto_unsold.values()),
                "carto_unsold_systems": len(self.carto_unsold),
                "materials": materials,
                "engineers": self.engineers,
                "missions": sorted(self.missions.values(), key=lambda m: m.get("expiry") or ""),
                "session": self.session,
                "feed": self.feed,
            }
