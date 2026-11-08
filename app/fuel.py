"""Sicurezza della rotta (carburante, stelle non rifornibili) e soccorso Fuel Rats.

Carburante per un salto (formula dell'FSD usata da Coriolis/EDSY/Spansh):
    carburante = fuelmul * ((distanza - boost) * massa / optmass) ^ fuelpower      (al massimo maxfuel)
con i parametri del modulo FSD montato (catalogo Coriolis + modifiche dell'ingegnere dal Loadout) e la massa
attuale (UnladenMass + carburante nel serbatoio principale + carico; verificato su un FSDJump reale: 1,6347 t stimate contro 1,634747 t del journal). Senza questi dati si usa il consumo osservato nei salti recenti
(FSDJump.FuelUsed: il salto più caro, +20%, per ogni salto); se non c'è nemmeno quello, i controlli sul
carburante vengono saltati (restano solo quelli sulla classe delle stelle). Il supercharge non viene contato:
la stima è per eccesso.

Supercharge (community, non documentato da Frontier): nel cono di getto di una stella di neutroni il salto
successivo arriva a x4, con una nana bianca circa x1.5; ogni passaggio consuma integrità dell'FSD (~1%) e sotto
l'80% compaiono malfunzionamenti. Fonti: forum Frontier, thread "How dangerous are neutron star FSD charging
supposed to be?" (https://forums.frontier.co.uk/goto/post?id=4872297) e "How To Increase Jump Capability"
(https://forums.frontier.co.uk/threads/how-to-increase-jump-capability.370592).

Stelle rifornibili: classi K G B F O A M ("KGBFOAM").

Procedura Fuel Rats: dalla pagina ufficiale https://fuelrats.com/i-need-fuel e dal modulo di richiesta
(QMS, https://github.com/FuelRats/QMS, testi in qms/frontend/public/locales). Il modulo NON legge parametri
dall'indirizzo (verificato nel sorgente pages/index.tsx): niente precompilazione, i dati vanno copiati a mano.
Svolgimento del soccorso (amicizia, wing, beacon, zona di esclusione): guida dei dispatcher Fuel Rats
"Anatomy of typical rescues" (https://confluence.fuelrats.com/x/C4A3). I testi sono nella scheda (fuelrats.js).
"""

import glob
import json
import math
import os
import threading
import time

from . import coriolis, journal, paths, search, storage, voice
from .gamedata import SCOOPABLE
from .journal import STATE
from .lang import pick

CONFIG_FILE = paths.user_file("fuel_config.json")
DEFAULT_CONFIG = {"voice": True, "feed": True, "margin_pct": 15, "rescue_voice": True}
MAIN_EMPTY_T = 0.05

_lock = threading.Lock()
_T = {"system": None, "address": None, "star": None, "pending": {}, "fuel": None, "reservoir": None,
      "fuel_ts": 0.0, "used": [], "odyssey": None, "gameversion": None, "warned": set(), "stranded_said": False}
_started = False


# --- Utilità -----------------------------------------------------------------------------

def scoopable(star_class):
    sc = star_class or ""
    return sc[:1] in SCOOPABLE and len(sc) <= 2 if sc else None


def star_kind(star_class):
    sc = star_class or ""
    if sc == "N":
        return "neutron"
    if sc.startswith("D"):
        return "white_dwarf"
    if sc in ("H", "SupermassiveBlackHole"):
        return "black_hole"
    return None


def _num(v, default, lo, hi):
    try:
        return max(lo, min(hi, float(v)))
    except (TypeError, ValueError):
        return default


def load_config():
    data = storage.load_json(CONFIG_FILE, {})
    cfg = {**DEFAULT_CONFIG, **(data if isinstance(data, dict) else {})}
    cfg["margin_pct"] = _num(cfg.get("margin_pct"), 15, 0, 100)
    return cfg


def save_config(changes):
    cfg = {**load_config(), **{k: v for k, v in (changes or {}).items() if k in DEFAULT_CONFIG}}
    for k in ("voice", "feed", "rescue_voice"):
        cfg[k] = bool(cfg[k])
    cfg["margin_pct"] = _num(cfg.get("margin_pct"), 15, 0, 100)
    storage.save_json(CONFIG_FILE, cfg)
    return status()


def _n(n, one, many):
    return f"{n} {one if n == 1 else many}"


def _fmt_t(v):
    return f"{v:.1f}".replace(".", ",")


# --- Lettura degli eventi (storico dell'ultimo journal + diretta) ---------------------------

