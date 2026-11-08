"use strict";

// ============================================================================
// COPILOTA VOCALE (TTS AUDIO)
// ============================================================================
const _ttsAlerted = {
  lastSystem: null,
  starAlerted: false,
  terraformable: false,
  elw: false,
  waterWorld: false,
  allFound: false,
  bioColony: false,
  lastBioStep: null,
  fsdAlerted: false,
  lowFuelAlerted: false
};

let _copilotSpeakingUntil = 0;

function markCopilotSpeaking(extraMs = 1500) {
  _copilotSpeakingUntil = Math.max(_copilotSpeakingUntil, Date.now() + extraMs);
}

function isCopilotSpeaking() {
  return Date.now() < _copilotSpeakingUntil;
}

// --- Effetti sulla voce (WebAudio) -------------------------------------------------------------
// Stesse ricette e stessi numeri di app/voice_fx.py (che le applica alla voce che parte dal PC): tienili allineati.
// L'audio della voce viene elaborato con un OfflineAudioContext (filtri biquad, riverbero a convoluzione,
// modulazione ad anello, chorus, compressore, distorsione), poi mescolato all'originale secondo l'intensità.
const TTS_FX = {
  ctx: null,
  ids: ["naturale", "computer", "robotico", "ia", "radio", "casco"],
  config() {
    const c = (typeof S !== "undefined" && S && S.voice_config) || {};
    const amt = c.tts_fx_amount;
    return { effect: this.ids.includes(c.tts_effect) ? c.tts_effect : "naturale",
             amount: amt != null && Number.isFinite(+amt) ? Math.max(0, Math.min(100, +amt)) / 100 : 0.7,
             rate: +c.tts_rate || 0, pitch: +c.tts_pitch || 0 };
  },
  audioCtx() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!this.ctx) this.ctx = new AC();
    if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
    return this.ctx;
  },
  _rand(seed) {  // generatore pseudo-casuale con seme (mulberry32): il riverbero suona sempre uguale
    return () => {
      seed |= 0; seed = seed + 0x6D2B79F5 | 0;
      let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  },
  // Risposta all'impulso: rumore gaussiano che decade di 60 dB in "decay" secondi (come voice_fx._impulse).
  _impulse(ctx, decay) {
    const n = Math.floor(ctx.sampleRate * decay), buf = ctx.createBuffer(1, n, ctx.sampleRate), d = buf.getChannelData(0);
    const r = this._rand(7);
    let e = 0;
    for (let i = 0; i < n; i++) {
      const g = Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());  // Box-Muller
      d[i] = g * Math.pow(10, -3 * (i / ctx.sampleRate) / decay);
      e += d[i] * d[i];
    }
    const k = 1 / Math.sqrt(e);
    for (let i = 0; i < n; i++) d[i] *= k;
    return buf;
  },
  _filter(ctx, type, f, q = 0.7071) {
    const b = ctx.createBiquadFilter();
    b.type = type; b.frequency.value = f; b.Q.value = q;
    return b;
  },
  _reverb(ctx, input, decay, wet) {
    const out = ctx.createGain(), conv = ctx.createConvolver(), g = ctx.createGain();
    conv.normalize = false;
    conv.buffer = this._impulse(ctx, decay);
    g.gain.value = wet;
    input.connect(out); input.connect(conv); conv.connect(g); g.connect(out);
    return out;
  },
  _shaper(ctx, input, fn) {
    const w = ctx.createWaveShaper(), n = 65536, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) curve[i] = fn(i / (n - 1) * 2 - 1);
    w.curve = curve;
    input.connect(w);
    return w;
  },
  // Costruisce la catena dell'effetto e restituisce l'ultimo nodo.
  _chain(ctx, src, name, dur) {
    if (name === "computer") {
      const hp = this._filter(ctx, "highpass", 300), lp = this._filter(ctx, "lowpass", 4000);
      src.connect(hp); hp.connect(lp);
      return this._reverb(ctx, lp, 0.6, 0.18);
    }
    if (name === "robotico") {
      // modulazione ad anello a 50 Hz al 60%: guadagno = 0.4 + 0.6 sin(2 pi 50 t)
      const ring = ctx.createGain(), osc = ctx.createOscillator(), depth = ctx.createGain();
      ring.gain.value = 0.4; osc.frequency.value = 50; depth.gain.value = 0.6;
      osc.connect(depth); depth.connect(ring.gain); osc.start();
      src.connect(ring);
      return this._shaper(ctx, ring, x => Math.round(x * 128) / 128);  // 8 bit
    }
    if (name === "ia") {
      // chorus: copia ritardata di 18 ms +/- 3 ms (oscillazione a 0.25 Hz) al 35%, poi stanza piccola e compressore
      const sum = ctx.createGain(), dl = ctx.createDelay(0.1), lfo = ctx.createOscillator(), lfoG = ctx.createGain(), mix = ctx.createGain();
      dl.delayTime.value = 0.018; lfo.frequency.value = 0.25; lfoG.gain.value = 0.003; mix.gain.value = 0.35;
      lfo.connect(lfoG); lfoG.connect(dl.delayTime); lfo.start();
      src.connect(sum); src.connect(dl); dl.connect(mix); mix.connect(sum);
      const rev = this._reverb(ctx, sum, 0.4, 0.12);
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -20; comp.ratio.value = 3; comp.knee.value = 0; comp.attack.value = 0.003; comp.release.value = 0.05;
      rev.connect(comp);
      return comp;
    }
    if (name === "radio") {
      const hp = this._filter(ctx, "highpass", 500), lp = this._filter(ctx, "lowpass", 2800);
      src.connect(hp); hp.connect(lp);
      const k = Math.tanh(3);
      const dist = this._shaper(ctx, lp, x => Math.tanh(3 * x) / k);
      // scatto dello squelch a fine trasmissione: 70 ms di fruscio filtrato a 2 kHz con attacco netto
      const out = ctx.createGain();
      dist.connect(out);
      const n = Math.floor(ctx.sampleRate * 0.07), nb = ctx.createBuffer(1, n, ctx.sampleRate), d = nb.getChannelData(0), r = this._rand(3);
      for (let i = 0; i < n; i++) d[i] = (r() * 2 - 1) * Math.pow(1 - i / n, 2) * 0.35;
      const ns = ctx.createBufferSource(), bp = this._filter(ctx, "bandpass", 2000, 0.8);
      ns.buffer = nb; ns.connect(bp); bp.connect(out); ns.start(dur);
      return out;
    }
    // casco
    const lp = this._filter(ctx, "lowpass", 2800);
    src.connect(lp);
    return this._reverb(ctx, lp, 0.15, 0.25);
  },
  async render(buffer, name, amount) {
    if (!this.ids.includes(name) || name === "naturale" || amount <= 0 || typeof OfflineAudioContext === "undefined") return buffer;
    const sr = buffer.sampleRate, tail = { computer: 0.6, ia: 0.4, casco: 0.15, radio: 0.08 }[name] || 0;
    const off = new OfflineAudioContext(1, Math.ceil((buffer.duration + tail) * sr), sr);
    const src = off.createBufferSource();
    src.buffer = buffer;
    this._chain(off, src, name, buffer.duration).connect(off.destination);
    src.start();
    const wetBuf = await off.startRendering();
    const x = buffer.getChannelData(0), y = wetBuf.getChannelData(0);
    if (name === "robotico") for (let i = 1; i < y.length; i += 2) y[i] = y[i - 1];  // meta' frequenza (sample-and-hold)
    const rms = a => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * a[i]; return Math.sqrt(s / Math.max(1, a.length)) + 1e-9; };
    const k = rms(x) / rms(y.subarray(0, x.length));  // stesso volume percepito dell'originale
    const out = off.createBuffer(1, y.length, sr), o = out.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < y.length; i++) {
      o[i] = (1 - amount) * (i < x.length ? x[i] : 0) + amount * y[i] * k;
      peak = Math.max(peak, Math.abs(o[i]));
    }
    if (peak > 0.97) for (let i = 0; i < o.length; i++) o[i] *= 0.97 / peak;
    return out;
  },
};

