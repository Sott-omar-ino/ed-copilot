"use strict";

// ============================================================================
// INGEGNERI
// ============================================================================
// Stati di EngineerProgress (Frontier Journal Manual; "Known" verificato sui journal dell'utente).
const ENG_STATUS = { Unlocked: ["Sbloccato", "ok"], Acquainted: ["Acquisito", "gold"], Invited: ["Invitato", "gold"], Known: ["Conosciuto", "holo-t"], Barred: ["Escluso", "bad"] };
const ENG_STAGES = [[null, "Sconosciuto"], ["Known", "Conosciuto"], ["Invited", "Invitato"], ["Acquainted", "Acquisito"], ["Unlocked", "Sbloccato"]];


// Requisiti degli ingegneri di bordo: [come trovarlo, per l'invito, per lo sblocco].
// Fonte: inara.cz/elite/engineers (nov 2026), confrontata con elite-dangerous.fandom.com (es. pagina Chloe Sedesi).
// "Referral da X" = arrivare al grado 3 con X e fare progressi verso il 4. Per gli ingegneri a piedi i requisiti
// sono in web/js/data/odyssey-data.js (engineers).
const ENG_REQ = {
  "Felicity Farseer": ["Noto a tutti", "Rango esplorazione Scout o superiore", "1 Meta-Alloys"],
  "Elvira Martuuk": ["Noto a tutti", "Allontanati almeno 300 al dal sistema di partenza della carriera", "3 Soontill Relics"],
  "The Dweller": ["Noto a tutti", "Commercia con almeno 5 black market", "500.000 CR"],
  "Liz Ryder": ["Noto a tutti", "Cordial o Friendly con Eurybia Blue Mafia", "200 Landmines"],
  "Tod 'The Blaster' McQuinn": ["Noto a tutti", "Più di 15 bounty voucher riscossi", "Bounty voucher per 100.000 CR"],
  "Juri Ishmaak": ["Referral da Felicity Farseer", "Più di 50 combat bond federali riscossi", "Combat bond federali per 100.000 o 1.000.000 CR (varia)"],
  "Colonel Bris Dekker": ["Referral da Juri Ishmaak", "Friendly con la Federazione", "Combat bond federali per 1.000.000 o 10.000.000 CR (varia)"],
  "The Sarge": ["Referral da Juri Ishmaak", "Grado Midshipman o superiore nella Federal Navy", "50 Aberrant Shield Pattern Analysis"],
  "Mel Brandon": ["Referral da Elvira Martuuk", "Invito da Colonia Council", "Bounty voucher per 100.000 CR"],
  "Zacariah Nemo": ["Referral da Elvira Martuuk", "Invito da Party of Yoru", "25 Xihe Companions"],
  "Marco Qwent": ["Referral da Elvira Martuuk", "Invito da Sirius Corporation", "25 Modular Terminals"],
  "Chloe Sedesi": ["Referral da Marco Qwent", "Allontanati almeno 5.000 al dal sistema di partenza della carriera", "25 Sensor Fragment"],
  "Lori Jameson": ["Referral da Marco Qwent", "Rango combattimento Dangerous o superiore", "25 Kongga Ale"],
  "Professor Palin": ["Referral da Marco Qwent", "Allontanati almeno 5.000 al dal sistema di partenza della carriera", "25 Sensor Fragment"],
  "Marsha Hicks": ["Referral da The Dweller", "Rango esplorazione Surveyor o superiore", "10 Osmium estratto"],
  "Lei Cheung": ["Referral da The Dweller", "Commercia in più di 50 mercati", "200 Gold"],
  "Ram Tah": ["Referral da Lei Cheung", "Rango esplorazione Surveyor o superiore", "50 Classified Scan Databanks"],
  "Petra Olmanova": ["Referral da Tod 'The Blaster' McQuinn", "Rango combattimento Expert o superiore", "200 Progenitor Cells"],
  "Selene Jean": ["Referral da Tod 'The Blaster' McQuinn", "Estrai almeno 500 t di minerale", "10 Painite estratta"],
  "Bill Turner": ["Referral da Selene Jean", "Friendly con l'Alleanza e Allied con Alioth Independents (permesso per Alioth)", "50 Bromellite"],
  "Didi Vatermann": ["Referral da Selene Jean", "Rango commercio Merchant o superiore", "50 Lavian Brandy"],
  "Etienne Dorn": ["Referral da Liz Ryder", "Rango commercio Dealer o superiore", "25 Occupied Escape Pod"],
  "Hera Tani": ["Referral da Liz Ryder", "Grado Outsider o superiore con l'Impero", "50 Kamitra Cigars"],
  "Broo Tarquin": ["Referral da Hera Tani", "Rango combattimento Competent o superiore", "50 Fujin Tea"],
  "Tiana Fortune": ["Referral da Hera Tani", "Friendly con l'Impero", "50 Decoded Emission Data"],
};
function engReq(e) {
  const r = ENG_REQ[e.name];
  if (r) return `Come trovarlo: ${r[0]} · Invito: ${r[1]} · Sblocco: ${r[2]}`;
  const o = window.ODYSSEY_DATA?.engineers?.[e.name];
  return o ? [o.discover && `Come trovarlo: ${o.discover}`, o.meet && `Per sbloccarlo: ${o.meet}`].filter(Boolean).join(" · ") : "";
}