def _track(e):
    ev = e.get("event")
    with _lock:
        if ev == "Fileheader":
            _T["gameversion"] = e.get("gameversion")
            _T["odyssey"] = e.get("Odyssey")
        elif ev == "LoadGame":
            _T["gameversion"] = e.get("gameversion") or _T["gameversion"]
            _T["odyssey"] = e.get("Odyssey", _T["odyssey"])
            _set_fuel(e.get("FuelLevel"), None)
        elif ev == "StartJump" and e.get("JumpType") == "Hyperspace":
            _T["pending"] = {"address": e.get("SystemAddress"), "star": e.get("StarClass")}
        elif ev in ("FSDJump", "Location", "CarrierJump"):
            addr = e.get("SystemAddress")
            if addr != _T["address"]:
                _T["star"] = None
                _T["warned"] = {w for w in _T["warned"] if w[0] == "route"}
            _T["system"], _T["address"] = e.get("StarSystem"), addr
            if ev == "FSDJump":
                if _T["pending"].get("address") == addr:
                    _T["star"] = _T["pending"].get("star")
                if e.get("FuelUsed") is not None and e.get("JumpDist"):
                    _T["used"] = (_T["used"] + [(e["JumpDist"], e["FuelUsed"])])[-20:]
                _set_fuel(e.get("FuelLevel"), None)
            _T["pending"] = {}
        elif ev == "Scan" and e.get("StarType") and e.get("SystemAddress") == _T["address"] \
                and (e.get("DistanceFromArrivalLS") or 0) < 1 and not _T["star"]:
            _T["star"] = e["StarType"]
        elif ev == "FuelScoop":
            _set_fuel(e.get("Total"), None)
        elif ev == "ReservoirReplenished":
            _set_fuel(e.get("FuelMain"), e.get("FuelReservoir"))
        elif ev == "RefuelAll":
            _set_fuel(STATE.cmdr.get("fuel_cap"), None)
        elif ev == "RefuelPartial" and _T["fuel"] is not None:
            _set_fuel(_T["fuel"] + (e.get("Amount") or 0), None)


def _set_fuel(main, reservoir):
    if main is not None:
        _T["fuel"] = float(main)
        _T["fuel_ts"] = time.time()
    if reservoir is not None:
        _T["reservoir"] = float(reservoir)


def _replay_latest_journal():
    files = sorted(glob.glob(os.path.join(paths.JOURNAL_DIR, "Journal.*.log")), key=os.path.getmtime)
    for path in files[-2:]:
        try:
            with open(path, encoding="utf-8", errors="replace") as f:
                for line in f:
                    try:
                        _track(json.loads(line))
                    except ValueError:
                        continue
        except OSError:
            pass


# --- Nave e FSD --------------------------------------------------------------------------

def _ship_raw():
    with STATE.lock:
        lo = STATE.loadouts.get(STATE.current_ship_id)
        cap = STATE.cmdr.get("fuel_cap")
        ship = dict(STATE.ship)
    return lo, cap, ship


def fsd_model():
    """Parametri dell'FSD montato e massa della nave. source: 'fsd' (formula) o None."""
    lo, cap, ship = _ship_raw()
    out = {"source": None, "cap": cap, "reserve_cap": None, "unladen": None, "has_scoop": None,
           "ship": ship.get("type"), "ship_name": (ship.get("name") or "").strip() or None, "jump_range": ship.get("jump_range")}
    if not lo:
        return out
    out["unladen"] = lo.get("mass")
    raw = lo.get("raw") or []
    out["has_scoop"] = any("fuelscoop" in (m.get("item") or "") for m in raw)
    catalog = coriolis._catalog or coriolis.load()
    if not catalog:
        return out
    key = (catalog.get("journal_ships") or {}).get(lo.get("symbol"))
    out["reserve_cap"] = ((catalog.get("ships") or {}).get(key) or {}).get("reserveFuel")
    by_symbol = {}
    for m in catalog.get("modules", []):     # a parità di simbolo, la versione normale (non pre-ingegnerizzata)
        if m.get("symbol") not in by_symbol or by_symbol[m["symbol"]].get("pre"):
            by_symbol[m.get("symbol")] = m
    fsd = next((m for m in raw if m.get("slot") == "FrameShiftDrive"), None)
    base = by_symbol.get((fsd or {}).get("item"))
    if not base or not base.get("optmass"):
        return out
    mods = fsd.get("mods") or {}
    boost = sum((by_symbol.get(m.get("item")) or {}).get("jumpboost") or 0 for m in raw
                if "guardianfsdbooster" in (m.get("item") or ""))
    out.update(source="fsd", optmass=mods.get("FSDOptimalMass", base["optmass"]),
               maxfuel=mods.get("MaxFuelPerJump", base["maxfuel"]), fuelmul=base["fuelmul"],
               fuelpower=base["fuelpower"], boost=boost, fsd_name=base.get("name"),
               fsd_class=f"{base.get('class')}{base.get('rating')}")
    return out


