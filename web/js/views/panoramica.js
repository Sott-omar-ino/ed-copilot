"use strict";

// ============================================================================
// PANORAMICA
// ============================================================================
const starName = c => UI.orig ? c : c === "N" ? "Stella di neutroni" : c === "H" ? "Buco nero" : c.startsWith("D") ? "Nana bianca " + c : "Stella classe " + c;
const isHot = b => b.value_mapped >= 500000 && !b.mapped_by_me;

function orrery(bodies) {
  const withDist = bodies.filter(b => b.kind !== "unknown" && b.dist > 0).sort((a, b) => a.dist - b.dist);
  // Raggio per ordine di distanza dalla stella di arrivo (non in scala): in molti sistemi i corpi sono tutti lontanissimi
  // e quasi alla stessa distanza (es. attorno a una stella secondaria), e in scala finirebbero sullo stesso anello.
  const dists = [...new Set(withDist.map(b => Math.round(b.dist)))];
  const radius = d => dists.length < 2 ? 70 : 20 + 72 * dists.indexOf(Math.round(d)) / (dists.length - 1);
  const rings = dists.map(d => `<circle class="ring" cx="100" cy="100" r="${radius(d).toFixed(1)}"/>`), dots = [];
  withDist.forEach(b => {
    const r = radius(b.dist);
    const color = isHot(b) ? "#ffd36b" : /Water|Earthlike|Ammonia/.test(b.cls) || b.terraformable ? "#66d4ff" : b.bio ? "#8fe388" : b.kind === "star" ? "#ffb35c" : "#ff8a1f";
    const size = b.kind === "star" ? 4 : /gas giant/i.test(b.cls) ? 3.2 : 2.1;
    const angle = (b.id * 137.5) % 360, period = 30 + r * 1.6;
    dots.push(`<g class="orbit" style="animation-duration:${period.toFixed(0)}s"><g transform="rotate(${angle} 100 100)">
      <circle cx="${(100 + r).toFixed(1)}" cy="100" r="${size}" fill="${color}" style="filter:drop-shadow(0 0 3px ${color})"><title>${esc(b.short || b.name)} · ${num(Math.round(b.dist))} ls</title></circle></g></g>`);
  });
  const empty = !withDist.length ? `<text x="100" y="152" text-anchor="middle" fill="#93704f" font-family="Share Tech Mono" font-size="7.5" letter-spacing="1">IN ATTESA DI SCANSIONE FSS</text>` : "";
  return `<svg class="orrery" viewBox="0 0 200 200" aria-label="Mappa del sistema">
    <defs><radialGradient id="core"><stop offset="0" stop-color="#fff3d6"/><stop offset=".4" stop-color="#ffb35c"/><stop offset="1" stop-color="#ff8a1f" stop-opacity="0"/></radialGradient>
    <linearGradient id="sw" x1="0" x2="1"><stop offset="0" stop-color="#66d4ff" stop-opacity="0"/><stop offset="1" stop-color="#66d4ff" stop-opacity=".28"/></linearGradient></defs>
    <circle cx="100" cy="100" r="96" fill="none" stroke="rgba(102,212,255,.35)" stroke-width=".6"/>
    <circle cx="100" cy="100" r="99" fill="none" stroke="rgba(102,212,255,.15)" stroke-width="2" stroke-dasharray="1 5"/>
    ${rings.join("")}
    <g class="sweep"><path d="M100 100 L196 100 A96 96 0 0 0 183 52 Z" fill="url(#sw)"/></g>
    <circle cx="100" cy="100" r="12" fill="url(#core)"/>
    ${dots.join("")}${empty}
  </svg>`;
}