let _currentSource = null;

// Lingua del copilota vocale: la stessa dell'interfaccia (web/js/lang.js).
function voiceLang() { return typeof LANG !== "undefined" && LANG.lang === "en" ? "en" : "it"; }

// Voce da usare: quella scelta, se sa parlare la lingua dell'interfaccia; altrimenti quella in uso sul server
// (/api/voice/config: in inglese è la voce inglese scelta o la predefinita), poi Elsa / Sonia.
// Stessa regola di app/voice.py (resolve_voice), che la riapplica comunque a ogni sintesi.
function ttsVoiceKey(v) {
  const en = voiceLang() === "en";
  const cfg = (typeof S !== "undefined" && S && S.voice_config) || {};
  v = v || SETTINGS.ttsVoice || cfg.voice || "elsa";
  if (v === "sapi") return v;
  const ok = id => /Multilingual/.test(id) || (en ? /^en-(GB|US)-/.test(id)
    : (/^it-IT-/.test(id) || ["elsa", "diego", "isabella", "giuseppe"].includes(id)));
  if (ok(v)) return v;
  return cfg.voice && ok(cfg.voice) ? cfg.voice : (en ? "en-GB-SoniaNeural" : "elsa");
}

// Parla con la voce scelta. opts: { voice, effect, amount, force } (per i pulsanti "Prova").
function speak(text, opts = {}) {
  if (SETTINGS.tts === false && !opts.force) return;
  // Correzione fonetica italiana per TTS: "scoopabile" -> "scupabile" (in inglese "scoop" si legge già bene)
  if (voiceLang() === "it") text = text.replace(/scoopabil/gi, "scupabil").replace(/scoop/gi, "scup");
  // In inglese: i testi italiani noti ai dizionari (es. le frasi degli avvisi di fabbrica) si dicono tradotti;
  // CMDR scritto come in gioco, detto per intero.
  else text = t(text).replace(/\bCMDR\b/g, "Commander");
  const voice = ttsVoiceKey(opts.voice);
  const vol = (SETTINGS.ttsVolume != null ? SETTINGS.ttsVolume : 100) / 100;
  const fx = TTS_FX.config();
  const effect = opts.effect || fx.effect, amount = opts.amount != null ? opts.amount : fx.amount;

  // Stima durata parlato + 1500ms di decadimento acustico casse
  const estDuration = Math.max(2200, (text.length * 85) + 1500);
  markCopilotSpeaking(estDuration);

  if (voice === "sapi") {
    fallbackSpeak(text);
    return;
  }
  // L'audio si scarica con fetch (che porta l'intestazione dell'app). Velocità e tono li applica il server nella
  // sintesi (impostazioni salvate); l'effetto lo applica qui WebAudio.
  fetch("/api/tts?text=" + encodeURIComponent(text) + "&voice=" + encodeURIComponent(voice))
    .then(r => { if (!r.ok) throw new Error(r.statusText); return r.arrayBuffer(); })
    .then(async data => {
      const ctx = TTS_FX.audioCtx();
      if (!ctx) throw new Error(t("WebAudio non disponibile"));
      const buf = await TTS_FX.render(await ctx.decodeAudioData(data), effect, amount);
      if (_currentSource) { try { _currentSource.stop(); } catch (e) {} }
      const src = ctx.createBufferSource(), gain = ctx.createGain();
      src.buffer = buf;
      gain.gain.value = Math.max(0, Math.min(1, vol));
      src.connect(gain); gain.connect(ctx.destination);
      _currentSource = src;
      markCopilotSpeaking(buf.duration * 1000 + 1500);
      src.onended = () => { _copilotSpeakingUntil = Date.now() + 1500; if (_currentSource === src) _currentSource = null; };
      src.start();
    })
    .catch(err => { console.warn("[TTS]", err); fallbackSpeak(text); });
}

