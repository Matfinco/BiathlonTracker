# Biathlon Tracker

App per smartphone e tablet per registrare i colpi al poligono, conservare le serie sul dispositivo e inviarle a Google Sheets quando torna la connessione.

## Utilizzo sul campo

- Bersaglio a tutta larghezza, senza margini laterali, colonne o limite massimo di larghezza. Le proporzioni 400 × 440 rimangono costanti, anche in orizzontale; si può scorrere verticalmente.
- Atleta, Terra/Piedi, tipo di allenamento e numero della serie sempre visibili. Bozze indipendenti per sessione, atleta, modalità e posizione.
- Cinque colpi iniziali; limite modificabile da **1 a 50** nelle impostazioni. Abbassarlo non elimina colpi già presenti.
- Tocco per inserire, anche nello stesso punto di un colpo precedente. “Modifica colpi” permette di scegliere il numero e spostare il colpo, con vista ingrandita; “Annulla colpo” rimuove l’ultimo.
- Salva e Annulla restano raggiungibili nella barra inferiore. Tema chiaro da esterno o scuro, marcatori colorati con forme diverse o bianco/nero, comandi di almeno 56 pixel per le operazioni principali.
- Storico di tutte le sessioni, bozze da riprendere, riepilogo locale, backup JSON e ripristino. Aprire una correzione conserva la serie originale fino al nuovo salvataggio.
- Blocco dei comandi per trasporto/pulizia e mantenimento opzionale dello schermo acceso, dove il browser lo consente.
- Selezione del vento tramite bandierine alle sei inclinazioni originali, dal livello 0 pendente al 5 disteso, su scala verticale con grandi pulsanti. La bandierina scelta resta visibile anche accanto al comando Vento.

Aprire almeno una volta l’app con connessione e attendere nel Menu la conferma **“App pronta per la riapertura senza connessione”**. Poi provare la riapertura in modalità aereo. Il salvataggio locale funziona indipendentemente dalla sincronizzazione.

All’apertura l’app controlla gli aggiornamenti e attiva automaticamente una nuova versione pronta prima di rendere disponibili i comandi. Il controllo iniziale dura al massimo circa tre secondi; se l’aggiornamento termina più tardi, resta disponibile nel Menu e non interrompe il lavoro. In assenza di rete viene usata la versione già installata. Prima della riapertura vengono attese le scritture locali; un collegamento personale ancora da confermare viene conservato temporaneamente per riproporlo dopo l’aggiornamento. Per installare questa nuova gestione su una vecchia versione può servire un ultimo aggiornamento manuale.

## Pubblicazione e accesso degli allenatori

L’indirizzo del deployment, le firme e le chiavi **non sono inclusi nel codice pubblico**. Si configurano manualmente su ciascun dispositivo.

Prima di pubblicare il frontend, aggiornare lo script Google seguendo [la procedura di deployment](docs/GOOGLE_APPS_SCRIPT.md). Il vecchio script non verifica le chiavi personali e non supporta il nuovo protocollo: la nuova app segnalerà la necessità di aggiornamento e conserverà le operazioni non confermate.

Nel progetto Google eseguire `configuraBiathlon` dopo aver aggiornato il deployment: configura il foglio e mostra il collegamento amministratore. Se il rilevamento dell’indirizzo non riesce, incollare l’URL `/exec` del deployment esistente nella finestra che compare nel foglio; `scegliServizioBiathlon` permette di selezionarlo esplicitamente. Dall’app l’amministratore può poi aggiungere, visualizzare, condividere, rigenerare e revocare gli accessi degli allenatori. Il collegamento personale configura il dispositivo e scarica l’anagrafica dopo la conferma dell’allenatore.

Ogni allenatore riceve una chiave personale associata alla propria firma. Lo script rifiuta chiavi assenti o revocate, firme diverse da quella autorizzata e cancellazioni di serie di altri allenatori. L’app può raccogliere bozze offline; soltanto credenziali valide consentono lettura dell’anagrafica e scrittura sul foglio.

Le impostazioni mostrano il nome dell’allenatore, gli atleti e poi le preferenze; accesso e sincronizzazione sono in una sezione richiudibile. L’amministratore può attivare il proprio accesso allenatore con **Usa su questo dispositivo**. Il comando **Verifica accesso e destinazione Google** controlla il servizio senza inviare colpi. Sono riconosciuti i tab `Database_Colpi` e `Database`, con precedenza all’eventuale nome impostato in `BIATHLON_DATABASE_SHEET`.

All’avvio gli atleti sono letti dall’archivio locale, conservato per l’uso offline. Il solo link pubblico, aperto in un browser nuovo, non scarica l’anagrafica e non abilita invii. La protezione richiede che anche il deployment Google esegua il codice aggiornato.

GitHub Pages può continuare a pubblicare dalla radice del ramo `main`: non è necessaria una compilazione. Dopo il push verificare il risultato dell’eventuale pubblicazione GitHub Pages e aprire la pagina con rete disponibile prima dell’uso offline.

## Dati e compatibilità

Al primo avvio viene aggiornato `BiathlonTrackerDB` alla versione 2. Lo stato precedente da IndexedDB o `localStorage` viene migrato senza rimuovere l’originale; una copia grezza viene conservata come `legacy_backup_v5`. Le serie e la coda diventano record separati. Gli errori di caricamento aprono un percorso di recupero invece di sostituire i dati con un atleta di prova.

Le scritture vengono confermate alla conclusione della transazione. Le modifiche tra schede sono serializzate e le bozze hanno una versione per impedire operazioni su un contesto ormai cambiato. Ogni colpo viene conservato in coordinate normalizzate a piena precisione; interfaccia, esportazione e server applicano le stesse soglie.

Il backup ordinario omette la chiave personale: va reinserita dopo il ripristino. Conservare un backup prima di importazioni o reset. Il reset cancella i dati del dispositivo e non elimina il foglio Google. Una vecchia versione dell’app non può leggere il nuovo formato: dopo la migrazione usare la versione aggiornata e i suoi strumenti di esportazione.

## Organizzazione

- `index.html`, `styles/app.css`: interfaccia e layout touch.
- `src/domain.js`: regole del tiro, bozze, sessioni, anagrafica e migrazione.
- `src/storage.js`: transazioni IndexedDB, recupero e notifiche tra schede.
- `src/sync.js`: unico motore di invio, timeout, tentativi successivi e conferme per operazione.
- `src/app.js`: interazioni dell’interfaccia.
- `src/updates.js`: controllo degli aggiornamenti all’avvio e attivazione prima dell’uso.
- `sw.js`, `manifest.webmanifest`, `icons/`: caricamento offline e installazione.
- `backend/Code.gs`: script Google Apps Script, versionato insieme all’app.

## Verifiche

Su un sistema Linux con Python 3 e `libjavascriptcoregtk-4.1`:

```sh
python3 tests/run.py
```

La suite esegue il JavaScript reale con simulazioni del DOM, delle transazioni, della rete, del service worker e di Google Sheets. Verifica regressioni della logica e dei flussi, compilazione degli script, riferimenti HTML e completezza degli asset offline. Non sostituisce un browser reale né una prova sul foglio di produzione.

La [verifica sui dispositivi](docs/DEVICE_CHECKS.md) copre sole, guanti, riapertura offline, rotazione e test di integrazione Google. In questo ambiente i vincoli su socket e avvio del browser impediscono quella verifica completa.
