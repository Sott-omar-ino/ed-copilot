"""Coda persistente degli invii e base comune dei tre "postini" (EDDN, EDSM, Inara).

La coda vive in memoria e viene salvata su disco (al massimo ogni pochi secondi) dai thread di invio, mai dal
thread del journal: così chiudere l'app o restare senza rete non fa perdere nulla.
"""

import gzip
import json
import threading
import time
import urllib.error
import urllib.request

from .. import VERSION, paths, storage
from ..lang import pick

DESTS = ("eddn", "edsm", "inara")
QUEUE_FILE = paths.cache_file("invio_coda.json")
MAX_ITEMS = {"eddn": 1000, "edsm": 5000, "inara": 2000}
SAVE_EVERY = 3
USER_AGENT = f"ED-Copilot/{VERSION}"


class Outbox:
    def __init__(self, path=QUEUE_FILE):
        self.path = path
        self.lock = threading.Lock()
        data = (storage.load_json(path, {}) or {}) if path else {}
        self.items = {d: [i for i in data.get(d, []) if isinstance(i, dict) and "data" in i] for d in DESTS}
        self.seq = max((i.get("id", 0) for q in self.items.values() for i in q), default=0)
        self.dirty, self.saved = False, 0.0

    def put(self, dest, data, meta=None, key=None, merge=None):
        """Accoda. Con `key` sostituisce un elemento ancora in coda con la stessa chiave (merge(vecchio, nuovo))."""
        with self.lock:
            q = self.items[dest]
            if key:
                for i, old in enumerate(q):
                    if old.get("key") == key:
                        if merge:
                            data = merge(old["data"], data)
                        del q[i]
                        break
            self.seq += 1
            q.append({"id": self.seq, "ts": time.time(), "tries": 0, "next": 0, "key": key, "meta": meta or {}, "data": data})
            del q[:-MAX_ITEMS[dest]]
            self.dirty = True

    def ready(self, dest, limit, now=None):
        now = now or time.time()
        with self.lock:
            return [i for i in self.items[dest] if i["next"] <= now][:limit]

    def remove(self, dest, ids):
        ids = set(ids)
        if not ids:
            return
        with self.lock:
            self.items[dest] = [i for i in self.items[dest] if i["id"] not in ids]
            self.dirty = True

    def postpone(self, dest, ids, delay):
        ids, until = set(ids), time.time() + delay
        with self.lock:
            for i in self.items[dest]:
                if i["id"] in ids:
                    i["tries"] += 1
                    i["next"] = until
            self.dirty = True

    def clear(self, dest):
        with self.lock:
            if self.items[dest]:
                self.items[dest] = []
                self.dirty = True

    def count(self, dest):
        with self.lock:
            return len(self.items[dest])

    def flush(self, force=False):
        if not self.path or not self.dirty or (not force and time.time() - self.saved < SAVE_EVERY):
            return
        with self.lock:
            snapshot = {d: list(q) for d, q in self.items.items()}
            self.dirty, self.saved = False, time.time()
        try:
            storage.save_json(self.path, snapshot)
        except OSError as exc:
            print(f"[Invio] Coda non salvata: {exc!r}")


def post(url, body, content_type="application/json", timeout=20, gzip_over=None):
    """POST HTTP/1.1. Restituisce (codice, testo, intestazioni); codice None se la rete non risponde.

    gzip_over: comprime il corpo oltre quella dimensione (solo dove il servizio lo documenta, cioè EDDN).
    """
    headers = {"Content-Type": content_type, "User-Agent": USER_AGENT}
    if gzip_over is not None and len(body) > gzip_over:
        body, headers["Content-Encoding"] = gzip.compress(body), "gzip"
    req = urllib.request.Request(url, data=body, method="POST", headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.read().decode("utf-8", "replace"), dict(r.headers)
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode("utf-8", "replace"), dict(exc.headers or {})
    except (OSError, ValueError) as exc:
        return None, str(getattr(exc, "reason", exc)), {}


def get_json(url, timeout=20):
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode("utf-8"))


class Sender:
    """Un thread per destinazione: una destinazione lenta o irraggiungibile non blocca le altre."""
    name = ""
    TICK = 1.0

    def __init__(self, box, config):
        self.box, self.config = box, config     # config(): impostazioni correnti (app_config in cache)
        self.last_ok = self.last_error = self.error_ts = None
        self.paused = None                      # testo dell'errore che ha fermato gli invii (chiave errata ecc.)
        self.paused_for = None                  # credenziali per cui vale la pausa: se cambiano, si riprova
        self.sent = 0

    def start(self):
        threading.Thread(target=self._loop, name=f"invio-{self.name}", daemon=True).start()

    def _loop(self):
        while True:
            try:
                self.tick()
            except Exception as exc:  # un errore imprevisto non deve fermare il thread
                self.error(pick(f"errore interno: {exc!r}", f"internal error: {exc!r}"))
                time.sleep(30)
            self.box.flush()
            time.sleep(self.TICK)

    def tick(self):
        raise NotImplementedError

    def ok(self, n=1):
        self.last_ok, self.sent = time.time(), self.sent + n

    def error(self, text):
        self.last_error, self.error_ts = text, time.time()
        print(f"[Invio {self.name}] {text}")

    def pause(self, text, creds):
        self.paused, self.paused_for = text, creds
        self.error(text)

    def check_pause(self, creds):
        """True se gli invii sono fermi per un errore di credenziali che l'utente non ha ancora corretto."""
        if self.paused and creds != self.paused_for:
            self.paused = self.paused_for = None
        return bool(self.paused)

    def resume(self):
        self.paused = self.paused_for = None

    def status(self):
        return {"queued": self.box.count(self.name), "last_ok": self.last_ok, "last_error": self.last_error,
                "error_ts": self.error_ts, "paused": self.paused, "sent": self.sent}


def backoff(tries, base=60, top=3600):
    return min(top, base * 2 ** min(tries, 6))
