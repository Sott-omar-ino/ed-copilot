"""Mappa dei sistemi visitati e delle rotte percorse.

Tutto viene dai journal (FSDJump, CarrierJump e Location hanno le coordinate StarPos): nessuna richiesta di rete.
Ogni file viene letto una volta sola e tenuto in cache (in memoria e su disco) con la sua dimensione e data di
modifica; del journal in corso si leggono solo le righe nuove.
"""

import json
import math
import os
import threading
import time

from . import journal, lang, paths, stats, storage
from .lang import pick

CACHE_FILE = paths.cache_file("travelmap.json")
CACHE_VERSION = 1
NEEDED = {"FSDJump", "CarrierJump", "Location", "Docked", "EngineerCraft", "LoadGame", "CarrierLocation", "CarrierStats"}
LIVE_EVENTS = NEEDED

MAX_PATH = 4000     # punti del percorso inviati al massimo
KEEP_FULL = 800     # gli ultimi salti restano sempre a piena risoluzione
PERIODS = {"all", "30d", "session"}

LOCK = threading.Lock()
_FILES = None       # nome file -> {"sig": [mtime, size], "off": byte letti, "rec": [record]}
_DIRTY = True
_CHECKED = 0.0
_RESULT = {}        # periodo -> (generazione, risposta)
_GEN = 0
_SAVED_GEN = -1


# ---------------------------------------------------------------------------
# Lettura dei journal
# ---------------------------------------------------------------------------
def _pos(e):
    p = e.get("StarPos")
    if isinstance(p, list) and len(p) == 3:
        try:
            return [round(float(v), 5) for v in p]
        except (TypeError, ValueError):
            return None
    return None


def _record(t, ev, e):
    """Record compatti (liste, per stare bene nel JSON della cache)."""
    if ev in ("FSDJump", "CarrierJump", "Location"):
        p = _pos(e)
        name = e.get("StarSystem")
        if not p or not name:
            return None
        kind = {"FSDJump": "f", "CarrierJump": "c", "Location": "l"}[ev]
        dist = e.get("JumpDist") if ev == "FSDJump" else None
        rec = ["J", t, name, p[0], p[1], p[2], round(float(dist), 2) if dist else None, kind]
        if ev == "CarrierJump":
            rec.append(e.get("MarketID"))  # la carrier su cui si viaggia (per capire se è la propria)
        return rec
    if ev == "Docked":
        from .state import station_name
        name = station_name(e.get("StationName"), e.get("StationName_Localised"))
        if not name:
            return None
        return ["D", t, name, e.get("StarSystem"), e.get("StationType") or "", e.get("MarketID")]
    if ev == "EngineerCraft":
        return ["E", t, e.get("Engineer") or "?"]
    if ev == "LoadGame":
        return ["S", t]
    if ev == "CarrierLocation":
        if e.get("CarrierType") not in (None, "FleetCarrier"):
            return None
        return ["C", t, e.get("StarSystem"), e.get("CarrierID")]
    if ev == "CarrierStats":
        return ["K", t, e.get("CarrierID"), e.get("Name") or e.get("Callsign")]
    return None


def _read(path, start=0):
    """Legge le righe complete da `start` in poi: (record, nuovo offset)."""
    out = []
    try:
        with open(path, "rb") as f:
            f.seek(start)
            data = f.read()
    except OSError:
        return out, start
    end = data.rfind(b"\n") + 1
    for raw in data[:end].splitlines():
        line = raw.decode("utf-8", errors="replace")
        m = stats.HEAD.match(line)
        if not m or m.group(2) not in NEEDED:
            continue
        try:
            e = json.loads(line)
        except ValueError:
            continue
        t = stats._epoch(e.get("timestamp"))
        if t is None or not isinstance(e, dict):
            continue
        try:
            r = _record(t, e.get("event"), e)
        except Exception as exc:  # un evento strano non deve rovinare la mappa
            print(f"Mappa dei viaggi, errore evento {e.get('event')}: {exc!r}")
            continue
        if r:
            out.append(r)
    return out, start + end


def _load_cache():
    data = storage.load_json(CACHE_FILE, {}) or {}
    if data.get("v") != CACHE_VERSION or not isinstance(data.get("files"), dict):
        return {}
    return data["files"]


def _refresh():
    """Aggiorna la cache dei file cambiati. Va chiamata con LOCK preso. True se qualcosa è cambiato."""
    global _FILES, _GEN
    if _FILES is None:
        _FILES = _load_cache()
        _GEN += 1
    changed = False
    seen = set()
    for path in journal.journal_files():
        name = os.path.basename(path)
        seen.add(name)
        try:
            st = os.stat(path)
        except OSError:
            continue
        sig = [int(st.st_mtime), st.st_size]
        cur = _FILES.get(name)
        if cur and cur.get("sig") == sig:
            continue
        if cur and st.st_size > cur.get("off", 0) and st.st_size >= cur.get("sig", [0, 0])[1]:
            rec, off = _read(path, cur.get("off", 0))  # il file è solo cresciuto: si leggono le righe nuove
            cur["rec"].extend(rec)
            cur["off"], cur["sig"] = off, sig
        else:
            rec, off = _read(path)
            _FILES[name] = {"sig": sig, "off": off, "rec": rec}
        changed = True
    for name in list(_FILES):
        if name not in seen:
            del _FILES[name]
            changed = True
    if changed:
        _GEN += 1
    return changed


