"""Odyssey a terra: missioni on-foot, settlement visitati, oggetti raccolti, Bartender e combattimento a piedi.

Tutto viene dagli eventi del journal (letti, mai modificati). Fonti dei formati degli eventi:
  - Documentazione del journal (trascrizione del Journal Manual Frontier), pagina "New in Odyssey":
    https://elite-journal.readthedocs.io/en/latest/New%20in%20Odyssey.html
    Backpack/BackpackChange (Added o Removed: Name, OwnerID, MissionID se c'è, Count, Type), CollectItems,
    Disembark/Embark (SRV, Taxi, Multicrew, StarSystem, SystemAddress, Body, BodyID, OnStation, OnPlanet,
    StationName, MarketID), SellMicroResources (MicroResources[Name, Category, Count], Price, MarketID),
    BuyMicroResources (nuovo formato: TotalCount, Price, MarketID, MicroResources[]),
    TradeMicroResources (Offered[Name, Category, Count], Received, Category, Count, MarketID), BookDropship.
  - EDMarketConnector monitor.py (https://github.com/EDCD/EDMarketConnector/blob/main/monitor.py, nov 2026):
    BackpackChange = cambi dello zaino "diversi da un trasferimento"; CollectItems/DropItems/UseConsumable sono
    accompagnati da un BackpackChange, quindi qui si contano SOLO i BackpackChange (niente doppioni).
    A piedi dopo Disembark/DropshipDeploy, non più a piedi dopo Embark; LoadGame con Ship = una tuta
    (FlightSuit/UtilitySuit/TacticalSuit/ExplorationSuit) = partita iniziata a piedi.
    Status.json Flags2 bit 0 = OnFoot (edmc_data.py, Flags2OnFoot = 1 << 0).
  - EDDI (https://github.com/EDCD/EDDI, nov 2026): DataDefinitions/MissionType.cs e Mission.cs — il nome
    interno della missione si divide con "_" e il tag "OnFoot" indica una missione a piedi; i tag secondari
    (Collect, Hack, Heist, Sabotage, Reboot, RebootRestore, Assassination, Onslaught, Salvage, Covert, NCD =
    non violenta, Download/Upload = hacking, POI, ProductionHeist) sono quelli commentati in MissionType.cs.
    Events/MissionAcceptedEvent.cs legge il campo DestinationSettlement. Events/SettlementApproachedEvent.cs:
    ApproachSettlement ha Name/Name_Localised, MarketID (assente per strutture Guardian e beacon), SystemAddress,
    BodyName, BodyID, Latitude/Longitude, StationFaction, StationGovernment, StationEconomy (verificato anche sul
    journal reale: StationEconomy_Localised, StationGovernment_Localised, StationAllegiance).

Limite dichiarato: il journal non dice DOVE hai raccolto un oggetto. Lo attribuisco all'ultimo settlement
avvicinato (ApproachSettlement) sullo stesso corpo celeste (SystemAddress + BodyID dell'ultimo Disembark);
lasciando il corpo (LeaveBody, salto) l'associazione si azzera.
"""

import json
import threading
import time

from . import journal
from .lang import pick_d

GET = {}
POST = {}
LAN = set()

_lock = threading.Lock()
SUITS = ("flightsuit", "utilitysuit", "tacticalsuit", "explorationsuit")
CATS = {"Item": "Items", "Component": "Components", "Data": "Data", "Consumable": "Consumables"}
WANTED = ('"LoadGame"', '"Location"', '"FSDJump"', '"CarrierJump"', '"LeaveBody"', '"ApproachSettlement"',
          '"Disembark"', '"Embark"', '"DropshipDeploy"', '"BackpackChange"', '"SellMicroResources"',
          '"BuyMicroResources"', '"TradeMicroResources"', '"Bounty"', '"FactionKillBond"', '"Died"',
          '"Resurrect"', '"MissionAccepted"', '"MissionCompleted"', '"MissionFailed"', '"MissionAbandoned"',
          '"BookDropship"')
MAX_SETTLEMENTS = 300
MAX_LOG = 40


