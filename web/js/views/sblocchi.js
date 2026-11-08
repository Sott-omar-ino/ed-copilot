"use strict";

// ============================================================================
// GUIDA MATERIALI, SITI GUARDIAN & RICERCA IN-GAME
// ============================================================================
// Dove trovare i materiali dei progetti. Solo indicazioni verificate su elite-dangerous.fandom.com (pagine
// Ancient Data Terminal, Guardian Structure, Guardian Module Blueprint Fragment, Guardian Power Cell, Pattern * Obelisk
// Data, Datamined Wake Exceptions, Meta-Alloys, Micro-Weave Cooling Hoses; nov 2026). Gli altri materiali usano le
// indicazioni generiche per categoria di getMaterialSourceInfo().
const GUARDIAN_SITE_TEXT = "Piccole Guardian Structure con Ancient Data Terminal attivo: carica i 6 Energy Pylon sparando al nucleo entro il tempo limite, getta un Ancient Relic dalla stiva dell'SRV nell'apertura davanti al terminale e scansiona il Data Core con il Data Link Scanner dell'SRV. Le Guardian Sentinel difendono il sito.";
const GUARDIAN_MAT_TEXT = "Si raccoglie con l'SRV nei siti Guardian (Guardian Structure e Ancient Ruins): pannelli distruttibili delle rovine e resti delle Guardian Sentinel.";
const OBELISK_TEXT = "Si ottiene scansionando con l'SRV gli Ancient Obelisk nei siti Guardian (Ancient Ruins e Guardian Structure).";
const MATERIAL_GUIDES = {
  "Guardian Module Blueprint Fragment": { cat: "Encoded", isCommodity: false, siteType: "module", needBroker: "Guardian",
    where: GUARDIAN_SITE_TEXT + " Siti con segmenti per moduli, per esempio <b>Synuefe NL-N c23-4</b> (B 3) e <b>Synuefe GT-H b43-1</b> (C 4)." },
  "Guardian Weapon Blueprint Fragment": { cat: "Encoded", isCommodity: false, siteType: "weapon", needBroker: "Guardian",
    where: GUARDIAN_SITE_TEXT + " Il tipo di segmento (moduli o armi) dipende dal sito." },
  "Guardian Power Cell": { cat: "Manufactured", isCommodity: false, needBroker: "Guardian",
    where: "Siti Guardian: cade spesso dai bersagli \"Destructible Panel\" sui pilastri delle rovine (con l'SRV)." },
  "Guardian Technology Component": { cat: "Manufactured", isCommodity: false, needBroker: "Guardian", where: GUARDIAN_MAT_TEXT },
  "Guardian Power Conduit": { cat: "Manufactured", isCommodity: false, needBroker: "Guardian", where: GUARDIAN_MAT_TEXT },
  "Guardian Sentinel Weapon Parts": { cat: "Manufactured", isCommodity: false, needBroker: "Guardian", where: GUARDIAN_MAT_TEXT },
  "Guardian Wreckage Components": { cat: "Manufactured", isCommodity: false, needBroker: "Guardian", where: GUARDIAN_MAT_TEXT },
  "Pattern Alpha Obelisk Data": { cat: "Encoded", isCommodity: false, needBroker: "Guardian", where: OBELISK_TEXT },
  "Pattern Beta Obelisk Data": { cat: "Encoded", isCommodity: false, needBroker: "Guardian", where: OBELISK_TEXT },
  "Pattern Gamma Obelisk Data": { cat: "Encoded", isCommodity: false, needBroker: "Guardian", where: OBELISK_TEXT },
  "Pattern Delta Obelisk Data": { cat: "Encoded", isCommodity: false, needBroker: "Guardian", where: OBELISK_TEXT },
  "Pattern Epsilon Obelisk Data": { cat: "Encoded", isCommodity: false, needBroker: "Guardian", where: OBELISK_TEXT },
  "Datamined Wake Exceptions": { cat: "Encoded", isCommodity: false, needTrader: "Encoded",
    where: "Scansione delle scie FSD ad alta energia con il Frame Shift Wake Scanner nei luoghi trafficati (anche Stronghold Carrier), Private Data Beacon, Encoded Emissions, ricompense delle missioni, oppure scambio dal Material Trader Encoded." },
  "Micro-Weave Cooling Hoses": { cat: "Commodity", isCommodity: true, canBuy: false,
    where: "Merce che si ottiene solo come ricompensa delle missioni: non si compra nei mercati." },
  "Meta-Alloys": { cat: "Commodity", isCommodity: true, canBuy: true,
    where: "Prodotta dai Thargoid Barnacle (si raccoglie nei loro siti). L'unico porto che la vende con regolarità è <b>Darnielle's Progress</b> (Maia A 2 a), di solito solo 2 unità alla volta. Abbonda anche intorno ai relitti dei Titan." }
};

