// Mappa dei viaggi: sistemi visitati e percorso, disegnati su un <canvas> (niente librerie esterne).
// Il canvas ha data-keep: renderView lo rimette al suo posto a ogni aggiornamento, quindi il disegno non si perde.
// Si ridisegna solo quando cambiano i dati, le dimensioni o quando trascini/zoomi.

// Coordinate verificate l'8/11/2026 con l'API pubblica EDSM (api-v1/systems?showCoordinates=1, tutte "coordsLocked": true);
// Colonia coincide anche con lo StarPos scritto dal gioco nei journal (FSDJump/Location).
const TM_LANDMARKS = [
  ["Sol", 0, 0, 0],
  ["Colonia", -9530.5, -910.28125, 19808.125],
  ["Sagittarius A*", 25.21875, -20.90625, 25899.96875],
  ["Beagle Point", -1111.5625, -134.21875, 65269.75],
];
const TM_PERIODS = [["all", "Tutto"], ["30d", "Ultimi 30 giorni"], ["session", "Sessione"]];
const TM_BUCKETS = 12;  // fasce di colore per la recenza (un solo stroke per fascia: veloce anche con migliaia di salti)

const TM = window.TM = {
  period: "all", view: "top", data: null, busy: false, error: null, at: 0, sys: null,
  cx: 0, cy: 0, scale: 0.05, fitted: false,  // centro (coordinate di schermo in al) e pixel per anno luce
  canvas: null, ro: null, raf: 0, hover: null, drag: null, pts: null,
};

async function tmLoad() {
  if (TM.busy) return;
  TM.busy = true;
  const period = TM.period;
  try {
    const d = await api(`/api/travelmap?period=${period}`);
    if (period !== TM.period) return;
    TM.data = d;
    TM.error = null;
    TM.hover = null;
    tmPrepare();
    if (!TM.fitted) tmFit();
  } catch (e) { TM.error = e.message; }
  finally {
    TM.busy = false;
    TM.at = Date.now();
    TM.sys = S?.location?.system || null;
    if (period !== TM.period) { tmLoad(); return; }  // il periodo è cambiato mentre leggevo
    if (currentTab() === "travelmap") renderView();
    tmDraw();
  }
}

// Coordinate di schermo (in anni luce) secondo la vista: dall'alto X/Z, di lato X/Y. Lo schermo ha y verso il basso.
const tmProj = (x, y, z) => TM.view === "side" ? [x, -y] : [x, -z];

function tmPrepare() {
  const d = TM.data;
  if (!d) return;
  const t0 = d.time_range?.[0] ?? 0, t1 = d.time_range?.[1] ?? 1, span = Math.max(1, t1 - t0);
  const rec = t => Math.max(0, Math.min(TM_BUCKETS - 1, Math.floor((t - t0) / span * TM_BUCKETS)));
  const n = d.systems.length, sx = new Float64Array(n), sy = new Float64Array(n), sb = new Uint8Array(n), sr = new Float32Array(n);
  d.systems.forEach((s, i) => {
    [sx[i], sy[i]] = tmProj(s[1], s[2], s[3]);
    sb[i] = rec(s[6]);
    sr[i] = Math.min(4.5, 2 + Math.log2(s[4]) * 0.7);
  });
  const m = d.path.length, px = new Float64Array(m), py = new Float64Array(m), pb = new Uint8Array(m), brk = new Uint8Array(m);
  d.path.forEach((p, i) => { [px[i], py[i]] = tmProj(p[0], p[1], p[2]); pb[i] = rec(p[3]); brk[i] = p[5]; });
  TM.pts = { sx, sy, sb, sr, px, py, pb, brk };
}

function tmSize() {
  const c = TM.canvas;
  if (!c) return [0, 0];
  const w = c.clientWidth, h = c.clientHeight, dpr = window.devicePixelRatio || 1;
  if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
  return [w, h];
}

function tmFitTo(points) {
  const [w, h] = tmSize();
  if (!w || !h || !points.length) return;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const [x, y] of points) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
  const pad = 50, dx = Math.max(x1 - x0, 20), dy = Math.max(y1 - y0, 20);
  TM.scale = Math.min((w - pad * 2) / dx, (h - pad * 2) / dy);
  TM.cx = (x0 + x1) / 2;
  TM.cy = (y0 + y1) / 2;
  TM.fitted = true;
}
function tmFit() {
  const d = TM.data;
  if (!d) return;
  const pts = d.systems.map(s => tmProj(s[1], s[2], s[3]));
  if (d.current?.pos) pts.push(tmProj(...d.current.pos));
  if (!pts.length) pts.push(tmProj(0, 0, 0));
  tmFitTo(pts);
  tmDraw();
}
function tmFitGalaxy() {
  const pts = TM_LANDMARKS.map(l => tmProj(l[1], l[2], l[3]));
  for (const s of TM.data?.systems || []) pts.push(tmProj(s[1], s[2], s[3]));
  tmFitTo(pts);
  tmDraw();
}

