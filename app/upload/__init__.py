"""Invio automatico dei dati di gioco a EDDN, EDSM e Inara (come fa EDMC). Ogni destinazione è spenta finché non la attivi.

Come funziona:
- journal.add_listener ci passa ogni evento NUOVO (mai lo storico letto all'avvio). Nel thread del journal si fa
  solo lavoro veloce: aggiornare lo stato (tracker), costruire i messaggi e metterli nella coda in memoria;
- tre thread (uno per destinazione) inviano, ritentano con attese crescenti e salvano la coda su disco
  (cache/invio_coda.json): chiudere l'app o restare senza rete non fa perdere nulla;
- niente invii dalle versioni beta o Legacy del gioco, né quando sei ospite nella nave di un altro comandante.

Impostazioni in app_config: upload_eddn, upload_edsm, upload_inara (sì/no), edsm_cmdr, edsm_api_key.
Inara usa la chiave già salvata per la lettura (inara_api_key).
"""

import glob
import json
import os
import threading
import time

from .. import paths
from ..lang import pick
from . import eddn, edsm, inara
from .outbox import DESTS, Outbox
from .tracker import Tracker

CONFIG_KEYS = ("upload_eddn", "upload_edsm", "upload_inara", "edsm_cmdr", "edsm_api_key", "inara_api_key")
CONFIG_TTL = 10

TRACK = Tracker()
_cfg = {"data": {}, "ts": 0.0}
_runtime = {"box": None, "senders": {}, "builders": None, "started": False}
_lock = threading.Lock()


def _config():
    """Impostazioni lette da app_config, tenute in cache qualche secondo (il listener gira a ogni evento)."""
    if time.time() - _cfg["ts"] > CONFIG_TTL:
        from ..server import app_config
        _cfg.update(data={k: app_config().get(k) for k in CONFIG_KEYS}, ts=time.time())
    return _cfg["data"]


def _status_body():
    """BodyName da Status.json: c'è solo quando sei abbastanza vicino a un corpo (serve a CodexEntry)."""
    try:
        with open(os.path.join(paths.JOURNAL_DIR, "Status.json"), encoding="utf-8") as f:
            return json.load(f).get("BodyName") or None
    except (OSError, ValueError):
        return None


def _builders():
    if not _runtime["builders"]:
        _runtime["builders"] = {"eddn": eddn.Builder(paths.JOURNAL_DIR, _status_body), "inara": inara.Builder(paths.JOURNAL_DIR)}
    return _runtime["builders"]


def handle(e, box, cfg, track=TRACK, builders=None):
    """Un evento nuovo: aggiorna lo stato e accoda ciò che va inviato. Separata dal listener per i test."""
    builders = builders or _builders()
    with _lock:
        track.update(e)
        if track.game_ok() or track.in_crew() or not track.cmdr:
            return
        for dest in DESTS:
            if not cfg.get(f"upload_{dest}"):
                continue
            try:
                _enqueue(dest, e, box, track, builders)
            except Exception as exc:  # un evento strano non deve fermare le altre destinazioni
                print(f"[Invio {dest}] Evento {e.get('event')} non elaborato: {exc!r}")


def _enqueue(dest, e, box, track, builders):
    if dest == "eddn":
        for msg in builders["eddn"].build(e, track):
            box.put("eddn", msg)
    elif dest == "edsm":
        sender = _runtime["senders"].get("edsm")
        if not (sender and sender.discard and e.get("event") in sender.discard):
            box.put("edsm", edsm.transient(e, track), {"cmdr": track.cmdr, "gv": track.gameversion, "gb": track.gamebuild})
    else:
        for data, key, merge in builders["inara"].build(e, track):
            box.put("inara", data, {"cmdr": track.cmdr, "fid": track.fid}, key=key, merge=merge)


def _on_event(e):
    if _runtime["box"] is not None:
        handle(e, _runtime["box"], _config())