def _cargo_t():
    data = storage.load_json(os.path.join(paths.JOURNAL_DIR, "Cargo.json"), {}) or {}
    if data.get("Vessel", "Ship") != "Ship":
        return 0
    return sum(i.get("Count") or 0 for i in data.get("Inventory") or [])


class FuelCalc:
    """Stima del carburante per salto con il modello migliore disponibile."""

    def __init__(self, model, fuel_now, cargo):
        self.m = model
        self.cap = model.get("cap") or 0
        self.mass = (model.get("unladen") or 0) + (self.cap if fuel_now is None else fuel_now) + cargo
        with _lock:
            used = list(_T["used"])
        self.used = used
        if model.get("source") == "fsd" and model.get("unladen"):
            self.source = "fsd"
            self.note = pick(f"Stima dalla formula dell'FSD ({model.get('fsd_class')}, massa attuale ~{self.mass:.0f} t); "
                             "il supercharge dei neutroni non è contato, quindi è per eccesso.",
                             f"Estimate from the FSD formula ({model.get('fsd_class')}, current mass ~{self.mass:.0f} t); "
                             "neutron supercharge isn't counted, so it errs on the high side.")
        elif used:
            self.source = "journal"
            self.note = pick("FSD non riconosciuto: stima dal consumo dei tuoi ultimi salti (FuelUsed nel journal), "
                             "con un margine prudente.",
                             "FSD not recognised: estimate based on the fuel used in your last jumps (FuelUsed in the journal), "
                             "with a safe margin.")
        else:
            self.source = None
            self.note = pick("Nessun dato sull'FSD né salti recenti: il consumo non è stimabile, controllo solo le classi "
                             "delle stelle. Fai un salto per avere una stima.",
                             "No FSD data and no recent jumps: fuel use can't be estimated, only star classes are checked. "
                             "Make a jump to get an estimate.")

    def max_per_jump(self):
        if self.source == "fsd":
            return min(self.m["maxfuel"], self.cap or self.m["maxfuel"])
        if self.source == "journal":
            return max(f for _, f in self.used) * 1.2
        return None

    def for_jump(self, dist):
        """Tonnellate per un salto di 'dist' al (None se la distanza non è nota)."""
        if dist is None:
            return self.max_per_jump()
        if self.source == "fsd":
            m = self.m
            eff = max(dist - (m.get("boost") or 0), 0)
            return m["fuelmul"] * (eff * self.mass / m["optmass"]) ** m["fuelpower"]
        return self.max_per_jump()

    def range_now(self, fuel):
        if self.source != "fsd" or not fuel:
            return None
        m = self.m
        f = min(fuel, m["maxfuel"])
        return (f / m["fuelmul"]) ** (1 / m["fuelpower"]) * m["optmass"] / self.mass + (m.get("boost") or 0)


# --- Stato del carburante ------------------------------------------------------------------

# Bit di Status.json "Flags" (Frontier, Elite Dangerous Player Journal, cap. Status File): 0 Docked, 1 Landed,
# 11 Scooping Fuel, 19 Low Fuel (< 25%), 24 In MainShip.
FLAG_DOCKED, FLAG_LANDED, FLAG_SCOOPING, FLAG_LOW_FUEL, FLAG_IN_SHIP = 1, 2, 1 << 11, 1 << 19, 1 << 24


def fuel_now():
    status = journal.read_status()
    f = status.get("Fuel") or {}
    flags = status.get("Flags") or 0
    with _lock:
        tracked, reservoir = _T["fuel"], _T["reservoir"]
    in_game = bool(flags)
    main = f.get("FuelMain") if in_game and "FuelMain" in f else tracked
    res = f.get("FuelReservoir") if in_game and "FuelReservoir" in f else reservoir
    return {"main": main, "reservoir": res, "flags": flags, "in_game": in_game,
            "docked": bool(flags & FLAG_DOCKED), "landed": bool(flags & FLAG_LANDED),
            "scooping": bool(flags & FLAG_SCOOPING), "low_flag": bool(flags & FLAG_LOW_FUEL),
            "in_ship": bool(flags & FLAG_IN_SHIP) or not in_game,
            "source": "Status.json" if in_game and "FuelMain" in f else "journal"}


