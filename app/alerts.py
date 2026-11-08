"""Avvisi prezzi: regole sulle merci controllate periodicamente su Spansh, con avviso nel ticker e a voce.

Una regola dice per esempio "Platinum venduto ad almeno 250.000 CR entro 80 al": ogni N minuti (e quando
cambi sistema, con un limite di frequenza) il controllore interroga la ricerca stazioni di Spansh, una regola
alla volta, e avvisa solo per le stazioni NUOVE (stazione + merce + fascia di prezzo già segnalate vengono
ricordate per qualche ora, anche dopo un riavvio).
"""

import datetime
import threading
import time
import uuid

from . import journal, paths, search, storage, voice
from .journal import STATE
from .lang import pick
from .spansh import http_json

SEARCH_URL = "https://spansh.co.uk/api/stations/search"
CONFIG_FILE = paths.user_file("price_alerts_config.json")
MEMORY_FILE = paths.cache_file("price_alerts_sent.json")
DEFAULT_CONFIG = {"interval_min": 15, "voice": True, "feed": True}
MIN_INTERVAL_MIN = 5
SYSTEM_GAP_S = 5 * 60         # dopo un salto, una regola già controllata da meno di così non viene ripetuta
MANUAL_GAP_S = 30             # "Controlla ora" ripetuto a raffica: niente richieste doppie
SENT_TTL_S = 6 * 3600         # per quanto tempo una stazione già segnalata non viene ripetuta
MAX_RULES = 20
MAX_RECENT = 60
RESULTS_PER_RULE = 10          # le migliori 10 per regola: abbastanza, senza inondare il ticker
TIMEOUT_S = 20
PAD_RANK = {"S": 0, "M": 1, "L": 2}
PLANETARY_TYPES = {"Planetary Outpost", "Planetary Port", "Settlement", "Planetary Construction Depot"}


# --- Regole -----------------------------------------------------------------------

def _num(v, default, lo, hi, cast=float):
    try:
        x = cast(float(v))
    except (TypeError, ValueError):
        return default
    return max(lo, min(hi, x))


def normalize_commodity(name):
    name = " ".join(str(name or "").split())[:80]
    alias = search.COMMODITY_ALIASES.get(name.lower())
    if alias:
        return alias
    # Spansh distingue maiuscole e minuscole: "platinum" non trova nulla, "Platinum" sì.
    if name and (name.islower() or name.isupper()):
        name = " ".join(w[:1].upper() + w[1:].lower() for w in name.split(" "))
    return name


def clean_rule(r):
    commodity = normalize_commodity(r.get("commodity"))
    threshold = _num(r.get("threshold"), 0, 0, 10**9, int)
    if not commodity or threshold <= 0:
        return None
    kind = r.get("kind") if r.get("kind") in ("sell", "buy") else "sell"
    pad = str(r.get("pad") or "S").upper()[:1]
    return {
        "id": str(r.get("id") or "")[:40] or uuid.uuid4().hex[:8],
        "commodity": commodity, "kind": kind, "threshold": threshold,
        "min_qty": _num(r.get("min_qty"), 1, 1, 10**8, int),
        "radius": _num(r.get("radius"), 50, 1, 1000),
        "reference": " ".join(str(r.get("reference") or "").split())[:100],
        "pad": pad if pad in PAD_RANK else "S",
        "carriers": bool(r.get("carriers", False)), "planetary": bool(r.get("planetary", True)),
        "max_age_h": _num(r.get("max_age_h"), 24, 1, 24 * 90, int),
        "enabled": bool(r.get("enabled", True)),
        "created": str(r.get("created") or time.strftime("%Y-%m-%dT%H:%M:%S"))[:25],
    }


RULES = storage.ListStore("price_alerts.json", clean_rule)


def describe(rule):
    op = pick("vendita ≥", "sell ≥") if rule["kind"] == "sell" else pick("acquisto ≤", "buy ≤")
    where = rule["reference"] or pick("sistema attuale", "current system")
    return pick(f"{rule['commodity']} {op} {rule['threshold']:,} CR entro {rule['radius']:g} al da {where}",
                f"{rule['commodity']} {op} {rule['threshold']:,} CR within {rule['radius']:g} ly of {where}").replace(",", ".")


# --- Configurazione e memoria ---------------------------------------------------------

_lock = threading.RLock()          # protegge le strutture qui sotto
_check_lock = threading.Lock()     # un solo controllo alla volta: richieste sequenziali a Spansh
_wake = threading.Event()
_started = False
_sent = {}                          # chiave -> momento dell'avviso
_recent = []                        # avvisi recenti, il più nuovo per primo
_rule_state = {}                    # id regola -> {last_check, error, matches, best}
_status = {"last_check": None, "last_error": None, "checking": False, "next_check": None}
_trigger = {"system": False}   # cambio di sistema in attesa di controllo


