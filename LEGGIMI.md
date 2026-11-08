# ED Copilot

Companion per Elite Dangerous: legge il journal del gioco in tempo reale e ti mostra sistema, flotta, materiali,
ingegneri, missioni, statistiche, Powerplay, rotte (Spansh), commercio, estrazione, colonizzazione, un configuratore navi
con lista della spesa dei materiali, un overlay da tenere sopra il gioco e un copilota vocale.

## Avvio

Fai doppio clic su **`ED Copilot.exe`**. Si apre nella sua finestra (non nel browser). Non serve installare nulla:
serve solo Windows 10/11 con Microsoft Edge WebView2, già presente in Windows 11.

È **portatile**: i tuoi dati stanno nella cartella **`ED Copilot - dati`** accanto all'eseguibile.
Per spostare l'app su un altro PC copia l'exe insieme a quella cartella.

Se riapri l'exe mentre è già aperto, viene riportata in primo piano la finestra esistente.

## Cosa serve internet

Funzionano senza internet: la lettura del journal, la panoramica, flotta, materiali, ingegneri, missioni,
il configuratore navi e le cose da fare.
Serve internet per: profilo e obiettivi della comunità (Inara, oppure Frontier senza chiave Inara),
ricerche, rotte e Powerplay (Spansh), coordinate (EDSM), immagini delle navi (wiki), voce del copilota (voci neurali Microsoft).

## Inara

Nelle **Impostazioni** incolla la tua chiave API personale di Inara (Inara → Settings → API): l'app legge da Inara
il profilo (squadriglia, power) e gli obiettivi della comunità. L'API di Inara non offre ricerche su mercati, stazioni
o rotte e i termini di Inara vietano di copiarne le pagine: per quelle l'app usa Spansh.
Inara compare solo nelle Impostazioni (chiave, profilo, collegamento al sito), non nelle altre schede.
Il riconoscimento vocale (Whisper) funziona in locale: al primo uso scarica un modello di circa 75 MB.

## Companion per il telefono

Dalle **Impostazioni** attiva "Accesso dal telefono" e inquadra il QR code con il telefono (stessa rete Wi-Fi).
Il telefono diventa una pulsantiera (carrello, luci, scudi, macro), un telecomando delle schede e un microfono:
tieni premuto il pulsante e dai il comando a voce.
La connessione è cifrata (HTTPS) con un certificato creato dall'app: la prima volta il telefono mostra un avviso,
scegli "Avanzate → Procedi" (Safari: "Mostra dettagli → visita questo sito web").
L'accesso è protetto da un codice segreto contenuto nel QR: non condividerlo. Quando non ti serve, spegnilo.

## Comandi alla nave

I comandi (voce, pulsanti, macro, telefono) premono i tasti della **tastiera** che hai assegnato in gioco:
l'app li legge dai file dei controlli di Elite Dangerous. Un comando assegnato solo a cloche o gamepad non si può
premere dall'app: in **Impostazioni → Audio → Tasti del gioco** vedi quali mancano e con un pulsante puoi aggiungere un tasto
libero della tastiera negli slot vuoti (prima viene fatta una copia del file; poi riavvia il gioco).
Prima di premere qualsiasi tasto l'app porta in primo piano la finestra del gioco; se il gioco non è aperto non preme nulla.

## Altre funzioni

- **Lingua**: interfaccia e copilota vocale in italiano o in inglese (Impostazioni → Generali → Lingua).
- **Diario di bordo**: ogni sessione raccontata in automatico, con note e screenshot.
- **Rank e reputazione**, **Statistiche** con grafici e record, **Mappa dei viaggi**, **Squadriglia** con gli amici.
- **Missioni**: raggruppate per destinazione e pianificatore degli stack di missioni massacro.
- **Cantiere navale**: configuratore con ingegneria, lista della spesa dei materiali, esporta/importa la build.
- **Esplorazione** (valore dei corpi), **Esobiologia** (specie possibili per pianeta), **Estrazione** (core e profitti
  all'ora), **Combattimento**, **Thargoid & AX**, **Missioni a terra**, **Powerplay**, **Colonizzazione** (dati reali
  del cantiere), **Bolla ↔ Colonia**, **Fuel Rats** (cosa fare se resti senza carburante).
