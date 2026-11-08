"use strict";

// ============================================================================
// SQUADRIGLIA: tu e i tuoi amici (ognuno con il suo copilota) vi vedete a vicenda
// ============================================================================
// Da pari a pari, senza server esterni (vedi app/squadron.py): un copilota ospita, gli altri entrano con
// indirizzo + codice. Lo stato arriva da /api/squadron/status, ricaricato ogni 2,5 s in UI.res.sq.
// Tutto ciò che arriva dagli altri comandanti passa da esc() prima di finire nella pagina.

const SQ_PRIVACY = [
  ["location", "Posizione", "Sistema e stazione in cui sei attraccato"],
  ["ship", "Nave", "Modello e nome della nave"],
  ["fuel", "Carburante", "Percentuale di carburante nel serbatoio principale"],
  ["activity", "Attività", "Stima di cosa stai facendo, dagli eventi recenti del journal"],
  ["route", "Rotta", "Prossimo salto e destinazione della rotta tracciata"],
  ["sites", "Cantieri", "Avanzamento dei cantieri di colonizzazione che hai visitato"],
];

function sqLoad(force = false) {
  const cur = UI.res.sq;
  if (cur?.loading) return;
  if (!force && cur && Date.now() - (cur.at || 0) < 2500) return;
  UI.res.sq = { ...(cur || {}), loading: true };
  api("/api/squadron/status")
    .then(d => { UI.res.sq = { data: d, at: Date.now() }; })
    .catch(e => { UI.res.sq = { ...(cur || {}), error: e.message, at: Date.now() }; })
    .finally(() => { if (currentTab() === "squadron") renderView(); });
}

async function sqPost(path, body, okMsg) {
  try {
    const d = await api(path, body || {});
    UI.res.sq = { data: d, at: Date.now() };
    if (okMsg) toast(okMsg);
  } catch (e) { toast(e.message); }
  if (currentTab() === "squadron") renderView();
}

const sqAgo = s => s == null ? "—" : s < 10 ? "adesso" : s < 60 ? `${Math.round(s)} s fa` : s < 3600 ? `${Math.round(s / 60)} min fa` : `${Math.round(s / 3600)} h fa`;
const sqHidden = (st, key) => (st.hidden || []).includes(key);
const sqVal = (st, key, v) => sqHidden(st, key) ? '<span class="muted">nascosto</span>' : v ?? "—";

function sqCard(m, d) {
  const st = m.status || {};
  const fuel = st.fuel_pct;
  const act = st.activity ? (SQ_ACT_LABEL[st.activity] || st.activity) : null;
  const canKick = d.role === "host" && !m.host;
  const route = st.next_jump
    ? `${sys(st.next_jump)}${st.destination && st.destination !== st.next_jump ? ` <span class="sub">→ ${esc(st.destination)}</span>` : ""}`
    : null;
  return `<section class="panel sq-card ${m.online ? "" : "offline"}">
    <div class="hd"><h2>${esc(st.name)}</h2><div class="aside">
      ${m.host ? '<span class="tag solid">HOST</span>' : ""}${m.you ? '<span class="tag">TU</span>' : ""}
      <span class="tag ${m.online ? "ok" : "bad"}">${m.online ? "ONLINE" : "OFFLINE"}</span></div></div>
    <div class="bd">
      <div class="kv-grid">
        <div class="kv"><span>Nave</span><span>${sqVal(st, "ship", st.ship ? esc(st.ship) + (st.ship_name ? ` <span class="sub">${esc(st.ship_name)}</span>` : "") : null)}</span></div>
        <div class="kv"><span>Sistema</span><span>${sqVal(st, "location", st.system ? sys(st.system) : null)}</span></div>
        <div class="kv"><span>Attraccato a</span><span>${sqVal(st, "location", st.docked ? esc(st.station || "—") : "In volo")}</span></div>
        <div class="kv"><span>Carburante</span><span>${sqVal(st, "fuel", fuel != null ? `${num(fuel)}%` : null)}</span></div>
        <div class="kv"><span>Attività (stima)</span><span>${sqVal(st, "activity", act ? esc(act) : '<span class="muted">nessuna rilevata</span>')}</span></div>
        <div class="kv"><span>Prossimo salto</span><span>${sqVal(st, "route", route || '<span class="muted">nessuna rotta</span>')}</span></div>
      </div>
      ${!sqHidden(st, "fuel") && fuel != null ? `<div style="margin-top:10px">${meter(fuel, fuel < 25 ? "bad" : "")}</div>` : ""}
      ${st.jumps_left && !sqHidden(st, "route") ? `<div class="sub" style="margin-top:6px">${st.jumps_left} salti alla destinazione</div>` : ""}
      <div class="sq-foot"><span class="sub">Ultimo contatto: ${m.you || (m.host && d.role === "host") ? "adesso" : sqAgo(m.age)}</span>
        ${canKick ? `<button class="small danger" data-sq-kick="${esc(m.id)}" data-sq-name="${esc(st.name)}">Espelli</button>` : ""}</div>
    </div></section>`;
}
const SQ_ACT_LABEL = { mining: "Mining", combat: "Combattimento", exploring: "Esplorazione", exobiology: "Esobiologia",
  trading: "Commercio", colonisation: "Colonizzazione", travelling: "In viaggio" };

