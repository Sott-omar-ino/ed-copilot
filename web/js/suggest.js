"use strict";

// Elenchi per i suggerimenti. Il valore resta inglese (è quello che Spansh capisce), l'etichetta è tradotta.
let SUGGEST = {};
function fillDatalists() {
  const items = (list, dict) => list.map(v => ({ value: v, label: dict ? T(dict, v) : v }));
  SUGGEST = {
    ships: items(STATIC.ships),
    mining: items(STATIC.mining_commodities, "commodity"),
    commodities: items([...new Set([...STATIC.mining_commodities, ...COMMODITIES])], "commodity"),
    modules: items(MODULES, "module"),
  };
}

const Suggest = (() => {
  const box = $("suggest");
  let input = null, list = [], active = -1;
  function updatePos() {
    if (!input) return;
    const r = input.getBoundingClientRect();
    Object.assign(box.style, { left: r.left + "px", top: (r.bottom + 2) + "px", width: Math.max(r.width, 240) + "px" });
  }
  function show(el) {
    input = el;
    const q = el.value.trim().toLowerCase();
    list = (SUGGEST[el.dataset.suggest] || []).filter(o => !q || o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q)).slice(0, 35);
    active = -1;
    if (!list.length) return hide();
    box.innerHTML = list.map((o, i) => `<div data-i="${i}">${esc(o.label)}${o.label !== o.value ? `<small>${esc(o.value)}</small>` : ""}</div>`).join("");
    updatePos();
    box.classList.add("open");
  }
  function hide() { box.classList.remove("open"); input = null; }
  function pick(i) {
    if (!input || !list[i]) return;
    input.value = list[i].value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    hide();
  }
  function move(d) {
    active = (active + d + list.length) % list.length;
    [...box.children].forEach((c, i) => c.classList.toggle("on", i === active));
    box.children[active]?.scrollIntoView({ block: "nearest" });
  }
  document.addEventListener("focusin", e => { if (e.target.dataset?.suggest) show(e.target); });
  document.addEventListener("input", e => { if (e.target.dataset?.suggest && e.target === input) show(e.target); else if (e.target.dataset?.suggest) show(e.target); });
  document.addEventListener("focusout", e => {
    if (e.target === input) {
      setTimeout(() => {
        if (!box.matches(":hover")) hide();
      }, 150);
    }
  });
  document.addEventListener("mousedown", e => {
    if (input && e.target !== input && !box.contains(e.target)) hide();
  });
  document.addEventListener("keydown", e => {
  if (e.key === "Enter" && e.target && e.target.id === "coriolis-custom-sys-input") {
    e.preventDefault();
    document.getElementById("coriolis-verify-custom-btn")?.click();
    return;
  }

    if (!input || !box.classList.contains("open")) return;
    if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
    else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
    else if (e.key === "Enter" && active >= 0) { e.preventDefault(); pick(active); }
    else if (e.key === "Escape") hide();
  });
  box.addEventListener("mousedown", e => {
    const item = e.target.closest("[data-i]");
    if (item) { e.preventDefault(); pick(+item.dataset.i); }
  });
  addEventListener("scroll", (e) => {
    if (e.target === box || box.contains(e.target)) return;
    if (input) {
      const r = input.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) hide();
      else updatePos();
    }
  }, true);
  return { hide };
})();


const COMMODITIES = ["Agronomic Treatment", "Advanced Medicines", "Aluminium", "Bertrandite", "Beryllium", "Bioreducing Lichen",
  "Building Fabricators", "CMM Composite", "Ceramic Composites", "Cobalt", "Coltan", "Consumer Technology", "Copper",
  "Food Cartridges", "Fruit and Vegetables", "Gallite", "Gallium", "Imperial Slaves", "Indite", "Indium", "Insulating Membrane",
  "Liquid oxygen", "Lithium Hydroxide", "Meta-Alloys", "Polymers", "Power Generators", "Semiconductors", "Steel",
  "Superconductors", "Titanium", "Uraninite", "Water", "Water Purifiers"];
const MODULES = ["Abrasion Blaster", "Advanced Docking Computer", "Auto Field-Maintenance Unit", "Beam Laser", "Bi-Weave Shield Generator",
  "Burst Laser", "Cannon", "Cargo Rack", "Chaff Launcher", "Collector Limpet Controller", "Detailed Surface Scanner",
  "Economy Class Passenger Cabin", "Electronic Countermeasure", "Fragment Cannon", "Frame Shift Drive", "Frame Shift Drive (SCO)",
  "Frame Shift Drive Interdictor", "Frame Shift Wake Scanner", "Fuel Scoop", "Fuel Tank", "Guardian FSD Booster",
  "Guardian Gauss Cannon", "Guardian Hybrid Power Distributor", "Guardian Hybrid Power Plant", "Guardian Shield Reinforcement",
  "Heat Sink Launcher", "Hull Reinforcement Package", "Kill Warrant Scanner", "Life Support", "Luxury Class Passenger Cabin",
  "Meta Alloy Hull Reinforcement", "Mine Launcher", "Mining Laser", "Mining Multi Limpet Controller", "Missile Rack",
  "Module Reinforcement Package", "Multi-Cannon", "Planetary Vehicle Hangar", "Plasma Accelerator", "Point Defence",
  "Power Distributor", "Power Plant", "Prismatic Shield Generator", "Prospector Limpet Controller", "Pulse Laser",
  "Pulse Wave Analyser", "Rail Gun", "Refinery", "Repair Limpet Controller", "Seeker Missile Rack", "Seismic Charge Launcher",
  "Sensors", "Shield Booster", "Shield Cell Bank", "Shield Generator", "Standard Docking Computer", "Sub-Surface Displacement Missile",
  "Supercruise Assist", "Thrusters", "Torpedo Pylon", "Vessel Hangar", "Xeno Scanner"];
