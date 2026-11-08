// Prova dei comandi vocali in inglese (VOICE_GRAMMAR_EN, TODO_VOICE_EN, _dispatchEn in web/js/voice-engine.js).
// Uso: node tools/test_voice_en.js
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm"), assert = require("assert");

const read = f => fs.readFileSync(path.join(__dirname, "..", "web", "js", f), "utf8");
const noop = () => {};
const calls = [];
const ctx = {
  console, document: { addEventListener: noop, getElementById: () => null }, window: {},
  localStorage: { getItem: () => null, setItem: noop }, $: () => null, navigator: {}, setTimeout, clearTimeout,
  esc: s => String(s), toast: noop, SETTINGS: {}, S: { voice_config: { voice: "en-GB-SoniaNeural" } },
  LANG: { lang: "en", t: s => s }, t: s => s,
  fetch: url => { calls.push(url); return Promise.resolve({ json: () => ({}) }); },
  CONTROLS: [], MACROS: [], TODOS: [],
};
vm.createContext(ctx);
vm.runInContext("function voiceLang() { return LANG.lang === 'en' ? 'en' : 'it'; }\n" +
  "function isCopilotSpeaking() { return false; }\nfunction getCoriolisStation() { return { materials: {}, name: 'X', system: 'Y' }; }\n" +
  "function ttsVoiceKey() { return 'en-GB-SoniaNeural'; }\nfunction speak(t) { fetch('speak:' + t); }\n" +
  read("voice-engine.js") + "\nthis.TODO_VOICE = TODO_VOICE; this.TODO_VOICE_EN = TODO_VOICE_EN; this.VOICE_ENGINE = VOICE_ENGINE;" +
  "this.voiceNormEn = voiceNormEn; this.matchGrammarEn = matchGrammarEn; this.voiceCommandsHelpEn = voiceCommandsHelpEn;" +
  "this.setLists = (c, m) => { CONTROLS = c; MACROS = m; };", ctx);
const T = ctx.TODO_VOICE_EN, VE = ctx.VOICE_ENGINE;

let n = 0;
const eq = (got, want, label) => { assert.deepStrictEqual(JSON.parse(JSON.stringify(got)), want, label); n++; };

// --- Cose da fare: aggiunta
const add = text => ({ kind: "add", text });
eq(T.parse("Add to do buy 30 Arsenic for the FSD."), add("Buy 30 Arsenic for the FSD"), "add to do");
eq(T.parse("Add to-do: sell the exploration data!"), add("Sell the exploration data"), "add to-do colon");
eq(T.parse("Add todo, repair the Fleet Carrier."), add("Repair the Fleet Carrier"), "add todo comma");
eq(T.parse("Add to my to do list: take steel to the construction site"), add("Take steel to the construction site"), "add to my list");
eq(T.parse("Add to my to-do list unlock Felicity Farseer"), add("Unlock Felicity Farseer"), "add to my to-do list");
eq(T.parse("Add a reminder to refuel at Jameson Memorial."), add("Refuel at Jameson Memorial"), "add a reminder to");
eq(T.parse("Remind me to visit Jameson Memorial."), add("Visit Jameson Memorial"), "remind me to");
eq(T.parse("remind me that I need to sell the samples"), add("I need to sell the samples"), "remind me that");
eq(T.parse("Remind me about the community goal"), add("The community goal"), "remind me about");
eq(T.parse("New task: buy limpets"), add("Buy limpets"), "new task");
eq(T.parse("New to-do, map the terraformable planet"), add("Map the terraformable planet"), "new to-do");
eq(T.parse("To do: collect G5 materials"), add("Collect G5 materials"), "to do colon");
eq(T.parse("Copilot, add to do engineer the FSD"), add("Engineer the FSD"), "copilot prefix");
eq(T.parse("Add sell the data to my to do list."), add("Sell the data"), "final form");
eq(T.parse("Remind me to lower the landing gear"), add("Lower the landing gear"), "not a ship command");
eq(T.parse("add to do"), null, "empty");

// --- Lettura
for (const s of ["What do I need to do?", "What do I have to do", "What have I got to do?", "What's left to do?",
                 "What is on my to-do list?", "Read my to-do list.", "read me my to dos", "List my to-dos", "Read the todo list",
                 "To-do list.", "My to do list", "Tell me my tasks", "what do we still need to do"])
  eq(T.parse(s), { kind: "read" }, "read: " + s);
