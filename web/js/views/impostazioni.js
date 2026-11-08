"use strict";
// Scheda Impostazioni: aspetto, lingua dei termini di gioco, companion per il telefono, dati salvati, informazioni.

const LANGS = [
  ["mixed", "Misto", "Interfaccia in italiano, nomi del gioco in originale (moduli, materiali, merci, ingegnerizzazioni, ranghi)."],
  ["it", "Tutto italiano", "Traduce anche i nomi del gioco. Attenzione: in gioco li vedrai in inglese."],
  ["en", "Tutto originale", "Tutti i termini del gioco in inglese, compresi tipi di pianeta, governi ed economie."],
];

// Lingua dell'interfaccia (menu, pulsanti, testi, messaggi del copilota): separata da quella dei termini di gioco.
const UI_LANGS = [["it", "Italiano"], ["en", "English"]];
function setUiLang(l) {
  if (l === LANG.lang) return;
  // In inglese i nomi del gioco "misti" lascerebbero in italiano pianeti, governi ed economie: passo a "Tutto originale"
  // e, se si torna all'italiano, ripristino "Misto" (solo se il cambio l'avevo fatto io).
  if (l === "en" && SETTINGS.lang === "mixed") { SETTINGS.langAuto = true; setSetting("lang", "en"); }
  else if (l === "it" && SETTINGS.langAuto) { delete SETTINGS.langAuto; setSetting("lang", "mixed"); }
  LANG.set(l);
}
const uiLangButtons = attr => UI_LANGS.map(([v, l]) =>
  `<button class="small ${LANG.lang === v ? "primary" : ""}" ${attr}="${v}" aria-pressed="${LANG.lang === v}" lang="${v}" data-no-translate>${l}</button>`).join("");
document.addEventListener("click", e => {
  const b = e.target.closest("[data-ui-lang]");
  if (b) setUiLang(b.dataset.uiLang);
});

function dataRow(title, desc, button) {
  return `<div class="todo-item" style="align-items:center"><div class="text">${title}<div class="sub">${desc}</div></div>${button}</div>`;
}

function companionPanel() {
  const lan = S.lan || {};
  const toggle = `<button class="switch ${lan.enabled ? "on" : ""}" id="lan-toggle" role="switch" aria-checked="${!!lan.enabled}"
    aria-label="Accesso dal telefono"><span></span><span></span></button>`;
  const head = dataRow("Accesso dal telefono",
    "Rende l'app raggiungibile dagli altri dispositivi della tua rete Wi-Fi, protetta da un codice segreto contenuto nel QR.", toggle);
  if (!lan.enabled) {
    return head + `<div class="sub" style="margin-top:8px">Spento: l'app è raggiungibile solo da questo PC.
      Attivalo per usare il telefono come pulsantiera (carrello, luci, scudi, macro) e telecomando delle schede.</div>`;
  }
  return head + `<div style="display:flex;gap:18px;align-items:center;flex-wrap:wrap;margin-top:12px">
      <div class="qr-box"><img src="/api/qrcode?ts=${encodeURIComponent(lan.url || "")}" width="160" height="160" alt="QR code del companion"></div>
      <div style="flex:1;min-width:220px">
        <div class="eyebrow">Inquadralo con il telefono</div>
        <div class="sub" style="margin:6px 0 10px">Telefono e PC devono essere sulla stessa rete Wi-Fi. Non condividere il QR:
          chi lo ha può premere tasti nel gioco. Se serve, spegni e riaccendi l'accesso per cambiarne il codice.</div>
        <button class="small" data-copy="${esc(lan.url || "")}">Copia l'indirizzo</button>
        ${lan.https ? `<div class="sub" style="margin-top:10px">Connessione cifrata (HTTPS) con un certificato creato dall'app:
          la prima volta il telefono mostra un avviso di sicurezza, scegli <b>Avanzate → Procedi</b>. Così funziona anche il comando vocale.
          ${lan.fingerprint ? `<div class="mono" style="font-size:10px;margin-top:4px;word-break:break-all">Impronta: ${esc(lan.fingerprint)}</div>` : ""}</div>`
          : '<div class="sub" style="margin-top:10px">Connessione non cifrata: dal telefono funzionano i pulsanti ma non il comando vocale.</div>'}
      </div>
    </div>${lan.https ? installAppNote(lan) : ""}`;
}

