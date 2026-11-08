"""EDSM (Elite Dangerous Star Map): diario di volo, flotta, materiali e crediti del comandante (www.edsm.net/api-journal-v1).

- Servono il nome del comandante registrato su EDSM e la chiave API (EDSM → Impostazioni → La mia chiave API).
- Gli eventi partono a gruppi così come sono nel journal, con gli "stati transitori" (_systemName, _shipId...)
  calcolati come nel codice di esempio della documentazione di EDSM.
- Gli eventi che EDSM non vuole (/api-journal-v1/discard) non partono: la lista si scarica a ogni avvio e resta
  in cache per quando la rete manca. Finché non c'è una lista non si invia nulla.
- Errori di nome o chiave (201-203) e software bloccato (204-205) fermano gli invii finché non cambi le impostazioni.
"""

import json
import time
import urllib.parse

from .. import VERSION, paths, storage
from ..lang import pick
from .outbox import Sender, backoff, get_json, post

API_URL = "https://www.edsm.net/api-journal-v1"
DISCARD_URL = "https://www.edsm.net/api-journal-v1/discard"
DISCARD_CACHE = paths.cache_file("edsm_scarti.json")
SOFTWARE = "ED Copilot"
BATCH_WAIT, BATCH_MAX = 15, 100
LOCATION = ("FSDJump", "Location", "Docked", "CarrierJump")
AUTH_ERRORS = (201, 202, 203, 204, 205)
DROP_ERRORS = (206, 207, 208)


def transient(e, t):
    """Copia dell'evento con lo stato di gioco che EDSM non può ricavare da un evento isolato."""
    s = t.edsm
    return {**e, "_systemAddress": s["address"], "_systemName": s["system"], "_systemCoordinates": s["coords"],
            "_marketId": s["market_id"], "_stationName": s["station"], "_shipId": t.ship_id}


class EdsmSender(Sender):
    name = "edsm"

    def __init__(self, box, config):
        super().__init__(box, config)
        self.discard = None
        self.discard_next = 0.0
        self.hold_until = 0.0   # limite di richieste di EDSM raggiunto: si aspetta fin qui

    def discarded(self):
        """Lista degli eventi da non inviare: scaricata una volta per avvio, con la copia in cache come riserva."""
        if self.discard is None and time.time() >= self.discard_next:
            try:
                data = get_json(DISCARD_URL)
                if isinstance(data, list) and data:
                    self.discard = set(data) - {"Docked"}  # come EDMC: Docked serve sempre per la posizione
                    storage.save_json(DISCARD_CACHE, sorted(self.discard))
            except Exception as exc:
                self.discard_next = time.time() + 60
                cached = storage.load_json(DISCARD_CACHE)
                if isinstance(cached, list) and cached:
                    self.discard = set(cached) - {"Docked"}
                else:
                    self.error(pick(f"lista degli eventi da scartare non disponibile ({exc}): riprovo tra un minuto",
                                    f"list of events to discard not available ({exc}): retrying in a minute"))
        return self.discard

    def creds(self):
        cfg = self.config()
        return (cfg.get("edsm_cmdr") or "").strip(), (cfg.get("edsm_api_key") or "").strip()

    def tick(self):
        if not self.config().get("upload_edsm"):
            return
        cmdr, key = self.creds()
        if not key:
            self.last_error = pick("Manca la chiave API di EDSM", "EDSM API key missing")
            return
        if self.check_pause((cmdr, key)) or time.time() < self.hold_until:
            return
        discard = self.discarded()
        if discard is None:
            return
        now = time.time()
        items = self.box.ready("edsm", BATCH_MAX * 2, now)
        skip = [i["id"] for i in items if i["data"].get("event") in discard]
        if skip:
            self.box.remove("edsm", skip)
            items = [i for i in items if i["id"] not in skip]
        if not items:
            return
        urgent = any(i["data"].get("event") in LOCATION for i in items)
        if len(items) < BATCH_MAX and now - items[0]["ts"] < (2 if urgent else BATCH_WAIT):
            return
        # Un gruppo = stesso comandante e stessa versione del gioco (vanno nei parametri della richiesta).
        meta = items[0]["meta"]
        batch = []
        for i in items:
            if i["meta"] != meta or len(batch) >= BATCH_MAX:
                break
            batch.append(i)
        self.send(batch, meta, cmdr or meta.get("cmdr") or "", key)

    def send(self, batch, meta, cmdr, key):
        ids = [i["id"] for i in batch]
        form = {"commanderName": cmdr, "apiKey": key, "fromSoftware": SOFTWARE, "fromSoftwareVersion": VERSION,
                "fromGameVersion": meta.get("gv") or "", "fromGameBuild": meta.get("gb") or "",
                "message": json.dumps([i["data"] for i in batch], ensure_ascii=False)}
        body = urllib.parse.urlencode(form).encode("utf-8")
        code, text, headers = post(API_URL, body, "application/x-www-form-urlencoded", timeout=30)
        if code != 200:
            self.box.postpone("edsm", ids, backoff(batch[0]["tries"]))
            self.error(pick(f"EDSM non raggiungibile ({code or text}): riprovo più tardi",
                            f"EDSM unreachable ({code or text}): retrying later"))
            return
        try:
            reply = json.loads(text)
            num, msg = int(reply.get("msgnum")), str(reply.get("msg") or "")
        except (ValueError, TypeError, AttributeError):
            self.box.postpone("edsm", ids, backoff(batch[0]["tries"]))
            self.error(pick("EDSM ha risposto in modo inatteso: riprovo più tardi", "Unexpected reply from EDSM: retrying later"))
            return
        self._rate_limit(headers)
        if num in AUTH_ERRORS:
            self.pause(pick(f"EDSM {num}: {msg}. Controlla nome del comandante e chiave API.",
                            f"EDSM {num}: {msg}. Check CMDR name and API key."), (cmdr, key))
            return
        if num in DROP_ERRORS or num // 100 == 3:
            self.box.remove("edsm", ids)
            self.error(pick(f"EDSM {num}: {msg} (eventi scartati)", f"EDSM {num}: {msg} (events discarded)"))
            return
        if num // 100 == 5 and not reply.get("events"):
            self.box.postpone("edsm", ids, backoff(batch[0]["tries"]))
            self.error(pick(f"EDSM {num}: {msg}: riprovo più tardi", f"EDSM {num}: {msg}: retrying later"))
            return
        # 1xx: tutto ricevuto. Per i singoli eventi 101-104 sono avvisi (già salvato, duplicato, equipaggio).
        self.box.remove("edsm", ids)
        self.ok(len(ids))
        bad = [(e["data"].get("event"), r) for e, r in zip(batch, reply.get("events") or [])
               if isinstance(r, dict) and int(r.get("msgnum") or 100) // 100 not in (1, 4, 5)]
        if bad:
            ev, r = bad[-1]
            self.error(pick(f"EDSM {r.get('msgnum')} per {ev}: {r.get('msg')}", f"EDSM {r.get('msgnum')} for {ev}: {r.get('msg')}"))

    def _rate_limit(self, headers):
        """Se EDSM dice che le richieste disponibili sono finite, si aspetta fino al momento indicato."""
        try:
            remaining = int(headers.get("X-Rate-Limit-Remaining", ""))
            reset = int(headers.get("X-Rate-Limit-Reset", ""))
        except ValueError:
            return
        if remaining == 0 and reset > 0:
            wait = reset - time.time() if reset > 10**9 else reset  # istante (come lo legge EDMC) o secondi
            if wait > 0:
                self.hold_until = time.time() + min(3600, wait)