def current_star():
    with _lock:
        star, sysname = _T["star"], _T["system"]
    if not star:
        route = storage.load_json(os.path.join(paths.JOURNAL_DIR, "NavRoute.json"), {}) or {}
        cur = STATE.location.get("system")
        for r in route.get("Route") or []:
            if r.get("StarSystem") == cur:
                star = r.get("StarClass")
    return {"class": star, "scoopable": scoopable(star), "kind": star_kind(star),
            "system": STATE.location.get("system") or sysname}


# --- Analisi delle rotte ---------------------------------------------------------------------

def _dist(a, b):
    if not a or not b or None in a or None in b:
        return None
    return math.dist(a, b)


def _analyse(hops, calc, fuel, here_scoopable, cap, margin):
    """hops: [{system, star, scoopable (True/False/None), dist, pos}] dalla posizione attuale in avanti."""
    out, risks = [], []
    known = calc.source is not None
    left = fuel if fuel is not None else cap
    chain_start, chain_fuel, chain_n = None, 0.0, 0
    first_reach = None        # prossima stella rifornibile
    cum = 0.0
    worst_chain = None
    for i, h in enumerate(hops):
        need = calc.for_jump(h.get("dist"))
        if need is None:              # consumo non stimabile: solo le classi delle stelle
            fuel = None
            need = 0.0
            h.update(fuel_need=None, fuel_left=None, danger=False, kind=star_kind(h.get("star")))
        else:
            if calc.source == "fsd" and h.get("dist") and need > calc.m["maxfuel"] + 1e-6:
                h["too_far"] = True
            cum += need
            left -= need
            h.update(fuel_need=round(need, 2), fuel_left=round(left, 2), danger=left < 0,
                     kind=star_kind(h.get("star")))
        if first_reach is None and h.get("scoopable"):
            first_reach = {"index": i, "system": h["system"], "star": h.get("star"), "jumps": i + 1,
                           "fuel_needed": round(cum * (1 + margin), 2)}
        if h.get("scoopable") is False:
            if chain_start is None:
                chain_start, chain_fuel, chain_n = i, 0.0, 0
            chain_n += 1
        if h.get("scoopable") is False or chain_start is not None:
            chain_fuel += need
        if h.get("scoopable"):
            if chain_start is not None:
                c = {"from": hops[chain_start]["system"], "to": h["system"], "jumps": chain_n + 1,
                     "fuel": round(chain_fuel, 1)}
                if worst_chain is None or c["fuel"] > worst_chain["fuel"]:
                    worst_chain = c
                if not known:
                    pass
                elif chain_fuel * (1 + margin) > cap:
                    risks.append({"level": "bad", "text": pick(
                        f"Da {c['from']} a {c['to']}: {chain_n} stelle non rifornibili di fila, "
                        f"servono ~{_fmt_t(chain_fuel)} t ma il serbatoio ne tiene {_fmt_t(cap)}.",
                        f"From {c['from']} to {c['to']}: {chain_n} non-scoopable stars in a row, "
                        f"you need ~{_fmt_t(chain_fuel)} t but your tank holds {_fmt_t(cap)}.")})
                elif chain_n >= 2 and chain_fuel * (1 + margin) > cap * 0.6:
                    risks.append({"level": "warn", "text": pick(
                        f"Da {c['from']} a {c['to']}: {chain_n} stelle non rifornibili di fila "
                        f"(~{_fmt_t(chain_fuel)} t): parti col pieno.",
                        f"From {c['from']} to {c['to']}: {chain_n} non-scoopable stars in a row "
                        f"(~{_fmt_t(chain_fuel)} t): leave with a full tank.")})
            chain_start, chain_fuel, chain_n = None, 0.0, 0
            left = cap       # ipotesi: fai il pieno a ogni stella rifornibile
        out.append(h)
    if chain_start is not None and chain_n and known:
        risks.append({"level": "bad" if chain_fuel * (1 + margin) > (fuel or 0) else "warn",
                      "text": pick(f"Ultimi {chain_n} salti senza stelle rifornibili (da {hops[chain_start]['system']}, ~{_fmt_t(chain_fuel)} t).",
                                   f"Last {chain_n} {'jump' if chain_n == 1 else 'jumps'} with no scoopable stars (from {hops[chain_start]['system']}, ~{_fmt_t(chain_fuel)} t).")})
    nonscoop = [h for h in out if h.get("scoopable") is False]
    if nonscoop:
        risks.insert(0, {"level": "info", "text": pick(
            f"{len(nonscoop)} stelle non rifornibili su {len(out)} salti.",
            f"{len(nonscoop)} non-scoopable {'star' if len(nonscoop) == 1 else 'stars'} in {len(out)} {'jump' if len(out) == 1 else 'jumps'}.")})
    wd = [h["system"] for h in out if h.get("kind") == "white_dwarf"]
    ns = [h["system"] for h in out if h.get("kind") == "neutron"]
    bh = [h["system"] for h in out if h.get("kind") == "black_hole"]
    if ns or wd:
        risks.append({"level": "warn", "text": pick(
            f"{_n(len(ns), 'stella di neutroni', 'stelle di neutroni')} e {_n(len(wd), 'nana bianca', 'nane bianche')}: il cono di getto dà il "
            "supercharge ma usura l'FSD; entraci solo se vuoi il boost e tieni l'FSD sopra l'80%.",
            f"{_n(len(ns), 'neutron star', 'neutron stars')} and {_n(len(wd), 'white dwarf', 'white dwarfs')}: the jet cone gives a "
            "supercharge but wears the FSD; only fly in if you want the boost and keep the FSD above 80%.")})
    if any(h.get("too_far") for h in out):
        risks.append({"level": "bad", "text": pick(
            "Alcuni salti superano il carburante massimo per salto del tuo FSD: senza supercharge non li fai.",
            "Some jumps exceed your FSD's max fuel per jump: you can't make them without a supercharge.")})
    now = None
    if fuel is not None and hops:
        if first_reach and fuel < first_reach["fuel_needed"]:
            fj = first_reach["jumps"]
            now = {"level": "bad", "text": pick(
                f"Col carburante attuale ({_fmt_t(fuel)} t) non arrivi alla prossima stella rifornibile "
                f"({first_reach['system']}, {fj} salti, ~{_fmt_t(first_reach['fuel_needed'])} t)."
                + (" Fai rifornimento qui prima di saltare." if here_scoopable else " Cambia rotta verso una stella KGBFOAM vicina."),
                f"With your current fuel ({_fmt_t(fuel)} t) you won't reach the next scoopable star "
                f"({first_reach['system']}, {fj} {'jump' if fj == 1 else 'jumps'}, ~{_fmt_t(first_reach['fuel_needed'])} t)."
                + (" Refuel here before jumping." if here_scoopable else " Reroute to a nearby KGBFOAM star."))}
        elif not first_reach and fuel < cum * (1 + margin):
            now = {"level": "bad", "text": pick(
                f"Sulla rotta non ci sono stelle rifornibili e il carburante ({_fmt_t(fuel)} t) "
                f"non basta per arrivare in fondo (~{_fmt_t(cum)} t).",
                f"There are no scoopable stars on the route and your fuel ({_fmt_t(fuel)} t) "
                f"isn't enough to reach the end (~{_fmt_t(cum)} t).")}
        if now:
            risks.insert(0, now)
    return {"hops": out, "risks": risks, "next_scoopable": first_reach, "worst_chain": worst_chain,
            "non_scoopable": len(nonscoop), "neutron": len(ns), "white_dwarf": len(wd), "black_hole": len(bh),
            "fuel_total": round(cum, 1) if known else None, "jumps": len(out)}


