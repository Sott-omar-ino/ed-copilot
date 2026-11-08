"""Prova dell'invio dati (app/upload) sui journal veri, senza inviare nulla di reale.

    python tools/test_upload.py [cartella_schemi_eddn] [--eddn-test-send]

- rilegge tutti i journal e costruisce i messaggi per EDDN, EDSM e Inara;
- controlla che nei messaggi EDDN non ci siano chiavi *_Localised né dati personali;
- se indichi la cartella con gli schemi ufficiali (*.json dal ramo live di github.com/EDCD/EDDN/schemas) e
  jsonschema è installato (pip install jsonschema, serve solo qui) li valida tutti;
- prova i "postini" con risposte simulate (nessuna rete);
- con --eddn-test-send manda UN messaggio a EDDN con lo schema di prova (…/journal/1/test).
"""

import glob
import json
import os
import sys
import tempfile
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
os.environ.setdefault("ED_COPILOT_DATA", tempfile.mkdtemp(prefix="edcopilot-test-"))  # niente scritture nei dati veri

from app import paths, upload                    # noqa: E402
from app.upload import eddn, edsm, inara, outbox  # noqa: E402
from app.upload.tracker import Tracker           # noqa: E402

PERSONAL = set(eddn.PERSONAL) | set(eddn.FACTION_PERSONAL)
FAILS = []


def check(cond, text):
    if not cond:
        FAILS.append(text)
        print("  FALLITO:", text)


def walk_keys(o, path=""):
    if isinstance(o, dict):
        for k, v in o.items():
            yield k, path
            yield from walk_keys(v, f"{path}.{k}")
    elif isinstance(o, list):
        for v in o:
            yield from walk_keys(v, path)


def load_validators(folder):
    try:
        import jsonschema
    except ImportError:
        print("jsonschema non installato: salto la validazione con gli schemi ufficiali")
        return {}
    out = {}
    for f in glob.glob(os.path.join(folder, "*-v*.json")):
        with open(f, encoding="utf-8") as fh:
            s = json.load(fh)
        ref = s.get("id", "").rstrip("#")
        cls = jsonschema.validators.validator_for(s)
        out[ref] = cls(s)
    print(f"Schemi EDDN caricati: {len(out)}")
    return out


def replay():
    outbox.MAX_ITEMS.update(eddn=10**7, edsm=10**7, inara=10**7)  # qui serve vedere tutto lo storico
    box = outbox.Outbox(path=None)
    track = Tracker()
    builders = {"eddn": eddn.Builder(paths.JOURNAL_DIR, lambda: None), "inara": inara.Builder(paths.JOURNAL_DIR)}
    cfg = {"upload_eddn": True, "upload_edsm": True, "upload_inara": True}
    events = Counter()
    files = sorted(glob.glob(os.path.join(paths.JOURNAL_DIR, "Journal.*.log")), key=os.path.getmtime)
    for path in files:
        with open(path, encoding="utf-8", errors="replace") as f:
            for line in f:
                try:
                    e = json.loads(line)
                except ValueError:
                    continue
                events[e.get("event")] += 1
                upload.handle(e, box, cfg, track, builders)
    print(f"Journal riletti: {len(files)} file, {sum(events.values())} eventi")
    return box, track, builders, events


def station_files(builders, track):
    """Market/Outfitting/Shipyard/NavRoute: i file contengono solo l'ultima stazione, la usiamo direttamente."""
    out = []
    b = builders["eddn"]
    b.last_station.clear()
    for name in ("Market", "Outfitting", "Shipyard", "NavRoute"):
        data = eddn.read_json(paths.JOURNAL_DIR, f"{name}.json")
        if not data:
            print(f"  {name}.json assente")
            continue
        e = {"timestamp": data.get("timestamp"), "event": name, "MarketID": data.get("MarketID")}
        got = b.build(e, track)
        if name == "NavRoute" and data.get("event") != "NavRoute":
            print(f"  NavRoute.json contiene {data.get('event')} (rotta cancellata): nessun messaggio, come previsto")
            check(not got, "NavRouteClear non deve produrre messaggi")
            continue
        check(bool(got), f"nessun messaggio da {name}.json")
        out += got
        if got and name == "Market":
            check(not b.build(e, track), "lo stesso mercato non deve partire due volte")
    # NavRoute sintetica dal formato del gioco, per provare anche quello schema.
    route = {"timestamp": "2026-11-06T23:41:00Z", "event": "NavRoute", "Route": [
        {"StarSystem": "Sol", "SystemAddress": 10477373803, "StarPos": [0.0, 0.0, 0.0], "StarClass": "G"},
        {"StarSystem": "Alpha Centauri", "SystemAddress": 1458376315610, "StarPos": [3.03125, -0.09375, 3.15625], "StarClass": "G"}]}
    folder = tempfile.mkdtemp()
    with open(os.path.join(folder, "NavRoute.json"), "w", encoding="utf-8") as f:
        json.dump(route, f)
    nb = eddn.Builder(folder)
    got = nb.build({"timestamp": route["timestamp"], "event": "NavRoute"}, track)
    check(len(got) == 1, "NavRoute sintetica non costruita")
    return out + got


