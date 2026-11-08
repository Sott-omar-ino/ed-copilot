"use strict";

// ============================================================================
// ESOBIOLOGIA (pianificatore)
// ============================================================================
// Il Codex arriva da /api/bio/codex (journal), la ricerca dei pianeti da /api/bio/nearby (Spansh, solo in background).
// Fonti di valori e distanze: app/gamedata.py; regola del bonus: app/bio.py.
// Entrambi restano in UI.res: l'aggiornamento automatico ogni 2 secondi non rifà le richieste.
const bioShort = (body, system) => body && system && body.startsWith(system) && body !== system ? body.slice(system.length).trim() : body;
const bioRange = (lo, hi) => lo == null ? "—" : lo === hi ? short(lo) : `${short(lo)}–${short(hi)}`;

function bioLoadCodex(quiet = false) {
  const cur = UI.res.bioCodex;
  if (cur?.busy || cur?.loading) return;
  if (!quiet || !cur) UI.res.bioCodex = { busy: true };
  else cur.loading = true;
  api("/api/bio/codex")
    .then(d => { UI.res.bioCodex = { data: d, at: Date.now(), unsold: S?.bio_unsold?.length }; })
    .catch(e => { UI.res.bioCodex = cur?.data ? { ...cur, loading: false, at: Date.now() } : { error: e.message, at: Date.now() }; })
    .finally(() => { if (currentTab() === "exobio") renderView(); });
}

function bioSearch() {
  const f = UI.forms.bio || {};
  const q = new URLSearchParams({
    ref: (f.ref || "").trim() || S.location.system || "Sol", radius: f.radius || 50,
    min_value: Math.round(parseFloat(String(f.min_value ?? "5").replace(",", ".")) * 1e6) || 0,
    max_gravity: String(f.max_gravity ?? "").replace(",", "."), max_arrival: f.max_arrival || "",
    only_new: f.only_new ? 1 : 0 });
  run("bioNearby", async () => {
    const d = await api("/api/bio/nearby?" + q);
    if (d.error) throw new Error(d.error);
    return d;
  });
}
document.addEventListener("submit", e => {
  if (e.target.dataset?.form !== "bio") return;
  e.preventDefault();
  bioSearch();
});
document.addEventListener("click", e => {
  if (e.target.closest("[data-bio-refresh]")) bioLoadCodex();
  const t = e.target.closest("[data-bio-toggle]");
  if (t) { UI.bioAll = !UI.bioAll; renderView(); }
});

function bioCodexPanel(c) {
  const unsold = S.bio_unsold || [];
  const kv = `<div class="kv-grid">
    <div class="kv"><span>Specie analizzate</span><span>${c.species_count}<span class="sub"> / ${c.known_total}</span></span></div>
    <div class="kv"><span>Analisi completate</span><span>${num(c.analysed)}</span></div>
    <div class="kv"><span>Varianti nel Codex</span><span>${num(c.variants_logged)}</span></div>
    <div class="kv"><span>Guadagnato</span><span class="gold">${short(c.earned)}</span></div>
    <div class="kv"><span>Di cui bonus scoperta</span><span class="gold">${short(c.bonus)}</span></div>
    <div class="kv"><span>Da vendere</span><span class="gold">${short(S.bio_unsold_total)}</span></div>
  </div>
  <div class="sub" style="margin-top:6px">${num(c.sold)} campioni venduti${unsold.length ? ` · ${unsold.length} campioni da vendere a Vista Genomics` : ""}</div>
  ${seg(c.species_count / (c.known_total || 1) * 100, 38, "holo")}`;
  const genera = c.genera.filter(g => g.total || g.species);
  const gt = `<table style="margin-top:12px"><thead><tr><th>Genere</th><th>Specie</th><th class="num">Analisi</th><th class="num">${LANG.lang === "en" ? "Colony" : "Colonia"}</th></tr></thead><tbody>
    ${genera.map(g => `<tr class="${g.species ? "" : "muted"}"><td><b>${esc(g.genus)}</b></td>
      <td><span class="mono">${g.species}/${g.total || "?"}</span> ${g.total ? seg(g.species / g.total * 100, 10, g.species >= g.total ? "full" : "") : ""}</td>
      <td class="num">${g.analysed || "—"}</td><td class="num muted">${g.min_dist ? g.min_dist + " m" : "—"}</td></tr>`).join("")}
    </tbody></table>`;
  const list = c.species.length ? `<table style="margin-top:12px"><thead><tr><th>Specie</th><th class="num">Analisi</th><th class="num">Valore</th><th class="num">Incassato</th></tr></thead><tbody>
    ${c.species.map(s => `<tr><td><b>${esc(s.name)}</b><div class="sub">${esc(s.variants.map(v => v.split(" - ")[1] || v).join(", "))}</div></td>
      <td class="num">${s.analysed}</td><td class="num gold">${short(s.value)}</td>
      <td class="num">${s.earned ? short(s.earned) : "—"}${s.bonus ? `<div class="sub new">bonus ${short(s.bonus)}</div>` : ""}</td></tr>`).join("")}
    </tbody></table>` : '<div class="empty">Nei journal non risulta ancora nessuna analisi completata</div>';
  const toggle = `<button class="small ghost" data-bio-toggle style="margin-top:10px">${UI.bioAll ? "▲ Mostra le specie analizzate" : "▼ Mostra i generi"}</button>`;
  return kv + (UI.bioAll ? gt : list) + toggle +
    (c.logged_only.length ? `<div class="sub" style="margin-top:8px">Registrate nel Codex ma mai analizzate: ${esc(c.logged_only.join(", "))}</div>` : "");
}

