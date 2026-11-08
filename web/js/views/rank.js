"use strict";

// ============================================================================
// RANK E REPUTAZIONE
// ============================================================================
// Dati da /api/ranks (app/ranks.py): rank e progress in diretta, sblocchi, reputazione, storico delle promozioni.
// Le fonti di ogni regola sono elencate in testa ad app/ranks.py. I dati restano in UI.res.ranks e si ricaricano
// ogni 20 s mentre la scheda è aperta (l'interfaccia si ridisegna ogni 2 s, le richieste no).
const RK_POWER = { Federation: "Federation", Empire: "Empire", Alliance: "Alliance", Independent: "Independent" };
const RK_LEVEL_CLS = { Hostile: "bad", Unfriendly: "bad", Neutral: "muted", Cordial: "", Friendly: "ok", Allied: "ok" };

function rkLoad(quiet = false) {
  const cur = UI.res.ranks;
  if (cur?.busy || cur?.loading) return;
  if (!quiet || !cur) UI.res.ranks = { busy: true };
  else cur.loading = true;
  api("/api/ranks")
    .then(d => { UI.res.ranks = { data: d, at: Date.now() }; })
    .catch(e => { UI.res.ranks = cur?.data ? { ...cur, loading: false, at: Date.now() } : { error: e.message, at: Date.now() }; })
    .finally(() => { if (currentTab() === "ranks") renderView(); });
}
document.addEventListener("click", e => {
  if (e.target.closest("[data-rk-refresh]")) rkLoad();
  const t = e.target.closest("[data-rk-toggle]");
  if (t) {
    const k = "rk:" + t.dataset.rkToggle;
    UI.open.has(k) ? UI.open.delete(k) : UI.open.add(k);
    renderView();
  }
});

const rkUnlockList = items => items.map(i => {
  const [kind, ...rest] = i.split(": ");
  return rest.length ? `<span class="tag">${esc(kind)}</span> ${esc(rest.join(": "))}` : esc(i);
}).join("<br>");

function rkCard(r) {
  if (r.rank == null) return `<div style="margin-bottom:14px"><span class="eyebrow">${esc(r.label)}</span>
    <div class="empty">Nessun dato nei journal</div></div>`;
  const p = r.progress || 0, pct = r.max ? 100 : Math.min(100, p);
  const ready = r.navy && !r.max && p >= 100;
  const nu = r.next_unlock;
  const open = UI.open.has("rk:" + r.key);
  return `<div style="margin-bottom:16px">
    <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">
      <span class="eyebrow">${esc(r.label)}</span>
      <span><b style="font-size:17px;letter-spacing:.06em;text-transform:uppercase">${esc(r.name)}</b>
      <span class="mono muted"> ${r.max ? "MAX" : p + "%"}</span></span></div>
    ${seg(pct, 25, r.max ? "full" : "")}
    ${r.max ? "" : `<div class="sub" style="margin-top:2px">→ ${esc(r.next || "")}${ready ? ' · <span class="gold">pronto per la promotion mission</span>' : ""}</div>`}
    ${nu ? `<div style="margin-top:6px;font-size:13px"><span class="sub">${nu.rank === r.rank + 1 ? "Al prossimo rank" : "Al rank " + esc(nu.name)}:</span><br>${rkUnlockList(nu.items)}</div>` : ""}
    <div class="sub" style="margin-top:4px">${esc(r.howto || "")}</div>
    ${r.unlocks.length ? `<button class="small ghost" data-rk-toggle="${esc(r.key)}" style="margin-top:4px">${open ? "Nascondi" : "Tutti gli sblocchi"}</button>
      ${open ? `<table style="margin-top:6px"><tbody>${r.unlocks.map(u => `<tr><td class="${u.rank <= r.rank ? "ok" : "muted"}">${u.rank <= r.rank ? "✓" : "·"} ${esc(u.name)}</td><td>${rkUnlockList(u.items)}</td></tr>`).join("")}</tbody></table>` : ""}` : ""}
  </div>`;
}

function rkRepBar(v, level) {
  return `<div style="display:flex;justify-content:space-between"><span class="mono ${RK_LEVEL_CLS[level] ?? ""}">${esc(level || "—")}</span>
    <span class="mono ${v < 0 ? "bad" : v > 35 ? "ok" : ""}">${v > 0 ? "+" : ""}${dec(v)}</span></div>${meter((v + 100) / 2, "center" + (v < 0 ? " bad" : ""))}`;
}

