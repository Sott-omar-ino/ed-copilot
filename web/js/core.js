"use strict";
// Nucleo dell'interfaccia: utilità, comunicazione con il server, stato, impostazioni, navigazione e disegno delle schede.

// ============================================================================
// Utilità
// ============================================================================
const $ = id => document.getElementById(id);
const setText = (id, text) => { const el = $(id); if (el) el.textContent = text; };

// Tutte le chiamate alle API dell'app portano l'intestazione che il server richiede
// (un sito web esterno non può aggiungerla, quindi non può comandare l'app).
{
  const nativeFetch = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.startsWith("/api/")) {
      const headers = new Headers(init.headers || {});
      headers.set("X-ED-Copilot", "1");  // vecchio nome dell'app, voluto: vedi app/server.py
      init = { ...init, headers };
    }
    return nativeFetch(input, init);
  };
}
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
// Formato dei numeri e unità secondo la lingua dell'interfaccia (1.234 al / 1,234 ly).
const NUM_LOCALE = LANG.lang === "en" ? "en-GB" : "it-IT";
const num = n => n == null || isNaN(n) ? "—" : Math.round(n).toLocaleString(NUM_LOCALE);
// Decimali fissi con il separatore della lingua (42,0 in italiano, 42.0 in inglese): da usare al posto di toFixed nel testo mostrato.
const dec = (n, d = 1) => Number(n).toLocaleString(NUM_LOCALE, { minimumFractionDigits: d, maximumFractionDigits: d, useGrouping: false });
const cr = n => n == null ? "—" : num(n) + " CR";
const short = n => n == null ? "—" : Math.abs(n) >= 1e9 ? dec(n / 1e9, 2) + "B" : Math.abs(n) >= 1e6 ? dec(n / 1e6, Math.abs(n) >= 1e7 ? 1 : 2) + "M" : Math.abs(n) >= 1e3 ? Math.round(n / 1e3) + "k" : String(Math.round(n));
// fixed: numero di decimali sempre mostrati (es. gittate "42,0 al" allineate in colonna).
const ly = (n, fixed) => n == null ? "—" : (fixed != null ? dec(n, fixed) : n.toLocaleString(NUM_LOCALE, { maximumFractionDigits: n < 100 ? 1 : 0 })) + (LANG.lang === "en" ? " ly" : " al");
const dist3 = (a, b) => a && b ? Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) : null;
const sys = name => name ? `<span class="sysname">${esc(name)}<button class="copy" data-copy="${esc(name)}" title="Copia nome sistema">⧉</button></span>` : "—";
const todoBtn = (text, system = "", category = "Generale") =>
  `<button class="small ghost" data-todo="${esc(text)}" data-system="${esc(system)}" data-category="${esc(category)}" title="Aggiungi alla lista delle cose da fare">+ da fare</button>`;

function panel(title, body, o = {}) {
  return `<section class="panel ${o.cls || ""}"${o.id ? ` id="${esc(o.id)}"` : ""}><div class="hd"><h2>${title}</h2>${o.code ? `<span class="code">${esc(o.code)}</span>` : ""}${o.aside ? `<div class="aside">${o.aside}</div>` : ""}</div><div class="bd">${body}</div></section>`;
}
function seg(pct, n = 20, cls = "") {
  const on = Math.round(Math.max(0, Math.min(100, pct || 0)) / 100 * n);
  return `<div class="seg ${cls}">${Array.from({ length: n }, (_, i) => `<i class="${i < on ? "on" : ""}"></i>`).join("")}</div>`;
}
const meter = (pct, cls = "") => `<div class="meter ${cls}"><div class="grow" style="width:${Math.max(0, Math.min(100, pct || 0))}%"></div></div>`;
const pips = (n, max = 5) => `<span class="pips">${Array.from({ length: max }, (_, i) => `<i class="${i < n ? "on" : ""}"></i>`).join("")}</span>`;

function ago(v) {
  if (!v) return "—";
  const t = typeof v === "number" ? v * 1000 : new Date(String(v).replace(" ", "T").replace(/\+00$/, "Z")).getTime();
  const s = (Date.now() - t) / 1000;
  if (isNaN(s)) return "—";
  const en = LANG.lang === "en";
  if (s < 3600) return Math.max(1, Math.round(s / 60)) + (en ? " min ago" : " min fa");
  if (s < 86400) return Math.round(s / 3600) + (en ? " h ago" : " h fa");
  return Math.round(s / 86400) + (en ? " d ago" : " g fa");
}
function until(iso) {
  if (!iso) return "—";
  const s = (new Date(iso) - Date.now()) / 1000;
  if (s <= 0) return `<span class="bad">${LANG.lang === "en" ? "EXPIRED" : "SCADUTA"}</span>`;
  const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
  return `<span class="mono ${s < 10800 ? "bad" : ""}">${d ? `${d}${LANG.lang === "en" ? "d" : "g"} ${h}h` : h ? `${h}h ${m}m` : `${m}m`}</span>`;
}
function dur(sec) {
  if (sec == null) return "—";
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}
function toast(msg) {
  const box = $("toast");
  box.textContent = LANG.t(String(msg ?? ""));
  box.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => box.classList.remove("show"), 1700);
}
async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || res.statusText);
  if (body !== undefined) UI.dirty.clear();  // salvato: i campi possono tornare a mostrare i dati del server
  return data;
}

