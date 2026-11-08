"use strict";

// ============================================================================
// RICERCA
// ============================================================================
const MT_KIND = { Raw: "grezzi", Manufactured: "manufatti", Encoded: "codificati" };
const QUICK = [
  ["Broker Guardian", { mode: "service", service: "Technology Broker", broker: "Guardian" }],
  ["Broker Human", { mode: "service", service: "Technology Broker", broker: "Human" }],
  ["MT grezzi", { mode: "service", service: "Material Trader", trader: "Raw" }],
  ["MT manufatti", { mode: "service", service: "Material Trader", trader: "Manufactured" }],
  ["MT codificati", { mode: "service", service: "Material Trader", trader: "Encoded" }],
  ["Interstellar Factors", { mode: "service", service: "Interstellar Factors Contact" }],
  ["Vista Genomics", { mode: "service", service: "Vista Genomics" }],
  ["Cantiere navale", { mode: "service", service: "Shipyard" }],
  ["Fleet carrier vicini", { mode: "carrier", service: "", max_age_days: 7 }],
  ["Armi e moduli", { mode: "module" }],
  ["Compra una merce", { mode: "buy" }],
];
// Servizi che si trovano sui fleet carrier (nomi come nel servizio di ricerca).
const CARRIER_SERVICES = [["", "Qualsiasi"], ["Refuel", "Rifornimento"], ["Repair", "Riparazioni"], ["Restock", "Munizioni"],
  ["Shipyard", "Cantiere navale"], ["Outfitting", "Outfitting"], ["Universal Cartographics", "Universal Cartographics"],
  ["Black Market", "Mercato nero"], ["Bartender", "Barista"], ["Redemption Office", "Redemption Office"],
  ["Pioneer Supplies", "Pioneer Supplies"], ["Vista Genomics", "Vista Genomics"]];
