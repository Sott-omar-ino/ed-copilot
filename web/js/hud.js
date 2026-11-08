"use strict";

function tickClock() {
  const d = new Date();
  $("clock").textContent = d.toISOString().slice(11, 19);
  const months = LANG.lang === "en" ? ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
    : ["GEN", "FEB", "MAR", "APR", "MAG", "GIU", "LUG", "AGO", "SET", "OTT", "NOV", "DIC"];
  $("date").textContent = `${String(d.getUTCDate()).padStart(2, "0")} ${months[d.getUTCMonth()]} ${d.getUTCFullYear() + 1286}`;
}
// Fonti (verificate l'08/11/2026):
// - KGBFOAM: Elite Dangerous Wiki, "Fuel Scoop" (stelle di sequenza principale O, B, A, F, G, K, M).
// - Mappatura efficiente x1.25: MattG, "Exploration value formulae" (forums.frontier.co.uk/threads/232000), la
//   formula usata da EDDiscovery/EDDI/EDMC-Pioneer (vedi app/exploration.py).
// - Campioni bio: 3 campioni della stessa specie, ognuno ad almeno la "distanza colonia" del genere dagli altri
//   (Marx's guide to exobiology, forums.frontier.co.uk/threads/583445).
// - Bonus bio x5 a chi vende per primo quella specie su quel corpo; il first footfall da solo non lo dà
//   (forums.frontier.co.uk/threads/600204, risposta di un moderatore).
// - Interstellar Factors: paga taglie e multe e incassa voucher di altre giurisdizioni con una commissione del 25%,
//   e serve Notoriety 0 (Elite Dangerous Wiki, "Interstellar Factor" e "Crime & Punishment").
// - Dati non venduti persi con la distruzione della nave: Elite Dangerous Wiki, "Universal Cartographics".
// - Supercharge: x4 la gittata del salto con una stella di neutroni, x1,5 con una nana bianca (Elite Dangerous Wiki,
//   "FSD Supercharging"); i getti danneggiano l'FSD (evento JetConeDamage nel journal).
const TIPS = [
  "Le stelle KGBFOAM si possono scoopare", "Una mappatura efficiente (sonde entro l'obiettivo) aumenta del 25% il valore del pianeta",
  "I 3 campioni di una specie bio vanno presi ad almeno la distanza colonia del genere l'uno dall'altro",
  "Vendere per primo una specie bio trovata su un corpo ne moltiplica per 5 il valore: il first footfall da solo non basta",
  "Interstellar Factors paga taglie e multe di altri sistemi con una commissione del 25% (serve Notoriety 0)", "Dati non venduti si perdono se muori",
  "Il supercharge di una stella di neutroni quadruplica la gittata del salto, ma i getti danneggiano l'FSD", "Usa ⧉ per copiare un sistema e incollarlo nella mappa galattica",
];
function renderTicker() {
  const items = [...(S.feed || []).slice(0, 6).map(e => e.text), ...TIPS];
  const html = items.map(t => `<span>${esc(t)}</span>`).join("");
  if ($("ticker").dataset.sig !== html) {
    $("ticker").dataset.sig = html;
    $("ticker").innerHTML = html;
  }
}

