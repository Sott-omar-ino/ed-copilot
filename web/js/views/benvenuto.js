"use strict";
// Guida al primo avvio ("Benvenuto"): finestra a passi sopra l'interfaccia, aperta da sola la prima volta.
// Vive fuori da #view (aggiunta a <body>), quindi il ridisegno ogni 2 secondi non la tocca: si ridisegna solo
// quando cambia qualcosa al suo interno. "Già vista" è salvato nella configurazione dell'app sul server
// (/api/settings → welcome_seen, POST /api/welcome), così resta anche se la memoria della finestra viene cancellata;
// localStorage serve solo come riserva se il server non risponde.

const WZ = {
  step: 0, el: null, prevFocus: null, settings: null, busy: {}, msg: {},
  STEPS: ["Benvenuto", "Lingua", "Copilota vocale", "Tasti del gioco", "Push-to-talk", "Facoltativi", "Fine"],
};

const wzVoices = [["elsa", "Elsa (femminile, cristallina)"], ["diego", "Diego (maschile, calmo)"],
  ["isabella", "Isabella (femminile, naturale)"], ["giuseppe", "Giuseppe (maschile, naturale)"], ["sapi", "Voce di Windows (offline)"]];
// Interfaccia in inglese: voci inglesi (verificate nell'elenco di edge-tts, vedi app/voice.py EN_DEFAULTS).
const wzVoicesEn = [["en-GB-SoniaNeural", "Sonia (female, British)"], ["en-GB-RyanNeural", "Ryan (male, British)"],
  ["en-US-AriaNeural", "Aria (female, American)"], ["en-US-GuyNeural", "Guy (male, American)"], ["sapi", "Windows voice (offline)"]];

const wzRow = (title, desc, control) =>
  `<div class="wz-row"><div class="text">${title}<div class="sub">${desc}</div></div><div class="wz-ctl">${control}</div></div>`;
const wzSwitch = (key, on, label) =>
  `<span class="sub wz-state">${on ? "ACCESO" : "SPENTO"}</span><button class="switch ${on ? "on" : ""}" data-wz-toggle="${key}" role="switch" aria-checked="${!!on}" aria-label="${esc(label)}"><span></span><span></span></button>`;

// --- Passi -------------------------------------------------------------------------------------------

function wzStepWelcome() {
  const j = WZ.settings?.journal;
  const dir = j?.dir || STATIC?.journal_dir || "—";
  const events = !!(S?.cmdr?.name);
  let status;
  if (!WZ.settings) status = '<div class="loading">Controllo la cartella del journal</div>';
  else if (!j?.found) status = `<div class="warnbox">⚠ Cartella del journal non trovata. Avvia Elite Dangerous una volta: il gioco la crea al primo avvio.
      <div class="sub mono" style="margin-top:4px;word-break:break-all">${esc(dir)}</div></div>`;
  else if (!j.files && !events) status = `<div class="warnbox">⚠ Cartella trovata, ma non ci sono ancora eventi del journal: avvia Elite Dangerous una volta
      ed entra in gioco, poi l'app si aggiorna da sola.<div class="sub mono" style="margin-top:4px;word-break:break-all">${esc(dir)}</div></div>`;
  else status = `<div class="ok">✓ Journal trovato${j.files ? ` (${num(j.files)} file)` : ""}${events ? ` · Comandante <b class="gold">${esc(S.cmdr.name)}</b>` : ""}.</div>
      <div class="sub mono" style="margin-top:4px;word-break:break-all">${esc(dir)}</div>`;
  return `<p class="wz-lead">Voidwatch ED è il tuo copilota per Elite Dangerous.</p>
    <ul class="wz-list">
      <li>Legge il journal del gioco e ti mostra in tempo reale nave, rotta, missioni, materiali ed esplorazione.</li>
      <li>Cerca stazioni, mercati e rotte e ti suggerisce cosa fare.</li>
      <li>Ti parla e ascolta i comandi vocali, anche dalla cloche o dal telefono.</li>
    </ul>
    <div class="eyebrow" style="margin:14px 0 6px">Journal di gioco</div>${status}
    <p class="sub" style="margin-top:12px">Ogni passo si può saltare: tutto resta modificabile in Impostazioni.</p>`;
}

