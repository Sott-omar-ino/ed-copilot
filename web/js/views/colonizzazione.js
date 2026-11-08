"use strict";

// ============================================================================
// COLONIZZAZIONE: cantieri (dati del journal o inseriti a mano), sistemi candidati, fornitori
// ============================================================================
// Le quantità vengono SOLO dal gioco (evento ColonisationConstructionDepot, vedi app/construction.py)
// oppure da quello che scrive il giocatore. Nessun valore predefinito inventato.

// Merci da costruzione usate nei cantieri, solo come suggerimenti per l'inserimento manuale (il testo libero è accettato).
// Fonte: "Colonization Construction Commodities List" (github.com/MikeCZ23/CCCL, giugno 2025), con i nomi
// controllati sull'elenco ufficiale delle merci EDCD/FDevIDs commodity.csv (08/11/2026). Il gioco resta la fonte:
// le quantità vere arrivano dall'evento ColonisationConstructionDepot.
const COL_COMMODITIES = [
  "Advanced Catalysers", "Agri-Medicines", "Aluminium", "Animal Meat", "Basic Medicines", "Battle Weapons", "Beer",
  "Bioreducing Lichen", "Building Fabricators", "CMM Composite", "Ceramic Composites", "Coffee", "Combat Stabilisers",
  "Computer Components", "Copper", "Crop Harvesters", "Emergency Power Cells", "Evacuation Shelter", "Fish",
  "Food Cartridges", "Fruit and Vegetables", "Geological Equipment", "Grain", "H.E. Suits", "Insulating Membrane",
  "Land Enrichment Systems", "Liquid oxygen", "Liquor", "Medical Diagnostic Equipment", "Micro Controllers",
  "Microbial Furnaces", "Military Grade Fabrics", "Mineral Extractors", "Muon Imager", "Non-Lethal Weapons",
  "Pesticides", "Polymers", "Power Generators", "Reactive Armour", "Resonating Separators", "Robotics",
  "Semiconductors", "Steel", "Structural Regulators", "Superconductors", "Surface Stabilisers", "Survival Equipment",
  "Tea", "Thermal Cooling Units", "Titanium", "Water", "Water Purifiers", "Wine"];
const COL_ALIASES = { "cmm composites": "CMM Composite", "cmm": "CMM Composite", "liquid oxygen": "Liquid oxygen", "lox": "Liquid oxygen",
  "micro-controllers": "Micro Controllers", "combat stabilizers": "Combat Stabilisers", "geothermal equipment": "Geological Equipment", "microcontrollers": "Micro Controllers", "aluminum": "Aluminium" };

// Valori finti delle versioni precedenti: se sono ancora quelli salvati, vengono scartati.
const COL_OLD_FAKE = { "CMM Composites": 8500, "Titanium": 6200, "Steel": 7800, "Aluminium": 4600, "Structural Regulators": 3400,
  "Power Generators": 2800, "Ceramic Composites": 3100, "Liquid Oxygen": 4200, "Polymers": 3600, "Water Purifiers": 2100,
  "Insulating Membrane": 2000, "Computer Components": 3400, "Micro-Controllers": 2200, "Superconductors": 2900,
  "Advanced Catalysers": 1600, "Robotics": 1400, "Medical Diagnostic Equipment": 900 };

function getCoriolisStation() {
  const curSys = S?.location?.system || "Sol";
  const def = { name: "", type: "coriolis", system: curSys, body: "", status: "construction", economy: "", faction: "",
    cargoShipCap: null, services: {}, materials: {} };
  try {
    const raw = localStorage.getItem("ed_coriolis_station");
    if (!raw) return def;
    const p = JSON.parse(raw);
    const materials = {};
    for (const [name, m] of Object.entries(p.materials || {})) {
      if (COL_OLD_FAKE[name] === m?.req) continue;  // numero inventato della vecchia versione
      if (m && m.req > 0) materials[name] = { req: m.req, done: m.done || 0 };
    }
    // Il vecchio nome predefinito era inventato.
    const name = p.name === "Stazione Coriolis Alpha" ? "" : p.name;
    const body = p.body === "Pianeta 3 - Anello Metallico A" ? "" : p.body;
    return { ...def, ...p, name: name || "", body: body || "", materials, services: { ...(p.services || {}) } };
  } catch (e) {
    return def;
  }
}

function saveCoriolisStation(cs) {
  try {
    localStorage.setItem("ed_coriolis_station", JSON.stringify(cs));
  } catch (e) {}
}

const colNorm = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
function colCanonical(name) {
  const n = String(name || "").trim().replace(/\s+/g, " ");
  const alias = COL_ALIASES[n.toLowerCase()];
  if (alias) return alias;
  const hit = COL_COMMODITIES.find(c => colNorm(c) === colNorm(n) || colNorm(c + "s") === colNorm(n));
  return hit || n;
}

