"use strict";

// ============================================================================
// ROTTE: tutti i plotter di Spansh, con avanzamento automatico della rotta attiva
// ============================================================================
const TOOLS = {
  neutron: { label: "Neutroni", title: "Plotter a neutroni",
    desc: "La rotta più rapida: sfrutta le stelle di neutroni, che caricano l'FSD al 400%.", fields: ["from", "to", "range", "efficiency"] },
  galaxy: { label: "Rotta esatta", title: "Galaxy Plotter (rotta esatta)",
    desc: "Calcolata salto per salto sul tuo FSD reale: ti dice dove rifornirti, dove ci sono neutroni e quando serve un'iniezione FSD.",
    fields: ["from", "to", "ship", "cargo", "galaxy"] },
  riches: { label: "Road to Riches", title: "Road to Riches",
    desc: "Pianeti di alto valore da scansionare e mappare lungo il percorso.", fields: ["from", "to", "range", "radius", "max_results", "max_distance", "min_value", "loop"], min: 300000 },
  exobio: { label: "Esobiologia", title: "Rotta esobiologica",
    desc: "Pianeti con le specie biologiche più remunerative da campionare.", fields: ["from", "to", "range", "radius", "max_results", "max_distance", "min_value", "loop"], min: 5000000 },
  earthlike: { label: "Mondi terrestri", title: "Rotta dei mondi terrestri",
    desc: "Mondi terrestri (ELW) e d'acqua: i corpi più preziosi da mappare.", fields: ["from", "to", "range", "radius", "max_results", "max_distance", "loop"] },
  ammonia: { label: "Mondi d'ammoniaca", title: "Rotta dei mondi d'ammoniaca",
    desc: "Mondi d'ammoniaca: valgono molto e sono rari.", fields: ["from", "to", "range", "radius", "max_results", "max_distance", "loop"] },
  rocky: { label: "Rocciosi e metallici", title: "Rotta di pianeti rocciosi e metallici",
    desc: "Pianeti rocciosi e ad alto contenuto metallico, spesso terraformabili.", fields: ["from", "to", "range", "radius", "max_results", "max_distance", "loop"] },
  tourist: { label: "Turistico", title: "Pianificatore turistico",
    desc: "Visita più sistemi nell'ordine più efficiente.", fields: ["from", "destinations", "final", "range", "loop"] },
  carrier: { label: "Fleet carrier", title: "Rotta per fleet carrier",
    desc: "Salti del carrier (fino a 500 al) con il trizio necessario e dove rifornirsi.", fields: ["from", "carrier_to", "capacity_used"] },
};
const BODY_TOOLS = ["riches", "exobio", "earthlike", "ammonia", "rocky"];
// Esobiologia "da scoprire": pianeti senza specie registrate su Spansh, con la previsione delle specie (app/spansh.py exobio_predict).
const EXO_PREDICT = { desc: "Pianeti con segnali biologici dove nessuno ha ancora registrato le specie: specie possibili e valore sono una previsione dalle condizioni del pianeta.",
  fields: ["from", "range", "area", "max_results", "max_distance", "min_value", "loop"] };

function routeState() {
  if (!ROUTE?.jumps?.length || !S) return null;
  const idx = ROUTE.jumps.findIndex(j => j.system === S.location.system);
  const pos = S.location.star_pos;
  // Se non sei su un waypoint, prendi quello più vicino come riferimento.
  let here = idx;
  if (here < 0 && pos) {
    let best = Infinity;
    ROUTE.jumps.forEach((j, i) => { const d = dist3(pos, j.pos); if (d < best) { best = d; here = i; } });
    if (best > 2 * (ROUTE.range || 60)) here = -1;
  }
  const nextIdx = Math.min(ROUTE.jumps.length - 1, here + 1);
  const left = ROUTE.jumps.slice(nextIdx).reduce((a, j) => a + (j.jumps || 0), 0);
  return { idx, here, nextIdx, next: ROUTE.jumps[nextIdx], left, done: idx === ROUTE.jumps.length - 1 };
}

// Navi utilizzabili per la rotta esatta: quelle della flotta con build e la build aperta nel cantiere.
function shipChoices() {
  const out = [];
  if (UI.cfg && CATALOG) out.push(["cfg", `Cantiere: ${CATALOG.ships[UI.cfg.ship]?.name || "build"}`]);
  for (const f of S.fleet) if (f.build && CATALOG?.journal_ships[f.symbol]) out.push(["ship-" + f.id, `${f.name?.trim() || f.type}${f.current ? " (attuale)" : ""}`]);
  return out;
}
function fsdFor(choice) {
  if (!CATALOG) return null;
  let cfg = null;
  if (choice === "cfg") cfg = UI.cfg;
  else {
    const f = S.fleet.find(x => "ship-" + x.id === choice) || S.fleet.find(x => x.current && x.build);
    if (f?.build) cfg = ShipCalc.fromLoadout(CATALOG, f.symbol, f.build.raw);
  }
  return cfg ? ShipCalc.compute(CATALOG, cfg).fsd : null;
}

