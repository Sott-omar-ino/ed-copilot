// File generato: dati Odyssey (tute, armi, modifiche, ingegneri a piedi). Fonti in ODYSSEY_DATA.meta.sources.
// Chiavi = nomi interni del journal (ShipLocker Name, SuitName, ModuleName, SuitMods/WeaponMods).
window.ODYSSEY_DATA = {
 "meta": {
  "generated": "2026-11-07",
  "sources": [
   "https://github.com/jixxed/ed-odyssey-materials-helper (commit 2e6d4c3, OdysseyBlueprintConstants.java, SpawnConstants.java, locale/*.csv) - upgrade di tute/armi, nomi e luoghi dei materiali",
   "https://github.com/EDDiscovery/EliteDangerousCore (EliteDangerous/FrontierData/Items/RecipesEngineering.cs, MCMRType.cs, Engineers.cs) - modifiche (dati Frontier, ago 2024), crediti delle modifiche, ingegneri e coordinate",
   "https://elite-dangerous.fandom.com/wiki/Artemis_Suit (e pagine delle armi) - crediti degli upgrade: prezzo base x 4/15/30/50",
   "https://inara.cz/elite/engineers/ e pagine ingegneri/modifiche di elite-dangerous.fandom.com (nov 2026) - requisiti degli ingegneri a piedi (valori attuali, ridotti rispetto al lancio) ed effetti delle modifiche"
  ],
  "notes": "Upgrade: ricette identiche in jixxed ed EDDiscovery (24/24). Modifiche: 25/31 identiche; per 6 modifiche cinetiche/plasma jixxed ha ancora le quantità pre-dimezzamento, qui si usano quelle di EDDiscovery. I crediti degli upgrade sono stimati (prezzo base x 4/15/30/50); quando il journal registra un UpgradeSuit/UpgradeWeapon il costo reale prevale.",
  "upgrade_multiplier": {
   "2": 4,
   "3": 15,
   "4": 30,
   "5": 50
  }
 },
 "suits": {
  "flightsuit": {
   "name": "Flight Suit",
   "maker": "Remlok",
   "role": "Base, non potenziabile",
   "price": 0,
   "upgrades": {}
  },
  "utilitysuit": {
   "name": "Maverick Suit",
   "maker": "Remlok",
   "role": "Utility (Arc Cutter)",
   "price": 150000,
   "upgrades": {
    "2": {
     "cr": 600000,
     "ing": {
      "suitschematic": 1,
      "healthmonitor": 1,
      "manufacturinginstructions": 1,
      "carbonfibreplating": 2,
      "graphene": 2
     }
    },
    "3": {
     "cr": 2250000,
     "ing": {
      "suitschematic": 2,
      "healthmonitor": 2,
      "manufacturinginstructions": 2,
      "carbonfibreplating": 5,
      "graphene": 5
     }
    },
    "4": {
     "cr": 4500000,
     "ing": {
      "suitschematic": 4,
      "healthmonitor": 4,
      "manufacturinginstructions": 4,
      "carbonfibreplating": 9,
      "graphene": 9
     }
    },
    "5": {
     "cr": 7500000,
     "ing": {
      "suitschematic": 5,
      "healthmonitor": 5,
      "manufacturinginstructions": 5,
      "carbonfibreplating": 12,
      "graphene": 12
     }
    }
   }
  },
  "tacticalsuit": {
   "name": "Dominator Suit",
   "maker": "Manticore",
   "role": "Combattimento (2 primarie)",
   "price": 150000,
   "upgrades": {
    "2": {
     "cr": 600000,
     "ing": {
      "suitschematic": 1,
      "healthmonitor": 1,
      "manufacturinginstructions": 1,
      "titaniumplating": 2,
      "graphene": 2
     }
    },
    "3": {
     "cr": 2250000,
     "ing": {
      "suitschematic": 2,
      "healthmonitor": 2,
      "manufacturinginstructions": 2,
      "titaniumplating": 5,
      "graphene": 5
     }
    },
    "4": {
     "cr": 4500000,
     "ing": {
      "suitschematic": 4,
      "healthmonitor": 4,
      "manufacturinginstructions": 4,
      "titaniumplating": 9,
      "graphene": 9
     }
    },
    "5": {
     "cr": 7500000,
     "ing": {
      "suitschematic": 5,
      "healthmonitor": 5,
      "manufacturinginstructions": 5,
      "titaniumplating": 12,
      "graphene": 12
     }
    }
   }
  },
  "explorationsuit": {
   "name": "Artemis Suit",
   "maker": "Supratech",
   "role": "Esplorazione (Genetic Sampler)",
   "price": 150000,
   "upgrades": {
    "2": {
     "cr": 600000,
     "ing": {
      "suitschematic": 1,
      "healthmonitor": 1,
      "manufacturinginstructions": 1,
      "aerogel": 2,
      "graphene": 2
     }
    },
    "3": {
     "cr": 2250000,
     "ing": {
      "suitschematic": 2,
      "healthmonitor": 2,
      "manufacturinginstructions": 2,
      "aerogel": 5,
      "graphene": 5
     }
    },
    "4": {
     "cr": 4500000,
     "ing": {
      "suitschematic": 4,
      "healthmonitor": 4,
      "manufacturinginstructions": 4,
      "aerogel": 9,
      "graphene": 9
     }
    },
    "5": {
     "cr": 7500000,
     "ing": {
      "suitschematic": 5,
      "healthmonitor": 5,
      "manufacturinginstructions": 5,
      "aerogel": 12,
      "graphene": 12
     }
    }
   }
  }
 },
 "weapons": {
  "wpn_m_assaultrifle_kinetic_fauto": {
   "name": "Karma AR-50",
   "maker": "Kinematic Armaments",
   "family": "kinetic",
   "type": "Fucile d'assalto",
   "slot": "primaria",
   "price": 125000,
   "upgrades": {
    "2": {
     "cr": 500000,
     "ing": {
      "weaponschematic": 1,
      "compressionliquefiedgas": 1,
      "manufacturinginstructions": 1,
      "weaponcomponent": 2,
      "tungstencarbide": 2
     }
    },
    "3": {
     "cr": 1875000,
     "ing": {
      "weaponschematic": 2,
      "compressionliquefiedgas": 2,
      "manufacturinginstructions": 2,
      "weaponcomponent": 5,
      "tungstencarbide": 5
     }
    },
    "4": {
     "cr": 3750000,
     "ing": {
      "weaponschematic": 4,
      "compressionliquefiedgas": 4,
      "manufacturinginstructions": 4,
      "weaponcomponent": 9,
      "tungstencarbide": 9
     }
    },
    "5": {
     "cr": 6250000,
     "ing": {
      "weaponschematic": 5,
      "compressionliquefiedgas": 5,
      "manufacturinginstructions": 5,
      "weaponcomponent": 12,
      "tungstencarbide": 12
     }
    }
   }
  },
  "wpn_m_submachinegun_kinetic_fauto": {
   "name": "Karma C-44",
   "maker": "Kinematic Armaments",
   "family": "kinetic",
   "type": "Carabina",
   "slot": "primaria",
   "price": 75000,
   "upgrades": {
    "2": {
     "cr": 300000,
     "ing": {
      "weaponschematic": 1,
      "compressionliquefiedgas": 1,
      "manufacturinginstructions": 1,
      "weaponcomponent": 2,
      "tungstencarbide": 2
     }
    },
    "3": {
     "cr": 1125000,
     "ing": {
      "weaponschematic": 2,
      "compressionliquefiedgas": 2,
      "manufacturinginstructions": 2,
      "weaponcomponent": 5,
      "tungstencarbide": 5
     }
    },
    "4": {
     "cr": 2250000,
     "ing": {
      "weaponschematic": 4,
      "compressionliquefiedgas": 4,
      "manufacturinginstructions": 4,
      "weaponcomponent": 9,
      "tungstencarbide": 9
     }
    },
    "5": {
     "cr": 3750000,
     "ing": {
      "weaponschematic": 5,
      "compressionliquefiedgas": 5,
      "manufacturinginstructions": 5,
      "weaponcomponent": 12,
      "tungstencarbide": 12
     }
    }
   }
  },
  "wpn_m_launcher_rocket_sauto": {
   "name": "Karma L-6",
   "maker": "Kinematic Armaments",
   "family": "kinetic",
   "type": "Lanciarazzi",
   "slot": "primaria",
   "price": 175000,
   "upgrades": {
    "2": {
     "cr": 700000,
     "ing": {
      "weaponschematic": 1,
      "compressionliquefiedgas": 1,
      "manufacturinginstructions": 1,
      "weaponcomponent": 2,
      "tungstencarbide": 2
     }
    },
    "3": {
     "cr": 2625000,
     "ing": {
      "weaponschematic": 2,
      "compressionliquefiedgas": 2,
      "manufacturinginstructions": 2,
      "weaponcomponent": 5,
      "tungstencarbide": 5
     }
    },
    "4": {
     "cr": 5250000,
     "ing": {
      "weaponschematic": 4,
      "compressionliquefiedgas": 4,
      "manufacturinginstructions": 4,
      "weaponcomponent": 9,
      "tungstencarbide": 9
     }
    },
    "5": {
     "cr": 8750000,
     "ing": {
      "weaponschematic": 5,
      "compressionliquefiedgas": 5,
      "manufacturinginstructions": 5,
      "weaponcomponent": 12,
      "tungstencarbide": 12
     }
    }
   }
  },
  "wpn_s_pistol_kinetic_sauto": {
   "name": "Karma P-15",
   "maker": "Kinematic Armaments",
   "family": "kinetic",
   "type": "Pistola",
   "slot": "secondaria",
   "price": 50000,
   "upgrades": {
    "2": {
     "cr": 200000,
     "ing": {
      "weaponschematic": 1,
      "compressionliquefiedgas": 1,
      "manufacturinginstructions": 1,
      "weaponcomponent": 2,
      "tungstencarbide": 2
     }
    },
    "3": {
     "cr": 750000,
     "ing": {
      "weaponschematic": 2,
      "compressionliquefiedgas": 2,
      "manufacturinginstructions": 2,
      "weaponcomponent": 5,
      "tungstencarbide": 5
     }
    },
    "4": {
     "cr": 1500000,
     "ing": {
      "weaponschematic": 4,
      "compressionliquefiedgas": 4,
      "manufacturinginstructions": 4,
      "weaponcomponent": 9,
      "tungstencarbide": 9
     }
    },
    "5": {
     "cr": 2500000,
     "ing": {
      "weaponschematic": 5,
      "compressionliquefiedgas": 5,
      "manufacturinginstructions": 5,
      "weaponcomponent": 12,
      "tungstencarbide": 12
     }
    }
   }
  },
  "wpn_m_assaultrifle_laser_fauto": {
   "name": "TK Aphelion",
   "maker": "Takada",
   "family": "laser",
   "type": "Fucile",
   "slot": "primaria",
   "price": 125000,
   "upgrades": {
    "2": {
     "cr": 500000,
     "ing": {
      "weaponschematic": 1,
      "ionisedgas": 1,
      "manufacturinginstructions": 1,
      "microelectrode": 2,
      "opticalfibre": 2
     }
    },
    "3": {
     "cr": 1875000,
     "ing": {
      "weaponschematic": 2,
      "ionisedgas": 2,
      "manufacturinginstructions": 2,
      "microelectrode": 5,
      "opticalfibre": 5
     }
    },
    "4": {
     "cr": 3750000,
     "ing": {
      "weaponschematic": 4,
      "ionisedgas": 4,
      "manufacturinginstructions": 4,
      "microelectrode": 9,
      "opticalfibre": 9
     }
    },
    "5": {
     "cr": 6250000,
     "ing": {
      "weaponschematic": 5,
      "ionisedgas": 5,
      "manufacturinginstructions": 5,
      "microelectrode": 12,
      "opticalfibre": 12
     }
    }
   }
  },
  "wpn_m_submachinegun_laser_fauto": {
   "name": "TK Eclipse",
   "maker": "Takada",
   "family": "laser",
   "type": "Carabina",
   "slot": "primaria",
   "price": 75000,
   "upgrades": {
    "2": {
     "cr": 300000,
     "ing": {
      "weaponschematic": 1,
      "ionisedgas": 1,
      "manufacturinginstructions": 1,
      "microelectrode": 2,
      "opticalfibre": 2
     }
    },
    "3": {
     "cr": 1125000,
     "ing": {
      "weaponschematic": 2,
      "ionisedgas": 2,
      "manufacturinginstructions": 2,
      "microelectrode": 5,
      "opticalfibre": 5
     }
    },
    "4": {
     "cr": 2250000,
     "ing": {
      "weaponschematic": 4,
      "ionisedgas": 4,
      "manufacturinginstructions": 4,
      "microelectrode": 9,
      "opticalfibre": 9
     }
    },
    "5": {
     "cr": 3750000,
     "ing": {
      "weaponschematic": 5,
      "ionisedgas": 5,
      "manufacturinginstructions": 5,
      "microelectrode": 12,
      "opticalfibre": 12
     }
    }
   }
  },
  "wpn_s_pistol_laser_sauto": {
   "name": "TK Zenith",
   "maker": "Takada",
   "family": "laser",
   "type": "Pistola",
   "slot": "secondaria",
   "price": 50000,
   "upgrades": {
    "2": {
     "cr": 200000,
     "ing": {
      "weaponschematic": 1,
      "ionisedgas": 1,
      "manufacturinginstructions": 1,
      "microelectrode": 2,
      "opticalfibre": 2
     }
    },
    "3": {
     "cr": 750000,
     "ing": {
      "weaponschematic": 2,
      "ionisedgas": 2,
      "manufacturinginstructions": 2,
      "microelectrode": 5,
      "opticalfibre": 5
     }
    },
    "4": {
     "cr": 1500000,
     "ing": {
      "weaponschematic": 4,
      "ionisedgas": 4,
      "manufacturinginstructions": 4,
      "microelectrode": 9,
      "opticalfibre": 9
     }
    },
    "5": {
     "cr": 2500000,
     "ing": {
      "weaponschematic": 5,
      "ionisedgas": 5,
      "manufacturinginstructions": 5,
      "microelectrode": 12,
      "opticalfibre": 12
     }
    }
   }
  },
  "wpn_m_sniper_plasma_charged": {
   "name": "Manticore Executioner",
   "maker": "Manticore",
   "family": "plasma",
   "type": "Fucile di precisione",
   "slot": "primaria",
   "price": 175000,
   "upgrades": {
    "2": {
     "cr": 700000,
     "ing": {
      "weaponschematic": 1,
      "ionisedgas": 1,
      "manufacturinginstructions": 1,
      "microelectrode": 2,
      "chemicalsuperbase": 2
     }
    },
    "3": {
     "cr": 2625000,
     "ing": {
      "weaponschematic": 2,
      "ionisedgas": 2,
      "manufacturinginstructions": 2,
      "microelectrode": 5,
      "chemicalsuperbase": 5
     }
    },
    "4": {
     "cr": 5250000,
     "ing": {
      "weaponschematic": 4,
      "ionisedgas": 4,
      "manufacturinginstructions": 4,
      "microelectrode": 9,
      "chemicalsuperbase": 9
     }
    },
    "5": {
     "cr": 8750000,
     "ing": {
      "weaponschematic": 5,
      "ionisedgas": 5,
      "manufacturinginstructions": 5,
      "microelectrode": 12,
      "chemicalsuperbase": 12
     }
    }
   }
  },
  "wpn_m_assaultrifle_plasma_fauto": {
   "name": "Manticore Oppressor",
   "maker": "Manticore",
   "family": "plasma",
   "type": "Fucile d'assalto",
   "slot": "primaria",
   "price": 125000,
   "upgrades": {
    "2": {
     "cr": 500000,
     "ing": {
      "weaponschematic": 1,
      "ionisedgas": 1,
      "manufacturinginstructions": 1,
      "microelectrode": 2,
      "chemicalsuperbase": 2
     }
    },
    "3": {
     "cr": 1875000,
     "ing": {
      "weaponschematic": 2,
      "ionisedgas": 2,
      "manufacturinginstructions": 2,
      "microelectrode": 5,
      "chemicalsuperbase": 5
     }
    },
    "4": {
     "cr": 3750000,
     "ing": {
      "weaponschematic": 4,
      "ionisedgas": 4,
      "manufacturinginstructions": 4,
      "microelectrode": 9,
      "chemicalsuperbase": 9
     }
    },
    "5": {
     "cr": 6250000,
     "ing": {
      "weaponschematic": 5,
      "ionisedgas": 5,
      "manufacturinginstructions": 5,
      "microelectrode": 12,
      "chemicalsuperbase": 12
     }
    }
   }
  },
  "wpn_m_shotgun_plasma_doublebarrel": {
   "name": "Manticore Intimidator",
   "maker": "Manticore",
   "family": "plasma",
   "type": "Fucile a pompa",
   "slot": "primaria",
   "price": 100000,
   "upgrades": {
    "2": {
     "cr": 400000,
     "ing": {
      "weaponschematic": 1,
      "ionisedgas": 1,
      "manufacturinginstructions": 1,
      "microelectrode": 2,
      "chemicalsuperbase": 2
     }
    },
    "3": {
     "cr": 1500000,
     "ing": {
      "weaponschematic": 2,
      "ionisedgas": 2,
      "manufacturinginstructions": 2,
      "microelectrode": 5,
      "chemicalsuperbase": 5
     }
    },
    "4": {
     "cr": 3000000,
     "ing": {
      "weaponschematic": 4,
      "ionisedgas": 4,
      "manufacturinginstructions": 4,
      "microelectrode": 9,
      "chemicalsuperbase": 9
     }
    },
    "5": {
     "cr": 5000000,
     "ing": {
      "weaponschematic": 5,
      "ionisedgas": 5,
      "manufacturinginstructions": 5,
      "microelectrode": 12,
      "chemicalsuperbase": 12
     }
    }
   }
  },
  "wpn_s_pistol_plasma_charged": {
   "name": "Manticore Tormentor",
   "maker": "Manticore",
   "family": "plasma",
   "type": "Pistola",
   "slot": "secondaria",
   "price": 50000,
   "upgrades": {
    "2": {
     "cr": 200000,
     "ing": {
      "weaponschematic": 1,
      "ionisedgas": 1,
      "manufacturinginstructions": 1,
      "microelectrode": 2,
      "chemicalsuperbase": 2
     }
    },
    "3": {
     "cr": 750000,
     "ing": {
      "weaponschematic": 2,
      "ionisedgas": 2,
      "manufacturinginstructions": 2,
      "microelectrode": 5,
      "chemicalsuperbase": 5
     }
    },
    "4": {
     "cr": 1500000,
     "ing": {
      "weaponschematic": 4,
      "ionisedgas": 4,
      "manufacturinginstructions": 4,
      "microelectrode": 9,
      "chemicalsuperbase": 9
     }
    },
    "5": {
     "cr": 2500000,
     "ing": {
      "weaponschematic": 5,
      "ionisedgas": 5,
      "manufacturinginstructions": 5,
      "microelectrode": 12,
      "chemicalsuperbase": 12
     }
    }
   }
  }
 },
 "suit_mods": {
  "suit_reducedtoolbatteryconsumption": {
   "name": "Reduced Tool Battery Consumption",
   "effect": "Consumo batteria degli strumenti -50%",
   "cr": 500000,
   "ing": {
    "electricalfuse": 3,
    "microtransformer": 5,
    "electricalwiring": 8,
    "reactoroutputreview": 5
   },
   "engineers": [
    "Domino Green",
    "Wellington Beck",
    "Rosa Dayette"
   ]
  },
  "suit_increasedbatterycapacity": {
   "name": "Improved Battery Capacity",
   "effect": "Batteria +50%",
   "cr": 750000,
   "ing": {
    "ionbattery": 3,
    "microsupercapacitor": 5,
    "electricalwiring": 5,
    "reactoroutputreview": 5,
    "maintenancelogs": 8
   },
   "engineers": [
    "Wellington Beck",
    "Oden Geiger",
    "Rosa Dayette"
   ]
  },
  "suit_increasedshieldregen": {
   "name": "Faster Shield Regen",
   "effect": "Rigenerazione dello scudo più rapida",
   "cr": 750000,
   "ing": {
    "ionbattery": 3,
    "microtransformer": 8,
    "electricalwiring": 8,
    "reactoroutputreview": 5
   },
   "engineers": [
    "Kit Fowler",
    "Uma Laszlo",
    "Eleanor Bresa"
   ]
  },
  "suit_improvedarmourrating": {
   "name": "Damage Resistance",
   "effect": "Resistenze ai danni +10% (relativo, tutti i tipi)",
   "cr": 750000,
   "ing": {
    "titaniumplating": 3,
    "carbonfibreplating": 3,
    "epoxyadhesive": 8,
    "weaponinventory": 5,
    "ballisticsdata": 5
   },
   "engineers": [
    "Jude Navarro",
    "Uma Laszlo",
    "Eleanor Bresa"
   ]
  },
  "suit_increasedo2capacity": {
   "name": "Increased Air Reserves",
   "effect": "Riserva d'aria d'emergenza da 60 a 300 s",
   "cr": 750000,
   "ing": {
    "oxygenicbacteria": 5,
    "phneutraliser": 8,
    "pharmaceuticalpatents": 3,
    "airqualityreports": 8
   },
   "engineers": [
    "Terra Velasquez",
    "Hero Ferrari",
    "Baltanos"
   ]
  },
  "suit_nightvision": {
   "name": "Night Vision",
   "effect": "Visione notturna",
   "cr": 1000000,
   "ing": {
    "surveillanceequipment": 5,
    "circuitswitch": 5,
    "surveilleancelogs": 3,
    "radioactivitydata": 3,
    "nocdata": 3
   },
   "engineers": [
    "Oden Geiger",
    "Yi Shen"
   ]
  },
  "suit_improvedradar": {
   "name": "Enhanced Tracking",
   "effect": "Analisi a vista istantanea e a distanza doppia (non vale per gli strumenti)",
   "cr": 750000,
   "ing": {
    "transmitter": 3,
    "circuitboard": 3,
    "topographicalsurveys": 5,
    "stellaractivitylogs": 5,
    "spectralanalysisdata": 5
   },
   "engineers": [
    "Domino Green",
    "Oden Geiger",
    "Rosa Dayette"
   ]
  },
  "suit_backpackcapacity": {
   "name": "Extra Backpack Capacity",
   "effect": "Zaino più capiente per dati, asset e oggetti (consumabili invariati)",
   "cr": 750000,
   "ing": {
    "epoxyadhesive": 5,
    "memorychip": 3,
    "weaponinventory": 5,
    "chemicalinventory": 5,
    "digitaldesigns": 5
   },
   "engineers": [
    "Domino Green",
    "Wellington Beck",
    "Rosa Dayette"
   ]
  },
  "suit_increasedammoreserves": {
   "name": "Extra Ammo Capacity",
   "effect": "Munizioni di riserva +50%",
   "cr": 750000,
   "ing": {
    "weaponcomponent": 3,
    "recyclinglogs": 8,
    "weapontestdata": 5,
    "productionreports": 5
   },
   "engineers": [
    "Kit Fowler",
    "Jude Navarro",
    "Eleanor Bresa"
   ]
  },
  "suit_improvedjumpassist": {
   "name": "Improved Jump Assist",
   "effect": "Jetpack più potente e con meno consumo",
   "cr": 750000,
   "ing": {
    "gmeds": 5,
    "microthrusters": 3,
    "motor": 5,
    "topographicalsurveys": 5
   },
   "engineers": [
    "Yarden Bond",
    "Hero Ferrari",
    "Baltanos"
   ]
  },
  "suit_increasedsprintduration": {
   "name": "Increased Sprint Duration",
   "effect": "Durata dello scatto +100%",
   "cr": 750000,
   "ing": {
    "oxygenicbacteria": 5,
    "chemicalcatalyst": 8,
    "troopdeploymentrecords": 3,
    "genesequencingdata": 3,
    "medicaltrialrecords": 3
   },
   "engineers": [
    "Terra Velasquez",
    "Hero Ferrari",
    "Baltanos"
   ]
  },
  "suit_adsmovementspeed": {
   "name": "Combat Movement Speed",
   "effect": "Movimento più rapido mentre miri",
   "cr": 750000,
   "ing": {
    "epinephrine": 5,
    "phneutraliser": 8,
    "evacuationprotocols": 5,
    "geneticresearch": 3
   },
   "engineers": [
    "Yarden Bond",
    "Terra Velasquez",
    "Baltanos"
   ]
  },
  "suit_quieterfootsteps": {
   "name": "Quieter Footsteps",
   "effect": "Passi più silenziosi (camminare come in modalità furtiva; salti e jetpack invariati)",
   "cr": 1000000,
   "ing": {
    "microhydraulics": 3,
    "viscoelasticpolymer": 8,
    "settlementassaultplans": 3,
    "tacticalplans": 5,
    "patrolroutes": 5
   },
   "engineers": [
    "Yarden Bond",
    "Yi Shen"
   ]
  },
  "suit_increasedmeleedamage": {
   "name": "Added Melee Damage",
   "effect": "Danno corpo a corpo +150%",
   "cr": 500000,
   "ing": {
    "epinephrine": 5,
    "microthrusters": 8,
    "combattrainingmaterial": 5,
    "combatantperformance": 5
   },
   "engineers": [
    "Kit Fowler",
    "Jude Navarro",
    "Eleanor Bresa"
   ]
  }
 },
 "weapon_mods": {
  "weapon_suppression_pressurised": {
   "name": "Noise Suppressor",
   "effect": "Silenziato in ambienti pressurizzati",
   "variants": {
    "all": {
     "cr": 1000000,
     "ing": {
      "viscoelasticpolymer": 8,
      "weaponcomponent": 3,
      "atmosphericdata": 5,
      "mininganalytics": 5
     },
     "engineers": [
      "Terra Velasquez",
      "Hero Ferrari",
      "Baltanos"
     ]
    }
   }
  },
  "weapon_suppression_unpressurised": {
   "name": "Audio Masking",
   "effect": "Silenziato in ambienti senza atmosfera",
   "variants": {
    "all": {
     "cr": 1000000,
     "ing": {
      "scrambler": 5,
      "transmitter": 8,
      "circuitboard": 3,
      "audiologs": 3,
      "patrolroutes": 5
     },
     "engineers": [
      "Yarden Bond",
      "Yi Shen"
     ]
    }
   }
  },
  "weapon_stability": {
   "name": "Stability",
   "effect": "Rinculo nettamente ridotto",
   "variants": {
    "all": {
     "cr": 500000,
     "ing": {
      "viscoelasticpolymer": 5,
      "microhydraulics": 5,
      "mininganalytics": 5,
      "riskassessments": 8
     },
     "engineers": [
      "Domino Green",
      "Oden Geiger",
      "Rosa Dayette"
     ]
    }
   }
  },
  "weapon_handling": {
   "name": "Faster Handling",
   "effect": "Estrazione, riposizionamento e passaggio al mirino più rapidi",
   "variants": {
    "all": {
     "cr": 500000,
     "ing": {
      "viscoelasticpolymer": 3,
      "operationalmanual": 5,
      "combatantperformance": 5,
      "combattrainingmaterial": 5
     },
     "engineers": [
      "Yarden Bond",
      "Hero Ferrari",
      "Baltanos"
     ]
    }
   }
  },
  "weapon_reloadspeed": {
   "name": "Reload Speed",
   "effect": "Ricarica più rapida (circa +20-30% secondo l'arma)",
   "variants": {
    "all": {
     "cr": 500000,
     "ing": {
      "microhydraulics": 5,
      "electromagnet": 5,
      "operationalmanual": 5,
      "productionreports": 5,
      "combattrainingmaterial": 5
     },
     "engineers": [
      "Jude Navarro",
      "Uma Laszlo",
      "Eleanor Bresa"
     ]
    }
   }
  },
  "weapon_clipsize": {
   "name": "Magazine Size",
   "effect": "Caricatore +50%",
   "variants": {
    "all": {
     "cr": 750000,
     "ing": {
      "weaponcomponent": 3,
      "tungstencarbide": 3,
      "metalcoil": 5,
      "weapontestdata": 5,
      "securityexpenses": 3
     },
     "engineers": [
      "Kit Fowler",
      "Jude Navarro",
      "Eleanor Bresa"
     ]
    }
   }
  },
  "weapon_scope": {
   "name": "Scope",
   "effect": "Mirino ottico",
   "variants": {
    "all": {
     "cr": 500000,
     "ing": {
      "opticallens": 5,
      "opticalfibre": 3,
      "spectralanalysisdata": 5,
      "biometricdata": 3
     },
     "engineers": [
      "Wellington Beck",
      "Oden Geiger",
      "Rosa Dayette"
     ]
    }
   }
  },
  "weapon_backpackreloading": {
   "name": "Stowed Reloading",
   "effect": "Ricarica mentre l'arma è riposta",
   "variants": {
    "all": {
     "cr": 1000000,
     "ing": {
      "circuitboard": 3,
      "encryptedmemorychip": 8,
      "digitaldesigns": 5,
      "operationalmanual": 5,
      "productionschedule": 5
     },
     "engineers": [
      "Kit Fowler",
      "Uma Laszlo",
      "Eleanor Bresa"
     ]
    }
   }
  },
  "weapon_accuracy": {
   "name": "Improved Hip Fire Accuracy",
   "effect": "Precisione senza mirino: +10% Kinematic, +15% Takada, +30% Manticore",
   "variants": {
    "kinetic": {
     "cr": 500000,
     "ing": {
      "viscoelasticpolymer": 5,
      "rdx": 5,
      "extractionyielddata": 5,
      "biometricdata": 3,
      "combatantperformance": 5
     },
     "engineers": [
      "Yarden Bond",
      "Terra Velasquez",
      "Baltanos"
     ]
    },
    "plasma": {
     "cr": 500000,
     "ing": {
      "chemicalcatalyst": 5,
      "electromagnet": 5,
      "metalcoil": 5,
      "chemicalpatents": 3,
      "combatantperformance": 5
     },
     "engineers": [
      "Yarden Bond",
      "Terra Velasquez",
      "Baltanos"
     ]
    },
    "laser": {
     "cr": 500000,
     "ing": {
      "metalcoil": 5,
      "opticallens": 3,
      "electricalwiring": 8,
      "radioactivitydata": 3,
      "combatantperformance": 5
     },
     "engineers": [
      "Yarden Bond",
      "Terra Velasquez",
      "Baltanos"
     ]
    }
   }
  },
  "weapon_range": {
   "name": "Greater Range",
   "effect": "Portata efficace +50%",
   "variants": {
    "kinetic": {
     "cr": 500000,
     "ing": {
      "metalcoil": 5,
      "rdx": 5,
      "weaponcomponent": 3,
      "ballisticsdata": 5,
      "topographicalsurveys": 5
     },
     "engineers": [
      "Domino Green",
      "Wellington Beck",
      "Rosa Dayette"
     ]
    },
    "plasma": {
     "cr": 500000,
     "ing": {
      "motor": 3,
      "electromagnet": 5,
      "electricalfuse": 3,
      "chemicalformulae": 5,
      "mineralsurvey": 8
     },
     "engineers": [
      "Domino Green",
      "Wellington Beck",
      "Rosa Dayette"
     ]
    },
    "laser": {
     "cr": 500000,
     "ing": {
      "microtransformer": 8,
      "opticallens": 3,
      "circuitboard": 3,
      "stellaractivitylogs": 5,
      "riskassessments": 8
     },
     "engineers": [
      "Domino Green",
      "Wellington Beck",
      "Rosa Dayette"
     ]
    }
   }
  },
  "weapon_headshotdamage": {
   "name": "Headshot Damage",
   "effect": "Danno alla testa +50%",
   "variants": {
    "kinetic": {
     "cr": 500000,
     "ing": {
      "chemicalcatalyst": 5,
      "rdx": 8,
      "weaponcomponent": 3,
      "weapontestdata": 5,
      "medicalrecords": 3
     },
     "engineers": [
      "Uma Laszlo",
      "Yi Shen"
     ]
    },
    "plasma": {
     "cr": 500000,
     "ing": {
      "ionbattery": 5,
      "electromagnet": 5,
      "microsupercapacitor": 8,
      "chemicalexperimentdata": 5,
      "bloodtestresults": 3
     },
     "engineers": [
      "Uma Laszlo",
      "Yi Shen"
     ]
    },
    "laser": {
     "cr": 750000,
     "ing": {
      "ionbattery": 5,
      "opticallens": 3,
      "scrambler": 5,
      "spectralanalysisdata": 5,
      "biometricdata": 3
     },
     "engineers": [
      "Uma Laszlo",
      "Yi Shen"
     ]
    }
   }
  }
 },
 "engineers": {
  "Domino Green": {
   "system": "Orishis",
   "base": "The Jackrabbit",
   "body": "4",
   "pos": [
    -31.0,
    93.96875,
    -3.5625
   ],
   "colonia": false,
   "discover": "Noto a tutti",
   "meet": "Percorri almeno 100 al sulle navette Apex",
   "unlock": "Consegna 5 Push per conoscere Kit Fowler",
   "req_en": "Travel 100 ly in Apex shuttles / Referral: 5 Push"
  },
  "Hero Ferrari": {
   "system": "Siris",
   "base": "Nevermore Terrace",
   "body": "5 C",
   "pos": [
    131.0625,
    -73.59375,
    -11.25
   ],
   "colonia": false,
   "discover": "Noto a tutti",
   "meet": "Completa 10 zone di conflitto a terra di bassa intensità (low threat)",
   "unlock": "Consegna 5 Settlement Defence Plans per conoscere Wellington Beck",
   "req_en": "Complete 10 low threat on-foot conflict zones / Referral: 5 Settlement Defence Plans"
  },
  "Jude Navarro": {
   "system": "Aurai",
   "base": "Marshall's Drift",
   "body": "1 A",
   "pos": [
    0.9375,
    -47.8125,
    46.28125
   ],
   "colonia": false,
   "discover": "Noto a tutti",
   "meet": "Completa 10 missioni a piedi Restore o Reactivation",
   "unlock": "Consegna 5 Genetic Repair Meds per conoscere Terra Velasquez",
   "req_en": "Complete 10 Restore or Reactivation missions / Referral: 5 Genetic Repair Meds"
  },
  "Kit Fowler": {
   "system": "Capoya",
   "base": "The Last Call",
   "body": "2",
   "pos": [
    -60.65625,
    82.4375,
    -45.0625
   ],
   "colonia": false,
   "discover": "Presentato da Domino Green",
   "meet": "Vendi 5 Opinion Polls ai bartender",
   "unlock": "Consegna 5 Surveillance Equipment per conoscere Yarden Bond",
   "req_en": "Sell 5 Opinion Polls to bartenders / Referral: 5 Surveillance Equipment"
  },
  "Oden Geiger": {
   "system": "Candiaei",
   "base": "Ankh's Promise",
   "body": "9 C",
   "pos": [
    -113.5,
    -4.9375,
    66.84375
   ],
   "colonia": false,
   "discover": "Presentato da Terra Velasquez",
   "meet": "Vendi ai bartender 20 unità in totale tra Biological Sample, Employee Genetic Data e Genetic Research",
   "unlock": "",
   "req_en": "Sell 20 Biological Sample, Employee Genetic Data and/or Genetic Research to bartenders"
  },
  "Terra Velasquez": {
   "system": "Shou Xing",
   "base": "Rascal's Choice",
   "body": "1",
   "pos": [
    -16.28125,
    -44.53125,
    94.375
   ],
   "colonia": false,
   "discover": "Presentato da Jude Navarro",
   "meet": "Completa 6 missioni a piedi Covert Theft / Covert Heist",
   "unlock": "Consegna 15 Financial Projections per conoscere Oden Geiger",
   "req_en": "Complete 6 Covert Theft/Covert Heist missions / Referral: 15 Financial Projections"
  },
  "Uma Laszlo": {
   "system": "Xuane",
   "base": "Laszlo's Resolve",
   "body": "A 3",
   "pos": [
    93.875,
    -9.25,
    -32.53125
   ],
   "colonia": false,
   "discover": "Presentato da Wellington Beck",
   "meet": "Reputazione Unfriendly o peggiore con Sirius Corporation",
   "unlock": "",
   "req_en": "Unfriendly or lower with Sirius Corporation"
  },
  "Wellington Beck": {
   "system": "Jolapa",
   "base": "Beck Facility",
   "body": "6 A",
   "pos": [
    100.1875,
    -41.34375,
    -78.0
   ],
   "colonia": false,
   "discover": "Presentato da Hero Ferrari",
   "meet": "Vendi ai bartender 15 unità in totale tra Multimedia Entertainment, Classic Entertainment e Cat Media",
   "unlock": "Consegna 5 InSight Entertainment Suite per conoscere Uma Laszlo",
   "req_en": "Sell 15 Classic Entertainment, Multimedia Entertainment and/or Cat Media to bartenders / Referral: 5 InSight Entertainment Suite"
  },
  "Yarden Bond": {
   "system": "Bayan",
   "base": "Salamander Bank",
   "body": "7 B",
   "pos": [
    -19.96875,
    117.625,
    -90.46875
   ],
   "colonia": false,
   "discover": "Presentato da Kit Fowler",
   "meet": "Vendi 5 Smear Campaign Plans ai bartender",
   "unlock": "",
   "req_en": "Sell 5 Smear Campaign Plans to bartenders"
  },
  "Baltanos": {
   "system": "Deriso",
   "base": "The Divine Apparatus",
   "body": "3 A",
   "pos": [
    -9520.3125,
    -909.5,
    19808.75
   ],
   "colonia": true,
   "discover": "Noto a tutti",
   "meet": "Reputazione Friendly o superiore con Colonia Council (arriva una missione di invito)",
   "unlock": "Consegna 10 Faction Associates per conoscere Yi Shen",
   "req_en": "Friendly with Colonia Council / Referral: 10 Faction Associates"
  },
  "Eleanor Bresa": {
   "system": "Desy",
   "base": "Bresa Modifications",
   "body": "7 A",
   "pos": [
    -9534.21875,
    -912.21875,
    19792.375
   ],
   "colonia": true,
   "discover": "Noto a tutti",
   "meet": "Attracca e scendi a terra in 5 insediamenti del sistema Colonia",
   "unlock": "Consegna 10 Digital Designs per conoscere Yi Shen",
   "req_en": "Dock and disembark at 5 settlements in the Colonia system / Referral: 10 Digital Designs"
  },
  "Rosa Dayette": {
   "system": "Kojeara",
   "base": "Rosa's Shop",
   "body": "4 B",
   "pos": [
    -9513.09375,
    -908.84375,
    19814.28125
   ],
   "colonia": true,
   "discover": "Noto a tutti",
   "meet": "Vendi 10 Culinary Recipes e/o Cocktail Recipes ai bartender di Colonia",
   "unlock": "Consegna 10 Manufacturing Instructions per conoscere Yi Shen",
   "req_en": "Sell 10 Culinary and/or Cocktail Recipes to bartenders in Colonia / Referral: 10 Manufacturing Instructions"
  },
  "Yi Shen": {
   "system": "Einheriar",
   "base": "Eidolon Hold",
   "body": "1 A",
   "pos": [
    -9557.8125,
    -880.1875,
    19801.5625
   ],
   "colonia": true,
   "discover": "Presentato da Baltanos, Eleanor Bresa e Rosa Dayette",
   "meet": "Completa i referral di Baltanos, Eleanor Bresa e Rosa Dayette",
   "unlock": "",
   "req_en": "Complete the referrals of Baltanos, Eleanor Bresa and Rosa Dayette"
  }
 },
 "materials": {
  "aerogel": {
   "name": "Aerogel",
   "cat": "Components",
   "where": "Armadietti aperti: Laboratorio, Lavorazione · Bartender (baratto)",
   "type": "chimico"
  },
  "airqualityreports": {
   "name": "Air Quality Reports",
   "cat": "Data",
   "where": "Data port: Comando, Habitat, Industriale, Laboratorio, Energia, Sicurezza · ricompensa missioni · Bartender (baratto)"
  },
  "atmosphericdata": {
   "name": "Atmospheric Data",
   "cat": "Data",
   "where": "Data port: Comando · siti planetari (satellite grande) · ricompensa missioni · Bartender (baratto)"
  },
  "audiologs": {
   "name": "Audio Logs",
   "cat": "Data",
   "where": "Data port: Comando, Medico, Sicurezza · ricompensa missioni · Bartender (baratto)"
  },
  "ballisticsdata": {
   "name": "Ballistics Data",
   "cat": "Data",
   "where": "Data port: Comando, Sicurezza · siti planetari (satellite grande, skimmer) · ricompensa missioni · Bartender (baratto)"
  },
  "biometricdata": {
   "name": "Biometric Data",
   "cat": "Data",
   "where": "Data port: Laboratorio, Medico, Sicurezza · ricompensa missioni · Bartender (baratto)"
  },
  "bloodtestresults": {
   "name": "Blood Test Results",
   "cat": "Data",
   "where": "Data port: Medico, Sicurezza · ricompensa missioni · Bartender (baratto)"
  },
  "carbonfibreplating": {
   "name": "Carbon Fibre Plating",
   "cat": "Components",
   "where": "Armadietti aperti: Agricolo, Comando, Estrazione, Habitat, Industriale, Laboratorio, Medico, Energia, Magazzino, Sicurezza, container esterni · Bartender (baratto)",
   "type": "tecnologico"
  },
  "chemicalcatalyst": {
   "name": "Chemical Catalyst",
   "cat": "Components",
   "where": "Armadietti aperti: Laboratorio, Medico · Bartender (baratto)",
   "type": "chimico"
  },
  "chemicalexperimentdata": {
   "name": "Chemical Experiment Data",
   "cat": "Data",
   "where": "Data port: Industriale, Laboratorio, Medico · ricompensa missioni · Bartender (baratto)"
  },
  "chemicalformulae": {
   "name": "Chemical Formulae",
   "cat": "Data",
   "where": "Data port: Industriale · ricompensa missioni · Bartender (baratto)"
  },
  "chemicalinventory": {
   "name": "Chemical Inventory",
   "cat": "Data",
   "where": "Data port: Industriale, Laboratorio, Medico · ricompensa missioni · Bartender (baratto)"
  },
  "chemicalpatents": {
   "name": "Chemical Patents",
   "cat": "Data",
   "where": "Data port: Comando, Industriale, Laboratorio, Medico · ricompensa missioni · Bartender (baratto)"
  },
  "chemicalsuperbase": {
   "name": "Chemical Superbase",
   "cat": "Components",
   "where": "Armadietti aperti: Laboratorio, Medico · Bartender (baratto)",
   "type": "chimico"
  },
  "circuitboard": {
   "name": "Circuit Board",
   "cat": "Components",
   "where": "Armadietti aperti: Agricolo, Comando, Estrazione, Habitat, Industriale, Laboratorio, Medico, Energia, Magazzino, Sicurezza, container esterni · siti planetari (satellite grande, satellite piccolo, relitti, segnali SRV) · Bartender (baratto)",
   "type": "circuito"
  },
  "circuitswitch": {
   "name": "Circuit Switch",
   "cat": "Components",
   "where": "Armadietti aperti: Dormitorio, Laboratorio, Operazioni, Lavorazione, Sicurezza, Magazzino · siti planetari (satellite grande, satellite piccolo, relitti, segnali SRV) · Bartender (baratto)",
   "type": "circuito"
  },
  "combatantperformance": {
   "name": "Combatant Performance",
   "cat": "Data",
   "where": "Data port: Habitat, Sicurezza · ricompensa missioni · Bartender (baratto)"
  },
  "combattrainingmaterial": {
   "name": "Combat Training Material",
   "cat": "Data",
   "where": "Data port: Sicurezza · ricompensa missioni · Bartender (baratto)"
  },
  "compressionliquefiedgas": {
   "name": "Compression-Liquefied Gas",
   "cat": "Items",
   "where": "Armadietti sigillati: Comando, Habitat, Laboratorio, Medico · ricompensa missioni · Bartender (baratto)"
  },
  "digitaldesigns": {
   "name": "Digital Designs",
   "cat": "Data",
   "where": "Data port: Comando, Habitat, Laboratorio · ricompensa missioni · Bartender (baratto)"
  },
  "electricalfuse": {
   "name": "Electrical Fuse",
   "cat": "Components",
   "where": "Armadietti aperti: Agricolo, Comando, Estrazione, Habitat, Industriale, Laboratorio, Medico, Energia, Magazzino, Sicurezza, container esterni · siti planetari (satellite grande, satellite piccolo, relitti, segnali SRV) · Bartender (baratto)",
   "type": "circuito"
  },
  "electricalwiring": {
   "name": "Electrical Wiring",
   "cat": "Components",
   "where": "Armadietti aperti: Agricolo, Comando, Estrazione, Habitat, Industriale, Laboratorio, Medico, Energia, Magazzino, Sicurezza, container esterni · siti planetari (satellite grande, satellite piccolo, relitti, segnali SRV) · Bartender (baratto)",
   "type": "circuito"
  },
  "electromagnet": {
   "name": "Electromagnet",
   "cat": "Components",
   "where": "Armadietti aperti: Agricolo, Comando, Estrazione, Habitat, Industriale, Laboratorio, Medico, Energia, Magazzino, Sicurezza, container esterni · siti planetari (satellite grande, satellite piccolo, relitti, segnali SRV) · Bartender (baratto)",
   "type": "circuito"
  },
  "encryptedmemorychip": {
   "name": "Encrypted Memory Chip",
   "cat": "Components",
   "where": "Armadietti aperti: Agricolo, Comando, Estrazione, Habitat, Industriale, Laboratorio, Medico, Energia, Magazzino, Sicurezza, container esterni · Bartender (baratto)",
   "type": "tecnologico"
  },
  "epinephrine": {
   "name": "Epinephrine",
   "cat": "Components",
   "where": "Armadietti aperti: Laboratorio, Medico · Bartender (baratto)",
   "type": "chimico"
  },
  "epoxyadhesive": {
   "name": "Epoxy Adhesive",
   "cat": "Components",
   "where": "Armadietti aperti: Laboratorio, Medico · Bartender (baratto)",
   "type": "chimico"
  },
  "evacuationprotocols": {
   "name": "Evacuation Protocols",
   "cat": "Data",
   "where": "Data port: Estrazione, Habitat, Laboratorio, Medico, Energia, Sicurezza · ricompensa missioni · Bartender (baratto)"
  },
  "extractionyielddata": {
   "name": "Extraction Yield Data",
   "cat": "Data",
   "where": "Data port: Estrazione · ricompensa missioni · Bartender (baratto)"
  },
  "genesequencingdata": {
   "name": "Gene Sequencing Data",
   "cat": "Data",
   "where": "Data port: Laboratorio, Medico · ricompensa missioni · Bartender (baratto)"
  },
  "geneticresearch": {
   "name": "Genetic Research",
   "cat": "Data",
   "where": "Data port: Medico · ricompensa missioni · Bartender (baratto)"
  },
  "gmeds": {
   "name": "G-Meds",
   "cat": "Items",
   "where": "Armadietti sigillati: Estrazione, Industriale, Medico · ricompensa missioni · Bartender (baratto)"
  },
  "graphene": {
   "name": "Graphene",
   "cat": "Components",
   "where": "Armadietti aperti: Agricolo, Habitat, Laboratorio, Sicurezza · Bartender (baratto)",
   "type": "chimico"
  },
  "healthmonitor": {
   "name": "Health Monitor",
   "cat": "Items",
   "where": "Armadietti sigillati: Comando, Habitat, Medico · ricompensa missioni · Bartender (baratto)"
  },
  "ionbattery": {
   "name": "Ion Battery",
   "cat": "Components",
   "where": "Armadietti aperti: Agricolo, Comando, Estrazione, Habitat, Industriale, Laboratorio, Medico, Energia, Magazzino, Sicurezza, container esterni · siti planetari (satellite grande, satellite piccolo, relitti, segnali SRV) · Bartender (baratto)",
   "type": "circuito"
  },
  "ionisedgas": {
   "name": "Ionised Gas",
   "cat": "Items",
   "where": "Armadietti sigillati: Estrazione, Industriale, Laboratorio, Energia · ricompensa missioni · Bartender (baratto)"
  },
  "maintenancelogs": {
   "name": "Maintenance Logs",
   "cat": "Data",
   "where": "Data port: Comando, Estrazione, Industriale, Laboratorio, Medico, Energia · siti planetari (skimmer) · ricompensa missioni · Bartender (baratto)"
  },
  "manufacturinginstructions": {
   "name": "Manufacturing Instructions",
   "cat": "Data",
   "where": "Data port: Comando, Industriale, Laboratorio · siti planetari (satellite piccolo, satellite grande, skimmer) · ricompensa missioni · Bartender (baratto)"
  },
  "medicalrecords": {
   "name": "Medical Records",
   "cat": "Data",
   "where": "Data port: Medico, Sicurezza · ricompensa missioni · Bartender (baratto)"
  },
  "medicaltrialrecords": {
   "name": "Clinical Trial Records",
   "cat": "Data",
   "where": "Data port: Laboratorio · ricompensa missioni · Bartender (baratto)"
  },
  "memorychip": {
   "name": "Memory Chip",
   "cat": "Components",
   "where": "Armadietti aperti: Agricolo, Comando, Estrazione, Habitat, Industriale, Laboratorio, Medico, Energia, Magazzino, Sicurezza, container esterni · Bartender (baratto)",
   "type": "tecnologico"
  },
  "metalcoil": {
   "name": "Metal Coil",
   "cat": "Components",
   "where": "Armadietti aperti: Agricolo, Comando, Estrazione, Habitat, Industriale, Laboratorio, Medico, Energia, Magazzino, Sicurezza, container esterni · siti planetari (satellite grande, satellite piccolo, relitti, segnali SRV) · Bartender (baratto)",
   "type": "circuito"
  },
  "microelectrode": {
   "name": "Microelectrode",
   "cat": "Components",
   "where": "Armadietti aperti: Agricolo, Comando, Estrazione, Habitat, Industriale, Laboratorio, Medico, Energia, Magazzino, Sicurezza, container esterni · siti planetari (satellite grande, satellite piccolo, relitti, segnali SRV) · Bartender (baratto)",
   "type": "circuito"
  },
  "microhydraulics": {
   "name": "Micro Hydraulics",
   "cat": "Components",
   "where": "Armadietti aperti: Agricolo, Comando, Estrazione, Habitat, Industriale, Laboratorio, Medico, Energia, Magazzino, Sicurezza, container esterni · Bartender (baratto)",
   "type": "tecnologico"
  },
  "microsupercapacitor": {
   "name": "Micro Supercapacitor",
   "cat": "Components",
   "where": "Armadietti aperti: Agricolo, Comando, Estrazione, Habitat, Industriale, Laboratorio, Medico, Energia, Magazzino, Sicurezza, container esterni · siti planetari (satellite grande, satellite piccolo, relitti, segnali SRV) · Bartender (baratto)",
   "type": "circuito"
  },
  "microthrusters": {
   "name": "Micro Thrusters",
   "cat": "Components",
   "where": "Armadietti aperti: Agricolo, Comando, Estrazione, Habitat, Industriale, Laboratorio, Medico, Energia, Magazzino, Sicurezza, container esterni · Bartender (baratto)",
   "type": "tecnologico"
  },
  "microtransformer": {
   "name": "Micro Transformer",
   "cat": "Components",
   "where": "Armadietti aperti: Agricolo, Comando, Estrazione, Habitat, Industriale, Laboratorio, Medico, Energia, Magazzino, Sicurezza, container esterni · siti planetari (satellite grande, satellite piccolo, relitti, segnali SRV) · Bartender (baratto)",
   "type": "circuito"
  },
  "mineralsurvey": {
   "name": "Mineral Survey",
   "cat": "Data",
   "where": "Data port: Industriale, Laboratorio · siti planetari (satellite grande) · ricompensa missioni · Bartender (baratto)"
  },
  "mininganalytics": {
   "name": "Mining Analytics",
   "cat": "Data",
   "where": "Data port: Estrazione · ricompensa missioni · Bartender (baratto)"
  },
  "motor": {
   "name": "Motor",
   "cat": "Components",
   "where": "Armadietti aperti: Agricolo, Comando, Estrazione, Habitat, Industriale, Laboratorio, Medico, Energia, Magazzino, Sicurezza, container esterni · siti planetari (satellite grande, satellite piccolo, relitti, segnali SRV) · Bartender (baratto)",
   "type": "circuito"
  },
  "nocdata": {
   "name": "NOC Data",
   "cat": "Data",
   "where": "Data port: Sicurezza · siti planetari (satellite piccolo) · ricompensa missioni · Bartender (baratto)"
  },
  "operationalmanual": {
   "name": "Operational Manual",
   "cat": "Data",
   "where": "Data port: Industriale, Laboratorio, Medico · siti planetari (satellite piccolo, satellite grande, skimmer) · ricompensa missioni · Bartender (baratto)"
  },
  "opticalfibre": {
   "name": "Optical Fibre",
   "cat": "Components",
   "where": "Armadietti aperti: Agricolo, Comando, Estrazione, Habitat, Industriale, Laboratorio, Medico, Energia, Magazzino, Sicurezza, container esterni · siti planetari (satellite grande, satellite piccolo, relitti, segnali SRV) · Bartender (baratto)",
   "type": "circuito"
  },
  "opticallens": {
   "name": "Optical Lens",
   "cat": "Components",
   "where": "Armadietti aperti: Agricolo, Comando, Estrazione, Habitat, Industriale, Laboratorio, Medico, Energia, Magazzino, Sicurezza, container esterni · Bartender (baratto)",
   "type": "tecnologico"
  },
  "oxygenicbacteria": {
   "name": "Oxygenic Bacteria",
   "cat": "Components",
   "where": "Armadietti aperti: Laboratorio, Medico · Bartender (baratto)",
   "type": "chimico"
  },
  "patrolroutes": {
   "name": "Patrol Routes",
   "cat": "Data",
   "where": "Data port: Comando, Sicurezza · siti planetari (skimmer) · ricompensa missioni · Bartender (baratto)"
  },
  "pharmaceuticalpatents": {
   "name": "Pharmaceutical Patents",
   "cat": "Data",
   "where": "Data port: Comando, Medico · ricompensa missioni · Bartender (baratto)"
  },
  "phneutraliser": {
   "name": "pH Neutraliser",
   "cat": "Components",
   "where": "Armadietti aperti: Laboratorio, Medico · Bartender (baratto)",
   "type": "chimico"
  },
  "productionreports": {
   "name": "Production Reports",
   "cat": "Data",
   "where": "Data port: Industriale, Laboratorio · ricompensa missioni · Bartender (baratto)"
  },
  "productionschedule": {
   "name": "Production Schedule",
   "cat": "Data",
   "where": "Data port: Industriale, Laboratorio · ricompensa missioni · Bartender (baratto)"
  },
  "radioactivitydata": {
   "name": "Radioactivity Data",
   "cat": "Data",
   "where": "Data port: Comando, Laboratorio, Medico, Energia · siti planetari (satellite grande) · ricompensa missioni · Bartender (baratto)"
  },
  "rdx": {
   "name": "RDX",
   "cat": "Components",
   "where": "Armadietti aperti: Laboratorio, Medico · Bartender (baratto)",
   "type": "chimico"
  },
  "reactoroutputreview": {
   "name": "Reactor Output Review",
   "cat": "Data",
   "where": "Data port: Comando, Industriale, Laboratorio, Energia · ricompensa missioni · Bartender (baratto)"
  },
  "recyclinglogs": {
   "name": "Recycling Logs",
   "cat": "Data",
   "where": "Data port: Comando, Habitat · ricompensa missioni · Bartender (baratto)"
  },
  "riskassessments": {
   "name": "Risk Assessments",
   "cat": "Data",
   "where": "Data port: Comando, Industriale, Laboratorio, Sicurezza · ricompensa missioni · Bartender (baratto)"
  },
  "scrambler": {
   "name": "Scrambler",
   "cat": "Components",
   "where": "Armadietti aperti: Agricolo, Comando, Estrazione, Habitat, Industriale, Laboratorio, Medico, Energia, Magazzino, Sicurezza, container esterni · Bartender (baratto)",
   "type": "tecnologico"
  },
  "securityexpenses": {
   "name": "Security Expenses",
   "cat": "Data",
   "where": "Data port: Comando, Sicurezza · ricompensa missioni · Bartender (baratto)"
  },
  "settlementassaultplans": {
   "name": "Settlement Assault Plans",
   "cat": "Data",
   "where": "Data port: Sicurezza · ricompensa missioni · Bartender (baratto)"
  },
  "spectralanalysisdata": {
   "name": "Spectral Analysis Data",
   "cat": "Data",
   "where": "Data port: Industriale · ricompensa missioni · Bartender (baratto)"
  },
  "stellaractivitylogs": {
   "name": "Stellar Activity Logs",
   "cat": "Data",
   "where": "Data port: Industriale, Laboratorio · siti planetari (satellite grande) · ricompensa missioni · Bartender (baratto)"
  },
  "suitschematic": {
   "name": "Suit Schematic",
   "cat": "Items",
   "where": "Armadietti sigillati: Comando, Energia · ricompensa missioni · Bartender (baratto)"
  },
  "surveillanceequipment": {
   "name": "Surveillance Equipment",
   "cat": "Items",
   "where": "Armadietti sigillati: Comando, Medico, Sicurezza · ricompensa missioni · Bartender (baratto)"
  },
  "surveilleancelogs": {
   "name": "Surveillance Logs",
   "cat": "Data",
   "where": "siti planetari (satellite piccolo, skimmer) · ricompensa missioni · Bartender (baratto)"
  },
  "tacticalplans": {
   "name": "Tactical Plans",
   "cat": "Data",
   "where": "Data port: Sicurezza · ricompensa missioni · Bartender (baratto)"
  },
  "titaniumplating": {
   "name": "Titanium Plating",
   "cat": "Components",
   "where": "Armadietti aperti: Lavorazione, Energia · Bartender (baratto)",
   "type": "tecnologico"
  },
  "topographicalsurveys": {
   "name": "Topographical Surveys",
   "cat": "Data",
   "where": "Data port: Laboratorio · siti planetari (satellite grande) · ricompensa missioni · Bartender (baratto)"
  },
  "transmitter": {
   "name": "Transmitter",
   "cat": "Components",
   "where": "Armadietti aperti: Agricolo, Comando, Estrazione, Habitat, Industriale, Laboratorio, Medico, Energia, Magazzino, Sicurezza, container esterni · Bartender (baratto)",
   "type": "tecnologico"
  },
  "troopdeploymentrecords": {
   "name": "Troop Deployment Records",
   "cat": "Data",
   "where": "Data port: Sicurezza · ricompensa missioni · Bartender (baratto)"
  },
  "tungstencarbide": {
   "name": "Tungsten Carbide",
   "cat": "Components",
   "where": "Armadietti aperti: Agricolo, Comando, Estrazione, Habitat, Industriale, Laboratorio, Medico, Energia, Magazzino, Sicurezza, container esterni · Bartender (baratto)",
   "type": "tecnologico"
  },
  "viscoelasticpolymer": {
   "name": "Viscoelastic Polymer",
   "cat": "Components",
   "where": "Armadietti aperti: Laboratorio, Medico · Bartender (baratto)",
   "type": "chimico"
  },
  "weaponcomponent": {
   "name": "Weapon Component",
   "cat": "Components",
   "where": "Armadietti aperti: Agricolo, Comando, Estrazione, Habitat, Industriale, Laboratorio, Medico, Energia, Magazzino, Sicurezza, container esterni · Bartender (baratto)",
   "type": "tecnologico"
  },
  "weaponinventory": {
   "name": "Weapon Inventory",
   "cat": "Data",
   "where": "Data port: Comando, Sicurezza · ricompensa missioni · Bartender (baratto)"
  },
  "weaponschematic": {
   "name": "Weapon Schematic",
   "cat": "Items",
   "where": "Armadietti sigillati: Comando, Energia · ricompensa missioni · Bartender (baratto)"
  },
  "weapontestdata": {
   "name": "Weapon Test Data",
   "cat": "Data",
   "where": "Data port: Comando, Sicurezza · ricompensa missioni · Bartender (baratto)"
  }
 }
};