function sqConnectPanel(d) {
  const notice = d.notice ? `<div class="warnbox" style="margin-bottom:14px">${esc(d.notice)}</div>` : "";
  if (d.role === "host") {
    const h = d.host || {};
    const online = (d.squad?.members || []).filter(m => m.online).length;
    const body = !h.running
      ? `<div class="warnbox">Il server di rete del copilota è spento (forse hai disattivato l'accesso dal telefono):
          gli altri non possono raggiungerti.</div><div style="margin-top:10px"><button class="primary" data-sq-host="1">Riaccendi</button>
          <button data-sq-host="0">Chiudi squadriglia</button></div>`
      : `<div class="sq-info">
          <div class="kv"><span>Indirizzo in rete locale</span><span class="mono">${esc(h.address)}</span></div>
          <div class="kv"><span>Comandanti</span><span>${(d.squad?.members || []).length}/${d.max} · ${online} online</span></div></div>
        <div class="eyebrow" style="margin-top:14px">Codice di accesso</div>
        <div class="sq-code mono">${esc(h.code)}</div>
        <div class="sub">Il codice contiene anche l'impronta del certificato: chi entra verifica di parlare proprio con te.
          Dallo solo agli amici, in privato. Se cambia l'indirizzo di rete di questo PC, cambia anche il codice.</div>
        <div class="briefing-actions" style="margin-top:10px;display:flex;flex-wrap:wrap;gap:8px">
          <button class="small" data-copy="${esc(h.address + " " + h.code)}">Copia indirizzo e codice</button>
          <button class="small" data-sq-regen="0">Nuovo codice</button>
          <button class="small" data-sq-regen="1">Nuovo codice ed espelli tutti</button>
          <button class="small danger" data-sq-host="0">Chiudi squadriglia</button></div>
        ${h.blocked?.length ? `<div class="sub" style="margin-top:10px">Espulsi (non possono rientrare con questo codice):
          ${h.blocked.map(n => `<span class="tag">${esc(n)} <button class="small ghost" data-sq-unblock="${esc(n)}" title="Riammetti">✕</button></span>`).join(" ")}</div>` : ""}`;
    return panel("Stai ospitando la squadriglia", notice + body, { code: "HOST" });
  }
  if (d.role === "member") {
    const m = d.member || {};
    const state = m.connected
      ? `<span class="ok">Collegato</span> · ultimo aggiornamento ${sqAgo(m.last_ok_age)}`
      : `<span class="bad">Host non raggiungibile</span>${m.last_ok_age != null ? ` da ${sqAgo(m.last_ok_age).replace(" fa", "")}` : ""}`;
    return panel("Sei in una squadriglia", `${notice}<div class="sq-info">
        <div class="kv"><span>Host</span><span class="mono">${esc(m.address)}</span></div>
        <div class="kv"><span>Stato</span><span>${state}</span></div></div>
      ${m.error && !m.connected ? `<div class="bad" style="margin-top:8px">⚠ ${esc(m.error)}</div>` : ""}
      <div style="margin-top:12px"><button class="danger" data-sq-leave>Esci dalla squadriglia</button></div>`, { code: "MEMBRO" });
  }
  const tls = d.tls_available;
  return panel("Squadriglia", `${notice}<p>Tu e i tuoi amici, ognuno con il suo copilota, vedete a vicenda nave, posizione,
      carburante e attività, con una lista di obiettivi comuni. Uno di voi ospita, gli altri entrano con indirizzo e codice.
      Massimo ${d.max} comandanti.</p>
    <div class="grid even">
      <div class="subpanel"><h3>Ospita</h3>
        <p class="sub">Questo copilota apre la squadriglia sul suo server di rete cifrato e ti mostra il codice da dare agli amici.</p>
        ${tls ? '<button class="primary" data-sq-host="1">Ospita una squadriglia</button>'
              : '<div class="warnbox">Connessione cifrata non disponibile in questa installazione: non puoi ospitare.</div>'}</div>
      <div class="subpanel"><h3>Entra</h3>
        <form class="form" data-form="sq-join" id="f-sq-join">
          <label class="grow-1">Indirizzo dell'host<input id="sq-addr" name="address" placeholder="192.168.1.20:8766" autocomplete="off" value="${esc(fv("sq-join", "address"))}"></label>
          <label class="grow-1">Codice di accesso<input id="sq-code" name="code" placeholder="XXXXXX-XXXXXX-…" autocomplete="off" value="${esc(fv("sq-join", "code"))}"></label>
          <button class="primary" type="submit" ${UI.res.sqJoin?.busy ? "disabled" : ""}>${UI.res.sqJoin?.busy ? "Collegamento…" : "Entra"}</button>
        </form>
        <div class="sub" style="margin-top:6px">Puoi incollare "indirizzo codice" tutto nel primo campo.</div>
        ${UI.res.sqJoin?.error ? `<div class="bad" style="margin-top:8px">⚠ ${esc(UI.res.sqJoin.error)}</div>` : ""}</div>
    </div>`, { code: "P2P" });
}

