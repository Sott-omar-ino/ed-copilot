"use strict";

function formatKeyFriendlyName(code, key) {
  if (!code) return "SPAZIO (Space)";
  if (code === "Space") return "SPAZIO (Space)";
  if (code === "Enter") return "INVIO (Enter)";
  if (code === "Tab") return "TAB";
  if (code === "Escape") return "ESC";
  if (code === "CapsLock") return "BLOC MAIUSC (Caps Lock)";
  if (code === "ShiftLeft" || code === "ShiftRight") return "SHIFT";
  if (code === "ControlLeft" || code === "ControlRight") return "CTRL";
  if (code === "AltLeft" || code === "AltRight") return "ALT";
  if (code.startsWith("Key")) return code.replace("Key", "");
  if (code.startsWith("Digit")) return code.replace("Digit", "");
  if (code.startsWith("Numpad")) return "NUM " + code.replace("Numpad", "");
  return (key || code).toUpperCase();
}

// ============================================================================
// REGISTRATORE MACRO TASTIERA DIRETTO
// ============================================================================
const MACRO_RECORDER = {
  recording: false,
  recordedKeys: [],
  lastKeyTime: 0,
  start() {
    this.recording = true;
    this.recordedKeys = [];
    this.lastKeyTime = Date.now();
    const btn = $("macro-record-btn");
    if (btn) {
      btn.className = "small danger";
      btn.innerHTML = "&#x25a0; FERMA REGISTRAZIONE (0 tasti)";
      btn.style.background = "#992200";
      btn.style.borderColor = "#ff4422";
    }
    const stat = $("macro-rec-status");
    if (stat) stat.style.display = "block";
    toast(t("Registrazione tasti AVVIATA: premi i pulsanti sulla tastiera"));
  },
  stop() {
    this.recording = false;
    const btn = $("macro-record-btn");
    if (btn) {
      btn.className = "small primary";
      btn.innerHTML = "&#x25cf; REGISTRA TASTI (Premi sulla tastiera)";
      btn.style.background = "";
      btn.style.borderColor = "";
    }
    const stat = $("macro-rec-status");
    if (stat) stat.style.display = "none";
    toast(t(`Registrazione completata: ${this.recordedKeys.length} comandi salvati`));
  },
  toggle() {
    if (this.recording) this.stop();
    else this.start();
  },
  recordKey(code) {
    if (!this.recording) return;
    const now = Date.now();
    const delta = now - this.lastKeyTime;
    this.lastKeyTime = now;

    let key = null;
    if (code.startsWith("Key")) key = code.slice(3).toUpperCase();
    else if (code.startsWith("Digit")) key = code.slice(5);
    else if (code.startsWith("Numpad")) key = "NUM" + code.slice(6);
    else if (code === "Space") key = "SPACE";
    else if (code === "Enter") key = "ENTER";
    else if (code === "Tab") key = "TAB";
    else if (code === "ArrowUp") key = "UP";
    else if (code === "ArrowDown") key = "DOWN";
    else if (code === "ArrowLeft") key = "LEFT";
    else if (code === "ArrowRight") key = "RIGHT";
    else if (code.startsWith("Shift")) key = "SHIFT";
    else if (code.startsWith("Control")) key = "CTRL";
    else if (code.startsWith("Alt")) key = "ALT";
    else if (code === "Insert") key = "INSERT";
    else if (code === "Delete") key = "DELETE";
    else if (code === "Home") key = "HOME";
    else if (code === "End") key = "END";
    else if (code === "PageUp") key = "PGUP";
    else if (code === "PageDown") key = "PGDN";
    else if (code.startsWith("F") && !isNaN(code.slice(1))) key = code.toUpperCase();

    if (!key) return;

    if (this.recordedKeys.length > 0 && delta >= 300) {
      const waitMs = Math.min(1000, Math.round(delta / 50) * 50);
      this.recordedKeys.push(`WAIT:${waitMs}`);
    }
    this.recordedKeys.push(key);

    const input = $("macro-input-keys");
    if (input) {
      input.value = this.recordedKeys.join(", ");
      UI.dirty.set(input.id, input.value);
    }
    const btn = $("macro-record-btn");
    if (btn) {
      btn.innerHTML = `&#x25a0; FERMA REGISTRAZIONE (${this.recordedKeys.length} tasti)`;
    }
  }
};


async function populateMicDeviceSelect() {
  const sel = document.getElementById("mic-device-select");
  if (!sel || !navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) return;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const audioInputs = devices.filter(d => d.kind === "audioinput");
    const saved = localStorage.getItem("ed_mic_device") || "";
    sel.innerHTML = '<option value="">Microfono Predefinito di Sistema</option>' +
      audioInputs.map(d => `<option value="${esc(d.deviceId)}" ${d.deviceId === saved ? "selected" : ""}>${esc(d.label || `Microfono ${d.deviceId.slice(0, 6)}...`)}</option>`).join("");
  } catch(e) {}
}

