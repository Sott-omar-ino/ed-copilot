"""Dati statici di Elite Dangerous usati dall'helper."""

# Valore base (Cr) delle specie esobiologiche (valori attuali, dopo il ritocco di Vista Genomics del 2022).
# Fonte: catalogo del plugin EDMC-BioScan (github.com/Silarn/EDMC-BioScan, bio_data/rulesets/*.py), controllato
# voce per voce l'08/11/2026. Concha Biconcavis vale davvero 16.777.215 Cr.
# I valori incassati realmente (SellOrganicData) sovrascrivono questi.
SPECIES_VALUES = {
    "Aleoida Arcus": 7252500, "Aleoida Coronamus": 6284600, "Aleoida Gravis": 12934900,
    "Aleoida Laminiae": 3385200, "Aleoida Spica": 3385200,
    "Bacterium Acies": 1000000, "Bacterium Alcyoneum": 1658500, "Bacterium Aurasus": 1000000,
    "Bacterium Bullaris": 1152500, "Bacterium Cerbrus": 1689800, "Bacterium Informem": 8418000,
    "Bacterium Nebulus": 5289900, "Bacterium Omentum": 4638900, "Bacterium Scopulum": 4934500,
    "Bacterium Tela": 1949000, "Bacterium Verrata": 3897000, "Bacterium Vesicula": 1000000,
    "Bacterium Volu": 7774700,
    "Cactoida Cortexum": 3667600, "Cactoida Lapis": 2483600, "Cactoida Peperatis": 2483600,
    "Cactoida Pullulanta": 3667600, "Cactoida Vermis": 16202800,
    "Clypeus Lacrimam": 8418000, "Clypeus Margaritus": 11873200, "Clypeus Speculumi": 16202800,
    "Concha Aureolas": 7774700, "Concha Biconcavis": 16777215, "Concha Labiata": 2352400,
    "Concha Renibus": 4572400,
    "Electricae Pluma": 6284600, "Electricae Radialem": 6284600,
    "Fonticulua Campestris": 1000000, "Fonticulua Digitos": 1804100, "Fonticulua Fluctus": 20000000,
    "Fonticulua Lapida": 3111000, "Fonticulua Segmentatus": 19010800, "Fonticulua Upupam": 5727600,
    "Frutexa Acus": 7774700, "Frutexa Collum": 1639800, "Frutexa Fera": 1632500,
    "Frutexa Flabellum": 1808900, "Frutexa Flammasis": 10326000, "Frutexa Metallicum": 1632500,
    "Frutexa Sponsae": 5988000,
    "Fumerola Aquatis": 6284600, "Fumerola Carbosis": 6284600, "Fumerola Extremus": 16202800,
    "Fumerola Nitris": 7500900,
    "Fungoida Bullarum": 3703200, "Fungoida Gelata": 3330300, "Fungoida Setisis": 1670100,
    "Fungoida Stabitis": 2680300,
    "Osseus Cornibus": 1483000, "Osseus Discus": 12934900, "Osseus Fractus": 4027800,
    "Osseus Pellebantus": 9739000, "Osseus Pumice": 3156300, "Osseus Spiralis": 2404700,
    "Recepta Conditivus": 14313700, "Recepta Deltahedronix": 16202800, "Recepta Umbrux": 12934900,
    "Stratum Araneamus": 2448900, "Stratum Cucumisis": 16202800, "Stratum Excutitus": 2448900,
    "Stratum Frigus": 2637500, "Stratum Laminamus": 2788300, "Stratum Limaxus": 1362000,
    "Stratum Paleas": 1362000, "Stratum Tectonicas": 19010800,
    "Tubus Cavas": 11873200, "Tubus Compagibus": 7774700, "Tubus Conifer": 2415500,
    "Tubus Rosarium": 2637500, "Tubus Sororibus": 5727600,
    "Tussock Albata": 3252500, "Tussock Capillum": 7025800, "Tussock Caputus": 3472400,
    "Tussock Catena": 1766600, "Tussock Cultro": 1766600, "Tussock Divisa": 1766600,
    "Tussock Ignis": 1849000, "Tussock Pennata": 5853800, "Tussock Pennatis": 1000000,
    "Tussock Propagito": 1000000, "Tussock Serrati": 4447100, "Tussock Stigmasis": 19010800,
    "Tussock Triticum": 7774700, "Tussock Ventusa": 3227700, "Tussock Virgam": 14313700,
    "Amphora Plant": 1628800, "Bark Mounds": 1471900, "Crystalline Shards": 1628800,
}