def _replay_recent():
    """Ricostruisce lo stato (comandante, versione del gioco, posizione) dai journal della sessione in corso.

    Il listener riceve solo gli eventi nuovi: senza questo, fino al prossimo salto non sapremmo dove siamo.
    Si leggono a ritroso i file fino a quello con il LoadGame (di solito basta l'ultimo).
    """
    files = sorted(glob.glob(os.path.join(paths.JOURNAL_DIR, "Journal.*.log")), key=os.path.getmtime)[-5:]
    chosen = []
    for path in reversed(files):
        chosen.insert(0, path)
        try:
            with open(path, encoding="utf-8", errors="replace") as f:
                if '"event":"LoadGame"' in f.read().replace(" ", ""):
                    break
        except OSError:
            continue
    for path in chosen:
        try:
            with open(path, encoding="utf-8", errors="replace") as f:
                for line in f:
                    try:
                        TRACK.update(json.loads(line))
                    except (ValueError, AttributeError):
                        continue
        except OSError:
            continue


def start():
    """Da chiamare una volta all'avvio: stato della sessione, listener sul journal e thread di invio."""
    if _runtime["started"]:
        return
    _runtime["started"] = True
    from .. import journal
    _replay_recent()
    box = Outbox()
    _runtime["box"] = box
    _runtime["senders"] = {"eddn": eddn.EddnSender(box, _config), "edsm": edsm.EdsmSender(box, _config),
                           "inara": inara.InaraSender(box, _config)}
    for s in _runtime["senders"].values():
        s.start()
    journal.add_listener(_on_event)


def status():
    cfg = _config()
    senders = _runtime["senders"]
    out = {}
    for dest in DESTS:
        s = senders.get(dest)
        out[dest] = {"enabled": bool(cfg.get(f"upload_{dest}")), **(s.status() if s else
                     {"queued": 0, "last_ok": None, "last_error": None, "error_ts": None, "paused": None, "sent": 0})}
    out["edsm"].update(configured=bool((cfg.get("edsm_api_key") or "").strip()), cmdr=cfg.get("edsm_cmdr") or "")
    out["inara"]["configured"] = bool((cfg.get("inara_api_key") or "").strip())
    blocked = TRACK.game_ok() or (pick("sei nell'equipaggio di un altro comandante", "you're in another CMDR's crew")
                                if TRACK.in_crew() else None)
    out["game"] = {"cmdr": TRACK.cmdr, "version": TRACK.gameversion, "blocked": blocked, "started": _runtime["started"]}
    return out


def configure(body):
    """POST dalle impostazioni: accende/spegne le destinazioni e salva nome e chiave di EDSM."""
    from ..server import set_app_config
    body = body or {}
    changes = {}
    for dest in DESTS:
        if f"upload_{dest}" in body:
            changes[f"upload_{dest}"] = bool(body[f"upload_{dest}"])
    if "edsm_cmdr" in body:
        name = str(body["edsm_cmdr"] or "").strip()
        if len(name) > 64:
            raise ValueError(pick("Nome del comandante troppo lungo", "CMDR name too long"))
        changes["edsm_cmdr"] = name
    if "edsm_api_key" in body:
        key = str(body["edsm_api_key"] or "").strip()
        if key and (not key.isalnum() or len(key) > 128):
            raise ValueError(pick("La chiave API di EDSM contiene solo lettere e numeri", "The EDSM API key only contains letters and numbers"))
        changes["edsm_api_key"] = key
    if changes:
        set_app_config(**changes)
        _cfg["ts"] = 0.0
    box, senders = _runtime["box"], _runtime["senders"]
    for dest in DESTS:
        if changes.get(f"upload_{dest}") is False and box:
            box.clear(dest)  # spento: quello che era in coda non parte più, nemmeno dopo
            box.flush(force=True)
        if changes and dest in senders:
            senders[dest].resume()  # impostazioni cambiate: si riprova anche dopo un errore di credenziali
    return status()
