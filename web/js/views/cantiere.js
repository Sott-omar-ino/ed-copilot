"use strict";

// ============================================================================
// CANTIERE: configuratore navi
// Dati di navi, moduli e ingegneria: catalogo generato da EDCD/coriolis-data (MIT), vedi app/coriolis.py.
// Calcoli in web/js/shipcalc.js (formule citate lì). In questa scheda non ci sono numeri scritti a mano:
// ogni valore mostrato viene dal catalogo, dal journal del gioco o da un calcolo su di essi.
// ============================================================================
// Nomi degli slot come nel gioco (termini di gioco in inglese).
const STD_LABELS = ["Power Plant", "Thrusters", "Frame Shift Drive", "Life Support", "Power Distributor", "Sensors", "Fuel Tank"];
const MOUNT_EN = { F: "Fixed", G: "Gimbal", T: "Turret" };
const HP_LABEL = ["Utility", "Small", "Medium", "Large", "Huge"];

function savedBuilds() { try { return JSON.parse(localStorage.getItem("builds") || "[]"); } catch { return []; } }

// --- formattazione -----------------------------------------------------------
const fmtN = (n, d = 2) => n == null || isNaN(n) ? "—" : (+n).toLocaleString(NUM_LOCALE, { maximumFractionDigits: d });
const fmtT = n => fmtN(n, n >= 100 ? 0 : 2);
const fmtMW = n => n == null || isNaN(n) ? "—" : (+n).toLocaleString(NUM_LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtLy = n => n == null || isNaN(n) ? "—" : (+n).toLocaleString(NUM_LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + (LANG.lang === "en" ? " ly" : " al");
const costShort = c => c == null ? "—" : c === 0 ? "0" : short(c);

function modOption(m) {
  const cost = m.cost == null ? " · prezzo n.d." : m.cost ? " · " + short(m.cost) : "";
  return `${m.class}${m.rating || ""} ${moduleName(m)}${m.mount ? " · " + (MOUNT_EN[m.mount] || m.mount) : ""}${cost}`;
}

// ============================================================================
// PRESET: allestimenti di partenza. La descrizione dice esattamente cosa monta il preset.
// ============================================================================
const SHIP_PRESETS = [
  { id: "max_jump", label: "Salto massimo", desc: "FSD classe A con Increased Range G5 e Mass Manager, Life Support e Sensors D con Lightweight G5, Guardian FSD Booster, niente armi" },
  { id: "max_cargo", label: "Carico massimo", desc: "Cargo Rack in tutti gli slot interni liberi" },
  { id: "max_speed", label: "Velocità massima", desc: "Thrusters A con Dirty Drives G5 e Drag Drives, Power Distributor A con Charge Enhanced G5 e Super Conduits" },
  { id: "max_defense", label: "Difesa", desc: "Military Grade Composite, Bi-Weave Shield Generator, Shield Cell Bank, Hull e Module Reinforcement" },
  { id: "explore", label: "Esplorazione", desc: "FSD ingegnerizzato, Fuel Scoop A, Auto Field-Maintenance Unit, Planetary Vehicle Hangar, Detailed Surface Scanner, Shield Generator D" },
  { id: "combat", label: "Combattimento", desc: "Beam Laser e Multi-Cannon, Bi-Weave Shield Generator, Hull e Module Reinforcement, Reinforced Alloy" },
  { id: "trade", label: "Commercio", desc: "Cargo Rack negli slot liberi e Shield Generator D" },
  { id: "mining", label: "Estrazione mineraria", desc: "Mining Laser, Refinery, Collector e Prospector Limpet Controller, Detailed Surface Scanner" },
];

function findMod(cat, grp, cls, rating) {
  const m = cat.modules.find(x => x.grp === grp && x.class === cls && (!rating || x.rating === rating) && !x.pre);
  return m ? { id: m.uid } : null;
}
function findFsdMod(cat, cls) {
  return cat.modules.find(m => m.grp === "fsd" && m.class === cls && m.rating === "A" && !m.pre && m.symbol?.includes("overcharge"))
    || cat.modules.find(m => m.grp === "fsd" && m.class === cls && m.rating === "A" && !m.pre);
}
// Ingegneria pianificata: chiavi del catalogo (blueprint e sperimentale), effetti calcolati da ShipCalc.
const plan = (catalog, grp, bp, exp, grade = 5) => {
  const key = ShipCalc.blueprintKey(catalog, grp, bp);
  return key ? { blueprint: key, grade, exp: ShipCalc.specialKey(catalog, grp, exp) || "" } : null;
};
function withEng(catalog, entry, bp, exp) {
  if (!entry) return entry;
  const m = ShipCalc.index(catalog).byId[entry.id];
  const eng = m && plan(catalog, m.grp, bp, exp);
  return eng ? { id: entry.id, engineering: eng } : { id: entry.id };
}

function buildRoleMix(catalog, shipKey, roles) {
  const ship = catalog.ships[shipKey];
  if (!ship) return null;
  const cfg = ShipCalc.blank(catalog, shipKey);
  const rSet = new Set(roles || []);
  const idxOf = e => ShipCalc.index(catalog).byId[e.id];
  const isDefense = rSet.has("max_defense"), isCombat = rSet.has("combat") || isDefense;
  const isSpeed = rSet.has("max_speed"), isJump = rSet.has("max_jump"), isExplore = rSet.has("explore");
  const isCargo = rSet.has("max_cargo") || rSet.has("trade"), isMining = rSet.has("mining");
  const s = ship.slots.standard;

  // Corazza: per nome (le navi con 6 corazze hanno una corazza in più in testa).
  const bh = name => Math.max(0, ship.bulkheads.findIndex(b => b.name.includes(name)));
  cfg.bulkhead = isDefense ? bh("Military Grade") : isCombat ? bh("Reinforced") : 0;

  const fsd = findFsdMod(catalog, s[2]);
  if (fsd) cfg.standard[2] = isJump || isExplore ? withEng(catalog, { id: fsd.uid }, "FSD_LongRange", "special_fsd_heavy") : { id: fsd.uid };
  const light = isJump && !isSpeed && !isCombat;
  const pp = findMod(catalog, "pp", s[0], "A");
  if (pp) cfg.standard[0] = isCombat ? withEng(catalog, pp, "PowerPlant_Boosted", "special_powerplant_cooled") : pp;
  const thr = findMod(catalog, "t", s[1], light ? "D" : "A") || findMod(catalog, "t", s[1], "A");
  if (thr) cfg.standard[1] = isSpeed || isCombat ? withEng(catalog, thr, "Engine_Dirty", "special_engine_overloaded") : thr;
  const ls = findMod(catalog, "ls", s[3], "D");
  if (ls) cfg.standard[3] = isJump || isExplore ? withEng(catalog, ls, "LightWeight", "") : ls;
  const pd = findMod(catalog, "pd", s[4], isCombat || isSpeed || isMining ? "A" : "D");
  if (pd) cfg.standard[4] = isCombat || isSpeed ? withEng(catalog, pd, "PowerDistributor_HighFrequency", "special_powerdistributor_fast") : pd;
  const sn = findMod(catalog, "s", s[5], "D");
  if (sn) cfg.standard[5] = isJump || isExplore ? withEng(catalog, sn, "Sensor_LightWeight", "") : sn;

  // Slot interni: ogni modulo va nello slot libero più piccolo che lo contiene.
  const slots = ship.slots.internal.map((x, i) => ({ ...ShipCalc.slotInfo(x), i })).filter(x => !x.name || x.name === "Military");
  // Si parte dagli slot vuoti; lo Shield Generator di serie torna al suo posto se il preset non ne monta uno.
  const SHIELDS = ["sg", "bsg", "psg"];
  const stockShield = slots.map(x => ({ x, e: cfg.internal[x.i] })).find(o => o.e && SHIELDS.includes(idxOf(o.e)?.grp));
  for (const x of slots) cfg.internal[x.i] = null;
  const free = () => slots.filter(x => !cfg.internal[x.i]);
  const fits = (x, m) => m && x.cls >= m.class && (!x.name || x.name !== "Military" || ["hr", "mrp", "scb", "sg", "bsg", "psg", "ghrp", "gmrp", "mahr"].includes(m.grp));
  const put = (grp, rating, cls) => {
    const list = catalog.modules.filter(m => m.grp === grp && (!rating || m.rating === rating) && !m.pre && (cls == null || m.class === cls));
    // Classe più grande che entra nello slot libero più grande, poi slot più piccolo che la contiene.
    const big = Math.max(0, ...free().map(x => x.cls));
    const m = list.filter(m => m.class <= big).sort((a, b) => b.class - a.class)[0];
    if (!m) return false;
    const slot = free().filter(x => fits(x, m)).sort((a, b) => a.cls - b.cls)[0];
    if (!slot) return false;
    cfg.internal[slot.i] = { id: m.uid };
    return true;
  };
  // Shield Generator: il più piccolo che regge la massa dello scafo (maxmass >= hullMass, altrimenti non si monta).
  const putShield = (grp, rating) => {
    const big = Math.max(0, ...free().map(x => x.cls));
    const m = catalog.modules.filter(x => x.grp === grp && x.rating === rating && !x.pre && x.class <= big && (x.maxmass || 0) >= ship.hullMass)
      .sort((a, b) => a.class - b.class)[0];
    const slot = m && free().filter(x => fits(x, m)).sort((a, b) => a.cls - b.cls)[0];
    if (slot) cfg.internal[slot.i] = { id: m.uid };
  };

  if (isJump || isExplore) put("gfsb", "H");
  if (isExplore) { put("fs", "A"); }
  if (isCombat) { putShield("bsg", "C"); put("scb", "A"); }
  else if (rSet.has("trade") || isMining || isExplore) putShield("sg", "D");
  if (isExplore) { put("am", "A"); put("pv", "H", 2); put("ss", "I", 1); }
  if (isMining) { put("rf", "A"); put("cc", "A"); put("pc", "A"); put("ss", "I", 1); }
  if (stockShield && !cfg.internal.some(e => e && SHIELDS.includes(idxOf(e)?.grp))) {
    const m = idxOf(stockShield.e);
    const slot = cfg.internal[stockShield.x.i] ? free().filter(x => fits(x, m)).sort((a, b) => a.cls - b.cls)[0] : stockShield.x;
    if (slot) cfg.internal[slot.i] = { id: m.uid };
  }
  for (const x of free()) {
    if (isCargo && !x.name) { const m = findMod(catalog, "cr", Math.min(x.cls, 8), "E"); if (m) cfg.internal[x.i] = m; }
    else if (isCombat) {
      const grp = x.i % 2 === 0 ? "hr" : "mrp";
      const m = findMod(catalog, grp, Math.min(x.cls, 5), "D");
      if (m) cfg.internal[x.i] = m;
    }
  }
  ship.slots.internal.forEach((x, i) => { if (ShipCalc.slotInfo(x).name === "PlanetaryApproachSuite") cfg.internal[i] = findMod(catalog, "pas", 1, "I"); });

  if (isCombat) {
    ship.slots.hardpoints.forEach((x, i) => {
      const info = ShipCalc.slotInfo(x);
      if (info.cls >= 3) cfg.hardpoints[i] = findMod(catalog, "bl", info.cls, "C") || findMod(catalog, "bl", info.cls, "A");
      else if (info.cls >= 1) cfg.hardpoints[i] = findMod(catalog, "mc", info.cls, "F") || findMod(catalog, "mc", info.cls, "E");
    });
  } else if (isMining) {
    let n = 0;
    ship.slots.hardpoints.forEach((x, i) => {
      const info = ShipCalc.slotInfo(x);
      if (info.cls >= 1 && n < 2) { cfg.hardpoints[i] = findMod(catalog, "ml", Math.min(info.cls, 2), "D"); n++; }
    });
  } else ship.slots.hardpoints.forEach((x, i) => { cfg.hardpoints[i] = null; });

  // Controlli: Power Plant sufficiente e Thrusters che reggono la massa (altrimenti si torna ai moduli A).
  let r = ShipCalc.compute(catalog, cfg);
  if (r.pgen < r.draw) {
    const better = catalog.modules.filter(m => m.grp === "pp" && m.class <= s[0] && !m.pre && m.pgen >= r.draw).sort((a, b) => a.mass - b.mass)[0];
    if (better) cfg.standard[0] = cfg.standard[0]?.engineering ? { id: better.uid, engineering: cfg.standard[0].engineering } : { id: better.uid };
  }
  r = ShipCalc.compute(catalog, cfg);
  if (r.std[1] && r.std[1].maxmass && r.unladen + r.fuelCap > r.std[1].maxmass) {
    const a = findMod(catalog, "t", s[1], "A");
    if (a) cfg.standard[1] = cfg.standard[1]?.engineering ? { ...a, engineering: cfg.standard[1].engineering } : a;
  }
  return cfg;
}

function buildRole(catalog, shipKey, role) {
  const roleToPresets = { explore: ["explore", "max_jump"], combat: ["combat", "max_defense"], trade: ["trade", "max_cargo"], mining: ["mining"] };
  return buildRoleMix(catalog, shipKey, roleToPresets[role] || [role]);
}

// ============================================================================
// CONDIVIDI / IMPORTA BUILD
// Formato journal: l'evento Loadout del gioco (Ship + Modules). I nomi degli slot vengono da ship-slots.json
// (EDCD/coriolis-data, MIT) tramite /api/buildshare/slots; la decodifica dei testi incollati la fa il backend
// (app/buildshare.py, dove sono citate le fonti dei formati).
// ============================================================================
let SHIP_SLOTS = null;
function loadShipSlots() {
  if (SHIP_SLOTS || loadShipSlots.busy) return;
  loadShipSlots.busy = true;
  api("/api/buildshare/slots").then(t => { SHIP_SLOTS = t || { ships: {} }; }).catch(() => { loadShipSlots.busy = false; });
}

function copyText(text, msg) {
  return navigator.clipboard.writeText(text).then(() => toast(msg)).catch(() => toast("Non riesco a copiare negli appunti"));
}

function sharePanel() {
  const m = UI.shareMsg;
  return `<div id="share-box" class="subpanel cfg-share">
      <h3>Condividi la build</h3>
      <div class="cfg-row">
        <button class="small primary" id="bs-copy-loadout" title="Evento Loadout del journal: lo leggono i configuratori e i siti della community">Copia la build (formato journal)</button>
        <button class="small" id="bs-copy-code" title="Codice compatto che ED Copilot reimporta identico, ingegnerie comprese">Copia codice ED Copilot</button>
      </div>
      <div class="sub" style="margin-top:6px">Il formato journal porta moduli, slot, blueprint, grado ed effetto sperimentale; per una build pianificata i valori dei modificatori non ci sono (grado al tiro migliore). Il codice ED Copilot conserva tutto, ma lo legge solo ED Copilot.</div>
      <h3 style="margin-top:12px">Importa una build</h3>
      <textarea id="bs-input" data-keep rows="3" maxlength="200000" spellcheck="false" placeholder="Incolla una build in formato journal (Loadout), un link di una build o un codice ED Copilot" style="width:100%;font-family:var(--mono, monospace);font-size:12px"></textarea>
      <div class="cfg-row" style="margin-top:6px">
        <button class="small primary" id="bs-import">Importa nel cantiere</button>
        ${m ? `<span class="${m.ok ? "ok" : "bad"}" style="font-size:12px">${esc(m.text)}</span>` : ""}
      </div>
    </div>`;
}

function shareShipKey(raw) {
  const k = String(raw || "").toLowerCase().replace(/[\s\-]/g, "_");
  if (CATALOG.ships[k]) return k;
  if (CATALOG.journal_ships[k]) return CATALOG.journal_ships[k];
  return Object.keys(CATALOG.ships).find(x => x.replace(/_/g, "") === k.replace(/_/g, "")) || null;
}

async function shareImport(text) {
  text = String(text || "").trim();
  if (!text) throw new Error("Incolla prima una build");
  if (text.length > 200000) throw new Error("Testo troppo lungo");
  if (text.startsWith("EDC1.")) {
    const { cfg, name } = ShipCalc.decodeCode(CATALOG, text);
    return { cfg, name: name || CATALOG.ships[cfg.ship].name, note: cfg.unknown.length ? LANG.t(`${cfg.unknown.length} moduli non validi ignorati`) : "" };
  }
  const res = await api("/api/buildshare/decode", { text });
  if (res.kind === "coriolis_outfit") {
    const key = shareShipKey(res.ship);
    if (!key) throw new Error("Nave non presente nel catalogo");
    return { cfg: ShipCalc.blank(CATALOG, key), name: CATALOG.ships[key].name, note: res.note };
  }
  const lo = res.loadout;
  const cfg = ShipCalc.fromLoadout(CATALOG, lo.Ship, res.modules, SHIP_SLOTS);
  if (!cfg) throw new Error("Nave non presente nel catalogo: " + lo.Ship);
  const notes = [res.note, cfg.unknown.length ? LANG.t(`non riconosciuti: ${cfg.unknown.join(", ")}`) : ""].filter(Boolean);
  return { cfg, name: lo.ShipName?.trim() || lo.ShipIdent?.trim() || CATALOG.ships[cfg.ship].name, note: notes.join(" · ") };
}

document.addEventListener("click", e => {
  const t = e.target.closest?.("#bs-copy-loadout, #bs-copy-code, #bs-import, #bs-toggle");
  if (!t || !CATALOG || !UI.cfg) return;
  if (t.id === "bs-toggle") {
    UI.showShare = !UI.showShare;
    UI.shareMsg = null;
    renderView();
  } else if (t.id === "bs-copy-loadout") {
    const { loadout, approx, skipped } = ShipCalc.toLoadout(CATALOG, UI.cfg, { slotTable: SHIP_SLOTS, name: UI.cfgName });
    const warn = [approx.length ? `nomi stimati per ${approx.length} slot` : "", skipped.length ? `${skipped.length} moduli senza simbolo esclusi` : ""].filter(Boolean).map(w => LANG.t(w));
    copyText(JSON.stringify(loadout, null, 2), LANG.t("Build copiata in formato journal") + (warn.length ? " (" + warn.join(", ") + ")" : ""));
  } else if (t.id === "bs-copy-code") {
    copyText(ShipCalc.encodeCode(UI.cfg, UI.cfgName), "Codice ED Copilot copiato");
  } else if (t.id === "bs-import") {
    const input = $("bs-input");
    shareImport(input?.value).then(r => {
      UI.cfg = r.cfg;
      UI.cfgName = r.name;
      UI.activeRoles = new Set();
      UI.shareMsg = { ok: true, text: LANG.t("Importata:") + " " + r.name + (r.note ? " · " + r.note : "") };
      if (input) input.value = "";
      UI.dirty.delete("bs-input");
      renderView();
    }).catch(err => {
      UI.shareMsg = { ok: false, text: err.message };
      renderView();
    });
  }
});

// ============================================================================
// INGEGNERIA: modifica di un modulo e consigli calcolati sulla build
// ============================================================================
// Modulo (o corazza) dello slot "kind:i".
function cfgSlotModule(cfg, kind, i) {
  if (kind === "bulkhead") return ShipCalc.resolveBulkhead(CATALOG, cfg);
  return ShipCalc.resolve(CATALOG, cfg[kind]?.[i]);
}
function cfgSlotEng(cfg, kind, i) {
  return kind === "bulkhead" ? ShipCalc.bulkheadEng(cfg) : cfg[kind]?.[i]?.engineering || null;
}
// Imposta (eng) o toglie (null) l'ingegneria pianificata. I valori reali importati dal gioco (fx) si tolgono:
// da qui in poi contano blueprint e grado scelti.
function cfgSetEng(cfg, kind, i, eng) {
  if (kind === "bulkhead") {
    if (eng) cfg.bulkheadEng = { ...eng, bi: cfg.bulkhead || 0 };
    else delete cfg.bulkheadEng;
    return true;
  }
  const e = cfg[kind]?.[i];
  if (!e) return false;
  delete e.fx; delete e.mods;
  if (eng) e.engineering = eng; else delete e.engineering;
  return true;
}
function cfgEngClear(kind, i) {
  cfgSetEng(UI.cfg, kind, +i, null);
  UI.activeEngSlot = null; UI.engDraft = null;
}
function cfgEngApply(kind, i) {
  const d = engDraft(kind, +i);
  if (!d || !d.blueprint) return null;
  const m = cfgSlotModule(UI.cfg, kind, +i);
  const eng = { blueprint: d.blueprint, grade: d.grade, exp: d.exp || "" };
  cfgSetEng(UI.cfg, kind, +i, eng);
  UI.activeEngSlot = null; UI.engDraft = null;
  return ShipCalc.engLabel(CATALOG, m?.grp || "bh", eng);
}
// Bozza dell'editor: parte dall'ingegneria attuale o dal primo blueprint disponibile.
function engDraft(kind, i) {
  const key = `${kind}:${i}`;
  if (UI.engDraft?.slot === key) return UI.engDraft;
  const m = cfgSlotModule(UI.cfg, kind, i), cur = cfgSlotEng(UI.cfg, kind, i);
  const opts = ShipCalc.blueprintsFor(CATALOG, m?.grp || "bh");
  const bp = (cur && ShipCalc.blueprintKey(CATALOG, m?.grp, cur.blueprint)) || opts.blueprints[0]?.key || "";
  UI.engDraft = { slot: key, blueprint: bp, grade: cur ? Math.max(1, Math.min(5, +cur.grade || 5)) : 5,
    exp: (cur && ShipCalc.specialKey(CATALOG, m?.grp, cur.exp)) || "" };
  return UI.engDraft;
}

function engEditor(kind, i, m) {
  const d = engDraft(kind, i), opts = ShipCalc.blueprintsFor(CATALOG, m.grp);
  const bp = opts.blueprints.find(b => b.key === d.blueprint) || opts.blueprints[0];
  const maxG = bp?.maxGrade || 5, grade = Math.min(d.grade, maxG);
  const fx = ShipCalc.engEffects(CATALOG, m.grp, { blueprint: d.blueprint, grade, exp: d.exp });
  const cur = cfgSlotEng(UI.cfg, kind, i);
  return `<div class="cfg-eng-editor">
      <label>Blueprint<select id="eng-bp-select" data-eng-draft="blueprint">${opts.blueprints.map(b => opt(b.key, b.name, d.blueprint)).join("")}</select></label>
      <label>Grado<select id="eng-grade-select" data-eng-draft="grade">${Array.from({ length: maxG }, (_, g) => opt(String(maxG - g), "G" + (maxG - g), String(grade))).join("")}</select></label>
      <label>Sperimentale<select id="eng-exp-input" data-eng-draft="exp"><option value="">— nessuno —</option>${opts.specials.map(s => opt(s.key, s.name, d.exp)).join("")}</select></label>
      <div class="cfg-eng-fx"><span class="eyebrow">Effetto a grado completato</span><span>${esc(ShipCalc.describeEffects(CATALOG, fx, 5) || "—")}</span></div>
      <div class="cfg-row">
        <button class="small primary" data-slot-eng-apply="${kind}:${i}">Applica</button>
        <button class="small ghost" data-slot-eng-cancel>Annulla</button>
        ${cur ? `<button class="small danger" data-slot-eng-clear="${kind}:${i}">Rimuovi</button>` : ""}
      </div>
    </div>`;
}

// Cella "Ingegneria": etichetta con i pip del grado e un'unica azione.
function engCell(kind, i, m) {
  if (!m) return "";
  const can = ShipCalc.blueprintsFor(CATALOG, m.grp).blueprints.length > 0;
  const eng = m.engineering;
  if (!eng && !m.fx) return can ? `<button class="small ghost cfg-eng-add" data-slot-eng-edit="${kind}:${i}" title="Pianifica un blueprint per questo modulo">+ ing.</button>` : "";
  const key = eng && ShipCalc.blueprintKey(CATALOG, m.grp, eng.blueprint);
  const name = key ? ShipCalc.bpName(CATALOG, key) : eng ? String(eng.blueprint).replace(/_/g, " ") : LANG.t("Modificato");
  const sk = eng && ShipCalc.specialKey(CATALOG, m.grp, eng.exp);
  const tip = [ShipCalc.engLabel(CATALOG, m.grp, eng) || name, ShipCalc.describeEffects(CATALOG, m.fx, 6),
    m.fx && (kind === "bulkhead" ? UI.cfg.bulkheadEng?.fx : UI.cfg[kind]?.[i]?.fx) ? LANG.t("Valori reali letti dal gioco") : LANG.t("Valori al tiro migliore del grado")].filter(Boolean).join("\n");
  return `<button class="cfg-eng" data-slot-eng-edit="${kind}:${i}" title="${esc(tip)}"><span class="cfg-eng-name">${esc(name)}</span>${eng ? pips(Math.max(0, Math.min(5, +eng.grade || 0))) : ""}${sk ? `<span class="cfg-eng-exp">${esc(CATALOG.specials[sk].name)}</span>` : ""}</button>`;
}

// Una riga della tabella moduli.
function slotRow(kind, i, label, size) {
  const cfg = UI.cfg, entry = cfg[kind][i];
  const options = ShipCalc.compatible(CATALOG, cfg, kind, i);
  const cur = entry && ShipCalc.index(CATALOG).byId[entry.id];
  if (cur && !options.includes(cur)) options.push(cur);  // modulo importato che il menu non propone
  options.sort((a, b) => moduleName(a).localeCompare(moduleName(b)) || b.class - a.class || (a.rating || "").localeCompare(b.rating || ""));
  const groups = {};
  for (const o of options) (groups[moduleName({ grp: o.grp })] ||= []).push(o);
  const m = ShipCalc.resolve(CATALOG, entry);
  const editing = UI.activeEngSlot === `${kind}:${i}` && m;
  const base = cur || {};
  const changed = k => m && m[k] != null && Math.abs((m[k] || 0) - (base[k] || 0)) > 1e-9 ? " holo-t" : "";
  const power = !m ? "" : m.grp === "pp"
    ? `<span class="ok${changed("pgen")}" title="Power capacity (energia prodotta)">+${fmtMW(m.pgen)}</span>`
    : `<span class="${changed("power").trim()}">${fmtMW(m.power || 0)}</span>`;
  return `<tr class="${editing ? "cfg-editing" : ""}">
      <td class="cfg-slot"><span>${esc(label)}</span>${size !== "" ? `<b>${size}</b>` : ""}</td>
      <td class="cfg-mod"><select data-slot-kind="${kind}" data-slot-i="${i}" title="${esc(m ? `${m.class}${m.rating || ""} ${moduleName(m)}${m.mount ? " · " + (MOUNT_EN[m.mount] || m.mount) : ""}` : "Slot vuoto")}">
        ${kind !== "standard" ? `<option value="">— vuoto —</option>` : ""}
        ${Object.entries(groups).map(([g, list]) => `<optgroup label="${esc(g)}">${list.map(o => `<option value="${esc(o.uid)}" ${entry?.id === o.uid ? "selected" : ""}>${esc(modOption(o))}</option>`).join("")}</optgroup>`).join("")}
      </select></td>
      <td class="cfg-engc">${engCell(kind, i, m)}</td>
      <td class="num${changed("mass")}">${m ? fmtT(m.mass || 0) : ""}</td>
      <td class="num">${power}</td>
      <td class="num gold" ${m?.cost == null && m ? 'title="Prezzo non presente nel catalogo"' : ""}>${m ? costShort(m.cost) : ""}</td>
    </tr>${editing ? `<tr class="cfg-editor-row"><td colspan="6">${engEditor(kind, i, m)}</td></tr>` : ""}`;
}

function armourRow(r) {
  const cfg = UI.cfg, ship = CATALOG.ships[cfg.ship], b = r.bulk;
  const editing = UI.activeEngSlot === "bulkhead:0";
  const baseB = ship.bulkheads[cfg.bulkhead] || ship.bulkheads[0];
  return `<tr class="${editing ? "cfg-editing" : ""}">
      <td class="cfg-slot"><span>Armour</span></td>
      <td class="cfg-mod"><select id="cfg-bulkhead" title="${esc(`${b?.name || ""} · Hull boost +${fmtN((b?.hullboost || 0) * 100, 1)}%`)}">${ship.bulkheads.map((x, i) => opt(i, `${x.name}${x.cost ? " · " + short(x.cost) : ""}`, cfg.bulkhead)).join("")}</select></td>
      <td class="cfg-engc">${b ? engCell("bulkhead", 0, b) : ""}</td>
      <td class="num${b && baseB && b.mass !== baseB.mass ? " holo-t" : ""}">${fmtT(b?.mass || 0)}</td>
      <td class="num"></td>
      <td class="num gold">${costShort(b?.cost || 0)}</td>
    </tr>${editing && b ? `<tr class="cfg-editor-row"><td colspan="6">${engEditor("bulkhead", 0, b)}</td></tr>` : ""}`;
}

function modTable(rows, powerHead = "MW") {
  return `<table class="cfg-table"><colgroup><col class="c-slot"><col><col class="c-eng"><col class="c-n"><col class="c-n"><col class="c-n"></colgroup>
    <thead><tr><th>Slot</th><th>Modulo</th><th>Ingegneria</th><th class="num">t</th><th class="num">${powerHead}</th><th class="num">CR</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

// Ingegneri che applicano il blueprint al grado, con sistema e distanza (dati di gioco: STATIC.engineers).
function engineersFor(grp, key, grade) {
  const pos = S?.location?.star_pos, st = STATIC?.engineers || [];
  return ShipCalc.blueprintEngineers(CATALOG, grp, key, grade).map(e => {
    const info = st.find(x => x.name === e.name);
    return { ...e, system: info?.system || "", unlocked: S?.engineers?.[e.name]?.progress === "Unlocked",
      d: info && pos ? dist3(pos, STATIC.coords?.[info.system]) : null };
  }).sort((a, b) => b.unlocked - a.unlocked || (a.d ?? 1e9) - (b.d ?? 1e9));
}

// Consigli di ingegneria: per ogni modulo presente, l'effetto CALCOLATO sulla build di un blueprint G5 comune.
// Nessun numero scritto a mano: "prima → dopo" esce da ShipCalc.compute con gli effetti del catalogo.
const ENG_RECS = [
  { kind: "standard", i: 2, bp: "FSD_LongRange", exp: "special_fsd_heavy", metric: "jump" },
  { kind: "standard", i: 1, bp: "Engine_Dirty", exp: "special_engine_overloaded", metric: "speed" },
  { kind: "standard", i: 0, bp: "PowerPlant_Boosted", exp: "special_powerplant_highcharge", metric: "pgen" },
  { kind: "standard", i: 4, bp: "PowerDistributor_HighFrequency", exp: "special_powerdistributor_fast", metric: null },
  { kind: "standard", i: 3, bp: "LightWeight", exp: "", metric: "jump" },
  { kind: "standard", i: 5, bp: "Sensor_LightWeight", exp: "", metric: "jump" },
  { kind: "shield", bp: "ShieldGenerator_Reinforced", exp: "special_shield_health", metric: "shield" },
  { kind: "bulkhead", i: 0, bp: "Armour_HeavyDuty", exp: "special_armour_chunky", metric: "armour" },
];
const METRIC = { jump: ["Salto max", r => r.jump.max, fmtLy], speed: ["Velocità", r => r.speed, v => num(v) + " m/s"],
  pgen: ["Energia", r => r.pgen, v => fmtMW(v) + " MW"], shield: ["Scudi", r => r.shield, v => num(v) + " MJ"],
  armour: ["Scafo", r => r.armour, v => num(v)] };

function getEngineeringAdvice(catalog, cfg) {
  if (!catalog.ships[cfg.ship] || !catalog.blueprints) return [];
  const base = ShipCalc.compute(catalog, cfg), out = [];
  for (const rec of ENG_RECS) {
    let kind = rec.kind, i = rec.i;
    if (kind === "shield") { kind = "internal"; i = base.internal.findIndex(m => m && ["sg", "bsg", "psg"].includes(m.grp)); if (i < 0) continue; }
    const m = cfgSlotModule(cfg, kind, i);
    if (!m) continue;
    const grp = kind === "bulkhead" ? "bh" : m.grp;
    const eng = plan(catalog, grp, rec.bp, rec.exp);
    if (!eng) continue;
    const cur = cfgSlotEng(cfg, kind, i);
    if (cur && ShipCalc.blueprintKey(catalog, grp, cur.blueprint) === eng.blueprint && +cur.grade >= 5) continue;
    const test = JSON.parse(JSON.stringify(cfg));
    cfgSetEng(test, kind, i, eng);
    const after = ShipCalc.compute(catalog, test);
    const met = rec.metric && METRIC[rec.metric];
    const engs = engineersFor(grp, eng.blueprint, 5);
    const label = ShipCalc.engLabel(catalog, grp, eng);
    out.push({
      kind, i, grp, eng, mod: kind === "bulkhead" ? "Armour" : moduleName(m), blueprint: label.split(" · ")[0],
      exp: eng.exp ? catalog.specials[eng.exp].name : "",
      effects: ShipCalc.describeEffects(catalog, ShipCalc.engEffects(catalog, grp, eng), 4),
      metric: met ? { label: met[0], before: met[2](met[1](base)), after: met[2](met[1](after)) } : null,
      engineers: engs, engineer: engs.slice(0, 2).map(e => e.name).join(" / "), sys: engs[0]?.system || "",
      benefit: met ? `${met[0]}: ${met[2](met[1](base))} → ${met[2](met[1](after))}` : "",
    });
  }
  return out;
}
function applyAllRecommended(cfg) {
  const list = getEngineeringAdvice(CATALOG, cfg);
  for (const a of list) cfgSetEng(cfg, a.kind, a.i, a.eng);
  return list.length;
}

// Cosa manca per completare la build: solo controlli calcolati sulla configurazione.
function getBuildAdvice(catalog, cfg) {
  const ship = catalog.ships[cfg.ship];
  if (!ship) return [];
  const items = [], r = ShipCalc.compute(catalog, cfg), name = UI.cfgName || ship.name;
  const best = findFsdMod(catalog, ship.slots.standard[2]);
  if (best && cfg.standard[2]?.id !== best.uid) {
    const test = JSON.parse(JSON.stringify(cfg));
    test.standard[2] = { id: best.uid };
    const after = ShipCalc.compute(catalog, test).jump.max;
    if (after > r.jump.max + 0.01) items.push({ text: `Monta ${best.class}${best.rating} ${moduleName(best)} su ${name}: salto max da ${fmtLy(r.jump.max)} a ${fmtLy(after)}`, cat: "Nave", sys: "" });
  }
  if (r.pgen && r.draw > r.pgen) {
    const pp = catalog.modules.filter(m => m.grp === "pp" && m.class <= ship.slots.standard[0] && !m.pre && m.pgen >= r.draw).sort((a, b) => a.mass - b.mass)[0];
    items.push({ text: `Energia insufficiente su ${name}: ${fmtMW(r.draw)} MW richiesti, ${fmtMW(r.pgen)} MW disponibili` + (pp ? ` (basta un Power Plant ${pp.class}${pp.rating}, ${fmtMW(pp.pgen)} MW)` : ""), cat: "Nave", sys: "" });
  }
  const thr = r.std[1];
  if (thr?.maxmass && r.unladen + r.fuelCap > thr.maxmass) items.push({ text: `I Thrusters di ${name} reggono al massimo ${num(thr.maxmass)} t: la nave ne pesa ${num(r.unladen + r.fuelCap)}`, cat: "Nave", sys: "" });
  if (!cfg.internal.some(e => e && ShipCalc.index(catalog).byId[e.id]?.grp === "fs"))
    items.push({ text: `Nessun Fuel Scoop su ${name}: potrai fare rifornimento solo in stazione o da un Fleet Carrier`, cat: "Nave", sys: "" });
  // Ingegnerie pianificate ancora da fare (gradi mancanti rispetto alla nave vera).
  const { jobs } = ShipCalc.engineeringJobs(catalog, cfg, { installedFor: shopInstalledFor(cfg) || undefined });
  for (const j of jobs) {
    if (!j.grades.length && !j.exp) continue;
    const e = engineersFor(j.module.grp, j.key, j.target)[0];
    // Frase composta in inglese qui: il pattern generico "Ingegnerizza {}: {}" (voci da fare di events.js) la tradurrebbe male.
    const what = `${j.name} G${j.target}${j.exp ? " · " + j.exp.name : ""}`;
    items.push({ text: LANG.lang === "en"
        ? `Engineer ${moduleName(j.module)} on ${name}: ${what}${j.from ? ` (now G${j.from})` : ""}${e ? " with " + e.name : ""}`
        : `Ingegnerizza ${moduleName(j.module)} di ${name}: ${what}${j.from ? ` (ora G${j.from})` : ""}${e ? " da " + e.name : ""}`,
      cat: "Ingegneri", sys: e?.system || "" });
  }
  return items;
}

// Scheda della nave: solo dati del catalogo.
function shipFacts(ship) {
  const hp = ship.slots.hardpoints.map(ShipCalc.slotInfo), cnt = {};
  for (const h of hp) { const k = (h.name === "Mining" ? "Mining " : "") + HP_LABEL[h.cls]; cnt[k] = (cnt[k] || 0) + 1; }
  const internal = ship.slots.internal.map(ShipCalc.slotInfo).filter(x => x.name !== "PlanetaryApproachSuite");
  const pad = ["", "S", "M", "L"][ship.size] || "—";
  return `<div class="kv-grid cfg-facts">
      <div class="kv"><span>Produttore</span><span>${esc(ship.manufacturer || "—")}</span></div>
      <div class="kv"><span>Landing pad</span><span>${pad}</span></div>
      <div class="kv"><span>Prezzo scafo</span><span class="gold">${short(ship.hullCost)} CR</span></div>
      <div class="kv"><span>Hull mass</span><span>${num(ship.hullMass)} t</span></div>
      <div class="kv"><span>Velocità base</span><span>${num(ship.speed)} m/s</span><span class="sub">boost ${num(ship.boost)} m/s</span></div>
      <div class="kv"><span>Scudi / scafo base</span><span>${num(ship.baseShield)} / ${num(ship.baseArmour)}</span></div>
      <div class="kv"><span>Mass lock</span><span>${ship.masslock ?? "—"}</span></div>
      <div class="kv"><span>Posti equipaggio</span><span>${ship.crew ?? "—"}</span></div>
    </div>
    <div class="sub" style="margin-top:10px">Hardpoint: ${Object.entries(cnt).map(([k, n]) => `${n}× ${k}`).join(", ") || "nessuno"}</div>
    <div class="sub">Interni: ${internal.map(x => x.name === "Military" ? `${x.cls} (Military)` : x.name ? `${x.cls} (${x.name})` : x.cls).join(" · ")}</div>
    <div class="sub">Core: ${ship.slots.standard.map((c, i) => `${STD_LABELS[i]} ${c}`).join(" · ")}</div>`;
}

// ============================================================================
// LISTA DELLA SPESA: materiali per tutta l'ingegneria dell'allestimento
// Ricette per grado da EDCD/coriolis-data modifications/blueprints.json (components) e specials.json.
// ============================================================================
const SHOP_CAT = { Raw: "Grezzi", Manufactured: "Manufatti", Encoded: "Codificati" };
const SHOP = { key: null, html: "" };  // memo: si ricalcola solo se cambiano build, tiri, inventario o flotta

function shopRollsId() {
  const v = localStorage.getItem("shopRolls");
  return ShipCalc.ROLL_PRESETS[v] ? v : ShipCalc.DEFAULT_ROLLS;
}

// Ingegneria già montata sul modulo della nave vera. Il Loadout della flotta non porta il blueprint nei dati
// grezzi, quindi lo si recupera da build.groups abbinando slot del journal e modulo.
function shopInstalledFor(cfg) {
  const ships = (S?.fleet || []).filter(f => f.build && CATALOG.journal_ships[f.symbol] === cfg.ship);
  if (!ships.length) return null;
  const pref = f => ((f.name?.trim() || f.type) === UI.cfgName ? 2 : 0) + (f.current ? 1 : 0);
  ships.sort((a, b) => pref(b) - pref(a));
  const idx = ShipCalc.index(CATALOG);
  return (kind, i, entry) => {
    if (!entry.slot) return null;
    for (const f of ships) {
      const r = (f.build.raw || []).find(x => x.slot === entry.slot);
      if (!r || idx.bySymbol[r.item]?.uid !== entry.id) continue;
      if (r.eng?.bp) return { blueprint: r.eng.bp, grade: r.eng.lvl || 0, exp: r.eng.exp || "" };
      const g = Object.values(f.build.groups || {}).flat().find(x => x.slot === entry.slot);
      return g && g.blueprint ? { blueprint: g.blueprint, grade: g.grade || 0, exp: g.effect || "" } : null;
    }
    return null;
  };
}

function shopMatName(r) {
  return UI.lang === "it" && typeof IT !== "undefined" && IT.material?.[r.symbol] || r.name;
}

function shopWhere(r) {
  if (typeof getMaterialSourceInfo !== "function") return "";
  // Tradotto prima di accorciarlo: il dizionario conosce la frase intera, non il pezzo tagliato.
  const w = LANG.t(String(getMaterialSourceInfo(r.name, r.category || "Manufactured")?.where || "").replace(/<[^>]+>/g, ""));
  const first = w.split(/(?<=\.)\s/)[0];
  return first.length > 150 ? first.slice(0, 147) + "…" : first;
}

function shopEngineers(job) {
  const list = engineersFor(job.module.grp, job.key, job.target);
  if (!list.length) return '<span class="bad">Nessun ingegnere applica questo grado</span>';
  return list.slice(0, 3).map(e => `<span class="${e.unlocked ? "ok" : ""}" title="${e.unlocked ? "Sbloccato" : "Non ancora sbloccato"}">${e.unlocked ? "✓ " : ""}${esc(e.name)}${e.system ? ` <span class="muted">(${esc(e.system)}${e.d != null ? " · " + ly(e.d) : ""})</span>` : ""}</span>`).join(" · ")
    + (list.length > 3 ? ` <span class="muted">+${list.length - 3}</span>` : "");
}

function shoppingPanel(cfg) {
  if (!CATALOG.blueprints) return panel("Lista della spesa", '<div class="empty">Il catalogo non contiene ancora le ricette di ingegneria: verrà aggiornato al prossimo download.</div>', { code: "MATERIALI" });
  const rollsId = shopRollsId();
  const inventory = {};
  for (const m of S?.materials || []) inventory[m.name] = (inventory[m.name] || 0) + (m.count || 0);
  const parts = ["standard", "internal", "hardpoints"].map(k => (cfg[k] || []).map(e => e?.engineering ? [e.id, e.engineering.blueprint, e.engineering.grade, e.engineering.exp, e.slot, e.installed?.grade] : 0));
  const key = JSON.stringify([cfg.ship, parts, rollsId, inventory, (S?.fleet || []).map(f => f.id + ":" + f.updated), UI.cfgName, UI.lang,
    Object.entries(S?.engineers || {}).map(([n, e]) => n + e.progress), S?.location?.system]);
  if (SHOP.key === key) return SHOP.html;

  const res = ShipCalc.shoppingList(CATALOG, cfg, inventory, { rolls: ShipCalc.ROLL_PRESETS[rollsId].rolls, installedFor: shopInstalledFor(cfg) });
  const symName = {};
  for (const [n, [sym]] of Object.entries(CATALOG.materials || {})) symName[sym] ||= n;
  for (const m of S?.materials || []) symName[m.name] ||= m.label || m.name;
  const buildName = UI.cfgName || CATALOG.ships[cfg.ship]?.name || "";

  const controls = `<div class="form" style="margin-bottom:10px;align-items:flex-end">
      <label>Applicazioni per grado<select id="shop-rolls">${Object.entries(ShipCalc.ROLL_PRESETS).map(([id, p]) => opt(id, p.label, rollsId)).join("")}</select></label>
      <span class="sub" style="padding-bottom:9px;flex:1;min-width:200px">Dalla 3.3 un grado si completa con più applicazioni: quante dipende dalla reputazione con l'ingegnere, quindi "Stima" e "Prudente" sono stime. Effetto sperimentale: 1 applicazione. I gradi già presenti sulla tua nave vengono saltati.</span>
    </div>`;

  let body;
  if (!res.jobs.length) {
    body = '<div class="empty">Nessun modulo ingegnerizzato in questo allestimento. Usa "+ ing." su un modulo o "Ingegneria consigliata".</div>';
  } else {
    const jobs = res.jobs.map(j => {
      const steps = j.grades.length ? `G${j.from + 1}${j.target > j.from + 1 ? "→G" + j.target : ""}` : "";
      const status = !j.grades.length && !j.exp ? '<span class="tag ok">già fatto</span>' : "";
      return `<tr><td><b>${esc(moduleName(j.module))}</b> <span class="muted">${j.module.class}${j.module.rating || ""}</span></td>
        <td><span class="tag holo-t">${esc(j.name)} G${j.target}</span>${j.exp ? `<span class="tag">${esc(j.exp.name)}</span>` : ""}${status}
          ${steps ? `<div class="sub">da fare: ${steps}${j.from ? ` (sulla nave già G${j.from})` : ""}${j.expAlready ? " · sperimentale già applicato" : ""}</div>` : ""}</td>
        <td class="sub">${shopEngineers(j)}</td></tr>`;
    }).join("");

    const rows = res.rows.map(r => {
      const tr = r.trade?.from?.length
        ? `<div class="sub gold">Trader ${esc(LANG.t(SHOP_CAT[r.category] || ""))}: ${r.trade.from.slice(0, 2).map(x => `${x.spend}× ${esc(symName[x.symbol] || x.symbol)} → ${x.get}`).join(", ")}${r.trade.covered < r.missing ? ` (${LANG.t("copre")} ${r.trade.covered}/${r.missing})` : ""}</div>` : "";
      const where = r.missing ? `<div class="sub">${esc(shopWhere(r))}</div>` : "";
      return `<tr><td><span title="${esc(r.uses.map(j => moduleName(j.module) + ": " + j.name).join("\n"))}">${esc(shopMatName(r))}</span>${where}${tr}</td>
        <td>${r.grade ? "G" + r.grade : ""}</td><td class="sub">${esc(SHOP_CAT[r.category] || r.category || "")}</td>
        <td class="num">${r.needed}</td><td class="num ${r.owned >= r.needed ? "ok" : ""}">${r.owned}</td>
        <td class="num ${r.missing ? "bad" : "ok"}">${r.missing || "✓"}</td>
        <td>${r.missing ? todoBtn(`Procurare ${r.missing}× ${r.name} (G${r.grade || "?"} ${SHOP_CAT[r.category] || ""}) per ${buildName}`, "", "Materiali") : ""}</td></tr>`;
    }).join("");

    const missing = res.rows.filter(r => r.missing);
    const allText = missing.length ? `Lista della spesa ${buildName}: ${missing.map(r => `${r.missing}× ${r.name}`).join(", ")}` : "";
    const t = res.totals;
    const summary = `<div class="kv-grid" style="margin:4px 0 10px">
        <div class="kv"><span>Materiali richiesti</span><span>${num(t.needed)}</span></div>
        <div class="kv"><span>Mancanti</span><span class="${t.missing ? "bad" : "ok"}">${t.missing ? num(t.missing) : "nessuno ✓"}</span></div>
        <div class="kv"><span>Dal Material Trader</span><span class="gold">${num(t.tradeable)}</span><span class="sub">stima, usando solo il surplus</span></div>
      </div>`;
    body = `<div class="subpanel"><h3>Moduli da ingegnerizzare</h3><table><thead><tr><th>Modulo</th><th>Blueprint</th><th>Ingegneri</th></tr></thead><tbody>${jobs}</tbody></table></div>
      ${summary}
      ${res.skipped.length ? `<div class="sub" style="margin-bottom:6px">Ricetta non trovata per: ${res.skipped.map(s => esc(moduleName(s.module) + " · " + s.blueprint)).join(", ")}</div>` : ""}
      <table><thead><tr><th>Materiale</th><th>G</th><th>Tipo</th><th class="num">Serve</th><th class="num">Hai</th><th class="num">Manca</th><th></th></tr></thead><tbody>${rows}</tbody></table>
      ${missing.length ? `<div class="cfg-row" style="justify-content:space-between;margin-top:10px"><span class="sub">Aggiungi tutti i materiali mancanti come una sola voce da fare</span>${todoBtn(allText, "", "Materiali")}</div>` : ""}`;
  }
  SHOP.key = key;
  SHOP.html = panel("Lista della spesa", controls + body, { code: "MATERIALI", aside: res.jobs.length ? `${res.jobs.length} moduli` : "" });
  return SHOP.html;
}

document.addEventListener("change", e => {
  const t = e.target;
  if (t.id === "shop-rolls") {
    localStorage.setItem("shopRolls", t.value);
    renderView();
  } else if (t.dataset?.engDraft && UI.engDraft) {
    const k = t.dataset.engDraft;
    UI.engDraft[k] = k === "grade" ? +t.value : t.value;
    if (k === "blueprint") {  // il nuovo blueprint può avere meno gradi
      const [kind, i] = UI.engDraft.slot.split(":");
      const m = cfgSlotModule(UI.cfg, kind, +i);
      const bp = ShipCalc.blueprintsFor(CATALOG, m?.grp || "bh").blueprints.find(b => b.key === t.value);
      if (bp) UI.engDraft.grade = Math.min(UI.engDraft.grade, bp.maxGrade);
    }
    renderView();
  }
});
// Consigli di ingegneria: applica il singolo blueprint consigliato.
document.addEventListener("click", e => {
  const t = e.target.closest?.("[data-eng-rec]");
  if (!t || !CATALOG || !UI.cfg) return;
  const a = getEngineeringAdvice(CATALOG, UI.cfg)[+t.dataset.engRec];
  if (a) { cfgSetEng(UI.cfg, a.kind, a.i, a.eng); toast("Pianificato: " + a.mod + " · " + ShipCalc.engLabel(CATALOG, a.grp, a.eng)); renderView(); }
});

// ============================================================================
// VISTA
// ============================================================================
VIEWS.shipyard = () => {
  if (!CATALOG) return panel("Cantiere navale", UI.catalogError ? `<div class="bad">⚠ ${esc(UI.catalogError)}</div>` : '<div class="loading">CARICAMENTO DEL CATALOGO NAVI</div>', { code: "SHIPYARD" });
  if (!UI.cfg) {
    const cur = S.fleet.find(f => f.current && f.build && CATALOG.journal_ships[f.symbol]);
    UI.cfg = cur ? ShipCalc.fromLoadout(CATALOG, cur.symbol, cur.build.raw, SHIP_SLOTS) : ShipCalc.blank(CATALOG, "cobramkv");
    UI.cfgName = cur ? (cur.name?.trim() || cur.type) : "";
  }
  const cfg = UI.cfg, ship = CATALOG.ships[cfg.ship], r = ShipCalc.compute(CATALOG, cfg);
  const symbol = ShipCalc.journalSymbol(CATALOG, cfg.ship);
  const shipOpts = Object.values(CATALOG.ships).sort((a, b) => a.name.localeCompare(b.name)).map(s => opt(s.key, s.name, cfg.ship)).join("");
  const fleet = S.fleet.filter(f => f.build && CATALOG.journal_ships[f.symbol]);
  const otherFleet = S.fleet.filter(f => f.build && !CATALOG.journal_ships[f.symbol]);
  const saved = savedBuilds();
  const roles = UI.activeRoles || new Set();
  loadShipSlots();

  // --- intestazione ---
  const top = `<div class="form cfg-top">
      <label>Nave<select id="cfg-ship">${shipOpts}</select></label>
      <label class="grow-1">Nome dell'allestimento<input id="cfg-name" value="${esc(UI.cfgName || "")}" placeholder="es. Cobra multi-ruolo"></label>
      <button class="primary" id="cfg-save">Salva</button>
      <span class="seg-choice">
        <button id="btn-create-coriolis" title="Nuova build della nave scelta, con i moduli di serie">Nuova</button>
        <button id="cfg-reset" title="Rimette i moduli di serie, tenendo il nome">Di serie</button>
      </span>
      <button class="${UI.showShare ? "primary" : ""}" id="bs-toggle">${UI.showShare ? "Chiudi condivisione" : "Condividi / importa"}</button>
    </div>
    ${UI.showShare ? sharePanel() : ""}
    <div class="cfg-sources">
      <div><div class="eyebrow">Preset <span class="sub">(combinabili)</span>${roles.size ? ` <button class="small ghost" id="clear-roles-btn">azzera</button>` : ""}</div>
        <div class="chips">${SHIP_PRESETS.map(p => `<button class="small ${roles.has(p.id) ? "primary" : ""}" data-toggle-role="${p.id}" title="${esc(p.desc)}">${esc(p.label)}</button>`).join("")}</div></div>
      <div><div class="eyebrow">Dalla tua flotta</div>
        <div class="chips">${fleet.map(f => `<button class="small" data-import="${f.id}" title="${esc(f.type)}">${esc(f.name?.trim() || f.type)}</button>`).join("") || '<span class="sub">Nessun allestimento registrato</span>'}
        ${otherFleet.length ? `<span class="sub" title="Navi non presenti nel catalogo dei moduli">non nel catalogo: ${otherFleet.map(f => esc(f.type)).join(", ")}</span>` : ""}</div></div>
      ${saved.length ? `<div><div class="eyebrow">Salvati</div><div class="chips">${saved.map((b, i) => `<span class="cfg-saved"><button class="small" data-load-build="${i}">${esc(b.name)}</button><button class="small ghost" data-del-build="${i}" title="Elimina">✕</button></span>`).join("")}</div></div>` : ""}
    </div>
    ${cfg.unknown?.length ? `<div class="sub bad">Moduli non presenti nel catalogo (massa e costo non conteggiati): ${cfg.unknown.map(esc).join(", ")}</div>` : ""}`;

  // --- tabelle moduli ---
  const core = armourRow(r) + ship.slots.standard.map((size, i) => slotRow("standard", i, STD_LABELS[i], size)).join("");
  const internal = ship.slots.internal.map((slot, i) => {
    const info = ShipCalc.slotInfo(slot);
    const label = { Military: "Military", PlanetaryApproachSuite: "Planetary Approach", Limpets: "Limpets", Fighter: "Fighter Hangar" }[info.name] || "Optional";
    return slotRow("internal", i, label, info.cls);
  }).join("");
  const hard = ship.slots.hardpoints.map((slot, i) => {
    const info = ShipCalc.slotInfo(slot);
    return slotRow("hardpoints", i, (info.name === "Mining" ? "Mining " : "") + HP_LABEL[info.cls], info.cls ? info.cls : "");
  }).join("");

  // --- riepilogo ---
  const powerPct = r.pgen ? r.draw / r.pgen * 100 : 0;
  const hullCost = ship.hullCost || 0, modulesCost = Math.max(0, r.cost - hullCost), credits = S?.commander?.credits;
  const warns = r.warnings.filter(w => w.kind !== "power");
  const stats = `${shipPic(symbol)}
    <div class="cfg-hero">
      <div><div class="eyebrow">Salto max</div><div class="big holo-t">${fmtLy(r.jump.max)}</div></div>
      <div><div class="eyebrow">A pieno carico</div><div class="mid">${fmtLy(r.jump.laden)}</div></div>
    </div>
    <div class="kv-grid cfg-kv">
      <div class="kv"><span>Serbatoio pieno</span><span>${fmtLy(r.jump.full)}</span></div>
      <div class="kv"><span>Autonomia</span><span>${num(r.totalRange)} al</span><span class="sub">${r.totalJumps} salti con un pieno</span></div>
      <div class="kv"><span>Massa a vuoto</span><span>${fmtN(r.unladen, 1)} t</span></div>
      <div class="kv"><span>Fuel / Cargo</span><span>${num(r.fuelCap)} / ${num(r.cargoCap)} t</span></div>
      <div class="kv"><span>Velocità</span><span>${r.speed ? num(r.speed) + " m/s" : "—"}</span><span class="sub">boost ${r.boostSpeed ? num(r.boostSpeed) + " m/s" : "—"}</span></div>
      <div class="kv"><span>Scudi / Scafo</span><span>${r.shield ? num(r.shield) + " MJ" : "—"} / ${num(r.armour)}</span></div>
      ${r.passengers ? `<div class="kv"><span>Passeggeri</span><span>${r.passengers}</span></div>` : ""}
    </div>
    <div class="cfg-power">
      <div class="cfg-row" style="justify-content:space-between"><span class="eyebrow">Energia</span>
        <span class="${powerPct > 100 ? "bad" : ""}">${fmtMW(r.draw)} / ${fmtMW(r.pgen)} MW · ${Math.round(powerPct)}%</span></div>
      ${seg(Math.min(100, powerPct), 30, powerPct > 100 ? "" : "holo")}
      <div class="sub">Armi ritratte: ${fmtMW(r.drawRetracted)} MW${powerPct > 100 ? ' · <span class="bad">oltre il 100%: in gioco dovrai spegnere o mettere a priorità bassa alcuni moduli</span>' : ""}</div>
    </div>
    <table class="cfg-cost"><tbody>
      <tr><td>Scafo</td><td class="num">${cr(hullCost)}</td></tr>
      <tr><td>Moduli</td><td class="num">${cr(modulesCost)}</td></tr>
      <tr><td><b>Totale</b></td><td class="num gold"><b>${cr(r.cost)}</b></td></tr>
      <tr><td>Riscatto (5%)</td><td class="num gold">${cr(r.rebuy)}</td></tr>
      ${credits != null ? `<tr><td>Crediti</td><td class="num ${credits >= r.cost ? "ok" : "bad"}">${cr(credits)}</td></tr>` : ""}
    </tbody></table>
    <div class="sub">Prezzi di listino del catalogo: alcune stazioni applicano sconti.${r.unknownCost ? ` ${r.unknownCost} moduli senza prezzo noto non sono conteggiati.` : ""}</div>
    ${warns.map(w => `<div class="bad" style="margin-top:6px">⚠ ${esc(w.text)}</div>`).join("")}
    <div class="cfg-row" style="margin-top:12px"><button class="primary" id="cfg-plot">Usa nella rotta esatta</button></div>`;

  // --- consigli ---
  const engAdvice = getEngineeringAdvice(CATALOG, cfg);
  const engHtml = engAdvice.length ? `<table class="cfg-rec"><tbody>${engAdvice.map((a, k) => `<tr>
        <td><b>${esc(a.mod)}</b><div><span class="tag holo-t">${esc(a.blueprint)}</span>${a.exp ? `<span class="tag">${esc(a.exp)}</span>` : ""}</div>
          <div class="sub">${esc(a.effects)}</div>
          ${a.engineers.length ? `<div class="sub">Ingegneri G5: ${a.engineers.slice(0, 3).map(e => `<span class="${e.unlocked ? "ok" : ""}">${e.unlocked ? "✓ " : ""}${esc(e.name)}${e.system ? ` <span class="muted">(${esc(e.system)})</span>` : ""}</span>`).join(" · ")}</div>` : ""}</td>
        <td class="num" style="white-space:nowrap">${a.metric ? `<div class="sub">${esc(a.metric.label)}</div><div>${esc(a.metric.before)}</div><div class="holo-t">→ ${esc(a.metric.after)}</div>` : ""}</td>
        <td class="cfg-rec-act"><button class="small" data-eng-rec="${k}">Pianifica</button>
          <button class="small ghost" data-eng-todo="${esc(a.mod)}" data-eng-bp="${esc(a.blueprint)}" data-eng-exp="${esc(a.exp || "nessuno sperimentale")}" data-eng-eng="${esc(a.sys)}">+ da fare</button></td></tr>`).join("")}</tbody></table>
      <div class="cfg-row" style="margin-top:10px"><button class="primary" id="cfg-eng-all-g5">Pianifica tutto</button><button id="eng-todo-all">Tutto nei da fare</button></div>`
    : '<div class="empty">Tutti i moduli principali hanno già questi blueprint al G5.</div>';
  const engNote = '<div class="sub" style="margin-top:8px">Blueprint G5 comuni per ogni modulo, al tiro migliore del grado. "Prima → dopo" è calcolato su questa build con gli effetti del catalogo.</div>';

  const adviceItems = getBuildAdvice(CATALOG, cfg);
  const adviceHtml = adviceItems.length ? adviceItems.map(item => `<div class="todo-item"><div class="text">${esc(item.text)}<div class="sub">${esc(LANG.t(item.cat))}${item.sys ? " · " + esc(item.sys) : ""}</div></div>
      <button class="small ghost" data-build-todo="${esc(item.text)}" data-build-cat="${esc(item.cat)}" data-build-sys="${esc(item.sys)}">+ da fare</button></div>`).join("") +
    `<div class="cfg-row" style="margin-top:10px"><button id="build-todo-all">Tutto nei da fare</button></div>`
    : '<div class="empty">Niente da segnalare su questa build.</div>';

  return `${panel("Cantiere navale", top, { code: "SHIPYARD", aside: `${esc(ship.name)} · pad ${["", "S", "M", "L"][ship.size] || "?"}` })}
    <div class="grid cfg-grid" style="margin-top:18px"><div class="col">
      ${panel("Moduli principali", modTable(core, "MW"), { code: "CORE" })}
      ${panel("Interni opzionali", modTable(internal), { code: "OPTIONAL", aside: `${cfg.internal.filter(Boolean).length}/${ship.slots.internal.length}` })}
      ${ship.slots.hardpoints.length ? panel("Hardpoint e utility", modTable(hard), { code: "HARDPOINTS" }) : ""}
    </div><div class="col cfg-side">
      ${panel(esc(UI.cfgName || ship.name), stats, { cls: "holo", code: "STATS", aside: UI.cfgName ? esc(ship.name) : "" })}
    </div></div>
    <div class="grid cfg-grid" style="margin-top:18px"><div class="col">
      ${panel("Ingegneria consigliata", engHtml + engNote, { code: "INGEGNERIA" })}
      ${shoppingPanel(cfg)}
    </div><div class="col">
      ${panel("Da completare", adviceHtml, { code: "OBIETTIVI" })}
      ${panel("Scheda nave", shipFacts(ship), { code: "DATI" })}
    </div></div>`;
};