def _save():
    global _SAVED_GEN
    with LOCK:
        if _FILES is None or _SAVED_GEN == _GEN:
            return
        data = {"v": CACHE_VERSION, "files": _FILES}
        gen = _GEN
        blob = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    try:
        os.makedirs(os.path.dirname(CACHE_FILE), exist_ok=True)
        tmp = CACHE_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(blob)
        os.replace(tmp, CACHE_FILE)
        _SAVED_GEN = gen
    except OSError as exc:
        print(f"Mappa dei viaggi: cache non salvata ({exc})")


def _records():
    """Tutti i record in ordine di tempo (i file sono ordinati per nome = data di inizio)."""
    out = []
    for name in sorted(_FILES):
        out.extend(_FILES[name]["rec"])
    out.sort(key=lambda r: r[1])  # ordinamento stabile: dentro lo stesso secondo resta l'ordine del file
    return out


# ---------------------------------------------------------------------------
# Elaborazione
# ---------------------------------------------------------------------------
def _d3(a, b):
    return math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2)


def _simplify(points, budget=MAX_PATH, keep_full=KEEP_FULL):
    """Riduce i punti del percorso: le parti vecchie vengono sfoltite tenendo i salti lunghi, le recenti restano intere.

    Un punto vecchio si tiene se dista dall'ultimo tenuto più di una soglia, che raddoppia finché si sta nel budget.
    """
    n = len(points)
    if n <= budget:
        return points, False
    keep_full = min(keep_full, budget // 2)
    old, recent = points[:n - keep_full], points[n - keep_full:]
    target = budget - keep_full
    xs = [p[0] for p in old]
    zs = [p[2] for p in old]
    ys = [p[1] for p in old]
    diag = math.sqrt((max(xs) - min(xs)) ** 2 + (max(ys) - min(ys)) ** 2 + (max(zs) - min(zs)) ** 2) or 1.0
    eps = diag / (target * 4)
    for _ in range(40):
        kept = [old[0]]
        last = old[0]
        for p in old[1:]:
            if p[5] or _d3(p, last) >= eps:  # p[5] = interruzione (rientro/respawn): si tiene sempre
                kept.append(p)
                last = p
        if len(kept) <= target:
            break
        eps *= 1.6
    return kept + recent, True


def _build(period):
    recs = _records()
    now = time.time()
    session_start = None
    for r in recs:
        if r[0] == "S":
            session_start = r[1]
    since = {"all": None, "30d": now - 30 * 86400, "session": session_start}.get(period)

    systems = {}      # nome -> [x, y, z, visite, prima, ultima]
    stations = {}     # (stazione, sistema) -> {...}
    engineers = {}    # ingegnere -> {...}
    carriers = []     # posizioni della propria Fleet Carrier
    own_carrier = None
    path = []         # [x, y, z, t, tipo, interruzione]
    cur_sys, cur_pos = None, None
    fsd_ly = carrier_ly = 0.0
    jumps = carrier_jumps = 0

    for r in recs:
        kind = r[0]
        t = r[1]
        inside = since is None or t >= since
        if kind == "J":
            name, pos, jk = r[2], r[3:6], r[7]
            if jk == "l" and name == cur_sys:
                continue
            prev = cur_pos
            cur_sys, cur_pos = name, pos
            if not inside:
                continue
            s = systems.get(name)
            if s is None:
                systems[name] = [pos[0], pos[1], pos[2], 1, t, t]
            else:
                s[3] += 1
                s[5] = t
            brk = 1 if jk == "l" or not path else 0
            path.append([pos[0], pos[1], pos[2], t, jk, brk])
            if jk == "f":
                jumps += 1
                fsd_ly += r[6] or (_d3(prev, pos) if prev else 0)
            elif jk == "c":
                carrier_jumps += 1
                if prev:
                    carrier_ly += _d3(prev, pos)
        elif kind == "K":
            own_carrier = r[2] or own_carrier
        elif not inside:
            continue
        elif kind == "D":
            system = r[3] or cur_sys
            key = (r[2], system)
            st = stations.get(key)
            if st is None:
                st = stations[key] = {"name": r[2], "system": system, "type": r[4], "count": 0, "first": t, "last": t,
                                      "market_id": r[5]}
            st["count"] += 1
            st["last"] = t
        elif kind == "E":
            en = engineers.get(r[2])
            if en is None:
                en = engineers[r[2]] = {"name": r[2], "system": cur_sys, "crafts": 0, "first": t, "last": t}
            en["crafts"] += 1
            en["last"] = t
            if cur_sys:
                en["system"] = cur_sys
        elif kind == "C" and r[2]:
            if own_carrier and r[3] and r[3] != own_carrier:
                continue
            if not carriers or carriers[-1]["system"] != r[2]:
                carriers.append({"system": r[2], "t": t})

    # Anche i salti fatti a bordo della propria carrier sono posizioni della carrier.
    for r in recs:
        if r[0] == "J" and r[7] == "c" and (since is None or r[1] >= since)                 and (not own_carrier or len(r) < 9 or r[8] == own_carrier):
            carriers.append({"system": r[2], "t": r[1]})
    carriers.sort(key=lambda c: c["t"])
    dedup = []
    for c in carriers:
        if not dedup or dedup[-1]["system"] != c["system"]:
            dedup.append(c)
    carriers = dedup

    def coords_of(name):
        s = systems.get(name)
        if s:
            return s[:3]
        for r in reversed(recs):
            if r[0] == "J" and r[2] == name:
                return r[3:6]
        return None

    places = []
    for st in sorted(stations.values(), key=lambda s: -s["last"]):
        places.append({"kind": "carrier" if st["type"] == "FleetCarrier" else "station", "name": st["name"],
                       "system": st["system"], "pos": coords_of(st["system"]), "count": st["count"],
                       "first": st["first"], "last": st["last"], "type": st["type"]})
    for en in sorted(engineers.values(), key=lambda e: -e["last"]):
        places.append({"kind": "engineer", "name": en["name"], "system": en["system"], "pos": coords_of(en["system"]),
                       "count": en["crafts"], "first": en["first"], "last": en["last"]})
    carrier_now = None
    if carriers:
        last = carriers[-1]
        carrier_now = {"system": last["system"], "pos": coords_of(last["system"]), "t": last["t"]}
        places.append({"kind": "mycarrier", "name": pick("La tua Fleet Carrier", "Your Fleet Carrier"), "system": last["system"],
                       "pos": carrier_now["pos"], "count": len(carriers), "first": carriers[0]["t"], "last": last["t"]})

    far = None
    for name, s in systems.items():
        d = math.sqrt(s[0] ** 2 + s[1] ** 2 + s[2] ** 2)
        if far is None or d > far["dist"]:
            far = {"system": name, "dist": round(d, 1), "pos": s[:3]}

    full = len(path)
    simple, simplified = _simplify(path)
    return {
        "period": period,
        "since": since,
        "session_start": session_start,
        "current": {"system": cur_sys, "pos": cur_pos} if cur_sys else None,
        "systems": [[n, s[0], s[1], s[2], s[3], s[4], s[5]] for n, s in systems.items()],
        "system_fields": ["name", "x", "y", "z", "visits", "first", "last"],
        "path": [[p[0], p[1], p[2], p[3], 1 if p[4] == "c" else 0, p[5]] for p in simple],
        "path_fields": ["x", "y", "z", "t", "carrier", "break"],
        "path_total": full,
        "simplified": simplified,
        "places": places,
        "carrier": carrier_now,
        "stats": {"systems": len(systems), "jumps": jumps, "carrier_jumps": carrier_jumps,
                  "distance": round(fsd_ly, 1), "carrier_distance": round(carrier_ly, 1), "farthest": far},
        "time_range": [path[0][3], path[-1][3]] if path else None,
    }


def get(q=None, save=True):
    global _CHECKED, _DIRTY
    period = (q or {}).get("period", "all")
    if period not in PERIODS:
        period = "all"
    with LOCK:
        if _FILES is None or _DIRTY or time.time() - _CHECKED > 10:
            _refresh()
            _CHECKED, _DIRTY = time.time(), False
        hit = _RESULT.get(period)
        ui_lang = lang.current()  # il risultato contiene un testo visibile: la cache vale per una lingua
        if hit and hit[0] == _GEN and hit[3] == ui_lang and (period != "30d" or time.time() - hit[2] < 3600):
            return hit[1]
        res = _build(period)
        _RESULT[period] = (_GEN, res, time.time(), ui_lang)
    if save:
        threading.Thread(target=_save, daemon=True).start()
    return res


def _on_event(e):
    global _DIRTY
    if e.get("event") in LIVE_EVENTS:
        _DIRTY = True  # alla prossima richiesta si leggono le righe nuove del journal


def start():
    """Prepara la cache in background così la prima apertura della scheda è immediata."""
    journal.add_listener(_on_event)
    try:
        get({"period": "all"}, save=False)
        _save()
    except Exception as exc:
        print(f"Mappa dei viaggi: {exc!r}")


GET = {"/api/travelmap": lambda q: get(q)}
POST = {}
LAN = set()
