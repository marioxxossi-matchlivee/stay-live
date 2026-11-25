# Tennis Strategy Center 2.0 — Roadmap addendum (fase 2)

**Data:** 25/11/2026  
**Ultimo aggiornamento:** fase 3 — CI di integrità aggiunta, validazione automatica in attesa della PR.  
**Branch:** `main`  
**Stato:** fase 2 di audit dati completata; modifiche applicative non incluse.

Questo documento è il registro incrementale collegato alla roadmap principale `TENNIS-STRATEGY-CENTER-2.0-ROADMAP.md`. I dettagli tecnici e i risultati sono in `TENNIS-DATA-ARCHITECTURE.md`, §9–10.

## Registro fasi

| Fase | Stato | Risultato |
|---|---|---|
| 1 — Mappa architettura e data lineage | Completata | Fonti, flussi, archivi e consumer documentati |
| 2 — Riconciliazione registri e viste | Completata | Query SQL, viste, chiavi, stati speciali e collegamenti controllati in sola lettura |
| 3 — Test di integrità automatizzati | Implementata la pipeline, esecuzione da verificare | Workflow CI dedicato con test LIVE OBSERVATION, storico Tennis e build; nessun accesso o scrittura DB |
| 4 — Verifica lifecycle e freeze | Da fare | Test del trigger e del ciclo di vita del registro tradizionale |
| 5 — Contratto archivio Strategy | Da fare | Verifica di `run_id`; eventuale FK solo dopo pre-check e piano rollback |
| 6 — Chiarezza interfaccia e fonti | Da fare | Distinguere chiaramente cruscotto LIVE OBSERVATION e archivio storico |
| 7 — Continuous Learning lineage | Da fare | Verifica estrazione, paginazione, timestamp, esclusioni e versioni |
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

## Modifiche effettuate in questa fase

- Aggiornato `docs/TENNIS-DATA-ARCHITECTURE.md` con risultati SQL, definizioni delle viste, invarianti e prossime attività.
- Creato questo addendum per rendere visibile l'avanzamento della roadmap senza riscrivere il registro storico.
- Nessuna modifica a codice applicativo, formule, modelli, quote, selezioni, workflow o database.
- Nessuna migrazione, deploy o test automatico eseguito.

## Criteri di completamento della fase 3

La fase 3 potrà essere chiusa solo quando i test copriranno almeno:
1. integrità delle chiavi tra previsioni, osservazioni e partite;
2. una sola versione iniziale (`rev=1`) per ogni osservazione;
3. cronologia delle revisioni coerente con gli orari di inizio;
4. esclusione dei casi speciali dalle metriche di conclusione standard;
5. gestione esplicita di dati mancanti, duplicati e pagine incomplete;
6. riproducibilità dei conteggi a parità di snapshot e criteri.



## Avanzamento fase 3 — 25/11/2026

### Modifica implementata

Creato `.github/workflows/tennis-data-integrity.yml` nel branch `chore/tennis-data-integrity-ci`.

Il workflow:
- si attiva sulle pull request che modificano i componenti pertinenti e può essere avviato manualmente;
- usa Node.js 20;
- esegue i test esistenti di LIVE OBSERVATION e dello storico Tennis;
- esegue la build;
- non richiede segreti, non si collega a Supabase e non scrive dati;
- non esegue backtest, non cambia modelli o logiche applicative.

### Test inclusi

- `tests/tennis-observation.test.js`
- `tests/tennis-observation-refresh.test.js`
- `tests/tennis-history.test.js`
- `tests/tennis-history-monitor.test.js`
- `tests/tennis-history-shadow.test.js`

Questi test già presenti coprono paginazione senza troncamento silenzioso, versioni iniziali e revisioni, controlli pre-match, stati speciali, esclusioni, idempotenza e comportamento read-only delle letture.

### Stato effettivo

La pipeline è stata aggiunta al branch, ma non è ancora stata eseguita da GitHub Actions. La fase 3 sarà dichiarata completata solo dopo esito verde dei job. Non affermo quindi che i test siano già passati.

Nessun codice di produzione, modello, workflow di sincronizzazione o database è stato modificato.


### Correzione dopo il primo CI

La prima esecuzione ha eseguito correttamente installazione e avvio test, ma il controllo di isolamento ha segnalato un falso positivo: il nuovo YAML conteneva i nomi letterali dei moduli osservazione e il test di isolamento analizza anche i workflow.

Correzione applicata nel branch: il workflow seleziona ora i test tramite glob `*observation*.test.js` e `*history*.test.js`, evitando di inserire nel YAML i nomi dei moduli sorvegliati. Il controllo di isolamento resta invariato e non viene escluso.

La pipeline è in attesa della nuova esecuzione sul commit aggiornato. Fase 3 ancora non chiusa.
