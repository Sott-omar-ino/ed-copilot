"""Tracker degli sblocchi degli ingegneri (scheda "Ingegneri").

Dai journal (tutti, cache in memoria per file: nome + dimensione + data di modifica) si ricavano:
- EngineerProgress: stato (Known / Invited / Acquainted / Unlocked / Barred), Rank (1-5) e RankProgress
  (percentuale verso il grado successivo). L'evento all'avvio ha l'elenco "Engineers"[], quelli successivi un solo
  ingegnere (a volte senza "Progress", solo "Rank").
- EngineerContribution: consegne per invito/sblocco (Type = Commodity / Materials / Credits / Bond / Bounty,
  Commodity o Material, Quantity, TotalQuantity = totale consegnato finora a quell'ingegnere).
- EngineerCraft: modifiche fatte (Engineer, BlueprintName, Level = grado).
- Statistics / Rank / Reputation: ultimi valori, per i requisiti che corrispondono chiaramente a un dato del journal.

FONTI (verificate l'8/11/2026):
- Campi degli eventi: Frontier Journal Manual (EngineerProgress, EngineerContribution, EngineerCraft, Statistics) e
  codice di EDDiscovery, EliteDangerousCore/EliteDangerous/JournalStatus/Events/JournalEngineer.cs
  (ContributionType { Bond, Bounty, Commodity, Credits, Materials }; Rank e RankProgress "only when unlocked",
  RankProgress mostrato come %). Confermati sui journal dell'utente (es. EngineerContribution Felicity Farseer,
  Type "Commodity", Commodity "metaalloys", Quantity 1, TotalQuantity 1; RankProgress 5 con Rank 3).
- Requisiti (numeri e referral) degli ingegneri di bordo: gli stessi di web/js/views/ingegneri.js (ENG_REQ), presi da
  inara.cz/elite/engineers (nov 2026) e confrontati con elite-dangerous.fandom.com. Ingegneri a piedi:
  web/js/data/odyssey-data.js (engineers: meet / unlock), stesse fonti.
- "Referral da X" = arrivare al grado 3 con X e fare progressi verso il 4 (stessa fonte, vedi ENG_REQ).
- Statistiche usate (nomi dei campi verificati sull'evento Statistics dei journal dell'utente):
  Exploration.Greatest_Distance_From_Start (al), Exploration.Shuttle_Distance_Travelled (al),
  Smuggling.Black_Markets_Traded_With, Trading.Markets_Traded_With, Combat.Bounties_Claimed, Mining.Quantity_Mined.
  NON usati perché non corrispondono esattamente al requisito: Combat.Combat_Bonds (conta tutti i combat bond,
  non solo quelli federali), Combat.ConflictZone_Low (non distingue a piedi / in nave).
- Livelli di reputazione: soglie STIMATE di app/ranks.py (Frontier non le pubblica): nell'interfaccia sono indicate
  come stima.
- Grado massimo di ogni ingegnere: il grado più alto offerto in gamedata.ENGINEERS (colonna specialità).
"""

import json
import os
import re
import threading

from . import journal
from .gamedata import ENGINEER_ALIASES, ENGINEERS, RANK_LABELS, RANKS_EN
from .lang import pick, pick_d

LOCK = threading.Lock()
FILES = {}  # nome file -> {"sig": [...], "events": [...]}
WANTED = ('"event":"EngineerProgress"', '"event":"EngineerContribution"', '"event":"EngineerCraft"',
          '"event":"Statistics"', '"event":"Rank"', '"event":"Reputation"')