function getMaterialSourceInfo(name, cat) {
  const existing = MATERIAL_GUIDES[name];
  if (existing) return existing;
  const c = cat || "Manufactured";
  if (c === "Commodity") {
    return {
      cat: "Commodity",
      isCommodity: true,
      canBuy: true,
      where: "Merce commerciale in vendita con crediti nei mercati stellari."
    };
  } else if (c === "Raw") {
    return {
      cat: "Raw",
      isCommodity: false,
      where: "Materiale Grezzo non acquistabile a mercato: reperibile su superfici planetarie con SRV (crateri e siti geologici) o mining di asteroidi, oppure scambiabile da un Material Trader Grezzi.",
      needTrader: "Raw"
    };
  } else if (c === "Encoded") {
    return {
      cat: "Encoded",
      isCommodity: false,
      where: "Dati Codificati non acquistabili a mercato: ottenibili scansionando navi, scie FSD con Wake Scanner o terminali dati insediamenti, oppure scambiabili da un Material Trader Codificati.",
      needTrader: "Encoded"
    };
  } else {
    return {
      cat: "Manufactured",
      isCommodity: false,
      where: "Materiale Manifatturato non acquistabile a mercato: recuperabile da relitti di navi distrutte in combattimento o fonti di segnale USS nello spazio, oppure scambiabile da un Material Trader Manufatti.",
      needTrader: "Manufactured"
    };
  }
}

function getGuardianSiteGuide(siteType) {
  // Procedura: elite-dangerous.fandom.com/wiki/Ancient_Data_Terminal; siti con segmenti per moduli:
  // elite-dangerous.fandom.com/wiki/Guardian_Module_Blueprint_Fragment.
  const sites = siteType === "weapon" ? "" : `
      <div>Siti con segmenti per moduli, per esempio: <b class="gold">Synuefe NL-N c23-4</b> (B 3), <b class="gold">Synuefe GT-H b43-1</b> (C 4).</div>`;
  return `
    <div style="font-size:12px;color:var(--text-1);line-height:1.5">
      <div style="font-weight:bold;color:var(--gold);margin-bottom:6px">&#x25c6; ${siteType === "weapon" ? "WEAPON" : "MODULE"} BLUEPRINT FRAGMENT: COME OTTENERLO</div>
      <div>Si ottiene solo dalle piccole Guardian Structure con un Ancient Data Terminal attivo; il tipo di segmento (moduli o armi) dipende dal sito.</div>${sites}
      <div><a href="#guardian">Tutti i siti, con distanza e materiali che ti mancano: scheda Guardian →</a></div>
      <div style="margin-top:8px"><b>Procedura:</b></div>
      <div>1. Atterra vicino al sito e scendi con l'SRV.</div>
      <div>2. Procurati un <b>Ancient Relic</b> (nei piccoli siti se ne trovano fino a 3) e caricalo nella stiva dell'SRV.</div>
      <div>3. Alza i <b>6 Energy Pylon</b> avvicinandoti con l'SRV: prima i due accanto al terminale, poi gli altri quattro.</div>
      <div>4. Carica i pylon sparando al nucleo luminoso (con l'SRV o con la nave): dal primo colpo parte un timer e vanno caricati tutti e 6 prima che scada.</div>
      <div>5. Le <b>Guardian Sentinel</b> si attivano durante la procedura: abbattile.</div>
      <div>6. Getta l'Ancient Relic nell'apertura luminosa davanti al terminale e scansiona il Data Core con il <b>Data Link Scanner</b> dell'SRV: ricevi 1 segmento.</div>
      <div style="margin-top:6px">In stormo ogni comandante deve scansionare il terminale per conto suo.</div>
    </div>
  `;
}