def _new_counts():
    return {"collected": {}, "mission_items": 0, "sold_cr": 0, "sold_n": 0, "bought_cr": 0, "bought_n": 0,
            "trades": 0, "kills": 0, "bounty_cr": 0, "bonds_cr": 0, "deaths": 0, "foot_s": 0,
            "disembarks": 0, "settlements": [], "missions_done": 0, "missions_cr": 0}


def _reset():
    return {"system": None, "address": None, "on_foot": False, "foot_since": None, "body": None,
            "here": None, "settlements": {}, "missions": {}, "session": _new_counts(), "total": _new_counts(),
            "session_start": None, "log": [], "last_ts": "", "last_lines": set()}


D = _reset()


def _ts_seconds(ts):
    from datetime import datetime, timezone
    try:
        return datetime.strptime(ts, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp()
    except (TypeError, ValueError):
        return None


def _loc(v, k):
    return v.get(k + "_Localised") or v.get(k)


def _add_item(bucket, name, label, cat, n):
    c = bucket.setdefault(cat, {})
    it = c.setdefault(name, {"name": label, "count": 0})
    it["count"] += n


def _both(fn):
    fn(D["session"])
    fn(D["total"])


def _log(e, it, en):
    # Entrambe le lingue: la scelta si fa quando l'API risponde (la lingua può cambiare mentre l'app gira).
    D["log"].insert(0, {"ts": e.get("timestamp"), "text": {"it": it, "en": en}})
    del D["log"][MAX_LOG:]


def _foot_end(ts):
    if D["on_foot"] and D["foot_since"]:
        a, b = _ts_seconds(D["foot_since"]), _ts_seconds(ts)
        if a and b and 0 < b - a < 12 * 3600:   # oltre 12 h è quasi certamente una chiusura del gioco non registrata
            _both(lambda c: c.__setitem__("foot_s", c["foot_s"] + int(b - a)))
    D["on_foot"], D["foot_since"] = False, None


def handle(e):
    ev = e.get("event")
    ts = e.get("timestamp") or ""
    if ev == "LoadGame":
        _foot_end(ts)
        D["session"] = _new_counts()
        D["session_start"] = ts
        D["here"] = None
        if (e.get("Ship") or "").lower().startswith(SUITS):
            D["on_foot"], D["foot_since"] = True, ts
    elif ev in ("Location", "FSDJump", "CarrierJump"):
        if e.get("StarSystem"):
            if e.get("SystemAddress") != D["address"]:
                D["here"] = None
            D["system"], D["address"] = e.get("StarSystem"), e.get("SystemAddress")
        if ev == "Location":
            D["body"] = (e.get("SystemAddress"), e.get("BodyID"))
    elif ev == "LeaveBody":
        D["here"] = None
    elif ev == "ApproachSettlement":
        name = _loc(e, "Name") or "?"
        key = f"{e.get('SystemAddress')}:{e.get('MarketID') or name}"
        s = D["settlements"].get(key)
        if s is None:
            s = D["settlements"][key] = {
                "key": key, "name": name, "system": D["system"] if e.get("SystemAddress") == D["address"] else None,
                "address": e.get("SystemAddress"), "body": e.get("BodyName"), "body_id": e.get("BodyID"),
                "market_id": e.get("MarketID"), "visits": 0, "first": ts, "collected": {}}
            if len(D["settlements"]) > MAX_SETTLEMENTS:
                old = min(D["settlements"].values(), key=lambda x: x.get("last") or "")
                D["settlements"].pop(old["key"], None)
        fac = e.get("StationFaction") or {}
        s.update(economy=_loc(e, "StationEconomy") or s.get("economy"),
                 government=_loc(e, "StationGovernment") or s.get("government"),
                 allegiance=e.get("StationAllegiance") or s.get("allegiance"),
                 faction=fac.get("Name") or s.get("faction"), faction_state=fac.get("FactionState"),
                 bartender="bartender" in (e.get("StationServices") or []) or s.get("bartender", False),
                 last=ts)
        if s["system"] is None and e.get("SystemAddress") == D["address"]:
            s["system"] = D["system"]
        if D["here"] != key:         # nuova visita (non le ripetizioni mentre resti lì)
            s["visits"] += 1
            for c in (D["session"], D["total"]):
                if key not in c["settlements"]:
                    c["settlements"].append(key)
            line = f"Settlement: {name}" + (f" ({s['body']})" if s.get("body") else "")
            _log(e, line, line)
        D["here"] = key
        D["body"] = (e.get("SystemAddress"), e.get("BodyID"))
    elif ev == "Disembark":
        D["on_foot"], D["foot_since"] = True, ts
        D["body"] = (e.get("SystemAddress"), e.get("BodyID"))
        if D["here"]:
            s = D["settlements"].get(D["here"])
            if not s or (s.get("address"), s.get("body_id")) != D["body"]:
                D["here"] = None
        if e.get("StarSystem"):
            D["system"], D["address"] = e.get("StarSystem"), e.get("SystemAddress")
        _both(lambda c: c.__setitem__("disembarks", c["disembarks"] + 1))
    elif ev == "DropshipDeploy":
        D["on_foot"], D["foot_since"] = True, ts
    elif ev == "Embark":
        _foot_end(ts)
    elif ev == "BackpackChange":
        for it in e.get("Added") or []:
            n = it.get("Count") or 0
            if it.get("MissionID"):      # oggetto della missione: non è un materiale tuo
                _both(lambda c: c.__setitem__("mission_items", c["mission_items"] + n))
                continue
            name = (it.get("Name") or "").lower()
            label = it.get("Name_Localised") or it.get("Name") or "?"
            cat = CATS.get(it.get("Type"), it.get("Type") or "Altro")
            _add_item(D["session"]["collected"], name, label, cat, n)
            _add_item(D["total"]["collected"], name, label, cat, n)
            s = D["settlements"].get(D["here"]) if D["here"] else None
            if s:
                _add_item(s["collected"], name, label, cat, n)
    elif ev == "SellMicroResources":
        n = sum(m.get("Count") or 0 for m in e.get("MicroResources") or [])
        p = e.get("Price") or 0
        _both(lambda c: c.update(sold_cr=c["sold_cr"] + p, sold_n=c["sold_n"] + n))
        _log(e, f"Venduti {n} oggetti al Bartender: {p:,} CR".replace(",", "."),
             f"Sold {n} item{'s' if n != 1 else ''} to the Bartender: {p:,} CR".replace(",", "."))
    elif ev == "BuyMicroResources":
        n = e.get("TotalCount") or e.get("Count") or sum(m.get("Count") or 0 for m in e.get("MicroResources") or [])
        p = e.get("Price") or 0
        _both(lambda c: c.update(bought_cr=c["bought_cr"] + p, bought_n=c["bought_n"] + n))
    elif ev == "TradeMicroResources":
        _both(lambda c: c.__setitem__("trades", c["trades"] + 1))
        _log(e, f"Baratto: ricevuti {e.get('Count') or 0}× {_loc(e, 'Received') or '?'}",
             f"Barter: received {e.get('Count') or 0}× {_loc(e, 'Received') or '?'}")
    elif ev in ("Bounty", "FactionKillBond") and D["on_foot"]:
        r = e.get("TotalReward") or e.get("Reward") or 0
        k = "bounty_cr" if ev == "Bounty" else "bonds_cr"
        _both(lambda c: c.update({"kills": c["kills"] + 1, k: c[k] + r}))
    elif ev == "Died":
        if D["on_foot"]:
            _both(lambda c: c.__setitem__("deaths", c["deaths"] + 1))
            _log(e, "Morto a piedi" + (f" (ucciso da {_loc(e, 'KillerName')})" if e.get("KillerName") else ""),
                 "Died on foot" + (f" (killed by {_loc(e, 'KillerName')})" if e.get("KillerName") else ""))
        _foot_end(ts)
    elif ev == "MissionAccepted":
        tags = (e.get("Name") or "").split("_")
        if "OnFoot" in tags:
            D["missions"][e.get("MissionID")] = {
                "id": e.get("MissionID"), "kind": e.get("Name"), "tags": tags,
                "name": e.get("LocalisedName") or e.get("Name"), "faction": e.get("Faction"),
                "system": e.get("DestinationSystem"), "settlement": e.get("DestinationSettlement_Localised") or e.get("DestinationSettlement"),
                "station": e.get("DestinationStation"), "reward": e.get("Reward"), "expiry": e.get("Expiry"),
                "accepted": ts, "accepted_system": D["system"], "wing": e.get("Wing", False)}
    elif ev in ("MissionCompleted", "MissionFailed", "MissionAbandoned"):
        m = D["missions"].pop(e.get("MissionID"), None)
        if m and ev == "MissionCompleted":
            r = e.get("Reward") or 0
            _both(lambda c: c.update(missions_done=c["missions_done"] + 1, missions_cr=c["missions_cr"] + r))
            _log(e, f"Missione a terra completata: {m['name']}", f"On-foot mission completed: {m['name']}")


def _feed(e, live):
    line = json.dumps(e, sort_keys=True)
    ts = e.get("timestamp") or ""
    with _lock:
        if live:
            # Eventi già letti nello storico (stesso secondo dell'ultimo evento letto): si saltano.
            if ts < D["last_ts"] or (ts == D["last_ts"] and line in D["last_lines"]):
                return
        if ts != D["last_ts"]:
            D["last_ts"], D["last_lines"] = ts, set()
        D["last_lines"].add(line)
        try:
            handle(e)
        except (TypeError, ValueError, AttributeError, KeyError) as exc:
            print(f"[A terra] evento {e.get('event')} ignorato: {exc!r}")


_ready = threading.Event()
_pending = []


def _on_event(e):
    if not _ready.is_set():
        with _lock:
            _pending.append(e)
        return
    _feed(e, True)


def read_history(files=None):
    for path in files if files is not None else journal.journal_files():
        try:
            with open(path, encoding="utf-8", errors="replace") as f:
                for line in f:
                    if any(w in line for w in WANTED):
                        try:
                            _feed(json.loads(line), False)
                        except ValueError:
                            pass
        except OSError:
            pass


def start():
    journal.add_listener(_on_event)   # prima l'ascolto (in coda), poi lo storico, poi la coda senza doppioni
    read_history()
    with _lock:
        queued = _pending[:]
        _pending.clear()
    for e in queued:
        _feed(e, True)
    _ready.set()


def _on_foot_now():
    st = journal.read_status()
    if "Flags2" in st:
        return bool(st.get("Flags2", 0) & 1)
    return None


def _counts_out(c):
    out = {k: v for k, v in c.items() if k != "settlements"}
    out["collected"] = {cat: sorted(items.items(), key=lambda kv: -kv[1]["count"]) for cat, items in c["collected"].items()}
    out["collected"] = {cat: [{"id": k, **v} for k, v in lst] for cat, lst in out["collected"].items()}
    out["collected_n"] = sum(i["count"] for items in c["collected"].values() for i in items.values())
    out["settlements_n"] = len(c["settlements"])
    return out


def status(q=None):
    from .journal import STATE
    with STATE.lock:
        active_ids = set(STATE.missions)
    flag = _on_foot_now()
    with _lock:
        sess = _counts_out(D["session"])
        if D["on_foot"] and D["foot_since"]:
            a = _ts_seconds(D["foot_since"])
            if a and 0 < time.time() - a < 12 * 3600:
                sess["foot_s"] += int(time.time() - a)
        settl = []
        for s in D["settlements"].values():
            x = dict(s)
            x["collected"] = [{"id": k, "cat": cat, **v} for cat, items in s["collected"].items() for k, v in items.items()]
            x["collected"].sort(key=lambda i: -i["count"])
            x["collected_n"] = sum(i["count"] for i in x["collected"])
            settl.append(x)
        settl.sort(key=lambda s: s.get("last") or "", reverse=True)
        # Le missioni attive: quelle che lo stato (che legge anche l'evento Missions all'accesso) considera ancora aperte.
        missions = [dict(m) for mid, m in D["missions"].items() if mid in active_ids]
        missions.sort(key=lambda m: m.get("expiry") or "")
        session_keys = set(D["session"]["settlements"])
        return {
            "on_foot": flag if flag is not None else D["on_foot"],
            "here": D["settlements"].get(D["here"], {}).get("name") if D["here"] else None,
            "system": D["system"], "session_start": D["session_start"],
            "session": sess, "total": _counts_out(D["total"]),
            "session_settlements": [s for s in settl if s["key"] in session_keys],
            "settlements": settl, "missions": missions, "log": [{**x, "text": pick_d(x["text"])} for x in D["log"][:15]],
        }


GET["/api/onfoot/status"] = status
