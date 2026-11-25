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
| 4 — Verifica lifecycle e freeze | Audit read-only in corso | Trigger esistente analizzato; individuato un caso limite da coprire con test prima di qualsiasi modifica |
| 5 — Contratto archivio Strategy | Da fare | Verifica integrità referenziale e lineage; nessuna modifica alle logiche decisionali |
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