// ============================================================================
// Stato
// ============================================================================
let S = null, STATIC = null, TODOS = [], ROUTE = null, CATALOG = null, ADVICE = [], MACROS = [], CONTROLS = [], TELEMETRY_RULES = [];

async function saveControls(list) {
  try { CONTROLS = await api("/api/controls", list); toast("Controlli salvati"); }
  catch (e) { toast("Errore nel salvataggio: " + e.message); }
  renderView();
}
async function saveTelemetryRules(list) {
  try { TELEMETRY_RULES = await api("/api/telemetry_rules", list); toast("Avvisi salvati"); }
  catch (e) { toast("Errore nel salvataggio: " + e.message); }
  renderView();
}

function updateHudSliderFill(el) {
  if (!el) return;
  const min = parseFloat(el.min) || 0;
  const max = parseFloat(el.max) || 100;
  const val = parseFloat(el.value) || 0;
  const pct = Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100));
  el.style.background = `linear-gradient(to right, #ff8a1f 0%, #ffd36b ${pct}%, rgba(255, 138, 31, 0.12) ${pct}%, rgba(255, 138, 31, 0.12) 100%)`;
}

const SETTINGS_DEFAULT = { vhs: true, flicker: true, stars: true, warp: true, boot: true, ticker: true, lang: "mixed", tts: true, ttsVolume: 100 };
function loadSettings() {
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem("settings") || "{}"); } catch { saved = {}; }
  if (localStorage.getItem("fx-off")) saved.vhs ??= false;
  if (localStorage.getItem("orig-names")) saved.orig ??= true;
  if ("orig" in saved) { saved.lang ??= saved.orig ? "en" : "mixed"; delete saved.orig; }
  return { ...SETTINGS_DEFAULT, ...saved };
}
const SETTINGS = loadSettings();
function applySettings() {
  const b = document.body.classList;
  b.toggle("fx-off", !SETTINGS.vhs);
  b.toggle("no-flicker", !SETTINGS.flicker);
  b.toggle("no-ticker", !SETTINGS.ticker);
  UI.lang = SETTINGS.lang;
  UI.orig = SETTINGS.lang === "en";
}
function saveSettings() {
  localStorage.setItem("settings", JSON.stringify(SETTINGS));
}
function setSetting(key, value) {
  SETTINGS[key] = value;
  saveSettings();
  localStorage.removeItem("fx-off");
  localStorage.removeItem("orig-names");
  applySettings();
}

const UI = window.UI = {
  lang: SETTINGS.lang, orig: SETTINGS.lang === "en", adviceAll: false, dismissed: new Set(JSON.parse(localStorage.getItem("dismissed") || "[]")),
  forms: {}, res: {}, open: new Set(), matFilter: "", engKind: "all", engSort: "distance", todoFilter: "open",
  fleetMetric: "jump", lastJumps: null, ticks: 0, tool: "neutron", cfg: null, editingMacro: null,
  dirty: new Map(),  // testo scritto nei campi e non ancora salvato: sopravvive agli aggiornamenti automatici
};
const fv = (form, name, def = "") => UI.forms[form]?.[name] ?? def;

async function run(key, fn) {
  UI.res[key] = { busy: true };
  renderView();
  try { UI.res[key] = { data: await fn() }; }
  catch (e) { UI.res[key] = { error: e.message }; }
  renderView();
}
function result(key, render, empty) {
  const r = UI.res[key];
  if (!r) return `<div class="empty">${empty}</div>`;
  if (r.busy) return '<div class="loading">ELABORAZIONE IN CORSO</div>';
  if (r.error) return `<div class="bad">⚠ ${esc(r.error)}</div>`;
  return render(r.data);
}

