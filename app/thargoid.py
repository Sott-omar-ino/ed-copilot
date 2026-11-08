"""Thargoid & AX: stato della guerra, uccisioni e combat bond AX dai journal, moduli AX della flotta.

STATO DELLA GUERRA (verificato l'8/11/2026)
- La Seconda guerra Thargoid è finita il 18 dicembre 3310 (2024) con la distruzione dell'ultimo Titan, Cocijo,
  nel sistema Sol. Fonte: GalNet ufficiale "Titan Cocijo Destroyed, Sol Liberated" (18 DEC 3310) e
  "One Year Since Humanity's Victory in Xeno War" (18 DEC 3311), dal feed GalNet di Frontier
  (https://cms.zaonce.net/en-GB/jsonapi/node/galnet_article). Fino al 05 NOV 3312 (ultimo articolo letto)
  il GalNet non riporta nuove offensive Thargoid. "HIP 22460 Declared Free of Thargoids" (16 JAN 3311).
- Nessuna fonte pubblica e documentata dello stato "live": DCoH Overwatch (dcoh.watch) è stato dismesso
  ("is no longer running and no new data is being collected", https://dcoh.watch/consumer-api; archivio in
  https://github.com/DarkSession/EDOverwatch.Archive). Quindi niente sistemi in guerra "live" in questa scheda.
- Dove si trovano ancora i Thargoid (wiki della Anti-Xeno Initiative, https://wiki.antixenoinitiative.com/en/finding-thargoids,
  dati di febbraio 2025): Non-Human Signal Source nelle nebulose Pleiadi (Asterope, Sterope II, Merope),
  Coalsack (Musca Dark Region HM-V c2-17) e Witch Head; AX Conflict Zone note solo nella California Nebula
  (California Sector BA-A e6, HR-W d1-28, JH-V c2-12, intorno a HIP 18390). Nomi dei sistemi controllati su EDSM.

JOURNAL
- FactionKillBond: {"Reward", "AwardingFaction":"$faction_PilotsFederation;", "VictimFaction":"$faction_Thargoid;"}
  (esempio reale nei test di EDDI, EDCD/EDDI Tests/JournalMonitorTests.cs; schema in jixxed/ed-journal-schemas).
  EDDiscovery segnala di aver visto sia "Thargoid" sia "$faction_Thargoid;": confronto senza maiuscole su "thargoid".
- RedeemVoucher: {"Type":"CombatBond", "Faction":"PilotsFederation", "Amount" (netto), "BrokerPercentage"} (schema
  jixxed/ed-journal-schemas). I voucher non riscossi si perdono se la nave viene distrutta (Elite Dangerous Wiki,
  "Bounty Voucher"): i bond in attesa ripartono da zero a ogni Died. È comunque una STIMA.
- FSSSignalDiscovered: AX Conflict Zone = SignalName "$Warzone_TG_Low/Med/High/VeryHigh..." (EDCD/EDDI
  DataDefinitions/SignalSource.cs; esempio reale "$Warzone_TG_Low:#index=2;" nei test di EDDiscovery);
  Non-Human Signal Source = USSType "$USS_Type_NonHuman;" (EDDI SignalSource.cs, schema jixxed).

TIPO DI THARGOID DAL VALORE DEL BOND (il journal non dice quale nave hai distrutto)
- Ufficiali, note di aggiornamento Frontier 18.06 (28 maggio 2024, https://www.elitedangerous.com/update-notes/4-0-18-06):
  Cyclops 6.500.000 -> 8.000.000, Basilisk 20.000.000 -> 24.000.000, Medusa 34.000.000 -> 40.000.000,
  Hydra 50.000.000 -> 60.000.000, Orthrus 40.000.000 -> 15.000.000. Prima del 28/05/2024 40M = Orthrus, dopo = Medusa.
- Dalla Elite Dangerous Wiki (pagina "Bonds", non confermati da Frontier, segnati "wiki" nell'interfaccia):
  Thargoid Scout 80.000 (anche 75.000 e 65.000), Thargoid Hunter (Glaive/Scythe) 4.500.000, Banshee 1.000.000,
  Revenant 25.000. Ogni altro valore resta "non identificato" con il suo importo.
"""