// Installare il companion come app sul telefono (icona sulla schermata Home, a schermo intero): il telefono deve prima
// fidarsi della piccola CA creata dall'app (app/tls.py), valida solo per gli indirizzi delle reti di casa.
// Gli stessi passi, più dettagliati, sono nella sezione "Installa come app" della pagina del companion.
function installAppNote(lan) {
  const li = text => `<li style="margin-bottom:4px">${text}</li>`;
  const warn = lan.ip_private === false
    ? `<div class="bad" style="margin:8px 0">L'indirizzo di questo PC non è di una rete di casa: il telefono non potrà fidarsi del certificato e l'installazione come app non funzionerà.</div>` : "";
  return `<div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--hud-faint)">
    <div class="eyebrow">Installa come app sul telefono</div>
    <div class="sub" style="margin:6px 0 10px">Per avere il companion come app (icona sulla schermata Home, a schermo intero, senza la barra del browser) il telefono deve fidarsi del certificato di Voidwatch ED. Il certificato vale solo per gli indirizzi delle reti di casa: non può essere usato per nessun sito internet.</div>
    ${warn}
    <div style="display:flex;gap:18px;align-items:flex-start;flex-wrap:wrap">
      ${lan.ca_url ? `<div class="qr-box"><img src="/api/qrcode?for=ca&ts=${encodeURIComponent(lan.ca_url)}" width="140" height="140" alt="QR code del certificato"></div>` : ""}
      <div style="flex:1;min-width:220px">
        <div class="sub">Inquadra il QR per scaricare il certificato, poi:</div>
        <ol class="sub" style="margin:6px 0 8px;padding-left:20px">
          ${li("Android: Impostazioni › Sicurezza e privacy › Altre impostazioni di sicurezza › Crittografia e credenziali › Installa un certificato › Certificato CA (i nomi cambiano con la marca).")}
          ${li("iPhone: Impostazioni › Generali › VPN e gestione dispositivi › installa il profilo; poi Generali › Info › Impostazioni certificati attendibili › attiva la fiducia completa.")}
          ${li("Apri il companion: nella sezione «Installa come app» trovi il pulsante (Android) o i passi per Condividi › Aggiungi alla schermata Home (iPhone).")}
        </ol>
        ${lan.ca_url ? `<button class="small" data-copy="${esc(lan.ca_url)}">Copia l'indirizzo del certificato</button>` : ""}
        ${lan.ca_fingerprint ? `<div class="sub" style="margin-top:8px">Impronta del certificato (SHA-256), da confrontare con quella mostrata dal telefono:</div>
          <div class="mono" style="font-size:10px;margin-top:2px;word-break:break-all">${esc(lan.ca_fingerprint)}</div>` : ""}
        ${lan.token ? `<div class="sub" style="margin-top:8px">Se l'app installata chiede il codice di accesso:</div>
          <div class="mono" style="font-size:12px;margin-top:2px;word-break:break-all">${esc(lan.token)}</div>` : ""}
      </div>
    </div>
  </div>`;
}

// Impostazioni lette dal server (Inara, overlay, aggiornamenti): caricate una volta, ricaricate dopo ogni modifica.
const loadServerSettings = () => run("serverSettings", () => api("/api/settings"));
const switchBtn = (id, on, label) =>
  `<button class="switch ${on ? "on" : ""}" id="${id}" role="switch" aria-checked="${!!on}" aria-label="${esc(label)}"><span></span><span></span></button>`;

function inaraPanel(st) {
  if (st.inara.configured && !UI.res.inaraProfile) run("inaraProfile", () => api("/api/inara/profile"));
  const p = UI.res.inaraProfile?.data;
  const prof = !st.inara.configured ? "" : !p ? '<div class="loading">Collegamento a Inara</div>'
    : p.error ? `<div class="bad" style="margin-top:8px">⚠ ${esc(p.error)}</div>`
    : `<div class="kv-grid" style="margin-top:10px">
        <div class="kv"><span>Comandante</span><span>${esc(p.name || "—")}</span></div>
        <div class="kv"><span>Squadriglia</span><span>${esc(p.squadron?.name || "—")}</span></div>
        <div class="kv"><span>Power preferito</span><span>${esc(p.power || "—")}</span></div>
        <div class="kv"><span>Ruolo</span><span>${esc(p.role || "—")}</span></div></div>
      ${p.url ? `<button class="small" data-open="${esc(p.url)}" style="margin-top:8px">Apri il profilo su Inara</button>` : ""}`;
  return `<div class="sub">Con la tua chiave API personale l'app legge da Inara il tuo profilo e gli obiettivi della comunità.
      L'API di Inara non offre ricerche su mercati, stazioni o rotte e i termini del sito vietano di copiarne le pagine:
      per quelle l'app usa Spansh. Inara compare solo qui: da questo pannello apri il sito o il tuo profilo.</div>
    <div style="display:flex;gap:8px;margin-top:10px">
      <input id="inara-key" type="password" autocomplete="off" style="flex:1"
        placeholder="${st.inara.configured ? "Chiave salvata (scrivine una nuova per cambiarla)" : "Chiave API di Inara"}">
      <button class="small primary" id="inara-key-save">Salva</button>
      ${st.inara.configured ? '<button class="small ghost" id="inara-key-clear">Rimuovi</button>' : ""}
    </div>
    <div style="display:flex;gap:8px;margin-top:6px;flex-wrap:wrap">
      <button class="small ghost" data-open="https://inara.cz/elite/">Apri Inara</button>
      <button class="small ghost" data-open="https://inara.cz/elite/cmdr-settings-api/">Dove trovo la chiave? (Inara → Settings → API)</button></div>${prof}`;
}

function overlayPanel(st) {
  const o = S.overlay || st.overlay;
  if (!o.available) return '<div class="sub">L\'overlay è disponibile solo nella finestra dell\'app, non nel browser.</div>';
  return dataRow("Overlay sopra il gioco", "Finestra trasparente sempre in primo piano: sistema, prossimo salto, carburante, campioni bio, ultimo evento.",
      switchBtn("overlay-toggle", o.enabled, "Overlay"))
    + dataRow("Blocca e lascia passare i clic", "Bloccato: resta fermo e i clic arrivano al gioco. Sbloccato: trascinalo e ridimensionalo dove vuoi.",
      switchBtn("overlay-lock", o.locked, "Blocca overlay"))
    + dataRow("Opacità", "Quanto si vede il gioco dietro all'overlay.", `<div class="seg-choice">${[50, 65, 80, 100].map(v =>
        `<button class="small ${o.opacity === v ? "primary" : ""}" data-ov-opacity="${v}">${v}%</button>`).join("")}</div>`)
    + '<div class="sub" style="margin-top:6px">In Elite imposta la modalità video <b>Finestra senza bordi</b>: lo schermo intero copre qualsiasi overlay.</div>';
}

function updatePanel(st) {
  const u = st.update, l = u.latest;
  return `<table><tbody><tr><td class="muted">Versione installata</td><td class="mono">${esc(u.current)}</td></tr>
      ${l ? `<tr><td class="muted">Ultima versione</td><td class="mono">${esc(l.version)} ${u.available ? '<span class="tag ok">nuova</span>' : '<span class="sub">sei aggiornato</span>'}</td></tr>` : ""}
      ${u.checked ? `<tr><td class="muted">Ultimo controllo</td><td>${ago(u.checked)}</td></tr>` : ""}</tbody></table>
    ${u.error ? `<div class="sub bad" style="margin-top:6px">${esc(u.error)}</div>` : ""}
    ${u.busy ? `<div class="loading">Download${u.progress != null ? " " + u.progress + "%" : ""}</div>` : ""}
    <div style="display:flex;gap:8px;margin-top:10px;flex-wrap:wrap">
      <input id="update-repo" placeholder="Repository GitHub (utente/nome)" value="${esc(u.repo)}" style="flex:1;min-width:180px">
      <button class="small" id="update-repo-save">Salva</button>
      <button class="small" id="update-check" ${u.repo ? "" : "disabled"}>Controlla ora</button>
      ${u.available ? `<button class="small primary" id="update-install" ${u.frozen ? "" : "disabled"}>Installa ${esc(l.version)}</button>` : ""}
    </div>
    ${l?.notes && u.available ? `<div class="sub" style="margin-top:8px;white-space:pre-wrap;max-height:120px;overflow:auto">${esc(l.notes)}</div>` : ""}
    ${dataRow("Controlla all'avvio", "Se c'è una nuova versione la vedi qui; l'installazione parte solo quando premi il pulsante.",
      switchBtn("update-auto", u.auto, "Controlla all'avvio"))}
    <div class="sub" style="margin-top:6px">Una versione si installa solo se la release contiene <b>Voidwatch ED.exe</b> con la sua impronta SHA-256:
      un file corrotto o alterato non viene mai eseguito.</div>`;
}

function discordPanel(st) {
  const d = st.discord;
  return `<div class="sub">Sul tuo profilo Discord compare cosa stai facendo in Elite: nave, sistema o stazione, da quanto giochi.
      Serve Discord aperto sul PC e l'<b>ID di un'applicazione Discord</b>: su Discord Developer Portal premi
      "New Application", chiamala come vuoi far vedere (es. "Elite Dangerous") e copia l'Application ID.</div>
    <div style="display:flex;gap:8px;margin-top:10px">
      <input id="discord-id" placeholder="Application ID (solo numeri)" value="${esc(d.client_id)}" style="flex:1">
      <button class="small" id="discord-id-save">Salva</button></div>
    <button class="small ghost" data-open="https://discord.com/developers/applications" style="margin:6px 0 10px">Apri Discord Developer Portal</button>
    ${dataRow("Mostra su Discord", d.connected ? '<span class="ok">Collegato a Discord</span>' : esc(d.error || (d.enabled ? "In attesa di Discord" : "Spento")),
      switchBtn("discord-toggle", d.enabled, "Discord"))}
    ${dataRow("Mostra il sistema", "Spento: si vede solo la nave e l'attività, non dove sei.", switchBtn("discord-system", d.show_system, "Mostra il sistema"))}`;
}

function backupPanel() {
  return dataRow("Esporta i dati", "Crea uno zip nella cartella Download con cose da fare, macro, controlli, avvisi, diario, allestimenti salvati e impostazioni (comprese le chiavi API di Inara ed EDSM: tienilo per te).",
      '<button class="small" id="backup-export">Esporta</button>')
    + dataRow("Importa un backup", "Ripristina uno zip esportato da Voidwatch ED, anche da un altro PC. I dati attuali vengono prima copiati nella cartella cache.",
      '<label class="btn small" style="cursor:pointer">Importa<input type="file" id="backup-import" accept=".zip" hidden></label>');
}

document.addEventListener("change", async e => {
  if (e.target.id !== "backup-import" || !e.target.files[0]) return;
  const file = e.target.files[0];
  e.target.value = "";
  if (!confirm(LANG.t(`Ripristino il backup "${file.name}"? Le impostazioni attuali verranno sostituite (ne resta una copia).`))) return;
  try {
    const res = await fetch("/api/backup/import", { method: "POST", headers: { "Content-Type": "application/zip" }, body: file });
    const r = await res.json();
    if (!res.ok) throw new Error(r.error || res.statusText);
    for (const [k, v] of Object.entries(r.ui || {})) localStorage.setItem(k, v);
    alert(LANG.t(`Backup ripristinato (${r.restored.length} file). L'app si ricarica.`));
    location.reload();
  } catch (err) { toast("Importazione non riuscita: " + err.message); }
});