// ============================================================================
// COMANDI VOCALI "DA FARE"
// Funzioni pure (provate con tools/test_voice_todo.js): lavorano sul testo grezzo di Whisper, così la voce
// aggiunta conserva maiuscole, accenti e i termini di gioco come sono stati riconosciuti.
// ============================================================================
const TODO_VOICE = {
  // "da fare" detto anche all'inglese: Whisper scrive "to do", "todo", "to-do".
  LIST: String.raw`(?:(?:la\s+)?lista\s+(?:delle\s+cose\s+)?(?:da\s*fare|to[\s-]*do)|(?:le\s+)?cose\s+da\s*fare|(?:i\s+|il\s+)?(?:da\s*fare|to[\s-]*dos?)|(?:i\s+|un\s+|il\s+)?promemoria)`,
  WORDS: { uno: 1, una: 1, primo: 1, prima: 1, due: 2, secondo: 2, seconda: 2, tre: 3, terzo: 3, terza: 3, quattro: 4,
           quarto: 4, quarta: 4, cinque: 5, quinto: 5, quinta: 5, sei: 6, sesto: 6, sesta: 6, sette: 7, settimo: 7,
           settima: 7, otto: 8, ottavo: 8, ottava: 8, nove: 9, nono: 9, nona: 9, dieci: 10, decimo: 10, decima: 10 },
  STOP: new Set("il lo la i gli le un uno una di a da in con su per tra fra del della dei delle al alla ai alle e che come fatto fatta fatti fatte".split(" ")),

  norm(s) {
    return String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
  },

  // Pulisce il testo dettato: niente punteggiatura finale o virgolette, prima lettera maiuscola.
  cleanText(s) {
    let t = String(s || "").replace(/^[\s:;,.\-–—"'«»“”]+/, "").replace(/[\s.,;:!?…"'«»“”]+$/, "").replace(/\s+/g, " ").trim();
    return t ? t[0].toUpperCase() + t.slice(1) : "";
  },

  // { kind: "add", text } | { kind: "read" } | { kind: "done", query } | null
  parse(raw) {
    const s = String(raw || "").trim()
      .replace(/^(?:(?:ok|okay|ehi|hey|copilota|computer|per\s+favore|perfavore|allora)[\s,.:!]+)+/i, "");
    const L = this.LIST, sep = String.raw`\s*[:,.;\-–—]?\s*`;
    let m;
    // Aggiunta: "aggiungi (alle cose) da fare: X", "aggiungi un promemoria X", "nuovo da fare X", "ricordami di X", "promemoria: X"
    m = s.match(new RegExp(String.raw`^(?:aggiungi|aggiungere|aggiunge|metti|inserisci|segna)\s+(?:(?:a|ai|al|alla|alle|nella|nelle|nei|tra\s+le|fra\s+le)\s+)?(?:un\s+|una\s+|nuovo\s+|nuova\s+)?${L}${sep}(?:(?:di|che)\s+)?(.+)$`, "i"))
      || s.match(new RegExp(String.raw`^nuov[oa]\s+${L}${sep}(?:(?:di|che)\s+)?(.+)$`, "i"))
      || s.match(new RegExp(String.raw`^ricorda(?:mi|ti)${sep}(?:(?:di|che)\s+)?(.+)$`, "i"))
      || s.match(new RegExp(String.raw`^promemoria${sep}(?:(?:di|che)\s+)?(.+)$`, "i"));
    if (!m) {  // "aggiungi X alle cose da fare"
      m = s.match(new RegExp(String.raw`^(?:aggiungi|metti|inserisci)\s+(.+?)\s+(?:a|ai|al|alla|alle|nella|nelle|nei|tra\s+le|fra\s+le)\s+${L}[\s.!?]*$`, "i"));
    }
    if (m) {
      const text = this.cleanText(m[1]);
      return text ? { kind: "add", text } : null;
    }
    const n = this.norm(s);
    if (/^(?:(?:che\s+)?cosa|che)\s+(?:devo|dobbiamo|resta|rimane|c\s+e|ce)\s+(?:(?:ancora\s+)?da\s+)?fare(?:\s+oggi)?$/.test(n)
        || /^(?:leggi|leggimi|elenca|dimmi|ripeti|quali\s+sono)\s+(?:le\s+cose\s+da\s+fare|(?:la\s+)?lista(?:\s+delle\s+cose)?\s+da\s+fare|(?:i\s+)?(?:da\s+fare|to\s*dos?)|(?:i\s+)?promemoria|(?:la\s+)?lista\s+(?:to\s*dos?|promemoria))$/.test(n)
        || /^(?:cose\s+da\s+fare|lista\s+(?:delle\s+cose\s+)?da\s+fare)$/.test(n)) {
      return { kind: "read" };
    }
    m = s.match(new RegExp(String.raw`^(?:segna(?:re|mi)?|metti)\s+(?:come\s+)?(?:fatt[oaie]|completat[oaie]|svolt[oaie])${sep}(.+)$`, "i"))
      || s.match(new RegExp(String.raw`^(?:completa(?:re|to)?|spunta|chiudi|ho\s+fatto|ho\s+completato)${sep}(.+)$`, "i"))
      || s.match(new RegExp(String.raw`^segna\s+(.+?)\s+come\s+(?:fatt[oaie]|completat[oaie])[\s.!?]*$`, "i"));
    if (m) {
      const query = this.cleanText(m[1]).replace(new RegExp(String.raw`^(?:(?:dalle|nelle|delle|tra\s+le)\s+)?${L}${sep}`, "i"), "");
      return query ? { kind: "done", query } : null;
    }
    return null;
  },

  // Numero detto ("il 2", "numero due", "il primo", "la terza voce"), altrimenti null.
  ordinal(query) {
    const w = this.norm(query).split(" ").filter(x => !["il", "lo", "la", "l", "numero", "n", "voce", "attivita", "punto", "promemoria"].includes(x));
    if (w.length !== 1) return null;
    if (/^\d{1,2}$/.test(w[0])) return parseInt(w[0], 10);
    return this.WORDS[w[0]] || null;
  },

  _tokens(s) {
    return this.norm(s).split(" ").filter(w => w && !this.STOP.has(w));
  },

  // Cerca la voce aperta più simile. { item } se una sola è chiaramente migliore, { ambiguous: [..] } o { none: true }.
  match(query, open) {
    const n = this.ordinal(query);
    if (n != null) return open[n - 1] ? { item: open[n - 1] } : { none: true };
    const q = this._tokens(query);
    if (!q.length) return { none: true };
    const nq = this.norm(query);
    const same = (a, b) => a === b || (a.length >= 4 && b.length >= 4 && a.slice(0, Math.max(4, Math.min(a.length, b.length) - 2)) === b.slice(0, Math.max(4, Math.min(a.length, b.length) - 2)));
    const scored = open.map(item => {
      const t = this._tokens(item.text);
      const hit = q.filter(w => t.some(x => same(w, x))).length;
      let score = hit / q.length;
      if (nq.length >= 4 && this.norm(item.text).includes(nq)) score += 0.5;  // frase detta contenuta nel testo
      return { item, score };
    }).sort((a, b) => b.score - a.score);
    const best = scored[0], second = scored[1];
    if (!best || best.score < 0.5) return { none: true };
    if (second && second.score >= 0.5 && best.score - second.score < 0.25) return { ambiguous: scored.filter(s => s.score >= 0.5).slice(0, 3).map(s => s.item) };
    return { item: best.item };
  },

  // Frase per "cosa devo fare": al massimo 5 voci, poi "e altre N".
  readText(open) {
    if (!open.length) return "Non hai niente da fare in elenco, comandante.";
    const head = open.slice(0, 5).map((t, i) => `${i + 1}: ${this.cleanText(t.text)}`).join(". ");
    const more = open.length > 5 ? `. E altre ${open.length - 5}` : "";
    return `${open.length === 1 ? "Hai una cosa da fare" : `Hai ${open.length} cose da fare`}. ${head}${more}.`;
  },
};

// ============================================================================
// COMANDI VOCALI IN INGLESE (interfaccia in inglese: LANG.lang === "en")
// Grammatica equivalente a quella italiana (VOICE_ENGINE.dispatch e TODO_VOICE), scelta in base alla lingua;
// quella italiana resta com'è. Whisper trascrive in inglese (app/voice.py usa la lingua dell'interfaccia).
// Provata con tools/test_voice_en.js.
// ============================================================================
const TODO_VOICE_EN = Object.assign(Object.create(TODO_VOICE), {
  // "to do" come lo scrive Whisper: "to do", "to-do", "todo", "to-dos", "todo's" (e "two do" quando sbaglia).
  TD: String.raw`(?:to[\s-]*do|todo|two[\s-]*do)(?:'?s)?`,
  get LIST() { return String.raw`(?:(?:my|the|your|our)\s+)?(?:${this.TD}(?:\s+list)?|task\s+list|tasks?|reminders?)`; },
  WORDS: { one: 1, first: 1, two: 2, second: 2, three: 3, third: 3, four: 4, fourth: 4, five: 5, fifth: 5, six: 6,
           sixth: 6, seven: 7, seventh: 7, eight: 8, eighth: 8, nine: 9, ninth: 9, ten: 10, tenth: 10 },
  STOP: new Set("the a an of to in on at for with from and or my your our is it that this done".split(" ")),

  // { kind: "add", text } | { kind: "read" } | { kind: "done", query } | null
  parse(raw) {
    const s = String(raw || "").trim()
      .replace(/^(?:(?:ok|okay|hey|hi|copilot|computer|please|so|right|alright)[\s,.:!]+)+/i, "");
    const L = this.LIST, sep = String.raw`\s*[:,.;\-–—]?\s*`;
    const n = this.norm(s), TDn = String.raw`(?:to\s*do|todo|two\s*do)(?:\s*s)?`;
    const LISTn = String.raw`(?:(?:my|the|your|our)\s+)?(?:${TDn}(?:\s+list)?|task\s+list|tasks|reminders)`;
    // Lettura (prima dell'aggiunta: "to do list" da solo è una lettura, non una voce "list").
    if (new RegExp(String.raw`^what\s*(?:s|is)?\s+(?:do|does|have|did)?\s*(?:i|we)\s+(?:still\s+)?(?:need|have|got|gotta)\s+(?:to\s+)?do(?:\s+(?:today|next|now))?$`).test(n)
        || /^what\s*(?:s|is)?\s+(?:left|still\s+left|remaining|there)\s+(?:for\s+me\s+)?to\s+do(?:\s+(?:today|next))?$/.test(n)
        || new RegExp(String.raw`^what\s*(?:s|is)\s+on\s+${LISTn}$`).test(n)
        || new RegExp(String.raw`^(?:read|list|tell|show|repeat|give)(?:\s+me)?(?:\s+out)?\s+${LISTn}$`).test(n)
        || new RegExp(String.raw`^${LISTn}$`).test(n)) {
      return { kind: "read" };
    }
    let m;
    // Aggiunta: "add to do X", "add to my to-do list: X", "add a reminder to X", "new task X", "remind me to X",
    // "to do: X", "add X to my to do list"
    m = s.match(new RegExp(String.raw`^(?:add|put|create|make)\s+(?:(?:it\s+)?(?:to|on|onto|in|into)\s+)?(?:a\s+|an\s+|new\s+)?${L}(?:\s+item)?${sep}(?:(?:to|that)\s+)?(.+)$`, "i"))
      || s.match(new RegExp(String.raw`^new\s+${L}${sep}(?:(?:to|that)\s+)?(.+)$`, "i"))
      || s.match(new RegExp(String.raw`^remind\s+me${sep}(?:(?:to|that|about|of)\s+)?(.+)$`, "i"))
      || s.match(new RegExp(String.raw`^(?:reminder|${this.TD}|note\s+to\s+self)\s*[:,.;\-–—]\s*(.+)$`, "i"));
    if (!m) m = s.match(new RegExp(String.raw`^(?:add|put)\s+(.+?)\s+(?:to|on|onto|in|into)\s+${L}[\s.!?]*$`, "i"));
    if (m) {
      const text = this.cleanText(m[1]);
      return text && !/^(?:list|it)$/i.test(text) ? { kind: "add", text } : null;
    }
    // Completamento: "mark done X", "mark as done: X", "mark X as done", "tick off X", "complete X", "I've done X"
    m = s.match(new RegExp(String.raw`^(?:mark|tick|check|set)\s+(?:it\s+)?(?:as\s+)?(?:done|complete|completed|finished)${sep}(.+)$`, "i"))
      || s.match(new RegExp(String.raw`^(?:complete|finish|finished|tick\s+off|check\s+off|cross\s+off|strike\s+off)${sep}(.+)$`, "i"))
      || s.match(new RegExp(String.raw`^mark\s+(.+?)\s+(?:as\s+)?(?:done|complete|completed|finished)[\s.!?]*$`, "i"))
      || s.match(new RegExp(String.raw`^(?:tick|cross|strike)\s+(.+?)\s+off[\s.!?]*$`, "i"))
      || s.match(new RegExp(String.raw`^i(?:\s+have|\s*['’]?\s*ve)?\s+(?:done|finished|completed)${sep}(.+)$`, "i"));
    if (m) {
      const query = this.cleanText(this.cleanText(m[1])
        .replace(new RegExp(String.raw`^(?:(?:from|on|in|off)\s+)?${L}${sep}`, "i"), "")
        .replace(new RegExp(String.raw`\s+(?:from|on|in|off)\s+${L}$`, "i"), ""));
      return query ? { kind: "done", query } : null;
    }
    return null;
  },

  // Numero detto ("number 2", "the second one", "the 3rd", "item two"), altrimenti null.
  ordinal(query) {
    let w = this.norm(query).split(" ").filter(x => !["the", "number", "no", "item", "task", "entry", "to", "do", "todo",
      "reminder", "thing", "point", "line"].includes(x));
    if (w.length === 2 && w[1] === "one") w = [w[0]];  // "the first one"
    if (w.length !== 1) return null;
    const d = w[0].match(/^(\d{1,2})(?:st|nd|rd|th)?$/);
    if (d) return parseInt(d[1], 10);
    return this.WORDS[w[0]] || null;
  },

  readText(open) {
    if (!open.length) return "Your to-do list is empty, CMDR.";
    const head = open.slice(0, 5).map((t, i) => `${i + 1}: ${this.cleanText(t.text)}`).join(". ");
    const more = open.length > 5 ? `. And ${open.length - 5} more` : "";
    return `${open.length === 1 ? "You have one thing to do" : `You have ${open.length} things to do`}. ${head}${more}.`;
  },

  HELP: [
    ["To-do", "“add to do …”, “add to my to-do list …”, “remind me to …”, “new task …”"],
    ["", "“what do I need to do”, “read my to-do list”"],
    ["", "“mark done …”, “mark … as done”, “tick off …” (also by number: “mark done number 2”)"],
  ],
});

// Testo detto → forma confrontabile: minuscole, senza punteggiatura, senza parole di riempimento, con le varianti
// che Whisper scrive per i termini di gioco ("hard points", "F.S.D.", "super cruise", "seventy-five").
function voiceNormEn(s) {
  let x = " " + String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[’']/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim() + " ";
  const fix = [
    [/ (?:please|the|my|a|an|our|can you|could you|would you|will you|go ahead and|i want to|lets|let s) /g, " "],
    [/ hard ?points? /g, " hardpoints "], [/ f s d /g, " fsd "], [/ s c b /g, " scb "], [/ super ?cruise /g, " supercruise "],
    [/ heat ?sinks? /g, " heat sink "], [/ cargo (?:scope|scoup|school|scoops) /g, " cargo scoop "],
    [/ landing gears /g, " landing gear "], [/ gears /g, " gear "], [/ light /g, " lights "],
    [/ seventy ?five /g, " 75 "], [/ per cent /g, " percent "],
    [/ gal ?map /g, " galmap "], [/ sys ?map /g, " sysmap "], [/ exo ?bio(?:logy)? /g, " exobiology "],
    [/ manoeuvre /g, " maneuver "], [/ equalise /g, " equalize "], [/ pip /g, " pips "], [/ four pips /g, " 4 pips "],
    [/ what s /g, " what is "], [/ whats /g, " what is "],
  ];
  for (let i = 0; i < 2; i++) for (const [re, out] of fix) x = x.replace(re, out);
  return x.replace(/\s+/g, " ").trim();
}

// Grammara inglese, nell'ordine in cui si prova (la prima che corrisponde vince). say: frasi contenute in ciò che
// è stato detto (parola per parola), exact: frasi da sole. act: azione di /api/voice/ship_control (app/keys.py),
// report: /api/voice/play?type=..., do: comando speciale. desc: cosa viene mostrato e scritto in cronologia.
// help: quante frasi mostrare in "What you can say".
const VOICE_GRAMMAR_EN = [
  // --- Nave (prima dei controlli personalizzati: "landing gear down" non deve diventare "landing gear")
  { group: "Ship", act: "gear_down", desc: "Landing gear down", help: 1,
    say: ["landing gear down", "gear down", "deploy landing gear", "deploy gear", "lower landing gear", "lower gear",
          "drop landing gear", "drop gear", "extend landing gear", "extend gear", "put landing gear down", "put gear down"] },
  { group: "Ship", act: "gear_up", desc: "Landing gear up", help: 1,
    say: ["landing gear up", "gear up", "retract landing gear", "retract gear", "raise landing gear", "raise gear",
          "stow landing gear", "stow gear", "put landing gear up", "put gear up"] },
  { group: "Ship", act: "gear_toggle", desc: "Landing gear toggled", help: 0,
    say: ["toggle landing gear", "toggle gear", "landing gear"], exact: ["gear"] },
  { group: "Ship", act: "cargo_open", desc: "Cargo scoop open", help: 1,
    say: ["open cargo scoop", "deploy cargo scoop", "cargo scoop open", "cargo scoop out", "open cargo hatch", "open scoop", "deploy scoop"] },
  { group: "Ship", act: "cargo_close", desc: "Cargo scoop closed", help: 1,
    say: ["close cargo scoop", "retract cargo scoop", "stow cargo scoop", "cargo scoop closed", "cargo scoop close", "cargo scoop in",
          "close cargo hatch", "close scoop", "retract scoop"] },
  { group: "Ship", act: "cargo", desc: "Cargo scoop toggled", help: 0, say: ["toggle cargo scoop", "cargo scoop", "cargo hatch"] },
  { group: "Ship", act: "lights_on", desc: "Ship lights on", help: 1,
    say: ["lights on", "turn on lights", "turn lights on", "switch on lights", "switch lights on", "ship lights on", "headlights on"] },
  { group: "Ship", act: "lights_off", desc: "Ship lights off", help: 1,
    say: ["lights off", "turn off lights", "turn lights off", "switch off lights", "switch lights off", "ship lights off", "headlights off", "kill lights"] },
  { group: "Ship", act: "lights", desc: "Ship lights toggled", help: 0, say: ["toggle lights", "ship lights", "headlights"] },
  { group: "Ship", act: "night_vision", desc: "Night vision toggled", help: 1, say: ["night vision"] },
  { group: "Ship", act: "hardpoints_deploy", desc: "Hardpoints deployed", help: 1,
    say: ["deploy hardpoints", "hardpoints out", "hardpoints deploy", "hardpoints on", "deploy weapons", "weapons out", "weapons hot"] },
  { group: "Ship", act: "hardpoints_retract", desc: "Hardpoints retracted", help: 1,
    say: ["retract hardpoints", "hardpoints in", "hardpoints away", "hardpoints off", "stow hardpoints", "retract weapons", "weapons away", "weapons cold"] },
  { group: "Ship", act: "hardpoints", desc: "Hardpoints toggled", help: 0, say: ["toggle hardpoints"], exact: ["hardpoints", "weapons"] },
  { group: "Ship", act: "pips_sys", desc: "Max power to shields", help: 1,
    say: ["4 pips to shields", "4 pips to systems", "pips to shields", "pips to systems", "full power to shields", "power to shields",
          "full power to systems", "power to systems", "max shields", "maximum shields", "max systems"] },
  { group: "Ship", act: "pips_eng", desc: "Max power to engines", help: 1,
    say: ["4 pips to engines", "pips to engines", "full power to engines", "power to engines", "max engines", "maximum engines"] },
  { group: "Ship", act: "pips_wep", desc: "Max power to weapons", help: 1,
    say: ["4 pips to weapons", "pips to weapons", "full power to weapons", "power to weapons", "max weapons", "maximum weapons"] },
  { group: "Ship", act: "pips_reset", desc: "Power distribution balanced", help: 1,
    say: ["balance power", "reset pips", "balance pips", "reset power", "equalize power", "reset power distribution"] },
  { group: "Ship", act: "shield_cell", desc: "Shield cell", help: 1, say: ["use shield cell", "fire shield cell", "shield cell"], exact: ["scb"] },
  { group: "Ship", act: "heatsink", desc: "Heat sink", help: 1, say: ["deploy heat sink", "launch heat sink", "fire heat sink", "heat sink"] },
  { group: "Ship", act: "chaff", desc: "Chaff", help: 1, say: ["launch chaff", "deploy chaff", "fire chaff", "chaff", "countermeasures"] },
  { group: "Ship", act: "silent_running", desc: "Silent running toggled", help: 1, say: ["silent running", "go silent", "run silent"] },
  { group: "Ship", act: "docking_request", desc: "Docking request", help: 1,
    say: ["request docking", "docking request", "request dock", "dock request", "request landing", "request permission to dock",
          "request permission to land", "ask for docking", "docking permission", "permission to dock", "permission to land"] },
  { group: "Ship", act: "throttle75", desc: "Throttle at 75%", help: 1,
    say: ["throttle 75", "throttle to 75", "75 percent", "75 throttle", "set speed 75", "approach speed", "optimal approach", "blue zone"] },
  { group: "Ship", act: "stop", desc: "Throttle to zero", help: 1,
    say: ["all stop", "full stop", "stop ship", "throttle zero", "zero throttle", "throttle to zero", "cut throttle", "cut engines", "stop engines"],
    exact: ["stop"] },
  { group: "Ship", act: "boost", desc: "Boost", help: 1, say: ["engage boost", "hit boost", "boost engines"], exact: ["boost"] },
  { group: "Ship", act: "fsd_jump", desc: "Frame Shift Drive engaged", help: 2,
    say: ["engage fsd", "charge fsd", "fsd jump", "hyperspace jump", "jump to hyperspace", "engage supercruise", "enter supercruise",
          "drop into supercruise", "engage frame shift drive", "engage frame shift", "initiate jump", "make jump", "jump now", "engage jump", "punch it"],
    exact: ["jump", "fsd", "hyperspace", "supercruise", "frame shift drive"] },
  { group: "Ship", act: "galmap", desc: "Galaxy map", help: 1, say: ["galaxy map", "galactic map", "galmap"] },
  { group: "Ship", act: "sysmap", desc: "System map", help: 1, say: ["system map", "sysmap"] },
  // --- Rapporti (dopo controlli e macro personalizzati, come in italiano)
  { group: "Reports", do: "coriolis", desc: "Coriolis station status", help: 0, say: ["coriolis status", "coriolis station", "coriolis"] },
  { group: "Reports", report: "fuel", desc: "Fuel check", help: 1,
    say: ["fuel status", "fuel level", "fuel report", "fuel check", "how much fuel", "fuel"] },
  { group: "Reports", report: "cargo", desc: "Cargo hold check", help: 1,
    say: ["cargo status", "cargo report", "cargo hold", "what's in the hold", "what am i carrying", "how much cargo"], exact: ["cargo", "hold"] },
  { group: "Reports", report: "damage", desc: "Shield and hull integrity", help: 1,
    say: ["damage report", "hull status", "hull integrity", "shield status", "shields status", "fsd status", "fsd integrity", "damage"],
    exact: ["shields", "hull", "integrity"] },
  { group: "Route", do: "carrier", desc: "Nearest fleet carrier, or find one by name or callsign (\"find carrier K3N-98F\")", help: 1,
    say: ["nearest carrier", "nearest fleet carrier", "closest carrier", "nearest carrier with repairs", "find carrier", "where is carrier"] },
  { group: "Route", do: "nearest", desc: "Nearest station (optionally with a service: repairs, material trader…)", help: 1,
    say: ["nearest station", "closest station", "nearest base", "nearest starport", "nearest material trader", "nearest technology broker",
      "nearest interstellar factors", "nearest station with repairs", "where can i repair", "nearest shipyard", "nearest black market"] },
  { group: "Route", do: "copy", desc: "Copy destination to clipboard", help: 1,
    say: ["copy destination", "copy next system", "copy next jump", "copy route", "copy system"] },
  { group: "Reports", report: "route", desc: "Next jump on the route", help: 1,
    say: ["next jump", "next system", "where am i going", "route status", "destination"], exact: ["route"] },
  { group: "Reports", report: "bio", desc: "Exobiology distance", help: 1,
    say: ["exobiology", "sample distance", "bio status", "biology", "organics"], exact: ["bio"] },
  { group: "Reports", report: "advice", desc: "Tactical advice", help: 1,
    say: ["any advice", "advice", "what should i do", "suggestion", "suggestions", "tips", "give me a tip"], exact: ["what now"] },
  { group: "Reports", report: "all", desc: "Ship status report", help: 1,
    say: ["status report", "ship status", "ship report", "sitrep", "situation report", "general report", "report"], exact: ["status"] },
];

// Frasi inglesi dei controlli e delle macro di fabbrica (defaults/controls.json, defaults/macros.json): le loro
// frasi salvate sono in italiano. Quasi tutti sono già nella grammatica qui sopra; questi si aggiungono a quelle.
const VOICE_BUILTIN_SAY_EN = {
  emergency_boost: ["emergency boost", "emergency escape", "evasive maneuver", "evasive action", "get us out of here"],
};

// Trova il comando inglese nel testo già normalizzato (voiceNormEn). Restituisce l'elemento della grammatica o null.
// Le frasi della grammatica passano dalla stessa normalizzazione del testo detto (una volta sola).
function matchGrammarEn(text, filter = () => true) {
  return VOICE_GRAMMAR_EN.find(g => {
    if (!filter(g)) return false;
    if (!g._n) g._n = { say: (g.say || []).map(voiceNormEn), exact: (g.exact || []).map(voiceNormEn) };
    return g._n.exact.includes(text) || g._n.say.some(p => saidPhrase(text, p));
  }) || null;
}

// Righe di "What you can say" (scheda Audio) generate dalla grammatica inglese.
function voiceCommandsHelpEn() {
  const rows = [...TODO_VOICE_EN.HELP];
  for (const group of ["Reports", "Route", "Ship"]) {
    const items = VOICE_GRAMMAR_EN.filter(g => g.group === group && g.help)
      .flatMap(g => [...(g.say || []), ...(g.exact || [])].slice(0, g.help));
    const quote = s => `“${s.replace(/\bfsd\b/g, "FSD").replace(/\bscb\b/g, "SCB").replace(/\bi\b/g, "I")}”`;
    rows.push([group, items.map(quote).join(", ") + (group === "Ship" ? " … (plus the ship controls below)" : "")]);
  }
  rows.push(["Macros", "the macro's name or one of its phrases"]);
  return rows;
}

// ============================================================================
// FILTRO RUMORI (cursore "Filtro rumori" nella scheda Audio)
// Stessi numeri di app/noise_filter.py (params): il server rifà lo stesso controllo su ogni registrazione,
// anche su quelle del push-to-talk globale e del telefono. Tienili allineati.
// ============================================================================
const NOISE_FILTER = {
  strength() {
    const v = S?.voice_config?.noise_filter;
    return Number.isFinite(+v) && v !== null ? Math.max(0, Math.min(100, +v)) : 50;
  },
  params(strength = this.strength()) {
    const s = strength / 100;
    return { strength: Math.round(strength), margin_db: 3 + 15 * s, min_ms: Math.round(40 + 110 * s),
             voiced_check: s >= 0.2, voiced_ratio: 0.08 + 0.22 * s };
  },
  // Ritardo della porta: quanto serve per decidere (min_ms) più un margine per l'attacco della voce.
  lookaheadMs() { return this.params().min_ms + 50; },
  calibratedFloor() {
    const v = parseFloat(localStorage.getItem("ed_mic_floor_db"));
    return Number.isFinite(v) ? v : null;
  },
  describe(strength = this.strength()) {
    const p = this.params(strength);
    if (strength < 15) return `Quasi spento: passa tutto ciò che supera di ${p.margin_db.toFixed(0)} dB il rumore di fondo. I clic dei tasti possono arrivare al riconoscimento.`;
    if (strength < 45) return `Leggero: taglia suoni più corti di ${p.min_ms} ms e quelli senza voce. Soglia ${p.margin_db.toFixed(0)} dB sopra il fondo.`;
    if (strength < 75) return `Medio: taglia clic di tastiera e pulsanti (suoni sotto ${p.min_ms} ms o senza voce). Soglia ${p.margin_db.toFixed(0)} dB sopra il fondo.`;
    return `Forte: taglia tutto ciò che dura meno di ${p.min_ms} ms o non è voce, soglia alta (${p.margin_db.toFixed(0)} dB sopra il fondo). Parla vicino al microfono.`;
  },
};

const VOICE_ENGINE = {
  active: false,
  mode: localStorage.getItem("ed_voice_mode") || "continuous", // "continuous" or "ptt"
  pttActive: false,
  pttKeyCode: localStorage.getItem("ed_ptt_key_code") || "Space",
  pttKeyName: localStorage.getItem("ed_ptt_key_name") || "SPAZIO (Space)",
  pttBehavior: localStorage.getItem("ed_ptt_behavior") || "hold", // "hold" or "toggle"
  listeningPttKey: false,
  recognition: null,
  restartTimer: null,
  keepAliveCtx: null,
  audioCtx: null,
  micStream: null,
  mediaRecorder: null,
  audioChunks: [],
  isTranscribing: false,
  lastSpeechTime: 0,
  speaking: false,
  lastDispatchedRaw: "",
  lastDispatchedTime: 0,
  meterInterval: null,
  history: [],

  renderHistory() {
    if (!this.history || !this.history.length) {
      return '<div class="sub" style="font-size:11px;padding:4px 0">Nessun comando vocale recente. Attiva il copilota e pronuncia un comando.</div>';
    }
    return this.history.map(h => 
      `<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid rgba(255,138,31,0.1)">
        <span>&#x25cf; <b>${esc(h.name)}</b> <span class="sub" style="font-size:10px">("${esc(h.raw)}")</span></span>
        <span class="sub mono" style="font-size:10px">${h.time}</span>
      </div>`
    ).join("");
  },
  
  start() {
    this.active = true;
    localStorage.setItem("ed_prop_voice", "true"); this.syncServerConfig();
    
    // Audio keep-alive to keep background tab at full priority
    try {
      if (!this.keepAliveCtx) {
        this.keepAliveCtx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = this.keepAliveCtx.createOscillator();
        const gain = this.keepAliveCtx.createGain();
        gain.gain.value = 0.00001;
        osc.connect(gain);
        gain.connect(this.keepAliveCtx.destination);
        osc.start();
      }
    } catch(e) {}

    // Microfono: vedi _micConstraints (opzioni del browser) e _initAudioPipeline (filtro rumori dell'app).
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      const constraints = { audio: this._micConstraints() };
      navigator.mediaDevices.getUserMedia(constraints).then(stream => {
        this.micStream = stream;
        const processedStream = this._initAudioPipeline(stream);
        this._initRecorder(processedStream || stream);
        const tr = $("voice-hud-transcript");
        if (tr && !this.pttActive) {
          tr.innerHTML = this.mode === "ptt" ?
            "Push-to-Talk pronto: premi <b>PARLA</b> o <b>spazio</b>" :
            "In ascolto... pronuncia un comando";
        }
      }).catch(err => {
        console.warn("Microphone access error:", err);
        const tr = $("voice-hud-transcript");
        if (tr) {
          tr.innerHTML = `<span style="color:var(--bad)">&#x26a0; ACCESSO MICROFONO NEGATO: consenti il microfono nelle autorizzazioni del browser o Windows.</span>`;
        }
        toast(t("Errore microfono: autorizzazione negata o nessun microfono collegato"));
      });
    }
    
    if (this.mode === "continuous") {
      this._initRecognition();
    }
    this.updateUI();
    toast(t(this.mode === "ptt" ? "Copilota Vocale ATTIVO (Push-to-Talk pronto)" : "Copilota Vocale ATTIVO (Ascolto continuo)"));
    return true;
  },
  
  stop() {
    this.active = false;
    this.pttActive = false;
    this.speaking = false;
    this.isTranscribing = false;
    localStorage.setItem("ed_prop_voice", "false"); this.syncServerConfig();
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }
    if (this.meterInterval) {
      clearInterval(this.meterInterval);
      this.meterInterval = null;
    }
    if (this.recognition) {
      try { this.recognition.abort(); } catch(e) {}
      this.recognition = null;
    }
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      try { this.mediaRecorder.stop(); } catch(e) {}
    }
    this.mediaRecorder = null;
    this.audioChunks = [];
    if (this.micStream) {
      try { this.micStream.getTracks().forEach(t => t.stop()); } catch(e) {}
      this.micStream = null;
    }
    const fill = $("voice-meter-fill");
    const pctLabel = $("vh-meter-pct");
    if (fill) fill.style.width = "0%";
    if (pctLabel) pctLabel.textContent = "0%";
    const sFill = $("settings-meter-fill");
    const sPct = $("settings-meter-pct");
    const sBadge = $("settings-mic-badge");
    if (sFill) sFill.style.width = "0%";
    if (sPct) sPct.textContent = "0%";
    if (sBadge) {
      sBadge.textContent = "MIC MUTO";
      sBadge.className = "tag sub";
    }
    this.updateUI();
    toast(t("Copilota vocale disattivato"));
  },
  
  toggle() {
    if (this.active) this.stop();
    else this.start();
  },

  syncServerConfig() {
    this.lastSync = Date.now();
    try {
      fetch("/api/voice/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: this.mode,
          enabled: this.active,
          ptt_key_code: this.pttKeyCode,
          ptt_key_name: this.pttKeyName,
          ptt_behavior: this.pttBehavior
        })
      }).catch(() => {});
    } catch(e) {}
  },

  initServerSync() {
    fetch("/api/voice/config")
      .then(r => r.json())
      .then(cfg => {
        if (cfg && cfg.mode) {
          this.mode = cfg.mode;
          localStorage.setItem("ed_voice_mode", cfg.mode);
        }
        if (cfg && cfg.ptt_key_code) {
          this.pttKeyCode = cfg.ptt_key_code;
          this.pttKeyName = cfg.ptt_key_name || cfg.ptt_key_code;
        }
        this.updateUI();
      })
      .catch(() => {});
  },

  // Le impostazioni vocali salvate sul server valgono per PC e telefono: se cambiano altrove, il PC si adegua.
  applyServerConfig(cfg, initial = false) {
    if (!cfg) return;
    // Subito dopo una modifica fatta qui il server può non averla ancora ricevuta: non tornare indietro.
    if (!initial && Date.now() - (this.lastSync || 0) < 5000) return;
    if (cfg.mode && cfg.mode !== this.mode) {
      this.mode = cfg.mode;
      localStorage.setItem("ed_voice_mode", cfg.mode);
      this.updateUI();
    }
    if (cfg.ptt_key_code && cfg.ptt_key_code !== this.pttKeyCode) {
      this.pttKeyCode = cfg.ptt_key_code;
      this.pttKeyName = cfg.ptt_key_name || cfg.ptt_key_code;
    }
    if (cfg.ptt_behavior) this.pttBehavior = cfg.ptt_behavior;
    if (initial || cfg.enabled !== this.active) {
      if (cfg.enabled && !this.active) this.start();
      else if (!cfg.enabled && this.active) this.stop();
      else this.updateUI();
    }
  },

  setMode(newMode) {
    this.mode = newMode;
    localStorage.setItem("ed_voice_mode", newMode);
    this.syncServerConfig();
    if (newMode === "ptt") {
      if (this.recognition) {
        try { this.recognition.abort(); } catch(e) {}
        this.recognition = null;
      }
      const tr = $("voice-hud-transcript");
      if (tr) tr.innerHTML = "Modalita Push-to-Talk attiva: tieni premuto <b>PARLA</b> o la <b>barra spaziatrice</b>";
    } else {
      if (this.active) this._initRecognition();
    }
    this.updateUI();
  },

  toggleMode() {
    this.setMode(this.mode === "ptt" ? "continuous" : "ptt");
  },

  setPttKey(code, key) {
    this.pttKeyCode = code;
    this.pttKeyName = formatKeyFriendlyName(code, key);
    localStorage.setItem("ed_ptt_key_code", code);
    localStorage.setItem("ed_ptt_key_name", this.pttKeyName);
    this.listeningPttKey = false;
    const disp = $("ptt-key-display");
    if (disp) disp.textContent = `[ ${this.pttKeyName} ]`;
    const btn = $("btn-record-ptt-key");
    if (btn) {
      btn.innerHTML = "&#x25cf; IMPOSTA TASTO PTT";
      btn.style.borderColor = "var(--accent)";
      btn.style.color = "var(--gold)";
      btn.style.background = "#1a0a00";
    }
    toast(t(`Tasto Push-to-Talk impostato su: ${this.pttKeyName}`)); this.syncServerConfig();
  },

  setBehavior(b) {
    this.pttBehavior = b;
    localStorage.setItem("ed_ptt_behavior", b); this.syncServerConfig();
    toast(b === "toggle" ? t("PTT impostato su: Premi per attivare/disattivare (Toggle)") : t("PTT impostato su: Tieni premuto per parlare (Hold)"));
  },

  pttDown() {
    if (!this.active) this.start();
    if (this.pttActive) return;
    this.pttActive = true;
    const pttBtn = $("btn-ptt-hud");
    if (pttBtn) pttBtn.classList.add("active");
    const tr = $("voice-hud-transcript");
    if (tr) tr.innerHTML = `<span style="color:var(--gold);font-weight:bold">&#x25cf; ASCOLTO IN CORSO... PARLA ORA</span>`;
    const pttInd = $("ptt-transmission-indicator");
    if (pttInd) {
      pttInd.innerHTML = "&#x25cf; TRASMISSIONE VOCALE IN CORSO";
      pttInd.style.color = "#00e676";
      pttInd.style.borderColor = "#00e676";
      pttInd.style.background = "rgba(0, 230, 118, 0.15)";
    }
    
    // Start Whisper audio recorder
    if (this.mediaRecorder && this.mediaRecorder.state === "inactive") {
      this.audioChunks = [];
      try { this.mediaRecorder.start(); } catch(e) {}
    }
    this._initRecognition(true);
  },

  pttUp() {
    if (!this.pttActive) return;
    this.pttActive = false;
    const pttBtn = $("btn-ptt-hud");
    if (pttBtn) pttBtn.classList.remove("active");
    const tr = $("voice-hud-transcript");
    if (tr) tr.innerHTML = `<span style="color:var(--gold)">&#x25cf; Elaborazione comando neurale...</span>`;
    const pttInd = $("ptt-transmission-indicator");
    if (pttInd) {
      pttInd.innerHTML = "&#x25cf; IN ATTESA DI INPUT VOCALE";
      pttInd.style.color = "var(--text-3)";
      pttInd.style.borderColor = "rgba(255, 138, 31, 0.3)";
      pttInd.style.background = "#110800";
    }
    
    // Ferma il registratore poco dopo: l'audio passa dal ritardo del filtro rumori (lookahead), altrimenti
    // l'ultima sillaba resterebbe fuori.
    const rec = this.mediaRecorder;
    setTimeout(() => {
      if (rec && rec.state === "recording" && !this.pttActive) { try { rec.stop(); } catch(e) {} }
    }, NOISE_FILTER.lookaheadMs() + 350);
    setTimeout(() => {
      if (this.recognition) {
        try { this.recognition.stop(); } catch(e) {}
      }
    }, 350);
  },

  // Catena audio del microfono dell'app:
  //   microfono → passa-alto 80 Hz → [analizzatore: decide il filtro]  → ritardo (lookahead) → porta (gain) → registratore
  // Il ritardo serve a "guardare avanti": la porta si apre solo quando un suono ha dimostrato di essere voce
  // (abbastanza lungo e sonoro, vedi NOISE_FILTER), ma grazie al ritardo si apre prima che quel suono arrivi
  // al registratore. Un clic dura meno di min_ms: la porta resta chiusa e nel file registrato non c'è.
  _initAudioPipeline(stream) {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!this.audioCtx) this.audioCtx = new AC();
      if (this.audioCtx.state === "suspended") this.audioCtx.resume();
      const ctx = this.audioCtx;
      const source = ctx.createMediaStreamSource(stream);

      // Passa-alto: toglie ronzii elettrici e vibrazioni della scrivania sotto la voce (che parte da ~85 Hz).
      const highpass = ctx.createBiquadFilter();
      highpass.type = "highpass";
      highpass.frequency.value = 80;
      highpass.Q.value = 0.7;
      source.connect(highpass);

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;               // ~21 ms a 48 kHz
      analyser.smoothingTimeConstant = 0;    // niente media: servono i valori del momento per vedere i clic
      highpass.connect(analyser);
      this.analyser = analyser;

      this.lookahead = ctx.createDelay(1.0);
      this.lookahead.delayTime.value = NOISE_FILTER.lookaheadMs() / 1000;
      this.gateGain = ctx.createGain();
      this.gateGain.gain.value = 0;
      highpass.connect(this.lookahead);
      this.lookahead.connect(this.gateGain);

      let cleanStream = stream;
      if (ctx.createMediaStreamDestination) {
        const dest = ctx.createMediaStreamDestination();
        this.gateGain.connect(dest);
        cleanStream = dest.stream;
      }
      this.processedStream = cleanStream;
      this._startAudioMonitor();
      return cleanStream;
    } catch (err) {
      console.warn("[AudioPipeline Error]", err);
      return stream;
    }
  },

  _startAudioMonitor() {
    if (!this.analyser) return;
    const an = this.analyser, ctx = this.audioCtx;
    const time = new Float32Array(an.fftSize);
    const spec = new Float32Array(an.frequencyBinCount);
    const binHz = ctx.sampleRate / an.fftSize;
    const b0 = Math.max(1, Math.round(125 / binHz)), b1 = Math.min(spec.length - 1, Math.round(5000 / binHz));
    const st = this.nf = { open: false, runStart: 0, lastActive: 0, frames: 0, voiced: 0, closeAt: 0, cut: this.nf?.cut || 0,
      lastCut: this.nf?.lastCut || 0, track: null, db: -100, thr: -60 };
    if (this.meterInterval) clearInterval(this.meterInterval);

    this.meterInterval = setInterval(() => {
      if (!this.active) return;
      const p = NOISE_FILTER.params();
      const now = performance.now();
      // Se la pagina viene rallentata (finestra dietro al gioco) il filtro non riesce a seguire la voce: lascia passare
      // l'audio, che il server filtra comunque (noise_filter.py) prima del riconoscimento.
      const late = st.lastTick && now - st.lastTick > 150;
      st.lastTick = now;
      if (late || st.bypassUntil > now) {
        if (late) st.bypassUntil = now + 3000;
        if (!st.open) { st.open = true; this.gateGain.gain.cancelScheduledValues(ctx.currentTime); this.gateGain.gain.setTargetAtTime(1, ctx.currentTime, 0.004); }
        st.closeAt = now + 300;
      }
      an.getFloatTimeDomainData(time);
      let sum = 0, zc = 0;
      for (let i = 0; i < time.length; i++) {
        sum += time[i] * time[i];
        if (i && (time[i] >= 0) !== (time[i - 1] >= 0)) zc++;
      }
      const db = 10 * Math.log10(sum / time.length + 1e-12);
      const zcr = zc / time.length;
      an.getFloatFrequencyData(spec);
      let logSum = 0, linSum = 0;
      for (let i = b0; i <= b1; i++) {
        const pw = Math.pow(10, (isFinite(spec[i]) ? spec[i] : -160) / 10) + 1e-16;
        logSum += Math.log(pw); linSum += pw;
      }
      const nb = b1 - b0 + 1;
      const flat = Math.exp(logSum / nb) / (linSum / nb);

      // Rumore di fondo: calibrato, oppure seguito dal vivo (scende subito, risale piano: 1 dB al secondo).
      st.track = st.track == null ? db : (db < st.track ? db : Math.min(st.track + 0.02, db));
      const cal = NOISE_FILTER.calibratedFloor();
      const floor = cal == null ? st.track : Math.min(cal, st.track + 6);
      const thr = Math.max(floor + p.margin_db, -60);
      st.db = db; st.thr = thr;
      const active = db >= thr;

      // Eventi: frame sopra soglia, buchi fino a 50 ms dentro lo stesso evento (come noise_filter.py).
      if (active) {
        if (!st.runStart || now - st.lastActive > 50) { st.runStart = now; st.frames = 0; st.voiced = 0; }
        st.lastActive = now;
        st.frames++;
        if (flat < 0.30 && zcr < 0.25) st.voiced++;
      } else if (st.runStart && now - st.lastActive > 50) {
        if (!st.open && st.qualifiedRun !== st.runStart) { st.cut++; st.lastCut = now; }  // evento finito senza diventare voce
        st.runStart = 0;
      }
      const runMs = st.runStart ? st.lastActive - st.runStart : 0;
      const isVoice = st.runStart && runMs >= p.min_ms && (!p.voiced_check || st.voiced / Math.max(1, st.frames) >= p.voiced_ratio);
      const D = NOISE_FILTER.lookaheadMs() / 1000;
      if (Math.abs(this.lookahead.delayTime.value - D) > 0.001) this.lookahead.delayTime.setValueAtTime(D, ctx.currentTime);
      if (isVoice) {
        st.qualifiedRun = st.runStart;
        if (!st.open) { st.open = true; this.gateGain.gain.cancelScheduledValues(ctx.currentTime); this.gateGain.gain.setTargetAtTime(1, ctx.currentTime, 0.004); }
        st.closeAt = now + 300;  // coda: la porta resta aperta 300 ms dopo l'ultima voce
      } else if (st.open && active && st.qualifiedRun === st.runStart) {
        st.closeAt = now + 300;
      } else if (st.open && now > st.closeAt && !(st.bypassUntil > now)) {
        st.open = false;
        st.closedAt = now;
        // chiude quando anche l'audio ritardato è arrivato alla fine della voce
        this.gateGain.gain.setTargetAtTime(0, ctx.currentTime + D, 0.015);
      }
      this._renderMeter(db, thr, st, now);

      // Se il copilota sta parlando dalle casse, il microfono non conta (eco della voce del copilota).
      if (isCopilotSpeaking()) {
        if (this.speaking && this.mediaRecorder && this.mediaRecorder.state === "recording") {
          this.speaking = false;
          this.audioChunks = [];
          this.discardNext = true;
          try { this.mediaRecorder.stop(); } catch (e) {}
        }
        return;
      }

      // Ascolto continuo: si registra solo quando la porta si apre (voce vera), non per un clic.
      if (this.mode === "continuous" && this.mediaRecorder) {
        if (st.open && !this.speaking && !this.isTranscribing && this.mediaRecorder.state === "inactive") {
          this.speaking = true;
          this.audioChunks = [];
          try {
            this.mediaRecorder.start();
            const tr = $("voice-hud-transcript");
            if (tr) tr.innerHTML = `<span style="color:var(--gold);font-weight:bold">&#x25cf; ASCOLTO IN CORSO...</span>`;
          } catch (e) {}
        } else if (!st.open && this.speaking && this.mediaRecorder.state === "recording" && now - (st.closedAt || 0) > 650) {
          this.speaking = false;
          try { this.mediaRecorder.stop(); } catch (e) {}
        }
      }
    }, 20);
  },

  // Indicatore di livello: barra in dBFS (da -80 a 0), tacca bianca = soglia del filtro.
  _renderMeter(db, thr, st, now) {
    const pos = v => Math.max(0, Math.min(100, (v + 80) / 80 * 100));
    const pct = Math.round(pos(db));
    const cls = st.open ? "open" : db >= thr ? "cand" : "low";
    for (const [fillId, pctId] of [["voice-meter-fill", "vh-meter-pct"], ["settings-meter-fill", "settings-meter-pct"]]) {
      const fill = $(fillId), lbl = $(pctId);
      if (fill) { fill.style.width = pct + "%"; fill.dataset.state = cls; }
      if (lbl) lbl.textContent = `${Math.round(db)} dB`;
    }
    const mark = $("settings-meter-thr");
    if (mark) mark.style.left = pos(thr) + "%";
    const thrLbl = $("nf-thr-val");
    if (thrLbl) thrLbl.textContent = `soglia ${Math.round(thr)} dB`;
    const cut = $("nf-cut-count");
    if (cut) cut.textContent = String(st.cut);
    const badge = $("settings-mic-badge");
    if (badge) {
      if (isCopilotSpeaking()) { badge.textContent = "COPILOTA PARLA"; badge.className = "tag dim"; }
      else if (st.open) { badge.textContent = "VOCE: PASSA"; badge.className = "tag gold"; }
      else if (now - st.lastCut < 600) { badge.textContent = "RUMORE TAGLIATO"; badge.className = "tag bad"; }
      else { badge.textContent = "IN ASCOLTO"; badge.className = "tag ok"; }
    }
  },

  // Misura per 2 secondi il rumore di fondo del microfono dell'app (mediana dei livelli, in dBFS).
  async calibrateNoise(seconds = 2) {
    let stream = null, ctx = null, own = false;
    try {
      if (this.micStream && this.audioCtx) { stream = this.micStream; ctx = this.audioCtx; }
      else {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("microfono non disponibile");
        stream = await navigator.mediaDevices.getUserMedia({ audio: this._micConstraints() });
        ctx = new (window.AudioContext || window.webkitAudioContext)();
        own = true;
      }
      const src = ctx.createMediaStreamSource(stream);
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass"; hp.frequency.value = 80;
      const an = ctx.createAnalyser();
      an.fftSize = 1024;
      src.connect(hp); hp.connect(an);
      const buf = new Float32Array(an.fftSize), vals = [];
      const t0 = performance.now();
      await new Promise(res => {
        const iv = setInterval(() => {
          an.getFloatTimeDomainData(buf);
          let s = 0;
          for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i];
          vals.push(10 * Math.log10(s / buf.length + 1e-12));
          if (performance.now() - t0 > seconds * 1000) { clearInterval(iv); res(); }
        }, 20);
      });
      try { src.disconnect(); } catch (e) {}
      vals.sort((a, b) => a - b);
      const floor = Math.round(vals[Math.floor(vals.length / 2)] * 10) / 10;
      localStorage.setItem("ed_mic_floor_db", String(floor));
      if (this.nf) this.nf.track = floor;
      return floor;
    } finally {
      if (own) {
        try { stream.getTracks().forEach(t => t.stop()); } catch (e) {}
        try { ctx.close(); } catch (e) {}
      }
    }
  },

  _micConstraints() {
    const savedDev = localStorage.getItem("ed_mic_device");
    return {
      deviceId: savedDev ? { exact: savedDev } : undefined,
      echoCancellation: localStorage.getItem("ed_mic_echo_cancel") !== "false",
      // Riduzione del rumore del browser (WebRTC): solo acceso/spento, la regola il browser. Il cursore
      // "Filtro rumori" è un'altra cosa (NOISE_FILTER, sotto) e funziona anche con questa spenta.
      noiseSuppression: localStorage.getItem("ed_mic_noise_supp") !== "false",
      autoGainControl: localStorage.getItem("ed_mic_auto_gain") !== "false",
      channelCount: 1
    };
  },

  _initRecorder(stream) {
    try {
      let mime = "";
      if (typeof MediaRecorder !== "undefined") {
        if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) mime = "audio/webm;codecs=opus";
        else if (MediaRecorder.isTypeSupported("audio/webm")) mime = "audio/webm";
        else if (MediaRecorder.isTypeSupported("audio/ogg;codecs=opus")) mime = "audio/ogg;codecs=opus";
      }
      this.mediaRecorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
      this.audioChunks = [];
      
      this.mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          this.audioChunks.push(e.data);
        }
      };

      this.mediaRecorder.onstop = () => {
        this._sendChunksToWhisper();
      };
    } catch(err) {
      console.warn("[MediaRecorder Init Error]", err);
    }
  },

  _sendChunksToWhisper() {
    if (this.discardNext) { this.discardNext = false; this.audioChunks = []; return; }
    if (isCopilotSpeaking()) {
      this.audioChunks = [];
      return;
    }
    if (!this.audioChunks || this.audioChunks.length === 0) return;
    const mime = (this.mediaRecorder && this.mediaRecorder.mimeType) || "audio/webm";
    const blob = new Blob(this.audioChunks, { type: mime });
    this.audioChunks = [];
    
    // Ignora click o impulsi brevissimi < 1500 byte
    if (blob.size < 1500) return;
    
    const tr = $("voice-hud-transcript");
    if (tr) {
      tr.innerHTML = `<span style="color:var(--gold)">&#x25cf; Trascrizione comando neurale...</span>`;
    }
    
    this.isTranscribing = true;
    fetch("/api/voice/transcribe", {
      method: "POST",
      headers: { "Content-Type": blob.type || "audio/webm" },
      body: blob
    })
    .then(r => r.json())
    .then(res => {
      this.isTranscribing = false;
      const text = (res && res.text) ? res.text.trim() : "";
      if (text) {
        if (tr) tr.innerHTML = `Comando: <b>${esc(text)}</b>`;
        this.dispatch(text);
      } else {
        if (tr && !this.pttActive) {
          tr.innerHTML = this.mode === "ptt" ?
            "Push-to-Talk pronto: tieni premuto <b>PARLA</b> o <b>spazio</b>" :
            "In ascolto continuo... pronuncia un comando";
        }
      }
    })
    .catch(err => {
      this.isTranscribing = false;
      console.warn("[Whisper Transcribe Error]", err);
    });
  },

  // Il riconoscimento avviene solo con Whisper (locale, sul server): vedi _sendChunksToWhisper.
  _initRecognition() {},

  async dispatch(raw) {
    if (isCopilotSpeaking()) {
      return;
    }
    if (voiceLang() === "en") return this._dispatchEn(raw);
    let text = raw.toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) return;

    // Prevent duplicate dispatch within 3.5 seconds
    const now = Date.now();
    if (this.lastDispatchedRaw === text && (now - this.lastDispatchedTime) < 3500) {
      return;
    }
    this.lastDispatchedRaw = text;
    this.lastDispatchedTime = now;

    // 0. Cose da fare: prima di tutto, perché il testo dettato può contenere parole di altri comandi
    //    ("ricordami di abbassare il carrello" non deve abbassare il carrello).
    const todoCmd = TODO_VOICE.parse(raw);
    if (todoCmd) { this._todoCommand(todoCmd, raw); return; }

    // Il riconoscimento sbaglia spesso di una o due lettere ("ricchiesta attrago", "mappagallattica"): se nessuna frase
    // dei comandi compare esatta, si prende la frase più simile, solo se lo è davvero (vedi closestPhrase).
    const known = [...CONTROLS, ...MACROS].flatMap(x => (x.say || "").split(";")).map(s => s.toLowerCase()
      .normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim()).filter(Boolean);
    if (!known.some(p => saidPhrase(text, p))) {
      const near = closestPhrase(text, known);
      if (near) text = near;
    }

    // 1. Match custom ship controls first
    for (const c of CONTROLS) {
      const phrases = (c.say || "").split(";").map(s => s.toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ").trim()).filter(Boolean);
      if (phrases.some(p => saidPhrase(text, p))) {
        this._recordAction(c.name, raw);
        const tr = $("voice-hud-transcript");
        if (tr) tr.innerHTML = `<span style="color:var(--ok)">&#x2714; Controllo Nave: <b>${esc(c.name)}</b></span>`;
        const v = ttsVoiceKey();
        const vol = SETTINGS.ttsVolume != null ? SETTINGS.ttsVolume : 100;
        fetch(`/api/voice/ship_control?action=${encodeURIComponent(c.id)}&voice=${v}&volume=${vol}`).catch(()=>{});
        return;
      }
    }

    // 2. Match custom macros
    for (const m of MACROS) {
      const phrases = (m.say || "").split(";").map(s => s.toLowerCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9\s]/g, " ")
        .replace(/\s+/g, " ").trim()).filter(Boolean);
      if (phrases.some(p => saidPhrase(text, p))) {
        this._recordAction(m.name, raw);
        const tr = $("voice-hud-transcript");
        if (tr) tr.innerHTML = `<span style="color:var(--ok)">&#x2714; Macro: <b>${esc(m.name)}</b></span>`;
        fetch(`/api/voice/macro?id=${encodeURIComponent(m.id)}&voice=${encodeURIComponent(ttsVoiceKey())}`).catch(()=>{});
        return;
      }
    }
    
    const has = (...words) => words.some(w => saidPhrase(text, w));
    let act = null;
    let desc = "";
    
    if (has("abbassa carrello", "estrai carrello", "carrello giu", "apri carrello")) {
      act = "gear_down"; desc = "Carrello abbassato";
    } else if (has("alza carrello", "ritira carrello", "chiudi carrello", "carrello su")) {
      act = "gear_up"; desc = "Carrello ritirato";
    } else if (has("carrello")) {
      act = "gear_toggle"; desc = "Carrello azionato";
    } else if (has("apri stiva", "estrai stiva", "apri portellone", "portellone aperto")) {
      act = "cargo_open"; desc = "Boccaporto stiva aperto";
    } else if (has("chiudi stiva", "ritira stiva", "chiudi portellone", "portellone chiuso")) {
      act = "cargo_close"; desc = "Boccaporto stiva chiuso";
    } else if (has("accendi luci", "accendi fari", "fari accesi", "luci accese", "luci on")) {
      act = "lights_on"; desc = "Fari nave accesi";
    } else if (has("spegni luci", "spegni fari", "fari spenti", "luci spente", "luci off")) {
      act = "lights_off"; desc = "Fari nave spenti";
    } else if (has("visione notturna", "notturna")) {
      act = "night_vision"; desc = "Visione notturna azionata";
    } else if (has("estrai armi", "armi fuori", "armi pronte", "armi attive")) {
      act = "hardpoints_deploy"; desc = "Punti d'ancoraggio armi estratti";
    } else if (has("ritira armi", "armi dentro", "armi via", "chiudi armi")) {
      act = "hardpoints_retract"; desc = "Punti d'ancoraggio armi ritirati";
    } else if (has("ferma nave", "motori fermi", "velocita zero", "arresta nave") || text === "stop") {
      act = "stop"; desc = "Propulsione a zero";
    } else if (has("settantacinque", "75 percento", "avvicinamento supercruise", "velocita avvicinamento")) {
      act = "throttle75"; desc = "Manetta al 75%";
    } else if (has("mappa galattica", "galmap")) {
      act = "galmap"; desc = "Mappa galattica";
    } else if (has("mappa di sistema", "mappa sistema", "sysmap")) {
      act = "sysmap"; desc = "Mappa di sistema";
    }
    
    const tr = $("voice-hud-transcript");
    if (act) {
      this._recordAction(desc, raw);
      if (tr) tr.innerHTML = `<span style="color:var(--ok)">&#x2714; Azione: <b>${esc(desc)}</b></span>`;
      fetch(`/api/voice/ship_control?action=${act}`).catch(()=>{});
      return;
    }
    
    // Telemetry & Reports
    if (has("stazione coriolis", "stato coriolis", "cantiere coriolis", "materiali coriolis", "coriolis")) {
      const cs = getCoriolisStation();
      let totalReq = 0, totalDone = 0;
      Object.values(cs.materials).forEach(m => {
        totalReq += (m.req || 0);
        totalDone += Math.min(m.req || 0, m.done || 0);
      });
      const pct = totalReq ? Math.min(100, Math.round((totalDone / totalReq) * 100)) : 0;
      const left = Math.max(0, totalReq - totalDone);
      const cap = cs.cargoShipCap || 752;
      const trips = Math.ceil(left / cap);
      
      this._recordAction("Stato Stazione Coriolis", raw);
      const tr = $("voice-hud-transcript");
      if (tr) tr.innerHTML = `<span style="color:var(--ok)">&#x2714; Rapporto Cantiere Coriolis: <b>${pct}%</b></span>`;
      
      let speech = "";
      if (left === 0) {
        speech = `Comandante, la stazione Coriolis ${cs.name} e completata al cento per cento ed e pienamente operativa nel sistema ${cs.system}.`;
      } else {
        speech = `Cantiere Stazione Coriolis ${cs.name}: completato al ${pct} percento. Mancano ${left} tonnellate di materiali, circa ${trips} viaggi cargo.`;
      }
      speak(speech);
      return;
    }
    if (has("rapporto nave", "stato nave", "situazione nave", "rapporto generale", "rapporto")) {
      this._recordAction("Rapporto di bordo", raw);
      if (tr) tr.innerHTML = `<span style="color:var(--ok)">&#x2714; Rapporto di bordo</span>`;
      speakReport("all");
      return;
    }
    if (has("carburante", "quanto carburante", "stato carburante")) {
      this._recordAction("Controllo carburante", raw);
      if (tr) tr.innerHTML = `<span style="color:var(--ok)">&#x2714; Controllo carburante</span>`;
      speakReport("fuel");
      return;
    }
    if (has("stato stiva", "materiali", "quanto carico") || text === "stiva") {
      this._recordAction("Controllo carico stiva", raw);
      if (tr) tr.innerHTML = `<span style="color:var(--ok)">&#x2714; Controllo carico stiva</span>`;
      speakReport("cargo");
      return;
    }
    if (has("integrita scudo", "stato scudi", "danni", "danni scafo") || text === "scudi") {
      this._recordAction("Integrita scudi e scafo", raw);
      if (tr) tr.innerHTML = `<span style="color:var(--ok)">&#x2714; Integrita scudi e scafo</span>`;
      speakReport("damage");
      return;
    }
    if (has("prossimo salto", "destinazione", "prossimo sistema") || text === "rotta") {
      this._recordAction("Prossimo salto di rotta", raw);
      if (tr) tr.innerHTML = `<span style="color:var(--ok)">&#x2714; Prossimo salto di rotta</span>`;
      speakReport("route");
      return;
    }
    // Fleet carrier: "carrier più vicino" (anche con un servizio) oppure "cerca il carrier <nome o codice>".
    {
      const named = text.match(/(?:cerca|trova|dove (?:si trova|e|sta)|posizione (?:del|di))\s+(?:il\s+|la\s+)?(?:fleet\s+)?carrier\s+(.+)$/);
      if (named || (/carrier/.test(text) && /(piu vicin[oa]|vicin[oa] a me|vicin[oa])/.test(text))) {
        const name = named ? named[1].replace(/(per favore|grazie)/g, "").trim() : "";
        const svc = name ? "" : (nearestServiceIt(text) === "Refuel" && !/rifornimento|carburante/.test(text) ? "" : nearestServiceIt(text));
        this._recordAction(name ? `Cerca carrier ${name}` : "Fleet carrier più vicino", raw);
        if (tr) tr.innerHTML = `<span style="color:var(--ok)">&#x2714; ${name ? "Cerca carrier: <b>" + esc(name) + "</b>" : "Fleet carrier più vicino"}</span>`;
        const v = ttsVoiceKey(), vol = SETTINGS.ttsVolume != null ? SETTINGS.ttsVolume : 100;
        fetch(`/api/voice/carrier?play=1&name=${encodeURIComponent(name)}&service=${encodeURIComponent(svc)}&voice=${encodeURIComponent(v)}&volume=${vol}`).catch(() => {});
        return;
      }
    }
    // Stazione più vicina, anche con un servizio: "stazione più vicina con riparazioni", "material trader più vicino".
    if (/(piu vicin[oa]|vicin[oa] a me|piu vicine)/.test(text) && /(base|stazion[ei]|porto|spazioporto|attracc\w*|material trader|mercante|broker|riparazion\w*|ripara\w*|rifornimento|carburante|cartograf\w*|genomics|interstellar|factors|cantiere|outfitting|equipaggiamento|mercato nero)/.test(text)) {
      const svc = nearestServiceIt(text);
      this._recordAction("Stazione più vicina", raw);
      if (tr) tr.innerHTML = `<span style="color:var(--ok)">&#x2714; Stazione più vicina</span>`;
      const v = ttsVoiceKey(), vol = SETTINGS.ttsVolume != null ? SETTINGS.ttsVolume : 100;
      fetch(`/api/voice/nearest?play=1&service=${encodeURIComponent(svc)}&voice=${encodeURIComponent(v)}&volume=${vol}`).catch(() => {});
      return;
    }
    if (has("copia destinazione", "copia rotta", "copia sistema", "copia prossimo")) {
      this._recordAction("Copia destinazione negli appunti", raw);
      if (tr) tr.innerHTML = `<span style="color:var(--ok)">&#x2714; Copia rotta</span>`;
      fetch("/api/voice/copy-next?play=1").catch(()=>{});
      return;
    }
    if (has("esobiologia", "distanza esobiologia", "batteri", "esobio")) {
      this._recordAction("Distanza esobiologia", raw);
      if (tr) tr.innerHTML = `<span style="color:var(--ok)">&#x2714; Distanza esobiologia</span>`;
      speakReport("bio");
      return;
    }
    if (has("consigli", "consiglio", "cosa faccio", "suggerimento")) {
      this._recordAction("Richiesta suggerimenti tattici", raw);
      if (tr) tr.innerHTML = `<span style="color:var(--ok)">&#x2714; Suggerimenti tattici</span>`;
      speakReport("advice");
      return;
    }
    
    if (tr) tr.innerHTML = `Non riconosciuto: <span style="color:var(--hud-hi)">"${esc(raw)}"</span>`;
  },
  
  // Comandi in inglese (interfaccia in inglese): stessa sequenza di dispatch, con la grammatica VOICE_GRAMMAR_EN.
  // Ordine: cose da fare → comandi della nave della grammatica → controlli e macro (frasi salvate, nome, frasi
  // inglesi di fabbrica) → rapporti.
  _dispatchEn(raw) {
    const text = voiceNormEn(raw);
    if (!text) return;
    const now = Date.now();
    if (this.lastDispatchedRaw === text && (now - this.lastDispatchedTime) < 3500) return;
    this.lastDispatchedRaw = text;
    this.lastDispatchedTime = now;
    const tr = $("voice-hud-transcript");
    const show = html => { if (tr) tr.innerHTML = html; };

    const todoCmd = TODO_VOICE_EN.parse(raw);
    if (todoCmd) { this._todoCommand(todoCmd, raw); return; }

    // Fleet carriers: "nearest carrier" (optionally with a service) or "find carrier <name or callsign>".
    {
      const named = text.match(/(?:find|search for|locate|where is)\s+(?:the\s+)?(?:fleet\s+)?carrier\s+(.+)$/);
      if (named || (/carrier/.test(text) && /(nearest|closest|near me|nearby)/.test(text))) {
        const name = named ? named[1].replace(/please/g, "").trim() : "";
        const svc = name ? "" : (nearestServiceEn(text) === "Refuel" && !/fuel/.test(text) ? "" : nearestServiceEn(text));
        this._recordAction(name ? `Find carrier ${name}` : "Nearest fleet carrier", raw);
        show(`<span style="color:var(--ok)">&#x2714; ${name ? "Find carrier: <b>" + esc(name) + "</b>" : "Nearest fleet carrier"}</span>`);
        const v = ttsVoiceKey(), vol = SETTINGS.ttsVolume != null ? SETTINGS.ttsVolume : 100;
        fetch(`/api/voice/carrier?play=1&name=${encodeURIComponent(name)}&service=${encodeURIComponent(svc)}&voice=${encodeURIComponent(v)}&volume=${vol}`).catch(() => {});
        return;
      }
    }

    const ship = matchGrammarEn(text, g => !!g.act);
    if (ship) {
      this._recordAction(ship.desc, raw);
      show(`<span style="color:var(--ok)">&#x2714; Action: <b>${esc(ship.desc)}</b></span>`);
      const v = ttsVoiceKey(), vol = SETTINGS.ttsVolume != null ? SETTINGS.ttsVolume : 100;
      fetch(`/api/voice/ship_control?action=${encodeURIComponent(ship.act)}&voice=${encodeURIComponent(v)}&volume=${vol}`).catch(() => {});
      return;
    }

    const phrasesOf = item => [...(item.say || "").split(";"), item.name || "", ...(VOICE_BUILTIN_SAY_EN[item.id] || [])]
      .map(voiceNormEn).filter(Boolean);
    for (const c of CONTROLS) {
      if (phrasesOf(c).some(p => saidPhrase(text, p))) {
        this._recordAction(c.name, raw);
        show(`<span style="color:var(--ok)">&#x2714; Ship control: <b>${esc(c.name)}</b></span>`);
        const v = ttsVoiceKey(), vol = SETTINGS.ttsVolume != null ? SETTINGS.ttsVolume : 100;
        fetch(`/api/voice/ship_control?action=${encodeURIComponent(c.id)}&voice=${encodeURIComponent(v)}&volume=${vol}`).catch(() => {});
        return;
      }
    }
    for (const m of MACROS) {
      if (phrasesOf(m).some(p => saidPhrase(text, p))) {
        this._recordAction(m.name, raw);
        show(`<span style="color:var(--ok)">&#x2714; Macro: <b>${esc(m.name)}</b></span>`);
        fetch(`/api/voice/macro?id=${encodeURIComponent(m.id)}&voice=${encodeURIComponent(ttsVoiceKey())}`).catch(() => {});
        return;
      }
    }

    const g = matchGrammarEn(text, g => !g.act);
    if (!g) {
      show(`Not recognised: <span style="color:var(--hud-hi)">"${esc(raw)}"</span>`);
      return;
    }
    this._recordAction(g.desc, raw);
    if (g.do === "coriolis") {
      const cs = getCoriolisStation();
      let totalReq = 0, totalDone = 0;
      Object.values(cs.materials).forEach(m => { totalReq += (m.req || 0); totalDone += Math.min(m.req || 0, m.done || 0); });
      const pct = totalReq ? Math.min(100, Math.round((totalDone / totalReq) * 100)) : 0;
      const left = Math.max(0, totalReq - totalDone);
      const trips = Math.ceil(left / (cs.cargoShipCap || 752));
      show(`<span style="color:var(--ok)">&#x2714; Coriolis construction report: <b>${pct}%</b></span>`);
      speak(left === 0
        ? `CMDR, Coriolis station ${cs.name} is one hundred percent complete and fully operational in the ${cs.system} system.`
        : `Coriolis station ${cs.name} construction: ${pct} percent complete. ${left} tonnes of materials to go, about ${trips} cargo ${trips === 1 ? "trip" : "trips"}.`);
      return;
    }
    show(`<span style="color:var(--ok)">&#x2714; ${esc(g.desc)}</span>`);
    if (g.do === "copy") { fetch("/api/voice/copy-next?play=1").catch(() => {}); return; }
    if (g.do === "nearest") {
      const v = ttsVoiceKey(), vol = SETTINGS.ttsVolume != null ? SETTINGS.ttsVolume : 100;
      fetch(`/api/voice/nearest?play=1&service=${encodeURIComponent(nearestServiceEn(text))}&voice=${encodeURIComponent(v)}&volume=${vol}`).catch(() => {});
      return;
    }
    speakReport(g.report);
  },

  // Esegue un comando "da fare". La voce in cronologia si scrive subito (prima di qualsiasi await):
  // handleRemoteVoice (main.js) la legge appena dopo dispatch() per rispondere al telefono.
  _todoCommand(cmd, raw) {
    const TV = voiceLang() === "en" ? TODO_VOICE_EN : TODO_VOICE;
    const vl = (it, en) => voiceLang() === "en" ? en : it;
    const tr = $("voice-hud-transcript");
    const show = (html) => { if (tr) tr.innerHTML = html; };
    const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const reload = async () => { try { TODOS = await api("/api/todos"); } catch (e) {} return TODOS.filter(t => !t.done); };
    const save = async () => { TODOS = await api("/api/todos", TODOS); if (typeof renderView === "function") renderView(); };
    if (cmd.kind === "add") {
      this._recordAction(vl(`Da fare aggiunto: ${cmd.text}`, `To-do added: ${cmd.text}`), raw);
      show(`<span style="color:var(--ok)">&#x2714; ${vl("Da fare", "To-do")}: <b>${esc(cmd.text)}</b></span>`);
      (async () => {
        await reload();
        if (!TODOS.some(t => !t.done && TV.norm(t.text) === TV.norm(cmd.text))) {
          TODOS.push({ id: newId(), text: cmd.text, category: "Generale", system: "", done: false, created: new Date().toISOString() });
          await save();
        }
        replySpeak(vl(`Aggiunto alle cose da fare: ${cmd.text}.`, `Added to your to-do list: ${cmd.text}.`));
      })().catch(e => {
        toast(vl("Da fare non salvato: ", "To-do not saved: ") + e.message);
        replySpeak(vl("Non sono riuscito a salvare la cosa da fare.", "I couldn't save the to-do."));
      });
      return;
    }
    if (cmd.kind === "read") {
      this._recordAction(vl("Lettura cose da fare", "Reading the to-do list"), raw);
      show(`<span style="color:var(--ok)">&#x2714; ${vl("Cose da fare", "To-do list")}</span>`);
      reload().then(open => replySpeak(TV.readText(open)));
      return;
    }
    // "done": si cerca sull'elenco già in memoria (lo stesso letto da "cosa devo fare"), così la cronologia è immediata.
    const open = TODOS.filter(t => !t.done);
    const res = TV.match(cmd.query, open);
    if (res.item) {
      this._recordAction(vl(`Da fare completato: ${res.item.text}`, `To-do done: ${res.item.text}`), raw);
      show(`<span style="color:var(--ok)">&#x2714; ${vl("Fatto", "Done")}: <b>${esc(res.item.text)}</b></span>`);
      res.item.done = true;
      save().then(() => replySpeak(vl(`Segnato come fatto: ${res.item.text}.`, `Marked as done: ${res.item.text}.`)))
        .catch(e => { res.item.done = false; toast(vl("Errore nel salvataggio: ", "Save failed: ") + e.message); });
    } else if (res.ambiguous) {
      this._recordAction(vl(`Non riconosciuto: più cose da fare corrispondono a "${cmd.query}"`,
        `Not recognised: more than one to-do matches "${cmd.query}"`), raw);
      show(`<span style="color:var(--warn,var(--gold))">${vl("Più voci corrispondono", "More than one item matches")}: ${res.ambiguous.map(t => esc(t.text)).join(" · ")}</span>`);
      replySpeak(vl(`Ho trovato più cose da fare simili: ${res.ambiguous.map(t => t.text).join("; ")}. Dimmi il numero o qualche parola in più. Non ho segnato niente.`,
        `I found several similar to-dos: ${res.ambiguous.map(t => t.text).join("; ")}. Tell me the number or a few more words. Nothing was marked.`));
    } else {
      this._recordAction(vl(`Non riconosciuto: nessuna cosa da fare corrisponde a "${cmd.query}"`,
        `Not recognised: no to-do matches "${cmd.query}"`), raw);
      show(vl(`Nessuna cosa da fare corrisponde a <b>${esc(cmd.query)}</b>`, `No to-do matches <b>${esc(cmd.query)}</b>`));
      replySpeak(vl(`Non trovo nessuna cosa da fare che corrisponda a ${cmd.query}.`, `I can't find a to-do matching ${cmd.query}.`));
    }
  },

  _recordAction(name, raw) {
    this.history.unshift({ name, raw, time: new Date().toLocaleTimeString() });
    if (this.history.length > 20) this.history.pop();
    const hl = $("voice-history-list");
    if (hl) {
      hl.innerHTML = this.history.map(h => 
        `<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid rgba(255,138,31,0.1)">
          <span>&#x25cf; <b>${esc(h.name)}</b> <span class="sub" style="font-size:10px">("${esc(h.raw)}")</span></span>
          <span class="sub mono" style="font-size:10px">${h.time}</span>
        </div>`
      ).join("");
    }
  },

  updateUI() {
    const dot = $("prop-voice-dot");
    const label = $("prop-voice-label");
    const bar = $("voice-hud-bar");
    const pttBtn = $("btn-ptt-hud");
    const modeBtn = $("voice-mode-toggle-btn");
    
    if (dot) dot.className = "live-dot " + (this.active ? "on" : "");
    if (label) label.textContent = "Copilota Vocale: " + (this.active ? "ATTIVO" : "OFF");
    if (bar) bar.style.display = this.active ? "flex" : "none";
    if (pttBtn) pttBtn.style.display = (this.active && this.mode === "ptt") ? "inline-block" : "none";
    if (modeBtn) modeBtn.innerHTML = this.mode === "ptt" ? "&#x25c6; PTT (Spazio)" : "&#x25c6; Continuo";
    
    const setBtn = $("btn-toggle-prop-voice");
    if (setBtn) {
      setBtn.innerHTML = this.active ? "&#x25a0; Disattiva Copilota Vocale" : "&#x25b6; Attiva Copilota Vocale";
      setBtn.className = this.active ? "small danger" : "small ok";
    }
    const setModeBtn = $("settings-voice-mode-btn");
    if (setModeBtn) {
      setModeBtn.innerHTML = this.mode === "ptt" ? "Modalita: Push-to-Talk (Spazio)" : "Modalita: Ascolto Continuo";
    }
  }
};

