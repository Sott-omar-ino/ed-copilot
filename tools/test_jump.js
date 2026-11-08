"use strict";
// Test della portata di salto e della massa del cantiere (web/js/shipcalc.js).
//   node tools/test_jump.js [cartella del journal]
// 1. Riferimento indipendente: la build "Salto massimo" del Panther Clipper Mk II rifatta a mano con i valori e la formula
//    di EDSY (https://edsy.org/eddb.js versione 424029902 e https://edsy.org/edsy.js, getJumpDistance), non con il catalogo.
// 2. Regressione sul journal: ogni evento Loadout diverso (sola lettura) deve dare lo stesso MaxJumpRange e UnladenMass
//    che scrive il gioco. Cartella: argomento, oppure ED_JOURNAL_DIR, oppure quella standard; se manca la parte si salta.
// 3. Preset del cantiere: fanno quello che dice la descrizione, su tutte le navi del catalogo.
// 4. Andata e ritorno: Loadout -> configurazione -> Loadout -> configurazione e codice ED Copilot, stessi numeri.
const fs = require("fs");
const path = require("path");
const os = require("os");
const ROOT = path.join(__dirname, "..");
const SC = require(path.join(ROOT, "web/js/shipcalc.js"));
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "data/catalog.json"), "utf8"));
const slotTable = JSON.parse(fs.readFileSync(path.join(ROOT, "defaults/ship_slots.json"), "utf8"));

let failed = 0, passed = 0;
const ok = (cond, msg) => { if (cond) passed++; else { failed++; console.log("  FAIL " + msg); } };
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// ---------------------------------------------------------------------------------------------------------------- 1
console.log("1. Panther Clipper Mk II, build \"Salto massimo\" segnalata (riferimento EDSY)");
{
  // EDSY eddb.js: Panther Clipper Mk II mass 1200; Frame Shift Drive (SCO) 7A (Int_Hyperdrive_Overcharge_Size7_Class5)
  // mass 80, fsdoptmass 3000, maxfuel 13.10, fuelmul 0.013, fuelpower 2.75; cfsd_ir (Increased Range) G5 mass +30%,
  // fsdoptmass +55%; cfsdx_mm (Mass Manager) fsdoptmass +4%; misc_lw (Lightweight) G5 mass -85%; cs_lw G5 mass -80%;
  // Guardian FSD Booster 5H mass 1.30 jumpbst 10.50. Masse dei moduli normali dal catalogo (identiche in EDSY):
  // Power Plant 8A 80, Thrusters 8D 64, Life Support 5D 8, Power Distributor 7D 32, Sensors 5D 8, Fuel Tank 7C 0 (128 t),
  // Cargo Rack 7E 0 (128 t), Shield Generator 7E 80, Lightweight Alloy 0.
  const fsdMass = 80 * 1.30, opt = 3000 * 1.55 * 1.04;
  const unladen = 1200 + 80 + 64 + fsdMass + 8 * 0.15 + 32 + 8 * 0.20 + 0 + 0 + 80 + 1.3;
  // edsy.js getJumpDistance: pow(min(fuel, maxfuel) / fuelmul, 1 / fuelpower) * optmass / (mass + fuel) + jumpbst
  const dist = (mass, fuel) => Math.pow(Math.min(fuel, 13.1) / 0.013, 1 / 2.75) * opt / (mass + fuel) + 10.5;
  const ref = { unladen, max: dist(unladen, 13.1), full: dist(unladen + 128 - 13.1, 13.1), laden: dist(unladen + 128 + 128 - 13.1, 13.1) };
  const id = (grp, cls, rating, extra = m => true) => catalog.modules.find(m => m.grp === grp && m.class === cls && m.rating === rating && !m.pre && extra(m)).uid;
  const cfg = SC.blank(catalog, "panthermkii");
  cfg.bulkhead = 0;
  cfg.standard = [
    { id: id("pp", 8, "A") }, { id: id("t", 8, "D") },
    { id: id("fsd", 7, "A", m => m.symbol === "int_hyperdrive_overcharge_size7_class5"), engineering: { blueprint: "FSD_LongRange", grade: 5, exp: "special_fsd_heavy" } },
    { id: id("ls", 5, "D"), engineering: { blueprint: "LifeSupport_LightWeight", grade: 5, exp: "" } },
    { id: id("pd", 7, "D") }, { id: id("s", 5, "D"), engineering: { blueprint: "Sensor_LightWeight", grade: 5, exp: "" } },
    { id: id("ft", 7, "C") }];
  cfg.internal = cfg.internal.map(() => null);
  cfg.hardpoints = cfg.hardpoints.map(() => null);
  cfg.internal[0] = { id: id("cr", 7, "E") };
  cfg.internal[1] = { id: id("sg", 7, "E") };
  cfg.internal[7] = { id: id("gfsb", 5, "H") };
  const r = SC.compute(catalog, cfg);
  console.log(`   ED Copilot: max ${r.jump.max.toFixed(2)}  full ${r.jump.full.toFixed(2)}  laden ${r.jump.laden.toFixed(2)}  unladen ${r.unladen.toFixed(1)} t`);
  console.log(`   EDSY      : max ${ref.max.toFixed(2)}  full ${ref.full.toFixed(2)}  laden ${ref.laden.toFixed(2)}  unladen ${ref.unladen.toFixed(1)} t`);
  ok(near(r.unladen, ref.unladen, 0.01), "massa a vuoto diversa da EDSY");
  ok(near(r.jump.max, ref.max, 0.005) && near(r.jump.full, ref.full, 0.005) && near(r.jump.laden, ref.laden, 0.005), "portata diversa da EDSY");
  ok(near(r.jump.max, 48.41, 0.005), "il valore segnalato era 48,41 al");
}

