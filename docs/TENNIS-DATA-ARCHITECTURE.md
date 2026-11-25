# Tennis — mappa architetturale e data lineage

**Revisione:** 25/11/2026  
**Ambito:** prima ricognizione documentale, codice e database in sola lettura.  
**Stato:** mappa iniziale; non è una specifica di migrazione né autorizza cancellazioni.

## 1. Principio architetturale

Il Tennis deve avere fonti canoniche chiare e componenti che consumano gli stessi dati, senza creare copie concorrenti. La separazione tra Calcio e Tennis resta invariata. Questa mappa non propone di fondere tabelle diverse solo perché contengono informazioni correlate: i registri con semantiche differenti devono rimanere distinguibili.

## 2. Flusso verificato

```text
Provider Tennis
   |
   v
scripts/tennis-sync.js
   |-- normalizzazione e aggiornamento --> tennis_matches
   |-- anagrafica -----------------------> tennis_players
   |-- ranking -------------------------> tennis_rankings
   |-- statistiche --------------------> tennis_player_stats
   |
   |-- storico + dati disponibili --> Prediction Engine
   |                                  |
   |                                  v
   |                           tennis_predictions
   |                                  |
   |                                  +--> tennis_snapshot (board)
   |
   |-- osservazione prospettica -----> tennis_observations
   |                                  +--> tennis_observation_versions
   |                                  +--> tennis_observation_results
   |
   |-- Strategy Engine v1 -----------> tennis_strategy_runs
   |                                  +--> tennis_strategy_picks
   |                                  +--> tennis_strategy_doubles
   |
   +-- snapshot ---------------------> tennis_snapshot
                                      |
                                      v
                              /api/tennis-board

src/tennis/app.js
   |-- board/history ----------------> /api/tennis-board
   |-- LIVE OBSERVATION -------------> /api/tennis-observation
   |-- scheda Strategia --------------> buildDashboard(observation data)
   |-- Continuous Learning ----------> /learning/report.json
```

## 3. Ruolo degli archivi

| Archivio | Ruolo | Trattamento proposto |
|---|---|---|
| `tennis_matches` | Anagrafica canonica delle partite e risultati normalizzati | Conservare come fonte delle partite |
| `tennis_players` | Anagrafica giocatori | Conservare |
| `tennis_rankings` | Dati ranking acquisiti | Conservare con data/versione della rilevazione |
| `tennis_player_stats` | Statistiche giocatori | Conservare con data/versione della rilevazione |
| `tennis_predictions` | Valutazioni del registro tradizionale | Conservare; verificare semantica temporale e freeze |
| `tennis_prediction_results` | Esiti collegati al registro tradizionale | Conservare fino alla riconciliazione |
| `tennis_observations` | Prima registrazione prospettica per partita | Conservare |
| `tennis_observation_versions` | Revisioni append-only | Conservare integralmente |
| `tennis_observation_results` | Risultato consultabile/derivato del registro observation | Verificare definizione SQL; non assumere che sia duplicato |
| `tennis_strategy_runs` | Esecuzioni del motore strategico v1 | Conservare fino alla decisione sul suo ruolo |
| `tennis_strategy_picks` | Registrazioni associate alle esecuzioni | Conservare; verificare chiavi e lifecycle |
| `tennis_strategy_doubles` | Registrazioni doppie | Conservare schema e storico anche se al controllo è vuota |
| `tennis_snapshot` | Payload derivato per lettura UI | Trattare come cache/materializzazione, non fonte canonica |
| `public/learning/report.json` | Report statico di diagnostica/esperimenti | Derivato e rigenerabile; esporre sempre data e provenienza |

## 4. Dipendenze UI e servizi confermate

- `scripts/tennis-sync.js` orchestra aggiornamento, calcolo, registrazione observation, Strategy Engine e snapshot.
- `runRefresh` calcola e salva `tennis_predictions`.
- `buildAndStoreSnapshot` assembla il payload e lo salva in `tennis_snapshot`.
- `/api/tennis-board` legge lo snapshot; non calcola il modello.
- `/api/tennis-observation` legge il registro prospettico con paginazione.
- `src/tennis/app.js` usa `state.lo.data` per `buildDashboard` nella scheda Strategia: questa UI è alimentata da LIVE OBSERVATION.
- Lo Strategy Engine v1 è comunque invocato nel refresh: `recordStrategy` chiama `buildStrategy` e registra run/picks/doubles. `loadStrategyHistory` carica lo storico e lo inserisce nel payload snapshot. Va chiarito perché l'archivio strategico non sia la fonte della scheda che porta quel nome.
- Continuous Learning legge `/learning/report.json`, file statico generato da un processo separato. Non è un registro operativo e non modifica il motore.

## 5. Fotografia database del 25/11/2026

| Tabella/insieme | Righe |
|---|---:|
| `tennis_matches` | 103.295 |
| `tennis_players` | 12.088 |
| `tennis_rankings` | 1.836 |
| `tennis_player_stats` | 1.853 |
| `tennis_predictions` | 2.505 |
| Previsioni pubblicate (sottoinsieme) | 1.415 |
| `tennis_prediction_results` | 2.029 |
| `tennis_observations` | 868 |
| `tennis_observation_versions` | 1.980 |
| `tennis_observation_results` | 868 |
| `tennis_strategy_runs` | 153 |
| `tennis_strategy_picks` | 121 |
| `tennis_strategy_doubles` | 0 |
| `tennis_snapshot` | 2 |

I valori sono una fotografia istantanea, non invarianti. Non dimostrano da soli corrispondenza uno-a-uno, completezza o qualità dei dati.

## 6. Decisioni iniziali

1. `tennis_matches` è il riferimento canonico per identità e calendario delle partite.
2. Le previsioni tradizionali, le osservazioni prospettiche e le esecuzioni Strategy hanno semantiche diverse: non vanno fuse né sommate senza una definizione comune.
3. LIVE OBSERVATION e tutte le sue revisioni sono un audit trail prospettico: non cancellare né ricostruire retroattivamente.
4. `tennis_snapshot` è un prodotto derivato per la UI e non deve diventare una seconda fonte autorevole.
5. Continuous Learning deve rimanere un laboratorio derivato dai registri canonici, con metadati espliciti su timestamp, versione, provenienza, campione e criteri.
6. Lo Strategy Engine v1 non è da considerare inutilizzato: viene eseguito e scrive dati. Il disallineamento tra archivio e schermata va chiarito prima di qualsiasi deprecazione.
7. Nessuna tabella viene eliminata o migrata in questa fase.

## 7. Audit successivo necessario

- Riconciliare `tennis_predictions` e `tennis_prediction_results` per chiave, stato, data e risultato.
- Verificare trigger/freeze, aggiornamenti e timestamp che definiscono la previsione tradizionale valutabile.
- Leggere la definizione SQL di `tennis_observation_results` e verificare gli stati anomali: ritiri, walkover, rinvii, interruzioni, identità non verificate.
- Ricostruire per intero le query di lettura/scrittura e le dipendenze di tutte le schermate.
- Verificare run→picks→doubles e l'effettivo consumo dello storico Strategy.
- Definire un contratto comune di provenienza e campionamento per ogni metrica, senza unire campioni non confrontabili.
- Preparare test di integrità e rollback prima di ogni cambiamento strutturale.

## 8. Fuori perimetro

Nessuna modifica a modelli, formule, probabilità, quote, selezioni o logiche di pronostico; nessuna modifica al motore Calcio; nessuna modifica a secrets, API provider, workflow operativi o database. Nessuna migrazione o deploy è inclusa in questa prima fase.
