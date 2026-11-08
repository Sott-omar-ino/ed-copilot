"use strict";
// Calcoli del configuratore navi (stesse formule di Coriolis/EDSY), usabile anche da Node per i test.
(function (root) {
  const STD_GROUPS = ["pp", "t", "fsd", "ls", "pd", "s", "ft"];
  const STD_SLOTS = ["PowerPlant", "MainEngines", "FrameShiftDrive", "LifeSupport", "PowerDistributor", "Radar", "FuelTank"];
  const ARMOUR = ["grade1", "grade2", "grade3", "mirrored", "reactive"];
  // ==========================================================================
  // Ingegneria. Effetti presi dal catalogo (EDCD/coriolis-data, MIT):
  //  - modifications/blueprints.json: per ogni grado "features" {attributo: [tiro peggiore, tiro migliore]};
  //  - modifications/modifierActions.json: effetto fisso di ogni sperimentale;
  //  - modifications/modifications.json: come si combina il modificatore ("multiplicative" = base x (1 + mod)).
  // Regole di combinazione come in Coriolis (EDCD/coriolis, src/app/shipyard/Module.js, getModValue/_getModifiedValue):
  // sperimentale e blueprint si moltiplicano, (1 + bp) x (1 + sp) - 1; hullboost/shieldboost: (1 + base) x (1 + mod) - 1;
  // optmul scala anche minmul/maxmul; optmass scala minmass/maxmass (scudi: maxmass solo se il mod è positivo).
  // Una build pianificata usa il tiro migliore del grado (dalla 3.3 un grado si completa al 100% prima del successivo).
  // ==========================================================================
  // Modificatori del journal (Engineering.Modifiers[].Label) -> [attributo del catalogo, fattore di unità].
  // Unità verificate confrontando OriginalValue del journal con il catalogo (es. ShieldGenStrength 90 = optmul 0.9,
  // DefenceModifierHealthMultiplier 80 = hullboost 0.8, PowerCapacity 15.6 = pgen 15.6).
  const JOURNAL_MODS = { Mass: ["mass", 1], PowerDraw: ["power", 1], PowerCapacity: ["pgen", 1],
    FSDOptimalMass: ["optmass", 1], MaxFuelPerJump: ["maxfuel", 1], EngineOptimalMass: ["optmass", 1],
    ShieldGenOptimalMass: ["optmass", 1], FuelCapacity: ["fuel", 1], CargoCapacity: ["cargo", 1],
    ShieldGenStrength: ["optmul", 0.01], EngineOptPerformance: ["optmul", 0.01],
    DefenceModifierHealthMultiplier: ["hullboost", 0.01], DefenceModifierShieldMultiplier: ["shieldboost", 0.01],
    DefenceModifierHealthAddition: ["hullreinforcement", 1], DefenceModifierShieldAddition: ["shieldaddition", 1] };
  // Vecchio formato salvato (valori assoluti del journal in entry.mods) -> attributi.
  const LEGACY_ABS = ["mass", "power", "optmass", "maxfuel", "pgen", "fuel", "cargo"];
  const RES = new Set(["kinres", "thermres", "explres", "causres"]);  // resistenze: il configuratore non le usa
  const ADDITIVE_ABS = new Set(["hullreinforcement", "shieldaddition"]);

  const method = (catalog, attr) => catalog.mod_methods?.[attr] || "multiplicative";
  // Effetti di blueprint + sperimentale al tiro migliore: {attributo: frazione} (0.55 = +55%).
  function engEffects(catalog, grp, eng) {
    if (!eng || !eng.blueprint) return null;
    const key = blueprintKey(catalog, grp, eng.blueprint);
    const grade = Math.max(1, Math.min(5, +eng.grade || 5));
    const feats = key && catalog.blueprints?.[key]?.features?.[grade];
    const fx = {};
    if (feats) for (const [a, v] of Object.entries(feats)) if (!RES.has(a)) fx[a] = v[1];
    const sk = specialKey(catalog, grp, eng.exp);
    const act = sk ? catalog.specials?.[sk]?.actions || {} : {};
    for (const [a, v] of Object.entries(act)) {
      if (RES.has(a)) continue;
      const mth = method(catalog, a);
      fx[a] = mth === "additive" ? (fx[a] || 0) + v : mth === "overwrite" ? v : (1 + (fx[a] || 0)) * (1 + v) - 1;
    }
    return Object.keys(fx).length ? fx : null;
  }
  // Valori reali del journal -> frazioni rispetto al modulo di base del catalogo (comprendono già lo sperimentale).
  function journalEffects(base, mods) {
    const fx = {};
    for (const [label, v] of Object.entries(mods || {})) {
      const map = JOURNAL_MODS[label];
      if (!map || typeof v !== "number" || !isFinite(v)) continue;
      const [attr, unit] = map, b = base[attr], val = v * unit;
      if (attr === "hullboost" || attr === "shieldboost") fx[attr] = (1 + val) / (1 + (b || 0)) - 1;
      else if (ADDITIVE_ABS.has(attr)) fx[attr] = val - (b || 0);
      else if (b) fx[attr] = val / b - 1;
    }
    return Object.keys(fx).length ? fx : null;
  }
  // Configurazioni salvate prima di questa versione: entry.mods con valori assoluti del journal (validi) e chiavi
  // "...Mul" con percentuali scritte a mano (scartate: l'effetto si ricalcola da entry.engineering).
  function legacyEffects(base, mods) {
    if (!mods) return null;
    const fx = {};
    for (const a of LEGACY_ABS) if (typeof mods[a] === "number" && base[a]) fx[a] = mods[a] / base[a] - 1;
    return Object.keys(fx).length ? fx : null;
  }
  function applyEffects(catalog, res, fx) {
    const base = { ...res };
    const isShield = ["sg", "bsg", "psg"].includes(res.grp);
    for (const [a, v] of Object.entries(fx)) {
      if (!v || typeof v !== "number") continue;
      const mth = method(catalog, a);
      if (a === "hullboost" || a === "shieldboost") res[a] = (1 + (base[a] || 0)) * (1 + v) - 1;
      else if (ADDITIVE_ABS.has(a) || mth === "additive") res[a] = (base[a] || 0) + v;
      else if (mth === "overwrite") res[a] = v;
      else if (base[a] != null) res[a] = base[a] * (1 + v);
      if (a === "optmul") for (const k of ["minmul", "maxmul", "minmulspeed", "optmulspeed", "maxmulspeed"])
        if (base[k] != null && fx[k] == null) res[k] = base[k] * (1 + v);
      if (a === "optmass") {
        if (base.minmass != null && fx.minmass == null) res.minmass = base.minmass * (1 + v);
        if (base.maxmass != null && fx.maxmass == null && (!isShield || v > 0)) res.maxmass = base.maxmass * (1 + v);
      }
    }
    return res;
  }
  // Riepilogo leggibile degli effetti principali ("Optimal mass +55%, Mass +30%").
  const FX_LABEL = { optmass: "Optimal mass", mass: "Mass", power: "Power draw", pgen: "Power capacity", optmul: "Optimal multiplier",
    maxfuel: "Max fuel per jump", hullboost: "Hull boost", shieldboost: "Shield boost", hullreinforcement: "Hull reinforcement",
    engrate: "Engines recharge", sysrate: "Systems recharge", weprate: "Weapons recharge", engcap: "Engines capacity",
    syscap: "Systems capacity", wepcap: "Weapons capacity", boot: "Boot time", eff: "Heat efficiency", integrity: "Integrity",
    range: "Range", regen: "Regen rate", brokenregen: "Broken regen rate", thermload: "Thermal load", damage: "Damage",
    rof: "Rate of fire", distdraw: "Distributor draw", cargo: "Cargo", fuel: "Fuel", angle: "Scan angle" };
  function describeEffects(catalog, fx, max = 4) {
    if (!fx) return "";
    return Object.entries(fx).filter(([a, v]) => v && FX_LABEL[a] && !ADDITIVE_ABS.has(a) && method(catalog, a) === "multiplicative")
      .sort((x, y) => Math.abs(y[1]) - Math.abs(x[1])).slice(0, max)
      .map(([a, v]) => `${FX_LABEL[a]} ${v > 0 ? "+" : "−"}${+(Math.abs(v) * 100).toFixed(1)}%`).join(", ");
  }
  // Blueprint e sperimentali applicabili a un gruppo di modulo (modifications/modules.json).
  function blueprintsFor(catalog, grp) {
    const e = catalog.engineering?.[grp];
    if (!e) return { blueprints: [], specials: [] };
    return {
      blueprints: Object.keys(e.bp).filter(k => catalog.blueprints?.[k]).map(k => ({ key: k, name: bpName(catalog, k),
        maxGrade: Math.max(...Object.keys(catalog.blueprints[k].grades).map(Number)) })),
      specials: (e.sp || []).filter(k => catalog.specials?.[k]).map(k => ({ key: k, name: catalog.specials[k].name })),
    };
  }
  const bpName = (catalog, key) => catalog.bp_labels?.[key] || catalog.blueprints?.[key]?.name || key;
  // Etichetta breve dell'ingegneria: "Increased Range G5 · Mass Manager".
  function engLabel(catalog, grp, eng) {
    if (!eng || !eng.blueprint) return "";
    const key = blueprintKey(catalog, grp, eng.blueprint);
    const name = key ? bpName(catalog, key) : String(eng.blueprint).replace(/_/g, " ");
    const sk = specialKey(catalog, grp, eng.exp);
    const exp = sk ? catalog.specials[sk].name : eng.exp || "";
    return `${name} G${Math.max(1, Math.min(5, +eng.grade || 5))}${exp ? " · " + exp : ""}`;
  }

  // Gruppi di cui si può montare un solo modulo per nave.
  const UNIQUE = { fs: 1, rf: 1, dc: 1, sua: 1, ss: 1, fi: 1, gfsb: 1, sg: "shield", bsg: "shield", psg: "shield", fh: 1, pv: 1 };
  const HP_SIZE = { Tiny: 0, Small: 1, Medium: 2, Large: 3, Huge: 4 };
  const SLOT_ALIASES = { limpetcontroller: "Limpets", fighterbay: "Fighter" };  // chiavi minuscole: si confrontano col nome dello slot in minuscolo

  function index(catalog) {
    if (catalog._idx) return catalog._idx;
    const byId = {}, bySymbol = {};
    for (const m of catalog.modules) {
      byId[m.uid] = m;
      // Coriolis elenca i pre-ingegnerizzati con lo stesso simbolo del modulo normale (e senza prezzo né effetti):
      // il simbolo del journal deve indicare il modulo normale.
      if (m.symbol && (!bySymbol[m.symbol] || bySymbol[m.symbol].pre)) bySymbol[m.symbol] = m;
    }
    return (catalog._idx = { byId, bySymbol });
  }

  function slotInfo(slot) {
    if (typeof slot === "number") return { cls: slot, eligible: null, name: null };
    return { cls: slot.class, eligible: slot.eligible || null, name: slot.name || null };
  }

  function blank(catalog, shipKey) {
    const ship = catalog.ships[shipKey], idx = index(catalog);
    const pick = sec => id => (id && idx.byId[sec + ":" + id] ? { id: sec + ":" + id } : null);
    const std = ship.defaults.standard.map((id, i) => {
      const p = pick("s")(id);
      if (p) return p;
      const cls = ship.slots.standard[i];
      const grp = STD_GROUPS[i];
      const rating = grp === "ft" ? "C" : "E";
      const m = catalog.modules.find(x => x.grp === grp && x.class === cls && x.rating === rating && x.section === "standard") ||
                catalog.modules.find(x => x.grp === grp && x.class === cls && x.rating === rating);
      return m ? { id: m.uid } : null;
    });
    return {
      ship: shipKey, bulkhead: 0,
      standard: std,
      internal: ship.defaults.internal.map(pick("i")),
      hardpoints: ship.defaults.hardpoints.map(pick("h")),
    };
  }

  // Converte un Loadout del journal (moduli grezzi + modificatori) in una configurazione.
  // `slotTable` (facoltativo): nomi degli slot di Coriolis (vedi slotNamesFor) per abbinare i moduli per nome.
  function fromLoadout(catalog, journalSymbol, raw, slotTable) {
    const symLower = String(journalSymbol || "").toLowerCase();
    const key = catalog.journal_ships[symLower] || (catalog.ships[symLower] ? symLower : null);
    if (!key) return null;
    const ship = catalog.ships[key], idx = index(catalog);
    const cfg = { ship: key, bulkhead: 0, standard: Array(7).fill(null),
      internal: ship.slots.internal.map(() => null), hardpoints: ship.slots.hardpoints.map(() => null), unknown: [] };
    const names = slotTable ? slotNamesFor(catalog, key, slotTable) : null;
    const toEntry = r => {
      const itemSym = String(r.item || r.Item || "").toLowerCase();
      const m = idx.bySymbol[itemSym];
      if (!m) { cfg.unknown.push(itemSym); return null; }
      // Modificatori reali: {Label: Value} (Flotta, app/ships.py) oppure [{Label, Value}] (Loadout incollato).
      const rawMods = r.mods || r.Engineering?.Modifiers || {};
      const mods = Array.isArray(rawMods) ? Object.fromEntries(rawMods.filter(x => x && x.Label && "Value" in x).map(x => [x.Label, x.Value])) : rawMods;
      const src = r.Engineering || r.eng || null;
      const bp = src && (src.BlueprintName || src.bp || src.blueprint);
      const entry = { id: m.uid };
      const fx = journalEffects(m, mods);
      if (fx) entry.fx = fx;
      if (bp) {
        const expKey = src.ExperimentalEffect || src.exp || "";
        entry.engineering = { blueprint: blueprintKey(catalog, m.grp, bp) || bp, grade: +(src.Level || src.lvl || src.grade || 0) || 1,
          exp: specialKey(catalog, m.grp, expKey) || expKey || "" };
      }
      // Slot del journal e ingegneria già montata: servono alla lista della spesa per saltare i gradi già fatti.
      const slotName = String(r.slot || r.Slot || "").trim();
      if (slotName) entry.slot = slotName;
      if (bp) entry.installed = { blueprint: bp, grade: +(src.Level || src.lvl || src.grade || 0),
        exp: src.ExperimentalEffect || src.exp || "" };
      return entry;
    };
    // Ingegneria della corazza: effetti reali dal journal (DefenceModifierHealthMultiplier, Mass).
    const toArmourEng = r => {
      const src = r.Engineering || r.eng || null, bp = src && (src.BlueprintName || src.bp || src.blueprint);
      if (!bp) return null;
      const rawMods = r.mods || src.Modifiers || {};
      const mods = Array.isArray(rawMods) ? Object.fromEntries(rawMods.filter(x => x && x.Label && "Value" in x).map(x => [x.Label, x.Value])) : rawMods;
      const b = ship.bulkheads[bulkheadFromItem(ship, String(r.item || r.Item || "").toLowerCase())] || {};
      const expKey = src.ExperimentalEffect || src.exp || "";
      const out = { blueprint: blueprintKey(catalog, "bh", bp) || bp, grade: +(src.Level || src.lvl || 0) || 1,
        exp: specialKey(catalog, "bh", expKey) || expKey || "", bi: bulkheadFromItem(ship, String(r.item || r.Item || "").toLowerCase()) };
      const fx = journalEffects(b, mods);
      if (fx) out.fx = fx;
      return out;
    };
    const STD_LOWER = STD_SLOTS.map(s => s.toLowerCase());
    const hps = [], opts = [], mil = [], special = [];
    for (const r of raw) {
      const s = String(r.slot || r.Slot || "").trim();
      const sLower = s.toLowerCase();
      const itemSym = String(r.item || r.Item || "").toLowerCase();
      if (sLower === "armour") {
        cfg.bulkhead = bulkheadFromItem(ship, itemSym);
        const be = toArmourEng(r);
        if (be) cfg.bulkheadEng = be;
      } else if (names && names.byName[sLower] && !cfg[names.byName[sLower][0]][names.byName[sLower][1]]) {
        const [kind, i] = names.byName[sLower];
        cfg[kind][i] = toEntry(r);
      } else if (STD_LOWER.includes(sLower)) {
        cfg.standard[STD_LOWER.indexOf(sLower)] = toEntry(r);
      } else if (/hardpoint/i.test(sLower)) {
        const m = sLower.match(/^(tiny|small|medium|large|huge)(?:mining)?hardpoint(\d+)/i);
        if (m) hps.push({ size: HP_SIZE[m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase()], n: +m[2], mining: /mining/i.test(sLower), r });
      } else if (/^slot\d+/i.test(sLower)) {
        const m = sLower.match(/^slot(\d+)/i);
        opts.push({ n: +m[1], r });
      } else if (/^military\d+/i.test(sLower)) {
        const m = sLower.match(/military(\d+)/i);
        mil.push({ n: +m[1], r });
      } else {
        special.push(r);
      }
    }
    // Armi: in Coriolis sono ordinate per taglia decrescente, nel journal per taglia e numero.
    hps.sort((a, b) => b.size - a.size || a.n - b.n);
    const used = new Set(cfg.hardpoints.map((e, j) => e ? j : -1).filter(j => j >= 0));
    for (const h of hps) {
      const fits = (sz, j, strict) => !used.has(j) && slotInfo(sz).cls === h.size && (!strict || (slotInfo(sz).name === "Mining") === h.mining);
      let i = ship.slots.hardpoints.findIndex((sz, j) => fits(sz, j, true));
      if (i < 0) i = ship.slots.hardpoints.findIndex((sz, j) => fits(sz, j, false));
      if (i >= 0) { used.add(i); cfg.hardpoints[i] = toEntry(h.r); }
    }
    // Slot con nome (PlanetaryApproachSuite, LimpetController01, Cargo, ...): stesso nome senza numero finale.
    for (const r of special) {
      const s = String(r.slot || r.Slot || "").trim();
      const base = s.replace(/\d+$/, "").toLowerCase();
      const want = (SLOT_ALIASES[base] || base).toLowerCase();
      const i = ship.slots.internal.findIndex((x, j) => !cfg.internal[j] && (slotInfo(x).name || "").toLowerCase() === want);
      if (i >= 0) cfg.internal[i] = toEntry(r);
      else cfg.unknown.push(s);
    }
    const internalIdx = ship.slots.internal.map((x, i) => ({ i, info: slotInfo(x) }));
    const plain = internalIdx.filter(x => !x.info.name && !cfg.internal[x.i]),
      military = internalIdx.filter(x => /^military/i.test(x.info.name || "") && !cfg.internal[x.i]);
    opts.sort((a, b) => a.n - b.n).forEach((o, k) => { if (plain[k]) cfg.internal[plain[k].i] = toEntry(o.r); });
    mil.sort((a, b) => a.n - b.n).forEach((o, k) => { if (military[k]) cfg.internal[military[k].i] = toEntry(o.r); });
    return cfg;
  }

  // ==========================================================================
  // Esportazione: configurazione -> evento Loadout del journal (per Coriolis / EDSY / Inara).
  // ==========================================================================
  // Corazza: le navi con 6 corazze (es. Caspian) hanno in testa quella "_grade1_default" (stessa regola di Coriolis,
  // JournalUtils.shipFromLoadoutJSON).
  function bulkheadFromItem(ship, itemSym) {
    const off = (ship.bulkheads || []).length > 5 ? 1 : 0;
    if (itemSym.endsWith("_armour_grade1_default")) return 0;
    const g = ARMOUR.findIndex(a => itemSym.endsWith("_armour_" + a));
    return g < 0 ? 0 : g + off;
  }
  function bulkheadItem(ship, journalSym, i) {
    const off = (ship.bulkheads || []).length > 5 ? 1 : 0;
    if (off && i === 0) return journalSym + "_armour_grade1_default";
    return journalSym + "_armour_" + (ARMOUR[i - off] || "grade1");
  }
  function journalSymbol(catalog, shipKey) {
    return Object.keys(catalog.journal_ships || {}).find(j => catalog.journal_ships[j] === shipKey) || shipKey;
  }
  const slotKind = name => /^military/i.test(name || "") ? "mil" : /^planetaryapproach/i.test(name || "") ? "pas"
    : !name || /^slot\d+_size/i.test(name) ? "plain" : "named";
  // Abbina gli slot del catalogo ai nomi del journal presi da ship-slots.json di Coriolis
  // ({ships: {simbolo: {internal: [[nome, classe]], hardpoints: [...]}}}). Abbinamento in ordine per classe e tipo,
  // così regge anche se una delle due liste ha uno slot in più (navi aggiornate da Frontier).
  function slotNamesFor(catalog, shipKey, table) {
    const ship = catalog.ships[shipKey], t = (table?.ships || table || {})[journalSymbol(catalog, shipKey)];
    if (!ship || !t) return null;
    const out = { internal: [], hardpoints: [], byName: {} };
    for (const kind of ["internal", "hardpoints"]) {
      const list = (t[kind] || []).filter(x => Array.isArray(x) && typeof x[0] === "string");
      const kindOf = n => kind === "internal" ? slotKind(n) : /mining/i.test(n || "") ? "mining" : "hp";
      let j = 0;
      ship.slots[kind].forEach((slot, i) => {
        const info = slotInfo(slot);
        const want = kind === "internal" ? slotKind(info.name) : info.name === "Mining" ? "mining" : "hp";
        let k = j;
        while (k < list.length && !(list[k][1] === info.cls && kindOf(list[k][0]) === want)) k++;
        if (k < list.length) { out[kind][i] = list[k][0]; out.byName[list[k][0].toLowerCase()] = [kind, i]; j = k + 1; }
        else out[kind][i] = null;
      });
    }
    return out;
  }
  // Nomi di ripiego quando la nave non è in ship-slots.json: numerazione progressiva (può non coincidere col gioco).
  function fallbackSlotNames(ship) {
    const out = { internal: [], hardpoints: [] }, count = {};
    const next = k => (count[k] = (count[k] || 0) + 1), pad = n => String(n).padStart(2, "0");
    const SIZE = ["Tiny", "Small", "Medium", "Large", "Huge"], NAMED = { Limpets: "LimpetController", Fighter: "FighterBay" };
    ship.slots.hardpoints.forEach((s, i) => {
      const info = slotInfo(s);
      out.hardpoints[i] = SIZE[info.cls] + (info.name === "Mining" ? "Mining" : "") + "Hardpoint" + next(SIZE[info.cls]);
    });
    ship.slots.internal.forEach((s, i) => {
      const info = slotInfo(s), k = slotKind(info.name);
      out.internal[i] = k === "pas" ? "PlanetaryApproachSuite" : k === "mil" ? "Military" + pad(next("mil"))
        : k === "plain" ? `Slot${pad(next("plain"))}_Size${info.cls}` : (NAMED[info.name] || info.name) + pad(next(info.name));
    });
    return out;
  }

  // Configurazione -> { loadout, approx: [slot con nome stimato], skipped: [moduli senza simbolo del journal] }.
  function toLoadout(catalog, cfg, opts = {}) {
    const ship = catalog.ships[cfg.ship];
    if (!ship) throw new Error("Nave sconosciuta");
    const idx = index(catalog), sym = journalSymbol(catalog, cfg.ship);
    const named = opts.slotTable ? slotNamesFor(catalog, cfg.ship, opts.slotTable) : null;
    const fb = fallbackSlotNames(ship), approx = [], skipped = [], modules = [];
    const r = compute(catalog, cfg);
    const armour = { Slot: "Armour", Item: bulkheadItem(ship, sym, cfg.bulkhead || 0), On: true, Priority: 1, Health: 1,
      Value: Math.round(r.bulk?.cost || 0) };
    const be = bulkheadEng(cfg);
    if (be) {
      const bp = blueprintKey(catalog, "bh", be.blueprint), sp = specialKey(catalog, "bh", be.exp);
      if (bp) {
        armour.Engineering = { BlueprintName: bp, Level: Math.max(1, Math.min(5, +be.grade || 5)), Quality: 1 };
        if (sp) Object.assign(armour.Engineering, { ExperimentalEffect: sp, ExperimentalEffect_Localised: catalog.specials[sp].name });
      }
    }
    modules.push(armour);
    const add = (slot, entry) => {
      const m = idx.byId[entry.id];
      if (!m || !m.symbol) { skipped.push(m?.name || entry.id); return; }
      const out = { Slot: slot, Item: m.symbol, On: true, Priority: 0, Health: 1, Value: Math.round(m.cost || 0) };
      // Ingegneria pianificata, altrimenti quella già montata sul modulo della nave vera.
      const eng = entry.engineering?.blueprint ? entry.engineering : entry.installed;
      if (eng && eng.blueprint) {
        const bp = blueprintKey(catalog, m.grp, eng.blueprint) || BP_ALIASES[String(eng.blueprint).toLowerCase()] || String(eng.blueprint);
        const sp = specialKey(catalog, m.grp, eng.exp);
        // Build pianificata: non ci sono i valori reali dei modificatori. Quality 1 = tiro migliore del grado
        // (Coriolis la usa per calcolare i valori quando mancano i Modifiers).
        out.Engineering = { BlueprintName: bp, Level: Math.max(1, Math.min(5, +eng.grade || 5)), Quality: 1 };
        if (sp) Object.assign(out.Engineering, { ExperimentalEffect: sp, ExperimentalEffect_Localised: catalog.specials[sp].name });
      }
      modules.push(out);
    };
    cfg.standard.forEach((e, i) => e && add(STD_SLOTS[i], e));
    for (const kind of ["hardpoints", "internal"]) {
      cfg[kind].forEach((e, i) => {
        if (!e) return;
        let slot = named?.[kind][i] || null;
        // Un modulo importato dal gioco ricorda il suo slot: si tiene quello, se non appartiene a un altro slot.
        const own = e.slot && named?.byName[e.slot.toLowerCase()];
        if (e.slot && /^[A-Za-z0-9_]+$/.test(e.slot) && (!own || own[1] === i)) slot = e.slot;
        if (!slot) { slot = fb[kind][i]; approx.push(slot); }
        add(slot, e);
      });
    }
    const hullCost = ship.hullCost || 0;
    const loadout = { event: "Loadout", Ship: sym, ShipName: String(opts.name || "").slice(0, 22), ShipIdent: "",
      HullValue: Math.round(hullCost), ModulesValue: Math.round(Math.max(0, r.cost - hullCost)), HullHealth: 1,
      UnladenMass: +r.unladen.toFixed(3), CargoCapacity: r.cargoCap, MaxJumpRange: +r.jump.max.toFixed(3),
      FuelCapacity: { Main: r.fuelCap, Reserve: ship.reserveFuel || 0 }, Rebuy: Math.round(r.rebuy), Modules: modules };
    return { loadout, approx, skipped };
  }

  // ==========================================================================
  // Codice di condivisione ED Copilot: la configurazione completa (anche le ingegnerie stimate), senza perdite.
  // Formato: "EDC1." + base64 URL-safe del JSON UTF-8.
  // ==========================================================================
  const CODE_PREFIX = "EDC1.";
  const FX_KEY = /^[a-z]{2,24}$/;
  const b64url = {
    enc: str => {
      let s = "";
      for (const x of new TextEncoder().encode(str)) s += String.fromCharCode(x);
      return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    },
    dec: str => {
      const s = atob(str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4));
      return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(s, c => c.charCodeAt(0)));
    },
  };
  function encodeCode(cfg, name) {
    const pack = e => e ? { i: e.id, ...(e.fx ? { f: e.fx } : {}), ...(!e.fx && e.mods ? { m: e.mods } : {}),
      ...(e.engineering ? { e: e.engineering } : {}),
      ...(e.slot ? { s: e.slot } : {}), ...(e.installed ? { x: e.installed } : {}) } : 0;
    const be = bulkheadEng(cfg);
    return CODE_PREFIX + b64url.enc(JSON.stringify({ v: 1, n: name || "", s: cfg.ship, b: cfg.bulkhead || 0,
      ...(be ? { be: { blueprint: be.blueprint, grade: be.grade, exp: be.exp || "", ...(be.fx ? { f: be.fx } : {}) } } : {}),
      std: cfg.standard.map(pack), int: cfg.internal.map(pack), hp: cfg.hardpoints.map(pack) }));
  }
  // Ricostruisce la configurazione da zero con i soli campi ammessi; ogni modulo deve essere montabile nel suo slot.
  function cleanFx(f) {
    if (!f || typeof f !== "object" || Array.isArray(f)) return null;
    const out = {};
    for (const [k, v] of Object.entries(f)) if (FX_KEY.test(k) && typeof v === "number" && isFinite(v) && Math.abs(v) < 100) out[k] = v;
    return Object.keys(out).length ? out : null;
  }
  function decodeCode(catalog, code) {
    code = String(code || "").replace(/\s+/g, "");
    if (!code.startsWith(CODE_PREFIX)) throw new Error("Non è un codice ED Copilot");
    if (code.length > 60000) throw new Error("Codice troppo lungo");
    let o;
    try { o = JSON.parse(b64url.dec(code.slice(CODE_PREFIX.length))); } catch { throw new Error("Codice ED Copilot danneggiato"); }
    if (!o || o.v !== 1 || typeof o.s !== "string" || !Object.prototype.hasOwnProperty.call(catalog.ships, o.s))
      throw new Error("Nave del codice non trovata nel catalogo");
    const ship = catalog.ships[o.s];
    const str = (v, n, re) => typeof v === "string" && v.length <= n && (!re || re.test(v)) ? v : undefined;
    const eng = x => x && typeof x === "object" && str(x.blueprint, 64, /^[A-Za-z0-9_ ]+$/) ? { blueprint: x.blueprint,
      grade: Math.max(1, Math.min(5, Math.round(+x.grade) || 5)), ...(str(x.exp, 64) ? { exp: x.exp } : {}),
      ...(str(x.label, 96) ? { label: x.label } : {}) } : null;
    const cfg = { ship: o.s, bulkhead: Number.isInteger(o.b) && o.b >= 0 && o.b < ship.bulkheads.length ? o.b : 0,
      standard: Array(7).fill(null), internal: ship.slots.internal.map(() => null), hardpoints: ship.slots.hardpoints.map(() => null), unknown: [] };
    for (const [k, kind] of [["std", "standard"], ["int", "internal"], ["hp", "hardpoints"]]) {
      const list = Array.isArray(o[k]) ? o[k] : [];
      cfg[kind].forEach((_, i) => {
        const p = list[i];
        if (!p || typeof p !== "object" || typeof p.i !== "string") return;
        // Il modulo deve esistere ed essere del tipo e della taglia giusti per lo slot (non si usa compatible():
        // le navi vere montano anche moduli che il menu del configuratore non propone, es. limpet multiruolo).
        const m = Object.prototype.hasOwnProperty.call(index(catalog).byId, p.i) ? index(catalog).byId[p.i] : null;
        const size = kind === "standard" ? ship.slots.standard[i] : slotInfo(ship.slots[kind][i]).cls;
        const okKind = m && (kind === "standard" ? m.grp === STD_GROUPS[i] : m.section === kind);
        if (!okKind || (m.class || 0) > size || (kind === "hardpoints" && (size === 0) !== ((m.class || 0) === 0))) { cfg.unknown.push(p.i.slice(0, 40)); return; }
        const e = { id: p.i };
        const fx = cleanFx(p.f);
        if (fx) e.fx = fx;
        // Codici della versione precedente: valori assoluti del journal (le chiavi "...Mul" stimate si scartano).
        else if (p.m && typeof p.m === "object") {
          const m0 = index(catalog).byId[p.i], lf = legacyEffects(m0, p.m);
          if (lf) e.fx = lf;
        }
        const en = eng(p.e), inst = eng(p.x);
        if (en) e.engineering = en;
        if (inst) e.installed = { blueprint: inst.blueprint, grade: inst.grade, exp: inst.exp || "" };
        if (str(p.s, 40, /^[A-Za-z0-9_]+$/)) e.slot = p.s;
        cfg[kind][i] = e;
      });
    }
    const be = eng(o.be);
    if (be) {
      cfg.bulkheadEng = { blueprint: be.blueprint, grade: be.grade, exp: be.exp || "", bi: cfg.bulkhead };
      const bfx = cleanFx(o.be.f);
      if (bfx) cfg.bulkheadEng.fx = bfx;
    }
    return { cfg, name: str(o.n, 60) || "" };
  }

  // Effetti dell'ingegneria su un modulo: valori reali del journal (fx) se ci sono, altrimenti il blueprint pianificato.
  function entryEffects(catalog, m, entry) {
    if (!entry) return null;
    return entry.fx || legacyEffects(m, entry.mods) || (entry.engineering ? engEffects(catalog, m.grp, entry.engineering) : null);
  }
  function resolve(catalog, entry) {
    if (!entry) return null;
    const m = index(catalog).byId[entry.id];
    if (!m) return null;
    const res = { ...m };
    const fx = entryEffects(catalog, m, entry);
    if (fx) { applyEffects(catalog, res, fx); res.fx = fx; res.engineered = true; }
    if (entry.engineering) { res.engineering = entry.engineering; res.engineered = true; }
    return res;
  }
  // Ingegneria della corazza (cfg.bulkheadEng), valida solo per la corazza per cui è stata impostata.
  function bulkheadEng(cfg) {
    const be = cfg.bulkheadEng;
    return be && be.blueprint && (be.bi == null || be.bi === (cfg.bulkhead || 0)) ? be : null;
  }
  function resolveBulkhead(catalog, cfg) {
    const ship = catalog.ships[cfg.ship], b = ship.bulkheads[cfg.bulkhead] || ship.bulkheads[0];
    if (!b) return null;
    const res = { ...b, grp: "bh" }, be = bulkheadEng(cfg);
    const fx = be && (be.fx || engEffects(catalog, "bh", be));
    if (fx) { applyEffects(catalog, res, fx); res.fx = fx; res.engineering = be; res.engineered = true; }
    return res;
  }

  function massCurve(mass, minMass, optMass, maxMass, minMul, optMul, maxMul) {
    const xnorm = Math.min(1, (maxMass - mass) / (maxMass - minMass));
    const exponent = Math.log((optMul - minMul) / (maxMul - minMul)) / Math.log(Math.min(1, (maxMass - optMass) / (maxMass - minMass)));
    return minMul + Math.pow(Math.max(0, xnorm), exponent) * (maxMul - minMul);
  }

  // Elenco dei moduli montabili in uno slot.
  function compatible(catalog, cfg, kind, i) {
    const ship = catalog.ships[cfg.ship], shipName = ship.name;
    // Esclude i segnaposto "Unrecognised" del catalogo e i moduli riservati ad altre navi.
    // Esclude anche i pre-ingegnerizzati: nel catalogo hanno le statistiche del modulo normale e nessun prezzo, quindi
    // non sono affidabili (restano riconosciuti se importati dal gioco).
    const okShip = m => !m.pre && !/^Unrecognised/.test(m.name || "") && (!m.ship || (Array.isArray(m.ship) ? m.ship.includes(shipName) : m.ship === shipName));
    if (kind === "standard") {
      const cls = ship.slots.standard[i], grp = STD_GROUPS[i];
      return catalog.modules.filter(m => m.grp === grp && m.class <= cls && okShip(m));
    }
    if (kind === "hardpoints") {
      const info = slotInfo(ship.slots.hardpoints[i]), size = info.cls;
      return catalog.modules.filter(m => m.section === "hardpoints" && (size === 0 ? m.class === 0 : m.class > 0 && m.class <= size)
        && okShip(m) && m.grp !== "mh" && (!info.eligible || info.eligible[m.grp]));
    }
    const info = slotInfo(ship.slots.internal[i]);
    return catalog.modules.filter(m => m.section === "internal" && m.class <= info.cls && okShip(m) && m.grp !== "mm"
      && (info.eligible ? info.eligible[m.grp] : m.grp !== "pas") && !(m.restriction && !info.eligible?.[m.grp] && m.restriction !== "none"));
  }

  function compute(catalog, cfg) {
    const ship = catalog.ships[cfg.ship];
    const std = cfg.standard.map(e => resolve(catalog, e));
    const internal = cfg.internal.map(e => resolve(catalog, e));
    const hard = cfg.hardpoints.map(e => resolve(catalog, e));
    const all = [...std, ...internal, ...hard].filter(Boolean);
    const bulk = resolveBulkhead(catalog, cfg);
    const [pp, thr, fsd, , pd, , ft] = std;

    const unladen = ship.hullMass + (bulk?.mass || 0) + all.reduce((a, m) => a + (m.mass || 0), 0);
    const fuelCap = (ft?.fuel || 0) + internal.filter(m => m?.grp === "ft").reduce((a, m) => a + (m.fuel || 0), 0);
    const cargoCap = internal.filter(m => m && (m.grp === "cr" || m.grp === "crl")).reduce((a, m) => a + (m.cargo || 0), 0);
    const pgen = pp?.pgen || 0;
    const draw = all.filter(m => m.grp !== "pp").reduce((a, m) => a + (m.power || 0), 0);
    // Con gli hardpoint ritratti le armi (classe > 0) non assorbono energia; le utility sì.
    const drawRetracted = draw - hard.filter(m => m && m.class > 0).reduce((a, m) => a + (m.power || 0), 0);
    const boost = internal.reduce((a, m) => a + (m?.jumpboost || 0), 0);
    const passengers = internal.reduce((a, m) => a + (m?.passengers || 0), 0);

    // Portata di salto (EDCD/coriolis, src/app/shipyard/Calculations.js, jumpRange; stessa formula di EDSY):
    // (carburante / fuelmul)^(1 / fuelpower) × optmass / massa + jumpboost del Guardian FSD Booster,
    // con carburante ≤ maxfuel. Coriolis aggiunge alla massa anche il serbatoio di riserva; il gioco no: senza riserva il
    // risultato coincide con il MaxJumpRange che il gioco scrive nell'evento Loadout (verificato su build reali).
    const reserve = ship.reserveFuel || 0;
    const range = (mass, fuel) => fsd ? Math.pow(fuel / fsd.fuelmul, 1 / fsd.fuelpower) * fsd.optmass / mass + boost : 0;
    const jumpFuel = fsd ? Math.min(fsd.maxfuel, fuelCap) : 0;
    const jump = {
      max: range(unladen + jumpFuel, jumpFuel),
      full: range(unladen + fuelCap, jumpFuel),
      laden: range(unladen + fuelCap + cargoCap, jumpFuel),
    };
    // Autonomia con il serbatoio pieno e senza carico, salti uno dopo l'altro (Calculations.js, totalJumpRange).
    let fuelLeft = fuelCap, total = 0, jumps = 0;
    while (fsd && fuelLeft > 0.0001 && jumps < 500) {
      const f = Math.min(jumpFuel, fuelLeft);
      total += range(unladen + fuelLeft, f);
      fuelLeft -= f;
      jumps++;
    }

    // Velocità: curva di massa dei Thrusters (Calculations.js, speed/calcSpeed), con 4 pip ai motori.
    let speed = null, boostSpeed = null;
    if (thr && thr.minmass != null) {
      const mul = massCurve(unladen + fuelCap + reserve, thr.minmass, thr.optmass, thr.maxmass,
        thr.minmulspeed ?? thr.minmul, thr.optmulspeed ?? thr.optmul, thr.maxmulspeed ?? thr.maxmul);
      speed = ship.speed * mul;
      boostSpeed = ship.boost * mul;
    }
    // Scudi: curva di massa del generatore sulla massa dello scafo × (1 + somma degli shieldboost) + Guardian Shield
    // Reinforcement (Calculations.js, shieldStrength/shieldMetrics).
    const sg = internal.find(m => m && ["sg", "bsg", "psg"].includes(m.grp));
    let shield = 0;
    if (sg && sg.minmass != null) {
      const mul = massCurve(ship.hullMass, sg.minmass, sg.optmass, sg.maxmass, sg.minmul, sg.optmul, sg.maxmul);
      const boosters = hard.filter(m => m?.grp === "sb").reduce((a, m) => a + (m.shieldboost || 0), 0);
      shield = ship.baseShield * mul * (1 + boosters) + internal.reduce((a, m) => a + (m?.grp === "gsrp" ? m.shieldaddition || 0 : 0), 0);
    }
    // Scafo: baseArmour × (1 + hullboost della corazza) + Hull Reinforcement (Calculations.js, armourMetrics).
    const armour = ship.baseArmour * (1 + (bulk?.hullboost || 0)) +
      internal.reduce((a, m) => a + (m && ["hr", "ghrp", "mahr"].includes(m.grp) ? m.hullreinforcement || 0 : 0), 0);
    // Prezzi di listino del catalogo (le stazioni possono applicare sconti). cost null = prezzo sconosciuto.
    const cost = (ship.hullCost || 0) + (bulk?.cost || 0) + all.reduce((a, m) => a + (m.cost || 0), 0);
    const unknownCost = all.filter(m => m.cost == null).length;

    const warnings = [];
    if (pgen && draw > pgen) warnings.push({ kind: "power", text: `Energia insufficiente: ${draw.toFixed(2)} MW richiesti su ${pgen.toFixed(2)} MW` });
    const seen = {};
    for (const m of internal.filter(Boolean)) {
      const u = UNIQUE[m.grp];
      if (!u) continue;
      const key = u === 1 ? m.grp : u;
      if (seen[key]) warnings.push({ kind: "dup", grp: m.grp, text: `Puoi montare un solo modulo di questo tipo (${m.name || m.grp})` });
      seen[key] = true;
    }
    if (!fsd) warnings.push({ kind: "fsd", text: "Manca il motore FSD" });
    if (thr && thr.maxmass && unladen + fuelCap > thr.maxmass) warnings.push({ kind: "thr", text: "Nave troppo pesante per questi propulsori" });

    // Riscatto: 5% del valore della nave (assicurazione standard).
    return { ship, std, internal, hard, bulk, unladen, fuelCap, cargoCap, pgen, draw, drawRetracted, boost, passengers, jump,
      totalRange: total, totalJumps: jumps, speed, boostSpeed, shield, armour, cost, unknownCost, rebuy: cost * 0.05, warnings,
      fsd: fsd ? { optimal_mass: fsd.optmass, max_fuel_per_jump: fsd.maxfuel, fuel_multiplier: fsd.fuelmul, fuel_power: fsd.fuelpower,
        base_mass: unladen, tank_size: fuelCap, internal_tank_size: reserve, range_boost: boost } : null };
  }

  // ==========================================================================
  // Lista della spesa: materiali per ingegnerizzare l'allestimento (ricette da coriolis-data).
  // ==========================================================================
  // Tiri per grado (indice 0 = G1). Dalla 3.3 ogni grado si completa con più applicazioni; quante dipende dalla
  // reputazione con l'ingegnere e dalla fortuna, e Frontier non pubblica un numero fisso. "Minimo" = 1 tiro per grado
  // (come i planner della community); "Stima" e "Prudente" sono STIME per avere margine, non dati ufficiali.
  const ROLL_PRESETS = {
    min: { label: "Minimo · 1 tiro per grado", rolls: [1, 1, 1, 1, 1] },
    typ: { label: "Stima · G1 1, G2 2, G3 3, G4 4, G5 5", rolls: [1, 2, 3, 4, 5] },
    safe: { label: "Prudente · G1 1, G2 3, G3 4, G4 5, G5 6", rolls: [1, 3, 4, 5, 6] },
  };
  const DEFAULT_ROLLS = "typ";
  // Famiglie del Material Trader (stessa colonna = stessa famiglia), dal grado più basso al più alto: come nella
  // schermata del Material Trader in gioco (gradi da EDCD/FDevIDs e coriolis-data).
  const MATERIAL_FAMILIES = {
    Raw: [
      ["carbon", "vanadium", "niobium", "yttrium"], ["phosphorus", "chromium", "molybdenum", "technetium"],
      ["sulphur", "manganese", "cadmium", "ruthenium"], ["iron", "zinc", "tin", "selenium"],
      ["nickel", "germanium", "tungsten", "tellurium"], ["rhenium", "arsenic", "mercury", "polonium"],
      ["lead", "zirconium", "boron", "antimony"],
    ],
    Manufactured: [
      ["chemicalstorageunits", "chemicalprocessors", "chemicaldistillery", "chemicalmanipulators", "pharmaceuticalisolators"],
      ["temperedalloys", "heatresistantceramics", "precipitatedalloys", "thermicalloys", "militarygradealloys"],
      ["heatconductionwiring", "heatdispersionplate", "heatexchangers", "heatvanes", "protoheatradiators"],
      ["basicconductors", "conductivecomponents", "conductiveceramics", "conductivepolymers", "biotechconductors"],
      ["mechanicalscrap", "mechanicalequipment", "mechanicalcomponents", "configurablecomponents", "improvisedcomponents"],
      ["gridresistors", "hybridcapacitors", "electrochemicalarrays", "polymercapacitors", "militarysupercapacitors"],
      ["wornshieldemitters", "shieldemitters", "shieldingsensors", "compoundshielding", "imperialshielding"],
      ["compactcomposites", "filamentcomposites", "highdensitycomposites", "fedproprietarycomposites", "fedcorecomposites"],
      ["crystalshards", "uncutfocuscrystals", "focuscrystals", "refinedfocuscrystals", "exquisitefocuscrystals"],
      ["salvagedalloys", "galvanisingalloys", "phasealloys", "protolightalloys", "protoradiolicalloys"],
    ],
    Encoded: [
      ["scrambledemissiondata", "archivedemissiondata", "emissiondata", "decodedemissiondata", "compactemissionsdata"],
      ["disruptedwakeechoes", "fsdtelemetry", "wakesolutions", "hyperspacetrajectories", "dataminedwake"],
      ["shieldcyclerecordings", "shieldsoakanalysis", "shielddensityreports", "shieldpatternanalysis", "shieldfrequencydata"],
      ["encryptedfiles", "encryptioncodes", "symmetrickeys", "encryptionarchives", "adaptiveencryptors"],
      ["bulkscandata", "scanarchives", "scandatabanks", "encodedscandata", "classifiedscandata"],
      ["legacyfirmware", "consumerfirmware", "industrialfirmware", "securityfirmware", "embeddedfirmware"],
    ],
  };
  const FAMILY_OF = {};
  for (const [cat, fams] of Object.entries(MATERIAL_FAMILIES))
    fams.forEach((f, fi) => f.forEach((sym, gi) => { FAMILY_OF[sym] = { cat, fam: fi, grade: gi + 1 }; }));
  // Id del configuratore -> blueprint Coriolis/journal.
  const BP_ALIASES = { fsd_longrange: "FSD_LongRange", fsd_fastboot: "FSD_FastBoot", engine_dirty: "Engine_Dirty",
    engine_clean: "Engine_Tuned", powerplant_boosted: "PowerPlant_Boosted", powerplant_armoured: "PowerPlant_Armoured",
    powerdistributor_highfrequency: "PowerDistributor_HighFrequency", sensor_longrange: "Sensor_LongRange",
    shieldgen_reinforced: "ShieldGenerator_Reinforced", shieldgen_thermal: "ShieldGenerator_Thermic", armour_heavy: "Armour_HeavyDuty" };

  // Blueprint applicabile al gruppo di modulo `grp` partendo da id del configuratore, nome del journal
  // (FSD_LongRange) o nome leggibile (Increased Range, anche nella forma di gamedata.BLUEPRINTS).
  function blueprintKey(catalog, grp, bp) {
    const eng = catalog.engineering?.[grp];
    if (!eng || !bp) return null;
    const keys = Object.keys(eng.bp), raw = String(bp), low = raw.toLowerCase();
    const alias = BP_ALIASES[low];
    let k = keys.find(x => x.toLowerCase() === low) || (alias && keys.find(x => x === alias));
    if (k) return k;
    const tail = low.includes("_") ? low.slice(low.indexOf("_") + 1) : null;
    if (tail) k = keys.find(x => x.toLowerCase().endsWith("_" + tail));
    if (k) return k;
    const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const n = norm(raw), labels = catalog.bp_labels || {};
    const label = x => labels[x] || x.slice(x.indexOf("_") + 1).replace(/(?!^)(?=[A-Z])/g, " ");
    return keys.find(x => norm(label(x)) === n || norm(catalog.blueprints?.[x]?.name) === n) || null;
  }

  function specialKey(catalog, grp, exp) {
    if (!exp) return null;
    const low = String(exp).toLowerCase().trim(), sp = catalog.specials || {};
    const own = catalog.engineering?.[grp]?.sp || [];
    const match = k => k.toLowerCase() === low || String(sp[k]?.name || "").toLowerCase() === low;
    return own.find(match) || Object.keys(sp).find(match) || null;
  }

  // Ingegneri che applicano il blueprint al grado richiesto: [{name, maxGrade}].
  function blueprintEngineers(catalog, grp, key, grade) {
    const map = catalog.engineering?.[grp]?.bp?.[key] || {};
    return Object.entries(map).filter(([, g]) => g >= grade).map(([name, maxGrade]) => ({ name, maxGrade }))
      .sort((a, b) => b.maxGrade - a.maxGrade || a.name.localeCompare(b.name));
  }

  // Cosa serve per ogni modulo ingegnerizzato. `opts.installedFor(kind, i, entry)` può restituire l'ingegneria già
  // presente sulla nave vera ({blueprint, grade, exp}) quando la configurazione non la porta con sé.
  function engineeringJobs(catalog, cfg, opts = {}) {
    const rolls = opts.rolls || ROLL_PRESETS[DEFAULT_ROLLS].rolls;
    const jobs = [], skipped = [];
    for (const kind of ["standard", "internal", "hardpoints"]) {
      (cfg[kind] || []).forEach((entry, i) => {
        const eng = entry?.engineering;
        if (!eng || !eng.blueprint) return;
        const m = index(catalog).byId[entry.id];
        if (!m) return;
        const key = blueprintKey(catalog, m.grp, eng.blueprint);
        if (!key || !catalog.blueprints?.[key]) { skipped.push({ kind, i, module: m, blueprint: eng.blueprint }); return; }
        const target = Math.max(1, Math.min(5, +eng.grade || 5));
        const inst = entry.installed || (opts.installedFor && opts.installedFor(kind, i, entry)) || null;
        const instKey = inst ? blueprintKey(catalog, m.grp, inst.blueprint) : null;
        const from = instKey === key ? Math.max(0, +inst.grade || 0) : 0;
        const expKey = specialKey(catalog, m.grp, eng.exp);
        const instExp = inst && instKey === key ? specialKey(catalog, m.grp, inst.exp) : null;
        const grades = [];
        for (let g = from + 1; g <= target; g++)
          grades.push({ grade: g, rolls: rolls[g - 1] || 1, components: catalog.blueprints[key].grades[g] || {} });
        const exp = expKey && expKey !== instExp
          ? { key: expKey, name: catalog.specials[expKey].name, components: catalog.specials[expKey].components } : null;
        jobs.push({ kind, i, module: m, key, name: catalog.bp_labels?.[key] || catalog.blueprints[key].name,
          target, from, grades, exp, expAlready: !!(expKey && expKey === instExp),
          engineers: blueprintEngineers(catalog, m.grp, key, target) });
      });
    }
    return { jobs, skipped };
  }

  // Lista aggregata confrontata con l'inventario ({simbolo journal: quantità}).
  function shoppingList(catalog, cfg, inventory = {}, opts = {}) {
    const { jobs, skipped } = engineeringJobs(catalog, cfg, opts);
    const mats = catalog.materials || {}, need = {};
    const add = (name, n, job) => {
      const info = mats[name] || [String(name).toLowerCase().replace(/[^a-z0-9]/g, ""), null, null];
      const row = need[info[0]] ||= { symbol: info[0], name, category: info[1], grade: info[2], needed: 0, uses: new Set() };
      row.needed += n;
      row.uses.add(job);
    };
    for (const j of jobs) {
      for (const g of j.grades) for (const [name, n] of Object.entries(g.components)) add(name, n * g.rolls, j);
      if (j.exp) for (const [name, n] of Object.entries(j.exp.components)) add(name, n, j);
    }
    const rows = Object.values(need).map(r => {
      const owned = inventory[r.symbol] || 0;
      return { ...r, uses: [...r.uses], owned, missing: Math.max(0, r.needed - owned) };
    });
    // Material Trader: si usa solo il surplus (posseduto meno richiesto) della stessa categoria.
    // Tassi del trader in gioco (Elite Dangerous wiki, "Material Trader"): salire di un grado costa 6:1, scendere rende
    // 1:3; scambiare con un'altra famiglia della stessa categoria costa 6 volte tanto.
    const surplus = {};
    for (const [sym, n] of Object.entries(inventory))
      if (FAMILY_OF[sym]) surplus[sym] = Math.max(0, n - (need[sym]?.needed || 0));
    const cost = (src, dst) => {
      const a = FAMILY_OF[src], b = FAMILY_OF[dst];
      if (!a || !b || a.cat !== b.cat || src === dst) return null;
      const step = a.grade < b.grade ? Math.pow(6, b.grade - a.grade) : 1 / Math.pow(3, a.grade - b.grade);
      return step * (a.fam === b.fam ? 1 : 6);
    };
    // Prima i gradi alti (più difficili da trovare), così si prenotano le sorgenti migliori.
    for (const r of rows.filter(x => x.missing > 0).sort((a, b) => (b.grade || 0) - (a.grade || 0))) {
      let left = r.missing;
      const from = [];
      const sources = Object.keys(surplus).map(sym => ({ sym, c: cost(sym, r.symbol) }))
        .filter(x => x.c != null && surplus[x.sym] > 0).sort((a, b) => a.c - b.c);
      for (const s of sources) {
        if (left <= 0) break;
        const get = Math.min(left, Math.floor(surplus[s.sym] / s.c + 1e-9));
        if (get <= 0) continue;
        const spend = Math.ceil(get * s.c - 1e-9);
        surplus[s.sym] -= spend;
        left -= get;
        from.push({ symbol: s.sym, spend, get, sameFamily: FAMILY_OF[s.sym].fam === FAMILY_OF[r.symbol]?.fam });
      }
      r.trade = { covered: r.missing - left, from };
    }
    rows.sort((a, b) => (b.missing > 0) - (a.missing > 0) || (a.category || "").localeCompare(b.category || "")
      || (b.grade || 0) - (a.grade || 0) || a.name.localeCompare(b.name));
    const totals = rows.reduce((t, r) => ({ needed: t.needed + r.needed, missing: t.missing + r.missing,
      tradeable: t.tradeable + (r.trade?.covered || 0) }), { needed: 0, missing: 0, tradeable: 0 });
    return { jobs, skipped, rows, totals };
  }

  const api = { STD_GROUPS, STD_SLOTS, index, blank, fromLoadout, resolve, resolveBulkhead, bulkheadEng, compute, compatible, slotInfo,
    engEffects, entryEffects, describeEffects, blueprintsFor, engLabel, bpName,
    ROLL_PRESETS, DEFAULT_ROLLS, MATERIAL_FAMILIES, blueprintKey, specialKey, blueprintEngineers, engineeringJobs, shoppingList,
    slotNamesFor, toLoadout, journalSymbol, encodeCode, decodeCode };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ShipCalc = api;
})(typeof window !== "undefined" ? window : globalThis);