def _ingame_hops():
    route = storage.load_json(os.path.join(paths.JOURNAL_DIR, "NavRoute.json"), {}) or {}
    jumps = route.get("Route") or []
    cur = STATE.location.get("system")
    names = [r.get("StarSystem") for r in jumps]
    if cur in names:
        jumps = jumps[names.index(cur) + 1:]
    prev = STATE.location.get("star_pos")
    hops = []
    for r in jumps:
        pos = r.get("StarPos")
        hops.append({"system": r.get("StarSystem"), "star": r.get("StarClass"), "scoopable": scoopable(r.get("StarClass")),
                     "dist": _dist(prev, pos), "pos": pos})
        prev = pos
    return hops


def _spansh_hops():
    route = search.load_route()
    if not route or not route.get("jumps"):
        return None, None
    jumps = route["jumps"]
    cur = STATE.location.get("system")
    names = [j.get("system") for j in jumps]
    start = names.index(cur) + 1 if cur in names else 0
    if not (cur in names):
        pos = STATE.location.get("star_pos")
        best, idx = None, -1
        for i, j in enumerate(jumps):
            d = _dist(pos, j.get("pos"))
            if d is not None and (best is None or d < best):
                best, idx = d, i
        if best is not None and best < 2 * (route.get("range") or 60):
            start = idx + 1
    hops = []
    for j in jumps[start:]:
        hops.append({"system": j.get("system"), "star": "N" if j.get("neutron") else None,
                     "scoopable": j.get("scoopable") if route.get("tool") == "galaxy" else None,
                     "dist": j.get("distance_jumped") if (j.get("jumps") or 1) <= 1 else None,
                     "jumps": j.get("jumps"), "refuel": j.get("refuel"), "neutron": j.get("neutron"),
                     "pos": j.get("pos")})
    return route, hops