function bioTips(c) {
  const dist = Object.entries(c?.genus_distance || {}).sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
  return `<ul style="margin:0 0 10px 18px;padding:0">
    <li>Ogni specie va campionata <b>3 volte</b>; i campioni devono essere lontani almeno la <b>distanza di colonia</b> del genere.</li>
    <li>Il <b>bonus prima scoperta</b> (in totale ${c?.first_bonus || 5} volte il valore base) si ottiene sui corpi dove nessuno
      ha ancora messo piede (in Panoramica: tag <span class="tag new">no footfall</span>). Le specie già segnalate da altri
      giocatori sono su corpi già visitati: lì il bonus è molto improbabile.</li>
    <li><span class="tag new">nuova</span> = specie che non hai mai analizzato: è nuova per il <b>tuo</b> Codex, non per la galassia.</li>
    <li>Con gravità alta atterrare e camminare è più difficile: usa il filtro della gravità massima.</li>
    <li>Le specie elencate sono quelle segnalate dai giocatori e possono essere incomplete: controlla il numero di segnali.</li>
  </ul>
  <div class="eyebrow" style="margin-bottom:4px">Distanza di colonia</div>
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:2px 14px">
    ${dist.map(([g, m]) => `<div style="display:flex;justify-content:space-between"><span>${esc(g)}</span><span class="mono muted">${m} m</span></div>`).join("")}
  </div>`;
}

function bioSpecies(x) {
  const sp = x.species.map(s => `<div style="white-space:nowrap">${esc(s.name)} <span class="mono gold">${short(s.value)}</span>
    ${s.done_here ? '<span class="tag mapped">fatta qui</span>' : s.new ? '<span class="tag new">nuova</span>' : ""}</div>`);
  const unk = x.unknown_genera.map(u => `<div style="white-space:nowrap" class="muted">${esc(u.genus)} <span class="sub">(specie ?)</span>
    <span class="mono">${bioRange(u.min, u.max)}</span>${u.new_possible ? ' <span class="tag new">forse nuova</span>' : ""}</div>`);
  if (x.unidentified) unk.push(`<div class="sub">+ ${x.unidentified} segnali non identificati</div>`);
  return sp.concat(unk).join("") || '<span class="sub">Nessuna specie segnalata</span>';
}