document.addEventListener("click", e => {
  const t = e.target.closest("button");
  if (!t) return;
  if (t.id === "backup-export") {
    const ui = Object.fromEntries(Object.keys(localStorage).map(k => [k, localStorage.getItem(k)]));
    return api("/api/backup/export", { ui }).then(r => toast("Backup salvato: " + r.path)).catch(err => toast(err.message));
  }
  if (t.id === "discord-id-save") return api("/api/discord", { client_id: $("discord-id")?.value.trim() || "" })
    .then(() => { toast("ID di Discord salvato"); loadServerSettings(); }).catch(err => toast(err.message));
  if (t.id === "discord-toggle" || t.id === "discord-system") {
    const d = UI.res.serverSettings?.data?.discord || {};
    return api("/api/discord", t.id === "discord-toggle" ? { enabled: !d.enabled } : { show_system: !d.show_system })
      .then(loadServerSettings).catch(err => toast(err.message));
  }
  if (t.dataset.ovOpacity) return api("/api/overlay", { opacity: +t.dataset.ovOpacity }).then(loadServerSettings).catch(err => toast(err.message));
  if (!t.id) return;
  const save = (path, body, msg) => api(path, body)
    .then(r => { toast(msg); UI.res.inaraProfile = undefined; loadServerSettings(); return r; })
    .catch(err => toast(err.message));
  if (t.id === "inara-key-save") {
    const key = $("inara-key")?.value.trim();
    if (!key) return toast("Scrivi la chiave API di Inara");
    save("/api/inara/key", { key }, "Chiave di Inara salvata");
  } else if (t.id === "inara-key-clear") save("/api/inara/key", { key: "" }, "Chiave di Inara rimossa");
  else if (t.id === "overlay-toggle") save("/api/overlay", { enabled: !S.overlay?.enabled }, S.overlay?.enabled ? "Overlay chiuso" : "Overlay aperto");
  else if (t.id === "overlay-lock") save("/api/overlay", { locked: !S.overlay?.locked }, S.overlay?.locked ? "Overlay sbloccato" : "Overlay bloccato");
  else if (t.id === "update-repo-save") save("/api/update/config", { repo: $("update-repo")?.value.trim() || "" }, "Fonte degli aggiornamenti salvata");
  else if (t.id === "update-auto") save("/api/update/config", { auto: !UI.res.serverSettings?.data?.update.auto }, "Impostazione salvata");
  else if (t.id === "update-check") save("/api/update/check", {}, "Controllo completato");
  else if (t.id === "update-install") {
    if (!confirm(LANG.t("Scarico e installo la nuova versione? L'app si chiuderà e si riaprirà da sola."))) return;
    save("/api/update/install", {}, "Aggiornamento in corso");
    const poll = setInterval(loadServerSettings, 1500);
    setTimeout(() => clearInterval(poll), 120000);
  }
});

