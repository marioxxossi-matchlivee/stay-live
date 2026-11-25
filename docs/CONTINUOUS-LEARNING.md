# CONTINUOUS LEARNING — diagnostica dei modelli e laboratorio sperimentale (tennis e calcio)

**Stato (24/11/2026): implementato in modalità isolata e osservativa; NON attivato in automatico.** Nessun motore operativo, probabilità, criterio di selezione, endpoint, workflow, secret, variabile d'ambiente, tabella o migrazione è stato modificato.

## 1. Cosa fa e cosa NON fa
- Analizza le previsioni **concluse** già registrate dall'app (registri esistenti, sola lettura), individua anomalie con evidenze statistiche e le accompagna da ipotesi e limiti.
- Sperimenta, **in un ambiente separato**, ricalibrazioni delle probabilità già prodotte e stabilisce con un validatore indipendente se una variante è migliore su dati storici indipendenti.
- **Non** applica nulla ai modelli, **non** scrive sul database, **non** cambia le probabilità mostrate, **non** esegue i modelli con parametri diversi (questo tipo di esperimento è predisposto come interfaccia ma NON implementato: vedi §8).
- «Validato» significa solo «migliore su dati storici indipendenti». Non è un'adozione e non è una validazione prospettica.

## 2. Architettura (file)
| Livello | File | Ruolo |
|---|---|---|
| Nucleo statistico | `functions/api/_learning-core.js` | Metriche (Brier, log loss, accuratezza, ECE), fasce con intervalli di Wilson, bootstrap a blocchi (seme fisso), differenza tra gruppi indipendenti, correzione di Holm, regressione logistica (pendenza/intercetta di calibrazione con IC), PSI, impronte dei dati |
| Adattatori | `functions/api/_learning-adapters.js` | Righe dei registri esistenti → record normalizzati `{id, sport, t, p, y, group, block, version, segs, flags, sources}`; nulla viene inventato (`null` se manca) |
| Diagnostica | `functions/api/_learning-diagnostics.js` | Rilevamento di anomalie (§3) |
| Laboratorio e validatore | `functions/api/_learning-lab.js` | Candidati, divisione cronologica, walk-forward, holdout, verdetto, registro append-only (§4–§5) |
| Report | `functions/api/_learning-report.js` | Unisce adattatori, diagnostica, laboratorio; produce il report `learning-report-v1` |
| Esecuzione | `scripts/learning-run.js` | Legge i registri (solo richieste GET) e scrive **un file locale** `public/learning/report.json` |
| Interfaccia | `src/learning/view.js`, `mount.js`, `learning.css` | Sezione «CONTINUOUS LEARNING» (6 schede); legge solo `/learning/report.json` |
| Montaggio | `src/tennis/app.js` (Affidabilità), `src/monitor-tab.js` (calcio) | Una riga ciascuno; se il modulo non carica, la schermata ospite resta com'è |

Nessuna dipendenza nuova, nessuna tabella, nessuna migrazione, nessun endpoint. Il modulo non importa alcun motore (test di isolamento).