function sqTodos(d) {
  const todos = d.squad?.todos || [];
  const list = todos.length ? todos.map(t => `<div class="todo-item">
      <button class="small ${t.done ? "ok" : ""}" data-sq-todo="${t.done ? "undo" : "done"}" data-id="${esc(t.id)}" title="${t.done ? "Segna da fare" : "Segna come fatto"}">${t.done ? "✓" : "○"}</button>
      <div class="text" style="flex:1;${t.done ? "text-decoration:line-through;opacity:.6" : ""}">${esc(t.text)}
        <div class="sub">${LANG.lang === "en" ? LANG.t("obiettivo aggiunto da") : "da"} <span>${esc(t.by || "?")}</span>${t.done && t.done_by ? ` · fatto da <span>${esc(t.done_by)}</span>` : ""}</div></div>
      <button class="small ghost" data-sq-todo="delete" data-id="${esc(t.id)}" title="Elimina">✕</button></div>`).join("")
    : '<div class="empty">Nessun obiettivo condiviso. Aggiungine uno: lo vedono tutti.</div>';
  return panel("Obiettivi condivisi", `<form class="form" data-form="sq-todo" id="f-sq-todo" style="margin-bottom:12px">
      <label class="grow-1">Nuovo obiettivo<input id="sq-todo-text" name="text" maxlength="140" autocomplete="off" placeholder="Es. portare 500 t di Steel al cantiere"></label>
      <button class="primary" type="submit">Aggiungi</button></form>${list}
    ${todos.some(t => t.done) ? '<div style="margin-top:8px"><button class="small ghost" data-sq-todo="clear_done">Togli i completati</button></div>' : ""}`,
    { code: `${todos.filter(t => !t.done).length} APERTI` });
}

