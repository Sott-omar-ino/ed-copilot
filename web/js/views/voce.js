"use strict";

// ============================================================================

// Tasti letti dai controlli del gioco: i comandi della nave premono questi, non quelli di fabbrica.
function gameKeysPanel() {
  if (!UI.res.bindings) run("bindings", () => api("/api/bindings"));
  return panel("Tasti del gioco", result("bindings", b => {
    const missing = b.commands.filter(c => !c.token);
    const fixable = missing.filter(c => c.free_slot && b.files[c.category]?.editable);
    const done = UI.res.bindingsFix?.data;
    return `<p class="sub">Preset in uso: generali <b>${esc(b.presets.general)}</b>, nave <b>${esc(b.presets.ship)}</b>.
      I comandi vocali, le macro e il telefono premono i tasti della <b>tastiera</b> assegnati qui sotto.
      Un comando assegnato solo alla cloche non si può premere dall'app.</p>
      ${missing.length ? `<div class="warnbox">⚠ ${missing.length} comandi non hanno un tasto della tastiera: dall'app non funzioneranno.
        ${fixable.length ? `<div style="margin-top:8px"><button class="primary" data-binds-fix>Aggiungi tasti liberi (${fixable.length})</button>
        <span class="sub"> Usa solo gli slot vuoti: la cloche resta com'è. Prima viene fatta una copia del file. Poi riavvia il gioco.</span></div>` : ""}</div>` : '<div class="ok">✓ Tutti i comandi usati dall\'app hanno un tasto della tastiera.</div>'}
      ${done ? `<div class="ok" style="margin-top:8px">✓ Aggiunti ${done.done.length} tasti${done.done.length ? ": " + done.done.map(d => `${esc(d.label)} = <b>${esc(d.key)}</b>`).join(", ") : ""}. Riavvia Elite Dangerous per caricarli.
        ${done.skipped.length ? `<div class="bad">Non modificati: ${done.skipped.map(s => `${esc(s.label)} (${esc(s.reason)})`).join(", ")}</div>` : ""}</div>` : ""}
      <table style="margin-top:10px"><thead><tr><th>Comando</th><th>Tastiera</th><th>Altri dispositivi</th></tr></thead><tbody>
      ${b.commands.map(c => `<tr><td>${esc(c.label)}<div class="sub mono">${esc(c.name)}</div></td>
        <td>${c.token ? `<b class="mono gold">${esc(c.keyboard || c.token)}</b>` : '<span class="bad">nessun tasto</span>'}</td>
        <td class="sub">${esc(c.other.join(", ")) || "—"}</td></tr>`).join("")}
      </tbody></table>
      <div class="sub" style="margin-top:6px">File: ${esc(b.files.ship.path || "non trovato")} <button class="small ghost" data-binds-reload>Rileggi</button></div>`;
  }, "Lettura dei controlli del gioco…"), { code: "BINDINGS", aside: UI.res.bindings?.data ? `${UI.res.bindings.data.missing_keyboard.length} senza tastiera` : "" });
}
document.addEventListener("click", e => {
  if (e.target.closest("[data-binds-reload]")) run("bindings", () => api("/api/bindings"));
  if (e.target.closest("[data-binds-fix]")) {
    if (!confirm(LANG.t("Aggiungo un tasto della tastiera libero ai comandi che non ne hanno uno, nel file dei controlli di Elite Dangerous (prima ne faccio una copia). Continuo?"))) return;
    run("bindingsFix", async () => { const r = await api("/api/bindings/assign", {}); await run("bindings", () => api("/api/bindings")); return r; });
  }
});

// ============================================================================
// AUDIO: voce del copilota (voci, effetti, velocità e tono) e filtro rumori del microfono
// Le impostazioni stanno nel server (voice_config.json, /api/voice/config): valgono per la voce che parte
// dall'interfaccia (tts.js, WebAudio) e per quella che parte dal PC (app/voice.py, avvisi e risposte ai comandi).
// ============================================================================
const TTS_SAMPLE = "Sistemi di bordo attivi. Copilota vocale operativo, comandante.";
const GENDER_IT = { Female: "femminile", Male: "maschile" };

function vcfg() { return S?.voice_config || {}; }

// Salva una o più impostazioni vocali sul server e le applica subito anche qui.
async function saveVoiceCfg(changes) {
  if (S?.voice_config) Object.assign(S.voice_config, changes);
  try {
    const cfg = await api("/api/voice/config", changes);
    if (S) S.voice_config = cfg;
  } catch (e) { toast("Impostazione non salvata: " + e.message); }
}

function ttsVoiceLabel(v) {
  const g = GENDER_IT[v.gender] ? ` · ${LANG.t(GENDER_IT[v.gender])}` : "";
  const loc = v.group === "Multilingue" || v.group === "Inglesi" ? ` · ${v.locale}` : "";
  return `${v.name}${g}${loc}`;
}

// Cursore che non viene ricreato dal ridisegno ogni 2 s (data-keep): si può trascinare senza interruzioni.
function vcSlider(id, min, max, step, value) {
  return `<span id="${id}-wrap" data-keep style="display:block"><input type="range" id="${id}" class="hud-slider" min="${min}" max="${max}" step="${step}" value="${value}"></span>`;
}

