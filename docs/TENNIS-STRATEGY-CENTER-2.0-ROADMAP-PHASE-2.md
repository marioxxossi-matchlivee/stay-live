# Tennis Strategy Center 2.0 — Roadmap addendum (fase 2)

**Data:** 25/11/2026  
**Ultimo aggiornamento:** 25/11/2026 — CI completa verde, inclusi test trigger su PostgreSQL 17 effettivo.  
**Branch di lavoro:** `main`  
**Stato:** fasi 1–6 completate come audit; test PostgreSQL fase 4 superati; nessuna modifica al DB remoto applicata.

Questo documento è il registro incrementale collegato alla roadmap principale `TENNIS-STRATEGY-CENTER-2.0-ROADMAP.md`. I dettagli tecnici e i risultati sono in `TENNIS-DATA-ARCHITECTURE.md`, §9–10.

## Registro fasi

| Fase | Stato | Risultato |
|---|---|---|
| 1 — Mappa architettura e data lineage | Completata | Fonti, flussi, archivi e consumer documentati |
| 2 — Riconciliazione registri e viste | Completata | Query SQL, viste, chiavi, stati speciali e collegamenti controllati in sola lettura |
| 3 — Test di integrità automatizzati | Completata | CI GitHub Actions verde: test LIVE OBSERVATION, storico Tennis e build |
| 4 — Verifica lifecycle e freeze | Test PostgreSQL completati; valutazione semantica aperta | Migrazioni reali applicate a PostgreSQL 17 effimero; trigger testati con dati sintetici; caso futuro→passato riprodotto |
| 5 — Contratto archivio Strategy | Audit read-only completato | Writer e lineage verificati; run_id sempre valorizzato e coerente nello snapshot, FK non introdotta per ora |
| 6 — Chiarezza interfaccia e fonti | Audit completato | UI già dichiara LIVE OBSERVATION come fonte della scheda Strategia e separa l'archivio Strategy 2.0 sperimentale |
| 7 — Continuous Learning lineage | In corso | Audit codice completato in prima passata; corretto il caso limite del tetto di paginazione e aggiunto test CI |
| 8 — Decisione strutturale | Bloccata fino ai test | Nessuna fusione, migrazione distruttiva o deprecazione prima delle verifiche |

## Esito fase 2

- `tennis_prediction_results` è una vista derivata da `tennis_predictions` + `tennis_matches`, filtrata sulle partite finite con vincitore valorizzato.
- Il controllo ha rilevato 0 previsioni senza partita collegata.
- LIVE OBSERVATION ha 0 osservazioni senza partita e 0 osservazioni senza versione iniziale.
- I casi di ritiro e walkover rimangono stati speciali (`ended_other`), distinti dalle conclusioni standard.
- Nessuna identità discordante è stata rilevata nel controllo puntuale.
- I collegamenti pick→run risultano coerenti nei dati presenti, ma lo schema non dichiara una foreign key per `run_id`.
- La scheda chiamata «Strategia» usa LIVE OBSERVATION; non rappresenta l'archivio Strategy v1. La distinzione va mantenuta esplicita.

I conteggi puntuali e le query di verifica sono riportati nel documento architetturale. Non sono valori permanenti: si aggiornano con il database.

## Fase 3 — CI automatizzata

Creato `.github/workflows/tennis-data-integrity.yml` nel branch `chore/tennis-data-integrity-ci`.

Il workflow:
- si attiva sulle pull request che modificano i componenti pertinenti e può essere avviato manualmente;
- usa Node.js 20;
- esegue i test esistenti di LIVE OBSERVATION e dello storico Tennis;
- esegue la build;
- non richiede segreti, non si collega a Supabase e non scrive dati;
- non esegue backtest, non cambia modelli o logiche applicative.

Test inclusi tramite glob:
- `tests/*observation*.test.js`
- `tests/*history*.test.js`

**Esito:** run GitHub Actions `45612249679` completato con successo; test LIVE OBSERVATION, test storico Tennis e build verdi. I primi due tentativi avevano evidenziato falsi positivi nel test di isolamento dovuti ai riferimenti letterali nel workflow; i filtri sono stati generalizzati senza modificare o disattivare i test.