function tmDraw() {
  if (!TM.canvas || TM.raf) return;
  TM.raf = requestAnimationFrame(() => { TM.raf = 0; tmPaint(); });
}

// Colore della recenza: dal marrone spento (vecchio) all'arancione HUD fino al giallo chiaro (recente).
function tmColor(b, alpha) {
  const f = b / (TM_BUCKETS - 1);
  const r = Math.round(120 + 135 * Math.min(1, f * 1.4)), g = Math.round(50 + 160 * f), bl = Math.round(10 + 100 * f * f);
  return `rgba(${r},${g},${bl},${alpha})`;
}

// Etichette della griglia compatte: 12k invece di 12.000 (non si sovrappongono).
const tmGridLabel = v => { v = Math.round(v) || 0; return Math.abs(v) >= 1000 ? (v / 1000).toLocaleString(NUM_LOCALE, { maximumFractionDigits: 1 }) + "k" : String(v); };

function tmNiceStep(ly) {
  const p = Math.pow(10, Math.floor(Math.log10(ly)));
  return ly / p < 2 ? p : ly / p < 5 ? 2 * p : 5 * p;
}

function tmPaint() {
  const c = TM.canvas;
  if (!c || !c.isConnected) return;
  const [w, h] = tmSize();
  if (!w || !h) return;
  const dpr = c.width / w, ctx = c.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const k = TM.scale, ox = w / 2 - TM.cx * k, oy = h / 2 - TM.cy * k;
  const X = x => ox + x * k, Y = y => oy + y * k;

  // Griglia con passo adattivo (circa 90 px) ed etichette.
  const step = tmNiceStep(90 / k);
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(255,140,0,.07)";
  ctx.fillStyle = "rgba(255,140,0,.35)";
  ctx.font = "10px 'Share Tech Mono', Consolas, monospace";
  ctx.beginPath();
  const gx0 = Math.floor((0 - ox) / k / step) * step, gy0 = Math.floor((0 - oy) / k / step) * step;
  for (let g = gx0; X(g) < w; g += step) { const sx = Math.round(X(g)) + .5; ctx.moveTo(sx, 0); ctx.lineTo(sx, h); }
  for (let g = gy0; Y(g) < h; g += step) { const sy = Math.round(Y(g)) + .5; ctx.moveTo(0, sy); ctx.lineTo(w, sy); }
  ctx.stroke();
  const vAxis = TM.view === "side" ? "Y" : "Z";
  for (let g = gx0; X(g) < w; g += step) ctx.fillText(`X ${tmGridLabel(g)}`, X(g) + 3, h - 6);
  for (let g = gy0; Y(g) < h; g += step) ctx.fillText(`${vAxis} ${tmGridLabel(-g)}`, 4, Y(g) - 3);
  // Scala
  ctx.fillStyle = "rgba(255,178,71,.8)";
  ctx.fillRect(w - 20 - step * k, h - 22, step * k, 2);
  ctx.fillText(LANG.t(`${num(step)} al`), w - 20 - step * k, h - 28);

  // Punti di riferimento
  ctx.strokeStyle = "rgba(63,169,255,.75)";
  ctx.fillStyle = "rgba(143,208,255,.9)";
  ctx.font = "11px Saira, Bahnschrift, 'Segoe UI', sans-serif";
  ctx.beginPath();
  for (const [name, x, y, z] of TM_LANDMARKS) {
    const [a, b] = tmProj(x, y, z), sx = X(a), sy = Y(b);
    if (sx < -100 || sx > w + 100 || sy < -30 || sy > h + 30) continue;
    ctx.moveTo(sx - 6, sy); ctx.lineTo(sx + 6, sy); ctx.moveTo(sx, sy - 6); ctx.lineTo(sx, sy + 6);
    ctx.fillText(name.toUpperCase(), sx + 8, sy - 6);
  }
  ctx.stroke();

  const p = TM.pts, d = TM.data;
  if (!p || !d) return;
  // Percorso: una passata per fascia di recenza (le più recenti sopra).
  ctx.lineWidth = 1.3;
  ctx.lineJoin = "round";
  for (let b = 0; b < TM_BUCKETS; b++) {
    ctx.strokeStyle = tmColor(b, 0.25 + 0.6 * b / (TM_BUCKETS - 1));
    ctx.beginPath();
    let any = false;
    for (let i = 1; i < p.px.length; i++) {
      if (p.pb[i] !== b || p.brk[i]) continue;
      ctx.moveTo(X(p.px[i - 1]), Y(p.py[i - 1]));
      ctx.lineTo(X(p.px[i]), Y(p.py[i]));
      any = true;
    }
    if (any) ctx.stroke();
  }
  // Sistemi visitati
  for (let b = 0; b < TM_BUCKETS; b++) {
    ctx.fillStyle = tmColor(b, 0.95);
    for (let i = 0; i < p.sx.length; i++) {
      if (p.sb[i] !== b) continue;
      const sx = X(p.sx[i]), sy = Y(p.sy[i]);
      if (sx < -5 || sy < -5 || sx > w + 5 || sy > h + 5) continue;
      const r = p.sr[i];
      ctx.fillRect(sx - r / 2, sy - r / 2, r, r);
    }
  }
  // Luoghi notevoli: ingegneri (oro), la propria carrier (blu)
  for (const pl of d.places) {
    if (!pl.pos || (pl.kind !== "engineer" && pl.kind !== "mycarrier")) continue;
    const [a, b] = tmProj(...pl.pos), sx = X(a), sy = Y(b);
    ctx.strokeStyle = pl.kind === "engineer" ? "#ffd27a" : "#3fa9ff";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(sx, sy - 6); ctx.lineTo(sx + 6, sy); ctx.lineTo(sx, sy + 6); ctx.lineTo(sx - 6, sy); ctx.closePath();
    ctx.stroke();
  }
  // Posizione attuale
  if (d.current?.pos) {
    const [a, b] = tmProj(...d.current.pos), sx = X(a), sy = Y(b);
    ctx.strokeStyle = "#ffb247";
    ctx.shadowColor = "rgba(255,140,0,.9)";
    ctx.shadowBlur = 10;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(sx, sy, 9, 0, Math.PI * 2); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.beginPath();
    ctx.moveTo(sx - 16, sy); ctx.lineTo(sx - 11, sy); ctx.moveTo(sx + 11, sy); ctx.lineTo(sx + 16, sy);
    ctx.moveTo(sx, sy - 16); ctx.lineTo(sx, sy - 11); ctx.moveTo(sx, sy + 11); ctx.lineTo(sx, sy + 16);
    ctx.stroke();
    ctx.fillStyle = "#ffd9b0";
    ctx.font = "700 12px Saira, Bahnschrift, 'Segoe UI', sans-serif";
    ctx.fillText(d.current.system.toUpperCase(), sx + 14, sy - 12);
  }
  // Sistema sotto il mouse
  if (TM.hover != null) {
    const i = TM.hover, sx = X(p.sx[i]), sy = Y(p.sy[i]);
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.arc(sx, sy, 6, 0, Math.PI * 2); ctx.stroke();
  }
}

