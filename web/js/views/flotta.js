"use strict";

// ============================================================================
// FLOTTA: registro navi, build e posizione
// ============================================================================
const SHIP_GLYPH = `<svg class="ship-glyph" viewBox="0 0 96 70" aria-hidden="true">
  <polygon class="hull" points="48,4 58,26 90,50 90,56 60,50 56,64 40,64 36,50 6,56 6,50 38,26"/>
  <polyline points="48,4 48,64" stroke="rgba(255,138,31,.35)" fill="none"/><polyline points="38,26 48,34 58,26" stroke="rgba(255,138,31,.5)" fill="none"/>
  <rect class="scan" x="0" y="4" width="96" height="2" fill="rgba(102,212,255,.7)"/></svg>`;

// Immagine della nave dal wiki (con la sagoma olografica se non c'è).
function shipPic(symbol, title = "") {
  return `<div class="ship-pic"><img data-keep src="/api/shipimg/${esc(symbol || "x")}" alt="" onerror="this.parentNode.classList.add('noimg')">
    ${SHIP_GLYPH}<i class="scan"></i>${title ? `<div class="ship-title">${title}</div>` : ""}</div>`;
}

function shipLocation(s) {
  if (s.current) return `<span class="ok" style="font-weight:700;letter-spacing:.1em">IN USO</span> · ${sys(s.system)}${s.station ? ` · ${esc(s.station)}` : ""}`;
  if (s.in_transit) return `<span class="gold" style="font-weight:700">IN TRANSITO</span> → ${sys(s.system)}${s.arrival_in ? ` · arrivo fra ${dur(s.arrival_in)}` : ""}`;
  return `${sys(s.system)}${s.station ? ` · ${esc(s.station)}` : ""}${s.system && S.location.system === s.system ? ' <span class="tag bio">qui</span>' : ""}`;
}
function modRow(m) {
  const cls = [m.size, m.rating].filter(Boolean).join("");
  return `<div class="mod"><span class="slot">${esc(m.slot_label)}</span><span title="${esc(m.name)}">${esc(T("module", m.name))}${m.mount ? ` <span class="sub">${esc(m.mount)}</span>` : ""}
    ${m.blueprint ? `<div class="eng" title="${esc(m.blueprint)}">${esc(T("blueprint", m.blueprint))}${pips(m.grade || 0)}${m.effect ? ` · ${esc(m.effect)}` : ""}</div>` : ""}</span><span class="cls">${esc(cls)}</span></div>`;
}
function shipCard(s) {
  const b = s.build, key = "ship-" + s.id;
  const groups = b ? [["core", "Moduli principali"], ["optional", "Interni opzionali"], ["hardpoints", "Armi"], ["utility", "Utility"]]
    .filter(([g]) => b.groups[g].length).map(([g, lbl]) => `<div class="mod-group"><h4>${lbl}</h4>${b.groups[g].map(modRow).join("")}</div>`).join("") : "";
  return `<section class="panel ship-card ${s.current ? "current" : ""}"><div class="hd"><h2>${s.current ? "Nave attiva" : "In deposito"}</h2>
      <span class="code">ID ${s.id}${b?.ident ? " · " + esc(b.ident) : ""}</span><div class="aside">${b?.engineered ? `<span class="holo-t">${b.engineered} ingegnerizzati</span>` : ""}</div></div>
    ${shipPic(s.symbol, `<div class="ship-name ${s.current ? "chroma" : ""}">${esc(s.name?.trim() || s.type)}</div>
      ${s.name?.trim() ? `<div class="sub" style="text-transform:uppercase;letter-spacing:.12em">${esc(s.type)}</div>` : ""}
      <div class="loc">${shipLocation(s)}</div>`)}
    <div class="ship-stats">
      <div class="kv"><span>Salto</span><span>${b?.jump_range ? b.jump_range.toFixed(1) + " al" : "—"}</span></div>
      <div class="kv"><span>Stiva</span><span>${b?.cargo != null ? b.cargo + " t" : "—"}</span></div>
      <div class="kv"><span>Valore</span><span>${short(s.value)}</span></div>
      <div class="kv"><span>Riscatto</span><span class="gold">${short(b?.rebuy)}</span></div>
    </div>
    ${b ? `<details class="build" data-key="${key}" ${UI.open.has(key) ? "open" : ""}><summary>Allestimento · ${b.groups.core.length + b.groups.optional.length + b.groups.hardpoints.length + b.groups.utility.length} moduli</summary>${groups}
      <div class="sub" style="margin-top:6px">Allestimento registrato ${ago(b.updated)}</div></details>`
      : '<div class="sub" style="padding:10px 16px 0">Allestimento non ancora registrato: sali su questa nave una volta con il gioco aperto.</div>'}
    <div class="ship-actions">${b ? `<button class="small" data-copy-loadout="${s.id}" title="Copia l'evento Loadout del journal di questa nave negli appunti">Copia la build (formato journal)</button>` : ""}
      ${!s.current && s.system ? todoBtn(`Recuperare ${s.name?.trim() || s.type} a ${s.system}`, s.system, "Nave") : ""}</div></section>`;
}

