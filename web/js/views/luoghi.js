"use strict";

// ============================================================================
// LUOGHI
// ============================================================================
// L'unico posto dell'app con collegamenti a siti esterni (si aprono nel browser).
const EXTERNAL_LINKS = [
  ["Strumenti e database", [
    ["https://spansh.co.uk/plotter", "Spansh", "Rotte (neutron, esatta, Road to Riches), ricerche di stazioni, mercati e corpi"],
    ["https://spansh.co.uk/fleet-carrier", "Spansh · Fleet Carrier", "Rotta e Tritium per il tuo fleet carrier"],
    ["https://www.edsm.net", "EDSM", "Mappa galattica e cronologia dei voli"],
    ["https://inara.cz/elite/", "Inara", "Profilo, squadriglie, obiettivi della comunità, database del gioco"],
    ["https://coriolis.io", "Coriolis", "Configuratore navi (importa la build copiata dal Cantiere)"],
    ["https://edsy.org", "EDSY", "Configuratore navi avanzato (importa la build copiata dal Cantiere)"],
    ["https://edtools.cc/miner", "EDTools Mining", "Prezzi e hotspot di estrazione"],
    ["https://canonn.science", "Canonn", "Ricerca scientifica, siti Guardian e Thargoid"],
    ["https://inara.cz/elite/techbroker/", "Inara · Technology Broker", "Tutti gli sblocchi dei Technology Broker con i materiali"],
  ]],
  ["Comunità", [
    ["https://fuelrats.com/i-need-fuel", "Fuel Rats · Richiesta di soccorso", "Se resti senza carburante: compila la richiesta e resta in gioco"],
    ["https://fuelrats.com/", "Fuel Rats", "Il gruppo che soccorre i comandanti a secco: puoi anche unirti a loro"],
    ["https://discord.gg/fcoc", "Fleet Carrier Owners Club · Discord", "Passaggi sui fleet carrier, anche tra Bolla e Colonia"],
    ["https://www.reddit.com/r/FCOC/", "Fleet Carrier Owners Club · Reddit", "Annunci dei viaggi dei carrier e domande frequenti"],
    ["https://wiki.antixenoinitiative.com/en/finding-thargoids", "Anti-Xeno Initiative · Dove trovare i Thargoid", "Segnali Non-Human e AX Conflict Zone ancora attivi"],
    ["https://wiki.antixenoinitiative.com/en/builds", "Anti-Xeno Initiative · Build AX", "Allestimenti per il combattimento contro i Thargoid"],
    ["https://wiki.antixenoinitiative.com/en/guardianunlocks", "Anti-Xeno Initiative · Sblocchi Guardian", "Guida ai moduli, armi e caccia Guardian"],
    ["https://inara.cz/elite/thargoidwar/", "Inara · Attività Thargoid", "Panoramica dell'attività Thargoid segnalata dai giocatori"],
  ]],
  ["Guide e riferimenti", [
    ["https://elite-dangerous.fandom.com/wiki/Colonia_Region", "Elite Dangerous Wiki · Colonia", "La regione di Colonia: sistemi, stazioni, ingegneri"],
    ["https://elite-dangerous.fandom.com/wiki/Drake-Class_Carrier", "Elite Dangerous Wiki · Fleet Carrier", "Meccaniche, costi e salti dei fleet carrier"],
    ["https://math.edomh.nl/pages/fleet-carrier-jump/", "ED-math · Salto del carrier", "Come si calcola il Tritium per salto"],
    ["https://www.elitedangerous.com/update-notes/4-0-18-06", "Frontier · Note di aggiornamento 4.0.18.06", "Valori ufficiali dei combat bond Thargoid"],
  ]],
];

VIEWS.places = () => {
  const pos = S.location.star_pos;
  return `<div class="cards">${STATIC.places.map(c => panel(esc(c.category), `<table><tbody>${c.items.map(p => `<tr>
      <td><b>${sys(p.system)}</b><div class="sub">${esc(p.text)}</div>${todoBtn(`Visitare ${p.system}`, p.system, "Viaggi")}</td>
      <td class="num" style="white-space:nowrap">${ly(dist3(pos, STATIC.coords[p.system]))}</td></tr>`).join("")}</tbody></table>`, { code: "POI" })).join("")}
    ${EXTERNAL_LINKS.map(([group, links]) => panel(group, `<div class="link-list">${links.map(([u, n, d]) =>
      `<button type="button" data-open="${esc(u)}">${esc(n)}<span>${esc(d)}</span></button>`).join("")}</div>`, { cls: "holo", code: "LINKS" })).join("")}</div>`;
};
