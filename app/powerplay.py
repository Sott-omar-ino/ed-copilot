"""Powerplay 2.0: stato del comandante dai journal, sistemi vicini per power e stato (Spansh), come guadagnare merits.

Dai journal:
- Powerplay (all'avvio: Power, Rank, Merits, TimePledged), PowerplayJoin/Leave/Defect, PowerplayRank,
  PowerplayMerits (MeritsGained, TotalMerits);
- dal Location/FSDJump/CarrierJump più recente i campi Powerplay del sistema corrente
  (ControllingPower, Powers, PowerplayState, PowerplayStateControlProgress, PowerplayStateReinforcement,
  PowerplayStateUndermining, PowerplayConflictProgress).
Il "sistema in Acquisition" nei journal e su Spansh compare come PowerplayState "Unoccupied".
La settimana Powerplay ricomincia il giovedì alle 07:00 UTC, con la manutenzione settimanale
(annuncio del Game Director Frontier, forums.frontier.co.uk; può slittare di qualche decina di minuti).
"""

import datetime as dt
import json
import os
import threading
import time
import urllib.error

from . import journal
from .lang import pick
from .spansh import http_json

SYSTEMS_URL = "https://spansh.co.uk/api/systems/search"
CACHE_TTL = 900
STATES = ("Exploited", "Fortified", "Stronghold")

# Nomi come compaiono nei journal e su Spansh.
POWERS = [
    {"name": "A. Lavigny-Duval", "full": "Arissa Lavigny-Duval", "allegiance": "Empire"},
    {"name": "Aisling Duval", "full": "Aisling Duval", "allegiance": "Empire"},
    {"name": "Archon Delaine", "full": "Archon Delaine", "allegiance": "Independent"},
    {"name": "Denton Patreus", "full": "Denton Patreus", "allegiance": "Empire"},
    {"name": "Edmund Mahon", "full": "Edmund Mahon", "allegiance": "Alliance"},
    {"name": "Felicia Winters", "full": "Felicia Winters", "allegiance": "Federation"},
    {"name": "Jerome Archer", "full": "Jerome Archer", "allegiance": "Federation"},
    {"name": "Li Yong-Rui", "full": "Li Yong-Rui", "allegiance": "Independent"},
    {"name": "Nakato Kaine", "full": "Nakato Kaine", "allegiance": "Alliance"},
    {"name": "Pranav Antal", "full": "Pranav Antal", "allegiance": "Independent"},
    {"name": "Yuri Grom", "full": "Yuri Grom", "allegiance": "Independent"},
    {"name": "Zemina Torval", "full": "Zemina Torval", "allegiance": "Empire"},
]

# Come guadagnare merits in Powerplay 2.0, per tipo di sistema. Solo attività confermate dalla tabella
# "activities" della guida Powerplay 2.0 di Inara (logbook 84502, aggiornata dopo il ribilanciamento del 30/04/2025)
# incrociata con l'annuncio Frontier sulle attività PP 2.0 (forums.frontier.co.uk, thread 629227).
# Tolte perché non confermate o contraddittorie: missioni normali delle fazioni, escape pod/black box
# (le assignment sono state sospese), il tipo di limpet per gli holo-screen. Raggi di Acquisition:
# 20 al da un sistema Fortified, 30 al da uno Stronghold (stessa guida). L'elenco completo è nella scheda Powerplay in gioco.
ACTIVITIES = {
    "Acquisition": {
        "title": "Acquisition", "where": "Sistemi Unoccupied entro 20 al da un sistema Fortified o 30 al da uno Stronghold della tua power",
        "items": [
            "Trasporta le merci Powerplay: ritirale in un tuo sistema Fortified/Stronghold vicino e consegnale al Power Contact del sistema in Acquisition",
            "Distruggi le navi delle power rivali presenti nel sistema",
            "Mining: estrai in un tuo sistema Fortified/Stronghold vicino e vendi nel sistema in Acquisition",
            "Hacking degli holo-screen pubblicitari delle stazioni",
            "A piedi: carica il malware nei data port degli insediamenti del sistema",
        ],
    },
    "Reinforcement": {
        "title": "Reinforcement", "where": "Sistemi Exploited, Fortified e Stronghold della tua power",
        "items": [
            "Bounty hunting: i merits arrivano quando distruggi i ricercati nel sistema",
            "Vendi nel sistema i dati di esplorazione (Universal Cartographics) e di esobiologia (Vista Genomics)",
            "Mining: estrai e vendi nello stesso sistema",
            "Distruggi le navi delle power rivali presenti nel sistema",
            "Hacking degli holo-screen pubblicitari delle stazioni",
        ],
    },
    "Undermining": {
        "title": "Undermining", "where": "Sistemi controllati da una power rivale",
        "items": [
            "Distruggi le navi della power che controlla il sistema",
            "Mining: estrai e vendi nello stesso sistema",
            "Hacking degli holo-screen pubblicitari delle stazioni",
            "A piedi: carica il malware nei data port degli insediamenti",
        ],
    },
}

