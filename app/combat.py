"""Missioni massacro: raggruppamento per fazione bersaglio e uccisioni necessarie.

Regola dello stacking (fonti della comunità, non documentazione ufficiale Frontier):
  - una uccisione della fazione bersaglio fa avanzare una missione per OGNI fazione committente diversa;
    le missioni dello stesso committente non avanzano insieme (cambiamento della patch 2.4).
    Fonti: forum Frontier "Stacking Massacre Missions question"
    (https://forums.frontier.co.uk/threads/stacking-massacre-missions-question.613831) e
    "Massacre missions don't stack..." (https://forums.frontier.co.uk/goto/post?id=6245396).
  - uccisioni necessarie per lo stack = la somma più alta fra i committenti; "Total Kills" = somma di
    tutte le missioni; la differenza rispetto al committente più alto indica quanto si può aggiungere gratis.
    Stesse definizioni del Massacre Mission Stacker di ODEliteTracker
    (https://github.com/WarmedxMints/ODEliteTracker/wiki/Massacre-Mission-Stacker).

Il progresso è una STIMA: il journal non dice quale missione ha contato una uccisione. Lo stato (app/state.py)
conta i Bounty contro la fazione bersaglio nel sistema della missione, dopo l'accettazione, e lo corregge
quando arriva MissionRedirected (missione completata: questo è certo). Le uccisioni nelle zone di conflitto
(FactionKillBond) non sono contate: non ho trovato una fonte affidabile che dica se valgono. Le uccisioni dei
compagni di squadra non si vedono. Il progresso viene ricostruito rileggendo i journal a ogni avvio.
"""

import time
from datetime import datetime, timezone

from . import journal, voice
from .journal import STATE
from .lang import pick

EXPIRY_WARN_H = 24   # scelta dell'interfaccia: avviso se una missione dello stack scade entro un giorno
EXPIRY_HOT_H = 3
BALANCE_RATIO = 1.5  # scelta dell'interfaccia (non una regola del gioco): quando suggerire di bilanciare


