"use strict";

// ============================================================================
// AVVISI PREZZI (pannello inserito nella scheda Commercio)
// ============================================================================
// Lo stato arriva da /api/price_alerts e resta in UI.res.alerts; si aggiorna da solo ogni 30 secondi
// mentre il pannello è visibile (il controllo vero su Spansh lo fa il server in background).
// Ripetizioni: app/alerts.py, SENT_TTL_S = 6 h e fasce di prezzo del 2% della soglia (_bucket).
const PA_FORM = "alerts-new";
const PA_REFRESH_MS = 30000;

function paLoad(force = false) {
  const r = UI.res.alerts;
  if (UI.paLoading || (!force && r && Date.now() - (r.t || 0) < PA_REFRESH_MS)) return;
  UI.paLoading = true;
  api("/api/price_alerts")
    .then(data => { UI.res.alerts = { data, t: Date.now() }; })
    .catch(e => { UI.res.alerts = { error: e.message, t: Date.now() }; })
    .finally(() => {
      UI.paLoading = false;
      // Come l'aggiornamento automatico: non ridisegnare mentre si scrive in un campo (si perderebbe il focus).
      if (!document.activeElement?.matches("input:not([type=checkbox]):not([type=range]), select, textarea")) renderView();
    });
}

async function paPost(path, body, okMsg) {
  try {
    const data = await api(path, body || {});
    UI.res.alerts = { data, t: Date.now() };
    if (okMsg) toast(typeof okMsg === "function" ? okMsg(data) : okMsg);
  } catch (e) { toast("Avvisi prezzi: " + e.message); }
  renderView();
}

const paPad = p => p === "L" ? '<span class="ok">L</span>' : p === "M" ? "M" : '<span class="muted">S</span>';
const paKind = k => `<span class="tag ${k === "sell" ? "bio" : "geo"}">${k === "sell" ? "vendi" : "compra"}</span>`;

function paRules(d) {
  if (!d.rules.length) return '<div class="empty">Nessun avviso: aggiungine uno qui sotto.</div>';
  return `<table><thead><tr><th>Attivo</th><th>Regola</th><th class="num">Migliore</th><th class="num">Trovate</th><th>Ultimo controllo</th><th></th></tr></thead><tbody>
    ${d.rules.map(r => `<tr>
      <td><button class="switch ${r.enabled ? "on" : ""}" data-pa-toggle="${esc(r.id)}" role="switch" aria-checked="${r.enabled}" aria-label="Attiva avviso"><span></span><span></span></button></td>
      <td>${paKind(r.kind)} <b>${esc(T("commodity", r.commodity))}</b> ${r.kind === "sell" ? "≥" : "≤"} <span class="mono gold">${num(r.threshold)}</span>
        <div class="sub">${[`entro ${ly(r.radius)} da ${r.reference || LANG.t("sistema attuale")}`, `pad ${r.pad}+`, r.carriers ? "carrier inclusi" : "senza carrier",
          r.planetary ? "" : "no planetarie", `dati ≤ ${r.max_age_h} h`, r.min_qty > 1 ? `${r.kind === "sell" ? "domanda" : "offerta"} ≥ ${num(r.min_qty)}` : ""]
          .filter(Boolean).map(x => esc(LANG.t(x))).join(" · ")}</div>
        ${r.error ? `<div class="bad sub">⚠ ${esc(r.error)}</div>` : ""}</td>
      <td class="num gold">${r.best != null ? num(r.best) : "—"}</td>
      <td class="num">${r.matches != null ? num(r.matches) + (r.total > r.matches ? `<span class="sub"> / ${num(r.total)}</span>` : "") : "—"}</td>
      <td class="sub">${r.last_check ? ago(r.last_check) : "mai"}</td>
      <td><div style="display:flex;gap:4px"><button class="small ghost" data-pa-check="${esc(r.id)}" ${d.checking ? "disabled" : ""} title="Controlla ora questa regola">↻</button>
        <button class="small ghost" data-pa-del="${esc(r.id)}" title="Elimina avviso">✕</button></div></td></tr>`).join("")}</tbody></table>`;
}

