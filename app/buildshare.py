"""Esportazione e importazione delle build (Coriolis / EDSY / Loadout del journal).

Formati verificati sul codice sorgente (novembre 2026):
- Coriolis: https://coriolis.io/import?data=<dati>. Coriolis legge il parametro con decodeURIComponent, lo decodifica
  da base64 e lo decomprime con pako.inflate (che riconosce da solo gzip e zlib); accetta un evento Loadout del journal
  (oggetto con Ship e Modules) o un array SLEF ([{header, data: Loadout}]).
  Fonte: https://github.com/EDCD/coriolis/blob/develop/src/app/Coriolis.jsx (_importBuild) e Router.js
  (il parser della query tiene solo il testo prima del secondo "=": per questo il padding va scritto %3D).
- EDSY: https://edsy.org/#/I=<dati>. importData() fa decodeURIComponent, base64 URL-safe, pako.inflate e poi accetta
  eventi del journal (serve "event": "Loadout") o SLEF. Fonte: https://edsy.org/edsy.js (processURLHash, importData).
- Dati: JSON compatto -> gzip -> base64 URL-safe, "=" -> "%3D". È esattamente quello che fa EDMarketConnector
  (plugins/common_coreutils.py, shipyard_url_common; plugins/coriolis.py e plugins/edsy.py).
- Nomi degli slot di ogni nave: ship-slots.json di Coriolis (EDCD/coriolis-data, MIT), pubblicato su
  https://coriolis.io/ship-slots.json. Una copia compatta sta in defaults/ship_slots.json e si riaggiorna ogni 14 giorni.

Non si esegue nulla di ciò che arriva: solo JSON, con limiti di dimensione e una lista di campi ammessi.
"""

import base64
import binascii
import gzip
import json
import os
import re
import threading
import time
import urllib.parse
import urllib.request
import zlib

from . import paths
from .lang import pick
from .gamedata import COSMETIC_SLOTS

SLOTS_SOURCE = "https://coriolis.io/ship-slots.json"
SLOTS_CACHE = paths.cache_file("ship_slots.json")
SLOTS_SEED = paths.default_file("ship_slots.json")
SLOTS_MAX_AGE = 14 * 86400

MAX_TEXT = 200_000          # testo incollato
MAX_INFLATED = 1_000_000    # JSON dopo la decompressione
MAX_MODULES = 150
MAX_MODIFIERS = 60
_SYMBOL = re.compile(r"^[A-Za-z0-9_]{1,96}$")
_CTRL = re.compile(r"[\x00-\x1f\x7f]")

_lock = threading.Lock()
_slots = None


# ---------------------------------------------------------------------------- codifica
def encode(obj):
    """JSON -> gzip -> base64 URL-safe con il padding scritto %3D (come EDMarketConnector)."""
    raw = json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(gzip.compress(raw)).decode("ascii").replace("=", "%3D")


class _TooBig(ValueError):
    pass


def _inflate(data):
    d = zlib.decompressobj(47)  # 32 + 15: riconosce da solo intestazione gzip o zlib
    out = d.decompress(data, MAX_INFLATED)
    if d.unconsumed_tail:
        raise _TooBig(pick("Dati troppo grandi", "Data too large"))
    return out


