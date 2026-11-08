"use strict";

// ============================================================================
// MISSIONI A TERRA (Odyssey): missioni on-foot, sessione a piedi, cosa ti serve, settlement visitati
// ============================================================================
// Dati da /api/onfoot/status (app/onfoot.py: fonti dei formati degli eventi nel suo docstring).
// "Cosa ti serve" riusa il calcolo della scheda Tute e armi (odData/odPlan/odCompute in odyssey.js, stesso
// piano salvato in localStorage "onfootPlan") senza modificarla. I luoghi tipici dei materiali ("where") sono
// quelli dei dati condivisi /js/data/odyssey-data.js (fonti in ODYSSEY_DATA.meta.sources). Non mostro una
// tabella "economia del settlement -> materiali": non ho trovato una fonte affidabile che la confermi; al suo
// posto ci sono i settlement dove TU hai già raccolto quel materiale, ricavati dal journal.

const AT_CATS = [["Items", "Items"], ["Components", "Components"], ["Data", "Data"], ["Consumables", "Consumables"]];
// Tag dei nomi interni delle missioni a piedi (EDDI, DataDefinitions/MissionType.cs): solo quelli documentati lì.
const AT_TAGS = {
  Collect: "Collect", Hack: "Hacking", Download: "Download dati", Upload: "Upload dati", Heist: "Heist",
  ProductionHeist: "Heist", POI: "Cache nascosta", Sabotage: "Sabotaggio", Reboot: "Reboot", RebootRestore: "Restore",
  Assassination: "Assassinio", Onslaught: "Onslaught", Salvage: "Salvage", Covert: "furtiva", NCD: "non violenta",
  Disable: "Disable", Massacre: "Massacre",
};

function atLoad() {
  const cur = UI.res.onfoot;
  if (cur?.busy || cur?.loading) return;
  if (cur && Date.now() - (cur.at || 0) < 4000) return;
  if (!cur) UI.res.onfoot = { busy: true };
  else cur.loading = true;
  api("/api/onfoot/status")
    .then(d => { UI.res.onfoot = { data: d, at: Date.now() }; })
    .catch(e => { UI.res.onfoot = cur?.data ? { ...cur, loading: false, at: Date.now() } : { error: e.message, at: Date.now() }; })
    .finally(() => { if (currentTab() === "onfoot_missions") renderView(); });
}

// Dati condivisi della scheda Tute e armi, se disponibili (caricati al primo uso da odyssey.js).
function atOdData() {
  if (typeof odData !== "function") return null;
  try { return odData(); } catch { return null; }
}
const atName = (D, id, fallback) => D?.materials?.[id]?.name || fallback || id;

function atMissionsPanel(d) {
  const ms = d.missions || [];
  if (!ms.length) return panel("Missioni a terra attive", '<div class="empty">Nessuna missione a piedi attiva.</div>', { code: "ON-FOOT" });
  const rows = ms.map(m => {
    const tags = (m.tags || []).filter(t => AT_TAGS[t]).map(t => `<span class="tag" style="font-size:10px">${esc(AT_TAGS[t])}</span>`).join(" ");
    const dest = m.settlement || m.station;
    return `<tr><td><b>${esc(m.name)}</b>${tags ? `<div style="margin-top:3px">${tags}</div>` : ""}<div class="sub">${esc(m.faction || "")}</div></td>
      <td>${dest ? esc(dest) : '<span class="muted">—</span>'}<div class="sub">${sys(m.system)}</div></td>
      <td class="num">${cr(m.reward)}</td><td>${until(m.expiry)}</td>
      <td>${todoBtn(LANG.t(`Missione a terra: ${m.name}${dest ? " a " + dest : ""}`), m.system || "", "Missioni")}</td></tr>`;
  }).join("");
  return panel("Missioni a terra attive", `<table><thead><tr><th>Missione</th><th>Destinazione</th><th class="num">Ricompensa</th><th>Scade</th><th></th></tr></thead><tbody>${rows}</tbody></table>
    <div class="sub" style="margin-top:6px">Riconosciute dal nome interno della missione (contiene "OnFoot"). Ricompensa in crediti dichiarata all'accettazione.</div>`,
    { code: "ON-FOOT", aside: `${ms.length} attive · ${cr(ms.reduce((s, m) => s + (m.reward || 0), 0))}` });
}

function atCollectedList(D, collected) {
  const parts = AT_CATS.map(([k, label]) => {
    const items = collected?.[k] || [];
    if (!items.length) return "";
    const tot = items.reduce((s, i) => s + i.count, 0);
    return `<div style="margin-top:6px"><div class="eyebrow">${label} <span class="muted">· ${num(tot)}</span></div>
      <div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:3px">${items.map(i => `<span class="tag" style="font-size:11px">${esc(atName(D, i.id, i.name))} ×${i.count}</span>`).join("")}</div></div>`;
  }).join("");
  return parts || '<div class="sub" style="margin-top:6px">Nessun oggetto raccolto.</div>';
}

