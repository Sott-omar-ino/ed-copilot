"use strict";

// ============================================================================
// GUARDIAN: sblocchi al Guardian Technology Broker, siti e cosa ti manca
// ============================================================================
// Dati e fonti di ricette, nomi e siti: docstring di app/guardian.py (/api/guardian).
// La risposta resta in UI.res.guardian e viene ricaricata al massimo ogni 15 s mentre la scheda è aperta.
//
// Procedura dei siti (fonti):
// - Siti Weapon/Module: guida "Unlock Guardian Weapons and Modules" dell'Anti-Xeno Initiative
//   (wiki.antixenoinitiative.com/en/guardianunlocks): attiva i piloni sparando ai globi di energia entro il tempo
//   limite, prendi una Guardian Relic, lasciala sul podio dove inizia la sequenza, scansiona il globo che appare con
//   il Data Link Scanner; per un altro blueprint allontanati, esci e rientra nel gioco e ricomincia.
//   Point Defence e un SRV di scorta consigliati; le Guardian Sentinel lanciano missili.
// - Siti Vessel: servono un Ancient Key, che si ottiene scansionando il data core di un Guardian Beacon con il Data
//   Link Scanner (ripetibile), invece della Guardian Relic (guide dei giocatori sul forum Frontier
//   "Walkthrough: Guardian Vessel Blueprints" e "Quick-Guide to Guardian Fighters").
// - Gioca in Solo: i materiali di un sito li può raccogliere una sola persona (guida AXI "engineering-materials").
// - Materiali Guardian: dai pannelli distruttibili e dalle Sentinel distrutte; Pattern Obelisk Data dagli
//   obelischi attivi, a caso (guida AXI "engineering-materials").

const GD_GROUPS = [
  ["all", "Tutti"], ["module", "Moduli"], ["weapon", "Armi"], ["modified", "Modified"], ["fighter", "Fighter"],
];
// Tradotto con t() e data-no-translate: "Data" (inglese di "Dati") è anche una chiave italiana ("Data" = "Date").
const GD_KIND = { material: "Materiale", data: "Dati", commodity: "Commodity" };

function gdLoad(force = false) {
  const cur = UI.res.guardian;
  if (cur?.busy) return;
  if (!force && cur?.at && Date.now() - cur.at < 15000) return;
  if (!cur?.data) UI.res.guardian = { busy: true };
  else cur.busy = true;
  api("/api/guardian")
    .then(d => { UI.res.guardian = { data: d, at: Date.now() }; })
    .catch(e => { UI.res.guardian = cur?.data ? { ...cur, busy: false, at: Date.now() } : { error: e.message, at: Date.now() }; })
    .finally(() => { if (currentTab() === "guardian") renderView(); });
}

document.addEventListener("click", e => {
  const g = e.target.closest("[data-gd-group]");
  if (g) { UI.gdGroup = g.dataset.gdGroup; renderView(); return; }
  if (e.target.closest("[data-gd-ready]")) { UI.gdReady = !UI.gdReady; renderView(); return; }
  if (e.target.closest("[data-gd-refresh]")) gdLoad(true);
});

const gdMissingText = u => u.items.filter(i => i.missing).map(i => `${i.missing} ${i.name}`).join(", ");

