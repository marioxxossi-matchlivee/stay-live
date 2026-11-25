# Tennis Strategy Center 2.0 — Roadmap addendum (fase 2)

**Data:** 25/11/2026  
**Ultimo aggiornamento:** fase 3 CI verde; avviata verifica read-only della fase 4.  
**Branch di lavoro:** `chore/tennis-data-integrity-ci`  
**Stato:** fasi 1–3 completate; fase 4 in audit, nessuna modifica DB applicata.

Questo documento è il registro incrementale collegato alla roadmap principale `TENNIS-STRATEGY-CENTER-2.0-ROADMAP.md`. I dettagli tecnici e i risultati sono in `TENNIS-DATA-ARCHITECTURE.md`, §9–10.

## Registro fasi

| Fase | Stato | Risultato |
|---|---|---|
| 1 — Mappa architettura e data lineage | Completata | Fonti, flussi, archivi e consumer documentati |
| 2 — Riconciliazione registri e viste | Completata | Query SQL, viste, chiavi, stati speciali e collegamenti controllati in sola lettura |
| 3 — Test di integrità automatizzati | Completata | CI GitHub Actions verde: test LIVE OBSERVATION, storico Tennis e build |
| 4 — Verifica lifecycle e freeze | In corso — test isolati da predisporre | Semantica dei trigger ricostruita da migrazioni; il caso limite resta da riprodurre in PostgreSQL isolato |
| 5 — Contratto archivio Strategy | Audit read-only in corso | FK verso le partite verificate; run_id senza FK ma nessun orfano nello snapshot attuale |
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
