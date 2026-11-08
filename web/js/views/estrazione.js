"use strict";

// ============================================================================
// MINING
// ============================================================================
// Analisi degli asteroidi in diretta: S.mining (app/state.py, ultimi 15 ProspectedAsteroid).
// Core, sessione e storico: /api/mining/session (app/mining.py), chiesti ogni 5 secondi mentre la scheda è aperta.
// Fonti delle regole, dei campi del journal e dei consigli sul core mining: commento in testa a app/mining.py.
// Valore stimato della stiva: miglior prezzo di vendita conosciuto = prezzo del mercato dove sei attraccato
// (Market.json del gioco) oppure il migliore delle ricerche "Dove vendere" fatte da questa scheda (salvate qui sotto
// con la data). Se per una merce non c'è nessuno dei due: "valore stimato non disponibile".
const MN_TTL = 5000;
const MN_PRICES_KEY = "mining_prices";

function mnData(force = false) {
  const r = UI.res.miningSession;
  if (force || !r || (!r.busy && Date.now() - r.at > MN_TTL)) {
    const prev = r?.data;
    UI.res.miningSession = { busy: true, data: prev, at: Date.now() };
    api("/api/mining/session").then(data => { UI.res.miningSession = { data, at: Date.now() }; })
      .catch(e => { UI.res.miningSession = { data: prev, error: e.message, at: Date.now() }; })
      .finally(() => {
        if (currentTab() === "mining" && !document.activeElement?.matches("input:not([type=checkbox]), select, textarea")) renderView();
      });
  }
  return UI.res.miningSession;
}

function mnPrices() {
  try { return JSON.parse(localStorage.getItem(MN_PRICES_KEY) || "{}") || {}; } catch { return {}; }
}
function mnSavePrice(commodity, res) {
  // Scelta dell'interfaccia: si preferiscono i prezzi aggiornati negli ultimi 7 giorni (i dati vecchi possono essere
  // cambiati); se non ce ne sono si usa il migliore in assoluto, mostrando sempre quando è stato aggiornato.
  const ok = (res.results || []).filter(r => r.sell > 0).sort((a, b) => b.sell - a.sell);
  const fresh = ok.filter(r => r.updated && Date.now() - new Date(String(r.updated).replace(" ", "T").replace(/\+00$/, "Z")).getTime() < 7 * 864e5);
  const best = fresh[0] || ok[0];
  const all = mnPrices();
  if (best) all[commodity.toLowerCase()] = { sell: best.sell, station: best.station, system: best.system, distance: best.distance, updated: best.updated, ts: Date.now() };
  else delete all[commodity.toLowerCase()];
  localStorage.setItem(MN_PRICES_KEY, JSON.stringify(all));
}