VIEWS.ranks = () => {
  const res = UI.res.ranks;
  if (!res) rkLoad();
  else if (!res.busy && !res.loading && Date.now() - (res.at || 0) > 20000) rkLoad(true);
  if (!res || res.busy) return panel("Rank e reputazione", '<div class="loading">LETTURA DEI JOURNAL</div>', { code: "RANK" });
  if (res.error) return panel("Rank e reputazione", `<div class="bad">⚠ ${esc(res.error)}</div><button class="small" data-rk-refresh>Riprova</button>`, { code: "RANK" });
  const d = res.data;
  const pf = d.ranks.filter(r => !r.navy), navy = d.ranks.filter(r => r.navy);

  const powers = d.powers.length ? d.powers.map(p => `<div style="margin-bottom:10px"><span class="eyebrow">${esc(RK_POWER[p.key] || p.key)}</span>${rkRepBar(p.value, p.level)}</div>`).join("")
    : '<div class="empty">In attesa del login in gioco</div>';
  const levels = d.rep_levels.map(l => esc(l.name)).join(" · ");

  const fq = (UI.forms.rk?.fq || "").toLowerCase();
  const fl = d.factions.filter(f => !fq || f.name.toLowerCase().includes(fq) || (f.systems || []).some(s => s.toLowerCase().includes(fq)));
  const showAll = UI.open.has("rk:factions-all");
  const shown = showAll ? fl : fl.slice(0, 40);
  const factions = d.factions.length ? `
    <form class="form" data-form="rk" onsubmit="return false" style="margin-bottom:8px">
      <input name="fq" placeholder="Cerca faction o sistema" value="${esc(UI.forms.rk?.fq || "")}"></form>
    <table><thead><tr><th>Faction</th><th>Sistema</th><th>Livello</th><th class="num">Rep.</th></tr></thead><tbody>
    ${shown.map(f => `<tr><td>${esc(f.name)}${f.allegiance ? ` <span class="sub">· ${esc(f.allegiance)}</span>` : ""}</td>
      <td>${sys(f.system)}${f.systems.length > 1 ? ` <span class="sub" title="${esc(f.systems.join(", "))}">+${f.systems.length - 1}</span>` : ""}</td>
      <td class="${RK_LEVEL_CLS[f.level] ?? ""}">${esc(f.level || "—")}</td>
      <td class="num ${f.rep < 0 ? "bad" : f.rep > 35 ? "ok" : ""}">${f.rep > 0 ? "+" : ""}${dec(f.rep)}</td></tr>`).join("")}
    </tbody></table>
    ${fl.length > 40 ? `<button class="small ghost" data-rk-toggle="factions-all" style="margin-top:6px">${showAll ? "Mostra le prime 40" : `Mostra tutte (${fl.length})`}</button>` : ""}
    <div class="sub" style="margin-top:6px">Valore dell'ultima visita in un sistema dove la faction è presente; "Sistema" è l'ultimo in cui l'hai incontrata.</div>`
    : '<div class="empty">Nessuna faction nei journal</div>';

  const promos = d.promotions.length ? `<table><tbody>${d.promotions.map(p => `<tr><td class="muted mono">${esc((p.ts || "").slice(0, 10))}</td>
      <td><span class="eyebrow">${esc(p.label)}</span></td><td><b>${esc(p.name)}</b></td></tr>`).join("")}</tbody></table>`
    : '<div class="empty">Nessuna promozione nei journal</div>';

  return `<div class="col">
    <div class="grid">
      <div class="col">${panel("Pilots Federation", pf.map(rkCard).join(""), { code: "PF-RANK", aside: `<button class="small ghost" data-rk-refresh title="Rileggi">↻</button>` })}</div>
      <div class="col">${panel("Navy", navy.map(rkCard).join("") + `<div class="subpanel" style="margin-top:6px"><div class="eyebrow">Come salire nelle navy</div>
          <ul style="margin:6px 0 0 18px;padding:0">${d.navy_tips.map(t => `<li class="sub" style="margin-bottom:4px">${esc(t)}</li>`).join("")}</ul></div>`, { code: "NAVY" })}
        ${panel("Reputazione superpotenze", powers + `<div class="sub">Scala da -100 a +100. Livello stimato: Frontier non pubblica le soglie (${levels}).</div>`, { code: "REP" })}
        ${panel("Storico promozioni", promos, { code: "PROMO" })}</div>
    </div>
    ${panel(`Minor faction incontrate <span class="sub">(${d.factions.length})</span>`, factions, { code: "BGS-REP" })}
  </div>`;
};

document.addEventListener("input", e => {
  if (e.target.closest("[data-form='rk']")) {
    UI.forms.rk = { ...(UI.forms.rk || {}), [e.target.name]: e.target.value };
    const pos = e.target.selectionStart;
    renderView();
    const el = document.querySelector("[data-form='rk'] [name='fq']");
    if (el) { el.focus(); el.setSelectionRange(pos, pos); }
  }
});
