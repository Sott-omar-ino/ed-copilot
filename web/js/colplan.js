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

  const api = { EFFECTS, STATUSES, sites, site, applyTax, evaluate, encode, decode };
  root.ColPlan = api;
  if (typeof module !== "undefined") module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