# Distanza minima (m) tra un campione e l'altro ("colony range"), per genere.
# Fonte: EDMC-ExploData (github.com/Silarn/EDMC-ExploData, explo_data/bio_data/genus.py), controllata l'08/11/2026.
GENUS_DISTANCE = {
    "Aleoida": 150, "Bacterium": 500, "Cactoida": 300, "Clypeus": 150, "Concha": 150,
    "Electricae": 1000, "Fonticulua": 500, "Frutexa": 150, "Fumerola": 100, "Fungoida": 300,
    "Osseus": 800, "Recepta": 150, "Stratum": 500, "Tubus": 800, "Tussock": 200,
}

SCOOPABLE = set("KGBFOAM")

# Ranghi in italiano (Elite non ha una localizzazione italiana ufficiale: traduzioni nostre).
RANKS = {
    "Combat": ["Innocuo", "Quasi innocuo", "Novizio", "Competente", "Esperto", "Maestro",
               "Pericoloso", "Letale", "Elite", "Elite I", "Elite II", "Elite III", "Elite IV", "Elite V"],
    "Trade": ["Squattrinato", "Quasi squattrinato", "Venditore ambulante", "Commerciante", "Mercante", "Intermediario",
              "Imprenditore", "Magnate", "Elite", "Elite I", "Elite II", "Elite III", "Elite IV", "Elite V"],
    "Explore": ["Senza meta", "Quasi senza meta", "Esploratore", "Topografo", "Apripista", "Battistrada",
                "Ranger", "Pioniere", "Elite", "Elite I", "Elite II", "Elite III", "Elite IV", "Elite V"],
    "Soldier": ["Indifeso", "Quasi indifeso", "Recluta", "Soldato", "Pistolero", "Guerriero",
                "Gladiatore", "Tiratore infallibile", "Elite", "Elite I", "Elite II", "Elite III", "Elite IV", "Elite V"],
    "Exobiologist": ["Senza direzione", "Quasi senza direzione", "Compilatore", "Collezionista", "Catalogatore",
                     "Tassonomista", "Ecologo", "Genetista", "Elite", "Elite I", "Elite II", "Elite III", "Elite IV", "Elite V"],
    "Empire": ["Nessuno", "Estraneo", "Servo", "Padrone", "Scudiero", "Cavaliere", "Signore", "Barone", "Visconte",
               "Conte", "Conte palatino", "Marchese", "Duca", "Principe", "Re"],
    "Federation": ["Nessuno", "Recluta", "Cadetto", "Allievo ufficiale", "Sottufficiale", "Capo sottufficiale",
                   "Maresciallo", "Guardiamarina", "Tenente di vascello", "Capitano di corvetta", "Capitano di fregata",
                   "Capitano di vascello", "Contrammiraglio", "Viceammiraglio", "Ammiraglio"],
}
# Nomi originali inglesi, per chi preferisce vedere i termini del gioco.
RANKS_EN = {
    "Combat": ["Harmless", "Mostly Harmless", "Novice", "Competent", "Expert", "Master",
               "Dangerous", "Deadly", "Elite", "Elite I", "Elite II", "Elite III", "Elite IV", "Elite V"],
    "Trade": ["Penniless", "Mostly Penniless", "Peddler", "Dealer", "Merchant", "Broker",
              "Entrepreneur", "Tycoon", "Elite", "Elite I", "Elite II", "Elite III", "Elite IV", "Elite V"],
    "Explore": ["Aimless", "Mostly Aimless", "Scout", "Surveyor", "Trailblazer", "Pathfinder",
                "Ranger", "Pioneer", "Elite", "Elite I", "Elite II", "Elite III", "Elite IV", "Elite V"],
    "Soldier": ["Defenceless", "Mostly Defenceless", "Rookie", "Soldier", "Gunslinger", "Warrior",
                "Gladiator", "Deadeye", "Elite", "Elite I", "Elite II", "Elite III", "Elite IV", "Elite V"],
    "Exobiologist": ["Directionless", "Mostly Directionless", "Compiler", "Collector", "Cataloguer",
                     "Taxonomist", "Ecologist", "Geneticist", "Elite", "Elite I", "Elite II",
                     "Elite III", "Elite IV", "Elite V"],
    "Empire": ["None", "Outsider", "Serf", "Master", "Squire", "Knight", "Lord", "Baron", "Viscount",
               "Count", "Earl", "Marquis", "Duke", "Prince", "King"],
    "Federation": ["None", "Recruit", "Cadet", "Midshipman", "Petty Officer", "Chief Petty Officer",
                   "Warrant Officer", "Ensign", "Lieutenant", "Lt. Commander", "Post Commander",
                   "Post Captain", "Rear Admiral", "Vice Admiral", "Admiral"],
}
RANK_LABELS = {"Combat": "Combattimento", "Trade": "Commercio", "Explore": "Esplorazione",
               "Soldier": "Mercenario", "Exobiologist": "Esobiologo", "Empire": "Impero",
               "Federation": "Federazione"}

