# Tennis Strategy Center 2.0 — Roadmap addendum (fase 2)

**Data:** 25/11/2026  
**Branch:** `main`  
**Stato:** fase 2 di audit dati completata; modifiche applicative non incluse.

Questo documento è il registro incrementale collegato alla roadmap principale `TENNIS-STRATEGY-CENTER-2.0-ROADMAP.md`. I dettagli tecnici e i risultati sono in `TENNIS-DATA-ARCHITECTURE.md`, §9–10.

## Registro fasi

| Fase | Stato | Risultato |
|---|---|---|
| 1 — Mappa architettura e data lineage | Completata | Fonti, flussi, archivi e consumer documentati |
| 2 — Riconciliazione registri e viste | Completata | Query SQL, viste, chiavi, stati speciali e collegamenti controllati in sola lettura |
| 3 — Test di integrità automatizzati | Da fare | Test sulle invarianti senza cambiare il comportamento operativo |
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

