"""Valore dei corpi scansionati (FSS/DSS) e consigli su cosa mappare.

Formula del valore (Universal Cartographics, dalla 3.3 in poi): è quella ricavata da MattG nel thread
"Exploration value formulae" (https://forums.frontier.co.uk/threads/exploration-value-formulae.232000/),
la stessa usata da EDDiscovery (EliteDangerousCore/.../Enumerations/EstimatedValues.cs), EDDI
(DataDefinitions/Body.cs) ed EDMC-Pioneer (src/pioneer/body_calc.py). Verificata su quei sorgenti a nov. 2026.

  Stelle:   v = k + m * k / 66.25        (m = massa in masse solari; k = 1200, nane bianche 14057,
                                          neutroni/buchi neri 22628)  x2.6 se primo a scoprirla.
  Pianeti:  v = k + k * q * m^0.2        (m = massa in masse terrestri, q = 0.56591828; k per tipo,
                                          + k_terraform se terraformabile)
            mappato: v *= 3.699622554 (primo a scoprirlo e mapparlo) | 8.0956 (primo a mapparlo)
                          | 3.3333333 (già mappato)
                     poi bonus Odyssey (4.0+): v += max(v * 0.3, 555)
                     mappatura efficiente (sonde <= obiettivo): v *= 1.25
            minimo 500 CR, infine x2.6 se primo a scoprirlo.
  Caso speciale (EDDI): corpi "non scoperti" ma già mappati (vecchia bolla pre-Odyssey) non prendono
  né il bonus Odyssey né il x2.6.
  Bonus di sistema (EDMC-Pioneer): 1000 CR per corpo se sei il primo a completare la scansione FSS
  (FSSAllBodiesFound), 10000 CR per pianeta se sei il primo a mapparli tutti.
"""

import threading
import time

from . import journal, paths, storage, voice
from .journal import STATE
from .lang import is_en, pick

CONFIG_FILE = paths.user_file("exploration_config.json")
DEFAULT_CONFIG = {"voice": True, "feed": True, "min_map_value": 500_000, "announce_terraformable": True}
SPECIAL = {"Earthlike body": "Earth-like", "Water world": "Water world", "Ammonia world": "Ammonia world"}
QUIET_S = 4.0          # dopo l'ultimo evento di scansione aspetta così prima di parlare (raggruppa gli annunci)

Q = 0.56591828
_lock = threading.Lock()
_announced = {}        # indirizzo sistema -> set di BodyID già annunciati
_pending = {"since": 0.0}
_wake = threading.Event()
_started = False


# --- Formula ----------------------------------------------------------------------------

def star_k(cls):
    cls = cls or ""
    if cls in ("N", "H"):
        return 22628
    if cls.startswith("D"):
        return 14057
    if cls == "SupermassiveBlackHole":
        return 33.5678
    return 1200


def planet_k(cls, terraformable):
    """(k, k_terraform) dalla tabella di MattG."""
    if cls == "Metal rich body":
        k, kt = 21790, 65631
    elif cls == "Ammonia world":
        k, kt = 96932, 0
    elif cls == "Sudarsky class I gas giant":
        k, kt = 1656, 0
    elif cls in ("Sudarsky class II gas giant", "High metal content body"):
        k, kt = 9654, 100677
    elif cls == "Water world":
        k, kt = 64831, 116295
    elif cls == "Earthlike body":
        return 64831 + 116295          # sempre col bonus pieno
    else:
        k, kt = 300, 93328
    return k + (kt if terraformable else 0)


def star_value(cls, mass, first):
    k = star_k(cls)
    v = k + (mass or 1.0) * k / 66.25
    return round(v * (2.6 if first else 1))


