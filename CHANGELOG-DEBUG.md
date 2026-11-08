# CHANGELOG-DEBUG — audit e revisione del motore Stay Live

Estrai lo ZIP direttamente sopra il progetto (stessa struttura di cartelle). Nessun file va eliminato (vedi «Codice morto»).
Verifica eseguita: `node --test` → 105 test, 105 superati. **`npm run build` NON è stato eseguito** (Vite non installato nell'ambiente di lavoro, nessuna rete): esegui `npm install && npm run check` prima del deploy.

## File nuovi
- `supabase/migrations/202611070001_backtest_finals_view.sql` — vista `backtest_finals` (già applicata al progetto Supabase).
- `functions/api/_names.js` — abbinamento nomi squadra (spostato da `_odds.js`).
- `src/corners.js`, `tests/cornerui.test.js` — blocco «calci d'angolo» (stessa funzione per preview, giocate salvate e multiple) e verdetti a partita finita.
- `scripts/backtest.js`, `scripts/metrics.js` — backtest cronologico (60/20/20, nessun dato futuro), metriche, taratura su validazione, Platt scaling.
- `tests/quant.test.js`, `tests/backtest.test.js` — test dei casi matematici noti, EV, Dixon-Coles, probabilità prudente, congiunta, Kelly, assenza di look-ahead, metriche, Platt.
- `CHANGELOG-DEBUG.md`.

## File modificati
`functions/api/model.js`, `functions/api/_corners.js`, `functions/api/_apifootball.js`, `functions/api/corners.js`, `functions/api/quotes.js`, `functions/api/_odds.js`, `functions/api/_scrape.js`, `functions/api/_lib.js`, `src/plan.js`, `src/main.js`, `src/afdetail.js`, `src/plays.js`, `src/report.js`, `src/style.css`, `tests/model.test.js`, `tests/brain.test.js`, `tests/corners.test.js`, `tests/apifootball.test.js`, `tests/afdetail.test.js`, `package.json` (script `backtest`), `README.md`.

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

## Corner: favorita, dettagli e confronto a fine partita (aggiornamento)
- **Preview**: per ogni partita si vede chi è favorita a fare più corner (mercato «Corners 1x2» di API-Football: probabilità senza margine, quote mediane, n° bookmaker, margine, barra casa/pari/trasferta; «nessuna favorita» sotto 3 punti di differenza), la linea principale del totale (Over/Under con probabilità e quote) e il lato più probabile. I dati arrivano in background dopo il preview e la card si aggiorna da sola.
- **Partita finita**: corner reali dalle statistiche di squadra («Corner Kicks» di `fixtures?id=`) e verdetti ✓/✗: favorita rispettata (più corner della favorita), lato Over/Under centrato, linea principale. Pari nei corner = favorita non rispettata; totale esattamente sulla linea = rimborso.
- **Giocate salvate e multiple**: la card è la stessa del preview (lo snapshot ora include corner e stato). «Aggiorna risultati» scarica anche i corner reali e li copia nella giocata (`cres`), così restano dopo la scadenza della cache. Le gambe delle multiple mostrano una riga di sintesi. Testo copiato e PDF includono la riga corner.
- Endpoint `/api/corners?ids=…[&actual=1]`: con `actual=1` restituisce anche `actual` e `actualState`.
- **Verificato sul database Supabase**: l'elenco ufficiale `odds/bets` in cache contiene «Corners 1x2» (id 55) e le statistiche in cache contengono «Corner Kicks» (valore numerico). Non verificati dal vivo: le etichette Home/Draw/Away dentro «Corners 1x2» e la disponibilità delle quote dopo il fischio d'inizio.
- **Costo API**: +1 richiesta per partita per le quote «Corners 1x2» e +1 per i corner reali delle partite finite (stessa cache della scheda dati). API-Football può non conservare le quote dopo il fischio d'inizio: per questo la previsione si salva nella giocata.
- La favorita è l'opinione dei bookmaker, non un modello nostro (`verified: false`): non entra in singole né multiple.

## Niente più The Odds API; scheda partita unica (aggiornamento)
- **The Odds API rimossa**: eliminati pulsante «Preleva quote reali», chiamata `/api/quotes`, `pvMarket`, le chiavi `oddsKey` dei campionati e i relativi test. Le quote reali vengono solo da API-Football (preview: `pick.odds`; il piano usa «inserita > mercato API-Football > stimata»). `quotes.js` risponde ora 410 e `_odds.js` è un file vuoto (nessuno lo importa): **puoi eliminarli entrambi**. Le funzioni di abbinamento nomi sono in `_names.js`.
- **Da fare a mano (facoltativo)**: togliere `ODDS_API_KEY` / `ODDS_REGIONS` da Cloudflare; la tabella `odds_quotes` (migrazione `202610300001_odds_quotes.sql`) non serve più: `drop table if exists public.odds_quotes;` solo se vuoi rimuoverla (distruttivo, non incluso).
- **Scheda partita unica**: via le due schede («Analisi» / «Dati API-Football»). Un solo scorrimento: intestazione, Cosa giocare, calci d'angolo (previsione del mercato e, a partita finita, corner reali con verdetti), gambe per le multiple, pronostico API-Football con il suo peso, dati della partita (infortuni, formazioni, eventi, statistiche, giocatori, a richiesta classifica/H2H/allenatori), poi «Tutti i mercati e come è calcolato». Niente testata né sezioni ripetute (pronostico e linee consigliate compaiono una volta sola).
- **Costo API**: i dati API-Football della scheda si scaricano all'apertura (prima solo alla scheda «Dati»): ~6 richieste per partita aperta, più 2 per i corner. Restano in cache.
- Non verificato dal vivo: il rendering nel browser (non c'è un browser qui); solo sintassi, import e test su funzioni pure e HTML generato.

## Supabase: controlli ed interventi (progetto `unyslooizzzhaeegzlkn`, eu-west-2)
- **Applicata**: migrazione `backtest_finals_view` (vista di sola lettura, `security_invoker`, nessun accesso per anon/authenticated; 3.838 righe). Export backtest: `select * from public.backtest_finals;` → CSV.
- **Dati**: 3.866 finali nella stagione in corso (nessun duplicato, nessun punteggio mancante o anomalo, nessuna partita ferma in stato sbagliato). 28 sono decise ai supplementari/rigori: ora escluse dalle medie (`decided_in` letto da `loadFinals`) e dalla vista. Limite: il punteggio delle gare ai supplementari resta quello dopo 120' anche per la liquidazione di Over/Under (0,7% delle partite).
- **Pronostici mancanti (diagnosi)**: non era il limite giornaliero (`af_usage`: 467 richieste su 7.500 oggi) ma il limite **al minuto** di API-Football (errori «Too many requests… per minute» in `af_cache`). Il retry dell'app è la contromisura giusta; anteprime con molte partite si completano in più passaggi.
- **Controllo descrittivo di Dixon-Coles** su 3.866 partite (medie campionato 1,68 / 1,33): 0-0 osservato 5,46% contro 4,90% attesi dal Poisson indipendente, 1-1 10,53% contro 11,00%: nessuna evidenza a favore di una correzione standard, quindi `rho = 0` resta. Non è una taratura (serve il backtest per partita).
- **Avvisi di sicurezza/prestazioni**: solo livello INFO. «RLS senza policy» su 7 tabelle è voluto (il server usa la chiave di servizio; aggiungere policy aprirebbe l'accesso). Indici non usati e FK senza indice sono nelle tabelle legacy vuote.
- **Non toccato (decidi tu)**: `odds_quotes` (12 righe) e `odds_usage` (1) non servono più, ma l'app in produzione le usa finché non distribuisci questo patch; dopo il deploy: `drop table if exists public.odds_quotes, public.odds_usage;`. Le tabelle legacy vuote (`fixtures`, `teams`, `team_match_stats`, `predictions`, `odds_snapshots`, `competitions`, `seasons`, `favorites`, `api_cache`, `analysis_log`) non sono usate dal codice.
- **Backtest non eseguito sui dati reali**: l'ambiente non può portare 3.838 righe dal database al sandbox senza ritrascriverle a mano (rischio di errori). Esporta il CSV e caricalo in chat: lo lancio io.

## Taratura Over/Under: `formShrinkK` 4 → 24 (aggiornamento)
Misurato su `backtest_finals` (2.126 partite dal 1/5/2026, forma delle ultime 8 gare, media gol del campionato, nessun dato futuro), mercato Over 2,5:
- Con `formShrinkK = 4` (prima) il modello storico era PEGGIORE della sola media del campionato (Brier 0,2507 vs 0,2428). Over dichiarati al 71% uscivano al 64%; **Under dichiarati al 63% uscivano al 46,5%** (peggio di una moneta).
- Con 24 (≈ 30 partite non pesate) Brier 0,2416 (meglio della media campionato) e **Over dichiarati al 67,2% escono al 67,1%**: taratura perfetta. Gli Under diventano rari (pochi con probabilità alta): è corretto, il segnale non c'è.
- Nuovo parametro `MODEL.formShrinkK` (solo forma squadra); `shrinkK` resta per i gol attesi di API-Football. `model_ver` cambia da solo: le previsioni nuove non si mescolano alle vecchie.
- Limite: misurato solo sulla componente storica (senza API-Football né quote) e senza quote storiche: dimostra la taratura, NON la redditività.
- Effetto atteso: molti meno BET (su dati senza differenze reali tra squadre il numero di BET cala di oltre la metà: test in `tests/backtestbets.test.js`).

## Registro di tutti i mercati (`prediction_legs`) — base del selettore di mercato (aggiornamento)
- **Perché**: i dati storici di API-Football non esistono (nella cache solo dal 4/11/2026), quindi non si possono backtestare. Si registrano da ora, per ogni partita e PRIMA del calcio d'inizio, tutte le 14 selezioni con la probabilità di ogni fonte (`p_model` storico, `p_api` pronostico API-Football, `p_market` quote senza margine), la finale `p`/`p_low`, la quota reale mediana e il numero di bookmaker.
- **Migrazione `202611090001_prediction_legs.sql`** (GIÀ APPLICATA al progetto Supabase): tabella `prediction_legs` (chiave `game_id + sel_key`, RLS senza policy, trigger che congela le righe al calcio d'inizio) e due viste di sola lettura: `prediction_leg_results` (esito `won` a partita finita, esclusi supplementari e rigori) e `prediction_leg_scorecard` (per mercato: tasso reale, Brier di modello/API/mercato/fusione sulle STESSE partite, ROI a puntata fissa sulle quote reali).
- **Codice**: `legRows` e `recordLegs` in `_predictions.js`; `snapshot.js`, `analysis.js` e `preview.js` registrano anche le selezioni (stessa condizione delle righe esistenti). `/api/snapshot` restituisce ora anche `legs`. Il workflow «Registra i pronostici» ogni 4 ore riempie il registro per tutte le partite delle prossime 36 ore, senza richieste in più ad API-Football.
- **Dimensione**: ~14 righe da ~120 byte per partita, circa 60 MB a stagione con ~100 partite al giorno.
- **Lettura**: `select * from public.prediction_leg_scorecard order by n desc;` nell'SQL Editor. Con meno di ~300 esiti per riga le differenze sono rumore.
- **Non fatto (volutamente)**: il selettore di mercato e il peso delle fonti per mercato: senza storico sarebbe una scelta alla cieca. Arriva quando il registro ha dati.

## Grafica: O/U + corner in «Tutte», icone animate, gesture (aggiornamento)
- **Lista «Tutte» / «Solo BET»**: sotto il consiglio compaiono gli stessi chip della schermata «O/U + corner» (Over/Under 2,5 con probabilità e API, corner Over/Under con quota) e, quando i corner sono scaricati, la **barra «più corner»** casa / pari / trasferta con la favorita (`cornerBarHtml` in `src/corners.js`). Le quote corner restano a richiesta («Cerca i corner», ora visibile anche in «Tutte»): nessuna richiesta in più ad API-Football in automatico. Anche i corner già aperti nella scheda partita compaiono in lista (cache).
- **Icone**: `src/icons.js` — icone in stile Lucide (check, flag, trending-up/down, grip) in JavaScript puro con animazioni CSS (tratto che si disegna, bandierina che sventola, maniglia che si ingrandisce). NON è il pacchetto «lucide-animated» (React + Motion): l'app non usa React e qui non c'è rete per installarlo; le animazioni sono equivalenti ma più leggere.
- **Animazioni** (solo al primo caricamento della lista, così non ripartono a ogni selezione): barre di probabilità e barra corner che crescono, chip che entrano a scalare, bandierina; tutte spente con «riduci movimento» (regola già presente nel CSS).
- **Swipe** (`src/gestures.js`): su touch, trascina una partita a destra per selezionarla, a sinistra per deselezionarla (feedback visivo e vibrazione); col mouse resta la casella. Soglia 64 px e gesto nettamente orizzontale, così lo scroll verticale e il pull-to-refresh non cambiano.
- **Trascinamento**: nelle «Le mie giocate» ogni giocata ha una maniglia a sinistra per riordinarla (touch, mouse; con la tastiera frecce su/giù sulla maniglia). L'ordine resta nel browser.
- **Test**: `tests/gestures.test.js` (soglie dello swipe, riordino, icone, barra corner). **Non verificato**: il comportamento nel browser (nessun browser/rete qui, quindi neanche `npm run build`): prova swipe e trascinamento sul telefono prima del deploy.

## Errore Cloudflare 1102 «Worker exceeded resource limits» (HTTP 503 senza messaggio) — correzione
- **Causa**: `/api/fixtures` rifaceva a OGNI richiesta l'analisi completa di tutte le partite aperte della finestra (oggi 599 su 21 giorni, per via della sincronizzazione di 32 campionati): ~340–620 ms di CPU per richiesta, anche con la versione originale (misurato con 3.838 partite storiche e 599 aperte). Cloudflare interrompe la funzione quando supera il tempo di calcolo concesso. Non dipende dalle patch precedenti (stessa CPU prima e dopo).
- **`probabilities()`** riscritta senza matrici né array annidati (stessi numeri: differenza massima 1,7e-15 su 20.000 coppie di gol attesi; 300 partite confrontate con la versione precedente: consigli e probabilità identici). `round()` senza `toFixed`. `posteriorLowProbabilities()` senza oggetti temporanei.
- **Memoria nell'isolate** in `fixtures.js`: contesto dello storico e consiglio rapido di ogni partita si ricalcolano solo se cambia lo storico, la partita o i dati API-Football. Simulazione di `/api/fixtures` con dati delle stesse dimensioni: originale 340–620 ms per richiesta; ora ~335 ms alla prima richiesta di un isolate «freddo» e ~17 ms dalle successive.
- **Se l'errore persiste** (la prima richiesta a freddo pesa ancora): variabile Cloudflare `FIXTURES_DAYS` (3–30, default 21) più bassa, per esempio 5, e nuovo deploy: meno partite da analizzare alla prima richiesta.
- Limite: misurato in locale con Node, non su Cloudflare.

## Errore 1102 persistente: copia pronta di /api/fixtures (cache del data center)
- **Causa**: anche dopo l'ottimizzazione dei calcoli, la prima richiesta di ogni istanza costa ~200–300 ms di CPU (599 partite, 3.838 storiche; misura in Node con dati simulati) e anche le successive superano i 10 ms concessi dal piano Workers Free. Oltre il limite Cloudflare risponde «Worker exceeded resource limits» (1102).
- **Correzione**: `functions/api/_edgecache.js` tiene pronta l'ultima risposta di `/api/fixtures` nella cache Cloudflare: 60 s «fresca», poi servita comunque e rinnovata in secondo piano (`waitUntil`) fino a 30 minuti; gli errori non si memorizzano e, se il rinnovo fallisce, resta la copia buona. `?fresh=1` salta la copia: lo usano l'aggiornamento manuale, il tira-per-aggiornare e le riletture dopo sincronizzazione e scudetti. Misura con fetch e cache simulati: 300 ms la prima volta, 3–5 ms dalle successive.
- **Limiti**: la copia è per data center; il primo ricalcolo a freddo pesa ancora e, se Cloudflare lo interrompe, la copia non si crea finché un ricalcolo non riesce. Soluzioni più forti: piano Workers Paid (30 s di CPU) oppure `FIXTURES_DAYS` più basso (es. 7) per analizzare meno partite.

## Corner automatici e salvataggio dalla lista
- **Niente più ricerca manuale**: tolti il pulsante «Cerca i corner» e il suo stato. Le quote corner si cercano da sole:
  - ogni notte a mezzanotte (ora italiana) per TUTTE le partite in programma nei prossimi 7 giorni: workflow `.github/workflows/corner-notturni.yml` + `scripts/nightly-corners.js` (parte due volte, 22:05 e 23:05 UTC, e prosegue solo quando a Roma è mezzanotte; stessi secrets `SITE_URL` e `SYNC_SECRET`). Riscarica le quote più vecchie dell'inizio del giro (`/api/corners?since=…`, solo con il segreto) a gruppi di 6 partite, aspettando e riprovando se API-Football limita le richieste;
  - quando si ricarica (aggiornamento a mano o dei risultati nelle Giocate) l'app completa in secondo piano i corner ancora mancanti (max 40, al massimo una volta ogni 10 minuti per le aperture ripetute).
- **Validità**: le quote corner restano valide 27 ore (`ttlFor("corner-odds")`), cioè fino alla notte dopo; `/api/fixtures` ora porta i corner già in cache di tutte le partite dei prossimi 7 giorni (prima 3). La lettura della cache `af_cache` avviene a gruppi di 40 chiavi (indirizzi troppo lunghi con molte partite).
- **Salva una giocata dalla lista**: ogni partita non ancora iniziata con un consiglio ha un segnalibro che salva la giocata (consiglio principale; in «O/U + corner» l'Over/Under 2,5 mostrato), senza puntata né quota. I corner non si salvano come giocata: non esiste un modello né un esito verificabile.
- Nessuna modifica al database.