import json
import os
import re
import threading
import time

from . import journal
from .journal import STATE
from .lang import pick, pick_d

UPDATE_1806 = "2024-05-28"  # data delle note 18.06 (confronto fra stringhe ISO del journal)

# (reward, tipo, classe, fonte) — fonte "frontier" = note ufficiali 18.06, "wiki" = Elite Dangerous Wiki "Bonds".
BONDS_AFTER = {
    8_000_000: ("Cyclops", "Interceptor", "frontier"), 24_000_000: ("Basilisk", "Interceptor", "frontier"),
    40_000_000: ("Medusa", "Interceptor", "frontier"), 60_000_000: ("Hydra", "Interceptor", "frontier"),
    15_000_000: ("Orthrus", "Interceptor", "frontier"),
}
BONDS_BEFORE = {
    6_500_000: ("Cyclops", "Interceptor", "frontier"), 20_000_000: ("Basilisk", "Interceptor", "frontier"),
    34_000_000: ("Medusa", "Interceptor", "frontier"), 50_000_000: ("Hydra", "Interceptor", "frontier"),
    40_000_000: ("Orthrus", "Interceptor", "frontier"),
}
BONDS_WIKI = {
    80_000: ("Scout", "Scout", "wiki"), 75_000: ("Scout", "Scout", "wiki"), 65_000: ("Scout", "Scout", "wiki"),
    4_500_000: ("Hunter", "Hunter (Glaive/Scythe)", "wiki"), 1_000_000: ("Banshee", "Banshee", "wiki"),
    25_000: ("Revenant", "Revenant", "wiki"),
}
TYPE_ORDER = ["Hydra", "Medusa", "Basilisk", "Orthrus", "Cyclops", "Hunter", "Banshee", "Scout", "Revenant", "?"]


def classify(reward, ts=""):
    table = BONDS_AFTER if (ts or "9") >= UPDATE_1806 else BONDS_BEFORE
    hit = table.get(reward) or BONDS_WIKI.get(reward)
    if hit:
        return {"type": hit[0], "class": hit[1], "source": hit[2]}
    return {"type": "?", "class": pick("Non identificato", "Unidentified"), "source": None}