// Servizio chiesto a voce per "stazione più vicina" (nomi come in gamedata.SERVICES); senza servizio basta il rifornimento.
function nearestServiceIt(text) {
  const rules = [[/material trader|mercante di material/, "Material Trader"], [/broker|tecnologic/, "Technology Broker"],
    [/interstellar|factors|taglie|multe/, "Interstellar Factors Contact"], [/cartograf|vendere i dati|dati esplorativi/, "Universal Cartographics"],
    [/genomics|dati biologici|esobiologi/, "Vista Genomics"], [/cantiere|shipyard|comprare (una )?nave/, "Shipyard"],
    [/outfitting|equipaggiamento|moduli/, "Outfitting"], [/mercato nero/, "Black Market"], [/ripara/, "Repair"],
    [/rifornimento|carburante|benzina/, "Refuel"]];
  return (rules.find(([re]) => re.test(text)) || [null, "Refuel"])[1];
}
function nearestServiceEn(text) {
  const rules = [[/material trader/, "Material Trader"], [/broker/, "Technology Broker"], [/interstellar|factors|bount|fines/, "Interstellar Factors Contact"],
    [/cartograph|sell (my )?data|exploration data/, "Universal Cartographics"], [/genomics|bio data|exobio/, "Vista Genomics"],
    [/shipyard|buy a ship/, "Shipyard"], [/outfitting|modules/, "Outfitting"], [/black market/, "Black Market"], [/repair/, "Repair"],
    [/refuel|fuel/, "Refuel"]];
  return (rules.find(([re]) => re.test(text)) || [null, "Refuel"])[1];
}

