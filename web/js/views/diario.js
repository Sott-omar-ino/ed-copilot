"use strict";

// ============================================================================
// DIARIO DI BORDO
// ============================================================================
// Elenco delle sessioni e cronologia della sessione scelta, ricostruiti dal server a partire dai journal.
// Restano in UI.res (diaryList, diarySes): si richiedono al massimo una volta al minuto, non a ogni
// aggiornamento dell'interfaccia; dopo ogni modifica (nota, impostazioni) si ricaricano subito.
const DIARY_TTL = 60000;
const DIARY_KIND = {
  start: ["Inizio", "muted"], jump: ["Salti", "holo-t"], dock: ["Attracco", "gold"], land: ["Atterraggio", "bio"],
  space: ["Nello spazio", "muted"], carrier: ["Carrier", "holo-t"], death: ["Nave persa", "bad"], note: ["Nota", "new"],
};

function diaryFetch(key, url, force = false) {
  const r = UI.res[key];
  if (r?.busy) return r;
  if (force || !r || r.url !== url || Date.now() - r.at > DIARY_TTL) {
    const prev = r?.url === url ? r.data : undefined;  // durante l'aggiornamento resta visibile il dato precedente
    UI.res[key] = { busy: true, data: prev, url, at: Date.now() };
    api(url).then(data => { UI.res[key] = { data, url, at: Date.now() }; })
      .catch(e => { UI.res[key] = { data: prev, error: e.message, url, at: Date.now() }; })
      .finally(() => { if (currentTab() === "diary") renderView(); });
  }
  return UI.res[key];
}
const diaryList = (force) => diaryFetch("diaryList", "/api/diary", force);
const diarySession = (id, force) => diaryFetch("diarySes", "/api/diary/session" + (id ? "?id=" + encodeURIComponent(id) : ""), force);
function diaryReload() {
  diaryList(true);
  diarySession(UI.diaryId, true);
}

async function diaryPost(url, body, msg) {
  try {
    const d = await api(url, body);
    if (msg) toast(typeof msg === "function" ? msg(d) : msg);
    return d;
  } catch (e) {
    toast("Errore: " + e.message);
    return null;
  }
}

const diaryThumb = name => "/api/diary/thumb?name=" + encodeURIComponent(name);

function diaryShots(shots) {
  if (!shots.length) return "";
  return `<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:6px">${shots.map(sh => {
    const label = [sh.system, sh.body && sh.body !== sh.system ? sh.body : null].filter(Boolean).join(" · ");
    if (!sh.png) return `<span class="tag muted" title="${esc(label)}">Screenshot ${esc(sh.time)}${sh.bmp ? " · BMP da convertire" : " · file non trovato"}</span>`;
    return `<button class="ghost" data-diary-open="${esc(sh.png)}" title="${esc(label + " · " + sh.time)} — apri l'immagine" style="padding:0;line-height:0">
      <img data-keep loading="lazy" src="${diaryThumb(sh.png)}" alt="${esc(label)}" style="width:160px;height:90px;object-fit:cover;display:block"></button>`;
  }).join("")}</div>`;
}

