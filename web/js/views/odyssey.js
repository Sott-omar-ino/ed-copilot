"use strict";

// ============================================================================
// TUTE E ARMI (Odyssey): upgrade di grado, modifiche e lista della spesa dei materiali a piedi
// ============================================================================
// Dati in /js/data/odyssey-data.js (window.ODYSSEY_DATA), caricato al primo accesso alla scheda.
// Le chiavi sono i nomi interni del journal: SuitName senza "_classN", ModuleName delle armi,
// SuitMods/WeaponMods e i Name dello ShipLocker.

const OD = { loading: false, error: null, key: null, html: "" };  // memo: si ricalcola solo se cambiano piano, inventario o dati
const OD_CAT = { Items: "Item", Components: "Componente", Data: "Dati", Consumables: "Consumabile" };
const OD_PROGRESS = { Unlocked: "Sbloccato", Invited: "Invitato", Acquainted: "Conosciuto", Known: "Noto", Barred: "Bandito" };

function odData() {
  if (window.ODYSSEY_DATA) return window.ODYSSEY_DATA;
  if (!OD.loading && !OD.error && typeof document !== "undefined") {
    OD.loading = true;
    const s = document.createElement("script");
    s.src = "/js/data/odyssey-data.js";
    s.onload = () => { OD.loading = false; renderView(); };
    s.onerror = () => { OD.loading = false; OD.error = "Impossibile caricare i dati Odyssey (/js/data/odyssey-data.js)"; renderView(); };
    document.head.appendChild(s);
  }
  return null;
}

// --- piano salvato -----------------------------------------------------------
// Ogni obiettivo: { id, kind: "suit"|"weapon", item: nome interno, owned: SuitID/SuitModuleID o null, to: grado, mods: [...] }
function odPlan() {
  if (!OD.plan) {
    try { OD.plan = JSON.parse(localStorage.getItem("onfootPlan") || "[]"); } catch { OD.plan = []; }
    if (!Array.isArray(OD.plan)) OD.plan = [];
  }
  return OD.plan;
}
function odSavePlan(plan) {
  OD.plan = plan;
  localStorage.setItem("onfootPlan", JSON.stringify(plan));
  renderView();
}

const odOwned = () => S?.onfoot || { suits: [], weapons: [], loadout: {}, costs: {} };
function odOwnedItem(t) {
  if (t.owned == null) return null;
  const list = t.kind === "suit" ? odOwned().suits : odOwned().weapons;
  return list.find(x => String(x.id) === String(t.owned)) || null;
}
function odInfo(D, kind, item) { return kind === "suit" ? D.suits[item] : D.weapons[item]; }
function odName(D, kind, item) { return odInfo(D, kind, item)?.name || item; }

// Modifiche disponibili per un oggetto: { fdname: { name, effect, cr, ing, engineers } }
function odMods(D, kind, item) {
  if (kind === "suit") return item === "flightsuit" ? {} : D.suit_mods;
  const fam = D.weapons[item]?.family, out = {};
  for (const [fd, m] of Object.entries(D.weapon_mods)) {
    const v = m.variants[fam] || m.variants.all;
    if (v) out[fd] = { name: m.name, effect: m.effect, ...v };
  }
  return out;
}

// Stato di partenza di un obiettivo: grado e modifiche già presenti (oggetto posseduto) o nuovo acquisto.
function odStart(t) {
  const o = odOwnedItem(t);
  return o ? { grade: o.class || 1, mods: o.mods || [], buy: false } : { grade: 1, mods: [], buy: true };
}

