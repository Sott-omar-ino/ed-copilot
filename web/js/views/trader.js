"use strict";

// ============================================================================
// MATERIAL TRADER + AVVISI MATERIALI DELLA WISHLIST
// ============================================================================
// Il calcolo degli scambi è nel server (/api/trader/plan, app/engineering.py): regole del trader verificate
// sul codice di EDDiscovery e sugli scambi MaterialTrade del journal.

// --- Wishlist → server -------------------------------------------------------
// L'obiettivo di "Sblocchi e progetti" vive nel localStorage: il server lo riceve per gli avvisi a voce
// (all'avvio e ogni volta che cambia).
function engWishlist() {
  if (typeof BLUEPRINTS === "undefined") return [];
  const id = localStorage.getItem("ed_wishlist_selected");
  const bp = id && BLUEPRINTS.find(b => b.id === id);
  return bp ? [{ id: bp.id, name: bp.name, items: bp.items.map(i => ({ name: i.name, cat: i.cat, count: i.count })) }] : [];
}
function engWishlistSync(force = false) {
  const list = engWishlist();
  const sig = JSON.stringify(list);
  if (!force && UI.engWishSig === sig) return;
  UI.engWishSig = sig;
  // fetch diretto e non api(): api() con un corpo svuota i campi non salvati delle altre schede.
  fetch("/api/engineering/wishlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ items: list }) })
    .then(r => r.ok ? r.json() : Promise.reject(new Error(r.statusText)))
    .then(d => { UI.res.engStatus = { data: d }; renderView(); })
    .catch(() => { UI.engWishSig = null; });
}
function engStatusRefresh() {
  const sig = (S?.materials || []).map(m => m.count).join(",") + "|" + (S?.cargo || []).map(c => c.count).join(",");
  if (UI.engMatSig === sig) return;
  UI.engMatSig = sig;
  api("/api/engineering/status").then(d => { UI.res.engStatus = { data: d }; renderView(); }).catch(() => {});
}
// Piccolo badge per "Sblocchi e progetti": stato dell'obiettivo salvato visto dal server.
function engWishlistBadge() {
  engWishlistSync();
  engStatusRefresh();
  const it = UI.res.engStatus?.data?.items?.[0];
  if (!it) return '<span class="tag">avviso materiali: nessun obiettivo salvato</span>';
  return it.affordable
    ? `<span class="tag ok" title="Obiettivo salvato: ${esc(it.name)}">✔ obiettivo pronto</span>`
    : `<span class="tag" title="Obiettivo salvato: ${esc(it.name)}. Avviso nel ticker (e a voce, se attiva) quando hai tutto.">obiettivo: ${it.ready}/${it.total} · avviso attivo</span>`;
}
window.addEventListener("load", () => setTimeout(() => engWishlistSync(true), 1500));

// --- Calcolatore -------------------------------------------------------------
const TRADER_TYPES = { Raw: "Grezzi (Raw)", Manufactured: "Manufatti (Manufactured)", Encoded: "Codificati (Encoded)" };
const TRADER_DIR = { up: "sale di grado", down: "scende di grado", same: "stesso grado" };

function traderMaterials() {
  if (!UI.res.traderMats) run("traderMats", () => api("/api/trader/materials"));
  return UI.res.traderMats?.data?.materials || [];
}
const traderCount = key => (S.materials.find(m => m.name === key) || {}).count || 0;

function traderPlan() {
  const f = UI.forms.trader || {};
  if (!f.material) return;
  const q = new URLSearchParams({ material: f.material, qty: f.qty || 1, keep: f.keep === false ? 0 : 1 });
  run("traderPlan", () => api("/api/trader/plan?" + q));
}

function traderTradeLine(o, target) {
  const f = o.from;
  return `<b>${num(o.give)}× ${esc(f.name)}</b> <span class="sub">G${f.grade} · ${esc(f.group)}</span>
    → <b class="gold">${num(o.get)}× ${esc(target.name)}</b>
    <div class="sub"><span>${num(o.trades)} ${o.trades === 1 ? "scambio" : "scambi"} da ${o.offer}:${o.receive}</span>${o.cross != null ? ` · <span>${o.cross ? "altra categoria" : "stessa categoria"}</span>` : ""}${o.direction ? `, <span>${TRADER_DIR[o.direction]}</span>` : ""}
    · <span>ne hai ${num(f.count)}</span>${f.reserved ? `, <span>${num(f.reserved)} tenuti per la wishlist</span>` : ""}</div>`;
}

function traderResult(p) {
  const t = p.target;
  const head = `<div class="kv-grid" style="margin-bottom:10px">
    <div class="kv"><span>Obiettivo</span><span>${num(p.qty)}× ${esc(t.name)}</span></div>
    <div class="kv"><span>Ne hai</span><span>${num(t.count)} / ${num(t.cap)}</span></div>
    <div class="kv"><span>Grado</span><span>G${t.grade} · ${esc(t.group)}</span></div>
    <div class="kv"><span>Trader</span><span>${esc(TRADER_TYPES[p.trader])}</span></div></div>
    ${p.over_cap ? `<div class="warnbox" style="margin-bottom:10px">⚠ Superi il limite di ${num(t.cap)} per questo grado: l'eccedenza va persa.</div>` : ""}`;
  let main;
  if (p.best) {
    main = `<div style="border-left:3px solid var(--gold);padding:6px 10px;background:rgba(255,138,31,.06)">
      <div class="eyebrow">Scambio consigliato</div>${traderTradeLine(p.best, t)}
      <div style="margin-top:6px">${todoBtn(`Material trader: ${p.best.give}× ${p.best.from.name} → ${p.best.get}× ${t.name}`, "", "Materiali")}</div></div>`;
  } else if (p.combo.length) {
    main = `<div class="warnbox">Nessun materiale da solo basta: combinazione possibile${p.combo_short ? `, ma mancano ancora ${num(p.combo_short)} unità` : ""}.</div>
      ${p.combo.map(o => `<div style="margin-top:6px">${traderTradeLine(o, t)}</div>`).join("")}
      <div style="margin-top:6px">${todoBtn(`Material trader: ${p.combo.map(o => `${o.give}× ${o.from.name}`).join(" + ")} → ${t.name}`, "", "Materiali")}</div>`;
  } else {
    main = `<div class="warnbox">Non hai abbastanza materiali ${esc(TRADER_TYPES[p.trader])} per questo scambio${p.keep_wishlist ? " (senza toccare quelli della wishlist)" : ""}.</div>`;
  }
  const alts = p.options.filter(o => o !== p.best && !(p.best && o.from.key === p.best.from.key));
  const table = alts.length ? `<table style="margin-top:12px"><thead><tr><th>Dai</th><th class="num">Rapporto</th><th class="num">Ne servono</th><th class="num">Disponibili</th><th class="num">Ottieni al massimo</th></tr></thead><tbody>
    ${alts.map(o => `<tr class="${o.enough ? "" : "muted"}"><td>${esc(o.from.name)} <span class="sub">G${o.from.grade} · ${esc(o.from.group)}</span></td>
      <td class="num mono">${o.offer}:${o.receive}</td><td class="num">${num(o.give)}</td><td class="num">${num(o.from.available)}</td><td class="num">${num(o.max_get)}</td></tr>`).join("")}
    </tbody></table>` : "";
  return head + main + table;
}

function traderNearPanel(type) {
  const r = UI.res.traderNear;
  const body = !r ? `<div class="empty">Cerca il Material Trader ${esc(TRADER_TYPES[type] || "")} più vicino a ${esc(S.location.system || "Sol")}.</div>`
    : r.busy ? '<div class="loading">RICERCA IN CORSO</div>'
    : r.error ? `<div class="bad">⚠ ${esc(r.error)}</div>`
    : `<table><thead><tr><th>Stazione</th><th class="num">Distanza</th><th>Pad</th><th></th></tr></thead><tbody>
      ${(r.data.results || []).slice(0, 6).map(x => `<tr><td><b>${esc(x.station)}</b><div class="sub">${sys(x.system)} · ${num(x.dist_ls)} ls</div></td>
        <td class="num">${ly(x.distance)}</td><td>${x.large_pad ? "L" : x.medium_pad ? "M" : "S"}${x.planetary ? ' <span class="sub">planetaria</span>' : ""}</td>
        <td>${todoBtn(`Material trader ${x.material_trader || type} a ${x.station}`, x.system, "Materiali")}</td></tr>`).join("") || '<tr><td colspan="4"><div class="empty">Nessun trader trovato</div></td></tr>'}
      </tbody></table><div class="sub" style="margin-top:6px">Fleet Carrier esclusi. Dati inviati dai giocatori: possono essere non aggiornati.</div>`;
  return panel("Material trader vicino", `<div style="margin-bottom:10px"><button class="small primary" data-trader-near="${esc(type)}">◆ Cerca trader ${esc(TRADER_TYPES[type] || type)}</button></div>${body}`,
    { code: "NEAREST", aside: r?.type ? esc(TRADER_TYPES[r.type]) : "" });
}

VIEWS.trader = () => {
  const mats = traderMaterials();
  engWishlistSync();
  engStatusRefresh();
  const f = (UI.forms.trader ||= {});
  const wish = UI.res.engStatus?.data?.items || [];
  const missing = wish.flatMap(it => it.missing.filter(r => r.tradeable).map(r => ({ ...r, bp: it.name })));
  if (!f.material && missing[0]) { f.material = missing[0].key; f.qty = missing[0].missing; }
  UI.traderT0 ||= Date.now();  // senza wishlist dopo qualche secondo: primo materiale dell'elenco
  if (!f.material && mats[0] && (UI.res.engStatus?.data || Date.now() - UI.traderT0 > 5000)) f.material = mats[0].key;

  // Ricalcolo quando cambiano i materiali (nuove raccolte o scambi fatti).
  const sig = `${f.material}:${f.qty}:${f.keep}|` + S.materials.map(m => m.count).join(",");
  if (mats.length && UI.traderSig !== sig) { UI.traderSig = sig; traderPlan(); }

  const cur = mats.find(m => m.key === f.material);
  const options = Object.entries(TRADER_TYPES).map(([type, label]) => `<optgroup label="${esc(t(label))}">${mats.filter(m => m.type === type)
    .map(m => opt(m.key, `G${m.grade} ${m.name} (${traderCount(m.key)})`, f.material)).join("")}</optgroup>`).join("");
  const chips = missing.length ? `<div class="chips" style="margin-top:10px">${missing.map(r =>
    `<button class="small ${r.key === f.material ? "primary" : "ghost"}" data-trader-pick="${esc(r.key)}" data-qty="${r.missing}" title="Manca per ${esc(r.bp)}">${num(r.missing)}× ${esc(r.name)}</button>`).join("")}</div>
    <div class="sub">Materiali che mancano all'obiettivo salvato in "Sblocchi e progetti".</div>` : "";
  const form = `<form class="form" data-form="trader" id="f-trader">
    <label class="grow-1">Materiale da ottenere<select name="material" id="trader-material">${options}</select></label>
    <label>Quantità<input name="qty" id="trader-qty" type="number" min="1" max="1000" value="${esc(f.qty ?? 1)}" style="width:90px"></label>
    <label class="check"><input type="checkbox" name="keep" id="trader-keep" ${f.keep === false ? "" : "checked"}> Non cedere i materiali della wishlist</label>
    <button class="primary" type="submit">Calcola</button></form>${chips}`;

  const rules = `<table><tbody>
    <tr><td>Stessa categoria, sali di N gradi</td><td class="num mono">6<sup>N</sup> : 1</td></tr>
    <tr><td>Stessa categoria, scendi di N gradi</td><td class="num mono">1 : 3<sup>N</sup></td></tr>
    <tr><td>Altra categoria, stesso grado</td><td class="num mono">6 : 1</td></tr>
    <tr><td>Altra categoria, sali di N gradi</td><td class="num mono">6<sup>N+1</sup> : 1</td></tr>
    <tr><td>Altra categoria, scendi di 1 / 2 / 3 gradi</td><td class="num mono">2:1 · 2:3 · 2:9</td></tr></tbody></table>
    <div class="sub" style="margin-top:6px">Solo dentro lo stesso tipo: grezzi, manufatti e codificati hanno trader diversi.
    Il calcolatore sceglie cosa cedere preferendo gradi bassi e materiali vicini al limite. Materiali Guardian e Thargoid esclusi.</div>`;

  return `<div class="grid"><div class="col">
      ${panel("Calcolatore scambi", form, { code: "MAT-TRADER", aside: cur ? esc(TRADER_TYPES[cur.type]) : "" })}
      <div style="margin-top:18px">${panel("Risultato", result("traderPlan", traderResult, "Scegli un materiale."), { code: "TRADE-PLAN" })}</div>
    </div><div class="col">
      ${traderNearPanel(cur?.type || "Raw")}
      <div style="margin-top:18px">${panel("Regole del trader", rules, { code: "RATES" })}</div>
    </div></div>`;
};

document.addEventListener("change", e => {
  const t = e.target;
  if (!t.closest?.("#f-trader")) return;
  const f = (UI.forms.trader ||= {});
  if (t.name === "keep") f.keep = t.checked;
  else if (t.name === "material") { f.material = t.value; UI.res.traderNear = null; }
  else if (t.name === "qty") f.qty = t.value;
  renderView();
});
document.addEventListener("submit", e => {
  if (e.target.dataset?.form !== "trader") return;
  e.preventDefault();
  const f = (UI.forms.trader ||= {});
  f.qty = $("trader-qty")?.value || f.qty;
  UI.dirty.delete("trader-qty");
  traderPlan();
});
document.addEventListener("click", e => {
  const pick = e.target.closest("[data-trader-pick]");
  if (pick) {
    const f = (UI.forms.trader ||= {});
    f.material = pick.dataset.traderPick;
    f.qty = pick.dataset.qty;
    UI.dirty.delete("trader-qty");
    UI.res.traderNear = null;
    renderView();
    return;
  }
  const near = e.target.closest("[data-trader-near]");
  if (near) {
    const type = near.dataset.traderNear;
    UI.res.traderNear = { busy: true, type };
    renderView();
    api("/api/search", { mode: "service", service: "Material Trader", trader: type, reference: S.location.system || "Sol" })
      .then(d => { UI.res.traderNear = { data: d, type }; })
      .catch(err => { UI.res.traderNear = { error: err.message, type }; })
      .finally(() => renderView());
  }
});
