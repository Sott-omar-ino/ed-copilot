"""Inara (inara.cz): profilo del comandante e obiettivi della comunità tramite l'API ufficiale (INAPI).

Serve la chiave API personale del comandante (Inara → Impostazioni → API key). L'API di Inara non offre ricerche
su mercati, stazioni o sistemi e i termini di Inara vietano di copiarne i contenuti in automatico: per quelle
ricerche l'app usa Spansh e accanto ai risultati mette il collegamento alla pagina di Inara.
"""

import json
import threading
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone

from . import VERSION
from .lang import pick

ENDPOINT = "https://inara.cz/inapi/v1/"
APP_NAME = "Voidwatch ED"   # come in app/upload/inara.py: deve essere approvato da Inara
PROFILE_TTL, CG_TTL, ERROR_RETRY = 3600, 600, 120

_cache = {}
_lock = threading.Lock()


def _cfg():
    from .server import app_config
    return (app_config().get("inara_api_key") or "").strip()


def configured():
    return bool(_cfg())


def not_approved():
    return pick("Inara non ha ancora abilitato Voidwatch ED: ogni applicazione deve essere approvata dal gestore di Inara "
                "prima di poter usare la sua API. Nel frattempo gli obiettivi della comunità arrivano direttamente da Frontier.",
                "Inara hasn't enabled Voidwatch ED yet: every application must be approved by Inara's admin "
                "before it can use their API. Meanwhile community goals come straight from Frontier.")


def _status_error(text):
    # Inara richiede che il nome dell'app sia nella sua lista (inara.cz/elite/inara-api-devguide: "needs to be white-listed first").
    if "no access allowed" in (text or "").lower():
        return ValueError(not_approved())
    return ValueError(f"Inara: {text or pick('richiesta rifiutata', 'request rejected')}")


def _call(event, data=None):
    key = _cfg()
    if not key:
        raise ValueError(pick("Chiave API di Inara non impostata", "Inara API key not set"))
    from .journal import STATE
    cmdr = STATE.snapshot().get("cmdr") or {}
    header = {"appName": APP_NAME, "appVersion": VERSION, "isBeingDeveloped": False, "APIkey": key}
    if cmdr.get("name"):
        header["commanderName"] = cmdr["name"]
    if cmdr.get("fid"):
        header["commanderFrontierID"] = cmdr["fid"]
    body = {"header": header, "events": [{
        "eventName": event, "eventTimestamp": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "eventData": data if data is not None else []}]}
    req = urllib.request.Request(ENDPOINT, data=json.dumps(body).encode("utf-8"), method="POST",
                                 headers={"Content-Type": "application/json", "User-Agent": f"Voidwatch-ED/{VERSION}"})
    with urllib.request.urlopen(req, timeout=15) as r:
        res = json.loads(r.read().decode("utf-8"))
    head = res.get("header") or {}
    if head.get("eventStatus") not in (200, 202):
        raise _status_error(head.get("eventStatusText"))
    ev = (res.get("events") or [{}])[0]
    if ev.get("eventStatus") == 204:
        return None
    if ev.get("eventStatus") not in (200, 202):
        raise _status_error(ev.get("eventStatusText"))
    return ev.get("eventData")


def _cached(name, ttl, fn):
    now = time.time()
    with _lock:
        hit = _cache.get(name)
        if hit and now - hit["ts"] < (ttl if "data" in hit else ERROR_RETRY):
            if "data" in hit:
                return hit["data"]
            raise ValueError(hit["error"])
    try:
        data = fn()
    except Exception as exc:
        with _lock:
            _cache[name] = {"ts": now, "error": str(exc)}
        raise
    with _lock:
        _cache[name] = {"ts": now, "data": data}
    return data


def reset():
    with _lock:
        _cache.clear()


def profile():
    """Profilo del comandante su Inara (ranghi, squadriglia, link)."""
    if not configured():
        return {"configured": False}

    def fetch():
        p = _call("getCommanderProfile") or {}
        sq = p.get("commanderSquadron") or {}
        return {"configured": True, "name": p.get("commanderName") or p.get("userName"),
                "url": p.get("inaraURL"), "avatar": p.get("avatarImageURL"),
                "allegiance": p.get("preferredAllegianceName"), "power": p.get("preferredPowerName"),
                "role": p.get("preferredGameRole"),
                "ranks": [{"name": r.get("rankName"), "value": r.get("rankValue"), "progress": r.get("rankProgress")}
                          for r in p.get("commanderRanksPilot") or []],
                "squadron": sq and {"name": sq.get("SquadronName"), "members": sq.get("SquadronMembersCount"),
                                    "rank": sq.get("SquadronMemberRank"), "url": sq.get("inaraURL")},
                "wing": (p.get("commanderWing") or {}).get("wingName")}

    try:
        return _cached("profile", PROFILE_TTL, fetch)
    except Exception as exc:
        return {"configured": True, "error": str(exc)}


def community_goals():
    """Obiettivi della comunità da Inara, nello stesso formato del feed di Frontier usato dall'interfaccia."""
    def fetch():
        out = []
        for g in _call("getCommunityGoalsRecent") or []:
            if g.get("isCompleted"):
                continue
            tier, top = g.get("tierReached") or 0, g.get("tierMax") or 0
            out.append({"id": str(g.get("communitygoalGameID")), "title": g.get("communitygoalName"),
                        "system": g.get("starsystemName"), "station": g.get("stationName"),
                        "objective": g.get("goalObjectiveText"), "reward": g.get("goalRewardText"),
                        "description": g.get("goalDescriptionText"), "expiry": g.get("goalExpiry"),
                        "qty": g.get("contributionsTotal") or 0, "target_qty": None,
                        "tier": tier, "tier_max": top, "contributors": g.get("contributorsNum"),
                        "pct": round(tier / top * 100) if top else 0, "url": g.get("inaraURL"), "source": "Inara"})
        return out

    return _cached("cg", CG_TTL, fetch)


# --- Pagine di Inara (si aprono nel browser) -------------------------------------------

def page_url(kind, name, system=None):
    """Indirizzi di ricerca di Inara (gli stessi usati da EDMC)."""
    q = urllib.parse.quote
    if kind == "station" and system:
        return f"https://inara.cz/elite/station/?search={q(f'{system} [{name}]')}"
    if kind == "station":
        return f"https://inara.cz/elite/station/?search={q(name or '')}"
    if kind == "system":
        return f"https://inara.cz/elite/starsystem/?search={q(name or '')}"
    return {"commodity": "https://inara.cz/elite/commodities/", "engineer": "https://inara.cz/elite/engineers/",
            "powerplay": "https://inara.cz/elite/powerplay/"}.get(kind, "https://inara.cz/elite/")