function bioResults(n) {
  const filters = [`entro ${ly(n.radius)} da ${n.reference}`];
  if (n.min_value) filters.push(`valore ≥ ${short(n.min_value)}`);
  if (n.max_gravity) filters.push(`gravità ≤ ${n.max_gravity} g`);
  if (n.max_arrival) filters.push(`≤ ${num(n.max_arrival)} ls`);
  if (n.only_new) filters.push("solo specie nuove");
  return `<div class="sub" style="margin-bottom:6px">${n.results.length} <span>corpi</span> ${filters.map(x => esc(LANG.t(x))).join(" · ")}${n.truncated ? `<span> · trovati ${num(n.spansh_count)}, letti i primi 200 ${n.min_value ? "più ricchi" : "più vicini"}</span>` : ""}</div>
    <table><thead><tr><th>Corpo</th><th class="num">Dist.</th><th class="num">Gravità</th><th>Atmosfera</th><th class="num">Bio</th><th>Specie</th><th class="num">Valore</th><th></th></tr></thead><tbody>
    ${n.results.map(x => {
      const body = bioShort(x.body, x.system), hot = x.value_new >= 10e6;
      return `<tr class="${hot ? "hot" : ""}"><td>${sys(x.system)}<div><b>${esc(body)}</b></div>
        <div class="sub">${esc(T("body", x.type || ""))}${x.temperature != null ? ` · ${x.temperature} K` : ""}</div></td>
      <td class="num">${ly(x.distance)}<div class="sub">${x.arrival != null ? num(x.arrival) + " ls" : "—"}</div></td>
      <td class="num ${x.gravity > 2 ? "bad" : ""}">${x.gravity != null ? x.gravity.toLocaleString(NUM_LOCALE, { maximumFractionDigits: 2 }) + " g" : "—"}</td>
      <td>${esc(x.atmosphere)}</td>
      <td class="num"><span class="tag bio">${x.bio ?? "?"}</span>${x.complete ? "" : '<div class="sub">incompleto</div>'}</td>
      <td>${bioSpecies(x)}</td>
      <td class="num"><b class="gold">${short(x.value)}</b>${x.value_new && x.value_new !== x.value ? `<div class="sub new"><span>nuove</span> ${short(x.value_new)}</div>` : ""}
        ${x.value_max > x.value ? `<div class="sub"><span>fino a</span> ${short(x.value_max)}</div>` : ""}</td>
      <td>${todoBtn(LANG.t(`Esobiologia: ${x.body}${x.new_count ? ` (${x.new_count} specie nuove)` : ""} · ${short(x.value)} Cr`), x.system, "Esobiologia")}</td></tr>`;
    }).join("") || '<tr><td colspan="8"><div class="empty">Nessun pianeta trovato: allarga il raggio o abbassa il valore minimo</div></td></tr>'}</tbody></table>
    <div class="sub" style="margin-top:6px">Valori base (senza bonus prima scoperta), dalle tue vendite o dalla tabella dei valori. Dati segnalati dai giocatori, in cache per 15 minuti.</div>`;
}

// --- Previsione delle specie nel sistema attuale (/api/bio/predict, regole in app/bio_rules.py) ---------------
const BIO_PRED_MS = 5000;
function bioPredLoad(force = false) {
  const r = UI.res.bioPred;
  if (UI.bioPredLoading || (!force && r && Date.now() - (r.t || 0) < BIO_PRED_MS)) return;
  UI.bioPredLoading = true;
  api("/api/bio/predict")
    .then(data => { UI.res.bioPred = { data, t: Date.now() }; })
    .catch(e => { UI.res.bioPred = { ...(r || {}), error: e.message, t: Date.now() }; })
    .finally(() => {
      UI.bioPredLoading = false;
      if (currentTab() === "exobio" && !document.activeElement?.matches("input:not([type=checkbox]):not([type=range]), select, textarea")) renderView();
    });
}
const bioPredSwitch = (key, on, label) =>
  `<button class="switch ${on ? "on" : ""}" data-biopred-cfg="${key}" role="switch" aria-checked="${on}" aria-label="${esc(label)}"><span></span><span></span></button>`;
const BIO_WORTH = { si: '<span class="tag solid">sì</span>', forse: '<span class="tag new">forse</span>', no: '<span class="muted">no</span>' };

function bioPredGenus(g, mult) {
  const sp = g.species.map(s => {
    const state = s.scanned ? (s.done ? '<span class="tag mapped">analizzata</span>' : '<span class="tag bio">trovata</span>')
      : s.sure ? "" : `<span class="sub" title="Condizione non verificabile qui: ${esc(s.why)}">(da verificare: ${esc(s.why)})</span>`;
    return `<div class="bio-pred-sp">${esc(s.name)} <span class="mono gold">${short(s.value * mult)}</span>
      ${s.new ? '<span class="tag new">nuova</span>' : ""}${state}</div>`;
  }).join("");
  const head = `<b>${esc(g.genus)}</b>${g.detected ? ' <span class="tag bio">rilevato</span>' : ""}
    <span class="mono sub">${bioRange(g.min, g.max)}</span>${g.outside ? '<div class="sub bad">nessuna specie prevista dalle regole: elencate tutte</div>' : ""}`;
  return `<div class="bio-pred-genus">${head}${sp}</div>`;
}

