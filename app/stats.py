"""Statistiche nel tempo: sessioni di gioco, giorni e settimane ricostruiti da tutti i journal.

Una sessione va dal LoadGame (o dal primo evento del file) fino allo Shutdown o al LoadGame successivo.
Il tempo attivo è la somma degli intervalli fra eventi consecutivi: le pause più lunghe di 30 minuti
non contano (il gioco lasciato aperto non gonfia le ore). I risultati di ogni file restano in cache
(nome + dimensione + data di modifica): si rilegge solo il journal che sta crescendo.
"""

import calendar
import json
import os
import re
import threading
import time
from datetime import date, timedelta

from . import journal, paths, storage
from .gamedata import MINING_COMMODITIES, SHIP_NAMES
from .state import ship_name

CACHE_FILE = paths.cache_file("stats.json")
VERSION = 3  # da cambiare quando cambia il formato delle sessioni salvate
IDLE = 1800  # secondi: oltre questa pausa il tempo non è considerato attivo
CATS = ("trade", "mining", "missions", "combat", "exploration", "exobiology", "other")
SPEND = ("ships", "modules", "services", "fines", "rebuy", "other")
COUNTERS = ("jumps", "ly", "fuel", "scans", "mapped", "bio", "deaths", "refined")

# Nomi interni delle merci estraibili (MarketSell usa "lowtemperaturediamond", "opal"...).
MINABLE = {c.lower().replace(" ", "") for c in MINING_COMMODITIES} | {"lowtemperaturediamond", "opal"}
VOUCHERS = {"bounty": "combat", "combatbond": "combat", "trade": "trade", "scannable": "exploration",
            "codex": "exploration", "settlement": "combat"}
# Eventi di cui serve il contenuto: gli altri (la maggior parte) servono solo per l'orario.
NEEDED = {"LoadGame", "Shutdown", "Loadout", "ShipyardSwap", "ShipyardBuy", "FSDJump", "MarketSell", "MissionCompleted",
          "RedeemVoucher", "SellExplorationData", "MultiSellExplorationData", "SellOrganicData", "MiningRefined", "Scan",
          "SAAScanComplete", "ScanOrganic", "Died", "Resurrect", "ModuleBuy", "ShipyardTransfer", "FetchRemoteModule",
          "ModuleRetrieve", "Repair", "RepairAll", "RefuelAll", "RefuelPartial", "BuyAmmo", "RestockVehicle", "BuyDrones",
          "PayFines", "PayBounties", "PayLegacyFines", "CommunityGoalReward", "SearchAndRescue", "PowerplaySalary",
          "SellDrones", "SellMicroResources", "BuyExplorationData", "BuyTradeData", "CrewHire", "Statistics"}
SERVICE_COSTS = {"Repair": "Cost", "RepairAll": "Cost", "RefuelAll": "Cost", "RefuelPartial": "Cost", "BuyAmmo": "Cost",
                 "RestockVehicle": "Cost", "BuyDrones": "TotalCost", "ShipyardTransfer": "TransferPrice",
                 "FetchRemoteModule": "TransferCost", "ModuleRetrieve": "Cost"}
OTHER_INCOME = {"CommunityGoalReward": "Reward", "SearchAndRescue": "Reward", "PowerplaySalary": "Amount",
                "SellDrones": "TotalSale", "SellMicroResources": "Price"}
OTHER_COSTS = {"BuyExplorationData": "Cost", "BuyTradeData": "Cost", "CrewHire": "Cost"}
NOT_SHIPS = re.compile(r"suit|taxi|buggy|srv|fighter")
HEAD = re.compile(r'\{\s*"timestamp"\s*:\s*"([^"]+)"\s*,\s*"event"\s*:\s*"([^"]+)"')

LOCK = threading.Lock()
FILES = None  # nome file -> {"sig": [dimensione, mtime], "sessions": [...]}
_DAYS = {}    # quarto d'ora -> data locale (copre anche i fusi orari con la mezz'ora)


def _epoch(ts):
    try:
        return calendar.timegm((int(ts[0:4]), int(ts[5:7]), int(ts[8:10]), int(ts[11:13]), int(ts[14:16]), int(ts[17:19]), 0, 0, 0))
    except (TypeError, ValueError):
        return None