# Stessa tabella in inglese (stessa forma): status() sceglie in base alla lingua dell'interfaccia.
ACTIVITIES_EN = {
    "Acquisition": {
        "title": "Acquisition", "where": "Unoccupied systems within 20 ly of a Fortified system or 30 ly of a Stronghold of your power",
        "items": [
            "Haul Powerplay commodities: collect them in one of your nearby Fortified/Stronghold systems and deliver them to the Power Contact of the Acquisition system",
            "Destroy ships of rival powers in the system",
            "Mining: mine in one of your nearby Fortified/Stronghold systems and sell in the Acquisition system",
            "Hack the stations' advertising holo-screens",
            "On foot: upload malware to the data ports of the system's settlements",
        ],
    },
    "Reinforcement": {
        "title": "Reinforcement", "where": "Exploited, Fortified and Stronghold systems of your power",
        "items": [
            "Bounty hunting: merits are earned when you destroy wanted ships in the system",
            "Sell exploration data (Universal Cartographics) and exobiology data (Vista Genomics) in the system",
            "Mining: mine and sell in the same system",
            "Destroy ships of rival powers in the system",
            "Hack the stations' advertising holo-screens",
        ],
    },
    "Undermining": {
        "title": "Undermining", "where": "Systems controlled by a rival power",
        "items": [
            "Destroy ships of the power controlling the system",
            "Mining: mine and sell in the same system",
            "Hack the stations' advertising holo-screens",
            "On foot: upload malware to settlement data ports",
        ],
    },
}

_RELEVANT = ('"event":"Powerplay', '"event":"Location"', '"event":"FSDJump"', '"event":"CarrierJump"', '"event":"LoadGame"')
_file_cache, _search_cache = {}, {}
_lock = threading.Lock()


def week_start(now=None):
    """Inizio della settimana Powerplay in corso: il giovedì più recente alle 07:00 UTC."""
    now = now or dt.datetime.now(dt.timezone.utc)
    start = (now - dt.timedelta(days=(now.weekday() - 3) % 7)).replace(hour=7, minute=0, second=0, microsecond=0)
    return start - dt.timedelta(days=7) if start > now else start


def _ts(e):
    try:
        return dt.datetime.fromisoformat(str(e.get("timestamp")).replace("Z", "+00:00"))
    except ValueError:
        return None


def _events(path):
    """Solo gli eventi che servono, in ordine; in cache finché il file non cambia."""
    try:
        st = os.stat(path)
    except OSError:
        return []
    key = (st.st_mtime, st.st_size)
    with _lock:
        hit = _file_cache.get(path)
        if hit and hit[0] == key:
            return hit[1]
    out = []
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            if not any(tag in line for tag in _RELEVANT):
                continue
            try:
                out.append(json.loads(line))
            except ValueError:
                continue
    with _lock:
        _file_cache[path] = (key, out)
    return out