def route_safety(cfg=None, model=None, fuel=None):
    cfg = cfg or load_config()
    model = model or fsd_model()
    fuel = fuel or fuel_now()
    calc = FuelCalc(model, fuel["main"], _cargo_t())
    margin = cfg["margin_pct"] / 100
    cap = model.get("cap") or 0
    here = current_star()
    hops = _ingame_hops()
    ingame = _analyse(hops, calc, fuel["main"], here["scoopable"], cap, margin) if hops else None
    route, shops = _spansh_hops()
    spansh = None
    if route:
        tool = route.get("tool")
        known = tool == "galaxy"
        spansh = {"tool": tool, "from": route.get("from"), "to": route.get("to"), "known_stars": known}
        if known:
            spansh.update(_analyse(shops, calc, fuel["main"], here["scoopable"], cap, margin))
            spansh["refuels"] = [h["system"] for h in shops if h.get("refuel")]
        else:
            ns = [h["system"] for h in shops if h.get("neutron")]
            spansh.update(hops=shops, jumps=sum(h.get("jumps") or 1 for h in shops), neutron=len(ns), risks=[
                {"level": "info", "text": pick(
                    "Per questo tipo di rotta la classe delle stelle intermedie non è nota: controlla la "
                    "rotta tracciata nella mappa galattica, che la riporta, oppure calcola una 'rotta esatta'.",
                    "For this route type the class of the stars in between isn't known: check the route "
                    "plotted in the Galaxy Map, which shows it, or calculate an 'exact route'.")}] + ([
                {"level": "warn", "text": pick(
                    f"{len(ns)} tappe su stelle di neutroni: il supercharge usura l'FSD, "
                    "tienilo sopra l'80% (un AFMU aiuta).",
                    f"{len(ns)} {'waypoint' if len(ns) == 1 else 'waypoints'} on neutron stars: supercharging wears the FSD, "
                    "keep it above 80% (an AFMU helps).")}] if ns else []))
    return {"ingame": ingame, "spansh": spansh, "calc": {"source": calc.source, "note": calc.note,
            "max_per_jump": None if calc.max_per_jump() is None else round(calc.max_per_jump(), 2), "margin_pct": cfg["margin_pct"]}}


# --- Comandante a secco ---------------------------------------------------------------------

def stranded_check(model=None, fuel=None, safety=None):
    model = model or fsd_model()
    fuel = fuel or fuel_now()
    here = current_star()
    main, cap = fuel["main"], model.get("cap") or 0
    reasons, level = [], None
    if main is None or fuel["docked"] or fuel["landed"] or not fuel["in_ship"]:
        return {"level": None, "reasons": [], "star": here}
    calc = FuelCalc(model, main, _cargo_t())
    next_hop = (safety or {}).get("ingame", {}) or {}
    first = (next_hop.get("hops") or [None])[0]
    # Senza rotta non si sa quanto dista la stella più vicina: si usa il più corto dei tuoi ultimi salti.
    with _lock:
        used = list(_T["used"])
    if first and first.get("dist"):
        need = calc.for_jump(first["dist"])
    elif used:
        d_min = min(d for d, _ in used)
        need = calc.for_jump(d_min) if calc.source == "fsd" else min(f for _, f in used)
    else:
        need = None
    can_scoop = here["scoopable"] and model.get("has_scoop") is not False
    if main <= MAIN_EMPTY_T:
        reasons.append(pick("Serbatoio principale vuoto: l'FSD non può saltare.", "Main fuel tank empty: the FSD can't jump."))
    elif need is not None and main < need:
        where = ((pick(" verso ", " to ") + first["system"]) if first and first.get("dist")
                 else pick(" anche per il più corto dei tuoi ultimi salti", " even for the shortest of your recent jumps"))
        reasons.append(pick(f"Carburante ({_fmt_t(main)} t) insufficiente per un salto (~{_fmt_t(need)} t{where}).",
                            f"Not enough fuel ({_fmt_t(main)} t) for a jump (~{_fmt_t(need)} t{where})."))
    if reasons:
        if can_scoop:
            level = "scoop"
            reasons.append(pick(f"La stella qui ({here['class']}) è rifornibile: avvicinati e usa il fuel scoop.",
                                f"The star here ({here['class']}) is scoopable: get close and use your fuel scoop."))
        else:
            level = "stranded"
            if here["scoopable"] and model.get("has_scoop") is False:
                reasons.append(pick("La stella è rifornibile ma non hai un fuel scoop.",
                                    "The star is scoopable but you have no fuel scoop."))
            elif here["scoopable"] is False:
                reasons.append(pick(f"La stella qui ({here['class']}) non è rifornibile.",
                                    f"The star here ({here['class']}) isn't scoopable."))
            else:
                reasons.append(pick("Classe della stella non nota: se non è KGBFOAM non puoi rifornirti.",
                                    "Star class unknown: if it isn't KGBFOAM you can't refuel."))
            if fuel.get("reservoir") is not None:
                reasons.append(pick(f"Riserva per i sistemi di bordo: {fuel['reservoir']:.2f} t.",
                                    f"Reservoir for ship systems: {fuel['reservoir']:.2f} t.").replace(".", ",", 1))
    elif fuel["low_flag"] or (cap and main < cap * 0.25):
        level = "low"
        reasons.append(pick(f"Carburante basso: {_fmt_t(main)} t su {_fmt_t(cap)}.", f"Fuel low: {_fmt_t(main)} t of {_fmt_t(cap)}."))
    return {"level": level, "reasons": reasons, "star": here, "need": None if need is None else round(need, 2)}