function diaryTimeline(d) {
  if (!d.timeline.length) return '<div class="empty">Nessun evento di rilievo in questa sessione</div>';
  return d.timeline.map(e => {
    const [label, cls] = DIARY_KIND[e.kind] || ["Evento", "muted"];
    return `<div class="todo-item" style="align-items:flex-start">
      <div class="mono" style="min-width:92px;color:var(--text-3)">${esc(e.time)}${e.until ? "–" + esc(e.until) : ""}</div>
      <div class="text"><span class="tag ${cls}">${label}</span> ${esc(e.text)}
        ${e.details.length ? `<ul style="margin:4px 0 0 18px;padding:0;font-weight:600">${e.details.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
        ${diaryShots(e.shots)}</div>
      ${e.note ? `<div class="actions"><button class="small ghost" data-diary-del-note="${esc(e.note)}" title="Elimina la nota">✕</button></div>` : ""}</div>`;
  }).join("");
}

function diaryNotes(d) {
  const f = "diary-note", live = d.session.live;
  const list = d.notes.length ? d.notes.map(n => `<div class="todo-item"><div class="text">${esc(n.text)}
      <div class="sub">${esc(n.date)} · ${n.kind === "time" ? "nella cronologia" : "nota della sessione"}</div></div>
      <div class="actions"><button class="small ghost" data-diary-del-note="${esc(n.id)}" title="Elimina">✕</button></div></div>`).join("")
    : '<div class="empty">Nessuna nota. Scrivi cosa hai fatto, cosa ti è piaciuto o cosa fare la prossima volta</div>';
  return list + `<form class="form" data-form="${f}" id="f-diary-note" style="margin-top:10px">
    <label class="grow-1">Nuova nota<textarea id="diary-note-text" name="text" rows="2" maxlength="4000" placeholder="es. Trovato un ottimo hotspot di Painite nell'anello A">${esc(fv(f, "text"))}</textarea></label>
    <label>Dove<select name="where">${opt("session", "Nota della sessione", fv(f, "where", "session"))}${opt("now", live ? "Adesso, nella cronologia" : "Adesso (ultima sessione)", fv(f, "where", "session"))}</select></label>
    <button class="primary" type="submit">Aggiungi</button></form>`;
}

function diarySettings(list) {
  const s = list.settings, job = list.job, f = "diary-shots";
  const jobLine = job.running ? `<div class="loading">CONVERSIONE ${job.done}/${job.total}</div>`
    : job.total ? `<div class="sub" style="margin-top:8px">Ultima conversione: ${job.converted} convertiti, ${job.skipped} saltati${job.errors ? `, <span class="bad">${job.errors} errori</span>` : ""}${job.last_error ? ` · ${esc(job.last_error)}` : ""}</div>` : "";
  // F10 = screenshot predefinito, salvato in BMP in Pictures\Frontier Developments\Elite Dangerous
  // (forums.frontier.co.uk/threads/where-does-it-store-ed-screenshots.534204).
  return `<div class="sub" style="margin-bottom:10px">Il gioco salva gli screenshot (F10) in BMP in <span class="mono">${esc(s.pictures_dir)}</span>.
      ED Copilot li converte in PNG con il nome del sistema, del corpo e la data, e li collega alla cronologia.</div>
    <form class="form" data-form="${f}" id="f-diary-shots">
      ${chk(f, "convert", s.convert, "Converti automaticamente i nuovi screenshot")}
      ${chk(f, "delete_bmp", s.delete_bmp, "Elimina il BMP originale dopo la conversione")}
      <label class="grow-1">Cartella PNG<input id="diary-out-dir" name="out_dir" value="${esc(fv(f, "out_dir", s.out_dir))}" placeholder="${esc(s.default_out)}"></label>
      <button class="primary" type="submit">Salva</button></form>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">
      <button class="small" data-diary-convert ${job.running ? "disabled" : ""}>Converti screenshot esistenti</button>
      <button class="small ghost" data-diary-open-folder>Apri cartella</button></div>
    <div class="sub" style="margin-top:6px">Cartella in uso: <span class="mono">${esc(s.out_dir_effective)}</span></div>${jobLine}`;
}

VIEWS.diary = () => {
  const lr = diaryList(), list = lr.data;
  if (!list) return panel("Diario di bordo", lr.error ? `<div class="bad">⚠ ${esc(lr.error)}</div>` : '<div class="loading">LETTURA DEI JOURNAL IN CORSO</div>', { code: "LOG" });
  // Durante la conversione degli screenshot l'avanzamento si aggiorna ogni 2 secondi.
  if (list.job.running && Date.now() - lr.at > 1500) diaryList(true);
  if (UI.diaryJobRunning && !list.job.running) diarySession(UI.diaryId, true);
  UI.diaryJobRunning = list.job.running;

  const sr = diarySession(UI.diaryId), d = sr.data;
  const sel = d?.session.id;
  const rows = list.sessions.map(s => `<tr class="${s.id === sel ? "hot" : ""}" data-diary-sel="${esc(s.id)}" style="cursor:pointer">
      <td>${esc(statDate(s.start))}${s.live ? ' <span class="tag new">in corso</span>' : ""}
        <div class="sub">${esc(s.ships.join(" · ") || "—")}${s.notes ? ` · ${s.notes} ${s.notes === 1 ? "nota" : "note"}` : ""}${s.shots ? ` · ${s.shots} screenshot` : ""}</div></td>
      <td class="num">${dur(s.active)}</td><td class="num gold">${s.earned ? short(s.earned) : "—"}</td><td class="num">${s.jumps || "—"}</td></tr>`).join("");
  const sessions = panel("Sessioni", list.sessions.length ? `<div style="max-height:520px;overflow:auto"><table><thead><tr><th>${LANG.lang === "en" ? LANG.t("Data della sessione") : "Data"}</th><th class="num">Durata</th>
      <th class="num">CR</th><th class="num">Salti</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<div class="empty">Nessuna sessione nei journal</div>',
    { code: "SESSIONS", aside: `${list.sessions.length}${lr.busy ? " · aggiorno…" : ""} <button class="small ghost" data-diary-refresh title="Rileggi i journal">↻</button>` });

  let main;
  if (!d) main = panel("Cronologia", sr.error ? `<div class="bad">⚠ ${esc(sr.error)}</div>` : '<div class="loading">COMPOSIZIONE DEL DIARIO</div>', { code: "TIMELINE" });
  else {
    const s = d.session;
    main = panel(esc(d.title), `<div style="margin-bottom:12px;line-height:1.5">${esc(d.summary.join(" "))}</div>
        <div class="kv-grid" style="margin-bottom:14px">
          <div class="kv"><span>Durata attiva</span><span>${dur(s.active)}</span></div>
          <div class="kv"><span>Guadagnato</span><span class="gold">${short(s.earned)} CR</span></div>
          <div class="kv"><span>Salti</span><span>${num(s.jumps)}</span></div>
          <div class="kv"><span>Distanza</span><span>${ly(s.ly)}</span></div>
          <div class="kv"><span>Screenshot</span><span>${num(d.shots.length)}</span></div></div>
        ${diaryTimeline(d)}`,
      { code: s.live ? "LIVE" : "TIMELINE", aside: `${sr.busy ? "aggiorno… " : ""}<button class="small" data-diary-export="${esc(s.id)}">Esporta sessione</button>` })
      + panel("Note del comandante", diaryNotes(d), { code: "NOTES" });
  }
  return `<div class="grid"><div class="col">${main}</div><div class="col">${sessions}
    ${panel("Esporta", `<div class="sub" style="margin-bottom:8px">Il diario viene salvato in Markdown nella cartella degli screenshot, con le immagini collegate.</div>
      <button class="small" data-diary-export="all">Esporta tutto il diario</button>${UI.diaryExported ? `<div class="sub" style="margin-top:8px">Salvato in <span class="mono">${esc(UI.diaryExported)}</span></div>` : ""}`, { code: "EXPORT" })}
    ${panel("Screenshot", diarySettings(list), { code: "PICTURES" })}</div></div>`;
};

document.addEventListener("click", async e => {
  const t = e.target.closest("[data-diary-sel], [data-diary-del-note], [data-diary-export], [data-diary-convert], [data-diary-open], [data-diary-open-folder], [data-diary-refresh]");
  if (!t || currentTab() !== "diary") return;
  const ds = t.dataset;
  if (ds.diarySel !== undefined) {
    UI.diaryId = ds.diarySel;
    diarySession(UI.diaryId);
    renderView();
  } else if (ds.diaryDelNote !== undefined) {
    if (!confirm(LANG.t("Eliminare la nota?"))) return;
    if (await diaryPost("/api/diary/notes/delete", { id: ds.diaryDelNote }, "Nota eliminata")) diaryReload();
  } else if (ds.diaryExport !== undefined) {
    const d = await diaryPost("/api/diary/export", { session: ds.diaryExport }, "Diario esportato");
    if (d) { UI.diaryExported = d.path; renderView(); }
  } else if (ds.diaryConvert !== undefined) {
    if (await diaryPost("/api/diary/convert", {}, "Conversione avviata")) diaryList(true);
  } else if (ds.diaryOpen !== undefined) {
    diaryPost("/api/diary/open", { name: ds.diaryOpen });
  } else if (ds.diaryOpenFolder !== undefined) {
    diaryPost("/api/diary/open", {});
  } else if (ds.diaryRefresh !== undefined) {
    diaryReload();
  }
});

document.addEventListener("submit", async e => {
  const id = e.target.dataset?.form;
  if (id !== "diary-note" && id !== "diary-shots") return;
  e.preventDefault();
  const q = { ...(UI.forms[id] || {}) };
  if (id === "diary-note") {
    const text = (q.text ?? $("diary-note-text")?.value ?? "").trim();
    if (!text) { toast("Scrivi prima il testo della nota"); return; }
    const sid = UI.res.diarySes?.data?.session.id;
    const body = (q.where || "session") === "now" ? { text } : { text, session: sid };
    if (await diaryPost("/api/diary/notes", body, "Nota aggiunta")) {
      UI.forms[id] = { where: q.where };
      UI.dirty.delete("diary-note-text");
      diaryReload();
    }
  } else {
    const s = UI.res.diaryList?.data?.settings || {};
    const body = { convert: q.convert ?? s.convert, delete_bmp: q.delete_bmp ?? s.delete_bmp, out_dir: q.out_dir ?? s.out_dir ?? "" };
    if (body.delete_bmp && !s.delete_bmp && !confirm(LANG.t("Dopo la conversione il BMP originale verrà eliminato. Continuare?"))) return;
    if (await diaryPost("/api/diary/settings", body, "Impostazioni salvate")) {
      UI.forms[id] = {};
      UI.dirty.delete("diary-out-dir");
      diaryReload();
    }
  }
});