// --- calcolo -----------------------------------------------------------------
function odCompute(D, plan) {
  const need = {}, uses = {}, steps = [], costs = odOwned().costs || {};
  let credits = 0;
  const add = (ing, label) => {
    for (const [m, q] of Object.entries(ing)) {
      need[m] = (need[m] || 0) + q;
      (uses[m] ||= []).push(label);
    }
  };
  for (const t of plan) {
    const info = odInfo(D, t.kind, t.item);
    if (!info) continue;
    const st = odStart(t), name = info.name;
    if (st.buy && info.price) { credits += info.price; steps.push({ t, label: `Acquisto ${name} G1`, cr: info.price, buy: true }); }
    for (let g = st.grade + 1; g <= Math.min(t.to, 5); g++) {
      const u = info.upgrades[g];
      if (!u) continue;
      const key = t.item + ":" + g;  // come in state.onfoot_costs
      const cr = costs[key] ?? u.cr;
      credits += cr;
      add(u.ing, `${name} G${g}`);
      steps.push({ t, label: `${name} G${g - 1}→G${g}`, cr, estimated: costs[key] == null });
    }
    const mods = odMods(D, t.kind, t.item);
    for (const fd of t.mods || []) {
      const m = mods[fd];
      if (!m || st.mods.includes(fd)) continue;
      credits += m.cr;
      add(m.ing, `${name}: ${m.name}`);
      steps.push({ t, label: `${name}: ${m.name}`, cr: m.cr, mod: fd, engineers: m.engineers });
    }
  }
  const inv = {};
  for (const k of Object.keys(OD_CAT)) for (const i of S?.locker?.[k] || []) {
    const id = i.id || String(i.name || "").toLowerCase().replace(/\s+/g, "");
    inv[id] = (inv[id] || 0) + (i.count || 0);
  }
  const order = { Items: 0, Components: 1, Data: 2, Consumables: 3 };
  const rows = Object.entries(need).map(([id, n]) => {
    const m = D.materials[id] || { name: id, cat: "", where: "" };
    const owned = inv[id] || 0;
    return { id, name: m.name, cat: m.cat, type: m.type, where: m.where, needed: n, owned, missing: Math.max(0, n - owned), uses: uses[id] };
  }).sort((a, b) => (order[a.cat] ?? 9) - (order[b.cat] ?? 9) || b.missing - a.missing || a.name.localeCompare(b.name));
  return { rows, steps, credits, needed: rows.reduce((s, r) => s + r.needed, 0), missing: rows.reduce((s, r) => s + r.missing, 0) };
}

// --- pannelli ----------------------------------------------------------------
function odOwnedPanel(D) {
  const o = odOwned(), lo = o.loadout || {};
  const inUse = new Set([lo.suit, ...(lo.weapons || [])].filter(x => x != null).map(String));
  const modName = (kind, item, fd) => odMods(D, kind, item)[fd]?.name || fd;
  const row = (kind, x) => {
    const info = odInfo(D, kind, x.name);
    const mods = (x.mods || []).map(fd => `<span class="tag" style="font-size:10px">${esc(modName(kind, x.name, fd))}</span>`).join("") || '<span class="muted">—</span>';
    const can = info && Object.keys(info.upgrades || {}).length;
    return `<tr><td>${kind === "suit" ? "Tuta" : "Arma"}${inUse.has(String(x.id)) ? ' <span class="tag ok" style="font-size:10px">in uso</span>' : ""}</td>
      <td><b>${esc(info?.name || x.name)}</b>${info?.type ? `<div class="sub">${esc(LANG.t(info.type))} · ${esc(info.maker)}</div>` : info?.role ? `<div class="sub">${esc(info.role)}</div>` : ""}</td>
      <td>${pips(x.class || 1)} <span class="mono">G${x.class || 1}</span></td><td>${mods}</td>
      <td>${can && (x.class || 1) < 5 ? `<button class="small ghost" data-od-plan="${kind}:${esc(x.id)}">Pianifica</button>` : ""}</td></tr>`;
  };
  const rows = [...o.suits.filter(s => s.name !== "flightsuit").map(s => row("suit", s)), ...o.weapons.map(w => row("weapon", w))].join("");
  const body = rows
    ? `<table><thead><tr><th>Tipo</th><th>Nome</th><th>Grado</th><th>Modifiche</th><th></th></tr></thead><tbody>${rows}</tbody></table>
       <div class="sub" style="margin-top:6px">Ricavato dagli eventi del journal (BuySuit, BuyWeapon, Upgrade*, SuitLoadout). Le tute e armi mai usate in un loadout o comprate prima dei journal presenti non compaiono.</div>`
    : '<div class="empty">Nessuna tuta o arma trovata nei journal. Equipaggia un loadout a piedi o aggiungi un obiettivo nuovo qui sotto.</div>';
  return panel("Tute e armi possedute", body, { code: "LOCKER", aside: `${o.suits.length + o.weapons.length} oggetti` });
}

