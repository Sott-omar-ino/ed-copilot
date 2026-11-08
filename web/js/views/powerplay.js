"use strict";

// ============================================================================
// POWERPLAY (Powerplay 2.0)
// ============================================================================
// Lo stato arriva da /api/powerplay/status (journal), le ricerche da /api/powerplay/nearby (Spansh, solo in background).
// Fonti delle regole: guida Powerplay 2.0 di Inara (logbook 84502) e annunci Frontier (vedi app/powerplay.py).
// Entrambi restano in UI.res: l'aggiornamento automatico ogni 2 secondi non rifà le richieste.
const PP_STATES = [
  ["Acquisition", "Acquisition · da conquistare"],
  ["Exploited", "Exploited · tuoi, da rinforzare"],
  ["Fortified", "Fortified · tuoi, da rinforzare"],
  ["Stronghold", "Stronghold · tuoi, da rinforzare"],
  ["enemy", "Dove sono i nemici · Undermining"],
];
const PP_STATE_LABEL = { Unoccupied: "Unoccupied (Acquisition)", Exploited: "Exploited", Fortified: "Fortified", Stronghold: "Stronghold" };
const PP_REL = {
  Reinforcement: ["ok", "Sistema della tua power: fai Reinforcement per mantenerlo e farlo salire di livello."],
  Acquisition: ["gold", "Sistema in Acquisition per la tua power: porta merits per conquistarlo."],
  Undermining: ["bad", "Sistema controllato da una power rivale: fai Undermining per indebolirlo."],
};
const ppPct = v => v == null ? "—" : (v * 100).toLocaleString(NUM_LOCALE, { maximumFractionDigits: 1 }) + "%";

function ppLoadStatus(quiet = false) {
  const cur = UI.res.ppStatus;
  if (cur?.busy || cur?.loading) return;
  if (!quiet || !cur) UI.res.ppStatus = { busy: true };
  else cur.loading = true;
  api("/api/powerplay/status")
    .then(d => { UI.res.ppStatus = { data: d, at: Date.now() }; })
    .catch(e => { UI.res.ppStatus = cur?.data ? { ...cur, loading: false, at: Date.now() } : { error: e.message, at: Date.now() }; })
    .finally(() => { if (currentTab() === "powerplay") renderView(); });
}

function ppSearch() {
  const f = UI.forms.pp || {}, st = UI.res.ppStatus?.data;
  const q = new URLSearchParams({
    power: f.power ?? st?.power ?? "", state: f.ppstate || "Acquisition",
    ref: (f.ref || "").trim() || S.location.system || "Sol", radius: f.radius || 30 });
  run("ppNearby", async () => {
    const d = await api("/api/powerplay/nearby?" + q);
    if (d.error) throw new Error(d.error);
    return d;
  });
}
document.addEventListener("submit", e => {
  if (e.target.dataset?.form !== "pp") return;
  e.preventDefault();
  ppSearch();
});
document.addEventListener("click", e => {
  if (e.target.closest("[data-pp-refresh]")) ppLoadStatus();
});

function ppProgress(s) {
  if (!s) return "";
  const rows = [];
  if (s.state && s.state !== "Unoccupied" && s.control_progress != null) {
    rows.push(`<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between"><span class="sub">Control progress (${esc(s.state)})</span><span class="mono">${ppPct(s.control_progress)}</span></div>
      ${meter(s.control_progress * 100, s.control_progress < 0.25 ? "bad" : s.control_progress >= 1 ? "full" : "")}</div>`);
  }
  if (s.reinforcement != null || s.undermining != null) {
    const r = s.reinforcement || 0, u = s.undermining || 0, tot = r + u;
    rows.push(`<div class="kv-grid" style="margin-bottom:10px">
      <div class="kv"><span>Reinforcement</span><span class="ok">${num(r)}</span></div>
      <div class="kv"><span>Undermining</span><span class="bad">${num(u)}</span></div></div>
      ${tot ? `<div class="sub">Quota Reinforcement questo ciclo: ${ppPct(r / tot)}</div>${meter(r / tot * 100, r < u ? "bad" : "")}` : ""}`);
  }
  if (s.conflict?.length) {
    rows.push(`<div class="sub" style="margin:6px 0 4px">Acquisition in corso (100% = soglia di conquista)</div>` + s.conflict.map(c =>
      `<div style="margin-bottom:6px"><div style="display:flex;justify-content:space-between"><span>${esc(c.power)}</span><span class="mono">${ppPct(c.progress)}</span></div>
      ${meter((c.progress || 0) * 100, c.progress >= 1 ? "full" : "holo")}</div>`).join(""));
  }
  return rows.join("") || '<div class="empty">Nessun dato di avanzamento per questo sistema</div>';
}