# Nomi interni delle navi -> nome visualizzato (quando il journal non lo localizza).
# Fonte: EDCD/FDevIDs shipyard.csv.
SHIP_NAMES = {
    "sidewinder": "Sidewinder", "eagle": "Eagle", "hauler": "Hauler", "adder": "Adder",
    "empire_eagle": "Imperial Eagle", "viper": "Viper MkIII", "cobramkiii": "Cobra MkIII",
    "viper_mkiv": "Viper MkIV", "diamondback": "Diamondback Scout", "cobramkiv": "Cobra MkIV",
    "type6": "Type-6 Transporter", "dolphin": "Dolphin", "diamondbackxl": "Diamondback Explorer",
    "empire_courier": "Imperial Courier", "independant_trader": "Keelback", "asp_scout": "Asp Scout",
    "vulture": "Vulture", "asp": "Asp Explorer", "federation_dropship": "Federal Dropship",
    "type7": "Type-7 Transporter", "typex": "Alliance Chieftain", "federation_dropship_mkii": "Federal Assault Ship",
    "empire_trader": "Imperial Clipper", "typex_2": "Alliance Crusader", "typex_3": "Alliance Challenger",
    "federation_gunship": "Federal Gunship", "krait_light": "Krait Phantom", "krait_mkii": "Krait MkII",
    "orca": "Orca", "ferdelance": "Fer-de-Lance", "mamba": "Mamba", "python": "Python",
    "python_nx": "Python MkII", "type9": "Type-9 Heavy", "belugaliner": "Beluga Liner",
    "type9_military": "Type-10 Defender", "anaconda": "Anaconda", "federation_corvette": "Federal Corvette",
    "cutter": "Imperial Cutter", "type8": "Type-8 Transporter", "mandalay": "Mandalay",
    "cobramkv": "Cobra MkV", "corsair": "Corsair", "lakonminer": "Type-11 Prospector",
    "mediumtransport01": "Lynx Highliner", "panthermkii": "Panther Clipper MkII",
    "explorer_nx": "Caspian Explorer", "smallcombat01_nx": "Kestrel MkII", "anacondamkii": "Anaconda Mk II",
}

# Gradi dei materiali (cap: G1 300, G2 250, G3 200, G4 150, G5 100).
# Fonte: EDCD/FDevIDs material.csv (colonna rarity) + EDDiscovery EliteDangerousCore MCMRType.cs (ItemType
# VeryCommon..VeryRare = G1..G5, include i materiali Thargoid più recenti); le due fonti coincidono dove si
# sovrappongono. Cap per grado: limiti di magazzino introdotti con Elite Dangerous: Beyond 3.0 (note di patch Frontier).
GRADE_CAP = {1: 300, 2: 250, 3: 200, 4: 150, 5: 100}
_GRADES = {
    "Raw": [
        "carbon iron lead nickel phosphorus rhenium sulphur",
        "arsenic chromium germanium manganese vanadium zinc zirconium",
        "boron cadmium mercury molybdenum niobium tin tungsten",
        "antimony polonium ruthenium selenium technetium tellurium yttrium",
    ],
    "Manufactured": [
        "basicconductors chemicalstorageunits compactcomposites crystalshards gridresistors "
        "guardian_powercell guardian_sentinel_wreckagecomponents heatconductionwiring mechanicalscrap "
        "salvagedalloys temperedalloys tg_abrasion03 wornshieldemitters",
        "chemicalprocessors conductivecomponents filamentcomposites galvanisingalloys guardian_powerconduit "
        "heatdispersionplate heatresistantceramics hybridcapacitors mechanicalequipment shieldemitters "
        "uncutfocuscrystals unknowncarapace unknowncorechip",
        "chemicaldistillery conductiveceramics electrochemicalarrays focuscrystals "
        "guardian_sentinel_weaponparts guardian_techcomponent heatexchangers highdensitycomposites "
        "mechanicalcomponents phasealloys precipitatedalloys shieldingsensors tg_abrasion02 "
        "tg_biomechanicalconduits tg_causticgeneratorparts tg_causticshard tg_wreckagecomponents "
        "unknownenergycell",
        "chemicalmanipulators compoundshielding conductivepolymers configurablecomponents "
        "fedproprietarycomposites heatvanes polymercapacitors protolightalloys refinedfocuscrystals "
        "tg_causticcrystal tg_weaponparts thermicalloys unknowntechnologycomponents",
        "biotechconductors exquisitefocuscrystals fedcorecomposites imperialshielding improvisedcomponents "
        "militarygradealloys militarysupercapacitors pharmaceuticalisolators protoheatradiators "
        "protoradiolicalloys tg_abrasion01 tg_propulsionelement unknownenergysource unknownorganiccircuitry",
    ],
    "Encoded": [
        "bulkscandata disruptedwakeechoes encryptedfiles legacyfirmware scrambledemissiondata "
        "shieldcyclerecordings",
        "archivedemissiondata consumerfirmware encryptioncodes fsdtelemetry scanarchives shieldsoakanalysis "
        "tg_structuraldata",
        "emissiondata industrialfirmware scandatabanks shielddensityreports symmetrickeys tg_compositiondata "
        "tg_interdictiondata tg_shipflightdata tg_shutdowndata tg_structuraldata02 unknownshipsignature "
        "wakesolutions",
        "ancientbiologicaldata ancientculturaldata ancienthistoricaldata ancientlanguagedata "
        "ancienttechnologicaldata decodedemissiondata encodedscandata encryptionarchives "
        "guardian_moduleblueprint guardian_weaponblueprint hyperspacetrajectories securityfirmware "
        "shieldpatternanalysis tg_residuedata tg_shipsystemsdata unknownwakedata",
        "adaptiveencryptors classifiedscandata compactemissionsdata dataminedwake embeddedfirmware "
        "guardian_vesselblueprint shieldfrequencydata",
    ],
}
MATERIAL_GRADE = {}
for _cat, _rows in _GRADES.items():
    for _g, _row in enumerate(_rows, start=1):
        for _name in _row.split():
            MATERIAL_GRADE.setdefault(_name, _g)