function sqSites(d) {
  // Ogni comandante condivide i cantieri che ha visto: per ogni cantiere vale il dato più recente.
  const by = new Map();
  for (const m of d.squad?.members || []) for (const s of m.status?.sites || []) {
    const key = s.market_id ?? `${s.system}|${s.station}`;
    const cur = by.get(key);
    if (!cur || (s.updated || "") > (cur.updated || "")) by.set(key, { ...s, from: m.status.name });
  }
  if (!by.size) return "";
  return panel("Cantieri di colonizzazione condivisi", [...by.values()].map(s => `<div class="subpanel">
      <h3>${esc(s.station || "Cantiere")} <span class="sub">${s.system ? esc(s.system) : ""}</span><span class="aside mono">${s.progress != null ? dec(s.progress * 100) + "%" : "—"}</span></h3>
      ${meter((s.progress || 0) * 100, "holo")}
      <div class="sub" style="margin-top:4px">Mancano ${num(s.remaining)} t · dato di ${esc(s.from)}${s.updated ? `, ${ago(s.updated)}` : ""}</div></div>`).join(""));
}

function sqPrivacy(d) {
  return panel("Cosa condividi", `<p class="sub">Il nome del comandante si condivide sempre. Ciò che spegni qui non lascia
      mai questo PC.</p>${SQ_PRIVACY.map(([k, title, desc]) => {
    const on = d.privacy?.[k];
    title = LANG.lang === "en" ? LANG.t("Condivisione: " + title) : title;  // "Attività" da sola è ambigua nel dizionario
    return `<div class="todo-item" style="align-items:center"><div class="text">${esc(title)}<div class="sub">${esc(desc)}</div></div>
      <span class="sub" style="min-width:52px;text-align:right">${on ? "VISIBILE" : "NASCOSTO"}</span>
      <button class="switch ${on ? "on" : ""}" data-sq-privacy="${k}" role="switch" aria-checked="${on}" aria-label="${esc(title)}"><span></span><span></span></button></div>`;
  }).join("")}`);
}

function sqHelp(d) {
  return panel("Come vi collegate", `<ul class="fr-tips">
      <li><b>Stessa rete</b> (stessa casa, stesso router): funziona subito. Chi entra usa l'indirizzo mostrato all'host.</li>
      <li><b>Via internet</b>: non c'è un server centrale, quindi il PC dell'host deve essere raggiungibile dagli altri.
        Due strade: inoltrare la porta ${esc(d.host?.port || "del server di rete")} (TCP) sul router dell'host verso questo PC
        e dare agli amici l'indirizzo pubblico, oppure usare una rete virtuale privata tra voi (come quelle che molti
        gruppi usano già per giocare): in quel caso si usa l'indirizzo dell'host in quella rete. Se nessuna delle due è
        possibile, la squadriglia via internet non funziona.</li>
      <li>Il firewall di Windows dell'host deve consentire le connessioni in entrata al copilota.</li>
      <li><b>Sicurezza</b>: connessione cifrata, certificato verificato con l'impronta contenuta nel codice, limiti su
        richieste e dimensioni. Si scambiano solo i dati di stato qui sopra: nessun file, nessun comando.</li>
      <li>L'attività è una <b>stima</b>: il tipo di eventi più frequente nel journal negli ultimi 10 minuti
        (estrazione, combattimento, scansioni, compravendite, consegne ai cantieri, salti).</li>
      <li>Un comandante risulta offline dopo ${d.offline_after} s senza notizie; gli stati si aggiornano ogni ${d.poll} s.</li></ul>`);
}