def planet_value(cls, mass, terraformable, first_disc, first_map, mapped, efficient, odyssey=True):
    k = planet_k(cls, terraformable)
    v = k + k * Q * max(mass or 1.0, 0) ** 0.2
    pre_odyssey_bubble = first_disc and not first_map
    if mapped:
        if first_disc and first_map:
            v *= 3.699622554
        elif first_map:
            v *= 8.0956
        else:
            v *= 3.3333333333
        if odyssey and not pre_odyssey_bubble:
            v += max(v * 0.3, 555)
        if efficient:
            v *= 1.25
    v = max(500, v)
    if first_disc and not pre_odyssey_bubble:
        v *= 2.6
    return round(v)


def appraise(b):
    """Valori del corpo dallo stato del journal: ora, se mappato (efficiente) e flag utili."""
    first_disc = b.get("was_discovered") is False
    first_map = b.get("was_mapped") is False
    if b.get("kind") == "star":
        v = star_value(b.get("cls"), b.get("mass"), first_disc)
        return {"now": v, "if_mapped": None, "mappable": False}
    if b.get("kind") != "planet":
        return {"now": None, "if_mapped": None, "mappable": False}
    args = (b.get("cls"), b.get("mass"), bool(b.get("terraformable")), first_disc, first_map)
    mapped = bool(b.get("mapped_by_me"))
    return {"now": planet_value(*args, mapped, bool(b.get("efficient"))),
            "if_mapped": planet_value(*args, True, True),
            "if_mapped_plain": planet_value(*args, True, False),
            "scan_only": planet_value(*args, False, False),
            "mappable": True}


# --- Configurazione ----------------------------------------------------------------------

def load_config():
    data = storage.load_json(CONFIG_FILE, {})
    cfg = {**DEFAULT_CONFIG, **(data if isinstance(data, dict) else {})}
    try:
        cfg["min_map_value"] = max(0, min(50_000_000, int(cfg["min_map_value"])))
    except (TypeError, ValueError):
        cfg["min_map_value"] = DEFAULT_CONFIG["min_map_value"]
    return cfg


def save_config(changes):
    cfg = {**load_config(), **{k: v for k, v in (changes or {}).items() if k in DEFAULT_CONFIG}}
    for k in ("voice", "feed", "announce_terraformable"):
        cfg[k] = bool(cfg[k])
    storage.save_json(CONFIG_FILE, cfg)
    return status()


# --- Analisi del sistema -----------------------------------------------------------------

def _worth(b, val, cfg):
    """Motivo per cui vale la pena mapparlo (o None)."""
    if b.get("kind") != "planet" or b.get("mapped_by_me"):
        return None
    if b.get("cls") in SPECIAL:
        return SPECIAL[b["cls"]]
    if b.get("terraformable") and cfg["announce_terraformable"]:
        return pick("terraformabile", "terraformable")
    if (val.get("if_mapped") or 0) >= cfg["min_map_value"]:
        return pick("valore alto", "high value")
    return None


def _short(name, sysname):
    if name and sysname and name.startswith(sysname) and name != sysname:
        return name[len(sysname):].strip()
    return name


