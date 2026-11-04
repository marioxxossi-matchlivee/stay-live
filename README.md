# Stay Live

Analisi pre-partita per **Serie A, Premier League, LaLiga, Bundesliga, Ligue 1, MLS, Champions League ed Europa League**: probabilità per 1X2, doppia chance, Over/Under 1,5·2,5·3,5 ed entrambe segnano, verdetto **BET / EVITA** con la quota minima da cercare, e **preview di giornata** sulle partite che scegli.

Stack: Vite (JS vanilla) · Cloudflare Pages Functions · Supabase · API Ninjas (piano gratuito).

> Le stime sono sperimentali e usano solo i gol: non sono garanzie né consigli finanziari.

## Messa in funzione

1. **Supabase → SQL Editor**: esegui `supabase/migrations/202610290002_matches_cache.sql` (additiva, crea `matches` e `sync_state`; la migrazione precedente resta valida ma non è più usata).
2. **Cloudflare Pages → Settings → Variables and Secrets**: `API_NINJAS_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (secret). Opzionale `SYNC_SECRET`.
3. Build: `npm run build`, output `dist`. Push su GitHub e il deploy parte da solo.
4. Apri il sito: al primo accesso l'app scarica i campionati da API Ninjas e li salva in Supabase (qualche secondo).

## Menu campionati e PDF

Il menu in alto è organizzato per **continente > nazione (accordion) > campionati**; le coppe europee stanno sotto Europa > Coppe europee. Per aggiungere un campionato basta una riga in `LEAGUES` (`functions/api/_lib.js`) con continente, nazione e categoria. Il pulsante **Condividi PDF** della preview crea il PDF nel browser (`src/pdf.js`, nessuna dipendenza) e lo condivide col foglio di sistema; dove non è supportato lo scarica.

## Budget, puntate e vincita potenziale

Il resoconto è diviso in tre blocchi: **Multiple consigliate** (sicura = le 2 giocate più probabili, equilibrata = 3, ambiziosa = fino a 5), **Singole consigliate** e **Da evitare**; ogni multipla ha la sua puntata e vincita, calcolate sul prodotto di probabilità e quote (anche il margine del bookmaker si moltiplica, quindi le puntate sono più basse). Nel resoconto (preview) inserisci il **budget**; per ogni BET puoi scrivere la **quota reale** del bookmaker. Senza quota l'app usa una **quota stimata** = quota equa / 1,06 (margine medio del 6%). La puntata si calcola con **Kelly a un quarto** sulla probabilità prudente, con tetti: 5% del budget su una singola, 2% sulla multipla, 20% di esposizione totale (tutto in `MODEL`, `functions/api/model.js`). Se a quella quota il valore atteso prudente è sotto 1,03 non si punta: l'app indica invece la quota minima da trovare e quanto puntare *se* il bookmaker la paga. Il PDF riporta lo stesso piano.

Attenzione: una quota stimata dal modello non può creare un vantaggio (il margine del bookmaker lo toglie per costruzione). Il piano è affidabile solo con quote reali; nessuna stima garantisce un guadagno.

## Quote reali (The Odds API, piano gratuito)

Nel resoconto il pulsante **Preleva quote reali** chiede a The Odds API la quota del solo mercato consigliato (BET) di ogni partita scelta. Per non sprecare i 500 crediti mensili: l'elenco eventi è gratuito, si spende 1 credito per partita e mercato (`totals`+`alternate_totals` contano 1 se ne risponde uno solo), le quote restano in cache 3 ore su Supabase (`odds_quotes`), al massimo 12 partite per richiesta e stop sotto 40 crediti residui (`odds_usage`). Il piano usa la **mediana** dei bookmaker (mostra anche la migliore); priorità: quota inserita a mano > mercato > stima.

Setup: crea la chiave su the-odds-api.com, aggiungi `ODDS_API_KEY` (e opzionale `ODDS_REGIONS`, default `eu`) alle variabili di Cloudflare, applica `supabase/migrations/202610300001_odds_quotes.sql` (già applicata sul tuo progetto). I bookmaker della regione `eu` non sono necessariamente quelli italiani ADM: controlla sempre la quota sul tuo.

## Come arrivano i dati

`/api/fixtures` legge da Supabase. Se i dati di un campionato sono vecchi, la pagina chiama `/api/sync?league=…`, che interroga API Ninjas **solo se serve**: ogni 6 ore, oppure ogni 15 minuti per i campionati con partite iniziate da meno di 4 ore o in partenza. Un sync costa circa 8 chiamate per campionato; con dati freschi ne costa 0, quindi chiunque apra il sito non può consumare la quota. Errori: nuovo tentativo dopo 2 minuti. Nessun dato demo: se qualcosa manca viene mostrato l'errore reale.

## Come sono calcolate le percentuali

Fonte unica del codice: `functions/api/model.js` (tutte le costanti sono lì e compaiono nell'app in "Come calcoliamo").

1. **Media gol di riferimento** del campionato (casa e trasferta), mescolata con 1,5 / 1,2 come se fossero 30 partite. Sotto 20 partite giocate si usa la media di tutti i campionati.
2. **Attacco e difesa** di ogni squadra sulle ultime 5/8/10 partite (tutte le competizioni). Gol fatti e subiti divisi per la media del campionato in cui sono stati segnati; peso `0,92^k` (più vecchia = meno peso); poi 4 partite "medie" aggiunte per evitare valori estremi.
3. **Gol attesi**: `λ casa = media casa × attacco casa × difesa trasferta`, `λ trasf. = media trasf. × attacco trasf. × difesa casa` (limitati a 0,2–4; campo neutro: stessa media per entrambe).
4. **Probabilità**: Poisson indipendente per le due squadre, punteggi 0–0 … 10–10. Ogni mercato è una somma di caselle, quindi tutti i mercati sono coerenti.
5. **Probabilità prudente**: attese gol incerte di `±0,30/√partite`; si ricalcolano 5 scenari e si tiene il peggiore. È la percentuale mostrata in grande.
6. **BET** se: campione ≥ 5 partite per squadra, probabilità prudente ≥ 60%, e almeno 8 punti sopra la frequenza storica di quell'esito nel campionato (evita mercati "sempre probabili" come Over 1,5). **Quota minima** = `1,03 / probabilità prudente`. Se inserisci la tua quota: BET se `prob. prudente × quota ≥ 1,03`. Esiti con quota equa < 1,25 non sono proposti.
7. **Multipla**: fino a 4 BET di partite diverse; probabilità = prodotto delle prudenti.

Limiti: soglie non calibrate su uno storico lungo; nessuna quota reale, infortuni o formazioni; API Ninjas non fornisce corner né quote, quindi i mercati corner non sono calcolabili; copre solo 8 competizioni (5 campionati top europei, Champions, Europa League, MLS), nessuna serie minore. Senza la quota del bookmaker "BET" significa solo "alta probabilità rispetto alla norma", non "scommessa di valore".

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
npm test          # modello e politica di sync
npm run build
```
Per provare anche le Functions in locale usa `npx wrangler pages dev dist` con le variabili in `.dev.vars`.