// ---------------------------------------------------------------------------------------------------------------- 2
console.log("2. Regressione sugli eventi Loadout del journal");
// Aggiornamento "Anaconda Mk II" (20/10/2026): Frontier ha cambiato massa e slot di alcune navi (Asp Scout, Federal
// Dropship, Imperial Clipper, Type-6/Type-7, Mandalay, Caspian Explorer). EDSY (eddb.js, edsy_lastmodified_db 20261020)
// e coriolis-data (develop, 25/10/2026) hanno i valori nuovi; un Loadout scritto prima di quella data per queste navi ha
// la massa vecchia: si verifica la formula con la UnladenMass del gioco e si segnala la differenza dello scafo.
const REBALANCE = "2026-10-20";
const REBALANCED = new Set(["asp_scout", "federal_dropship", "imperial_clipper", "type_6_transporter", "type_7_transport", "mandalay", "explorer_nx"]);
const COSMETIC = /^(Decal|PaintJob|ShipName|ShipID|ShipKit|WeaponColour|EngineColour|VesselVoice|Bobble|StringLights|CargoHatch|ShipCockpit)/i;
const dir = process.argv[2] || process.env.ED_JOURNAL_DIR || path.join(os.homedir(), "Saved Games", "Frontier Developments", "Elite Dangerous");
const loadouts = [];
if (fs.existsSync(dir)) {
  const seen = new Map();
  for (const f of fs.readdirSync(dir).filter(f => /^Journal\..*\.log$/.test(f)).sort())
    for (const line of fs.readFileSync(path.join(dir, f), "utf8").split("\n")) {
      if (!line.includes('"event":"Loadout"')) continue;
      let e;
      try { e = JSON.parse(line); } catch { continue; }
      seen.set(JSON.stringify([e.Ship, e.Modules.map(m => [m.Slot, m.Item, m.Engineering?.Modifiers?.map(x => x.Value)]), e.FuelCapacity]), e);
    }
  loadouts.push(...seen.values());
}
if (!loadouts.length) console.log(`   (nessun Loadout in ${dir}: parte saltata)`);
let strict = 0, pre = 0, skipped = 0;
for (const e of loadouts) {
  const tag = `${e.Ship} ${e.timestamp}`;
  const cfg = SC.fromLoadout(catalog, e.Ship, e.Modules.filter(m => !COSMETIC.test(m.Slot)), slotTable);
  if (!cfg) { skipped++; console.log(`   salta ${tag}: nave non nel catalogo`); continue; }
  if (cfg.unknown.length) { skipped++; console.log(`   salta ${tag}: moduli non nel catalogo ${cfg.unknown.join(", ")}`); continue; }
  const r = SC.compute(catalog, cfg), f = r.fsd;
  ok(near(r.fuelCap, e.FuelCapacity.Main, 0.001), `${tag}: serbatoio ${r.fuelCap} invece di ${e.FuelCapacity.Main}`);
  const old = e.timestamp < REBALANCE && REBALANCED.has(cfg.ship);
  if (old) {
    // Formula e moduli con la massa vera del gioco.
    const fuel = Math.min(f.max_fuel_per_jump, r.fuelCap);
    const jump = Math.pow(fuel / f.fuel_multiplier, 1 / f.fuel_power) * f.optimal_mass / (e.UnladenMass + fuel) + f.range_boost;
    ok(near(jump, e.MaxJumpRange, 0.01), `${tag}: salto ${jump.toFixed(3)} invece di ${e.MaxJumpRange.toFixed(3)}`);
    const hull = catalog.ships[cfg.ship].hullMass, implied = hull + e.UnladenMass - r.unladen;
    console.log(`   ${tag}: prima del ${REBALANCE}, scafo dal journal ${implied.toFixed(2)} t, catalogo ${hull} t; salto ok con la massa del gioco`);
    pre++;
  } else {
    ok(near(r.unladen, e.UnladenMass, 0.05), `${tag}: massa ${r.unladen.toFixed(2)} invece di ${e.UnladenMass.toFixed(2)}`);
    ok(near(r.jump.max, e.MaxJumpRange, 0.01), `${tag}: salto ${r.jump.max.toFixed(3)} invece di ${e.MaxJumpRange.toFixed(3)}`);
    strict++;
  }
  // 4. Andata e ritorno (formato journal e codice ED Copilot).
  const back = SC.toLoadout(catalog, cfg, { slotTable }).loadout;
  const cfg2 = SC.fromLoadout(catalog, back.Ship, back.Modules, slotTable);
  const r2 = SC.compute(catalog, cfg2);
  ok(near(r2.unladen, r.unladen, 1e-6) && near(r2.jump.max, r.jump.max, 1e-6), `${tag}: andata e ritorno del Loadout cambia i numeri`);
  const r3 = SC.compute(catalog, SC.decodeCode(catalog, SC.encodeCode(cfg, "x")).cfg);
  ok(near(r3.unladen, r.unladen, 1e-6) && near(r3.jump.max, r.jump.max, 1e-6) && near(r3.cost, r.cost, 1e-6), `${tag}: codice ED Copilot cambia i numeri`);
}
if (loadouts.length) console.log(`   ${loadouts.length} Loadout: ${strict} confrontati con massa e salto del gioco, ${pre} prima del ribilanciamento, ${skipped} saltati`);