def _version_label():
    with _lock:
        gv, ody = _T["gameversion"] or "", _T["odyssey"]
    if gv.startswith("3."):
        return "Legacy (Horizons 3.8)"
    return "Odyssey" if ody else "Horizons (4.0)"


def rescue_info(model=None, fuel=None):
    model = model or fsd_model()
    fuel = fuel or fuel_now()
    with STATE.lock:
        cmdr = STATE.cmdr.get("name")
        loc = dict(STATE.location)
    ship = " ".join(x for x in (model.get("ship"), f'"{model["ship_name"]}"' if model.get("ship_name") else None) if x)
    where = loc.get("body") if loc.get("body") and loc.get("body") != loc.get("system") else None
    return {"cmdr": cmdr, "system": loc.get("system"), "platform": "PC", "version": _version_label(),
            "ship": ship or None, "near": where,
            "fuel": None if fuel["main"] is None else f"{fuel['main']:.2f} t",
            "reservoir": None if fuel.get("reservoir") is None else f"{fuel['reservoir']:.2f} t"}


def status():
    cfg = load_config()
    model = fsd_model()
    fuel = fuel_now()
    safety = route_safety(cfg, model, fuel)
    calc = FuelCalc(model, fuel["main"], _cargo_t())
    return {"config": cfg, "fuel": {**fuel, "cap": model.get("cap"), "reserve_cap": model.get("reserve_cap")},
            "star": current_star(), "ship": {k: model.get(k) for k in ("ship", "ship_name", "has_scoop", "fsd_name", "fsd_class",
                                                                     "jump_range", "source")},
            "range_now": calc.range_now(fuel["main"]), "safety": safety,
            "stranded": stranded_check(model, fuel, safety), "rescue": rescue_info(model, fuel)}


# --- Avvisi in diretta ----------------------------------------------------------------------

def _say(key, spoken, text, kind="bad", voice_key="voice"):
    cfg = load_config()
    with _lock:
        if key in _T["warned"]:
            return False
        _T["warned"].add(key)
    if cfg["feed"]:
        with STATE.lock:
            STATE.note(time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), text, kind)
    if cfg[voice_key] and voice.load_config().get("enabled"):
        voice.say(spoken)
    print(f"[Carburante] {text}")
    return True