eq(T.parse("What should I do?"), null, "advice, not to-do");

// --- Completamento
const done = query => ({ kind: "done", query });
eq(T.parse("Mark done buy limpets."), done("Buy limpets"), "mark done");
eq(T.parse("Mark as done: number 2"), done("Number 2"), "mark as done");
eq(T.parse("Mark buy limpets as done"), done("Buy limpets"), "final form");
eq(T.parse("mark sell the data done."), done("Sell the data"), "mark X done");
eq(T.parse("Tick off the first one"), done("The first one"), "tick off");
eq(T.parse("Tick sell the data off"), done("Sell the data"), "tick X off");
eq(T.parse("Complete the second."), done("The second"), "complete");
eq(T.parse("I've done the refuelling"), done("The refuelling"), "i've done");
eq(T.parse("I finished selling the data"), done("Selling the data"), "i finished");
eq(T.parse("Mark done buy limpets from my to-do list"), done("Buy limpets"), "trailing list");
eq(T.parse("Status report"), null, "other command");
eq(T.parse("Landing gear down"), null, "ship command");

// --- Numeri
eq(T.ordinal("Number 2"), 2, "number 2");
eq(T.ordinal("the first one"), 1, "the first one");
eq(T.ordinal("the 3rd"), 3, "3rd");
eq(T.ordinal("number two"), 2, "number two");
eq(T.ordinal("one"), 1, "one");
eq(T.ordinal("buy limpets"), null, "not a number");
const open = [{ id: "a", text: "Buy 30 Arsenic for the FSD" }, { id: "b", text: "Sell the exploration data" },
              { id: "c", text: "Sell the bio samples at Vista Genomics" }];
eq(T.match("number 2", open), { item: open[1] }, "match by number");
eq(T.match("arsenic", open), { item: open[0] }, "match word");
eq(T.match("sell", open).ambiguous.length, 2, "ambiguous");
eq(T.match("exploration data", open), { item: open[1] }, "match phrase");
eq(T.match("engineer the thrusters", open), { none: true }, "none");
eq(T.readText([]), "Your to-do list is empty, CMDR.", "empty list");
eq(T.readText(open.slice(0, 1)), "You have one thing to do. 1: Buy 30 Arsenic for the FSD.", "one item");

// --- Normalizzazione (stranezze di Whisper)
eq(ctx.voiceNormEn("Deploy the hard points, please."), "deploy hardpoints", "hard points");
eq(ctx.voiceNormEn("Engage F.S.D."), "engage fsd", "F.S.D.");
eq(ctx.voiceNormEn("Super cruise!"), "supercruise", "super cruise");
eq(ctx.voiceNormEn("Throttle to seventy-five percent"), "throttle to 75 percent", "seventy-five");
eq(ctx.voiceNormEn("Open the cargo scope"), "open cargo scoop", "cargo scope");
eq(ctx.voiceNormEn("What's in the hold?"), "what is in hold", "what's");
eq(ctx.voiceNormEn("Four pip to shields"), "4 pips to shields", "four pip");

