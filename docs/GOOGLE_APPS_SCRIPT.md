# Aggiornare Google Apps Script

Il push GitHub aggiorna i file dell’app; non pubblica automaticamente il codice nel progetto Apps Script. Questi passaggi vanno eseguiti dal proprietario del foglio, nel proprio account Google. Non occorre inserire link o chiavi nel repository.

## 1. Preparare il progetto

1. Nel foglio esistente aprire **Estensioni → Apps Script**.
2. Conservare una copia del codice attuale e del foglio prima dell’aggiornamento.
3. Sostituire il codice con il contenuto di [`backend/Code.gs`](../backend/Code.gs), quindi salvare.
4. Verificare che esistano il tab dei colpi e `Anagrafica`. Il codice riconosce `Database_Colpi` e, in sua assenza, `Database`. Se entrambi esistono viene scelto `Database_Colpi`. Un valore esplicito della proprietà `BIATHLON_DATABASE_SHEET` ha precedenza e permette di usare altri nomi.
5. Aggiornare il deployment come descritto sotto, poi eseguire `configuraBiathlon` dall’editor e tornare alla scheda del foglio Google. La funzione configura automaticamente l’ID del foglio e mostra il collegamento amministratore.
6. Se il rilevamento automatico dell’indirizzo non riesce, nel foglio compare una richiesta: incollare l’URL dell’Applicazione web preso da **Esegui deployment → Gestisci deployment** nello stesso progetto. Deve terminare con `/exec`. Per scegliere esplicitamente il deployment eseguire `scegliServizioBiathlon` oppure usare **Biathlon → Scegli indirizzo del servizio** dopo aver riaperto il foglio.

L’indirizzo scelto viene conservato nella proprietà privata `BIATHLON_SERVICE_URL`; le varianti Google con account o dominio Workspace vengono convertite nell’indirizzo standard del medesimo deployment. Annullare la richiesta o inserire un indirizzo non valido lascia invariati configurazione e accessi. Ripetere la configurazione conserva la credenziale amministratore e quelle degli allenatori.

