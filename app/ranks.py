"""Rank e reputazione: avanzamento, permessi e navi sbloccabili, reputazione con superpotenze e minor faction,
storico delle promozioni.

Dati: rank/progress/reputazione dallo stato in diretta (journal.STATE); dai journal (tutti, con cache per file:
nome + dimensione + data di modifica) si ricavano le promozioni, la reputazione con le minor faction incontrate
(FSDJump/Location -> Factions[].MyReputation) e il rank CQC, che lo stato non conserva.

FONTI (verificate l'8/11/2026):
- Ranghi Federal Navy e cosa sbloccano: Elite Dangerous Wiki (fandom), pagine "Federation/Ranks",
  "Federal Navy" (tabella navi, colonna "Rank required") e "Permits/Federation" (Career Rank Permits).
  Le tre pagine concordano: Midshipman = Federal Dropship; Petty Officer = Sol; Chief Petty Officer = Federal
  Assault Ship, Vega, Beta Hydri; Warrant Officer = PLX 695; Ensign = Federal Gunship, Ross 128;
  Lieutenant = Exbeur; Post Commander = Hors; Rear Admiral = Federal Corvette.
- Ranghi Imperial Navy: pagine "Empire/Ranks", "Imperial Navy" e "Permits/Empire": Master = Imperial Courier;
  Squire = Achenar; Baron = Imperial Clipper, Summerland; Duke = Imperial Cutter. (Earl = Facece: escluso, vedi UNLOCKS.)
- Controllo incrociato dei permessi: API pubblica EDSM (systems?showPermit=1) indica requirePermit per Sol, Vega,
  Beta Hydri, PLX 695, Ross 128, Exbeur, Hors, Achenar, Summerland, Shinrarta Dezhra (permitName "Founders World").
- Inviti degli engineer: pagina "The Sarge" ("Gain a Federal Navy rank of Midshipman or higher") e pagina
  "Hera Tani" ("Gain an Imperial Navy rank of Outsider or higher").
- Shinrarta Dezhra (Jameson Memorial): pagine "Shinrarta Dezhra" e "Permits/Independent": permesso con Elite in
  Combat, Trade, Exploration, Mercenary o Exobiology. (La pagina "Pilots Federation" dice "Elite in any field":
  per il CQC le fonti non concordano, quindi per il CQC non lo indichiamo.)
- Promozioni nelle navy: pagine "Federation/Ranks" e "Empire/Ranks", sezione "Promotion": al 100% di progresso
  le minor faction allineate con cui sei almeno Cordial offrono promotion mission ("Federal Navy ..." /
  "Imperial Navy ..."); completandola sali di un rank; il progresso oltre il 100% non va perso.
- Come si sale nei rank della Pilots Federation: pagina "Ranks" (tabella delle categorie).
- Nomi dei rank CQC: pagina "Pilots Federation" (Helpless ... Legend, Elite).
- Reputazione: il journal riporta valori da -100 a +100 (Frontier Journal Manual, eventi Reputation e
  FSDJump/Location; confermato da uno sviluppatore di EDDI, github.com/EDCD/EDDI/discussions/2254).
  Le SOGLIE dei livelli non sono pubblicate da Frontier e le fonti della community non concordano
  (wiki fandom "Reputation": Cordial 15, Friendly 35, Allied 75, senza soglie negative; EDDiscovery,
  EliteDangerousCore/.../Enumerations/Factions.cs, segnate "TBC": Hostile < -90, Unfriendly <= -35,
  Neutral <= 4, Cordial <= 35, Friendly <= 90, Allied > 90). Usiamo quelle di EDDiscovery (le uniche complete)
  e nell'interfaccia il livello è indicato come STIMA.
"""

import json
import os
import threading

from . import journal, paths, storage
from .gamedata import RANKS_EN
from .lang import pick_d

CACHE_FILE = paths.cache_file("ranks.json")
VERSION = 1
LOCK = threading.Lock()
FILES = None  # nome file -> {"sig": [...], "promotions": [...], "factions": {...}, "rank": {...}, "progress": {...}}

