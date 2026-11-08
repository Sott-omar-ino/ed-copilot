"""Sessioni di combattimento: taglie, conflict zone, guadagni all'ora e dove riscuotere.

Tutto viene ricostruito dai journal (stessa cartella letta da app/journal.py, solo lettura). Di ogni file si tengono
solo gli eventi utili, in cache per nome + dimensione + data di modifica: si rilegge solo il journal che sta crescendo.
Lo stack delle missioni massacro resta in app/combat.py (scheda Missioni): qui non viene toccato.

Fonti dei campi del journal (manuale ufficiale Frontier, trascritto in tipi da kayahr/ed-journal,
https://kayahr.github.io/ed-journal/ , pagine interfaces/<Evento>.html):
  - Bounty: Rewards [{Faction, Reward}], TotalReward, VictimFaction, Target/Target_Localised, SharedWithOthers;
    per gli skimmer invece Faction + Reward.
  - FactionKillBond e CapShipBond: Reward, AwardingFaction, VictimFaction.
  - RedeemVoucher: Type, Amount, Faction oppure Factions [{Faction, Amount}], BrokerPercentage (opzionale).
  - PayBounties / PayFines: Amount, Faction, BrokerPercentage (opzionale). Died: KillerName, KillerShip, KillerRank.
  - PVPKill: Victim, CombatRank. Interdiction: Success, Interdicted, IsPlayer. Interdicted: Submitted, Interdictor.
  - FSSSignalDiscovered: SignalName, SignalName_Localised, SignalType ("può mancare nei journal vecchi"), SystemAddress.
Verificati anche sul journal reale dell'utente: Bounty con Rewards/TotalReward/VictimFaction/SharedWithOthers;
RedeemVoucher via Interstellar Factors con "Factions":[{"Faction":"", ...}] e "BrokerPercentage":25.0 (luglio 2026);
segnali con SignalType "ResourceExtraction" ($MULTIPLAYER_SCENARIO14/77/78/79_TITLE; = Resource Extraction Site
[-/Low/High/Hazardous]) e "Combat" ($Warzone_PointRace_Low/Med/High:#index=N; = Conflict Zone, e
$Warzone_Powerplay_...; = Power Conflict Zone).

Regole di gioco usate (fonti della comunità):
  - i voucher non riscossi si perdono se la nave viene distrutta: wiki Elite Dangerous, pagine "Bounty Voucher" e
    "Bounty Hunter" (https://elite-dangerous.fandom.com/wiki/Bounty_Voucher).
  - le taglie si riscuotono nelle stazioni controllate dalla fazione che le ha emesse (stessa pagina "Bounty Voucher");
    all'Interstellar Factors si riscuotono taglie e combat bond di qualunque fazione pagando una commissione
    (https://newp.io/crimes, sezione Interstellar Factors). La percentuale NON è scritta qui: si mostra quella che il
    gioco ha registrato nel journal (BrokerPercentage dell'ultimo RedeemVoucher/PayFines/PayBounties).
  - l'importo pagato alla riscossione può differire dalla somma degli eventi Bounty (discussione sul forum Frontier
    "Bounty event rewards don't match RedeemVoucher in journal files", thread 580165; visto anche nel journal
    dell'utente): i totali qui sono quelli degli eventi Bounty/Bond, non una previsione dell'incasso.
Il journal non dice quali voucher vengono riscossi uno per uno: un RedeemVoucher azzera i voucher (di quel tipo)
delle fazioni elencate; se la fazione è vuota (riscossione tramite broker) azzera tutti quelli di quel tipo.
"""

import calendar
import json
import os
import re
import threading
import time

from . import journal, paths, storage, voice
from .gamedata import SHIP_NAMES
from .journal import STATE
from .lang import pick

CACHE_FILE = paths.cache_file("bounty.json")
CONFIG_FILE = paths.user_file("combat_config.json")
VERSION = 1
# Valore di partenza SCELTO A CASO (non una regola del gioco): l'utente lo cambia nella scheda.
DEFAULT_CONFIG = {"warn_cr": 10_000_000, "warn_feed": True, "warn_voice": False}
# Scelta dell'interfaccia (stima): fra due uccisioni con più di 15 minuti di pausa il tempo non conta per CR/ora.
IDLE = 900
HISTORY_MAX = 40

