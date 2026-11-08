<p align="center"><img src="docs/logo.png" alt="ED Copilot" width="560"></p>

# ED Copilot

A free desktop companion for **Elite Dangerous** on Windows. It reads the journal files the game writes for
third-party tools and shows everything live while you play, with a voice copilot, an in-game overlay and a phone
companion. Interface in **English** and **Italian**.

> Beta. Built by a fairly new player: feedback from experienced CMDRs is very welcome (see *Feedback* below).

## Download

Get `ED Copilot.exe` from the [latest release](https://github.com/Sott-omar-ino/ed-copilot/releases/latest).
It's portable: no installation. Requirements: Windows 10/11 with Microsoft Edge WebView2 (already included in Windows 11).

Your data stays in the `ED Copilot - dati` folder next to the exe. To move to another PC, copy the exe together with
that folder (or use *Settings → General → Backup*).

The exe is not code-signed yet, so Windows SmartScreen may warn you the first time ("More info → Run anyway").
Each release lists the SHA-256 of the exe and a VirusTotal scan.

## Features

**Commander**
- Overview: current system, scanned bodies with estimated values, unsold exploration and exobiology data, in-game
  route, community goals, startup voice briefing
- Profile, ranks and reputation (progress, what the next rank unlocks, superpowers and minor factions)
- Missions grouped by destination with a suggested order, massacre-stack planner
- Statistics with charts (credits over time, earnings by activity, CR/hour estimates, personal records)
- Logbook with automatic session summaries, notes and screenshots
- Travel map of your whole history, squad sharing with friends, to-do list (also by voice)

**Ship**
- Fleet, shipyard/configurator with engineering, material shopping list, build export/import (journal Loadout format)
- Odyssey suits and weapons planner, fleet carrier info and route planning

**Activities**
- Routes with a route-safety check (non-scoopable chains, fuel, neutron/white dwarf warnings)
- Trade with price alerts, mining (core/motherlode detection, profit per hour), combat and AX tracking
- Exploration values, exobiology species prediction, Powerplay, colonisation (real construction-site data),
  Bubble ↔ Colonia travel, on-foot missions, out-of-fuel help following the Fuel Rats' guidance

**Database**
- Materials, engineering unlocks and blueprints, engineer unlock tracker, material trader calculator,
  Guardian unlocks and sites, station search, useful places

**Voice copilot**
- Speech recognition runs locally (Whisper). Commands press **your own keyboard bindings** (read from the game's
  bindings file), like other voice tools do; it only sends keys when the game window is open
- Spoken alerts and replies with neural voices and optional effects (ship computer, robotic, radio, helmet…)
- Push-to-talk from a HOTAS button, noise filter against key clicks

**Overlay and phone**
- Small always-on-top overlay for borderless mode (next jump, fuel, bio samples)
- Phone companion over your local network (HTTPS): button board, microphone, notifications

**Optional integrations** (all off by default): Inara (your own API key), EDSM and EDDN uploads, Discord Rich Presence.

## Privacy

Everything stays on your PC. Data is sent to EDDN, EDSM or Inara only if you enable it. Online lookups (station and
route search, coordinates, community goals, ship images, neural voices) use public community services; links to them
are in the *Useful places* tab.

## Accuracy

Game facts, formulas and numbers in the app are taken from sources that are cited in the code (Frontier, EDCD data,
community research). When the game doesn't provide a value, the app computes an estimate and labels it as such.
If you spot something wrong, please open an issue.

## Feedback

Open an [issue](https://github.com/Sott-omar-ino/ed-copilot/issues). For bugs, attach `registro.log` from the data
folder and describe what you were doing.

## Running from source

```
pip install -r requirements.txt
python run.py            # --browser to open in a browser, --headless for the server only
python tools\build_exe.py  # builds ED Copilot.exe (needs pyinstaller)
```

## License

GNU GPL v2 or later — see [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Elite Dangerous is a trademark of Frontier Developments plc. ED Copilot is an unofficial fan project, not affiliated
with or endorsed by Frontier Developments.