function wzStepLang() {
  const cur = LANGS.find(l => l[0] === SETTINGS.lang) || LANGS[0];
  // Lingua dell'interfaccia (Interface language): scritta in entrambe le lingue, così si trova anche senza capire l'altra.
  return `<div class="eyebrow" style="margin:0 0 6px" data-no-translate>Lingua dell'interfaccia / Interface language</div>
    <div class="seg-choice" role="group" aria-label="Lingua dell'interfaccia">${uiLangButtons("data-wz-ui-lang")}</div>
    <div class="sub" style="margin-top:8px">Menu, pulsanti, testi e messaggi del copilota. Cambiandola l'app si ricarica e la guida riparte da qui.</div>
    <div class="eyebrow" style="margin:16px 0 6px">Lingua dei termini di gioco</div>
    <p class="sub" style="margin-top:0">Come vuoi vedere i nomi del gioco (moduli, materiali, merci, ranghi)? In gioco sono in inglese.</p>
    <div class="seg-choice" role="group" aria-label="Lingua dei termini di gioco">${LANGS.map(([v, l]) =>
      `<button class="small ${SETTINGS.lang === v ? "primary" : ""}" data-wz-lang="${v}" aria-pressed="${SETTINGS.lang === v}">${l}</button>`).join("")}</div>
    <div class="sub" style="margin-top:8px">${esc(cur[2])}</div>`;
}

function wzStepVoice() {
  const ttsOn = SETTINGS.tts !== false;
  const cur = ttsVoiceKey();
  const mics = WZ.mics || [];
  const savedMic = localStorage.getItem("ed_mic_device") || "";
  return `<p class="sub">Il copilota ti avvisa a voce (stella non scupabile, carburante basso, pianeti di classe terrestre…) e può eseguire i tuoi comandi vocali.</p>
    ${wzRow("Avvisi vocali", "Il copilota parla quando succede qualcosa di importante.", wzSwitch("tts", ttsOn, "Avvisi vocali"))}
    ${wzRow("Comandi vocali", `Ascolta il microfono e riconosce i comandi (modalità: ${VOICE_ENGINE.mode === "ptt" ? "push-to-talk, " + esc(VOICE_ENGINE.pttKeyName) : "ascolto continuo"}).`,
      wzSwitch("listen", VOICE_ENGINE.active, "Comandi vocali"))}
    ${wzRow("Voce", "La voce con cui ti parla il copilota.",
      `<select data-wz-voice aria-label="Voce del copilota">${(voiceLang() === "en" ? wzVoicesEn : wzVoices).map(([v, l]) => opt(v, l, cur)).join("")}</select>`)}
    ${wzRow("Microfono", "Quello usato per i comandi vocali dall'app.",
      `<select data-wz-mic aria-label="Microfono">${opt("", "Predefinito di sistema", savedMic)}${mics.map((m, i) =>
        opt(m.deviceId, m.label || `Microfono ${i + 1}`, savedMic)).join("")}</select>`)}
    <div style="display:flex;gap:8px;margin-top:12px;flex-wrap:wrap">
      <button class="small primary" data-wz-test>▶ Prova la voce</button>
      <a class="btn small" href="#voice_commands" data-wz-goto>Altre impostazioni audio</a></div>`;
}