const mnDate = iso => iso ? new Date(iso).toLocaleString(NUM_LOCALE, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
const mnKv = (label, value, cls = "", sub = "") => `<div class="kv"><span>${label}</span><span class="${cls}">${value}</span>${sub ? `<span class="sub">${sub}</span>` : ""}</div>`;
const mnContent = c => ({ High: "Alto", Medium: "Medio", Low: "Basso" }[c] || c || "—");
const mnRemaining = v => v == null ? "" : `<span class="sub">rimasto ${Number(v).toFixed(0)}%</span>`;

// Prezzo migliore conosciuto per una merce (nome inglese, come nelle ricerche).
function mnBestPrice(d, c) {
  const opts = [];
  const m = d.market?.prices?.[c.key];
  if (m) opts.push({ sell: m.sell, where: `${d.market.station} (dove sei attraccato)` });
  const p = mnPrices()[c.name.toLowerCase()];
  if (p) opts.push({ sell: p.sell, where: `${p.station}, ${p.system} · prezzo aggiornato ${ago(p.updated)}, cercato ${ago(p.ts / 1000)}` });
  return opts.sort((a, b) => b.sell - a.sell)[0] || null;
}

function mnEstimate(d) {
  const rows = d.cargo.map(c => ({ ...c, price: mnBestPrice(d, c) }));
  const known = rows.filter(r => r.price);
  return { rows, value: known.reduce((a, r) => a + r.count * r.price.sell, 0), missing: rows.filter(r => !r.price), any: known.length > 0 };
}

// --- Analisi degli asteroidi (in diretta) ------------------------------------
function mnRock(r) {
  const head = r.motherlode
    ? `<span class="gold">CORE: ${esc(T("commodity", r.motherlode))}</span>`
    : `<span>Contenuto</span> ${esc(T("value", r.content) || "—")}`;
  return `<div class="rock"><div class="rock-head"><span>${head}</span>
      <span class="mono muted">${r.remaining != null ? `rimasto ${Number(r.remaining).toFixed(0)}% · ` : ""}${r.ts.slice(11, 19)}</span></div>
      ${r.materials.map(x => `<div class="mat-line"><span>${esc(T("commodity", x.name))}</span>${meter(x.pct * 2, "holo")}<span class="num">${dec(x.pct)}%</span></div>`).join("")}</div>`;
}

function mnProspector() {
  const m = S.mining;
  const [last, ...prev] = m.prospected;
  if (!last) return '<div class="empty">Lancia un Prospector Limpet: la composizione degli asteroidi apparirà qui in tempo reale</div>';
  const big = last.motherlode ? `Core di ${T("commodity", last.motherlode)}` : T("value", last.content) || "—";
  const cls = last.motherlode ? "gold" : /High|Alto/i.test(last.content) ? "ok" : /Low|Basso/i.test(last.content) ? "muted" : "holo-t";
  return `<div class="eyebrow">Ultimo asteroide</div>
    <div class="display chroma ${cls}" style="font-size:34px">${esc(big)}</div>
    ${mnRock(last)}${prev.length ? `<div class="eyebrow" style="margin-top:12px">Precedenti</div>${prev.slice(0, 5).map(mnRock).join("")}` : ""}`;
}

// --- Core mining -------------------------------------------------------------
function mnCores(d) {
  const s = d.current;
  const cfg = d.config;
  const voiceRow = `<div class="todo-item" style="align-items:center"><div class="text">Annuncia i core a voce
      <div class="sub">${d.voice_enabled ? "Es. «Core di Void Opal!» appena il Prospector Limpet trova un core." : "La voce del copilota è spenta: accendila nella scheda Voce."}</div></div>
    <span class="sub" style="min-width:52px;text-align:right">${cfg.voice_core ? "ACCESO" : "SPENTO"}</span>
    <button class="switch ${cfg.voice_core ? "on" : ""}" data-mn-voice role="switch" aria-checked="${cfg.voice_core}" aria-label="Annuncia i core a voce"><span></span><span></span></button></div>`;
  let body;
  if (!s) body = '<div class="empty">Nessuna sessione di estrazione in corso.</div>';
  else {
    const list = s.cores.length ? `<table style="margin-top:10px"><thead><tr><th>Core</th><th>Contenuto</th><th class="num">Rimasto</th><th>Superficie</th><th class="num">Ora</th></tr></thead><tbody>
      ${s.cores.map(c => `<tr><td class="gold"><b>${esc(T("commodity", c.name))}</b></td><td>${esc(mnContent(c.content))}</td>
        <td class="num">${c.remaining != null ? Number(c.remaining).toFixed(0) + "%" : "—"}</td>
        <td class="sub">${c.materials.map(x => `${esc(T("commodity", x.name))} ${dec(x.pct)}%`).join(" · ") || "—"}</td>
        <td class="num mono">${esc((c.ts || "").slice(11, 16))}</td></tr>`).join("")}</tbody></table>`
      : '<div class="empty" style="margin-top:10px">Nessun core trovato in questa sessione.</div>';
    body = `<div class="kv-grid">
      ${mnKv("Asteroidi analizzati", num(s.prospected))}
      ${mnKv("Core trovati", num(s.cores_found), s.cores_found ? "gold" : "")}
      ${mnKv("Core crackati", num(s.cracked))}
      ${mnKv("Core ogni", s.cores_found ? dec(s.prospected / s.cores_found) : "—", "", "asteroidi")}</div>${list}`;
  }
  const open = UI.open.has("mn:tips");
  const tips = `<details class="build" data-key="mn:tips" ${open ? "open" : ""} style="margin:12px 0 0"><summary>Consigli per il core mining</summary>
    <ul class="sub" style="margin:6px 0 0 18px;padding:0">${d.tips.map(t => `<li style="margin:4px 0">${esc(t)}</li>`).join("")}</ul>
    <div class="sub" style="margin-top:8px">Si trovano nei core: ${d.core_materials.map(c => esc(T("commodity", c))).join(", ")}.</div></details>`;
  return voiceRow + `<div style="margin-top:10px">${body}</div>` + tips;
}

// --- Sessione e profitto all'ora ------------------------------------------------
function mnSession(d) {
  const s = d.current;
  if (!s) return '<div class="empty">Nessuna sessione di estrazione in corso. Le sessioni passate sono nello storico qui sotto.</div>';
  const est = mnEstimate(d);
  const hours = s.span / 3600;
  const estTotal = s.sold_cr + est.value;
  const estCrh = hours >= 5 / 60 && est.any ? Math.round(estTotal / hours) : null;
  const estLabel = !d.cargo.length ? "stiva vuota"
    : est.any ? `${cr(est.value)}${est.missing.length ? " (parziale)" : ""}` : "valore stimato non disponibile";
  const crhSub = s.crh != null ? "venduto / durata" : "nessuna vendita";
  const kv = `<div class="kv-grid">
      ${mnKv("Raffinato", `${num(s.tons)} t`, "big")}
      ${mnKv("Ritmo", s.tph != null ? s.tph.toLocaleString(NUM_LOCALE) : "—", "big holo-t", "t/ora (tempo attivo)")}
      ${mnKv("Venduto", s.sold_cr ? cr(s.sold_cr) : "—", "gold", s.sold_t ? `${num(s.sold_t)} t` : "")}
      ${mnKv("CR/ora reali", s.crh != null ? short(s.crh) : "—", "gold", crhSub)}
      ${mnKv("Valore in stiva", estLabel, est.any ? "gold" : "muted", est.any ? "stima" : "")}
      ${mnKv("CR/ora con la stiva", estCrh != null ? short(estCrh) : "—", "", estCrh != null ? (est.missing.length ? "stima parziale" : "stima") : "")}
      ${mnKv("Limpet usati", num(s.limpets_total), "", Object.entries(s.limpets).map(([k, v]) => `${esc(T("value", k))} ${v}`).join(" · "))}
      ${mnKv("Tempo attivo", dur(s.active), "", `<span>durata</span> ${dur(s.span)}`)}</div>`;

  // Tabella per merce: 4 colonne (la colonna di destra è stretta); la provenienza del prezzo va su una riga sotto.
  const inHold = Object.fromEntries(est.rows.map(r => [r.key, r]));
  const valCell = (h, name) => !h ? "—" : h.price ? `<span class="gold">${short(h.count * h.price.sell)} CR</span>`
    : `<button class="small ghost" data-mn-sell="${esc(name)}" title="Cerca il prezzo di vendita migliore">Cerca prezzo</button>`;
  const srcRow = h => !h ? "" : `<tr><td colspan="4" class="sub" style="padding-top:0">${h.price
    ? `${num(h.price.sell)} CR/t · ${esc(h.price.where)}` : "valore stimato non disponibile"}</td></tr>`;
  const rowsData = [
    ...s.commodities.map(c => ({ c, h: inHold[c.key], name: c.name, prev: false })),
    // Merce estratta in sessioni precedenti e ancora in stiva.
    ...est.rows.filter(r => !s.commodities.some(c => c.key === r.key)).map(h => ({ c: null, h, name: h.name, prev: true })),
  ];
  const rows = rowsData.map(({ c, h, name, prev }) => `<tr><td><b>${esc(T("commodity", name))}</b>
      <div class="sub">${prev ? "da una sessione precedente" : `raffinato ${num(c.refined)} t`}</div></td>
    <td class="num">${c?.sold_t ? `${num(c.sold_t)} t<div class="sub gold">${short(c.sold_cr)} CR</div>` : "—"}</td>
    <td class="num">${h ? num(h.count) + " t" : "—"}</td><td class="num">${valCell(h, name)}</td></tr>${srcRow(h)}`).join("");
  const table = rows ? `<table style="margin-top:12px"><thead><tr><th>Merce</th><th class="num">Venduto</th><th class="num">In stiva</th>
      <th class="num">Valore stimato</th></tr></thead><tbody>${rows}</tbody></table>` : "";
  const where = [...s.systems, ...s.bodies.filter(b => !s.systems.some(x => b.startsWith(x)))];
  return kv + table + `<div class="sub" style="margin-top:8px">Dal ${mnDate(s.first)}${where.length ? " · " + where.map(esc).join(", ") : ""}.
    Tonnellate all'ora sul tempo attivo (pause oltre 15 minuti escluse); CR/ora sulla durata dal primo evento di estrazione
    all'ultimo evento o vendita, viaggio per vendere compreso. Il valore in stiva è una stima con l'ultimo prezzo conosciuto.</div>`;
}

function mnHistory(d) {
  if (!d.history.length) return '<div class="empty">Nessuna sessione di estrazione precedente nei journal.</div>';
  return `<div style="max-height:360px;overflow:auto"><table><thead><tr><th>Inizio</th><th class="num">Raffinato</th><th class="num">Venduto</th>
    <th class="num">Core</th><th>Merci</th></tr></thead><tbody>
    ${d.history.map(s => `<tr><td class="sub">${mnDate(s.first)}<div>${dur(s.span)}</div></td>
      <td class="num">${num(s.tons)} t<div class="sub">${s.tph != null ? s.tph.toLocaleString(NUM_LOCALE) + " t/h" : "—"}</div></td>
      <td class="num gold">${s.sold_cr ? short(s.sold_cr) : "—"}<div class="sub">${s.crh != null ? short(s.crh) + " CR/h" : ""}</div></td>
      <td class="num">${s.prospected ? `${s.cores_found}/${s.prospected}` : "—"}</td>
      <td class="sub">${s.commodities.slice(0, 3).map(c => `${esc(T("commodity", c.name))} ${c.refined} t`).join(" · ") || "nessuna raffinazione"}
        <div>Limpet ${num(s.limpets_total)}${s.systems.length ? " · " + s.systems.map(esc).join(", ") : ""}</div></td></tr>`).join("")}
    </tbody></table></div><div class="sub" style="margin-top:6px">Core = core trovati / asteroidi analizzati. Durata e ritmi come per la sessione in corso.</div>`;
}

VIEWS.mining = () => {
  const r = mnData();
  const d = r.data;
  const m = S.mining;

  const hs = "hot";
  const hotForm = `<form class="form" data-form="${hs}" id="f-hot">
      <label>Minerale<input name="commodity" data-suggest="mining" autocomplete="off" value="${esc(fv(hs, "commodity", "Painite"))}"></label>
      ${inp(hs, "max_dist", "Entro (al)", "100", 'type="number" style="width:90px"')}
      <label>Hotspot min<select name="min_count">${[1, 2, 3, 4].map(n => opt(n, n, fv(hs, "min_count", 1))).join("")}</select></label>
      ${inp(hs, "reference", "Vicino a", "", `placeholder="${esc(S.location.system || "")}"`)}
      <button class="primary" type="submit">Trova hotspot</button></form>`;
  const hotRes = result("hot", d => `<div class="sub" style="margin:10px 0 6px">${d.results.length} anelli con hotspot di ${esc(T("commodity", d.commodity))} vicino a ${esc(d.reference?.name || "")}</div>
      <table><thead><tr><th>Anello</th><th>Sistema</th><th>Tipo</th><th>Hotspot</th><th>Riserva</th><th class="num">Dist.</th><th class="num">ls</th><th></th></tr></thead><tbody>
      ${d.results.map(r => `<tr><td><b>${esc(r.ring.replace(r.system, "").trim())}</b><div class="sub">${Object.entries(r.signals).map(([k, v]) => `${esc(T("commodity", k))} ${v}`).join(" · ")}</div></td>
        <td>${sys(r.system)}</td><td class="sub">${esc(T("value", r.type))}</td><td>${pips(r.count, Math.max(3, r.count))}</td><td class="sub">${esc(T("value", r.reserve) || "—")}</td>
        <td class="num">${ly(r.distance)}</td><td class="num">${num(r.dist_ls)}</td><td>${todoBtn(LANG.t(`Minare ${d.commodity} a ${r.ring}`), r.system, "Estrazione")}</td></tr>`).join("")
        || '<tr><td colspan="8"><div class="empty">Nessun hotspot trovato</div></td></tr>'}</tbody></table>`,
    "Cerca gli anelli con hotspot vicino a te (segnalazioni della comunità).");

  const sellBtns = STATIC.mining_commodities.slice(0, 12).map(c => `<button class="small" data-mn-sell="${esc(c)}">${esc(T("commodity", c))}</button>`).join("");
  const sellRes = result("mineSell", d => (d.commodity ? `<div class="eyebrow" style="margin-bottom:4px">${esc(T("commodity", d.commodity))}</div>` : "") + marketTable(d, "sell"),
    "Scegli un minerale per vedere chi lo paga di più entro 150 al. Il prezzo migliore viene usato per stimare il valore della stiva.");

  const wait = r.error ? `<div class="bad">⚠ ${esc(r.error)}</div>` : '<div class="loading">LETTURA DEI JOURNAL</div>';
  const cur = d?.current;
  return `<div class="grid"><div class="col">
      ${panel("Analisi degli asteroidi", mnProspector(), { cls: "holo", code: "PROSPECT", aside: m.prospected.length ? `${m.prospected.length} asteroidi analizzati` : "" })}
      ${panel("Core mining", d ? mnCores(d) : wait, { code: "CORE", aside: cur ? `${cur.cores_found} core su ${cur.prospected} asteroidi` : "" })}
      ${panel("Hotspot di estrazione", hotForm + hotRes, { code: "RING-SCAN" })}
    </div><div class="col">
      ${panel("Sessione di estrazione", d ? mnSession(d) : wait, { code: "REFINERY", aside: cur ? "<span>dalle</span> " + mnDate(cur.first) : "" })}
      ${panel("Dove vendere", `<div class="chips">${sellBtns}</div>${sellRes}`, { code: "SELL" })}
      ${panel("Sessioni precedenti", d ? mnHistory(d) : wait, { code: "HISTORY" })}
    </div></div>`;
};

document.addEventListener("click", e => {
  const sell = e.target.closest?.("[data-mn-sell]");
  if (sell) {
    const commodity = sell.dataset.mnSell;
    run("mineSell", async () => {
      const res = await api("/api/search", { mode: "sell", commodity, sort: "price", max_dist: 150, no_carriers: true });
      mnSavePrice(commodity, res);
      return { ...res, commodity };
    });
    return;
  }
  const v = e.target.closest?.("[data-mn-voice]");
  if (v) {
    const on = !UI.res.miningSession?.data?.config?.voice_core;
    api("/api/mining/config", { voice_core: on })
      .then(data => { UI.res.miningSession = { data, at: Date.now() }; toast(on ? "Annuncio dei core acceso" : "Annuncio dei core spento"); renderView(); })
      .catch(err => toast("Errore: " + err.message));
  }
});