function renderActiveFinderHtml() {
  if (!UI.activeFinder) return "";
  const f = UI.activeFinder;
  const curSys = S?.location?.system || "Sol";

  if (f.isGuide) {
    return `
      <div style="background:rgba(255,138,31,0.08);border:1px solid var(--accent);padding:14px;margin-bottom:14px;position:relative">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <b class="gold" style="font-size:14px">&#x25c6; ${esc(f.title)}</b>
          <button class="small ghost" data-close-finder style="font-size:11px">&times; Chiudi Guida</button>
        </div>
        ${f.content}
      </div>
    `;
  }

  if (f.loading) {
    return `
      <div style="background:rgba(255,138,31,0.08);border:1px solid var(--accent);padding:14px;margin-bottom:14px;display:flex;align-items:center;gap:12px">
        <span class="holo-t" style="font-size:16px">&#x25cf;</span>
        <div>
          <b class="gold" style="font-size:13px">${esc(f.title)}</b>
          <div class="sub" style="font-size:12px;margin-top:2px">Interrogazione stazioni e mercati vicini a <b>${esc(curSys)}</b> in corso...</div>
        </div>
      </div>
    `;
  }

  if (f.error || !f.results || !f.results.length) {
    return `
      <div style="background:rgba(255,138,31,0.08);border:1px solid var(--accent);padding:14px;margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <b class="bad" style="font-size:13px">&#x2716; ${esc(f.title)}: Nessuna stazione trovata</b>
          <button class="small ghost" data-close-finder style="font-size:11px">&times; Chiudi</button>
        </div>
        <div class="sub" style="margin-top:6px;font-size:12px">
          ${esc(f.error || `Nessuna stazione nelle immediate vicinanze di ${curSys} soddisfa i criteri di ricerca.`)}
        </div>
      </div>
    `;
  }

  const resultsHtml = f.results.map((r, i) => {
    const padStr = r.large_pad ? "Large (L)" : r.medium_pad ? "Medium (M)" : "Small (S)";
    return `
      <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 10px;background:rgba(0,0,0,0.45);border:1px solid rgba(255,138,31,0.2);margin-bottom:6px;flex-wrap:wrap;gap:8px">
        <div>
          <div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap">
            <span class="mono muted" style="font-size:11px">#${i+1}</span>
            <b class="holo-t" style="font-size:14px">${esc(r.station)}</b>
            <span class="gold" style="font-size:13px">Sistema: <b>${esc(r.system)}</b></span>
            ${r.type ? `<span class="sub" style="font-size:11px">(${esc(r.type)})</span>` : ""}
          </div>
          <div class="sub" style="font-size:11px;margin-top:3px;display:flex;gap:10px;flex-wrap:wrap">
            <span>Distanza: <b class="gold">${r.distance} AL</b></span>
            ${r.dist_ls ? `<span>Arrivo: <b>${num(Math.round(r.dist_ls))} ls</b></span>` : ""}
            <span>Piazzola: <b class="${r.large_pad ? "ok" : "gold"}">${padStr}</b></span>
            ${r.supply !== undefined ? `<span>Scorte: <b class="gold">${num(r.supply)} t</b></span>` : ""}
            ${r.buy !== undefined ? `<span>Prezzo: <b>${num(r.buy)} Cr/t</b></span>` : ""}
            ${r.technology_broker ? `<span class="tag ok" style="font-size:9px">Broker: ${esc(r.technology_broker)}</span>` : ""}
            ${r.material_trader ? `<span class="tag ok" style="font-size:9px">Trader: ${esc(r.material_trader)}</span>` : ""}
          </div>
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          <button class="small primary" data-copy="${esc(r.system)}" title="Copia '${esc(r.system)}' negli appunti per incollarlo nella mappa galattica">&#x25c6; Copia Sistema</button>
        </div>
      </div>
    `;
  }).join("");

  return `
    <div style="background:rgba(255,138,31,0.08);border:1px solid var(--accent);padding:14px;margin-bottom:14px;position:relative">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div>
          <b class="gold" style="font-size:13px;letter-spacing:0.04em">&#x25c6; ${esc(f.title).toUpperCase()}</b>
          <div class="sub" style="font-size:11px;margin-top:2px">Stazioni ordinate per distanza minima dal sistema <b>${esc(curSys)}</b>:</div>
        </div>
        <button class="small ghost" data-close-finder style="font-size:11px">&times; Chiudi Risultati</button>
      </div>
      <div>
        ${resultsHtml}
      </div>
    </div>
  `;
}