function wzStepKeys() {
  const r = UI.res.bindings;
  if (!r || r.busy) return '<div class="loading">Lettura dei controlli del gioco</div>';
  if (r.error) return `<div class="bad">⚠ ${esc(r.error)}</div>`;
  const b = r.data;
  const missing = b.commands.filter(c => !c.token);
  const fixable = missing.filter(c => c.free_slot && b.files[c.category]?.editable);
  const done = WZ.fix;
  return `<p class="sub">I comandi vocali, le macro e il telefono premono i tasti della <b>tastiera</b> assegnati nei controlli di Elite.
      Un comando assegnato solo alla cloche non si può premere dall'app.</p>
    <div class="sub">Preset in uso: <b>${esc(b.presets?.ship || "—")}</b> · ${num(b.commands.length)} comandi usati dall'app.</div>
    ${missing.length ? `<div class="warnbox" style="margin-top:10px">⚠ <b>${missing.length}</b> comandi non hanno un tasto della tastiera.
      ${fixable.length ? `<div class="sub" style="margin-top:6px">«Aggiungi tasti liberi» assegna un tasto libero solo negli slot vuoti (la cloche resta com'è).
        Prima viene fatta una copia di sicurezza del file dei controlli. Dopo, <b>riavvia il gioco</b> per caricarli.</div>
        <button class="primary" data-wz-fix style="margin-top:8px" ${WZ.busy.fix ? "disabled" : ""}>${WZ.busy.fix ? "Assegno…" : `Aggiungi tasti liberi (${fixable.length})`}</button>`
        : '<div class="sub" style="margin-top:6px">Non ci sono slot liberi da riempire in automatico: assegnali dalle Opzioni del gioco.</div>'}</div>`
      : '<div class="ok" style="margin-top:10px">✓ Tutti i comandi usati dall\'app hanno un tasto della tastiera.</div>'}
    ${done ? (done.error ? `<div class="bad" style="margin-top:8px">⚠ ${esc(done.error)}</div>`
      : `<div class="ok" style="margin-top:8px">✓ Aggiunti ${done.done.length} tasti. Riavvia Elite Dangerous per caricarli.</div>`) : ""}
    <a class="btn small" href="#voice_commands" data-wz-goto style="margin-top:12px">Vedi l'elenco completo</a>`;
}

function wzStepPtt() {
  const st = WZ.ptt;
  const b = st?.binding;
  const learning = WZ.busy.learn;
  return `<p class="sub">Usa un pulsante della cloche o della manetta (o un tasto) per parlare al copilota <b>anche mentre giochi</b>:
      tieni premuto, parla, rilascia. Scegli un pulsante che nel gioco non fa nulla.</p>
    ${!st ? '<div class="loading">Lettura stato push-to-talk</div>' : st.error ? `<div class="bad">⚠ ${esc(st.error)}</div>` : `
    ${wzRow("Pulsante assegnato", b ? `<span class="mono gold">[ ${esc(b.name)} ]</span>` : "Nessuno.",
      learning ? '<span class="tag gold">● PREMI ORA IL PULSANTE… (Esc annulla)</span> <button class="small danger" data-wz-learn-cancel>Annulla</button>'
        : `<button class="small primary" data-wz-learn>● ${b ? "Cambia pulsante" : "Assegna pulsante"}</button>`)}
    ${wzRow("Push-to-talk globale", "Legge il pulsante anche con il gioco in primo piano.", wzSwitch("ptt", !!st.enabled, "Push-to-talk globale"))}`}
    ${WZ.msg.ptt ? `<div class="sub" style="margin-top:8px">${esc(WZ.msg.ptt)}</div>` : ""}
    <a class="btn small" href="#voice_commands" data-wz-goto style="margin-top:12px">Impostazioni Audio (microfono, modalità)</a>`;
}

function wzStepExtras() {
  const ov = S?.overlay || WZ.settings?.overlay || {};
  const lan = S?.lan || {};
  const st = WZ.settings;
  return `<p class="sub">Niente di questo è necessario: attivali quando vuoi.</p>
    ${wzRow("Inara", `Con la tua chiave API personale mostra il tuo profilo e gli obiettivi della comunità.${st?.inara?.configured ? ' <span class="ok">Chiave salvata.</span>' : ""}`,
      '<a class="btn small" href="#settings" data-wz-goto>Imposta</a>')}
    ${wzRow("Overlay sopra il gioco", ov.available === false ? "Disponibile solo nella finestra dell'app, non nel browser."
      : "Finestra trasparente con sistema, prossimo salto e carburante. In Elite usa «Finestra senza bordi».",
      ov.available === false ? "" : wzSwitch("overlay", !!ov.enabled, "Overlay"))}
    ${wzRow("Companion per il telefono", `Il telefono diventa pulsantiera e telecomando, sulla stessa rete Wi-Fi (si collega con un QR).${lan.enabled ? ' <span class="ok">Attivo.</span>' : ""}`,
      '<a class="btn small" href="#settings" data-wz-goto>Apri</a>')}
    ${wzRow("Invio dati", "Invio automatico dei dati di gioco ai servizi che attivi in Impostazioni → Generali → Invio dati.",
      '<a class="btn small" href="#settings" data-wz-goto>Imposta</a>')}
    ${wzRow("Discord", "Mostra sul tuo profilo Discord nave, sistema e attività.", '<a class="btn small" href="#settings" data-wz-goto>Imposta</a>')}
    <div class="sub" style="margin-top:8px">«Imposta» e «Apri» chiudono la guida e aprono Impostazioni → Generali.</div>`;
}