VIEWS.overview = () => {
  const sy = S.system, loc = S.location;
  const pct = sy.body_count ? sy.scanned / sy.body_count * 100 : 0;
  const meta = [["ALL", loc.allegiance], ["GOV", loc.government], ["ECO", loc.economy], ["SIC", loc.security],
    ["POT", loc.power], ["POP", loc.population ? num(loc.population) : null]].filter(([, v]) => v);
  const hero = `<section class="panel"><div class="bd" style="padding-top:18px"><div class="hero"><div>
      <div class="eyebrow">Sistema corrente ${loc.docked && loc.station ? "· attraccato a " + esc(loc.station) : ""}</div>
      <div class="display chroma glitchy">${esc(sy.name || loc.system || "—")}</div>
      <div class="sys-meta">${meta.map(([k, v]) => `<span><b>${k}</b>${esc(T("value", v))}</span>`).join("")}</div>
      <div style="display:grid;grid-template-columns:repeat(4, minmax(130px, 1fr));gap:12px;margin-top:16px;align-items:stretch">
        <div class="kv" style="background:rgba(255,138,31,0.04);border:1px solid rgba(255,138,31,0.22);padding:10px 12px;border-radius:2px;display:flex;flex-direction:column;justify-content:space-between">
          <span style="font-size:10px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:var(--text-3);height:16px;line-height:16px">Corpi Scansionati</span>
          <span class="mono" style="font-size:20px;font-weight:bold;margin:6px 0;line-height:1.2;color:var(--text)">${sy.body_count != null ? `${sy.scanned}/${sy.body_count}` : "FSS &mdash;"}</span>
          <div style="height:18px;display:flex;align-items:center">${seg(pct, 16, sy.all_found ? "full" : "")}</div>
        </div>
        <div class="kv" style="background:rgba(255,138,31,0.04);border:1px solid rgba(255,138,31,0.22);padding:10px 12px;border-radius:2px;display:flex;flex-direction:column;justify-content:space-between">
          <span style="font-size:10px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:var(--text-3);height:16px;line-height:16px">Dati Cartografici</span>
          <span class="mono gold" style="font-size:20px;font-weight:bold;margin:6px 0;line-height:1.2">${short(S.carto_unsold_total)}</span>
          <div class="sub" style="height:18px;line-height:18px;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${S.carto_unsold_systems} sistemi non venduti</div>
        </div>
        <div class="kv" style="background:rgba(255,138,31,0.04);border:1px solid rgba(255,138,31,0.22);padding:10px 12px;border-radius:2px;display:flex;flex-direction:column;justify-content:space-between">
          <span style="font-size:10px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:var(--text-3);height:16px;line-height:16px">Dati Biologici</span>
          <span class="mono gold" style="font-size:20px;font-weight:bold;margin:6px 0;line-height:1.2">${short(S.bio_unsold_total)}</span>
          <div class="sub" style="height:18px;line-height:18px;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${S.bio_unsold.length} campioni</div>
        </div>
        <div class="kv" style="background:rgba(255,138,31,0.04);border:1px solid rgba(255,138,31,0.22);padding:10px 12px;border-radius:2px;display:flex;flex-direction:column;justify-content:space-between">
          <span style="font-size:10px;font-weight:800;letter-spacing:0.12em;text-transform:uppercase;color:var(--text-3);height:16px;line-height:16px">Segnali</span>
          <span class="mono" style="font-size:20px;font-weight:bold;margin:6px 0;line-height:1.2;color:var(--text)">${sy.non_bodies ?? "&mdash;"}</span>
          <div class="sub" style="height:18px;line-height:18px;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">non corporei</div>
        </div>
      </div></div>
      ${orrery(sy.bodies)}</div></div></section>`;

  const rows = sy.bodies.length ? sy.bodies.map(b => {
    const tags = [];
    if (!b.was_discovered && b.kind !== "unknown") tags.push('<span class="tag new">non scoperto</span>');
    if (b.terraformable) tags.push('<span class="tag tf">terraform.</span>');
    if (b.bio) tags.push(`<span class="tag bio">bio ${b.bio}</span>`);
    if (b.geo) tags.push(`<span class="tag geo">geo ${b.geo}</span>`);
    if (b.landable) tags.push('<span class="tag">atterrabile</span>');
    if (b.landable && b.was_footfalled === false) tags.push('<span class="tag new">no footfall</span>');
    if (b.mapped_by_me) tags.push(`<span class="tag mapped">mappato${b.efficient ? " ✓" : ""}</span>`);
    else if (b.was_mapped) tags.push('<span class="tag mapped">già mappato</span>');
    const type = b.kind === "star" ? starName(b.cls) : b.kind === "planet" ? T("body", b.cls) : "?";
    return `<tr class="${isHot(b) ? "hot" : ""}"><td><b>${esc(b.short || b.name)}</b></td>
      <td>${esc(type)}${b.atmosphere ? `<div class="sub">${esc(b.atmosphere)}</div>` : ""}</td>
      <td class="num">${b.dist != null ? num(b.dist) : "—"}</td><td>${tags.join("")}</td>
      <td class="num">${b.value != null ? short(b.value) : "—"}</td>
      <td class="num ${isHot(b) ? "gold" : "muted"}">${b.value_mapped != null && !b.mapped_by_me ? short(b.value_mapped) : ""}</td></tr>`;
  }).join("") : '<tr><td colspan="6"><div class="empty">Nessun corpo scansionato in questo sistema</div></td></tr>';

  const r = S.route, unscoop = r.filter(j => !j.scoopable).length;
  const route = r.length ? `<div class="route-list">${r.slice(0, 10).map((j, i) =>
    `<div class="hop ${i === 0 ? "next" : ""}"><span class="n">${String(i + 1).padStart(2, "0")}</span><span>${sys(j.StarSystem)}</span>
     <span class="${j.scoopable ? "ok" : "bad"} mono">${esc(j.StarClass)} ${j.scoopable ? "⛽" : "✕"}</span></div>`).join("")}</div>
     ${r.length > 10 ? `<div class="sub" style="margin-top:6px">… altri ${r.length - 10} salti</div>` : ""}` : '<div class="empty">Nessuna rotta tracciata nella mappa galattica</div>';

  return `${typeof fuelRescueBanner === "function" ? fuelRescueBanner(true) : ""}${briefingPanel()}${hero}<div class="grid" style="margin-top:18px"><div class="col">
    ${panel("Corpi del sistema", `<table><thead><tr><th>Corpo</th><th>Tipo</th><th class="num">Dist. ls</th><th>Note</th><th class="num">Valore</th><th class="num">Mappato</th></tr></thead><tbody>${rows}</tbody></table>`, { code: "SYS-SCAN", aside: `${sy.bodies.filter(isHot).length} da mappare` })}
    ${panel("Rotta di gioco", route, { code: "NAV-ROUTE", aside: r.length ? `${r.length} salti${unscoop ? ` · <span class="bad">${unscoop} non scoopabili</span>` : ""}` : "" })}
  </div><div class="col">
    ${panel("Esobiologia", renderBio(), { cls: "holo", code: "GENE-SEQ", aside: esc(loc.status_body || loc.body || "") })}
    ${panel("Obiettivi della comunità", renderCg(), { code: "CG", cls: "holo", aside: `${(UI.cgs || []).length} attivi` })}
    ${panel("Dati non venduti", `<table><tbody>${S.bio_unsold.slice().reverse().map(u =>
      `<tr><td>${esc(u.species)}<div class="sub">${esc(u.variant || "")}</div></td><td class="num gold">${short(u.value)}</td></tr>`).join("") ||
      '<tr><td><div class="empty">Nessun campione da vendere</div></td></tr>'}</tbody></table>`, { code: "VISTA", aside: `totale <span class="gold mono">${short(S.carto_unsold_total + S.bio_unsold_total)}</span>` })}
    ${panel("Registro eventi", `<ul class="feed">${S.feed.length ? S.feed.map(e =>
      `<li class="${{ gold: "gold", bio: "ok", bad: "bad" }[e.kind] || ""}"><time>${e.ts.slice(11, 19)}</time>${esc(e.text)}</li>`).join("")
      : '<li class="empty">Gli eventi interessanti appariranno qui mentre giochi</li>'}</ul>`, { code: "LOG" })}
  </div></div>`;
};