WANTED = {"LoadGame", "Shutdown", "Location", "FSDJump", "CarrierJump", "Bounty", "FactionKillBond", "CapShipBond",
          "RedeemVoucher", "Died", "PVPKill", "Interdicted", "Interdiction", "EscapeInterdiction", "PayBounties",
          "PayFines", "FSSSignalDiscovered", "ShipTargeted"}
HEAD = re.compile(r'"event"\s*:\s*"([^"]+)"')
RES_NAMES = re.compile(r"^\$MULTIPLAYER_SCENARIO(14|77|78|79)_TITLE;$")
CZ_NAMES = re.compile(r"^\$Warzone_")

LOCK = threading.Lock()
FILES = None          # nome file -> {"sig": [dimensione, mtime], "events": [...]}
_LAST = {"t": 0, "data": None}
_WARN = {"over": False}


def _n(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) else 0


def _faction(name, localised=None):
    """'$faction_Empire;' -> 'Empire' (fazioni delle superpotenze); i nomi delle minor faction restano uguali."""
    if localised:
        return localised
    name = name or ""
    if name.startswith("$faction_") and name.endswith(";"):
        return name[9:-1]
    return name


def _epoch(ts):
    try:
        return calendar.timegm(time.strptime(ts[:19], "%Y-%m-%dT%H:%M:%S"))
    except (TypeError, ValueError):
        return None


def _compact(e):
    """Solo i campi che servono: la cache resta piccola."""
    ev = e.get("event")
    if ev == "ShipTargeted" and "Bounty" not in e:
        return None
    if ev == "FSSSignalDiscovered":
        name, typ = e.get("SignalName") or "", e.get("SignalType")
        if not (typ in ("ResourceExtraction", "Combat") or RES_NAMES.match(name) or CZ_NAMES.match(name)):
            return None
    keep = ("timestamp", "event", "Rewards", "TotalReward", "Reward", "Faction", "Faction_Localised", "VictimFaction",
            "VictimFaction_Localised", "Target", "Target_Localised", "SharedWithOthers", "AwardingFaction",
            "AwardingFaction_Localised", "Type", "Amount", "Factions", "BrokerPercentage", "KillerName",
            "KillerName_Localised", "KillerShip", "Victim", "Success", "Submitted", "Interdictor", "IsPlayer",
            "StarSystem", "SystemAddress", "SignalName", "SignalName_Localised", "SignalType", "Ship", "Ship_Localised",
            "PilotName_Localised", "PilotRank", "LegalStatus", "Bounty", "Commander", "Docked", "StationName",
            "ThreatLevel")
    return {k: e[k] for k in keep if k in e}


def _read_file(path):
    events = []
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            m = HEAD.search(line, 0, 200)
            if not m or m.group(1) not in WANTED:
                continue
            try:
                c = _compact(json.loads(line))
            except ValueError:
                continue
            if c:
                events.append(c)
    return events


def _load_files():
    global FILES
    if FILES is None:
        data = storage.load_json(CACHE_FILE, {}) or {}
        FILES = data.get("files", {}) if data.get("version") == VERSION else {}
    changed = False
    seen = []
    for path in journal.journal_files():
        name = os.path.basename(path)
        try:
            st = os.stat(path)
        except OSError:
            continue
        sig = [st.st_size, int(st.st_mtime)]
        seen.append(name)
        cur = FILES.get(name)
        if cur and cur.get("sig") == sig:
            continue
        try:
            FILES[name] = {"sig": sig, "events": _read_file(path)}
            changed = True
        except OSError:
            pass
    for name in list(FILES):
        if name not in seen:
            del FILES[name]
            changed = True
    if changed:
        storage.save_json(CACHE_FILE, {"version": VERSION, "files": FILES})
    return [FILES[n] for n in seen if n in FILES]