# --- requisiti strutturati ----------------------------------------------------
# ("rank", chiave Rank, indice minimo in RANKS_EN)  ("stat", sezione, campo, obiettivo, unità, strettamente maggiore)
# ("rep", superpotenza, livello)  ("faction", nome, livello, "min"|"max")  ("give", nome oggetto, quantità o None)
# Per "give" il nome oggetto "Credits"/"Bond"/"Bounty" indica una consegna in crediti di quel Type.
SHIP = {
    "Felicity Farseer": {"invite": [("rank", "Explore", 2)], "unlock": [("give", "Meta-Alloys", 1)]},
    "Elvira Martuuk": {"invite": [("stat", "Exploration", "Greatest_Distance_From_Start", 300, "al", False)],
                       "unlock": [("give", "Soontill Relics", 3)]},
    "The Dweller": {"invite": [("stat", "Smuggling", "Black_Markets_Traded_With", 5, "", False)],
                    "unlock": [("give", "Credits", 500000)]},
    "Liz Ryder": {"invite": [("faction", "Eurybia Blue Mafia", "Cordial", "min")], "unlock": [("give", "Landmines", 200)]},
    "Tod 'The Blaster' McQuinn": {"invite": [("stat", "Combat", "Bounties_Claimed", 15, "", True)],
                                  "unlock": [("give", "Bounty", 100000)]},
    "Juri Ishmaak": {"ref": ["Felicity Farseer"], "unlock": [("give", "Bond", None)]},
    "Colonel Bris Dekker": {"ref": ["Juri Ishmaak"], "invite": [("rep", "Federation", "Friendly")],
                            "unlock": [("give", "Bond", None)]},
    "The Sarge": {"ref": ["Juri Ishmaak"], "invite": [("rank", "Federation", 3)],
                  "unlock": [("give", "Aberrant Shield Pattern Analysis", 50)]},
    "Mel Brandon": {"ref": ["Elvira Martuuk"], "unlock": [("give", "Bounty", 100000)]},
    "Zacariah Nemo": {"ref": ["Elvira Martuuk"], "unlock": [("give", "Xihe Companions", 25)]},
    "Marco Qwent": {"ref": ["Elvira Martuuk"], "unlock": [("give", "Modular Terminals", 25)]},
    "Chloe Sedesi": {"ref": ["Marco Qwent"],
                     "invite": [("stat", "Exploration", "Greatest_Distance_From_Start", 5000, "al", False)],
                     "unlock": [("give", "Sensor Fragment", 25)]},
    "Lori Jameson": {"ref": ["Marco Qwent"], "invite": [("rank", "Combat", 6)], "unlock": [("give", "Kongga Ale", 25)]},
    "Professor Palin": {"ref": ["Marco Qwent"],
                        "invite": [("stat", "Exploration", "Greatest_Distance_From_Start", 5000, "al", False)],
                        "unlock": [("give", "Sensor Fragment", 25)]},
    "Marsha Hicks": {"ref": ["The Dweller"], "invite": [("rank", "Explore", 3)], "unlock": [("give", "Osmium", 10)]},
    "Lei Cheung": {"ref": ["The Dweller"], "invite": [("stat", "Trading", "Markets_Traded_With", 50, "", True)],
                   "unlock": [("give", "Gold", 200)]},
    "Ram Tah": {"ref": ["Lei Cheung"], "invite": [("rank", "Explore", 3)],
                "unlock": [("give", "Classified Scan Databanks", 50)]},
    "Petra Olmanova": {"ref": ["Tod 'The Blaster' McQuinn"], "invite": [("rank", "Combat", 4)],
                       "unlock": [("give", "Progenitor Cells", 200)]},
    "Selene Jean": {"ref": ["Tod 'The Blaster' McQuinn"],
                    "invite": [("stat", "Mining", "Quantity_Mined", 500, "t", False)], "unlock": [("give", "Painite", 10)]},
    "Bill Turner": {"ref": ["Selene Jean"],
                    "invite": [("rep", "Alliance", "Friendly"), ("faction", "Alioth Independents", "Allied", "min")],
                    "unlock": [("give", "Bromellite", 50)]},
    "Didi Vatermann": {"ref": ["Selene Jean"], "invite": [("rank", "Trade", 4)], "unlock": [("give", "Lavian Brandy", 50)]},
    "Etienne Dorn": {"ref": ["Liz Ryder"], "invite": [("rank", "Trade", 3)],
                     "unlock": [("give", "Occupied Escape Pod", 25)]},
    "Hera Tani": {"ref": ["Liz Ryder"], "invite": [("rank", "Empire", 1)], "unlock": [("give", "Kamitra Cigars", 50)]},
    "Broo Tarquin": {"ref": ["Hera Tani"], "invite": [("rank", "Combat", 3)], "unlock": [("give", "Fujin Tea", 50)]},
    "Tiana Fortune": {"ref": ["Hera Tani"], "invite": [("rep", "Empire", "Friendly")],
                      "unlock": [("give", "Decoded Emission Data", 50)]},
}
# A piedi: "meet" = requisito per incontrarlo (sblocco), "referral" = consegna al referrer per far conoscere il
# successivo (odyssey-data.js, campi meet / unlock).
SUIT = {
    "Domino Green": {"meet": [("stat", "Exploration", "Shuttle_Distance_Travelled", 100, "al", False)],
                     "referral": ("Push", 5, "Kit Fowler")},
    "Hero Ferrari": {"referral": ("Settlement Defence Plans", 5, "Wellington Beck")},
    "Jude Navarro": {"referral": ("Genetic Repair Meds", 5, "Terra Velasquez")},
    "Kit Fowler": {"ref": ["Domino Green"], "referral": ("Surveillance Equipment", 5, "Yarden Bond")},
    "Terra Velasquez": {"ref": ["Jude Navarro"], "referral": ("Financial Projections", 15, "Oden Geiger")},
    "Wellington Beck": {"ref": ["Hero Ferrari"], "referral": ("InSight Entertainment Suite", 5, "Uma Laszlo")},
    "Oden Geiger": {"ref": ["Terra Velasquez"]},
    "Uma Laszlo": {"ref": ["Wellington Beck"], "meet": [("faction", "Sirius Corporation", "Unfriendly", "max")]},
    "Yarden Bond": {"ref": ["Kit Fowler"]},
    "Baltanos": {"meet": [("faction", "Colonia Council", "Friendly", "min")],
                 "referral": ("Faction Associates", 10, "Yi Shen")},
    "Eleanor Bresa": {"referral": ("Digital Designs", 10, "Yi Shen")},
    "Rosa Dayette": {"referral": ("Manufacturing Instructions", 10, "Yi Shen")},
    "Yi Shen": {"ref": ["Baltanos", "Eleanor Bresa", "Rosa Dayette"]},
}
STAT_LABEL = {
    "Greatest_Distance_From_Start": {"it": "Distanza massima dal sistema di partenza",
                                     "en": "Greatest distance from starting system"},
    "Shuttle_Distance_Travelled": {"it": "Distanza percorsa sulle navette Apex", "en": "Distance travelled on Apex shuttles"},
    "Black_Markets_Traded_With": {"it": "Black market con cui hai commerciato", "en": "Black markets traded with"},
    "Markets_Traded_With": {"it": "Mercati con cui hai commerciato", "en": "Markets traded with"},
    "Bounties_Claimed": {"it": "Bounty riscosse", "en": "Bounties claimed"},
    "Quantity_Mined": {"it": "Minerale estratto", "en": "Quantity mined"},
}