Lo script apre esplicitamente il file configurato. Nelle richieste alla web app non è disponibile il contesto del foglio attivo, anche se il progetto è stato aperto dal foglio: [documentazione Google sui metodi degli script collegati](https://developers.google.com/apps-script/guides/bound#special_methods).

Le colonne **A–O di Database conservano ordine e intestazioni esistenti**. Il nuovo codice aggiunge P `AtletaID`, Q `SessioneID`, R `Timestamp`; Anagrafica conserva A nome, B email, C note e aggiunge D `AtletaID`. Viene creato il foglio nascosto `_BiathlonDeleted`, che conserva gli identificativi eliminati e impedisce reinserimenti da richieste ritardate. Non cancellarlo durante la manutenzione ordinaria.

Il codice non sostituisce le email esistenti. Per gli atleti nuovi conserva il comportamento precedente con email segnaposto; completare l’anagrafica se le regole di Looker dipendono da quella colonna. Le autorizzazioni del report Looker rimangono quelle configurate nel report.

## 2. Gestire gli allenatori dall’app

1. Aprire sul telefono o tablet il collegamento amministratore mostrato da `configuraBiathlon` e confermare l’attivazione con connessione disponibile. Questo collegamento va conservato dall’amministratore.
2. Nell’app aprire **Menu → Gestisci allenatori**.
3. Inserire nome e cognome e premere **Aggiungi allenatore**. L’app mostra il collegamento personale da copiare o condividere con l’allenatore.
4. Nell’elenco sono visibili nome, stato e chiave associata. **Rigenera accesso** invalida il collegamento precedente; **Revoca accesso** blocca i successivi invii senza cancellare le serie conservate sui dispositivi.
5. Per registrare le proprie serie, l’amministratore crea anche un accesso allenatore per sé e preme **Usa su questo dispositivo** nella propria scheda, poi conferma. I due accessi restano separati e possono coesistere sul dispositivo.

Le credenziali sono conservate nelle proprietà private del progetto Google. La vecchia proprietà `BIATHLON_COACH_KEYS`, se presente, viene migrata mantenendo le chiavi valide e l’associazione al nome. La creazione e la gestione degli allenatori non richiedono modifiche manuali alle proprietà né al codice.

La gestione riguarda un unico archivio e un’anagrafica comune. Non è presente la separazione per gruppi o società.

## 3. Aggiornare il deployment esistente

1. Aprire **Esegui deployment → Gestisci deployment**.
2. Modificare il deployment della web app esistente.
3. Selezionare una nuova versione e descriverla, per esempio `Gestione allenatori nell’app e configurazione del deployment esistente`.
4. Per il funzionamento dalla pagina GitHub senza login Google incorporato, la web app deve eseguire come proprietario ed essere raggiungibile dal browser degli allenatori. Con l’accesso `Chiunque`, l’autorizzazione ai dati è applicata dal codice tramite le chiavi personali; nessuna richiesta anonima viene accettata dal nuovo script.
5. Pubblicare mantenendo il deployment esistente, così l’indirizzo `/exec` resta lo stesso.

Riferimento ufficiale: [Web app Apps Script](https://developers.google.com/apps-script/guides/web).

## 4. Configurare ciascun dispositivo

L’allenatore apre il proprio collegamento e conferma **Attiva su questo dispositivo** con connessione disponibile. Nome, credenziale, destinazione e anagrafica vengono configurati insieme. In alternativa può incollare il collegamento in **Menu → Impostazioni e atleti → Accesso e sincronizzazione → Collegamento personale ricevuto**. La configurazione manuale resta disponibile nella stessa sezione richiudibile.

In cima alle impostazioni compaiono nome e breve descrizione dell’accesso; seguono atleti, preferenze e configurazione della sincronizzazione. Il campo del servizio accetta l’URL Apps Script `/exec`: il collegamento GitHub Pages apre l’app, mentre il collegamento al file Google Sheets apre il documento. Questi ultimi due non sono indirizzi di sincronizzazione.

**Verifica accesso e destinazione Google** controlla credenziale e firma, e indica il tab che riceverà le serie. Non invia colpi né modifica il foglio. Dopo aver modificato manualmente i campi occorre comunque salvare le impostazioni.

Gli atleti mostrati all’apertura provengono dall’archivio locale del browser. Un browser nuovo, aperto dal solo link pubblico, non ha anagrafica né credenziali preconfigurate. L’anagrafica viene scaricata solo durante l’attivazione confermata di un accesso allenatore o tramite il comando esplicito **Scarica atleti da Google**. Le richieste senza credenziale vengono bloccate anche dal client; il server verifica autonomamente le credenziali per letture, inserimenti, cancellazioni e amministrazione. I nomi già salvati sul dispositivo restano disponibili offline.

I presenti sono scelti in **Nuova sessione**; scaricare l’anagrafica non seleziona automaticamente tutti gli atleti. Il report Looker e le preferenze di visualizzazione si impostano nelle impostazioni.

I collegamenti personali contengono la credenziale dopo `#`; all’apertura l’app rimuove il frammento dall’indirizzo e richiede conferma prima di salvare l’accesso. Le richieste al servizio Google inviano la credenziale nel corpo HTTPS. Il codice pubblico non contiene credenziali precompilate. Le serie salvate prima di configurare la firma vengono associate alla firma al momento dell’invio; quelle già firmate mantengono la propria attribuzione.

Per un nuovo atleta si può usare **Archivio atleti → Aggiungi**, anche offline. L’inserimento è inizialmente locale: l’anagrafica Google viene aggiornata alla prima serie sincronizzata per quell’atleta. Gli altri dispositivi lo trovano scaricando di nuovo l’anagrafica.

## 5. Verifica di integrazione

Su una copia del foglio e un deployment di prova:

1. Con chiave valida inviare una serie, ripetere l’invio e verificare una sola riga per coppia ID/numero del colpo.
2. Verificare i colpi al bordo della soglia a terra e in piedi.
3. Eliminare la serie, poi ripetere la richiesta di inserimento precedente: deve restare eliminata.
4. Usare una seconda chiave: deve essere impossibile scrivere con la firma della prima o cancellarne le serie.
5. Revocare una chiave e verificare che lettura dell’anagrafica e invio siano rifiutati.
6. Controllare il report Looker esistente, incluso il filtro sul flag Eliminato della colonna O.
7. Aprire l’indirizzo del servizio `/exec` senza credenziali: deve restituire un errore senza anagrafica. Verificare anche il rifiuto di richieste POST senza credenziale o con credenziale errata. Se altri deployment attivi eseguono il vecchio codice privo di autenticazione, aggiornarli oppure archiviarli da **Gestisci deployment**: aggiornare un deployment non aggiorna automaticamente gli altri.

Il server serializza le scritture con [LockService](https://developers.google.com/apps-script/reference/lock/lock-service). Le operazioni sulle celle non sono una transazione di database: se l’esecuzione si interrompe, il client ripete le operazioni rimaste in coda e il server ne gestisce l’idempotenza.
