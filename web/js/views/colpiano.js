// Colonizzazione > Piano del sistema: strutture da costruire corpo per corpo, construction points, effetti sul sistema,
// merci stimate, cantieri del sistema letti dal journal e codice da passare ad altri giocatori.
// Dati e regole: Raven Colonial (GPL-3.0), scaricati quando servono (app/colonisation_data.py); calcoli in web/js/colplan.js.
// Corpi del sistema: Spansh (/api/colonisation/system_bodies). I piani restano nel browser (localStorage ed_col_plans).
// Che le strutture di superficie vadano su corpi atterrabili e quelle orbitali in orbita: wiki della community,
// pagina System_Colonisation (letta il 10/11/2026), già citata in colonizzazione.js.

const COLP_ECO = { agriculture: "Agriculture", service: "Service", extraction: "Extraction", hightech: "High Tech", industrial: "Industrial",
  military: "Military", tourism: "Tourism", refinery: "Refinery", colony: "Colony", terraforming: "Terraforming" };
const COLP_EFFECT = { pop: "Population", mpop: "Max population", sec: "Security", wealth: "Wealth", tech: "Tech level",
  sol: "Standard of living", dev: "Development level" };
const COLP_CLASS = { starport: "Starport", outpost: "Outpost", installation: "Installation", settlement: "Settlement", hub: "Hub" };
const COLP_STATUS = { plan: "Da fare", build: "In costruzione", done: "Finita" };

function colPlans() {
  try { return JSON.parse(localStorage.getItem("ed_col_plans")) || {}; } catch (e) { return {}; }
}
function colSavePlan(plan) {
  const all = colPlans();
  if (plan.sites.length) all[plan.system.toLowerCase()] = plan; else delete all[plan.system.toLowerCase()];
  try { localStorage.setItem("ed_col_plans", JSON.stringify(all)); } catch (e) {}
}
function colPlanSystem() {
  if (!UI.colPlanSys) {
    const saved = Object.values(colPlans());
    const depotSys = (UI.colDepots?.data?.depots || []).find(d => d.system)?.system;
    UI.colPlanSys = saved[0]?.system || depotSys || S?.location?.system || "";
  }
  return UI.colPlanSys;
}
function colPlanGet(sysName) {
  return colPlans()[String(sysName).toLowerCase()] || { system: sysName, sites: [] };
}

UI.colBodies = UI.colBodies || {};
function colLoadBodies(sysName) {
  const k = sysName.toLowerCase();
  if (!sysName || UI.colBodies[k]) return;
  UI.colBodies[k] = { loading: true };
  api(`/api/colonisation/system_bodies?system=${encodeURIComponent(sysName)}`)
    .then(d => { UI.colBodies[k] = { data: d }; })
    .catch(e => { UI.colBodies[k] = { data: { bodies: [], error: e.message } }; })
    .finally(() => { if (currentTab() === "coriolis_station" && UI.colMode === "plan") renderView(); });
}

const colpBodyLabel = b => [b.name, b.subtype, b.landable ? LANG.t("atterrabile") : "", b.dist_ls != null ? `${num(b.dist_ls)} ls` : ""].filter(Boolean).join(" · ");
const colpCargoSum = s => Object.values(s?.cargo || {}).reduce((a, b) => a + b, 0);
const colpSigned = v => v > 0 ? `+${v}` : String(v);

// Dati delle strutture: dal server, che li scarica da Raven Colonial alla prima apertura e li tiene in cache.
function colLoadSiteData() {
  if (UI.colSiteData?.loading || window.COLONISATION_DATA?.sites?.length) return;
  UI.colSiteData = { loading: true };
  api("/api/colonisation/site_data")
    .then(d => { if (d.sites?.length) window.COLONISATION_DATA = d; UI.colSiteData = { error: d.error }; })
    .catch(e => { UI.colSiteData = { error: e.message }; })
    .finally(() => { if (currentTab() === "coriolis_station" && UI.colMode === "plan") renderView(); });
}