def _rank_label(key):
    try:
        from .state import rank_label  # nome del rank nella lingua dell'interfaccia
        return rank_label(key)
    except Exception:  # noqa: BLE001
        return RANK_LABELS.get(key, key)
REP_ORDER = ["Hostile", "Unfriendly", "Neutral", "Cordial", "Friendly", "Allied"]
STAGES = ["None", "Known", "Invited", "Acquainted", "Unlocked"]


def _norm(s):
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def _max_grade(name):
    g = [int(x) for x in re.findall(r"G(\d)", ENGINEERS.get(name, ("", "", "", ""))[3])]
    return max(g) if g else 5


# --- lettura dei journal --------------------------------------------------------
def _parse(path):
    out = []
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            for line in f:
                head = line[:90].replace(" ", "")
                if not any(w in head for w in WANTED):
                    continue
                try:
                    out.append(json.loads(line))
                except ValueError:
                    continue
    except OSError:
        pass
    return out


def _events():
    seen, evs = set(), []
    with LOCK:
        for path in journal.journal_files():
            name = os.path.basename(path)
            try:
                st = os.stat(path)
            except OSError:
                continue
            sig = [st.st_size, int(st.st_mtime)]
            seen.add(name)
            ent = FILES.get(name)
            if not ent or ent["sig"] != sig:
                ent = FILES[name] = {"sig": sig, "events": _parse(path)}
            evs.extend(ent["events"])
        for name in set(FILES) - seen:
            del FILES[name]
    evs.sort(key=lambda e: e.get("timestamp") or "")
    return evs