# Moduli AX: simboli da EDCD/FDevIDs outfitting.csv (aggiornato il 20/10/2026), confrontati in minuscolo come
# nei Loadout. L'ordine conta (le varianti _v2 / Gimbal prima delle versioni base). Note: solo a cosa servono,
# dalla Elite Dangerous Wiki (pagine dei singoli moduli); nessun valore di danno. Note {"it", "en"}: pick_d() all'uso.
AX_MODULES = [
    (r"hpt_atmulticannon_(gimbal_|.*_v2$)", "Enhanced AX Multi-Cannon", "weapon",
     {"it": "Variante migliorata dell'AX Multi-Cannon: un po' più di danno e proiettili molto più veloci.",
      "en": "Improved AX Multi-Cannon: a bit more damage and much faster projectiles."}),
    (r"hpt_atmulticannon_", "AX Multi-Cannon", "weapon",
     {"it": "Multi-cannon anti-xeno: danneggia gli Interceptor insieme agli AX Missile Rack, che espongono i Thargoid "
            "Hearts. Contro le navi umane rende meno di un Multi-Cannon normale.",
      "en": "Anti-xeno multi-cannon: damages Interceptors together with AX Missile Racks, which expose the Thargoid "
            "Hearts. Against human ships it does less than a normal Multi-Cannon."}),
    (r"hpt_atdumbfiremissile_.*_v2$", "Enhanced AX Missile Rack", "weapon",
     {"it": "Variante migliorata dell'AX Missile Rack: un po' più di danno e missili molto più veloci.",
      "en": "Improved AX Missile Rack: a bit more damage and much faster missiles."}),
    (r"hpt_atdumbfiremissile_", "AX Missile Rack", "weapon",
     {"it": "Missili dumbfire anti-xeno: superano la resistenza degli Interceptor alle armi normali ed espongono i "
            "Thargoid Hearts. Non si possono ingegnerizzare.",
      "en": "Anti-xeno dumbfire missiles: they bypass Interceptors' resistance to normal weapons and expose the "
            "Thargoid Hearts. Cannot be engineered."}),
    (r"hpt_guardian_gausscannon_", "Guardian Gauss Cannon", "weapon",
     {"it": "Arma Guardian (si sblocca al Guardian Technology Broker): efficace contro i Thargoid e valida anche contro "
            "le navi umane.",
      "en": "Guardian weapon (unlocked at the Guardian Technology Broker): effective against Thargoids and also good "
            "against human ships."}),
    (r"hpt_guardian_plasmalauncher_", "Guardian Plasma Charger", "weapon",
     {"it": "Arma Guardian al plasma (Technology Broker): più efficace delle armi umane contro Interceptor e Scout.",
      "en": "Guardian plasma weapon (Technology Broker): more effective than human weapons against Interceptors and "
            "Scouts."}),
    (r"hpt_guardian_shardcannon_", "Guardian Shard Cannon", "weapon",
     {"it": "Arma Guardian a frammenti, simile al Fragment Cannon (Technology Broker).",
      "en": "Guardian shard weapon, similar to the Fragment Cannon (Technology Broker)."}),
    (r"hpt_atventdisruptorpylon_", "Guardian Nanite Torpedo Pylon", "weapon",
     {"it": "Torpedini per le bocchette termiche dei Titan: inefficaci contro altri bersagli. Senza Titan oggi non "
            "hanno bersagli.",
      "en": "Torpedoes for Titan heat vents: useless against other targets. With no Titans left, they have no "
            "targets today."}),
    (r"hpt_flakmortar_", "Remote Release Flak Launcher", "weapon",
     {"it": "Contromisura contro gli sciami di Thargon lanciati dagli Interceptor; inefficace contro altri bersagli.",
      "en": "Countermeasure against Thargon swarms launched by Interceptors; useless against other targets."}),
    (r"hpt_xenoscanner_advanced_", "Pulse Wave Xeno Scanner", "utility",
     {"it": "Xeno Scanner con le funzioni per i Titan; fa anche tutto ciò che fa l'AX Xeno Scanner.",
      "en": "Xeno Scanner with the Titan functions; it also does everything the AX Xeno Scanner does."}),
    (r"hpt_xenoscannermk2_", "Enhanced Xeno Scanner", "utility",
     {"it": "Xeno Scanner con portata di 2 km invece di 500 m.",
      "en": "Xeno Scanner with a 2 km range instead of 500 m."}),
    (r"hpt_xenoscanner_basic_", "Xeno Scanner", "utility",
     {"it": "Scansiona e identifica Interceptor e Scout: è l'unico modo per evidenziare i Thargoid Hearts e mirarli "
            "(500 m).",
      "en": "Scans and identifies Interceptors and Scouts: the only way to highlight the Thargoid Hearts and target "
            "them (500 m)."}),
    (r"hpt_antiunknownshutdown_tiny_v2", "Thargoid Pulse Neutraliser", "utility",
     {"it": "Variante del Shutdown Field Neutraliser contro l'onda d'urto dei Maelstrom (che oggi non ci sono più).",
      "en": "Shutdown Field Neutraliser variant against the Maelstrom shockwave (Maelstroms are gone today)."}),
    (r"hpt_antiunknownshutdown_", "Shutdown Field Neutraliser", "utility",
     {"it": "Se attivato in tempo protegge dal campo di spegnimento (shutdown field) degli Interceptor, entro 3 km.",
      "en": "If activated in time, protects against the Interceptors' shutdown field, within 3 km."}),
    (r"hpt_causticsinklauncher_", "Caustic Sink Launcher", "utility",
     {"it": "Toglie il danno caustico in corso e ne assorbe altro finché il sink non è pieno.",
      "en": "Removes ongoing caustic damage and absorbs more until the sink is full."}),
    (r"int_dronecontrol_decontamination_", "Decontamination Limpet Controller", "internal",
     {"it": "Limpet che tolgono la sostanza caustica lasciata dai missili Thargoid e riparano un po' lo scafo.",
      "en": "Limpets that remove the caustic substance left by Thargoid missiles and repair some hull."}),
    (r"int_multidronecontrol_xeno_", "Xeno Multi Limpet Controller", "internal",
     {"it": "Limpet decontaminazione, riparazione e ricerca in un solo modulo (solo classe 3, più pesante).",
      "en": "Decontamination, repair and research limpets in a single module (class 3 only, heavier)."}),
    (r"int_metaalloyhullreinforcement_", "Meta Alloy Hull Reinforcement", "internal",
     {"it": "Hull reinforcement con resistenza al danno caustico (niente resistenze kinetic/thermal/explosive).",
      "en": "Hull reinforcement with caustic resistance (no kinetic/thermal/explosive resistances)."}),
    (r"int_guardianhullreinforcement_", "Guardian Hull Reinforcement", "internal",
     {"it": "Hull reinforcement Guardian: resistenza al danno thermal e caustico.",
      "en": "Guardian hull reinforcement: thermal and caustic resistance."}),
    (r"int_guardianmodulereinforcement_", "Guardian Module Reinforcement", "internal",
     {"it": "Riduce il danno ai moduli e protegge da HUD disturbato e riavvii forzati dei fulmini degli Interceptor.",
      "en": "Reduces module damage and protects against HUD disruption and forced reboots from Interceptor "
            "lightning."}),
]
_AX_RX = [(re.compile(p), n, k, note) for p, n, k, note in AX_MODULES]
CAUSTIC = {"Caustic Sink Launcher", "Decontamination Limpet Controller", "Xeno Multi Limpet Controller",
           "Meta Alloy Hull Reinforcement", "Guardian Hull Reinforcement"}
