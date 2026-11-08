"""Discord Rich Presence: sul tuo profilo Discord compare cosa stai facendo in Elite (nave, sistema, attività).

Parla con il client Discord sul PC tramite la sua "named pipe" locale (\\\\.\\pipe\\discord-ipc-N), senza librerie.
Serve l'ID di un'applicazione Discord (Discord Developer Portal → New Application, il nome dell'applicazione
è quello che gli altri vedono: "Sta giocando a ..."). Nessun dato esce dal PC se non verso il client Discord.
"""

import json
import os
import struct
import threading
import time
import uuid
from datetime import datetime, timezone

from .journal import STATE
from .lang import pick

UPDATE_EVERY = 15  # secondi; Discord accetta al massimo 5 aggiornamenti ogni 20 secondi

_state = {"connected": False, "error": None, "last": None, "activity": None}
_pipe = {"f": None}
_wake = threading.Event()


def _cfg():
    from .server import app_config
    cfg = app_config()
    return {"enabled": bool(cfg.get("discord_enabled")), "client_id": str(cfg.get("discord_client_id") or "").strip(),
            "show_system": cfg.get("discord_show_system", True)}


def status():
    return {**_cfg(), "connected": _state["connected"], "error": _state["error"], "activity": _state["activity"]}


def configure(body):
    from .server import set_app_config
    body = body or {}
    changes = {}
    if "client_id" in body:
        cid = str(body["client_id"] or "").strip()
        if cid and not cid.isdigit():
            raise ValueError(pick("L'ID applicazione di Discord è un numero (Developer Portal → la tua app → Application ID)",
                                   "The Discord application ID is a number (Developer Portal → your app → Application ID)"))
        changes["discord_client_id"] = cid
    for key in ("enabled", "show_system"):
        if key in body:
            changes["discord_" + key] = bool(body[key])
    set_app_config(**changes)
    _close()
    _wake.set()
    return status()


# --- Protocollo IPC di Discord ------------------------------------------------------

def _send(op, payload):
    data = json.dumps(payload).encode("utf-8")
    _pipe["f"].write(struct.pack("<II", op, len(data)) + data)
    _pipe["f"].flush()


def _recv():
    head = _pipe["f"].read(8)
    if len(head) < 8:
        raise OSError(pick("Discord ha chiuso la connessione", "Discord closed the connection"))
    op, size = struct.unpack("<II", head)
    return op, json.loads(_pipe["f"].read(size) or b"{}")


def _connect(client_id):
    for i in range(10):
        try:
            _pipe["f"] = open(rf"\\.\pipe\discord-ipc-{i}", "r+b", buffering=0)
            break
        except OSError:
            continue
    else:
        raise OSError(pick("Discord non è aperto su questo PC", "Discord isn't running on this PC"))
    _send(0, {"v": 1, "client_id": client_id})
    op, data = _recv()
    if op == 2 or data.get("evt") == "ERROR":
        msg = data.get('message') or data.get('data', {}).get('message')
        raise OSError(pick(f"Discord ha rifiutato l'ID applicazione: {msg}", f"Discord rejected the application ID: {msg}"))
    _state.update(connected=True, error=None)


def _close():
    f = _pipe["f"]
    _pipe["f"] = None
    _state["connected"] = False
    if f:
        try:
            f.close()
        except OSError:
            pass


def _where(snap, loc, show_system):
    system = loc.get("system") if show_system else None
    sys_part = f" · {system}" if system else ""
    if loc.get("docked"):
        return pick(f"Attraccato a {loc.get('station')}", f"Docked at {loc.get('station')}") + sys_part
    if snap.get("bio_current"):
        return pick("Esobiologia: ", "Exobiology: ") + f"{snap['bio_current'].get('species')}"
    if snap.get("route"):
        n = len(snap["route"])
        return pick(f"In viaggio · {n} salti rimanenti", f"Travelling · {n} jump{'s' if n != 1 else ''} left") + sys_part
    return pick("In volo", "In flight") + sys_part


def _activity(show_system):
    snap = STATE.snapshot()
    loc, ship = snap.get("location") or {}, snap.get("ship") or {}
    if not (snap.get("cmdr") or {}).get("name"):
        return None
    act = {"details": (ship.get("type") or pick("In volo", "In flight")) + (f" «{ship['name']}»" if ship.get("name") else ""),
           "state": _where(snap, loc, show_system)[:128]}
    try:
        start = datetime.strptime((snap.get("session") or {}).get("start") or "", "%Y-%m-%dT%H:%M:%SZ")
        act["timestamps"] = {"start": int(start.replace(tzinfo=timezone.utc).timestamp())}
    except ValueError:
        pass
    return act


def _loop():
    while True:
        cfg = _cfg()
        if not cfg["enabled"] or not cfg["client_id"]:
            _close()
            _state["activity"] = None
            _wake.wait(30)
            _wake.clear()
            continue
        try:
            if not _pipe["f"]:
                _connect(cfg["client_id"])
            act = _activity(cfg["show_system"])
            if act != _state["last"]:
                _send(1, {"cmd": "SET_ACTIVITY", "args": {"pid": os.getpid(), "activity": act}, "nonce": str(uuid.uuid4())})
                _recv()
                _state.update(last=act, activity=act)
        except (OSError, ValueError) as exc:
            _close()
            _state.update(error=str(exc), last=None)
        _wake.wait(UPDATE_EVERY)
        _wake.clear()


def start():
    threading.Thread(target=_loop, daemon=True, name="discord").start()