function bioPredRows(d) {
  if (!d.bodies.length) return `<tr><td colspan="5"><div class="empty">Nessun corpo con segnali biologici in questo sistema${d.system ? "" : " (sistema non ancora noto)"}: fai l'honk e usa l'FSS</div></td></tr>`;
  return d.bodies.map(b => {
    const info = b.scanned ? `<div class="sub">${esc(T("body", b.cls || ""))}${b.gravity != null ? ` · ${b.gravity.toLocaleString(NUM_LOCALE, { maximumFractionDigits: 2 })} g` : ""}${b.temp != null ? ` · ${b.temp} K` : ""}</div>
        <div class="sub">${esc(b.atmo && b.atmo !== "None" ? b.atmo.replace(/([a-z])([A-Z])/g, "$1 $2") : "senza atmosfera")}${b.volcanism ? " · " + esc(b.volcanism) : ""}${b.dist != null ? ` · ${num(b.dist)} ls` : ""}</div>`
      : '<div class="sub">corpo non ancora scansionato</div>';
    const genera = b.genera.map(g => bioPredGenus(g, b.mult)).join("")
      + (b.unexplained ? `<div class="sub">${b.genera.length ? "+ " : ""}${b.unexplained} ${b.unexplained === 1 ? "segnale" : "segnali"} senza specie prevista</div>` : "");
    const ff = b.mult === 5 ? '<div class="sub new">×5 prima impronta</div>' : b.footfall === false ? '<div class="sub">sistema abitato: niente bonus</div>' : "";
    return `<tr class="${b.worth === "si" ? "hot" : ""}"><td><b>${esc(b.short || b.name || "?")}</b>${info}</td>
      <td class="num"><span class="tag bio">${b.bio}</span><div class="sub">${b.dss ? "DSS fatto" : "solo FSS"}</div></td>
      <td>${genera || '<span class="sub">—</span>'}</td>
      <td class="num"><b class="gold">${b.max ? bioRange(b.min, b.max) : "—"}</b>${ff}</td>
      <td>${BIO_WORTH[b.worth] || ""}</td></tr>`;
  }).join("");
}

function bioPredPanel() {
  bioPredLoad();
  const r = UI.res.bioPred;
  if (!r?.data) return { head: r?.error ? `<div class="bad">⚠ ${esc(r.error)}</div>` : '<div class="loading">LETTURA DELLE SCANSIONI</div>', settings: "" };
  const d = r.data, cfg = d.config;
  const worth = d.bodies.filter(b => b.worth !== "no").length;
  const head = `<div class="kv-grid">
      <div class="kv"><span>Sistema</span><span>${sys(d.system)}</span>${d.region ? `<span class="sub">${esc(d.region)}</span>` : ""}</div>
      <div class="kv"><span>Corpi con vita</span><span class="mono">${d.bodies.length}</span></div>
      <div class="kv"><span>Potenziale</span><span class="gold mono">${d.total_max ? bioRange(d.total_min, d.total_max) : "—"}</span></div>
      <div class="kv"><span>Vale la pena</span><span class="big ${worth ? "gold" : ""}">${worth}</span><span class="sub">soglia ${short(cfg.min_value)} CR</span></div>
    </div>${d.populated ? '<div class="sub" style="margin-top:6px">Sistema abitato: niente bonus prima impronta.</div>' : ""}`;
  const table = `<div style="overflow-x:auto;margin-top:12px"><table><thead><tr><th>Corpo</th><th class="num">Bio</th><th>Specie possibili</th><th class="num">Valore</th><th>Atterrare?</th></tr></thead>
    <tbody>${bioPredRows(d)}</tbody></table></div>
    <div class="sub" style="margin-top:6px">Previsione dalle condizioni del corpo (tipo, atmosfera, gravità, temperatura, pressione, vulcanismo, stelle, regione):
      sono specie <b>possibili</b>, non certe. Valore minimo = i generi meno ricchi, massimo = i più ricchi, per quanti sono i segnali; dopo il DSS
      contano solo i generi rilevati. "Sì" se anche il minimo supera la soglia, "forse" se la supera solo il massimo.
      ×5 se nessuno ha mai messo piede sul corpo e il sistema non è abitato.</div>`;
  const settings = `<div class="todo-item" style="align-items:center"><div class="text">Annuncio a voce<div class="sub">Dopo FSS e DSS dice quali corpi conviene visitare</div></div>${bioPredSwitch("voice", cfg.voice, "Annuncio a voce")}</div>
    <div class="todo-item" style="align-items:center"><div class="text">Nel ticker<div class="sub">Scrive specie possibili e valore nel registro eventi</div></div>${bioPredSwitch("feed", cfg.feed, "Annuncio nel ticker")}</div>
    <form class="form" data-form="biopred-cfg" id="f-biopred-cfg" style="margin-top:8px">
      <label>Soglia "vale la pena" (M CR per corpo)<input id="biopred-min" name="min_value" type="number" min="0" step="0.5" value="${esc(cfg.min_value / 1e6)}" style="width:120px"></label>
      <button class="small" type="submit">Salva</button></form>`;
  return { head: head + table, settings };
}