function wzStepEnd() {
  return `<p class="wz-lead">Pronto al decollo, Comandante.</p>
    <ul class="wz-list">
      <li><b>Impostazioni</b>: l'ingranaggio in basso a sinistra, sotto il menu. Da lì puoi rivedere questa guida.</li>
      <li><b>Comandante</b>: panoramica, profilo, missioni, diario e cose da fare.</li>
      <li><b>Nave</b>: flotta, cantiere navale, tute e Fleet Carrier.</li>
      <li><b>Attività</b>: rotte, commercio, estrazione, esplorazione, esobiologia, Powerplay.</li>
      <li><b>Database</b>: materiali, ingegneri, material trader, ricerca stazioni.</li>
      <li>Il pulsante <b>+ da fare</b> accanto ai risultati aggiunge un promemoria; <b>⧉</b> copia il nome del sistema.</li>
    </ul>`;
}

const WZ_RENDER = [wzStepWelcome, wzStepLang, wzStepVoice, wzStepKeys, wzStepPtt, wzStepExtras, wzStepEnd];

// --- Finestra ----------------------------------------------------------------------------------------

function wzRender() {
  if (!WZ.el) return;
  const n = WZ.STEPS.length, i = WZ.step, last = i === n - 1;
  const focusKey = document.activeElement && WZ.el.contains(document.activeElement) ? wzFocusKey(document.activeElement) : null;
  let body;
  try { body = WZ_RENDER[i](); } catch (e) { console.error("[benvenuto]", e); body = `<div class="bad">⚠ ${esc(e.message)}</div>`; }
  WZ.el.innerHTML = `<div class="wz-box panel" role="dialog" aria-modal="true" aria-labelledby="wz-title" aria-describedby="wz-body">
    <div class="hd"><h2 id="wz-title">${esc(WZ.STEPS[i])}</h2><span class="code">PRIMO AVVIO · ${i + 1}/${n}</span>
      <div class="aside"><button class="small ghost wz-x" data-wz-close aria-label="Chiudi la guida">✕</button></div></div>
    <div class="bd"><div id="wz-body" class="wz-body">${body}</div>
      <nav class="wz-dots" aria-label="Passi della guida">${WZ.STEPS.map((s, k) =>
        `<button class="wz-dot ${k === i ? "on" : k < i ? "done" : ""}" data-wz-go="${k}" aria-label="Passo ${k + 1}: ${esc(s)}" ${k === i ? 'aria-current="step"' : ""}></button>`).join("")}</nav>
      <div class="wz-foot">
        <button class="small ghost" data-wz-close>Salta tutto</button>
        <span style="flex:1"></span>
        <button class="small" data-wz-prev ${i ? "" : "disabled"}>◂ Indietro</button>
        <button class="small primary" data-wz-next>${last ? "Inizia" : "Avanti ▸"}</button>
      </div></div></div>`;
  const again = focusKey && [...WZ.el.querySelectorAll("button, select, a[href]")].find(el => wzFocusKey(el) === focusKey);
  (again || WZ.el.querySelector("[data-wz-next]")).focus({ preventScroll: true });
}
function wzFocusKey(el) {
  return [...el.attributes].filter(a => a.name.startsWith("data-wz")).map(a => a.name + "=" + a.value).join("|") || null;
}

function wzLoad(step) {
  if (step === 0 || step === 5) api("/api/settings").then(st => { WZ.settings = st; wzRender(); }).catch(() => {});
  if (step === 2 && navigator.mediaDevices?.enumerateDevices) {
    navigator.mediaDevices.enumerateDevices()
      .then(d => { WZ.mics = d.filter(x => x.kind === "audioinput" && x.deviceId && x.deviceId !== "default"); wzRender(); }).catch(() => {});
  }
  if (step === 3 && !UI.res.bindings?.data) {
    UI.res.bindings = { busy: true };
    api("/api/bindings").then(d => { UI.res.bindings = { data: d }; }).catch(e => { UI.res.bindings = { error: e.message }; }).finally(wzRender);
  }
  if (step === 4) api("/api/ptt/status").then(st => { WZ.ptt = st; UI.ptt = st; wzRender(); }).catch(e => { WZ.ptt = { error: e.message }; wzRender(); });
}