def check_eddn(msgs, validators):
    by_schema = Counter()
    invalid = Counter()
    for m in msgs:
        ref = m["$schemaRef"]
        schema = ref.removeprefix("https://eddn.edcd.io/schemas/")
        by_schema[schema] += 1
        for k, path in walk_keys(m["message"]):
            check(not k.endswith("_Localised"), f"{schema}: chiave localizzata {path}.{k}")
            if schema == "journal/1" and k in PERSONAL and path in ("", ".Factions"):
                check(False, f"{schema}: dato personale {path}.{k}")
        for flag in eddn.FLAGS:
            check(flag not in m["message"] or isinstance(m["message"][flag], bool), f"{schema}: {flag} non booleano")
        h = m["header"]
        check(h["softwareName"] == "ED Copilot" and h["softwareVersion"] and h["uploaderID"], f"{schema}: header incompleto")
        check(isinstance(h["gameversion"], str) and isinstance(h["gamebuild"], str), f"{schema}: gameversion/gamebuild")
        v = validators.get(ref.removesuffix("/test"))
        if v:
            errs = sorted(v.iter_errors(m), key=lambda x: x.path)
            if errs:
                invalid[schema] += 1
                if invalid[schema] <= 3:
                    print(f"  NON VALIDO {schema} ({m['message'].get('event')}): {errs[0].message[:200]}")
    for k in sorted(by_schema):
        print(f"  {k:22s} {by_schema[k]:5d} messaggi" + (f"  ({invalid[k]} NON VALIDI)" if invalid[k] else "  validi" if validators else ""))
    check(not invalid, f"messaggi non validi per gli schemi: {dict(invalid)}")
    expected = {"journal/1", "fssdiscoveryscan/1", "navroute/1", "approachsettlement/1", "codexentry/1", "fssbodysignals/1",
                "fssallbodiesfound/1", "navbeaconscan/1", "scanbarycentre/1", "commodity/3", "outfitting/2", "shipyard/2"}
    check(expected <= set(by_schema), f"schemi senza messaggi: {expected - set(by_schema)}")
    journal_events = Counter(m["message"]["event"] for m in msgs if m["$schemaRef"].endswith("journal/1"))
    print("  journal/1 per evento:", dict(journal_events))


def check_edsm(box):
    items = box.items["edsm"]
    keys = ("_systemAddress", "_systemName", "_systemCoordinates", "_marketId", "_stationName", "_shipId")
    check(all(all(k in i["data"] for k in keys) for i in items), "EDSM: stati transitori mancanti")
    with_sys = sum(1 for i in items if i["data"]["_systemName"])
    print(f"  EDSM: {len(items)} eventi in coda, {with_sys} con il sistema noto")
    check(all(i["meta"].get("gv") for i in items), "EDSM: versione del gioco mancante")


def check_inara(box):
    items = box.items["inara"]
    names = Counter(i["data"]["eventName"] for i in items)
    print(f"  Inara: {len(items)} eventi in coda dopo le sostituzioni:", dict(names))
    for i in items:
        json.dumps(i["data"])
        check(i["data"]["eventTimestamp"].endswith("Z"), "Inara: timestamp non ISO")
    one_of_each = {"setCommanderInventoryMaterials", "setCommanderInventoryCargo", "setCommanderStorageModules",
                   "setCommanderGameStatistics", "setCommanderCredits", "setCommanderTravelLocation"}
    for n in one_of_each & set(names):
        check(names[n] == 1, f"Inara: {n} dovrebbe essere sostituito in coda, non accumulato ({names[n]})")


