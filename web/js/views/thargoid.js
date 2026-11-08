"use strict";

// ============================================================================
// THARGOID & AX
// ============================================================================
// Dati da /api/thargoid (journal + Loadout). Fonti di stato della guerra, valori dei bond, simboli e note dei
// moduli: vedi l'intestazione di app/thargoid.py. Niente stato "live" della guerra: non esiste più una fonte
// pubblica documentata, e dalla fine della guerra (18/12/3310) non ci sono Titan né sistemi in guerra.
// Il risultato resta in UI.res: l'aggiornamento automatico ogni 2 secondi non rifà la richiesta.

function tgLoad(quiet = false) {
  const cur = UI.res.tg;
  if (cur?.busy || cur?.loading) return;
  if (!quiet || !cur) UI.res.tg = { busy: true };
  else cur.loading = true;
  api("/api/thargoid")
    .then(d => { UI.res.tg = { data: d, at: Date.now() }; })
    .catch(e => { UI.res.tg = cur?.data ? { ...cur, loading: false, at: Date.now() } : { error: e.message, at: Date.now() }; })
    .finally(() => { if (currentTab() === "thargoid") renderView(); });
}
document.addEventListener("click", e => {
  if (e.target.closest("[data-tg-refresh]")) tgLoad();
});

const TG_SRC = s => s === "wiki" ? ' <span class="tag" title="Valore del bond dalla wiki della comunità, non confermato da Frontier">stima</span>' : "";

function tgTypeTable(rows, empty) {
  if (!rows.length) return `<div class="empty">${empty}</div>`;
  return `<table><thead><tr><th>Tipo</th><th class="num">Uccisioni</th><th class="num">Bond</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td><b>${r.type === "?" ? "Non identificato" : esc(r.type)}</b>${r.type !== r.class && r.type !== "?" ? ` <span class="sub">${esc(r.class)}</span>` : ""}${TG_SRC(r.source)}
      ${r.type === "?" ? `<div class="sub">Valori: ${r.rewards.map(v => num(v)).join(", ")} CR</div>` : ""}</td>
      <td class="num">${num(r.count)}</td><td class="num gold">${short(r.credits)}</td></tr>`).join("")}</tbody></table>`;
}

function tgWar(d) {
  return `<p>La <b>Seconda guerra Thargoid è finita il 18 dicembre 3310</b>: l'ultimo Titan, <b>Cocijo</b>, è stato distrutto in Sol.
    Da allora non ci sono più Titan, Maelstrom né sistemi in guerra (Alert, Invasion, Controlled, Recovery), e fino a novembre 3312 il GalNet non ha riportato nuove offensive.</p>
    <p>I Thargoid però esistono ancora: si incontrano nelle <b>Non-Human Signal Source</b> (Pleiadi, Coalsack, Witch Head) e nelle
    <b>AX Conflict Zone</b> rimaste nella California Nebula. Si possono trovare anche nelle strutture Thargoid in superficie e nei siti statici.</p>
    <div class="subpanel"><h3>Stato in tempo reale</h3>
      <div class="sub">Non disponibile: il servizio della comunità che seguiva la guerra sistema per sistema ha chiuso dopo la vittoria,
      e non esiste un'altra fonte pubblica dei sistemi coinvolti. Le AX Conflict Zone che vedi tu con l'FSS sono elencate più sotto.</div></div>`;
}

function tgBonds(d) {
  const p = d.pending, s = d.session;
  return `<div class="kv-grid">
      <div class="kv"><span>Bond AX da riscuotere</span><span class="gold">${cr(p.amount)}</span></div>
      <div class="kv"><span>Sessione: uccisioni</span><span>${num(s.kills)}</span></div>
      <div class="kv"><span>Sessione: bond</span><span class="gold">${short(s.credits)}</span></div>
      <div class="kv"><span>Totale: uccisioni</span><span>${num(d.kills_total)}</span></div>
      <div class="kv"><span>Totale: bond</span><span class="gold">${short(d.credits_total)}</span></div>
    </div>
    <div class="sub" style="margin-top:8px">I bond AX li paga la <b>Pilots' Federation</b> e si riscuotono dal menu Contacts delle stazioni. ${p.last_redeem ? `<span>Ultimo incasso: ${cr(p.last_redeem.amount)} ${ago(p.last_redeem.ts)}${p.last_redeem.system ? ` in ${esc(p.last_redeem.system)}` : ""}${p.last_redeem.broker ? ` (commissione ${p.last_redeem.broker}%)` : ""}.</span>` : ""}
      ${p.lost ? ` <span class="bad">${cr(p.lost.amount)} di bond persi con la distruzione della nave ${ago(p.lost.ts)}.</span>` : ""}</div>
    <div class="sub" style="margin-top:4px">Stima dal journal: conta i tuoi bond contro i Thargoid, toglie gli incassi della Pilots' Federation e riparte da zero quando la nave viene distrutta.</div>`;
}