// --- Tracker degli sblocchi ---------------------------------------------------
// Dati da /api/engineers (app/engineers.py): stato/grado da EngineerProgress di TUTTI i journal, consegne da
// EngineerContribution, modifiche da EngineerCraft, e per il prossimo passo i controlli calcolabili dal journal
// (Statistics, Rank, Reputation, reputazione con le minor faction). Le fonti dei requisiti sono in testa al modulo.
// Se un numero non è nei dati verificati si mostra solo il testo del requisito, senza barra.
const ENG_STEP = { discover: "Per conoscerlo", invite: "Per l'invito", unlock: "Per lo sblocco", meet: "Per sbloccarlo",
  referral: "Referral", rank: "Prossimo grado", done: "Completato", barred: "Escluso" };

function engLoad(quiet = false) {
  const cur = UI.res.engtrack;
  if (cur?.busy || cur?.loading) return;
  if (!quiet || !cur) UI.res.engtrack = { busy: true };
  else cur.loading = true;
  api("/api/engineers")
    .then(d => { UI.res.engtrack = { data: d, at: Date.now(), live: JSON.stringify(S.engineers || {}) }; })
    .catch(e => { UI.res.engtrack = cur?.data ? { ...cur, loading: false, at: Date.now() } : { error: e.message, at: Date.now() }; })
    .finally(() => { if (currentTab() === "engineers") renderView(); });
}

function engStepText(e, step) {
  const r = ENG_REQ[e.name], o = window.ODYSSEY_DATA?.engineers?.[e.name];
  if (step === "discover") return r ? r[0] : o?.discover;
  if (step === "invite") return r?.[1];
  if (step === "unlock") return r?.[2];
  if (step === "meet") return o?.meet;
  if (step === "referral") return o?.unlock;
  // Il grado sale applicando modifiche: nei journal dell'utente ogni EngineerProgress con un Rank nuovo segue degli EngineerCraft.
  if (step === "rank") return "Si sale di grado applicando modifiche presso l'ingegnere";
  return "";
}

function engCheckVal(c) {
  let val = "";
  if (c.unit === "%") val = `${num(c.have)}%`;
  else if (c.have != null && c.give) val = c.unit === "CR" ? `${num(c.have)}${c.need ? " / " + num(c.need) : ""} CR`
    : `consegnati ${num(c.have)}${c.need ? "/" + num(c.need) : ""}`;
  else if (c.have != null && c.need) val = `${num(c.have)} / ${num(c.need)}${c.unit ? " " + esc(c.unit) : ""}`;
  return val;
}

function engCheck(c) {
  const val = engCheckVal(c);
  return `<div class="eng-check">
    <div class="eng-check-row"><span class="${c.done ? "ok" : ""}">${c.done ? "✓ " : ""}${esc(c.label)}</span><span class="mono">${val}</span></div>
    ${c.frac != null ? meter(c.frac * 100, c.done ? "full" : "holo") : ""}
    ${c.text ? `<div class="sub">${esc(c.text)}</div>` : ""}</div>`;
}

function engNext(e) {
  const nx = e.bk?.next;
  if (!nx || nx.step === "done") return "";
  // "Referral da X" è già nei controlli: il testo serve solo se non ci sono controlli.
  const txt = nx.step === "discover" && nx.checks.length ? "" : engStepText(e, nx.step);
  return `<div class="eng-next"><span class="eyebrow">${esc(ENG_STEP[nx.step] || nx.step)}</span>${nx.ready ? ' <span class="tag solid">pronto</span>' : ""}
    ${txt ? `<div class="eng-next-txt">${esc(txt)}</div>` : ""}${nx.checks.map(engCheck).join("")}</div>`;
}