def _live_check(event_fuel=None):
    cfg = load_config()
    model = fsd_model()
    fuel = fuel_now()
    if event_fuel is not None:
        fuel["main"] = event_fuel
    safety = route_safety(cfg, model, fuel)
    r = safety.get("ingame") or (safety.get("spansh") if (safety.get("spansh") or {}).get("known_stars") else None)
    here = current_star()
    sysname = here.get("system")
    if r and r.get("hops") and fuel["main"] is not None and r.get("fuel_total") is not None:
        margin = cfg["margin_pct"] / 100
        nxt = r.get("next_scoopable")
        hops = r["hops"]
        if nxt and fuel["main"] < nxt["fuel_needed"]:
            if here["scoopable"]:
                nj = nxt["jumps"]
                _say((sysname, "refuel_here"), pick(
                    f"Carburante basso: fai rifornimento qui prima di saltare. La prossima stella "
                    f"rifornibile, {nxt['system']}, è a {nxt['jumps']} salti.",
                    f"Fuel low: refuel here before jumping. The next scoopable star, {nxt['system']}, "
                    f"is {nj} {'jump' if nj == 1 else 'jumps'} away."),
                     pick(f"Carburante basso: rifornisciti qui. Prossima stella rifornibile: {nxt['system']} ({nxt['jumps']} salti)",
                          f"Fuel low: refuel here. Next scoopable star: {nxt['system']} ({nj} {'jump' if nj == 1 else 'jumps'})"))
            else:
                _say((sysname, "cannot_reach"), pick(
                    f"Attenzione: il carburante non basta per arrivare alla prossima stella "
                    f"rifornibile, {nxt['system']}. Cambia rotta verso una stella rifornibile più vicina.",
                    f"Warning: not enough fuel to reach the next scoopable star, {nxt['system']}. "
                    f"Reroute to a closer scoopable star."),
                     pick(f"Carburante insufficiente per {nxt['system']} (prossima stella rifornibile): cambia rotta",
                          f"Not enough fuel for {nxt['system']} (next scoopable star): reroute"))
        elif nxt:
            # Arrivi alla prossima rifornibile, ma non a quella dopo: fai il pieno lì.
            after = next((i for i in range(nxt["index"] + 1, len(hops)) if hops[i].get("scoopable")), None)
            need_after = sum(h["fuel_need"] for h in hops[:after + 1]) * (1 + margin) if after is not None else None
            if need_after and fuel["main"] < need_after:
                nj = nxt["jumps"]
                _say((sysname, "refuel_next"), pick(f"Carburante basso: fai rifornimento alla prossima stella, {nxt['system']}.",
                                                    f"Fuel low: refuel at the next star, {nxt['system']}."),
                     pick(f"Carburante basso: fai rifornimento alla prossima stella ({nxt['system']}, {nxt['jumps']} salti)",
                          f"Fuel low: refuel at the next star ({nxt['system']}, {nj} {'jump' if nj == 1 else 'jumps'})"), "gold")
    st = stranded_check(model, fuel, safety)
    if st["level"] == "stranded":
        _say((sysname, "stranded"), pick(
            "Sei a secco e qui non puoi rifornirti. Apri la scheda Fuel Rats: ti spiego come chiedere "
            "soccorso. Se vedi il timer dell'ossigeno, esci subito al menu principale.",
            "You're out of fuel and can't refuel here. Open the Fuel Rats tab: I'll explain how to call "
            "for rescue. If you see the oxygen timer, exit to the main menu right away."),
             pick("A secco: chiedi aiuto ai Fuel Rats (scheda Fuel Rats)", "Out of fuel: call the Fuel Rats (Fuel Rats tab)"),
             "bad", "rescue_voice")


def _on_event(e):
    _track(e)
    ev = e.get("event")
    if ev in ("FSDJump", "FuelScoop", "ReservoirReplenished", "NavRoute"):
        fuel = {"FSDJump": e.get("FuelLevel"), "FuelScoop": e.get("Total"),
                "ReservoirReplenished": e.get("FuelMain")}.get(ev)
        delay = 2.0 if ev == "NavRoute" else 0.5      # NavRoute.json viene scritto subito dopo l'evento
        threading.Timer(delay, _safe_check, args=(fuel,)).start()
    elif ev in ("RefuelAll", "RefuelPartial"):
        with _lock:
            _T["warned"] = {w for w in _T["warned"] if w[1] not in ("refuel_here", "stranded")}


def _safe_check(fuel=None):
    try:
        _live_check(fuel)
    except Exception as exc:
        print(f"[Carburante] {exc!r}")


def _status_loop():
    """Status.json non genera eventi: controllo leggero ogni 5 s per accorgersi di essere a secco."""
    last = None
    while True:
        time.sleep(5)
        try:
            st = stranded_check()
            if st["level"] != last:
                last = st["level"]
                if st["level"] == "stranded":
                    _safe_check()
                elif st["level"] is None:
                    with _lock:
                        _T["warned"] = {w for w in _T["warned"] if w[1] != "stranded"}
        except Exception as exc:
            print(f"[Carburante] {exc!r}")


def start():
    global _started
    with _lock:
        if _started:
            return
        _started = True
    deadline = time.time() + 90
    while not STATE.live and time.time() < deadline:
        time.sleep(1)
    _replay_latest_journal()
    journal.add_listener(_on_event)
    threading.Thread(target=_status_loop, name="fuel-status", daemon=True).start()


# API registrate dal server (stesse firme di server.GET / server.POST).
GET = {"/api/fuel": lambda q: status(),
       "/api/fuel/route_safety": lambda q: route_safety()}
POST = {"/api/fuel/config": lambda body, q: save_config(body)}
# Percorsi che il companion sul telefono può usare.
LAN = {"/api/fuel"}