// Impostazioni divise in schede: Generali (#settings), Audio (#voice_commands: voce, microfono, comandi), Info & FAQ (#info).
const SETTINGS_TABS = [["settings", "Generali"], ["voice_commands", "Audio"], ["commands", "Comandi e macro"], ["info", "Info & FAQ"]];
const settingsTabs = cur => `<div class="settings-tabs">${SETTINGS_TABS.map(([id, label]) =>
  `<a href="#${id}" class="${id === cur ? "active" : ""}">${label}</a>`).join("")}</div>`;
{
  const cmds = VIEWS.commands;
  VIEWS.commands = () => settingsTabs("commands") + cmds();
  const audio = VIEWS.voice_commands;
  VIEWS.voice_commands = () => settingsTabs("voice_commands") + audio()
    + (typeof briefingSettingsPanel === "function" && S?.voice_config?.copilot_on !== false
      ? `<div style="margin-top:18px">${briefingSettingsPanel()}</div>` : "");
}

VIEWS.settings = () => {
  if (!UI.res.serverSettings) loadServerSettings();
  const st = UI.res.serverSettings?.data;
  const builds = savedBuilds().length;
  const cur = LANGS.find(l => l[0] === SETTINGS.lang) || LANGS[0];
  return settingsTabs("settings") + `<div class="grid even"><div class="col">
    ${panel("Aspetto", settingRow("vhs", "Effetti VHS", "Righe di scansione, grana e banda che scorre sullo schermo.")
      + settingRow("flicker", "Sfarfallio dello schermo", "Il leggero tremolio periodico, come un vecchio monitor.")
      + settingRow("stars", "Campo stellare animato", "Le stelle che scorrono sullo sfondo. Spegnilo se il PC fatica mentre giochi.")
      + settingRow("warp", "Effetto salto", "Le stelle accelerano quando salti in gioco o calcoli una rotta.")
      + settingRow("boot", "Sequenza di avvio", "La schermata di avvio all'apertura dell'app.")
      + settingRow("ticker", "Barra delle comunicazioni", "La barra in basso con eventi e suggerimenti che scorrono."), { code: "DISPLAY" })}
    ${panel("Lingua", `<div class="seg-choice" role="group" aria-label="Lingua dell'interfaccia">${uiLangButtons("data-ui-lang")}</div>
      <div class="sub" style="margin-top:8px">Lingua dell'interfaccia: menu, pulsanti, testi e messaggi del copilota. Cambiandola l'app si ricarica.</div>`, { code: "UI" })}
    ${panel("Lingua dei termini di gioco", `<div class="seg-choice">${LANGS.map(([v, l]) =>
        `<button class="small ${SETTINGS.lang === v ? "primary" : ""}" data-setting="lang" data-value="${v}">${l}</button>`).join("")}</div>
      <div class="sub" style="margin-top:8px">${esc(cur[2])}</div>
      <div class="sub" style="margin-top:6px">Vale solo per i nomi del gioco (materiali, merci, moduli, ingegnerizzazioni, ranghi…), non per il resto dell'interfaccia.</div>`, { code: "LINGUA" })}
  </div><div class="col">
    ${panel("Companion per il telefono", companionPanel(), { code: "RETE", cls: "holo" })}
    ${panel("Notifiche sul telefono", notifyPanel(), { code: "NOTIFY" })}
    ${panel("Inara", st ? inaraPanel(st) : '<div class="loading">Caricamento</div>', { code: "INARA" })}
    ${panel("Invio dati", st ? uploadPanel(st) : '<div class="loading">Caricamento</div>', { code: "UPLINK" })}
    ${panel("Overlay", st ? overlayPanel(st) : '<div class="loading">Caricamento</div>', { code: "OVERLAY" })}
    ${panel("Aggiornamenti", st ? updatePanel(st) : '<div class="loading">Caricamento</div>', { code: "UPDATE" })}
    ${panel("Discord", st ? discordPanel(st) : '<div class="loading">Caricamento</div>', { code: "DISCORD" })}
    ${panel("Backup", backupPanel(), { code: "BACKUP" })}
    ${panel("Dati salvati", dataRow("Consigli ignorati", `${UI.dismissed.size} consigli nascosti dal copilota.`,
        `<button class="small" id="advice-reset" ${UI.dismissed.size ? "" : "disabled"}>Ripristina</button>`)
      + dataRow("Allestimenti del cantiere", `${builds} allestimenti salvati.`,
        `<button class="small danger" id="builds-clear" ${builds ? "" : "disabled"}>Elimina tutti</button>`)
      + dataRow("Cose da fare", `${TODOS.length} attività salvate.`,
        `<button class="small danger" id="todos-clear-all" ${TODOS.length ? "" : "disabled"}>Elimina tutte</button>`), { code: "MEMORIA" })}
  </div></div>`;
};

// ============================================================================
// NOTIFICHE SUL TELEFONO (app/notify.py): quali eventi inviare al companion
// ============================================================================
function notifyPanel() {
  if (!UI.res.notifyCfg) run("notifyCfg", () => api("/api/notify/config"));
  return result("notifyCfg", c => {
    const sw = (attr, on, label) => `<button class="switch ${on ? "on" : ""}" ${attr} role="switch" aria-checked="${!!on}" aria-label="${esc(label)}"><span></span><span></span></button>`;
    const head = dataRow("Invia notifiche al companion",
      "Eventi importanti della partita sul telefono: avviso, vibrazione e suono. Tieni la pagina del companion aperta: in background il browser può ritardarle.",
      sw("data-notify-all", c.enabled, "Notifiche sul telefono"));
    const rows = Object.entries(c.labels).map(([k, label]) =>
      `<div class="notify-type ${c.enabled ? "" : "off"}"><span>${esc(label)}</span>${sw(`data-notify-type="${esc(k)}"`, c.types[k], label)}</div>`).join("");
    const lan = S.lan?.enabled ? "" : `<div class="sub" style="margin-top:6px">L'accesso dal telefono è spento: attivalo qui sopra per ricevere le notifiche.</div>`;
    return head + `<div class="notify-types">${rows}</div>${lan}
      <div style="margin-top:10px"><button class="small" data-notify-test>Invia notifica di prova</button></div>`;
  }, "Caricamento");
}

