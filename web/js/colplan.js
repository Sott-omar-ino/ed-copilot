"use strict";
// Calcoli del piano di colonizzazione di un sistema (scheda Colonizzazione > Piano del sistema).
// Le regole vengono da Raven Colonial (https://github.com/njthomson/RavenColonialWeb, GPL-3.0, commit 01b89a9,
// src/system-model2.ts: sumTierPoints, applyTax, sumSystemEffects; src/views/SystemView2/BuildOrder.tsx):
// - la prima struttura del piano è il primary port e non costa construction points;
// - ogni altra struttura costa needs[1] punti del tier needs[0] e, finita, ne dà gives[1] del tier gives[0];
// - dal terzo starport di tier 2/3 oltre al primary il costo cresce: +100% del costo base per ogni starport in più se è
//   di tier 3, +75% (arrotondato per difetto) se è di tier 2 (Raven Colonial: applyTax, taxCount che parte da -2);
// - gli effetti sul sistema (popolazione, security, wealth, ...) sono la somma degli effetti delle strutture finite.
// I dati delle strutture arrivano da /api/colonisation/site_data (app/colonisation_data.py, stesso commit) in
// window.COLONISATION_DATA: non sono inclusi nell'app per via della licenza GPL-3.0.
(function (root) {
  const EFFECTS = ["pop", "mpop", "sec", "wealth", "tech", "sol", "dev"];
  const STATUSES = ["plan", "build", "done"];
  const CODE_PREFIX = "VWCOL1.";

  const sites = () => (root.COLONISATION_DATA && root.COLONISATION_DATA.sites) || [];
  const site = key => sites().find(s => s.key === key || s.sub.includes(key)) || null;

  function applyTax(tier, cost, taxCount) {
    if (taxCount <= 0) return cost;
    return tier === 3 ? cost + cost * taxCount : cost + Math.trunc(cost * 0.75 * taxCount);
  }

  // plan.sites = [{body, type, status}] in ordine di costruzione. Ritorna ogni riga con costo reale e saldo, più i totali.
  function evaluate(plan) {
    const rows = [], bal = { 2: 0, 3: 0 }, effects = {}, economies = {}, cargo = {};
    let taxCount = -2;
    (plan.sites || []).forEach((p, i) => {
      const t = site(p.type);
      const row = { ...p, index: i, site: t, primary: i === 0, cost: null, short: false };
      if (t) {
        if (i > 0 && t.needs[1] > 0 && t.needs[0] > 1) {
          let n = t.needs[1];
          if (t.cls === "starport" && t.tier > 1) n = applyTax(t.tier, n, ++taxCount);
          row.cost = { tier: t.needs[0], count: n };
          // punti disponibili prima di avviarla: quelli dati dalle strutture precedenti meno i costi già spesi
          row.short = bal[t.needs[0]] < n;
          bal[t.needs[0]] -= n;
        }
        if (t.gives[1] > 0 && t.gives[0] > 1) bal[t.gives[0]] += t.gives[1];
        if (p.status === "done") {
          for (const k of EFFECTS) if (t.effects[k]) effects[k] = (effects[k] || 0) + t.effects[k];
          if (t.inf && t.inf !== "none") economies[t.inf] = (economies[t.inf] || 0) + 1;
        } else {
          for (const [name, q] of Object.entries(t.cargo || {})) cargo[name] = (cargo[name] || 0) + q;
        }
      }
      row.balance = { ...bal };
      rows.push(row);
    });
    for (const k of Object.keys(effects)) effects[k] = Math.round(effects[k] * 1000) / 1000;
    const planned = {};
    for (const r of rows) if (r.site) for (const k of EFFECTS) if (r.site.effects[k]) planned[k] = (planned[k] || 0) + r.site.effects[k];
    for (const k of Object.keys(planned)) planned[k] = Math.round(planned[k] * 1000) / 1000;
    return { rows, points: bal, effects, planned, economies, cargo,
      cargoTotal: Object.values(cargo).reduce((a, b) => a + b, 0), short: rows.filter(r => r.short).length };
  }

  // --- consigli: solo conti sui dati di Raven Colonial (effetti, punti, merci medie), nessun peso inventato ---
  const tonsOf = s => Object.values(s.cargo || {}).reduce((a, b) => a + b, 0);
  // surfaceOk: false se il sistema non ha corpi atterrabili (allora niente strutture di superficie), null se non si sa.
  const fits = (s, surfaceOk) => s.orbital || surfaceOk !== false;
  const nextRow = (plan, key) => evaluate({ sites: [...(plan.sites || []), { type: key, status: "plan" }] }).rows.slice(-1)[0];

  // Strutture che alzano l'effetto `goal`, dalla più conveniente: punti di effetto ogni 100.000 t di merci da portare.
  // Strutture senza merci note (cargo vuoto nei dati) restano fuori: non si può dire quanto costano.
  function advise(plan, goal, surfaceOk) {
    const picks = [];
    for (const s of sites()) {
      const gain = s.effects[goal] || 0, tons = tonsOf(s);
      if (gain <= 0 || !tons || !fits(s, surfaceOk)) continue;
      const row = nextRow(plan, s.key);
      picks.push({ site: s, gain, tons, per100k: gain * 100000 / tons, cost: row.cost, short: row.short, primary: row.primary });
    }
    picks.sort((a, b) => b.per100k - a.per100k || a.tons - b.tons);
    // "Meglio X che Y": stesso tipo di posto (classe, tier, orbitale o superficie), Y alza anche lui l'effetto ma X dà di
    // più e non chiede più merci.
    const groups = {};
    for (const s of sites()) {
      if (!tonsOf(s) || !fits(s, surfaceOk)) continue;
      (groups[`${s.cls}|${s.tier}|${s.orbital}`] ||= []).push(s);
    }
    const compare = [];
    for (const list of Object.values(groups)) {
      const best = list.slice().sort((a, b) => (b.effects[goal] || 0) - (a.effects[goal] || 0) || tonsOf(a) - tonsOf(b))[0];
      const gain = best.effects[goal] || 0;
      const worse = list.filter(s => (s.effects[goal] || 0) > 0 && (s.effects[goal] || 0) < gain && tonsOf(s) >= tonsOf(best))
        .sort((a, b) => (a.effects[goal] || 0) - (b.effects[goal] || 0));
      if (gain > 0 && worse.length) compare.push({ best, worse });
    }
    compare.sort((a, b) => (b.best.effects[goal] || 0) - (a.best.effects[goal] || 0));
    const lowers = (plan.sites || []).map((x, i) => ({ index: i, site: site(x.type) }))
      .filter(x => x.site && (x.site.effects[goal] || 0) < 0);
    return { picks, compare, lowers };
  }

  // Strada con meno merci per avere i punti T3 di uno starport T3 aggiunto in fondo al piano. Fonti di punti T3: strutture
  // non starport che costano punti T2 e ne danno T3 (gli starport T2 alzano la tassa e danno 1 solo punto); fonti di punti T2:
  // strutture che non costano punti. Fuori quelle con prerequisiti e quelle senza merci note.
  function pathToT3(plan, targetKey, surfaceOk) {
    const target = site(targetKey);
    const last = nextRow(plan, target.key);
    if (!last.cost) return { target, free: true, steps: [], tons: 0, need: 0 };
    const before = evaluate(plan).points;
    const need = last.cost.count - before[3];
    if (need <= 0) return { target, cost: last.cost, steps: [], tons: 0, need: 0 };
    const usable = s => s.cls !== "starport" && !s.preReq && tonsOf(s) > 0 && fits(s, surfaceOk);
    const cheapest = list => list.sort((a, b) => tonsOf(a) - tonsOf(b))[0] || null;
    const t2 = cheapest(sites().filter(s => usable(s) && s.needs[1] === 0 && s.gives[0] === 2 && s.gives[1] > 0));
    const by = g => cheapest(sites().filter(s => usable(s) && s.needs[0] === 2 && s.needs[1] > 0 && s.gives[0] === 3 && s.gives[1] === g));
    const g2 = by(2), g1 = by(1);
    let best = null;
    for (let a = 0; a <= Math.ceil(need / 2); a++) {
      if (a && !g2) break;
      const b = Math.max(0, need - 2 * a);
      if (b && !g1) continue;
      const pts2 = (a ? a * g2.needs[1] : 0) + (b ? b * g1.needs[1] : 0);
      const extra = Math.max(0, pts2 - before[2]);
      if (extra && !t2) continue;
      const tons = (a ? a * tonsOf(g2) : 0) + (b ? b * tonsOf(g1) : 0) + (extra ? Math.ceil(extra / t2.gives[1]) * tonsOf(t2) : 0);
      if (!best || tons < best.tons) {
        best = { tons, steps: [extra && { site: t2, n: Math.ceil(extra / t2.gives[1]) }, a && { site: g2, n: a }, b && { site: g1, n: b }].filter(Boolean) };
      }
    }
    return best ? { target, cost: last.cost, need, ...best } : { target, cost: last.cost, need, steps: null, tons: 0 };
  }

  // Codice da copiare: prefisso + base64 URL-safe di JSON {s: sistema, x: [[corpo, tipo, stato], ...]}.
  function b64enc(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function b64dec(str) {
    const bin = atob(str.replace(/-/g, "+").replace(/_/g, "/"));
    return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
  }
  function encode(plan) {
    return CODE_PREFIX + b64enc(JSON.stringify({ s: plan.system, x: (plan.sites || []).map(p => [p.body || "", p.type, p.status || "plan"]) }));
  }
  // Non si esegue nulla: solo JSON, con limiti e controllo dei tipi.
  function decode(text) {
    const m = String(text || "").trim().match(/VWCOL1\.([A-Za-z0-9_-]{4,20000})/);
    if (!m) throw new Error("codice non riconosciuto");
    let o;
    try { o = JSON.parse(b64dec(m[1])); } catch (e) { throw new Error("codice rovinato"); }
    if (!o || typeof o.s !== "string" || !o.s.trim() || o.s.length > 80 || !Array.isArray(o.x) || o.x.length > 100) throw new Error("codice non valido");
    const out = [];
    for (const r of o.x) {
      if (!Array.isArray(r) || typeof r[0] !== "string" || r[0].length > 80 || !site(r[1])) throw new Error("struttura non valida nel codice");
      out.push({ body: r[0], type: site(r[1]).key, status: STATUSES.includes(r[2]) ? r[2] : "plan" });
    }
    return { system: o.s.trim(), sites: out };
  }

  const api = { EFFECTS, STATUSES, sites, site, applyTax, evaluate, encode, decode, advise, pathToT3 };
  root.ColPlan = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