CQC_EN = ["Helpless", "Mostly Helpless", "Amateur", "Semi Professional", "Professional", "Champion", "Hero",
          "Legend", "Elite", "Elite I", "Elite II", "Elite III", "Elite IV", "Elite V"]
ORDER = ["Combat", "Trade", "Explore", "CQC", "Soldier", "Exobiologist", "Federation", "Empire"]
LABELS = {"Combat": "Combat", "Trade": "Trade", "Explore": "Exploration", "CQC": "CQC", "Soldier": "Mercenary",
          "Exobiologist": "Exobiologist", "Federation": "Federal Navy", "Empire": "Imperial Navy"}

# Cosa sblocca il rank (indice = valore del journal). Fonti: vedi intestazione.
UNLOCKS = {
    "Federation": {
        3: ["Ship: Federal Dropship", {"it": "Invito dell'engineer The Sarge", "en": "Invite from engineer The Sarge"}],
        4: ["Permit: Sol"],
        5: ["Ship: Federal Assault Ship", "Permit: Vega", "Permit: Beta Hydri"],
        6: ["Permit: PLX 695"],
        7: ["Ship: Federal Gunship", "Permit: Ross 128"],
        8: ["Permit: Exbeur"],
        10: ["Permit: Hors"],
        12: ["Ship: Federal Corvette"],
    },
    "Empire": {
        1: [{"it": "Invito dell'engineer Hera Tani", "en": "Invite from engineer Hera Tani"}],
        3: ["Ship: Imperial Courier"],
        4: ["Permit: Achenar"],
        7: ["Ship: Imperial Clipper", "Permit: Summerland"],
        # Earl = permesso Facece secondo la wiki e EDSM (requirePermit), MA il journal reale di un comandante con
        # rank Empire 0 contiene un FSDJump in Facece (19/07/2026): dato non confermato, quindi non lo mostriamo.
        12: ["Ship: Imperial Cutter"],
    },
}
ELITE_PERMIT = "Permit: Shinrarta Dezhra (Jameson Memorial)"
ELITE_PERMIT_KEYS = ("Combat", "Trade", "Explore", "Soldier", "Exobiologist")
for _k in ELITE_PERMIT_KEYS:
    UNLOCKS[_k] = {8: [ELITE_PERMIT]}

# Come si avanza (pagine "Ranks", "Federation/Ranks", "Empire/Ranks" della wiki). Testi {"it", "en"}: pick_d() nell'API.
HOWTO = {
    "Combat": {"it": "Si sale solo distruggendo navi e skimmer.",
               "en": "You only rank up by destroying ships and skimmers."},
    "Trade": {"it": "Profitti dal commercio di merci, trasporto di passeggeri, mining e vendita delle risorse.",
              "en": "Profits from commodity trading, passenger transport, mining and selling the resources."},
    "Explore": {"it": "Vendita dei dati di esplorazione a Universal Cartographics, trasporto di passeggeri VIP verso "
                      "mete turistiche lontane.",
                "en": "Selling exploration data to Universal Cartographics, carrying VIP passengers to distant "
                      "tourist destinations."},
    "CQC": {"it": "Partite nel CQC Championship.", "en": "Matches in the CQC Championship."},
    "Soldier": {"it": "Attività di combattimento e infiltrazione On Foot, missioni On Foot, eliminazione del personale "
                      "delle settlement.",
                "en": "On Foot combat and infiltration, On Foot missions, eliminating settlement personnel."},
    "Exobiologist": {"it": "Campioni raccolti col Genetic Sampler e venduti a Vista Genomics.",
                     "en": "Samples collected with the Genetic Sampler and sold to Vista Genomics."},
    "Federation": {"it": "Missioni e altre attività favorevoli per minor faction allineate con la Federation.",
                   "en": "Missions and other favourable actions for minor factions aligned with the Federation."},
    "Empire": {"it": "Missioni e altre attività favorevoli per minor faction allineate con l'Empire.",
               "en": "Missions and other favourable actions for minor factions aligned with the Empire."},
}
NAVY_TIPS = [
    {"it": "Valgono le missioni (e le altre attività favorevoli) per minor faction allineate con la superpotenza.",
     "en": "Missions (and other favourable actions) for minor factions aligned with the superpower count."},
    {"it": "Tipi di missione indicati come rapidi: consegna di cargo, donazioni (charity), data courier; "
           "passeggeri e source-and-return per faction allineate in stazioni danneggiate o in riparazione.",
     "en": "Mission types reported as quick: cargo delivery, donations (charity), data courier; "
           "passengers and source-and-return for aligned factions at damaged or repairing stations."},
    {"it": "Al 100% di progresso le faction allineate con cui sei almeno Cordial offrono la promotion mission "
           "(nel titolo c'è \"Federal Navy\" o \"Imperial Navy\"): completandola sali di un rank.",
     "en": "At 100% progress, aligned factions where you are at least Cordial offer the promotion mission "
           "(its title contains \"Federal Navy\" or \"Imperial Navy\"): complete it to rank up."},
    {"it": "Il progresso oltre il 100% non va perso mentre aspetti la promotion mission.",
     "en": "Progress above 100% isn't lost while you wait for the promotion mission."},
]