document.addEventListener("click", e => {
  const t = e.target.closest("[data-notify-all],[data-notify-type],[data-notify-test]");
  if (!t) return;
  if (t.matches("[data-notify-test]")) {
    return api("/api/notify/test", {}).then(() => toast("Notifica di prova inviata al companion")).catch(err => toast(err.message));
  }
  const c = UI.res.notifyCfg?.data;
  if (!c) return;
  const body = t.matches("[data-notify-all]") ? { enabled: !c.enabled } : { types: { [t.dataset.notifyType]: !c.types[t.dataset.notifyType] } };
  run("notifyCfg", () => api("/api/notify/config", body));
});

// ============================================================================
// INFO & FAQ
// ============================================================================
const FAQ = [
  ["La panoramica è vuota o i dati non si aggiornano.",
    "L'app legge i journal che Elite Dangerous scrive mentre giochi. Avvia il gioco almeno una volta ed entra in partita: i dati arrivano da soli. Qui sotto vedi la cartella dei journal che l'app sta usando."],
  ["L'app modifica il gioco?",
    "No. Legge solo i file journal e di stato che il gioco scrive apposta per i programmi esterni. I comandi alla nave (voce, pulsanti, macro, telefono) premono i tasti della tastiera che hai assegnato nei controlli del gioco, come faresti tu. Voidwatch ED è un progetto non ufficiale, non di Frontier."],
  ["Un comando vocale non fa niente in gioco.",
    "Il comando deve avere un tasto della tastiera assegnato nei controlli del gioco: in Impostazioni → Audio → Tasti del gioco vedi quali mancano e puoi aggiungerli in automatico. Il gioco deve essere aperto: prima di premere un tasto l'app lo porta in primo piano."],
  ["L'overlay non si vede sopra il gioco.",
    "Imposta il gioco in modalità video \"Finestra senza bordi\": a schermo intero il gioco copre qualsiasi finestra."],
  ["Il telefono mostra un avviso di sicurezza.",
    "La connessione con il telefono è cifrata con un certificato creato dall'app, che il telefono non conosce: la prima volta scegli \"Avanzate → Procedi\". Telefono e PC devono essere sulla stessa rete Wi-Fi."],
  ["Serve internet?",
    "Journal, panoramica, flotta, materiali, ingegneri, missioni, configuratore navi e cose da fare funzionano anche senza. Servono internet le ricerche di stazioni e mercati, le rotte, il Powerplay, le coordinate dei sistemi, le immagini delle navi e la voce del copilota."],
  ["Il riconoscimento vocale manda la mia voce su internet?",
    "No, gira sul tuo PC. Al primo uso scarica il modello di riconoscimento (circa 75 MB)."],
  ["Windows o l'antivirus dicono che l'app è sconosciuta.",
    "L'eseguibile non è firmato digitalmente, quindi Windows può mostrare l'avviso \"PC protetto da Windows\": scegli \"Ulteriori informazioni → Esegui comunque\" solo se l'hai scaricato da una fonte di cui ti fidi."],
  ["Dove sono i miei dati? Come li porto su un altro PC?",
    "Nella cartella dei dati indicata qui sotto, accanto all'eseguibile. Copia l'exe insieme a quella cartella, oppure usa Impostazioni → Generali → Backup."],
  ["Alcuni numeri sono indicati come stime.",
    "Quando il gioco non scrive un dato (per esempio i progressi delle missioni massacro dei compagni di squadra o il tempo d'arrivo di un fleet carrier), l'app lo calcola e lo segna come stima."],
  ["Qualcosa non funziona: come lo segnalo?",
    "Nella cartella dei dati c'è il file registro.log con gli ultimi messaggi dell'app: allegalo alla segnalazione insieme a cosa stavi facendo."],
];