function engCrafts(c) {
  if (!c) return "";
  const grades = Object.entries(c.grades).sort().map(([g, n]) => `G${g} ×${n}`).join(" · ");
  const bps = Object.entries(c.blueprints).map(([b, g]) => `${b} G${g}`).join(", ");
  return `<div class="sub" title="${esc(bps)}">Modifiche fatte: ${num(c.count)} · ${esc(grades)}</div>`;
}

// Testo del "da fare" e sistema dove andare per il prossimo passo.
function engTodo(e) {
  const nx = e.bk?.next || {}, ref = nx.checks?.find(c => c.ref && !c.done)?.ref;
  const at = name => STATIC.engineers.find(x => x.name === name)?.system || "";
  switch (nx.step) {
    case "discover": return [`Ottenere il referral per ${e.name}${ref ? " da " + ref : ""}`, ref ? at(ref) : e.system];
    case "invite": return [`Invito di ${e.name}`, e.system];
    case "unlock": case "meet": return [`Sbloccare ${e.name}`, e.system];
    case "rank": return [`Salire al grado ${(e.st.rank || 0) + 1} con ${e.name}`, e.system];
    case "referral": return [`Referral per ${nx.target} da ${e.name}`, e.system];
    default: return null;
  }
}

function engStage(e) {
  const p = e.st.progress;
  const [lbl, cls] = ENG_STATUS[p] || ["Sconosciuto", "muted"];
  const idx = ENG_STAGES.findIndex(s => s[0] === (p || null));
  const steps = p === "Barred" ? "" : `<div class="eng-stages">${ENG_STAGES.map((s, i) => `<i class="${i <= idx ? "on" : ""}" title="${s[1]}"></i>`).join("")}</div>`;
  const top = e.bk?.max_grade || 5;
  const rank = p === "Unlocked" && e.st.rank != null
    ? `<div class="sub">Grado ${e.st.rank}/${top}${pips(e.st.rank, top)}${e.st.rank < top && e.st.rank_progress != null ? ` <span class="mono">${e.st.rank_progress}%</span>` : ""}</div>` : "";
  return `<span class="${cls}" style="font-weight:700">${lbl}</span>${steps}${rank}`;
}