# Ingegneri: nome -> (sistema, base, tipo, specialità con grado massimo).
# Fonti (verificate nov 2026): inara.cz/elite/engineers (sistema, base, moduli e grado massimo, modifiche a piedi),
# EDCD/coriolis-data modifications/modules.json (ingegneri per grado di ogni blueprint, stessi gradi massimi),
# elite-dangerous.fandom.com (pagine dei singoli ingegneri). Colonia = Mel Brandon, Etienne Dorn, Marsha Hicks,
# Petra Olmanova (nave) e Baltanos, Eleanor Bresa, Rosa Dayette, Yi Shen (a piedi). Chloe Sedesi NON è in Colonia:
# Cinder Dock (Shenve) è nella Witch Head Nebula, a qualche centinaio di al dalla bolla.
ENGINEERS = {
    # Nave
    "Felicity Farseer": ("Deciat", "Farseer Inc", "ship",
                         "FSD G5 · Thrusters, Sensors, Detailed Surface Scanner G3 · Interdictor, Power Plant, Shield Booster G1"),
    "Elvira Martuuk": ("Khun", "Long Sight Base", "ship", "FSD G5 · Shield Generator G3 · Thrusters G2 · Shield Cell Bank G1"),
    "The Dweller": ("Wyrd", "Black Hide", "ship", "Power Distributor G5 · Pulse Laser G4 · Beam Laser, Burst Laser G3"),
    "Liz Ryder": ("Eurybia", "Demolition Unlimited", "ship",
                  "Missile Rack, Seeker Missile Rack, Torpedo Pylon G5 · Mine Launcher, mining tools G3 · Armour, Hull Reinforcement G1"),
    "Tod 'The Blaster' McQuinn": ("Wolf 397", "Trophy Camp", "ship", "Multi-cannon, Rail Gun G5 · Fragment Cannon G3 · Cannon G2"),
    "Zacariah Nemo": ("Yoru", "Nemo Cyber Party Base", "ship", "Fragment Cannon G5 · Multi-cannon G3 · Plasma Accelerator G2"),
    "Lei Cheung": ("Laksak", "Trader's Rest", "ship", "Shield Generator, Sensors, Detailed Surface Scanner G5 · Shield Booster G3"),
    "Hera Tani": ("Kuwemaki", "The Jet's Hole", "ship", "Power Plant, Detailed Surface Scanner G5 · Power Distributor, Sensors G3"),
    "Juri Ishmaak": ("Giryak", "Pater's Memorial", "ship",
                     "Mine Launcher, mining tools, Sensors, Detailed Surface Scanner G5 · missili, scanner G3"),
    "Selene Jean": ("Kuk", "Prospector's Rest", "ship", "Armour, Hull Reinforcement, Module Reinforcement G5"),
    "Marco Qwent": ("Sirius", "Qwent Research Base", "ship", "Power Plant G4 · Power Distributor G3"),
    "Ram Tah": ("Meene", "Phoenix Base", "ship",
                "Chaff, ECM, Heat Sink Launcher, Point Defence G5 · limpet controller G3-G4 · Cargo Rack G4"),
    "Broo Tarquin": ("Muang", "Broo's Legacy", "ship", "Beam Laser, Burst Laser, Pulse Laser G5"),
    "Colonel Bris Dekker": ("Sol", "Dekker's Yard", "ship", "Interdictor G4 · FSD G3"),
    "Didi Vatermann": ("Leesti", "Vatermann LLC", "ship", "Shield Booster G5 · Shield Generator G3"),
    "Professor Palin": ("Arque", "Abel Laboratory", "ship", "Thrusters G5 · FSD G3"),
    "Lori Jameson": ("Shinrarta Dezhra", "Jameson Base", "ship",
                     "Sensors, Detailed Surface Scanner G5 · AFMU, Fuel Scoop, Life Support, Refinery G4 · scanner, Shield Cell Bank G3"),
    "Tiana Fortune": ("Achenar", "Fortune's Loss", "ship",
                      "Sensors, scanner, limpet controller G5 · Cargo Rack G4 · Detailed Surface Scanner, Interdictor G3"),
    "The Sarge": ("Beta-3 Tucani", "The Beach", "ship", "Cannon, limpet controller G5 · Rail Gun G3"),
    "Bill Turner": ("Alioth", "Turner Metallics Inc", "ship",
                    "Plasma Accelerator, Sensors, Detailed Surface Scanner G5 · Cargo Rack G4 · AFMU, Fuel Scoop, Life Support, Refinery, scanner G3"),
    "Etienne Dorn": ("Los", "Kraken's Retreat", "ship",
                     "Power Plant, Power Distributor, Rail Gun, Plasma Accelerator, Life Support, Sensors, scanner G5 (Colonia)"),
    "Marsha Hicks": ("Tir", "The Watchtower", "ship",
                     "Cannon, Multi-cannon, Fragment Cannon, Fuel Scoop, Refinery, limpet controller G5 (Colonia)"),
    "Mel Brandon": ("Luchtaine", "The Brig", "ship",
                    "FSD, Thrusters, Shield Generator, Shield Booster, Interdictor, laser G5 · Shield Cell Bank G4 (Colonia)"),
    "Petra Olmanova": ("Asura", "Sanctuary", "ship",
                       "Armour, Hull/Module Reinforcement, missili, Mine Launcher, Chaff, ECM, Heat Sink, Point Defence, AFMU G5 (Colonia)"),
    "Chloe Sedesi": ("Shenve", "Cinder Dock", "ship", "Thrusters G5 · FSD G3 (Witch Head Nebula)"),
    # A piedi (Odyssey): modifiche offerte (nomi del gioco), da inara.cz/elite/engineers.
    "Domino Green": ("Orishis", "The Jackrabbit", "suit",
                     "Greater Range, Stability · Enhanced Tracking, Extra Backpack Capacity, Reduced Tool Battery Consumption"),
    "Hero Ferrari": ("Siris", "Nevermore Terrace", "suit",
                     "Faster Handling, Noise Suppressor · Increased Sprint Duration, Improved Jump Assist, Increased Air Reserves"),
    "Jude Navarro": ("Aurai", "Marshall's Drift", "suit",
                     "Reload Speed, Magazine Size · Extra Ammo Capacity, Damage Resistance, Added Melee Damage"),
    "Kit Fowler": ("Capoya", "The Last Call", "suit",
                   "Stowed Reloading, Magazine Size · Added Melee Damage, Faster Shield Regen, Extra Ammo Capacity"),
    "Oden Geiger": ("Candiaei", "Ankh's Promise", "suit",
                    "Stability, Scope · Enhanced Tracking, Improved Battery Capacity, Night Vision"),
    "Terra Velasquez": ("Shou Xing", "Rascal's Choice", "suit",
                        "Improved Hip Fire Accuracy, Noise Suppressor · Increased Sprint Duration, Combat Movement Speed, Increased Air Reserves"),
    "Uma Laszlo": ("Xuane", "Laszlo's Resolve", "suit",
                   "Reload Speed, Stowed Reloading, Headshot Damage · Damage Resistance, Faster Shield Regen"),
    "Wellington Beck": ("Jolapa", "Beck Facility", "suit",
                        "Greater Range, Scope · Reduced Tool Battery Consumption, Improved Battery Capacity, Extra Backpack Capacity"),
    "Yarden Bond": ("Bayan", "Salamander Bank", "suit",
                    "Faster Handling, Improved Hip Fire Accuracy, Audio Masking · Improved Jump Assist, Combat Movement Speed, Quieter Footsteps"),
    "Baltanos": ("Deriso", "The Divine Apparatus", "suit",
                 "Noise Suppressor, Improved Hip Fire Accuracy, Faster Handling · Improved Jump Assist, Increased Air Reserves, "
                 "Increased Sprint Duration, Combat Movement Speed (Colonia)"),
    "Eleanor Bresa": ("Desy", "Bresa Modifications", "suit",
                      "Magazine Size, Reload Speed, Stowed Reloading · Added Melee Damage, Damage Resistance, Extra Ammo Capacity, "
                      "Faster Shield Regen (Colonia)"),
    "Rosa Dayette": ("Kojeara", "Rosa's Shop", "suit",
                     "Greater Range, Scope, Stability · Extra Backpack Capacity, Enhanced Tracking, Reduced Tool Battery Consumption, "
                     "Improved Battery Capacity (Colonia)"),
    "Yi Shen": ("Einheriar", "Eidolon Hold", "suit", "Audio Masking, Headshot Damage · Quieter Footsteps, Night Vision (Colonia)"),
}
# Nome usato da alcune fonti/journal -> nome in ENGINEERS.
ENGINEER_ALIASES = {"Tod McQuinn": "Tod 'The Blaster' McQuinn"}

