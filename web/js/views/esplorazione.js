"use strict";

// ============================================================================
// ESPLORAZIONE: valore dei corpi del sistema e cosa conviene mappare
// ============================================================================
// I dati arrivano da /api/exploration (formula di MattG, vedi app/exploration.py) e restano in UI.res.explo;
// si aggiornano ogni 3 secondi mentre la scheda è aperta.
const EXPLO_REFRESH_MS = 3000;

function exploLoad(force = false) {
  const r = UI.res.explo;
  if (UI.exploLoading || (!force && r && Date.now() - (r.t || 0) < EXPLO_REFRESH_MS)) return;
  UI.exploLoading = true;
  api("/api/exploration")
    .then(data => { UI.res.explo = { data, t: Date.now() }; })
    .catch(e => { UI.res.explo = { error: e.message, t: Date.now() }; })
    .finally(() => {
      UI.exploLoading = false;
      if (currentTab() === "exploration" && !document.activeElement?.matches("input:not([type=checkbox]):not([type=range]), select, textarea")) renderView();
    });
}

const exploType = b => b.kind === "star" ? (typeof starName === "function" ? starName(b.cls) : b.cls)
  : b.kind === "planet" ? T("body", b.cls) : "Non ancora scansionato";
const exploSwitch = (key, on, label) =>
  `<button class="switch ${on ? "on" : ""}" data-explo-cfg="${key}" role="switch" aria-checked="${on}" aria-label="${esc(label)}"><span></span><span></span></button>`;

function exploRows(d) {
  if (!d.bodies.length) return '<tr><td colspan="8"><div class="empty">Nessun corpo scansionato: fai l\'honk e usa l\'FSS</div></td></tr>';
  return d.bodies.map(b => {
    const worth = !!b.worth;
    const state = !b.scanned ? '<span class="muted">—</span>'
      : b.mapped_by_me ? `<span class="tag mapped">mappato${b.efficient ? " ✓" : ""}</span>`
      : b.kind === "planet" ? `<span class="tag">scansionato</span>${b.was_mapped ? '<div class="sub">già mappato da altri</div>' : ""}`
      : '<span class="tag">scansionato</span>';
    const sig = [b.bio ? `<span class="tag bio">bio ${b.bio}</span>` : "", b.geo ? `<span class="tag geo">geo ${b.geo}</span>` : ""].join("");
    const first = b.first_discovery ? '<span class="tag new">primo a scoprirlo</span>'
      : b.first_map && !b.mapped_by_me ? '<span class="tag new">primo a mapparlo</span>' : "";
    return `<tr class="${worth ? "hot" : ""}"><td><b>${esc(b.short || b.name || "?")}</b>${worth ? `<div class="sub gold" style="white-space:nowrap">▲ ${esc(b.worth)}</div>` : ""}</td>
      <td>${esc(exploType(b))}${b.landable ? '<div class="sub">atterrabile</div>' : ""}</td>
      <td class="num">${b.dist != null ? num(b.dist) : "—"}</td>
      <td>${b.terraformable ? '<span class="tag tf">sì</span>' : ""}</td>
      <td>${state}</td>
      <td class="num">${b.value_now != null ? short(b.value_now) : "—"}</td>
      <td class="num ${worth ? "gold" : "muted"}">${b.value_mapped != null && !b.mapped_by_me ? short(b.value_mapped) : ""}</td>
      <td>${first}${sig}</td></tr>`;
  }).join("");
}

