"use strict";

// ============================================================================
// Eventi
// ============================================================================
const formData = id => ({ ...(UI.forms[id] || {}) });

document.addEventListener("click", e => {
  const t = e.target.closest("button, input[type=checkbox]");
  if (!t) return;
  // --- Coriolis and Logistics button actions ---
  if (t.id === 'coriolis-verify-custom-btn' || t.closest('#coriolis-verify-custom-btn')) {
    const input = document.getElementById('coriolis-custom-sys-input');
    const val = (input ? input.value : '').trim();
    if (!val) { toast('Inserisci il nome di un sistema stellare da verificare'); return; }
    const curSys = (typeof S !== 'undefined' && S && S.location && S.location.system) ? S.location.system : 'Sol';
    const cs = getCoriolisStation();
    UI.customVerification = { loading: true, system: val };
    renderView();
    fetch('/api/colonisation/verify_system?system=' + encodeURIComponent(val) + '&ref=' + encodeURIComponent(curSys) + '&type=' + encodeURIComponent(cs.type || 'coriolis'))
      .then(r => r.json())
      .then(data => {
        UI.customVerification = data;
        renderView();
        toast(data.eligible ? ('Sistema ' + val + ' IDONEO per il cantiere!') : ('Sistema ' + val + ' analizzato'));
      })
      .catch(err => {
        UI.customVerification = { found: false, error: err.message, system: val };
        renderView();
      });
    return;
  }
  if (t.id === 'coriolis-apply-custom-btn' || t.closest('#coriolis-apply-custom-btn')) {
    const btn = t.closest('#coriolis-apply-custom-btn') || t;
    const sysName = btn.dataset.sys;
    if (sysName) {
      const cs = getCoriolisStation();
      cs.system = sysName;
      if (UI.customVerification && UI.customVerification.bodies_list && UI.customVerification.bodies_list.length) {
        cs.body = UI.customVerification.bodies_list[0].name + ' (' + UI.customVerification.bodies_list[0].type + ')';
      }
      saveCoriolisStation(cs);
      UI.systemVerifications[sysName.toLowerCase()] = UI.customVerification;
      toast('Sistema cantiere impostato su ' + sysName);
      renderView();
    }
    return;
  }
  if (t.id === 'coriolis-reverify-btn') {
    const cs = getCoriolisStation();
    const curSys = (typeof S !== 'undefined' && S && S.location && S.location.system) ? S.location.system : 'Sol';
    const sysName = cs.system || curSys;
    delete UI.systemVerifications[sysName.toLowerCase()];
    delete UI.loadingVerification[sysName.toLowerCase()];
    toast('Rianalisi parametri per ' + sysName + '...');
    renderView();
    return;
  }
  if (t.id === 'suppliers-origin-station') {
    UI.suppliersOrigin = 'station';
    renderView();
    return;
  }
  if (t.id === 'suppliers-origin-ship') {
    UI.suppliersOrigin = 'ship';
    renderView();
    return;
  }
  if (t.id === 'coriolis-refresh-suppliers') {
    UI.nearestSuppliers = {};
    UI.loadingSuppliers = {};
    toast('Mercati e fornitori ricaricati');
    renderView();
    return;
  }
  if (t.id === 'wishlist-ref-current') {
    UI.wishlistRefSys = 'current';
    renderView();
    return;
  }
  if (t.id === 'wishlist-ref-coriolis') {
    UI.wishlistRefSys = 'coriolis';
    renderView();
    return;
  }
  const d = t.dataset;
  if (d.copy) navigator.clipboard.writeText(d.copy).then(() => toast("Copiato: " + d.copy));
  else if (d.open) api("/api/open", { url: d.open }).then(() => toast("Aperto nel browser")).catch(e => toast(e.message));
  else if (d.todo) addTodo(d.todo, d.category, d.system);
  else if (d.findCommodity) {
    const curSys = S?.location?.system || "Sol";
    const comm = d.findCommodity;
    const needed = parseInt(d.needed, 10) || 1;
    UI.activeFinder = {
      title: `Stazione pi\u00f9 vicina per acquistare ${comm}`,
      commodity: comm,
      loading: true,
      results: []
    };
    renderView();
    api("/api/search", { mode: "buy", commodity: comm, reference: curSys, min_qty: 1 })
      .then(r => {
        UI.activeFinder.loading = false;
        UI.activeFinder.results = (r.results || []).slice(0, 5);
        renderView();
      })
      .catch(err => {
        UI.activeFinder.loading = false;
        UI.activeFinder.error = err.message || "Nessuna stazione trovata";
        renderView();
      });
  } else if (d.findTrader) {
    const refSys = d.refSys || S?.location?.system || "Sol";
    const cat = d.findTrader;
    const catNames = { Raw: "Grezzi", Manufactured: "Manufatti", Encoded: "Codificati" };
    UI.activeFinder = {
      title: `Material Trader (${catNames[cat] || cat}) pi\u00f9 vicino a ${refSys}`,
      trader: cat,
      loading: true,
      results: []
    };
    renderView();
    api("/api/search", { mode: "service", service: "Material Trader", trader: cat, reference: refSys })
      .then(r => {
        UI.activeFinder.loading = false;
        UI.activeFinder.results = (r.results || []).slice(0, 5);
        renderView();
      })
      .catch(err => {
        UI.activeFinder.loading = false;
        UI.activeFinder.error = err.message || "Nessun mercante trovato";
        renderView();
      });
  } else if (d.findBroker) {
    const refSys = d.refSys || S?.location?.system || "Sol";
    const brokerType = d.findBroker;
    UI.activeFinder = {
      title: `Technology Broker (${brokerType}) pi\u00f9 vicino a ${refSys}`,
      broker: brokerType,
      loading: true,
      results: []
    };
    renderView();
    api("/api/search", { mode: "service", service: "Technology Broker", broker: brokerType, reference: refSys })
      .then(r => {
        UI.activeFinder.loading = false;
        UI.activeFinder.results = (r.results || []).slice(0, 5);
        renderView();
      })
      .catch(err => {
        UI.activeFinder.loading = false;
        UI.activeFinder.error = err.message || "Nessun broker trovato";
        renderView();
      });
  } else if (d.showGuardianSite) {
    const siteType = d.showGuardianSite;
    UI.activeFinder = {
      title: siteType === "weapon" ? "Sito Rovine Guardian Armi (Weapon Blueprint)" : "Sito Rovine Guardian Moduli (Module Blueprint)",
      isGuide: true,
      content: getGuardianSiteGuide(siteType)
    };
    renderView();
  } else if (d.closeFinder !== undefined || t.hasAttribute("data-close-finder")) {
    UI.activeFinder = null;
    renderView();
  }
  else if (d.quick) {
    const [, preset] = QUICK[+d.quick];
    UI.forms.search = { ...formData("search"), trader: "", ...preset };
    // Le ricerche che hanno bisogno di un nome (arma, merce) aprono solo il modulo giusto.
    if ((preset.mode === "module" && !preset.module) || (preset.mode === "buy" && !preset.commodity)) { renderView(); return; }
    run("search", async () => ({ ...(await api("/api/search", UI.forms.search)), mode: preset.mode }));
  } else if (d.minesell) {
    run("mineSell", () => api("/api/search", { mode: "sell", commodity: d.minesell, sort: "price", max_dist: 150, no_carriers: true }));
  } else if (d.metric) { UI.fleetMetric = d.metric; renderView(); }
  else if (d.toggle) {
    const item = TODOS.find(x => x.id === d.toggle);
    if (item) { item.done = t.checked; saveTodos(); }
  } else if (d.del) { TODOS = TODOS.filter(x => x.id !== d.del); saveTodos(); }
  else if (t.id === "todo-clear") { TODOS = TODOS.filter(x => !x.done); saveTodos(); }
  else if (t.id === "route-clear") { api("/api/route/clear", {}).then(() => { ROUTE = null; renderView(); }); }
  else if (d.exoMode) { (UI.forms["rt-exobio"] ||= {}).mode = d.exoMode; renderView(); }
  else if (d.tool) { UI.tool = d.tool; renderView(); }
  else if (d.adviceAdd) {
    const a = ADVICE.find(x => x.id === d.adviceAdd);
    if (a) { addTodo(a.text, a.category, a.system); dismiss(a.id); }
  } else if (d.adviceSkip) { dismiss(d.adviceSkip); renderView(); }
  else if (t.id === "advice-more") { UI.adviceAll = !UI.adviceAll; renderView(); }
  else if (t.id === "advice-reset") { UI.dismissed.clear(); localStorage.removeItem("dismissed"); renderView(); }
  else if (d.import) {
    const f = S.fleet.find(x => String(x.id) === d.import);
    UI.cfg = ShipCalc.fromLoadout(CATALOG, f.symbol, f.build.raw, typeof SHIP_SLOTS !== "undefined" ? SHIP_SLOTS : null);
    UI.cfgName = f.name?.trim() || f.type;
    toast("Allestimento importato: " + UI.cfgName);
    renderView();
  } else if (d.loadBuild) {
    const b = savedBuilds()[+d.loadBuild];
    UI.cfg = JSON.parse(JSON.stringify(b.cfg));
    UI.cfgName = b.name;
    renderView();
  } else if (d.delBuild) {
    const list = savedBuilds();
    list.splice(+d.delBuild, 1);
    localStorage.setItem("builds", JSON.stringify(list));
    renderView();
  } else if (t.id === "cfg-save") {
    const name = ($("cfg-name").value || "").trim() || CATALOG.ships[UI.cfg.ship].name;
    const list = savedBuilds().filter(b => b.name !== name);
    list.push({ name, cfg: UI.cfg });
    localStorage.setItem("builds", JSON.stringify(list));
    UI.cfgName = name;
    toast("Allestimento salvato");
    renderView();
  } else if (d.coriolisAddCargo) {
    const cs = getCoriolisStation();
    const m = cs.materials[d.coriolisAddCargo];
    if (m) {
      m.done = Math.min(m.req, (m.done || 0) + (cs.cargoShipCap || 752));
      saveCoriolisStation(cs);
      toast(`+${cs.cargoShipCap || 752} t ${d.coriolisAddCargo} registrate`);
      renderView();
    }
  } else if (d.coriolisAdd100) {
    const cs = getCoriolisStation();
    const m = cs.materials[d.coriolisAdd100];
    if (m) {
      m.done = Math.min(m.req, (m.done || 0) + 100);
      saveCoriolisStation(cs);
      toast(`+100 t ${d.coriolisAdd100} registrate`);
      renderView();
    }
  } else if (d.coriolisDone) {
    const cs = getCoriolisStation();
    const m = cs.materials[d.coriolisDone];
    if (m) {
      m.done = m.req;
      saveCoriolisStation(cs);
      toast(`${d.coriolisDone} completato!`);
      renderView();
    }
  } else if (d.coriolisClear) {
    const cs = getCoriolisStation();
    const m = cs.materials[d.coriolisClear];
    if (m) {
      m.done = 0;
      saveCoriolisStation(cs);
      toast(`${d.coriolisClear} azzerato`);
      renderView();
    }
  } else if (d.coriolisTodo) {
    const cs = getCoriolisStation();
    const m = cs.materials[d.coriolisTodo];
    const left = m ? Math.max(0, m.req - (m.done || 0)) : 1000;
    addTodo(`Fornire ${num(left)} t di ${d.coriolisTodo} a ${cs.name}`, "Cantiere Coriolis", cs.system);
  } else if (t.id === "coriolis-phase1-all") {
    const cs = getCoriolisStation();
    Object.values(cs.materials).filter(m => m.phase === 1).forEach(m => m.done = m.req);
    saveCoriolisStation(cs);
    toast("Fase 1 completata al 100%!");
    renderView();
  } else if (t.id === "coriolis-phase2-all") {
    const cs = getCoriolisStation();
    Object.values(cs.materials).filter(m => m.phase === 2).forEach(m => m.done = m.req);
    saveCoriolisStation(cs);
    toast("Fase 2 completata al 100%!");
    renderView();
  } else if (t.id === "coriolis-phase3-all") {
    const cs = getCoriolisStation();
    Object.values(cs.materials).filter(m => m.phase === 3).forEach(m => m.done = m.req);
    saveCoriolisStation(cs);
    toast("Fase 3 completata al 100%!");
    renderView();
  } else if (t.id === "coriolis-reset-btn") {
    if (confirm(LANG.t("Sei sicuro di voler azzerare l'avanzamento dei materiali del cantiere Coriolis?"))) {
      const cs = getCoriolisStation();
      Object.values(cs.materials).forEach(m => m.done = 0);
      saveCoriolisStation(cs);
      toast("Avanzamento cantiere azzerato");
      renderView();
    }
  } else if (t.id === "coriolis-save-meta-btn") {
    const cs = getCoriolisStation();
    const prevType = cs.type;
    cs.type = $("coriolis-edit-type")?.value || cs.type || "coriolis";
    cs.name = ($("coriolis-edit-name")?.value || cs.name).trim();
    cs.system = ($("coriolis-edit-system")?.value || cs.system).trim();
    cs.body = ($("coriolis-edit-body")?.value || cs.body).trim();
    cs.economy = $("coriolis-edit-economy")?.value || cs.economy;
    cs.faction = ($("coriolis-edit-faction")?.value || cs.faction).trim();
    
    // Se la tipologia di stazione e cambiata, resetta la cache dei candidati per ricalcolare i sistemi adatti
    if (prevType !== cs.type) {
      UI.coriolisCandidates = null;
      UI.lastCandidatesKey = null;
    }
    
    saveCoriolisStation(cs);
    toast(`Struttura aggiornata: ricerca sistemi per ${cs.type.toUpperCase()}`);
    renderView();
  } else if (d.coriolisService) {
    const cs = getCoriolisStation();
    cs.services[d.coriolisService] = t.checked;
    saveCoriolisStation(cs);
    toast(`Servizio ${d.coriolisService} ${t.checked ? "attivato" : "disattivato"}`);
  } else if (d.toggleRole) {
    UI.activeRoles ||= new Set();
    if (UI.activeRoles.has(d.toggleRole)) {
      UI.activeRoles.delete(d.toggleRole);
    } else {
      UI.activeRoles.add(d.toggleRole);
    }
    if (UI.activeRoles.size) {
      UI.cfg = buildRoleMix(CATALOG, UI.cfg.ship, Array.from(UI.activeRoles));
      const roleNames = Array.from(UI.activeRoles).map(r => SHIP_PRESETS.find(p => p.id === r)?.label).filter(Boolean).map(l => LANG.t(l));
      UI.cfgName = `${CATALOG.ships[UI.cfg.ship].name} (${roleNames.join(" + ")})`;
    } else {
      UI.cfg = ShipCalc.blank(CATALOG, UI.cfg.ship);
      UI.cfgName = "";
    }
    renderView();
  } else if (t.id === "clear-roles-btn") {
    UI.activeRoles = new Set();
    UI.cfg = ShipCalc.blank(CATALOG, UI.cfg.ship);
    UI.cfgName = "";
    renderView();
  } else if (d.engTodo) {
    addTodo(`Ingegnerizza ${d.engTodo}: ${d.engBp} (${d.engExp})`, "Ingegneri", d.engEng.split("/")[0].trim());
  } else if (t.id === "eng-todo-all") {
    const engList = getEngineeringAdvice(CATALOG, UI.cfg);
    let count = 0;
    for (const it of engList) {
      addTodo(`Ingegnerizza ${it.mod}: ${it.blueprint}${it.exp ? " (" + it.exp + ")" : ""}`, "Ingegneri", it.sys || "");
      count++;
    }
    toast(`${count} ingegnerizzazioni aggiunte ai da fare`);
  } else if (t.id === "cg-toggle-view") {
    UI.cgExpanded = !UI.cgExpanded;
    renderView();  } else if (t.id === "cfg-reset") {
    UI.cfg = ShipCalc.blank(CATALOG, UI.cfg.ship);
    UI.activeEngSlot = null;
    renderView();
  } else if (t.id === "cfg-eng-all-g5") {
    const n = applyAllRecommended(UI.cfg);
    renderView();
    toast(n ? `${n} blueprint G5 pianificati` : "Niente da aggiungere");
  } else if (d.slotEngEdit) {
    UI.activeEngSlot = d.slotEngEdit;
    renderView();
  } else if (t.hasAttribute("data-slot-eng-cancel")) {
    UI.activeEngSlot = null;
    renderView();
  } else if (d.slotEngClear) {
    const [k, idx] = d.slotEngClear.split(":");
    cfgEngClear(k, idx);
    renderView();
    toast("Ingegneria rimossa dal modulo");
  } else if (d.slotEngApply) {
    const [k, idx] = d.slotEngApply.split(":");
    const label = cfgEngApply(k, idx);
    if (label) toast("Pianificato: " + label);
    renderView();
  } else if (d.roleBuild) {
    const role = d.roleBuild;
    const roleNames = { explore: "Esplorazione", combat: "Combattimento", trade: "Commercio", mining: "Estrazione" };
    UI.cfg = buildRole(CATALOG, UI.cfg.ship, role);
    UI.cfgName = `${CATALOG.ships[UI.cfg.ship].name} ${roleNames[role] || role}`;
    renderView();
    toast(`Allestimento ${roleNames[role]} caricato`);
  } else if (t.closest("[data-win]")) {
    api("/api/app/window", { action: t.closest("[data-win]").dataset.win });
  } else if (t.id === "tts-test-main") {
    speak(LANG.t("Sistemi di bordo attivi. Copilota vocale operativo. Buona caccia tra le stelle, Comandante."));
  } else if (t.id === "btn-prop-voice" || t.closest("#btn-prop-voice") || t.id === "btn-voice-toggle-settings" || t.closest("#btn-voice-toggle-settings")) {
    VOICE_ENGINE.toggle();
  } else if (t.id === "voice-toggle-hud-btn" || t.closest("#voice-toggle-hud-btn") || t.id === "btn-voice-mute") {
    VOICE_ENGINE.stop();
  } else if (t.id === "btn-voice-settings") {
    location.hash = "voice_commands";
  } else if (t.id === "voice-mode-toggle-btn" || t.closest("#voice-mode-toggle-btn")) {
    VOICE_ENGINE.toggleMode();
  } else if (t.id === "macro-record-btn") {
    MACRO_RECORDER.toggle();
  } else if (t.id === "tts-test-vol") {
    speak(LANG.t("Prova volume copilota al " + (SETTINGS.ttsVolume != null ? SETTINGS.ttsVolume : 100) + " percento. Segnale audio chiaro."));
  } else if (t.id === "btn-create-coriolis") {
    const shipKey = $("cfg-ship")?.value || UI.cfg?.ship || "cobramkv";
    UI.cfg = ShipCalc.blank(CATALOG, shipKey);
    UI.cfgName = "Nuovo Allestimento (" + (CATALOG.ships[shipKey]?.name || shipKey) + ")";
    toast("Creato allestimento vuoto da zero per: " + (CATALOG.ships[shipKey]?.name || shipKey));
    renderView();
  } else if (t.id === "btn-calc-carrier-route") {
    const from = ($("fc-from")?.value || "").trim() || S?.location?.system || "Sol";
    const to = ($("fc-to")?.value || "").trim() || "Colonia";
    const cap = parseInt($("fc-cargo")?.value || "0", 10);
    UI.forms.carrier = { from, to, capacity_used: cap };
    UI.carrierRoute = { busy: true };
    renderView();
    api("/api/route", { tool: "carrier", from, to, capacity_used: cap }).then(data => {
      UI.carrierRoute = { data };
      renderView();
    }).catch(err => {
      UI.carrierRoute = { error: err.message };
      renderView();
    });
  } else if (d.fcQuickTo) {
    if ($("fc-to")) $("fc-to").value = d.fcQuickTo;
    UI.forms.carrier = { ...(UI.forms.carrier || {}), to: d.fcQuickTo };
  } else if (d.fcService) {
    UI.carrierServices = UI.carrierServices || {};
    UI.carrierServices[d.fcService] = t.checked;
    renderView();
  // PTT and Voice Mode Selectors
  } else if (t.id === "btn-mode-continuous" || t.closest("#btn-mode-continuous")) {
    VOICE_ENGINE.setMode("continuous");
    renderView();
  } else if (t.id === "btn-mode-ptt" || t.closest("#btn-mode-ptt")) {
    VOICE_ENGINE.setMode("ptt");
    renderView();
  } else if (t.id === "btn-record-ptt-key" || t.closest("#btn-record-ptt-key")) {
    VOICE_ENGINE.listeningPttKey = true;
    const btn = $("btn-record-ptt-key");
    if (btn) {
      btn.innerHTML = "&#x25cf; PREMI UN TASTO...";
      btn.style.borderColor = "#ff3300";
      btn.style.color = "#ff3300";
      btn.style.background = "#2b0a00";
    }
    toast("Premi il tasto desiderato per il Push-to-Talk...");

  // Voice Section Tabs
  } else if (t.id === "tab-voice-controls" || t.closest("#tab-voice-controls")) {
    UI.activeVoiceTab = "controls";
    renderView();
  } else if (t.id === "tab-voice-telemetry" || t.closest("#tab-voice-telemetry")) {
    UI.activeVoiceTab = "telemetry";
    renderView();
  } else if (t.id === "tab-voice-macros" || t.closest("#tab-voice-macros")) {
    UI.activeVoiceTab = "macros";
    renderView();

  // Ship Controls Management
  } else if (t.id === "control-new-toggle") {
    UI.editingControl = null;
    UI.showControlForm = !UI.showControlForm;
    renderView();
  } else if (t.id === "control-form-cancel") {
    UI.showControlForm = false;
    UI.editingControl = null;
    renderView();
  } else if (t.id === "ctrl-record-key-btn") {
    UI.recordingCtrlKey = true;
    t.innerHTML = "&#x25cf; PREMI IL TASTO...";
    t.style.borderColor = "#ff3300";
    t.style.color = "#ff3300";
    toast("Premi ora il tasto fisico sulla tastiera...");
  } else if (d.controlEdit) {
    const target = CONTROLS.find(c => c.id === d.controlEdit);
    if (target) {
      UI.editingControl = { ...target };
      UI.showControlForm = false;
      renderView();
      $("controls-panel")?.scrollIntoView({ behavior: "smooth" });
    }
  } else if (d.controlDel) {
    if (confirm(LANG.t("Eliminare questo controllo di bordo?"))) {
      CONTROLS = CONTROLS.filter(c => c.id !== d.controlDel);
      saveControls(CONTROLS);
      toast("Controllo eliminato");
    }
  } else if (d.controlTest) {
    const v = ttsVoiceKey();
    const vol = SETTINGS.ttsVolume != null ? SETTINGS.ttsVolume : 100;
    fetch(`/api/voice/ship_control?action=${encodeURIComponent(d.controlTest)}&voice=${v}&volume=${vol}`)
      .then(r => r.json())
      .then(res => {
        toast("Controllo azionato: " + (res.played || res.control));
      })
      .catch(err => {
        toast("Errore esecuzione controllo: " + err.message);
      });
  } else if (t.id === "ctrl-form-test") {
    const key = ($("ctrl-input-key")?.value || "").trim();
    const voice = ($("ctrl-input-voice")?.value || "").trim();
    const v = ttsVoiceKey();
    const vol = SETTINGS.ttsVolume != null ? SETTINGS.ttsVolume : 100;
    if (key) {
      fetch(`/api/voice/ship_control?action=test_key&key=${encodeURIComponent(key)}&voice=${v}&volume=${vol}`).catch(()=>{});
    }
    if (voice) speak(voice);
    toast("Test tasto e voce copilota avviato");
  } else if (t.id === "ctrl-form-save") {
    const name = ($("ctrl-input-name")?.value || "").trim();
    if (!name) { toast("Inserisci il nome del controllo"); return; }
    const say = ($("ctrl-input-say")?.value || "").trim() || name;
    const key = ($("ctrl-input-key")?.value || "SPACE").trim().toUpperCase();
    const voice = ($("ctrl-input-voice")?.value || "").trim();
    const desc = ($("ctrl-input-desc")?.value || "").trim();
    
    if (UI.editingControl) {
      const idx = CONTROLS.findIndex(c => c.id === UI.editingControl.id);
      if (idx !== -1) {
        CONTROLS[idx] = { ...CONTROLS[idx], name, say, key, voice, desc };
      }
      UI.editingControl = null;
      saveControls(CONTROLS);
      toast(`Controllo "${name}" aggiornato!`);
    } else {
      const newC = {
        id: "ctrl_" + Date.now().toString(36),
        name, say, key, voice, desc, builtIn: false
      };
      CONTROLS.push(newC);
      UI.showControlForm = false;
      saveControls(CONTROLS);
      toast(`Controllo "${name}" salvato!`);
    }

  // Telemetry Rules Management
  } else if (t.id === "telemetry-new-toggle") {
    UI.editingTelemetry = null;
    UI.showTelemetryForm = !UI.showTelemetryForm;
    renderView();
  } else if (t.id === "telemetry-form-cancel") {
    UI.showTelemetryForm = false;
    UI.editingTelemetry = null;
    renderView();
  } else if (d.telemetryToggle) {
    const target = TELEMETRY_RULES.find(r => r.id === d.telemetryToggle);
    if (target) {
      target.enabled = !target.enabled;
      saveTelemetryRules(TELEMETRY_RULES);
      toast(`Allarme "${target.name}" ${target.enabled ? "abilitato" : "disabilitato"}`);
    }
  } else if (d.telemetryEdit) {
    const target = TELEMETRY_RULES.find(r => r.id === d.telemetryEdit);
    if (target) {
      UI.editingTelemetry = { ...target };
      UI.showTelemetryForm = false;
      renderView();
      $("telemetry-panel")?.scrollIntoView({ behavior: "smooth" });
    }
  } else if (d.telemetryDel) {
    if (confirm(LANG.t("Eliminare questa regola di telemetria?"))) {
      TELEMETRY_RULES = TELEMETRY_RULES.filter(r => r.id !== d.telemetryDel);
      saveTelemetryRules(TELEMETRY_RULES);
      toast("Regola telemetria eliminata");
    }
  } else if (d.telemetryTest) {
    const target = TELEMETRY_RULES.find(r => r.id === d.telemetryTest);
    if (target && target.voice) speak(target.voice);
    toast("Riproduzione avviso telemetria");
  } else if (t.id === "telem-form-test") {
    const voice = ($("telem-input-voice")?.value || "").trim();
    if (voice) speak(voice);
    toast("Riproduzione avviso vocale");
  } else if (t.id === "telem-form-save") {
    const name = ($("telem-input-name")?.value || "").trim();
    if (!name) { toast("Inserisci il nome della regola"); return; }
    const metric = $("telem-input-metric")?.value || "fuel";
    const condition = $("telem-input-cond")?.value || "lt";
    const threshold = parseFloat($("telem-input-thresh")?.value || "25");
    const voice = ($("telem-input-voice")?.value || "").trim();
    const desc = ($("telem-input-desc")?.value || "").trim();
    const unit = metric === "fuel" || metric === "heat" || metric === "hull" || metric === "fsd" ? "%" : "";

    if (UI.editingTelemetry) {
      const idx = TELEMETRY_RULES.findIndex(r => r.id === UI.editingTelemetry.id);
      if (idx !== -1) {
        TELEMETRY_RULES[idx] = { ...TELEMETRY_RULES[idx], name, metric, condition, threshold, unit, voice, desc };
      }
      UI.editingTelemetry = null;
      saveTelemetryRules(TELEMETRY_RULES);
      toast(`Regola telemetria "${name}" aggiornata!`);
    } else {
      const newR = {
        id: "telem_" + Date.now().toString(36),
        name, metric, condition, threshold, unit, voice, desc, enabled: true
      };
      TELEMETRY_RULES.push(newR);
      UI.showTelemetryForm = false;
      saveTelemetryRules(TELEMETRY_RULES);
      toast(`Regola telemetria "${name}" creata!`);
    }

  } else if (t.id === "macro-new-toggle") {
    UI.editingMacro = null;
    UI.showMacroForm = !UI.showMacroForm;
    renderView();
  } else if (t.id === "macro-form-cancel") {
    UI.showMacroForm = false;
    UI.editingMacro = null;
    renderView();
  } else if (t.closest("[data-macro-add-key]")) {
    const k = t.closest("[data-macro-add-key]").dataset.macroAddKey;
    const input = $("macro-input-keys");
    if (input) {
      const cur = input.value.trim();
      input.value = cur ? cur + ", " + k : k;
      UI.dirty.set(input.id, input.value);
    }
  } else if (d.macroEdit) {
    const target = MACROS.find(m => m.id === d.macroEdit);
    if (target) {
      UI.editingMacro = { ...target };
      UI.showMacroForm = false;
      renderView();
      $("macro-editor-panel")?.scrollIntoView({ behavior: "smooth" });
    }
  } else if (t.id === "macro-form-test-seq") {
    const keysRaw = ($("macro-input-keys")?.value || "").trim();
    const voice = ($("macro-input-voice")?.value || "").trim();
    const v = ttsVoiceKey();
    if (keysRaw) {
      const keys = keysRaw.split(",").map(k => k.trim()).filter(Boolean);
      fetch("/api/macros", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify([{ id: "temp_test", name: "Test Sequenza", keys }])
      }).then(() => {
        fetch(`/api/voice/macro?id=temp_test&voice=${v}`);
      }).catch(()=>{});
    }
    if (voice) speak(voice);
    toast("Test sequenza tasti e voce avviato");
  } else if (t.id === "macro-form-save") {
    const name = ($("macro-input-name")?.value || "").trim();
    if (!name) { toast("Inserisci il nome del comando o macro"); return; }
    const say = ($("macro-input-say")?.value || "").trim() || name;
    const keysRaw = ($("macro-input-keys")?.value || "").trim();
    const keys = keysRaw.split(",").map(k => k.trim()).filter(Boolean);
    const voice = ($("macro-input-voice")?.value || "").trim();
    const desc = ($("macro-input-desc")?.value || "").trim();
    
    if (UI.editingMacro) {
      const idx = MACROS.findIndex(m => m.id === UI.editingMacro.id);
      if (idx !== -1) {
        MACROS[idx] = { id: UI.editingMacro.id, name, say, keys, voice, desc };
      }
      UI.editingMacro = null;
      saveMacros(MACROS);
      toast(`Macro "${name}" modificata con successo!`);
    } else {
      const newM = {
        id: "m_" + Date.now().toString(36),
        name, say, keys, voice, desc
      };
      MACROS.push(newM);
      UI.showMacroForm = false;
      saveMacros(MACROS);
      toast(`Macro "${name}" creata con successo!`);
    }
  } else if (d.macroDel) {
    if (confirm(LANG.t("Eliminare questa macro?"))) {
      MACROS = MACROS.filter(m => m.id !== d.macroDel);
      saveMacros(MACROS);
    }
  } else if (d.macroTest) {
    const v = ttsVoiceKey();
    fetch(`/api/voice/macro?id=${d.macroTest}&voice=${v}`)
      .then(r => r.json())
      .then(res => {
        toast("Macro eseguita: " + (res.played || res.macro));
      })
      .catch(err => {
        toast("Errore esecuzione macro: " + err.message);
      });
  } else if (d.vaAction) {
    const v = ttsVoiceKey();
    fetch(`/api/voice/ship_control?action=${d.vaAction}&voice=${v}`)
      .then(r => r.json())
      .then(res => {
        toast("Comando nave eseguito: " + (res.played || res.action));
      })
      .catch(err => {
        toast("Errore comando nave: " + err.message);
      });
  } else if (d.vaTelemetry) {
    const v = ttsVoiceKey();
    const ep = d.vaTelemetry === "copy" ? `/api/voice/copy-next?play=1&voice=${v}` : `/api/voice/play?type=${d.vaTelemetry}&voice=${v}`;
    fetch(ep)
      .then(r => r.json())
      .then(res => {
        toast(res.played || res.text || "Comando vocale eseguito");
      })
      .catch(err => {
        toast("Errore comando telemetria: " + err.message);
      });
  } else if (d.ttsSample) {
    speak(LANG.t(d.ttsSample));
  } else if (d.cgPlot) {
    UI.tool = "neutron";
    (UI.forms["rt-neutron"] ||= {}).to = d.cgPlot;
    location.hash = "route";
  } else if (d.cgTodo) {
    addTodo(`Partecipa all'obiettivo della comunità: ${d.cgTodo} a ${d.cgSys} (${d.cgSt})`, "Obiettivi comunità", d.cgSys);
  } else if (d.traderCat) {
    UI.tool = "service";
    (UI.forms["sr-service"] ||= {}).service = "Material Trader";
    UI.forms["sr-service"].trader = d.traderCat;
    location.hash = "search";
  } else if (d.setCoriolisSys) {
    const cs = getCoriolisStation();
    cs.system = d.setCoriolisSys;
    saveCoriolisStation(cs);
    renderView();
    toast(`Sistema Cantiere Stazione Coriolis impostato su: ${cs.system}`);
  } else if (t.id === "wishlist-add-todo") {
    const bp = BLUEPRINTS.find(b => b.id === (UI.bpId || BLUEPRINTS[0].id)) || BLUEPRINTS[0];
    const matStock = {};
    for (const m of S.materials) {
      matStock[m.name] = (matStock[m.name] || 0) + m.count;
      if (m.label) matStock[m.label] = (matStock[m.label] || 0) + m.count;
    }
    const cargoStock = {};
    for (const c of (S.cargo || [])) {
      cargoStock[c.name] = (cargoStock[c.name] || 0) + (c.count || 0);
      if (c.label) cargoStock[c.label] = (cargoStock[c.label] || 0) + (c.count || 0);
    }
    let addedCount = 0;
    bp.items.forEach(req => {
      const owned = matStock[req.name] || cargoStock[req.name] || 0;
      const missing = Math.max(0, req.count - owned);
      if (missing > 0) {
        const text = `Raccogliere ${missing}x ${req.name} (${req.hint || req.cat}) per ${bp.name}`;
        if (!TODOS.some(x => x.text === text)) {
          TODOS.push({
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            text,
            category: "Materiali",
            system: "",
            done: false,
            created: new Date().toISOString()
          });
          addedCount++;
        }
      }
    });
    if (addedCount > 0) {
      saveTodos();
      toast(`${addedCount} materiali mancanti aggiunti a "Da fare"!`);
    } else {
      toast("Tutti i materiali necessari sono gia disponibili o in elenco!");
    }
  } else if (t.id === "wishlist-save-active") {
    const bp = BLUEPRINTS.find(b => b.id === (UI.bpId || BLUEPRINTS[0].id)) || BLUEPRINTS[0];
    localStorage.setItem("ed_wishlist_selected", bp.id);
    toast(`Obiettivo attivo "${bp.name}" salvato!`);
  } else if (d.wishlistTodo) {
    addTodo(`Modifica ingegneristica: ${d.wishlistTodo}`, "Ingegneri", d.wishlistSys || "");
  } else if (d.buildTodo) {
    addTodo(d.buildTodo, d.buildCat || "Nave", d.buildSys || "");
  } else if (t.id === "build-todo-all") {
    const items = getBuildAdvice(CATALOG, UI.cfg);
    let count = 0;
    for (const it of items) {
      if (!TODOS.some(x => x.text === it.text)) {
        TODOS.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text: it.text, category: it.cat || "Nave", system: it.sys || "", done: false, created: new Date().toISOString() });
        count++;
      }
    }
    if (count > 0) {
      saveTodos();
      toast(`${count} tappe aggiunte alle cose da fare`);
    } else {
      toast("Tutte le tappe sono già nella lista da fare");
    }
  }
  else if (t.id === "cfg-plot") {
    UI.tool = "galaxy";
    (UI.forms["rt-galaxy"] ||= {}).ship = "cfg";
    location.hash = "route";
  } else if (d.setting) {
    if (d.setting === "lang") delete SETTINGS.langAuto;  // scelta fatta a mano: non la ripristino più da solo
    setSetting(d.setting, d.value === undefined ? !SETTINGS[d.setting] : d.value);
    if (d.setting === "lang") fillDatalists();
    if (d.setting === "warp" && SETTINGS.warp) Stars.warp(900);
    renderView();
  } else if (t.id === "lan-toggle") {
    api("/api/lan", { enabled: !S.lan?.enabled })
      .then(r => { S.lan = r; toast(r.enabled ? "Accesso dal telefono attivo" : "Accesso dal telefono spento"); renderView(); })
      .catch(e => toast("Non riesco a cambiare l'accesso: " + e.message));
  } else if (t.id === "builds-clear") {
    if (confirm(LANG.t("Eliminare tutti gli allestimenti salvati?"))) { localStorage.removeItem("builds"); renderView(); }
  } else if (t.id === "todos-clear-all") {
    if (confirm(LANG.t("Eliminare tutte le cose da fare, anche quelle non completate?"))) { TODOS = []; saveTodos(); }
  }
});