def system_report(cfg=None):
    cfg = cfg or load_config()
    with STATE.lock:
        sy = STATE.system
        raw = [dict(b) for b in sy["bodies"].values()]
        info = {"name": sy["name"], "address": sy["address"], "body_count": sy["body_count"],
                "non_bodies": sy["non_bodies"], "all_found": sy["all_found"]}
        unsold = {"carto": sum(sum(v.values()) for v in STATE.carto_unsold.values()),
                  "carto_systems": len(STATE.carto_unsold),
                  "bio": sum(u["value"] for u in STATE.bio_unsold), "bio_samples": len(STATE.bio_unsold)}
    bodies = []
    for b in raw:
        if b.get("kind") == "unknown" and not b.get("bio") and not b.get("geo"):
            continue
        val = appraise(b)
        why = _worth(b, val, cfg)
        bodies.append({
            "id": b.get("id"), "name": b.get("name"), "short": _short(b.get("name"), info["name"]),
            "kind": b.get("kind"), "cls": b.get("cls"), "dist": b.get("dist"),
            "terraformable": bool(b.get("terraformable")), "landable": bool(b.get("landable")),
            "first_discovery": b.get("was_discovered") is False and b.get("kind") != "unknown",
            "first_map": b.get("kind") == "planet" and b.get("was_mapped") is False,
            "was_mapped": bool(b.get("was_mapped")), "mapped_by_me": bool(b.get("mapped_by_me")),
            "efficient": bool(b.get("efficient")), "scanned": b.get("kind") != "unknown",
            "bio": b.get("bio") or 0, "geo": b.get("geo") or 0, "genuses": b.get("genuses") or [],
            "value_now": val["now"], "value_mapped": val.get("if_mapped"), "worth": why})
    bodies.sort(key=lambda x: -max(x["value_mapped"] or 0, x["value_now"] or 0))

    scanned = [b for b in bodies if b["scanned"]]
    planets = [b for b in scanned if b["kind"] == "planet"]
    total_now = sum(b["value_now"] or 0 for b in scanned)
    potential = sum((b["value_now"] if b["mapped_by_me"] or b["kind"] != "planet" else b["value_mapped"]) or 0 for b in scanned)
    worth = [b for b in bodies if b["worth"]]
    # Bonus di sistema: solo se nessun corpo era già noto (sei il primo in assoluto).
    virgin = bool(scanned) and all(b["first_discovery"] for b in scanned)
    bonus_fss = ((info["body_count"] or 0) + (info["non_bodies"] or 0)) * 1000 if virgin and info["all_found"] else 0
    all_mapped = bool(planets) and all(b["mapped_by_me"] for b in planets)
    bonus_map = len(planets) * 10000 if virgin and info["all_found"] and all(b["first_map"] for b in planets) else 0
    return {"system": {**info, "scanned": len([b for b in bodies if b["scanned"]])},
            "bodies": bodies, "worth": [b["id"] for b in worth],
            "totals": {"now": total_now + bonus_fss + (bonus_map if all_mapped else 0),
                       "potential": potential + bonus_fss + bonus_map,
                       "bonus_fss": bonus_fss, "bonus_map": bonus_map, "virgin": virgin,
                       "worth_value": sum(b["value_mapped"] or 0 for b in worth)},
            "unsold": unsold}


def status():
    cfg = load_config()
    return {"config": cfg, **system_report(cfg)}


# --- Annuncio a voce / nel ticker ------------------------------------------------------------

_NUM = {1: "un", 2: "due", 3: "tre", 4: "quattro", 5: "cinque", 6: "sei", 7: "sette", 8: "otto", 9: "nove"}
_NUM_EN = {1: "one", 2: "two", 3: "three", 4: "four", 5: "five", 6: "six", 7: "seven", 8: "eight", 9: "nine"}


