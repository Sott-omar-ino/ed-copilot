"""Verifica del convertitore Spansh -> regole (app/bio_predict.py from_spansh), usato dalla rotta esobiologica con previsione.

Prende da Spansh (api/bodies/search, serve la rete) pianeti con segnali biologici già campionati da qualcuno (landmarks)
in zone diverse della galassia, li passa nel convertitore e nella previsione SENZA i generi rilevati col DSS (così si
provano le regole da sole) e controlla che ogni specie registrata sia tra quelle previste.
Uso: python tools/test_bio_spansh.py [pianeti per zona, predefinito 15]
"""

import json
import os
import sys
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app import bio_predict  # noqa: E402

ZONES = ["Colonia", "Sol", "Sagittarius A*", "Beagle Point", "Rohini", "Synuefe XR-H d11-102", "Oevasy SG-Y d0"]
PER_ZONE = int(sys.argv[1]) if len(sys.argv) > 1 else 15
# Lacune note delle regole di BioScan (app/bio_rules.py), non del convertitore: controllate il 10/11/2026 sui dati
# di Spansh, la stessa specie manca anche con i dati del journal. Si elencano ma non fanno fallire il test.
# - Sinuous Tubers: più specie sullo stesso pianeta, fuori dalle zone o dai vulcanismi delle regole;
# - Stratum Limaxus vicino a Colonia: pressione/temperatura fuori dai limiti delle regole;
# - Aureum Brain Tree su un Rocky body (le regole vogliono metallici);
# - Tau Ceti 4 e Flousop A 2 (bolla abitata, a Flousop A 2 anche stazioni di superficie): condizioni del pianeta su
#   Spansh fuori dalle regole della specie registrata (temperatura/atmosfera); causa non verificata.
GAP_SPECIES = ("Sinuous Tubers", "Stratum Limaxus", "Aureum Brain Tree")
GAP_BODIES = ("Tau Ceti 4", "Flousop A 2")


def search(ref):
    body = {"filters": {"is_landable": {"value": True}, "signals": [{"comparison": "<=>", "count": [1, 99], "name": "Biological"}],
                        "distance": {"min": "0", "max": "1000"}},
            "sort": [{"distance": {"direction": "asc"}}], "size": 200, "page": 0, "reference_system": ref}
    req = urllib.request.Request("https://spansh.co.uk/api/bodies/search", data=json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json", "User-Agent": "Voidwatch-ED test"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())["results"]


def main():
    checked = species = 0
    bad, gaps = [], []
    for ref in ZONES:
        taken = 0
        for b in search(ref):
            real = {l["subtype"] for l in b.get("landmarks") or [] if l.get("subtype") in bio_predict.SPECIES_NAMES}
            if not real:
                continue
            p, sy = bio_predict.from_spansh(b)
            p["genera"] = []
            pred = bio_predict.predict_body(p, sy)
            names = {s["name"] for g in pred["genera"] for s in g["species"]}
            for name in real:
                species += 1
                if bio_predict._ALIAS.get(name, name) not in names:
                    known = name.endswith(GAP_SPECIES) or b["name"] in GAP_BODIES
                    (gaps if known else bad).append((b["name"], name, p["cls"], p["atmo"], round(p["gravity"], 3), round(p["temp"] or 0),
                                p["pressure"], p["volcanism"], sy["region"]))
            checked += 1
            taken += 1
            if taken >= PER_ZONE:
                break
    print(f"Pianeti controllati: {checked}, specie registrate: {species}, non previste: {len(bad) + len(gaps)}"
          f" (lacune note delle regole: {len(gaps)})")
    for row in gaps:
        print("  lacuna nota:", *row)
    for row in bad:
        print("  NON PREVISTA:", *row)
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