VIEWS.squadron = () => {
  sqLoad();
  const r = UI.res.sq;
  if (!r?.data) {
    if (r?.error) return panel("Squadriglia", `<div class="bad">⚠ ${esc(r.error)}</div>`);
    return panel("Squadriglia", '<div class="loading">CARICAMENTO</div>');
  }
  const d = r.data;
  let members = d.squad?.members || [];
  if (d.role === "none") members = [{ id: "me", you: true, online: true, age: 0, status: d.me }];
  const cards = `<div class="cards" style="margin-top:18px">${members.map(m => sqCard(m, d)).join("")}</div>`;
  const inSquad = d.role !== "none";
  return `${sqConnectPanel(d)}
    ${!inSquad ? '<div class="eyebrow" style="margin-top:18px">Anteprima di ciò che vedrebbero gli altri</div>' : ""}${cards}
    <div class="grid" style="margin-top:18px"><div class="col">${inSquad ? sqTodos(d) + sqSites(d) : sqSites(d)}${sqHelp(d)}</div>
      <div class="col">${sqPrivacy(d)}</div></div>`;
};

document.addEventListener("click", e => {
  const t = e.target.closest("[data-sq-host],[data-sq-regen],[data-sq-kick],[data-sq-unblock],[data-sq-leave],[data-sq-todo],[data-sq-privacy]");
  if (!t) return;
  const d = t.dataset;
  if (d.sqHost != null) {
    if (d.sqHost === "0" && !confirm(LANG.t("Chiudere la squadriglia? Tutti i membri verranno scollegati."))) return;
    sqPost("/api/squadron/host", { enable: d.sqHost === "1" }, d.sqHost === "1" ? "Squadriglia aperta" : "Squadriglia chiusa");
  } else if (d.sqRegen != null) {
    if (d.sqRegen === "1" && !confirm(LANG.t("Creare un codice nuovo ed espellere tutti? Dovranno rientrare con il nuovo codice."))) return;
    sqPost("/api/squadron/regen", { drop_members: d.sqRegen === "1" }, "Nuovo codice creato: il vecchio non vale più");
  } else if (d.sqKick) {
    if (!confirm(LANG.t(`Espellere ${d.sqName}? Non potrà rientrare con il codice attuale.`))) return;
    sqPost("/api/squadron/kick", { id: d.sqKick }, "Comandante espulso");
  } else if (d.sqUnblock) {
    sqPost("/api/squadron/unblock", { name: d.sqUnblock });
  } else if (d.sqLeave != null) {
    if (!confirm(LANG.t("Uscire dalla squadriglia?"))) return;
    sqPost("/api/squadron/leave", {}, "Sei uscito dalla squadriglia");
  } else if (d.sqTodo) {
    sqPost("/api/squadron/todo", { op: d.sqTodo, id: d.id });
  } else if (d.sqPrivacy) {
    const cur = UI.res.sq?.data?.privacy?.[d.sqPrivacy];
    sqPost("/api/squadron/privacy", { [d.sqPrivacy]: !cur });
  }
});

document.addEventListener("submit", e => {
  const form = e.target.dataset?.form;
  if (form !== "sq-join" && form !== "sq-todo") return;
  e.preventDefault();
  const f = new FormData(e.target);
  if (form === "sq-todo") {
    const text = String(f.get("text") || "").trim();
    if (!text) return;
    UI.dirty.delete("sq-todo-text");
    e.target.reset();
    sqPost("/api/squadron/todo", { op: "add", text });
    return;
  }
  UI.res.sqJoin = { busy: true };
  renderView();
  api("/api/squadron/join", { address: f.get("address"), code: f.get("code") })
    .then(d => { UI.res.sq = { data: d, at: Date.now() }; UI.res.sqJoin = null; UI.forms["sq-join"] = {}; toast("Sei nella squadriglia"); })
    .catch(err => { UI.res.sqJoin = { error: err.message }; })
    .finally(() => renderView());
});