// "Aluminium 12,555", "CMM Composite: 13.443 t", "12 555 Steel": righe incollate da un messaggio.
function parseColonisationList(text) {
  const out = [];
  for (const raw of String(text || "").split(/\r?\n|;/)) {
    const line = raw.replace(/[•·\-–*]\s+/g, " ").trim();
    if (!line) continue;
    const m = line.match(/(\d{1,3}(?:[.,'  ]\d{3})+|\d+)\s*(?:t\b|ton\w*)?/i);
    if (!m) continue;
    const qty = parseInt(m[1].replace(/[.,'  ]/g, ""), 10);
    const name = (line.slice(0, m.index) + " " + line.slice(m.index + m[0].length)).replace(/[:=]+|(^|\s)[x×](?=\s|$)/gi, " ").replace(/\s+/g, " ").trim();
    if (name && qty > 0) out.push({ name: colCanonical(name), qty });
  }
  return out;
}

// --- dati dei cantieri dal journal ------------------------------------------------
function colLoadDepots() {
  const cur = UI.colDepots;
  if (cur?.loading) return;
  UI.colDepots = { ...(cur || {}), loading: true };
  api("/api/colonisation/depots")
    .then(d => { UI.colDepots = { data: d, at: Date.now() }; })
    .catch(e => { UI.colDepots = { ...(cur || {}), error: e.message, at: Date.now() }; })
    .finally(() => { if (currentTab() === "coriolis_station") renderView(); });
}

// Dopo un errore di rete si aspetta un minuto prima di riprovare (invece di riprovare a ogni aggiornamento).
const RETRY_AFTER = 60000;
const retryBlocked = key => (UI.netFailures[key] || 0) > Date.now();
const markFailed = key => { UI.netFailures[key] = Date.now() + RETRY_AFTER; };

function renderCoriolisCandidatesHtml(curSys) {
  const cs = getCoriolisStation();
  const stType = cs.type || "coriolis";
  const cacheKey = `${curSys}_${stType}`;

  if (UI.lastCandidatesKey !== cacheKey) {
    UI.coriolisCandidates = null;
    UI.lastCandidatesKey = cacheKey;
  }

  if (!UI.coriolisCandidates) {
    if (retryBlocked("candidates")) {
      return `<div class="bad">⚠ La ricerca dei sistemi candidati non risponde. Riprovo tra un minuto.</div>`;
    }
    if (!UI.loadingCandidates) {
      UI.loadingCandidates = true;
      fetch(`/api/colonisation/candidate_systems?ref=${encodeURIComponent(curSys)}&type=${encodeURIComponent(stType)}`)
        .then(r => r.json())
        .then(data => {
          if (data.error) throw new Error(data.error);
          UI.coriolisCandidates = data.candidates || [];
          UI.candidatesLabel = data.station_label || "";
          UI.loadingCandidates = false;
          if (currentTab() === "coriolis_station") renderView();
        })
        .catch(() => {
          markFailed("candidates");
          UI.loadingCandidates = false;
          if (currentTab() === "coriolis_station") renderView();
        });
    }
    return `<div class="loading">Ricerca dei sistemi disabitati vicino a ${esc(curSys)}</div>`;
  }
  if (!UI.coriolisCandidates.length) {
    return `<div class="empty">Nessun sistema disabitato idoneo nelle vicinanze</div>`;
  }

  return `<div class="sub">Tipo di struttura: <b class="gold">${esc(UI.candidatesLabel || stType)}</b></div>
    <table><thead><tr><th>Sistema</th><th class="num">Distanza</th><th class="num">Corpi</th><th></th></tr></thead><tbody>
    ${UI.coriolisCandidates.slice(0, 6).map(c => `<tr><td>${sys(c.name)}${c.name === cs.system ? ' <span class="tag ok">cantiere qui</span>' : ""}</td>
      <td class="num">${ly(c.distance)}</td><td class="num">${num(c.body_count)}</td>
      <td class="num">${c.name !== cs.system ? `<button class="small" data-set-coriolis-sys="${esc(c.name)}">Scegli</button>` : ""}</td></tr>`).join("")}
    </tbody></table>`;
}

function getSystemColonisationEligibility(sysName) {
  if (!sysName) {
    return { eligible: null, status: "Sistema mancante", label: "Indica il sistema in cui vuoi avviare il cantiere.", cls: "muted" };
  }
  const norm = sysName.trim().toLowerCase();
  const curLoc = S?.location || {};
  const curSysNorm = (curLoc.system || "").trim().toLowerCase();

  if (norm === curSysNorm) {
    const pop = curLoc.population || 0;
    if (pop > 0) {
      return {
        eligible: false,
        status: "Già abitato",
        label: `${sysName} ha una popolazione (${num(pop)}): si può colonizzare solo un sistema disabitato.`,
        cls: "bad"
      };
    }
  }

  if (UI.coriolisCandidates && UI.coriolisCandidates.some(c => c.name.toLowerCase() === norm)) {
    return { eligible: true, status: "Idoneo", label: "Sistema disabitato tra i candidati trovati qui vicino.", cls: "ok" };
  }

  return { eligible: null, status: "Da verificare", label: `Usa la verifica qui accanto per controllare ${sysName}.`, cls: "muted" };
}


// ============================================================================
// FORNITORI PIÙ VICINI DELLE MERCI
// ============================================================================
UI.nearestSuppliers = UI.nearestSuppliers || {};
UI.loadingSuppliers = UI.loadingSuppliers || {};
UI.systemVerifications = UI.systemVerifications || {};
UI.loadingVerification = UI.loadingVerification || {};
UI.netFailures = UI.netFailures || {};
UI.customVerification = null;
UI.suppliersOrigin = UI.suppliersOrigin || "station"; // 'station' or 'ship'

function sanitizeCommSlug(str) {
  return (str || "").toLowerCase().replace(/[^a-z0-9]/g, "-");
}

function renderSupplierDetailsHtml(name, refSys) {
  const cleanRef = (refSys || "Sol").toLowerCase();
  const key = cleanRef + "_" + (name || "").toLowerCase();
  const sup = UI.nearestSuppliers[key];
  if (!sup) return `<span class="loading">Ricerca del mercato con pad L più vicino a ${esc(refSys)}</span>`;
  if (!sup.found) return `<span class="muted">Nessun mercato con pad L trovato vicino a ${esc(refSys)}</span>`;
  return `${sys(sup.system)} · ${esc(sup.station)} <span class="muted">(${sup.planetary ? "superficie" : "orbitale"}, pad L)</span>
    · <b class="gold">${ly(sup.distance)}</b> · <b class="ok">${num(sup.buy)} CR</b> · stock ${num(sup.supply)} t`;
}
const supplierLineHtml = (name, refSys) => `<span class="eyebrow">Più vicino</span> ${renderSupplierDetailsHtml(name, refSys)}`;

function loadNearestSuppliers(commodities, refSys) {
  if (!commodities || !commodities.length) return;
  const cleanRef = (refSys || "Sol").toLowerCase();
  const missing = commodities.filter(c => !UI.nearestSuppliers[cleanRef + "_" + c.toLowerCase()]);
  if (!missing.length || UI.loadingSuppliers[cleanRef] || retryBlocked("suppliers_" + cleanRef)) return;

  UI.loadingSuppliers[cleanRef] = true;
  fetch(`/api/colonisation/nearest_materials?ref=${encodeURIComponent(refSys)}&commodities=${encodeURIComponent(missing.join(","))}`)
    .then(r => r.json())
    .then(data => {
      UI.loadingSuppliers[cleanRef] = false;
      Object.entries(data).forEach(([commName, info]) => {
        UI.nearestSuppliers[cleanRef + "_" + commName.toLowerCase()] = info;
      });
      // Le merci senza risposta non vanno richieste di nuovo a ogni aggiornamento.
      missing.forEach(c => { UI.nearestSuppliers[cleanRef + "_" + c.toLowerCase()] ||= { commodity: c, found: false }; });
      commodities.forEach(c => {
        const el = document.getElementById("coriolis-supplier-" + sanitizeCommSlug(c));
        if (el) el.innerHTML = supplierLineHtml(c, refSys);
      });
    })
    .catch(() => {
      UI.loadingSuppliers[cleanRef] = false;
      markFailed("suppliers_" + cleanRef);
    });
}

// --- verifica di un sistema ---------------------------------------------------------
function colChecksTable(checks) {
  if (!checks?.length) return "";
  return `<table><thead><tr><th>Requisito</th><th>Valore</th><th>Esito</th></tr></thead><tbody>
    ${checks.map(c => `<tr><td>${esc(c.title)}<div class="sub">${esc(c.desc)}</div></td><td class="${c.ok ? "" : "bad"}">${esc(c.val)}</td>
      <td><span class="tag ${c.ok ? "ok" : "bad"}">${c.ok ? "ok" : "no"}</span></td></tr>`).join("")}</tbody></table>`;
}

function renderViaLiberaPanel(cs, curSys) {
  const sysName = cs.system || curSys;
  const ver = UI.systemVerifications[sysName.toLowerCase()];
  const reBtn = `<span class="aside"><button class="small" id="coriolis-reverify-btn" title="Ripeti la verifica">↻ Ricontrolla</button></span>`;

  if (!ver) {
    if (retryBlocked("verify_" + sysName.toLowerCase())) {
      return `<div id="coriolis-via-libera-panel" class="subpanel bad"><h3>Verifica di ${esc(sysName)}${reBtn}</h3>
        <div class="bad">⚠ Verifica non riuscita (nessuna risposta). Riprovo tra un minuto.</div></div>`;
    }
    if (!UI.loadingVerification[sysName.toLowerCase()]) {
      UI.loadingVerification[sysName.toLowerCase()] = true;
      fetch(`/api/colonisation/verify_system?system=${encodeURIComponent(sysName)}&ref=${encodeURIComponent(curSys)}&type=${encodeURIComponent(cs.type || "coriolis")}`)
        .then(r => r.json())
        .then(data => {
          UI.loadingVerification[sysName.toLowerCase()] = false;
          UI.systemVerifications[sysName.toLowerCase()] = data;
          const box = document.getElementById("coriolis-via-libera-panel");
          if (box) box.outerHTML = renderViaLiberaPanel(cs, curSys);
        })
        .catch(() => {
          UI.loadingVerification[sysName.toLowerCase()] = false;
          markFailed("verify_" + sysName.toLowerCase());
        });
    }
    return `<div id="coriolis-via-libera-panel" class="subpanel"><h3>Verifica di ${esc(sysName)}</h3>
      <div class="loading">Controllo dei requisiti</div></div>`;
  }

  if (!ver.found) {
    return `<div id="coriolis-via-libera-panel" class="subpanel bad"><h3>Verifica di ${esc(sysName)}${reBtn}</h3>
      <div class="bad">⚠ ${esc(ver.error || "Sistema non trovato.")}</div></div>`;
  }

  return `<div id="coriolis-via-libera-panel" class="subpanel ${ver.eligible ? "ok" : "bad"}">
    <h3>Verifica di ${esc(ver.name)} <span class="tag ${ver.eligible ? "ok" : "bad"}">${ver.eligible ? "idoneo" : "non idoneo"}</span>${reBtn}</h3>
    <div class="sub">${ly(ver.distance)} da te · ${ly(ver.nearest_populated)} dal sistema abitato più vicino · ${num(ver.body_count)} corpi</div>
    <p class="${ver.eligible ? "ok" : "bad"}">${esc(ver.status_label)}</p>
    ${colChecksTable(ver.checks)}</div>`;
}

function renderCustomVerifyResultHtml() {
  const ver = UI.customVerification;
  if (!ver) return "";
  if (ver.loading) return `<div class="loading">Verifica di ${esc(ver.system)}</div>`;
  if (!ver.found) return `<div class="bad">⚠ ${esc(ver.error || "Sistema non trovato.")}</div>`;

  return `<div class="subpanel ${ver.eligible ? "ok" : "bad"}">
    <h3>${esc(ver.name)} <span class="tag ${ver.eligible ? "ok" : "bad"}">${ver.eligible ? "idoneo" : "non idoneo"}</span>
      ${ver.eligible ? `<span class="aside"><button class="small primary" id="coriolis-apply-custom-btn" data-sys="${esc(ver.name)}">Usa come sistema del cantiere</button></span>` : ""}</h3>
    <div class="sub">${ly(ver.distance)} da te · ${num(ver.body_count)} corpi</div>
    <p class="${ver.eligible ? "ok" : "bad"}">${esc(ver.status_label)}</p>
    ${colChecksTable(ver.checks)}
    ${ver.bodies_list?.length ? `<div class="sub">Corpi per l'orbita: <b class="gold">${ver.bodies_list.map(b => esc(b.name)).join(", ")}</b></div>` : ""}
  </div>`;
}

// --- navi utili per il trasporto ------------------------------------------------------
function colCargoShips(cs) {
  const ships = [];
  const curCargo = S?.ship?.cargo_capacity || S?.ship?.cargo || 0;
  if (curCargo > 0) ships.push({ id: "current", name: `${S.ship.name?.trim() ? S.ship.name.trim() + " (" + (S.ship.type || "nave") + ")" : (S.ship.type || "Nave attuale")}`, cargo: curCargo, isCurrent: true });
  for (const sh of Array.isArray(S?.fleet) ? S.fleet : []) {
    const cap = sh.build?.cargo || sh.cargo_capacity || sh.cargo || 0;
    if (cap > 0 && !sh.current && !ships.some(o => o.id === sh.id)) {
      ships.push({ id: sh.id, name: `${sh.name?.trim() ? sh.name.trim() + " (" + (sh.type || "nave") + ")" : (sh.type || "Nave")}`, cargo: cap });
    }
  }
  const fc = S?.carrier || {};
  // 25.000 t è la capacità massima di un Fleet Carrier: i servizi installati ne occupano una parte.
  if (fc.callsign || fc.name || fc.carrier_id) ships.push({ id: "carrier", name: `Fleet Carrier ${fc.callsign || ""} ${fc.name || ""}`.trim(), cargo: 25000 });
  if (!ships.length && cs.cargoShipCap) ships.push({ id: "custom", name: "Stiva scelta in precedenza", cargo: cs.cargoShipCap });
  const chosen = ships.find(s => s.cargo === cs.cargoShipCap) || ships.find(s => s.isCurrent) || ships[0] || null;
  return { ships, chosen, cap: chosen?.cargo || 0 };
}

// --- disegno della scheda -------------------------------------------------------------
const CORIOLIS_SVG = `
    <svg viewBox="0 0 160 160" width="110" height="110" style="flex:none;filter:drop-shadow(0 0 8px var(--hud-glow))" aria-hidden="true">
      <polygon points="48,16 112,16 144,48 144,112 112,144 48,144 16,112 16,48" fill="rgba(255,140,0,.08)" stroke="var(--hud)" stroke-width="2.2" stroke-linejoin="round"/>
      <polygon points="48,16 112,16 112,48 48,48" fill="none" stroke="var(--hud-line)" stroke-width="1.2"/>
      <polygon points="144,48 144,112 112,112 112,48" fill="none" stroke="var(--hud-line)" stroke-width="1.2"/>
      <polygon points="112,144 48,144 48,112 112,112" fill="none" stroke="var(--hud-line)" stroke-width="1.2"/>
      <polygon points="16,112 16,48 48,48 48,112" fill="none" stroke="var(--hud-line)" stroke-width="1.2"/>
      <polygon points="56,56 104,56 120,72 120,88 104,104 56,104 40,88 40,72" fill="var(--void)" stroke="var(--gold)" stroke-width="1.8"/>
      <rect x="62" y="75" width="36" height="10" rx="1.5" fill="var(--void)" stroke="var(--hud)" stroke-width="1.6"/>
      <path d="M 80 32 A 48 48 0 0 0 32 80" fill="none" stroke="var(--gold)" stroke-width="1.4" stroke-dasharray="3,3"/>
      <polygon points="32,74 27,82 36,82" fill="var(--gold)"/>
    </svg>`;

function colOnBoard(name, symbol) {
  const keys = [colNorm(name), colNorm(symbol)].filter(Boolean);
  return (S?.cargo || []).filter(c => keys.includes(colNorm(c.name))).reduce((a, c) => a + (c.count || 0), 0);
}

VIEWS.coriolis_station = () => {
  const cs = getCoriolisStation();
  const curSys = S?.location?.system || "Sol";
  if (!cs.system) cs.system = curSys;
  if (SUGGEST && !SUGGEST.colony) SUGGEST.colony = COL_COMMODITIES.map(v => ({ value: v, label: T("commodity", v) }));

  // Dati del journal: primo caricamento, poi ogni 15 s.
  const dr = UI.colDepots;
  if (!dr || (!dr.loading && Date.now() - (dr.at || 0) > 15000)) colLoadDepots();
  const depots = dr?.data?.depots || [];
  const live = depots.filter(d => !d.complete && !d.failed);
  if (UI.colSource == null && dr?.data) UI.colSource = live[0]?.market_id ?? depots[0]?.market_id ?? "manual";
  const depot = UI.colSource === "manual" ? null : depots.find(d => String(d.market_id) === String(UI.colSource)) || null;
  const manual = !depot;

  const { ships, chosen, cap } = colCargoShips(cs);

  // Righe uniformi per le due fonti.
  const rows = manual
    ? Object.entries(cs.materials).map(([name, m]) => ({ name, required: m.req, provided: Math.min(m.req, m.done || 0), remaining: Math.max(0, m.req - (m.done || 0)) }))
    : depot.resources.map(r => ({ name: r.name, symbol: r.symbol, required: r.required, provided: r.provided, remaining: r.remaining }));
  rows.forEach(r => { r.onBoard = colOnBoard(r.name, r.symbol); });
  rows.sort((a, b) => (a.remaining === 0) - (b.remaining === 0) || b.remaining - a.remaining || a.name.localeCompare(b.name));
  const totReq = rows.reduce((a, r) => a + r.required, 0), totDone = rows.reduce((a, r) => a + r.provided, 0);
  const totLeft = rows.reduce((a, r) => a + r.remaining, 0), totBoard = rows.reduce((a, r) => a + Math.min(r.onBoard, r.remaining), 0);
  const pct = depot ? Math.round(depot.progress * 100) : totReq ? Math.round(totDone / totReq * 100) : 0;
  const trips = cap && totLeft ? Math.ceil(totLeft / cap) : 0;
  const siteSystem = depot ? depot.system || "—" : cs.system;
  const siteName = depot ? depot.station || "Cantiere" : cs.name || "Cantiere senza nome";

  // --- intestazione con fonte dei dati ---
  const sources = `<div class="seg-choice">${depots.map(d => `<button class="small ${depot === d ? "primary" : ""}" data-col-source="${esc(d.market_id)}">${esc(d.system || "Cantiere")}${d.complete ? " · completato" : ""}</button>`).join("")}
    <button class="small ${manual ? "primary" : ""}" data-col-source="manual">Inseriti a mano</button></div>`;
  const srcLabel = depot ? `Dati dal journal · aggiornati ${ago(depot.updated)}` : "Inseriti a mano";
  const header = panel("Cantiere di colonizzazione", `
    <div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap">
      ${CORIOLIS_SVG}
      <div style="flex:1;min-width:280px">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px"><span class="sub">Fonte</span>${sources}</div>
        <div class="eyebrow">${esc(depot ? ({ SpaceConstructionDepot: "Cantiere orbitale", PlanetaryConstructionDepot: "Cantiere planetario" }[depot.station_type] || "Cantiere") : (cs.type || "coriolis"))}</div>
        <div class="mid gold">${esc(siteName)}</div>
        <div class="sys-meta"><span><b>Sistema</b>${siteSystem && siteSystem !== "—" ? sys(siteSystem) : "—"}</span>
          ${!manual && depot.complete ? '<span class="ok">Costruzione completata</span>' : ""}${!manual && depot.failed ? '<span class="bad">Costruzione fallita</span>' : ""}
          ${manual && cs.body ? `<span><b>Corpo</b>${esc(cs.body)}</span>` : ""}</div>
      </div>
    </div>
    <div style="display:flex;justify-content:space-between;margin-top:6px"><span class="eyebrow">Avanzamento${depot ? " (dal gioco)" : " (stimato dalle consegne segnate)"}</span><span class="mono gold">${pct}%</span></div>
    ${meter(pct, pct >= 100 ? "full" : "")}
    <div class="kv-grid" style="margin-top:14px">
      <div class="kv"><span>Da consegnare</span><span class="${totLeft ? "gold" : "ok"}">${num(totLeft)} t</span></div>
      ${depot || totDone ? `<div class="kv"><span>Consegnate</span><span>${num(totDone)} t</span><span class="sub">su ${num(totReq)} t</span></div>` : ""}
      <div class="kv"><span>Viaggi</span><span>${cap ? num(trips) : "—"}</span><span class="sub">${cap ? `con ${num(cap)} t di stiva` : "nessuna stiva nota"}</span></div>
      <div class="kv"><span>Utili a bordo ora</span><span class="${totBoard ? "ok" : ""}">${num(totBoard)} t</span></div>
    </div>
    ${!depots.length ? `<p class="sub">Nessun cantiere nei journal: quando attracchi a un cantiere i dati arrivano da soli. Per un cantiere dove non sei
      ancora stato (per esempio quello di un amico) inserisci le quantità a mano qui sotto.</p>` : ""}`,
    { code: "COLONISATION", aside: srcLabel });

  // --- tabella delle merci ---
  const suppliersOrigin = UI.suppliersOrigin === "ship" ? curSys : (siteSystem && siteSystem !== "—" ? siteSystem : curSys);
  const toFetch = rows.filter(r => r.remaining > 0).map(r => r.name);
  setTimeout(() => loadNearestSuppliers(toFetch, suppliersOrigin), 50);

  const toolbar = `<div class="form" style="margin-bottom:12px">
      <label>Nave per il trasporto<select id="coriolis-ship-select">${ships.map(s => `<option value="${s.cargo}" ${s === chosen ? "selected" : ""}>${esc(s.name)} — ${num(s.cargo)} t</option>`).join("") || '<option value="">Nessuna nave con stiva</option>'}</select></label>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding-bottom:2px"><span class="sub">Fornitori vicino a</span>
        <div class="seg-choice">
          <button class="small ${UI.suppliersOrigin !== "ship" ? "primary" : ""}" id="suppliers-origin-station">Cantiere · ${esc(siteSystem)}</button>
          <button class="small ${UI.suppliersOrigin === "ship" ? "primary" : ""}" id="suppliers-origin-ship">Posizione attuale · ${esc(curSys)}</button>
        </div>
        <button class="small" id="coriolis-refresh-suppliers" title="Cerca di nuovo i mercati più vicini">↻ Ricarica mercati</button></div>
    </div>`;

  const rowHtml = r => {
    const fin = r.remaining === 0, mPct = r.required ? Math.min(100, Math.round(r.provided / r.required * 100)) : 0;
    const actions = fin ? (manual ? `<button class="small ghost" data-col-remove="${esc(r.name)}" title="Togli dalla lista">✕</button>` : "")
      : `<button class="small primary" data-find-commodity="${esc(r.name)}" data-needed="${r.remaining}" title="Stazione più vicina che vende ${esc(r.name)}">Dove comprare</button>
        ${manual ? `${cap ? `<button class="small" data-col-add="${esc(r.name)}" data-amount="${cap}" title="Segna un carico consegnato">+${num(cap)} t</button>` : ""}
          <button class="small" data-col-add="${esc(r.name)}" data-amount="100">+100</button>
          <button class="small" data-col-done="${esc(r.name)}" title="Segna come completata">✔</button>
          <button class="small ghost" data-col-remove="${esc(r.name)}" title="Togli dalla lista">✕</button>` : ""}
        ${todoBtn(LANG.t(`Portare ${num(r.remaining)} t di ${r.name} al cantiere ${siteName}`), siteSystem !== "—" ? siteSystem : "", "Colonizzazione")}`;
    return `<tbody><tr class="${r.onBoard && !fin ? "hot" : ""}">
        <td><b class="${fin ? "ok" : "gold"}">${esc(T("commodity", r.name))}</b>${T("commodity", r.name) !== r.name ? `<div class="sub">${esc(r.name)}</div>` : ""}</td>
        ${manual ? "" : `<td class="num">${num(r.required)}</td><td class="num">${num(r.provided)}${meter(mPct, fin ? "full" : "")}</td>`}
        <td class="num ${fin ? "ok" : "gold"}">${fin ? "fatto" : num(r.remaining)}</td>
        <td class="num ${r.onBoard ? "ok" : "muted"}">${r.onBoard ? num(r.onBoard) : "—"}</td>
        <td class="num">${fin || !cap ? "—" : num(Math.ceil(r.remaining / cap))}</td>
        <td class="num">${actions}</td></tr>
      ${fin ? "" : `<tr><td colspan="${manual ? 5 : 7}"><div class="coriolis-supplier-bar sub" id="coriolis-supplier-${sanitizeCommSlug(r.name)}">${supplierLineHtml(r.name, suppliersOrigin)}</div></td></tr>`}
      </tbody>`;
  };
  const table = rows.length ? `<table><thead><tr><th>Commodity</th>${manual ? "" : '<th class="num">Richieste</th><th class="num">Consegnate</th>'}
      <th class="num">Mancano</th><th class="num">A bordo</th><th class="num">Viaggi</th><th class="num">Azioni</th></tr></thead>${rows.map(rowHtml).join("")}</table>`
    : `<div class="empty">${manual ? "Nessuna merce inserita: incolla l'elenco del cantiere o aggiungi le merci qui sotto" : "Il journal non riporta merci per questo cantiere"}</div>`;

  const materialsPanel = panel("Merci da consegnare", toolbar + renderActiveFinderHtml() + table,
    { code: "MATERIALS", aside: `${rows.filter(r => r.remaining).length} merci · ${num(totLeft)} t` });

  // --- inserimento manuale ---
  const manualPanel = manual ? panel("Inserimento manuale", `
    <p class="sub">Scrivi o incolla le quantità che MANCANO, una merce per riga (per esempio copiate dal messaggio di un amico):
      <span class="mono">Aluminium 12,555</span>. Le merci già in lista vengono aggiornate.</p>
    <div class="form">
      <label class="grow-1">Elenco<textarea id="col-paste" rows="5" placeholder="Aluminium 12,555&#10;CMM Composite 13,443&#10;Liquid oxygen 4,904"></textarea></label>
      <button class="primary" data-col-paste>Importa elenco</button>
    </div>
    <div class="form" style="margin-top:12px">
      <label class="grow-1">Merce<input id="col-add-name" data-suggest="colony" autocomplete="off" placeholder="es. Steel"></label>
      <label>Mancano (t)<input id="col-add-qty" type="number" min="1" step="1" placeholder="es. 19436"></label>
      <button data-col-add-row>Aggiungi</button>
      ${rows.length ? '<button class="small danger" data-col-clear-all>Svuota la lista</button>' : ""}
    </div>`, { code: "MANUAL" }) : "";

  // --- dati del cantiere (nome, sistema, tipo) ---
  const sysElig = getSystemColonisationEligibility(cs.system);
  const ecoOpts = ["", "Agriculture", "Colony", "Extraction", "High-Tech", "Industrial", "Military", "Refinery", "Tourism"];
  const typeOpts = [["coriolis", "Coriolis"], ["orbis", "Orbis"], ["ocellus", "Ocellus"], ["asteroid", "Asteroid base"], ["outpost", "Outpost"], ["surface", "Planetary port"]];
  const noAuto = 'autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" data-lpignore="true" data-1p-ignore="true" data-bwignore="true"';
  const settingsPanel = panel("Dati del cantiere", `
    <div class="form">
      <label class="grow-1">Tipo di struttura<select id="coriolis-edit-type">${typeOpts.map(([v, l]) => opt(v, l, cs.type || "coriolis")).join("")}</select></label>
      <label class="grow-1">Nome<input id="coriolis-edit-name" value="${esc(cs.name)}" ${noAuto} placeholder="es. Orbital Construction Site"></label>
      <label class="grow-1">Sistema<input id="coriolis-edit-system" value="${esc(cs.system)}" ${noAuto} placeholder="es. IC 2602 Sector CB-X d1-160"></label>
      <label class="grow-1">Corpo celeste<input id="coriolis-edit-body" value="${esc(cs.body)}" ${noAuto} placeholder="es. A 4"></label>
      <label class="grow-1">Economia<select id="coriolis-edit-economy">${ecoOpts.map(v => opt(v, v || "—", cs.economy || "")).join("")}</select></label>
      <label class="grow-1">Fazione<input id="coriolis-edit-faction" value="${esc(cs.faction)}" ${noAuto} placeholder="es. il tuo squadrone"></label>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-top:12px">
      <span><span class="tag ${sysElig.cls}">${esc(sysElig.status)}</span> <span class="sub">${esc(sysElig.label)}</span></span>
      <button class="primary" id="coriolis-save-meta-btn">Salva</button>
    </div>`, { code: "SITE", aside: manual ? "usati per l'inserimento manuale" : "" });

  // --- scelta di un nuovo sistema ---
  const candidatesPanel = panel("Sistemi candidati per il cantiere", `
    <p class="sub">Sistemi disabitati qui vicino, a meno di 15 al da un sistema abitato (il numero di corpi è solo informativo).</p>
    <div id="coriolis-candidates-box">${renderCoriolisCandidatesHtml(curSys)}</div>
    <div class="form" style="margin-top:14px">
      <label class="grow-1">Verifica un altro sistema<input id="coriolis-custom-sys-input" placeholder="es. HIP 22629" ${noAuto}></label>
      <button class="primary" id="coriolis-verify-custom-btn">Verifica</button>
    </div>
    <div id="coriolis-verify-result-box">${renderCustomVerifyResultHtml()}</div>
    ${manual ? renderViaLiberaPanel(cs, curSys) : ""}`,
    { code: "TARGETS", aside: `vicino a ${esc(curSys)}` });

  return `<div class="col">
      ${header}
      ${materialsPanel}
      ${manual ? `<div class="grid even"><div class="col">${manualPanel}${settingsPanel}</div><div class="col">${candidatesPanel}</div></div>` : candidatesPanel}
    </div>`;
};

// --- azioni della scheda (inserimento manuale, fonte dei dati) ---------------------------
function colEditMaterials(fn) {
  const cs = getCoriolisStation();
  fn(cs.materials, cs);
  saveCoriolisStation(cs);
  renderView();
}
document.addEventListener("click", e => {
  const t = e.target.closest("[data-col-source], [data-col-add], [data-col-done], [data-col-remove], [data-col-paste], [data-col-add-row], [data-col-clear-all]");
  if (!t) return;
  const d = t.dataset;
  if (d.colSource != null) {
    UI.colSource = d.colSource;
    renderView();
  } else if (d.colAdd != null) {
    colEditMaterials(m => { const x = m[d.colAdd]; if (x) x.done = Math.min(x.req, (x.done || 0) + (parseInt(d.amount, 10) || 0)); });
    toast(`+${num(parseInt(d.amount, 10) || 0)} t di ${d.colAdd}`);
  } else if (d.colDone != null) {
    colEditMaterials(m => { const x = m[d.colDone]; if (x) x.done = x.req; });
  } else if (d.colRemove != null) {
    colEditMaterials(m => { delete m[d.colRemove]; });
  } else if (d.colPaste != null) {
    const list = parseColonisationList($("col-paste")?.value);
    if (!list.length) { toast("Nessuna riga valida (serve: nome quantità)"); return; }
    UI.dirty.delete("col-paste");
    colEditMaterials(m => { for (const x of list) m[x.name] = { req: x.qty, done: 0 }; });
    toast(`${list.length} merci importate`);
  } else if (d.colAddRow != null) {
    const name = colCanonical($("col-add-name")?.value), qty = parseInt(String($("col-add-qty")?.value || "").replace(/[.,' ]/g, ""), 10);
    if (!name || !(qty > 0)) { toast("Scrivi la merce e la quantità che manca"); return; }
    UI.dirty.delete("col-add-name"); UI.dirty.delete("col-add-qty");
    colEditMaterials(m => { m[name] = { req: qty, done: 0 }; });
  } else if (d.colClearAll != null) {
    if (confirm(LANG.t("Svuotare la lista delle merci inserite a mano?"))) colEditMaterials(m => { for (const k of Object.keys(m)) delete m[k]; });
  }
});