- **Database**: materiali, sblocchi, ingegneri (con lo stato di sblocco), material trader, Guardian, ricerca stazioni,
  luoghi utili (l'unica scheda con collegamenti a siti esterni).
- **Copilota vocale**: comandi, avvisi, briefing all'avvio, cose da fare a voce, effetti per la voce, filtro rumori,
  push-to-talk dalla cloche.
- **Avvisi prezzi**, **notifiche sul telefono**, **invio dati** (EDDN, EDSM, Inara), **Discord**, **backup**.
- **Info & FAQ** nelle Impostazioni: domande frequenti e riconoscimenti.

## Overlay

Dalle **Impostazioni** apri l'overlay: una piccola finestra semitrasparente sempre in primo piano con sistema,
prossimo salto, carburante, campioni bio e ultimo evento. Sbloccato si trascina dove vuoi; bloccato lascia passare
i clic al gioco. In Elite usa la modalità video "Finestra senza bordi": lo schermo intero copre qualsiasi overlay.

## Aggiornamenti

Le nuove versioni arrivano dalle release di GitHub (github.com/Sott-omar-ino/ed-copilot); nelle **Impostazioni** puoi
indicare un altro repository.
Una versione si installa solo se la release contiene `ED Copilot.exe` con la sua impronta SHA-256
e solo quando premi "Installa": l'app si chiude e si riapre aggiornata.

## In caso di problemi

L'app scrive un registro in `ED Copilot - dati\registro.log`.

## Per sviluppatori

```
ED Copilot.exe          l'app compilata (portatile)
Avvia dai sorgenti.bat  avvio dai sorgenti (installa le librerie al primo avvio)
run.py                  punto di avvio
app/                    server Python
  main.py                 finestra nativa (pywebview) e avvio
  server.py               API HTTP locali e sicurezza
  journal.py, state.py    lettura del journal e stato del comandante
  search.py, spansh.py    ricerche e rotte online
  inara.py                profilo e obiettivi della comunità da Inara
  stats.py                statistiche delle sessioni (dai journal)
  powerplay.py            Powerplay: stato del comandante e ricerca sistemi
  bindings.py             lettura (e completamento) dei tasti del gioco
  overlay.py              finestra overlay sopra il gioco
  tls.py, remote_voice.py HTTPS del companion e comandi vocali dal telefono
  updater.py              aggiornamento automatico dalle release di GitHub
  colonisation.py         pianificatore di colonizzazione
  voice.py, keys.py       copilota vocale e comandi alla nave
  advisor.py              consigli del copilota
  coriolis.py, ships.py   catalogo navi e allestimenti
  paths.py, storage.py    cartelle e salvataggio dei dati
web/                    interfaccia (HTML, CSS, una cartella js/ con un file per scheda)
defaults/               macro, controlli e avvisi predefiniti
data/catalog.json       catalogo navi iniziale (dati Coriolis, licenza MIT)
assets/                 icona
tools/                  compilazione dell'exe, zip da condividere, test della finestra
```

- Avvio dai sorgenti: `pip install -r requirements.txt` e poi `python run.py`
  (`--browser` per aprire nel browser, `--headless` per il solo server).
  Variabili utili per le prove: `ED_COPILOT_PORT` (porta iniziale, per non scontrarsi con l'exe aperto)
  e `ED_COPILOT_DATA` (cartella dati alternativa).
- Compilazione: `pip install pyinstaller` e poi `python tools\build_exe.py`.
- Zip da condividere (solo exe e LEGGIMI, senza dati personali): `python tools\make_release_zip.py`.

## Licenza

Software libero con licenza GNU GPL versione 2 o successiva (vedi `LICENSE` e `THIRD_PARTY_NOTICES.md`).
Elite Dangerous è un marchio di Frontier Developments plc; ED Copilot è un progetto amatoriale non ufficiale.