function ttsVoicePanel() {
  if (!UI.res.ttsVoices) run("ttsVoices", () => api("/api/voice/voices"));
  if (!UI.res.ttsFx) run("ttsFx", () => api("/api/voice/fx"));
  const cfg = vcfg();
  const cur = ttsVoiceKey();  // tts.js: la voce scelta, se sa parlare la lingua dell'interfaccia
  const legacy = { elsa: "it-IT-ElsaNeural", diego: "it-IT-DiegoNeural", isabella: "it-IT-IsabellaNeural", giuseppe: "it-IT-GiuseppeNeural" };
  const curId = legacy[cur] || cur;
  const data = UI.res.ttsVoices?.data;
  const voices = data?.voices || [];
  const groups = voiceLang() === "en"  // app/voice.py: in inglese l'elenco ha voci inglesi (en-GB/en-US) e multilingue
    ? [["Inglesi", "English voices"], ["Multilingue", "Multilingual"]]
    : [["Italiane", "Voci italiane"], ["Multilingue", "Multilingue (parlano anche italiano)"]];
  const known = voices.some(v => v.id === curId) || cur === "sapi";
  const options = !data ? `<option value="${esc(cur)}" selected>${esc(cur)}</option>`
    : groups.map(([g, label]) => {
        const list = voices.filter(v => v.group === g);
        return list.length ? `<optgroup label="${esc(LANG.t(label))}">${list.map(v => `<option value="${esc(v.id)}" ${v.id === curId ? "selected" : ""}>${esc(ttsVoiceLabel(v))}</option>`).join("")}</optgroup>` : "";
      }).join("") + (known ? "" : `<option value="${esc(cur)}" selected>${esc(cur)} (attuale)</option>`)
      + `<optgroup label="${esc(LANG.t("Senza internet"))}"><option value="sapi" ${cur === "sapi" ? "selected" : ""}>Sintetizzatore di Windows (offline, senza effetti)</option></optgroup>`;
  const presets = UI.res.ttsFx?.data?.presets || [];
  const eff = cfg.tts_effect || "naturale";
  const effDesc = presets.find(p => p.id === eff)?.desc || "";
  const amount = cfg.tts_fx_amount ?? 70, rate = cfg.tts_rate ?? 0, pitch = cfg.tts_pitch ?? 0;
  const vol = SETTINGS.ttsVolume != null ? SETTINGS.ttsVolume : 100;
  return `<div style="background:rgba(0,0,0,0.4);border:1px solid rgba(255,138,31,0.22);padding:14px;display:flex;flex-direction:column;gap:10px">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <label style="font-size:12px;font-weight:bold;color:var(--gold);margin:0">Volume</label>
      <div style="display:flex;align-items:center;gap:10px">
        <span id="tts-vol-val" class="mono gold" style="font-size:14px;font-weight:bold">${vol}%</span>
        <button class="small primary" id="tts-test-vol" style="height:26px;padding:0 10px">&#x25b6; Prova volume</button>
      </div>
    </div>
    ${vcSlider("tts-volume", 0, 100, 1, vol)}

    <label style="font-size:11px">Voce
      <div style="display:flex;gap:6px;margin-top:3px">
        <select id="tts-voice-sel" style="flex:1;height:32px;background:#110800;border:1px solid var(--accent);color:var(--gold)">${options}</select>
        <button class="small" data-tts-try="voice" style="height:32px">&#x25b6; Prova</button>
      </div>
    </label>
    <div class="sub" style="font-size:11px">${!data ? "Lettura dell'elenco delle voci…" : data.source === "offline" ? "Elenco completo non disponibile senza internet: ci sono solo le voci di base." : `${voices.length} voci neurali che parlano italiano (servono internet).`}</div>

    <label style="font-size:11px">Effetto sulla voce
      <div style="display:flex;gap:6px;margin-top:3px">
        <select id="tts-effect-sel" style="flex:1;height:32px;background:#110800;border:1px solid var(--accent);color:var(--gold)">
          ${(presets.length ? presets : [{ id: "naturale", label: "Naturale" }]).map(p => `<option value="${esc(p.id)}" ${p.id === eff ? "selected" : ""}>${esc(p.label)}</option>`).join("")}
        </select>
        <button class="small" data-tts-try="effect" style="height:32px">&#x25b6; Prova</button>
      </div>
    </label>
    <div class="sub" style="font-size:11px">${esc(effDesc)}${UI.res.ttsFx?.data && !UI.res.ttsFx.data.available ? " Gli avvisi che partono dal PC restano senza effetto (manca una libreria audio)." : ""}</div>

    <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:10px">
      <label style="font-size:11px">Intensità effetto <span id="tts-fx-amount-val" class="mono gold">${amount}%</span>${vcSlider("tts-fx-amount", 0, 100, 5, amount)}</label>
      <label style="font-size:11px">Velocità <span id="tts-rate-val" class="mono gold">${rate > 0 ? "+" : ""}${rate}%</span>${vcSlider("tts-rate-sl", -50, 50, 5, rate)}</label>
      <label style="font-size:11px">Tono <span id="tts-pitch-val" class="mono gold">${pitch > 0 ? "+" : ""}${pitch} Hz</span>${vcSlider("tts-pitch-sl", -30, 30, 1, pitch)}</label>
    </div>
    <div class="sub" style="font-size:11px">Valgono per gli avvisi, il briefing e le risposte ai comandi vocali. Velocità e tono cambiano la sintesi (non sono un effetto).</div>
    <div><button class="small ghost" data-tts-try="pc">&#x25b6; Prova dalle casse del PC</button>
      <span class="sub" style="font-size:11px"> come gli avvisi che partono dall'app anche quando la finestra è nascosta</span></div>

    <div style="margin-top:4px">
      <div class="eyebrow" style="font-size:10px;margin-bottom:6px">Campioni avvisi di bordo</div>
      <div style="display:flex;gap:6px;flex-wrap:wrap">
        <button class="small" data-tts-sample="Attenzione: stella di destinazione non scupabile.">&#x25b6; Stella non scupabile</button>
        <button class="small" data-tts-sample="Pianeta di classe terrestre confermato nel sistema.">&#x25b6; Pianeta terrestre</button>
        <button class="small" data-tts-sample="Distanza minima colonia raggiunta: puoi campionare.">&#x25b6; Esobiologia</button>
        <button class="small" data-tts-sample="Attenzione: integrità FSD sotto l'80 per cento.">&#x25b6; Danno FSD</button>
        <button class="small" data-tts-sample="Attenzione: riserva di carburante inferiore al 25 per cento.">&#x25b6; Carburante basso</button>
      </div>
    </div>
  </div>`;
}

