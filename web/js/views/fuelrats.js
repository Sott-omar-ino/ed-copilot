"use strict";

// ============================================================================
// FUEL RATS: comandante a secco, procedura di soccorso e prevenzione
// ============================================================================
// Lo stato arriva da /api/fuel (app/fuel.py) e resta in UI.res.fuel; si aggiorna ogni 4 secondi mentre la
// scheda o la panoramica sono aperte (la panoramica mostra il banner d'emergenza).
//
// Procedura tradotta e riassunta da fonti ufficiali dei Fuel Rats (verificate a nov. 2026):
//  - pagina "I Need Fuel" (fuelrats.com/i-need-fuel): timer ossigeno -> uscire subito al menu principale;
//  - modulo di richiesta (QMS, github.com/FuelRats/QMS, qms/frontend/public/locales/*/rescueForm.json e
//    queuePage.json): non rientrare finché non te lo dicono, non rientrare per controllare il timer, annotare
//    tempo rimasto e posizione; in coda uscire al menu per non consumare carburante; campi: CMDR, sistema,
//    piattaforma, modalità (Odyssey / Horizons / Legacy);
//  - guida dei dispatcher "Anatomy of typical rescues" (confluence.fuelrats.com/x/C4A3): uscire dal supercruise
//    e fermarsi, tenere acceso il supporto vitale e spegnere il resto, il cliente invia l'amicizia e l'invito
//    in wing/team, beacon su WING/TEAM, uscire dalla zona di esclusione (~5 ls), il caso si chiude quando il
//    rat conferma il rifornimento.
const FUEL_REFRESH_MS = 4000;

function fuelLoad(force = false) {
  const r = UI.res.fuel;
  if (UI.fuelLoading || (!force && r && Date.now() - (r.t || 0) < FUEL_REFRESH_MS)) return;
  UI.fuelLoading = true;
  api("/api/fuel")
    .then(data => { UI.res.fuel = { data, t: Date.now() }; })
    .catch(e => { UI.res.fuel = { ...(UI.res.fuel || {}), error: e.message, t: Date.now() }; })
    .finally(() => {
      UI.fuelLoading = false;
      const tab = currentTab();
      if ((tab === "fuelrats" || tab === "overview" || tab === "route")
        && !document.activeElement?.matches("input:not([type=checkbox]):not([type=range]), select, textarea")) renderView();
    });
}

const frT = v => v == null ? "—" : Number(v).toLocaleString(NUM_LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 2 }) + " t";

const FR_STEPS = [
  ["Vedi il timer \"OXYGEN DEPLETED\"?", "Esci <b>subito</b> al menu principale, dove vedi la nave nell'hangar. Non rientrare in gioco finché non te lo dicono e non rientrare per controllare: annota quanto tempo restava sul timer e dove eri nel sistema, te lo chiederanno."],
  ["Nessun timer?", "Esci dal supercruise e fermati. Tieni acceso il supporto vitale (Life Support) e spegni gli altri moduli. Mentre aspetti il tuo turno, esci al menu principale per non consumare carburante."],
  ["Chiedi soccorso", "Apri la pagina ufficiale di richiesta dei Fuel Rats (il link è in <a href=\"#places\">Luoghi utili</a>) e compila: nome del CMDR, sistema, piattaforma e modalità di gioco. Rispondi alla domanda sul timer dell'ossigeno."],
  ["Segui il dispatcher", "In chat ti guida un dispatcher. Di solito ti chiede di inviare <b>tu</b> la richiesta di amicizia ai rat (menu SOCIAL), di invitarli <b>tu</b> in wing/team e di accendere il beacon su WING/TEAM."],
  ["Troppo vicino alla stella?", "Se sei nella zona di esclusione: riattiva propulsori e FSD, togli il bersaglio, entra in supercruise e allontanati di circa 5 ls, poi torna nello spazio normale."],
  ["Fine", "Quando il rat conferma il rifornimento il soccorso è concluso. In caso di dubbio vale sempre quello che ti dice il dispatcher."],
];