def _loc(items):
    return [pick_d(i) for i in items]

# Soglie STIMATE (vedi intestazione): (limite superiore incluso, livello).
REP_LEVELS = [(-90.0001, "Hostile"), (-35, "Unfriendly"), (4, "Neutral"), (35, "Cordial"), (90, "Friendly"),
              (100.0001, "Allied")]


def rep_level(v):
    if not isinstance(v, (int, float)):
        return None
    for top, name in REP_LEVELS:
        if v <= top:
            return name
    return "Allied"


def rank_names(key):
    return CQC_EN if key == "CQC" else RANKS_EN.get(key, [])


# ============================================================================
# Lettura dei journal
# ============================================================================
WANTED = ('"event":"Promotion"', '"event":"FSDJump"', '"event":"Location"', '"event":"Rank"', '"event":"Progress"',
          '"event":"CarrierJump"')


def parse_file(path):
    out = {"promotions": [], "factions": {}, "rank": {}, "progress": {}}
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            for line in f:
                compact = line[:120].replace(" ", "")
                if not any(w in compact for w in WANTED):
                    continue
                try:
                    e = json.loads(line)
                except ValueError:
                    continue
                ev, ts = e.get("event"), e.get("timestamp")
                if ev == "Promotion":
                    for k in ORDER:
                        if isinstance(e.get(k), int):
                            out["promotions"].append({"ts": ts, "key": k, "rank": e[k]})
                elif ev == "Rank":
                    out["rank"] = {k: e[k] for k in ORDER if isinstance(e.get(k), int)} | {"ts": ts}
                elif ev == "Progress":
                    out["progress"] = {k: e[k] for k in ORDER if isinstance(e.get(k), (int, float))} | {"ts": ts}
                else:
                    system = e.get("StarSystem")
                    for fa in e.get("Factions") or []:
                        name, rep = fa.get("Name"), fa.get("MyReputation")
                        if not name or not isinstance(rep, (int, float)):
                            continue
                        cur = out["factions"].setdefault(name, {"systems": []})
                        cur.update(rep=rep, ts=ts, system=system, allegiance=fa.get("Allegiance"),
                                   government=fa.get("Government"))
                        if system and system not in cur["systems"]:
                            cur["systems"].append(system)
    except OSError:
        pass
    return out


def _refresh():
    global FILES
    if FILES is None:
        data = storage.load_json(CACHE_FILE, {})
        FILES = data.get("files", {}) if isinstance(data, dict) and data.get("v") == VERSION else {}
    seen, changed, entries = set(), False, []
    for path in journal.journal_files():
        name = os.path.basename(path)
        try:
            st = os.stat(path)
        except OSError:
            continue
        sig = [st.st_size, int(st.st_mtime)]
        seen.add(name)
        entry = FILES.get(name)
        if not entry or entry.get("sig") != sig:
            entry = FILES[name] = {"sig": sig, **parse_file(path)}
            changed = True
        entries.append(entry)
    for name in set(FILES) - seen:
        del FILES[name]
        changed = True
    if changed:
        try:
            storage.save_json(CACHE_FILE, {"v": VERSION, "files": FILES})
        except OSError:
            pass
    return entries  # in ordine di modifica dei file (dal più vecchio)


