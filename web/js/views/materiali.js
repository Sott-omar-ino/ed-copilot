"use strict";

// ============================================================================
// MATERIALI
// ============================================================================

// Progetti per "Sblocchi e progetti". Fonti (verificate nov 2026):
// - Tech Broker: EDEngineer (github.com/msarilar/EDEngineer, Resources/Data/blueprints.json); FSD Booster, Hybrid
//   Power Plant, Shield/Hull Reinforcement e Corrosion Resistant Cargo Rack confrontati con elite-dangerous.fandom.com.
//   Portata del FSD Booster: elite-dangerous.fandom.com/wiki/Guardian_Frame_Shift_Drive_Booster.
// - Ingegneri: EDCD/coriolis-data modifications/blueprints.json (materiali per grado), modules.json (ingegneri
//   che arrivano al G5), specials.json (materiali degli effetti sperimentali).
// Categorie dei materiali: EDCD/FDevIDs material.csv; tutto il resto è merce (Commodity).
const BLUEPRINTS = [
  {
    "id": "g_fsd_booster",
    "name": "Guardian FSD Booster",
    "cat": "Tech Broker Guardian",
    "engineer": "Technology Broker Guardian",
    "desc": "Aggiunge portata fissa al salto: +4,00 / 6,00 / 7,75 / 9,25 / 10,50 al (classi 1-5).",
    "items": [
      {
        "name": "Guardian Module Blueprint Fragment",
        "cat": "Encoded",
        "count": 1
      },
      {
        "name": "Guardian Power Cell",
        "cat": "Manufactured",
        "count": 21
      },
      {
        "name": "Guardian Technology Component",
        "cat": "Manufactured",
        "count": 21
      },
      {
        "name": "Focus Crystals",
        "cat": "Manufactured",
        "count": 24
      },
      {
        "name": "HN Shock Mount",
        "cat": "Commodity",
        "count": 8
      }
    ]
  },
  {
    "id": "g_shield_reinf",
    "name": "Guardian Shield Reinforcement Package",
    "cat": "Tech Broker Guardian",
    "engineer": "Technology Broker Guardian",
    "desc": "Aggiunge MJ fissi allo scudo, indipendenti dal Shield Generator.",
    "items": [
      {
        "name": "Guardian Module Blueprint Fragment",
        "cat": "Encoded",
        "count": 1
      },
      {
        "name": "Guardian Power Cell",
        "cat": "Manufactured",
        "count": 17
      },
      {
        "name": "Guardian Technology Component",
        "cat": "Manufactured",
        "count": 20
      },
      {
        "name": "Pattern Delta Obelisk Data",
        "cat": "Encoded",
        "count": 24
      },
      {
        "name": "Hardware Diagnostic Sensor",
        "cat": "Commodity",
        "count": 8
      }
    ]
  },
  {
    "id": "g_hull_reinforce",
    "name": "Guardian Hull Reinforcement Package",
    "cat": "Tech Broker Guardian",
    "engineer": "Technology Broker Guardian",
    "desc": "Rinforzo scafo con resistenza ai danni caustici (Thargoid).",
    "items": [
      {
        "name": "Guardian Module Blueprint Fragment",
        "cat": "Encoded",
        "count": 1
      },
      {
        "name": "Guardian Wreckage Components",
        "cat": "Manufactured",
        "count": 21
      },
      {
        "name": "Pattern Beta Obelisk Data",
        "cat": "Encoded",
        "count": 16
      },
      {
        "name": "Pattern Gamma Obelisk Data",
        "cat": "Encoded",
        "count": 16
      },
      {
        "name": "Reinforced Mounting Plate",
        "cat": "Commodity",
        "count": 12
      }
    ]
  },
  {
    "id": "g_module_reinforce",
    "name": "Guardian Module Reinforcement Package",
    "cat": "Tech Broker Guardian",
    "engineer": "Technology Broker Guardian",
    "desc": "Protegge i moduli interni dai danni.",
    "items": [
      {
        "name": "Guardian Module Blueprint Fragment",
        "cat": "Encoded",
        "count": 1
      },
      {
        "name": "Guardian Wreckage Components",
        "cat": "Manufactured",
        "count": 18
      },
      {
        "name": "Pattern Epsilon Obelisk Data",
        "cat": "Encoded",
        "count": 15
      },
      {
        "name": "Guardian Power Conduit",
        "cat": "Manufactured",
        "count": 20
      },
      {
        "name": "Reinforced Mounting Plate",
        "cat": "Commodity",
        "count": 9
      }
    ]
  },
  {
    "id": "g_hybrid_powerplant",
    "name": "Guardian Hybrid Power Plant",
    "cat": "Tech Broker Guardian",
    "engineer": "Technology Broker Guardian",
    "desc": "Power Plant Guardian di classe A (classi 2-8).",
    "items": [
      {
        "name": "Guardian Module Blueprint Fragment",
        "cat": "Encoded",
        "count": 1
      },
      {
        "name": "Guardian Power Conduit",
        "cat": "Manufactured",
        "count": 18
      },
      {
        "name": "Pattern Epsilon Obelisk Data",
        "cat": "Encoded",
        "count": 21
      },
      {
        "name": "Heat Resistant Ceramics",
        "cat": "Manufactured",
        "count": 15
      },
      {
        "name": "Energy Grid Assembly",
        "cat": "Commodity",
        "count": 10
      }
    ]
  },
  {
    "id": "g_power_distributor",
    "name": "Guardian Hybrid Power Distributor",
    "cat": "Tech Broker Guardian",
    "engineer": "Technology Broker Guardian",
    "desc": "Power Distributor di derivazione Guardian.",
    "items": [
      {
        "name": "Guardian Module Blueprint Fragment",
        "cat": "Encoded",
        "count": 1
      },
      {
        "name": "Pattern Alpha Obelisk Data",
        "cat": "Encoded",
        "count": 20
      },
      {
        "name": "Guardian Power Cell",
        "cat": "Manufactured",
        "count": 24
      },
      {
        "name": "Phase Alloys",
        "cat": "Manufactured",
        "count": 18
      },
      {
        "name": "Heatsink Interlink",
        "cat": "Commodity",
        "count": 6
      }
    ]
  },
  {
    "id": "g_gauss_cannon",
    "name": "Guardian Gauss Cannon (Medium, Fixed)",
    "cat": "Tech Broker Guardian",
    "engineer": "Technology Broker Guardian",
    "desc": "Arma Guardian anti-Thargoid. Le altre taglie hanno ricette diverse.",
    "items": [
      {
        "name": "Guardian Weapon Blueprint Fragment",
        "cat": "Encoded",
        "count": 1
      },
      {
        "name": "Guardian Power Cell",
        "cat": "Manufactured",
        "count": 18
      },
      {
        "name": "Guardian Technology Component",
        "cat": "Manufactured",
        "count": 20
      },
      {
        "name": "Manganese",
        "cat": "Raw",
        "count": 15
      },
      {
        "name": "Magnetic Emitter Coil",
        "cat": "Commodity",
        "count": 6
      }
    ]
  },
  {
    "id": "g_plasma_charger",
    "name": "Guardian Plasma Charger (Medium, Fixed)",
    "cat": "Tech Broker Guardian",
    "engineer": "Technology Broker Guardian",
    "desc": "Arma Guardian anti-Thargoid a carica. Le altre taglie hanno ricette diverse.",
    "items": [
      {
        "name": "Guardian Weapon Blueprint Fragment",
        "cat": "Encoded",
        "count": 1
      },
      {
        "name": "Guardian Power Conduit",
        "cat": "Manufactured",
        "count": 19
      },
      {
        "name": "Guardian Sentinel Weapon Parts",
        "cat": "Manufactured",
        "count": 16
      },
      {
        "name": "Chromium",
        "cat": "Raw",
        "count": 14
      },
      {
        "name": "Micro-Weave Cooling Hoses",
        "cat": "Commodity",
        "count": 8
      }
    ]
  },
  {
    "id": "g_shard_cannon",
    "name": "Guardian Shard Cannon (Medium, Fixed)",
    "cat": "Tech Broker Guardian",
    "engineer": "Technology Broker Guardian",
    "desc": "Arma Guardian anti-Thargoid a corto raggio. Le altre taglie hanno ricette diverse.",
    "items": [
      {
        "name": "Guardian Technology Component",
        "cat": "Manufactured",
        "count": 18
      },
      {
        "name": "Guardian Weapon Blueprint Fragment",
        "cat": "Encoded",
        "count": 1
      },
      {
        "name": "Guardian Wreckage Components",
        "cat": "Manufactured",
        "count": 20
      },
      {
        "name": "Carbon",
        "cat": "Raw",
        "count": 14
      },
      {
        "name": "Power Transfer Bus",
        "cat": "Commodity",
        "count": 12
      }
    ]
  },
  {
    "id": "human_corrosive_rack",
    "name": "Corrosion Resistant Cargo Rack (Size 4)",
    "cat": "Tech Broker Human",
    "engineer": "Technology Broker Human",
    "desc": "Stiva per merci corrosive Thargoid senza danni alla nave.",
    "items": [
      {
        "name": "Meta-Alloys",
        "cat": "Commodity",
        "count": 16
      },
      {
        "name": "Iron",
        "cat": "Raw",
        "count": 26
      },
      {
        "name": "Chemical Manipulators",
        "cat": "Manufactured",
        "count": 18
      },
      {
        "name": "Neofabric Insulation",
        "cat": "Commodity",
        "count": 12
      },
      {
        "name": "Radiation Baffle",
        "cat": "Commodity",
        "count": 22
      }
    ]
  },
  {
    "id": "fsd_range",
    "name": "FSD Increased Range G5 + Mass Manager",
    "cat": "Ingegneri Moduli",
    "engineer": "Elvira Martuuk · Felicity Farseer · Mel Brandon",
    "desc": "Massima portata di salto. Quantità per UN tiro di G5 (1 di ciascun materiale) più l'effetto sperimentale: di solito servono più tiri per completare il grado.",
    "items": [
      {
        "name": "Arsenic",
        "cat": "Raw",
        "count": 1
      },
      {
        "name": "Chemical Manipulators",
        "cat": "Manufactured",
        "count": 1
      },
      {
        "name": "Datamined Wake Exceptions",
        "cat": "Encoded",
        "count": 1
      },
      {
        "name": "Atypical Disrupted Wake Echoes",
        "cat": "Encoded",
        "count": 5
      },
      {
        "name": "Galvanising Alloys",
        "cat": "Manufactured",
        "count": 3
      },
      {
        "name": "Eccentric Hyperspace Trajectories",
        "cat": "Encoded",
        "count": 1
      }
    ]
  },
  {
    "id": "dirty_drives",
    "name": "Thrusters Dirty Drive Tuning G5 + Drag Drives",
    "cat": "Ingegneri Moduli",
    "engineer": "Professor Palin · Mel Brandon · Chloe Sedesi",
    "desc": "Massima velocità e manovrabilità. Quantità per UN tiro di G5 (1 di ciascun materiale) più l'effetto sperimentale: di solito servono più tiri per completare il grado.",
    "items": [
      {
        "name": "Cadmium",
        "cat": "Raw",
        "count": 1
      },
      {
        "name": "Cracked Industrial Firmware",
        "cat": "Encoded",
        "count": 1
      },
      {
        "name": "Pharmaceutical Isolators",
        "cat": "Manufactured",
        "count": 1
      },
      {
        "name": "Iron",
        "cat": "Raw",
        "count": 5
      },
      {
        "name": "Hybrid Capacitors",
        "cat": "Manufactured",
        "count": 3
      },
      {
        "name": "Security Firmware Patch",
        "cat": "Encoded",
        "count": 1
      }
    ]
  },
  {
    "id": "charge_enhanced",
    "name": "Power Distributor Charge Enhanced G5 + Super Conduits",
    "cat": "Ingegneri Moduli",
    "engineer": "The Dweller · Etienne Dorn",
    "desc": "Ricarica più rapida dei capacitori. Quantità per UN tiro di G5 (1 di ciascun materiale) più l'effetto sperimentale: di solito servono più tiri per completare il grado.",
    "items": [
      {
        "name": "Chemical Manipulators",
        "cat": "Manufactured",
        "count": 1
      },
      {
        "name": "Cracked Industrial Firmware",
        "cat": "Encoded",
        "count": 1
      },
      {
        "name": "Exquisite Focus Crystals",
        "cat": "Manufactured",
        "count": 1
      },
      {
        "name": "Phosphorus",
        "cat": "Raw",
        "count": 5
      },
      {
        "name": "Heat Resistant Ceramics",
        "cat": "Manufactured",
        "count": 3
      },
      {
        "name": "Security Firmware Patch",
        "cat": "Encoded",
        "count": 1
      }
    ]
  },
  {
    "id": "overcharged_pp",
    "name": "Power Plant Overcharged G5 + Monstered",
    "cat": "Ingegneri Moduli",
    "engineer": "Hera Tani · Etienne Dorn",
    "desc": "Più energia disponibile. Quantità per UN tiro di G5 (1 di ciascun materiale) più l'effetto sperimentale: di solito servono più tiri per completare il grado.",
    "items": [
      {
        "name": "Chemical Manipulators",
        "cat": "Manufactured",
        "count": 1
      },
      {
        "name": "Conductive Ceramics",
        "cat": "Manufactured",
        "count": 1
      },
      {
        "name": "Tellurium",
        "cat": "Raw",
        "count": 1
      },
      {
        "name": "Grid Resistors",
        "cat": "Manufactured",
        "count": 5
      },
      {
        "name": "Vanadium",
        "cat": "Raw",
        "count": 3
      },
      {
        "name": "Polymer Capacitors",
        "cat": "Manufactured",
        "count": 1
      }
    ]
  },
  {
    "id": "reinforced_shield",
    "name": "Shield Generator Reinforced G5 + Fast Charge",
    "cat": "Ingegneri Moduli",
    "engineer": "Lei Cheung · Mel Brandon",
    "desc": "Scudo più robusto e rigenerazione più rapida. Quantità per UN tiro di G5 (1 di ciascun materiale) più l'effetto sperimentale: di solito servono più tiri per completare il grado.",
    "items": [
      {
        "name": "Arsenic",
        "cat": "Raw",
        "count": 1
      },
      {
        "name": "Conductive Polymers",
        "cat": "Manufactured",
        "count": 1
      },
      {
        "name": "Improvised Components",
        "cat": "Manufactured",
        "count": 1
      },
      {
        "name": "Flawed Focus Crystals",
        "cat": "Manufactured",
        "count": 3
      },
      {
        "name": "Worn Shield Emitters",
        "cat": "Manufactured",
        "count": 5
      },
      {
        "name": "Compound Shielding",
        "cat": "Manufactured",
        "count": 3
      }
    ]
  }
];