function frInfo(d) {
  const i = d.rescue;
  const rows = [["Nome CMDR", i.cmdr], ["Sistema", i.system], ["Piattaforma", i.platform], ["Modalità", i.version],
    ["Nave", i.ship], ["Vicino a", i.near], ["Carburante", i.fuel], ["Riserva", i.reservoir]].filter(([, v]) => v);
  const all = rows.map(([k, v]) => `${LANG.t(k)}: ${v}`).join("\n") + "\n" + LANG.t("Timer ossigeno: (sì/no, e quanto tempo restava)");
  return `<table><tbody>${rows.map(([k, v]) => `<tr><td class="sub">${esc(k)}</td><td><b>${esc(v)}</b></td>
      <td style="text-align:right"><button class="small ghost" data-copy="${esc(v)}">⧉ Copia</button></td></tr>`).join("")}
    <tr><td class="sub">Timer ossigeno</td><td colspan="2">Lo sai solo tu: guarda in gioco se compare il timer "OXYGEN DEPLETED" e quanto tempo resta.</td></tr></tbody></table>
    <div style="margin-top:8px"><button class="small" data-copy="${esc(all)}">⧉ Copia tutto</button></div>
    <div class="sub" style="margin-top:6px">Il modulo di richiesta non si compila da solo: copia i dati da qui.</div>`;
}

// Banner d'emergenza: usato dalla scheda Fuel Rats e dalla panoramica.
function fuelRescueBanner(compact = false) {
  fuelLoad();
  const d = UI.res.fuel?.data, st = d?.stranded;
  if (!st?.level || (st.level === "low" && compact)) return "";
  const reasons = st.reasons.map(r => `<li>${esc(r)}</li>`).join("");
  if (st.level === "stranded") {
    return `<section class="panel fr-banner"><div class="bd"><div class="fr-banner-title">▲ SEI A SECCO</div>
      <ul class="fr-reasons">${reasons}</ul>
      <div class="fr-o2">Se vedi il timer <b>OXYGEN DEPLETED</b>: esci SUBITO al menu principale.</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
        ${compact ? '<button class="primary" data-fr-go="fuelrats">Apri la procedura Fuel Rats</button>' : ""}
        <button class="${compact ? "ghost" : "primary"}" data-fr-go="places">Richiesta di soccorso (Luoghi utili)</button></div></div></section>`;
  }
  const cls = st.level === "scoop" ? "fr-banner warn" : "fr-banner low";
  return `<section class="panel ${cls}"><div class="bd"><div class="fr-banner-title">${st.level === "scoop" ? "▲ CARBURANTE FINITO: RIFORNISCITI QUI" : "Carburante basso"}</div>
    <ul class="fr-reasons">${reasons}</ul></div></section>`;
}

function frStatus(d) {
  const f = d.fuel, star = d.star, sh = d.ship;
  const pct = f.main != null && f.cap ? f.main / f.cap * 100 : 0;
  return `<div class="kv-grid">
      <div class="kv"><span>Serbatoio principale</span><span class="big mono ${pct < 25 ? "bad" : ""}">${frT(f.main)}</span><span class="sub">su ${frT(f.cap)}</span></div>
      <div class="kv"><span>Riserva</span><span class="mono">${frT(f.reservoir)}</span><span class="sub">${f.reserve_cap ? "su " + frT(f.reserve_cap) : ""}</span></div>
      <div class="kv"><span>Stella qui</span><span class="mono ${star.scoopable ? "ok" : star.scoopable === false ? "bad" : ""}">${esc(star.class || "?")} ${star.scoopable ? "⛽ rifornibile" : star.scoopable === false ? "✕ non rifornibile" : ""}</span></div>
      <div class="kv"><span>Fuel scoop</span><span class="${sh.has_scoop ? "ok" : sh.has_scoop === false ? "bad" : ""}">${sh.has_scoop ? "montato" : sh.has_scoop === false ? "assente" : "—"}</span></div>
      <div class="kv"><span>Salto ora</span><span class="mono">${d.range_now ? ly(d.range_now) : "—"}</span></div>
    </div>${meter(pct, pct < 25 ? "bad" : "")}
    <div class="sub" style="margin-top:6px">${esc(d.safety.calc.note)} Dati del carburante: ${f.source === "Status.json" ? "in tempo reale" : "dall'ultimo evento del journal"}.</div>`;
}

const frSwitch = (key, on, label) =>
  `<button class="switch ${on ? "on" : ""}" data-fuel-cfg="${key}" role="switch" aria-checked="${on}" aria-label="${esc(label)}"><span></span><span></span></button>`;