// Sistema più vicino al mouse (entro 8 px), in pixel CSS del canvas.
function tmPick(mx, my) {
  const p = TM.pts;
  if (!p || !TM.canvas) return null;
  const w = TM.canvas.clientWidth, h = TM.canvas.clientHeight, k = TM.scale;
  const ox = w / 2 - TM.cx * k, oy = h / 2 - TM.cy * k;
  let best = null, bd = 64;
  for (let i = 0; i < p.sx.length; i++) {
    const dx = ox + p.sx[i] * k - mx, dy = oy + p.sy[i] * k - my, dd = dx * dx + dy * dy;
    if (dd < bd) { bd = dd; best = i; }
  }
  return best;
}

function tmTip(mx, my) {
  const tip = $("tm-tip");
  if (!tip) return;
  const i = TM.hover;
  if (i == null) { tip.style.display = "none"; return; }
  const s = TM.data.systems[i], cur = TM.data.current?.pos;
  const fromSol = Math.hypot(s[1], s[2], s[3]), fromHere = cur ? dist3(cur, [s[1], s[2], s[3]]) : null;
  tip.innerHTML = `<b>${esc(s[0])}</b><div>${s[4]} ${s[4] === 1 ? "visita" : "visite"} · ultima ${esc(ago(s[6]))}</div>
    <div>${ly(fromSol)} da Sol${fromHere != null && fromHere > 0.05 ? ` · ${ly(fromHere)} da qui` : ""}</div><div class="sub">Clic per copiare il nome</div>`;
  tip.style.display = "block";
  const wrap = TM.canvas.clientWidth;
  tip.style.left = Math.min(mx + 14, wrap - tip.offsetWidth - 6) + "px";
  tip.style.top = Math.max(6, my - tip.offsetHeight - 10) + "px";
}

