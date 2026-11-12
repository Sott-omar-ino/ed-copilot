"""Dati delle strutture di colonizzazione per il piano del sistema, scaricati da Raven Colonial quando servono.

Fonte: https://github.com/njthomson/RavenColonialWeb (GPL-3.0), al commit fissato in COMMIT:
- src/site-data.ts (siteTypes, mapName): tier, construction points richiesti/dati, pad, economia, effetti sul sistema,
  prerequisiti e sblocchi;
- src/assets/colonization-costs2.json: merci medie dei cantieri, raccolte dai giocatori (una stima);
- src/assets/cargo-types.json: nomi visibili delle merci.
I file non sono inclusi in Voidwatch ED (licenza GPL-2.0-or-later, che contiene anche codice solo GPL-2.0 incompatibile
con la GPL-3.0): l'app li scarica alla prima apertura del piano e li tiene in cache nella cartella dati.
Non si esegue nulla di ciò che arriva: il letterale TypeScript viene trasformato in JSON a mano e poi letto con json.
"""

import json
import os
import re
import threading
import urllib.request

from . import paths
from .lang import pick
from .spansh import USER_AGENT

COMMIT = "01b89a9522d20ef8109b3110812db0a1d0a0981f"
RAW = f"https://raw.githubusercontent.com/njthomson/RavenColonialWeb/{COMMIT}/"
CACHE = os.path.join(paths.DATA_DIR, "cache", "colonisation_sites.json")
SOURCE = f"https://github.com/njthomson/RavenColonialWeb (GPL-3.0), commit {COMMIT[:7]}"

# Chiavi che sono il nome interno del gioco e non quello visibile (EDCD/FDevIDs commodity.csv, colonne symbol/name).
ALIASES = {"agriculturalmedicines": "Agri-Medicines", "hazardousenvironmentsuits": "H.E. Suits", "mutomimager": "Muon Imager",
           "terrainenrichmentsystems": "Land Enrichment Systems", "heliostaticfurnaces": "Microbial Furnaces"}

_lock = threading.Lock()
_mem = {}


def _get(file):
    req = urllib.request.Request(RAW + file, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read(3_000_000).decode("utf-8")


def ts_literal(src, marker):
    """Il letterale (array/oggetto) dopo `marker =`, convertito in JSON: commenti tolti, stringhe con apici singoli in
    doppi, chiavi senza virgolette tra virgolette, virgole finali tolte."""
    at = src.find(marker)
    if at < 0:
        raise ValueError("manca " + marker)
    start = src.index("=", at) + 1
    open_ch = re.search(r"[\[{]", src[start:])
    i = start + open_ch.start()
    out, depth, j = [], 0, i
    while j < len(src):
        c = src[j]
        if c in "'\"`":
            k = j + 1
            buf = []
            while src[k] != c:
                if src[k] == "\\":
                    buf.append(src[k + 1])
                    k += 1
                else:
                    buf.append(src[k])
                k += 1
            out.append(json.dumps("".join(buf)))
            j = k + 1
            continue
        if src.startswith("//", j):
            j = src.index("\n", j)
            continue
        if src.startswith("/*", j):
            j = src.index("*/", j) + 2
            continue
        m = re.match(r"[A-Za-z_$][\w$]*", src[j:])
        if m:  # chiave senza virgolette (seguita da ":") oppure true/false/null/numero
            word, j = m.group(0), j + m.end()
            out.append(json.dumps(word) if re.match(r"\s*:", src[j:]) else word)
            continue
        if c == "+":  # "+3": il più davanti a un numero non è ammesso in JSON
            j += 1
            continue
        if c in "[{":
            depth += 1
        elif c in "]}":
            depth -= 1
        out.append(c)
        j += 1
        if depth == 0:
            break
    text = re.sub(r",(\s*[\]}])", r"\1", "".join(out))
    return json.loads(text)


def _norm(s):
    return re.sub(r"[^a-z0-9]", "", str(s or "").lower())


def build(site_src, costs, cargo_types):
    """Formato usato da web/js/colplan.js."""
    site_types = ts_literal(site_src, "export const siteTypes")
    map_name = ts_literal(site_src, "export const mapName")
    names = {_norm(n): n for group in cargo_types.values() for n in group}
    names.update(ALIASES)
    sites = []
    for t in site_types:
        if t.get("buildClass") == "unknown":
            continue
        sub = [s for s in t.get("subTypes") or [] if s]
        c = next((x for x in costs if x.get("buildType") in sub or any(lay in sub for lay in x.get("layouts") or [])), None)
        cargo = {names.get(k, k): int(v) for k, v in ((c or {}).get("cargo") or {}).items()}
        sites.append({
            "key": sub[0], "name": t.get("displayName"), "name2": t.get("displayName2"), "sub": sub, "cls": t.get("buildClass"),
            "tier": t.get("tier"), "pad": t.get("padSize"), "orbital": bool(t.get("orbital")), "inf": t.get("inf"),
            "fixed": t.get("fixed"), "needs": [t["needs"]["tier"], t["needs"]["count"]],
            "gives": [t["gives"]["tier"], t["gives"]["count"]], "effects": t.get("effects") or {},
            "preReq": map_name.get(t["preReq"]) if t.get("preReq") else None, "unlocks": t.get("unlocks") or [],
            "cargo": cargo})
    return {"meta": {"source": SOURCE, "commit": COMMIT,
                     "note": "cargo = merci medie raccolte dai giocatori (stima)"}, "sites": sites}


def site_data():
    with _lock:
        if _mem.get("data"):
            return _mem["data"]
        try:
            with open(CACHE, encoding="utf-8") as f:
                data = json.load(f)
            if data.get("meta", {}).get("commit") == COMMIT and data.get("sites"):
                _mem["data"] = data
                return data
        except (OSError, ValueError):
            pass
        try:
            data = build(_get("src/site-data.ts"), json.loads(_get("src/assets/colonization-costs2.json")),
                         json.loads(_get("src/assets/cargo-types.json")))
        except Exception:
            return {"sites": [], "error": pick("Non riesco a scaricare i dati delle strutture da GitHub (Raven Colonial): "
                                               "controlla la connessione e riprova.",
                                               "Can't download the structure data from GitHub (Raven Colonial): "
                                               "check the connection and try again.")}
        os.makedirs(os.path.dirname(CACHE), exist_ok=True)
        with open(CACHE, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        _mem["data"] = data
        return data


GET = {"/api/colonisation/site_data": lambda q: site_data()}