function paRecent(d) {
  if (!d.recent.length) return '<div class="empty">Nessun avviso recente.</div>';
  return `<table><thead><tr><th>Quando</th><th>Merce</th><th>Stazione</th><th>Sistema</th><th class="num">Dist.</th><th>Pad</th><th class="num">Prezzo</th><th class="num">Offerta / Dom.</th><th>Dati</th><th></th></tr></thead><tbody>
    ${d.recent.slice(0, 25).map(a => `<tr><td class="sub">${ago(a.ts)}</td>
      <td>${paKind(a.kind)} ${esc(T("commodity", a.commodity))}</td>
      <td><b>${esc(a.station)}</b><div class="sub">${esc(T("station", a.type || ""))}${a.dist_ls != null ? " · " + num(a.dist_ls) + " ls" : ""}</div></td>
      <td>${sys(a.system)}<div class="sub"><span>da</span> ${esc(a.reference || "")}</div></td><td class="num">${ly(a.distance)}</td><td>${paPad(a.pad)}</td>
      <td class="num gold">${num(a.price)}</td><td class="num">${num(a.kind === "sell" ? a.demand : a.supply)}</td>
      <td class="sub">${ago(a.updated)}</td>
      <td>${todoBtn(LANG.t(`${a.kind === "sell" ? "Vendere" : "Comprare"} ${a.commodity} a ${a.station} (${num(a.price)} CR)`), a.system, "Commercio")}</td></tr>`).join("")}</tbody></table>`;
}

function paForm(d) {
  const f = PA_FORM, kind = fv(f, "kind", "sell");
  return `<form class="form" data-form="${f}" id="f-alerts-new">
    ${inp(f, "commodity", "Merce", "", 'data-suggest="commodities" autocomplete="off" required placeholder="es. Platinum"')}
    <label>Tipo<select name="kind">${opt("sell", "Vendere a ≥", kind)}${opt("buy", "Comprare a ≤", kind)}</select></label>
    ${inp(f, "threshold", "Prezzo (CR)", "", 'type="number" min="1" required style="width:120px"')}
    ${inp(f, "min_qty", kind === "sell" ? "Domanda min" : "Offerta min", "", 'type="number" min="1" placeholder="1" style="width:100px"')}
    ${inp(f, "radius", "Entro (al)", "50", 'type="number" min="1" max="1000" style="width:90px"')}
    ${inp(f, "reference", "Da", "", `placeholder="${esc(d?.current_system || S.location.system || "sistema attuale")}" title="Vuoto = segue il sistema in cui ti trovi"`)}
    <label>Pad min<select name="pad">${["S", "M", "L"].map(p => opt(p, p, fv(f, "pad", "M"))).join("")}</select></label>
    <label>Dati entro<select name="max_age_h">${[[6, "6 ore"], [24, "1 giorno"], [72, "3 giorni"], [168, "1 settimana"]].map(([v, l]) => opt(v, l, fv(f, "max_age_h", 24))).join("")}</select></label>
    ${chk(f, "carriers", false, "Fleet carrier")}${chk(f, "planetary", true, "Planetarie")}
    <button class="primary" type="submit">Aggiungi avviso</button></form>`;
}