const NAV = [
  ["Comandante", [["overview", "Panoramica"], ["cmdr", "Profilo"], ["ranks", "Rank e reputazione"], ["missions", "Missioni", () => S?.missions.length], ["stats", "Statistiche"], ["diary", "Diario di bordo"], ["travelmap", "Mappa dei viaggi"], ["squadron", "Squadriglia"],
    ["todo", "Da fare", () => TODOS.filter(t => !t.done).length + ADVICE.filter(a => !UI.dismissed.has(a.id) && a.prio <= 1).length]]],
  ["Nave", [["fleet", "Flotta"], ["shipyard", "Cantiere navale"], ["onfoot", "Tute e armi"], ["carrier", "Fleet carrier"]]],
  ["Attività", [["route", "Rotte", () => routeState()?.left || 0], ["trade", "Commercio"], ["mining", "Estrazione"], ["combat", "Combattimento"], ["thargoid", "Thargoid & AX"], ["onfoot_missions", "Missioni a terra"],
    ["coriolis_station", "Colonizzazione"], ["exploration", "Esplorazione"], ["exobio", "Esobiologia"], ["powerplay", "Powerplay"],
    ["colonia", "Bolla ↔ Colonia"], ["fuelrats", "Fuel Rats"]]],
  ["Database", [["materials", "Materiali"], ["wishlist", "Sblocchi e progetti"], ["engineers", "Ingegneri"], ["trader", "Material trader"], ["guardian", "Guardian"],
    ["search", "Ricerca stazioni"], ["places", "Luoghi utili"]]],
];
const VIEWS = {};
const currentTab = () => {
  const id = location.hash.slice(1);
  return VIEWS[id] ? id : "overview";
};

const navClosed = () => { try { return new Set(JSON.parse(localStorage.getItem("ed_nav_closed") || "[]")); } catch { return new Set(); } };
document.addEventListener("click", e => {
  const b = e.target.closest("[data-nav-group]");
  if (!b) return;
  const closed = navClosed(), g = b.dataset.navGroup;
  closed.has(g) ? closed.delete(g) : closed.add(g);
  localStorage.setItem("ed_nav_closed", JSON.stringify([...closed]));
  renderNav();
});

function renderNav() {
  const cur = currentTab();
  const gearOn = ["settings", "voice_commands", "commands", "info"].includes(cur);
  const keep = $("nav").querySelector(".nav-scroll")?.scrollTop || 0;  // il menu viene ridisegnato: resta dov'era
  // Gruppi richiudibili (clic sul titolo); quello della scheda aperta resta sempre aperto.
  const closed = navClosed();
  $("nav").innerHTML = `<div class="nav-scroll">${NAV.map(([group, items]) => {
    const shut = closed.has(group) && !items.some(([id]) => id === cur);
    return `<div class="nav-group ${shut ? "shut" : ""}"><h6><button type="button" class="nav-toggle" data-nav-group="${esc(group)}" aria-expanded="${!shut}">${group}</button></h6>${items.map(([id, label, count]) => {
    const c = count ? count() : 0;
    return `<a href="#${id}" class="${id === cur ? "active" : ""}">${label}${c ? `<span class="count">${c}</span>` : ""}</a>`;
  }).join("")}</div>`;
  }).join("")}</div>
    <div class="nav-foot"><a href="#settings" class="nav-gear ${gearOn ? "active" : ""}" title="Impostazioni" aria-label="Impostazioni">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.4 13a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.4 7.4 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7.4 7.4 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.4 7.4 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7.4 7.4 0 0 0 1.7-1l2.4 1 2-3.4-2-1.6z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.6"/></svg></a></div>`;
  $("nav").querySelector(".nav-scroll").scrollTop = keep;
}
// Animazioni che devono scorrere senza interruzioni (le altre sono effetti d'ingresso).
const CONTINUOUS = new Set(["spin", "scanline", "chroma-jitter", "pulse"]);

// I riquadri con lo scorrimento interno (es. elenco delle sessioni) restano dove li hai lasciati dopo il ridisegno.
function keepScroll(root) {
  const path = el => { const p = []; for (; el !== root; el = el.parentElement) p.unshift([...el.parentElement.children].indexOf(el)); return p; };
  const saved = [...root.querySelectorAll("*")].filter(el => el.scrollTop > 0 || el.scrollLeft > 0)
    .map(el => [path(el), el.scrollTop, el.scrollLeft]);
  return () => {
    for (const [p, top, left] of saved) {
      let el = root;
      for (const i of p) { el = el?.children[i]; if (!el) break; }
      if (el) { el.scrollTop = top; el.scrollLeft = left; }
    }
  };
}

