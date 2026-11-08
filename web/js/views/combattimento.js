"use strict";

// ============================================================================
// COMBATTIMENTO
// ============================================================================
// Dati da /api/combat/session (app/bounty.py): sessione in corso, voucher non riscossi, storico, segnali RES/CZ del
// sistema attuale. Si chiedono al server ogni 5 secondi mentre la scheda è aperta (non a ogni ridisegno da 2 s).
// Fonti delle regole e dei campi del journal: commento in testa a app/bounty.py.
const CB_TTL = 5000;

function cbData(force = false) {
  const r = UI.res.combat;
  if (force || !r || (!r.busy && Date.now() - r.at > CB_TTL)) {
    const prev = r?.data;
    UI.res.combat = { busy: true, data: prev, at: Date.now() };
    api("/api/combat/session").then(data => { UI.res.combat = { data, at: Date.now() }; })
      .catch(e => { UI.res.combat = { data: prev, error: e.message, at: Date.now() }; })
      .finally(() => {
        if (currentTab() === "combat" && !document.activeElement?.matches("input:not([type=checkbox]), select, textarea")) renderView();
      });
  }
  return UI.res.combat;
}

const cbDate = iso => iso ? new Date(iso).toLocaleString(NUM_LOCALE, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "—";
const cbRate = (v, unit) => v == null ? '<span class="muted">—</span>' : `${unit === "cr" ? short(v) + " CR/h" : v.toLocaleString(NUM_LOCALE) + "/h"}`;
const cbKv = (label, value, cls = "") => `<div class="kv"><span>${label}</span><span class="${cls}">${value}</span></div>`;

function cbSession(s) {
  if (!s) return '<div class="empty">Nessuna sessione trovata nei journal.</div>';
  const kills = s.kills + s.bond_kills;
  if (!kills && !s.deaths && !s.redeemed && !s.interdicted) {
    return `<div class="empty">Nessuna uccisione in questa sessione (dal ${cbDate(s.start)}).</div>`;
  }
  const facs = s.top_factions.length ? `<table style="margin-top:12px"><thead><tr><th>Fazione che paga</th><th class="num">Guadagnato</th></tr></thead><tbody>
    ${s.top_factions.map(f => `<tr><td>${esc(f.faction)}</td><td class="num gold">${cr(f.amount)}</td></tr>`).join("")}</tbody></table>` : "";
  const victims = s.victims.length ? `<div class="sub" style="margin-top:10px">Bersagli: ${s.victims.map(v => `${esc(v.faction)} ×${v.kills}`).join(" · ")}</div>` : "";
  const ships = s.targets.length ? `<div class="sub">Navi abbattute: ${s.targets.map(t => `${esc(t.ship)} ×${t.kills}`).join(" · ")}</div>` : "";
  return `<div class="kv-grid">
      ${cbKv("Uccisioni", num(kills))}
      ${cbKv("Bounty", cr(s.bounties), "gold")}
      ${cbKv("Combat bond", cr(s.bonds), "gold")}
      ${cbKv("CR/ora", cbRate(s.cr_hour, "cr"))}
      ${cbKv("Uccisioni/ora", cbRate(s.kills_hour))}
      ${cbKv("Tempo in combattimento", dur(s.active))}
      ${s.capship ? cbKv("Capital ship", num(s.capship)) : ""}
      ${s.pvp ? cbKv("PvP", num(s.pvp)) : ""}
      ${s.interdicted || s.escaped ? cbKv("Interdetto / sfuggito", `${num(s.interdicted)} / ${num(s.escaped)}`) : ""}
      ${s.interdictions ? cbKv("Interdizioni riuscite", num(s.interdictions)) : ""}
      ${s.redeemed ? cbKv("Riscosso", cr(s.redeemed), "ok") : ""}
      ${s.fines ? cbKv("Multe/taglie pagate", cr(s.fines), "bad") : ""}
      ${s.deaths ? cbKv("Morti", num(s.deaths), "bad") : ""}
      ${s.lost ? cbKv("Voucher persi", cr(s.lost), "bad") : ""}
    </div>${facs}${victims}${ships}
    <div class="sub" style="margin-top:8px">Dal ${cbDate(s.start)}${s.systems.length ? " · " + s.systems.map(esc).join(", ") : ""}.
      CR/ora e uccisioni/ora sono stime: contano solo il tempo fra un'uccisione e la successiva (pause oltre 15 minuti escluse).</div>`;
}

function cbVouchers(d) {
  const warn = d.warn ? `<div class="warnbox" style="margin-bottom:10px">⚠ Stai portando ${cr(d.total)} di voucher non riscossi (soglia ${cr(d.config.warn_cr)}).
    Se la nave viene distrutta si perdono: valuta di riscuoterli.</div>` : "";
  if (!d.vouchers.length) return warn + '<div class="empty">Nessun voucher da riscuotere.</div>';
  const broker = d.broker ? `${num(d.broker.pct)}% (ultima commissione registrata dal gioco, ${cbDate(d.broker.ts)})` : "una commissione";
  return `${warn}<table><thead><tr><th>Fazione</th><th>Tipo</th><th class="num">Valore</th></tr></thead><tbody>
    ${d.vouchers.map(v => `<tr><td>${esc(v.faction)}</td><td><span class="tag">${v.type === "bounty" ? "Bounty" : "Combat bond"}</span></td>
      <td class="num gold">${cr(v.amount)}</td></tr>`).join("")}
    <tr><td><b>Totale</b></td><td></td><td class="num gold"><b>${cr(d.total)}</b></td></tr></tbody></table>
    <div class="sub" style="margin-top:8px">Le taglie si riscuotono nelle stazioni controllate dalla fazione che le ha emesse.
      All'Interstellar Factors puoi riscuotere bounty e combat bond di qualunque fazione, pagando ${broker}.
      Valori secondo gli eventi del journal: l'importo pagato alla riscossione può essere diverso.</div>`;
}

function cbIF() {
  const res = !UI.res.combatIF ? "" : result("combatIF", d => `<div class="sub" style="margin:6px 0">Da ${esc(d.reference?.name || "")} · ${d.results.length} di ${num(d.count)}</div>
    <table><thead><tr><th>Stazione</th><th>Sistema</th><th class="num">Dist.</th><th class="num">Dalla stella</th><th>Pad</th><th></th></tr></thead><tbody>
    ${d.results.slice(0, 8).map(r => `<tr><td><b>${esc(r.station)}</b><div class="sub">${esc(T("station", r.type || ""))}</div></td>
      <td>${sys(r.system)}</td><td class="num">${ly(r.distance)}</td><td class="num">${r.dist_ls != null ? num(r.dist_ls) + " ls" : "—"}</td>
      <td>${r.large_pad ? '<span class="ok">L</span>' : r.medium_pad ? "M" : '<span class="muted">S</span>'}</td>
      <td>${todoBtn(LANG.t(`Riscuotere voucher a ${r.station}`), r.system, "Viaggi")}</td></tr>`).join("")
      || '<tr><td colspan="6"><div class="empty">Nessun risultato</div></td></tr>'}</tbody></table>`, "");
  return `<button class="small" data-cb-if ${S.location.system ? "" : "disabled"}>Cerca Interstellar Factors vicino</button>${res}`;
}

function cbSignals(d) {
  const s = d.system || {};
  const here = S.location.system;
  const list = s.signals || [];
  const head = `<div class="sub" style="margin-bottom:8px">${here ? sys(here) : "Sistema sconosciuto"} · segnali rilevati con FSS o all'arrivo</div>`;
  if (!list.length) return head + '<div class="empty">Nessun Resource Extraction Site o Conflict Zone trovato finora in questo sistema.</div>';
  return head + list.map(x => `<div class="todo-item" style="align-items:center"><div class="text">${esc(x.label)}</div>
    <span class="tag ${x.kind === "cz" ? "solid" : ""}">${x.kind === "cz" ? "CZ" + (x.count > 1 ? " ×" + x.count : "") : "RES"}</span></div>`).join("");
}

function cbScan(d) {
  const t = d.last_scan;
  if (!t || Date.now() - new Date(t.ts).getTime() > 3600e3) return "";
  return `<div class="sub" style="margin-top:12px">Ultimo bersaglio scansionato (${ago(t.ts)}): <b>${esc(t.ship || "?")}</b>
    ${t.pilot ? "· " + esc(t.pilot) : ""}${t.rank ? " (" + esc(t.rank) + ")" : ""}${t.faction ? " · " + esc(t.faction) : ""}
    · taglia <span class="gold">${cr(t.bounty)}</span></div>`;
}

function cbRank() {
  const idx = S.ranks?.Combat;
  if (idx == null) return '<div class="empty">Rank non ancora letto dal journal.</div>';
  const names = (UI.lang === "it" ? STATIC.ranks : STATIC.ranks_en)?.Combat || [];
  const p = S.progress?.Combat ?? null;
  const next = names[idx + 1];
  return `<div class="kv-grid">${cbKv("Rank Combat", esc(names[idx] || String(idx)), "gold")}${cbKv("Progresso", p != null ? p + "%" : "—")}</div>
    ${p != null && next ? `<div style="margin-top:8px">${seg(p, 20)}</div><div class="sub"><span>Verso</span> ${esc(next)}</div>` : ""}`;
}

function cbHistory(d) {
  const h = d.history.filter(s => s.start !== d.current?.start);
  if (!h.length) return '<div class="empty">Nessuna sessione di combattimento precedente nei journal.</div>';
  return `<div style="max-height:360px;overflow:auto"><table><thead><tr><th>Inizio</th><th class="num">Uccisioni</th><th class="num">Bounty</th><th class="num">Bond</th>
    <th class="num">CR/ora</th><th class="num">Riscosso</th><th class="num">Persi</th><th>Sistemi</th></tr></thead><tbody>
    ${h.map(s => `<tr><td class="sub">${cbDate(s.start)}</td><td class="num">${num(s.kills + s.bond_kills)}</td><td class="num gold">${short(s.bounties)}</td>
      <td class="num gold">${short(s.bonds)}</td><td class="num">${s.cr_hour != null ? short(s.cr_hour) : "—"}</td>
      <td class="num ok">${s.redeemed ? short(s.redeemed) : "—"}</td><td class="num ${s.lost ? "bad" : ""}">${s.lost ? short(s.lost) : "—"}</td>
      <td class="sub">${s.systems.map(esc).join(", ") || "—"}</td></tr>`).join("")}</tbody></table></div>`;
}

function cbSettings(d) {
  const c = d.config;
  return `<form class="form" data-cb-form>
    <label>Avvisa sopra (CR)<input id="cb-warn" name="warn_cr" type="number" min="0" step="100000" value="${esc(c.warn_cr)}" style="width:140px"></label>
    <label class="check"><input type="checkbox" name="warn_feed" ${c.warn_feed ? "checked" : ""}> Nel feed</label>
    <label class="check"><input type="checkbox" name="warn_voice" ${c.warn_voice ? "checked" : ""}> A voce</label>
    <button class="primary" type="submit">Salva</button></form>
    <div class="sub">Il valore iniziale (10 milioni) è arbitrario: scegli il rischio che sei disposto a correre. 0 = nessun avviso.</div>`;
}

VIEWS.combat = () => {
  const r = cbData();
  const d = r.data;
  if (!d) return panel("Combattimento", r.error ? `<div class="bad">⚠ ${esc(r.error)}</div>` : '<div class="loading">LETTURA DEI JOURNAL</div>');
  const massacre = (S.missions || []).some(m => m.kills != null && m.target)
    ? `<a href="#missions" class="small">Vedi stack massacro in Missioni →</a>` : "";
  const title = d.current && !d.current.ended ? "Sessione in corso" : "Ultima sessione";
  return `<div class="grid">
    <div class="col">
      ${panel(title, cbSession(d.current) + cbScan(d), { code: "COMBAT-LOG", aside: massacre })}
      ${panel("Voucher da riscuotere", cbVouchers(d) + `<div style="margin-top:12px">${cbIF()}</div>`, { code: "VOUCHERS" })}
      ${panel("Sessioni precedenti", cbHistory(d), { code: "HISTORY" })}
    </div>
    <div class="col">
      ${panel("RES e Conflict Zone nel sistema", cbSignals(d), { code: "SIGNALS" })}
      ${panel("Rank Combat", cbRank(), { code: "RANK" })}
      ${panel("Avviso voucher", cbSettings(d), { code: "ALERT" })}
    </div></div>`;
};

document.addEventListener("click", e => {
  if (!e.target.closest?.("[data-cb-if]")) return;
  run("combatIF", () => api("/api/search", { mode: "service", service: "Interstellar Factors Contact", reference: S.location.system, no_carriers: true }));
});
document.addEventListener("submit", e => {
  const f = e.target.closest?.("[data-cb-form]");
  if (!f) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  const body = { warn_cr: f.warn_cr.value, warn_feed: f.warn_feed.checked, warn_voice: f.warn_voice.checked };
  api("/api/combat/config", body).then(data => { UI.res.combat = { data, at: Date.now() }; UI.dirty.delete("cb-warn"); toast("Avviso salvato"); })
    .catch(err => toast("Errore: " + err.message)).finally(renderView);
}, true);
