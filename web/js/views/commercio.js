"use strict";

// ============================================================================
// COMMERCIO
// ============================================================================
function marketTable(data, mode) {
  return `<div class="sub" style="margin-bottom:6px">Da ${esc(data.reference?.name || "")} · ${data.results.length} risultati</div>
    <table><thead><tr><th>Stazione</th><th>Sistema</th><th class="num">Dist.</th><th>Pad</th><th class="num">${mode === "buy" ? "Acquisto" : "Vendita"}</th><th class="num">${mode === "buy" ? "Offerta" : "Domanda"}</th><th>Agg.</th><th></th></tr></thead><tbody>
    ${data.results.map(r => `<tr><td><b>${esc(r.station)}</b><div class="sub">${esc(T("station", r.type || ""))} · ${r.dist_ls != null ? num(r.dist_ls) + " ls" : ""}</div></td>
      <td>${sys(r.system)}</td><td class="num">${ly(r.distance)}</td><td>${r.large_pad ? '<span class="ok">L</span>' : r.medium_pad ? "M" : '<span class="muted">S</span>'}</td>
      <td class="num gold">${num(mode === "buy" ? r.buy : r.sell)}</td><td class="num">${num(mode === "buy" ? r.supply : r.demand)}</td>
      <td class="sub">${ago(r.updated)}</td><td>${todoBtn(LANG.t(`${mode === "buy" ? "Comprare" : "Vendere"} a ${r.station}`), r.system, "Commercio")}</td></tr>`).join("")
      || '<tr><td colspan="8"><div class="empty">Nessun risultato</div></td></tr>'}</tbody></table>`;
}