function atSessionPanel(D, d) {
  const s = d.session || {};
  const state = d.on_foot ? `<span class="ok">A PIEDI</span>${d.here ? ` · ${esc(d.here)}` : ""}` : '<span class="muted">a bordo</span>';
  const settl = (d.session_settlements || []).map(x => `<span class="tag" style="font-size:11px">${esc(x.name)}</span>`).join(" ");
  const body = `<div class="kv-grid">
      <div class="kv"><span>Stato</span><span>${state}</span></div>
      <div class="kv"><span>Tempo a piedi</span><span class="mono">${dur(s.foot_s || 0)}</span><span class="sub">${num(s.disembarks || 0)} discese</span></div>
      <div class="kv"><span>Settlement visitati</span><span>${num(s.settlements_n || 0)}</span></div>
      <div class="kv"><span>Oggetti raccolti</span><span>${num(s.collected_n || 0)}</span>${s.mission_items ? `<span class="sub">+${num(s.mission_items)} di missione</span>` : ""}</div>
      <div class="kv"><span>Venduti al Bartender</span><span class="gold">${cr(s.sold_cr || 0)}</span><span class="sub">${num(s.sold_n || 0)} oggetti</span></div>
      <div class="kv"><span>Acquisti micro-resources</span><span>${cr(s.bought_cr || 0)}</span><span class="sub">${num(s.bought_n || 0)} oggetti${s.trades ? ` · ${s.trades} baratti` : ""}</span></div>
      <div class="kv"><span>Uccisioni a piedi</span><span>${num(s.kills || 0)}</span><span class="sub">${s.bounty_cr ? `Bounty ${cr(s.bounty_cr)}` : ""}${s.bonds_cr ? ` · Combat Bond ${cr(s.bonds_cr)}` : ""}</span></div>
      <div class="kv"><span>Missioni completate</span><span>${num(s.missions_done || 0)}</span><span class="sub">${s.missions_cr ? cr(s.missions_cr) : ""}</span></div>
      <div class="kv"><span>Morti a piedi</span><span class="${s.deaths ? "bad" : ""}">${num(s.deaths || 0)}</span></div>
    </div>
    ${settl ? `<div class="eyebrow" style="margin-top:8px">Settlement di questa sessione</div><div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:3px">${settl}</div>` : ""}
    ${atCollectedList(D, s.collected)}
    <div class="sub" style="margin-top:8px">Sessione = dall'ultimo accesso al gioco${d.session_start ? ` (${esc(ago(d.session_start))})` : ""}. Raccolti = oggetti entrati nello zaino (BackpackChange), esclusi gli oggetti di missione. Uccisioni contate solo mentre eri a piedi.</div>`;
  return panel("Sessione a terra", body, { code: "SESSIONE" });
}

function atNeedsPanel(D, d) {
  if (typeof odCompute !== "function" || typeof odPlan !== "function") return panel("Cosa ti serve", '<div class="empty">Calcolo della scheda Tute e armi non disponibile.</div>', { code: "SERVE" });
  if (!D) return panel("Cosa ti serve", '<div class="loading">CARICAMENTO DATI ODYSSEY</div>', { code: "SERVE" });
  const plan = odPlan();
  if (!plan.length) return panel("Cosa ti serve", '<div class="empty">Nessun obiettivo nel pianificatore. Aggiungi una tuta o un\'arma da potenziare nella scheda <a href="#onfoot">Tute e armi</a>: qui vedrai cosa manca e dove l\'hai già trovato.</div>', { code: "SERVE" });
  let res;
  try { res = odCompute(D, plan); } catch (e) { return panel("Cosa ti serve", `<div class="bad">⚠ ${esc(e.message)}</div>`, { code: "SERVE" }); }
  const missing = res.rows.filter(r => r.missing);
  if (!missing.length) return panel("Cosa ti serve", '<div class="empty ok">Hai già tutti i materiali per gli obiettivi della scheda Tute e armi ✓</div>', { code: "SERVE", aside: "tutto pronto" });
  // Dove l'hai già raccolto (journal): settlement che contengono quel materiale, i più ricchi prima.
  const found = {};
  for (const s of d.settlements || []) for (const i of s.collected || []) (found[i.id] ||= []).push({ s, n: i.count });
  const rows = missing.map(r => {
    const f = (found[r.id] || []).sort((a, b) => b.n - a.n).slice(0, 3);
    const fhtml = f.length ? f.map(x => `<div class="sub" style="font-size:11px">${esc(x.s.name)} <span class="muted">${esc([x.s.economy, x.s.body].filter(Boolean).join(" · "))}</span> ×${x.n}</div>`).join("") : '<span class="muted">—</span>';
    return `<tr><td><span title="${esc((r.uses || []).join("\n"))}">${esc(r.name)}</span><div class="sub">${esc(r.cat)}</div></td>
      <td class="num bad">${r.missing}</td><td class="sub" style="font-size:11px">${esc(r.where || "—")}</td><td>${fhtml}</td></tr>`;
  }).join("");
  return panel("Cosa ti serve", `<table><thead><tr><th>Materiale</th><th class="num">Manca</th><th>Dove si trova di solito</th><th>Dove l'hai già raccolto</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="sub" style="margin-top:6px">Dal pianificatore della scheda <a href="#onfoot">Tute e armi</a> (inventario: ShipLocker). "Dove l'hai già raccolto" viene dal tuo journal; l'economia indicata è quella del settlement, non una garanzia che lì il materiale ricompaia.</div>`,
    { code: "SERVE", aside: `${missing.length} da procurare` });
}