def collect():
    """Stato degli ingegneri, consegne, modifiche fatte e ultime statistiche/rank/reputazione."""
    eng, contrib, crafts, last = {}, {}, {}, {}
    for e in _events():
        ev, ts = e.get("event"), e.get("timestamp")
        if ev == "EngineerProgress":
            for i in e.get("Engineers") or [e]:
                name = ENGINEER_ALIASES.get(i.get("Engineer"), i.get("Engineer"))
                if not name:
                    continue
                cur = eng.setdefault(name, {})
                for k, dst in (("Progress", "progress"), ("Rank", "rank"), ("RankProgress", "rank_progress")):
                    if k in i:
                        cur[dst] = i[k]
                if "Rank" in i and "RankProgress" not in i:
                    cur["rank_progress"] = 0  # nuovo grado appena raggiunto
                cur["ts"] = ts
        elif ev == "EngineerContribution":
            name = ENGINEER_ALIASES.get(e.get("Engineer"), e.get("Engineer"))
            typ = e.get("Type") or ""
            if typ in ("Credits", "Bond", "Bounty"):
                item, label = typ, typ
            else:
                item = e.get("Commodity") or e.get("Material") or ""
                label = e.get("Commodity_Localised") or e.get("Material_Localised") or item
            if not name or not item:
                continue
            key = _norm(item)
            c = contrib.setdefault(name, {}).setdefault(key, {"type": typ, "item": label, "total": 0})
            tq = e.get("TotalQuantity")
            c["total"] = max(c["total"], tq) if isinstance(tq, (int, float)) else c["total"] + (e.get("Quantity") or 0)
            c["ts"] = ts
        elif ev == "EngineerCraft":
            name = ENGINEER_ALIASES.get(e.get("Engineer"), e.get("Engineer"))
            if not name:
                continue
            c = crafts.setdefault(name, {"count": 0, "grades": {}, "blueprints": {}, "max": 0})
            lvl = e.get("Level") or 0
            c["count"] += 1
            c["grades"][str(lvl)] = c["grades"].get(str(lvl), 0) + 1
            c["max"] = max(c["max"], lvl)
            bp = (e.get("BlueprintName") or "?").replace("_", " ")
            c["blueprints"][bp] = max(c["blueprints"].get(bp, 0), lvl)
            c["last"] = ts
        elif ev in ("Statistics", "Rank", "Reputation"):
            last[ev] = e
    return eng, contrib, crafts, last


# --- valutazione dei requisiti -------------------------------------------------------
def _factions():
    try:
        from . import ranks  # import pigro: ranks legge già la reputazione con le minor faction
        _, factions, _, _ = ranks._history()
        return factions, ranks.rep_level
    except Exception:  # noqa: BLE001 - senza reputazione le faction restano solo testo
        return {}, lambda v: None


