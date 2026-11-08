"""Test dell'importazione delle build (app/buildshare.py): tutti i formati, limiti e messaggi.

    python tools/test_buildshare.py [cartella del journal]

Campioni reali: tools/fixtures/coriolis_fixtures.json (link e SLEF dai test di EDCD/coriolis, MIT: link /outfit/ prodotti
dall'encoder di Coriolis, SLEF esportati da Inara e da EDSY) e gli eventi Loadout del journal dell'utente (sola lettura,
andata e ritorno in ogni formato). Senza journal quella parte si salta.
"""

import base64
import gzip
import json
import os
import struct
import sys
import urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
from app import buildshare as bs  # noqa: E402

FIX = json.load(open(os.path.join(ROOT, "tools", "fixtures", "coriolis_fixtures.json"), encoding="utf-8"))
passed = failed = 0


def check(cond, msg):
    global passed, failed
    if cond:
        passed += 1
    else:
        failed += 1
        print("  FAIL", msg)


def refused(text, contains):
    try:
        bs.decode_text(text)
    except ValueError as exc:
        return contains.lower() in str(exc).lower()
    return False


print("1. Link /outfit/ di Coriolis (prodotti dall'encoder di Coriolis)")
for d in FIX["detailed"]:
    r = bs.decode_text(d["url"])
    check(r["kind"] == "coriolis_outfit" and r["ship"] == d["ship"] and r["name"] == d["name"], d["file"] + ": nave o nome")
    engineered = sum(1 for x in d["standard"] + d["hardpoints"] + d["utility"] + d["internal"] if x and x.get("blueprint"))
    check(len([m for m in r["mods"] if m.get("bp")]) == engineered, f"{d['file']}: {engineered} moduli ingegnerizzati attesi")
    # Stesso link con il codice nel percorso (/outfit/<nave>/<codice>) e senza https.
    q = dict(urllib.parse.parse_qsl(urllib.parse.urlsplit(d["url"]).query))
    r2 = bs.decode_text("https://coriolis.io/outfit/%s/%s" % (d["ship"], urllib.parse.quote(q["code"], safe="")))
    check(r2["code"] == r["code"] and r2["mods"] == r["mods"], d["file"] + ": codice nel percorso")
for ship, builds in FIX["expected_builds"].items():
    for name, code in builds.items():
        r = bs.decode_text("https://coriolis.io/outfit/%s?code=%s&bn=%s" % (ship, urllib.parse.quote(code, safe=""), urllib.parse.quote(name)))
        check(r["code"] == code.split(".")[0] and r["name"] == name and r["mods"] == [], f"{ship} {name}")
r = bs.decode_text("https://coriolis.io/outfit/anaconda")
check(r["kind"] == "coriolis_outfit" and "code" not in r and r.get("note"), "link senza codice: nave di serie")
check(refused("https://coriolis.io/outfit/anaconda?code=B4pu%3Cscript%3E", "non valido"), "codice con caratteri non ammessi")
check(refused("https://coriolis.io/outfit/anaconda?code=" + "0" * 900, "non valido"), "codice troppo lungo")
# Ingegnerie danneggiate o enormi: come Coriolis si tengono i moduli e si avvisa.
bad = "B4putkFklkdzsuf5" + "-" * 30 + ".x.y." + base64.b64encode(gzip.compress(b"\x01\xfe\x00")).decode()
r = bs.decode_text("https://coriolis.io/outfit/anaconda?code=" + urllib.parse.quote(bad, safe=""))
check(r["mods"] == [] and r.get("note"), "ingegnerie troncate")
bomb = base64.b64encode(gzip.compress(b"\x01" * 5_000_000)).decode()
r = bs.decode_text("https://coriolis.io/outfit/anaconda?code=" + urllib.parse.quote("B4" + ".a.b." + bomb, safe=""))
check(r["mods"] == [] and r.get("note"), "ingegnerie oltre il limite di decompressione")
# Struttura scritta a mano come updateModificationsString: slot 3, blueprint 26, grado 5, sperimentale 120, optmass 5500.
raw = (struct.pack("<b", 3) + struct.pack("<bi", -2, 26) + struct.pack("<bi", -3, 5) + struct.pack("<bi", -4, 120)
       + struct.pack("<bi", 20, 5500) + struct.pack("<b", 40) + b"  TK" + struct.pack("<b", -1) + struct.pack("<b", -1))
