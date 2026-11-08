// Prova del riconoscimento dei comandi vocali "da fare" (TODO_VOICE in web/js/voice-engine.js).
// Uso: node tools/test_voice_todo.js
"use strict";
const fs = require("fs"), path = require("path"), vm = require("vm"), assert = require("assert");

const src = fs.readFileSync(path.join(__dirname, "..", "web", "js", "voice-engine.js"), "utf8");
const noop = () => {};
const ctx = { console, document: { addEventListener: noop, getElementById: () => null }, window: {},
  localStorage: { getItem: () => null, setItem: noop }, $: () => null, navigator: {}, setTimeout, clearTimeout };
vm.createContext(ctx);
vm.runInContext(src + "\nthis.TODO_VOICE = TODO_VOICE;", ctx);
const T = ctx.TODO_VOICE;

let n = 0;
const eq = (got, want, label) => { assert.deepStrictEqual(JSON.parse(JSON.stringify(got)), want, label); n++; };

// --- Aggiunta
const add = text => ({ kind: "add", text });
eq(T.parse("Aggiungi da fare comprare 30 Arsenic per l'FSD."), add("Comprare 30 Arsenic per l'FSD"), "base");
eq(T.parse("aggiungi da fare: vendere i dati di esplorazione!"), add("Vendere i dati di esplorazione"), "due punti");
eq(T.parse("Aggiungi alle cose da fare, riparare il Fleet Carrier."), add("Riparare il Fleet Carrier"), "alle cose da fare");
eq(T.parse("Aggiungi alla lista da fare portare l'acciaio al cantiere"), add("Portare l'acciaio al cantiere"), "lista");
eq(T.parse("Nuovo da fare: sbloccare Felicity Farseer"), add("Sbloccare Felicity Farseer"), "nuovo");
eq(T.parse("Ricordami di passare da Jameson Memorial."), add("Passare da Jameson Memorial"), "ricordami di");
eq(T.parse("ricordami che devo vendere i campioni"), add("Devo vendere i campioni"), "ricordami che");
eq(T.parse("Promemoria: comprare limpet"), add("Comprare limpet"), "promemoria");
eq(T.parse("Aggiungi un promemoria di fare rifornimento"), add("Fare rifornimento"), "un promemoria di");
eq(T.parse("Aggiungi to do mappare il pianeta terraformabile"), add("Mappare il pianeta terraformabile"), "to do inglese");
eq(T.parse("Aggiungi ai todo: raccogliere materiali G5"), add("Raccogliere materiali G5"), "todo");
eq(T.parse("Aggiungi to-do, comprare un Mandalay"), add("Comprare un Mandalay"), "to-do");
eq(T.parse("Copilota, aggiungi da fare ingegnerizzare l'FSD"), add("Ingegnerizzare l'FSD"), "prefisso copilota");
eq(T.parse("Aggiungi vendere i dati alle cose da fare."), add("Vendere i dati"), "forma finale");
eq(T.parse("Ricordami di abbassare il carrello"), add("Abbassare il carrello"), "non è un comando nave");
eq(T.parse("aggiungi da fare"), null, "vuoto");

// --- Lettura
for (const s of ["Cosa devo fare?", "Che cosa devo fare", "cosa c'è da fare?", "Leggi le cose da fare.", "leggimi la lista da fare",
                 "Quali sono le cose da fare?", "Leggi i to do", "leggi i promemoria", "Cose da fare.", "cosa resta da fare"])
  eq(T.parse(s), { kind: "read" }, "lettura: " + s);
eq(T.parse("Cosa faccio?"), null, "consigli, non da fare");

// --- Completamento
const done = query => ({ kind: "done", query });
eq(T.parse("Segna fatto comprare limpet."), done("Comprare limpet"), "segna fatto");
eq(T.parse("Segna come fatto: il numero 2"), done("Il numero 2"), "segna come fatto");
eq(T.parse("Completa il primo."), done("Il primo"), "completa");
eq(T.parse("segna vendere i dati come fatto"), done("Vendere i dati"), "forma finale");
eq(T.parse("Ho fatto rifornimento"), done("Rifornimento"), "ho fatto");
eq(T.parse("Rapporto nave"), null, "altro comando");
eq(T.parse("Abbassa carrello"), null, "comando nave");

// --- Numeri e corrispondenze
eq(T.ordinal("Il numero 2"), 2, "numero cifra");
eq(T.ordinal("il primo"), 1, "primo");
eq(T.ordinal("la terza"), 3, "terza");
eq(T.ordinal("numero due"), 2, "numero due");
eq(T.ordinal("comprare limpet"), null, "non numero");

const open = [
  { id: "a", text: "Comprare 30 Arsenic per l'FSD G5" },
  { id: "b", text: "Vendere i dati di esplorazione a Jameson Memorial" },
  { id: "c", text: "Vendere i campioni esobiologici a Vista Genomics" },
  { id: "d", text: "Fare rifornimento" },
];
eq(T.match("arsenic", open).item.id, "a", "una parola");
eq(T.match("Il numero 2", open).item.id, "b", "numero");
eq(T.match("il quarto", open).item.id, "d", "ordinale");
eq(T.match("il nono", open), { none: true }, "numero fuori elenco");
eq(T.match("dati di esplorazione", open).item.id, "b", "più parole");
eq(T.match("campione esobiologico", open).item.id, "c", "singolare/plurale");
eq(!!T.match("vendere", open).ambiguous, true, "ambiguo");
eq(T.match("carrier", open), { none: true }, "nessuno");
eq(T.match("Rifornimento", open).item.id, "d", "da 'ho fatto rifornimento'");

// --- Lettura ad alta voce
eq(T.readText([]), "Non hai niente da fare in elenco, comandante.", "vuoto");
const many = Array.from({ length: 7 }, (_, i) => ({ text: `voce ${i + 1}` }));
eq(T.readText(many), "Hai 7 cose da fare. 1: Voce 1. 2: Voce 2. 3: Voce 3. 4: Voce 4. 5: Voce 5. E altre 2.", "max 5");
eq(T.readText([{ text: "fare rifornimento." }]), "Hai una cosa da fare. 1: Fare rifornimento.", "una");

console.log(`OK: ${n} verifiche`);