// ---------------------------------------------------------------------------------------------------------------- 3
console.log("3. Preset \"Salto massimo\" su tutte le navi");
{
  const src = fs.readFileSync(path.join(ROOT, "web/js/views/cantiere.js"), "utf8");
  const a = src.indexOf("const SHIP_PRESETS"), b = src.indexOf("function buildRole(");
  const buildRoleMix = new Function("ShipCalc", src.slice(a, b) + "\nreturn buildRoleMix;")(SC);
  const idx = SC.index(catalog).byId;
  for (const key of Object.keys(catalog.ships)) {
    const ship = catalog.ships[key], cfg = buildRoleMix(catalog, key, ["max_jump"]), r = SC.compute(catalog, cfg);
    const mods = [...cfg.internal, ...cfg.hardpoints].filter(Boolean).map(e => idx[e.id]);
    const fsd = idx[cfg.standard[2].id];
    ok(!r.warnings.length, `${key}: avvisi ${r.warnings.map(w => w.kind).join(",")}`);
    ok(!fsd.ship || [].concat(fsd.ship).includes(key), `${key}: FSD riservato a un'altra nave (${fsd.symbol})`);
    ok(fsd.rating === "A" && cfg.standard[2].engineering?.blueprint === "FSD_LongRange", `${key}: FSD non A con Increased Range`);
    ok(!mods.some(m => m.grp === "cr" || m.grp === "crl"), `${key}: monta Cargo Rack`);
    ok(!cfg.hardpoints.some(Boolean), `${key}: monta armi`);
    ok(mods.some(m => m.grp === "gfsb"), `${key}: manca il Guardian FSD Booster`);
    // Power Plant: nessuno più leggero basta.
    const pp = idx[cfg.standard[0].id];
    ok(!catalog.modules.some(m => m.grp === "pp" && !m.pre && m.class <= ship.slots.standard[0] && (!m.ship || [].concat(m.ship).includes(key))
      && m.pgen >= r.draw && m.mass < pp.mass), `${key}: c'è un Power Plant più leggero che basta`);
    // Shield Generator: il più leggero che regge lo scafo (se ne entra uno).
    const sg = mods.find(m => ["sg", "bsg", "psg"].includes(m.grp));
    if (sg) ok(sg.maxmass >= ship.hullMass, `${key}: Shield Generator che non regge lo scafo`);
  }
}

console.log(`\n${passed} controlli superati, ${failed} falliti`);
process.exit(failed ? 1 : 0);
