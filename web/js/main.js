"use strict";
// Avvio dell'interfaccia e ciclo di aggiornamento (ogni 2 secondi legge lo stato dal server).

let remoteNavSeen = Date.now() / 1000;
let remoteVoiceSeen = null;

// Comandi vocali dal telefono: il server li trascrive, qui vengono eseguiti come quelli detti al PC.
function handleRemoteVoice() {
  const items = S.remote_voice || [];
  if (remoteVoiceSeen === null)  // al primo giro ignora i comandi vecchi di più di 10 secondi
    remoteVoiceSeen = Math.max(0, ...items.filter(i => Date.now() / 1000 - i.ts > 10).map(i => i.id));
  for (const it of items) {
    if (it.id <= remoteVoiceSeen) continue;
    remoteVoiceSeen = it.id;
    const before = VOICE_ENGINE.history[0], t0 = VOICE_ENGINE.lastDispatchedTime;
    VOICE_ENGINE.dispatch(it.text);
    const after = VOICE_ENGINE.history[0];
    // Il telefono considera un errore i risultati che iniziano con "Non riconosciuto" o "Ignorato"
    // (in inglese "Not recognised" o "Ignored").
    const en = voiceLang() === "en";
    const result = after && after !== before ? after.name
      : VOICE_ENGINE.lastDispatchedTime === t0 ? (en ? "Ignored (already done or copilot speaking)" : "Ignorato (già eseguito o copilota in voce)")
      : (en ? `Not recognised: "${it.text}"` : `Non riconosciuto: "${it.text}"`);
    fetch("/api/voice/remote_result", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: it.id, result }) }).catch(() => {});
  }
}

async function tick() {
  try {
    S = await api("/api/state");
  } catch (e) {
    setText("h-live", "SCOLLEGATO");
    const dot = $("h-dot");
    if (dot) dot.className = "live-dot bad";
    return;
  }
  // Ogni passo è protetto: un errore in una parte non deve fermare tutto l'aggiornamento.
  const step = (name, fn) => { try { fn(); } catch (e) { console.error(`[${name}]`, e); } };
  step("intestazione", renderHeader);
  step("ticker", renderTicker);
  step("avvisi vocali", checkTtsAlerts);
  step("voce", () => VOICE_ENGINE.applyServerConfig(S.voice_config));
  step("voce dal telefono", handleRemoteVoice);
  step("salto", () => {
    // Salto vero dal journal: StartJump avvia carica e tunnel, FSDJump l'uscita. Solo eventi recenti (non quelli riletti all'avvio).
    const j = S.jump, recent = ts => ts && Date.now() - new Date(ts).getTime() < 60000;
    if (j && j.id !== UI.jumpSeen && recent(j.ts) && !j.done) { UI.jumpSeen = j.id; Stars.jumpStart(j.star_class); }
    if (j && j.done && j.id !== UI.jumpDone && recent(j.done)) {
      UI.jumpDone = j.id;
      if (UI.jumpSeen === j.id) Stars.jumpEnd(j.star_class); else Stars.warp();
      UI.jumpSeen = j.id;
    }
    else if (UI.lastJumps != null && S.session.jumps > UI.lastJumps && !Stars.busy && !(j && j.id === UI.jumpDone)) Stars.warp();
    UI.lastJumps = S.session.jumps;
  });
  // Il telefono (companion) può chiedere di cambiare scheda sul PC.
  step("navigazione remota", () => {
    const nav = S.remote_nav || {};
    if (nav.view && nav.ts > remoteNavSeen) {
      remoteNavSeen = nav.ts;
      if (VIEWS[nav.view]) location.hash = nav.view;
    }
  });
  if (!(UI.ticks++ % 10)) api("/api/advice?lang=" + UI.lang).then(a => { ADVICE = a; }).catch(() => {});
  if (!UI.cgs || !(UI.ticks % 300)) {
    api("/api/community_goals").then(cgs => { UI.cgs = cgs; if (currentTab() === "overview") renderView(); }).catch(() => {});
  }
  // Non ridisegnare mentre stai scrivendo in un campo.
  if (!document.activeElement?.matches("input:not([type=checkbox]):not([type=range]), select, textarea")) step("scheda", () => renderView());
  else step("menu", renderNav);
}

async function boot() {
  const lines = ["VOIDWATCH ED // ELITE DANGEROUS COMPANION", "> COLLEGAMENTO AL JOURNAL ........", "> SINCRONIZZAZIONE TELEMETRIA ....",
    "> CARICAMENTO DATABASE GALATTICO ..", "> CALIBRAZIONE HUD OLOGRAFICO ....."].map(l => t(l));
  const pre = $("boot-text");
  if (!SETTINGS.boot || sessionStorage.getItem("booted") || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    $("boot").classList.add("done");
    return;
  }
  for (let i = 0; i < lines.length; i++) {
    pre.innerHTML = lines.slice(0, i + 1).map((l, j) => j && j < i + 1 ? `${l} ${j < i || i === lines.length - 1 ? '<span class="ok">OK</span>' : ""}` : l).join("\n");
    await new Promise(r => setTimeout(r, 230));
  }
  pre.innerHTML += `\n\n<span class='ok'>${t("TUTTI I SISTEMI IN LINEA")}</span>`;
  await new Promise(r => setTimeout(r, 380));
  sessionStorage.setItem("booted", "1");
  $("boot").classList.add("done");
  Stars.warp(900);
}

async function init() {
  applySettings();
  tickClock();
  setInterval(tickClock, 1000);
  const bootDone = boot();
  const [st, td, rt, mc, ct, tm] = await Promise.all([
    api("/api/static").catch(() => ({})),
    api("/api/todos").catch(() => []),
    api("/api/route").catch(() => null),
    api("/api/macros").catch(() => []),
    api("/api/controls").catch(() => []),
    api("/api/telemetry_rules").catch(() => []),
  ]);
  STATIC = st || {};
  TODOS = td || [];
  ROUTE = rt;
  MACROS = mc || [];
  CONTROLS = ct || [];
  TELEMETRY_RULES = tm || [];
  fillDatalists();
  api("/api/catalog").then(c => { if (c && !c.error) CATALOG = c; else UI.catalogError = c?.error; renderView(); })
    .catch(e => { UI.catalogError = "Catalogo navi non disponibile: " + e.message; });
  await tick();
  VOICE_ENGINE.applyServerConfig(S?.voice_config, true);
  await bootDone;
  renderView(true);
  setInterval(tick, 2000);
  // Le coordinate di ingegneri e luoghi arrivano da EDSM qualche secondo dopo l'avvio.
  setTimeout(async () => { STATIC = await api("/api/static").catch(() => STATIC); renderView(); }, 8000);
}

init();