def load_config():
    data = storage.load_json(CONFIG_FILE, {})
    cfg = {**DEFAULT_CONFIG, **(data if isinstance(data, dict) else {})}
    cfg["interval_min"] = _num(cfg.get("interval_min"), 15, MIN_INTERVAL_MIN, 24 * 60, int)
    return cfg


def save_config(changes):
    cfg = {**load_config(), **{k: v for k, v in (changes or {}).items() if k in DEFAULT_CONFIG}}
    cfg["interval_min"] = _num(cfg.get("interval_min"), 15, MIN_INTERVAL_MIN, 24 * 60, int)
    cfg["voice"], cfg["feed"] = bool(cfg["voice"]), bool(cfg["feed"])
    storage.save_json(CONFIG_FILE, cfg)
    _wake.set()   # il nuovo intervallo vale subito
    return status()


def _load_memory():
    data = storage.load_json(MEMORY_FILE, {}) or {}
    now = time.time()
    with _lock:
        _sent.update({k: v for k, v in (data.get("sent") or {}).items() if isinstance(v, (int, float)) and now - v < SENT_TTL_S})
        _recent[:] = [a for a in (data.get("recent") or []) if isinstance(a, dict)][:MAX_RECENT]


def _save_memory():
    with _lock:
        now = time.time()
        for k in [k for k, v in _sent.items() if now - v >= SENT_TTL_S]:
            del _sent[k]
        data = {"sent": dict(_sent), "recent": list(_recent)}
    try:
        storage.save_json(MEMORY_FILE, data)
    except OSError as exc:
        print(f"[Avvisi prezzi] Memoria non salvata: {exc}")


# --- Ricerca su Spansh -------------------------------------------------------------------

def _iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _age_h(ts):
    try:
        t = datetime.datetime.fromisoformat(str(ts).replace("Z", "+00:00").replace(" ", "T"))
        if t.tzinfo is None:
            t = t.replace(tzinfo=datetime.timezone.utc)
        return round((datetime.datetime.now(datetime.timezone.utc) - t).total_seconds() / 3600, 1)
    except (TypeError, ValueError):
        return None


def _pad(r):
    if r.get("has_large_pad") or (r.get("large_pads") or 0) > 0:
        return "L"
    if (r.get("medium_pads") or 0) > 0:
        return "M"
    return "S"


def build_query(rule, ref):
    """Filtri della ricerca stazioni di Spansh (sintassi verificata sull'API reale)."""
    price_key = "sell_price" if rule["kind"] == "sell" else "buy_price"
    qty_key = "demand" if rule["kind"] == "sell" else "supply"
    price = ([str(rule["threshold"]), "999999999"] if rule["kind"] == "sell"
             else ["1", str(rule["threshold"])])  # prezzo d'acquisto 0 = la stazione non la vende
    now = datetime.datetime.now(datetime.timezone.utc)
    filters = {
        "market": [{"name": rule["commodity"],
                    price_key: {"value": price, "comparison": "<=>"},
                    qty_key: {"value": [str(rule["min_qty"]), "999999999"], "comparison": "<=>"}}],
        "distance": {"min": "0", "max": str(float(rule["radius"]))},
        "market_updated_at": {"value": [_iso(now - datetime.timedelta(hours=rule["max_age_h"])), _iso(now + datetime.timedelta(hours=1))],
                              "comparison": "<=>"},
    }
    if not rule["carriers"]:
        types = [t for t in search.NON_CARRIER_TYPES if rule["planetary"] or t not in PLANETARY_TYPES]
        filters["type"] = {"value": types}
    if not rule["planetary"]:
        filters["is_planetary"] = {"value": False}
    if rule["pad"] == "L":
        filters["has_large_pad"] = {"value": True}
    elif rule["pad"] == "M":
        filters["medium_pads"] = {"value": ["1", "999"], "comparison": "<=>"}
    sort_dir = "desc" if rule["kind"] == "sell" else "asc"
    return {"filters": filters, "sort": [{f"market_{price_key}": [{"name": rule["commodity"], "direction": sort_dir}]}],
            "size": RESULTS_PER_RULE, "page": 0, "reference_system": ref}