function tgKills(d) {
  const recent = d.recent.length ? `<table><thead><tr><th>Quando</th><th>Tipo</th><th>Sistema</th><th class="num">Bond</th></tr></thead><tbody>
    ${d.recent.map(k => `<tr><td class="sub">${ago(k.ts)}</td><td>${k.type === "?" ? '<span class="muted">non identificato</span>' : esc(k.type)}${TG_SRC(k.source)}</td>
      <td>${k.system ? sys(k.system) : "—"}</td><td class="num gold" title="${num(k.reward)} CR">${short(k.reward)}</td></tr>`).join("")}</tbody></table>` : "";
  return `<div class="subpanel"><h3>Questa sessione</h3>${tgTypeTable(d.session.by_type, "Nessuna uccisione di Thargoid in questa sessione")}</div>
    <div class="subpanel"><h3>Da sempre <span class="sub">(journal presenti sul PC)</span></h3>${tgTypeTable(d.by_type, "Nei journal non ci sono uccisioni di Thargoid")}</div>
    ${recent ? `<div class="subpanel"><h3>Ultime uccisioni</h3>${recent}</div>` : ""}
    <div class="sub">Il journal non dice quale nave Thargoid hai distrutto: il tipo si ricava dal valore del bond. Gli Interceptor usano i valori ufficiali
      (cambiati il 28 maggio 2024); Scout, Hunter, Banshee e Revenant quelli raccolti dalla comunità, segnati come stima.</div>`;
}

function tgSignals(d) {
  const h = d.here;
  const here = h.system ? `<div class="subpanel ${h.cz || h.nhss ? "ok" : ""}"><h3>Qui: ${sys(h.system)}</h3>
      ${h.cz ? `<div><span class="tag solid">AX Conflict Zone</span>${h.cz_levels.map(l => `<span class="tag">${esc(l)}</span>`).join("")}</div>` : ""}
      ${h.nhss ? `<div><span class="tag">Non-Human Signal Source</span> <span class="sub">${num(h.nhss)} segnali visti</span></div>` : ""}
      ${!h.cz && !h.nhss ? '<div class="sub">Nessun segnale Thargoid visto in questo sistema (servono FSS o i segnali in supercruise).</div>' : ""}</div>` : "";
  const cz = d.cz_seen.length ? `<table><thead><tr><th>Sistema</th><th>Intensità</th><th class="num">Visto</th></tr></thead><tbody>
    ${d.cz_seen.map(c => `<tr><td>${sys(c.system)}</td><td>${c.levels.map(l => `<span class="tag">${esc(l)}</span>`).join("") || "—"}</td><td class="num sub">${ago(c.last)}</td></tr>`).join("")}</tbody></table>`
    : '<div class="empty">Nei tuoi journal non ci sono AX Conflict Zone</div>';
  const nh = d.nhss_seen.length ? `<table><thead><tr><th>Sistema</th><th class="num">Segnali</th><th class="num">Visto</th></tr></thead><tbody>
    ${d.nhss_seen.map(c => `<tr><td>${sys(c.system)}</td><td class="num">${num(c.count)}</td><td class="num sub">${ago(c.last)}</td></tr>`).join("")}</tbody></table>`
    : '<div class="empty">Nei tuoi journal non ci sono Non-Human Signal Source</div>';
  return `${here}<div class="subpanel"><h3>AX Conflict Zone che hai visto</h3>${cz}</div>
    <div class="subpanel"><h3>Non-Human Signal Source che hai visto</h3>${nh}</div>`;
}

