"""Consigli su cosa fare, ricavati dallo stato del comandante. Ogni consiglio ha un id stabile per poterlo ignorare.

Fonti dei fatti di gioco citati nei testi (verificate l'08/11/2026):
- Increased Range G5: optimal mass +45..+55% (EDCD/coriolis-data, modifications/blueprints.json, FSD_LongRange);
  la gittata cresce in proporzione all'optimal mass, meno l'aumento di massa del modulo: "circa +50%".
- Guardian FSD Booster: +4 / 6 / 7,75 / 9,25 / 10,5 al per le classi 1-5
  (EDCD/coriolis-data, modules/internal/guardian_fsd_booster.json).
- Interstellar Factors: paga taglie/multe di altre giurisdizioni con commissione del 25%, serve Notoriety 0
  (Elite Dangerous Wiki, "Interstellar Factor").
- Permesso di Shinrarta Dezhra: rango Elite in una qualsiasi categoria (Elite Dangerous Wiki, "Founders World").
- Valori base delle specie: gamedata.SPECIES_VALUES (catalogo di EDMC-BioScan), Fonticulua Fluctus 20.000.000 Cr,
  Stratum Tectonicas 19.010.800 Cr.
- Fuel scoop: rifornimento dalle stelle KGBFOAM (gamedata.SCOOPABLE; Elite Dangerous Wiki, "Fuel Scoop").
- Ingegneri: ogni modifica fatta da un ingegnere aumenta la reputazione con lui fino a sbloccare il grado successivo
  (Elite Dangerous Wiki, "Engineers").
"""

import math
from datetime import datetime, timezone

from .gamedata import ENGINEERS, RANK_LABELS, RANKS, RANKS_EN
from .lang import pick


def _rank_label(key, label):
    try:
        from .state import rank_label  # nome del rank nella lingua dell'interfaccia
        return rank_label(key)
    except Exception:  # noqa: BLE001
        return label


def _cr(n):
    return f"{n:,.0f}".replace(",", ".") + " Cr"


def _ly(a, b):
    return math.dist(a, b) if a and b else None


