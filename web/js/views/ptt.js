"use strict";
// Push-to-talk globale (app/ptt.py): pulsante della cloche/manetta o tasto della tastiera letto da Windows,
// microfono registrato dall'app in Python. Funziona anche mentre giochi (il PTT della pagina sente solo con l'app in primo piano).

UI.ptt = null;       // ultimo stato letto da /api/ptt/status
UI.pttMics = null;   // elenco microfoni (/api/ptt/mics)

function pttRow(title, desc, control) {
  return `<div class="todo-item" style="align-items:center"><div class="text">${title}<div class="sub">${desc}</div></div>${control}</div>`;
}
function pttSwitch(key, on, label) {
  return `<span class="sub" style="min-width:52px;text-align:right">${on ? "ACCESO" : "SPENTO"}</span>
    <button class="switch ${on ? "on" : ""}" data-ptt-switch="${key}" role="switch" aria-checked="${on}" aria-label="${esc(label)}"><span></span><span></span></button>`;
}

// Parte che cambia spesso: aggiornata da sola ogni mezzo secondo senza ridisegnare la scheda.
function pttLive(st) {
  if (!st) return '<div class="loading">LETTURA STATO PUSH-TO-TALK</div>';
  let tag;
  if (st.learning) tag = `<span class="tag gold">● PREMI ORA IL PULSANTE O IL TASTO… ${Math.ceil(st.learn_left)} s (Esc annulla)</span>`;
  else if (st.recording) tag = `<span class="tag ok">● REGISTRAZIONE IN CORSO ${dec(st.recording_for)} s / ${st.max_seconds} s</span>`;
  else if (st.transcribing) tag = '<span class="tag gold">◌ TRASCRIZIONE…</span>';
  else if (st.enabled && st.binding) tag = `<span class="tag">● IN ATTESA · ${st.mode === "toggle" ? "premi" : "tieni premuto"} ${esc(st.binding.name)}</span>`;
  else tag = `<span class="tag sub">○ ${st.enabled ? "NESSUN PULSANTE ASSEGNATO" : "SPENTO"}</span>`;
  const last = st.last;
  const res = last?.result;
  const resCls = !res ? "sub" : /^(Non riconosciuto|Ignorato|Not recognised|Ignored)/.test(res) ? "bad" : "ok";
  return `<div style="display:flex;flex-direction:column;gap:6px">
    <div>${tag}</div>
    ${last ? `<div class="sub">Ultimo comando (${ago(last.ts)}): <b class="gold">"${esc(last.text)}"</b>
      ${res ? `<span class="${resCls}">→ ${esc(res)}</span>` : '<span class="sub">→ in esecuzione…</span>'}</div>` : ""}
    ${st.last_error ? `<div class="bad">⚠ ${esc(st.last_error)}</div>` : ""}
    ${st.audio_error ? `<div class="bad">⚠ ${esc(st.audio_error)}</div>` : ""}
  </div>`;
}

function pttPanel() {
  if (!UI.ptt && !pttPanel.loading) {
    pttPanel.loading = true;
    api("/api/ptt/status").then(st => { UI.ptt = st; renderView(); }).catch(e => { UI.ptt = { error: e.message }; renderView(); });
  }
  if (!UI.pttMics && !pttPanel.loadingMics) {
    pttPanel.loadingMics = true;
    api("/api/ptt/mics").then(m => { UI.pttMics = m; renderView(); }).catch(e => { UI.pttMics = { devices: [], error: e.message }; });
  }
  const st = UI.ptt;
  if (st?.error) return panel("Push-to-talk globale", `<div class="bad">⚠ ${esc(st.error)}</div>`, { code: "PTT-GLOBAL" });
  const b = st?.binding;
  const mics = UI.pttMics?.devices || [];
  const micMissing = st?.mic && !mics.some(m => m.name === st.mic);
  const joys = st?.joysticks || [];
  const body = `
    <p class="sub">Questo push-to-talk funziona <b>anche mentre giochi</b>: l'app legge direttamente da Windows il pulsante della cloche
      o della manetta (o un tasto della tastiera) e registra il microfono da sola. Il push-to-talk qui sopra (barra spaziatrice)
      sente solo quando la finestra dell'app è in primo piano. Il comando riconosciuto viene eseguito come quelli detti all'app.</p>
    ${pttRow("Push-to-talk globale", "Legge il pulsante assegnato anche con il gioco in primo piano.", pttSwitch("enabled", !!st?.enabled, "Push-to-talk globale"))}
    ${pttRow("Pulsante assegnato",
      b ? `<span class="mono gold" style="font-size:14px">[ ${esc(b.name)} ]</span>` : "Nessuno: premi «Assegna pulsante» e poi il pulsante della cloche o il tasto da usare.",
      `<div style="display:flex;gap:6px">${st?.learning
        ? '<button class="small danger" data-ptt-cancel>Annulla</button>'
        : `<button class="small primary" data-ptt-learn>● Assegna pulsante</button>${b ? '<button class="small ghost" data-ptt-clear title="Togli il pulsante assegnato">✕</button>' : ""}`}</div>`)}
    ${pttRow("Comportamento", `Tieni premuto: registra finché il pulsante è giù. Premi e ripremi: la prima pressione avvia, la seconda ferma. Massimo ${st?.max_seconds || 15} secondi.`,
      `<select id="ptt-g-mode" data-ptt-mode style="max-width:240px">
        ${opt("hold", "Tieni premuto per parlare", st?.mode)}${opt("toggle", "Premi per avviare / fermare", st?.mode)}</select>`)}
    ${pttRow("Microfono", UI.pttMics?.error ? `<span class="bad">${esc(UI.pttMics.error)}</span>` : micMissing ? '<span class="bad">Il microfono scelto non è collegato: uso quello predefinito.</span>' : "Quello da cui registra il push-to-talk globale.",
      `<div style="display:flex;gap:6px"><select id="ptt-g-mic" data-ptt-mic style="max-width:260px">
        ${opt("", "Predefinito di sistema", st?.mic || "")}
        ${mics.map(m => opt(m.name, m.name + (m.default ? " (predefinito)" : ""), st?.mic || "")).join("")}
        ${micMissing ? opt(st.mic, st.mic + " (scollegato)", st.mic) : ""}</select>
        <button class="small ghost" data-ptt-mics title="Rileggi l'elenco dei microfoni">↻</button></div>`)}
    ${pttRow("Segnale acustico", "Un breve bip quando inizia e finisce la registrazione (e un bip basso se qualcosa non va).", pttSwitch("beep", !!st?.beep, "Segnale acustico"))}
    <div id="ptt-g-live" style="margin-top:10px">${pttLive(st)}</div>
    <div class="sub" style="margin-top:8px">Dispositivi rilevati: ${joys.length ? joys.map(j => `<b>${esc(j.name)}</b> (${j.buttons} pulsanti)`).join(", ") : "nessuna cloche o manetta (o non ancora lette)"}.
      Consiglio: usa un pulsante che nel gioco non fa nulla, perché la pressione arriva anche al gioco.</div>`;
  return panel("Push-to-talk globale (anche in gioco)", body, {
    code: "PTT-GLOBAL",
    aside: st?.recording ? '<span class="ok">● REC</span>' : st?.enabled ? "ACCESO" : "SPENTO",
  });
}

