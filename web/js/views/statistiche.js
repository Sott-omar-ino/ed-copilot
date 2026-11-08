"use strict";

// ============================================================================
// STATISTICHE
// ============================================================================
// Le statistiche si ricalcolano dai journal: si chiedono al server al massimo una volta al minuto,
// non a ogni aggiornamento dell'interfaccia (ogni 2 secondi).
const STATS_TTL = 60000;
// Un colore fisso per attività, uguale in tutti i grafici della scheda. L'ordine è anche l'ordine delle barre impilate:
// palette verificata con il validatore dataviz sullo sfondo scuro (#1a0b00): luminosità e croma nella banda, coppie vicine
// distinguibili anche con daltonismo (con lo spazio di 2 px fra i segmenti, legenda e tooltip come seconda codifica).
// "Altro" è volutamente un grigio neutro.
const STAT_CATS = { trade: ["Commercio", "#d66f00"], exploration: ["Esplorazione", "#3a8be0"], mining: ["Estrazione", "#a89530"],
  missions: ["Missioni", "#9a78ec"], exobiology: ["Esobiologia", "#3f9a55"], combat: ["Bounty e combat bond", "#d9508e"],
  other: ["Altro", "#5f5a56"] };
const SPEND_LABELS = { ships: "Navi", modules: "Moduli", services: "Riparazioni, carburante, munizioni", fines: "Multe e taglie",
  rebuy: "Rebuy", other: "Altro" };

function statsData() {
  const r = UI.res.stats;
  if (!r || (!r.busy && Date.now() - r.at > STATS_TTL)) {
    const prev = r?.data;  // durante l'aggiornamento resta visibile il dato precedente
    UI.res.stats = { busy: true, data: prev, at: Date.now() };
    api("/api/stats").then(data => { UI.res.stats = { data, at: Date.now() }; })
      .catch(e => { UI.res.stats = { data: prev, error: e.message, at: Date.now() }; })
      .finally(() => { if (currentTab() === "stats") renderView(); });
  }
  return UI.res.stats;
}