VIEWS.materials = () => {
  const f = UI.matFilter.toLowerCase();
  const cats = { Raw: "Grezzi", Manufactured: "Manufatti", Encoded: "Codificati" };
  const cols = Object.entries(cats).map(([cat, lbl]) => {
    const items = S.materials.map(m => ({ ...m, it: UI.lang === "it" ? IT.material[m.name] || m.label : m.label }))
      .filter(m => m.category === cat && (!f || m.it.toLowerCase().includes(f) || m.label.toLowerCase().includes(f) || m.name.includes(f)))
      .sort((a, b) => (a.grade || 9) - (b.grade || 9) || a.it.localeCompare(b.it));
    const total = items.reduce((s, m) => s + m.count, 0);
    return panel(lbl, items.map(m => {
      const full = m.cap && m.count >= m.cap;
      return `<div class="mat-line" style="grid-template-columns:30px 1fr 74px;padding:4px 0"><span class="mono muted">${m.grade ? "G" + m.grade : ""}</span>
        <span title="${esc(m.label)}">${esc(m.it)}${m.cap ? meter(m.count / m.cap * 100, full ? "full" : "") : ""}</span>
        <span class="num ${full ? "ok" : m.count === 0 ? "muted" : ""}" style="text-align:right">${m.count}<span class="muted">${m.cap ? "/" + m.cap : ""}</span></span></div>`;
    }).join("") || '<div class="empty">Nessun materiale</div>', { code: cat.toUpperCase(), aside: `${num(total)} totali` });
  }).join("");
  const lk = S.locker || {}, lkCats = { Items: "Oggetti", Components: "Componenti", Consumables: "Consumabili", Data: "Dati" };
  const locker = Object.entries(lkCats).map(([k, l]) => lk[k]?.length ? `<div class="eyebrow" style="margin-top:8px">${l}</div><table><tbody>${lk[k].map(i =>
    `<tr><td>${esc(i.name)}</td><td class="num">${i.count}</td></tr>`).join("")}</tbody></table>` : "").join("") || '<div class="empty">Armadietto vuoto</div>';

  return `<div class="col">
    ${panel("Materiali", `<div class="form"><label class="grow-1">Filtra materiali
      <input id="mat-filter" value="${esc(UI.matFilter)}" placeholder="es. arsenic, focus, firmware…"></label>
      <span class="sub" style="padding-bottom:9px">Limiti per grado: G1 300 · G2 250 · G3 200 · G4 150 · G5 100</span></div>`,
      { code: "INVENTORY", aside: '<a class="btn" href="#wishlist">Sblocchi e progetti</a>' })}
    <div class="cards" style="grid-template-columns:repeat(auto-fill,minmax(320px,1fr))">${cols}${panel("Armadietto Odyssey", locker, { cls: "holo", code: "LOCKER" })}</div>
  </div>`;
};