def check_filters(track):
    """Beta, Legacy ed equipaggio bloccano tutto; uno Scan di un altro sistema non parte su EDDN."""
    t = Tracker()
    t.update({"event": "Fileheader", "gameversion": "4.0.0.100 Beta", "build": "r1"})
    check(t.game_ok() is not None, "beta non riconosciuta")
    t.update({"event": "Fileheader", "gameversion": "3.8.0.407", "build": "r1"})
    check(t.game_ok() is not None, "Legacy non riconosciuta")
    t.update({"event": "Fileheader", "gameversion": "4.4.2.1", "build": "r1"})
    check(t.game_ok() is None, "versione live rifiutata")
    t.update({"event": "LoadGame", "Commander": "Io", "Horizons": True, "Odyssey": True})
    t.update({"event": "JoinACrew", "Captain": "Altro"})
    check(t.in_crew(), "equipaggio non riconosciuto")
    t.update({"event": "QuitACrew", "Captain": "Altro"})
    t.update({"event": "FSDJump", "StarSystem": "Sol", "SystemAddress": 10477373803, "StarPos": [0, 0, 0],
              "FuelLevel": 3, "JumpDist": 4.2, "Factions": [{"Name": "X", "MyReputation": 10, "Influence": 0.5}]})
    b = eddn.Builder(tempfile.mkdtemp())
    scan = {"timestamp": "2026-01-01T00:00:00Z", "event": "Scan", "StarSystem": "Altro", "SystemAddress": 1, "BodyName": "x",
            "BodyID": 1}
    check(not b.build(scan, t), "Scan di un altro sistema non deve partire")
    scan.update(StarSystem="Sol", SystemAddress=10477373803)
    m = b.build(scan, t)
    check(m and m[0]["message"]["StarPos"] == [0, 0, 0], "Scan nel sistema corrente senza StarPos aggiunto")
    j = b.build({"timestamp": "2026-01-01T00:00:00Z", "event": "FSDJump", "StarSystem": "Sol", "SystemAddress": 10477373803,
                 "StarPos": [0, 0, 0], "FuelLevel": 3, "JumpDist": 4.2, "SystemFaction_Localised": "x",
                 "Factions": [{"Name": "X", "MyReputation": 10, "Influence": 0.5}]}, t)[0]["message"]
    check("FuelLevel" not in j and "JumpDist" not in j and "MyReputation" not in j["Factions"][0], "dati personali in FSDJump")
    t2 = Tracker()
    t2.update({"event": "Fileheader", "gameversion": "4.4.2.1", "build": "r1"})
    t2.update({"event": "LoadGame", "Commander": "Io", "Horizons": True})  # client senza Odyssey nel LoadGame
    t2.update({"event": "FSDJump", "StarSystem": "Sol", "SystemAddress": 10477373803, "StarPos": [0, 0, 0]})
    m = b.build({"timestamp": "2026-01-01T00:00:00Z", "event": "FSDJump", "StarSystem": "Sol", "SystemAddress": 10477373803,
                 "StarPos": [0, 0, 0]}, t2)[0]["message"]
    check("odyssey" not in m and m.get("horizons") is True, "flag odyssey da omettere se assente nel LoadGame")


class FakePost:
    def __init__(self, replies):
        self.replies, self.calls = list(replies), []

    def __call__(self, url, body, *a, **k):
        self.calls.append((url, body))
        return self.replies.pop(0)


