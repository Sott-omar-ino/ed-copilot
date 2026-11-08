# Licenses and third-party data

Voidwatch ED is free software: you can redistribute it and/or modify it under the terms of the
**GNU General Public License, version 2 or (at your option) any later version** (see `LICENSE`).
Copyright (c) 2026 Sott-omar-ino.

The GPL is required because the exobiology prediction rules are derived from GPL-licensed projects (below).

## Included third-party material

| Component | Where | Source | License |
|---|---|---|---|
| Ship and module data, blueprint data, ship slot names | `data/catalog.json`, `defaults/ship_slots.json` | [EDCD/coriolis-data](https://github.com/EDCD/coriolis-data) | MIT |
| Exobiology species rules | `app/bio_rules.py` | [EDMC-BioScan](https://github.com/Silarn/EDMC-BioScan) by Silarn | GPL-2.0-or-later |
| Exobiology colour/genus data | `app/bio_rules.py` | [EDMC-ExploData](https://github.com/Silarn/EDMC-ExploData) by Silarn | GPL-2.0 |
| Fonts Saira, Share Tech Mono | `web/fonts/` | Google Fonts (Omnibus-Type; Carrois Type Design) | SIL Open Font License 1.1 (`web/fonts/OFL.txt`). The Saira files `*-slashedzero.woff2` are modified (slashed zero, static weights) by `tools/make_slashed_zero.py` |
| Galactic region map | `app/regionmap.py` | [EliteDangerousRegionMap](https://github.com/klightspeed/EliteDangerousRegionMap) by klightspeed | MIT (notice kept in the file) |

Facts and formulas taken from community research (exploration value formula, material trader ratios, journal
field names, engineer requirements, Guardian recipes and sites, etc.) are cited in comments next to the code that uses them.

## Online services used at runtime

Data is fetched from public community services (Spansh, EDSM, Inara with the user's own API key, the Frontier
community goals feed, Microsoft neural voices for speech). Uploads to EDDN, EDSM and Inara happen only if the user
enables them. Links to these services are in the app's "Luoghi utili" (Useful places) tab.

## Trademarks

Elite Dangerous is a trademark of Frontier Developments plc. Voidwatch ED is an unofficial fan project, not affiliated
with or endorsed by Frontier Developments.
