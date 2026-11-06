# CHANGELOG-DEBUG — audit e revisione del motore Stay Live

Estrai lo ZIP direttamente sopra il progetto (stessa struttura di cartelle). Nessun file va eliminato (vedi «Codice morto»).
Verifica eseguita: `node --test` → 98 test, 98 superati. **`npm run build` NON è stato eseguito** (Vite non installato nell'ambiente di lavoro, nessuna rete): esegui `npm install && npm run check` prima del deploy.

## File nuovi
- `scripts/backtest.js`, `scripts/metrics.js` — backtest cronologico (60/20/20, nessun dato futuro), metriche, taratura su validazione, Platt scaling.
- `tests/quant.test.js`, `tests/backtest.test.js` — test dei casi matematici noti, EV, Dixon-Coles, probabilità prudente, congiunta, Kelly, assenza di look-ahead, metriche, Platt.
- `CHANGELOG-DEBUG.md`.

## File modificati
`functions/api/model.js`, `functions/api/_corners.js`, `src/plan.js`, `src/main.js`, `tests/model.test.js`, `tests/brain.test.js`, `package.json` (script `backtest`), `README.md`.

## Bug corretti (trovati nell'audit)
1. **Totale puntato oltre il budget** (screenshot: 20 € su budget 5 €, «400%»): `stakePlan` alzava ogni puntata al minimo di 0,50 € e `applyCap` rifaceva lo stesso dopo il ridimensionamento, quindi il tetto del 20% non valeva. Ora sotto il minimo non si gioca e le giocate in eccesso vengono tolte: totale sempre ≤ 20% del budget. Puntate mai sopra Kelly frazionato.
2. **Quote reali di API-Football ignorate nelle singole**: il verdetto BET/EVITA e la puntata usavano solo la probabilità o quote inserite a mano. Ora, se il mercato quota la selezione, decide pLow × quota reale; `plan.js` usa quella quota (fonte «mercato»).
3. **Probabilità prudente sottostimava l'incertezza**: scarto fisso `0,30/√partite` (≈ ±11% con 8 partite) contro un'incertezza poissoniana reale di ordine ±25–35% sui gol attesi. Sostituito con quantile 20% su griglia 7×7 con varianza bayesiana dal numero effettivo di partite (Kish) e dispersione tra squadre.
4. **Multiple costruite su quote stimate** (quota equa/1,06): EV negativo per costruzione, ma presentate come «sicura/equilibrata/ambiziosa». Ora solo quote reali, EV congiunto prudente ≥ 1,03, altrimenti nessuna multipla. Rinominate (nessuna è «sicura»).
5. **Multipla = prodotto delle pLow**: troppo severo e incoerente. Ora p congiunta × exp(−√Σ ln²(p/pLow)) (incertezze indipendenti in quadratura).
6. **Mercato preferito a priori** («Gol totali» sempre davanti): rimosso; tra i BET verificati vince l'EV prudente più alto.
7. **Doppio conteggio** `afAdviceShift` (+6 punti dal consiglio del provider, derivato dagli stessi dati): azzerato.
8. **Platt scaling divergente** (trovato dai test): Newton senza smorzamento arrivava a coefficienti assurdi; ora passo dimezzato sulla log loss e regolarizzazione verso l'identità.
9. Corner: segnati `verified: false, ev: null` (probabilità implicita nella quota = nessun vantaggio per costruzione).
10. Testo «Margine di prudenza» in `main.js` non più coerente col calcolo: aggiornato.

## Modifiche al modello matematico
- `scoreMatrix(lh, la, rho)`: correzione Dixon-Coles (0-0, 0-1, 1-0, 1-1), **`MODEL.rho = 0`** finché `npm run backtest -- --tune` non la giustifica.
- `posteriorLowProbabilities`, `relVar`, `teamForm().neff`; `MODEL.pLowMethod` (`posterior` | `legacy`, quest'ultimo solo per confronti).
- Per ogni selezione: `ev`, `evLow` (solo su quota reale, altrimenti `null`), `verified`; il verdetto senza quota avverte che il valore non è verificato.

## Modifiche al motore delle multiple
Ricerca esaustiva (12 partite × 2 gambe, fino a 5 gambe) con quota reale, EV congiunto prudente ≥ 1,03, max 2 gambe per campionato; fasce `prudente` (obiettivo: probabilità congiunta prudente), `equilibrata` e `alto-rendimento` (obiettivo: crescita attesa Kelly). Nuove `jointProbability`, `kellyGrowth`.

## Miglioramenti dimostrati dal backtest
**Nessuno.** Non c'erano dati storici (né quote storiche) nell'archivio e l'ambiente non ha accesso a Supabase. Le correzioni sopra sono bug o correzioni di principio, non miglioramenti misurati. L'infrastruttura è pronta: esporta le partite finali (query nell'intestazione di `scripts/backtest.js`) ed esegui `npm run backtest -- --file finals.csv --compare --tune`. Per giudicare il ROI servono anche le quote storiche (colonne `odds_*`); con meno di 300 giocate il report scrive «NON DIMOSTRABILE».

## Limiti ancora presenti
- Pesi delle fonti (`weights` 0,25/0,40/0,35), soglie (0,60, 0,62, 0,08…) e `shrinkK`/`decay` **non calibrati**; con una finestra di 8 partite `shrinkK = 4` probabilmente regolarizza poco (da tarare col backtest).
- Il mercato fuso nella probabilità rende l'EV vs quota parzialmente circolare (conservativo, ma riduce i vantaggi rilevabili).
- Non implementati perché non dimostrabili senza dati: forza degli avversari, split casa/trasferta, xG, riposo/calendario, scontri diretti, calibrazione in produzione, Over/Under 0,5 e 4,5, Goal/No Goal e doppia chance con quota reale (il mercato non le quota nell'app: restano «non verificate»).
- **Corner: nessun modello statistico** (servirebbero i corner storici per partita, `fixtures/statistics`).
- Indipendenza tra partite diverse assunta (non verificata); esposizione per campionato limitata solo nelle multiple, non nelle singole.
- Nessun log server delle giocate: la redditività reale si legge solo dalle «giocate salvate» del browser.
- Piano API-Football: ~3 richieste per partita (pronostico + 2 quote) oltre alla ricerca dell'id; `maxLive` resta 12 per chiamata.

## Codice morto (NON eliminato: lo ZIP non può cancellare file; decidi tu)
Non referenziati da frontend, modello o workflow: `functions/api/odds.js` (legge la vecchia tabella `odds_snapshots`), `functions/api/availability.js` + `_scrape.js` + `_sources.js` + `scrape-debug.js` (+ `tests/availability.test.js`, migrazione `202610310001_availability.sql`): lo scraping di infortuni/formazioni non alimenta il modello (usa gli infortuni di API-Football). Export senza uso fuori dai test: `AfError`, `trackUsage`, `goalsIt`, `NINJAS_URL`, `fmtDay`, `encode`, `PLAYS_KEY`, `MAX_PLAYS`. Il README dichiarava funzioni (multipla «sicura», API Ninjas come unica fonte) non più corrispondenti al codice: corretto.

## Migrazioni Supabase / variabili Cloudflare
Nessuna migrazione. Nessuna nuova variabile.