VIEWS.wishlist = () => {
  UI.bpId ||= (localStorage.getItem("ed_wishlist_selected") || BLUEPRINTS[0].id);
  const bp = BLUEPRINTS.find(b => b.id === UI.bpId) || BLUEPRINTS[0];

  const matStock = {};
  for (const m of S.materials) {
    matStock[m.name] = (matStock[m.name] || 0) + m.count;
    if (m.label) matStock[m.label] = (matStock[m.label] || 0) + m.count;
  }
  const cargoStock = {};
  for (const c of (S.cargo || [])) {
    cargoStock[c.name] = (cargoStock[c.name] || 0) + (c.count || 0);
    if (c.label) cargoStock[c.label] = (cargoStock[c.label] || 0) + (c.count || 0);
  }

  let totalItems = bp.items.length;
  let readyItems = 0;
  const missingItems = [];

  const rows = bp.items.map(req => {
    const owned = matStock[req.name] || cargoStock[req.name] || 0;
    const missing = Math.max(0, req.count - owned);
    const ok = missing === 0;
    if (ok) readyItems++;
    else missingItems.push({ name: req.name, missing, hint: req.hint, cat: req.cat });

    const srcInfo = getMaterialSourceInfo(req.name, req.cat);
    const isComm = srcInfo.isCommodity || req.cat === "Commodity";
    const canBuy = srcInfo.canBuy !== false && isComm;

    const actionButtons = [];
    if (isComm) {
      actionButtons.push(`<button class="small primary" data-find-commodity="${esc(req.name)}" data-needed="${missing || req.count}">&#x25c6; Trova Stazione Pi&ugrave; Vicina (${esc(req.name)})</button>`);
    } else {
      if (srcInfo.siteType) {
        actionButtons.push(`<button class="small primary" data-show-guardian-site="${srcInfo.siteType}">Siti Guardian</button>`);
      }
      if (srcInfo.needBroker) {
        actionButtons.push(`<button class="small ghost" data-find-broker="${srcInfo.needBroker}">&#x25c6; Cerca ${srcInfo.needBroker} Broker pi&ugrave; vicino</button>`);
      }
      if (srcInfo.needTrader) {
        const catMap = { Raw: "Grezzi", Manufactured: "Manufatti", Encoded: "Codificati" };
        actionButtons.push(`<button class="small ghost" data-find-trader="${srcInfo.needTrader}">&#x25c6; Cerca Material Trader (${catMap[srcInfo.needTrader] || srcInfo.needTrader}) pi&ugrave; vicino</button>`);
      }
    }

    return `
      <div style="padding:10px 0;border-bottom:1px solid rgba(255,138,31,0.15)">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <div>
            <b class="${ok ? "ok" : "gold"}" style="font-size:14px">${esc(req.name)}</b>
            <span class="tag ${isComm ? "gold" : "sub"}" style="margin-left:6px;font-size:10px">
              ${isComm ? (canBuy ? "MERCE DI MERCATO ACQUISTABILE" : "MERCE RICOMPENSA MISSIONI") : `MATERIALE ${req.cat.toUpperCase()} (NON ACQUISTABILE A MERCATO)`}
            </span>
          </div>
          <div style="display:flex;align-items:center;gap:12px">
            <div class="mono" style="font-size:13px">
              <span class="${ok ? "ok" : "gold"}">${owned}</span> / ${req.count}
            </div>
            <div>
              ${ok ? '<span class="tag ok">&#x2714; PRONTO</span>' : `<span class="tag bad">mancano ${missing}</span>`}
            </div>
          </div>
        </div>

        <div style="margin-top:6px;font-size:12px;color:var(--text-1);line-height:1.45;background:rgba(0,0,0,0.3);border-left:2px solid var(--accent);padding:6px 10px">
          <span style="color:var(--gold);font-weight:bold">&#x25c6; DOVE E COME TROVARLO:</span> ${srcInfo.where}
        </div>

        <div style="margin-top:6px;display:flex;gap:6px;flex-wrap:wrap;align-items:center">
          ${actionButtons.join("")}
        </div>
      </div>
    `;
  }).join("");

  const allReady = readyItems === totalItems;
  const curSys = S?.location?.system || "Sol";

  const isGuardian = bp.cat.includes("Guardian");
  const isHuman = bp.cat.includes("Human");

  const topControls = `
    <div class="form" style="margin-bottom:12px;gap:12px">
      <label class="grow-1">Seleziona Modulo o Progetto da Sbloccare
        <select id="wishlist-select" style="min-width:320px">
          ${BLUEPRINTS.map(b => `<option value="${b.id}" ${b.id === bp.id ? "selected" : ""}>[${b.cat}] ${b.name}</option>`).join("")}
        </select>
      </label>
      <div style="display:flex;gap:8px;align-items:flex-end">
        <button class="primary" id="wishlist-add-todo" ${allReady ? "disabled" : ""} title="Aggiunge tutti i materiali mancanti alla scheda 'Da fare'">+ Aggiungi Mancanti ai Da Fare</button>
        <button class="ghost" id="wishlist-save-active" title="Salva questo progetto come obiettivo principale">&#x25c6; Salva come Obiettivo</button>
      </div>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;background:rgba(255,138,31,0.06);border:1px solid rgba(255,138,31,0.22);padding:10px 14px;margin-bottom:14px">
      <div>
        <div class="eyebrow">${esc(bp.cat)}</div>
        <b class="holo-t" style="font-size:16px">${esc(bp.name)}</b>
        <div class="sub" style="margin-top:2px;font-size:12px">${esc(bp.desc || "")}</div>
        <div class="sub gold" style="margin-top:2px;font-size:11px">${bp.cat.startsWith("Tech") ? "Dove si sblocca" : "Ingegneri che arrivano al G5"}: <b>${esc(bp.engineer)}</b></div>
      </div>
      <div style="text-align:right">
        <div class="display chroma ${allReady ? "ok" : "gold"}" style="font-size:28px">${readyItems} / ${totalItems}</div>
        <div class="sub" style="font-size:11px">${allReady ? '<span class="tag ok">TUTTI I MATERIALI DISPONIBILI!</span>' : `${missingItems.length} componenti ancora da completare`}</div>
      </div>
    </div>
  `;

  const coriolisStation = getCoriolisStation();
  const wishRefSys = UI.wishlistRefSys === "coriolis" && coriolisStation.system ? coriolisStation.system : curSys;

  const fromCurrent = wishRefSys === curSys;
  const inAppServicesPanel = panel("Servizi più vicini", `
      <div class="field-row" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px">
        <span class="sub">Cerca vicino a</span>
        <div class="seg-choice">
          <button class="small ${fromCurrent ? "primary" : ""}" id="wishlist-ref-current">Posizione attuale · ${esc(curSys)}</button>
          ${coriolisStation.system ? `<button class="small ${!fromCurrent ? "primary" : ""}" id="wishlist-ref-coriolis">Cantiere Coriolis · ${esc(coriolisStation.system)}</button>` : ""}
        </div>
      </div>
      <p class="sub" style="margin:0 0 10px">Con i materiali pronti vai dal Technology Broker per sbloccare il progetto, oppure scambia quelli in eccesso da un Material Trader.</p>
      <div class="chips">
        ${isGuardian ? `<button class="small primary" data-find-broker="Guardian" data-ref-sys="${esc(wishRefSys)}">Guardian Tech Broker</button>` : ""}
        ${isHuman ? `<button class="small primary" data-find-broker="Human" data-ref-sys="${esc(wishRefSys)}">Human Tech Broker</button>` : ""}
        <button class="small" data-find-trader="Raw" data-ref-sys="${esc(wishRefSys)}">Material Trader Raw</button>
        <button class="small" data-find-trader="Manufactured" data-ref-sys="${esc(wishRefSys)}">Material Trader Manufactured</button>
        <button class="small" data-find-trader="Encoded" data-ref-sys="${esc(wishRefSys)}">Material Trader Encoded</button>
      </div>`, { code: "IN-GAME", aside: `vicino a ${esc(wishRefSys)}` });

  return `
    ${renderActiveFinderHtml()}
    ${panel("Pianificatore Sblocchi & Wishlist Materiali", topControls + rows, { code: "WISHLIST-PLANNER", aside: (allReady ? "Pronto per lo sblocco" : `Mancano ${missingItems.length} componenti`) + (typeof engWishlistBadge === "function" ? " " + engWishlistBadge() : "") })}
    ${inAppServicesPanel}
  `;
};