def decode_blob(text):
    """Testo base64 (standard o URL-safe, anche con %3D) compresso gzip/zlib -> oggetto JSON."""
    text = urllib.parse.unquote(re.sub(r"\s+", "", text or ""))
    if not re.fullmatch(r"[A-Za-z0-9+/_\-]+=*", text):
        raise ValueError(pick("Dati codificati non validi", "Invalid encoded data"))
    text = text.rstrip("=").replace("-", "+").replace("_", "/")
    try:
        raw = base64.b64decode(text + "=" * (-len(text) % 4))
        return json.loads(_inflate(raw).decode("utf-8"))
    except (binascii.Error, zlib.error, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError(pick("Dati codificati non leggibili", "Encoded data can't be read")) from exc


def as_json(loadout):
    return json.dumps(loadout, ensure_ascii=False, indent=2)


# ---------------------------------------------------------------------------- validazione
def _str(v, n=64):
    return _CTRL.sub("", v)[:n] if isinstance(v, str) else None


def _num(v):
    return v if isinstance(v, (int, float)) and not isinstance(v, bool) and abs(v) < 1e12 else None


def _int(v, lo=-(10 ** 12), hi=10 ** 12):
    return int(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and lo <= v <= hi else None


def _clean(d):
    return {k: v for k, v in d.items() if v is not None}


def _engineering(e):
    if not isinstance(e, dict):
        return None
    mods = []
    for m in (e.get("Modifiers") or [])[:MAX_MODIFIERS]:
        if isinstance(m, dict) and _str(m.get("Label")):
            mods.append(_clean({"Label": _str(m.get("Label")), "Value": _num(m.get("Value")),
                                "OriginalValue": _num(m.get("OriginalValue")), "LessIsGood": _int(m.get("LessIsGood"), 0, 1),
                                "ValueStr": _str(m.get("ValueStr"), 96), "ValueStr_Localised": _str(m.get("ValueStr_Localised"), 96)}))
    out = _clean({"Engineer": _str(e.get("Engineer")), "EngineerID": _int(e.get("EngineerID")),
                  "BlueprintID": _int(e.get("BlueprintID")), "BlueprintName": _str(e.get("BlueprintName")),
                  "Level": _int(e.get("Level"), 0, 5), "Quality": _num(e.get("Quality")),
                  "ExperimentalEffect": _str(e.get("ExperimentalEffect")),
                  "ExperimentalEffect_Localised": _str(e.get("ExperimentalEffect_Localised"))})
    if mods:
        out["Modifiers"] = mods
    return out if out.get("BlueprintName") else None


def clean_loadout(lo):
    """Tiene solo i campi noti di un evento Loadout, con tipi e lunghezze controllati. Solleva ValueError."""
    if not isinstance(lo, dict):
        raise ValueError(pick("Non è un Loadout del journal", "Not a journal Loadout"))
    ship = lo.get("Ship")
    mods = lo.get("Modules")
    if not isinstance(ship, str) or not _SYMBOL.match(ship) or not isinstance(mods, list):
        raise ValueError(pick("Il Loadout deve avere Ship e Modules", "The Loadout must have Ship and Modules"))
    if len(mods) > MAX_MODULES:
        raise ValueError(pick("Troppi moduli nel Loadout", "Too many modules in the Loadout"))
    modules = []
    for m in mods:
        if not isinstance(m, dict) or not isinstance(m.get("Slot"), str) or not isinstance(m.get("Item"), str):
            continue
        if not _SYMBOL.match(m["Slot"]) or not _SYMBOL.match(m["Item"]):
            continue
        entry = _clean({"Slot": m["Slot"], "Item": m["Item"], "On": m["On"] if isinstance(m.get("On"), bool) else None,
                        "Priority": _int(m.get("Priority"), 0, 5), "Health": _num(m.get("Health")),
                        "Value": _int(m.get("Value"), 0), "AmmoInClip": _int(m.get("AmmoInClip"), 0),
                        "AmmoInHopper": _int(m.get("AmmoInHopper"), 0)})
        eng = _engineering(m.get("Engineering"))
        if eng:
            entry["Engineering"] = eng
        modules.append(entry)
    fuel = lo.get("FuelCapacity") if isinstance(lo.get("FuelCapacity"), dict) else {}
    out = _clean({"event": "Loadout", "Ship": ship, "ShipID": _int(lo.get("ShipID"), 0),
                  "ShipName": _str(lo.get("ShipName"), 40), "ShipIdent": _str(lo.get("ShipIdent"), 16),
                  "HullValue": _int(lo.get("HullValue"), 0), "ModulesValue": _int(lo.get("ModulesValue"), 0),
                  "HullHealth": _num(lo.get("HullHealth")), "UnladenMass": _num(lo.get("UnladenMass")),
                  "CargoCapacity": _int(lo.get("CargoCapacity"), 0), "MaxJumpRange": _num(lo.get("MaxJumpRange")),
                  "Rebuy": _int(lo.get("Rebuy"), 0), "Hot": lo["Hot"] if isinstance(lo.get("Hot"), bool) else None})
    fc = _clean({"Main": _num(fuel.get("Main")), "Reserve": _num(fuel.get("Reserve"))})
    if fc:
        out["FuelCapacity"] = fc
    out["Modules"] = modules
    return out


def _result(kind, loadout, note=None):
    lo = clean_loadout(loadout)
    # Per il configuratore: stessi moduli che ships.parse_loadout mette in build.raw (senza quelli estetici).
    modules = [m for m in lo["Modules"] if not m["Slot"].startswith(COSMETIC_SLOTS)]
    return _clean({"kind": kind, "loadout": lo, "modules": modules, "note": note})


def _from_json(obj, kind):
    if isinstance(obj, list):  # SLEF: [{"header": {...}, "data": Loadout}]
        builds = [x.get("data") for x in obj if isinstance(x, dict) and isinstance(x.get("data"), dict)]
        if not builds:
            raise ValueError(pick("JSON non riconosciuto: serve un Loadout del journal",
                              "JSON not recognised: a journal Loadout is needed"))
        return _result("slef" if kind == "json" else kind, builds[0],
                       pick(f"Il file contiene {len(builds)} build: importata la prima.",
                            f"The file contains {len(builds)} builds: imported the first one.") if len(builds) > 1 else None)
    if isinstance(obj, dict) and isinstance(obj.get("data"), dict) and "Modules" not in obj:
        obj = obj["data"]
    if isinstance(obj, dict) and "Modules" in obj:
        return _result(kind, obj)
    if isinstance(obj, dict) and (obj.get("$schema") or "").find("coriolis") >= 0:
        raise ValueError(pick("Questo export dettagliato non è supportato: esporta la build in formato journal (Loadout)",
                              "This detailed export isn't supported: export the build in journal format (Loadout)"))
    raise ValueError(pick("JSON non riconosciuto: serve un Loadout del journal",
                              "JSON not recognised: a journal Loadout is needed"))


def decode_text(text):
    """Testo incollato (link Coriolis/EDSY, JSON Loadout/SLEF, base64 compresso) -> Loadout validato."""
    text = (text or "").strip()
    if not text:
        raise ValueError(pick("Incolla un link o un JSON", "Paste a link or a JSON"))
    if len(text) > MAX_TEXT:
        raise ValueError(pick("Testo troppo lungo", "Text too long"))
    if text.startswith(("{", "[")):
        try:
            obj = json.loads(text)
        except json.JSONDecodeError as exc:
            raise ValueError(pick(f"JSON non valido (riga {exc.lineno})", f"Invalid JSON (line {exc.lineno})")) from exc
        return _from_json(obj, "json")
    if re.match(r"^https?://", text, re.I):
        u = urllib.parse.urlsplit(text)
        host = (u.hostname or "").lower()
        if host.endswith("coriolis.io"):
            data = re.search(r"(?:^|&)data=([^&]+)", u.query)
            if data:
                return _from_json(decode_blob(data.group(1)), "coriolis")
            if u.path.startswith("/import/"):
                return _from_json(decode_blob(u.path[len("/import/"):]), "coriolis")
            m = re.match(r"^/outfit/([A-Za-z0-9_\-]+)", u.path)
            if m:  # link di condivisione con il codice interno di Coriolis: si legge solo la nave
                return {"kind": "coriolis_outfit", "ship": m.group(1).lower().replace("-", "_"),
                        "note": pick("Da questo link si legge solo la nave. Per avere anche i moduli incolla la build "
                                     "in formato journal (Loadout).",
                                     "Only the ship can be read from this link. To get the modules too, paste the "
                                     "build in journal format (Loadout).")}
            raise ValueError(pick("Il link non contiene i dati della build", "The link doesn't contain the build data"))
        if host.endswith("edsy.org") or host.endswith("edshipyard.com"):
            for part in u.fragment.split("/"):
                if part.startswith("I="):
                    return _from_json(decode_blob(part[2:]), "edsy")
            if any(p.startswith("L=") for p in u.fragment.split("/")):
                raise ValueError(pick("Questo link usa un formato interno non leggibile: incolla la build in formato "
                                      "journal (Loadout)",
                                      "This link uses an internal format that can't be read: paste the build in "
                                      "journal format (Loadout)"))
            raise ValueError(pick("Il link non contiene i dati della build", "The link doesn't contain the build data"))
        raise ValueError(pick("Link non riconosciuto: incolla la build in formato journal (Loadout)",
                              "Link not recognised: paste the build in journal format (Loadout)"))
    try:
        obj = decode_blob(text)
    except _TooBig:
        raise
    except ValueError as exc:
        raise ValueError(pick("Testo non riconosciuto: incolla una build in formato journal (Loadout), "
                              "un link di una build o un codice ED Copilot",
                              "Text not recognised: paste a build in journal format (Loadout), "
                              "a build link or an ED Copilot code")) from exc
    return _from_json(obj, "blob")


# ---------------------------------------------------------------------------- navi del comandante
def ship_loadout(q):
    from .journal import STATE  # import pigro
    try:
        sid = int(q.get("id"))
    except (TypeError, ValueError):
        raise ValueError(pick("Nave non valida", "Invalid ship"))
    with STATE.lock:
        build = STATE.loadouts.get(sid)
        blob = (build or {}).get("coriolis", "")
    if not blob:
        raise ValueError(pick("Allestimento non ancora registrato: sali su questa nave con il gioco aperto",
                              "Loadout not recorded yet: board this ship with the game running"))
    # ships.parse_loadout conserva l'intero evento Loadout (senza timestamp) compresso dentro il link.
    loadout = decode_blob(blob.split("data=", 1)[1])
    return {"loadout": loadout, "json": as_json(loadout)}


# ---------------------------------------------------------------------------- nomi degli slot
def compact_slots(raw):
    """ship-slots.json di Coriolis -> {simbolo journal: {"internal": [[nome, classe], ...], "hardpoints": [...]}}."""
    out = {}
    for sym, s in (raw or {}).items():
        if sym.startswith("_") or not isinstance(s, dict):
            continue
        slots = s.get("slots") or {}
        out[sym.lower()] = {g: [[x["name"], x.get("class", 0)] for x in slots.get(g) or [] if isinstance(x, dict) and "name" in x]
                            for g in ("internal", "hardpoints")}
    return out


def slot_names():
    global _slots
    with _lock:
        if _slots is None:
            for f in (SLOTS_CACHE, SLOTS_SEED):
                try:
                    with open(f, encoding="utf-8") as fh:
                        _slots = json.load(fh)
                    break
                except (OSError, ValueError):
                    continue
        return _slots or {"ships": {}}


def _refresh_slots():
    try:
        if time.time() - os.path.getmtime(SLOTS_CACHE) < SLOTS_MAX_AGE:
            return
    except OSError:
        pass
    global _slots
    try:
        req = urllib.request.Request(SLOTS_SOURCE, headers={"User-Agent": "ED-Copilot/1.0"})
        with urllib.request.urlopen(req, timeout=30) as r:
            ships = compact_slots(json.loads(r.read(5_000_000)))
        if len(ships) < 30:
            return
        data = {"source": SLOTS_SOURCE, "updated": time.time(), "ships": ships}
        os.makedirs(os.path.dirname(SLOTS_CACHE), exist_ok=True)
        tmp = SLOTS_CACHE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, separators=(",", ":"))
        os.replace(tmp, SLOTS_CACHE)
        with _lock:
            _slots = data
    except Exception as exc:
        print(f"Nomi degli slot Coriolis non aggiornati ({exc}).")


def start():
    time.sleep(20)  # non rallenta l'avvio
    _refresh_slots()


GET = {
    "/api/buildshare/ship": ship_loadout,
    "/api/buildshare/slots": lambda q: slot_names(),
}
POST = {
    "/api/buildshare/decode": lambda body, q: decode_text(str((body or {}).get("text") or "")[:MAX_TEXT + 1]),
}
LAN = set()