def find_matches(rule, ref):
    res = http_json(SEARCH_URL, build_query(rule, ref), timeout=TIMEOUT_S)
    if res.get("error"):
        raise ValueError(res["error"])
    out = []
    for r in res.get("results", []):
        m = next((x for x in r.get("market") or [] if x.get("commodity") == rule["commodity"]), None)
        if not m:
            continue
        price = m.get("sell_price") if rule["kind"] == "sell" else m.get("buy_price")
        ok = price and (price >= rule["threshold"] if rule["kind"] == "sell" else price <= rule["threshold"])
        pad = _pad(r)
        if not ok or PAD_RANK[pad] < PAD_RANK[rule["pad"]]:
            continue  # doppio controllo: Spansh a volte ha i pad incompleti
        updated = r.get("market_updated_at") or r.get("updated_at")
        out.append({"station": r.get("name"), "system": r.get("system_name"), "type": r.get("type"),
                    "market_id": r.get("market_id"), "distance": r.get("distance"), "dist_ls": r.get("distance_to_arrival"),
                    "pad": pad, "planetary": bool(r.get("is_planetary")), "price": price,
                    "supply": m.get("supply"), "demand": m.get("demand"), "updated": updated, "age_h": _age_h(updated)})
    return {"reference": (res.get("reference") or {}).get("name") or ref, "count": res.get("count"), "results": out}