function wzGo(step) {
  WZ.step = Math.max(0, Math.min(WZ.STEPS.length - 1, step));
  wzRender();
  wzLoad(WZ.step);
  WZ.el?.querySelector(".wz-body")?.scrollTo?.(0, 0);
}

function openWelcome(step = 0) {
  if (!WZ.el) {
    WZ.el = document.createElement("div");
    WZ.el.id = "wizard";
    WZ.el.className = "wz-overlay";
    document.body.appendChild(WZ.el);
  }
  WZ.prevFocus = document.activeElement;
  WZ.el.hidden = false;
  document.body.classList.add("wz-open");
  wzGo(step);
}

function closeWelcome() {
  if (!WZ.el || WZ.el.hidden) return;
  if (WZ.busy.learn) api("/api/ptt/learn/cancel", {}).catch(() => {});
  WZ.el.hidden = true;
  WZ.el.innerHTML = "";
  document.body.classList.remove("wz-open");
  localStorage.setItem("welcome-seen", "1");
  api("/api/welcome", { seen: true }).catch(() => {});
  if (WZ.prevFocus?.isConnected) WZ.prevFocus.focus?.();
}

// Primo avvio: aspetta la fine della sequenza di avvio e i primi dati, poi decide.
(function wzAutoStart() {
  const wait = setInterval(async () => {
    if (!S || !STATIC || !$("boot")?.classList.contains("done")) return;
    clearInterval(wait);
    let seen = localStorage.getItem("welcome-seen") === "1";
    try {
      const st = await api("/api/settings");
      WZ.settings = st;
      // Lingua dell'interfaccia: vale quella del server (es. dopo il ripristino di un backup); se cambia, la pagina si ricarica.
      if (st.ui_lang && st.ui_lang !== LANG.lang) return LANG.sync(st.ui_lang);
      seen = !!st.welcome_seen;  // il server decide: sopravvive alla cancellazione della memoria della finestra
      if (seen) localStorage.setItem("welcome-seen", "1");
    } catch { /* server senza risposta: vale localStorage */ }
    // Primo avvio con un sistema non in italiano: l'interfaccia parte in inglese (si cambia al passo "Lingua").
    if (!seen && !localStorage.getItem("ed_ui_lang") && LANG.lang !== "en" && !/^it(-|_|$)/i.test(navigator.language || "it")) {
      sessionStorage.setItem("wz-reopen", "0");
      return setUiLang("en");
    }
    // Dopo un cambio di lingua fatto dalla guida la pagina si ricarica: la guida riparte dal passo in cui eri.
    const reopen = sessionStorage.getItem("wz-reopen");
    sessionStorage.removeItem("wz-reopen");
    if (reopen != null) openWelcome(+reopen || 0);
    else if (!seen) openWelcome(0);
  }, 300);
})();

// --- Azioni ------------------------------------------------------------------------------------------

async function wzLearn() {
  WZ.busy.learn = true; WZ.msg.ptt = ""; wzRender();
  try {
    const r = await api("/api/ptt/learn", {});
    if (r.type) {
      WZ.ptt = r.status || WZ.ptt;
      if (WZ.ptt && !WZ.ptt.enabled) WZ.ptt = await api("/api/ptt/config", { enabled: true });
      WZ.msg.ptt = "Assegnato: " + r.name + ". Push-to-talk globale acceso.";
    } else {
      WZ.msg.ptt = r.error || "Nessun pulsante assegnato.";
      WZ.ptt = await api("/api/ptt/status");
    }
    UI.ptt = WZ.ptt;
  } catch (e) { WZ.msg.ptt = "Errore: " + e.message; }
  WZ.busy.learn = false;
  wzRender();
}