const carrierServicesText = list => {
  const names = CARRIER_SERVICES.filter(([v]) => v && (list || []).includes(v)).map(([, l]) => LANG.t(l));
  return names.length ? " · " + esc(names.join(", ")) : "";
};
VIEWS.search = () => {
  const f = "search", mode = fv(f, "mode", "service"), service = fv(f, "service", "Interstellar Factors Contact");
  const fields = {
    service: `<label>Servizio<select name="service">${STATIC.services.map(s => opt(s.value, s.label, service)).join("")}</select></label>
      ${service === "Material Trader" ? `<label>Tipo Trader<select name="trader">${opt("", "Qualsiasi", fv(f, "trader"))}${opt("Raw", "Grezzi", fv(f, "trader"))}${opt("Manufactured", "Manufatti", fv(f, "trader"))}${opt("Encoded", "Codificati", fv(f, "trader"))}</select></label>` : ""}
      ${service === "Technology Broker" ? `<label>Tipo Broker<select name="broker">${opt("", "Tutti (Guardian & Human)", fv(f, "broker"))}${opt("Guardian", "Guardian (Moduli Alieni)", fv(f, "broker"))}${opt("Human", "Human (Moduli Umani)", fv(f, "broker"))}</select></label>` : ""}`,
    carrier: `${inp(f, "name", "Nome o codice", "", 'autocomplete="off" placeholder="es. K3N-98F (vuoto = i più vicini)"')}
      <label>Servizio<select name="service">${CARRIER_SERVICES.map(([v, l]) => opt(v, l, fv(f, "service", ""))).join("")}</select></label>
      <label>Visto negli ultimi<select name="max_age_days">${[["1", "1 giorno"], ["7", "7 giorni"], ["30", "30 giorni"], ["0", "sempre"]].map(([v, l]) => opt(v, l, fv(f, "max_age_days", "7"))).join("")}</select></label>`,
    ship: inp(f, "ship", "Nave", "", 'data-suggest="ships" autocomplete="off" required placeholder="es. Mandalay"'),
    module: `${inp(f, "module", "Modulo o arma", "", 'data-suggest="modules" autocomplete="off" required placeholder="es. Multi-Cannon, Fuel Scoop"')}
      <label>Classe<select name="cls">${opt("", "—", fv(f, "cls"))}${[1, 2, 3, 4, 5, 6, 7, 8].map(c => opt(c, c, fv(f, "cls"))).join("")}</select></label>
      <label>Rating<select name="rating">${opt("", "—", fv(f, "rating"))}${"ABCDEFGHI".split("").map(c => opt(c, c, fv(f, "rating"))).join("")}</select></label>
      <label>Montaggio (armi)<select name="mount">${opt("", "Qualsiasi", fv(f, "mount"))}${opt("Fixed", "Fixed", fv(f, "mount"))}${opt("Gimbal", "Gimballed", fv(f, "mount"))}${opt("Turret", "Turreted", fv(f, "mount"))}</select></label>`,
    buy: `${inp(f, "commodity", "Merce", "", 'data-suggest="commodities" autocomplete="off" required placeholder="es. Steel, Painite"')}
      ${inp(f, "min_qty", "Quantità minima", "", 'type="number" min="1" style="width:110px" placeholder="1"')}
      <label>Ordina per<select name="sort">${opt("", "Distanza", fv(f, "sort"))}${opt("price", "Prezzo migliore", fv(f, "sort"))}</select></label>`,
  };
  fields.sell = fields.buy;
  const res = result("search", d => `<div class="sub" style="margin-bottom:6px">Da ${esc(d.reference?.name || "")} · ${d.results.length} di ${num(d.count)} · tipo di stazione, pad e pianeta secondo i dati della community: possono differire da quello che vedi in gioco</div>
    <table><thead><tr><th>Stazione</th><th>Sistema</th><th class="num">Dist.</th><th class="num">Dalla stella</th><th>Pad</th>${d.mode === "ship" || d.mode === "module" ? '<th class="num">Prezzo</th>' : ""}${d.mode === "buy" ? '<th class="num">Prezzo</th><th class="num">Disponibili</th>' : d.mode === "sell" ? '<th class="num">Paga</th><th class="num">Richiesta</th>' : ""}<th>Agg.</th><th></th></tr></thead><tbody>
    ${d.results.map(r => `<tr><td><b>${esc(r.carrier_name ? r.carrier_name + " · " + r.station : r.station)}</b><div class="sub">${esc(T("station", r.type || ""))}${r.body ? ` · ${esc(LANG.t("su"))} <b>${esc(r.body.startsWith(r.system + " ") ? r.body.slice(r.system.length + 1) : r.body)}</b>${r.gravity != null ? ` · <span class="${r.gravity > 1.5 ? "bad" : ""}">${dec(r.gravity, 2)} g</span>` : ""}` : ""}${d.mode === "carrier" ? carrierServicesText(r.services) : ""}${r.material_trader ? " · mercante " + esc(MT_KIND[r.material_trader] || r.material_trader) : ""}${r.technology_broker ? " · broker " + esc(r.technology_broker) : ""}</div></td>
      <td>${sys(r.system)}</td><td class="num">${ly(r.distance)}</td><td class="num">${r.dist_ls != null ? num(r.dist_ls) : "—"}</td>
      <td title="${r.pads ? esc(`L ${r.pads[0]} · M ${r.pads[1]} · S ${r.pads[2]}`) : ""}">${r.large_pad ? '<span class="ok">L</span>' : r.medium_pad ? "M" : '<span class="muted">S</span>'}</td>
      ${d.mode === "ship" || d.mode === "module" ? `<td class="num gold" ${r.module ? `title="${esc(r.module)}"` : ""}>${short(r.price)}${r.module ? `<div class="sub">${esc(r.module)}</div>` : ""}</td>` : ""}${
        d.mode === "buy" ? `<td class="num gold">${num(r.buy)} CR</td><td class="num">${num(r.supply)}</td>` : d.mode === "sell" ? `<td class="num gold">${num(r.sell)} CR</td><td class="num">${num(r.demand)}</td>` : ""}<td class="sub">${ago(r.updated)}</td><td>${todoBtn(`Andare a ${r.station}`, r.system, "Viaggi")}</td></tr>`).join("")
      || '<tr><td colspan="8"><div class="empty">Nessun risultato</div></td></tr>'}</tbody></table>`, "Scegli una ricerca rapida o compila il modulo.");
  return `<div class="col">${panel("Ricerca stazioni", `<div class="chips">${QUICK.map(([l], i) => `<button class="small" data-quick="${i}">${esc(l)}</button>`).join("")}</div>
    <form class="form" data-form="${f}" id="f-search">
      <label>Cerca<select name="mode">${opt("service", "Servizio", mode)}${opt("carrier", "Fleet carrier", mode)}${opt("ship", "Nave in vendita", mode)}${opt("module", "Modulo o arma in vendita", mode)}${opt("buy", "Merce: dove comprarla", mode)}${opt("sell", "Merce: dove venderla", mode)}</select></label>
      ${fields[mode] || fields.service}
      ${inp(f, "reference", "Vicino a", "", `placeholder="${esc(S.location.system || "Sol")}"`)}
      ${inp(f, "max_dist", "Entro (al)", "", 'type="number" style="width:90px"')}
      ${chk(f, "large_pad", false, "Pad grande")}${mode === "carrier" ? "" : chk(f, "no_carriers", true, "Escludi carrier")}
      <button class="primary" type="submit">Cerca</button></form>`, { code: "STATION-DB" })}
    ${panel("Risultati", res, { code: "RESULTS" })}</div>`;
};
