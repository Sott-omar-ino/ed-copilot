"""Lettura dei journal di Elite Dangerous: storico all'avvio, poi in tempo reale."""

import glob
import json
import os
import time

from . import paths
from .state import State

STATE = State(paths.JOURNAL_DIR)
# Funzioni chiamate per ogni evento NUOVO (non per lo storico letto all'avvio): fn(evento).
# Vengono eseguite fuori dal lock dello stato; devono essere veloci (il lavoro lento va in un thread o in coda).
LISTENERS = []


def add_listener(fn):
    LISTENERS.append(fn)


def journal_files():
    return sorted(glob.glob(os.path.join(paths.JOURNAL_DIR, "Journal.*.log")), key=os.path.getmtime)


def parse_lines(text, state=STATE):
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            e = json.loads(line)
        except ValueError:
            continue
        with state.lock:
            try:
                state.handle(e)
            except Exception as exc:  # un evento strano non deve fermare l'helper
                print(f"Errore evento {e.get('event')}: {exc}")
        if state.live and state is STATE:
            for fn in LISTENERS:
                try:
                    fn(e)
                except Exception as exc:
                    print(f"Errore in {getattr(fn, '__module__', '?')} per {e.get('event')}: {exc!r}")


def read_status():
    """Status.json: lo stato istantaneo della nave (flag, carburante, posizione sul pianeta)."""
    try:
        with open(os.path.join(paths.JOURNAL_DIR, "Status.json"), encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def watch(state=STATE):
    files = journal_files()
    current, pos, buf = None, 0, ""
    for path in files:
        with open(path, encoding="utf-8", errors="replace") as f:
            parse_lines(f.read(), state)
        current = path
    if current:
        pos = os.path.getsize(current)
    state.live = True
    print(f"Letti {len(files)} journal. In ascolto...")

    while True:
        time.sleep(1)
        latest = journal_files()
        if latest and latest[-1] != current:
            current, pos, buf = latest[-1], 0, ""
        if not current:
            continue
        try:
            size = os.path.getsize(current)
            if size < pos:
                pos = 0
            if size > pos:
                with open(current, "rb") as f:
                    f.seek(pos)
                    chunk = f.read()
                pos += len(chunk)
                buf += chunk.decode("utf-8", errors="replace")
                complete, _, buf = buf.rpartition("\n")
                parse_lines(complete, state)
        except OSError:
            pass
