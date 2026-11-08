"use strict";

// ============================================================================
// BOLLA ↔ COLONIA
// ============================================================================
// Stato da /api/colonia/status (posizione, stime, viaggio da passeggero), rotte da /api/colonia/plan (Spansh).
// Tutto resta in UI.res: il ridisegno ogni 2 s non rifà le richieste; lo stato si ricarica ogni 10 s.
// Niente link esterni né nomi di siti/community qui (il programma è pubblico): fonti in app/colonia.py.

function colLoad(quiet = false) {
  const cur = UI.res.colStatus;
  if (cur?.busy || cur?.loading) return;
  if (!quiet || !cur) UI.res.colStatus = { busy: true };
  else cur.loading = true;
  const dest = UI.forms.colonia?.dest || "";
  api("/api/colonia/status" + (dest ? "?dest=" + encodeURIComponent(dest) : ""))
    .then(d => { UI.res.colStatus = { data: d, at: Date.now() }; })
    .catch(e => { UI.res.colStatus = cur?.data ? { ...cur, loading: false, at: Date.now() } : { error: e.message, at: Date.now() }; })
    .finally(() => { if (currentTab() === "colonia") renderView(); });
}

const colHours = min => min == null ? "—" : min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min}m`;
const COL_REGION = { bubble: "Nella Bolla", colonia: "Regione di Colonia", deep: "Spazio profondo", unknown: "Posizione sconosciuta" };

function colPlanBox(key, render) {
  return result(key, render, "Premi Calcola per la rotta esatta (può richiedere un minuto).");
}

VIEWS.colonia = () => {
  const r = UI.res.colStatus;
  if (!r || (r.at && Date.now() - r.at > 10000)) colLoad(!!r);
  if (!r?.data) return panel("Bolla ↔ Colonia", r?.error ? `<div class="bad">⚠ ${esc(r.error)}</div>` : '<div class="loading">CARICAMENTO</div>');
  const d = r.data, f = UI.forms.colonia || {};
  const toCol = d.direction === "to_colonia";
  const dest = d.destination;
  const dirLabel = toCol ? "Verso Colonia" : "Verso la Bolla (Sol)";

  // --- testata ---
  const head = `<div class="kv-grid">
      <div class="kv"><span>Posizione</span><span>${sys(d.system)}</span><span class="sub">${COL_REGION[d.region] || ""}</span></div>
      <div class="kv"><span>Distanza da Colonia</span><span class="gold">${ly(d.d_colonia)}</span></div>
      <div class="kv"><span>Distanza da Sol</span><span>${ly(d.d_sol)}</span></div>
      <div class="kv"><span>Direzione</span><span class="gold">${dirLabel}</span><span class="sub">${d.manual ? "scelta da te" : "rilevata in automatico"}</span></div>
    </div>
    <div class="chips" style="margin-top:10px">
      <span class="sub" style="align-self:center">Meta:</span>
      <button class="small ${dest === "Colonia" ? "primary" : "ghost"}" data-col-dest="Colonia">Colonia</button>
      <button class="small ${dest === "Sol" ? "primary" : "ghost"}" data-col-dest="Sol">Bolla (Sol)</button>
      ${f.dest ? `<button class="small ghost" data-col-dest="">Automatica</button>` : ""}
    </div>`;

  // --- (a) nave propria, neutron highway ---
  const ne = d.neutron_estimate;
  const shipOpt = `<p class="sub">${esc(d.ship || "Nave attuale")} · gittata ${d.jump_range ? ly(d.jump_range, 1) : "—"}.
      Con la neutron highway ogni salto da una stella di neutroni vale ~4 volte la gittata (supercharge; l'FSD si danneggia un po' a ogni supercharge: porta un AFMU per ripararlo).</p>
    <div class="kv-grid">
      <div class="kv"><span>Salti (stima)</span><span>${ne ? "~" + num(ne.jumps) : "—"}</span></div>
      <div class="kv"><span>Tempo (stima)</span><span>${ne ? "~" + colHours(ne.minutes) : "—"}</span><span class="sub">stima: ~75 s a salto</span></div>
    </div>
    <div style="margin-top:8px"><button class="primary small" data-col-plan="neutron">◆ Calcola rotta neutron</button>
      <button class="small ghost" data-col-plan="neutron" data-col-save="1" title="Calcola e imposta come rotta attiva (scheda Rotte)">Calcola e usa come rotta attiva</button></div>
    <div style="margin-top:8px">${colPlanBox("colPlanNeutron", p => `<div class="kv-grid">
      <div class="kv"><span>Salti</span><span class="gold">${num(p.jumps)}</span></div>
      <div class="kv"><span>Tappe neutron</span><span>${num(p.neutrons)}</span></div>
      <div class="kv"><span>Distanza</span><span>${ly(p.distance)}</span></div>
      <div class="kv"><span>Tempo</span><span>~${colHours(p.minutes)}</span></div></div>
      <div class="sub" style="margin-top:6px">${esc(p.from)} → ${esc(p.to)} · gittata ${num(p.range)} al${p.saved ? ' · <span class="ok">impostata come rotta attiva</span>' : ""}</div>`)}</div>`;

  // --- (b) fleet carrier proprio ---
  const ce = d.carrier_estimate, oc = d.own_carrier;
  const fcOpt = `<p class="sub">Salti da max ${d.facts.carrier_jump_ly} al: 15 min di preparazione + 5 di cooldown, ma la coda di Frontier spesso porta a 20-60 min a salto. Il Tritium consumato dipende da carico e serbatoio.</p>
    ${oc ? `<div class="sub" style="margin-bottom:6px">Il tuo carrier <b class="gold">${esc(oc.name || oc.callsign)}</b> [${esc(oc.callsign || "—")}] è a ${sys(oc.system)} · ${ly(oc.distance)} da ${esc(dest)} · Tritium ${num(oc.fuel)} t</div>` : ""}
    <div class="kv-grid">
      <div class="kv"><span>Salti</span><span>${(oc?.estimate || ce) ? "~" + num((oc?.estimate || ce).jumps) : "—"}</span></div>
      <div class="kv"><span>Tritium</span><span class="gold">${(oc?.estimate || ce) ? "~" + num((oc?.estimate || ce).tritium) + " t" : "—"}</span><span class="sub">${(oc?.estimate || ce)?.refills ? (oc?.estimate || ce).refills + " rifornimenti in viaggio" : ""}</span></div>
      <div class="kv"><span>Tempo minimo</span><span>${(oc?.estimate || ce) ? "~" + colHours((oc?.estimate || ce).minutes) : "—"}</span><span class="sub">a 20 min a salto</span></div>
    </div>
    <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
      <button class="primary small" data-col-plan="carrier">◆ Calcola rotta carrier</button>
      ${oc ? `<button class="small ghost" data-col-fc-plan="${esc(oc.system || "")}">Pianifica il viaggio del tuo carrier →</button>` : ""}
    </div>
    <div style="margin-top:8px">${colPlanBox("colPlanCarrier", p => `<div class="kv-grid">
      <div class="kv"><span>Salti</span><span class="gold">${num(p.jumps)}</span></div>
      <div class="kv"><span>Tritium</span><span class="gold">${num(p.tritium)} t</span></div>
      <div class="kv"><span>Distanza</span><span>${ly(p.distance)}</span></div>
      <div class="kv"><span>Tempo minimo</span><span>~${colHours(p.minutes)}</span></div></div>
      ${p.restock?.length ? `<div class="sub" style="margin-top:6px">Rifornire il Tritium a: ${p.restock.map(s => sys(s)).join(", ")}</div>` : ""}
      <div class="sub" style="margin-top:6px">${esc(p.from)} → ${esc(p.to)} · calcolato dalla posizione attuale. Per un altro punto di partenza usa la scheda Fleet carrier.</div>`)}</div>`;

  // --- (c) passaggio su un carrier altrui ---
  const ride = `<ol style="margin:0 0 8px 18px;padding:0;line-height:1.6">
      <li><b>Trova un carrier</b>: cerca un passaggio nelle community dei Fleet Carrier, dove i proprietari annunciano i viaggi (es. "Bubble &gt; Colonia", orari in UTC = ora di gioco): trovi i collegamenti in <a href="#places">Luoghi utili</a>. Il passaggio di solito è gratis: una donazione di Tritium è gradita.</li>
      <li><b>Raggiungi il carrier</b> prima della partenza: controlla che il docking access sia aperto a tutti (All) e che la tua nave entri nei pad.</li>
      <li><b>Attracca e resta attraccato</b>: quando il carrier salta tu salti con lui. Puoi stare in gioco (l'app annuncia ogni salto) o uscire dal gioco attraccato: al rientro sarai dove è arrivato il carrier (i salti fatti mentre eri fuori non vengono contati, la distanza sì).</li>
      <li><b>Cosa portare</b>: una nave da esplorazione con fuel scoop (a Colonia ti servirà) e, se puoi, una seconda nave: il trasferimento navi fino a Colonia è lentissimo e costoso.</li>
      <li><b>All'arrivo</b> decolla e vai a Jaques Station (Colonia) per riparazioni, rebuy e outfitting.</li>
    </ol>
    <div class="sub">Rischi: il carrier può partire prima o dopo dell'orario annunciato, cambiare rotta o fermarsi; il proprietario può chiudere il docking access. Tieni sempre una nave in grado di tornare da sola.</div>
`;

  // --- passeggero a bordo ---
  const t = d.trip, here = d.carrier_here;
  let tripHtml;
  if (t && t.active) {
    tripHtml = `<div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px;align-items:center">
        <div><b class="gold">${esc(t.start_system || "—")} → ${esc(t.destination)}</b>
          <div class="sub">${t.carrier ? `Carrier ${esc(t.carrier.name || "")} [${esc(t.carrier.callsign)}]` : "Carrier non ancora rilevato"} · ${t.aboard ? '<span class="ok">A BORDO</span>' : '<span class="bad">NON A BORDO</span>'}${t.auto ? " · preparato in automatico" : ""}</div></div>
        <div style="display:flex;gap:6px"><button class="small ghost" data-col-trip="stop">Termina viaggio</button></div>
      </div>
      <div style="margin:10px 0">${meter(t.pct || 0, "holo")}</div>
      <div class="kv-grid">
        <div class="kv"><span>Salti fatti</span><span class="gold">${num(t.jumps_done)}</span></div>
        <div class="kv"><span>Mancano</span><span class="gold">${ly(t.remaining)}</span><span class="sub">${t.jumps_left != null ? "~" + t.jumps_left + " salti" : ""}</span></div>
        <div class="kv"><span>Arrivo stimato</span><span>${t.eta_min != null ? "~" + colHours(t.eta_min) : "—"}</span><span class="sub">${t.jumps_done > 1 ? `media osservata ${t.avg_gap_min} min/salto` : "a 20 min a salto"}</span></div>
        <div class="kv"><span>Partito</span><span>${ago(t.started)}</span></div>
      </div>
      ${t.jumps?.length ? `<div style="max-height:180px;overflow-y:auto;margin-top:10px"><table><thead><tr><th>#</th><th>Sistema</th><th class="num">Mancano</th><th>Quando</th></tr></thead><tbody>
        ${t.jumps.slice().reverse().map((j, i) => `<tr><td class="mono">${t.jumps.length - i}</td><td>${sys(j.system)}</td><td class="num">${ly(j.remaining)}</td><td class="sub">${ago(j.ts)}</td></tr>`).join("")}</tbody></table></div>` : ""}
      <div class="sub" style="margin-top:8px">A ogni salto del carrier (evento CarrierJump, solo se sei in gioco e attraccato) il copilota annuncia dove sei e quanto manca.</div>`;
  } else {
    const last = t && !t.active ? `<div class="sub" style="margin-bottom:8px">Ultimo viaggio: ${esc(t.start_system || "—")} → ${esc(t.destination)}, ${num(t.jumps_done)} salti${t.ended ? " · finito " + ago(t.ended) : ""}. <button class="small ghost" data-col-trip="clear">Cancella</button></div>` : "";
    tripHtml = `${last}<p class="sub">${here ? `Sei attraccato al carrier <b class="gold">${esc(here.name || here.callsign)}</b> [${esc(here.callsign)}].` : "Quando attracchi a un fleet carrier il viaggio si prepara da solo (se sei nella Bolla o a Colonia)."}
      Puoi anche avviarlo a mano: l'app conta i salti del carrier, la distanza che manca e l'arrivo stimato.</p>
      <button class="primary small" data-col-trip="start">◆ Inizia viaggio verso ${esc(dest)}</button>`;
  }

  // --- info Colonia ---
  const engs = d.engineers || [];
  const engRow = e => `<tr><td><b>${esc(e.name)}</b><div class="sub">${esc(e.spec)}</div></td><td>${sys(e.system)}<div class="sub">${esc(e.base)}</div></td><td class="num">${ly(e.d_colonia)}</td></tr>`;
  const info = `<div class="kv-grid" style="margin-bottom:10px">
      <div class="kv"><span>Colonia ↔ Sol</span><span class="gold">${ly(d.colonia_to_sol)}</span></div>
      <div class="kv"><span>Capitale</span><span>Jaques Station</span><span class="sub">sistema Colonia</span></div>
    </div>
    <p class="sub">Jaques Station ha cantiere, outfitting, riparazioni e rebuy. Il Colonia Bridge è una catena di ~56 megaship ferme tra Alcor e Colonia (utili come tappe con servizi), non un servizio di trasporto.</p>
    <div class="chips" style="margin:8px 0">
      <button class="small" data-col-svc="Shipyard">Cantieri vicino a Colonia</button>
      <button class="small" data-col-svc="Outfitting">Outfitting vicino a Colonia</button>
      <button class="small" data-col-svc="Material Trader">Material trader</button>
      <button class="small" data-col-svc="Interstellar Factors Contact">Interstellar Factors</button>
    </div>
    ${result("colSvc", s => `<table><thead><tr><th>Stazione</th><th>Sistema</th><th class="num">Da Colonia</th><th>Pad</th></tr></thead><tbody>
      ${s.results.slice(0, 8).map(x => `<tr><td><b>${esc(x.station)}</b><div class="sub">${esc(x.type || "")}</div></td><td>${sys(x.system)}</td><td class="num">${ly(x.distance)}</td><td>${x.large_pad ? '<span class="ok">L</span>' : x.medium_pad ? "M" : "S"}</td></tr>`).join("") || '<tr><td colspan="4"><div class="empty">Nessun risultato</div></td></tr>'}
      </tbody></table>`, "Scegli un servizio da cercare attorno a Colonia.")}
    <h3 style="margin-top:12px">Ingegneri della regione di Colonia</h3>
    ${engs.length ? `<table><thead><tr><th>Ingegnere</th><th>Base</th><th class="num">Da Colonia</th></tr></thead><tbody>${engs.map(engRow).join("")}</tbody></table>`
      : '<div class="empty">Coordinate degli ingegneri non ancora disponibili</div>'}
`;

  return `${panel("Bolla ↔ Colonia", head, { code: "COLONIA", aside: `<span class="tag">${ly(d.distance)} a ${esc(dest)}</span>` })}
    <div style="margin-top:18px">${panel("Passeggero a bordo", tripHtml, { code: "PASSENGER", aside: t?.active ? '<span class="tag gold">VIAGGIO IN CORSO</span>' : "" })}</div>
    <div class="grid even" style="margin-top:18px">
      <div class="col">
        ${panel("A · Con la tua nave (neutron highway)", shipOpt, { code: "NEUTRON" })}
        ${panel("B · Con il tuo fleet carrier", fcOpt, { code: "CARRIER" })}
      </div>
      <div class="col">
        ${panel("C · Passaggio su un carrier altrui", ride, { code: "RIDE" })}
        ${panel("Colonia: cosa sapere", info, { code: "INFO" })}
      </div>
    </div>`;
};

document.addEventListener("click", e => {
  const b = e.target.closest("[data-col-dest],[data-col-plan],[data-col-trip],[data-col-fc-plan],[data-col-svc]");
  if (!b || currentTab() !== "colonia") return;
  const d = b.dataset, st = UI.res.colStatus?.data;
  if ("colDest" in d) {
    UI.forms.colonia = { ...(UI.forms.colonia || {}), dest: d.colDest };
    delete UI.res.colPlanNeutron; delete UI.res.colPlanCarrier;
    colLoad(true);
  } else if (d.colPlan) {
    const tool = d.colPlan, key = tool === "neutron" ? "colPlanNeutron" : "colPlanCarrier";
    run(key, () => api("/api/colonia/plan", { tool, to: st?.destination, save: !!d.colSave }));
  } else if (d.colTrip) {
    if (d.colTrip === "stop" && !confirm(LANG.t("Terminare il viaggio in corso?"))) return;
    api("/api/colonia/trip", { action: d.colTrip, destination: d.colTrip === "start" ? st?.destination : undefined })
      .then(() => { toast(d.colTrip === "start" ? "Viaggio avviato" : "Fatto"); colLoad(true); })
      .catch(err => toast(err.message));
  } else if ("colFcPlan" in d) {
    UI.forms.carrier = { ...(UI.forms.carrier || {}), from: d.colFcPlan || S.location.system || "Sol", to: st?.destination || "Colonia" };
    location.hash = "#carrier";
  } else if (d.colSvc) {
    run("colSvc", () => api("/api/search", { mode: "service", service: d.colSvc, reference: "Colonia", max_dist: 1500, no_carriers: true }));
  }
});