function renderView(enter = false) {
  renderNav();
  if (!S || !STATIC) return;
  const view = $("view");
  const oldImgs = new Map([...view.querySelectorAll("img[data-keep]")].map(i => [i.getAttribute("src"), i]));
  // Altri elementi con data-keep e un id (es. un <canvas>) vengono rimessi al loro posto così come sono.
  const oldKeep = new Map([...view.querySelectorAll("[data-keep][id]:not(img)")].map(el => [el.id, el]));
  const scrolled = keepScroll(view);
  view.innerHTML = VIEWS[currentTab()]();
  scrolled();
  for (const [id, value] of UI.dirty) {
    const el = $(id);
    if (el && el.value !== value) el.value = value;
  }
  view.querySelectorAll(".hud-slider").forEach(updateHudSliderFill);
  if (currentTab() === "voice_commands" && (enter || !$("mic-device-select")?.options.length)) populateMicDeviceSelect();
  // Le immagini già caricate vengono riusate: niente sfarfallio a ogni aggiornamento.
  for (const img of view.querySelectorAll("img[data-keep]")) {
    const old = oldImgs.get(img.getAttribute("src"));
    if (old && old.complete) img.replaceWith(old);
  }
  for (const el of view.querySelectorAll("[data-keep][id]:not(img)")) {
    const old = oldKeep.get(el.id);
    if (old && old !== el) el.replaceWith(old);
  }
  for (const a of view.getAnimations({ subtree: true })) if (CONTINUOUS.has(a.animationName)) a.startTime = 0;
  if (enter) {
    view.classList.remove("enter");
    void view.offsetWidth;
    view.classList.add("enter");
    clearTimeout(renderView.t);
    renderView.t = setTimeout(() => view.classList.remove("enter"), 900);
  }
}

// ============================================================================
// Header, orologio, ticker
// ============================================================================
function renderHeader() {
  const c = S.cmdr, sh = S.ship, loc = S.location;
  // Versione compatta: i dettagli completi sono nella panoramica (il titolo del campo li mostra al passaggio del mouse).
  setText("h-cmdr", c.name || "—");
  setText("h-ship", sh.type || "—");
  setText("h-sys", loc.system || "—");
  setText("h-credits", c.credits != null ? short(c.credits) + " CR" : "—");
  const titles = { "h-ship": [sh.type, sh.name].filter(Boolean).join(" · "), "h-sys": [loc.system, loc.docked && loc.station].filter(Boolean).join(" · "),
    "h-credits": cr(c.credits) };
  for (const [id, t] of Object.entries(titles)) { const el = $(id); if (el) el.title = t; }
  const f = S.fuel, cells = 14, fuel = $("h-fuel");
  const on = f.level != null && f.cap ? Math.round(f.level / f.cap * cells) : 0;
  if (fuel) {
    fuel.className = "fuel" + (f.cap && f.level / f.cap < .25 ? " low" : "");
    fuel.innerHTML = Array.from({ length: cells }, (_, i) => `<i class="${i < on ? "on" : ""}"></i>`).join("");
  }
  setText("h-fuel-t", f.level != null && f.cap ? dec(f.level) + "/" + f.cap + " t" : "—");
  setText("h-session", `${S.session.jumps} salti · ${S.session.ly.toFixed(0)} al`);
  setText("h-live", S.live ? "IN LINEA" : "SINCRONIZZO…");
  const dot = $("h-dot");
  if (dot) dot.className = "live-dot" + (S.live ? " on" : "");
}


const opt = (v, l, cur) => `<option value="${esc(v)}" ${String(v) === String(cur) ? "selected" : ""}>${esc(l)}</option>`;
const chk = (form, name, def, label) => `<label class="check"><input type="checkbox" name="${name}" ${fv(form, name, def) ? "checked" : ""}> ${label}</label>`;
const inp = (form, name, label, def = "", attrs = "") => `<label>${label}<input name="${name}" value="${esc(fv(form, name, def))}" ${attrs}></label>`;

function settingRow(key, title, desc) {
  const on = SETTINGS[key];
  return `<div class="todo-item" style="align-items:center"><div class="text">${esc(title)}<div class="sub">${esc(desc)}</div></div>
    <span class="sub" style="min-width:52px;text-align:right">${on ? "ACCESO" : "SPENTO"}</span>
    <button class="switch ${on ? "on" : ""}" data-setting="${key}" role="switch" aria-checked="${on}" aria-label="${esc(title)}"><span></span><span></span></button></div>`;
}

// Memorizza ciò che scrivi nei campi con un id, così l'aggiornamento automatico ogni 2 secondi non lo cancella.
document.addEventListener("input", e => {
  const el = e.target;
  if (el.id && el.closest?.("#view") && el.matches("input:not([type=checkbox]):not([type=range]), textarea")) UI.dirty.set(el.id, el.value);
});
window.addEventListener("hashchange", () => { UI.dirty.clear(); $("view").scrollTop = 0; });