VIEWS.fuelrats = () => {
  fuelLoad();
  const r = UI.res.fuel;
  if (!r?.data) return panel("Fuel Rats", r?.error ? `<div class="bad">⚠ ${esc(r.error)}</div>` : '<div class="loading">CONTROLLO DEL CARBURANTE</div>');
  const d = r.data, cfg = d.config;
  const steps = `<ol class="fr-steps">${FR_STEPS.map(([t, x]) => `<li><b>${t}</b><div>${x}</div></li>`).join("")}</ol>
    <div class="sub" style="margin-top:8px">Procedura di The Fuel Rats, tradotta e riassunta da Voidwatch ED. Il merito è tutto loro.</div>`;
  const prevent = `<ul class="fr-tips">
      <li>Monta un <b>fuel scoop</b>: puoi rifornirti gratis dalle stelle di classe K, G, B, F, O, A, M (KGBFOAM).</li>
      <li>Tieni una scorta: rifornisciti prima dell'avviso di carburante basso del gioco (sotto il 25% del serbatoio).</li>
      <li>Evita catene di stelle non rifornibili (nane brune, nane bianche, neutroni, buchi neri...): controlla i
        <a href="#route">rischi della rotta</a> prima di partire.</li>
      <li>L'FSD consuma il serbatoio principale; la riserva alimenta solo i sistemi di bordo.</li></ul>`;
  const settings = `<div class="todo-item" style="align-items:center"><div class="text">Avviso a voce<div class="sub">"Carburante basso: fai rifornimento alla prossima stella" lungo la rotta</div></div>${frSwitch("voice", cfg.voice, "Avviso a voce")}</div>
    <div class="todo-item" style="align-items:center"><div class="text">Nel ticker<div class="sub">Scrive gli avvisi sul carburante nel registro eventi</div></div>${frSwitch("feed", cfg.feed, "Avvisi nel ticker")}</div>
    <div class="todo-item" style="align-items:center"><div class="text">Annuncio "a secco"<div class="sub">Una volta sola, quando non puoi più saltare né rifornirti</div></div>${frSwitch("rescue_voice", cfg.rescue_voice, "Annuncio a secco")}</div>
    <form class="form" data-form="fuel-cfg" id="f-fuel-cfg" style="margin-top:8px">
      <label>Margine di sicurezza (%)<input id="fuel-margin" name="margin_pct" type="number" min="0" max="100" value="${esc(cfg.margin_pct)}" style="width:90px"></label>
      <button class="small" type="submit">Salva</button></form>`;
  const join = `<p>The Fuel Rats sono giocatori volontari che portano carburante ai comandanti rimasti a secco, su tutte le piattaforme.
    Se hai una nave con un po' di autonomia e vuoi aiutare, puoi unirti a loro: trovi il loro sito in <a href="#places">Luoghi utili</a>.</p>`;
  return `${fuelRescueBanner()}<div class="grid"${d.stranded.level ? ' style="margin-top:18px"' : ""}><div class="col">
      ${panel("Se sei a secco: cosa fare", steps, { cls: d.stranded.level === "stranded" ? "holo" : "", code: "FUEL-RATS" })}
      <div style="margin-top:18px">${panel("Dati da dare ai rat", frInfo(d), { code: "CASE" })}</div>
    </div><div class="col">
      ${panel("Carburante", frStatus(d), { code: "FUEL", aside: d.stranded.level ? `<span class="${d.stranded.level === "low" ? "gold" : "bad"}">${{ stranded: "A SECCO", scoop: "RIFORNISCITI", low: "BASSO" }[d.stranded.level]}</span>` : '<span class="ok">ok</span>' })}
      <div style="margin-top:18px">${panel("Prevenzione", prevent, { code: "TIPS" })}</div>
      <div style="margin-top:18px">${panel("Avvisi", settings, { code: "VOX" })}</div>
      <div style="margin-top:18px">${panel("Diventa un Rat", join, { code: "JOIN" })}</div>
    </div></div>`;
};

document.addEventListener("click", e => {
  const go = e.target.closest("[data-fr-go]");
  if (go) { location.hash = go.dataset.frGo; return; }
  const t = e.target.closest("[data-fuel-cfg]");
  if (!t) return;
  const cfg = UI.res.fuel?.data?.config;
  if (!cfg) return;
  const key = t.dataset.fuelCfg;
  api("/api/fuel/config", { [key]: !cfg[key] })
    .then(data => { UI.res.fuel = { data, t: Date.now() }; toast("Impostazione salvata"); })
    .catch(err => toast(err.message))
    .finally(renderView);
});

document.addEventListener("submit", e => {
  if (e.target.dataset?.form !== "fuel-cfg") return;
  e.preventDefault();
  e.stopImmediatePropagation();
  const v = parseFloat(new FormData(e.target).get("margin_pct"));
  if (!(v >= 0 && v <= 100)) { toast("Indica un valore tra 0 e 100"); return; }
  api("/api/fuel/config", { margin_pct: v })
    .then(data => { UI.res.fuel = { data, t: Date.now() }; UI.dirty.delete("fuel-margin"); toast("Margine salvato"); })
    .catch(err => toast(err.message))
    .finally(renderView);
});
