# Stay Live

Analisi pre-partita per **Serie A, Premier League, LaLiga, Bundesliga, Ligue 1, MLS, Champions League ed Europa League**: probabilità per 1X2, doppia chance, Over/Under 1,5·2,5·3,5 ed entrambe segnano, verdetto **BET / EVITA** con la quota minima da cercare, e **preview di giornata** sulle partite che scegli.

Stack: Vite (JS vanilla) · Cloudflare Pages Functions · Supabase · API Ninjas (calendario) · API-Football (pronostici, quote, infortuni).

> Le stime sono sperimentali e usano solo i gol: non sono garanzie né consigli finanziari.

## Messa in funzione

1. **Supabase → SQL Editor**: esegui `supabase/migrations/202610290002_matches_cache.sql` (additiva, crea `matches` e `sync_state`; la migrazione precedente resta valida ma non è più usata).
2. **Cloudflare Pages → Settings → Variables and Secrets**: `API_NINJAS_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (secret). Opzionale `SYNC_SECRET`.
3. Build: `npm run build`, output `dist`. Push su GitHub e il deploy parte da solo.
4. Apri il sito: al primo accesso l'app scarica i campionati da API Ninjas e li salva in Supabase (qualche secondo).

## Menu campionati e PDF

Il menu in alto è organizzato per **continente > nazione (accordion) > campionati**; le coppe europee stanno sotto Europa > Coppe europee. Per aggiungere un campionato basta una riga in `LEAGUES` (`functions/api/_lib.js`) con continente, nazione e categoria. Il pulsante **Condividi PDF** della preview crea il PDF nel browser (`src/pdf.js`, nessuna dipendenza) e lo condivide col foglio di sistema; dove non è supportato lo scarica.

## Budget, puntate e vincita potenziale

Il resoconto è diviso in tre blocchi: **Multiple consigliate**, **Singole consigliate** e **Da evitare**. Le multiple (prudente, equilibrata, ad alto rendimento; nessuna è «sicura») compaiono **solo** se esiste una combinazione di partite diverse con quote reali di API-Football e valore atteso prudente positivo (vedi «Multiple»); altrimenti il resoconto dice che è meglio non giocare. Nel resoconto (preview) inserisci il **budget**; per ogni BET puoi scrivere la **quota reale** del bookmaker. Senza quota l'app usa una **quota stimata** = quota equa / 1,06 (margine medio del 6%). La puntata si calcola con **Kelly a un quarto** sulla probabilità prudente, con tetti: 5% del budget su una singola, 2% sulla multipla, 20% di esposizione totale (tutto in `MODEL`, `functions/api/model.js`). Se a quella quota il valore atteso prudente è sotto 1,03 non si punta: l'app indica invece la quota minima da trovare e quanto puntare *se* il bookmaker la paga. La puntata non viene mai arrotondata per eccesso al minimo di 0,50 €: se Kelly dà meno, non si gioca; e il totale non supera mai il 20% del budget (le giocate in eccesso vengono tolte). Il PDF riporta lo stesso piano.

Attenzione: una quota stimata dal modello non può creare un vantaggio (il margine del bookmaker lo toglie per costruzione). Il piano è affidabile solo con quote reali; nessuna stima garantisce un guadagno.

## Quote reali (solo API-Football)

L'app non usa più The Odds API: le quote reali arrivano solo da **API-Football** (mercato «Match Winner» e «Goals Over/Under», mediana tra i bookmaker) e le probabilità solo da API-Football e dal modello. Nel resoconto, la quota reale della giocata consigliata (se il mercato la quota) viene usata al posto della stima; se non c'è, la card lo dice e puoi inserire a mano la quota del tuo bookmaker. `ODDS_API_KEY` e `ODDS_REGIONS` non servono più e si possono togliere da Cloudflare.

## Scheda partita

È una scheda unica (niente più due schede): intestazione, «Cosa giocare», calci d'angolo, gambe per le multiple, pronostico di API-Football, dati della partita (infortuni, formazioni, eventi, statistiche, giocatori; classifica, scontri diretti e allenatori a richiesta) e, in fondo, tutti i mercati con il calcolo passo per passo. I dati di API-Football si scaricano appena apri la scheda.

## Come arrivano i dati

`/api/fixtures` legge da Supabase. Se i dati di un campionato sono vecchi, la pagina chiama `/api/sync?league=…`, che interroga API Ninjas **solo se serve**: ogni 6 ore, oppure ogni 15 minuti per i campionati con partite iniziate da meno di 4 ore o in partenza. Un sync costa circa 8 chiamate per campionato; con dati freschi ne costa 0, quindi chiunque apra il sito non può consumare la quota. Errori: nuovo tentativo dopo 2 minuti. Nessun dato demo: se qualcosa manca viene mostrato l'errore reale.

## Come sono calcolate le percentuali

Fonte unica del codice: `functions/api/model.js` (tutte le costanti sono lì e compaiono nell'app in "Come calcoliamo").

1. **Media gol di riferimento** del campionato (casa e trasferta), mescolata con 1,5 / 1,2 come se fossero 30 partite. Sotto 20 partite giocate si usa la media di tutti i campionati.
2. **Attacco e difesa** di ogni squadra sulle ultime 5/8/10 partite (tutte le competizioni). Gol fatti e subiti divisi per la media del campionato in cui sono stati segnati; peso `0,92^k` (più vecchia = meno peso); poi 4 partite "medie" aggiunte per evitare valori estremi.
3. **Gol attesi**: `λ casa = media casa × attacco casa × difesa trasferta`, `λ trasf. = media trasf. × attacco trasf. × difesa casa` (limitati a 0,2–4; campo neutro: stessa media per entrambe).
4. **Probabilità**: Poisson per le due squadre, punteggi 0–0 … 10–10 (opzionale correzione Dixon-Coles dei punteggi bassi con `MODEL.rho`, oggi 0 perché va stimato con il backtest). Ogni mercato è una somma di caselle, quindi tutti i mercati sono coerenti.
5. **Probabilità prudente**: i gol attesi sono incerti; la varianza deriva dal numero effettivo di partite osservate (dati poissoniani + dispersione tra squadre `teamSd`). Si calcola la probabilità su una griglia 7×7 di scenari e si prende il **quantile 20%** (`pLowQuantile`). Prima era «la peggiore di 5 scenari» con uno scarto scelto a mano (`0,30/√partite`, molto più piccolo dell'incertezza reale). È la percentuale mostrata in grande.
6. **BET** se: campione ≥ 5 partite per squadra, probabilità prudente ≥ 60%, e almeno 8 punti sopra la frequenza storica di quell'esito nel campionato (evita mercati "sempre probabili" come Over 1,5). **Quota minima** = `1,03 / probabilità prudente`. Se inserisci la tua quota: BET se `prob. prudente × quota ≥ 1,03`. Esiti con quota equa < 1,25 non sono proposti.
7. **Valore atteso**: solo con quota reale. EV = p × quota − 1, EV prudente = pLow × quota − 1. Senza quota reale l'app mostra «valore non verificato» e non lo conta come vantaggio. Il mercato da consigliare per ogni partita non è fisso: tra i BET verificati vince l'EV prudente più alto.
8. **Multiple**: vedi sotto.

## Multiple

Una gamba per partita, solo con **quota reale** (mediana tra bookmaker di API-Football), probabilità prudente ≥ 62%, quota ≥ 1,15 e pLow × quota ≥ 1. Ricerca esaustiva sulle 12 partite migliori (2 gambe ciascuna, fino a 5 gambe, al massimo 2 gambe per campionato). Una combinazione è ammessa solo se **probabilità congiunta prudente × quota totale ≥ 1,03**. La probabilità congiunta assume partite indipendenti (ipotesi non verificata; la concentrazione sullo stesso campionato è limitata) e l'incertezza delle gambe si somma in quadratura. Fasce: *prudente* (quota 1,8–3, massimizza la probabilità congiunta prudente), *equilibrata* (3–6) e *ad alto rendimento* (6–14), entrambe massimizzano la crescita attesa del capitale (Kelly). Quote stimate non vengono mai usate: se nessuna combinazione ha valore, nessuna multipla.

## Corner

In preview, nelle giocate salvate e (con i corner reali) a partita finita, la card mostra chi è favorita a fare più corner (mercato «Corners 1x2»), la linea principale del totale e, a fine partita, se la previsione è stata rispettata.

Il modulo corner usa solo le quote di API-Football (`verified: false`): una probabilità ricavata dalla quota non dimostra alcun vantaggio, quindi non entra in singole né multiple. Un modello statistico dei corner richiede i corner storici per partita (`fixtures/statistics`), che l'app non scarica.

## Affidabilità dei BET (registro dei pronostici)
Ogni pronostico principale dell'app viene registrato su Supabase (tabella `bet_predictions`, una riga per partita, ~200 byte) **prima** del calcio d'inizio: dopo, la riga è congelata da un trigger e non si può ritoccare a risultato noto. Si registra da tre punti: ogni preview, ogni analisi aperta e `/api/snapshot`, chiamato ogni 4 ore da `.github/workflows/snapshot-predictions.yml` per **tutte** le partite delle prossime 36 ore (anche quelle mai aperte). Lo snapshot usa solo i dati già in cache di API-Football (nessuna richiesta in più; `?live=N` ne permette N).
`/api/reliability` confronta i BET con il punteggio finale (solo gol) e mostra, in cima a «Giocate»: percentuale di successo con intervallo al 95%, per mercato e per tipo, **dichiarato contro reale** per fasce di probabilità (taratura), rendimento a quota reale e risultati divisi per fonti usate. Conta solo la versione attuale dei parametri del modello (`model_ver`): se ne cambi uno le statistiche ripartono da zero, senza mescolarsi con le vecchie (`?all=1` le somma).
Migrazione: `supabase/migrations/202611080001_bet_predictions.sql`.

## Backtest

`npm run backtest -- --file finals.csv [--compare] [--tune]` (vedi l'intestazione di `scripts/backtest.js` per formato ed export da Supabase). Divisione cronologica 60/20/20, nessun dato futuro, metriche (accuracy, precisione, richiamo, Brier, log loss, ECE, ROI, drawdown, rendimento per campionato e mercato, multiple) e Platt scaling fittato sulla validazione. Con meno di 300 giocate nessun vantaggio viene dichiarato dimostrato. Finché non lo esegui su uno storico reale, nessun miglioramento del modello è provato.

Limiti: soglie e pesi delle fonti (`weights`) non calibrati su uno storico lungo; il modello storico non corregge per la forza degli avversari né separa casa/trasferta; infortuni solo come penalità; il blocco di scraping (`availability`) non alimenta il modello. Senza la quota del bookmaker "BET" significa solo "alta probabilità rispetto alla norma", non "scommessa di valore".

## Infortuni, squalifiche e probabili formazioni (scraping)

Migrazione: `supabase/migrations/202610310001_availability.sql` (crea `match_availability` e `scrape_state`). `/api/availability?ids=…` legge la cache e, solo per partite entro 48 ore, riscarica le fonti: ogni 60 minuti tra 24 e 48 ore dal match, ogni 30 minuti nelle ultime 24 ore, una richiesta per fonte e campionato (non per partita). Fonti: Transfermarkt (Serie A, Premier, LaLiga, Bundesliga, Ligue 1), PremierInjuries (Premier), probabili formazioni Sky Sport (Serie A). Se una fonte fallisce o blocca, l'errore va in `scrape_state` con backoff 10 min → 6 ore e l'app usa il modello statistico standard. Parser puri in `functions/api/_sources.js`, politica e fusione in `_scrape.js`.

Verifica dal sito pubblicato (nessuna scrittura su Supabase): `curl -H "x-sync-secret: $SYNC_SECRET" "https://<sito>/api/scrape-debug?source=transfermarkt&league=seriea"`. Opzionale `LINEUPS_URL_SERIEA` per fissare a mano la pagina delle formazioni.

## API-Football (piano a pagamento)

Migrazione: `supabase/migrations/202611030001_apifootball.sql` (`af_fixture_map`, `af_cache`, `af_usage`). Variabile Cloudflare: `API_FOOTBALL_KEY` (secret). `/api/match-detail?id=<game_id>` collega la partita dell'app a quella di API-Football e restituisce tutto ciò che il piano fornisce: partita (arbitro, stadio, eventi, formazioni, statistiche e giocatori a partita iniziata), infortuni, pronostico del provider, quote Over/Under gol e corner con miglior quota e mediana tra bookmaker, scontri diretti, classifica, statistiche stagionali delle squadre e copertura dati del campionato. Ogni risposta del provider è salvata in `af_cache` con scadenza per tipo di dato (5 min–30 giorni) e il residuo giornaliero è tracciato in `af_usage`: se una chiamata fallisce si usa l'ultima risposta salvata. Le richieste partono distanziate (una ogni 250 ms, regolabile con `API_FOOTBALL_MIN_GAP_MS`; il piano Pro ammette 5 al secondo e 300 al minuto) e, se API-Football risponde "Too many requests", si riprova dopo 1,5 e 4 secondi.

## Campionati (32)

I 8 campionati principali (Serie A, Premier, LaLiga, Bundesliga, Ligue 1, Champions, Europa League, MLS) restano su API Ninjas. Gli altri 24 arrivano da API-Football (`provider: "apifootball"` in `functions/api/_lib.js`): Serie B, Championship, League One, 2. Bundesliga, Ligue 2, Segunda División, Eredivisie, Primeira Liga, Pro League, Scottish Premiership, Süper Lig, Super League greca e svizzera, Bundesliga austriaca, Superliga danese, Ekstraklasa, prima lega ceca, HNL, Liga 1 romena, SuperLiga serba, NB I, Eliteserien, Allsvenskan, Conference League. Una richiesta scarica l'intera stagione di un campionato; si ripete ogni 6 ore (15 minuti con partite in corso). Prima di scrivere, `afCountry`/`afName` verificano che l'id API-Football sia davvero il campionato previsto. Per aggiungerne un altro basta una riga in `LEAGUES`. Se `/api/fixtures` va in errore per il tempo di calcolo (Cloudflare 1102) imposta `FIXTURES_DAYS` (es. 10) o passa a Workers Paid.

## Sviluppo

```bash
npm install
npm test          # modello, multiple, puntate, backtest e politica di sync
npm run backtest -- --file finals.csv --compare
npm run build
```
Per provare anche le Functions in locale usa `npx wrangler pages dev dist` con le variabili in `.dev.vars`.

## Aggiornamento automatico dei campionati (notte e mattino)

Perché l'app si apra subito, i dati dei campionati si aggiornano da soli con un'automazione di GitHub (`.github/workflows/sync-leagues.yml`):

- **00:30 ora italiana** (23:30 UTC): risultati della serata, aggiornamento forzato;
- **07:00 ora italiana** (06:00 UTC): calendario e orari del giorno, solo ciò che è scaduto.

Con l'ora legale gli orari italiani slittano di un'ora (GitHub usa solo l'ora UTC): è ininfluente per lo scopo.

Per attivarla: su Cloudflare Pages imposta la variabile `SYNC_SECRET` (una parola d'ordine lunga a caso); su GitHub → *Settings → Secrets and variables → Actions* crea i secret `SITE_URL` (indirizzo del sito, senza barra finale) e `SYNC_SECRET` (lo stesso valore). Per provarla subito: *Actions → Aggiorna campionati → Run workflow*.

Se le chiamate ad API-Football sono limitate (piano gratuito), il workflow aspetta e riprova da solo; un campionato che non si aggiorna fa risultare il lavoro "fallito" e GitHub ti manda una email.

**Apertura istantanea**: l'app conserva nel dispositivo l'ultimo elenco ricevuto e lo mostra subito; poi si aggiorna in secondo piano. Se un aggiornamento fallisce, restano visibili gli ultimi dati.