def _day(t):
    k = int(t // 900)
    d = _DAYS.get(k)
    if d is None:
        d = _DAYS[k] = time.strftime("%Y-%m-%d", time.localtime(k * 900))
    return d


def _n(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else 0


def _new_session(t, name):
    return {"file": name, "start": t, "end": t, "active": 0, "loadgame": False, "ended": False, "commander": None,
            "ships": [], "credits_start": None, "wealth": None, "systems": 0, "max_jump": None, "incomes": [],
            **dict.fromkeys(COUNTERS, 0),
            "earn": dict.fromkeys(CATS, 0), "spend": dict.fromkeys(SPEND, 0), "days": {}}


def _busy(s):
    return s["jumps"] or s["active"] > 300 or any(s["earn"].values())


class _Parser:
    """Legge un file journal e ne ricava le sessioni."""

    def __init__(self, name):
        self.name = name
        self.sessions = []
        self.cur = None
        self.bodies = set()
        self.refined = set()
        self.systems = set()

    def bucket(self, t):
        d = self.cur["days"].get(_day(t))
        if d is None:
            d = self.cur["days"][_day(t)] = {"earn": dict.fromkeys(CATS, 0), "jumps": 0, "ly": 0, "active": 0}
        return d

    def earn(self, t, cat, amount):
        if amount:
            self.cur["earn"][cat] += amount
            self.bucket(t)["earn"][cat] += amount
            # Ogni incasso con il suo orario: serve per i record (miglior ora, incasso più grande).
            self.cur["incomes"].append([t, amount, cat])

    def spend(self, cat, amount):
        self.cur["spend"][cat] += amount

    def ship(self, symbol, localised=None):
        key = str(symbol or "").lower()
        # A piedi, in SRV o in taxi il LoadGame riporta la tuta o il veicolo: non sono navi della flotta.
        if not key or NOT_SHIPS.search(key):
            return
        # Prima il nome interno (uguale per LoadGame, Loadout e Shipyard), poi quello tradotto dal gioco.
        name = SHIP_NAMES.get(key) or ship_name(symbol, localised)
        if name and name not in self.cur["ships"]:
            self.cur["ships"].append(name)

    def start(self, t):
        self.cur = _new_session(t, self.name)
        self.sessions.append(self.cur)
        self.bodies, self.refined, self.systems = set(), set(), set()

    def feed(self, t, ev, e):
        if ev == "LoadGame" and self.cur and (self.cur["loadgame"] or _busy(self.cur)):
            self.cur["ended"] = True
            self.cur = None
        if self.cur is None:
            self.start(t)
        s = self.cur
        gap = t - s["end"]
        if 0 < gap <= IDLE:
            s["active"] += gap
            self.bucket(t)["active"] += gap
        s["end"] = max(s["end"], t)
        if e is None:
            return
        handler = getattr(self, "on_" + ev, None)
        if handler:
            handler(t, e)
        elif ev in SERVICE_COSTS:
            self.spend("services", _n(e.get(SERVICE_COSTS[ev])))
        elif ev in OTHER_INCOME:
            self.earn(t, "other", _n(e.get(OTHER_INCOME[ev])))
        elif ev in OTHER_COSTS:
            self.spend("other", _n(e.get(OTHER_COSTS[ev])))
        elif ev in ("PayFines", "PayBounties", "PayLegacyFines"):
            self.spend("fines", _n(e.get("Amount")))

    # --- sessione e nave -----------------------------------------------------------
    def on_LoadGame(self, t, e):
        s = self.cur
        s.update(loadgame=True, commander=e.get("Commander") or s["commander"])
        if isinstance(e.get("Credits"), (int, float)):
            s["credits_start"] = e["Credits"]
        if e.get("Ship"):
            self.ship(e["Ship"], e.get("Ship_Localised"))

    def on_Statistics(self, t, e):
        # Bank_Account.Current_Wealth: il patrimonio che il gioco calcola (più alto del saldo: comprende anche altri beni).
        bank = e.get("Bank_Account") if isinstance(e.get("Bank_Account"), dict) else {}
        if isinstance(bank.get("Current_Wealth"), (int, float)) and self.cur["wealth"] is None:
            self.cur["wealth"] = bank["Current_Wealth"]

    def on_Shutdown(self, t, e):
        self.cur["ended"] = True
        self.cur = None

    def on_Loadout(self, t, e):
        self.ship(e.get("Ship"))

    def on_ShipyardSwap(self, t, e):
        self.ship(e.get("ShipType"), e.get("ShipType_Localised"))

    def on_ShipyardBuy(self, t, e):
        self.spend("ships", _n(e.get("ShipPrice")))
        self.ship(e.get("ShipType"), e.get("ShipType_Localised"))

    def on_ModuleBuy(self, t, e):
        self.spend("modules", _n(e.get("BuyPrice")))

    def on_Resurrect(self, t, e):
        self.spend("rebuy", _n(e.get("Cost")))

    # --- viaggio ed esplorazione -------------------------------------------------------
    def on_FSDJump(self, t, e):
        s, d = self.cur, self.bucket(t)
        s["jumps"] += 1
        d["jumps"] += 1
        s["ly"] += _n(e.get("JumpDist"))
        d["ly"] += _n(e.get("JumpDist"))
        s["fuel"] += _n(e.get("FuelUsed"))
        dist = _n(e.get("JumpDist"))
        if dist and (not s["max_jump"] or dist > s["max_jump"][0]):
            s["max_jump"] = [round(dist, 2), e.get("StarSystem"), t]
        if e.get("StarSystem") and e["StarSystem"] not in self.systems:
            self.systems.add(e["StarSystem"])
            s["systems"] += 1

    def on_Scan(self, t, e):
        body = e.get("BodyName")
        if body and body not in self.bodies:
            self.bodies.add(body)
            self.cur["scans"] += 1

    def on_SAAScanComplete(self, t, e):
        self.cur["mapped"] += 1

    def on_ScanOrganic(self, t, e):
        if e.get("ScanType") == "Analyse":
            self.cur["bio"] += 1

    def on_Died(self, t, e):
        self.cur["deaths"] += 1

    # --- guadagni --------------------------------------------------------------------
    def on_MarketSell(self, t, e):
        kind = str(e.get("Type") or "").lower()
        total, paid = _n(e.get("TotalSale")), _n(e.get("AvgPricePaid"))
        # Merce estratta (raffinata in questa sessione, o estraibile e avuta gratis): conta come estrazione.
        if not paid and (kind in self.refined or kind in MINABLE):
            self.earn(t, "mining", total)
        else:
            self.earn(t, "trade", total - paid * _n(e.get("Count")))

    def on_MiningRefined(self, t, e):
        self.cur["refined"] += 1
        kind = str(e.get("Type") or "").lower()
        self.refined.add(kind[1:].split("_")[0] if kind.startswith("$") else kind)

    def on_MissionCompleted(self, t, e):
        self.earn(t, "missions", _n(e.get("Reward")))
        self.spend("other", _n(e.get("Donated")))

    def on_RedeemVoucher(self, t, e):
        self.earn(t, VOUCHERS.get(str(e.get("Type") or "").lower(), "other"), _n(e.get("Amount")))

    def on_SellExplorationData(self, t, e):
        self.earn(t, "exploration", _n(e.get("TotalEarnings")))

    on_MultiSellExplorationData = on_SellExplorationData

    def on_SellOrganicData(self, t, e):
        data = e.get("BioData") if isinstance(e.get("BioData"), list) else []
        self.earn(t, "exobiology", sum(_n(b.get("Value")) + _n(b.get("Bonus")) for b in data if isinstance(b, dict)))


def parse_file(path):
    p = _Parser(os.path.basename(path))
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            for line in f:
                m = HEAD.match(line)
                e = None
                if m:
                    ts, ev = m.groups()
                else:
                    try:
                        e = json.loads(line)
                        ts, ev = e["timestamp"], e["event"]
                    except (ValueError, KeyError, TypeError):
                        continue
                t = _epoch(ts)
                if t is None:
                    continue
                if ev in NEEDED and e is None:
                    try:
                        e = json.loads(line)
                    except ValueError:
                        continue
                if not isinstance(e, dict) or ev not in NEEDED:
                    e = None
                try:
                    p.feed(t, ev, e)
                except Exception as exc:  # un evento strano non deve rovinare le statistiche
                    print(f"Statistiche, errore evento {ev}: {exc}")
    except OSError:
        pass
    return p.sessions


# ============================================================================
# Cache dei file
# ============================================================================
def _refresh():
    """Rilegge solo i journal nuovi o cambiati; restituisce le sessioni di tutti i file in ordine."""
    global FILES
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
            entry = FILES[name] = {"sig": sig, "sessions": parse_file(path)}
            changed = True
        out.extend(entry["sessions"])
    for name in set(FILES) - seen:
        del FILES[name]
        changed = True
    if changed:
        try:
            storage.save_json(CACHE_FILE, {"v": VERSION, "files": FILES})
        except OSError:
            pass
    return sorted(out, key=lambda s: s["start"])


def _merge(a, b):
    """Unisce una sessione proseguita in un nuovo file (journal spezzato) a quella precedente."""
    a = {**a, "earn": dict(a["earn"]), "spend": dict(a["spend"]), "days": {k: {**v, "earn": dict(v["earn"])} for k, v in a["days"].items()}}
    for k in COUNTERS + ("active",):
        a[k] += b[k]
    for k in CATS:
        a["earn"][k] += b["earn"][k]
    for k in SPEND:
        a["spend"][k] += b["spend"][k]
    for day, d in b["days"].items():
        cur = a["days"].setdefault(day, {"earn": dict.fromkeys(CATS, 0), "jumps": 0, "ly": 0, "active": 0})
        for k in ("jumps", "ly", "active"):
            cur[k] += d[k]
        for k in CATS:
            cur["earn"][k] += d["earn"][k]
    a["ships"] = a["ships"] + [x for x in b["ships"] if x not in a["ships"]]
    # Sistemi: somma dei due file (un sistema visitato in entrambi conta due volte, caso raro).
    a["systems"] += b["systems"]
    a["incomes"] = a["incomes"] + b["incomes"]
    if b["max_jump"] and (not a["max_jump"] or b["max_jump"][0] > a["max_jump"][0]):
        a["max_jump"] = b["max_jump"]
    if a["wealth"] is None:
        a["wealth"] = b["wealth"]
    a.update(end=max(a["end"], b["end"]), ended=b["ended"])
    return a


def _sessions():
    merged = []
    for s in _refresh():
        prev = merged[-1] if merged else None
        if prev and not s["loadgame"] and not prev["ended"] and s["start"] - prev["end"] <= IDLE:
            merged[-1] = _merge(prev, s)
        else:
            merged.append(s)
    # Le sessioni vuote (gioco aperto e chiuso subito) non interessano.
    return [s for s in merged if s["active"] >= 60 or _busy(s)]


def _rate(earned, active):
    return round(earned / active * 3600) if active >= 600 else None


def _public(s, nxt, now):
    earned, spent = sum(s["earn"].values()), sum(s["spend"].values())
    end_cr = nxt["credits_start"] if nxt and nxt["commander"] == s["commander"] else None
    if end_cr is None and not nxt:
        live = journal.STATE.cmdr.get("credits") if journal.STATE.live else None
        end_cr = live if live is not None else (s["credits_start"] + earned - spent if s["credits_start"] is not None else None)
    return {"id": f'{s["file"]}:{s["start"]}', "start": s["start"], "end": s["end"], "active": s["active"],
            "commander": s["commander"], "ships": s["ships"], "credits_start": s["credits_start"], "credits_end": end_cr,
            "wealth": s["wealth"], "systems": s["systems"], "max_jump": s["max_jump"],
            **{k: round(s[k], 2) if isinstance(s[k], float) else s[k] for k in COUNTERS},
            "earn": s["earn"], "earned": earned, "spend": s["spend"], "spent": spent, "cr_h": _rate(earned, s["active"]),
            "ended": s["ended"], "live": not s["ended"] and now - s["end"] <= IDLE}


def _empty_day(day):
    return {"date": day, "earn": dict.fromkeys(CATS, 0), "earned": 0, "jumps": 0, "ly": 0, "active": 0, "sessions": 0}


def summary():
    with LOCK:
        sessions = _sessions()
    now = time.time()
    pub = [_public(s, sessions[i + 1] if i + 1 < len(sessions) else None, now) for i, s in enumerate(sessions)]

    days = {}
    for s in sessions:
        days.setdefault(_day(s["start"]), _empty_day(_day(s["start"])))["sessions"] += 1
        for day, d in s["days"].items():
            cur = days.setdefault(day, _empty_day(day))
            for k in ("jumps", "ly", "active"):
                cur[k] += d[k]
            for k in CATS:
                cur["earn"][k] += d["earn"][k]
    for d in days.values():
        d["earned"] = sum(d["earn"].values())
        d["ly"] = round(d["ly"], 1)
    # Ultimi 60 giorni, continui (anche quelli senza gioco), dal più vecchio.
    last = [_day(now - i * 86400) for i in range(59, -1, -1)]
    recent = [days.get(day) or _empty_day(day) for day in dict.fromkeys(last)]

    weeks = {}
    for day, d in days.items():
        y, w, _ = date.fromisoformat(day).isocalendar()
        cur = weeks.setdefault(f"{y}-W{w:02d}", {"week": f"{y}-W{w:02d}", "from": day, "earned": 0, "jumps": 0, "ly": 0, "active": 0, "days": 0})
        cur["from"] = min(cur["from"], day)
        cur["days"] += 1 if d["active"] else 0
        for k in ("earned", "jumps", "ly", "active"):
            cur[k] += d[k]

    totals = {"sessions": len(pub), "earn": dict.fromkeys(CATS, 0), "spend": dict.fromkeys(SPEND, 0),
              **dict.fromkeys(COUNTERS, 0), "active": 0, "first": pub[0]["start"] if pub else None}
    for s in pub:
        for k in COUNTERS + ("active",):
            totals[k] += s[k]
        for k in CATS:
            totals["earn"][k] += s["earn"][k]
        for k in SPEND:
            totals["spend"][k] += s["spend"][k]
    totals["earned"], totals["spent"] = sum(totals["earn"].values()), sum(totals["spend"].values())
    totals["ly"], totals["fuel"] = round(totals["ly"], 1), round(totals["fuel"], 1)
    totals["cr_h"] = _rate(totals["earned"], totals["active"])
    best = max(pub, key=lambda s: s["earned"], default=None)
    totals["best_session"] = best if best and best["earned"] > 0 else None
    best_day = max(days.values(), key=lambda d: d["earned"], default=None)
    totals["best_day"] = best_day if best_day and best_day["earned"] > 0 else None

    current = pub[-1] if pub and pub[-1]["live"] else None
    return {**_advanced(sessions, pub, days, now),"sessions": pub[::-1][:200], "days": recent, "weeks": sorted(weeks.values(), key=lambda w: w["week"])[-12:],
            "totals": totals, "current": current, "categories": list(CATS)}


# ============================================================================
# Statistiche avanzate: crediti nel tempo, guadagni per attività, CR/h per attività, record
# ============================================================================
DOMINANT = 0.6     # quota minima dei guadagni di una sessione perché la sessione "appartenga" a un'attività
RATE_MIN = 600     # secondi attivi minimi perché una sessione entri nel calcolo dei CR/h (come _rate)
PERIODS = {"30": 30, "90": 90, "all": None}


def _credit_series(pub):
    """Un punto per sessione: il saldo del LoadGame (Credits) e, se c'è, Current_Wealth delle Statistics."""
    with_cr = [s for s in pub if s["credits_start"] is not None]
    if not with_cr:
        return {"commander": None, "points": []}
    cmdr = with_cr[-1]["commander"]  # il comandante più recente: con più account i saldi non si mescolano
    mine = [s for s in pub if s["commander"] == cmdr]
    pts = [{"t": s["start"], "credits": s["credits_start"], "wealth": s["wealth"], "kind": "start"}
           for s in mine if s["credits_start"] is not None]
    last = mine[-1] if mine else None
    if last and last["credits_end"] is not None and last["end"] > last["start"]:
        pts.append({"t": last["end"], "credits": last["credits_end"], "wealth": None, "kind": "live" if last["live"] else "end"})
    return {"commander": cmdr, "points": pts}


def _activity_weeks(days, now):
    """Guadagni per attività settimana per settimana, dalla prima settimana giocata a oggi (anche quelle vuote)."""
    if not days:
        return []
    monday = lambda iso: date.fromisoformat(iso) - timedelta(days=date.fromisoformat(iso).weekday())
    first, today = monday(min(days)), monday(_day(now))
    out, cur = {}, first
    while cur <= today:
        y, w, _ = cur.isocalendar()
        out[cur.isoformat()] = {"week": f"{y}-W{w:02d}", "from": cur.isoformat(), "earn": dict.fromkeys(CATS, 0), "earned": 0, "active": 0}
        cur += timedelta(days=7)
    for day, d in days.items():
        wk = out.get(monday(day).isoformat())
        if wk:
            wk["active"] += d["active"]
            wk["earned"] += d["earned"]
            for k in CATS:
                wk["earn"][k] += d["earn"][k]
    return list(out.values())


def _rates(pub, now):
    """CR/h per attività: si sommano guadagni e tempo attivo delle sessioni in cui quell'attività ha reso
    almeno il 60% dei guadagni della sessione. È una stima: i guadagni contano quando vengono incassati."""
    res = {}
    for key, n in PERIODS.items():
        cut = now - n * 86400 if n else None
        acc, mixed, considered = {}, 0, 0
        for s in pub:
            if (cut and s["start"] < cut) or s["active"] < RATE_MIN or s["earned"] <= 0:
                continue
            considered += 1
            pos = {k: max(0, v) for k, v in s["earn"].items()}
            tot = sum(pos.values())
            cat = max(pos, key=pos.get)
            if not tot or pos[cat] / tot < DOMINANT:
                mixed += 1
                continue
            a = acc.setdefault(cat, {"cat": cat, "sessions": 0, "active": 0, "earned": 0})
            a["sessions"] += 1
            a["active"] += s["active"]
            a["earned"] += s["earned"]
        rows = [{**a, "cr_h": round(a["earned"] / a["active"] * 3600)} for a in acc.values() if a["active"]]
        res[key] = {"rows": sorted(rows, key=lambda r: -r["cr_h"]), "mixed": mixed, "considered": considered}
    return {"periods": res, "dominant": DOMINANT, "min_active": RATE_MIN}


def _best_hour(sessions):
    """Il massimo incassato in 60 minuti consecutivi (finestra mobile sugli incassi di ogni sessione)."""
    best = None
    for s in sessions:
        inc = sorted((x for x in s.get("incomes", []) if x[1] > 0), key=lambda x: x[0])
        lo, total = 0, 0
        for hi, (t, amount, _cat) in enumerate(inc):
            total += amount
            while inc[lo][0] <= t - 3600:
                total -= inc[lo][1]
                lo += 1
            if not best or total > best["value"]:
                best = {"value": total, "t": inc[lo][0], "end": t, "count": hi - lo + 1}
    return best


def _records(sessions, pub, credits):
    def top(key, min_value=0, filt=None):
        cand = [s for s in pub if (filt is None or filt(s)) and (s.get(key) or 0) > min_value]
        s = max(cand, key=lambda x: x[key], default=None)
        return {"value": s[key], "t": s["start"], "active": s["active"], "ships": s["ships"]} if s else None

    rec = {"best_session": top("earned"), "best_rate": top("cr_h", filt=lambda s: s["active"] >= 3600 and s["cr_h"]),
           "best_hour": _best_hour(sessions), "most_systems": top("systems"), "most_jumps": top("jumps"),
           "most_ly": top("ly"), "longest_session": top("active"), "most_scans": top("scans"), "most_bio": top("bio")}
    jumps = [s["max_jump"] for s in pub if s.get("max_jump")]
    j = max(jumps, key=lambda x: x[0], default=None)
    rec["longest_jump"] = {"value": j[0], "system": j[1], "t": j[2]} if j else None
    inc = max((x for s in sessions for x in s.get("incomes", [])), key=lambda x: x[1], default=None)
    rec["biggest_income"] = {"value": inc[1], "cat": inc[2], "t": inc[0]} if inc and inc[1] > 0 else None
    pts = credits["points"]
    c = max(pts, key=lambda p: p["credits"], default=None)
    rec["max_credits"] = {"value": c["credits"], "t": c["t"]} if c else None
    w = max((p for p in pts if p["wealth"] is not None), key=lambda p: p["wealth"], default=None)
    rec["max_wealth"] = {"value": w["wealth"], "t": w["t"]} if w else None
    return rec


def _advanced(sessions, pub, days, now):
    credits = _credit_series(pub)
    return {"credits": credits, "activity_weeks": _activity_weeks(days, now), "rates": _rates(pub, now),
            "records": _records(sessions, pub, credits)}
