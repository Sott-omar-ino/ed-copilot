"""Missioni raggruppate per destinazione, con la stiva necessaria e un ordine di consegna consigliato."""

import math
import time
from datetime import datetime, timezone

from . import search
from .journal import STATE
from .lang import pick

URGENT_HOURS = 3  # una destinazione con missioni in scadenza entro 3 ore va prima, anche se è più lontana


def _hours_left(expiry):
    try:
        t = datetime.strptime(expiry, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp()
        return (t - time.time()) / 3600
    except (TypeError, ValueError):
        return None


def _kind(m):
    """Tipo di missione dal nome interno (Mission_Delivery_..., Mission_Collect_..., Mission_Massacre_...)."""
    k = (m.get("kind") or "").lower()
    for key, label, en in (("delivery", "Consegna", "Delivery"), ("collect", "Raccolta", "Source"),
                           ("passenger", "Passeggeri", "Passengers"), ("sightseeing", "Passeggeri", "Passengers"),
                           ("massacre", "Massacro", "Massacre"), ("assassinate", "Assassinio", "Assassination"),
                           ("courier", "Corriere", "Courier"), ("salvage", "Recupero", "Salvage"),
                           ("mining", "Estrazione", "Mining"), ("smuggle", "Contrabbando", "Smuggling"),
                           ("rescue", "Soccorso", "Rescue"), ("disable", "Neutralizzazione", "Disable"),
                           ("onfoot", "A piedi", "On Foot"), ("altruism", "Donazione", "Donation")):
        if key in k:
            return pick(label, en)
    return pick("Altro", "Other")


def _cargo(m):
    """Tonnellate da portare a destinazione: solo per le consegne (le raccolte si comprano/trovano lungo la strada)."""
    k = (m.get("kind") or "").lower()
    if m.get("commodity") and m.get("count") and ("delivery" in k or "smuggle" in k):
        return m["count"]
    return 0


def plan():
    snap = STATE.snapshot()
    here = (snap.get("location") or {}).get("system")
    here_pos = (snap.get("location") or {}).get("star_pos")
    missions = snap.get("missions") or []

    groups = {}
    for m in missions:
        key = (m.get("system") or "", m.get("station") or "")
        g = groups.setdefault(key, {"system": key[0] or None, "station": key[1] or None, "missions": [],
                                    "reward": 0, "cargo": 0, "passengers": 0, "hours_left": None})
        hl = _hours_left(m.get("expiry"))
        g["missions"].append({**m, "type": _kind(m), "hours_left": hl})
        g["reward"] += m.get("reward") or 0
        g["cargo"] += _cargo(m)
        g["passengers"] += m.get("passengers") or 0
        if hl is not None and (g["hours_left"] is None or hl < g["hours_left"]):
            g["hours_left"] = hl

    pos = search.ensure_coords([g["system"] for g in groups.values()])
    if here and here_pos:
        pos[here] = here_pos
    for g in groups.values():
        g["coords"] = pos.get(g["system"])
        g["distance"] = round(math.dist(here_pos, g["coords"]), 1) if here_pos and g["coords"] else None

    # Ordine: prima le destinazioni urgenti (per scadenza), poi il vicino più prossimo partendo da dove sei.
    todo = [g for g in groups.values() if g["system"]]
    urgent = sorted((g for g in todo if g["hours_left"] is not None and g["hours_left"] < URGENT_HOURS),
                    key=lambda g: g["hours_left"])
    rest = [g for g in todo if g not in urgent]
    order, cur = list(urgent), (urgent[-1]["coords"] if urgent and urgent[-1]["coords"] else here_pos)
    while rest:
        nxt = min(rest, key=lambda g: math.dist(cur, g["coords"]) if cur and g["coords"] else float("inf"))
        rest.remove(nxt)
        order.append(nxt)
        cur = nxt["coords"] or cur
    prev, total = here_pos, 0.0
    for i, g in enumerate(order, 1):
        g["step"] = i
        g["leg"] = round(math.dist(prev, g["coords"]), 1) if prev and g["coords"] else None
        total += g["leg"] or 0
        prev = g["coords"] or prev
    unknown = [g for g in groups.values() if not g["system"]]  # missioni senza destinazione nota

    cargo_needed = sum(g["cargo"] for g in order)
    in_hold = sum(c.get("count") or 0 for c in snap.get("cargo") or [])
    return {
        "here": here, "groups": order + unknown, "total_ly": round(total, 1),
        "reward": sum(g["reward"] for g in groups.values()), "cargo_needed": cargo_needed,
        "cargo_in_hold": in_hold, "cargo_capacity": (snap.get("ship") or {}).get("cargo"),
        "passengers": sum(g["passengers"] for g in groups.values()), "count": len(missions),
    }