// Consigli: cosa costruire per un obiettivo (resa per tonnellata) e strada con meno merci per uno starport T3.
// Conti in ColPlan.advise / ColPlan.pathToT3 (web/js/colplan.js), solo sui dati di Raven Colonial.
function colAdvicePanel(plan, surfaceOk) {
  const goal = UI.colGoal || "t3";
  const tabs = `<div class="seg-choice">${["t3", ...ColPlan.EFFECTS].map(k =>
    `<button class="small ${k === goal ? "primary" : ""}" data-colp-goal="${k}">${k === "t3" ? LANG.t("Strada al T3") : COLP_EFFECT[k]}</button>`).join("")}</div>`;
  const kind = s => `${COLP_CLASS[s.cls]} T${s.tier} · ${LANG.t(s.orbital ? "orbitale" : "superficie")}`;
  const note = `<p class="sub">Merci: medie raccolte dai giocatori (Raven Colonial), quindi una stima.${surfaceOk === false ? " Il sistema non ha corpi atterrabili: strutture di superficie escluse." : ""} I posti liberi su ogni corpo qui non si vedono: controllali nella vista Architect.</p>`;
  let body;
  if (goal === "t3") {
    const t3 = ColPlan.sites().filter(s => s.cls === "starport" && s.tier === 3 && (s.orbital || surfaceOk !== false));
    const key = t3.some(s => s.key === UI.colT3) ? UI.colT3 : "apollo";
    const r = ColPlan.pathToT3(plan, key, surfaceOk);
    const pick = `<div class="form"><label class="grow-1">Starport da raggiungere<select id="col-plan-t3">${t3.map(s => opt(s.key, s.name2, key)).join("")}</select></label></div>`;
    body = pick + (r.free ? `<p>La prima struttura del piano è il primary port e non costa construction points: puoi mettere subito ${esc(r.target.name2)} come primary port.</p>`
      : !r.need ? `<p class="ok">Il piano dà già i punti T3 per ${esc(r.target.name2)} (${r.cost.count} T3): aggiungilo in fondo.</p>`
      : !r.steps ? `<p class="bad">Con le strutture possibili in questo sistema non si arriva ai punti T3 che servono.</p>`
      : `<p>Per ${esc(r.target.name2)} servono ${r.cost.count} punti T3, al piano ne mancano ${r.need}. La strada con meno merci:</p>
        <table><thead><tr><th>Struttura</th><th class="num">Quante</th><th class="num">Costo</th><th class="num">Dà</th><th class="num">Merci (t)</th></tr></thead><tbody>${r.steps.map(st =>
          `<tr><td><b class="gold">${esc(st.site.name2)}</b><div class="sub">${esc(kind(st.site))}</div></td><td class="num">${st.n}</td>
            <td class="num">${st.site.needs[1] ? `${st.n * st.site.needs[1]} T${st.site.needs[0]}` : "—"}</td>
            <td class="num ok">${st.n * st.site.gives[1]} T${st.site.gives[0]}</td><td class="num">${num(st.n * colpCargoSum(st.site))}</td></tr>`).join("")}
          <tr><td><b>Totale</b></td><td></td><td></td><td></td><td class="num gold">${num(r.tons)}</td></tr></tbody></table>
        <p class="sub">Le strutture che danno punti T2 vanno costruite prima di quelle che li spendono. Escluse quelle con prerequisiti e gli starport T2, che danno 1 solo punto T3 e alzano il costo degli starport successivi.</p>
        <button class="primary" data-colp-addpath="${esc(key)}">Aggiungi al piano, con ${esc(r.target.name2)} in fondo</button>`);
  } else {
    const { picks, compare: cmp, lowers } = ColPlan.advise(plan, goal, surfaceOk);
    const neg = s => ColPlan.EFFECTS.filter(k => k !== goal && s.effects[k] < 0).map(k => `<span class="tag bad">${COLP_EFFECT[k]} ${s.effects[k]}</span>`).join("");
    const cost = p => p.primary ? `<span class="ok">${LANG.t("gratis")}</span>` : p.cost ? `<span class="${p.short ? "bad" : ""}">${p.cost.count} T${p.cost.tier}</span>` : "—";
    const top = picks.slice(0, 6);
    const eff = s => colpSigned(s.effects[goal] || 0);
    const compare = cmp.map(c => `<li><span class="sub">${esc(kind(c.best))}</span><div><b class="gold">${esc(c.best.name2)}</b> ${eff(c.best)} · ${num(colpCargoSum(c.best))} t${c.best.preReq ? ` <span class="sub">· ${LANG.t("richiede")} <span data-no-translate>${esc(c.best.preReq)}</span></span>` : ""}</div>
      <div class="sub">${esc(LANG.t("piuttosto che"))} ${c.worse.map(w => `${esc(w.name2)} ${eff(w)} · ${num(colpCargoSum(w))} t`).join(" — ")}</div></li>`).join("");
    body = !picks.length ? `<div class="empty">Nessuna struttura possibile alza ${esc(COLP_EFFECT[goal])}</div>`
      : `<table><thead><tr><th>Struttura</th><th class="num">${COLP_EFFECT[goal]}</th><th class="num">Merci (t)</th><th class="num">Ogni 100.000 t</th><th class="num">Costo</th><th>Abbassa</th></tr></thead><tbody>${top.map(p =>
          `<tr><td><b class="gold">${esc(p.site.name2)}</b><div class="sub">${esc(kind(p.site))}${p.site.preReq ? ` · ${LANG.t("richiede")} <span data-no-translate>${esc(p.site.preReq)}</span>` : ""}</div></td>
            <td class="num ok">+${p.gain}</td><td class="num">${num(p.tons)}</td><td class="num gold">${num(p.per100k)}</td><td class="num">${cost(p)}</td><td>${neg(p.site)}</td></tr>`).join("")}</tbody></table>
        ${top.some(p => p.short) ? `<p class="sub"><span class="bad">Costo in rosso</span>: aggiunta in fondo al piano partirebbe senza construction points sufficienti.</p>` : ""}
        ${compare ? `<div class="subpanel colp-gap"><h3>Ti consiglio</h3><p class="sub">Stesso tipo di posto: la prima dà di più e non chiede più merci delle altre.</p><ul>${compare}</ul></div>` : ""}
        ${lowers.length ? `<div class="subpanel colp-gap"><h3>Nel piano abbassano ${COLP_EFFECT[goal]}</h3><ul>${lowers.map(x =>
          `<li>${x.index + 1}. ${esc(x.site.name2)} <span class="bad">${x.site.effects[goal]}</span></li>`).join("")}</ul></div>` : ""}`;
  }
  return panel("Consigli", `${tabs}<div class="colp-gap">${body}</div>${note}`, { code: "ADVICE", aside: "calcoli sui dati di Raven Colonial" });
}

