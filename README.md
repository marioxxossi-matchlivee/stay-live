# Stay Live

Analisi pre-partita per **Serie A, Premier League, LaLiga, Bundesliga, Ligue 1, Champions League ed Europa League**: probabilità per 1X2, doppia chance, Over/Under 1,5·2,5·3,5 ed entrambe segnano, verdetto **BET / EVITA** con la quota minima da cercare, e **preview di giornata** sulle partite che scegli.

Stack: Vite (JS vanilla) · Cloudflare Pages Functions · Supabase · API Ninjas (piano gratuito).

> Le stime sono sperimentali e usano solo i gol: non sono garanzie né consigli finanziari.

## Messa in funzione

1. **Supabase → SQL Editor**: esegui `supabase/migrations/202610290002_matches_cache.sql` (additiva, crea `matches` e `sync_state`; la migrazione precedente resta valida ma non è più usata).
2. **Cloudflare Pages → Settings → Variables and Secrets**: `API_NINJAS_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (secret). Opzionale `SYNC_SECRET`.
3. Build: `npm run build`, output `dist`. Push su GitHub e il deploy parte da solo.
4. Apri il sito: al primo accesso l'app scarica i campionati da API Ninjas e li salva in Supabase (qualche secondo).

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

Limiti: soglie non calibrate su uno storico lungo; nessuna quota reale, infortuni o formazioni; API Ninjas (free) non fornisce corner né quote, quindi i mercati corner sono stati rimossi. Senza la quota del bookmaker "BET" significa solo "alta probabilità rispetto alla norma", non "scommessa di valore".

## Sviluppo

```bash
npm install
npm test          # modello e politica di sync
npm run build
```
Per provare anche le Functions in locale usa `npx wrangler pages dev dist` con le variabili in `.dev.vars`.