function routeField(tool, name) {
  const f = "rt-" + tool, jr = S.ship.jump_range ? S.ship.jump_range.toFixed(2) : "";
  switch (name) {
    case "from": return inp(f, "from", "Partenza", "", `placeholder="${esc(S.location.system || "")}"`);
    case "to": return inp(f, "to", tool === "neutron" || tool === "galaxy" ? "Destinazione" : "Destinazione (facoltativa)", "",
      tool === "neutron" || tool === "galaxy" ? 'required placeholder="es. Colonia"' : 'placeholder="vuoto = giro ad anello"');
    case "range": return inp(f, "range", "Salto (al)", "", `type="number" step="0.01" placeholder="${jr}" style="width:100px"`);
    case "efficiency": return `<label>Efficienza<select name="efficiency">${[[40, "40% (più neutroni)"], [60, "60% (bilanciata)"], [80, "80% (più diretta)"], [100, "100%"]].map(([v, l]) => opt(v, l, fv(f, "efficiency", 60))).join("")}</select></label>`;
    case "radius": return inp(f, "radius", "Raggio (al)", "25", 'type="number" style="width:90px"');
    case "area": return inp(f, "area", "Raggio dalla partenza (al)", "100", 'type="number" style="width:90px"');
    case "max_results": return inp(f, "max_results", "Sistemi max", "50", 'type="number" style="width:90px"');
    case "max_distance": return inp(f, "max_distance", "Max ls dall'arrivo", "5000", 'type="number" style="width:120px"');
    case "min_value": return inp(f, "min_value", "Valore minimo (Cr)", String(TOOLS[tool].min || 1), 'type="number" style="width:140px"');
    case "loop": return chk(f, "loop", true, "Torna al punto di partenza");
    case "destinations": return `<label class="grow-1">Sistemi da visitare (uno per riga)<textarea name="destinations" rows="3" style="font:inherit;background:var(--inset);color:var(--text);border:1px solid var(--hud-line);padding:7px 11px">${esc(fv(f, "destinations", ""))}</textarea></label>`;
    case "final": return inp(f, "to", "Destinazione finale (facoltativa)", "");
    case "carrier_to": return inp(f, "to", "Destinazione del carrier", "", 'required placeholder="es. Colonia"');
    case "capacity_used": return inp(f, "capacity_used", "Stiva occupata (t)", "0", 'type="number" style="width:120px"');
    case "cargo": return inp(f, "cargo", "Carico (t)", "0", 'type="number" style="width:90px"');
    case "ship": {
      const choices = shipChoices();
      return choices.length ? `<label>Nave<select name="ship">${choices.map(([v, l]) => opt(v, l, fv(f, "ship", choices.find(c => c[1].includes("attuale"))?.[0] || choices[0][0]))).join("")}</select></label>`
        : '<span class="sub">Caricamento del catalogo navi…</span>';
    }
    case "galaxy": return `${chk(f, "use_neutrons", true, "Usa i neutroni")}${chk(f, "injections", false, "Usa le iniezioni FSD")}
      ${chk(f, "exclude_secondary", false, "Escludi stelle secondarie")}${chk(f, "refuel_every", false, "Rifornisciti a ogni stella scoopabile")}
      <label>Algoritmo<select name="algorithm">${[["optimistic", "Ottimista (veloce)"], ["fuel", "Risparmio carburante"], ["fuel_jumps", "Carburante + salti"], ["guided", "Guidato"], ["pessimistic", "Pessimista"]].map(([v, l]) => opt(v, l, fv(f, "algorithm", "optimistic"))).join("")}</select></label>`;
  }
  return "";
}