function noiseFilterPanel() {
  const st = vcfg().noise_filter ?? 50;
  const cal = NOISE_FILTER.calibratedFloor();
  const pttFloor = UI.ptt?.noise_floor_db;
  if (!UI.res.voiceNoise || Date.now() - UI.res.voiceNoise.t > 4000) run("voiceNoise", () => api("/api/voice/noise"));
  const last = UI.res.voiceNoise?.data?.last;
  const src = { app: "microfono dell'app", ptt: "push-to-talk", phone: "telefono" };
  const lastTxt = last && last.ts ? `Ultima registrazione (${src[last.source] || last.source}, ${ago(last.ts)}): ${
    last.speech ? `voce tenuta (${(last.kept_ms / 1000).toFixed(1)} s)` : "nessuna voce, non inviata al riconoscimento"}${
    last.dropped ? `, tagliati ${last.dropped} rumori` : ""}.` : "Nessuna registrazione analizzata dall'avvio.";
  const calRes = UI.nfCal;
  return `<div style="background:rgba(0,0,0,0.3);padding:10px 12px;border:1px solid rgba(255,138,31,0.18);display:flex;flex-direction:column;gap:8px">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <label style="font-size:12px;font-weight:bold;color:var(--gold);margin:0">Filtro rumori</label>
      <span id="nf-strength-val" class="mono gold" style="font-size:13px;font-weight:bold">${st}%</span>
    </div>
    ${vcSlider("nf-strength", 0, 100, 5, st)}
    <div id="nf-desc" class="sub" style="font-size:11px">${esc(NOISE_FILTER.describe(st))}</div>
    <div class="sub" style="font-size:11px">Basso: passa quasi tutto. Alto: taglia anche suoni lunghi se non sono voce, ma devi parlare più forte.
      Vale per il microfono dell'app, il push-to-talk dalla cloche e il telefono.</div>

    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:4px">
      <span style="font-size:11px;font-weight:bold;color:var(--gold)">Livello dal vivo</span>
      <span class="mono" style="font-size:12px"><span id="settings-meter-pct">—</span> · <span id="nf-thr-val" class="gold">soglia —</span></span>
    </div>
    <div class="nf-meter"><div id="settings-meter-fill" class="nf-meter-fill" style="width:0%"></div><div id="settings-meter-thr" class="nf-meter-thr" style="left:0%"></div></div>
    <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
      <span class="sub" style="font-size:11px">${VOICE_ENGINE.active ? `Tacca = soglia. Rumori tagliati: <b id="nf-cut-count" class="mono">${VOICE_ENGINE.nf?.cut || 0}</b>` : "Attiva il copilota vocale per vedere il livello del microfono."}</span>
      <span id="settings-mic-badge" class="tag ${VOICE_ENGINE.active ? "ok" : "sub"}" style="font-size:10px">${VOICE_ENGINE.active ? "IN ASCOLTO" : "MIC SPENTO"}</span>
    </div>

    <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:4px">
      <button class="small primary" data-nf-calibrate ${UI.nfCalibrating ? "disabled" : ""}>${UI.nfCalibrating ? "Misuro… resta in silenzio" : "Calibra rumore di fondo"}</button>
      <span class="sub" style="font-size:11px">2 secondi in silenzio, con ventole e gioco accesi come al solito.</span>
    </div>
    <div class="sub" style="font-size:11px">Fondo misurato: microfono dell'app <b class="mono">${cal != null ? cal + " dB" : "non calibrato (stimato dal vivo)"}</b>${
      UI.ptt?.enabled ? ` · push-to-talk <b class="mono">${pttFloor != null ? pttFloor + " dB" : "non calibrato"}</b>` : ""}</div>
    ${calRes?.error ? `<div class="bad" style="font-size:11px">${esc(calRes.error)}</div>` : ""}
    <div class="sub" style="font-size:11px">${esc(lastTxt)}</div>
  </div>`;
}

// Elenco dei comandi vocali già pronti (quelli del motore in voice-engine.js, oltre a controlli e macro qui sotto).
function voiceCommandsHelp() {
  const rows = voiceLang() === "en" ? voiceCommandsHelpEn() : [  // inglese: generato dalla grammatica (voice-engine.js)
    ["Cose da fare", "“aggiungi da fare …”, “ricordami di …”, “promemoria …”, “nuovo da fare …”"],
    ["", "“cosa devo fare”, “leggi le cose da fare”"],
    ["", "“segna fatto …” o “completa …” (anche col numero: “segna fatto il 2”)"],
    ["Rapporti", "“rapporto nave”, “carburante”, “stato stiva”, “danni”, “prossimo salto”, “esobiologia”, “consigli”"],
    ["Rotta", "“copia destinazione”"],
    ["Nave", "“abbassa carrello”, “apri stiva”, “accendi luci”, “estrai armi”, “mappa galattica”… (vedi Controlli di bordo)"],
  ];
  return `<div class="eyebrow" style="font-size:10px;color:var(--gold);margin-top:6px">&#x25c6; COSA PUOI DIRE</div>
    <table style="font-size:11px"><tbody>${rows.map(([a, b]) => `<tr><td class="gold" style="white-space:nowrap;vertical-align:top">${esc(a)}</td><td>${esc(b)}</td></tr>`).join("")}</tbody></table>`;
}

document.addEventListener("input", e => {
  const t = e.target, val = () => parseInt(t.value, 10);
  if (t.id === "tts-fx-amount") setText("tts-fx-amount-val", `${val()}%`);
  else if (t.id === "tts-rate-sl") setText("tts-rate-val", `${val() > 0 ? "+" : ""}${val()}%`);
  else if (t.id === "tts-pitch-sl") setText("tts-pitch-val", `${val() > 0 ? "+" : ""}${val()} Hz`);
  else if (t.id === "nf-strength") { setText("nf-strength-val", `${val()}%`); setText("nf-desc", NOISE_FILTER.describe(val())); }
  else return;
  updateHudSliderFill(t);
});
document.addEventListener("change", e => {
  const t = e.target, val = parseInt(t.value, 10);
  if (t.id === "tts-voice-sel") {
    setSetting("ttsVoice", t.value);
    if (t.value !== "sapi") saveVoiceCfg({ voice: t.value });  // stessa voce per gli avvisi che partono dal PC
    speak(LANG.t("Voce selezionata."), { force: true });
  } else if (t.id === "tts-effect-sel") { saveVoiceCfg({ tts_effect: t.value }).then(() => renderView()); }
  else if (t.id === "tts-fx-amount") saveVoiceCfg({ tts_fx_amount: val });
  else if (t.id === "tts-rate-sl") saveVoiceCfg({ tts_rate: val });
  else if (t.id === "tts-pitch-sl") saveVoiceCfg({ tts_pitch: val });
  else if (t.id === "nf-strength") saveVoiceCfg({ noise_filter: val });
  else if (t.id === "tts-volume") saveVoiceCfg({ volume: val });  // anche per gli avvisi che partono dal PC
});
document.addEventListener("click", async e => {
  const tryBtn = e.target.closest("[data-tts-try]");
  if (tryBtn) {
    const kind = tryBtn.dataset.ttsTry;
    const voice = $("tts-voice-sel")?.value || ttsVoiceKey();
    if (kind === "pc") {
      api("/api/voice/test?voice=" + encodeURIComponent(voice === "sapi" ? "" : voice) + "&volume=" + (SETTINGS.ttsVolume ?? 100))
        .then(() => toast("Prova dalle casse del PC")).catch(err => toast("Prova non riuscita: " + err.message));
    } else {
      speak(LANG.t(TTS_SAMPLE), { voice, force: true });
    }
    return;
  }
  if (e.target.closest("[data-nf-calibrate]")) {
    if (UI.nfCalibrating) return;
    UI.nfCalibrating = true; UI.nfCal = null; renderView();
    const errors = [];
    const jobs = [VOICE_ENGINE.calibrateNoise(2).catch(err => errors.push("Microfono dell'app: " + err.message))];
    if (UI.ptt?.enabled) jobs.push(api("/api/ptt/calibrate", {}).then(r => {
      if (r.error) errors.push("Push-to-talk: " + r.error); else if (r.status) UI.ptt = r.status;
    }).catch(err => errors.push("Push-to-talk: " + err.message)));
    await Promise.all(jobs);
    UI.nfCalibrating = false;
    UI.nfCal = errors.length ? { error: errors.join(" · ") } : { ok: true };
    toast(errors.length ? "Calibrazione non completa" : "Rumore di fondo misurato");
    renderView();
  }
});