function fallbackSpeak(text) {
  if (!window.speechSynthesis) return;
  try {
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang = voiceLang() === "en" ? "en-GB" : "it-IT";
    const fx = TTS_FX.config();
    // stesse impostazioni di velocità (%) e tono (Hz) della voce neurale, riportate alla scala del browser
    utt.rate = Math.max(0.5, Math.min(2, 1 + fx.rate / 100));
    utt.pitch = Math.max(0, Math.min(2, 1 + fx.pitch / 50));
    utt.volume = Math.max(0, Math.min(1, (SETTINGS.ttsVolume != null ? SETTINGS.ttsVolume : 100) / 100));

    markCopilotSpeaking((text.length * 85) + 1500);
    utt.onstart = () => markCopilotSpeaking(2000);
    utt.onboundary = () => markCopilotSpeaking(1500);
    utt.onend = () => { _copilotSpeakingUntil = Date.now() + 1500; };
    utt.onerror = () => { _copilotSpeakingUntil = Date.now() + 300; };

    window.speechSynthesis.speak(utt);
  } catch (e) {}
}

function checkTtsAlerts() {
  if (SETTINGS.tts === false) return;
  const sysName = S.system?.name;
  if (sysName && sysName !== _ttsAlerted.lastSystem) {
    _ttsAlerted.lastSystem = sysName;
    _ttsAlerted.starAlerted = false;
    _ttsAlerted.terraformable = false;
    _ttsAlerted.elw = false;
    _ttsAlerted.waterWorld = false;
    _ttsAlerted.allFound = false;
    _ttsAlerted.bioColony = false;
    _ttsAlerted.lastBioStep = null;
  }

  // 1. Allarme stella non scoopabile in rotta
  if (S.route?.length > 0 && !_ttsAlerted.starAlerted) {
    const nextHop = S.route[0];
    if (nextHop && nextHop.scoopable === false) {
      speak(t("Attenzione: stella di destinazione non scupabile."));
      _ttsAlerted.starAlerted = true;
    }
  }

  // 2. Allarme pianeta simile alla Terra (ELW)
  if (!_ttsAlerted.elw && S.system?.bodies?.some(b => b.sub_type === "Earthlike body" || b.name?.includes("Earth-like"))) {
    speak(t("Pianeta di classe terrestre confermato nel sistema. Alto valore cartografico."));
    _ttsAlerted.elw = true;
  }
  // 3. Allarme Mondo d'Acqua (Water World)
  else if (!_ttsAlerted.waterWorld && S.system?.bodies?.some(b => b.sub_type === "Water world")) {
    speak(t("Mondo acquatico rilevato nel sistema."));
    _ttsAlerted.waterWorld = true;
  }
  // 4. Allarme pianeta terraformabile
  else if (!_ttsAlerted.terraformable && S.system?.bodies?.some(b => b.terraformable)) {
    speak(t("Pianeta terraformabile ad alto valore rilevato nel sistema."));
    _ttsAlerted.terraformable = true;
  }

  // 5. Scansione sistema completata
  if (!_ttsAlerted.allFound && S.system?.all_found && S.system?.body_count > 1) {
    speak(t("Scansione del sistema completata. Tutti i corpi celesti catalogati."));
    _ttsAlerted.allFound = true;
  }

  // 6. Esobiologia: distanza minima colonia raggiunta
  if (S.bio_current?.far_enough && !_ttsAlerted.bioColony) {
    speak(t("Distanza minima colonia raggiunta: puoi campionare."));
    _ttsAlerted.bioColony = true;
  } else if (S.bio_current && !S.bio_current.far_enough) {
    _ttsAlerted.bioColony = false;
  }

  // 7. Esobiologia: progressione campioni
  if (S.bio_current && S.bio_current.step !== _ttsAlerted.lastBioStep) {
    if (_ttsAlerted.lastBioStep != null) {
      if (S.bio_current.step === 2) {
        speak(t("Secondo campione registrato. Allontanati dalla colonia per il terzo."));
      } else if (S.bio_current.step === 3) {
        speak(t("Sequenziamento genetico completato. Campione pronto per Vista Genomics."));
      }
    }
    _ttsAlerted.lastBioStep = S.bio_current.step;
  }

  // 8. Allarme carburante basso (< 25%)
  const fuel = S.fuel;
  if (fuel?.level != null && fuel?.cap != null && fuel.cap > 0) {
    const fuelPct = (fuel.level / fuel.cap) * 100;
    if (fuelPct < 25 && !_ttsAlerted.lowFuelAlerted) {
      speak(t("Attenzione: riserva di carburante inferiore al 25 per cento. Trova una stella scupabile."));
      _ttsAlerted.lowFuelAlerted = true;
    } else if (fuelPct >= 35) {
      _ttsAlerted.lowFuelAlerted = false;
    }
  }

  // 9. Allarme integrita FSD sotto 80%
  if (S.fsd_health != null && S.fsd_health <= 80 && !_ttsAlerted.fsdAlerted) {
    speak(t("Attenzione: integrita FSD sotto l'80 per cento. Rischio malfunzionamento, ripara con AFMU."));
    _ttsAlerted.fsdAlerted = true;
  } else if (S.fsd_health != null && S.fsd_health > 80) {
    _ttsAlerted.fsdAlerted = false;
  }
}