// ============================================================================
// Campo stellare con salto FSD
// ============================================================================
// ============================================================================
// Campo stellare e salto nell'iperspazio
// Il salto segue le fasi del gioco: carica dell'FSD (le stelle si allungano), tunnel dell'iperspazio
// (vortice di scie azzurre e viola con lampi), uscita con il bagliore del colore della stella di arrivo.
// ============================================================================
const Stars = (() => {
  const cv = $("stars"), ctx = cv.getContext("2d");
  // Colori approssimativi delle classi stellari (stella di arrivo, da StartJump.StarClass).
  const STAR_TINT = { O: [155, 176, 255], B: [170, 191, 255], A: [202, 215, 255], F: [248, 247, 255], G: [255, 244, 214],
    K: [255, 210, 161], M: [255, 180, 120], L: [255, 120, 80], T: [220, 90, 90], Y: [170, 70, 70],
    N: [200, 235, 255], H: [60, 40, 90], D: [235, 240, 255], W: [190, 215, 255] };
  let w, h, dpr, stars = [], tunnel = [], speed = 0.15, target = 0.15;
  let phase = "idle", phaseAt = 0, tint = [255, 255, 255], dest = [255, 255, 255], shake = 0, flash = 0, swirl = 0;

  const rnd = (a, b) => a + Math.random() * (b - a);
  function resize() {
    dpr = devicePixelRatio || 1;
    w = cv.width = innerWidth * dpr;
    h = cv.height = innerHeight * dpr;
    stars = Array.from({ length: 380 }, () => ({ x: (Math.random() - .5) * w, y: (Math.random() - .5) * h, z: Math.random() * w }));
    tunnel = Array.from({ length: 520 }, () => ({ a: rnd(0, Math.PI * 2), z: rnd(0, 1), r: rnd(.75, 1.35), hue: Math.random() }));
  }
  const tintFor = cls => STAR_TINT[(cls || "").replace(/^D.*/, "D").replace(/^W.*/, "W").charAt(0)] || [255, 255, 255];

  function drawStars(cx, cy, hot) {
    for (const s of stars) {
      const pz = s.z;
      s.z -= speed * 4 * dpr;
      if (s.z < 1) { s.x = (Math.random() - .5) * w; s.y = (Math.random() - .5) * h; s.z = w; continue; }
      const k = 300 * dpr / s.z, pk = 300 * dpr / pz;
      const a = Math.min(1, (1 - s.z / w) * 1.4);
      ctx.strokeStyle = hot ? `rgba(170,215,255,${a})` : `rgba(255,${200 + 40 * a | 0},${170 + 60 * a | 0},${a * .9})`;
      ctx.lineWidth = Math.max(.6, k * .9);
      ctx.beginPath();
      ctx.moveTo(cx + s.x * pk, cy + s.y * pk);
      ctx.lineTo(cx + s.x * k + .1, cy + s.y * k + .1);
      ctx.stroke();
    }
  }

  // Tunnel: particelle su un cilindro che scorrono verso chi guarda e ruotano lentamente.
  function drawTunnel(cx, cy, t, intensity) {
    const R = Math.hypot(w, h) * .55;
    ctx.globalCompositeOperation = "lighter";
    // nebbia del tunnel: anelli sfumati blu/viola che pulsano
    for (let i = 0; i < 3; i++) {
      const pr = R * (.25 + .3 * i + .05 * Math.sin(t * 2.2 + i));
      const g = ctx.createRadialGradient(cx, cy, pr * .35, cx, cy, pr);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(.7, `rgba(${i === 1 ? "120,70,255" : "40,120,255"},${.07 * intensity})`);
      g.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    swirl += .004 + .01 * intensity;
    for (const p of tunnel) {
      const z0 = p.z;
      p.z -= (.006 + .02 * intensity);
      if (p.z <= .02) { p.z = 1; p.a = rnd(0, Math.PI * 2); p.r = rnd(.75, 1.35); continue; }
      const k0 = .06 / z0, k1 = .06 / p.z;
      const ang = p.a + swirl * (1 + p.r * .3);
      const x0 = cx + Math.cos(ang - .02) * R * p.r * k0, y0 = cy + Math.sin(ang - .02) * R * p.r * k0;
      const x1 = cx + Math.cos(ang) * R * p.r * k1, y1 = cy + Math.sin(ang) * R * p.r * k1;
      const a = Math.min(1, (1 - p.z) * 1.3) * intensity;
      const col = p.hue < .55 ? `rgba(120,190,255,${a})` : p.hue < .85 ? `rgba(170,140,255,${a})` : `rgba(235,245,255,${a})`;
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(.8, 2.4 * dpr * (1 - p.z));
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
    }
    // luce in fondo al tunnel
    // la stella di arrivo: in fondo al tunnel, sempre più grande
    const grow = Math.min(1, t / 14);
    const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * (.16 + .14 * grow));
    core.addColorStop(0, `rgba(${dest[0]},${dest[1]},${dest[2]},${(.55 + .35 * grow) * intensity})`);
    core.addColorStop(.35, `rgba(120,170,255,${.22 * intensity})`);
    core.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = core;
    ctx.fillRect(0, 0, w, h);
    // turbolenza: ogni tanto un lampo che attraversa il tunnel
    if (Math.random() < .025 * intensity) {
      const ang = rnd(0, Math.PI * 2);
      ctx.strokeStyle = `rgba(200,220,255,${.5 * intensity})`;
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      let r = R * .08;
      ctx.moveTo(cx + Math.cos(ang) * r, cy + Math.sin(ang) * r);
      for (let i = 0; i < 7; i++) {
        r *= 1.45;
        const a2 = ang + rnd(-.18, .18);
        ctx.lineTo(cx + Math.cos(a2) * r, cy + Math.sin(a2) * r);
      }
      ctx.stroke();
      shake = Math.max(shake, 4 * dpr);
    }
    ctx.globalCompositeOperation = "source-over";
  }

  function frame(now) {
    if (!SETTINGS.stars) {
      ctx.fillStyle = "#030100";
      ctx.fillRect(0, 0, w, h);
      requestAnimationFrame(frame);
      return;
    }
    const t = now / 1000, el = (now - phaseAt) / 1000;
    if (phase === "charge" && el > 4.2) setPhase("tunnel");
    if (phase === "tunnel" && el > 45) setPhase("exit");  // il gioco non ha mai segnalato l'arrivo: si esce comunque
    if (phase === "exit" && el > 2.5) setPhase("idle");

    speed += (target - speed) * (phase === "exit" ? .06 : .04);
    const inTunnel = phase === "tunnel";
    ctx.fillStyle = inTunnel ? "rgba(2,3,10,.35)" : speed > 2 ? "rgba(4,2,1,.25)" : "rgba(4,2,1,.9)";
    ctx.fillRect(0, 0, w, h);

    shake *= .9;
    const ox = (Math.random() - .5) * shake, oy = (Math.random() - .5) * shake;
    const cx = w / 2 + ox, cy = h / 2 + oy;
    if (phase === "charge") shake = Math.max(shake, Math.min(el, 4) * 1.2 * dpr);

    if (inTunnel) drawTunnel(cx, cy, el, Math.min(1, el / 1.2));
    else drawStars(cx, cy, speed > 2);

    if (flash > .01) {
      ctx.fillStyle = `rgba(${tint[0]},${tint[1]},${tint[2]},${flash})`;
      ctx.fillRect(0, 0, w, h);
      flash *= .93;
    }
    requestAnimationFrame(frame);
  }

  function setPhase(p) {
    phase = p;
    phaseAt = performance.now();
    if (p === "charge") target = 3;
    if (p === "tunnel") { flash = .55; tint = [190, 215, 255]; target = 0.15; }
    if (p === "exit") { flash = .85; target = 26; setTimeout(() => { target = 0.15; }, 500); }
    if (p === "idle") target = 0.15;
  }

  addEventListener("resize", resize);
  resize();
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) requestAnimationFrame(frame);
  return {
    // Effetto breve (rotte calcolate, salto rilevato senza StartJump).
    warp(ms = 1400) { if (!SETTINGS.warp || phase !== "idle") return; target = 22; setTimeout(() => { target = 0.15; }, ms); },
    nudge() { target = 2.4; setTimeout(() => { target = 0.15; }, 260); },
    // Salto vero: chiamato quando il journal segnala StartJump (iperspazio) e poi l'arrivo (FSDJump).
    jumpStart(starClass) { if (!SETTINGS.warp || phase === "charge" || phase === "tunnel") return; dest = tintFor(starClass); setPhase("charge"); },
    jumpEnd(starClass) {
      if (!SETTINGS.warp) return;
      if (starClass) dest = tintFor(starClass);
      if (phase === "charge" || phase === "tunnel") { setPhase("exit"); tint = dest; }
    },
    get busy() { return phase !== "idle"; },
  };
})();