SCANNERS = {"Xeno Scanner", "Enhanced Xeno Scanner", "Pulse Wave Xeno Scanner"}
AX_WEAPONS = {"AX Multi-Cannon", "Enhanced AX Multi-Cannon", "AX Missile Rack", "Enhanced AX Missile Rack",
              "Guardian Gauss Cannon", "Guardian Plasma Charger", "Guardian Shard Cannon"}

# Dove si trovano ancora i Thargoid: wiki della Anti-Xeno Initiative, "Finding Thargoids" (dati febbraio 2025).
PLACES = [
    ("California Sector BA-A e6", "AX Conflict Zone",
     {"it": "Una High e una Medium vicino al corpo 4 (consigliata la High).",
      "en": "One High and one Medium near body 4 (the High is recommended)."}),
    ("California Sector HR-W d1-28", "AX Conflict Zone",
     {"it": "Due High e una Medium vicino al corpo 3 (una High non funzionava).",
      "en": "Two High and one Medium near body 3 (one High was not working)."}),
    ("California Sector JH-V c2-12", "AX Conflict Zone",
     {"it": "Una Medium vicino al corpo 6 (~45 Ls), consigliata.", "en": "One Medium near body 6 (~45 Ls), recommended."}),
    ("Asterope", "Non-Human Signal Source", {"it": "Pleiadi: NHSS frequenti.", "en": "Pleiades: frequent NHSS."}),
    ("Sterope II", "Non-Human Signal Source",
     {"it": "Pleiadi: consigliato per cacciare Hydra.", "en": "Pleiades: recommended for hunting Hydras."}),
    ("Merope", "Non-Human Signal Source", {"it": "Pleiadi: NHSS frequenti.", "en": "Pleiades: frequent NHSS."}),
    ("Musca Dark Region HM-V c2-17", "Non-Human Signal Source",
     {"it": "Coalsack: NHSS di minaccia alta, comodo con un Fleet Carrier.",
      "en": "Coalsack: high-threat NHSS, handy with a Fleet Carrier."}),
]

WANTED = ("FactionKillBond", "RedeemVoucher", "Died", "LoadGame", "FSDJump", "Location", "CarrierJump",
          "FSSSignalDiscovered")
_HEAD = re.compile(r'"event"\s*:\s*"(\w+)"')
_FILES = {}           # nome file -> {"sig": [size, mtime], "events": [...]}
_LOCK = threading.Lock()
_COORDS = {}