function odPickerOptions(D) {
  const o = odOwned(), out = [];
  for (const s of o.suits) if (s.name !== "flightsuit" && D.suits[s.name]) out.push([`suit:${s.id}`, `${D.suits[s.name].name} G${s.class} (posseduta)`]);
  for (const w of o.weapons) if (D.weapons[w.name]) out.push([`weapon:${w.id}`, `${D.weapons[w.name].name} G${w.class} (posseduta)`]);
  for (const [k, s] of Object.entries(D.suits)) if (Object.keys(s.upgrades).length) out.push([`newsuit:${k}`, `Nuova: ${s.name}`]);
  for (const [k, w] of Object.entries(D.weapons)) out.push([`newweapon:${k}`, `Nuova: ${w.name}`]);
  return out;
}

function odPlannerPanel(D, plan) {
  const opts = odPickerOptions(D);
  UI.odPick = opts.some(([v]) => v === UI.odPick) ? UI.odPick : opts[0]?.[0];
  const add = `<div class="form" style="margin-bottom:10px">
      <label class="grow-1">Oggetto<select id="od-pick">${opts.map(([v, l]) => opt(v, l, UI.odPick)).join("")}</select></label>
      <label>Grado obiettivo<select id="od-to">${[2, 3, 4, 5].map(g => opt(g, "G" + g, UI.odTo || 5)).join("")}</select></label>
      <button class="small" data-od-add>+ Aggiungi obiettivo</button></div>`;
  const cards = plan.map(t => {
    const info = odInfo(D, t.kind, t.item);
    if (!info) return "";
    const st = odStart(t), slots = Math.max(0, t.to - 1), mods = odMods(D, t.kind, t.item);
    const chosen = new Set([...st.mods, ...(t.mods || [])]);
    const full = chosen.size >= slots;
    const boxes = Object.entries(mods).map(([fd, m]) => {
      const have = st.mods.includes(fd), on = chosen.has(fd);
      return `<label class="check" style="padding-bottom:2px;font-size:13px" title="${esc(LANG.t(m.effect))} · ${num(m.cr)} CR">
        <input type="checkbox" data-od-mod="${esc(t.id)}" value="${esc(fd)}" ${on ? "checked" : ""} ${have || (!on && full) ? "disabled" : ""}>
        ${esc(m.name)}${have ? ' <span class="muted">(già presente)</span>' : ""}</label>`;
    }).join("");
    const o = odOwnedItem(t);
    return `<div style="padding:8px 0;border-bottom:1px solid rgba(255,138,31,0.1)">
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
        <b>${esc(info.name)}</b> <span class="sub">${o ? `posseduta, ora G${st.grade}` : "nuovo acquisto"}</span>
        <span class="sub">→</span>
        <select data-od-to="${esc(t.id)}">${[2, 3, 4, 5].filter(g => g >= st.grade).map(g => opt(g, "G" + g, t.to)).join("")}</select>
        <span class="sub">${chosen.size}/${slots} slot modifiche</span>
        <span style="flex:1"></span><button class="small ghost" data-od-del="${esc(t.id)}" title="Rimuovi obiettivo">✕</button>
      </div>
      ${Object.keys(mods).length ? `<div style="display:flex;flex-wrap:wrap;gap:2px 14px;margin-top:6px">${boxes}</div>` : ""}
    </div>`;
  }).join("");
  const body = add + (cards || '<div class="empty">Nessun obiettivo. Scegli una tuta o un\'arma, il grado da raggiungere, poi spunta le modifiche.</div>');
  return panel("Pianificatore", body, { code: "UPGRADE", aside: plan.length ? `${plan.length} obiettivi` : "" });
}