// Inara dà il tier raggiunto, Frontier la quantità consegnata rispetto all'obiettivo.
const cgProgress = cg => cg.tier_max ? `Tier ${cg.tier}/${cg.tier_max} · ${short(cg.qty)}` : `${short(cg.qty)}/${short(cg.target_qty)}`;

function renderCg() {
  const cgs = UI.cgs;
  if (!cgs) return '<div class="loading">CONNESSIONE ALLA RETE GALATTICA IN CORSO</div>';
  if (!cgs.length) return '<div class="empty">Nessun obiettivo della comunità attivo</div>';
  const isExpanded = UI.cgExpanded === true;
  const toggleBtn = `<div style="display:flex;justify-content:flex-end;margin-bottom:6px">
    <button class="small ghost" id="cg-toggle-view" style="font-size:11px;padding:2px 8px">${isExpanded ? "▲ Modalita compatta" : "▼ Espandi tutti i dettagli"}</button>
  </div>`;
  const items = cgs.map(cg => {
    if (!isExpanded) {
      return `<div style="display:flex;justify-content:space-between;align-items:center;padding:7px 0;border-bottom:1px solid rgba(255,138,31,0.12);gap:8px">
        <div style="min-width:0;flex:1">
          <div style="display:flex;align-items:baseline;gap:6px">
            <b class="holo-t" style="font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" title="${esc(cg.title)}">${esc(cg.title)}</b>
            <span class="tag ok" style="font-size:10px;padding:1px 4px">${cg.pct}%</span>
          </div>
          <div class="sub" style="font-size:11px;margin-top:2px">
            ${sys(cg.system)} · <b>${esc(cg.station)}</b> · <span class="mono gold">${cgProgress(cg)}</span>
          </div>
        </div>
        <div style="display:flex;gap:4px;flex-shrink:0">
          <button class="small" data-cg-plot="${esc(cg.system)}" title="Traccia rotta" style="padding:2px 6px">⧉ Rotta</button>
          <button class="small ghost" data-cg-todo="${esc(cg.title)}" data-cg-sys="${esc(cg.system)}" data-cg-st="${esc(cg.station)}" title="Aggiungi ai da fare" style="padding:2px 6px">+</button>
        </div>
      </div>`;
    }
    return `<div class="todo-item" style="padding:8px 0;border-bottom:1px solid rgba(255,138,31,0.15);flex-direction:column;align-items:stretch;gap:5px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
        <div>
          <b class="holo-t" style="font-size:14px">${esc(cg.title)}</b>
          <div class="sub" style="margin-top:2px">Obiettivo: <b>${esc(cg.objective)}</b></div>
        </div>
        <span class="tag ok" style="flex-shrink:0">${cg.pct}%</span>
      </div>
      <div style="margin:2px 0">${seg(cg.tier_max ? cg.pct : Math.min(100, Math.round(cg.pct * 5)), 25, "ok")}</div>
      <div class="kv-grid" style="grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:6px;background:rgba(0,0,0,0.25);padding:6px;border-radius:2px">
        <div class="kv"><span>Sistema</span><span>${sys(cg.system)}</span></div>
        <div class="kv"><span>Stazione</span><span>${esc(cg.station)}</span></div>
        <div class="kv"><span>Progresso</span><span class="mono">${cgProgress(cg)}</span></div>
        ${cg.contributors ? `<div class="kv"><span>Partecipanti</span><span class="mono">${num(cg.contributors)}</span></div>` : ""}
        <div class="kv"><span>Scadenza</span><span class="mono gold">${esc(cg.expiry ? cg.expiry.slice(0, 16) : "—")}</span></div>
      </div>
      <div style="display:flex;gap:8px;margin-top:2px;flex-wrap:wrap">
        <button class="small" data-cg-plot="${esc(cg.system)}">⧉ Traccia rotta verso ${esc(cg.system)}</button>
        <button class="small ghost" data-cg-todo="${esc(cg.title)}" data-cg-sys="${esc(cg.system)}" data-cg-st="${esc(cg.station)}">+ Aggiungi ai da fare</button>
      </div>
      ${cg.reward ? `<div class="sub">Ricompensa: ${esc(cg.reward)}</div>` : ""}
    </div>`;
  }).join("");

  return `${toggleBtn}<div style="max-height:220px;overflow-y:auto;padding-right:4px">${items}</div>`;
}