function gdUnlockCard(u) {
  const state = u.done ? `<span class="tag ok">Sbloccato</span>`
    : u.ready ? `<span class="tag solid">Pronto</span>`
    : `<span class="tag bad">Mancano ${num(u.missing_total)}</span>`;
  const todo = u.done ? "" : todoBtn(u.ready
    ? `Guardian Technology Broker: sblocca ${u.name} (hai tutto)`
    : `Guardian: per ${u.name} mancano ${gdMissingText(u)}`, "", "Materiali");
  const rows = u.items.map(i => `<tr>
      <td>${esc(i.name)}</td><td class="sub" data-no-translate>${esc(t(GD_KIND[i.kind] || ""))}</td>
      <td class="num">${num(i.need)}</td><td class="num">${num(i.have)}</td>
      <td class="num ${i.missing ? "bad" : "ok"}">${i.missing ? num(i.missing) : "✓"}</td></tr>`).join("");
  return `<div class="subpanel ${u.done || u.ready ? "ok" : ""}">
    <h3>${esc(u.name)} ${state}<span class="aside">${todo}</span></h3>
    ${u.note ? `<div class="sub" style="margin-bottom:4px">${esc(u.note)}</div>` : ""}
    <table><thead><tr><th>Serve</th><th>Tipo</th><th class="num">Servono</th><th class="num">Hai</th><th class="num">Mancano</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

function gdSitesPanel(d) {
  const sec = (key, extraNote) => {
    const g = d.sites[key];
    const rows = g.list.map(s => `<tr>
        <td>${sys(s.system)}${s.rec ? ` <span class="tag new" title="Sito consigliato dalla comunità">Consigliato</span>` : ""}</td>
        <td>${esc(s.body)}</td><td class="sub">${esc(s.type)}</td>
        <td class="num">${s.dist == null ? "—" : ly(s.dist)}</td>
        <td>${todoBtn(`Guardian: sito ${g.title} su ${s.system} ${s.body}${s.beacon ? ` (Ancient Key dal Guardian Beacon di ${s.beacon})` : ""}`, s.system, "Viaggi")}</td></tr>`).join("");
    return `<div class="subpanel">
      <h3>${esc(g.title)} <span class="sub">strutture ${esc(g.layouts)} · serve ${esc(g.needs)} · ne hai ${num(g.have)}</span></h3>
      ${extraNote ? `<div class="sub" style="margin-bottom:4px">${extraNote}</div>` : ""}
      <table class="gd-sites"><thead><tr><th>Sistema</th><th>Corpo</th><th>Struttura</th><th class="num">Distanza</th><th></th></tr></thead><tbody>${rows}</tbody></table>
    </div>`;
  };
  const extra = d.extra_sites.map(s => `<tr>
      <td>${sys(s.system)}</td><td>${esc(s.body)}</td><td class="sub">${esc(s.type)}</td><td>${esc(s.what)}</td>
      <td class="num">${s.dist == null ? "—" : ly(s.dist)}</td>
      <td>${todoBtn(`Guardian: ${s.what} — ${s.system} ${s.body}`, s.system, "Viaggi")}</td></tr>`).join("");
  return panel("Dove trovare blueprint e materiali", `
    <div class="sub" style="margin-bottom:10px">Ogni Guardian Structure dà un solo tipo di blueprint, in base alla forma della struttura.
      Porta un SRV, meglio se con un SRV di scorta, e un Point Defence per abbattere i missili delle Guardian Sentinel. Conviene giocare in Solo:
      i materiali di un sito li raccoglie una sola persona.</div>
    ${sec("weapon")}
    ${sec("module")}
    ${sec("vessel", "I siti Vessel chiedono un <b>Ancient Key</b> al posto della Guardian Relic: lo ottieni scansionando con il Data Link Scanner il data core di un Guardian Beacon (si può ripetere). Il beacon di Synuefe KU-F b44-4 rimanda alla struttura di Synuefe EU-Q c21-15 A 1.")}
    <div class="subpanel">
      <h3>Come si ottiene un blueprint (siti Weapon e Module)</h3>
      <ol style="margin:0;padding-left:18px;line-height:1.6">
        <li>Con l'SRV attiva i piloni del sito sparando ai globi di energia, tutti entro il tempo limite.</li>
        <li>Prendi una Guardian Relic e lasciala cadere sul podio da cui parte la sequenza.</li>
        <li>Scansiona con il Data Link Scanner il globo che compare: ricevi un blueprint.</li>
        <li>Per un altro blueprint allontanati, esci dal gioco, rientra e ricomincia.</li>
      </ol>
    </div>
    <div class="subpanel">
      <h3>Materiali e Pattern Obelisk Data</h3>
      <div class="sub" style="margin-bottom:6px">I materiali Guardian cadono dai pannelli distruttibili e dalle Sentinel distrutte. I Pattern Obelisk Data si ottengono scansionando gli obelischi attivi, ma il tipo è casuale: spesso serve uscire e rientrare più volte.</div>
      <table class="gd-sites"><thead><tr><th>Sistema</th><th>Corpo</th><th>Sito</th><th>Cosa</th><th class="num">Distanza</th><th></th></tr></thead><tbody>${extra}</tbody></table>
    </div>`, { code: "GDN-SITES" });
}

VIEWS.guardian = () => {
  gdLoad();
  const r = UI.res.guardian;
  if (!r || (r.busy && !r.data)) return panel("Guardian", `<p class="muted">Caricamento…</p>`);
  if (r.error) return panel("Guardian", `<p class="bad">Impossibile leggere i dati Guardian: ${esc(r.error)}</p>
    <button class="small" data-gd-refresh>Riprova</button>`);
  const d = r.data;
  const curSys = S?.location?.system || d.system || "Sol";
  const group = UI.gdGroup || "all";
  const list = d.unlocks.filter(u => (group === "all" || u.group === group) && (!UI.gdReady || u.ready || u.done));
  const ready = d.unlocks.filter(u => u.ready && !u.done).length;
  const done = d.unlocks.filter(u => u.done).length;

  // Materiali e dati raggruppati per tipo, in tabelle compatte: nome a sinistra, quantità a destra.
  const invGroups = [
    ["Materiali", i => !/Blueprint|Obelisk/.test(i.name), n => n.replace(/^Guardian /, "")],
    ["Frammenti di blueprint", i => /Blueprint/.test(i.name), n => n.replace(/^Guardian /, "").replace(/ Blueprint Fragment$/, "")],
    ["Dati degli obelischi", i => /Obelisk/.test(i.name), n => n.replace(/^Pattern /, "").replace(/ Obelisk Data$/, "")],
  ];
  const inv = `<div class="gd-inv">${invGroups.map(([title, match, label]) => {
      const items = d.inventory.filter(match);
      return items.length ? `<div class="subpanel"><h3>${esc(title)}</h3><table class="gd-inv-t"><tbody>${items.map(i =>
        `<tr title="${esc(i.name)}"><td>${esc(label(i.name))}</td><td class="num ${i.count ? "gold" : "muted"}">${num(i.count)}</td></tr>`).join("")}</tbody></table></div>` : "";
    }).join("")}</div>
    <div class="sub" style="margin-top:8px">Le commodity (HN Shock Mount, Reinforced Mounting Plate…) vengono contate solo nella stiva della nave attuale.</div>`;

  const finder = typeof renderActiveFinderHtml === "function" && UI.activeFinder?.broker === "Guardian" ? renderActiveFinderHtml() : "";
  const head = panel("Guardian Technology Broker", `
    ${finder}
    <div class="kv-grid" style="margin-bottom:10px">
      <div class="kv"><span>Sbloccabili ora</span><span class="${ready ? "ok" : ""}">${ready}</span></div>
      <div class="kv"><span>Già sbloccati</span><span>${done}</span></div>
      <div class="kv"><span>Tecnologie</span><span>${d.unlocks.length}</span></div>
    </div>
    <div class="sub" style="margin-bottom:10px">Ogni tecnologia Guardian si sblocca a un Guardian Technology Broker consegnando blueprint, materiali, dati e commodity.
      "Già sbloccato" compare solo per i moduli e le armi standard, quando il journal registra lo sblocco.</div>
    <div class="eyebrow" style="margin-bottom:6px">I tuoi materiali e dati Guardian</div>
    ${inv}`, { code: "GDN-TECH", aside: `<button class="small primary" data-find-broker="Guardian" data-ref-sys="${esc(curSys)}">◆ Cerca il Guardian Tech Broker più vicino</button>
      <button class="small ghost" data-gd-refresh title="Rileggi materiali e stiva">↻</button>` });

  const chips = `<div class="chips">${GD_GROUPS.map(([k, l]) =>
    `<button class="small ${group === k ? "primary" : ""}" data-gd-group="${k}">${l}</button>`).join("")}
    <button class="small ${UI.gdReady ? "primary" : "ghost"}" data-gd-ready>${UI.gdReady ? "◆ " : ""}Solo pronti</button></div>`;
  const cards = list.length ? list.map(u => gdUnlockCard(u)).join("") : `<p class="muted">Nessuna tecnologia con questi filtri.</p>`;

  return `${head}<div class="grid even">${panel("Cosa serve e cosa ti manca", chips + cards, { code: "GDN-UNLOCK" })}${gdSitesPanel(d)}</div>`;
};