function atSettlementsPanel(D, d) {
  const list = d.settlements || [];
  if (!list.length) return panel("Settlement visitati", '<div class="empty">Nessun settlement nei journal. Compaiono quando ti avvicini a uno (evento ApproachSettlement).</div>', { code: "STORICO" });
  const lim = UI.atAll ? list.length : 15;
  const rows = list.slice(0, lim).map(s => {
    const got = s.collected?.length
      ? s.collected.slice(0, 8).map(i => `<span class="tag" style="font-size:10px">${esc(atName(D, i.id, i.name))} ×${i.count}</span>`).join(" ") + (s.collected.length > 8 ? ` <span class="muted">+${s.collected.length - 8}</span>` : "")
      : '<span class="muted">—</span>';
    return `<tr><td><b>${esc(s.name)}</b>${s.bartender ? ' <span class="tag" style="font-size:10px">Bartender</span>' : ""}<div class="sub">${esc(s.body || "")}</div></td>
      <td>${s.system ? sys(s.system) : '<span class="muted">—</span>'}</td>
      <td class="sub">${esc([s.economy, s.government].filter(Boolean).join(" · ") || "—")}${s.faction ? `<div style="font-size:11px">${esc(s.faction)}</div>` : ""}</td>
      <td class="num">${s.visits}</td><td class="sub">${esc(ago(s.last))}</td>
      <td>${got}${s.collected_n ? `<div class="sub" style="font-size:11px">${num(s.collected_n)} oggetti</div>` : ""}</td></tr>`;
  }).join("");
  const more = list.length > 15 ? `<button class="small ghost" data-at-all style="margin-top:8px">${UI.atAll ? "Mostra meno" : `Mostra tutti (${list.length})`}</button>` : "";
  return panel("Settlement visitati", `<table><thead><tr><th>Settlement</th><th>Sistema</th><th>Economia · governo</th><th class="num">Visite</th><th>Ultima</th><th>Raccolto qui</th></tr></thead><tbody>${rows}</tbody></table>${more}
    <div class="sub" style="margin-top:6px">Gli oggetti sono attribuiti all'ultimo settlement a cui ti sei avvicinato sullo stesso corpo celeste: il journal non registra il punto esatto della raccolta.</div>`,
    { code: "STORICO", aside: `${list.length} settlement` });
}

function atTotalsPanel(D, d) {
  const t = d.total || {};
  const log = (d.log || []).map(l => `<div class="sub" style="display:flex;justify-content:space-between;gap:8px"><span>${esc(l.text)}</span><span class="muted">${esc(ago(l.ts))}</span></div>`).join("");
  return panel("Totale nei journal", `<div class="kv-grid">
      <div class="kv"><span>Tempo a piedi</span><span class="mono">${dur(t.foot_s || 0)}</span></div>
      <div class="kv"><span>Oggetti raccolti</span><span>${num(t.collected_n || 0)}</span></div>
      <div class="kv"><span>Venduti al Bartender</span><span class="gold">${cr(t.sold_cr || 0)}</span></div>
      <div class="kv"><span>Missioni a terra completate</span><span>${num(t.missions_done || 0)}</span><span class="sub">${t.missions_cr ? cr(t.missions_cr) : ""}</span></div>
      <div class="kv"><span>Uccisioni a piedi</span><span>${num(t.kills || 0)}</span></div>
      <div class="kv"><span>Morti a piedi</span><span>${num(t.deaths || 0)}</span></div>
    </div>${atCollectedList(D, t.collected)}
    ${log ? `<div class="eyebrow" style="margin-top:10px">Ultimi eventi</div>${log}` : ""}`, { code: "TOTALE" });
}

VIEWS.onfoot_missions = () => {
  atLoad();
  const r = UI.res.onfoot;
  if (!r || r.busy) return panel("Missioni a terra", '<div class="loading">LETTURA DEL JOURNAL</div>', { code: "ODYSSEY" });
  if (r.error) return panel("Missioni a terra", `<div class="bad">⚠ ${esc(r.error)}</div>`, { code: "ODYSSEY" });
  const d = r.data, D = atOdData();
  return `<div class="grid"><div class="col">${atMissionsPanel(d)}${atNeedsPanel(D, d)}${atSettlementsPanel(D, d)}</div>
    <div class="col">${atSessionPanel(D, d)}${atTotalsPanel(D, d)}</div></div>`;
};

document.addEventListener("click", e => {
  if (e.target.closest?.("[data-at-all]")) { UI.atAll = !UI.atAll; renderView(); }
});
