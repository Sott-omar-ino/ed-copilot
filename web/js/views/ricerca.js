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
];
VIEWS.search = () => {
  const f = "search", mode = fv(f, "mode", "service"), service = fv(f, "service", "Interstellar Factors Contact");
  const fields = {
    service: `<label>Servizio<select name="service">${STATIC.services.map(s => opt(s.value, s.label, service)).join("")}</select></label>
      ${service === "Material Trader" ? `<label>Tipo Trader<select name="trader">${opt("", "Qualsiasi", fv(f, "trader"))}${opt("Raw", "Grezzi", fv(f, "trader"))}${opt("Manufactured", "Manufatti", fv(f, "trader"))}${opt("Encoded", "Codificati", fv(f, "trader"))}</select></label>` : ""}
      ${service === "Technology Broker" ? `<label>Tipo Broker<select name="broker">${opt("", "Tutti (Guardian & Human)", fv(f, "broker"))}${opt("Guardian", "Guardian (Moduli Alieni)", fv(f, "broker"))}${opt("Human", "Human (Moduli Umani)", fv(f, "broker"))}</select></label>` : ""}`,
    ship: inp(f, "ship", "Nave", "", 'data-suggest="ships" autocomplete="off" required placeholder="es. Mandalay"'),
    module: `${inp(f, "module", "Modulo", "", 'data-suggest="modules" autocomplete="off" required placeholder="es. Fuel Scoop"')}
      <label>Classe<select name="cls">${opt("", "—", fv(f, "cls"))}${[1, 2, 3, 4, 5, 6, 7, 8].map(c => opt(c, c, fv(f, "cls"))).join("")}</select></label>
      <label>Rating<select name="rating">${opt("", "—", fv(f, "rating"))}${"ABCDE".split("").map(c => opt(c, c, fv(f, "rating"))).join("")}</select></label>`,
  };
  const res = result("search", d => `<div class="sub" style="margin-bottom:6px">Da ${esc(d.reference?.name || "")} · ${d.results.length} di ${num(d.count)}</div>
    <table><thead><tr><th>Stazione</th><th>Sistema</th><th class="num">Dist.</th><th class="num">Dalla stella</th><th>Pad</th>${d.mode === "ship" ? '<th class="num">Prezzo</th>' : ""}<th>Agg.</th><th></th></tr></thead><tbody>
    ${d.results.map(r => `<tr><td><b>${esc(r.station)}</b><div class="sub">${esc(T("station", r.type || ""))}${r.material_trader ? " · mercante " + esc(MT_KIND[r.material_trader] || r.material_trader) : ""}${r.technology_broker ? " · broker " + esc(r.technology_broker) : ""}</div></td>
      <td>${sys(r.system)}</td><td class="num">${ly(r.distance)}</td><td class="num">${r.dist_ls != null ? num(r.dist_ls) : "—"}</td>
      <td>${r.large_pad ? '<span class="ok">L</span>' : r.medium_pad ? "M" : '<span class="muted">S</span>'}</td>
      ${d.mode === "ship" ? `<td class="num gold">${short(r.price)}</td>` : ""}<td class="sub">${ago(r.updated)}</td><td>${todoBtn(`Andare a ${r.station}`, r.system, "Viaggi")}</td></tr>`).join("")
      || '<tr><td colspan="8"><div class="empty">Nessun risultato</div></td></tr>'}</tbody></table>`, "Scegli una ricerca rapida o compila il modulo.");
  return `<div class="col">${panel("Ricerca stazioni", `<div class="chips">${QUICK.map(([l], i) => `<button class="small" data-quick="${i}">${esc(l)}</button>`).join("")}</div>
    <form class="form" data-form="${f}" id="f-search">
      <label>Cerca<select name="mode">${opt("service", "Servizio", mode)}${opt("ship", "Nave in vendita", mode)}${opt("module", "Modulo", mode)}</select></label>
      ${fields[mode] || fields.service}
      ${inp(f, "reference", "Vicino a", "", `placeholder="${esc(S.location.system || "Sol")}"`)}
      ${inp(f, "max_dist", "Entro (al)", "", 'type="number" style="width:90px"')}
      ${chk(f, "large_pad", false, "Pad grande")}${chk(f, "no_carriers", true, "Escludi carrier")}
      <button class="primary" type="submit">Cerca</button></form>`, { code: "STATION-DB" })}
    ${panel("Risultati", res, { code: "RESULTS" })}</div>`;
};
