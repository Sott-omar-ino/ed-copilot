"use strict";

// ============================================================================
// MISSIONI
// ============================================================================

// Piano di consegna: ricalcolato dal server quando cambiano le missioni o il sistema in cui sei.
function missionPlanPanel() {
  const sig = S.missions.map(m => `${m.id}:${m.system}`).join("|") + "@" + (S.location.system || "");
  if (UI.missionPlanSig !== sig) {
    UI.missionPlanSig = sig;
    run("missionPlan", () => api("/api/missions/plan"));
  }
  return panel("Piano di consegna", result("missionPlan", p => {
    if (!p.groups.length) return '<div class="empty">Nessuna missione attiva</div>';
    const over = p.cargo_capacity != null && p.cargo_needed > p.cargo_capacity;
    const head = `<div class="kv-grid" style="margin-bottom:10px">
      <div class="kv"><span>Destinazioni</span><span>${p.groups.filter(g => g.system).length}</span></div>
      <div class="kv"><span>Percorso totale</span><span>${ly(p.total_ly)}</span></div>
      <div class="kv"><span>Ricompense</span><span class="gold">${short(p.reward)} CR</span></div>
      <div class="kv"><span>Stiva per le consegne</span><span class="${over ? "bad" : ""}">${num(p.cargo_needed)} t${p.cargo_capacity != null ? ` / ${num(p.cargo_capacity)} t` : ""}</span></div>
      ${p.passengers ? `<div class="kv"><span>Passeggeri</span><span>${num(p.passengers)}</span></div>` : ""}</div>
      ${over ? '<div class="warnbox" style="margin-bottom:10px">⚠ Le consegne richiedono più stiva di quella della nave: dividile in più viaggi.</div>' : ""}`;
    const rows = p.groups.map(g => `<tr class="${g.hours_left != null && g.hours_left < 3 ? "hot" : ""}">
      <td class="mono">${g.step ?? "—"}</td>
      <td>${g.system ? sys(g.system) : '<span class="sub">destinazione non indicata</span>'}${g.station ? `<div class="sub">${esc(g.station)}</div>` : ""}</td>
      <td class="num">${g.leg != null ? ly(g.leg) : "—"}<div class="sub">${g.distance != null ? "da qui " + ly(g.distance) : ""}</div></td>
      <td>${g.missions.map(m => `<div>${esc(m.type)} · ${esc(m.name)}${m.commodity && m.count ? ` <span class="sub">${num(m.count)}× ${esc(m.commodity)}</span>` : ""}</div>`).join("")}</td>
      <td class="num">${g.cargo ? num(g.cargo) + " t" : "—"}${g.passengers ? `<div class="sub">${g.passengers} pass.</div>` : ""}</td>
      <td class="num gold">${short(g.reward)}</td>
      <td>${g.hours_left != null ? until(new Date(Date.now() + g.hours_left * 3600e3).toISOString()) : "—"}</td>
      <td>${g.system ? todoBtn(`Consegnare missioni a ${g.station || g.system}`, g.system, "Missioni") : ""}</td></tr>`).join("");
    return head + `<table><thead><tr><th>#</th><th>Destinazione</th><th class="num">Tratta</th><th>Missioni</th><th class="num">Stiva</th>
      <th class="num">Ricompensa</th><th>Scadenza</th><th></th></tr></thead><tbody>${rows}</tbody></table>
      <div class="sub" style="margin-top:6px">Ordine: prima le destinazioni con missioni in scadenza entro 3 ore, poi la più vicina ogni volta.
      Distanze in linea retta.</div>`;
  }, "Calcolo del piano"), { code: "ROUTE-PLAN", aside: S.missions.length ? `${S.missions.length} missioni` : "" });
}