async function wzFix() {
  if (!confirm(LANG.t("Aggiungo un tasto della tastiera libero ai comandi che non ne hanno uno, nel file dei controlli di Elite Dangerous (prima ne faccio una copia). Continuo?"))) return;
  WZ.busy.fix = true; wzRender();
  try {
    WZ.fix = await api("/api/bindings/assign", {});
    UI.res.bindingsFix = { data: WZ.fix };
    UI.res.bindings = { data: await api("/api/bindings") };
  } catch (e) { WZ.fix = { error: e.message }; }
  WZ.busy.fix = false;
  wzRender();
}

async function wzToggle(key) {
  try {
    if (key === "tts") setSetting("tts", SETTINGS.tts === false);
    else if (key === "listen") VOICE_ENGINE.toggle();
    else if (key === "ptt") { WZ.ptt = UI.ptt = await api("/api/ptt/config", { enabled: !WZ.ptt?.enabled }); }
    else if (key === "overlay") {
      const on = !(S?.overlay?.enabled);
      const r = await api("/api/overlay", { enabled: on });
      if (S) S.overlay = { ...(S.overlay || {}), ...(r && typeof r === "object" ? r : { enabled: on }) };
      toast(on ? "Overlay aperto" : "Overlay chiuso");
    }
  } catch (e) { toast("Errore: " + e.message); }
  wzRender();
}

document.addEventListener("click", e => {
  if (e.target.closest("[data-welcome-open]")) return openWelcome(0);
  if (!WZ.el || WZ.el.hidden || !WZ.el.contains(e.target)) return;
  const t = e.target.closest("button, a");
  if (!t) return;
  const d = t.dataset;
  if ("wzClose" in d) closeWelcome();
  else if ("wzNext" in d) WZ.step === WZ.STEPS.length - 1 ? closeWelcome() : wzGo(WZ.step + 1);
  else if ("wzPrev" in d) wzGo(WZ.step - 1);
  else if (d.wzGo) wzGo(+d.wzGo);
  else if ("wzGoto" in d) closeWelcome();  // il link porta alla scheda: la guida si chiude (si riapre da Impostazioni)
  else if (d.wzUiLang) {
    if (d.wzUiLang === LANG.lang) return;
    sessionStorage.setItem("wz-reopen", String(WZ.step));
    setUiLang(d.wzUiLang);
  }
  else if (d.wzLang) {
    delete SETTINGS.langAuto;
    setSetting("lang", d.wzLang);
    if (typeof fillDatalists === "function") fillDatalists();
    renderView();
    wzRender();
  }
  else if ("wzTest" in d) speak(LANG.t("Sistemi di bordo attivi. Copilota vocale operativo. Buona caccia tra le stelle, Comandante."));
  else if (d.wzToggle) wzToggle(d.wzToggle);
  else if ("wzFix" in d) wzFix();
  else if ("wzLearn" in d) wzLearn();
  else if ("wzLearnCancel" in d) api("/api/ptt/learn/cancel", {}).catch(() => {});
});

document.addEventListener("change", e => {
  if (!WZ.el || !WZ.el.contains(e.target)) return;
  const t = e.target;
  if (t.matches("[data-wz-voice]")) {
    setSetting("ttsVoice", t.value);
    if (t.value !== "sapi") api("/api/voice/config", { voice: t.value }).catch(() => {});  // stessa voce per gli avvisi del server
    speak(LANG.t("Voce selezionata."));
  } else if (t.matches("[data-wz-mic]")) {
    localStorage.setItem("ed_mic_device", t.value);
    toast("Microfono aggiornato");
    if (VOICE_ENGINE.active) { VOICE_ENGINE.stop(); setTimeout(() => VOICE_ENGINE.start(), 200); }
  }
});

// Tastiera: Esc chiude (e segna la guida come vista), Tab resta dentro la finestra.
document.addEventListener("keydown", e => {
  if (!WZ.el || WZ.el.hidden) return;
  if (e.key === "Escape") {
    e.preventDefault();
    if (WZ.busy.learn) api("/api/ptt/learn/cancel", {}).catch(() => {});
    else closeWelcome();
    return;
  }
  if (e.key !== "Tab") return;
  const items = [...WZ.el.querySelectorAll("button:not([disabled]), select, a[href], input, [tabindex]:not([tabindex='-1'])")]
    .filter(el => el.offsetParent !== null);
  if (!items.length) return;
  const first = items[0], last = items[items.length - 1];
  if (!WZ.el.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
  else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}, true);
