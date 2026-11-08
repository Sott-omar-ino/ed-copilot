"""Lettura e scrittura sicura dei file JSON dell'utente."""

import json
import os
import threading
import time
import uuid

from . import paths
from .lang import pick


def load_json(path, default=None):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def save_json(path, data):
    """Scrittura atomica: prima un file temporaneo, poi lo scambio."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=1, ensure_ascii=False)
    os.replace(tmp, path)


class ListStore:
    """Una lista salvata nella cartella dati, con valori predefiniti inclusi nel programma.

    Se il file dell'utente esiste vale quello, anche se è vuoto: così cancellare tutto resta cancellato.
    """

    def __init__(self, name, clean_item, default_name=None):
        self.path = paths.user_file(name)
        self.default_path = paths.default_file(default_name) if default_name else None
        self.clean_item = clean_item
        self.lock = threading.Lock()

    def load(self):
        with self.lock:
            data = load_json(self.path)
            if isinstance(data, list):
                return data
            if self.default_path:
                data = load_json(self.default_path)
                if isinstance(data, list):
                    return data
            return []

    def save(self, items):
        if not isinstance(items, list):
            raise ValueError(pick("Lista attesa", "A list was expected"))
        clean = [c for c in (self.clean_item(i) for i in items if isinstance(i, dict)) if c]
        with self.lock:
            save_json(self.path, clean)
        return clean


def _text(v, limit=500):
    return str(v or "")[:limit]


def _new_id():
    return str(uuid.uuid4())[:8]


def clean_todo(t):
    if not _text(t.get("text")).strip():
        return None
    return {"id": _text(t.get("id"), 40) or str(time.time_ns()), "text": _text(t["text"]),
            "category": _text(t.get("category") or "Generale", 40), "system": _text(t.get("system"), 100),
            "done": bool(t.get("done")), "created": t.get("created") or time.strftime("%Y-%m-%dT%H:%M:%S")}


def clean_macro(m):
    if not m.get("name"):
        return None
    keys = m.get("keys")
    if isinstance(keys, str):
        keys = [k.strip() for k in keys.split(",") if k.strip()]
    return {"id": _text(m.get("id"), 40) or _new_id(), "name": _text(m["name"], 80), "say": _text(m.get("say") or m["name"]),
            "keys": [_text(k, 20) for k in keys][:60] if isinstance(keys, list) else [],
            "voice": _text(m.get("voice")), "desc": _text(m.get("desc"))}


def clean_control(c):
    if not c.get("name"):
        return None
    return {"id": _text(c.get("id"), 40) or _new_id(), "name": _text(c["name"], 80), "say": _text(c.get("say") or c["name"]),
            "key": _text(c.get("key") or "SPACE", 20).upper(), "voice": _text(c.get("voice")),
            "desc": _text(c.get("desc")), "builtIn": bool(c.get("builtIn", False))}


def clean_rule(r):
    if not r.get("name"):
        return None
    try:
        threshold = float(r.get("threshold", 0))
    except (TypeError, ValueError):
        threshold = 0.0
    return {"id": _text(r.get("id"), 40) or _new_id(), "name": _text(r["name"], 120), "metric": _text(r.get("metric") or "fuel", 40),
            "condition": _text(r.get("condition") or "lt", 10), "threshold": threshold, "unit": _text(r.get("unit"), 10),
            "enabled": bool(r.get("enabled", True)), "voice": _text(r.get("voice")), "desc": _text(r.get("desc"))}


TODOS = ListStore("todo.json", clean_todo)
MACROS = ListStore("macros.json", clean_macro, "macros.json")
CONTROLS = ListStore("controls.json", clean_control, "controls.json")
TELEMETRY = ListStore("telemetry.json", clean_rule, "telemetry.json")