VIEWS.engineers = () => {
  if (typeof odData === "function") odData();  // carica i requisiti degli ingegneri a piedi
  const res = UI.res.engtrack;
  if (!res) engLoad();
  else if (!res.busy && !res.loading && (Date.now() - (res.at || 0) > 20000 || (res.live != null && res.live !== JSON.stringify(S.engineers || {})))) engLoad(true);
  const bkAll = res?.data?.engineers || {};
  const pos = S.location.star_pos;
  const all = STATIC.engineers.map(e => {
    const bk = bkAll[e.name], live = S.engineers[e.name] || {};
    const st = bk ? { progress: bk.progress, rank: bk.rank, rank_progress: bk.rank_progress }
      : { progress: live.progress, rank: live.rank, rank_progress: live.rankprogress };
    return { ...e, bk, st, d: dist3(pos, STATIC.coords[e.system]) };
  });
  const list = all.filter(e => UI.engKind === "all" || e.kind === UI.engKind);
  const order = { Unlocked: 0, Acquainted: 1, Invited: 2, Known: 3, Barred: 5 };
  list.sort(UI.engSort === "status" ? (a, b) => (order[a.st.progress] ?? 4) - (order[b.st.progress] ?? 4) || (a.d ?? 1e9) - (b.d ?? 1e9) : (a, b) => (a.d ?? 1e9) - (b.d ?? 1e9));
  const unlocked = all.filter(e => e.st.progress === "Unlocked").length;
  const controls = `<div class="form" style="margin-bottom:10px">
      <label>Tipo<select id="eng-kind">${[["all", "Tutti"], ["ship", "Nave"], ["suit", "A piedi"]].map(([v, l]) => opt(v, l, UI.engKind)).join("")}</select></label>
      <label>Ordina<select id="eng-sort">${[["distance", "Distanza"], ["status", "Stato"]].map(([v, l]) => opt(v, l, UI.engSort)).join("")}</select></label>
      <div style="flex:1;min-width:200px;padding-bottom:6px"><div class="eyebrow">Sbloccati ${unlocked}/${STATIC.engineers.length}</div>${seg(unlocked / STATIC.engineers.length * 100, 38, "holo")}</div></div>
      <div class="sub" style="margin-bottom:8px"><span>Fasi: ${ENG_STAGES.map(s => s[1]).join(" → ")}. Il grado (1-5) sale con le modifiche; la % verso il grado successivo è quella del journal.</span>${res?.busy ? " · <span>lettura dei journal…</span>" : ""}${res?.error ? ` · <span class="bad">${esc(res.error)}</span>` : ""}</div>`;

  // Prossimi passi consigliati: prima i pronti, poi i più avanti (media dei controlli misurabili), poi i più vicini.
  const recs = all.filter(e => e.bk && !["done", "barred"].includes(e.bk.next.step) && (e.bk.next.ready || e.bk.next.frac > 0))
    .sort((a, b) => (b.bk.next.ready - a.bk.next.ready) || (b.bk.next.frac - a.bk.next.frac) || (a.d ?? 1e9) - (b.d ?? 1e9)).slice(0, 8);
  const recPanel = res?.data ? panel("Prossimi passi consigliati", recs.length ? `<table><tbody>${recs.map(e => {
    const nx = e.bk.next, td = engTodo(e);
    // Ogni pezzo nel suo <span>: così la traduzione inglese (web/js/lang.js) li riconosce uno per uno.
    const open = nx.checks.filter(c => !c.done).map(c => [c.label, engCheckVal(c), c.text].filter(Boolean).map(x => `<span>${esc(x)}</span>`).join(" — ")).join(" · ");
    return `<tr><td><b>${esc(e.name)}</b><div class="sub">${esc(ENG_STEP[nx.step] || "")} · ${e.kind === "ship" ? "nave" : "a piedi"} · ${sys(e.system)} · ${ly(e.d)}</div></td>
      <td style="min-width:220px">${nx.ready ? '<span class="tag solid">pronto</span>' : `<span class="mono">${Math.round(nx.frac * 100)}%</span>`}${meter(nx.frac * 100, nx.ready ? "full" : "holo")}
        <div class="sub">${open || esc(engStepText(e, nx.step) || "")}</div></td>
      <td style="white-space:nowrap">${td ? todoBtn(td[0], td[1], "Ingegneri") : ""}</td></tr>`;
  }).join("")}</tbody></table>
    <div class="sub" style="margin-top:6px">Ordine: passi già pronti, poi quelli con più progressi misurati dal journal, poi i più vicini.</div>`
    : '<div class="empty">Nessun passo con progressi misurabili dal journal</div>', { code: "NEXT", aside: `<button class="small ghost" data-eng-refresh title="Rileggi i journal">↻</button>` }) : "";

  const table = panel("Ingegneri", controls + `<table><thead><tr><th>Ingegnere</th><th>Sistema</th><th class="num">Distanza</th><th>Stato</th><th>Specialità e prossimo passo</th><th></th></tr></thead><tbody>
    ${list.map(e => {
      const td = engTodo(e);
      const req = !e.bk && e.st.progress !== "Unlocked" && engReq(e) ? `<div style="font-size:11px;margin-top:3px">${esc(engReq(e))}</div>` : "";
      const contrib = (e.bk?.contributions || []).map(c => `<span class="tag">${esc(c.item)} ${num(c.total)}${["Credits", "Bond", "Bounty"].includes(c.type) ? " CR" : ""}</span>`).join("");
      return `<tr><td><b>${esc(e.name)}</b><div class="sub">${esc(e.base)} · ${e.kind === "ship" ? "nave" : "a piedi"}</div>${engCrafts(e.bk?.crafts)}
          ${e.bk?.ref?.length ? `<div class="sub">Referral: ${e.bk.ref.map(esc).join(", ")}</div>` : ""}${contrib ? `<div class="sub">Consegnati: ${contrib}</div>` : ""}</td>
        <td>${sys(e.system)}</td><td class="num">${ly(e.d)}</td>
        <td>${engStage(e)}</td><td class="sub">${esc(e.specialty)}${req}${engNext(e)}</td>
        <td style="white-space:nowrap">${td ? todoBtn(td[0], td[1], "Ingegneri") : !e.bk && e.st.progress !== "Unlocked" ? todoBtn(`Sbloccare ${e.name}`, e.system, "Ingegneri") : ""}</td></tr>`;
    }).join("")}</tbody></table>`, { code: "WORKSHOP" });
  return `<div class="col">${recPanel}${table}</div>`;
};

document.addEventListener("click", e => {
  if (e.target.closest("[data-eng-refresh]")) engLoad();
});