# Luoghi più usati dai giocatori.
PLACES = [
    ("Hub e luoghi famosi", [
        ("Shinrarta Dezhra", "Jameson Memorial: tutte le navi e i moduli, serve il permesso (rango Elite)."),
        ("Sol", "Sistema natale della Federazione: serve il permesso (rango federale Sottufficiale / Petty Officer)."),
        ("Achenar", "Capitale dell'Impero: serve il permesso (rango imperiale Scudiero / Squire)."),
        ("Alioth", "Capitale dell'Alleanza: serve il permesso (missioni dell'Alleanza)."),
        ("Colonia", "Jaques Station, capitale della regione di Colonia (~22.000 al)."),
        ("Alpha Centauri", "Hutton Orbital a ~0,22 al dalla stella: la Hutton Mug, un classico."),
    ]),
    ("Materiali", [
        ("HIP 12099", "Pianeta 1 B, luogo dello schianto di Jameson: dati codificati G5 (si raccolgono ripetutamente rientrando in gioco)."),
        ("Hyades Sector DR-V c2-23", "Dav's Hope (A 5): materiali manufatti G3-G5 nelle rovine."),
        ("HIP 36601", "Pianeti C 1 a, C 1 d, C 3 b: formazioni cristalline con materiali grezzi G4-G5."),
        ("Outotz LS-K d8-3", "Pianeti B 5 a/c: altre formazioni cristalline per i materiali grezzi."),
        ("Synuefe XR-H d11-102", "Pianeta 1 b: Ancient Ruins (Beta) dei Guardian, per i Pattern Obelisk Data. I siti dei blueprint sono nella scheda Guardian."),
    ]),
    ("Esplorazione", [
        ("Sagittarius A*", "Il buco nero supermassiccio al centro della galassia."),
        ("Beagle Point", "La meta classica più lontana, a ~65.000 al da Sol."),
        ("Maia", "Pleiadi, ~380 al da Sol: zona di confine con i Thargoid."),
        ("Jackson's Lighthouse", "Nebulosa con una stella di neutroni al centro: un panorama celebre."),
    ]),
]