function odShoppingPanel(D, res) {
  if (!res.steps.length) return panel("Lista della spesa", '<div class="empty">Aggiungi un obiettivo con un grado più alto o una modifica per vedere i materiali.</div>', { code: "MATERIALI" });
  const rows = res.rows.map(r => `<tr>
      <td><span title="${esc(r.uses.join("\n"))}">${esc(r.name)}</span>${r.missing && r.where ? `<div class="sub" style="font-size:11px">${esc(r.where)}</div>` : ""}</td>
      <td class="sub">${esc(OD_CAT[r.cat] || r.cat)}${r.type ? ` <span class="muted">${esc(r.type)}</span>` : ""}</td>
      <td class="num">${r.needed}</td><td class="num ${r.owned >= r.needed ? "ok" : ""}">${r.owned}</td>
      <td class="num ${r.missing ? "bad" : "ok"}">${r.missing || "✓"}</td>
      <td>${r.missing ? todoBtn(`Procurare ${r.missing}× ${r.name} (${OD_CAT[r.cat] || r.cat}) per tute e armi`, "", "Materiali") : ""}</td></tr>`).join("");
  const missing = res.rows.filter(r => r.missing);
  const allText = missing.length ? `Lista della spesa tute e armi: ${missing.map(r => `${r.missing}× ${r.name}`).join(", ")}` : "";
  const steps = res.steps.map(s => `<div class="sub" style="display:flex;justify-content:space-between;gap:8px">
      <span>${esc(s.label)}</span><span class="mono">${num(s.cr)} CR${s.estimated ? ' <span class="muted" title="Stima: prezzo base × 4/15/30/50. Il costo reale viene preso dal journal dopo il primo upgrade uguale.">~</span>' : ""}</span></div>`).join("");
  const credits = S?.cmdr?.credits;
  const summary = `<div class="kv-grid" style="margin:8px 0">
      <div class="kv"><span>Materiali richiesti</span><span>${num(res.needed)}</span></div>
      <div class="kv"><span>Mancanti</span><span class="${res.missing ? "bad" : "ok"}">${res.missing ? num(res.missing) : "nessuno ✓"}</span></div>
      <div class="kv"><span>Crediti</span><span class="${credits != null && credits < res.credits ? "bad" : ""}">${cr(res.credits)}</span><span class="sub">upgrade da Pioneer Supplies, modifiche dagli ingegneri</span></div>
    </div>`;
  const body = `<div class="eyebrow" style="margin-bottom:4px">Passi</div>${steps}${summary}
    <table><thead><tr><th>Materiale</th><th>Tipo</th><th class="num">Serve</th><th class="num">Hai</th><th class="num">Manca</th><th></th></tr></thead><tbody>${rows}</tbody></table>
    ${missing.length ? `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:10px"><span class="sub">Aggiungi tutti i materiali mancanti come una sola voce da fare</span>${todoBtn(allText, "", "Materiali")}</div>` : ""}
    <div class="sub" style="margin-top:8px">Inventario dallo ShipLocker (deposito della nave): lo zaino non è contato. Item e dati si trovano anche al Bartender delle stazioni (baratto); gli Item si vendono solo lì.</div>`;
  return panel("Lista della spesa", body, { code: "MATERIALI", aside: missing.length ? `${missing.length} da procurare` : "tutto pronto" });
}

function odEngineersPanel(D, res) {
  const mods = res.steps.filter(s => s.mod);
  if (!mods.length) return "";
  const pos = S?.location?.star_pos;
  const byEng = {};
  for (const s of mods) for (const e of s.engineers || []) (byEng[e] ||= []).push(s);
  const list = Object.entries(byEng).map(([name, steps]) => {
    const info = D.engineers[name] || {}, prog = S?.engineers?.[name]?.progress;
    return { name, steps, info, prog, d: pos && info.pos ? dist3(pos, info.pos) : null };
  }).sort((a, b) => (b.prog === "Unlocked") - (a.prog === "Unlocked") || b.steps.length - a.steps.length || (a.d ?? 1e9) - (b.d ?? 1e9));
  const rows = list.map(e => {
    // Requisiti: inara.cz/elite/engineers + pagine ingegneri di elite-dangerous.fandom.com (vedi odyssey-data.js meta).
    const req = [...(e.prog === "Unlocked" ? [] : [e.info.discover && `Come trovarlo: ${e.info.discover}`, e.info.meet && `Per sbloccarlo: ${e.info.meet}`]), e.info.unlock && `Referral: ${e.info.unlock}`].filter(Boolean).map(LANG.t).join(" · ");
    const status = e.prog === "Unlocked" ? '<span class="ok">✓ Sbloccato</span>' : e.prog ? `<span class="gold">${esc(LANG.lang === "en" ? e.prog : OD_PROGRESS[e.prog] || e.prog)}</span>` : '<span class="muted">Sconosciuto</span>';
    return `<tr><td><b>${esc(e.name)}</b>${e.info.colonia ? ' <span class="tag" style="font-size:10px">Colonia</span>' : ""}<div class="sub">${esc(e.info.base || "")}${e.info.body ? " · " + esc(e.info.body) : ""}</div></td>
      <td>${sys(e.info.system)}${e.d != null ? `<div class="sub">${ly(e.d)}</div>` : ""}</td><td>${status}${req ? `<div class="sub" style="font-size:11px">${esc(req)}</div>` : ""}</td>
      <td class="sub">${e.steps.map(s => esc(s.label)).join("<br>")}</td>
      <td>${todoBtn(`Da ${e.name} (${e.info.base || ""}): ${e.steps.map(s => s.label).join(", ")}`, e.info.system || "", "Ingegneri")}</td></tr>`;
  }).join("");
  return panel("Ingegneri per le modifiche", `<table><thead><tr><th>Ingegnere</th><th>Sistema</th><th>Stato</th><th>Modifiche</th><th></th></tr></thead><tbody>${rows}</tbody></table>
    <div class="sub" style="margin-top:6px">Ogni ingegnere a piedi applica solo le sue modifiche. Lo stato viene da EngineerProgress del journal.</div>`, { code: "INGEGNERI" });
}

VIEWS.onfoot = () => {
  const D = odData();
  if (!D) return panel("Tute e armi", OD.error ? `<div class="bad">⚠ ${esc(OD.error)}</div>` : '<div class="loading">CARICAMENTO DATI ODYSSEY</div>', { code: "ODYSSEY" });
  const plan = odPlan();
  const key = JSON.stringify([plan, S?.onfoot, S?.locker, Object.entries(S?.engineers || {}).map(([n, e]) => n + e.progress),
    S?.location?.system, S?.cmdr?.credits, UI.odPick, UI.odTo]);
  if (OD.key === key) return OD.html;
  const res = odCompute(D, plan);
  OD.html = `<div class="grid"><div class="col">${odPlannerPanel(D, plan)}${odShoppingPanel(D, res)}</div>
    <div class="col">${odOwnedPanel(D)}${odEngineersPanel(D, res)}</div></div>`;
  OD.key = key;
  return OD.html;
};

// --- interazioni ----------------------------------------------------------------
function odAddTarget(pick, to) {
  const [kind, ref] = String(pick || "").split(":");
  if (!kind || ref == null) return;
  const D = window.ODYSSEY_DATA;
  let t;
  if (kind === "suit" || kind === "weapon") {
    const o = (kind === "suit" ? odOwned().suits : odOwned().weapons).find(x => String(x.id) === ref);
    if (!o) return;
    t = { kind, item: o.name, owned: o.id, to: Math.max(to, (o.class || 1) + 1), mods: [] };
  } else {
    t = { kind: kind === "newsuit" ? "suit" : "weapon", item: ref, owned: null, to, mods: [] };
  }
  if (!odInfo(D, t.kind, t.item)) return;
  t.to = Math.min(5, t.to);
  t.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  odSavePlan([...odPlan(), t]);
  toast("Obiettivo aggiunto: " + odName(D, t.kind, t.item) + " G" + t.to);
}

document.addEventListener("click", e => {
  const b = e.target.closest?.("[data-od-add],[data-od-del],[data-od-plan]");
  if (!b) return;
  if (b.hasAttribute("data-od-add")) odAddTarget(UI.odPick, Number(UI.odTo || 5));
  else if (b.dataset.odDel) odSavePlan(odPlan().filter(t => t.id !== b.dataset.odDel));
  else if (b.dataset.odPlan) odAddTarget(b.dataset.odPlan, 5);
});

document.addEventListener("change", e => {
  const el = e.target;
  if (el.id === "od-pick") { UI.odPick = el.value; renderView(); }
  else if (el.id === "od-to") { UI.odTo = Number(el.value); renderView(); }
  else if (el.dataset?.odTo) {
    const to = Number(el.value);
    odSavePlan(odPlan().map(t => {
      if (t.id !== el.dataset.odTo) return t;
      const slots = to - 1 - odStart(t).mods.length;
      return { ...t, to, mods: (t.mods || []).slice(0, Math.max(0, slots)) };  // meno slot: si tengono le prime modifiche
    }));
  } else if (el.dataset?.odMod) {
    odSavePlan(odPlan().map(t => {
      if (t.id !== el.dataset.odMod) return t;
      const mods = new Set(t.mods || []);
      el.checked ? mods.add(el.value) : mods.delete(el.value);
      return { ...t, mods: [...mods] };
    }));
  }
});
