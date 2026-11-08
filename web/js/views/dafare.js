"use strict";

// ============================================================================
// TO-DO
// ============================================================================
const TODO_CATS = ["Generale", "Ingegneri", "Materiali", "Esplorazione", "Esobiologia", "Commercio", "Estrazione", "Missioni", "Viaggi", "Nave", "Colonizzazione", "Obiettivi comunità"];
VIEWS.todo = () => {
  const items = TODOS.filter(t => UI.todoFilter === "all" || !t.done);
  const groups = {};
  for (const t of items) (groups[t.category] ||= []).push(t);
  const doneCount = TODOS.filter(t => t.done).length, open = TODOS.length - doneCount;
  const f = "todo";
  return `<div class="grid"><div class="col">${panel("Registro attività", Object.keys(groups).length ? Object.entries(groups)
      .sort(([a], [b]) => TODO_CATS.indexOf(a) - TODO_CATS.indexOf(b)).map(([cat, list]) => `<div class="todo-cat"><span>${esc(cat)}</span> · ${list.length}</div>` + list.map(t => {
        const d = t.system && STATIC.coords[t.system] ? dist3(S.location.star_pos, STATIC.coords[t.system]) : null;
        return `<div class="todo-item ${t.done ? "done" : ""}"><input type="checkbox" data-toggle="${esc(t.id)}" ${t.done ? "checked" : ""} aria-label="Completata">
          <div class="text">${esc(t.text)}${t.system ? `<div class="sub">${sys(t.system)}${d != null ? " · " + ly(d) : ""}${t.system === S.location.system ? ' <span class="tag bio">sei qui</span>' : ""}</div>` : ""}</div>
          <div class="actions"><button class="small ghost" data-del="${esc(t.id)}" title="Elimina">✕</button></div></div>`;
      }).join("")).join("") : '<div class="empty">Niente da fare. Aggiungi un\'attività, accetta un consiglio del copilota o usa i pulsanti "+ da fare" nelle altre schede</div>',
    { code: "TASK-LOG", aside: `<select id="todo-filter">${[["open", "Da fare"], ["all", "Tutte"]].map(([v, l]) => opt(v, l, UI.todoFilter)).join("")}</select>
      ${doneCount ? ` <button class="small ghost" id="todo-clear">Elimina completate (${doneCount})</button>` : ""}` })}</div>
    <div class="col">${panel("Consigli del copilota", adviceHtml(), { cls: "holo", code: "COPILOT", aside: UI.dismissed.size ? `<button class="small ghost" id="advice-reset">Ripristina ignorati (${UI.dismissed.size})</button>` : "" })}
    ${panel("Nuova attività", `<form class="form" data-form="${f}" id="f-todo">
      <label class="grow-1">Cosa fare<input name="text" required value="${esc(fv(f, "text"))}" placeholder="es. 30 Arsenic per l'FSD G5"></label>
      <label>Categoria<select name="category">${TODO_CATS.map(c => opt(c, c, fv(f, "category", "Generale"))).join("")}</select></label>
      ${inp(f, "system", "Sistema", "", `placeholder="${esc(S.location.system || "opzionale")}"`)}
      <button class="primary" type="submit">Aggiungi</button></form>`, { code: "NEW" })}
      ${panel("Stato", `<div class="kv-grid"><div class="kv"><span>Da fare</span><span class="big">${open}</span></div>
        <div class="kv"><span>Completate</span><span class="big" style="color:var(--ok)">${doneCount}</span></div></div>
        ${seg(TODOS.length ? doneCount / TODOS.length * 100 : 0, 30, "full")}`, { cls: "holo", code: "STATUS" })}</div></div>`;
};

const PRIO = [["URGENTE", "bad"], ["CONSIGLIATO", "gold"], ["UTILE", "holo-t"], ["UTILE", "holo-t"], ["SPUNTO", "muted"]];
function adviceHtml() {
  const all = ADVICE.filter(a => !UI.dismissed.has(a.id) && !TODOS.some(t => t.text === a.text));
  if (!all.length) return '<div class="empty">Nessun consiglio in questo momento: ottimo lavoro, comandante</div>';
  const list = UI.adviceAll ? all : all.slice(0, 5);
  const more = all.length > 5 ? `<button class="small ghost" id="advice-more" style="margin-top:6px">${UI.adviceAll ? "Mostra solo i più importanti" : `Mostra tutti (${all.length})`}</button>` : "";
  return list.map(a => { const [lbl, cls] = PRIO[Math.min(a.prio, 4)];
    return `<div class="todo-item"><div class="text"><span class="tag ${cls}">${lbl}</span> ${esc(a.text)}
      <div class="sub">${esc(a.why)}${a.system ? ` · ${sys(a.system)}` : ""}</div></div>
      <div style="display:flex;gap:4px;flex-direction:column"><button class="small" data-advice-add="${esc(a.id)}">+ Aggiungi</button>
      <button class="small ghost" data-advice-skip="${esc(a.id)}">Ignora</button></div></div>`; }).join("") + more;
}
function dismiss(id) {
  UI.dismissed.add(id);
  localStorage.setItem("dismissed", JSON.stringify([...UI.dismissed]));
}


async function saveTodos() {
  try { TODOS = await api("/api/todos", TODOS); } catch (e) { toast("Errore nel salvataggio: " + e.message); }
  renderView();
}
function addTodo(text, category, system) {
  if (!text) return;
  TODOS.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), text, category: category || "Generale",
    system: system || "", done: false, created: new Date().toISOString() });
  saveTodos();
  toast("Aggiunto alle cose da fare");
}