def _session(ts, commander=None):
    return {"start": ts, "end": ts, "commander": commander, "kills": 0, "bounties": 0, "bonds": 0, "capship": 0,
            "bond_kills": 0, "pvp": 0, "deaths": 0, "lost": 0, "redeemed": 0, "fines": 0, "interdicted": 0,
            "interdictions": 0, "escaped": 0, "active": 0, "first_kill": None, "last_kill": None,
            "factions": {}, "victims": {}, "targets": {}, "systems": [], "ended": False}


def _fold(files):
    vouchers = {"bounty": {}, "bond": {}}
    sessions, cur = [], None
    broker = None
    system = {"name": None, "address": None, "signals": {}}
    last_scan = None
    commander = None

    def sess(ts):
        nonlocal cur
        if cur is None or cur["ended"]:
            cur = _session(ts, commander)
            sessions.append(cur)
        return cur

    def kill(s, ts, sysname):
        t = _epoch(ts)
        if s["last_kill"] is not None and t is not None:
            gap = t - s["last_kill"]
            if 0 <= gap <= IDLE:
                s["active"] += gap
        if t is not None:
            s["last_kill"] = t
            s["first_kill"] = s["first_kill"] or t
        if sysname and sysname not in s["systems"]:
            s["systems"].append(sysname)

    for f in files:
        for e in f["events"]:
            ev, ts = e["event"], e.get("timestamp")
            if ev == "LoadGame":
                commander = e.get("Commander") or commander
                if cur is not None:
                    cur["ended"] = True
                cur = _session(ts, commander)
                sessions.append(cur)
                continue
            if ev == "Shutdown":
                if cur is not None:
                    cur["end"] = ts
                    cur["ended"] = True
                continue
            s = sess(ts)
            s["end"] = ts
            if ev in ("Location", "FSDJump", "CarrierJump"):
                addr = e.get("SystemAddress")
                if addr != system["address"]:
                    system = {"name": e.get("StarSystem"), "address": addr, "signals": {}}
                system["name"] = e.get("StarSystem") or system["name"]
            elif ev == "FSSSignalDiscovered":
                if e.get("SystemAddress") == system["address"]:
                    name = e.get("SignalName") or ""
                    label = e.get("SignalName_Localised") or name
                    kind = "res" if (e.get("SignalType") == "ResourceExtraction" or RES_NAMES.match(name)) else "cz"
                    sig = system["signals"].setdefault(label, {"label": label, "kind": kind, "count": 0, "names": []})
                    if name not in sig["names"]:
                        sig["names"].append(name)
                        sig["count"] += 1
            elif ev == "Bounty":
                total = _n(e.get("TotalReward")) or _n(e.get("Reward"))
                rewards = e.get("Rewards")
                if not isinstance(rewards, list):
                    rewards = [{"Faction": e.get("Faction"), "Faction_Localised": e.get("Faction_Localised"),
                                "Reward": e.get("Reward")}]
                for r in rewards:
                    fac = _faction(r.get("Faction"), r.get("Faction_Localised")) or "?"
                    amount = _n(r.get("Reward"))
                    vouchers["bounty"][fac] = vouchers["bounty"].get(fac, 0) + amount
                    s["factions"][fac] = s["factions"].get(fac, 0) + amount
                s["kills"] += 1
                s["bounties"] += total
                victim = _faction(e.get("VictimFaction"), e.get("VictimFaction_Localised"))
                if victim:
                    s["victims"][victim] = s["victims"].get(victim, 0) + 1
                target = e.get("Target_Localised") or SHIP_NAMES.get(str(e.get("Target") or "").lower()) or e.get("Target")
                if target:
                    s["targets"][target] = s["targets"].get(target, 0) + 1
                kill(s, ts, system["name"])
            elif ev in ("FactionKillBond", "CapShipBond"):
                fac = _faction(e.get("AwardingFaction"), e.get("AwardingFaction_Localised")) or "?"
                amount = _n(e.get("Reward"))
                vouchers["bond"][fac] = vouchers["bond"].get(fac, 0) + amount
                s["factions"][fac] = s["factions"].get(fac, 0) + amount
                s["bonds"] += amount
                s["bond_kills"] += 1
                if ev == "CapShipBond":
                    s["capship"] += 1
                victim = _faction(e.get("VictimFaction"), e.get("VictimFaction_Localised"))
                if victim:
                    s["victims"][victim] = s["victims"].get(victim, 0) + 1
                kill(s, ts, system["name"])
            elif ev == "RedeemVoucher":
                typ = str(e.get("Type") or "").lower()
                key = "bounty" if typ == "bounty" else "bond" if typ == "combatbond" else None
                if key is None:
                    continue
                facs = [x.get("Faction") for x in e["Factions"]] if isinstance(e.get("Factions"), list) else [e.get("Faction")]
                facs = [_faction(x) for x in facs]
                if not facs or any(not x for x in facs):
                    vouchers[key].clear()           # broker: fazione vuota
                else:
                    for x in facs:
                        vouchers[key].pop(x, None)
                s["redeemed"] += _n(e.get("Amount"))
                if "BrokerPercentage" in e:
                    broker = {"pct": _n(e["BrokerPercentage"]), "ts": ts}
            elif ev in ("PayBounties", "PayFines"):
                s["fines"] += _n(e.get("Amount"))
                if "BrokerPercentage" in e:
                    broker = {"pct": _n(e["BrokerPercentage"]), "ts": ts}
            elif ev == "Died":
                lost = sum(vouchers["bounty"].values()) + sum(vouchers["bond"].values())
                s["deaths"] += 1
                s["lost"] += lost
                vouchers = {"bounty": {}, "bond": {}}
            elif ev == "PVPKill":
                s["pvp"] += 1
            elif ev == "Interdicted":
                s["interdicted"] += 1
            elif ev == "EscapeInterdiction":
                s["escaped"] += 1
            elif ev == "Interdiction":
                if e.get("Success"):
                    s["interdictions"] += 1
            elif ev == "ShipTargeted":
                last_scan = {"ts": ts, "ship": e.get("Ship_Localised") or SHIP_NAMES.get(str(e.get("Ship") or "").lower())
                             or e.get("Ship"),
                             "pilot": e.get("PilotName_Localised"), "rank": e.get("PilotRank"),
                             "faction": _faction(e.get("Faction")), "legal": e.get("LegalStatus"),
                             "bounty": _n(e.get("Bounty"))}
    return vouchers, sessions, broker, system, last_scan