VIEWS.info = () => {
  if (!UI.res.serverSettings) loadServerSettings();
  const st = UI.res.serverSettings?.data;
  const faq = FAQ.map(([q, a]) => `<details class="faq"><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join("");
  return settingsTabs("info") + `<div class="grid even"><div class="col">
    ${panel("Voidwatch ED", `
      <p>Companion per Elite Dangerous: legge il journal del gioco in tempo reale e ti aiuta con nave, rotte, commercio,
        missioni, ingegneri ed esplorazione, con un copilota vocale e un overlay da tenere sopra il gioco.</p>
      <table><tbody>
        <tr><td class="muted">Versione</td><td>${esc(st?.version || "—")}</td></tr>
        <tr><td class="muted">Journal di gioco</td><td>${esc(STATIC.journal_dir || "—")}</td></tr>
        <tr><td class="muted">Dati dell'app</td><td>${esc(STATIC.data_dir || "—")}</td></tr>
        <tr><td class="muted">Catalogo navi</td><td>${STATIC.catalog_updated ? "aggiornato " + ago(STATIC.catalog_updated) : "non ancora scaricato"}</td></tr>
      </tbody></table>
      ${dataRow("Guida iniziale", "I passi del primo avvio: journal, lingua, voce, tasti, push-to-talk e funzioni facoltative.",
        '<button class="small" data-welcome-open>Rivedi la guida iniziale</button>')}`, { code: "INFO" })}
    ${panel("Riconoscimenti", `
      <p class="sub">Voidwatch ED è software libero e gratuito, distribuito con licenza GNU GPL versione 2 o successiva:
        puoi usarlo, studiarlo, modificarlo e ridistribuirlo alle stesse condizioni. Dettagli in LICENSE e THIRD_PARTY_NOTICES.md.</p>
      <p class="sub">Elite Dangerous è un marchio di Frontier Developments plc. Voidwatch ED è un progetto amatoriale non ufficiale,
        non affiliato né approvato da Frontier.</p>
      <p class="sub">Dati delle navi e dei moduli: progetto Coriolis (EDCD, licenza MIT). Le ricerche online usano i servizi
        pubblici della community; i collegamenti sono in Luoghi utili.</p>
      <p class="sub">Previsione delle specie in Esobiologia: regole del plugin EDMC-BioScan e dati di EDMC-ExploData di Jeremy Rimpo
        (Silarn, licenza GNU GPL v2), basate sulle ricerche della community (Deep Space Network, Canonn); regioni galattiche dalla mappa
        EliteDangerousRegionMap di Ben Peddell (klightspeed, licenza MIT).</p>`, { code: "CREDITS" })}
  </div><div class="col">
    ${panel("Domande frequenti", faq, { code: "FAQ" })}
  </div></div>`;
};