// I generi di un corpo si vedono dopo la mappatura DSS (evento SAASignalsFound con l'elenco Genuses, Journal Manual
// di Frontier). Distanza colonia per genere: gamedata.GENUS_DISTANCE.
function renderBio() {
  const loc = S.location, sy = S.system;
  const here = sy.bodies.find(b => b.name === (loc.status_body || loc.body));
  const cur = S.bio_current;
  let html = "";
  if (cur) {
    const steps = [1, 2, 3].map(i => `<div class="${cur.step >= i ? "on" : ""}"></div>`).join("");
    let dist = '<div class="sub">Distanza live disponibile per i campioni presi con l\'helper aperto</div>';
    if (cur.distances?.length) {
      const min = Math.min(...cur.distances);
      const remaining = Math.max(0, cur.min_dist - min);
      const pct = Math.min(100, Math.round((min / cur.min_dist) * 100));
      dist = `<div class="dist ${cur.far_enough ? "ok" : "bad"}" style="font-size:24px;margin:6px 0">${num(min)} m <span class="sub" style="font-size:14px">/ min ${cur.min_dist} m</span></div>
        <div style="margin:4px 0">${seg(pct, 25, cur.far_enough ? "ok" : "bad")}</div>
        <div class="${cur.far_enough ? "ok" : "bad"}" style="font-weight:700;letter-spacing:.08em">
          ${cur.far_enough ? "▲ DISTANZA RAGGIUNTA: PUOI CAMPIONARE" : `▼ TROPPO VICINO: MANCANO ${num(remaining)} METRI`}
        </div>`;
    }
    html += `<div class="eyebrow">Campionamento in corso</div><div class="mid holo-t" style="font-family:var(--ui);font-weight:700;font-size:22px">${esc(cur.species)}</div>
      <div class="sub">${esc(cur.variant || "")}</div><div class="gold mono" style="margin-top:4px">${cr(cur.value)}</div>
      <div class="steps">${steps}</div><div class="sub">Campione ${cur.step}/3 · distanza colonia ${cur.min_dist} m</div>${dist}`;
  }
  if (here && (here.bio || here.genus_info.length)) {
    html += `<div style="margin-top:${cur ? 14 : 0}px"><span class="tag bio">${here.bio} segnali biologici</span></div>`;
    html += here.genus_info.length ? "<table style='margin-top:6px'>" + here.genus_info.map(g =>
      `<tr><td>${esc(g.genus)}</td><td class="num muted">${g.min_dist} m</td><td class="num gold">${g.max ? (g.min === g.max ? short(g.max) : short(g.min) + "–" + short(g.max)) : "—"}</td></tr>`).join("") + "</table>"
      : '<div class="sub">Mappa il corpo con le sonde DSS per vedere i generi</div>';
  }
  if (!html) {
    const withBio = sy.bodies.filter(b => b.bio);
    html = withBio.length ? '<div class="eyebrow" style="margin-bottom:6px">Corpi con segnali biologici</div>' + withBio.map(b =>
      `<div style="padding:3px 0"><b>${esc(b.short)}</b> <span class="tag bio">bio ${b.bio}</span><span class="sub">${b.genuses.map(esc).join(", ")}</span></div>`).join("")
      : '<div class="empty">Nessun campionamento in corso</div>';
  }
  return html;
}