def _hours_left(expiry):
    try:
        t = datetime.strptime(expiry, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp()
        return (t - time.time()) / 3600
    except (TypeError, ValueError):
        return None


def _massacre(missions):
    return [m for m in missions if "kills" in m and m.get("target")]


def stacks(missions=None):
    """Stack di missioni massacro per (fazione bersaglio, sistema)."""
    if missions is None:
        missions = STATE.snapshot().get("missions") or []
    groups = {}
    for m in _massacre(missions):
        key = (m["target"], m.get("target_system") or "")
        g = groups.setdefault(key, {"target": key[0], "system": key[1] or None, "givers": {},
                                    "target_type": m.get("target_type"), "wing": False})
        g["wing"] = g["wing"] or bool(m.get("wing"))
        giver = g["givers"].setdefault(m.get("faction") or "?", {"faction": m.get("faction") or "?", "missions": []})
        count = m.get("count") or 0
        giver["missions"].append({
            "id": m["id"], "name": m.get("name"), "count": count, "kills": min(m.get("kills") or 0, count),
            "done": bool(m.get("redirected")), "reward": m.get("reward") or 0, "wing": bool(m.get("wing")),
            "expiry": m.get("expiry"), "hours_left": _hours_left(m.get("expiry")), "accepted": m.get("accepted"),
            "station": m.get("station")})

    out = []
    for g in groups.values():
        givers = list(g["givers"].values())
        for gv in givers:
            gv["missions"].sort(key=lambda x: x.get("accepted") or "")
            gv["total"] = sum(x["count"] for x in gv["missions"])
            gv["kills"] = sum(x["kills"] for x in gv["missions"])
            gv["remaining"] = max(0, gv["total"] - gv["kills"])
            gv["reward"] = sum(x["reward"] for x in gv["missions"])
            gv["done"] = all(x["done"] for x in gv["missions"])
        givers.sort(key=lambda x: -x["total"])
        needed = max((x["total"] for x in givers), default=0)
        total_kills = sum(x["total"] for x in givers)
        # Ogni uccisione avanza tutti i committenti non ancora finiti: il più alto le ha ricevute tutte.
        done = max((x["kills"] for x in givers), default=0)
        remaining = max((x["remaining"] for x in givers), default=0)
        all_missions = [x for gv in givers for x in gv["missions"]]
        warn = sorted((x for x in all_missions if not x["done"] and x["hours_left"] is not None
                       and x["hours_left"] < EXPIRY_WARN_H), key=lambda x: x["hours_left"])

        tips = []
        if len(givers) == 1:
            tips.append(pick(f"Un solo committente ({givers[0]['faction']}): le missioni contro {g['target']} di altre "
                             "fazioni avanzerebbero in parallelo, senza uccisioni in più.",
                             f"Only one mission giver ({givers[0]['faction']}): missions against {g['target']} from "
                             "other factions would progress in parallel, with no extra kills."))
        elif len(givers) > 1 and givers[0]["total"] >= BALANCE_RATIO * max(1, givers[1]["total"]):
            short_ones = [x for x in givers[1:] if needed - x["total"] > 0]
            names = ", ".join(f"{x['faction']} (+{needed - x['total']})" for x in short_ones[:4])
            tips.append(pick(f"{givers[0]['faction']} è molto più alto degli altri: prendi altre missioni da "
                             f"{names} per bilanciare. Quelle uccisioni le fai comunque.",
                             f"{givers[0]['faction']} is much higher than the others: take more missions from "
                             f"{names} to balance the stack. You'll make those kills anyway."))
        out.append({
            "target": g["target"], "system": g["system"], "target_type": g["target_type"], "wing": g["wing"],
            "givers": givers, "needed": needed, "kills_done": min(done, needed), "remaining": remaining,
            "total_kills": total_kills, "ratio": round(total_kills / needed, 2) if needed else None,
            "reward": sum(x["reward"] for x in givers), "missions": len(all_missions),
            "completed": sum(1 for x in all_missions if x["done"]),
            "all_done": bool(all_missions) and all(x["done"] for x in all_missions),
            "expiring": warn, "tips": tips,
            "per_kill": round(sum(x["reward"] for x in givers) / needed) if needed else None})
    out.sort(key=lambda s: (s["all_done"], -s["reward"]))
    return {"stacks": out, "here": STATE.location.get("system"),
            "note": pick("Uccisioni fatte = stima dalle taglie (Bounty) nel sistema della missione: non conta le "
                         "uccisioni dei compagni di squadra né quelle nelle zone di conflitto. Una missione segnata "
                         "come completata è certa (il gioco l'ha reindirizzata).",
                         "Kills done = estimate from bounties in the mission system: wingmates' kills and conflict "
                         "zone kills are not counted. A mission marked as completed is certain (the game has "
                         "redirected it).")}


# --- Avvisi a voce e nel ticker -----------------------------------------------------

def _announce(text, spoken=None, kind="gold"):
    ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    with STATE.lock:
        STATE.note(ts, text, kind)
    if voice.load_config().get("enabled"):
        voice.say(spoken or text)
    print(f"[Massacro] {text}")


def _on_event(e):
    if e.get("event") != "MissionRedirected":
        return
    with STATE.lock:
        m = dict(STATE.missions.get(e.get("MissionID")) or {})
        missions = [dict(x) for x in STATE.missions.values()]
    if "kills" not in m:
        return
    data = stacks(missions)
    st = next((s for s in data["stacks"] if s["target"] == m.get("target")
               and (s["system"] or "") == (m.get("target_system") or "")), None)
    if not st:
        return
    if st["all_done"]:
        reward = f"{st['reward']:,}".replace(",", ".")
        _announce(pick(f"Stack massacro contro {st['target']} completato ({st['missions']} missioni, "
                       f"{reward} CR): torna a consegnare",
                       f"Massacre stack against {st['target']} complete ({st['missions']} missions, "
                       f"{reward} CR): go back and hand them in"),
                  pick(f"Stack completato contro {st['target']}. Torna a consegnare le missioni.",
                       f"Stack against {st['target']} complete. Go back and hand in the missions."))
    else:
        left = st["missions"] - st["completed"]
        rest = "ne resta 1" if left == 1 else f"ne restano {left}"
        rest_en = "1 left" if left == 1 else f"{left} left"
        _announce(pick(f"Missione massacro completata per {m.get('faction')}: {rest} nello stack "
                       f"contro {st['target']} (circa {st['remaining']} uccisioni, stima)",
                       f"Massacre mission complete for {m.get('faction')}: {rest_en} in the stack "
                       f"against {st['target']} (about {st['remaining']} kills, estimate)"),
                  pick(f"Missione massacro completata per {m.get('faction')}. {rest[0].upper() + rest[1:]}.",
                       f"Massacre mission complete for {m.get('faction')}. {rest_en[0].upper() + rest_en[1:]} in the stack."))


def start():
    journal.add_listener(_on_event)


GET = {"/api/combat/massacre": lambda q: stacks()}
POST = {}
LAN = set()