def _check(spec, ctx):
    kind = spec[0]
    if kind == "rank":
        _, key, need = spec
        names = RANKS_EN.get(key, [])
        have = (ctx["rank"] or {}).get(key)
        rname = names[need] if need < len(names) else need
        label = pick(f"Rank {_rank_label(key)}: {rname} o superiore", f"{_rank_label(key)} rank: {rname} or higher")
        if not isinstance(have, int):
            return {"label": label, "have": None, "text": pick("nessun dato nel journal", "no data in the journal")}
        now = names[have] if have < len(names) else have
        return {"label": label, "done": have >= need, "frac": min(1, have / need) if need else 1,
                "text": pick(f"ora {now}", f"now {now}")}
    if kind == "stat":
        _, sec, field, target, unit, strict = spec
        have = ((ctx["stats"] or {}).get(sec) or {}).get(field)
        label = pick_d(STAT_LABEL.get(field)) or field.replace("_", " ")
        if not isinstance(have, (int, float)):
            return {"label": label, "have": None, "text": pick("nessun dato nel journal", "no data in the journal")}
        need = target + 1 if strict else target
        if unit == "al":
            unit = pick("al", "ly")
        return {"label": label, "have": have, "need": need, "unit": unit, "done": have >= need, "stat": True,
                "frac": min(1, have / need) if need else 1}
    if kind in ("rep", "faction"):
        name, level = spec[1], spec[2]
        mode = spec[3] if kind == "faction" else "min"
        if kind == "rep":
            v = (ctx["rep"] or {}).get(name)
        else:
            v = (ctx["factions"].get(name) or {}).get("rep")
        label = f"{name}: {level} " + (pick("o superiore", "or higher") if mode == "min" else pick("o peggiore", "or lower"))
        if not isinstance(v, (int, float)):
            return {"label": label, "have": None, "text": pick("reputazione non ancora nel journal",
                                                               "reputation not in the journal yet")}
        lv = ctx["rep_level"](v)
        ok = lv in REP_ORDER and (REP_ORDER.index(lv) >= REP_ORDER.index(level) if mode == "min"
                                  else REP_ORDER.index(lv) <= REP_ORDER.index(level))
        return {"label": label, "done": ok, "estimate": True,
                "text": pick(f"ora {lv} ({v:+.1f}, livello stimato)", f"now {lv} ({v:+.1f}, estimated level)")}
    if kind == "give":
        _, item, qty = spec
        have = ((ctx["contrib"].get(ctx["name"]) or {}).get(_norm(item)) or {}).get("total", 0)
        unit = "CR" if item in ("Credits", "Bond", "Bounty") else ""
        label = {"Credits": pick("Crediti", "Credits"), "Bond": "Combat bond", "Bounty": "Bounty voucher"}.get(item, item)
        out = {"label": pick(f"Consegna: {label}", f"Deliver: {label}"), "item": label, "have": have, "need": qty,
               "unit": unit, "give": True}
        if qty:
            out.update(done=have >= qty, frac=min(1, have / qty))
        else:
            out["text"] = pick("quantità variabile: nessuna barra", "variable amount: no progress bar")
        return out
    return {"label": str(spec)}


def _referral_checks(name, refs, ctx):
    out = []
    for r in refs:
        st = ctx["eng"].get(r) or {}
        if r in SHIP:
            rank, rp = st.get("rank"), st.get("rank_progress") or 0
            c = {"label": pick(f"Referral da {r}: grado 3 e progressi verso il 4",
                               f"Referral from {r}: grade 3 and progress towards 4"), "ref": r}
            if st.get("progress") != "Unlocked" or not isinstance(rank, int):
                c.update(done=False, frac=0, text=pick(f"{r} non ancora sbloccato", f"{r} not unlocked yet"))
            else:
                # Fatto di sicuro solo al grado 4: al 3 serve "fare progressi verso il 4" (quanti non è noto).
                c.update(done=rank >= 4, frac=min(1, (rank + rp / 100) / 4),
                         text=pick(f"ora grado {rank} ({rp}% verso il {rank + 1})",
                                   f"now grade {rank} ({rp}% towards {rank + 1})") if rank < 5
                         else pick("grado 5", "grade 5"))
            out.append(c)
        else:
            ref = SUIT.get(r, {}).get("referral")
            c = {"label": pick(f"Referral da {r}", f"Referral from {r}"), "ref": r}
            if st.get("progress") != "Unlocked":
                c.update(done=False, frac=0, text=pick(f"{r} non ancora sbloccato", f"{r} not unlocked yet"))
            elif ref:
                have = ((ctx["contrib"].get(r) or {}).get(_norm(ref[0])) or {}).get("total", 0)
                c.update(label=pick(f"Referral da {r}: consegna {ref[0]}", f"Referral from {r}: deliver {ref[0]}"),
                         item=ref[0], have=have, need=ref[1], give=True,
                         done=have >= ref[1], frac=min(1, have / ref[1]))
            out.append(c)
    return out