// Distanza di modifica (Levenshtein): quante lettere vanno cambiate, aggiunte o tolte per passare da a a b.
function editDistance(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

// Frase nota più simile a ciò che è stato detto, confrontando senza spazi ("mappa galattica" = "mappagalattica").
// Solo frasi di almeno 7 lettere, somiglianza almeno 82% e un vincitore netto: meglio "non riconosciuto" che un
// comando sbagliato.
function closestPhrase(text, phrases) {
  const said = text.replace(/\s/g, "");
  if (said.length < 5) return null;
  const scored = [...new Set(phrases)].map(p => {
    const q = p.replace(/\s/g, "");
    if (q.length < 7 || Math.abs(q.length - said.length) > Math.max(3, q.length * 0.3)) return null;
    return { p, score: 1 - editDistance(said, q) / Math.max(said.length, q.length) };
  }).filter(x => x && x.score >= 0.82).sort((a, b) => b.score - a.score);
  if (!scored.length || (scored[1] && scored[0].score - scored[1].score < 0.05)) return null;
  return scored[0].p;
}

// Vero se la frase compare intera, parola per parola, in ciò che è stato detto.
function saidPhrase(text, phrase) {
  return !!phrase && (" " + text + " ").includes(" " + phrase + " ");
}

// Il rapporto lo compone e lo pronuncia il server, con la voce scelta.
function speakReport(kind) {
  const v = ttsVoiceKey(), vol = SETTINGS.ttsVolume ?? 100;
  fetch(`/api/voice/play?type=${kind}&voice=${encodeURIComponent(v)}&volume=${vol}`).catch(() => {});
}

// Risposta a un comando vocale con una frase libera: la pronuncia il server come gli altri rapporti
// (stessa voce, stessi effetti, e il microfono resta sordo mentre parla).
function replySpeak(text) {
  const v = ttsVoiceKey(), vol = SETTINGS.ttsVolume ?? 100;
  if (v === "sapi") { speak(text); return; }
  fetch(`/api/voice/play?text=${encodeURIComponent(text)}&voice=${encodeURIComponent(v)}&volume=${vol}`).catch(() => speak(text));
}

async function saveMacros(list) {
  try {
    MACROS = await api("/api/macros", list);
    toast(t("Macro salvata con successo"));
  } catch (e) {
    toast(t("Errore salvataggio macro: ") + e.message);
  }
  renderView();
}


// PTT Pointer and Keyboard Events
document.addEventListener("pointerdown", e => {
  if (e.target.id === "btn-ptt-hud" || e.target.closest("#btn-ptt-hud")) {
    e.preventDefault();
    VOICE_ENGINE.pttDown();
  }
});
document.addEventListener("pointerup", e => {
  if (VOICE_ENGINE.pttActive) {
    VOICE_ENGINE.pttUp();
  }
});
document.addEventListener("keydown", e => {
  // Push-to-Talk key configuration capture
  if (VOICE_ENGINE.listeningPttKey) {
    e.preventDefault();
    e.stopPropagation();
    VOICE_ENGINE.setPttKey(e.code, e.key);
    return;
  }

  // Ship Control key recording capture
  if (UI.recordingCtrlKey) {
    e.preventDefault();
    e.stopPropagation();
    const rawKey = formatKeyFriendlyName(e.code, e.key);
    const keyInput = $("ctrl-input-key");
    if (keyInput) { keyInput.value = rawKey; UI.dirty.set(keyInput.id, rawKey); }
    const btn = $("ctrl-record-key-btn");
    if (btn) {
      btn.innerHTML = "&#x25cf; Premi Tasto da Tastiera";
      btn.style.borderColor = "";
      btn.style.color = "";
    }
    UI.recordingCtrlKey = false;
    toast(t(`Tasto assegnato: [ ${rawKey} ]`));
    return;
  }

  // Macro recorder capture
  if (MACRO_RECORDER.recording) {
    if (e.code === "Escape") {
      e.preventDefault();
      MACRO_RECORDER.stop();
      return;
    }
    const act = document.activeElement;
    if (act && (act.id === "macro-input-name" || act.id === "macro-input-say" || act.id === "macro-input-voice" || act.id === "macro-input-desc")) {
      return;
    }
    e.preventDefault();
    MACRO_RECORDER.recordKey(e.code);
    return;
  }

  // Live Push-to-Talk activation
  const pttTargetCode = VOICE_ENGINE.pttKeyCode || "Space";
  if (e.code === pttTargetCode && VOICE_ENGINE.mode === "ptt" && VOICE_ENGINE.active) {
    if (!document.activeElement?.matches("input, textarea, select")) {
      e.preventDefault();
      if (VOICE_ENGINE.pttBehavior === "toggle") {
        if (!e.repeat) {
          if (VOICE_ENGINE.pttActive) VOICE_ENGINE.pttUp();
          else VOICE_ENGINE.pttDown();
        }
      } else {
        if (!e.repeat) VOICE_ENGINE.pttDown();
      }
    }
  }
});

document.addEventListener("keyup", e => {
  const pttTargetCode = VOICE_ENGINE.pttKeyCode || "Space";
  if (e.code === pttTargetCode && VOICE_ENGINE.mode === "ptt" && VOICE_ENGINE.pttBehavior !== "toggle" && VOICE_ENGINE.pttActive) {
    if (!document.activeElement?.matches("input, textarea, select")) {
      e.preventDefault();
      VOICE_ENGINE.pttUp();
    }
  }
});