VIEWS.voice_commands = () => {
  // Le stesse chiavi che usa il motore vocale (voice-engine.js) e che salvano i controlli (events.js).
  const noiseSupp = localStorage.getItem("ed_mic_noise_supp") !== "false";
  const echoCancel = localStorage.getItem("ed_mic_echo_cancel") !== "false";
  const autoGain = localStorage.getItem("ed_mic_auto_gain") !== "false";
  const activeTab = UI.activeVoiceTab || "controls";

  return `<div style="display:flex;flex-direction:column;gap:18px">

    <!-- 1. HEADER DI STATO COPILOTA VOCALE -->
    <div style="background:rgba(20,8,0,0.65);border:1.5px solid var(--accent);padding:14px 18px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;border-radius:2px;box-shadow:0 0 16px rgba(255,138,31,0.15)">
      <div>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <b class="gold" style="font-size:16px;letter-spacing:0.06em">&#x25c6; SISTEMA VOCALE INTEGRATO // COPILOTA &amp; CONTROLLI NAVE</b>
          <span id="voice-status-pill-settings" class="tag ${VOICE_ENGINE.active ? "ok" : "sub"}" style="font-size:11px">
            ${VOICE_ENGINE.active ? "ATTIVO // IN ASCOLTO" : "DISATTIVATO"}
          </span>
          <span class="tag gold" style="font-size:11px">MODALITÀ: ${VOICE_ENGINE.mode === "ptt" ? `PUSH-TO-TALK (${esc(VOICE_ENGINE.pttKeyName)})` : "CONTINUA"}</span>
        </div>
        <div style="font-size:12px;color:var(--text-2);margin-top:4px;max-width:760px">
          Riconoscimento vocale integrato. Ascolta continuamente in cabina o tramite Push-to-Talk, controlla la nave a livello hardware (DirectInput) e risponde con sintesi vocale neurale in tempo reale.
        </div>
      </div>
      <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <button id="btn-voice-toggle-settings" class="${VOICE_ENGINE.active ? "danger" : "primary"}" style="height:38px;padding:0 20px;font-size:13px;display:inline-flex;align-items:center;gap:8px">
          ${VOICE_ENGINE.active ? "&#x2715; Disattiva Copilota Vocale" : "&#x25b6; Attiva Copilota Vocale"}
        </button>
      </div>
    </div>

    ${gameKeysPanel()}

    ${typeof pttPanel === "function" ? pttPanel() : ""}

    <!-- 2. SEZIONE PUSH-TO-TALK & MODALITÀ ASCOLTO -->
    <div style="background:rgba(20,8,0,0.6);border:1px solid rgba(255,138,31,0.35);padding:14px 18px;border-radius:2px">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px">
        <div class="eyebrow" style="color:var(--gold);font-size:12px;margin:0">&#x25c6; MODALITÀ ATTIVAZIONE MICROFONO &amp; PUSH-TO-TALK</div>
        <div id="ptt-transmission-indicator" class="tag" style="font-size:11px;background:#110800;border:1px solid ${VOICE_ENGINE.pttActive ? "#00e676" : "rgba(255,138,31,0.3)"};color:${VOICE_ENGINE.pttActive ? "#00e676" : "var(--text-3)"}">
          ${VOICE_ENGINE.pttActive ? "&#x25cf; TRASMISSIONE VOCALE IN CORSO" : "&#x25cf; IN ATTESA DI INPUT VOCALE"}
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(280px, 1fr));gap:14px;align-items:center">
        <!-- Scelta Modalita Ascolto -->
        <div style="display:flex;gap:8px">
          <button class="seg-btn ${VOICE_ENGINE.mode !== "ptt" ? "primary" : ""}" id="btn-mode-continuous" style="flex:1;padding:10px 8px;font-size:12px;text-align:center;border-radius:2px">
            &#x25cf; SEMPRE ATTIVO<br><span style="font-size:10px;font-weight:normal;opacity:0.85">Ascolto continuo automatico</span>
          </button>
          <button class="seg-btn ${VOICE_ENGINE.mode === "ptt" ? "primary" : ""}" id="btn-mode-ptt" style="flex:1;padding:10px 8px;font-size:12px;text-align:center;border-radius:2px">
            &#x25cf; PUSH-TO-TALK<br><span style="font-size:10px;font-weight:normal;opacity:0.85">Attiva con tasto dedicato</span>
          </button>
        </div>

        <!-- Tasto PTT configurato -->
        <div style="background:rgba(0,0,0,0.45);border:1px solid rgba(255,138,31,0.25);padding:10px 14px;display:flex;align-items:center;justify-content:space-between;gap:10px">
          <div>
            <div style="font-size:11px;color:var(--text-3);text-transform:uppercase;letter-spacing:0.06em">Tasto Push-to-Talk Assegnato</div>
            <div id="ptt-key-display" class="mono gold" style="font-size:15px;font-weight:bold;margin-top:2px">
              [ ${esc(VOICE_ENGINE.pttKeyName || "SPAZIO (Space)")} ]
            </div>
          </div>
          <button class="small" id="btn-record-ptt-key" style="height:34px;border:1px solid var(--accent);background:#1a0a00;color:var(--gold);font-weight:bold;padding:0 12px">
            &#x25cf; IMPOSTA TASTO PTT
          </button>
        </div>

        <!-- Comportamento PTT -->
        <div style="background:rgba(0,0,0,0.45);border:1px solid rgba(255,138,31,0.25);padding:10px 14px;display:flex;flex-direction:column;gap:4px">
          <label style="font-size:11px;font-weight:bold;color:var(--gold);margin:0">Comportamento Pressione Tasto PTT
            <select id="ptt-behavior-select" style="width:100%;height:32px;margin-top:4px;background:#110800;border:1px solid var(--accent);color:var(--gold)">
              <option value="hold" ${VOICE_ENGINE.pttBehavior !== "toggle" ? "selected" : ""}>Tieni premuto per parlare (Hold)</option>
              <option value="toggle" ${VOICE_ENGINE.pttBehavior === "toggle" ? "selected" : ""}>Premi per attivare / disattivare (Toggle)</option>
            </select>
          </label>
        </div>
      </div>
    </div>

    <!-- 3. VOCE DEL COPILOTA + CRONOLOGIA -->
    <div style="background:rgba(20,8,0,0.65);border:1px solid rgba(255,138,31,0.3);padding:16px 18px;border-radius:2px">
      <div class="eyebrow" style="margin-bottom:12px;color:var(--gold);font-size:12px">&#x25c6; VOCE DEL COPILOTA</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(320px, 1fr));gap:20px;align-items:start">
        ${ttsVoicePanel()}
        <div style="background:rgba(0,0,0,0.4);border:1px solid rgba(255,138,31,0.22);padding:14px;display:flex;flex-direction:column;gap:10px">
          <div class="eyebrow" style="font-size:10px;color:var(--gold)">&#x25c6; ULTIMI COMANDI RICONOSCIUTI</div>
          <div id="voice-history-list" style="background:#0c0500;padding:8px 12px;border:1px solid rgba(255,138,31,0.2);min-height:92px;max-height:160px;overflow-y:auto">
            ${VOICE_ENGINE.renderHistory()}
          </div>
          ${voiceCommandsHelp()}
        </div>
      </div>
    </div>

    <!-- 4. MICROFONO E FILTRO RUMORI -->
    <div style="background:rgba(20,8,0,0.5);border:1px solid rgba(255,138,31,0.28);padding:16px 18px">
      <div class="eyebrow" style="color:var(--gold);margin-bottom:12px;font-size:12px">&#x25c6; MICROFONO E FILTRO RUMORI</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(300px, 1fr));gap:16px;align-items:start">
        <div style="display:flex;flex-direction:column;gap:10px">
          <label style="font-size:11px;font-weight:bold;color:var(--gold)">Microfono dell'app
            <select id="mic-device-select" style="width:100%;height:34px;margin-top:4px;background:#110800;border:1px solid var(--accent);color:var(--gold)">
              <option value="">Microfono predefinito di sistema</option>
            </select>
          </label>
          <div class="sub" style="font-size:11px">Il push-to-talk dalla cloche usa il microfono scelto nel suo pannello.</div>
          <div style="display:flex;flex-direction:column;gap:8px;background:rgba(0,0,0,0.3);padding:10px 12px;border:1px solid rgba(255,138,31,0.18)">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px">
              <input type="checkbox" id="mic-noise-suppression" ${noiseSupp ? "checked" : ""}>
              <span><b>Riduzione rumore del browser:</b> solo acceso/spento, attenua fruscii continui (ventole). Non toglie i clic.</span>
            </label>
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px">
              <input type="checkbox" id="mic-echo-cancellation" ${echoCancel ? "checked" : ""}>
              <span><b>Cancellazione dell'eco:</b> evita che la voce delle casse rientri nel microfono</span>
            </label>
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:12px">
              <input type="checkbox" id="mic-auto-gain" ${autoGain ? "checked" : ""}>
              <span><b>Guadagno automatico:</b> tiene costante il volume della voce</span>
            </label>
          </div>
        </div>
        ${noiseFilterPanel()}
      </div>
    </div>

    <!-- PANNELLO 1: CONTROLLI DI BORDO DELLA NAVE -->
    
      <div id="controls-panel" style="background:rgba(255,138,31,0.06);border:1.5px solid var(--accent);padding:18px;border-radius:2px;box-shadow:0 0 16px rgba(255,138,31,0.12)">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid rgba(255,138,31,0.25)">
          <div>
            <div class="gold" style="font-size:16px;font-weight:700;letter-spacing:0.06em">&#x25c6; CONTROLLI DI BORDO DELLA NAVE (TASTI + VOCE NEURALE)</div>
            <div class="sub" style="font-size:12px;margin-top:3px">Aziona comandi singoli di bordo (carrello, fari, stiva, armi, fsd, pips, visione notturna) con voce o tasti hardware.</div>
          </div>
          <button class="primary" id="control-new-toggle" style="height:36px;padding:0 18px;display:inline-flex;align-items:center;gap:8px;font-size:13px">
            + Crea Nuovo Controllo di Bordo
          </button>
        </div>

        ${(UI.showControlForm || UI.editingControl) ? `
          <div style="background:rgba(10,5,1,0.95);border:2px solid var(--gold);padding:16px;margin-bottom:18px;box-shadow:0 0 20px rgba(255,138,31,0.25)">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid rgba(255,138,31,0.3)">
              <b class="gold" style="font-size:14px;letter-spacing:0.05em">
                ${UI.editingControl ? `&#x270e; MODIFICA CONTROLLO DI BORDO: ${esc(UI.editingControl.name)}` : "&#x25c6; CREA NUOVO CONTROLLO DI BORDO"}
              </b>
              <button class="small ghost" id="control-form-cancel" style="padding:3px 10px;font-size:12px">&#x2715; Chiudi</button>
            </div>
            <div style="display:flex;flex-direction:column;gap:12px">
              <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(280px, 1fr));gap:12px">
                <label style="font-size:11px">Nome del Controllo
                  <input type="text" id="ctrl-input-name" value="${esc(UI.editingControl?.name || "")}" placeholder="es. Iniezione Postbruciatore Boost" style="width:100%;height:34px;margin-top:3px">
                </label>
                <label style="font-size:11px">Cosa dire a voce (separa alternative con punto e virgola <code>;</code>)
                  <input type="text" id="ctrl-input-say" value="${esc(UI.editingControl?.say || "")}" placeholder="es. boost; motori al massimo; accelera" style="width:100%;height:34px;margin-top:3px">
                </label>
              </div>

              <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(280px, 1fr));gap:12px;align-items:center">
                <label style="font-size:11px">Tasto Fisico DirectInput della Nave
                  <div style="display:flex;gap:8px;margin-top:3px">
                    <input type="text" id="ctrl-input-key" value="${esc(UI.editingControl?.key || "SPACE")}" readonly style="flex:1;height:34px;font-family:var(--mono);font-weight:bold;color:var(--gold);background:#110800">
                    <button type="button" class="small primary" id="ctrl-record-key-btn" style="height:34px;padding:0 12px;white-space:nowrap">
                      &#x25cf; Premi Tasto da Tastiera
                    </button>
                  </div>
                </label>
                <label style="font-size:11px">Risposta Vocale Neurale del Copilota
                  <input type="text" id="ctrl-input-voice" value="${esc(UI.editingControl?.voice || "")}" placeholder="es. Propulsori ausiliari azionati, Comandante." style="width:100%;height:34px;margin-top:3px">
                </label>
              </div>

              <label style="font-size:11px">Descrizione Funzione (opzionale)
                <input type="text" id="ctrl-input-desc" value="${esc(UI.editingControl?.desc || "")}" placeholder="es. Inietta energia per accelerare al massimo con i propulsori di manovra" style="width:100%;height:34px;margin-top:3px">
              </label>

              <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,138,31,0.2)">
                <button type="button" class="small" id="ctrl-form-test">&#x25b6; Prova Tasto &amp; Voce</button>
                <div style="display:flex;gap:8px">
                  <button type="button" class="small ghost" id="ctrl-form-cancel">Annulla</button>
                  <button type="button" class="small primary" id="ctrl-form-save">
                    ${UI.editingControl ? "&#x25c6; Aggiorna Controllo" : "&#x25c6; Salva Controllo"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ` : ""}

        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(360px, 1fr));gap:12px">
          ${CONTROLS.map(c => `
            <div class="todo-item" style="flex-direction:column;align-items:stretch;gap:8px;padding:12px 14px;background:rgba(20,8,0,0.6);border:1px solid rgba(255,138,31,0.25);border-radius:2px">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
                <div>
                  <div style="display:flex;align-items:center;gap:8px">
                    <b class="gold" style="font-size:15px">&#x25c6; ${esc(c.name)}</b>
                    <span class="tag gold" style="font-size:12px;font-family:var(--mono);padding:2px 8px">[ ${esc(c.key)} ]</span>
                  </div>
                  <div style="margin-top:4px;font-size:12px;color:var(--hud-hi)"><b>Cosa dire:</b> <code>${esc(c.say)}</code></div>
                </div>
                <div style="display:flex;gap:4px;flex-shrink:0">
                  <button class="small" data-control-test="${esc(c.id)}" title="Simula tasto DirectInput e voce neurale">&#x25b6; Prova</button>
                  <button class="small primary" data-control-edit="${esc(c.id)}" title="Modifica questo controllo">&#x270e; Modifica</button>
                  ${!c.builtIn ? `<button class="small ghost" data-control-del="${esc(c.id)}" title="Elimina questo controllo">&#x2715;</button>` : ""}
                </div>
              </div>
              ${c.voice ? `<div class="sub" style="font-size:12px"><b>Voce copilota:</b> "${esc(c.voice)}"</div>` : ""}
              ${c.desc ? `<div class="sub" style="font-size:11px;color:var(--text-3)">${esc(c.desc)}</div>` : ""}
            </div>
          `).join("")}
        </div>
      </div>

    <!-- PANNELLO 2: TELEMETRIA COPILOTA & AVVISI AUTOMATICI -->
    
      <div id="telemetry-panel" style="background:rgba(255,138,31,0.06);border:1.5px solid var(--accent);padding:18px;border-radius:2px;box-shadow:0 0 16px rgba(255,138,31,0.12)">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid rgba(255,138,31,0.25)">
          <div>
            <div class="gold" style="font-size:16px;font-weight:700;letter-spacing:0.06em">&#x25c6; TELEMETRIA COPILOTA &amp; AVVISI AUTOMATICI DI BORDO</div>
            <div class="sub" style="font-size:12px;margin-top:3px">Allarmi intelligenti e avvisi vocali automatici scatenati in tempo reale dai sensori della nave (carburante, calore, scudi, scafo, fsd, pianeti, esobiologia).</div>
          </div>
          <button class="primary" id="telemetry-new-toggle" style="height:36px;padding:0 18px;display:inline-flex;align-items:center;gap:8px;font-size:13px">
            + Crea Nuova Regola Telemetria
          </button>
        </div>

        ${(UI.showTelemetryForm || UI.editingTelemetry) ? `
          <div style="background:rgba(10,5,1,0.95);border:2px solid var(--gold);padding:16px;margin-bottom:18px;box-shadow:0 0 20px rgba(255,138,31,0.25)">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid rgba(255,138,31,0.3)">
              <b class="gold" style="font-size:14px;letter-spacing:0.05em">
                ${UI.editingTelemetry ? `&#x270e; MODIFICA REGOLA TELEMETRIA: ${esc(UI.editingTelemetry.name)}` : "&#x25c6; CREA NUOVA REGOLA TELEMETRIA"}
              </b>
              <button class="small ghost" id="telemetry-form-cancel" style="padding:3px 10px;font-size:12px">&#x2715; Chiudi</button>
            </div>
            <div style="display:flex;flex-direction:column;gap:12px">
              <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(280px, 1fr));gap:12px">
                <label style="font-size:11px">Nome Identificativo Regola
                  <input type="text" id="telem-input-name" value="${esc(UI.editingTelemetry?.name || "")}" placeholder="es. Allarme Carburante Critico" style="width:100%;height:34px;margin-top:3px">
                </label>
                <label style="font-size:11px">Metrica Telemetria da Monitorare
                  <select id="telem-input-metric" style="width:100%;height:34px;margin-top:3px;background:#110800;border:1px solid var(--accent);color:var(--gold)">
                    <option value="fuel" ${UI.editingTelemetry?.metric === "fuel" ? "selected" : ""}>Livello Carburante Principale (%)</option>
                    <option value="heat" ${UI.editingTelemetry?.metric === "heat" ? "selected" : ""}>Temperatura Termica Scafo (%)</option>
                    <option value="shields_down" ${UI.editingTelemetry?.metric === "shields_down" ? "selected" : ""}>Collasso / Disattivazione Scudi</option>
                    <option value="hull" ${UI.editingTelemetry?.metric === "hull" ? "selected" : ""}>Integrità Strutturale Scafo (%)</option>
                    <option value="fsd" ${UI.editingTelemetry?.metric === "fsd" ? "selected" : ""}>Integrità Modulo FSD (%)</option>
                    <option value="star_unscoopable" ${UI.editingTelemetry?.metric === "star_unscoopable" ? "selected" : ""}>Stella Non Rifornibile (No KGBFOAM)</option>
                    <option value="elw" ${UI.editingTelemetry?.metric === "elw" ? "selected" : ""}>Pianeta Terrestre (Earth-Like / Valore)</option>
                    <option value="bio_distance" ${UI.editingTelemetry?.metric === "bio_distance" ? "selected" : ""}>Esobiologia: Distanza Campionamento Raggiunta</option>
                  </select>
                </label>
              </div>

              <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(280px, 1fr));gap:12px;align-items:center">
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
                  <label style="font-size:11px">Condizione
                    <select id="telem-input-cond" style="width:100%;height:34px;margin-top:3px;background:#110800;border:1px solid var(--accent);color:var(--gold)">
                      <option value="lt" ${UI.editingTelemetry?.condition === "lt" ? "selected" : ""}>Minore di (&lt;)</option>
                      <option value="gt" ${UI.editingTelemetry?.condition === "gt" ? "selected" : ""}>Maggiore di (&gt;)</option>
                      <option value="eq" ${UI.editingTelemetry?.condition === "eq" ? "selected" : ""}>Uguale a / Attivo (=)</option>
                    </select>
                  </label>
                  <label style="font-size:11px">Valore Soglia
                    <input type="number" id="telem-input-thresh" value="${UI.editingTelemetry?.threshold != null ? UI.editingTelemetry.threshold : 25}" step="1" style="width:100%;height:34px;margin-top:3px">
                  </label>
                </div>
                <label style="font-size:11px">Frase Annunciata dal Copilota Neurale
                  <input type="text" id="telem-input-voice" value="${esc(UI.editingTelemetry?.voice || "")}" placeholder="es. Attenzione comandante, riserva carburante critica." style="width:100%;height:34px;margin-top:3px">
                </label>
              </div>

              <label style="font-size:11px">Descrizione Regola (opzionale)
                <input type="text" id="telem-input-desc" value="${esc(UI.editingTelemetry?.desc || "")}" placeholder="es. Avvisa vocalmente quando il livello di carburante scende al di sotto della soglia" style="width:100%;height:34px;margin-top:3px">
              </label>

              <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,138,31,0.2)">
                <button type="button" class="small" id="telem-form-test">&#x25b6; Ascolta Voce Neurale</button>
                <div style="display:flex;gap:8px">
                  <button type="button" class="small ghost" id="telem-form-cancel">Annulla</button>
                  <button type="button" class="small primary" id="telem-form-save">
                    ${UI.editingTelemetry ? "&#x25c6; Aggiorna Regola" : "&#x25c6; Salva Regola"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ` : ""}

        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(420px, 1fr));gap:14px">
          ${TELEMETRY_RULES.map(r => `
            <div class="telem-rule-card" style="opacity:${r.enabled ? "1" : "0.75"}">
              <div class="telem-card-header">
                <div class="telem-card-info">
                  <input type="checkbox" data-telemetry-toggle="${esc(r.id)}" ${r.enabled ? "checked" : ""} style="cursor:pointer;margin-top:3px;flex-shrink:0">
                  <div style="min-width:0;flex:1">
                    <b class="${r.enabled ? "gold" : "sub"}" style="font-size:14px;line-height:1.3;display:block;word-break:break-word">&#x25c6; ${esc(r.name)}</b>
                    <div style="display:flex;gap:6px;align-items:center;margin-top:4px;flex-wrap:wrap">
                      <span class="tag" style="font-size:10px">METRICA: ${esc(r.metric)}</span>
                      <span class="tag gold" style="font-size:10px">SOGLIA: ${r.condition === "lt" ? "<" : r.condition === "gt" ? ">" : "="} ${r.threshold}${esc(r.unit || "")}</span>
                    </div>
                  </div>
                </div>
                <div class="telem-card-btns">
                  <button class="small" data-telemetry-test="${esc(r.id)}" title="Ascolta frase con voce neurale">&#x25b6; Ascolta</button>
                  <button class="small primary" data-telemetry-edit="${esc(r.id)}" title="Modifica questa regola">&#x270e; Modifica</button>
                  <button class="small ghost" data-telemetry-del="${esc(r.id)}" title="Elimina questa regola">&#x2715;</button>
                </div>
              </div>
              <div class="sub" style="font-size:12px;word-break:break-word"><b>Annuncio vocale:</b> "${esc(r.voice)}"</div>
              ${r.desc ? `<div class="sub" style="font-size:11px;color:var(--text-3);word-break:break-word">${esc(r.desc)}</div>` : ""}
            </div>
          `).join("")}
        </div>
      </div>

    <!-- PANNELLO 3: SEQUENZE MACRO HARDWARE MULTITASTO -->
    
      <div id="macro-editor-panel" style="background:rgba(255,138,31,0.06);border:1.5px solid var(--accent);padding:18px;border-radius:2px;box-shadow:0 0 16px rgba(255,138,31,0.12)">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid rgba(255,138,31,0.25)">
          <div>
            <div class="gold" style="font-size:16px;font-weight:700;letter-spacing:0.06em">&#x25c6; SEZIONE MACRO HARDWARE &amp; SEQUENZE TASTI MULTIPLE</div>
            <div class="sub" style="font-size:12px;margin-top:3px">Crea comandi composti DirectInput con pause temporizzate e risposte vocali dedicate per manovre complesse.</div>
          </div>
          <button class="primary" id="macro-new-toggle" style="height:36px;padding:0 18px;display:inline-flex;align-items:center;gap:8px;font-size:13px">
            + Crea Nuova Macro
          </button>
        </div>

        ${(UI.showMacroForm || UI.editingMacro) ? `
          <div style="background:rgba(10,5,1,0.92);border:2px solid var(--gold);padding:16px;margin-bottom:18px;box-shadow:0 0 20px rgba(255,138,31,0.25)">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid rgba(255,138,31,0.3)">
              <b class="gold" style="font-size:14px;letter-spacing:0.05em">
                ${UI.editingMacro ? `&#x270e; MODIFICA MACRO: ${esc(UI.editingMacro.name)}` : "&#x25c6; CREA NUOVA MACRO HARDWARE"}
              </b>
              <button class="small ghost" id="macro-form-cancel" style="padding:3px 10px;font-size:12px">&#x2715; Chiudi</button>
            </div>
            <div style="display:flex;flex-direction:column;gap:12px">
              <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(280px, 1fr));gap:12px">
                <label style="font-size:11px">Nome identificativo della macro
                  <input type="text" id="macro-input-name" value="${esc(UI.editingMacro?.name || "")}" placeholder="es. Richiesta d'attracco o Scudo d'emergenza" style="width:100%;height:34px;margin-top:3px">
                </label>
                <label style="font-size:11px">Cosa dire a voce per attivarla (separa alternative con <code>;</code>)
                  <input type="text" id="macro-input-say" value="${esc(UI.editingMacro?.say || "")}" placeholder="es. Richiesta attracco; Chiedi attracco; Attracco" style="width:100%;height:34px;margin-top:3px">
                </label>
              </div>
              
              <label style="font-size:11px">Sequenza tasti fisici DirectInput (separati da virgola)
                <div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;margin-bottom:6px">
                  <span class="sub" style="font-size:11px">Sequenza di pressione tasti:</span>
                  <button type="button" class="small primary" id="macro-record-btn" style="height:28px;display:inline-flex;align-items:center;gap:6px">
                    &#x25cf; REGISTRA TASTI DALLA TASTIERA
                  </button>
                </div>
                <div id="macro-rec-status" style="display:none;background:rgba(255,50,0,0.18);border:1px solid #ff4422;padding:8px 12px;margin-bottom:8px;font-family:var(--mono);font-size:12px;color:var(--gold)">
                  <b>&#x25cf; REGISTRAZIONE IN CORSO:</b> Premi i tasti sulla tastiera. Verranno catturati in sequenza con pause automatiche. Premi <b>Esc</b> o clicca su Ferma per concludere.
                </div>
                <input type="text" id="macro-input-keys" value="${esc((UI.editingMacro?.keys || []).join(", "))}" placeholder="es. 1, WAIT:250, E, E, SPACE, RIGHT, SPACE, 1" style="width:100%;height:34px;margin-top:3px">
              </label>
              <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;background:rgba(255,138,31,0.05);padding:8px 10px;border:1px solid rgba(255,138,31,0.2)">
                <span class="sub" style="font-size:11px">Inserimento rapido:</span>
                ${["1", "E", "Q", "SPACE", "ENTER", "TAB", "UP", "DOWN", "LEFT", "RIGHT", "L", "U", "V", "X", "N", "7", "WAIT:200", "WAIT:500"].map(k => `
                  <button type="button" class="small ghost" data-macro-add-key="${esc(k)}" style="padding:2px 8px;font-size:11px">${esc(k)}</button>
                `).join("")}
              </div>
              
              <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(280px, 1fr));gap:12px">
                <label style="font-size:11px">Risposta vocale pronunciata dal copilota (Voce Neurale AI)
                  <input type="text" id="macro-input-voice" value="${esc(UI.editingMacro?.voice || "")}" placeholder="es. Autorizzazione atterraggio richiesta alla torre." style="width:100%;height:34px;margin-top:3px">
                </label>
                <label style="font-size:11px">Descrizione funzione (opzionale)
                  <input type="text" id="macro-input-desc" value="${esc(UI.editingMacro?.desc || "")}" placeholder="es. Apre pannello contatti e richiede attracco alla stazione" style="width:100%;height:34px;margin-top:3px">
                </label>
              </div>
              
              <div style="display:flex;justify-content:space-between;align-items:center;margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,138,31,0.2)">
                <button type="button" class="small" id="macro-form-test-seq">&#x25b6; Prova Tasti &amp; Voce</button>
                <div style="display:flex;gap:8px">
                  <button type="button" class="small ghost" id="macro-form-cancel">Annulla</button>
                  <button type="button" class="small primary" id="macro-form-save">
                    ${UI.editingMacro ? "&#x25c6; Aggiorna Macro" : "&#x25c6; Salva Nuova Macro"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        ` : ""}

        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(360px, 1fr));gap:12px">
          ${MACROS.map(m => `
            <div class="todo-item" style="flex-direction:column;align-items:stretch;gap:8px;padding:12px 14px;background:rgba(20,8,0,0.6);border:1px solid rgba(255,138,31,0.25);border-radius:2px">
              <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
                <div>
                  <b class="gold" style="font-size:15px">&#x25c6; ${esc(m.name)}</b>
                  <div style="margin-top:3px;font-size:12px;color:var(--hud-hi)"><b>Cosa dire:</b> <code>${esc(m.say)}</code></div>
                </div>
                <div style="display:flex;gap:4px;flex-shrink:0">
                  <button class="small" data-macro-test="${esc(m.id)}" title="Simula tasti ed esegue voce neurale">&#x25b6; Prova</button>
                  <button class="small primary" data-macro-edit="${esc(m.id)}" title="Modifica questa macro">&#x270e; Modifica</button>
                  <button class="small ghost" data-macro-del="${esc(m.id)}" title="Elimina questa macro">&#x2715;</button>
                </div>
              </div>
              <div style="display:flex;gap:4px;flex-wrap:wrap;align-items:center;margin-top:2px">
                <span class="sub" style="font-size:11px">Tasti:</span>
                ${(m.keys || []).map(k => `<span class="tag gold" style="font-size:11px;padding:2px 6px">${esc(k)}</span>`).join("")}
              </div>
              ${m.voice ? `<div class="sub" style="font-size:12px"><b>Voce copilota:</b> "${esc(m.voice)}"</div>` : ""}
              ${m.desc ? `<div class="sub" style="font-size:11px;color:var(--text-3)">${esc(m.desc)}</div>` : ""}
            </div>
          `).join("")}
        </div>
      </div>

  </div>`;
};
