"""Immagini delle navi dal wiki di Elite Dangerous (Fandom).

Il server trova l'indirizzo dell'immagine con l'API del wiki e lo ricorda in data/ship_images.json;
l'immagine la carica poi direttamente il browser (il CDN del wiki rifiuta i client non-browser).
"""

import json
import os
import re
import threading
import urllib.parse
import urllib.request

from . import coriolis, paths
from .gamedata import SHIP_NAMES

CACHE_FILE = paths.cache_file("ship_images.json")
API = "https://elite-dangerous.fandom.com/api.php"
ALLOWED_HOST = "static.wikia.nocookie.net"
UA = {"User-Agent": "ED-Helper/1.0 (local companion app)"}
_lock = threading.Lock()
_cache = None


def _title(symbol):
    """Titolo della pagina del wiki: il nome di Coriolis è già nel formato giusto ("Cobra Mk V")."""
    cat = coriolis.load() or {}
    key = (cat.get("journal_ships") or {}).get(symbol)
    if key:
        return cat["ships"][key]["name"]
    return re.sub(r"Mk(?=[IVX]+\b)", "Mk ", SHIP_NAMES.get(symbol, symbol))


def _load():
    global _cache
    if _cache is None:
        try:
            with open(CACHE_FILE, encoding="utf-8") as f:
                _cache = json.load(f)
        except (OSError, ValueError):
            _cache = {}
    return _cache


def url(symbol):
    """Indirizzo dell'immagine della nave, o None se il wiki non ne ha una."""
    symbol = re.sub(r"[^a-z0-9_]", "", (symbol or "").lower())
    if not symbol:
        return None
    with _lock:
        cache = _load()
        if symbol in cache:
            return cache[symbol]
        src = None
        try:
            qs = urllib.parse.urlencode({"action": "query", "format": "json", "redirects": 1, "prop": "pageimages",
                                         "piprop": "thumbnail", "pithumbsize": 800, "titles": _title(symbol)})
            with urllib.request.urlopen(urllib.request.Request(API + "?" + qs, headers=UA), timeout=20) as r:
                pages = json.loads(r.read())["query"]["pages"]
            src = (next(iter(pages.values())).get("thumbnail") or {}).get("source")
            if src and urllib.parse.urlparse(src).hostname != ALLOWED_HOST:
                src = None
        except Exception as exc:
            print(f"Immagine della nave {symbol} non disponibile ({exc}).")
            return None  # errore di rete: si riproverà
        cache[symbol] = src
        os.makedirs(os.path.dirname(CACHE_FILE), exist_ok=True)
        with open(CACHE_FILE, "w", encoding="utf-8") as f:
            json.dump(cache, f, indent=1)
        return src