function tmMount() {
  const c = $("tm-canvas");
  if (!c || c === TM.canvas) return;
  TM.canvas = c;
  const rel = e => { const r = c.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  c.addEventListener("wheel", e => {
    e.preventDefault();
    const [mx, my] = rel(e), w = c.clientWidth, h = c.clientHeight;
    const k0 = TM.scale, k1 = Math.max(0.0005, Math.min(400, k0 * Math.exp(-e.deltaY * 0.0015)));
    // Lo zoom resta centrato sul punto sotto il mouse.
    const gx = TM.cx + (mx - w / 2) / k0, gy = TM.cy + (my - h / 2) / k0;
    TM.scale = k1;
    TM.cx = gx - (mx - w / 2) / k1;
    TM.cy = gy - (my - h / 2) / k1;
    tmDraw();
  }, { passive: false });
  c.addEventListener("pointerdown", e => {
    if (e.button !== 0) return;
    c.setPointerCapture(e.pointerId);
    TM.drag = { x: e.clientX, y: e.clientY, cx: TM.cx, cy: TM.cy, moved: false };
    c.classList.add("dragging");
  });
  c.addEventListener("pointermove", e => {
    const [mx, my] = rel(e);
    if (TM.drag) {
      const dx = e.clientX - TM.drag.x, dy = e.clientY - TM.drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) TM.drag.moved = true;
      TM.cx = TM.drag.cx - dx / TM.scale;
      TM.cy = TM.drag.cy - dy / TM.scale;
      if (TM.hover != null) { TM.hover = null; tmTip(); }
      tmDraw();
      return;
    }
    const h = tmPick(mx, my);
    if (h !== TM.hover) { TM.hover = h; tmDraw(); }
    tmTip(mx, my);
  });
  const end = e => {
    const d = TM.drag;
    TM.drag = null;
    c.classList.remove("dragging");
    if (d && !d.moved && e.type === "pointerup") {
      const [mx, my] = rel(e), i = tmPick(mx, my);
      if (i != null) {
        const name = TM.data.systems[i][0];
        navigator.clipboard.writeText(name).then(() => toast("Copiato: " + name), () => toast(name));
      }
    }
  };
  c.addEventListener("pointerup", end);
  c.addEventListener("pointercancel", end);
  c.addEventListener("pointerleave", () => { if (!TM.drag && TM.hover != null) { TM.hover = null; tmTip(); tmDraw(); } });
  TM.ro?.disconnect();
  TM.ro = new ResizeObserver(() => { if (!TM.fitted && TM.data) tmFit(); tmDraw(); });
  TM.ro.observe(c);
  tmDraw();
}

function tmPlaces(d) {
  const label = { station: "Stazione", carrier: "Fleet Carrier", engineer: "Ingegnere", mycarrier: "Tua carrier" };
  const list = d.places.slice().sort((a, b) => (b.kind === "mycarrier") - (a.kind === "mycarrier") || b.last - a.last);
  if (!list.length) return '<div class="empty">Nessun attracco o ingegnere nel periodo scelto</div>';
  const shown = list.slice(0, 40);
  return `<table><thead><tr><th>Tipo</th><th>Luogo</th><th>Sistema</th><th class="num">Volte</th><th class="num">Ultima</th><th></th></tr></thead><tbody>
    ${shown.map(pl => `<tr><td><span class="tag">${label[pl.kind] || esc(pl.kind)}</span></td><td>${esc(pl.name)}</td><td>${sys(pl.system)}</td>
      <td class="num">${pl.count}</td><td class="num">${esc(ago(pl.last))}</td>
      <td>${pl.pos ? `<button class="small ghost" data-tm-focus="${pl.pos.join(",")}" title="Centra la mappa qui">◎</button>` : ""}</td></tr>`).join("")}
    </tbody></table>${list.length > shown.length ? `<div class="sub" style="margin-top:6px">… altri ${list.length - shown.length} luoghi</div>` : ""}`;
}

