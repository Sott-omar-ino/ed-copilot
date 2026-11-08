"use strict";
// Importazione dei link /outfit/ di Coriolis da capo a fondo: app/buildshare.py (link e ingegnerie) + ShipCalc.fromCoriolis.
//   node tools/test_build_import.js
// I link sono quelli prodotti dall'encoder di Coriolis nei suoi test (tools/fixtures/coriolis_fixtures.json, EDCD/coriolis,
// MIT); per ciascuno Coriolis ha salvato anche l'export dettagliato della stessa build (moduli, blueprint, grado e valori
// dei modificatori), che qui fa da risultato atteso.
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..");
const SC = require(path.join(ROOT, "web/js/shipcalc.js"));
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "data/catalog.json"), "utf8"));
const FIX = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/coriolis_fixtures.json"), "utf8"));

let passed = 0, failed = 0;
const ok = (c, m) => { if (c) passed++; else { failed++; console.log("  FAIL " + m); } };

// Decodifica in blocco con il backend (stesso codice dell'app).
function decodeAll(texts) {
  const py = "import sys, json; sys.path.insert(0, sys.argv[1]); from app import buildshare as b\n" +
    "out = []\nfor t in json.load(sys.stdin):\n  try: out.append(b.decode_text(t))\n  except ValueError as e: out.append({'error': str(e)})\n" +
    "print(json.dumps(out))";
  const r = spawnSync(process.env.PYTHON || "python", ["-c", py, ROOT], { input: JSON.stringify(texts), encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout);
}
const idx = SC.index(catalog).byId;
const bpById = Object.fromEntries(Object.entries(catalog.blueprints).map(([k, b]) => [b.id, k]));
// Moduli rimossi dal gioco (Discovery Scanner, tolti con la 3.3): Coriolis li conserva nei vecchi export, il catalogo no.
const REMOVED = new Set(["Scanner"]);

console.log("1. Export dettagliati di Coriolis");
const dec = decodeAll(FIX.detailed.map(d => d.url));
FIX.detailed.forEach((d, n) => {
  const { cfg, name, version } = SC.fromCoriolis(catalog, dec[n]);
  ok(name === d.name, `${d.file}: nome`);
  const bh = typeof d.bulkheads === "string" ? d.bulkheads : d.bulkheads?.name;
  ok(catalog.ships[d.ship].bulkheads[cfg.bulkhead].name === bh, `${d.file}: corazza ${bh}`);
  const cmp = (label, want, entry) => {
    if (!want) { ok(!entry, `${label}: atteso vuoto`); return; }
    if (!entry) { ok(REMOVED.has(want.group), `${label}: manca ${want.class}${want.rating} ${want.group || ""}`); return; }
    const m = idx[entry.id];
    // Rating cambiati nei dati dopo questi export (EDSY eddb.js: Detailed Surface Scanner 1I, Pulse Laser fisso medio 2E).
    const RERATED = { "1C>1I": "Detailed Surface Scanner", "2F>2E": "hpt_pulselaser_fixed_medium" };
    const k = `${want.class}${want.rating}>${m.class}${m.rating}`;
    ok(m.class === want.class && (m.rating === want.rating || (RERATED[k] && (m.name === RERATED[k] || m.symbol === RERATED[k]))),
      `${label}: ${m.class}${m.rating} invece di ${want.class}${want.rating}`);
    if (want.blueprint) {
      ok(entry.engineering?.blueprint === bpById[want.blueprint.id] && entry.engineering.grade === want.blueprint.grade,
        `${label}: blueprint ${entry.engineering?.blueprint} G${entry.engineering?.grade}`);
      // Valori: modifications/10000 (Module.js), le resistenze non si usano nel cantiere.
      for (const [attr, v] of Object.entries(want.modifications || {})) {
        if (["kinres", "thermres", "explres", "causres"].includes(attr) || catalog.mod_methods[attr] !== "multiplicative") continue;
        const sp = entry.engineering.exp ? catalog.specials[entry.engineering.exp].actions?.[attr] : null;
        const expect = sp ? (1 + v / 10000) * (1 + sp) - 1 : v / 10000;
        ok(Math.abs((entry.fx?.[attr] ?? NaN) - expect) < 1e-9, `${label}: ${attr} ${entry.fx?.[attr]} invece di ${expect}`);
      }
    } else if (want.modifications) {
      // Modificatori senza blueprint (Coriolis li permette): solo i valori.
      for (const [attr, v] of Object.entries(want.modifications))
        if (catalog.mod_methods[attr] === "multiplicative") ok(Math.abs((entry.fx?.[attr] ?? NaN) - v / 10000) < 1e-9, `${label}: ${attr}`);
      ok(!entry.engineering, `${label}: blueprint inatteso`);
    } else ok(!entry.engineering && !entry.fx, `${label}: ingegneria inattesa`);
  };
  d.standard.forEach((w, i) => cmp(`${d.file} ${SC.STD_SLOTS[i]}`, w, cfg.standard[i]));
  // Coriolis elenca armi e utility a parte; nel catalogo stanno nello stesso array (utility = classe 0).
  const hp = cfg.hardpoints.map((e, i) => ({ e, cls: SC.slotInfo(catalog.ships[d.ship].slots.hardpoints[i]).cls }));
  hp.filter(x => x.cls > 0).forEach((x, i) => cmp(`${d.file} hardpoint ${i}`, d.hardpoints[i], x.e));
  hp.filter(x => x.cls === 0).forEach((x, i) => cmp(`${d.file} utility ${i}`, d.utility[i], x.e));
  d.internal.forEach((w, i) => cmp(`${d.file} interno ${i}`, w, cfg.internal[i]));
  const r = SC.compute(catalog, cfg);
  console.log(`   ${d.file}: v${version}, ${name}, salto max ${r.jump.max.toFixed(2)} al, massa ${r.unladen.toFixed(1)} t` +
    (cfg.unknown.length ? `, non nel catalogo: ${cfg.unknown.join(" ")}` : ""));
});

console.log("2. Build di Coriolis (expected-builds.json, link v3)");
const list = Object.entries(FIX.expected_builds).flatMap(([ship, b]) => Object.entries(b).map(([n, code]) => ({ ship, n, code })));
const dec2 = decodeAll(list.map(x => `https://coriolis.io/outfit/${x.ship}?code=${encodeURIComponent(x.code)}`));
list.forEach((x, n) => {
  const { cfg, version } = SC.fromCoriolis(catalog, dec2[n]);
  ok(version === 3 && !cfg.unknown.length, `${x.ship} ${x.n}: v${version}, sconosciuti ${cfg.unknown.join(",")}`);
  ok(cfg.standard.every(Boolean), `${x.ship} ${x.n}: moduli standard mancanti`);
  // Ogni modulo nel suo slot rispetta classe e tipo ammesso dal catalogo.
  const ship = catalog.ships[x.ship];
  cfg.internal.forEach((e, i) => {
    if (!e) return;
    const info = SC.slotInfo(ship.slots.internal[i]), m = idx[e.id];
    // Solo la classe: Coriolis non controlla il tipo negli slot Military (la sua build "Cargo" del Federal Dropship
    // ha un Cargo Rack in uno slot Military) e il decoder resta fedele al link.
    ok(m.class <= info.cls, `${x.ship} ${x.n}: ${m.name} nello slot ${i}`);
  });
});

console.log("3. Link v1 riscritti da Coriolis in v3 (test-link-migration.js: decode(v1) -> toString() === expected-builds)");
{
  // Comprende la migrazione delle navi con slot aggiunti (LinkMigration.js) e upgradeInternals() dei link v1.
  const shipId = name => Object.keys(catalog.ships).find(k => catalog.ships[k].name.toLowerCase() === name.toLowerCase());
  const cases = FIX.v1_links.map(x => ({ ...x, id: shipId(x.ship) })).filter(x => FIX.expected_builds[x.id]?.[x.name]);
  const enc = c => encodeURIComponent(c);
  const d1 = decodeAll(cases.map(x => `https://coriolis.io/outfit/${x.id}?code=${enc(x.code)}`));
  const d3 = decodeAll(cases.map(x => `https://coriolis.io/outfit/${x.id}?code=${enc(FIX.expected_builds[x.id][x.name])}`));
  const strip = cfg => JSON.stringify([cfg.bulkhead, ...["standard", "hardpoints", "internal"].map(k => cfg[k].map(e => e ? e.id : 0))]);
  cases.forEach((x, n) => {
    const a = SC.fromCoriolis(catalog, d1[n]), b = SC.fromCoriolis(catalog, d3[n]);
    ok(a.version === 1 && b.version === 3, `${x.id} ${x.name}: versioni ${a.version}/${b.version}`);
    ok(strip(a.cfg) === strip(b.cfg), `${x.id} ${x.name}: v1 e v3 danno build diverse \n      v1 ${strip(a.cfg)}\n      v3 ${strip(b.cfg)}`);
  });
  console.log(`   ${cases.length} link v1 confrontati`);
}

console.log(`\n${passed} controlli superati, ${failed} falliti`);
process.exit(failed ? 1 : 0);