// --- Grammatica (testo detto → azione/rapporto)
const g = s => { const r = ctx.matchGrammarEn(ctx.voiceNormEn(s)); return r ? (r.act || r.report || r.do) : null; };
const cases = {
  "Landing gear down": "gear_down", "Gear down.": "gear_down", "Deploy the landing gear": "gear_down", "Lower gear": "gear_down",
  "Landing gear up": "gear_up", "Retract the landing gear.": "gear_up", "Raise gear": "gear_up", "Landing gear": "gear_toggle",
  "Gear": "gear_toggle", "Open the cargo scoop": "cargo_open", "Close cargo scoop": "cargo_close", "Cargo scoop": "cargo",
  "Lights on": "lights_on", "Turn the lights off": "lights_off", "Turn on the lights.": "lights_on", "Toggle lights": "lights",
  "Night vision": "night_vision", "Night vision on": "night_vision", "Deploy hardpoints": "hardpoints_deploy",
  "Deploy hard points": "hardpoints_deploy", "Weapons hot": "hardpoints_deploy", "Retract hardpoints": "hardpoints_retract",
  "Hardpoints away": "hardpoints_retract", "Hardpoints": "hardpoints", "Four pips to shields": "pips_sys",
  "Max shields": "pips_sys", "Full power to engines": "pips_eng", "Power to weapons": "pips_wep", "Balance power": "pips_reset",
  "Reset pips": "pips_reset", "Use shield cell": "shield_cell", "Deploy heat sink": "heatsink", "Heatsink": "heatsink",
  "Launch chaff": "chaff", "Silent running": "silent_running", "Request docking": "docking_request",
  "Request docking please.": "docking_request", "Docking request": "docking_request", "Request permission to land": "docking_request",
  "Throttle 75%": "throttle75", "Throttle to seventy five percent": "throttle75", "Approach speed": "throttle75",
  "All stop": "stop", "Stop.": "stop", "Full stop": "stop", "Boost!": "boost", "Engage FSD": "fsd_jump", "Jump.": "fsd_jump",
  "Engage supercruise": "fsd_jump", "Super cruise": "fsd_jump", "Hyperspace jump": "fsd_jump", "F.S.D.": "fsd_jump",
  "Galaxy map": "galmap", "Open the galaxy map": "galmap", "Gal map": "galmap", "System map": "sysmap",
  "Status report": "all", "Ship status": "all", "Report": "all", "Fuel": "fuel", "How much fuel?": "fuel",
  "Fuel status": "fuel", "Cargo status": "cargo", "Cargo": "cargo", "What's in the hold?": "cargo",
  "Damage report": "damage", "Shields": "damage", "Hull integrity": "damage", "FSD status": "damage",
  "Next jump": "route", "Destination": "route", "Route": "route", "Copy destination": "copy", "Copy next system": "copy",
  "Exobiology": "bio", "Exo biology": "bio", "Sample distance": "bio", "Any advice?": "advice", "What should I do?": "advice",
  "Coriolis status": "coriolis", "Hello there": null, "Thank you": null,
};
for (const [s, want] of Object.entries(cases)) eq(g(s), want, "grammar: " + s);

// --- Dispatch: chiamate al server
const run = s => { calls.length = 0; VE.lastDispatchedRaw = ""; VE.dispatch(s); return calls.slice(); };
ctx.setLists([{ id: "my_ctrl", name: "Fighter bay", say: "Launch fighter; Deploy fighter", key: "F" }],
             [{ id: "emergency_boost", name: "Fuga d'emergenza", say: "Fuga d'emergenza; Manovra evasiva", keys: [] },
              { id: "m2", name: "Mining setup", say: "Mining setup", keys: [] }]);
assert.ok(run("Landing gear down")[0].startsWith("/api/voice/ship_control?action=gear_down&voice=en-GB-SoniaNeural")); n++;
assert.ok(run("Request docking")[0].startsWith("/api/voice/ship_control?action=docking_request")); n++;
assert.ok(run("Launch fighter")[0].startsWith("/api/voice/ship_control?action=my_ctrl")); n++;
assert.ok(run("Fighter bay")[0].startsWith("/api/voice/ship_control?action=my_ctrl"), "control by name"); n++;
assert.ok(run("Emergency boost")[0].startsWith("/api/voice/macro?id=emergency_boost"), "built-in macro english"); n++;
assert.ok(run("Mining setup")[0].startsWith("/api/voice/macro?id=m2"), "macro by name"); n++;
assert.ok(run("Fuel status")[0].startsWith("/api/voice/play?type=fuel&voice=en-GB-SoniaNeural")); n++;
assert.ok(run("Copy destination")[0] === "/api/voice/copy-next?play=1"); n++;
eq(run("Hello there"), [], "unknown: nothing sent");
eq(VE.history[0].name, "Copy destination to clipboard", "history in English");

// --- Elenco "What you can say"
const help = ctx.voiceCommandsHelpEn();
assert.ok(help.some(r => r[0] === "Ship" && r[1].includes("“landing gear down”") && r[1].includes("“request docking”"))); n++;
assert.ok(help.some(r => r[0] === "Reports" && r[1].includes("“status report”"))); n++;
assert.ok(help.every(r => !/[àèéìòù]| di | il | la /.test(r[1]))); n++;

// --- In italiano la grammatica italiana resta quella di prima
ctx.LANG.lang = "it";
assert.ok(run("abbassa carrello")[0] === "/api/voice/ship_control?action=gear_down"); n++;
eq(run("landing gear down"), [], "english phrase ignored in Italian");
eq(ctx.TODO_VOICE.parse("Ricordami di comprare limpet"), { kind: "add", text: "Comprare limpet" }, "italian todo");

console.log(`OK: ${n} verifiche`);