La PR #1 resta separata da `main`; nessun merge o deploy è incluso in questo aggiornamento. Nessun codice operativo, modello o database è stato modificato.

## Fase 4 — Audit preliminare lifecycle/freeze (sola lettura)

Schema osservato di `tennis_predictions`:
- chiave primaria su `match_key`;
- foreign key `match_key → tennis_matches(match_key)` con `ON DELETE RESTRICT`;
- vincoli CHECK su coerenza dei campi, valori ammessi e intervalli;
- trigger `tennis_predictions_freeze` su INSERT, UPDATE e DELETE.

Snapshot della verifica:
- 2.506 righe;
- 0 righe senza partita collegata;
- 0 timestamp `computed_at` successivi a `starts_at`;
- 0 timestamp `updated_at` precedenti a `computed_at`;
- nessun timestamp futuro anomalo rilevato.

Definizione attuale del trigger:
- rifiuta INSERT quando `NEW.starts_at <= now()`;
- rifiuta UPDATE/DELETE quando `OLD.starts_at <= now()`;
- aggiorna `updated_at` su UPDATE.

**Caso limite da testare:** un UPDATE di una riga ancora futura può modificare `NEW.starts_at` impostandolo nel passato, perché il controllo considera `OLD.starts_at`. Dopo tale modifica la riga risulta congelata, ma la transizione stessa non è impedita. È un rischio di integrità temporale da riprodurre in test isolati prima di decidere se correggere la funzione.

**Nessuna modifica SQL è stata applicata.** Nessun dato è stato aggiornato, cancellato o inserito. La fase 4 resta aperta finché il caso limite, le semantiche volute e i test di regressione non sono definiti.

## Prossimi passi sicuri

1. Aggiungere test isolati per INSERT futuro/passato, UPDATE prima/dopo l'inizio, modifica di `starts_at` e DELETE prima/dopo l'inizio.
2. Definire esplicitamente se `starts_at` deve essere immutabile dopo la creazione o solo dopo l'inizio.
3. Preparare eventuale correzione della funzione e migrazione con test e rollback; non applicarla al DB remoto prima della verifica.
4. Proseguire con controlli di integrità e lineage degli archivi, senza intervenire sulle logiche di pronostico.
## Aggiornamento fase 4 — ricostruzione delle regole da migrazione

La lettura delle migrazioni conferma che il comportamento dei trigger è intenzionale e differenziato per registro:

- `tennis_predictions_freeze`: congela INSERT/UPDATE/DELETE in base a `starts_at`; resta da testare la transizione di `starts_at` da futuro a passato durante un UPDATE.
- `tennis_strategy_picks_freeze`: INSERT solo prima dell'inizio; UPDATE e DELETE sempre ignorati.
- `tennis_strategy_doubles_freeze`: INSERT solo se entrambe le partite sono future; UPDATE e DELETE sempre ignorati.
- `tennis_strategy_runs_freeze`: consente solo INSERT.
- LIVE OBSERVATION: guardie append-only per anagrafica e versioni; vietano UPDATE/DELETE e anche TRUNCATE. Le versioni controllano progressione consecutiva, data di registrazione e partita non iniziata.

**Limite dei test attuali:** il progetto usa Node.js test runner e la CI non avvia PostgreSQL. I test esistenti verificano soprattutto la logica applicativa in memoria; non riproducono davvero i trigger PL/pgSQL. Non aggiungo test simulati spacciandoli per test DB. Il prossimo passo è predisporre un harness PostgreSQL isolato, senza credenziali Supabase e senza dati reali.

## Aggiornamento fase 5 — lineage dell'archivio Strategy (sola lettura)

Schema verificato nella migrazione `202611170001_tennis_strategy.sql` e riscontro read-only sul database:

- `tennis_strategy_picks.match_key` ha FK verso `tennis_matches(match_key)` con `ON DELETE RESTRICT`.
- Le due gambe di `tennis_strategy_doubles` hanno entrambe FK verso `tennis_matches(match_key)` con `ON DELETE RESTRICT`.
- `run_id` su picks e doubles è nullable nello schema e **non** ha FK verso `tennis_strategy_runs(id)`.
- Snapshot DB: 122 picks, 0 `run_id` nulli, 0 riferimenti a run inesistenti; doubles: 0 righe, 0 nulli, 0 orfani.
- I trigger dell'archivio sono coerenti con la documentazione: le registrazioni di picks/doubles non vengono aggiornate o cancellate; i run sono insert-only.