def _compact(e):
    ev = e.get("event")
    if ev == "FactionKillBond":
        if "thargoid" not in str(e.get("VictimFaction") or "").lower():
            return None
        return {"event": ev, "timestamp": e.get("timestamp"), "Reward": e.get("Reward") or 0,
                "AwardingFaction": e.get("AwardingFaction")}
    if ev == "RedeemVoucher":
        if e.get("Type") != "CombatBond" or "pilotsfederation" not in str(e.get("Faction") or "").lower().replace(" ", "").replace("'", ""):
            return None
        return {"event": ev, "timestamp": e.get("timestamp"), "Amount": e.get("Amount") or 0,
                "BrokerPercentage": e.get("BrokerPercentage")}
    if ev == "FSSSignalDiscovered":
        name, uss = str(e.get("SignalName") or ""), str(e.get("USSType") or "")
        if "warzone_tg" not in name.lower() and uss != "$USS_Type_NonHuman;":
            return None
        return {"event": ev, "timestamp": e.get("timestamp"), "SystemAddress": e.get("SystemAddress"),
                "SignalName": name, "USSType": uss}
    keep = ("event", "timestamp", "StarSystem", "SystemAddress", "Commander")
    return {k: e[k] for k in keep if k in e}


def _read(path):
    out = []
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            m = _HEAD.search(line, 0, 120)
            if not m or m.group(1) not in WANTED:
                continue
            try:
                c = _compact(json.loads(line))
            except ValueError:
                continue
            if c:
                out.append(c)
    return out


def _events():
    seen = []
    with _LOCK:
        for path in journal.journal_files():
            name = os.path.basename(path)
            try:
                st = os.stat(path)
            except OSError:
                continue
            sig = [st.st_size, int(st.st_mtime)]
            seen.append(name)
            cur = _FILES.get(name)
            if not cur or cur["sig"] != sig:
                try:
                    _FILES[name] = {"sig": sig, "events": _read(path)}
                except OSError:
                    continue
        for n in list(_FILES):
            if n not in seen:
                del _FILES[n]
        return [e for n in seen if n in _FILES for e in _FILES[n]["events"]]


def _cz_level(name):
    m = re.search(r"warzone_tg_?([a-z]*)", name.lower())
    return {"low": "Low", "med": "Medium", "high": "High", "veryhigh": "Very High"}.get(m.group(1) if m else "", "")


def _tally(kills):
    by = {}
    for k in kills:
        t = by.setdefault(k["type"], {"type": k["type"], "class": k["class"], "source": k["source"], "count": 0,
                                      "credits": 0, "rewards": set()})
        t["count"] += 1
        t["credits"] += k["reward"]
        t["rewards"].add(k["reward"])
    rows = sorted(by.values(), key=lambda r: TYPE_ORDER.index(r["type"]) if r["type"] in TYPE_ORDER else 99)
    for r in rows:
        r["rewards"] = sorted(r["rewards"])
    return rows


def _fleet():
    snap = STATE.snapshot()
    ships = []
    for sh in snap.get("fleet") or []:
        build = sh.get("build")
        mods = []
        if build:
            for m in build.get("raw") or []:
                item = m.get("item") or ""
                for rx, name, kind, note in _AX_RX:
                    if rx.match(item):
                        mods.append({"name": name, "kind": kind, "note": pick_d(note), "slot": m.get("slot"),
                                     "item": item})
                        break
        names = {m["name"] for m in mods}
        ships.append({
            "id": sh.get("id"), "type": sh.get("type"), "name": sh.get("name"), "ident": sh.get("ident"),
            "current": sh.get("current"), "system": sh.get("system"), "known": bool(build),
            "updated": build.get("updated") if build else None, "modules": mods,
            "ax_weapons": sum(1 for m in mods if m["name"] in AX_WEAPONS),
            "scanner": bool(names & SCANNERS), "caustic": sorted(names & CAUSTIC),
            "sfn": "Shutdown Field Neutraliser" in names, "flak": "Remote Release Flak Launcher" in names,
        })
    ships.sort(key=lambda s: (not s["current"], -s["ax_weapons"], not s["known"]))
    return ships, snap


