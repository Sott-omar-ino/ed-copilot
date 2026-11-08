"""Comandi vocali arrivati dal telefono (o dal push-to-talk globale del PC, vedi ptt.py).

Il telefono invia l'audio, il PC lo trascrive con Whisper e mette il testo in questa piccola coda; l'app sul PC
la legge da /api/state e passa il testo al motore dei comandi vocali (che conosce controlli e macro).
L'app può poi segnare l'esito, che il telefono rilegge da /api/state.
"""
import itertools
import threading
import time

KEEP_SECONDS = 60
MAX_ITEMS = 20

_lock = threading.Lock()
_ids = itertools.count(1)
_items = []


def _prune(now):
    _items[:] = [i for i in _items if now - i["ts"] < KEEP_SECONDS][-MAX_ITEMS:]


def push(text, source="phone"):
    """Mette in coda un comando trascritto. source: "phone" (companion) o "ptt" (push-to-talk globale del PC)."""
    now = time.time()
    with _lock:
        _prune(now)
        item = {"id": next(_ids), "text": text, "ts": now, "result": None, "source": source}
        _items.append(item)
        return dict(item)


def recent():
    with _lock:
        _prune(time.time())
        return [dict(i) for i in _items]


def set_result(item_id, result):
    with _lock:
        for i in _items:
            if i["id"] == item_id:
                i["result"] = str(result or "")[:200]
                return True
    return False