## 3. Motore diagnostico
Per ogni sport, sulle previsioni concluse (calcio: ricostruzioni a posteriori **escluse**, perché non prospettiche; tennis: solo previsioni pubblicate):
| Tipo | Cosa verifica | Come |
|---|---|---|
| `calibration_slope` / `calibration_intercept` | Probabilità troppo estreme o caute; sovra/sotto-stima media | Regressione logistica di y su logit(p), IC a blocchi: pendenza ≠ 1 o intercetta ≠ 0 |
| `bin_bias` | Fasce di probabilità sovra/sottostimate | Wilson + test normale, Holm tra le fasce (≥ 30 casi) |
| `segment_gap` | Differenze tra superfici (tennis), circuiti, campionati, mercati, basi dati, versioni (calcio) | Differenza di log loss gruppo − resto, bootstrap per blocchi indipendenti, Holm su tutti i gruppi |
| `performance_degradation` | Peggioramento recente | Ultimo quarto contro il resto, differenza di log loss con IC |
| `missing_data_effect` | Dati mancanti (tennis: H2H, ranking, statistiche di servizio…; calcio: API, quote) | Perdita con dato mancante contro presente, Holm |
| `source_divergence` | Fonti diverse sulle STESSE partite (modello, API, mercato) | Differenza appaiata di log loss con IC; solo quote **normalizzate** (nel tennis spesso c'è una sola quota: senza margine non è una probabilità) |
| `distribution_shift` | Cambio di distribuzione tra prima e seconda metà | PSI (0,10 moderato, 0,25 marcato) |

Ogni anomalia riporta: descrizione, evidenze numeriche, numero di osservazioni e di blocchi, periodo, livello di confidenza (95%, metodo, correzione, p corretto, livello alta/media/bassa), **spiegazioni possibili marcate «ipotesi non dimostrata»** e limiti. Stato:
- **rilevata**: campione sufficiente (≥ 300 osservazioni e ≥ 50 blocchi nel gruppo più piccolo), p corretto con Holm < 0,05, intervallo che esclude lo zero;
- **segnale debole**: indicativo (campione sotto soglia o test non corretto). Nessuna causa è mai attribuita automaticamente.

## 4. Fonti informative
Il report mostra, per sport, quante previsioni hanno la probabilità del modello, dell'API e una quota (e quante normalizzabili), l'anticipo mediano delle quote sull'inizio, la quota di dati mancanti per categoria e il confronto delle fonti sulle stesse partite. Le quote sono usate come riferimento esterno di calibrazione, mai per modificare i modelli.
Per il tennis, LIVE OBSERVATION già conserva per ogni valutazione: fonti usate, dati mancanti, istanti, versione del modello e dello storico, Elo, forma, statistiche, ranking e H2H.

## 5. Laboratorio sperimentale e validatore indipendente
**Candidati** (trasformazioni delle probabilità già prodotte): temperatura, Platt, contrazione verso il tasso base, miscela con la quota normalizzata (solo se ≥ 300 casi con quota), scostamento per gruppo (superficie nel tennis, mercato nel calcio).
**Protezioni contro la contaminazione e il «ritocco sui dati già visti»**
1. L'**ultimo 20% cronologico (holdout)** non entra in nessun adattamento né scelta.
2. Nel resto (sviluppo): **walk-forward a finestra espansa** (4 fold): si adatta sul passato, si valuta sul tratto successivo.
3. Nessuna partita/gruppo condiviso tra adattamento e valutazione e adattamento interamente anteriore (`assertNoLeakage`, test dedicati; un test dimostra che alterare gli esiti dell'holdout non cambia i risultati di sviluppo).
4. Confronto **sulle stesse osservazioni** (differenza appaiata), bootstrap a blocchi (torneo/campionato + settimana), **Holm** sui candidati provati.
5. Si sceglie **un solo** candidato (il migliore tra quelli che hanno superato lo sviluppo) e lo si valuta **una volta** sull'holdout; gli altri non lo toccano.
**Verdetti:** `validato_storico` (migliora sullo sviluppo con p corretto < 0,05, IC > 0, ≥ 2/3 dei fold, e sull'holdout con IC > 0, ECE non peggiore di 0,01) · `non_validato` · `peggiore` · `non_conclusivo` (campione insufficiente: < 300 osservazioni o < 50 blocchi). Verifiche sintetiche nei test: dati sovra-confidenti → un solo candidato validato; dati calibrati → nessuno; miglioramento solo sullo sviluppo che peggiora sul tratto finale → non validato.
**Ogni esperimento** ha: ID deterministico, versione di partenza, modifica sperimentata, dataset (impronta, periodo, n), periodi di addestramento e validazione, metriche, confronto, holdout, verdetto, limiti, `appliedToOperationalModel: false`.
**Registro delle modifiche:** `experimentLog` nel report, **append-only** (un id già presente con contenuto diverso è un errore). Stessi dati → stesso id → nessuna riga nuova.

## 6. Come si esegue
```
node scripts/learning-run.js                       # legge Supabase in sola lettura e scrive public/learning/report.json
node scripts/learning-run.js --input dati.json     # righe già estratte, nessuna rete
opzioni: --sports tennis,football · --out file · --since AAAA-MM-GG · --reps N · --no-lab · --dry-run
```
Richiede `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` (gli stessi dei workflow esistenti). Letture: `tennis_predictions`, `tennis_prediction_results`, `prediction_leg_results` (solo GET, paginate, errore se il tetto di pagine viene superato). Prestazioni misurate su dati sintetici: 16.300 previsioni di calcio e 1.000 ripetizioni di bootstrap → circa 2 secondi, report ~50 KB. Letture reali previste: ~4 richieste per il tennis e ~17 per il calcio.
**Non è stato eseguito sui dati reali del database in questa consegna** (l'ambiente di sviluppo non ha le credenziali). Il file `public/learning/report.json` incluso è un segnaposto (`status: not_generated`): finché non viene sostituito, l'interfaccia mostra «Nessun report generato» e nessun numero.

## 7. Attivazione dell'automazione (NON eseguita: i workflow esistenti non sono stati toccati)
**Opzione A — workflow dedicato (proposta, da creare solo con autorizzazione):**
```yaml
name: Diagnostica CONTINUOUS LEARNING
on:
  workflow_dispatch:
  schedule: [{ cron: "55 5 * * *" }]     # dopo il monitoraggio storico tennis (05:40)
permissions: { contents: write }
jobs:
  learning:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: node scripts/learning-run.js
        env:
          SUPABASE_URL: ${{ secrets.SUPABASE_URL }}
          SUPABASE_SERVICE_ROLE_KEY: ${{ secrets.SUPABASE_SERVICE_ROLE_KEY }}
      - run: |
          git config user.name "learning-bot" && git config user.email "learning-bot@users.noreply.github.com"
          git add public/learning/report.json && (git diff --cached --quiet || git commit -m "Aggiornamento report CONTINUOUS LEARNING") && git push
```
Conseguenze: il commit del report fa ripartire la build su Cloudflare Pages (una al giorno); il workflow scrive nel repository (non nel database). Con frequenza maggiore conviene l'opzione B.
**Opzione B — tabella `learning_reports` + endpoint di lettura** (richiede una migrazione e una modifica all'interfaccia: da progettare e autorizzare a parte). Evita il commit giornaliero.
**Incrementalità:** `--since` limita la finestra di analisi; l'esecuzione completa è comunque leggera (§6). Il registro degli esperimenti è già incrementale (append-only, id deterministici). Una cache dei record tra le esecuzioni NON è implementata.

## 8. Cosa è predisposto ma NON implementato
- Sperimentare **parametri del motore** (K dell'Elo, peso della forma, parametri del calcio): richiederebbe rieseguire il modello su storico con configurazioni diverse; non implementato per non toccare i motori. Il registro e il validatore sono già pronti ad accoglierli.
- Confronto con le quote **al momento della previsione** nel tennis: il registro prospettico oggi conserva solo se le quote erano disponibili; nei registri esistenti la quota è spesso di un solo giocatore.
- Analisi per campionato del calcio con campioni piccoli: molti gruppi restano «insufficienti».
- Intervallo di confidenza dell'ECE (la schermata dichiara «IC non stimato»).
- Esecuzione automatica, tabella dei report, avvisi.

## 9. Limiti statistici
Le previsioni della stessa partita (calcio) e dello stesso torneo non sono indipendenti: gli intervalli usano blocchi ma restano stime. Un'associazione non dimostra una causa. Un esito storico non prova un vantaggio futuro. Con campioni piccoli l'assenza di anomalie non dimostra che il modello sia corretto.