function hopBadges(j) {
  const b = [];
  if (j.neutron) b.push('<span class="neutron">◉ NEUTRONI</span>');
  if (j.refuel) b.push('<span class="tag new">rifornimento</span>');
  if (j.inject) b.push('<span class="tag tf">iniezione FSD</span>');
  if (j.waypoint) b.push('<span class="tag solid">tappa</span>');
  if (j.restock) b.push(`<span class="tag new">rifornisci ${num(j.restock_amount)} t di trizio</span>`);
  if (j.icy_ring && j.pristine) b.push('<span class="tag tf">anello ghiacciato intatto</span>');
  return b.join(" ");
}
function hopBodies(j) {
  if (!j.bodies?.length) return "";
  return `<div style="grid-column:2 / -1;margin:2px 0 4px">${j.bodies.map(b => b.predicted ? predictedBody(j, b) : `<div class="mat-line" style="grid-template-columns:1fr auto;font-size:13px">
    <span><b>${esc(b.name.replace(j.system, "").trim() || b.name)}</b> <span class="sub">${esc(T("body", b.type))} · ${num(b.dist_ls)} ls${b.terraformable ? " · terraformabile" : ""}</span>
    ${b.species?.length ? `<div class="sub">${b.species.map(sp => `${esc(sp.name)} <span class="gold">${short(sp.value)}</span>`).join(" · ")}</div>` : ""}</span>
    <span class="mono gold">${short(b.species?.length ? b.bio_value : b.mapping)}</span></div>`).join("")}</div>`;
}

// Pianeta previsto: le specie possibili per genere ("?" = condizioni da verificare) e il valore base minimo-massimo.
function predictedBody(j, b) {
  return `<div class="mat-line" style="grid-template-columns:1fr auto;font-size:13px">
    <span><b>${esc(b.name.replace(j.system, "").trim() || b.name)}</b> <span class="sub">${esc(T("body", b.type))} · ${num(b.dist_ls)} ls · ${b.signals} ${b.signals === 1 ? "segnale" : "segnali"}${b.dss ? " · generi rilevati" : ""}</span>
    ${b.genera.map(g => `<div class="sub">${g.species.map(sp => `${esc(sp.name)}${sp.sure ? "" : "?"} <span class="gold">${short(sp.value)}</span>`).join(" · ")}</div>`).join("")}</span>
    <span class="mono gold">${b.bio_min === b.bio_max ? short(b.bio_max) : `${short(b.bio_min)}–${short(b.bio_max)}`}</span></div>`;
}

// --- Rischi della rotta (dati da /api/fuel, vedi app/fuel.py; caricamento in fuelrats.js) ---------------------
const RISK_KIND = { neutron: "◉ neutroni", white_dwarf: "◉ nana bianca", black_hole: "● buco nero" };
function riskBlock(title, r) {
  if (!r) return "";
  const risks = r.risks?.length ? `<ul class="risk-list">${r.risks.map(x => `<li class="${x.level}">${x.level === "bad" ? "▲ " : ""}${esc(x.text)}</li>`).join("")}</ul>`
    : '<ul class="risk-list"><li class="ok">Nessun rischio trovato: tutte le stelle sono rifornibili.</li></ul>';
  const nx = r.next_scoopable;
  const head = r.fuel_total !== undefined ? `<div class="kv-grid" style="margin-bottom:8px">
      <div class="kv"><span>Salti</span><span class="big">${r.jumps ?? "—"}</span></div>
      <div class="kv"><span>Non rifornibili</span><span class="${r.non_scoopable ? "bad" : "ok"} big">${r.non_scoopable ?? "—"}</span></div>
      <div class="kv"><span>Prossima rifornibile</span><span>${nx ? `${sys(nx.system)} <span class="sub">${nx.jumps} salti${nx.fuel_needed ? " · ~" + frT(nx.fuel_needed) : ""}</span>` : "—"}</span></div>
      ${r.worst_chain ? `<div class="kv"><span>Catena più lunga</span><span class="mono">${r.worst_chain.jumps} salti · ~${frT(r.worst_chain.fuel)}</span></div>` : ""}
    </div>` : "";
  const hops = (r.hops || []).filter(h => h.scoopable === false || h.kind || h.danger || h.too_far).slice(0, 25);
  const list = hops.length && r.fuel_total !== undefined ? `<div class="route-list" style="margin-top:8px;max-height:260px;overflow:auto">${hops.map(h => `<div class="hop">
      <span class="n">${esc(h.star || "?")}</span><span>${sys(h.system)} ${h.kind ? `<span class="tag tf">${RISK_KIND[h.kind]}</span>` : ""}${h.danger ? ' <span class="tag new">carburante insufficiente</span>' : ""}${h.too_far ? ' <span class="tag new">oltre il max per salto</span>' : ""}</span>
      <span class="mono ${h.scoopable === false ? "bad" : h.scoopable ? "ok" : "sub"}">${h.scoopable === false ? "✕" : h.scoopable ? "⛽" : "?"}${h.fuel_need != null ? " · " + frT(h.fuel_need) : ""}</span></div>`).join("")}</div>` : "";
  return `<div class="subpanel ${r.risks?.some(x => x.level === "bad") ? "bad" : "ok"}"><h3>${esc(title)}</h3>${head}${risks}${list}</div>`;
}
function routeRiskPanel() {
  if (typeof fuelLoad === "function") fuelLoad();
  const d = UI.res.fuel?.data;
  if (!d) return panel("Rischi della rotta", '<div class="loading">ANALISI DELLA ROTTA</div>', { code: "RISK" });
  const s = d.safety, f = d.fuel;
  const body = (s.ingame ? riskBlock("Rotta nella mappa galattica", s.ingame) : '<div class="subpanel"><h3>Rotta nella mappa galattica</h3><div class="empty">Nessuna rotta tracciata in gioco</div></div>')
    + (s.spansh ? riskBlock(`Rotta attiva (${(TOOLS[s.spansh.tool] || {}).label || s.spansh.tool})`, s.spansh) : "")
    // Una frase per <span>: ogni pezzo si traduce da solo (web/js/lang/en-activities.js).
    + `<div class="sub" style="margin-top:6px"><span>Carburante ${frT(f.main)} su ${frT(f.cap)}${d.star?.class ? ` · stella qui ${esc(d.star.class)} ${d.star.scoopable ? "(rifornibile)" : d.star.scoopable === false ? "(non rifornibile)" : ""}` : ""}.</span>
      <span>${esc(s.calc.note)}</span> <span>Margine di sicurezza ${num(s.calc.margin_pct)}%. Rifornibili: stelle K, G, B, F, O, A, M.</span>
      Se resti a secco, vedi la scheda <a href="#fuelrats">Fuel Rats</a>.</div>`;
  const bad = [s.ingame, s.spansh].some(r => r?.risks?.some(x => x.level === "bad"));
  return panel("Rischi della rotta", body, { code: "RISK", aside: bad ? '<span class="bad">ATTENZIONE</span>' : "" });
}

