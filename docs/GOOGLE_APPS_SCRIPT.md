# Aggiornare Google Apps Script

Il push GitHub aggiorna i file dell’app; non pubblica automaticamente il codice nel progetto Apps Script. Questi passaggi vanno eseguiti dal proprietario del foglio, nel proprio account Google. Non occorre inserire link o chiavi nel repository.

## 1. Preparare il progetto

1. Nel foglio esistente aprire **Estensioni → Apps Script**.
2. Conservare una copia del codice attuale e del foglio prima dell’aggiornamento.
3. Sostituire il codice con il contenuto di [`backend/Code.gs`](../backend/Code.gs), quindi salvare.
4. Verificare che esistano i tab `Database` e `Anagrafica`. Se il database ha un nome diverso, impostare nelle Proprietà script `BIATHLON_DATABASE_SHEET` con quel nome.

Le colonne **A–O di Database conservano ordine e intestazioni esistenti**. Il nuovo codice aggiunge P `AtletaID`, Q `SessioneID`, R `Timestamp`; Anagrafica conserva A nome, B email, C note e aggiunge D `AtletaID`. Viene creato il foglio nascosto `_BiathlonDeleted`, che conserva gli identificativi eliminati e impedisce reinserimenti da richieste ritardate. Non cancellarlo durante la manutenzione ordinaria.

Il codice non sostituisce le email esistenti. Per gli atleti nuovi conserva il comportamento precedente con email segnaposto; completare l’anagrafica se le regole di Looker dipendono da quella colonna. Le autorizzazioni del report Looker rimangono quelle configurate nel report.

## 2. Creare una chiave personale

Per ogni allenatore:

1. Aprire **Impostazioni progetto → Proprietà script**.
2. Aggiungere `NUOVO_ALLENATORE` con la firma esatta, per esempio `Matteo Finco`.
3. Tornare all’editor, scegliere la funzione `creaChiaveAllenatore` ed eseguirla. Autorizzare lo script nel proprio account, se richiesto.
4. Nel registro di esecuzione copiare la chiave generata e consegnarla privatamente all’allenatore, insieme alla firma esatta e all’indirizzo di sincronizzazione.
5. Ripetere per gli altri allenatori. La funzione conserva le chiavi precedenti.

Le chiavi sono conservate nella proprietà privata `BIATHLON_COACH_KEYS`, come oggetto JSON che associa ciascuna chiave alla firma autorizzata. Non commettere questa proprietà nel repository. Il servizio rifiuta tutte le richieste finché non esiste almeno una chiave configurata.

Per revocare una chiave, rimuovere la sua voce da `BIATHLON_COACH_KEYS`, mantenendo valido il JSON. Non serve cambiare l’indirizzo dell’app. La revoca blocca gli invii successivi; le bozze già presenti sui dispositivi restano locali.

## 3. Aggiornare il deployment esistente

1. Aprire **Esegui deployment → Gestisci deployment**.
2. Modificare il deployment della web app esistente.
3. Selezionare una nuova versione e descriverla, per esempio `Protocollo 2: chiavi allenatori, identificativi stabili, invii idempotenti`.
4. Per il funzionamento dalla pagina GitHub senza login Google incorporato, la web app deve eseguire come proprietario ed essere raggiungibile dal browser degli allenatori. Con l’accesso `Chiunque`, l’autorizzazione ai dati è applicata dal codice tramite le chiavi personali; nessuna richiesta anonima viene accettata dal nuovo script.
5. Pubblicare mantenendo il deployment esistente, così l’indirizzo `/exec` resta lo stesso.

Riferimento ufficiale: [Web app Apps Script](https://developers.google.com/apps-script/guides/web).

## 4. Configurare ciascun dispositivo

Nell’app aprire **Menu → Impostazioni** e inserire manualmente:

- firma esatta associata alla chiave;
- indirizzo HTTPS del deployment che termina in `/exec`;
- chiave personale dell’allenatore;
- eventuale indirizzo del report Looker.

Salvare, scaricare l’anagrafica e avviare una sessione. I presenti sono scelti dall’allenatore; il download dell’anagrafica non seleziona automaticamente tutti gli atleti.

Le chiavi sono inviate nel corpo della richiesta HTTPS, non come parametro del link configurato. Il frontend non contiene credenziali precompilate. Le serie salvate prima di configurare la firma vengono associate alla firma al momento dell’invio; quelle già firmate mantengono la propria attribuzione.

## 5. Verifica di integrazione

Su una copia del foglio e un deployment di prova:

1. Con chiave valida inviare una serie, ripetere l’invio e verificare una sola riga per coppia ID/numero del colpo.
2. Verificare i colpi al bordo della soglia a terra e in piedi.
3. Eliminare la serie, poi ripetere la richiesta di inserimento precedente: deve restare eliminata.
4. Usare una seconda chiave: deve essere impossibile scrivere con la firma della prima o cancellarne le serie.
5. Revocare una chiave e verificare che lettura dell’anagrafica e invio siano rifiutati.
6. Controllare il report Looker esistente, incluso il filtro sul flag Eliminato della colonna O.

Il server serializza le scritture con [LockService](https://developers.google.com/apps-script/reference/lock/lock-service). Le operazioni sulle celle non sono una transazione di database: se l’esecuzione si interrompe, il client ripete le operazioni rimaste in coda e il server ne gestisce l’idempotenza.