VIEWS.trade = () => {
  const loc = S.location, sh = S.ship;
  const tradeForm = `<form class="form" data-form="trade" id="f-trade">
      ${inp("trade", "system", "Sistema", "", `placeholder="${esc(loc.system || "")}"`)}
      ${inp("trade", "station", "Stazione", "", `placeholder="${esc(loc.docked ? loc.station : "nome stazione")}"`)}
      ${inp("trade", "capital", "Capitale", "", `type="number" placeholder="${S.cmdr.credits || ""}" style="width:150px"`)}
      ${inp("trade", "cargo", "Stiva (t)", "", `type="number" placeholder="${sh.cargo || ""}" style="width:90px"`)}
      ${inp("trade", "hop_distance", "Salto max (al)", "", `type="number" step="0.1" placeholder="${sh.jump_range ? sh.jump_range.toFixed(1) : ""}" style="width:110px"`)}
      <label>Tappe<select name="hops">${[1, 2, 3, 4, 5, 6, 8, 10].map(n => opt(n, n, fv("trade", "hops", 4))).join("")}</select></label>
      ${inp("trade", "max_ls", "Max ls stazione", "5000", 'type="number" style="width:110px"')}
      <label>Prezzi entro<select name="max_age_h">${[[6, "6 ore"], [24, "1 giorno"], [48, "2 giorni"], [168, "1 settimana"]].map(([v, l]) => opt(v, l, fv("trade", "max_age_h", 48))).join("")}</select></label>
      ${chk("trade", "large_pad", false, "Pad grande")}${chk("trade", "planetary", true, "Planetarie")}${chk("trade", "carriers", false, "Fleet carrier")}
      <button class="primary" type="submit" ${UI.res.trade?.busy ? "disabled" : ""}>Calcola rotta</button></form>`;
  const tradeRes = result("trade", d => d.hops.length ? `<div class="kv-grid" style="margin:14px 0 6px">
        <div class="kv"><span>Profitto totale</span><span class="big">${short(d.hops.at(-1).cumulative)} CR</span></div>
        <div class="kv"><span>Tappe</span><span>${d.hops.length}</span></div>
        <div class="kv"><span>Distanza</span><span>${ly(d.hops.reduce((a, h) => a + h.distance, 0))}</span></div></div>
      <div class="route-list">${d.hops.map((h, i) => `<div style="padding:10px 0;border-bottom:1px solid var(--hud-line)">
        <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap"><span><span class="mono hud-t">${String(i + 1).padStart(2, "0")}</span>
          <b>${esc(h.from_station)}</b> <span class="sub">${esc(h.from_system)}</span> <span class="hud-t">→</span> <b>${esc(h.to_station)}</b> ${sys(h.to_system)}</span>
          <span class="mono">${ly(h.distance)} · ${num(h.to_ls)} ls · <span class="gold">+${short(h.profit)}</span></span></div>
        ${h.commodities.map(c => `<div class="mat-line" style="grid-template-columns:200px 1fr auto;margin-top:4px"><span>${esc(T("commodity", c.name))} <span class="sub">${num(c.amount)} t</span></span>
          <span class="sub mono">${num(c.buy)} → ${num(c.sell)} (+${num(c.profit)}/t)</span><span class="mono gold">+${short(c.total)}</span></div>`).join("")}
        <div style="margin-top:4px">${todoBtn(LANG.t(`Commercio: ${h.commodities.map(c => c.name).join(", ")} → ${h.to_station}`), h.to_system, "Commercio")}</div></div>`).join("")}</div>`
      : '<div class="empty">Nessuna rotta redditizia trovata con questi parametri</div>',
    "Il calcolo parte dalla stazione dove sei attraccato e usa stiva, salto e crediti della nave attuale (puoi cambiarli).");

  const cargoRes = result("cargoPrices", d => `<table><thead><tr><th>Merce</th><th class="num">t</th><th>Miglior offerta</th><th class="num">Prezzo</th><th class="num">Totale</th></tr></thead><tbody>
      ${d.map(x => `<tr><td><b>${esc(T("commodity", x.name))}</b></td><td class="num">${x.count}</td><td>${x.best ? `${esc(x.best.station)} · ${sys(x.best.system)} <span class="sub">${ly(x.best.distance)}</span>` : '<span class="muted">nessuna</span>'}</td>
        <td class="num gold">${x.best ? num(x.best.sell) : "—"}</td><td class="num">${x.best ? short(x.best.sell * x.count) : "—"}</td></tr>`).join("")}</tbody></table>
      <div class="kv" style="margin-top:10px"><span>Valore stimato del carico</span><span class="big">${short(d.reduce((a, x) => a + (x.best ? x.best.sell * x.count : 0), 0))} CR</span></div>`,
    S.cargo.length ? `${S.cargo.length} merci a bordo: premi il pulsante per cercare dove venderle meglio.` : "Stiva vuota.");

  const mk = "market";
  const marketForm = `<form class="form" data-form="${mk}" id="f-market">
      <label>Operazione<select name="mode">${opt("sell", "Vendere", fv(mk, "mode", "sell"))}${opt("buy", "Comprare", fv(mk, "mode", "sell"))}</select></label>
      ${inp(mk, "commodity", "Merce", "", 'data-suggest="commodities" autocomplete="off" required placeholder="es. Gold"')}
      ${inp(mk, "max_dist", "Entro (al)", "100", 'type="number" style="width:90px"')}
      ${inp(mk, "min_qty", "Quantità min", "", 'type="number" style="width:100px"')}
      <label>Ordina<select name="sort">${opt("price", "Prezzo migliore", fv(mk, "sort", "price"))}${opt("distance", "Distanza", fv(mk, "sort", "price"))}</select></label>
      ${chk(mk, "large_pad", false, "Pad grande")}${chk(mk, "no_carriers", true, "Escludi carrier")}
      <button class="primary" type="submit">Cerca</button></form>`;

  const trades = S.trades.length ? `<table><tbody>${S.trades.slice(0, 15).map(t => `<tr><td class="mono muted">${t.ts.slice(11, 16)}</td>
      <td><span class="tag ${t.kind === "sell" ? "bio" : "geo"}">${t.kind === "sell" ? "vendita" : "acquisto"}</span> ${esc(T("commodity", t.commodity))}</td><td class="num">${num(t.count)} t</td>
      <td class="num ${t.kind === "sell" ? "gold" : "muted"}">${t.kind === "sell" ? "+" + short(t.profit) : short(t.total)}</td></tr>`).join("")}</tbody></table>`
    : '<div class="empty">Nessuna compravendita in questa sessione</div>';

  return `<div class="grid"><div class="col">
      ${panel("Pianificatore rotte commerciali", tradeForm + `<div style="margin-top:14px">${tradeRes}</div>`, { code: "TRADE-PLOT" })}
      ${panel("Prezzi delle merci", marketForm + `<div style="margin-top:14px">${result("market", d => marketTable(d, UI.res.market.mode), "Cerca dove comprare o vendere una merce vicino a te.")}</div>`, { code: "MARKET" })}
      ${typeof alertsPanel === "function" ? alertsPanel() : ""}
    </div><div class="col">
      ${panel("Vendi il carico", `<div class="form" style="margin-bottom:10px">${inp("cargo", "max_dist", "Entro (al)", "60", 'type="number" style="width:90px" form="f-cargo"')}
        <form id="f-cargo" data-form="cargo"><button class="primary" type="submit" ${!S.cargo.length || UI.res.cargoPrices?.busy ? "disabled" : ""}>Trova miglior prezzo</button></form></div>${cargoRes}`, { code: "CARGO", aside: `${num(S.cargo.reduce((a, c) => a + c.count, 0))} t a bordo` })}
      ${panel("Registro commerci", trades, { code: "LEDGER", aside: `profitto sessione <span class="gold mono">${short(S.trade_profit)}</span>` })}
    </div></div>`;
};

async function cargoPrices() {
  const dist = fv("cargo", "max_dist", "60");
  const out = [];
  for (const c of S.cargo) {
    try {
      const r = await api("/api/search", { mode: "sell", commodity: c.name, sort: "price", max_dist: dist, no_carriers: true });
      out.push({ ...c, best: r.results[0] || null });
    } catch (e) {
      out.push({ ...c, best: null });
    }
  }
  return out;
}