def check_senders():
    """I postini con risposte simulate: niente rete."""
    cfg = {"upload_eddn": True, "upload_edsm": True, "upload_inara": True, "edsm_cmdr": "Io", "edsm_api_key": "abc123",
           "inara_api_key": "k1"}
    box = outbox.Outbox(path=None)
    for n in range(3):
        box.put("eddn", {"$schemaRef": "https://eddn.edcd.io/schemas/journal/1", "n": n})
    s = eddn.EddnSender(box, lambda: cfg)
    eddn.post = FakePost([(200, "OK", {}), (400, "FAIL: Schema Validation", {}), (503, "down", {})])
    s.tick()
    check(box.count("eddn") == 1 and box.items["eddn"][0]["next"] > 0, "EDDN: 200 tolto, 400 scartato, 503 rimandato")
    check(s.sent == 1 and "503" in s.last_error, "EDDN: stato dopo gli invii")

    box.put("edsm", {"event": "FSDJump", "timestamp": "x"}, {"cmdr": "Io", "gv": "4.4", "gb": "r"})
    box.put("edsm", {"event": "Music", "timestamp": "x"}, {"cmdr": "Io", "gv": "4.4", "gb": "r"})
    s = edsm.EdsmSender(box, lambda: cfg)
    s.discard = {"Music"}
    box.items["edsm"][0]["ts"] -= 60
    edsm.post = FakePost([(200, json.dumps({"msgnum": 203, "msg": "Commander name/API Key not found"}), {})])
    s.tick()
    check(s.paused and box.count("edsm") == 1, "EDSM: 203 deve fermare gli invii e tenere la coda (Music scartato)")
    s.tick()
    check(len(edsm.post.calls) == 1, "EDSM: in pausa non si riprova con la stessa chiave")
    cfg["edsm_api_key"] = "nuova1"
    edsm.post = FakePost([(200, json.dumps({"msgnum": 100, "msg": "OK", "events": [{"msgnum": 100, "msg": "OK"}]}), {})])
    s.tick()
    check(not s.paused and box.count("edsm") == 0 and s.sent == 1, "EDSM: con la chiave nuova si riprova e si svuota")
    body = edsm.post.calls[0][1].decode()
    check("fromGameVersion=4.4" in body and "apiKey=nuova1" in body, "EDSM: parametri della richiesta")

    box.put("inara", {"eventName": "setCommanderCredits", "eventTimestamp": "2099-01-01T00:00:00Z", "eventData": {}},
            {"cmdr": "Io", "fid": "F1"})
    box.items["inara"][0]["ts"] -= 60
    s = inara.InaraSender(box, lambda: cfg)
    inara.post = FakePost([(200, json.dumps({"header": {"eventStatus": 400, "eventStatusText": "Invalid application name"}}), {})])
    s.tick()
    check(s.paused and "Invalid application name" in s.paused and box.count("inara") == 1,
          "Inara: rifiuto del gruppo -> pausa con il testo di Inara, eventi in coda")
    sent = json.loads(inara.post.calls[0][1])
    check(sent["header"]["appName"] == "ED Copilot" and sent["header"]["commanderName"] == "Io", "Inara: header")

    # coda persistente e sostituzioni
    path = os.path.join(tempfile.mkdtemp(), "coda.json")
    b1 = outbox.Outbox(path)
    b1.put("inara", {"eventData": {"a": 1}}, key="ship:1", merge=inara._merge)
    b1.put("inara", {"eventData": {"b": 2}}, key="ship:1", merge=inara._merge)
    b1.flush(force=True)
    b2 = outbox.Outbox(path)
    check(b2.count("inara") == 1 and b2.items["inara"][0]["data"]["eventData"] == {"a": 1, "b": 2},
          "coda: unione per chiave e rilettura da disco")


def eddn_test_send(track):
    """UN messaggio vero a EDDN, sullo schema di prova (/test), per verificare il percorso HTTP."""
    eddn.TEST = True
    b = eddn.Builder(paths.JOURNAL_DIR)
    e = {"timestamp": "2026-11-06T23:00:00Z", "event": "FSDJump", "StarSystem": "Sol", "SystemAddress": 10477373803,
         "StarPos": [0.0, 0.0, 0.0], "SystemAllegiance": "Federation"}
    msg = b.build(e, track)[0]
    assert msg["$schemaRef"].endswith("/journal/1/test")
    code, text, _ = outbox.post(eddn.UPLOAD_URL, json.dumps(msg).encode("utf-8"), gzip_over=4096)
    print(f"  EDDN /test: HTTP {code} {text.strip()[:200]}")
    check(code == 200, "invio di prova a EDDN non riuscito")


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    validators = load_validators(args[0]) if args else {}
    print("Journal:", paths.JOURNAL_DIR)
    box, track, builders, events = replay()
    print(f"Comandante {track.cmdr}, gioco {track.gameversion}, horizons={track.horizons} odyssey={track.odyssey}")
    msgs = [i["data"] for i in box.items["eddn"]] + station_files(builders, track)
    print("EDDN:")
    check_eddn(msgs, validators)
    dropped = sum(events[e] for e in eddn.JOURNAL_EVENTS) - sum(1 for m in msgs if m["$schemaRef"].endswith("journal/1"))
    print(f"  eventi journal/1 non inviati (controllo della posizione, CQC, equipaggio): {dropped}")
    print("EDSM:")
    check_edsm(box)
    print("Inara:")
    check_inara(box)
    print("Filtri:")
    check_filters(track)
    print("Postini (risposte simulate):")
    check_senders()
    if "--eddn-test-send" in sys.argv:
        print("Invio di prova:")
        eddn_test_send(track)
    print("\nRISULTATO:", "tutto ok" if not FAILS else f"{len(FAILS)} problemi")
    sys.exit(1 if FAILS else 0)


if __name__ == "__main__":
    main()