def _system(e):
    return {"name": e.get("StarSystem"), "star_pos": e.get("StarPos"), "population": e.get("Population"),
            "controlling_power": e.get("ControllingPower"), "powers": e.get("Powers") or [],
            "state": e.get("PowerplayState"), "control_progress": e.get("PowerplayStateControlProgress"),
            "reinforcement": e.get("PowerplayStateReinforcement"), "undermining": e.get("PowerplayStateUndermining"),
            "conflict": sorted(({"power": c.get("Power"), "progress": c.get("ConflictProgress")}
                                for c in e.get("PowerplayConflictProgress") or []),
                               key=lambda c: -(c["progress"] or 0)),
            "timestamp": e.get("timestamp")}


def status():
    files = journal.journal_files()
    wk = week_start()
    pledge, system, session_start = None, None, None
    newer = []  # eventi dei file già letti (più recenti), in ordine cronologico
    for path in reversed(files):
        evs = _events(path)
        newer = evs + newer
        if system is None:
            system = next((_system(e) for e in reversed(evs) if e.get("event") in ("Location", "FSDJump", "CarrierJump")), None)
        if session_start is None:
            session_start = next((_ts(e) for e in reversed(evs) if e.get("event") == "LoadGame"), None)
        if pledge is None:
            pledge = next((e for e in reversed(evs) if e.get("event") in
                           ("Powerplay", "PowerplayJoin", "PowerplayLeave", "PowerplayDefect")), None)
        first = _ts(evs[0]) if evs else None
        if pledge is not None and system is not None and session_start is not None and first and first < wk:
            break

    # Stato dell'adesione: si parte dall'ultimo evento "di base" e si applicano quelli successivi.
    power = rank = merits = pledged_since = None
    if pledge:
        ev = pledge.get("event")
        if ev == "Powerplay":
            power, rank, merits = pledge.get("Power"), pledge.get("Rank"), pledge.get("Merits")
            if pledge.get("TimePledged") is not None and _ts(pledge):
                pledged_since = (_ts(pledge) - dt.timedelta(seconds=pledge["TimePledged"])).isoformat()
        elif ev == "PowerplayJoin":
            power, rank, merits, pledged_since = pledge.get("Power"), 1, 0, pledge.get("timestamp")
        elif ev == "PowerplayDefect":
            power, rank, merits, pledged_since = pledge.get("ToPower"), 1, 0, pledge.get("timestamp")
    after = pledge is None  # senza evento di base valgono gli eventi PowerplayMerits trovati
    session = week = 0
    for e in newer:
        if e is pledge:
            after = True
            continue
        ev = e.get("event")
        if ev == "PowerplayMerits":
            t = _ts(e)
            if t and t >= wk:
                week += e.get("MeritsGained") or 0
            if t and session_start and t >= session_start:
                session += e.get("MeritsGained") or 0
            if after:
                merits = e.get("TotalMerits", merits)
                power = power or e.get("Power")
        elif ev == "PowerplayRank" and after:
            rank = e.get("Rank", rank)

    next_reset = week_start() + dt.timedelta(days=7)
    sysinfo = dict(system) if system else None
    if sysinfo:
        sysinfo["relation"] = relation(power, sysinfo)
    return {"pledged": bool(power), "power": power, "rank": rank, "merits": merits, "pledged_since": pledged_since,
            "time_pledged": pledge.get("TimePledged") if pledge and pledge.get("event") == "Powerplay" else None,
            "merits_session": session, "merits_week": week, "week_start": week_start().isoformat(),
            "next_reset": next_reset.isoformat(), "system": sysinfo, "powers": POWERS, "activities": pick(ACTIVITIES, ACTIVITIES_EN)}


def relation(power, s):
    """Che cosa può fare qui chi è legato a `power`: Reinforcement, Acquisition, Undermining o niente."""
    state, ctrl = s.get("state"), s.get("controlling_power")
    if not power:
        return None
    if ctrl == power and state in STATES:
        return "Reinforcement"
    if ctrl and ctrl != power and state in STATES:
        return "Undermining"
    if state == "Unoccupied" and power in (s.get("powers") or []):
        return "Acquisition"
    return None