function tgPlaces(d) {
  return `<table><thead><tr><th>Sistema</th><th>Cosa</th><th class="num">Distanza</th></tr></thead><tbody>
    ${d.places.map(p => `<tr><td><b>${sys(p.system)}</b><div class="sub">${esc(p.note)}</div>${todoBtn(`AX: ${p.kind} in ${p.system}`, p.system, "Combattimento")}</td>
      <td><span class="tag">${p.kind === "AX Conflict Zone" ? "AX CZ" : "NHSS"}</span></td><td class="num" style="white-space:nowrap">${ly(p.distance)}</td></tr>`).join("")}</tbody></table>
    <div class="sub" style="margin-top:6px">Segnalazioni della comunità AX di febbraio 2025: controlla in gioco che ci siano ancora.
      Le AX Conflict Zone note sono tutte intorno a HIP 18390 (California Nebula).</div>`;
}

function tgFleet(d) {
  if (!d.fleet.length) return '<div class="empty">Nessuna nave nei journal</div>';
  const yes = (v, label) => `<span class="tag ${v ? "solid" : ""}" title="${esc(label)}">${v ? "✓" : "✗"} ${esc(label)}</span>`;
  return d.fleet.map(s => {
    const title = `${esc(s.type || "?")}${s.name ? ` <span class="sub">${esc(s.name)}</span>` : ""}${s.current ? ' <span class="tag solid">in uso</span>' : ""}`;
    if (!s.known) return `<div class="subpanel"><h3>${title}</h3><div class="sub">Dotazione sconosciuta: sali a bordo almeno una volta perché il journal la registri.</div></div>`;
    const ok = s.ax_weapons && s.scanner;
    return `<div class="subpanel ${ok ? "ok" : ""}"><h3>${title}<span class="aside">${s.ax_weapons ? `<span class="tag solid">${s.ax_weapons} armi AX</span>` : '<span class="tag">nessuna arma AX</span>'}</span></h3>
      <div style="margin-bottom:6px">${yes(s.scanner, "Xeno Scanner")}${yes(s.caustic.length, "Protezione caustica")}${yes(s.sfn, "Shutdown Field Neutraliser")}${yes(s.flak, "Flak")}</div>
      ${s.modules.length ? `<table><tbody>${s.modules.map(m => `<tr><td><b>${esc(m.name)}</b><div class="sub">${esc(m.note)}</div></td></tr>`).join("")}</tbody></table>`
        : '<div class="sub">Nessun modulo AX o Guardian a bordo.</div>'}</div>`;
  }).join("") + `<div class="sub">Gli Interceptor resistono alle armi normali: per danneggiarli servono armi AX o Guardian. Lo Xeno Scanner serve per mirare i Thargoid Hearts.
    Le dotazioni sono quelle dell'ultimo Loadout di ogni nave.</div>`;
}

function tgModules(d) {
  const kinds = { weapon: "Armi", utility: "Utility", internal: "Interni" };
  return Object.entries(kinds).map(([k, label]) => `<div class="subpanel"><h3>${label}</h3><table><tbody>
    ${d.modules.filter(m => m.kind === k).map(m => `<tr><td><b>${esc(m.name)}</b><div class="sub">${esc(m.note)}</div></td></tr>`).join("")}</tbody></table></div>`).join("");
}

VIEWS.thargoid = () => {
  const r = UI.res.tg;
  if (!r) tgLoad();
  else if (!r.busy && !r.loading && Date.now() - (r.at || 0) > 15000) tgLoad(true);
  if (!r || r.busy) return panel("Thargoid & AX", '<div class="loading">LETTURA DEI JOURNAL</div>', { code: "AX" });
  if (r.error) return panel("Thargoid & AX", `<div class="bad">⚠ ${esc(r.error)}</div><button class="small" data-tg-refresh>Riprova</button>`, { code: "AX" });
  const d = r.data;
  const refresh = '<button class="small ghost" data-tg-refresh title="Rileggi i journal">Aggiorna</button>';
  return `<div class="cards">
    ${panel("Stato della guerra", tgWar(d), { code: "WAR", aside: '<span class="tag">conclusa</span>' })}
    ${panel("Combat bond AX", tgBonds(d), { code: "BOND", aside: refresh })}
    ${panel("Uccisioni per tipo", tgKills(d), { code: "KILLS" })}
    ${panel("Dove trovare i Thargoid", tgPlaces(d), { code: "NAV" })}
    ${panel("Segnali Thargoid nei tuoi journal", tgSignals(d), { code: "FSS" })}
    ${panel("Allestimenti AX della flotta", tgFleet(d), { code: "FLEET" })}
    ${panel("Moduli AX: a cosa servono", tgModules(d), { code: "MODS" })}
  </div>`;
};