// Stack di missioni massacro: ricalcolato quando cambiano le missioni o le uccisioni stimate.
// Regola dello stack: un'uccisione del bersaglio avanza una sola missione per ciascuna fazione committente
// (forums.frontier.co.uk/threads/stacking-massacre-missions-question.613831, vedi app/combat.py).
function massacrePanel() {
  const mm = S.missions.filter(m => m.kills != null);
  if (!mm.length) return "";
  const sig = mm.map(m => `${m.id}:${m.kills}:${m.redirected ? 1 : 0}`).join("|");
  if (UI.massacreSig !== sig) {
    UI.massacreSig = sig;
    run("massacre", () => api("/api/combat/massacre"));
  }
  return `<div style="margin:18px 0">${panel("Stack massacro", result("massacre", d => {
    if (!d.stacks.length) return '<div class="empty">Nessuna missione massacro attiva</div>';
    return d.stacks.map(s => {
      const pct = s.needed ? s.kills_done / s.needed * 100 : 0;
      const givers = s.givers.map(g => `<tr class="${g.done ? "muted" : ""}">
        <td><b>${esc(g.faction)}</b>${g.done ? ' <span class="tag ok">completate</span>' : ""}
          <div class="sub">${g.missions.map(x => `${x.done ? "✔" : `${x.kills}/${x.count}`}${x.wing ? ` (${LANG.t("squadra")})` : ""}`).join(" · ")}</div></td>
        <td class="num">${g.missions.length}</td>
        <td class="num">${num(g.total)}</td>
        <td class="num">${num(g.kills)}</td>
        <td class="num ${g.remaining ? "" : "ok"}">${g.remaining ? num(g.remaining) : "—"}</td>
        <td style="min-width:90px">${meter(g.total ? g.kills / g.total * 100 : 0, g.done ? "full" : "")}</td>
        <td class="num gold">${short(g.reward)}</td></tr>`).join("");
      const expiring = s.expiring.map(x => `<div class="${x.hours_left < 3 ? "bad" : ""}">⚠ ${esc(x.name)} (${esc(s.givers.find(g => g.missions.some(y => y.id === x.id))?.faction || "")}): scade fra ${until(x.expiry)}</div>`).join("");
      return `<div style="margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap">
          <div><b class="gold" style="font-size:15px">${esc(s.target)}</b>${s.target_type ? ` <span class="sub">${esc(s.target_type)}</span>` : ""}
            <div class="sub">in ${s.system ? sys(s.system) : "sistema non indicato"}${s.system && s.system === d.here ? ' <span class="tag ok">sei qui</span>' : ""}</div></div>
          <div>${s.all_done ? '<span class="tag ok">stack completato: torna a consegnare</span>' : ""}
            ${s.system && !s.all_done ? todoBtn(`Massacro: ${s.remaining} uccisioni di ${s.target} a ${s.system}`, s.system, "Missioni") : ""}</div></div>
        <div class="kv-grid" style="margin:10px 0">
          <div class="kv"><span>Uccisioni necessarie</span><span>${num(s.needed)}</span></div>
          <div class="kv"><span>Fatte (stima)</span><span>${num(s.kills_done)}</span></div>
          <div class="kv"><span>Mancano</span><span class="${s.remaining ? "" : "ok"}">${num(s.remaining)}</span></div>
          <div class="kv"><span>Altezza stack</span><span title="Uccisioni di tutte le missioni / uccisioni necessarie">${s.ratio != null ? s.ratio.toLocaleString(NUM_LOCALE) + "×" : "—"}</span></div>
          <div class="kv"><span>Ricompensa</span><span class="gold">${short(s.reward)} CR</span></div>
          <div class="kv"><span>Per uccisione</span><span class="gold">${short(s.per_kill)} CR</span></div>
          <div class="kv"><span>Missioni</span><span>${s.completed}/${s.missions}</span></div></div>
        ${seg(pct, 30)}
        <table style="margin-top:10px"><thead><tr><th>Committente</th><th class="num">Missioni</th><th class="num">Uccisioni</th><th class="num">Fatte</th><th class="num">Mancano</th><th></th><th class="num">Ricompensa</th></tr></thead>
        <tbody>${givers}</tbody></table>
        ${expiring ? `<div class="warnbox" style="margin-top:8px">${expiring}</div>` : ""}
        ${s.tips.map(t => `<div class="sub gold" style="margin-top:6px">◆ ${esc(t)}</div>`).join("")}
        ${s.wing ? '<div class="sub" style="margin-top:4px">Missioni di squadra: le uccisioni dei compagni contano, ma qui non si vedono.</div>' : ""}
      </div>`;
    }).join("") + `<div class="sub">${esc(d.note)} Ogni uccisione vale per una missione di ciascun committente: committenti diversi avanzano insieme, quelle dello stesso committente una alla volta.</div>`;
  }, "Calcolo degli stack"), { code: "MASSACRE-STACK", aside: `${mm.length} missioni massacro` })}</div>`;
}

VIEWS.missions = () => {
  const m = S.missions;
  return missionPlanPanel() + massacrePanel() + panel("Missioni attive", `<table><thead><tr><th>Missione</th><th>Destinazione</th><th>Obiettivo</th><th class="num">Ricompensa</th><th>Scade fra</th><th></th></tr></thead><tbody>
    ${m.map(x => `<tr><td><b>${esc(x.name)}</b><div class="sub">${esc(x.faction || "")}${x.wing ? " · missione di squadra" : ""}</div></td>
      <td>${sys(x.system)}${x.station ? `<div class="sub">${esc(x.station)}</div>` : ""}${x.redirected ? ' <span class="tag new">reindirizzata</span>' : ""}</td>
      <td>${[x.count && x.count + "×", x.commodity, x.target, x.passengers && x.passengers + " passeggeri"].filter(Boolean).map(esc).join(" ") || "—"}</td>
      <td class="num gold">${short(x.reward)}</td><td>${x.expiry ? until(x.expiry) : "—"}</td><td>${todoBtn(`Missione: ${x.name}`, x.system || "", "Missioni")}</td></tr>`).join("")
      || '<tr><td colspan="6"><div class="empty">Nessuna missione attiva</div></td></tr>'}
    </tbody></table>`, { code: "MISSION-BOARD", aside: m.length ? `${m.length} attive · <span class="gold mono">${short(m.reduce((s, x) => s + (x.reward || 0), 0))}</span>` : "" });
};