document.addEventListener("click", e => {
  const t = e.target.closest("[data-biopred-cfg]");
  if (!t) return;
  const cfg = UI.res.bioPred?.data?.config;
  if (!cfg) return;
  const key = t.dataset.biopredCfg;
  api("/api/bio/predict/config", { [key]: !cfg[key] })
    .then(data => { UI.res.bioPred = { data, t: Date.now() }; toast("Impostazione salvata"); })
    .catch(err => toast(err.message))
    .finally(renderView);
});
document.addEventListener("submit", e => {
  if (e.target.dataset?.form !== "biopred-cfg") return;
  e.preventDefault();
  e.stopImmediatePropagation();
  const v = parseFloat(String(new FormData(e.target).get("min_value")).replace(",", "."));
  if (!(v >= 0)) { toast("Indica un valore valido"); return; }
  api("/api/bio/predict/config", { min_value: Math.round(v * 1e6) })
    .then(data => { UI.res.bioPred = { data, t: Date.now() }; UI.dirty.delete("biopred-min"); toast("Soglia salvata"); })
    .catch(err => toast(err.message))
    .finally(renderView);
});

VIEWS.exobio = () => {
  const pred = bioPredPanel();
  const r = UI.res.bioCodex;
  // Primo caricamento, poi rilettura leggera ogni 60 s o quando cambiano i campioni non venduti (nuova analisi/vendita).
  if (!r) bioLoadCodex();
  else if (!r.busy && !r.loading && (Date.now() - (r.at || 0) > 60000
    || (r.unsold != null && r.unsold !== S.bio_unsold?.length && Date.now() - (r.at || 0) > 3000))) bioLoadCodex(true);
  const c = r?.data;
  const codex = !r || r.busy ? '<div class="loading">LETTURA DEI JOURNAL</div>'
    : r.error ? `<div class="bad">⚠ ${esc(r.error)}</div><button class="small" data-bio-refresh>Riprova</button>`
      : bioCodexPanel(c);

  const f = "bio";
  const form = `<form class="form" data-form="${f}" id="f-bio">
    ${inp(f, "ref", "Vicino a", "", `id="bio-ref" placeholder="${esc(S.location.system || "Sol")}"`)}
    ${inp(f, "radius", "Entro (al)", "50", 'type="number" min="5" max="500" style="width:90px"')}
    ${inp(f, "min_value", "Valore min. (M Cr)", "5", 'type="number" min="0" step="0.5" style="width:110px"')}
    ${inp(f, "max_gravity", "Gravità max (g)", "", 'type="number" min="0" step="0.1" placeholder="nessuna" style="width:110px"')}
    ${inp(f, "max_arrival", "Distanza max (ls)", "", 'type="number" min="0" step="500" placeholder="nessuna" style="width:120px"')}
    ${chk(f, "only_new", false, "Solo specie nuove per me")}
    <button class="primary" type="submit">Cerca</button></form>
    <div class="sub" style="margin-top:6px">Valore = somma dei valori base delle specie segnalate dai giocatori che non hai già analizzato su quel corpo. Con valore minimo 0 si cercano i corpi più vicini, anche senza specie segnalate.</div>`;

  return `${panel("Vita nel sistema", pred.head, { code: "BIO-PREDICT", cls: "holo" })}
    ${pred.settings ? `<div style="margin-top:18px">${panel("Avvisi esobiologia", pred.settings, { code: "VOX" })}</div>` : ""}
    <div class="grid" style="margin-top:18px"><div class="col">
      ${panel("Il tuo Codex biologico", codex, { code: "CODEX", cls: "holo", aside: `<button class="small ghost" data-bio-refresh title="Rileggi i journal">Aggiorna</button>` })}
    </div><div class="col">${panel("Consigli", bioTips(c), { code: "GENE-SEQ" })}</div></div>
    <div style="margin-top:18px">${panel("Pianeti con vita vicini", form, { code: "BIO-SEARCH" })}</div>
    <div style="margin-top:18px">${panel("Risultati", result("bioNearby", bioResults, "Imposta i filtri e premi Cerca."), { code: "RESULTS" })}</div>`;
};