function rememberField(el) {
  const form = el.form?.dataset.form || document.getElementById(el.getAttribute("form") || "")?.dataset.form;
  if (!form || !el.name) return;
  (UI.forms[form] ||= {})[el.name] = el.type === "checkbox" ? el.checked : el.value;
}
document.addEventListener("input", e => {
  if (e.target.id === "mic-noise-gate") {
    localStorage.setItem("ed_mic_gate", e.target.value);
    updateHudSliderFill(e.target);
    const lbl = $("noise-gate-val");
    if (lbl) lbl.textContent = `${e.target.value}%`;
    return;
  }
  if (e.target.id === "tts-volume") {
    SETTINGS.ttsVolume = parseInt(e.target.value, 10);
    saveSettings();
    updateHudSliderFill(e.target);
    const lbl = $("tts-vol-val");
    if (lbl) lbl.textContent = `${SETTINGS.ttsVolume}%`;
    return;
  }
  if (e.target.classList.contains("hud-slider")) {
    updateHudSliderFill(e.target);
  }
  if (e.target.id === "mat-filter") {
    UI.matFilter = e.target.value;
    const pos = e.target.selectionStart;
    renderView();
    const el = $("mat-filter");
    el.focus();
    el.setSelectionRange(pos, pos);
    return;
  }
  rememberField(e.target);
});
document.addEventListener("change", e => {
  if (e.target.id === "ptt-behavior-select") {
    VOICE_ENGINE.setBehavior(e.target.value);
    return;
  }
  if (e.target.id === "mic-device-select") {
    localStorage.setItem("ed_mic_device", e.target.value);
    toast("Microfono aggiornato: calibrazione audio in corso...");
    if (VOICE_ENGINE.active) {
      VOICE_ENGINE.stop();
      setTimeout(() => VOICE_ENGINE.start(), 200);
    }
    return;
  }
  if (e.target.id === "mic-noise-suppression") {
    localStorage.setItem("ed_mic_noise_supp", e.target.checked);
    toast(`Filtro soppressione rumore ${e.target.checked ? "attivato" : "disattivato"}`);
    if (VOICE_ENGINE.active) {
      VOICE_ENGINE.stop();
      setTimeout(() => VOICE_ENGINE.start(), 200);
    }
    return;
  }
  if (e.target.id === "mic-echo-cancellation") {
    localStorage.setItem("ed_mic_echo_cancel", e.target.checked);
    toast(`Cancellazione eco ${e.target.checked ? "attivata" : "disattivata"}`);
    if (VOICE_ENGINE.active) {
      VOICE_ENGINE.stop();
      setTimeout(() => VOICE_ENGINE.start(), 200);
    }
    return;
  }
  if (e.target.id === "mic-auto-gain") {
    localStorage.setItem("ed_mic_auto_gain", e.target.checked);
    toast(`Guadagno automatico (AGC) ${e.target.checked ? "attivato" : "disattivato"}`);
    if (VOICE_ENGINE.active) {
      VOICE_ENGINE.stop();
      setTimeout(() => VOICE_ENGINE.start(), 200);
    }
    return;
  }
  if (e.target.id === "coriolis-edit-type") {
    const cs = getCoriolisStation();
    cs.type = e.target.value;
    saveCoriolisStation(cs);
    UI.coriolisCandidates = null;
    UI.lastCandidatesKey = null;
    UI.loadingCandidates = false;
    toast(`Architettura stazione impostata su ${cs.type.toUpperCase()}: ricalcolo sistemi compatibili...`);
    renderView(true);
    return;
  }
  if (e.target.id === "wishlist-select") {
    UI.bpId = e.target.value;
    localStorage.setItem("ed_wishlist_selected", e.target.value);
    renderView();
    return;
  }
  if (e.target.id === "coriolis-ship-select") {
    const cs = getCoriolisStation();
    cs.cargoShipCap = parseInt(e.target.value, 10) || 752;
    saveCoriolisStation(cs);
    renderView();
    return;
  }

  if (e.target.id === "tts-voice") { setSetting("ttsVoice", e.target.value); return; }
  if (e.target.id === "tts-rate") { setSetting("ttsRate", parseFloat(e.target.value)); return; }
  const t = e.target;
  rememberField(t);
  if (t.id === "eng-kind") { UI.engKind = t.value; renderView(); }
  else if (t.id === "eng-sort") { UI.engSort = t.value; renderView(); }
  else if (t.id === "todo-filter") { UI.todoFilter = t.value; renderView(); }
  else if (t.name === "mode" || t.name === "service") renderView();
  else if (t.id === "cfg-ship") { (UI.activeRoles ||= new Set()).clear(); UI.cfg = ShipCalc.blank(CATALOG, t.value); UI.cfgName = ""; renderView(); }
  else if (t.id === "cfg-bulkhead") {
    UI.cfg.bulkhead = +t.value;
    if (UI.cfg.bulkheadEng && !UI.cfg.bulkheadEng.fx) UI.cfg.bulkheadEng.bi = +t.value;  // blueprint pianificato: segue la corazza
    renderView();
  }
  else if (t.dataset.slotKind) {
    UI.cfg[t.dataset.slotKind][+t.dataset.slotI] = t.value ? { id: t.value } : null;
    UI.activeEngSlot = null; UI.engDraft = null;
    t.blur();
    renderView();
  }
});
document.addEventListener("toggle", e => {
  const key = e.target.dataset?.key;
  if (key) e.target.open ? UI.open.add(key) : UI.open.delete(key);
}, true);
document.addEventListener("submit", e => {
  e.preventDefault();
  const id = e.target.dataset.form;
  const q = formData(id);
  if (id === "trade") run("trade", () => api("/api/trade", q));
  else if (id === "market") run("market", async () => {
    UI.res.market = { busy: true, mode: q.mode || "sell" };
    return api("/api/search", { mode: "sell", sort: "price", max_dist: 100, no_carriers: true, ...q });
  }).then(() => { if (UI.res.market.data) UI.res.market.mode = q.mode || "sell"; renderView(); });
  else if (id === "cargo") run("cargoPrices", cargoPrices);
  else if (id === "hot") run("hot", () => api("/api/hotspots", { commodity: "Painite", max_dist: 100, ...q }));
  else if (id?.startsWith("rt-")) {
    const tool = id.slice(3);
    run("route", async () => {
      const body = { ...q };
      // il modulo manda solo i campi toccati: il valore minimo mostrato come predefinito va mandato lo stesso
      if (body.min_value == null && TOOLS[tool]?.min) body.min_value = TOOLS[tool].min;
      if (tool === "galaxy") {
        body.fsd = fsdFor(q.ship || shipChoices().find(c => c[1].includes("attuale"))?.[0] || shipChoices()[0]?.[0]);
        if (body.fsd && q.cargo) body.fsd = { ...body.fsd };
      }
      ROUTE = await api("/api/plot/" + tool, body);
      Stars.warp(1600);
      return ROUTE;
    });
  }
  else if (id === "search") run("search", async () => ({ ...(await api("/api/search", { mode: "service", service: "Interstellar Factors Contact", no_carriers: true, ...q })), mode: q.mode || "service" }));
  else if (id === "todo") {
    addTodo((q.text || "").trim(), q.category || "Generale", (q.system || "").trim());
    UI.forms.todo = { category: q.category };
  }
});
window.addEventListener("hashchange", () => { Stars.nudge(); renderView(true); });
