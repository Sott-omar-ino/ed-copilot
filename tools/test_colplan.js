"use strict";
// Piano di colonizzazione: construction points, tassa sugli starport, effetti e codice condivisibile (web/js/colplan.js).
//   node tools/test_colplan.js
// I valori attesi seguono le regole di Raven Colonial (src/system-model2.ts, vedi l'intestazione di colplan.js). I dati
// li dà app/colonisation_data.py, che li scarica da GitHub (serve la rete) in una cartella dati temporanea.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const ROOT = path.join(__dirname, "..");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "vw-colplan-"));
const r0 = spawnSync(process.env.PYTHON || "python", ["-c",
  "import sys, json; sys.path.insert(0, sys.argv[1]); from app import colonisation_data as c; print(json.dumps(c.site_data()))", ROOT],
  { encoding: "utf8", env: { ...process.env, VOIDWATCH_DATA: tmp } });
fs.rmSync(tmp, { recursive: true, force: true });
if (r0.status !== 0) { console.log(r0.stderr); process.exit(1); }
globalThis.COLONISATION_DATA = JSON.parse(r0.stdout);
if (COLONISATION_DATA.error) { console.log(COLONISATION_DATA.error); process.exit(1); }
const P = require(path.join(ROOT, "web/js/colplan.js"));

let passed = 0, failed = 0;
const ok = (c, m) => { if (c) passed++; else { failed++; console.log("  FAIL " + m); } };
const plan = (...types) => ({ system: "Test", sites: types.map((t, i) => ({ body: "A " + (i + 1), type: t, status: "plan" })) });

// Dati: forma di ogni struttura.
const all = P.sites();
ok(all.length >= 50, "almeno 50 strutture");
for (const s of all) {
  ok(Array.isArray(s.needs) && Array.isArray(s.gives) && typeof s.effects === "object", "forma di " + s.key);
  for (const [n, q] of Object.entries(s.cargo)) ok(typeof n === "string" && q > 0, `merce ${n} di ${s.key}`);
}
ok(P.site("dual_truss")?.key === "no_truss", "un sottotipo porta alla sua struttura");

// Primary port gratis, outpost danno punti T2, la Coriolis successiva li spende.
let r = P.evaluate(plan("no_truss", "plutus", "vulcan", "vesta", "no_truss"));
ok(r.rows[0].cost === null, "il primary port non costa");
ok(r.rows[4].cost?.tier === 2 && r.rows[4].cost.count === 3, "Coriolis costa 3 punti T2");
ok(!r.rows[4].short, "3 outpost bastano per la Coriolis");
ok(r.points[2] === 0 && r.points[3] === 2, `saldo finale T2 0 / T3 2 (${JSON.stringify(r.points)})`);

// Orbis (T3, 6 punti) senza punti sufficienti.
r = P.evaluate(plan("no_truss", "apollo"));
ok(r.rows[1].short && r.rows[1].cost.count === 6, "Orbis senza punti T3 è segnata come scoperta");
ok(r.short === 1, "un passo scoperto");

// Tassa: primary + 3 Coriolis in più; la terza costa 3 + trunc(3 * 0.75) = 5.
r = P.evaluate(plan("no_truss", "no_truss", "no_truss", "no_truss"));
ok(r.rows.slice(1).map(x => x.cost.count).join() === "3,3,5", "costi Coriolis con tassa " + r.rows.slice(1).map(x => x.cost.count));
ok(P.applyTax(3, 6, 2) === 18, "tier 3: +100% per ogni starport in più");

// Effetti: contano solo le strutture finite; le merci solo quelle da costruire.
const p = plan("no_truss", "plutus");
p.sites[0].status = "done";
r = P.evaluate(p);
const cor = P.site("no_truss");
ok(r.effects.wealth === cor.effects.wealth, "effetti della sola Coriolis finita");
ok(r.cargoTotal === Object.values(P.site("plutus").cargo).reduce((a, b) => a + b, 0), "merci solo dell'outpost da costruire");

// Codice condivisibile.
const code = P.encode({ system: "Synuefai ZA-L d9-57", sites: [{ body: "A 5 à", type: "no_truss", status: "done" }, { body: "", type: "plutus" }] });
ok(code.startsWith("VWCOL1."), "prefisso del codice");
const back = P.decode("eccolo: " + code + " ciao");
ok(back.system === "Synuefai ZA-L d9-57" && back.sites.length === 2 && back.sites[0].body === "A 5 à" && back.sites[1].status === "plan", "andata e ritorno del codice");
for (const bad of ["", "VWCOL1.!!!!", "VWCOL1.e30", P.encode({ system: "X", sites: [{ body: "", type: "nonesiste" }] })]) {
  let threw = false;
  try { P.decode(bad); } catch (e) { threw = true; }
  ok(threw, "rifiuta " + bad.slice(0, 20));
}

// Consigli per obiettivo: solo strutture che alzano l'effetto, in ordine di resa per tonnellata.
const tonsOf = s => Object.values(s.cargo).reduce((a, b) => a + b, 0);
let adv = P.advise(plan("no_truss", "asteroid"), "sol", null);
ok(adv.picks.length > 0 && adv.picks.every(x => x.gain > 0 && x.tons > 0), "consigli: solo effetti positivi con merci note");
ok(adv.picks.every((x, i) => !i || adv.picks[i - 1].per100k >= x.per100k), "consigli in ordine di resa");
ok(adv.compare.length > 0 && adv.compare.every(c => c.worse.every(w => w.cls === c.best.cls && w.tier === c.best.tier && w.orbital === c.best.orbital
  && (w.effects.sol || 0) > 0 && w.effects.sol < c.best.effects.sol && tonsOf(w) >= tonsOf(c.best))), "confronti: stesso posto, di più con meno merci");
ok(adv.lowers.length === 1 && adv.lowers[0].site.key === "asteroid", "segnala nel piano chi abbassa l'effetto");
adv = P.advise(plan("no_truss"), "tech", false);
ok(adv.picks.every(x => x.site.orbital), "niente superficie senza corpi atterrabili");

// Strada al T3: aggiungendo i passi al piano e poi l'Orbis, nessuna struttura parte senza punti.
for (const [base, surf] of [[["no_truss"], null], [["no_truss"], false], [["plutus", "vesta"], null]]) {
  const path3 = P.pathToT3(plan(...base), "apollo", surf);
  ok(path3.need > 0 && path3.steps?.length, `strada al T3 trovata (${base}, ${surf})`);
  const full = plan(...base, ...path3.steps.flatMap(st => Array(st.n).fill(st.site.key)), "apollo");
  const fe = P.evaluate(full);
  ok(fe.short === 0, `strada al T3 senza punti mancanti (${base}, ${surf}): ${JSON.stringify(fe.points)}`);
  ok(path3.tons === path3.steps.reduce((a, st) => a + st.n * tonsOf(st.site), 0), "tonnellate della strada");
  if (surf === false) ok(path3.steps.every(st => st.site.orbital), "strada solo orbitale");
}
ok(P.pathToT3(plan(), "apollo", null).free, "a piano vuoto l'Orbis è il primary port");

console.log(`${passed} ok, ${failed} falliti`);
process.exit(failed ? 1 : 0);