function alertsPanel() {
  paLoad();
  const r = UI.res.alerts, d = r?.data;
  let body;
  if (!r) body = '<div class="loading">CARICAMENTO AVVISI</div>';
  else if (r.error && !d) body = `<div class="bad">⚠ ${esc(r.error)}</div>`;
  else {
    const c = d.config, busy = d.checking || UI.res.alertsCheck?.busy;
    const head = `<div class="form" style="margin-bottom:10px;align-items:center">
        <button class="primary" data-pa-check="" ${busy || !d.rules.some(x => x.enabled) ? "disabled" : ""}>${busy ? "Controllo in corso…" : "Controlla ora"}</button>
        <label>Ogni<select data-pa-cfg="interval_min">${[5, 10, 15, 30, 60].map(m => opt(m, m + " min", c.interval_min)).join("")}</select></label>
        <label class="check"><input type="checkbox" data-pa-cfg="voice" ${c.voice ? "checked" : ""}> Annuncio vocale</label>
        <label class="check"><input type="checkbox" data-pa-cfg="feed" ${c.feed ? "checked" : ""}> Nel ticker</label>
        <span class="sub">Ultimo controllo: ${d.last_check ? ago(d.last_check) : "mai"}</span></div>
      ${d.last_error ? `<div class="bad sub" style="margin-bottom:8px">⚠ ${esc(d.last_error)}</div>` : ""}`;
    body = head + paRules(d) + `<div style="margin-top:14px">${paForm(d)}</div>
      <div style="margin-top:16px;display:flex;justify-content:space-between;align-items:center"><b class="hud-t">AVVISI RECENTI</b>
        ${d.recent.length ? '<button class="small ghost" data-pa-clear>Svuota</button>' : ""}</div>
      <div style="margin-top:6px">${paRecent(d)}</div>
      <div class="sub" style="margin-top:8px">Una stazione già segnalata non viene ripetuta per 6 ore, se il prezzo non cambia di fascia (fasce larghe il 2% della soglia, almeno 100 CR). L'annuncio vocale richiede il copilota vocale attivo.</div>`;
  }
  const n = d?.rules.filter(x => x.enabled).length || 0;
  return panel("Avvisi prezzi", body, { code: "PRICE-ALERT", aside: d ? `${n} <span>attiv${n === 1 ? "o" : "i"}</span>` : "" });
}

document.addEventListener("submit", e => {
  if (e.target.dataset?.form !== PA_FORM) return;
  e.preventDefault();
  const q = UI.forms[PA_FORM] || {};
  const body = {
    commodity: (q.commodity || "").trim(), kind: q.kind || "sell", threshold: q.threshold, min_qty: q.min_qty || 1,
    radius: q.radius || 50, reference: (q.reference || "").trim(), pad: q.pad || "M", max_age_h: q.max_age_h || 24,
    carriers: q.carriers ?? false, planetary: q.planetary ?? true, enabled: true,
  };
  if (!body.commodity || !(+body.threshold > 0)) { toast("Indica una merce e un prezzo"); return; }
  UI.forms[PA_FORM] = { kind: body.kind, radius: q.radius, pad: q.pad, max_age_h: q.max_age_h, carriers: q.carriers, planetary: q.planetary };
  paPost("/api/price_alerts/rule", body, "Avviso aggiunto: primo controllo in corso");
  setTimeout(() => paLoad(true), 6000);   // il primo controllo gira sul server: aggiorna appena è finito
});

document.addEventListener("click", e => {
  const t = e.target.closest("[data-pa-toggle], [data-pa-del], [data-pa-check], [data-pa-clear]");
  if (!t) return;
  const d = t.dataset;
  if (d.paToggle) {
    const rule = UI.res.alerts?.data?.rules.find(r => r.id === d.paToggle);
    if (rule) paPost("/api/price_alerts/rule", { id: rule.id, enabled: !rule.enabled }, rule.enabled ? "Avviso disattivato" : "Avviso attivato");
  } else if (d.paDel) {
    if (confirm(LANG.t("Eliminare questo avviso prezzi?"))) paPost("/api/price_alerts/delete", { id: d.paDel }, "Avviso eliminato");
  } else if (d.paCheck !== undefined) {
    UI.res.alertsCheck = { busy: true };
    renderView();
    paPost("/api/price_alerts/check", d.paCheck ? { id: d.paCheck } : {},
      data => data.new ? `${data.new} nuove stazioni trovate` : "Nessuna novità")
      .finally(() => { UI.res.alertsCheck = null; renderView(); });
  } else if (d.paClear !== undefined) {
    paPost("/api/price_alerts/clear", {}, "Avvisi recenti svuotati");
  }
});

document.addEventListener("change", e => {
  const key = e.target.dataset?.paCfg;
  if (!key) return;
  const value = e.target.type === "checkbox" ? e.target.checked : +e.target.value;
  paPost("/api/price_alerts/config", { [key]: value }, "Impostazioni avvisi salvate");
});
