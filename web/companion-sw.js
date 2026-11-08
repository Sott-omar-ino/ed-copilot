"use strict";
// Service worker del companion installato come app sul telefono (registrato da companion.html).
// Sta nella radice perché il suo ambito deve coprire /companion (MDN, ServiceWorkerContainer.register: "A service
// worker can't have a scope broader than its own location").
//
// Conserva SOLO l'involucro statico della pagina (HTML, font, icone, manifest), per aprire l'app anche quando il PC è
// spento e mostrare "PC non raggiungibile" invece di un errore del browser. Non tocca MAI:
// - le API (/api/...): stato, comandi e voce passano sempre dalla rete, mai dalla cache;
// - il codice di accesso: la pagina è salvata sotto "/companion" senza ?t=..., e il codice resta solo nel
//   localStorage della pagina (viene inviato nell'intestazione X-ED-Token, che qui non si legge né si salva);
// - il certificato della CA e qualunque altro indirizzo: passano dalla rete come se il service worker non ci fosse.
// Per la pagina vale "prima la rete": con il PC raggiungibile si usa sempre la versione aggiornata.

const CACHE = "edc-companion-v1";
const PAGE = "/companion";
const SHELL = [
  PAGE, "/companion.webmanifest", "/favicon.svg",
  "/icons/icon-192.png", "/icons/icon-512.png", "/icons/maskable-192.png", "/icons/maskable-512.png",
  "/icons/apple-touch-icon.png",
  "/fonts/Saira-500-latin-slashedzero.woff2", "/fonts/Saira-600-latin-slashedzero.woff2",
  "/fonts/Saira-700-latin-slashedzero.woff2", "/fonts/Saira-800-latin-slashedzero.woff2", "/fonts/Saira-latin-ext.woff2",
];

self.addEventListener("install", event => {
  // Un file mancante non deve impedire l'installazione: li salvo uno per uno.
  event.waitUntil(caches.open(CACHE)
    .then(cache => Promise.all(SHELL.map(url => cache.add(new Request(url, { cache: "no-store" })).catch(() => {}))))
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith("edc-companion-") && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;
  const isPage = url.pathname === PAGE || url.pathname === PAGE + "/";
  if (isPage) {
    // Prima la rete; la copia salvata è sempre quella senza parametri (mai il ?t= del QR).
    event.respondWith(fetch(req).then(resp => {
      if (resp.ok && !url.search) {  // la visita dal QR (?t=...) non si salva, nemmeno come indirizzo della risposta
        const copy = resp.clone();
        caches.open(CACHE).then(cache => cache.put(PAGE, copy)).catch(() => {});
      }
      return resp;
    }).catch(() => caches.match(PAGE).then(hit => hit || Response.error())));
    return;
  }
  if (url.search || !SHELL.includes(url.pathname)) return;
  // Font, icone, manifest: dalla cache se ci sono, altrimenti dalla rete.
  event.respondWith(caches.match(url.pathname).then(hit => hit || fetch(req)));
});