def advise(snap, coords, lang="mixed"):
    out = []

    def add(id_, text, category, why, prio=2, system=""):
        out.append({"id": id_, "text": text, "category": category, "why": why, "prio": prio, "system": system or ""})

    cmdr, ship = snap["cmdr"], snap["ship"]
    pos = snap["location"].get("star_pos")
    current = next((f for f in snap["fleet"] if f["current"]), None)
    build = current["build"] if current else None
    ship_name = (current or {}).get("name", "").strip() or ship.get("type") or pick("nave", "ship")

    # Soldi e rischio
    credits = cmdr.get("credits") or 0
    rebuy = (build or {}).get("rebuy") or ship.get("rebuy") or 0
    if rebuy and credits < rebuy:
        add("rebuy", pick(f"Metti da parte il rebuy della {ship_name} ({_cr(rebuy)})",
                          f"Save up the rebuy for the {ship_name} ({_cr(rebuy)})"), "Nave",
            pick(f"Hai {_cr(credits)}: se la distruggi adesso non potresti riscattarla.",
                 f"You have {_cr(credits)}: if you lose it now you couldn't buy it back."), 0)

    if snap["carto_unsold_total"] >= 1_000_000:
        n_sys = snap['carto_unsold_systems']
        add("sell-carto", pick(f"Vendi i dati cartografici (~{_cr(snap['carto_unsold_total'])}) a Universal Cartographics",
                               f"Sell your exploration data (~{_cr(snap['carto_unsold_total'])}) at Universal Cartographics"),
            "Esplorazione",
            pick(f"{n_sys} sistemi non venduti: se muori li perdi.",
                 f"{n_sys} unsold system{'s' if n_sys != 1 else ''}: if you die you lose {'them' if n_sys != 1 else 'it'}."),
            0 if snap["carto_unsold_total"] > 20_000_000 else 1)
    if snap["bio_unsold"]:
        n_bio = len(snap['bio_unsold'])
        add("sell-bio", pick(f"Vendi {n_bio} campioni biologici ({_cr(snap['bio_unsold_total'])}) a Vista Genomics",
                             f"Sell {n_bio} organic sample{'s' if n_bio != 1 else ''} ({_cr(snap['bio_unsold_total'])}) "
                             "at Vista Genomics"),
            "Esobiologia", pick("I campioni non venduti si perdono se muori.", "Unsold samples are lost if you die."), 0 if snap["bio_unsold_total"] > 20_000_000 else 1)
    if snap.get("bio_current"):
        b = snap["bio_current"]
        add(f"bio-{b['species']}", pick(f"Completa il campionamento di {b['species']} ({b['step']}/3)",
                                        f"Finish sampling {b['species']} ({b['step']}/3)"), "Esobiologia",
            pick(f"Il prossimo campione va preso ad almeno {b['min_dist']} m dai precedenti.",
                 f"Take the next sample at least {b['min_dist']} m from the previous ones."), 1)

    # Sistema corrente
    hot = [b for b in snap["system"]["bodies"] if (b.get("value_mapped") or 0) >= 500_000 and not b.get("mapped_by_me")]
    for b in hot[:3]:
        add(f"map-{b['name']}", pick(f"Mappa {b['name']} con le sonde DSS (~{_cr(b['value_mapped'])})",
                                     f"Map {b['name']} with DSS probes (~{_cr(b['value_mapped'])})"), "Esplorazione",
            pick("Tra i corpi più redditizi del sistema in cui ti trovi.",
                 "One of the most valuable bodies in your current system."), 1, snap["system"]["name"])

    # Missioni in scadenza
    now = datetime.now(timezone.utc)
    for m in snap["missions"]:
        if not m.get("expiry"):
            continue
        try:
            left = (datetime.strptime(m["expiry"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc) - now).total_seconds()
        except ValueError:
            continue
        if 0 < left < 6 * 3600:
            hm = f"{int(left // 3600)}h {int(left % 3600 // 60)}m"
            add(f"mission-{m['id']}", pick(f"Completa la missione «{m['name']}» entro {hm}",
                                           f"Complete the mission “{m['name']}” within {hm}"),
                "Missioni", pick(f"Destinazione: {m.get('system') or '—'}.", f"Destination: {m.get('system') or '—'}."),
                0, m.get("system"))

    # Ranghi vicini alla promozione
    for k, label in RANK_LABELS.items():
        r, p = snap["ranks"].get(k), snap["progress"].get(k) or 0
        names = (RANKS if lang == "it" else RANKS_EN).get(k, [])
        if r is not None and r < len(names) - 1 and p >= 75:
            lbl = _rank_label(k, label)
            add(f"rank-{k}-{r}", pick(f"Ti manca poco per diventare {names[r + 1]} in {lbl} ({p}%)",
                                      f"You're close to {names[r + 1]} in {lbl} ({p}%)"), "Generale",
                pick("Un ultimo sforzo per la promozione.", "One last push for the promotion."), 2)

    # Ingegneri
    eng = snap["engineers"]
    candidates = []
    for name, (system, base, kind, spec) in ENGINEERS.items():
        st = eng.get(name, {})
        d = _ly(pos, coords.get(system))
        if st.get("progress") in ("Known", "Invited", "Acquainted"):
            candidates.append((d if d is not None else 1e9, name, system, base, spec, kind))
    for d, name, system, base, spec, kind in sorted(candidates)[:3]:
        where = pick(f" ({d:,.0f} al)".replace(",", "."), f" ({d:,.0f} ly)".replace(",", ".")) if d < 1e9 else ""
        add(f"eng-unlock-{name}", pick(f"Sblocca {name} a {system}{where}", f"Unlock {name} in {system}{where}"),
            "Ingegneri",
            pick(f"Lo conosci già: completa il suo requisito di sblocco. Specialità: {spec}.",
                 f"You already know them: complete their unlock requirement. Specialities: {spec}."), 2, system)
    for name, st in eng.items():
        if st.get("progress") == "Unlocked" and (st.get("rank") or 0) < 5 and name in ENGINEERS:
            add(f"eng-rank-{name}", pick(f"Porta {name} al grado 5 (ora {st.get('rank')})",
                                         f"Get {name} to grade 5 (now {st.get('rank')})"), "Ingegneri",
                pick("Ogni modifica fatta da lui aumenta la reputazione e sblocca i gradi superiori dei blueprint.",
                     "Every modification they craft raises your reputation and unlocks higher blueprint grades."),
                3, ENGINEERS[name][0])

    # Build della nave attuale
    if build:
        mods = [m for g in build["groups"].values() for m in g]
        names = {m["name"] for m in mods}
        fsd = next((m for m in build["groups"]["core"] if m["slot"] == "FrameShiftDrive"), None)
        if not any("Fuel Scoop" in n for n in names):
            add(f"scoop-{current['id']}", pick(f"Monta un fuel scoop sulla {ship_name}", f"Fit a fuel scoop on the {ship_name}"),
                "Nave",
                pick("Senza fuel scoop puoi rifornirti solo nelle stazioni: con uno scoop fai il pieno dalle stelle KGBFOAM.",
                     "Without a fuel scoop you can only refuel at stations: with one you can refuel from KGBFOAM stars."), 1)
        farseer = eng.get("Felicity Farseer", {}).get("progress")
        if fsd and not fsd.get("blueprint"):
            who = "Felicity Farseer (Deciat)" if farseer == "Unlocked" else pick(
                "un ingegnere dell'FSD (Felicity Farseer, Elvira Martuuk...)",
                "an FSD engineer (Felicity Farseer, Elvira Martuuk...)")
            add(f"fsd-eng-{current['id']}", pick(f"Ingegnerizza l'FSD della {ship_name} con Increased Range G5",
                                                 f"Engineer the FSD of the {ship_name} with Increased Range G5"), "Nave",
                pick(f"È il potenziamento più utile per viaggiare: circa +50% di salto al G5. Da {who}.",
                     f"The most useful upgrade for travel: about +50% jump range at G5. Get it from {who}."),
                1, "Deciat" if farseer == "Unlocked" else "")
        elif fsd and fsd.get("blueprint") == "Increased Range" and (fsd.get("grade") or 0) < 5:
            add(f"fsd-g5-{current['id']}", pick(f"Porta l'FSD della {ship_name} al G5 (ora G{fsd.get('grade')})",
                                                f"Take the FSD of the {ship_name} to G5 (now G{fsd.get('grade')})"), "Nave",
                pick("Gli ultimi gradi danno l'aumento di salto maggiore.", "The last grades give the biggest jump range boost."),
                2)
        if not any("Guardian FSD Booster" in n for n in names) and (build.get("jump_range") or 0) < 50:
            add(f"gfsdb-{current['id']}", pick(f"Valuta un Guardian FSD Booster per la {ship_name}",
                                               f"Consider a Guardian FSD Booster for the {ship_name}"), "Nave",
                pick("Aggiunge fino a 10,5 al di salto. Si sblocca con i progetti Guardian presso un Technology Broker.",
                     "Adds up to 10.5 ly of jump range. Unlocked with Guardian blueprints at a Technology Broker."), 3)
        if (build.get("rebuy") or 0) and not any("Shield Generator" in n for n in names) and current.get("symbol") not in ("type8", "type9", "lakonminer"):
            add(f"shield-{current['id']}", pick(f"La {ship_name} non ha scudi", f"The {ship_name} has no shields"), "Nave",
                pick("Un generatore di scudi evita molti rebuy inutili.", "A Shield Generator saves you a lot of needless rebuys."),
                2)

    for f in snap["fleet"]:
        if f.get("hot"):
            sname = f.get('name') or f['type']
            add(f"hot-{f['id']}", pick(f"La {sname} è ricercata: paga le taglie a un Interstellar Factors",
                                       f"The {sname} is wanted: pay off the bounties at an Interstellar Factors"), "Nave",
                pick("Le navi ricercate vengono attaccate dalla sicurezza dove sei ricercato. Interstellar Factors trattiene "
                     "il 25% e serve Notoriety 0.",
                     "Wanted ships are attacked by security where you are wanted. Interstellar Factors takes a 25% cut "
                     "and requires Notoriety 0."), 1, f.get("system"))

    # Materiali pieni
    full = [m for m in snap["materials"] if m.get("cap") and m["count"] >= m["cap"]]
    for m in full[:4]:
        add(f"mat-full-{m['name']}", pick(f"{m['label']} è al massimo ({m['count']}/{m['cap']}): scambialo da un Material Trader",
                                          f"{m['label']} is maxed out ({m['count']}/{m['cap']}): trade it at a Material Trader"),
            "Materiali", pick("Ogni materiale in più che raccogli andrebbe perso.", "Any more you collect would be wasted."), 2)

    # Spunti generali in base a cosa fai
    ranks = snap["ranks"]
    if (ranks.get("Exobiologist") or 0) < 5:
        add("tip-exobio", pick("Prova una rotta esobiologica (scheda Rotte)", "Try an exobiology route (Routes tab)"),
            "Esobiologia",
            pick("Specie come Fonticulua Fluctus o Stratum Tectonicas valgono circa 20 milioni ciascuna (5 volte tanto se sei il primo).",
                 "Species like Fonticulua Fluctus or Stratum Tectonicas are worth about 20 million each "
                 "(5 times as much if you're first)."), 4)
    if any(f.get("symbol") == "lakonminer" for f in snap["fleet"]) and not snap["mining"]["tons"]:
        add("tip-mining", pick("Porta la Type-11 su un hotspot di Painite o Platinum (scheda Mining)",
                               "Take the Type-11 to a Painite or Platinum hotspot (Mining tab)"), "Estrazione",
            pick("Hai una nave da estrazione: con un hotspot vicino i profitti salgono molto.",
                 "You have a mining ship: with a hotspot nearby your profits go way up."), 4)
    if (ranks.get("Combat") or 0) < 2:
        add("tip-combat", pick("Sali di rango in combattimento con taglie nei siti di estrazione (RES)",
                               "Rank up in Combat by hunting bounties at Resource Extraction Sites (RES)"), "Generale",
            pick("Il rango Elite in una categoria serve per il permesso di Shinrarta Dezhra.",
                 "Elite rank in any category is required for the Shinrarta Dezhra permit."), 4)

    out.sort(key=lambda s: s["prio"])
    return out
