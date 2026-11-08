"use strict";
// Pannello "Invio dati" delle impostazioni: invio automatico a EDDN, EDSM e Inara (attivazione, chiave di EDSM, stato).
// Lo stato si carica una volta e si aggiorna in silenzio ogni UPLOAD_REFRESH ms, non a ogni ridisegno della scheda.

const UPLOAD_REFRESH = 10000;
const UPLOAD_DESTS = [
  ["eddn", "EDDN", "Rete di dati della comunità: sistemi, corpi celesti, mercati, equipaggiamento e cantieri che visiti. "
    + "Anonimo e senza dati personali; da qui li prendono Spansh, Inara, EDSM e gli altri siti."],
  ["edsm", "EDSM", "Diario di volo, flotta, materiali e crediti sul tuo profilo EDSM. "
    + "Servono il nome del comandante su EDSM e la chiave API."],
  ["inara", "Inara", "Crediti, ranghi, reputazione, navi e allestimenti, viaggi, materiali, stiva e missioni sul tuo profilo Inara. "
    + "Usa la chiave API del pannello Inara."],
];

function loadUploadStatus(quiet) {
  loadUploadStatus.ts = Date.now();
  if (!quiet) return run("uploadStatus", () => api("/api/upload/status"));
  return api("/api/upload/status")
    .then(d => { UI.res.uploadStatus = { data: d }; if (currentTab() === "settings") renderView(); })
    .catch(() => {});
}

const uploadSwitch = (dest, on, label) =>
  `<button class="switch ${on ? "on" : ""}" id="upload-${dest}" role="switch" aria-checked="${!!on}" aria-label="${esc(label)}"><span></span><span></span></button>`;

function uploadStatusLine(d) {
  if (!d.enabled) return '<div class="sub" style="margin-top:4px">Spento: non viene inviato nulla.</div>';
  let html = `<div class="sub" style="margin-top:4px">In coda: <b>${num(d.queued)}</b> · inviati da quando hai aperto l'app: ${num(d.sent)}
    · ultimo invio riuscito: ${d.last_ok ? ago(d.last_ok) : "—"}</div>`;
  if (d.paused) html += `<div class="bad" style="margin-top:4px">⚠ Invii fermi: ${esc(d.paused)}</div>`;
  else if (d.last_error && (!d.last_ok || (d.error_ts || 0) >= d.last_ok)) {
    html += `<div class="sub bad" style="margin-top:4px">${d.error_ts ? `Ultimo errore (${ago(d.error_ts)})` : "Attenzione"}: ${esc(d.last_error)}</div>`;
  }
  return html;
}

function uploadPanel(st) {
  const r = UI.res.uploadStatus;
  if (!r) loadUploadStatus();
  else if (!r.busy && Date.now() - (loadUploadStatus.ts || 0) > UPLOAD_REFRESH) loadUploadStatus(true);
  const u = r?.data;
  if (!u) return r?.error ? `<div class="bad">⚠ ${esc(r.error)}</div>` : '<div class="loading">Caricamento</div>';
  const anyOn = UPLOAD_DESTS.some(([d]) => u[d]?.enabled);
  const blocked = anyOn && u.game?.blocked
    ? `<div class="sub ${u.game.version ? "bad" : ""}" style="margin-bottom:8px">${u.game.version ? "⚠ Invio sospeso" : "In attesa del gioco"}: ${esc(u.game.blocked)}.</div>` : "";
  const rows = UPLOAD_DESTS.map(([dest, label, desc]) => {
    const d = u[dest] || {};
    let extra = "";
    if (dest === "edsm") {
      extra = `<div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">
          <input id="edsm-cmdr" autocomplete="off" style="flex:1;min-width:140px" value="${esc(d.cmdr || "")}"
            placeholder="Comandante su EDSM${u.game?.cmdr ? ` (vuoto: ${esc(u.game.cmdr)})` : ""}">
          <input id="edsm-key" type="password" autocomplete="off" style="flex:1;min-width:160px"
            placeholder="${d.configured ? "Chiave salvata (scrivine una nuova per cambiarla)" : "Chiave API di EDSM"}">
          <button class="small primary" id="upload-edsm-save">Salva</button>
          ${d.configured ? '<button class="small ghost" id="upload-edsm-clear">Rimuovi</button>' : ""}
        </div>
        <div style="margin-top:6px"><button class="small ghost" data-open="https://www.edsm.net/en/settings/api">Dove trovo la chiave? (EDSM → Settings → API Key)</button></div>`;
    } else if (dest === "inara") {
      if (d.enabled && !st.inara?.configured) extra = '<div class="sub bad" style="margin-top:4px">Salva prima la chiave API nel pannello Inara.</div>';
      if (d.paused) extra += `<div class="sub" style="margin-top:4px">Inara accetta gli aggiornamenti solo dalle app approvate dal suo autore:
        se l'errore parla del nome dell'applicazione, Voidwatch ED non è ancora nella lista. Gli eventi restano in coda fino a 30 giorni
        e partono quando cambi la chiave o riavvii l'app.</div>`;
    }
    return dataRow(`Invia a ${label}`, desc, uploadSwitch(dest, d.enabled, `Invia a ${label}`)) + uploadStatusLine(d) + extra;
  }).join('<div style="height:10px"></div>');
  return `${blocked}${rows}
    <div class="sub" style="margin-top:10px">Parte solo ciò che succede mentre l'app è aperta (non lo storico), mai dalle versioni beta o Legacy
      del gioco né quando sei nell'equipaggio di un altro comandante. Senza rete gli invii restano in coda e ripartono da soli.</div>`;
}

document.addEventListener("click", e => {
  const t = e.target.closest("button");
  if (!t || !t.id || !t.id.startsWith("upload-")) return;
  const cur = UI.res.uploadStatus?.data;
  const send = (body, msg) => api("/api/upload/config", body)
    .then(d => { UI.res.uploadStatus = { data: d }; loadUploadStatus.ts = Date.now(); toast(msg); renderView(); })
    .catch(err => toast(err.message));
  const dest = UPLOAD_DESTS.find(([d]) => t.id === `upload-${d}`);
  if (dest) {
    const on = !cur?.[dest[0]]?.enabled;
    send({ [`upload_${dest[0]}`]: on }, on ? `Invio a ${dest[1]} attivato` : `Invio a ${dest[1]} spento`);
  } else if (t.id === "upload-edsm-save") {
    const key = $("edsm-key")?.value.trim() || "";
    if (!key && !cur?.edsm?.configured) return toast("Scrivi la chiave API di EDSM");
    const body = { edsm_cmdr: $("edsm-cmdr")?.value.trim() || "" };
    if (key) body.edsm_api_key = key;
    send(body, "Dati di EDSM salvati");
  } else if (t.id === "upload-edsm-clear") send({ edsm_api_key: "" }, "Chiave di EDSM rimossa");
});
