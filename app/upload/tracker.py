"""Lo stato di gioco che serve agli invii, ricostruito dagli eventi del journal.

È separato da state.State perché segue regole precise di EDDN ed EDSM (posizione solo da Location/FSDJump/
CarrierJump, azzeramenti a ogni LoadGame, sessioni in equipaggio) e contiene cose che all'interfaccia non servono
(versione del gioco, flag Horizons/Odyssey).
"""

from ..lang import pick

LOCATION_EVENTS = ("Location", "FSDJump", "CarrierJump")
NOT_REAL_SYSTEMS = ("ProvingGround", "CQC")  # arena CQC: niente posizione


def version_tuple(v):
    out = []
    for part in str(v or "").split("."):
        if not part.isdigit():
            break
        out.append(int(part))
    return tuple(out)


class Tracker:
    def __init__(self):
        self.cmdr = self.fid = None
        self.gameversion = self.gamebuild = None
        self.horizons = self.odyssey = None   # None = non noto: per EDDN la chiave non va proprio inviata
        self.captain = None                   # comandante della nave su cui siamo ospiti (equipaggio)
        self.credits = self.loan = None
        self.ship_id = self.ship_type = None
        self.taxi = self.dropship = False
        self.ranks = {}
        self.materials = {}                   # nome minuscolo -> quantità (per Inara)
        self._reset_location()

    def _reset_location(self):
        # Posizione per EDDN: solo da Location, FSDJump e CarrierJump (controllo incrociato col SystemAddress).
        self.system = self.address = self.starpos = None
        self.journal_body = None              # (nome, BodyID) da ApproachBody/Location, per CodexEntry
        # Posizione per EDSM e Inara (anche da Docked), come nel codice di esempio di EDSM.
        self.edsm = {"address": None, "system": None, "coords": None, "market_id": None, "station": None}
        self.station = self.market_id = None
        self.docked = False

    # --- verifiche -----------------------------------------------------------
    def game_ok(self):
        """Motivo per cui non si deve inviare nulla (beta, Legacy, versione sconosciuta), oppure None."""
        gv = self.gameversion or ""
        if not gv:
            return pick("versione del gioco non ancora nota", "game version not known yet")
        low = gv.lower()
        if "beta" in low or "alpha" in low:
            return pick(f"versione beta del gioco ({gv})", f"beta version of the game ({gv})")
        if gv.upper().startswith(("CQC", "CAPI")) or not version_tuple(gv) or version_tuple(gv) < (4,):
            return pick(f"versione Legacy o non live del gioco ({gv})", f"Legacy or non-live version of the game ({gv})")
        return None

    def in_crew(self):
        return bool(self.captain and self.captain != self.cmdr)

    def location_matches(self, e, name_key="StarSystem"):
        """Controllo incrociato richiesto da EDDN: l'evento deve essere nel sistema dell'ultimo salto."""
        if self.address is None or self.starpos is None or e.get("SystemAddress") != self.address:
            return False
        name = e.get(name_key)
        return name is None or name == self.system

    # --- aggiornamento -------------------------------------------------------
    def update(self, e):
        ev = e.get("event")
        fn = getattr(self, "on_" + ev, None) if ev else None
        if fn:
            fn(e)

    def on_Fileheader(self, e):
        self.gameversion, self.gamebuild = e.get("gameversion"), e.get("build")

    def on_LoadGame(self, e):
        self.cmdr, self.fid = e.get("Commander"), e.get("FID")
        self.horizons = e["Horizons"] if isinstance(e.get("Horizons"), bool) else None
        self.odyssey = e["Odyssey"] if isinstance(e.get("Odyssey"), bool) else None
        if e.get("gameversion"):  # Fileheader è la fonte principale, LoadGame va bene lo stesso
            self.gameversion, self.gamebuild = e.get("gameversion"), e.get("build", self.gamebuild)
        self.credits, self.loan = e.get("Credits"), e.get("Loan")
        self.ship_id, self.ship_type = e.get("ShipID"), e.get("Ship")
        self.captain = None
        self.taxi = self.dropship = False
        self._reset_location()

    def on_Commander(self, e):
        self.cmdr, self.fid = e.get("Name") or self.cmdr, e.get("FID") or self.fid

    def on_JoinACrew(self, e):
        self.captain = e.get("Captain")
        self._reset_location()

    def on_QuitACrew(self, e):
        self.captain = None
        self._reset_location()

    def _enter(self, e):
        name, addr, pos = e.get("StarSystem"), e.get("SystemAddress"), e.get("StarPos")
        if name in NOT_REAL_SYSTEMS:
            self._reset_location()
            return
        self.system, self.address = name, addr
        self.starpos = list(pos) if isinstance(pos, list) and len(pos) == 3 else None
        self.taxi = bool(e.get("Taxi"))
        self._edsm_location(e)

    def _edsm_location(self, e):
        s = self.edsm
        if e.get("StarSystem") in NOT_REAL_SYSTEMS:
            s.update(address=None, system=None, coords=None, market_id=None, station=None)
            return
        if e.get("StarSystem") != s["system"]:
            s["coords"] = None
        if e.get("SystemAddress") is not None:
            s["address"] = e["SystemAddress"]
        s["system"] = e.get("StarSystem")
        if e.get("StarPos") is not None:
            s["coords"] = e["StarPos"]
        if e.get("MarketID") is not None:
            s["market_id"] = e["MarketID"]
        if e.get("StationName") is not None:
            s["station"] = e["StationName"]

    def on_Location(self, e):
        self._enter(e)
        self.journal_body = (e["Body"], e["BodyID"]) if e.get("Body") and isinstance(e.get("BodyID"), int) else None
        self.docked = bool(e.get("Docked"))
        self.station = e.get("StationName") if self.docked else None
        self.market_id = e.get("MarketID") if self.docked else None

    def on_FSDJump(self, e):
        self._enter(e)
        self.journal_body = None
        self.docked, self.station, self.market_id = False, None, None

    def on_CarrierJump(self, e):
        self._enter(e)
        self.journal_body = None
        self.docked = bool(e.get("Docked", True))
        self.station, self.market_id = e.get("StationName"), e.get("MarketID")

    def on_Docked(self, e):
        self._edsm_location(e)
        self.docked, self.station, self.market_id = True, e.get("StationName"), e.get("MarketID")
        self.taxi = bool(e.get("Taxi"))

    def on_Undocked(self, e):
        self.docked, self.station, self.market_id = False, None, None
        self.edsm.update(market_id=None, station=None)

    def on_ApproachBody(self, e):
        if isinstance(e.get("BodyID"), int):
            self.journal_body = (e.get("Body"), e["BodyID"])

    def on_LeaveBody(self, e):
        self.journal_body = None

    def on_BookDropship(self, e):
        self.dropship = True

    def on_DropshipDeploy(self, e):
        self.dropship = False

    on_CancelDropship = on_DropshipDeploy

    # --- nave ---------------------------------------------------------------
    def on_Loadout(self, e):
        self.ship_id, self.ship_type = e.get("ShipID"), e.get("Ship")

    def on_ShipyardSwap(self, e):
        self.ship_id, self.ship_type = e.get("ShipID"), e.get("ShipType")

    def on_ShipyardBuy(self, e):
        self.ship_id = None

    def on_SetUserShipName(self, e):
        self.ship_id = e.get("ShipID", self.ship_id)

    # --- comandante ---------------------------------------------------------
    def on_Rank(self, e):
        for k, v in e.items():
            if k not in ("timestamp", "event") and isinstance(v, int):
                self.ranks[k] = v

    def on_Promotion(self, e):
        self.on_Rank(e)

    # --- materiali (Inara vuole sempre l'inventario completo) ----------------
    def _mat(self, name, delta):
        if name:
            k = name.lower()
            self.materials[k] = max(0, self.materials.get(k, 0) + (delta or 0))

    def on_Materials(self, e):
        self.materials = {}
        for cat in ("Raw", "Manufactured", "Encoded"):
            for m in e.get(cat) or []:
                self._mat(m.get("Name"), m.get("Count", 0))

    def on_MaterialCollected(self, e):
        self._mat(e.get("Name"), e.get("Count", 1))

    def on_MaterialDiscarded(self, e):
        self._mat(e.get("Name"), -e.get("Count", 1))

    def on_MaterialTrade(self, e):
        p, r = e.get("Paid") or {}, e.get("Received") or {}
        self._mat(p.get("Material"), -p.get("Quantity", 0))
        self._mat(r.get("Material"), r.get("Quantity", 0))

    def on_EngineerCraft(self, e):
        ing = e.get("Ingredients") or []
        for m in ing if isinstance(ing, list) else []:
            self._mat(m.get("Name"), -m.get("Count", 0))

    def on_Synthesis(self, e):
        for m in e.get("Materials") or []:
            self._mat(m.get("Name"), -m.get("Count", 0))

    def on_TechnologyBroker(self, e):
        for m in e.get("Materials") or []:
            self._mat(m.get("Name"), -m.get("Count", 0))

    def on_EngineerContribution(self, e):
        if e.get("Type") == "Materials":
            self._mat(e.get("Material"), -e.get("Quantity", 0))

    def on_ScientificResearch(self, e):
        self._mat(e.get("Name"), -e.get("Count", 0))

    def on_MissionCompleted(self, e):
        for m in e.get("MaterialsReward") or []:
            self._mat(m.get("Name"), m.get("Count", 0))