# Servizi delle stazioni come li chiama Spansh, con etichetta italiana.
SERVICES = [
    ("Material Trader", "Mercante di materiali"),
    ("Technology Broker", "Broker tecnologico"),
    ("Interstellar Factors Contact", "Interstellar Factors (multe e taglie)"),
    ("Universal Cartographics", "Universal Cartographics (dati esplorativi)"),
    ("Vista Genomics", "Vista Genomics (dati biologici)"),
    ("Shipyard", "Cantiere navale"),
    ("Outfitting", "Equipaggiamento"),
    ("Black Market", "Mercato nero"),
    ("Pioneer Supplies", "Pioneer Supplies (equipaggiamento a piedi)"),
    ("Frontline Solutions", "Frontline Solutions (zone di conflitto)"),
    ("Apex Interstellar", "Apex Interstellar (navette)"),
    ("Bartender", "Barista (scambio materiali Odyssey)"),
    ("Refuel", "Rifornimento"),
    ("Repair", "Riparazioni"),
]

# --- Moduli delle navi (per leggere le build dai Loadout) ---------------------

# Prefisso del nome interno (senza int_/hpt_) -> nome visualizzato. Il primo che combacia vince.
# Prefisso del nome interno -> nome in gioco. Verificato su EDCD/FDevIDs outfitting.csv (nov 2026).
MODULE_NAMES = [
    ("hyperdrive_overcharge", "Frame Shift Drive (SCO)"), ("hyperdrive", "Frame Shift Drive"),
    ("engine", "Thrusters"), ("powerplant", "Power Plant"), ("powerdistributor", "Power Distributor"),
    ("sensors", "Sensors"), ("lifesupport", "Life Support"), ("fueltank", "Fuel Tank"),
    ("guardianshieldreinforcement", "Guardian Shield Reinforcement"),
    ("guardianhullreinforcement", "Guardian Hull Reinforcement"),
    ("guardianmodulereinforcement", "Guardian Module Reinforcement"),
    ("guardianpowerplant", "Guardian Hybrid Power Plant"), ("guardianpowerdistributor", "Guardian Hybrid Power Distributor"),
    ("guardianfsdbooster", "Guardian FSD Booster"),
    ("shieldgenerator", "Shield Generator"), ("shieldcellbank", "Shield Cell Bank"),
    ("fuelscoop", "Fuel Scoop"), ("cargorack", "Cargo Rack"), ("corrosionproofcargorack", "Corrosion Resistant Cargo Rack"),
    ("detailedsurfacescanner", "Detailed Surface Scanner"), ("buggybay", "Planetary Vehicle Hangar"),
    ("fighterbay", "Fighter Hangar"), ("dronecontrol_prospector", "Prospector Limpet Controller"),
    ("dronecontrol_collection", "Collector Limpet Controller"), ("dronecontrol_resourcesiphon", "Hatch Breaker Limpet Controller"),
    ("dronecontrol_repair", "Repair Limpet Controller"), ("dronecontrol_fueltransfer", "Fuel Transfer Limpet Controller"),
    ("dronecontrol_decontamination", "Decontamination Limpet Controller"), ("dronecontrol_recon", "Recon Limpet Controller"),
    ("dronecontrol_unkvesselresearch", "Research Limpet Controller"), ("multidronecontrol_mining", "Mining Multi Limpet Controller"),
    ("multidronecontrol_operations", "Operations Multi Limpet Controller"),
    ("multidronecontrol_rescue", "Rescue Multi Limpet Controller"), ("multidronecontrol_xeno", "Xeno Multi Limpet Controller"),
    ("multidronecontrol_universal", "Universal Multi Limpet Controller"),
    ("refinery", "Refinery"), ("hullreinforcement", "Hull Reinforcement"), ("modulereinforcement", "Module Reinforcement"),
    ("metaalloyhullreinforcement", "Meta Alloy Hull Reinforcement"),
    ("repairer", "Auto Field-Maintenance Unit"), ("dockingcomputer_advanced", "Advanced Docking Computer"),
    ("dockingcomputer_standard", "Standard Docking Computer"), ("supercruiseassist", "Supercruise Assist"),
    ("passengercabin", "Passenger Cabin"), ("fsdinterdictor", "FSD Interdictor"),
    ("planetapproachsuite_advanced", "Advanced Planetary Approach Suite"),
    ("shieldbooster", "Shield Booster"), ("heatsinklauncher", "Heat Sink Launcher"), ("chafflauncher", "Chaff Launcher"),
    ("electroniccountermeasure", "ECM"), ("plasmapointdefence", "Point Defence"), ("crimescanner", "Kill Warrant Scanner"),
    ("cargoscanner", "Cargo Scanner"), ("cloudscanner", "Frame Shift Wake Scanner"), ("mrascanner", "Pulse Wave Analyser"),
    ("xenoscanner", "Xeno Scanner"), ("pulselaserburst", "Burst Laser"), ("pulselaser", "Pulse Laser"),
    ("beamlaser", "Beam Laser"), ("multicannon", "Multi-Cannon"), ("cannon", "Cannon"), ("slugshot", "Fragment Cannon"),
    ("railgun", "Rail Gun"), ("plasmaaccelerator", "Plasma Accelerator"), ("dumbfiremissilerack", "Missile Rack"),
    ("basicmissilerack", "Seeker Missile Rack"), ("minelauncher", "Mine Launcher"), ("advancedtorppylon", "Torpedo Pylon"),
    ("mininglaser_fixed_small_advanced", "Mining Lance"), ("mininglaser", "Mining Laser"),
    ("miningtoolv2", "Mining Volley Repeater"), ("causticmissile", "Enzyme Missile Rack"),
    ("atdumbfiremissile", "AX Missile Rack"), ("atmulticannon", "AX Multi-Cannon"), ("plasmashockcannon", "Shock Cannon"),
    ("drunkmissilerack", "Pack-Hound Missile Rack"), ("mining_abrblstr", "Abrasion Blaster"),
    ("mining_seismchrgwarhd", "Seismic Charge Launcher"), ("mining_subsurfdispmisle", "Sub-Surface Displacement Missile"),
    ("guardian_gausscannon", "Guardian Gauss Cannon"), ("guardian_plasmalauncher", "Guardian Plasma Charger"),
    ("guardian_shardcannon", "Guardian Shard Cannon"), ("flakmortar", "Remote Release Flak Launcher"),
    ("flechettelauncher", "Remote Release Flechette Launcher"), ("antiunknownshutdown", "Shutdown Field Neutraliser"),
]
ARMOUR = {"grade1": "Lightweight Alloy", "grade2": "Reinforced Alloy", "grade3": "Military Grade Composite",
          "mirrored": "Mirrored Surface Composite", "reactive": "Reactive Surface Composite"}