def _history():
    with LOCK:
        entries = _refresh()
    promotions, factions, rank, progress = [], {}, {}, {}
    for en in entries:
        promotions.extend(en.get("promotions", []))
        for name, fa in en.get("factions", {}).items():
            cur = factions.get(name)
            if cur is None:
                factions[name] = cur = {"name": name, "systems": []}
            if not cur.get("ts") or (fa.get("ts") or "") >= cur["ts"]:
                cur.update({k: v for k, v in fa.items() if k != "systems"})
            for s in fa.get("systems", []):
                if s not in cur["systems"]:
                    cur["systems"].append(s)
        if en.get("rank") and (en["rank"].get("ts") or "") >= (rank.get("ts") or ""):
            rank = en["rank"]
        if en.get("progress") and (en["progress"].get("ts") or "") >= (progress.get("ts") or ""):
            progress = en["progress"]
    promotions.sort(key=lambda p: p.get("ts") or "", reverse=True)
    return promotions, factions, rank, progress


# ============================================================================
# API
# ============================================================================
def _next_unlock(key, r):
    """Primo rank sopra quello attuale che sblocca qualcosa (secondo le fonti)."""
    table = UNLOCKS.get(key, {})
    for i in sorted(table):
        if r is None or i > r:
            return {"rank": i, "name": rank_names(key)[i], "items": _loc(table[i])}
    return None


def summary(q=None):
    promotions, factions, last_rank, last_progress = _history()
    snap = journal.STATE.snapshot()
    live_r, live_p = snap.get("ranks") or {}, snap.get("progress") or {}
    ranks = []
    for k in ORDER:
        r = live_r.get(k) if live_r.get(k) is not None else last_rank.get(k)
        p = live_p.get(k) if live_r.get(k) is not None else last_progress.get(k)
        names = rank_names(k)
        top = len(names) - 1
        unlocked = [{"rank": i, "name": names[i], "items": _loc(v)} for i, v in sorted(UNLOCKS.get(k, {}).items())]
        ranks.append({
            "key": k, "label": LABELS[k], "navy": k in ("Federation", "Empire"),
            "rank": r, "name": names[r] if isinstance(r, int) and 0 <= r < len(names) else None,
            "next": names[r + 1] if isinstance(r, int) and r < top else None,
            "progress": p, "max": isinstance(r, int) and r >= top,
            "next_unlock": _next_unlock(k, r), "unlocks": unlocked, "howto": pick_d(HOWTO.get(k)),
        })
    rep = snap.get("reputation") or {}
    powers = [{"key": k, "value": rep.get(k), "level": rep_level(rep.get(k))}
              for k in ("Federation", "Empire", "Alliance", "Independent") if isinstance(rep.get(k), (int, float))]
    fl = sorted(factions.values(), key=lambda f: (-(f.get("rep") or 0), f["name"].lower()))
    for f in fl:
        f["level"] = rep_level(f.get("rep"))
    for p in promotions:
        names = rank_names(p["key"])
        p["label"] = LABELS.get(p["key"], p["key"])
        p["name"] = names[p["rank"]] if 0 <= p["rank"] < len(names) else str(p["rank"])
    return {"ranks": ranks, "powers": powers, "factions": fl, "promotions": promotions, "navy_tips": _loc(NAVY_TIPS),
            "rep_levels": [{"max": round(t), "name": n} for t, n in REP_LEVELS], "live": bool(live_r)}


def start():
    """Prima lettura in background: la scheda poi risponde subito."""
    try:
        _history()
    except Exception as exc:  # noqa: BLE001 - solo un riscaldamento della cache
        print(f"Ranks: errore nella lettura dei journal: {exc!r}")


# API registrate dal server (stesse firme di server.GET / server.POST).
GET = {"/api/ranks": lambda q: summary(q)}
POST = {}
# Percorsi che il companion sul telefono può usare.
LAN = set()