La mancanza della FK su `run_id` è una lacuna strutturale potenziale, non un errore dimostrato nei dati correnti. Non aggiungo la FK ora: prima servono verifica dei writer, gestione di eventuali run eliminati/ri-generati, decisione sulla nullabilità e piano di rollback. Nessuna scrittura DB o modifica alle tabelle è stata eseguita.

## Prossimi passi aggiornati

1. Predisporre un test PostgreSQL realmente isolato per i trigger della fase 4; coprire INSERT futuro/passato, UPDATE prima/dopo l'inizio, modifica di `starts_at`, DELETE e i trigger append-only.
2. Verificare tutti i writer di `tennis_strategy_runs`, `tennis_strategy_picks` e `tennis_strategy_doubles`, inclusi i casi di rigenerazione e retry.
3. Valutare il contratto referenziale di `run_id` senza applicare ancora vincoli o migrazioni.
4. Passare poi alla fase 6 (etichette chiare per LIVE OBSERVATION e archivio Strategy) e fase 7 (lineage del report Continuous Learning).
## Chiusura audit fase 5 — writer e lineage

Il writer è `recordStrategy()` in `scripts/tennis-sync.js`, con trasformazioni pure in `functions/api/_tennis-strategy-track.js`:

- `runId(now)` genera un identificativo deterministico dal timestamp ISO.
- `planRecords()` assegna lo stesso `run_id` al run, alle singole e alle doppie della stessa esecuzione.
- Il writer persiste prima `tennis_strategy_runs`, poi picks e doubles.
- Il database ha trigger che rendono i registri immutabili; gli upsert di righe già presenti non autorizzano una modifica retroattiva.
- Il writer usa tre richieste separate, non una transazione unica: un errore intermedio può lasciare un run senza tutte le righe figlie previste. Non è stata rilevata una violazione referenziale nello snapshot, ma il flusso non garantisce atomicità tra i tre registri.

Conclusione: la coerenza corrente è confermata, mentre l'atomicità del salvataggio resta un limite operativo da documentare/valutare separatamente. Non introduco FK su `run_id` né modifiche al writer in questa fase.

## Fase 6 — audit etichette UI e provenienza

Controllati `src/tennis/app.js`, `src/tennis/strategy.js` e `src/tennis/strategyview.js`:

- la scheda «Strategia» carica i dati LIVE OBSERVATION dall'endpoint dedicato;
- il cruscotto dichiara esplicitamente «Letto dal registro LIVE OBSERVATION»;
- la sezione di integrità distingue LIVE OBSERVATION, Strategy Center 2.0 sperimentale e motore operativo;
- la descrizione della pagina specifica che si tratta di analisi del modello e controllo dati, non di indicazioni di gioco.

Le etichette attuali sono sufficienti a distinguere le fonti principali. La fase 6 è chiusa come audit di provenienza; non ho modificato il layout né i componenti visuali.

## Fase 7 — audit iniziale Continuous Learning

Prima passata su `scripts/learning-run.js`, `_learning-report.js`, `_learning-adapters.js`, `_learning-diagnostics.js` e test dedicati:

- l'estrazione usa sole richieste GET e paginazione offset da 1.000 righe; il limite dichiarato è 200.000 righe per registro;
- il caricamento Tennis usa previsioni pubblicate con `starts_at` precedente all'istante di esecuzione e risultati dalla vista `tennis_prediction_results`;
- gli adattatori associano risultati e previsioni tramite `match_key`; escludono righe con probabilità/data non valide o senza esito e rendono espliciti i conteggi esclusi;
- nel calcio le righe ricostruite sono escluse per default e contate separatamente;
- il report è versionato (`learning-report-v1`), registra timestamp di generazione e parametri, ed è dichiarato read-only rispetto al database; scrive soltanto il file locale di report;
- `public/learning/report.json` nel repository contiene un report generato valido (`status: ok`); il test è stato aggiornato per accettare sia report valido sia stato non generato.