MOUNTS = {"fixed": "Fisso", "gimbal": "Gimbal", "turret": "Torretta"}
WEAPON_SIZES = {"tiny": "U", "small": "S", "medium": "M", "large": "L", "huge": "H"}
COSMETIC_SLOTS = ("PaintJob", "Decal", "ShipName", "ShipID", "VesselVoice", "Bobble", "ShipKit", "WeaponColour",
                  "EngineColour", "CargoHatch", "ShipCockpit", "StringLights")
CORE_SLOTS = ["Armour", "PowerPlant", "MainEngines", "FrameShiftDrive", "LifeSupport", "PowerDistributor",
              "Radar", "FuelTank"]
CORE_LABELS = {"Armour": "Corazza", "PowerPlant": "Power Plant", "MainEngines": "Propulsori",
               "FrameShiftDrive": "FSD", "LifeSupport": "Supporto vitale", "PowerDistributor": "Distributore",
               "Radar": "Sensori", "FuelTank": "Serbatoio"}

# Nomi dei blueprint (fdname del journal -> nome in gioco). Fonte: EDCD/coriolis-data modifications/blueprints.json,
# EDEngineer blueprints.json per i nomi completi (Drive Strengthening, Faster Boot Sequence ...).
BLUEPRINTS = {
    "FSD_LongRange": "Increased Range", "FSD_FastBoot": "Faster Boot Sequence", "FSD_Shielded": "Shielded",
    "Engine_Dirty": "Dirty Drive Tuning", "Engine_Reinforced": "Drive Strengthening", "Engine_Tuned": "Clean Drive Tuning",
    "PowerPlant_Boosted": "Overcharged", "PowerPlant_Armoured": "Armoured", "PowerPlant_Stealth": "Low Emissions",
    "PowerDistributor_HighCapacity": "High Charge Capacity", "PowerDistributor_HighFrequency": "Charge Enhanced",
    "PowerDistributor_PriorityEngines": "Engine Focused", "PowerDistributor_PrioritySystems": "System Focused",
    "PowerDistributor_PriorityWeapons": "Weapon Focused", "PowerDistributor_Shielded": "Shielded",
    "ShieldGenerator_Reinforced": "Reinforced", "ShieldGenerator_Thermic": "Thermal Resistant",
    "ShieldGenerator_Kinetic": "Kinetic Resistant", "ShieldGenerator_Optimised": "Enhanced Low Power",
    "ShieldBooster_HeavyDuty": "Heavy Duty", "ShieldBooster_Resistive": "Resistance Augmented",
    "ShieldBooster_Thermic": "Thermal Resistant", "ShieldBooster_Kinetic": "Kinetic Resistant",
    "ShieldBooster_Explosive": "Blast Resistant",
    "Armour_Advanced": "Lightweight", "Armour_HeavyDuty": "Heavy Duty", "Armour_Explosive": "Blast Resistant",
    "Armour_Kinetic": "Kinetic Resistant", "Armour_Thermic": "Thermal Resistant",
    "HullReinforcement_HeavyDuty": "Heavy Duty", "HullReinforcement_Advanced": "Lightweight",
    "Sensor_Expanded": "Expanded Probe Scanning Radius", "Sensor_LightWeight": "Light Weight",
    "Sensor_LongRange": "Long Range", "Sensor_WideAngle": "Wide Angle",
    "Weapon_Overcharged": "Overcharged", "Weapon_LongRange": "Long Range", "Weapon_Efficient": "Efficient",
    "Weapon_HighCapacity": "High Capacity", "Weapon_RapidFire": "Rapid Fire", "Weapon_ShortRange": "Short Range",
    "Weapon_Sturdy": "Sturdy", "Weapon_LightWeight": "Light Weight", "Weapon_Focused": "Focused",
    "Misc_LightWeight": "Light Weight", "Misc_Reinforced": "Reinforced", "Misc_Shielded": "Shielded",
    "LifeSupport_LightWeight": "Light Weight", "FuelScoop_Shielded": "Shielded",
}

MINING_COMMODITIES = ["Painite", "Platinum", "Low Temperature Diamonds", "Void Opal", "Monazite", "Musgravite",
                      "Grandidierite", "Alexandrite", "Benitoite", "Rhodplumsite", "Serendibite", "Bromellite",
                      "Tritium", "Osmium", "Palladium", "Gold", "Silver", "Samarium", "Praseodymium"]