function colPlanView() {
  if (!window.COLONISATION_DATA?.sites?.length) {
    if (!UI.colSiteData?.error) colLoadSiteData();
    return panel("Piano del sistema", UI.colSiteData?.error
      ? `<p class="bad">${esc(UI.colSiteData.error)}</p><button class="primary" data-colp-retry>Riprova</button>`
      : `<div class="empty">Scarico i dati delle strutture da Raven Colonial (solo la prima volta)…</div>`, { code: "PLAN" });
  }
  const sysName = colPlanSystem();
  const plan = colPlanGet(sysName);
  const ev = ColPlan.evaluate(plan);
  if (sysName) colLoadBodies(sysName);
  const br = UI.colBodies[sysName.toLowerCase()];
  const bodies = br?.data?.bodies || [];
  const bodyOf = name => bodies.find(b => b.name === name);
  const { cap } = colCargoShips(getCoriolisStation());
  const saved = Object.values(colPlans());
  const noAuto = 'autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false"';

  // --- sistema, piani salvati e codice da condividere ---
  const bodiesInfo = !sysName ? "" : br?.loading ? `<span class="sub">Carico i corpi da Spansh…</span>`
    : br?.data?.error ? `<span class="bad">${esc(br.data.error)}</span>`
    : `<span><b>Corpi</b>${num(bodies.length)}</span>${br?.data?.population ? `<span class="bad">Già abitato</span>` : ""}
       ${br?.data?.stations?.length ? `<span><b>Stazioni</b>${num(br.data.stations.length)}</span>` : ""}`;
  const head = panel("Piano del sistema", `
    <div class="form">
      <label class="grow-1">Sistema<input id="col-plan-sys" value="${esc(sysName)}" ${noAuto} placeholder="es. Synuefai ZA-L d9-57"></label>
      <button class="primary" data-colp-open>Apri</button>
    </div>
    ${saved.length ? `<div class="chips colp-gap"><span class="sub">Piani salvati</span><div class="seg-choice">${saved.map(p =>
      `<button class="small ${p.system.toLowerCase() === sysName.toLowerCase() ? "primary" : ""}" data-colp-pick="${esc(p.system)}">${esc(p.system)}</button>`).join("")}</div></div>` : ""}
    ${sysName ? `<div class="sys-meta"><span><b>Sistema</b>${sys(sysName)}</span>${bodiesInfo}</div>` : ""}
    <div class="subpanel colp-gap"><h3>Condividi il piano</h3>
      <p class="sub">Il codice contiene sistema, corpi, strutture e stato. Chi lo incolla qui ottiene una copia del piano: le modifiche successive non si aggiornano da sole.</p>
      <div class="form">
        ${plan.sites.length ? `<button data-copy="${esc(ColPlan.encode(plan))}">Copia codice del piano</button>` : ""}
        <label class="grow-1">Codice ricevuto<input id="col-plan-code" ${noAuto} placeholder="VWCOL1…"></label>
        <button data-colp-import>Importa</button>
        ${plan.sites.length ? `<button class="small danger" data-colp-clear>Elimina il piano</button>` : ""}
      </div>
    </div>`, { code: "PLAN", aside: "dati delle strutture: Raven Colonial" });

  // --- bilancio: punti, effetti, merci ---
  const done = ev.rows.filter(r => r.status === "done").length;
  const pts = t => `<span class="${ev.points[t] < 0 ? "bad" : ev.points[t] > 0 ? "ok" : ""}">${colpSigned(ev.points[t])}</span>`;
  const effRow = (label, e) => `<tr><td>${label}</td>${ColPlan.EFFECTS.map(k => `<td class="num ${(e[k] || 0) < 0 ? "bad" : (e[k] || 0) > 0 ? "ok" : "muted"}">${colpSigned(e[k] || 0)}</td>`).join("")}</tr>`;
  const ecoTags = Object.entries(ev.economies).sort((a, b) => b[1] - a[1]).map(([k, n]) => `<span class="tag">${esc(COLP_ECO[k] || k)} ${n}</span>`).join("");
  const balance = plan.sites.length ? panel("Bilancio del piano", `
    <div class="kv-grid">
      <div class="kv"><span>Punti T2</span>${pts(2)}<span class="sub">a piano completo</span></div>
      <div class="kv"><span>Punti T3</span>${pts(3)}<span class="sub">a piano completo</span></div>
      <div class="kv"><span>Strutture</span><span>${num(plan.sites.length)}</span><span class="sub">${num(done)} finite</span></div>
      <div class="kv"><span>Merci stimate</span><span class="gold">${num(ev.cargoTotal)} t</span><span class="sub">strutture non finite</span></div>
      <div class="kv"><span>Viaggi</span><span>${cap && ev.cargoTotal ? num(Math.ceil(ev.cargoTotal / cap)) : "—"}</span><span class="sub">${cap ? `con ${num(cap)} t di stiva` : "nessuna stiva nota"}</span></div>
    </div>
    ${ev.short ? `<p class="bad">Strutture che partono senza construction points sufficienti: ${ev.short}. Spostale più in basso o aggiungi prima strutture che ne danno.</p>` : ""}
    <div class="subpanel colp-gap"><h3>Effetti sul sistema</h3>
      <table><thead><tr><th></th>${ColPlan.EFFECTS.map(k => `<th class="num">${COLP_EFFECT[k]}</th>`).join("")}</tr></thead>
        <tbody>${effRow("Strutture finite", ev.effects)}${effRow("A piano completo", ev.planned)}</tbody></table>
      ${ecoTags ? `<div class="colp-gap"><span class="sub">Economie delle strutture finite</span> ${ecoTags}</div>` : ""}
    </div>`, { code: "POINTS", aside: "regole e valori: Raven Colonial" }) : "";

  // --- strutture in ordine di costruzione ---
  const all = ColPlan.sites();
  const typeOptions = cur => Object.entries(COLP_CLASS).map(([cls, label]) => `<optgroup label="${label}">${all.filter(s => s.cls === cls)
    .map(s => opt(s.key, `${s.name2} · T${s.tier} · ${LANG.t(s.orbital ? "orbitale" : "superficie")}`, cur)).join("")}</optgroup>`).join("");
  const bodyOptions = cur => `${opt("", "—", cur)}${bodies.map(b => opt(b.name, colpBodyLabel(b), cur)).join("")}${cur && !bodyOf(cur) ? opt(cur, cur, cur) : ""}`;
  const rowHtml = r => {
    const s = r.site, b = bodyOf(r.body), last = r.index === plan.sites.length - 1;
    const warn = [];
    if (r.short) warn.push(`<span class="tag bad">punti insufficienti</span>`);
    if (s && b && !s.orbital && !b.landable) warn.push(`<span class="tag bad">corpo non atterrabile</span>`);
    const info = s ? [`${COLP_CLASS[s.cls]} T${s.tier}`, s.pad !== "none" ? `pad ${s.pad}` : "", COLP_ECO[s.fixed || s.inf] || "",
      s.preReq ? LANG.t("richiede") : ""].filter(Boolean).join(" · ") : "";
    return `<tbody><tr class="${r.status === "build" ? "hot" : ""}">
        <td class="num">${r.index + 1}</td>
        <td><select data-colp-field="type" data-i="${r.index}">${typeOptions(r.type)}</select></td>
        <td>${bodies.length ? `<select data-colp-field="body" data-i="${r.index}">${bodyOptions(r.body)}</select>` : esc(r.body || "—")}</td>
        <td><select data-colp-field="status" data-i="${r.index}">${ColPlan.STATUSES.map(k => opt(k, LANG.t(COLP_STATUS[k]), r.status)).join("")}</select></td>
        <td class="num ${r.short ? "bad" : ""}">${r.cost ? `${r.cost.count} T${r.cost.tier}` : "—"}</td>
        <td class="num ok">${s && s.gives[1] ? `${s.gives[1]} T${s.gives[0]}` : "—"}</td>
        <td class="num">${colpCargoSum(s) ? num(colpCargoSum(s)) : "—"}</td>
        <td class="num"><button class="small ghost" data-colp-move="-1" data-i="${r.index}" ${r.index ? "" : "disabled"} title="Sposta su">↑</button>
          <button class="small ghost" data-colp-move="1" data-i="${r.index}" ${last ? "disabled" : ""} title="Sposta giù">↓</button>
          <button class="small ghost" data-colp-del="${r.index}" title="Togli dal piano">✕</button></td></tr>
      <tr><td></td><td colspan="7" class="sub">${r.primary ? `<span class="tag">Primary port</span> ` : ""}${esc(info)}${s?.preReq ? ` <span data-no-translate>${esc(s.preReq)}</span>` : ""} ${warn.join("")}${s?.unlocks.length ? `<div>${s.unlocks.map(esc).join(" · ")}</div>` : ""}</td></tr></tbody>`;
  };
  const nw = UI.colPlanNew || {};
  const addForm = `<div class="form colp-gap">
      <label class="grow-1">Struttura<select id="col-plan-type">${typeOptions(nw.type || (plan.sites.length ? "plutus" : "no_truss"))}</select></label>
      <label class="grow-1">Corpo${bodies.length ? `<select id="col-plan-body">${bodyOptions(nw.body || "")}</select>` : `<input id="col-plan-body" ${noAuto} placeholder="es. A 5">`}</label>
      <button class="primary" data-colp-add>Aggiungi al piano</button>
    </div>`;
  const sitesPanel = panel("Strutture in ordine di costruzione", (plan.sites.length
    ? `<table class="colp-plan"><thead><tr><th class="num">#</th><th>Struttura</th><th>Corpo</th><th>Stato</th><th class="num">Costo</th><th class="num">Dà</th>
        <th class="num">Merci (t)</th><th class="num">Azioni</th></tr></thead>${ev.rows.map(rowHtml).join("")}</table>`
    : `<div class="empty">Nessuna struttura nel piano: la prima che aggiungi è il primary port del sistema</div>`) + addForm,
    { code: "SITES", aside: `${num(plan.sites.length)} strutture` });

  // --- merci stimate ---
  const cargo = Object.entries(ev.cargo).sort((a, b) => b[1] - a[1]);
  const cargoPanel = cargo.length ? panel("Merci stimate da portare", `
    <p class="sub">Medie raccolte dai giocatori su cantieri veri (Raven Colonial): sono una stima. Le quantità esatte le dà il gioco quando attracchi al cantiere, e la scheda Cantiere le segue da sola.</p>
    <table><thead><tr><th>Commodity</th><th class="num">Stima (t)</th><th class="num">Viaggi</th></tr></thead><tbody>${cargo.map(([n, q]) =>
      `<tr><td><b class="gold">${esc(T("commodity", n))}</b>${T("commodity", n) !== n ? `<div class="sub">${esc(n)}</div>` : ""}</td><td class="num">${num(q)}</td><td class="num">${cap ? num(Math.ceil(q / cap)) : "—"}</td></tr>`).join("")}</tbody></table>`,
    { code: "CARGO", aside: `${num(ev.cargoTotal)} t · stima` }) : "";

  // --- cantieri del sistema letti dal journal ---
  const depots = (UI.colDepots?.data?.depots || []).filter(d => (d.system || "").toLowerCase() === sysName.toLowerCase());
  const depotsPanel = depots.length ? panel("Cantieri nel sistema", `<table><thead><tr><th>Cantiere</th><th class="num">Avanzamento</th><th class="num">Mancano</th><th class="num"></th></tr></thead><tbody>${depots.map(d => {
      const pct = Math.round((d.progress || 0) * 100);
      return `<tr><td><b class="gold">${esc(d.station || "Cantiere")}</b><div class="sub">${esc({ SpaceConstructionDepot: "Cantiere orbitale", PlanetaryConstructionDepot: "Cantiere planetario" }[d.station_type] || "")}
          ${d.complete ? '<span class="ok">completato</span>' : ""}${d.failed ? '<span class="bad">fallito</span>' : ""}</div></td>
        <td class="num">${pct}%${meter(pct, pct >= 100 ? "full" : "")}</td><td class="num">${num(d.remaining_total)} t</td>
        <td class="num"><button class="small" data-colp-depot="${esc(d.market_id)}">Apri</button></td></tr>`;
    }).join("")}</tbody></table>`, { code: "DEPOTS", aside: "dal journal" }) : "";

  const advice = colAdvicePanel(plan, br?.data && !br.data.error && bodies.length ? bodies.some(b => b.landable) : null);
  return `${head}${balance}${sitesPanel}${advice}${depotsPanel}${cargoPanel}`;
}

