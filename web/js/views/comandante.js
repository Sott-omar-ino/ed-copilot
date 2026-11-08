"use strict";

// ============================================================================
// COMANDANTE
// ============================================================================
const STAT_SECTIONS = { Exploration: "Esplorazione", Exobiology: "Esobiologia", Trading: "Commercio", Mining: "Estrazione",
  Combat: "Combattimento", Bank_Account: "Conto", Passengers: "Passeggeri", Search_And_Rescue: "Ricerca e soccorso",
  Crafting: "Ingegnerizzazione", Material_Trader_Stats: "Material Trader" };
function statValue(key, v) {
  if (typeof v !== "number") return esc(v);
  if (/Time_Played/.test(key)) return Math.round(v / 3600).toLocaleString(NUM_LOCALE) + " h";
  if (/Profit|Wealth|Spent|Payout|Reward|Value|Earned|Bonus/i.test(key)) return short(v) + " CR";
  if (/Distance/.test(key)) return ly(v);
  return num(v);
}

VIEWS.cmdr = () => {
  const st = S.statistics, bank = st.Bank_Account || {}, ex = st.Exploration || {};
  const ranks = Object.keys(STATIC.ranks).map(k => {
    const r = S.ranks[k], p = S.progress[k] || 0;
    if (r == null) return "";
    const names = (UI.lang === "it" ? STATIC.ranks : STATIC.ranks_en)[k], max = r >= names.length - 1;
    return `<div style="margin-bottom:12px"><div style="display:flex;justify-content:space-between;align-items:baseline">
      <span class="eyebrow">${STATIC.rank_labels[k]}</span><span><b style="font-size:17px;letter-spacing:.06em;text-transform:uppercase">${esc(names[r])}</b>
      <span class="mono muted"> ${max ? "MAX" : p + "%"}</span></span></div>${seg(max ? 100 : p, 25, max ? "full" : "")}
      ${max ? "" : `<div class="sub" style="margin-top:2px">→ ${esc(names[r + 1] || "")}</div>`}</div>`;
  }).join("");
  const rep = Object.entries(S.reputation).map(([k, v]) => {
    const lbl = { Empire: "Impero", Federation: "Federazione", Alliance: "Alleanza", Independent: "Indipendenti" }[k];
    return `<div style="margin-bottom:10px"><div style="display:flex;justify-content:space-between"><span class="eyebrow">${lbl}</span>
      <span class="mono ${v < 0 ? "bad" : v > 50 ? "ok" : ""}">${v > 0 ? "+" : ""}${dec(v)}</span></div>${meter((v + 100) / 2, "center" + (v < 0 ? " bad" : ""))}</div>`;
  }).join("");
  const stats = Object.entries(STAT_SECTIONS).filter(([k]) => st[k]).map(([k, lbl]) =>
    panel(lbl, `<table><tbody>${Object.entries(st[k]).filter(([, v]) => v !== 0).map(([sk, v]) =>
      `<tr><td class="muted">${esc(UI.orig || LANG.lang === "en" ? sk.replace(/_/g, " ") : IT.stat[sk] || sk.replace(/_/g, " "))}</td><td class="num">${statValue(sk, v)}</td></tr>`).join("") ||
      '<tr><td><div class="empty">Niente da mostrare</div></td></tr>'}</tbody></table>`, { code: k.slice(0, 4).toUpperCase() })).join("");
  const cargo = S.cargo.length ? `<table><tbody>${S.cargo.map(i => `<tr><td>${esc(T("commodity", i.name))}</td><td class="num">${num(i.count)} t</td></tr>`).join("")}</tbody></table>` : '<div class="empty">Stiva vuota</div>';

  return `<div class="col">${panel("Profilo del comandante", `
      <div class="eyebrow">Pilots Federation${S.cmdr.group ? " · gruppo " + esc(S.cmdr.group) : S.cmdr.mode ? " · " + esc(S.cmdr.mode) : ""}</div>
      <div class="display chroma glitchy">CMDR ${esc(S.cmdr.name || "—")}</div>
      <div class="kv-grid" style="margin-top:14px">
        <div class="kv"><span>Crediti</span><span class="gold">${cr(S.cmdr.credits)}</span></div>
        <div class="kv"><span>Patrimonio</span><span>${short(bank.Current_Wealth)} CR</span></div>
        <div class="kv"><span>Navi</span><span>${S.fleet.length}</span></div>
        <div class="kv"><span>Tempo di gioco</span><span>${ex.Time_Played ? Math.round(ex.Time_Played / 3600) + " h" : "—"}</span></div>
        <div class="kv"><span>Sistemi visitati</span><span>${num(ex.Systems_Visited)}</span></div>
        <div class="kv"><span>Distanza percorsa</span><span>${ly(ex.Total_Hyperspace_Distance)}</span></div>
      </div>`, { code: "PILOTS-FEDERATION" })}
    <div class="grid"><div class="col">${panel("Ranghi", ranks || '<div class="empty">In attesa del login in gioco</div>', { code: "RANK" })}</div>
    <div class="col">${panel("Reputazione superpotenze", rep || '<div class="empty">—</div>', { code: "REP" })}${panel("Stiva", cargo, { code: "CARGO" })}</div></div>
    <div class="cards">${stats}</div></div>`;
};
