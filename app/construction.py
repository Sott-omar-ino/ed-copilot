"""Cantieri di colonizzazione letti dal journal (depositi di costruzione, contributi, rivendicazioni).

Eventi usati (nomi dei campi verificati sulle definizioni dei tipi del journal 2025 di kayahr/ed-journal,
src/main/events/other/ColonisationConstructionDepot.ts e ColonisationContribution.ts, e di Xjph/ObservatoryCore,
ObservatoryFramework/Files/Journal/Colonisation/*.cs):
- ColonisationConstructionDepot: MarketID, ConstructionProgress (0-1), ConstructionComplete, ConstructionFailed,
  ResourcesRequired: [{Name, Name_Localised, RequiredAmount, ProvidedAmount, Payment}]
  (scritto all'attracco al cantiere e poi ogni ~15 s mentre resti attraccato: è sempre uno stato completo).
- ColonisationContribution: MarketID, Contributions: [{Name, Name_Localised, Amount}]
- ColonisationSystemClaim: StarSystem, SystemAddress
- ColonisationBeaconDeployed: nessun campo utile oltre al momento.
Il sistema e il nome del cantiere non sono nel deposito: si prendono dall'ultimo Docked/Location con lo stesso MarketID.

Lo storico viene letto da tutti i journal all'avvio (solo le righe che servono), poi si segue il journal in diretta.
"""

import json
import re
import threading

from . import journal

GET = {}
POST = {}
LAN = set()

_lock = threading.Lock()
DEPOTS = {}      # MarketID -> dati del cantiere
CLAIMS = []      # rivendicazioni di sistemi
_markets = {}    # MarketID -> {"system", "station", "station_type"}
_here = {"system": None, "market_id": None}

WANTED = ("Colonisation", '"Docked"', '"Location"', '"FSDJump"', '"CarrierJump"')


def _clean_name(raw):
    """'$CMMComposite_name;' -> 'CMMComposite' (solo se manca il nome leggibile)."""
    return re.sub(r"^\$|_name;$", "", raw or "")


def _station_label(name):
    """Il nome del cantiere nel journal è spesso un segnaposto ($EXT_PANEL_ColonisationShip...)."""
    if not name:
        return None
    if name.startswith("$") and "; " in name:
        return name.split("; ")[-1]
    if name.startswith("$EXT_PANEL_ColonisationShip"):
        return "Colonisation Ship"
    return name


def handle(e):
    ev = e.get("event")
    with _lock:
        if ev in ("Docked", "Location"):
            sys_name = e.get("StarSystem")
            if sys_name:
                _here["system"] = sys_name
            mid = e.get("MarketID")
            if mid and (ev == "Docked" or e.get("Docked")):
                _here["market_id"] = mid
                _markets[mid] = {"system": sys_name, "station": _station_label(e.get("StationName")),
                                 "station_type": e.get("StationType")}
                if mid in DEPOTS:
                    DEPOTS[mid].update({k: v for k, v in _markets[mid].items() if v})
        elif ev in ("FSDJump", "CarrierJump"):
            _here["system"] = e.get("StarSystem") or _here["system"]
        elif ev == "ColonisationConstructionDepot":
            mid = e.get("MarketID")
            if mid is None:
                return
            ts = e.get("timestamp") or ""
            cur = DEPOTS.get(mid)
            if cur and cur.get("updated", "") > ts:
                return  # evento più vecchio di quello già noto
            where = _markets.get(mid) or ({"system": _here["system"]} if _here["market_id"] == mid else {})
            res = []
            for r in e.get("ResourcesRequired") or []:
                req, prov = int(r.get("RequiredAmount") or 0), int(r.get("ProvidedAmount") or 0)
                res.append({"name": r.get("Name_Localised") or _clean_name(r.get("Name")), "symbol": _clean_name(r.get("Name")),
                            "required": req, "provided": prov, "remaining": max(0, req - prov), "payment": r.get("Payment")})
            DEPOTS[mid] = {**(cur or {}), "market_id": mid, "system": where.get("system") or (cur or {}).get("system"),
                           "station": where.get("station") or (cur or {}).get("station"),
                           "station_type": where.get("station_type") or (cur or {}).get("station_type"),
                           "progress": float(e.get("ConstructionProgress") or 0),
                           "complete": bool(e.get("ConstructionComplete")), "failed": bool(e.get("ConstructionFailed")),
                           "resources": res, "updated": ts,
                           "contributions": (cur or {}).get("contributions", [])}
        elif ev == "ColonisationContribution":
            mid = e.get("MarketID")
            d = DEPOTS.setdefault(mid, {"market_id": mid, "resources": [], "contributions": [], "progress": 0,
                                        **(_markets.get(mid) or {})})
            entry = {"ts": e.get("timestamp"), "items": [{"name": c.get("Name_Localised") or _clean_name(c.get("Name")),
                                                          "amount": c.get("Amount")} for c in e.get("Contributions") or []]}
            if entry not in d["contributions"]:
                d["contributions"].append(entry)
                del d["contributions"][:-30]
        elif ev == "ColonisationSystemClaim":
            claim = {"system": e.get("StarSystem"), "address": e.get("SystemAddress"), "ts": e.get("timestamp")}
            if claim not in CLAIMS:
                CLAIMS.append(claim)


def depots():
    with _lock:
        out = [{**d, "remaining_total": sum(r["remaining"] for r in d.get("resources", [])),
                "required_total": sum(r["required"] for r in d.get("resources", [])),
                "provided_total": sum(r["provided"] for r in d.get("resources", []))}
               for d in DEPOTS.values() if d.get("resources")]
        out.sort(key=lambda d: d.get("updated") or "", reverse=True)
        return {"depots": out, "claims": list(CLAIMS), "here_market_id": _here["market_id"]}


def read_history(files=None):
    for path in files if files is not None else journal.journal_files():
        try:
            with open(path, encoding="utf-8", errors="replace") as f:
                for line in f:
                    if any(w in line for w in WANTED):
                        try:
                            handle(json.loads(line))
                        except (ValueError, TypeError, AttributeError):
                            pass
        except OSError:
            pass


def start():
    journal.add_listener(handle)  # prima l'ascolto, poi lo storico: i doppioni sono innocui
    read_history()


GET["/api/colonisation/depots"] = lambda q: depots()