**Difetto corretto:** quando un registro conteneva esattamente il numero massimo di righe (un multiplo pieno di 1.000 fino al limite), il loader lanciava un errore pur non essendoci troncamento. Ora effettua una pagina aggiuntiva di controllo: se è vuota accetta il dataset esattamente al limite; se contiene righe segnala il superamento. Aggiunto test per entrambi i casi.

Il workflow CI è stato esteso con un test dedicato alla pipeline report tramite glob generico, mantenendo intatto il test di isolamento che vieta di collegare Continuous Learning ai workflow e ai motori operativi. L'esito della nuova esecuzione CI è in attesa.



## Aggiornamento 25/11/2026 — test PostgreSQL effettivi

Aggiunto il job CI `postgres-triggers` al workflow `.github/workflows/tennis-data-integrity.yml`:
- avvia PostgreSQL 17 come servizio effimero su GitHub Actions;
- crea soltanto i ruoli minimi compatibili con le migrazioni Supabase;
- applica le migrazioni Tennis originali `202611120001`, `202611150001`, `202611170001` e `202611210001` al database effimero;
- usa dati sintetici e non imposta credenziali Supabase;
- esegue `tests/postgres/tennis-trigger-lifecycle.sql` contro i trigger PL/pgSQL realmente installati.

Copertura verificata:
- `tennis_predictions_freeze`: INSERT retrodatato ignorato; transizione OLD futura → NEW passata riprodotta; dopo la transizione UPDATE/DELETE sono bloccati;
- `tennis_strategy_runs_freeze`: UPDATE/DELETE ignorati;
- `tennis_strategy_picks_freeze`: inserimento futuro accettato, inserimento passato ignorato, UPDATE/DELETE ignorati;
- `tennis_strategy_doubles_freeze`: inserimento valido accettato, UPDATE/DELETE ignorati e inserimento con una gamba già iniziata ignorato;
- `tennis_observations_guard`: UPDATE/DELETE rifiutati;
- `tennis_observation_versions_guard`: duplicato revisione no-op, salto di revisione rifiutato, UPDATE/DELETE rifiutati;
- trigger anti-TRUNCATE su entrambi i registri LIVE OBSERVATION verificati.

Il primo tentativo PostgreSQL aveva incontrato un vincolo FK nativo durante il test TRUNCATE della tabella padre (non un difetto del trigger). Il test è stato corretto per troncare le due tabelle collegate nella stessa istruzione e verificare la specifica eccezione della guardia; il rerun è passato.

**Esito definitivo CI:** run `45618450635`, commit `95f900512c7ab476e134b921a151e826def3c8b4`, entrambi i job verdi (Node/build e PostgreSQL 17).  
Link: https://github.com/marioxxossi-matchlivee/stay-live/actions/runs/45618450635

**Interpretazione:** la transizione OLD futura → NEW passata è confermata dal motore PostgreSQL reale. Non è stata corretta: resta una decisione di contratto applicativo da valutare separatamente. Nessuna migrazione è stata applicata al Supabase remoto; nessun dato reale è stato scritto o modificato.


## Aggiornamento 25/11/2026 — contratto temporale di tennis_predictions

Verifica in sola lettura di `scripts/tennis-sync.js`, `functions/api/_tennis-provider.js`, migrazione `202611120001_tennis.sql` e test PostgreSQL.

### Comportamento del writer attuale

- `saveMatches()` aggiorna il registro `tennis_matches` usando `match_key`; il programma non sovrascrive righe già `finished` o `ended_other`.
- Il programma normalizzato dal provider porta `status` a `scheduled` solo quando `startTimeStatus === "scheduled"`; gli altri valori osservati diventano `unknown`.
- `runRefresh()` calcola le righe da inviare a `tennis_predictions` soltanto per le partite `scheduled` con `starts_at > now`. Quindi un aggiornamento del programma che colloca la partita nel passato non produce una nuova riga di previsione da upsertare.
- Se invece una partita viene riprogrammata a una nuova data futura **dopo** che il vecchio `starts_at` è già passato, il writer può ricalcolare una riga per la nuova data, ma il trigger la ignora perché controlla `OLD.starts_at <= now()`. La registrazione preesistente resta congelata.
- Se la riprogrammazione avviene mentre il vecchio e il nuovo orario sono ancora futuri, l'UPDATE è consentito.

