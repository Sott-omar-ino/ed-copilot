"use strict";
// ============================================================================
// Lingua dell'interfaccia (italiano / inglese).
// L'interfaccia è scritta in italiano; con l'inglese attivo ogni testo mostrato viene sostituito con la sua traduzione.
// I dizionari stanno in web/js/lang/en-*.js e si registrano con LANG.add({...}):
//   - chiave esatta:   "Cosa fare qui": "What to do here"
//   - con segnaposto:  "{} sistemi non venduti": "{} unsold systems"   ({} = qualsiasi testo, anche numeri)
//     Più segnaposto si usano in ordine; "{1}", "{2}" nella traduzione permettono di cambiarlo ("{2} di {1}").
// Il confronto ignora gli spazi all'inizio e alla fine e quelli doppi. Si traducono i nodi di testo e gli attributi
// title, placeholder, aria-label e data-tip. Nel codice: t("testo") restituisce la traduzione (o il testo stesso).
// ============================================================================
const LANG = (() => {
  const exact = new Map(), patterns = [], memo = new Map();
  // Nodi e attributi già tradotti (con il testo scritto): quando l'osservatore li rivede non vanno ritradotti.
  const doneText = new WeakMap(), doneAttr = new WeakMap();
  let lang = localStorage.getItem("ed_ui_lang") || "it";
  const norm = s => s.replace(/\s+/g, " ").trim();
  const ATTRS = ["title", "placeholder", "aria-label", "data-tip"];

  function add(dict) {
    for (const [k, v] of Object.entries(dict)) {
      const key = norm(k);
      if (key.includes("{")) {
        const parts = key.split(/\{\d*\}/).map(p => p.replace(/[.*+?^$()|[\]\\]/g, "\\$&"));
        patterns.push({ re: new RegExp("^" + parts.join("(.+?)") + "$", "s"), out: v });
      } else exact.set(key, v);
    }
    memo.clear();
  }
  function translate(text) {
    if (lang !== "en" || !text) return text;
    const key = norm(text);
    if (!key || !/[a-zàèéìòù]/i.test(key)) return text;
    let out = memo.get(key);
    if (out === undefined) {
      out = exact.get(key) ?? null;
      if (out == null) {
        for (const p of patterns) {
          const m = key.match(p.re);
          if (!m) continue;
          let i = 0;
          const vals = m.slice(1).map(x => translate(x));
          out = p.out.replace(/\{(\d*)\}/g, (_, n) => vals[n ? +n - 1 : i++] ?? "");
          break;
        }
      }
      if (memo.size > 20000) memo.clear();
      memo.set(key, out);
    }
    if (out == null) return text;
    const lead = text.match(/^\s*/)[0], trail = text.match(/\s*$/)[0];
    return lead + out + trail;
  }
  function textNode(n) {
    if (doneText.get(n) === n.nodeValue) return;
    const v = translate(n.nodeValue);
    if (v !== n.nodeValue) { n.nodeValue = v; doneText.set(n, v); }
  }
  function walk(root) {
    if (lang !== "en" || !root) return;
    if (root.nodeType === 3) { textNode(root); return; }
    if (root.nodeType !== 1 || root.closest?.("[data-no-translate], script, style, textarea")) return;
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: n => n.parentElement?.closest("[data-no-translate], script, style, textarea") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    for (let n = tw.nextNode(); n; n = tw.nextNode()) textNode(n);
    const els = [root, ...root.querySelectorAll("[title], [placeholder], [aria-label], [data-tip]")];
    for (const el of els) for (const a of ATTRS) {
      const old = el.getAttribute?.(a);
      if (!old) continue;
      const done = doneAttr.get(el);
      if (done && done[a] === old) continue;
      const v = translate(old);
      if (v !== old) { el.setAttribute(a, v); doneAttr.set(el, { ...(done || {}), [a]: v }); }
    }
  }
  const obs = new MutationObserver(list => {
    for (const m of list) {
      if (m.type === "characterData") walk(m.target);
      else if (m.type === "attributes") walk(m.target.nodeType === 1 ? m.target : null);
      else m.addedNodes.forEach(walk);
    }
  });
  function start() {
    if (lang !== "en") return;
    document.documentElement.lang = "en";
    walk(document.body);
    obs.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  // Cambio lingua: salvata anche sul server (messaggi del copilota e companion), poi si ricarica la pagina.
  async function set(l) {
    localStorage.setItem("ed_ui_lang", l);
    try {
      await fetch("/api/ui_lang", { method: "POST", headers: { "X-ED-Copilot": "1", "Content-Type": "application/json" }, body: JSON.stringify({ lang: l }) });
    } catch { /* il server riprenderà la scelta al prossimo avvio */ }
    location.reload();
  }
  // Allinea la lingua salvata nel browser con quella del server (es. dopo un backup ripristinato).
  function sync(serverLang) {
    if (serverLang && serverLang !== lang && ["it", "en"].includes(serverLang)) { localStorage.setItem("ed_ui_lang", serverLang); location.reload(); }
  }
  return { add, t: translate, start, set, sync, get lang() { return lang; } };
})();
const t = s => LANG.t(s);
document.addEventListener("DOMContentLoaded", () => LANG.start());