def compose_announcement(worth):
    """'Nel sistema ci sono un Earth-like e due terraformabili: vale la pena mapparli.'"""
    groups = {}
    for b in worth:
        key = SPECIAL.get(b["cls"]) or ("terraformabile" if b["terraformable"] else "valore alto")
        groups.setdefault(key, []).append(b)
    en = is_en()
    parts = []
    for key in ("Earth-like", "Water world", "Ammonia world"):
        if key in groups:
            n = len(groups[key])
            parts.append(f"{_NUM_EN.get(n, n)} {key}{'s' if n > 1 else ''}" if en else f"{_NUM.get(n, n)} {key}")
    if "terraformabile" in groups:
        n = len(groups["terraformabile"])
        parts.append(pick("un terraformabile" if n == 1 else f"{_NUM.get(n, n)} terraformabili",
                          "one terraformable" if n == 1 else f"{_NUM_EN.get(n, n)} terraformables"))
    if "valore alto" in groups:
        n = len(groups["valore alto"])
        parts.append(pick("un corpo di valore alto" if n == 1 else f"{_NUM.get(n, n)} corpi di valore alto",
                          "one high-value body" if n == 1 else f"{_NUM_EN.get(n, n)} high-value bodies"))
    if not parts:
        return None, None
    listed = parts[0] if len(parts) == 1 else ", ".join(parts[:-1]) + pick(" e ", " and ") + parts[-1]
    many = len(worth) > 1
    total = sum(b["value_mapped"] or 0 for b in worth)
    first = sum(1 for b in worth if b["first_discovery"])
    if en:
        spoken = f"This system has {listed}: {'they are' if many else 'it is'} worth mapping."
        if first:
            spoken += (" Nobody has discovered it yet." if not many else " Nobody has discovered them yet." if first == len(worth)
                       else " Some of them are still undiscovered.")
    else:
        verb = "ci sono" if many else "c'è"
        spoken = f"Nel sistema {verb} {listed}: vale la pena {'mapparli' if many else 'mapparlo'}."
        if first:
            spoken += (" Nessuno l'ha ancora scoperto." if not many else " Nessuno li ha ancora scoperti." if first == len(worth)
                       else " Alcuni non li ha ancora scoperti nessuno.")
    labels = []
    for b in worth:
        kind = SPECIAL.get(b["cls"]) or b["cls"] or "?"
        labels.append("%s (%s%s)" % (b["short"] or b["name"], kind,
                                     pick(", terraform.", ", terraformable") if b["terraformable"] else ""))
    text = pick("Da mappare: %s · ~%s CR se mappati", "To map: %s · ~%s CR if mapped") % (", ".join(labels), _fmt(total))
    return spoken, text


def _fmt(n):
    return f"{int(n):,}".replace(",", ".")


def _announce_now():
    cfg = load_config()
    if not (cfg["voice"] or cfg["feed"]):
        return
    rep = system_report(cfg)
    addr = rep["system"]["address"]
    if addr is None:
        return
    with _lock:
        done = _announced.setdefault(addr, set())
        new = [b for b in rep["bodies"] if b["worth"] and b["id"] not in done]
        done.update(b["id"] for b in new)
        if len(_announced) > 50:
            for k in list(_announced)[:-50]:
                del _announced[k]
    if not new:
        return
    spoken, text = compose_announcement(new)
    if not spoken:
        return
    if cfg["feed"]:
        ts = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        with STATE.lock:
            STATE.note(ts, text, "gold")
    if cfg["voice"] and voice.load_config().get("enabled"):
        voice.say(spoken)
    print(f"[Esplorazione] {text}")


def _on_event(e):
    ev = e.get("event")
    if ev in ("FSSDiscoveryScan", "FSSAllBodiesFound", "Scan", "FSSBodySignals"):
        _pending["since"] = time.time()
        _wake.set()
    elif ev in ("FSDJump", "CarrierJump"):
        _pending["since"] = 0.0


def _loop():
    while True:
        _wake.wait(timeout=30)
        _wake.clear()
        while _pending["since"]:
            wait = _pending["since"] + QUIET_S - time.time()
            if wait > 0:
                time.sleep(min(wait, QUIET_S))
                continue
            _pending["since"] = 0.0
            try:
                _announce_now()
            except Exception as exc:
                print(f"[Esplorazione] {exc!r}")


def start():
    global _started
    with _lock:
        if _started:
            return
        _started = True
    # Al primo avvio non annunciare il sistema già letto dallo storico: solo le scansioni nuove.
    deadline = time.time() + 90
    while not STATE.live and time.time() < deadline:
        time.sleep(1)
    rep = system_report()
    addr = rep["system"]["address"]
    if addr is not None:
        with _lock:
            _announced[addr] = {b["id"] for b in rep["bodies"] if b["worth"]}
    journal.add_listener(_on_event)
    threading.Thread(target=_loop, name="exploration", daemon=True).start()


# API registrate dal server (stesse firme di server.GET / server.POST).
GET = {"/api/exploration": lambda q: status()}
POST = {"/api/exploration/config": lambda body, q: save_config(body)}
# Percorsi che il companion sul telefono può usare.
LAN = {"/api/exploration"}
