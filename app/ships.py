"""Lettura delle build delle navi dagli eventi Loadout del journal."""

import base64
import gzip
import json
import re

from .gamedata import ARMOUR, BLUEPRINTS, CORE_SLOTS, COSMETIC_SLOTS, MODULE_NAMES, WEAPON_SIZES

RATINGS = "EDCBA"
# Nomi degli slot e dei supporti come nel gioco in inglese (i termini di gioco non si traducono).
CORE_LABELS = {"Armour": "Armour", "PowerPlant": "Power Plant", "MainEngines": "Thrusters",
               "FrameShiftDrive": "Frame Shift Drive", "LifeSupport": "Life Support", "PowerDistributor": "Power Distributor",
               "Radar": "Sensors", "FuelTank": "Fuel Tank"}
MOUNTS = {"fixed": "Fixed", "gimbal": "Gimbal", "turret": "Turret"}


def module_info(item):
    """'int_hyperdrive_overcharge_size4_class5' -> {'name': 'Frame Shift Drive (SCO)', 'size': '4', 'rating': 'A'}"""
    raw = (item or "").lower()
    if "_armour_" in raw:
        grade = raw.split("_armour_")[1]
        return {"name": ARMOUR.get(grade, grade.title()), "size": "", "rating": ""}
    key = re.sub(r"^(int|hpt)_", "", raw)
    name = next((n for prefix, n in MODULE_NAMES if key.startswith(prefix)), None)
    if name is None:
        name = key.replace("_", " ").title()
    if "_mkii" in key or "_mk2" in key:
        name = "Mk II " + name if not name.startswith("Mk II") else name
    if "_strong" in key and name == "Shield Generator":
        name = "Prismatic Shield Generator"
    elif "_fast" in key and name == "Shield Generator":
        name = "Bi-Weave Shield Generator"
    size = re.search(r"_size(\d)", key)
    cls = re.search(r"_class(\d)", key)
    info = {"name": name, "size": size.group(1) if size else "", "rating": ""}
    if cls:
        c = int(cls.group(1))
        info["rating"] = RATINGS[c - 1] if 1 <= c <= 5 else ""
    for mount, label in MOUNTS.items():
        if f"_{mount}_" in key + "_":
            info["mount"] = label
    if raw.startswith("hpt_"):
        for wsize, label in WEAPON_SIZES.items():
            if key.endswith("_" + wsize):
                info["size"] = label
    if info["size"] == "0":
        info["size"] = ""
    return info


def slot_group(slot):
    if slot in CORE_SLOTS:
        return "core"
    if "Hardpoint" in slot and not slot.startswith("Tiny"):
        return "hardpoints"
    if slot.startswith("Tiny"):
        return "utility"
    return "optional"


def blueprint_name(bp):
    if not bp:
        return None
    if bp in BLUEPRINTS:
        return BLUEPRINTS[bp]
    tail = bp.split("_", 1)[-1]
    return re.sub(r"(?<!^)(?=[A-Z])", " ", tail)


def export_blob(loadout):
    data = gzip.compress(json.dumps(loadout, separators=(",", ":")).encode("utf-8"))
    # Padding scritto %3D come fa EDMarketConnector: il parser di Coriolis tronca il valore al primo "=".
    return base64.urlsafe_b64encode(data).decode("ascii").replace("=", "%3D")


def parse_loadout(e, ship_name):
    groups = {"core": [], "hardpoints": [], "utility": [], "optional": []}
    engineered = 0
    raw = []
    for m in e.get("Modules", []):
        slot = m.get("Slot", "")
        if not slot.startswith(COSMETIC_SLOTS):
            eng = m.get("Engineering") or {}
            raw.append({"slot": slot, "item": (m.get("Item") or "").lower(),
                        "mods": {x["Label"]: x["Value"] for x in eng.get("Modifiers", []) if "Value" in x},
                        # Per la lista della spesa del cantiere: gradi già applicati.
                        "eng": {"bp": eng.get("BlueprintName"), "lvl": eng.get("Level"),
                                "exp": eng.get("ExperimentalEffect")} if eng.get("BlueprintName") else None})
        if slot.startswith(COSMETIC_SLOTS) or slot == "PlanetaryApproachSuite":
            continue
        info = module_info(m.get("Item"))
        eng = m.get("Engineering") or {}
        if eng:
            engineered += 1
        groups[slot_group(slot)].append({
            "slot": slot, "slot_label": CORE_LABELS.get(slot) or slot_label(slot), **info,
            "on": m.get("On", True), "health": m.get("Health"),
            "blueprint": blueprint_name(eng.get("BlueprintName")), "grade": eng.get("Level"),
            "engineer": eng.get("Engineer"), "effect": eng.get("ExperimentalEffect_Localised"),
        })
    groups["core"].sort(key=lambda m: CORE_SLOTS.index(m["slot"]))
    blob = export_blob({k: v for k, v in e.items() if k != "timestamp"})
    return {
        "id": e.get("ShipID"), "symbol": (e.get("Ship") or "").lower(), "type": ship_name(e.get("Ship")),
        "name": e.get("ShipName"), "ident": e.get("ShipIdent"),
        "hull_value": e.get("HullValue"), "modules_value": e.get("ModulesValue"), "rebuy": e.get("Rebuy"),
        "jump_range": e.get("MaxJumpRange"), "cargo": e.get("CargoCapacity"),
        "fuel": (e.get("FuelCapacity") or {}).get("Main"), "mass": e.get("UnladenMass"),
        "hot": e.get("Hot", False), "groups": groups, "raw": raw, "engineered": engineered, "updated": e.get("timestamp"),
        "edsy": "https://edsy.org/#/I=" + blob, "coriolis": "https://coriolis.io/import?data=" + blob,
    }


def slot_label(slot):
    m = re.match(r"(Tiny|Small|Medium|Large|Huge)(Mining)?Hardpoint(\d)", slot)
    if m:
        return ("Utility" if m.group(1) == "Tiny" else m.group(1)) + (" Mining" if m.group(2) else "") + f" {m.group(3)}"
    m = re.match(r"Slot(\d+)_Size(\d)", slot)
    if m:
        return f"Slot {int(m.group(1))} · class {m.group(2)}"
    m = re.match(r"Military(\d+)", slot)
    if m:
        return f"Military {int(m.group(1))}"
    # Altri slot con numero (es. LimpetController01 della Type-11): nome del gioco separato in parole, "Limpet Controller 1".
    m = re.fullmatch(r"([A-Z][A-Za-z]+?)(\d+)", slot)
    if m:
        return re.sub(r"(?<=[a-z])(?=[A-Z])", " ", m.group(1)) + f" {int(m.group(2))}"
    return slot