async function pttSave(changes) {
  try { UI.ptt = await api("/api/ptt/config", changes); }
  catch (e) { toast("Errore: " + e.message); }
  renderView();
}

async function pttLearn() {
  if (UI.ptt) UI.ptt = { ...UI.ptt, learning: true, learn_left: 10 };
  renderView();
  pttPoll();
  try {
    const r = await api("/api/ptt/learn", {});
    if (r.type) {
      toast("Push-to-talk: " + r.name);
      UI.ptt = r.status || UI.ptt;
      // Assegnare un pulsante vuol dire volerlo usare: se era spento lo accendo.
      if (UI.ptt && !UI.ptt.enabled) UI.ptt = await api("/api/ptt/config", { enabled: true });
    } else {
      toast(r.error || "Nessun pulsante assegnato");
      UI.ptt = await api("/api/ptt/status");
    }
  } catch (e) { toast("Errore: " + e.message); }
  renderView();
}

// Stato in tempo reale (registrazione, conto alla rovescia dell'assegnazione) solo mentre la scheda è aperta.
async function pttPoll() {
  if (pttPoll.busy || currentTab() !== "voice_commands" || !$("ptt-g-live")) return;
  pttPoll.busy = true;
  try {
    const st = await api("/api/ptt/status");
    const prev = UI.ptt;
    UI.ptt = st;
    const el = $("ptt-g-live");
    if (el) el.innerHTML = pttLive(st);
    // Cambiamenti che toccano il resto del pannello (pulsante assegnato, acceso/spento): ridisegno, ma non mentre scegli da un menu.
    if (prev && (prev.learning !== st.learning || prev.enabled !== st.enabled || prev.recording !== st.recording ||
        JSON.stringify(prev.binding) !== JSON.stringify(st.binding)) && !document.activeElement?.matches("select")) renderView();
  } catch { /* server momentaneamente non raggiungibile: riprova al prossimo giro */ }
  pttPoll.busy = false;
}
setInterval(pttPoll, 500);

document.addEventListener("click", e => {
  const sw = e.target.closest("[data-ptt-switch]");
  if (sw) return pttSave({ [sw.dataset.pttSwitch]: !UI.ptt?.[sw.dataset.pttSwitch] });
  if (e.target.closest("[data-ptt-learn]")) return pttLearn();
  if (e.target.closest("[data-ptt-cancel]")) return api("/api/ptt/learn/cancel", {}).catch(() => {});
  if (e.target.closest("[data-ptt-clear]")) return pttSave({ binding: null });
  if (e.target.closest("[data-ptt-mics]")) {
    api("/api/ptt/mics").then(m => { UI.pttMics = m; toast("Microfoni aggiornati"); renderView(); }).catch(err => toast("Errore: " + err.message));
  }
});
document.addEventListener("change", e => {
  if (e.target.matches("[data-ptt-mode]")) pttSave({ mode: e.target.value });
  if (e.target.matches("[data-ptt-mic]")) pttSave({ mic: e.target.value });
});