VIEWS.travelmap = () => {
  // Primo caricamento, poi rilettura quando cambi sistema (dopo qualche secondo) o ogni 60 s.
  const age = Date.now() - TM.at;
  if (!TM.busy && (!TM.data && !TM.error || age > 60000 || (S.location.system && S.location.system !== TM.sys && age > 4000))) tmLoad();
  queueMicrotask(tmMount);
  const d = TM.data, st = d?.stats;
  const btn = (attr, v, cur, l) => `<button class="small ${v === cur ? "primary" : ""}" ${attr}="${v}">${l}</button>`;
  const controls = `<div class="tm-controls">
    <div class="seg-choice">${TM_PERIODS.map(([v, l]) => btn("data-tm-period", v, TM.period, l)).join("")}</div>
    <div class="seg-choice">${btn("data-tm-view", "top", TM.view, "Dall'alto (X/Z)")}${btn("data-tm-view", "side", TM.view, "Di lato (X/Y)")}</div>
    <button class="small" data-tm-fit title="Inquadra tutti i sistemi visitati">Adatta ai dati</button>
    <button class="small ghost" data-tm-galaxy title="Inquadra anche Colonia, Sagittarius A* e Beagle Point">Galassia</button>
    <button class="small ghost" data-tm-here title="Centra sulla posizione attuale">Dove sono</button></div>`;
  const far = st?.farthest;
  const stats = st ? `<div class="kv-grid tm-stats">
      <div class="kv"><span>Sistemi</span><span class="big">${num(st.systems)}</span></div>
      <div class="kv"><span>Salti FSD</span><span class="big">${num(st.jumps)}</span>${st.carrier_jumps ? `<span class="sub">+ ${num(st.carrier_jumps)} in carrier</span>` : ""}</div>
      <div class="kv"><span>Distanza</span><span class="big">${ly(st.distance)}</span>${st.carrier_distance ? `<span class="sub">+ ${ly(st.carrier_distance)} in carrier</span>` : ""}</div>
      <div class="kv"><span>Più lontano da Sol</span><span class="big">${far ? ly(far.dist) : "—"}</span>${far ? `<span class="sub">${sys(far.system)}</span>` : ""}</div>
    </div>` : "";
  const status = TM.error ? `<div class="bad">⚠ ${esc(TM.error)}</div>`
    : !d ? '<div class="loading">LETTURA DEI JOURNAL</div>'
      : !d.systems.length ? '<div class="empty">Nessun salto registrato nel periodo scelto</div>' : "";
  const note = d ? `<div class="sub tm-legend"><span><i class="tm-sw old"></i>vecchio</span><span><i class="tm-sw new"></i>recente</span>
      <span><i class="tm-sw here"></i>sei qui</span><span><i class="tm-sw eng"></i>ingegnere</span><span><i class="tm-sw fc"></i>tua carrier</span>
      <span><i class="tm-sw ref"></i>riferimento</span>
      <span>Trascina per spostare, rotella per lo zoom, clic su un sistema per copiarne il nome.${d.simplified ? ` Percorso semplificato: ${num(d.path.length)} punti su ${num(d.path_total)}.` : ""}</span></div>` : "";
  return `${panel("Mappa dei viaggi", `${controls}${stats}${status}
      <div class="tm-wrap"><canvas id="tm-canvas" data-keep></canvas><div id="tm-tip" class="tm-tip" data-keep></div></div>${note}`,
    { code: "GAL-MAP", aside: TM.busy ? "aggiorno…" : d ? `${num(d.systems.length)} sistemi` : "" })}
    <div style="margin-top:18px">${d ? panel("Luoghi notevoli", tmPlaces(d), { code: "WAYPOINTS", aside: d.carrier ? `Carrier a ${esc(d.carrier.system)}` : "" }) : ""}</div>`;
};

document.addEventListener("click", e => {
  const t = e.target.closest("[data-tm-period],[data-tm-view],[data-tm-fit],[data-tm-galaxy],[data-tm-here],[data-tm-focus]");
  if (!t) return;
  const ds = t.dataset;
  if (ds.tmPeriod) {
    if (TM.period === ds.tmPeriod) return;
    TM.period = ds.tmPeriod;
    TM.fitted = false;
    TM.hover = null;
    tmLoad();
    renderView();
  } else if (ds.tmView) {
    if (TM.view === ds.tmView) return;
    TM.view = ds.tmView;
    TM.hover = null;
    tmPrepare();
    tmFit();
    renderView();
  } else if ("tmFit" in ds) tmFit();
  else if ("tmGalaxy" in ds) tmFitGalaxy();
  else {
    const pos = "tmHere" in ds ? TM.data?.current?.pos : ds.tmFocus.split(",").map(Number);
    if (!pos) return;
    [TM.cx, TM.cy] = tmProj(...pos);
    if (TM.scale < 0.5) TM.scale = 2;
    if ("tmFocus" in ds) TM.canvas?.scrollIntoView({ behavior: "smooth", block: "center" });
    tmDraw();
  }
});