def _bucket(rule, price):
    step = max(100, int(rule["threshold"] * 0.02))   # fasce del 2% della soglia: piccole oscillazioni non riavvisano
    return int(price // step)


def _key(rule, m):
    return f"{rule['kind']}|{rule['commodity']}|{m['system']}|{m['station']}|{_bucket(rule, m['price'])}"


# --- Avvisi ---------------------------------------------------------------------------------

def _fmt(n):
    return f"{int(n):,}".replace(",", ".")


def _announce(rule, new):
    cfg = load_config()
    best = new[0]
    verb = pick("vendibile a", "sells for") if rule["kind"] == "sell" else pick("in vendita a", "on sale for")
    n_more = len(new) - 1
    more = pick(f" (+{n_more} altre stazioni)", f" (+{n_more} more station{'s' if n_more != 1 else ''})") if len(new) > 1 else ""
    text = pick(f"Avviso prezzi: {rule['commodity']} {verb} {_fmt(best['price'])} CR a {best['station']} "
                f"({best['system']}, {best['distance']:.0f} al){more}",
                f"Price alert: {rule['commodity']} {verb} {_fmt(best['price'])} CR at {best['station']} "
                f"({best['system']}, {best['distance']:.0f} ly){more}")
    if cfg["feed"]:
        ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        with STATE.lock:   # il feed è protetto dal lock dello stato, come per gli eventi del journal
            STATE.note(ts, text, "gold")
    if cfg["voice"] and voice.load_config().get("enabled"):
        spoken = pick(f"Avviso prezzi. {rule['commodity']} {verb} {_fmt(best['price'])} crediti a {best['station']}, "
                      f"sistema {best['system']}, {best['distance']:.0f} anni luce.",
                      f"Price alert. {rule['commodity']} {verb} {best['price']:,} credits at {best['station']}, "
                      f"in {best['system']}, {best['distance']:.0f} light years.")
        if len(new) > 1:
            spoken += pick(f" Altre {n_more} stazioni nell'elenco.",
                           f" {n_more} more station{'s' if n_more != 1 else ''} in the list.")
        voice.say(spoken)
    print(f"[Avvisi prezzi] {text}")


def _check_rule(rule):
    ref = rule["reference"] or search.current_system(None)
    st = _rule_state.setdefault(rule["id"], {})
    st["last_check"] = time.time()
    if not ref:
        st.update(error=pick("Sistema attuale sconosciuto: indica un sistema di riferimento",
                             "Current system unknown: enter a reference system"), matches=0)
        return []
    try:
        found = find_matches(rule, ref)
    except Exception as exc:
        st["error"] = pick(f"Servizio di ricerca non raggiungibile: {exc}", f"Search service unreachable: {exc}")
        raise
    now = time.time()
    st.update(error=None, matches=len(found["results"]), total=found["count"], reference=found["reference"],
              best=found["results"][0]["price"] if found["results"] else None)
    new = []
    with _lock:
        for m in found["results"]:
            k = _key(rule, m)
            if now - _sent.get(k, 0) < SENT_TTL_S:
                continue
            _sent[k] = now
            alert = {"id": uuid.uuid4().hex[:10], "rule_id": rule["id"], "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                     "commodity": rule["commodity"], "kind": rule["kind"], "threshold": rule["threshold"],
                     "reference": found["reference"], **m}
            new.append(alert)
        _recent[:0] = new
        del _recent[MAX_RECENT:]
    if new:
        _announce(rule, new)
    return new


def _run_checks(rule_ids=None, min_gap=0):
    """Controlla le regole attive una dopo l'altra. Restituisce gli avvisi nuovi."""
    with _check_lock:
        rules = [r for r in RULES.load() if r.get("enabled")][:MAX_RULES]
        if rule_ids is not None:
            rules = [r for r in rules if r["id"] in rule_ids]
        _status["checking"] = True
        new, errors = [], []
        try:
            for rule in rules:
                last = _rule_state.get(rule["id"], {}).get("last_check") or 0
                if min_gap and time.time() - last < min_gap:
                    continue
                try:
                    new += _check_rule(rule)
                except Exception as exc:
                    errors.append(f"{rule['commodity']}: {exc}")
        finally:
            _status.update(checking=False, last_check=time.time(), last_error="; ".join(errors) or None)
        _save_memory()
        return new


# --- Controllore in background -------------------------------------------------------------

def _on_event(e):
    if e.get("event") in ("FSDJump", "CarrierJump", "Location"):
        _trigger["system"] = True
        _wake.set()


def _loop():
    # Aspetta che il journal sia letto (serve il sistema attuale), ma non all'infinito.
    deadline = time.time() + 90
    while not STATE.live and time.time() < deadline:
        time.sleep(2)
    last_full = 0.0
    while True:
        interval = load_config()["interval_min"] * 60
        _status["next_check"] = last_full + interval if last_full else time.time()
        try:
            if time.time() - last_full >= interval:
                last_full = time.time()
                _trigger["system"] = False
                _run_checks()
            elif _trigger["system"]:
                _trigger["system"] = False
                # Solo le regole legate al sistema attuale; ognuna al massimo una volta ogni SYSTEM_GAP_S.
                ids = {r["id"] for r in RULES.load() if not r.get("reference")}
                if ids:
                    _run_checks(ids, min_gap=SYSTEM_GAP_S)
        except Exception as exc:
            _status["last_error"] = str(exc)
            print(f"[Avvisi prezzi] {exc}")
        _status["next_check"] = last_full + interval
        _wake.wait(timeout=max(5, min(60, last_full + interval - time.time())))
        _wake.clear()


def start():
    """Avvia il controllore (una volta sola). Non blocca."""
    global _started
    with _lock:
        if _started:
            return
        _started = True
    _load_memory()
    journal.add_listener(_on_event)
    threading.Thread(target=_loop, name="price-alerts", daemon=True).start()


# --- API per l'interfaccia ---------------------------------------------------------------

def status():
    cfg = load_config()
    with _lock:
        rules = []
        for r in RULES.load():
            st = dict(_rule_state.get(r["id"], {}))
            rules.append({**r, "label": describe(r), "last_check": st.get("last_check"), "error": st.get("error"),
                          "matches": st.get("matches"), "total": st.get("total"), "best": st.get("best"),
                          "checked_from": st.get("reference")})
        return {"config": cfg, "rules": rules, "recent": list(_recent), "running": _started,
                "checking": _status["checking"], "last_check": _status["last_check"],
                "next_check": _status["next_check"], "last_error": _status["last_error"],
                "current_system": search.current_system(None), "min_interval": MIN_INTERVAL_MIN}


def save_rule(body):
    """Aggiunge una regola o ne aggiorna una esistente (stesso id: i campi mancanti restano com'erano)."""
    body = body or {}
    rules = RULES.load()
    old = next((r for r in rules if body.get("id") and r["id"] == body["id"]), None)
    rule = clean_rule({**(old or {}), **body})
    if not rule:
        raise ValueError(pick("Serve una merce e una soglia di prezzo maggiore di zero",
                             "Enter a commodity and a price threshold above zero"))
    if old:
        rules = [rule if r["id"] == old["id"] else r for r in rules]
    else:
        if len(rules) >= MAX_RULES:
            raise ValueError(pick(f"Al massimo {MAX_RULES} avvisi", f"{MAX_RULES} alerts at most"))
        rules.append(rule)
    RULES.save(rules)
    if rule["enabled"] and (not old or old != rule):
        with _lock:
            _rule_state.pop(rule["id"], None)
        threading.Thread(target=_run_checks, args=({rule["id"]},), daemon=True).start()   # primo controllo subito
    return status()


def delete_rule(rule_id):
    RULES.save([r for r in RULES.load() if r["id"] != rule_id])
    with _lock:
        _rule_state.pop(rule_id, None)
    return status()


def check_now(rule_id=None):
    """Controlla subito una regola (o tutte) e aspetta il risultato."""
    new = _run_checks({rule_id} if rule_id else None, min_gap=MANUAL_GAP_S)
    return {**status(), "new": len(new)}


def clear_recent():
    with _lock:
        _recent.clear()
    _save_memory()
    return status()


def forget_sent():
    """Dimentica le stazioni già segnalate: al prossimo controllo riavvisa tutto."""
    with _lock:
        _sent.clear()
    _save_memory()
    return status()