def _cached(key):
    with _lock:
        hit = _search_cache.get(key)
        return hit[0] if hit and time.time() < hit[1] else None


def _store(key, value):
    with _lock:
        _search_cache[key] = (value, time.time() + CACHE_TTL)
        if len(_search_cache) > 200:
            for k in sorted(_search_cache, key=lambda k: _search_cache[k][1])[:50]:
                _search_cache.pop(k, None)


def _row(s):
    stations = [st for st in s.get("stations") or [] if st.get("type") != "Drake-Class Carrier"]
    return {"name": s.get("name"), "distance": round(s.get("distance") or 0, 1), "state": s.get("power_state"),
            "controlling_power": s.get("controlling_power"), "powers": s.get("power") or [],
            "control_progress": s.get("power_state_control_progress"),
            "reinforcement": s.get("power_state_reinforcement"), "undermining": s.get("power_state_undermining"),
            "population": s.get("population") or 0, "economy": s.get("primary_economy"),
            "second_economy": s.get("secondary_economy"), "security": s.get("security"),
            "allegiance": s.get("allegiance"), "faction_state": s.get("controlling_minor_faction_state"),
            "stations": len(stations), "large_pad": any(st.get("has_large_pad") for st in stations),
            "power_contact": any("Powerplay" in (st.get("services") or []) for st in stations),
            "updated": s.get("updated_at")}


def nearby(power="", state="Acquisition", ref="Sol", radius=30):
    """Sistemi vicini a `ref` filtrati per stato Powerplay.

    state: "Acquisition" (Unoccupied con la power presente), "Exploited"/"Fortified"/"Stronghold"
    (controllati dalla power, o da chiunque se power è vuota) oppure "enemy" (controllati da altre power).
    """
    power, ref = (power or "").strip(), (ref or "Sol").strip()
    radius = max(5, min(float(radius or 30), 200))
    key = (power.lower(), state, ref.lower(), radius)
    hit = _cached(key)
    if hit:
        return hit
    filters = {"distance": {"min": "0", "max": str(radius)}}
    if state == "Acquisition":
        filters["power_state"] = {"value": ["Unoccupied"]}
        if power:
            filters["power"] = {"value": [power]}
    elif state in STATES:
        filters["power_state"] = {"value": [state]}
        if power:
            filters["controlling_power"] = {"value": [power]}
    elif state == "enemy":
        filters["power_state"] = {"value": list(STATES)}
    else:
        raise ValueError(pick("Stato Powerplay non valido", "Invalid Powerplay state"))
    payload = {"filters": filters, "sort": [{"distance": {"direction": "asc"}}], "size": 100, "page": 0,
               "reference_system": ref}
    try:
        res = http_json(SYSTEMS_URL, payload, timeout=40)
    except Exception as exc:  # errore di rete: niente cache
        msg = (pick(f"Sistema «{ref}» non trovato: controlla il nome", f"System «{ref}» not found: check the name")
               if isinstance(exc, urllib.error.HTTPError) and exc.code == 400
               else pick("Servizio dati Powerplay non raggiungibile: riprova tra poco",
                         "Powerplay data service unreachable: try again shortly"))
        return {"reference": ref, "state": state, "power": power, "radius": radius, "results": [], "count": 0, "error": msg}
    rows = [_row(s) for s in res.get("results", [])]
    if state == "enemy" and power:
        rows = [r for r in rows if r["controlling_power"] and r["controlling_power"] != power]
    data = {"reference": ref, "state": state, "power": power, "radius": radius, "results": rows[:60],
            "count": res.get("count", len(rows)) if state != "enemy" or not power else len(rows),
            "truncated": res.get("count", 0) > 100, "fetched": time.time()}
    _store(key, data)
    return data