def _load_coords():
    try:
        from . import search
        _COORDS.update(search.ensure_coords([p[0] for p in PLACES]))
    except Exception as exc:
        print(f"[Thargoid] coordinate non disponibili: {exc!r}")


def overview():
    events = _events()
    names = {}          # SystemAddress -> nome
    system = None
    session_start = None
    kills, cz, nhss = [], {}, {}
    pending, pending_n, last_redeem, lost = 0, 0, None, None
    for e in events:
        ev, ts = e["event"], e.get("timestamp") or ""
        if ev in ("FSDJump", "Location", "CarrierJump"):
            system = e.get("StarSystem") or system
            if e.get("SystemAddress"):
                names[e["SystemAddress"]] = system
        elif ev == "LoadGame":
            session_start = ts
        elif ev == "FactionKillBond":
            r = int(e.get("Reward") or 0)
            kills.append({"ts": ts, "reward": r, "system": system, **classify(r, ts)})
            if "pilotsfederation" in str(e.get("AwardingFaction") or "").lower():
                pending += r
                pending_n += 1
        elif ev == "RedeemVoucher":
            pct = e.get("BrokerPercentage") or 0
            gross = e["Amount"] / (1 - pct / 100) if pct and pct < 100 else e["Amount"]
            pending = max(0, pending - round(gross))
            if pending == 0:
                pending_n = 0
            last_redeem = {"ts": ts, "amount": e["Amount"], "broker": pct or None, "system": system}
        elif ev == "Died":
            if pending:
                lost = {"ts": ts, "amount": pending}
            pending, pending_n = 0, 0
        elif ev == "FSSSignalDiscovered":
            sysname = names.get(e.get("SystemAddress")) or system
            if "warzone_tg" in e["SignalName"].lower():
                c = cz.setdefault(sysname, {"system": sysname, "last": ts, "levels": set()})
                c["last"] = max(c["last"], ts)
                lvl = _cz_level(e["SignalName"])
                if lvl:
                    c["levels"].add(lvl)
            else:
                n = nhss.setdefault(sysname, {"system": sysname, "last": ts, "count": 0})
                n["last"] = max(n["last"], ts)
                n["count"] += 1
    here = STATE.location.get("system")
    sess = [k for k in kills if session_start and k["ts"] >= session_start]
    ships, snap = _fleet()
    pos = (snap.get("location") or {}).get("star_pos")
    if not _COORDS:
        threading.Thread(target=_load_coords, daemon=True).start()
    places = []
    for name, kind, note in PLACES:
        c = _COORDS.get(name)
        d = round(sum((a - b) ** 2 for a, b in zip(pos, c)) ** 0.5, 1) if pos and c else None
        places.append({"system": name, "kind": kind, "note": pick_d(note), "distance": d})
    places.sort(key=lambda p: (p["distance"] is None, p["distance"] or 0))
    return {
        "war": {"ended": "3310-12-18", "live_source": False},
        "kills_total": len(kills), "credits_total": sum(k["reward"] for k in kills),
        "by_type": _tally(kills),
        "session": {"start": session_start, "kills": len(sess), "credits": sum(k["reward"] for k in sess),
                    "by_type": _tally(sess)},
        "recent": list(reversed(kills[-15:])),
        "pending": {"amount": pending, "count": pending_n, "last_redeem": last_redeem, "lost": lost},
        "cz_seen": sorted(({**c, "levels": sorted(c["levels"])} for c in cz.values()), key=lambda c: c["last"], reverse=True)[:15],
        "nhss_seen": sorted(nhss.values(), key=lambda n: n["last"], reverse=True)[:15],
        "here": {"system": here, "cz": here in cz, "cz_levels": sorted(cz[here]["levels"]) if here in cz else [],
                 "nhss": (nhss.get(here) or {}).get("count", 0)},
        "places": places,
        "fleet": ships,
        "modules": [{"name": n, "kind": k, "note": pick_d(note)} for _, n, k, note in AX_MODULES],
    }


def start():
    threading.Thread(target=_load_coords, daemon=True).start()


GET = {"/api/thargoid": lambda q: overview()}
POST = {}
LAN = set()