VIEWS.exploration = () => {
  exploLoad();
  const r = UI.res.explo;
  if (!r) return panel("Esplorazione", '<div class="loading">LETTURA DEI DATI DI SCANSIONE</div>');
  if (r.error && !r.data) return panel("Esplorazione", `<div class="bad">⚠ ${esc(r.error)}</div>`);
  const d = r.data, sy = d.system, tot = d.totals, cfg = d.config, un = d.unsold;
  const worth = d.bodies.filter(b => b.worth);
  const pct = sy.body_count ? Math.min(100, sy.scanned / sy.body_count * 100) : 0;

  const summary = `<div class="kv-grid">
      <div class="kv"><span>Sistema</span><span>${sys(sy.name)}</span></div>
      <div class="kv"><span>Corpi scansionati</span><span class="mono">${sy.body_count != null ? `${sy.scanned}/${sy.body_count}` : `${sy.scanned} · honk non fatto`}</span>
        ${sy.body_count != null ? seg(pct, 16, sy.all_found ? "full" : "") : ""}</div>
      <div class="kv"><span>Valore ora</span><span class="gold mono">${short(tot.now)} CR</span></div>
      <div class="kv"><span>Se mappi tutto</span><span class="gold mono">${short(tot.potential)} CR</span></div>
      <div class="kv"><span>Da mappare</span><span class="big ${worth.length ? "gold" : ""}">${worth.length}</span><span class="sub">${worth.length ? "~" + short(tot.worth_value) + " CR" : ""}</span></div>
    </div>
    ${tot.virgin ? `<div class="sub" style="margin-top:8px">Sistema mai scoperto: bonus di sistema ${tot.bonus_fss ? `scansione completa <span class="gold">${short(tot.bonus_fss)}</span>` : "per la scansione completa (1.000 CR per corpo) quando trovi tutti i corpi"}${tot.bonus_map ? ` · mappatura completa <span class="gold">${short(tot.bonus_map)}</span> se mappi tutti i pianeti` : ""}.</div>` : ""}`;

  const table = `<table><thead><tr><th>Corpo</th><th>Tipo</th><th class="num">Dist. ls</th><th>Terraform.</th><th>Stato</th>
      <th class="num">Valore ora</th><th class="num">Se mappato</th><th>Scoperta · segnali</th></tr></thead><tbody>${exploRows(d)}</tbody></table>
    <div class="sub" style="margin-top:8px">Stime con la formula della community (MattG), con il bonus Odyssey e la mappatura efficiente; il valore reale può differire di poco.
      "Primo a scoprirlo" vale ×2,6. In evidenza i corpi da mappare: Earth-like, Water world, Ammonia world, terraformabili e quelli che valgono almeno ${short(cfg.min_map_value)} CR mappati.</div>`;

  const unsold = `<div class="kv-grid">
      <div class="kv"><span>Dati cartografici</span><span class="gold mono">${short(un.carto)} CR</span><span class="sub">${un.carto_systems} sistemi</span></div>
      <div class="kv"><span>Dati biologici</span><span class="gold mono">${short(un.bio)} CR</span><span class="sub">${un.bio_samples} campioni</span></div>
      <div class="kv"><span>Totale da vendere</span><span class="gold big">${short(un.carto + un.bio)}</span></div>
    </div><div class="sub" style="margin-top:6px">Vendili da Universal Cartographics (dati cartografici) e Vista Genomics (biologici). Se la nave viene distrutta si perdono.</div>`;

  const settings = `<div class="todo-item" style="align-items:center"><div class="text">Annuncio a voce<div class="sub">Dopo honk e FSS dice una volta sola se ci sono corpi da mappare</div></div>${exploSwitch("voice", cfg.voice, "Annuncio a voce")}</div>
    <div class="todo-item" style="align-items:center"><div class="text">Nel ticker<div class="sub">Scrive l'elenco dei corpi da mappare nel registro eventi</div></div>${exploSwitch("feed", cfg.feed, "Annuncio nel ticker")}</div>
    <div class="todo-item" style="align-items:center"><div class="text">Conta i terraformabili<div class="sub">Considera da mappare ogni terraformabile, anche sotto la soglia</div></div>${exploSwitch("announce_terraformable", cfg.announce_terraformable, "Conta i terraformabili")}</div>
    <form class="form" data-form="explo-cfg" id="f-explo-cfg" style="margin-top:8px">
      <label>Soglia "da mappare" (CR se mappato)<input id="explo-min" name="min_map_value" type="number" min="0" step="50000" value="${esc(cfg.min_map_value)}" style="width:150px"></label>
      <button class="small" type="submit">Salva</button></form>`;

  return `<div class="grid"><div class="col">
      ${panel("Valore del sistema", summary, { cls: "holo", code: "UC-VALUE", aside: sy.all_found ? '<span class="ok">tutti i corpi trovati</span>' : "" })}
      <div style="margin-top:18px">${panel("Dati non venduti", unsold, { code: "UNSOLD" })}</div>
    </div><div class="col">${panel("Avvisi", settings, { code: "VOX" })}</div></div>
    <div style="margin-top:18px">${panel("Corpi per valore", `<div style="overflow-x:auto">${table}</div>`, { code: "SYS-SCAN", aside: `${d.bodies.length} corpi` })}</div>`;
};

document.addEventListener("click", e => {
  const t = e.target.closest("[data-explo-cfg]");
  if (!t) return;
  const cfg = UI.res.explo?.data?.config;
  if (!cfg) return;
  const key = t.dataset.exploCfg;
  api("/api/exploration/config", { [key]: !cfg[key] })
    .then(data => { UI.res.explo = { data, t: Date.now() }; toast("Impostazione salvata"); })
    .catch(err => toast(err.message))
    .finally(renderView);
});

document.addEventListener("submit", e => {
  if (e.target.dataset?.form !== "explo-cfg") return;
  e.preventDefault();
  e.stopImmediatePropagation();
  const v = parseInt(new FormData(e.target).get("min_map_value"), 10);
  if (!(v >= 0)) { toast("Indica un valore valido"); return; }
  api("/api/exploration/config", { min_map_value: v })
    .then(data => { UI.res.explo = { data, t: Date.now() }; UI.dirty.delete("explo-min"); toast("Soglia salvata"); })
    .catch(err => toast(err.message))
    .finally(renderView);
});