def _out_session(s):
    earned = s["bounties"] + s["bonds"]
    hours = s["active"] / 3600
    top = sorted(s["factions"].items(), key=lambda x: -x[1])[:6]
    return {"start": s["start"], "end": s["end"], "kills": s["kills"], "bond_kills": s["bond_kills"],
            "capship": s["capship"], "bounties": s["bounties"], "bonds": s["bonds"], "earned": earned,
            "pvp": s["pvp"], "deaths": s["deaths"], "lost": s["lost"], "redeemed": s["redeemed"], "fines": s["fines"],
            "interdicted": s["interdicted"], "interdictions": s["interdictions"], "escaped": s["escaped"],
            "active": round(s["active"]), "systems": s["systems"][:6],
            # Stime: solo il tempo fra un'uccisione e la successiva (pause > IDLE escluse); servono almeno 2 uccisioni.
            "cr_hour": round(earned / hours) if hours >= 1 / 60 else None,
            "kills_hour": round((s["kills"] + s["bond_kills"]) / hours, 1) if hours >= 1 / 60 else None,
            "top_factions": [{"faction": f, "amount": a} for f, a in top],
            "victims": sorted(({"faction": f, "kills": k} for f, k in s["victims"].items()), key=lambda x: -x["kills"])[:6],
            "targets": sorted(({"ship": t, "kills": k} for t, k in s["targets"].items()), key=lambda x: -x["kills"])[:8],
            "ended": s["ended"]}


def load_config():
    cfg = {**DEFAULT_CONFIG, **(storage.load_json(CONFIG_FILE, {}) or {})}
    try:
        cfg["warn_cr"] = max(0, int(cfg["warn_cr"]))
    except (TypeError, ValueError):
        cfg["warn_cr"] = DEFAULT_CONFIG["warn_cr"]
    cfg["warn_feed"], cfg["warn_voice"] = bool(cfg["warn_feed"]), bool(cfg["warn_voice"])
    return cfg