VIEWS.route = () => {
  const tool = UI.tool || "neutron", f = "rt-" + tool;
  const predict = tool === "exobio" && fv(f, "mode") === "predict", t = predict ? { ...TOOLS[tool], ...EXO_PREDICT } : TOOLS[tool];
  const modes = tool === "exobio" ? `<div class="chips"><span class="seg-choice">${[["known", "Specie già note"], ["predict", "Da scoprire, con previsione"]].map(([v, l]) =>
    `<button class="small ${(predict ? "predict" : "known") === v ? "primary" : ""}" data-exo-mode="${v}">${l}</button>`).join("")}</span></div>` : "";
  const tabs = `<div class="chips">${Object.entries(TOOLS).map(([k, v]) => `<button class="small ${k === tool ? "primary" : ""}" data-tool="${k}">${v.label}</button>`).join("")}</div>`;
  const form = `${tabs}${modes}<div class="eyebrow" style="margin-bottom:4px">${esc(t.title)}</div><div class="sub" style="margin-bottom:10px">${esc(t.desc)}</div>
    <form class="form" data-form="${f}" id="f-${f}" data-tool="${tool}">${t.fields.map(n => routeField(tool, n)).join("")}
      <button class="primary" type="submit" ${UI.res.route?.busy ? "disabled" : ""}>Calcola</button></form>
    <div style="margin-top:10px">${UI.res.route?.busy ? '<div class="loading">CALCOLO DELLA ROTTA IN CORSO</div>' : UI.res.route?.error ? `<div class="bad">⚠ ${esc(UI.res.route.error)}</div>` : ""}</div>
    ${predict ? `<div class="sub"><span>Questi pianeti sono già stati scansionati da qualcuno: niente prima scoperta.</span>
      <span>Il valore è quello base: il ×5 della prima impronta è possibile, ma Spansh non lo sa.</span>
      <span>Del sistema si conoscono solo le stelle madri del pianeta: le specie con ? dipendono da altre stelle o corpi e sono da verificare.</span></div>` : ""}
    ${BODY_TOOLS.includes(tool) ? '<div class="sub">Nella bolla abitata quasi tutto è già stato mappato: se non trovi nulla, aumenta il raggio o parti da una zona meno esplorata.</div>' : ""}`;

  let active = '<div class="empty">Nessuna rotta calcolata. Scegli uno strumento qui a fianco.</div>';
  const st = routeState();
  if (ROUTE && st) {
    const total = ROUTE.jumps.reduce((a, j) => a + (j.jumps || 0), 0);
    const pct = total ? (total - st.left) / total * 100 : 0;
    const kind = TOOLS[ROUTE.tool] || TOOLS.neutron;
    const extra = ROUTE.predicted ? `<div class="kv"><span>Valore previsto</span><span class="gold">${short(ROUTE.value_min)}–${short(ROUTE.value)} CR</span><span class="sub">${ROUTE.bodies} corpi · ×5 possibile</span></div>`
      : ROUTE.value ? `<div class="kv"><span>Valore stimato</span><span class="gold">${short(ROUTE.value)} CR</span><span class="sub">${ROUTE.bodies} corpi</span></div>`
      : ROUTE.tritium ? `<div class="kv"><span>Trizio necessario</span><span class="gold">${num(ROUTE.tritium)} t</span></div>` : "";
    const left = st.here >= 0 && ROUTE.jumps[st.here].distance_left != null ? ROUTE.jumps[st.here].distance_left : null;
    active = `<div class="grid even" style="gap:12px"><div>
        <div class="eyebrow">${esc(kind.title)} · ${st.done ? "arrivato" : "prossima tappa"}</div>
        <div class="display chroma glitchy" style="font-size:34px">${esc(st.done ? ROUTE.to : st.next.system)}</div>
        ${st.done ? "" : `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button class="primary" data-copy="${esc(st.next.system)}">⧉ Copia per la mappa</button>${hopBadges(st.next)}</div>`}
      </div><div class="kv-grid">
        <div class="kv"><span>Salti rimanenti</span><span class="big">${st.left}</span></div>
        ${left != null ? `<div class="kv"><span>Distanza rimanente</span><span>${ly(left)}</span></div>` : ""}
        <div class="kv"><span>Tappa</span><span>${st.nextIdx}/${ROUTE.jumps.length - 1}</span></div>
        <div class="kv"><span>Integrità FSD</span><span class="${S.fsd_health != null && S.fsd_health <= 80 ? "bad bold" : "ok"}">${S.fsd_health ?? 100}%</span></div>
        ${extra}
      </div></div>${seg(pct, 40)}
      ${S.fsd_health != null && S.fsd_health <= 80 ? `<div class="bad" style="margin-top:10px;padding:8px;border:1px solid #ff4444;background:rgba(255,0,0,0.1)">▲ ATTENZIONE FSD: integrità ${S.fsd_health}% (inferiore a 80%). Rischio malfunzionamento e drop dall'iperspazio! Effettua riparazione con AFMU prima del prossimo salto.</div>` : ""}
      <div class="route-list" style="margin-top:12px;max-height:560px;overflow:auto">${ROUTE.jumps.map((j, i) => `<div class="hop ${i < st.here ? "done" : i === st.here ? "here" : i === st.nextIdx ? "next" : ""}">
        <span class="n">${String(i).padStart(3, "0")}</span><span>${sys(j.system)} ${hopBadges(j)}</span>
        <span class="mono sub">${j.jumps > 1 ? j.jumps + " salti · " : ""}${j.distance_jumped ? ly(j.distance_jumped) : ""}${j.fuel != null ? ` · ${num(j.fuel)} t` : ""}</span>${hopBodies(j)}</div>`).join("")}</div>
      <div style="margin-top:10px;display:flex;gap:8px">${todoBtn(LANG.t(`Viaggio verso ${ROUTE.to}`), ROUTE.to, "Viaggi")}<button class="small ghost" id="route-clear">Cancella rotta</button></div>`;
  }
  return `<div class="grid"><div class="col">${panel("Rotta attiva", active, { cls: "holo", code: (ROUTE?.tool || "route").toUpperCase(), aside: ROUTE ? `${esc(ROUTE.from)} → ${esc(ROUTE.to)} · ${ROUTE.jumps.reduce((n, j) => n + (j.jumps || 0), 0)} salti` : "" })}
    <div style="margin-top:18px">${routeRiskPanel()}</div></div>
    <div class="col">${panel("Centro rotte", form, { code: "ROUTE-PLOT", aside: "tutti i tipi di rotta" })}
    ${panel("Rotta nella mappa di gioco", S.route.length ? `<div class="route-list">${S.route.slice(0, 15).map((j, i) => `<div class="hop"><span class="n">${String(i + 1).padStart(2, "0")}</span><span>${sys(j.StarSystem)}</span>
      <span class="mono ${j.scoopable ? "ok" : "bad"}">${esc(j.StarClass)} ${j.scoopable ? "⛽" : "✕"}</span></div>`).join("")}</div>` : '<div class="empty">Nessuna rotta tracciata in gioco</div>', { code: "GALMAP" })}</div></div>`;
};