// Lingua delle date: con l'interfaccia inglese mesi e formati in inglese (es. "Nov 25" sull'asse dei crediti).
const statLoc = () => NUM_LOCALE;
const statDate = (t, time = true) => new Date(t * 1000).toLocaleString(statLoc(), time
  ? { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" } : { day: "2-digit", month: "2-digit" });
const dayLabel = iso => iso.slice(8, 10) + "/" + iso.slice(5, 7);
const crh = v => v == null ? "—" : short(v) + " CR/h";

// Guadagni per categoria: barre proporzionali al totale, solo le categorie con qualcosa.
function catBars(earn) {
  const rows = Object.entries(STAT_CATS).filter(([k]) => earn[k]);
  const total = rows.reduce((s, [k]) => s + Math.max(0, earn[k]), 0);
  if (!rows.length) return '<div class="empty">Nessun guadagno registrato</div>';
  return rows.map(([k, [label, color]]) => `<div style="margin-bottom:8px"><div style="display:flex;justify-content:space-between;align-items:baseline">
    <span class="eyebrow"><i class="stx-sw" style="background:${color}"></i>${label}</span><span class="mono ${earn[k] < 0 ? "bad" : "gold"}">${cr(earn[k])}</span></div>
    ${meter(total ? Math.max(0, earn[k]) / total * 100 : 0)}</div>`).join("");
}
const statLegend = cats => `<div class="stx-legend">${Object.keys(STAT_CATS).filter(k => cats.includes(k)).map(k => `<span><i class="stx-sw" style="background:${STAT_CATS[k][1]}"></i>${STAT_CATS[k][0]}</span>`).join("")}</div>`;

// Asse e griglia comuni ai grafici: 30 colonne, etichetta del giorno ogni 5.
const STAT_CH = { w: 720, h: 190, l: 46, r: 8, t: 10, b: 22 };
function chartFrame(days, max, fmt, right = null) {
  const ih = STAT_CH.h - STAT_CH.t - STAT_CH.b, cw = (STAT_CH.w - STAT_CH.l - STAT_CH.r) / days.length;
  const grid = [0, .5, 1].map(f => {
    const y = STAT_CH.t + ih * (1 - f);
    return `<line x1="${STAT_CH.l}" x2="${STAT_CH.w - STAT_CH.r}" y1="${y}" y2="${y}" style="stroke:var(--hud-faint)"/>
      <text x="${STAT_CH.l - 6}" y="${y + 4}" text-anchor="end" style="fill:var(--text-3)" font-size="11">${fmt(max * f)}</text>
      ${right ? `<text x="${STAT_CH.w - STAT_CH.r}" y="${y - 3}" text-anchor="end" style="fill:var(--gold)" font-size="10">${right(f)}</text>` : ""}`;
  }).join("");
  const labels = days.map((d, i) => (days.length - 1 - i) % 5 ? "" :
    `<text x="${STAT_CH.l + cw * (i + .5)}" y="${STAT_CH.h - 6}" text-anchor="middle" style="fill:var(--text-3)" font-size="11">${dayLabel(d.date)}</text>`).join("");
  return { ih, cw, grid: grid + labels };
}
const statSvg = body => `<svg viewBox="0 0 ${STAT_CH.w} ${STAT_CH.h}" style="width:100%;height:auto;display:block;font-family:var(--ui)" role="img">${body}</svg>`;

function earningsChart(days) {
  const max = Math.max(1, ...days.map(d => Object.values(d.earn).reduce((s, v) => s + Math.max(0, v), 0)));
  const { ih, cw, grid } = chartFrame(days, max, short);
  const used = new Set();
  const bars = days.map((d, i) => {
    let y = STAT_CH.t + ih;
    const parts = Object.keys(STAT_CATS).filter(k => d.earn[k] > 0).map(k => {
      used.add(k);
      const h = d.earn[k] / max * ih;
      y -= h;
      return `<rect x="${(STAT_CH.l + cw * i + 1.5).toFixed(1)}" y="${y.toFixed(1)}" width="${(cw - 3).toFixed(1)}" height="${Math.max(h, .5).toFixed(1)}" style="fill:${STAT_CATS[k][1]}"/>`;
    }).join("");
    const tip = [dayLabel(d.date) + ": " + cr(d.earned), ...Object.keys(STAT_CATS).filter(k => d.earn[k]).map(k => `${LANG.t(STAT_CATS[k][0])}: ${cr(d.earn[k])}`)].join("\n");
    return `<g class="stx-hit" data-tip="${esc(tip)}"><rect x="${STAT_CH.l + cw * i}" y="${STAT_CH.t}" width="${cw}" height="${ih}" fill="transparent"/>${parts}</g>`;
  }).join("");
  return statSvg(grid + bars) + (used.size ? statLegend([...used]) : '<div class="empty">Nessun guadagno negli ultimi 30 giorni</div>');
}

function travelChart(days) {
  const maxLy = Math.max(1, ...days.map(d => d.ly)), maxJ = Math.max(1, ...days.map(d => d.jumps));
  const { ih, cw, grid } = chartFrame(days, maxLy, v => Math.round(v) + " al", f => Math.round(maxJ * f) + " salti");
  const bars = days.map((d, i) => {
    const h = d.ly / maxLy * ih;
    return `<g class="stx-hit" data-tip="${esc(`${dayLabel(d.date)}: ${LANG.t(ly(d.ly))} · ${LANG.t(`${d.jumps} salti`)}`)}">
      <rect x="${STAT_CH.l + cw * i}" y="${STAT_CH.t}" width="${cw}" height="${ih}" fill="transparent"/>
      ${d.ly ? `<rect x="${(STAT_CH.l + cw * i + 1.5).toFixed(1)}" y="${(STAT_CH.t + ih - h).toFixed(1)}" width="${(cw - 3).toFixed(1)}" height="${h.toFixed(1)}" style="fill:var(--holo-dim)"/>` : ""}</g>`;
  }).join("");
  const pts = days.map((d, i) => [STAT_CH.l + cw * (i + .5), STAT_CH.t + ih - d.jumps / maxJ * ih]);
  const line = `<polyline points="${pts.map(p => p.map(v => v.toFixed(1)).join(",")).join(" ")}" fill="none" style="stroke:var(--gold)" stroke-width="1.5"/>`
    + days.map((d, i) => d.jumps ? `<circle cx="${pts[i][0].toFixed(1)}" cy="${pts[i][1].toFixed(1)}" r="2.5" style="fill:var(--gold)" pointer-events="none"/>` : "").join("");
  return statSvg(grid + bars + line) + `<div style="margin-top:8px"><span class="tag holo-t">Distanza (al)</span><span class="tag gold">Salti</span></div>`;
}

function sessionCard(s) {
  return `<div class="kv-grid">
      <div class="kv"><span>Inizio</span><span>${statDate(s.start)}</span></div>
      <div class="kv"><span>Durata attiva</span><span>${dur(s.active)}</span></div>
      <div class="kv"><span>Guadagnato</span><span class="gold">${short(s.earned)} CR</span></div>
      <div class="kv"><span>Crediti/ora</span><span>${crh(s.cr_h)}</span></div>
      <div class="kv"><span>Salti</span><span>${num(s.jumps)}</span></div>
      <div class="kv"><span>Distanza</span><span>${ly(s.ly)}</span></div>
      <div class="kv"><span>Corpi scansionati</span><span>${num(s.scans)}</span></div>
      <div class="kv"><span>Campioni bio</span><span>${num(s.bio)}</span></div>
    </div>
    <div class="sub" style="margin:10px 0 12px">${esc(s.ships.join(" · ") || "—")}${s.spent ? ` · spesi <span class="mono">${short(s.spent)} CR</span>` : ""}${s.deaths ? ` · <span class="bad">${s.deaths} ${s.deaths > 1 ? "morti" : "morte"}</span>` : ""}</div>
    ${catBars(s.earn)}`;
}

VIEWS.stats = () => {
  const r = statsData(), d = r.data;
  if (!d) return panel("Statistiche", r.error ? `<div class="bad">⚠ ${esc(r.error)}</div>` : '<div class="loading">ANALISI DEI JOURNAL IN CORSO</div>', { code: "STATS" });
  const t = d.totals, days30 = d.days.slice(-30), cur = d.current, last = d.sessions[0];
  const sessionPanel = cur
    ? panel("Sessione in corso", sessionCard(cur), { code: "LIVE", aside: `<span class="ok">● in volo</span>` })
    : panel("Ultima sessione", last ? sessionCard(last) : '<div class="empty">Nessuna sessione nei journal</div>', { code: "LAST", aside: last ? ago(last.end) : "" });

  const totals = `<div class="kv-grid">
      <div class="kv"><span>Sessioni</span><span>${num(t.sessions)}</span></div>
      <div class="kv"><span>Tempo attivo</span><span>${dur(t.active)}</span></div>
      <div class="kv"><span>Guadagnato</span><span class="gold">${short(t.earned)} CR</span></div>
      <div class="kv"><span>Speso</span><span>${short(t.spent)} CR</span></div>
      <div class="kv"><span>Crediti/ora</span><span>${crh(t.cr_h)}</span></div>
      <div class="kv"><span>Salti</span><span>${num(t.jumps)}</span></div>
      <div class="kv"><span>Distanza</span><span>${ly(t.ly)}</span></div>
      <div class="kv"><span>Carburante</span><span>${num(t.fuel)} t</span></div>
      <div class="kv"><span>Corpi scansionati</span><span>${num(t.scans)}</span></div>
      <div class="kv"><span>Corpi mappati</span><span>${num(t.mapped)}</span></div>
      <div class="kv"><span>Campioni bio</span><span>${num(t.bio)}</span></div>
      <div class="kv"><span>Morti</span><span class="${t.deaths ? "bad" : ""}">${num(t.deaths)}</span></div>
    </div>
    <div style="margin-top:14px">${catBars(t.earn)}</div>
    ${t.spent ? `<table style="margin-top:10px"><thead><tr><th>Spese</th><th class="num">CR</th></tr></thead><tbody>${Object.entries(SPEND_LABELS).filter(([k]) => t.spend[k])
      .map(([k, label]) => `<tr><td class="muted">${label}</td><td class="num">${cr(t.spend[k])}</td></tr>`).join("")}</tbody></table>` : ""}`;

  const weeks = d.weeks.slice().reverse().slice(0, 8);
  const weekTable = weeks.length ? `<table><thead><tr><th>Settimana</th><th class="num">Tempo</th><th class="num">Guadagnato</th><th class="num">CR/h</th><th class="num">Salti</th></tr></thead><tbody>
    ${weeks.map(w => `<tr><td>${esc(w.week.replace("-W", " · sett. "))}<div class="sub">dal ${dayLabel(w.from)} · ${w.days} ${w.days === 1 ? "giorno" : "giorni"}</div></td><td class="num">${dur(w.active)}</td>
      <td class="num gold">${short(w.earned)}</td><td class="num">${w.active >= 600 ? short(w.earned / w.active * 3600) : "—"}</td><td class="num">${num(w.jumps)}</td></tr>`).join("")}</tbody></table>`
    : '<div class="empty">Nessun dato</div>';

  const rows = d.sessions.slice(0, 40).map(s => `<tr class="${s.live ? "hot" : ""}"><td>${statDate(s.start)}${s.live ? ' <span class="tag new">in corso</span>' : ""}</td>
    <td class="num">${dur(s.active)}</td><td>${esc(s.ships.join(" · ") || "—")}</td><td class="num gold">${short(s.earned)}</td>
    <td class="num">${s.cr_h == null ? "—" : short(s.cr_h)}</td><td class="num">${num(s.jumps)}</td><td class="num">${s.ly ? ly(s.ly) : "—"}</td></tr>`).join("");
  const earned30 = days30.reduce((s, x) => s + x.earned, 0), ly30 = days30.reduce((s, x) => s + x.ly, 0);

  return `<div class="grid"><div class="col">
      ${sessionPanel}
      ${panel("Guadagni per giorno", earningsChart(days30), { code: "30 GIORNI", aside: `<span class="gold mono">${short(earned30)} CR</span>` })}
      ${panel("Viaggi per giorno", travelChart(days30), { code: "30 GIORNI", aside: `${num(days30.reduce((s, x) => s + x.jumps, 0))} salti · ${ly(ly30)}` })}
    </div><div class="col">
      ${panel("Totali", totals, { code: "ALL-TIME", aside: t.first ? "dal " + statDate(t.first, false) + "/" + new Date(t.first * 1000).getFullYear() : "" })}
      ${panel("Settimane", weekTable, { code: "WEEKLY" })}
    </div></div>
    ${statsAdvanced(d)}
    <div style="margin-top:18px">${panel("Sessioni recenti", `<table><thead><tr><th>${LANG.lang === "en" ? LANG.t("Data della sessione") : "Data"}</th><th class="num">Durata</th><th>Nave</th>
      <th class="num">Guadagnato</th><th class="num">CR/h</th><th class="num">Salti</th><th class="num">Distanza</th></tr></thead><tbody>
      ${rows || '<tr><td colspan="7"><div class="empty">Nessuna sessione</div></td></tr>'}</tbody></table>`,
      { code: "LOG", aside: `${d.sessions.length} sessioni${r.busy ? " · aggiorno…" : ""}${r.error ? ` · <span class="bad">${esc(r.error)}</span>` : ""}` })}</div>`;
};

// ============================================================================
// STATISTICHE AVANZATE: crediti nel tempo, guadagni per attività, CR/h per attività, record
// ============================================================================
// I grafici si costruiscono una volta per ogni risposta del server (cache legata all'oggetto dati):
// il ridisegno ogni 2 secondi riusa le stringhe già pronte.
const STX_MEMO = new WeakMap();
function stxMemo(d, key, fn) {
  let m = STX_MEMO.get(d);
  if (!m) STX_MEMO.set(d, m = {});
  return m[key] ??= fn();
}
const STX_PERIODS = [["30", "30 giorni"], ["90", "90 giorni"], ["all", "Tutto"]];
const STX = { w: 1000, h: 230, l: 58, r: 14, t: 12, b: 26 };
const stxSvg = (body, h = STX.h) => `<svg class="stx-chart" viewBox="0 0 ${STX.w} ${h}" role="img">${body}</svg>`;
const stxDate = t => new Date(t * 1000).toLocaleDateString(statLoc(), { day: "2-digit", month: "2-digit", year: "numeric" });
const stxDateTime = t => new Date(t * 1000).toLocaleString(statLoc(), { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

// Tacche "tonde" da zero al massimo (1, 2, 2.5, 5 × 10^n).
function stxTicks(max, n = 4) {
  if (!(max > 0)) return [0, 1];
  const raw = max / n, p = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(m => m * p).find(s => s >= raw);
  return Array.from({ length: Math.ceil(max / step - 1e-9) + 1 }, (_, i) => i * step);
}
function stxYAxis(ticks, h = STX.h) {
  const ih = h - STX.t - STX.b, top = ticks[ticks.length - 1];
  return ticks.map(v => {
    const y = STX.t + ih * (1 - v / top);
    return `<line x1="${STX.l}" x2="${STX.w - STX.r}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}" class="${v ? "stx-grid" : "stx-base"}"/>
      <text x="${STX.l - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end" class="stx-ax">${short(v)}</text>`;
  }).join("");
}

// --- Crediti nel tempo: una linea, un punto per sessione (saldo al LoadGame) --------------------------------
function creditsChart(c) {
  const pts = c.points;
  if (pts.length < 2) return '<div class="empty">Servono almeno due sessioni con il saldo nel journal</div>';
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t, span = Math.max(1, t1 - t0);
  const hasW = pts.some(p => p.wealth != null);
  const ticks = stxTicks(Math.max(...pts.map(p => Math.max(p.credits, p.wealth || 0))));
  const ih = STX.h - STX.t - STX.b, iw = STX.w - STX.l - STX.r, top = ticks[ticks.length - 1];
  const X = t => STX.l + (t - t0) / span * iw, Y = v => STX.t + ih * (1 - v / top);
  // Asse del tempo: inizio di ogni mese (o di ogni settimana se il periodo è breve).
  const xt = [], d = new Date(t0 * 1000), long = span > 45 * 86400;
  if (long) d.setDate(1); else d.setDate(d.getDate() - (d.getDay() + 6) % 7);
  d.setHours(0, 0, 0, 0);
  for (; d.getTime() / 1000 <= t1; long ? d.setMonth(d.getMonth() + 1) : d.setDate(d.getDate() + 7))
    if (d.getTime() / 1000 >= t0) xt.push(d.getTime() / 1000);
  const xAxis = xt.map(t => `<line x1="${X(t).toFixed(1)}" x2="${X(t).toFixed(1)}" y1="${STX.t + ih}" y2="${STX.t + ih + 4}" class="stx-base"/>
    <text x="${X(t).toFixed(1)}" y="${STX.h - 6}" text-anchor="middle" class="stx-ax">${new Date(t * 1000).toLocaleDateString(statLoc(), long ? { month: "short", year: "2-digit" } : { day: "2-digit", month: "2-digit" })}</text>`).join("");
  const path = key => pts.filter(p => p[key] != null).map((p, i) => `${i ? "L" : "M"}${X(p.t).toFixed(1)},${Y(p[key]).toFixed(1)}`).join("");
  const lines = (hasW ? `<path d="${path("wealth")}" class="stx-line2"/>` : "") + `<path d="${path("credits")}" class="stx-line"/>`
    + pts.map(p => `<circle cx="${X(p.t).toFixed(1)}" cy="${Y(p.credits).toFixed(1)}" r="2.5" class="stx-pt"/>`).join("");
  // Zone di passaggio del mouse: dal punto a metà strada verso i vicini (più larghe del punto).
  const hits = pts.map((p, i) => {
    const a = i ? (X(pts[i - 1].t) + X(p.t)) / 2 : STX.l, b = i < pts.length - 1 ? (X(p.t) + X(pts[i + 1].t)) / 2 : STX.w - STX.r;
    const tip = [LANG.t(stxDateTime(p.t) + (p.kind === "live" ? " · adesso" : p.kind === "end" ? " · fine dell'ultima sessione" : " · inizio sessione")),
      LANG.t("Crediti: " + cr(p.credits)), p.wealth != null ? "Current_Wealth: " + cr(p.wealth) : ""].filter(Boolean).join("\n");
    return `<g class="stx-hit" data-tip="${esc(tip)}"><rect x="${a.toFixed(1)}" y="${STX.t}" width="${Math.max(1, b - a).toFixed(1)}" height="${ih}" fill="none" pointer-events="all"/>
      <line x1="${X(p.t).toFixed(1)}" x2="${X(p.t).toFixed(1)}" y1="${STX.t}" y2="${STX.t + ih}" class="stx-guide"/>
      <circle cx="${X(p.t).toFixed(1)}" cy="${Y(p.credits).toFixed(1)}" r="5" class="stx-focus"/></g>`;
  }).join("");
  const legend = hasW ? `<div class="stx-legend"><span><i class="stx-sw" style="background:var(--hud)"></i>Crediti (saldo al LoadGame)</span>
    <span><i class="stx-sw stx-dash"></i>Current_Wealth (dalle statistiche del gioco: è il patrimonio, non il saldo)</span></div>` : "";
  return stxSvg(stxYAxis(ticks) + xAxis + lines + hits) + legend;
}

// --- Guadagni per attività, settimana per settimana (barre impilate, base a zero) ---------------------------
function activityChart(weeks) {
  if (!weeks.some(w => w.earned)) return '<div class="empty">Nessun guadagno registrato</div>';
  const H = 220, ih = H - STX.t - STX.b, iw = STX.w - STX.l - STX.r, cw = iw / weeks.length;
  const pos = w => Object.keys(STAT_CATS).reduce((s, k) => s + Math.max(0, w.earn[k]), 0);
  const ticks = stxTicks(Math.max(...weeks.map(pos))), top = ticks[ticks.length - 1];
  const used = new Set(), every = Math.ceil(weeks.length / 12);
  const bars = weeks.map((w, i) => {
    let y = STX.t + ih;
    const x = STX.l + cw * i, bw = Math.max(1, Math.min(cw - 4, 46));
    const segs = Object.keys(STAT_CATS).filter(k => w.earn[k] > 0).map(k => {
      used.add(k);
      const h = w.earn[k] / top * ih, gap = h > 4 ? 2 : 0;  // 2 px di sfondo fra un segmento e l'altro
      y -= h;
      return `<rect x="${(x + (cw - bw) / 2).toFixed(1)}" y="${(y + gap).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(.8, h - gap).toFixed(1)}" fill="${STAT_CATS[k][1]}"/>`;
    }).join("");
    const end = new Date(w.from + "T12:00:00"); end.setDate(end.getDate() + 6);
    const tip = [LANG.t(`Settimana ${dayLabel(w.from)} – ${end.toLocaleDateString(statLoc(), { day: "2-digit", month: "2-digit" })}: ${cr(w.earned)}`),
      ...Object.keys(STAT_CATS).filter(k => w.earn[k]).map(k => `${LANG.t(STAT_CATS[k][0])}: ${cr(w.earn[k])}`),
      LANG.t(w.active ? "Tempo attivo: " + dur(w.active) : "Nessuna sessione")].join("\n");
    const label = (weeks.length - 1 - i) % every ? "" : `<text x="${(x + cw / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle" class="stx-ax">${dayLabel(w.from)}</text>`;
    return `<g class="stx-hit stx-col" data-tip="${esc(tip)}"><rect x="${x.toFixed(1)}" y="${STX.t}" width="${cw.toFixed(1)}" height="${ih}" class="stx-band"/>${segs}</g>${label}`;
  }).join("");
  const neg = weeks.some(w => Object.values(w.earn).some(v => v < 0));
  return stxSvg(stxYAxis(ticks, H) + bars, H) + statLegend([...used])
    + `<div class="sub stx-note">Etichetta = lunedì della settimana.${neg ? " Se in una settimana un'attività è in perdita (es. merci rivendute sotto costo), il valore negativo è nel tooltip, non nella barra." : ""}</div>`;
}

// --- Dove guadagni di più all'ora -------------------------------------------------------------------------
function ratesBlock(rates, period) {
  const p = rates.periods[period];
  if (!p || !p.rows.length) return `<div class="empty">Nessuna sessione con guadagni ${period === "all" ? "nei journal" : `negli ultimi ${period} giorni`}</div>${ratesNote(rates, p)}`;
  const max = Math.max(...p.rows.map(r => r.cr_h));
  const rows = p.rows.map(r => {
    const thin = r.sessions < 2 || r.active < 3600;
    const tip = [`${LANG.t(STAT_CATS[r.cat][0])}: ${crh(r.cr_h)}`, LANG.t(`${r.sessions} ${r.sessions === 1 ? "sessione" : "sessioni"} · ${dur(r.active)} attivi`),
      LANG.t(`Guadagnato in quelle sessioni: ${cr(r.earned)}`), thin ? LANG.t("Pochi dati: stima poco affidabile") : ""].filter(Boolean).join("\n");
    return `<div class="stx-rate stx-hit" data-tip="${esc(tip)}"><span class="stx-rl"><i class="stx-sw" style="background:${STAT_CATS[r.cat][1]}"></i>${STAT_CATS[r.cat][0]}</span>
      <span class="stx-track"><span style="width:${(r.cr_h / max * 100).toFixed(1)}%;background:${STAT_CATS[r.cat][1]}"></span></span>
      <span class="stx-rv mono">${short(r.cr_h)} CR/h</span>
      <span class="stx-rs sub">${r.sessions} sess. · ${dur(r.active)}${thin ? ' · <span class="tag">pochi dati</span>' : ""}</span></div>`;
  }).join("");
  return `<div class="stx-rates">${rows}</div>${ratesNote(rates, p)}`;
}
const ratesNote = (rates, p) => `<div class="sub stx-note">Stima: per ogni attività si sommano i guadagni e il tempo attivo delle sessioni (di almeno
  ${Math.round(rates.min_active / 60)} minuti) in cui quell'attività ha reso almeno il ${Math.round(rates.dominant * 100)}% dei crediti della sessione.
  I crediti contano quando li incassi: se raccogli dati di esplorazione o di esobiologia per più sessioni e vendi tutto in una volta,
  la sessione della vendita risulta più redditizia del reale.${p && p.considered ? ` Sessioni considerate: ${p.considered}${p.mixed ? `, di cui ${p.mixed} miste (senza un'attività prevalente) escluse` : ""}.` : ""}</div>`;

// --- Record -----------------------------------------------------------------------------------------------
function recordsBlock(rec, bestDay) {
  const sess = r => `${stxDate(r.t)} · ${dur(r.active)}${r.ships?.length ? " · " + esc(r.ships.join(", ")) : ""}`;
  const items = [
    ["Miglior sessione", rec.best_session, r => short(r.value) + " CR", sess],
    ["Miglior CR/h in una sessione", rec.best_rate, r => crh(r.value), r => sess(r) + " · sessioni di almeno 1 ora"],
    ["Miglior ora", rec.best_hour, r => short(r.value) + " CR", r => `${stxDateTime(r.t)} · ${r.count} ${r.count === 1 ? "incasso" : "incassi"} in 60 minuti`],
    ["Miglior giorno", bestDay && { value: bestDay.earned, date: bestDay.date }, r => short(r.value) + " CR", r => `${dayLabel(r.date)}/${r.date.slice(0, 4)}`],
    ["Incasso singolo più alto", rec.biggest_income, r => short(r.value) + " CR", r => `${stxDateTime(r.t)} · ${LANG.t(STAT_CATS[r.cat]?.[0] || "—")}`],
    ["Salto più lungo", rec.longest_jump, r => ly(r.value), r => `${esc(r.system || "—")} · ${stxDate(r.t)}`],
    ["Più sistemi in una sessione", rec.most_systems, r => num(r.value), sess],
    ["Più salti in una sessione", rec.most_jumps, r => num(r.value), sess],
    ["Più distanza in una sessione", rec.most_ly, r => ly(r.value), sess],
    ["Sessione più lunga", rec.longest_session, r => dur(r.value), r => `${stxDate(r.t)}${r.ships?.length ? " · " + esc(r.ships.join(", ")) : ""}`],
    ["Più corpi scansionati in una sessione", rec.most_scans, r => num(r.value), sess],
    ["Più campioni bio in una sessione", rec.most_bio, r => num(r.value), sess],
    ["Saldo più alto", rec.max_credits, r => short(r.value) + " CR", r => "a inizio sessione, " + stxDate(r.t)],
    ["Current_Wealth più alto", rec.max_wealth, r => short(r.value) + " CR", r => stxDate(r.t)],
  ].filter(([, r]) => r);
  if (!items.length) return '<div class="empty">Nessun record nei journal</div>';
  return `<div class="stx-records">${items.map(([label, r, val, sub]) => `<div class="stx-rec"><span class="eyebrow">${label}</span>
    <b class="mono">${val(r)}</b><span class="sub" title="${sub(r)}">${sub(r)}</span></div>`).join("")}</div>`;
}

function statsAdvanced(d) {
  if (!d.credits) return "";
  const period = UI.statsPeriod || "all";
  const pts = d.credits.points, lastPt = pts[pts.length - 1];
  const credits = stxMemo(d, "credits", () => creditsChart(d.credits));
  const activity = stxMemo(d, "activity", () => activityChart(d.activity_weeks));
  const rates = stxMemo(d, "rates:" + period, () => ratesBlock(d.rates, period));
  const records = stxMemo(d, "records", () => recordsBlock(d.records, d.totals.best_day));
  const selector = `<span class="stx-period" role="group" aria-label="Periodo">${STX_PERIODS.map(([k, l]) =>
    `<button class="small ${k === period ? "primary" : ""}" data-stats-period="${k}" aria-pressed="${k === period}">${l}</button>`).join("")}</span>`;
  const weeksEarned = d.activity_weeks.reduce((s, w) => s + w.earned, 0);
  requestAnimationFrame(stxTipRefresh);  // il contenuto è stato appena sostituito: il tooltip si riaggancia
  return `<div style="margin-top:18px">${panel("Crediti nel tempo", credits, { code: "BALANCE",
      aside: lastPt ? `<span class="gold mono">${short(lastPt.credits)} CR</span>${d.credits.commander ? " · CMDR " + esc(d.credits.commander) : ""}` : "" })}</div>
    <div style="margin-top:18px">${panel("Guadagni per attività", activity, { code: "SETTIMANE", aside: `<span class="gold mono">${short(weeksEarned)} CR</span> in ${d.activity_weeks.length} settimane` })}</div>
    <div class="grid" style="margin-top:18px"><div class="col">
      ${panel("Dove guadagni di più all'ora", rates, { code: "CR/H", aside: selector })}
    </div><div class="col">
      ${panel("Record", records, { code: "RECORDS", aside: "dai tuoi journal" })}
    </div></div>`;
}

// --- Tooltip: un solo elemento fuori dalla scheda, così sopravvive al ridisegno ogni 2 secondi ---------------
const STX_TIP = { x: -1, y: -1, el: null };
function stxTipShow(target) {
  let tip = $("stx-tip");
  if (!target) { if (tip) tip.hidden = true; STX_TIP.el?.classList.remove("stx-on"); STX_TIP.el = null; return; }
  if (!tip) { tip = document.createElement("div"); tip.id = "stx-tip"; tip.setAttribute("role", "tooltip"); document.body.appendChild(tip); }
  if (STX_TIP.el !== target) { STX_TIP.el?.classList.remove("stx-on"); target.classList.add("stx-on"); STX_TIP.el = target; }
  const text = target.getAttribute("data-tip");
  if (tip.textContent !== text) tip.textContent = text;
  tip.hidden = false;
  const r = tip.getBoundingClientRect(), pad = 14;
  let x = STX_TIP.x + pad, y = STX_TIP.y + pad;
  if (x + r.width > innerWidth - 8) x = STX_TIP.x - r.width - pad;
  if (y + r.height > innerHeight - 8) y = STX_TIP.y - r.height - pad;
  tip.style.transform = `translate(${Math.max(4, x)}px, ${Math.max(4, y)}px)`;
}
function stxTipRefresh() {
  if (STX_TIP.x < 0) return;
  const el = document.elementFromPoint(STX_TIP.x, STX_TIP.y);
  stxTipShow(el?.closest?.("#view [data-tip]") || null);
}
document.addEventListener("mousemove", e => {
  STX_TIP.x = e.clientX; STX_TIP.y = e.clientY;
  const t = e.target.closest?.("#view [data-tip]") || null;
  if (t || STX_TIP.el) stxTipShow(t);
}, { passive: true });
document.documentElement.addEventListener("mouseleave", () => { STX_TIP.x = -1; stxTipShow(null); });
window.addEventListener("hashchange", () => stxTipShow(null));
document.addEventListener("click", e => {
  const b = e.target.closest("[data-stats-period]");
  if (!b) return;
  UI.statsPeriod = b.dataset.statsPeriod;
  renderView();
});
