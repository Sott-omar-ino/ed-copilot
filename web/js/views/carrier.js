"use strict";

// ============================================================================
// FLEET CARRIER (stato dal journal e rotte)
// ============================================================================
// Solo dati del journal (CarrierStats / CarrierFinance) e fatti di gioco noti: niente costi stimati inventati.
// Verificati (08/11/2026): Drake-class, salto max 500 al (recap annuncio Frontier Fleet Carriers, forums.frontier.co.uk),
// 25.000 t di capacità condivisa con i servizi e serbatoio di Tritium da 1000 t (Elite Dangerous Wiki, "Drake-Class Carrier").
VIEWS.carrier = () => {
  const c = S?.carrier || {};
  const hasCarrier = !!(c.callsign || c.name || c.carrier_id);
  const curSys = S?.location?.system || "Sol";

  const name = c.name || (hasCarrier ? "Fleet Carrier" : "Nessun carrier nei journal");
  const where = c.system || "—";
  const fuel = c.fuel != null ? c.fuel : null;
  const fuelPct = fuel != null ? Math.round((fuel / 1000) * 100) : 0;  // serbatoio di Tritium: 1000 t
  const fin = c.finance || {};

  const statusPanel = panel(esc(name), hasCarrier ? `
      <div class="sys-meta"><span><b>Posizione</b>${where !== "—" ? sys(where) : "—"}</span>${c.body ? `<span><b>Corpo</b>${esc(c.body)}</span>` : ""}</div>
      <div class="kv-grid">
        <div class="kv"><span>Tritium nel serbatoio</span><span class="gold">${num(fuel)} / 1000 t</span>${seg(fuelPct, 16, fuelPct > 30 ? "full" : "")}</div>
        <div class="kv"><span>Saldo</span><span class="gold">${short(fin.balance)} CR</span></div>
        <div class="kv"><span>Disponibile</span><span>${short(fin.available)} CR</span></div>
        <div class="kv"><span>Riserva</span><span>${short(fin.reserve)} CR</span></div>
      </div>`
    : `<div class="empty">Nessun Fleet Carrier nei journal</div>
      <p class="sub">Puoi comunque calcolare una rotta per carrier qui sotto.</p>`,
    { code: c.callsign || "FLEET-CARRIER", aside: hasCarrier ? '<span class="tag ok">carrier attivo</span>' : "" });

  const f = UI.forms.carrier || { from: curSys, to: "Colonia", capacity_used: 0 };
  UI.forms.carrier = f;

  const routeRes = UI.carrierRoute;
  let routeHtml = "";
  if (routeRes) {
    if (routeRes.busy) {
      routeHtml = '<div class="loading">Calcolo della rotta</div>';
    } else if (routeRes.error) {
      routeHtml = `<div class="bad">⚠ ${esc(routeRes.error)}</div>`;
    } else if (routeRes.data) {
      const d = routeRes.data;
      const jumps = d.jumps || [];
      const totalTrit = d.tritium || jumps.reduce((a, j) => a + (j.tritium_used || 0), 0);
      routeHtml = `<div class="subpanel" style="margin-top:14px">
          <h3>${esc(d.from)} → ${esc(d.to)}</h3>
          <div class="kv-grid">
            <div class="kv"><span>Distanza</span><span>${ly(d.distance)}</span></div>
            <div class="kv"><span>Salti</span><span>${jumps.length}</span></div>
            <div class="kv"><span>Tritium</span><span class="gold">${num(totalTrit)} t</span></div>
          </div>
          <div style="max-height:360px;overflow-y:auto;margin-top:10px">
            <table><thead><tr><th class="num">#</th><th>Sistema</th><th class="num">Salto</th><th class="num">Tritium</th><th class="num">Nel serbatoio</th><th>Anello ghiacciato</th></tr></thead>
              <tbody>${jumps.map((j, idx) => `<tr><td class="num">${idx + 1}</td><td>${sys(j.system)}</td>
                <td class="num">${j.distance_jumped ? ly(j.distance_jumped) : "—"}</td>
                <td class="num gold">${j.tritium_used ? num(j.tritium_used) + " t" : "—"}</td>
                <td class="num">${j.fuel != null ? num(j.fuel) + " t" : "—"}</td>
                <td>${j.icy_ring ? '<span class="tag ok">sì</span>' : '<span class="muted">—</span>'}</td></tr>`).join("")}</tbody>
            </table>
          </div>
        </div>`;
    }
  }

  const routerPanel = panel("Rotta del carrier", `
      <div class="form">
        <label class="grow-1">Partenza<input id="fc-from" value="${esc(f.from || curSys)}" placeholder="es. Sol"></label>
        <label class="grow-1">Destinazione<input id="fc-to" value="${esc(f.to || "Colonia")}" placeholder="es. Colonia"></label>
        <label>Carico a bordo (t)<input id="fc-cargo" type="number" min="0" max="25000" step="100" value="${f.capacity_used || 0}"></label>
        <button class="primary" id="btn-calc-carrier-route">Calcola rotta</button>
      </div>
      <div class="chips" style="margin-top:10px">
        <span class="sub" style="align-self:center">Mete rapide</span>
        <button class="small" data-fc-quick-to="Colonia">Colonia</button>
        <button class="small" data-fc-quick-to="Sagittarius A*">Sagittarius A*</button>
        <button class="small" data-fc-quick-to="Sol">Sol</button>
        <button class="small" data-fc-quick-to="Beagle Point">Beagle Point</button>
      </div>
      ${routeHtml}`, { code: "ROUTER", aside: "salti fino a 500 al" });

  const infoPanel = panel("Da sapere", `
      <ul style="margin:0;padding-left:18px">
        <li>Un Fleet Carrier salta fino a <b>500 al</b> per volta e consuma Tritium; il consumo cresce con il carico a bordo.</li>
        <li>Il Tritium si trova negli anelli ghiacciati (minabile) o nei mercati.</li>
        <li>La capacità di carico massima è di <b>25.000 t</b>, ridotta dai servizi installati.</li>
        <li>Il mantenimento viene addebitato ogni settimana dal saldo del carrier: tieni una riserva sufficiente.</li>
      </ul>`, { code: "INFO" });

  return `<div class="col">
    ${statusPanel}
    <div class="grid"><div class="col">${routerPanel}</div><div class="col">${infoPanel}</div></div>
  </div>`;
};