VIEWS.fleet = () => {
  const f = S.fleet;
  const metrics = { jump: ["Salto massimo", s => s.build?.jump_range, v => v.toFixed(1) + " al"],
    cargo: ["Stiva", s => s.build?.cargo, v => v + " t"], value: ["Valore", s => s.value, v => short(v)],
    rebuy: ["Riscatto", s => s.build?.rebuy, v => short(v)] };
  const [mLabel, mGet, mFmt] = metrics[UI.fleetMetric];
  const max = Math.max(1, ...f.map(s => mGet(s) || 0));
  const compare = [...f].sort((a, b) => (mGet(b) || 0) - (mGet(a) || 0)).map(s => {
    const v = mGet(s);
    return `<div class="compare-row"><span style="font-weight:700;text-transform:uppercase;letter-spacing:.06em" class="${s.current ? "hud-t" : ""}">${esc(s.name?.trim() || s.type)}</span>
      ${meter(v ? v / max * 100 : 0, s.current ? "" : "holo")}<span class="num" style="text-align:right">${v ? mFmt(v) : "—"}</span></div>`;
  }).join("");
  const total = f.reduce((a, s) => a + (s.value || 0), 0);
  const upd = S.fleet_updated;
  return `<section class="panel"><div class="bd" style="padding-top:18px"><div class="grid" style="grid-template-columns:minmax(0,1fr) minmax(0,1.3fr)">
      <div><div class="eyebrow">Registro flotta</div><div class="display chroma">${f.length} navi</div>
        <div class="kv-grid" style="margin-top:12px">
          <div class="kv"><span>Valore flotta</span><span class="gold">${short(total)} CR</span></div>
          <div class="kv"><span>Stiva totale</span><span>${num(f.reduce((a, s) => a + (s.build?.cargo || 0), 0))} t</span></div>
          <div class="kv"><span>Sistemi</span><span>${new Set(f.map(s => s.system).filter(Boolean)).size}</span></div>
        </div>
        <div class="sub" style="margin-top:12px">${upd ? `Posizioni aggiornate ${ago(upd.ts)} da ${esc(upd.station)}. Apri il cantiere in gioco per aggiornarle.` : "Apri il cantiere navale in gioco per aggiornare le posizioni."}</div></div>
      <div><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><span class="eyebrow">Confronto · ${mLabel}</span>
        <span>${Object.entries(metrics).map(([k, [l]]) => `<button class="small ${UI.fleetMetric === k ? "primary" : "ghost"}" data-metric="${k}">${l}</button>`).join(" ")}</span></div>${compare}</div>
    </div></div></section>
    <div class="cards" style="margin-top:18px;grid-template-columns:repeat(auto-fill,minmax(420px,1fr))">${f.map(shipCard).join("")}</div>`;
};

// Copia la build della nave (evento Loadout del journal, come registrato dal gioco).
document.addEventListener("click", e => {
  const t = e.target.closest?.("[data-copy-loadout]");
  if (!t) return;
  api("/api/buildshare/ship?id=" + encodeURIComponent(t.dataset.copyLoadout))
    .then(r => navigator.clipboard.writeText(r.json))
    .then(() => toast("Build copiata in formato journal"))
    .catch(err => toast(err.message));
});