### Decisione sul trigger

Non modificare ora `tennis_predictions_freeze`. Il criterio basato su `OLD.starts_at` è coerente con il principio di non riscrivere una registrazione dopo l'orario originariamente associato alla partita: una riprogrammazione successiva non deve retroattivamente spostare la previsione congelata.

Il caso SQL diretto `OLD.starts_at > now()` → `NEW.starts_at <= now()` resta consentito dal trigger, ma il flusso `runRefresh()` corrente non genera quell'upsert: il filtro delle partite impedisce di produrre la riga quando il nuovo orario è già passato. Il test PostgreSQL conserva questa verifica come caratterizzazione del trigger, non come prova di un difetto raggiungibile dal writer corrente.

Aggiunto al test effettivo PostgreSQL anche il caso `future → future`, che deve restare aggiornabile. Il test copre quindi: riprogrammazione futura consentita; transizione diretta futura→passata caratterizzata; dopo che `OLD.starts_at` è passato, UPDATE/DELETE ignorati.

### Punto adiacente da verificare in seguito

`saveMatches()` protegge esplicitamente gli stati `finished` e `ended_other`, ma non applica una protezione equivalente per `postponed`, `cancelled` o `interrupted`. L'upcoming feed può normalizzare una partita come `scheduled`/ `unknown`. Va verificato con esempi provider reali se una partita rinviata o annullata possa essere riportata a uno stato precedente da un successivo refresh. Nessuna correzione è stata applicata in questa fase.

**Esito:** contratto del trigger documentato; nessuna modifica a logica di previsione, trigger di produzione, migrazioni o dati Supabase. Prossimo lavoro: test di regressione del lifecycle degli stati partita nel solo registro `tennis_matches`, senza intervenire sui pronostici.


## Aggiornamento 25/11/2026 — lifecycle degli stati speciali di tennis_matches

**Ambito:** sola integrità della sincronizzazione; nessuna modifica alle previsioni, al modello o ai dati remoti.

### Evidenza dal codice

- `normalizeResult()` classifica esplicitamente rinvii, annullamenti e interruzioni rispettivamente come `postponed`, `cancelled` e `interrupted`.
- `normalizeUpcoming()` riconosce soltanto `startTimeStatus === "scheduled"`; gli altri valori diventano `unknown` perché non sono interpretati.
- Prima della correzione, `saveMatches()` proteggeva soltanto `finished` e `ended_other`. Un successivo elemento del programma con stato `unknown` poteva quindi sovrascrivere uno stato speciale già registrato.
- I risultati ricevuti nello stesso giro hanno priorità sul programma tramite `resKeys`.

### Correzione conservativa

`saveMatches()` ora:
- preserva `postponed`, `cancelled` e `interrupted` quando il programma restituisce `unknown`;
- consente il passaggio a `scheduled` soltanto quando il provider dichiara esplicitamente `startTimeStatus = scheduled`;
- continua a dare priorità ai risultati del giro corrente;
- mantiene inalterate le protezioni per `finished` e `ended_other`.

Non vengono inventati stati e non si deduce una riprogrammazione dalla sola presenza della partita nel feed.

### Test e CI

Aggiunto test di regressione su database simulato per:
- preservare tutti e tre gli stati speciali contro un aggiornamento `unknown`;
- accettare una riprogrammazione esplicitamente `scheduled`;
- verificare che gli altri stati speciali restino invariati.

Il workflow `.github/workflows/tennis-data-integrity.yml` esegue il test mirato con Node test runner, senza eseguire gli altri test del motore.

### Riscontro Supabase read-only

Fotografia al 25/11/2026:
- `finished`: 97.861 righe;
- `ended_other`: 5.095;
- `scheduled`: 346;
- nessuna riga con stato `postponed`, `cancelled` o `interrupted` al momento della query.

La correzione copre quindi un percorso possibile e previsto dal normalizzatore, ma non è stata motivata da una riga speciale attualmente presente nel database. Nessuna scrittura o migrazione remota è stata eseguita.

**Esito:** modifica applicativa e test di regressione pubblicati direttamente su `main`. La verifica conclusiva è subordinata al nuovo run CI avviato dal push.
