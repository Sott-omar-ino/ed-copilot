"""Lingua dell'interfaccia e dei messaggi del copilota: "it" (predefinita) o "en".

Nel backend: `pick("testo italiano", "English text")` restituisce il testo nella lingua scelta.
Per tabelle lunghe: `pick_d({"it": ..., "en": ...})`. La lingua può cambiare mentre l'app gira:
chiamare pick() quando il testo viene prodotto, mai al momento dell'import.
Nel frontend la stessa scelta arriva da /api/settings (campo "ui_lang") e si cambia con POST /api/ui_lang.
"""

import threading
import time

LANGS = ("it", "en")
_cache = {"lang": None, "t": 0.0}
_lock = threading.Lock()
_TTL = 2.0  # secondi: la configurazione sta su disco, non rileggerla a ogni testo


def current():
    now = time.monotonic()
    with _lock:
        if _cache["lang"] is not None and now - _cache["t"] < _TTL:
            return _cache["lang"]
    try:
        from . import server  # import pigro: server importa questo modulo
        lang = (server.app_config().get("ui_lang") or "it").lower()
    except Exception:
        lang = "it"
    lang = lang if lang in LANGS else "it"
    with _lock:
        _cache.update(lang=lang, t=now)
    return lang


def is_en():
    return current() == "en"


def pick(it, en):
    return en if current() == "en" else it


def pick_d(d):
    """Da un dict {"it": ..., "en": ...} il valore nella lingua corrente (ripiego sull'italiano)."""
    if not isinstance(d, dict):
        return d
    return d.get(current(), d.get("it"))


def _set(body, q):
    lang = ((body or {}).get("lang") or "").lower()
    if lang not in LANGS:
        raise ValueError(pick("Lingua non valida", "Invalid language"))
    from . import server
    server.set_app_config(ui_lang=lang)
    with _lock:
        _cache.update(lang=lang, t=time.monotonic())
    return {"ui_lang": lang}


GET = {"/api/ui_lang": lambda q: {"ui_lang": current()}}
POST = {"/api/ui_lang": _set}
LAN = {"/api/ui_lang"}