// --- scelta tra cantiere e piano ---
const colSiteView = VIEWS.coriolis_station;
VIEWS.coriolis_station = () => {
  const plan = UI.colMode === "plan";
  const dr = UI.colDepots;
  if (plan && (!dr || (!dr.loading && Date.now() - (dr.at || 0) > 15000))) colLoadDepots();
  return `<div class="col"><div class="seg-choice">
      <button class="${plan ? "" : "primary"}" data-col-mode="site">Cantiere</button>
      <button class="${plan ? "primary" : ""}" data-col-mode="plan">Piano del sistema</button></div>
    ${plan ? colPlanView() : colSiteView()}</div>`;
};

// --- azioni ---
function colEditPlan(fn) {
  const plan = colPlanGet(colPlanSystem());
  fn(plan.sites, plan);
  colSavePlan(plan);
  renderView();
}
document.addEventListener("click", e => {
  const t = e.target.closest("[data-col-mode], [data-colp-open], [data-colp-pick], [data-colp-add], [data-colp-move], [data-colp-del], [data-colp-import], [data-colp-clear], [data-colp-depot], [data-colp-retry], [data-colp-goal], [data-colp-addpath]");
  if (!t || t.disabled) return;
  const d = t.dataset;
  if (d.colpGoal) {
    UI.colGoal = d.colpGoal;
    renderView();
  } else if (d.colpAddpath) {
    const plan = colPlanGet(colPlanSystem());
    const bodies = UI.colBodies[plan.system.toLowerCase()]?.data?.bodies || [];
    const r = ColPlan.pathToT3(plan, d.colpAddpath, bodies.length ? bodies.some(b => b.landable) : null);
    if (!r.steps) return;
    colEditPlan(s => {
      for (const st of r.steps) for (let i = 0; i < st.n; i++) s.push({ body: "", type: st.site.key, status: "plan" });
      s.push({ body: "", type: r.target.key, status: "plan" });
    });
  } else if (d.colMode) {
    UI.colMode = d.colMode;
    renderView();
  } else if (d.colpOpen != null || d.colpPick != null) {
    const name = (d.colpPick ?? $("col-plan-sys")?.value ?? "").trim();
    if (!name) { toast("Scrivi il nome del sistema"); return; }
    UI.dirty.delete("col-plan-sys");
    UI.colPlanSys = colPlans()[name.toLowerCase()]?.system || name;
    renderView();
  } else if (d.colpAdd != null) {
    const type = $("col-plan-type")?.value, body = ($("col-plan-body")?.value || "").trim().slice(0, 80);
    if (!ColPlan.site(type)) return;
    UI.dirty.delete("col-plan-body");
    UI.colPlanNew = { body };
    colEditPlan(s => s.push({ body, type, status: "plan" }));
  } else if (d.colpMove) {
    const i = +d.i, j = i + +d.colpMove;
    colEditPlan(s => { if (s[i] && s[j]) [s[i], s[j]] = [s[j], s[i]]; });
  } else if (d.colpDel != null) {
    colEditPlan(s => s.splice(+d.colpDel, 1));
  } else if (d.colpImport != null) {
    let p;
    try { p = ColPlan.decode($("col-plan-code")?.value); } catch (err) { toast(LANG.t("Codice non valido") + ": " + LANG.t(err.message)); return; }
    if (colPlans()[p.system.toLowerCase()] && !confirm(LANG.t(`Sostituire il piano già salvato per ${p.system}?`))) return;
    UI.dirty.delete("col-plan-code");
    colSavePlan(p);
    UI.colPlanSys = p.system;
    toast(LANG.t(`Piano importato: ${p.sites.length} strutture`));
    renderView();
  } else if (d.colpClear != null) {
    if (confirm(LANG.t(`Eliminare il piano di ${colPlanSystem()}?`))) colEditPlan(s => s.splice(0));
  } else if (d.colpRetry != null) {
    UI.colSiteData = null;
    renderView();
  } else if (d.colpDepot != null) {
    UI.colMode = "site";
    UI.colSource = d.colpDepot;
    renderView();
  }
});
document.addEventListener("change", e => {
  const t = e.target;
  if (t.id === "col-plan-t3") {
    UI.colT3 = t.value;
    renderView();
  } else if (t.id === "col-plan-type" || t.id === "col-plan-body") {
    UI.colPlanNew = { ...(UI.colPlanNew || {}), [t.id === "col-plan-type" ? "type" : "body"]: t.value };
  } else if (t.dataset?.colpField) {
    const i = +t.dataset.i, f = t.dataset.colpField;
    colEditPlan(s => { if (s[i]) s[i][f] = t.value; });
  }
});