enc = base64.b64encode(gzip.compress(raw)).decode().replace("/", "-").replace("+", "_")  # alfabeto di Utils.toUrlSafe
check(bs.decode_coriolis_mods(enc) == [{"slot": 3, "bp": 26, "grade": 5, "sp": 120, "mods": {"20": 5500}}], "struttura binaria delle ingegnerie")

print("2. SLEF (Inara: array; EDSY: oggetto singolo)")
for f, obj in FIX["slef"].items():
    r = bs.decode_text(json.dumps(obj))
    data = obj[0]["data"] if isinstance(obj, list) else obj["data"]
    check(r["loadout"]["Ship"] == data["Ship"] and len(r["loadout"]["Modules"]) == len(data["Modules"]), f + ": moduli")
    if isinstance(obj, list) and len(obj) > 1:
        check("2" in (r.get("note") or "") or str(len(obj)) in (r.get("note") or ""), f + ": avviso con il numero di build")
    single = json.dumps(obj[0] if isinstance(obj, list) else obj)
    check(bs.decode_text(single)["loadout"] == r["loadout"], f + ": come oggetto singolo")
    check(bs.decode_text(bs.encode(obj))["loadout"] == r["loadout"], f + ": compresso in base64")

print("3. Link e testi che non si possono leggere: messaggi chiari")
check(refused("https://edsy.org/#/L=AbCdEf123", "SLEF"), "EDSY #/L= rifiutato indicando SLEF")
check(refused("https://inara.cz/elite/cmdr-fleet/123/456/", "SLEF"), "pagina Inara: copia il formato SLEF")
check(refused("https://s.orbis.zone/abcd", "abbreviato") or refused("https://s.orbis.zone/abcd", "short"), "link abbreviato")
check(refused("https://example.com/build", "SLEF"), "sito sconosciuto")
check(refused("x" * (bs.MAX_TEXT + 1), "lungo") or refused("x" * (bs.MAX_TEXT + 1), "long"), "testo oltre il limite")
check(refused(bs.encode({"a": "x" * 2_000_000}), "grand") or refused(bs.encode({"a": "x" * 2_000_000}), "large"), "bomba gzip")
check(refused('{"Ship": "../../etc", "Modules": []}', "Ship"), "simbolo della nave non valido")
lo = bs.decode_text(json.dumps({"event": "Loadout", "Ship": "cobramkv", "Modules": [
    {"Slot": "Slot01_Size5", "Item": "int_cargorack_size5_class1"}, {"Slot": "<b>", "Item": "x"}, {"Slot": "A", "Item": "y" * 200}],
    "ShipName": "a\x00b" + "c" * 100, "Evil": {"__proto__": 1}}))["loadout"]
check(len(lo["Modules"]) == 1 and "Evil" not in lo and lo["ShipName"] == "ab" + "c" * 38, "campi e valori ripuliti")

print("4. Andata e ritorno con i Loadout del journal")
jdir = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("ED_JOURNAL_DIR") or os.path.join(
    os.path.expanduser("~"), "Saved Games", "Frontier Developments", "Elite Dangerous")
seen = {}
if os.path.isdir(jdir):
    for f in sorted(os.listdir(jdir)):
        if f.startswith("Journal.") and f.endswith(".log"):
            with open(os.path.join(jdir, f), encoding="utf-8", errors="replace") as fh:
                for line in fh:
                    if '"event":"Loadout"' in line:
                        e = json.loads(line)
                        seen[json.dumps(e["Modules"], sort_keys=True) + e["Ship"]] = e
for e in seen.values():
    want = bs.clean_loadout(e)
    blob = bs.encode({k: v for k, v in e.items() if k != "timestamp"})
    forms = {
        "JSON": json.dumps(e), "SLEF array": json.dumps([{"header": {"appName": "x"}, "data": e}]),
        "SLEF oggetto": json.dumps({"header": {"appName": "x"}, "data": e}), "base64": blob,
        "import?data=": "https://coriolis.io/import?data=" + blob, "#/I=": "https://edsy.org/#/I=" + blob,
    }
    for name, text in forms.items():
        check(bs.decode_text(text)["loadout"] == want, f"{e['Ship']} {e['timestamp']}: {name}")
print(f"   {len(seen)} Loadout del journal" if seen else f"   (nessun Loadout in {jdir}: parte saltata)")

print(f"\n{passed} controlli superati, {failed} falliti")
sys.exit(1 if failed else 0)