// ============================================================================
// BRIEFING DI BORDO (app/briefing.py): riassunto parlato all'avvio del gioco
// ============================================================================
function loadBriefing() { return run("briefing", () => api("/api/briefing")); }
const briefingAgo = t => t ? ago(t) : "mai in questa sessione dell'app";

function briefingSwitch(on) {
  return `<button class="switch ${on ? "on" : ""}" data-briefing-toggle role="switch" aria-checked="${!!on}"
    aria-label="Briefing automatico all'avvio del gioco"><span></span><span></span></button>`;
}

function briefingPanel() {
  if (!UI.res.briefing) loadBriefing();
  const r = UI.res.briefing, b = r?.data;
  const body = !r || r.busy ? '<div class="loading">PREPARAZIONE DEL BRIEFING</div>'
    : r.error ? `<div class="bad">⚠ ${esc(r.error)}</div>`
    : `<div class="briefing-parts">${b.parts.map(p => `<div class="briefing-part"><span class="eyebrow">${esc(p.label)}</span><span>${esc(p.text)}</span></div>`).join("")}</div>
      <div class="briefing-actions">
        <button class="small primary" data-briefing-speak>▶ Riascolta il briefing</button>
        <button class="small ghost" data-briefing-reload>Aggiorna</button>
        <span class="sub">Ultimo briefing parlato: ${esc(briefingAgo(b.last_spoken))}</span>
        <span class="sub" style="margin-left:auto">Automatico all'avvio del gioco</span>${briefingSwitch(b.config?.enabled)}
      </div>`;
  return panel("Briefing di bordo", body, { code: "BRIEF", cls: "briefing-panel" });
}

// Interruttore per la scheda Audio delle impostazioni.
function briefingSettingsPanel() {
  if (!UI.res.briefing) loadBriefing();
  const on = UI.res.briefing?.data?.config?.enabled;
  return panel("Briefing di bordo", dataRow("Briefing all'avvio del gioco",
    "Quando carichi una partita (o apri l'app a gioco avviato) il copilota riassume a voce dove sei, missioni in scadenza, dati da vendere e Fleet Carrier. Usa la voce degli avvisi dal PC.",
    briefingSwitch(on)) + `<div style="margin-top:8px"><button class="small" data-briefing-speak>▶ Riascolta il briefing</button></div>`, { code: "BRIEF" });
}

document.addEventListener("click", e => {
  const t = e.target.closest("[data-briefing-speak],[data-briefing-reload],[data-briefing-toggle]");
  if (!t) return;
  if (t.matches("[data-briefing-reload]")) return loadBriefing();
  if (t.matches("[data-briefing-speak]")) {
    toast("Briefing in arrivo…");
    return run("briefing", () => api("/api/briefing/speak", {}));
  }
  const on = !UI.res.briefing?.data?.config?.enabled;
  api("/api/briefing/config", { enabled: on })
    .then(cfg => { const d = UI.res.briefing?.data; if (d) d.config = cfg; toast(on ? "Briefing automatico acceso" : "Briefing automatico spento"); renderView(); })
    .catch(err => toast(err.message));
});