def save_config(body):
    cfg = load_config()
    body = body or {}
    if "warn_cr" in body:
        try:
            cfg["warn_cr"] = max(0, min(10**12, int(float(body["warn_cr"]))))
        except (TypeError, ValueError):
            raise ValueError(pick("Soglia non valida", "Invalid threshold"))
    for k in ("warn_feed", "warn_voice"):
        if k in body:
            cfg[k] = bool(body[k])
    storage.save_json(CONFIG_FILE, cfg)
    _LAST["t"] = 0
    return overview()


def overview(force=False):
    with LOCK:
        if not force and _LAST["data"] is not None and time.time() - _LAST["t"] < 2:
            return _LAST["data"]
        vouchers, sessions, broker, system, last_scan = _fold(_load_files())
    cfg = load_config()
    combat = [s for s in sessions if s["kills"] or s["bond_kills"] or s["pvp"] or s["lost"] or s["redeemed"]]
    current = sessions[-1] if sessions else None
    rows = []
    for key in ("bounty", "bond"):
        for fac, amount in vouchers[key].items():
            if amount > 0:
                rows.append({"type": key, "faction": fac, "amount": amount})
    rows.sort(key=lambda r: -r["amount"])
    total = sum(r["amount"] for r in rows)
    here = STATE.location.get("system")
    signals = sorted(system["signals"].values(), key=lambda x: (x["kind"], x["label"])) \
        if system["name"] and (not here or here == system["name"]) else []
    data = {
        "current": _out_session(current) if current else None,
        "history": [_out_session(s) for s in reversed(combat[-HISTORY_MAX:])],
        "vouchers": rows, "total": total,
        "bounty_total": sum(r["amount"] for r in rows if r["type"] == "bounty"),
        "bond_total": sum(r["amount"] for r in rows if r["type"] == "bond"),
        "warn": bool(cfg["warn_cr"]) and total >= cfg["warn_cr"],
        "broker": broker, "config": cfg,
        "system": {"name": system["name"], "signals": [{k: v for k, v in x.items() if k != "names"} for x in signals]},
        "last_scan": last_scan,
    }
    with LOCK:
        _LAST.update(t=time.time(), data=data)
    return data


def _fmt(n):
    return f"{int(n):,}".replace(",", ".")


def _check_warn():
    try:
        d = overview(force=True)
    except Exception as exc:
        print(f"[Combattimento] {exc!r}")
        return
    cfg = d["config"]
    if not d["warn"]:
        _WARN["over"] = False
        return
    if _WARN["over"]:
        return
    _WARN["over"] = True
    text = pick(f"Combattimento: {_fmt(d['total'])} CR di voucher non riscossi (soglia {_fmt(cfg['warn_cr'])}). "
                "Si perdono se la nave viene distrutta: valuta di riscuoterli.",
                f"Combat: {_fmt(d['total'])} CR of unredeemed vouchers (threshold {_fmt(cfg['warn_cr'])}). "
                "They are lost if your ship is destroyed: consider cashing them in.")
    if cfg["warn_feed"]:
        ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        with STATE.lock:
            STATE.note(ts, text, "bad")
    if cfg["warn_voice"] and voice.load_config().get("enabled"):
        voice.say(pick(f"Attenzione: hai {_fmt(d['total'])} crediti di voucher non riscossi. Valuta di riscuoterli.",
                       f"Warning: you have {int(d['total']):,} credits in unredeemed vouchers. Consider cashing them in."))


def _on_event(e):
    if e.get("event") in ("Bounty", "FactionKillBond", "CapShipBond", "RedeemVoucher", "Died"):
        threading.Thread(target=_check_warn, daemon=True).start()   # il listener deve restare veloce


def start():
    # Prima lettura in background (crea la cache); lo stato dell'avviso parte da quello attuale, senza annunciarlo.
    try:
        _WARN["over"] = overview(force=True)["warn"]
    except Exception as exc:
        print(f"[Combattimento] {exc!r}")


journal.add_listener(_on_event)

GET = {"/api/combat/session": lambda q: overview()}
POST = {"/api/combat/config": lambda body, q: save_config(body)}
LAN = set()