function ppActivities(acts, key) {
  const a = acts?.[key];
  if (!a) return "";
  return `<div style="margin-bottom:10px"><b>${esc(a.title)}</b> <span class="sub">· ${esc(a.where)}</span>
    <ul style="margin:6px 0 0 18px;padding:0">${a.items.map(i => `<li>${esc(i)}</li>`).join("")}</ul></div>`;
}

VIEWS.powerplay = () => {
  const r = UI.res.ppStatus;
  // Primo caricamento, poi un aggiornamento leggero ogni 30 s o quando cambi sistema.
  if (!r) ppLoadStatus();
  else if (!r.busy && !r.loading && (Date.now() - (r.at || 0) > 30000
    || (r.data?.system?.name && S.location.system && r.data.system.name !== S.location.system && Date.now() - (r.at || 0) > 3000))) ppLoadStatus(true);
  if (!r || r.busy) return panel("Powerplay", '<div class="loading">LETTURA DEI JOURNAL</div>', { code: "PP-2.0" });
  if (r.error) return panel("Powerplay", `<div class="bad">⚠ ${esc(r.error)}</div><button class="small" data-pp-refresh>Riprova</button>`, { code: "PP-2.0" });
  const d = r.data, s = d.system, acts = d.activities;

  // --- comandante ---
  const cmdr = d.pledged
    ? `<div class="eyebrow">Power</div><div class="display" style="font-size:28px">${esc(d.power)}</div>
      <div class="kv-grid" style="margin-top:14px">
        <div class="kv"><span>Rank</span><span>${d.rank ?? "—"}</span></div>
        <div class="kv"><span>Merits totali</span><span class="gold">${num(d.merits)}</span></div>
        <div class="kv"><span>Merits sessione</span><span>${num(d.merits_session)}</span></div>
        <div class="kv"><span>Merits settimana</span><span>${num(d.merits_week)}</span></div>
        <div class="kv"><span>Reset settimanale</span><span>${until(d.next_reset)}</span></div>
        <div class="kv"><span>Pledged da</span><span>${d.pledged_since ? ago(d.pledged_since).replace(/ (fa|ago)$/, "") : "—"}</span></div>
      </div><div class="sub" style="margin-top:8px">La settimana Powerplay ricomincia il giovedì verso le 07:00 UTC, con la manutenzione settimanale.</div>`
    : `<div class="eyebrow">Non sei pledged</div>
      <p>Nei journal non risulta l'adesione a nessuna power. In Powerplay 2.0 ti unisci a una power dalla scheda <b>Powerplay</b>
      del pannello di destra della nave: da lì guadagni merits, sali di rank e sblocchi bonus e moduli della power.
      Se lasci la power i merits tornano a zero e perdi i bonus.</p>
      <table><thead><tr><th>Power</th><th>Allegiance</th></tr></thead><tbody>
      ${d.powers.map(p => `<tr><td><b>${esc(p.full)}</b>${p.full !== p.name ? ` <span class="sub">(${esc(p.name)})</span>` : ""}</td><td>${esc(T("value", p.allegiance))}</td></tr>`).join("")}
      </tbody></table>
      <div class="sub" style="margin-top:8px">Puoi comunque cercare i sistemi di una power qui sotto, scegliendola nel modulo.</div>`;

  // --- sistema corrente ---
  const rel = s?.relation && PP_REL[s.relation];
  const here = s ? `<div class="eyebrow">Sistema corrente</div><div style="font-size:20px;margin-bottom:8px">${sys(s.name)}</div>
    <div class="sys-meta" style="margin-bottom:10px">
      <span><b>STATO</b>${esc(PP_STATE_LABEL[s.state] || s.state || "Nessuna power")}</span>
      <span><b>CONTROLLO</b>${esc(s.controlling_power || "—")}</span>
    </div>
    ${s.powers.length ? `<div style="margin-bottom:10px">${s.powers.map(p => `<span class="tag ${p === d.power ? "solid" : ""}">${esc(p)}</span>`).join("")}</div>` : ""}
    ${ppProgress(s)}` : '<div class="empty">Nessun salto registrato nei journal</div>';

  let todo;
  if (!s) todo = '<div class="empty">Entra in un sistema per sapere cosa fare</div>';
  else if (!d.pledged) todo = `<p class="sub">Senza power non guadagni merits. Ecco cosa si fa nei vari tipi di sistema:</p>
    ${ppActivities(acts, "Acquisition")}${ppActivities(acts, "Reinforcement")}${ppActivities(acts, "Undermining")}`;
  else if (rel) todo = `<p class="${rel[0]}">${esc(rel[1])}</p>${ppActivities(acts, s.relation)}
    ${todoBtn(LANG.t(`Powerplay: ${s.relation} a ${s.name}`), s.name, "Powerplay")}`;
  else todo = `<p class="sub">${s.state === "Unoccupied"
    ? "Sistema Unoccupied fuori dal raggio della tua power: qui non puoi fare Acquisition."
    : "Nessuna power in questo sistema: qui non guadagni merits di sistema."} Usa la ricerca qui sotto per trovare dove andare.</p>`;

  // --- ricerca ---
  const f = "pp", res = result("ppNearby", n => {
    const isEnemy = n.state === "enemy";
    return `<div class="sub" style="margin-bottom:6px">${n.results.length} sistemi entro ${ly(n.radius)} da ${esc(n.reference)}${n.power ? " · " + esc(n.power) : ""}${n.truncated ? "<span> · mostrati i più vicini</span>" : ""}</div>
    <table><thead><tr><th>Sistema</th><th class="num">Dist.</th><th>Stato</th><th>${isEnemy ? "Controllato da" : "Power"}</th><th class="num">Popolazione</th><th>Economia</th><th>Stazioni</th><th></th></tr></thead><tbody>
    ${n.results.map(x => {
      const act = n.state === "Acquisition" ? "Acquisition" : isEnemy ? "Undermining" : "Reinforcement";
      return `<tr><td>${sys(x.name)}<div class="sub">${esc(x.security || "")}${x.faction_state && x.faction_state !== "None" ? " · " + esc(x.faction_state) : ""}</div></td>
      <td class="num">${ly(x.distance)}</td>
      <td>${esc(PP_STATE_LABEL[x.state] || x.state || "—")}${x.control_progress != null ? `<div class="sub">${ppPct(x.control_progress)}</div>` : ""}</td>
      <td>${x.controlling_power ? `<b>${esc(x.controlling_power)}</b>` : ""}<div class="sub">${esc(x.powers.filter(p => p !== x.controlling_power).join(", ")) || ""}</div></td>
      <td class="num">${x.population ? short(x.population) : "—"}</td>
      <td>${esc(T("value", x.economy || "—"))}${x.second_economy && x.second_economy !== "None" ? `<div class="sub">${esc(T("value", x.second_economy))}</div>` : ""}</td>
      <td>${x.stations || "—"}${x.large_pad ? ' <span class="ok">L</span>' : ""}${x.power_contact ? '<div class="sub">Power Contact</div>' : ""}</td>
      <td>${todoBtn(LANG.t(`Powerplay: ${act} a ${x.name}`), x.name, "Powerplay")}</td></tr>`;
    }).join("") || '<tr><td colspan="8"><div class="empty">Nessun sistema trovato: prova ad allargare il raggio</div></td></tr>'}</tbody></table>
    <div class="sub" style="margin-top:6px">Dati inviati dai giocatori: potrebbero non essere aggiornati. In cache per 15 minuti.</div>`;
  }, "Scegli lo stato e premi Cerca.");
  const power = fv(f, "power", d.power || "");
  const form = `<form class="form" data-form="${f}" id="f-pp">
    <label>Power<select name="power">${opt("", d.pledged ? "Qualsiasi" : "Qualsiasi power", power)}${d.powers.map(p => opt(p.name, p.full, power)).join("")}</select></label>
    <label>Cerca<select name="ppstate">${PP_STATES.map(([v, l]) => opt(v, l, fv(f, "ppstate", "Acquisition"))).join("")}</select></label>
    ${inp(f, "ref", "Vicino a", "", `placeholder="${esc(S.location.system || "Sol")}"`)}
    ${inp(f, "radius", "Entro (al)", "30", 'type="number" min="5" max="200" style="width:90px"')}
    <button class="primary" type="submit">Cerca</button></form>
    <div class="sub" style="margin-top:6px">Acquisition: sistemi Unoccupied dove la power è presente. "Dove sono i nemici": sistemi controllati da altre power (con "Qualsiasi" mostra tutti quelli controllati).</div>`;

  return `<div class="grid"><div class="col">
      ${panel("Comandante", cmdr, { code: "PLEDGE", aside: `<button class="small ghost" data-pp-refresh title="Rileggi i journal">Aggiorna</button>` })}
      <div style="margin-top:18px">${panel("Cosa fare qui", todo, { code: s?.relation || "MERITS" })}</div>
    </div><div class="col">${panel("Sistema corrente", here, { code: s?.state || "—" })}</div></div>
    <div style="margin-top:18px">${panel("Sistemi Powerplay vicini", form, { code: "PP-SEARCH" })}</div>
    <div style="margin-top:18px">${panel("Risultati", res, { code: "RESULTS" })}</div>`;
};