def _next(name, kind, st, ctx):
    spec = (SHIP if kind == "ship" else SUIT).get(name, {})
    prog = st.get("progress")
    if prog == "Barred":
        return {"step": "barred", "checks": []}
    if not prog:
        return {"step": "discover", "checks": _referral_checks(name, spec.get("ref", []), ctx)}
    if prog == "Unlocked":
        if kind == "ship":
            rank, top = st.get("rank") or 0, _max_grade(name)
            if rank >= top:
                return {"step": "done", "checks": []}
            rp = st.get("rank_progress") or 0
            return {"step": "rank", "checks": [{"label": pick(f"Grado {rank} → {rank + 1}", f"Grade {rank} → {rank + 1}"),
                                                "have": rp, "need": 100,
                                                "unit": "%", "frac": rp / 100, "done": False}], "max": top}
        ref = spec.get("referral")
        if ref and not (ctx["eng"].get(ref[2]) or {}).get("progress"):
            have = ((ctx["contrib"].get(name) or {}).get(_norm(ref[0])) or {}).get("total", 0)
            return {"step": "referral", "target": ref[2],
                    "checks": [{"label": pick(f"Consegna {ref[0]} per conoscere {ref[2]}",
                                              f"Deliver {ref[0]} to meet {ref[2]}"), "item": ref[0], "have": have, "need": ref[1],
                                "give": True, "done": have >= ref[1], "frac": min(1, have / ref[1])}]}
        return {"step": "done", "checks": []}
    if kind == "ship":
        if prog == "Known":
            return {"step": "invite", "checks": [_check(s, ctx) for s in spec.get("invite", [])]}
        return {"step": "unlock", "checks": [_check(s, ctx) for s in spec.get("unlock", [])]}
    return {"step": "meet", "checks": [_check(s, ctx) for s in spec.get("meet", [])]}


def summary(q=None):
    eng, contrib, crafts, last = collect()
    factions, rep_level = _factions()
    stats = {k: v for k, v in (last.get("Statistics") or {}).items() if isinstance(v, dict)}
    rank = {k: v for k, v in (last.get("Rank") or {}).items() if isinstance(v, int)}
    rep = {k: v for k, v in (last.get("Reputation") or {}).items() if isinstance(v, (int, float))}
    ctx = {"eng": eng, "contrib": contrib, "stats": stats, "rank": rank, "rep": rep,
           "factions": factions, "rep_level": rep_level}
    out = {}
    for name, v in ENGINEERS.items():
        kind = v[2]
        st = eng.get(name, {})
        ctx["name"] = name
        nx = _next(name, kind, st, ctx)
        fr = [c["frac"] for c in nx["checks"] if isinstance(c.get("frac"), (int, float))]
        nx["frac"] = round(sum(fr) / len(fr), 3) if fr else None
        nx["ready"] = bool(nx["checks"]) and all(c.get("done") for c in nx["checks"])
        out[name] = {
            "progress": st.get("progress"), "rank": st.get("rank"), "rank_progress": st.get("rank_progress"),
            "max_grade": _max_grade(name) if kind == "ship" else None,
            "ref": (SHIP if kind == "ship" else SUIT).get(name, {}).get("ref", []),
            "next": nx,
            "contributions": sorted((contrib.get(name) or {}).values(), key=lambda c: c.get("ts") or ""),
            "crafts": crafts.get(name),
        }
    return {"engineers": out, "has_journal": bool(eng)}


def start():
    """Prima lettura in background: la scheda poi risponde subito."""
    try:
        collect()
    except Exception as exc:  # noqa: BLE001 - solo riscaldamento della cache
        print(f"Engineers: errore nella lettura dei journal: {exc!r}")


GET = {"/api/engineers": lambda q: summary(q)}
POST = {}
LAN = set()
