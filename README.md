# Stay Live

**Stay Live** è una dashboard web in italiano per analisi pre-partita e live della Serie A, con focus su Over/Under gol e corner. Il repository è progettato per GitHub + Cloudflare Pages + Supabase e non richiede un server Node permanente.

> Importante: questo progetto è uno starter tecnico. Le stime statistiche sono sperimentali, non validate e non costituiscono consigli di scommessa. Non vengono mostrate quote inventate. Prima di usare i dati, configura i servizi e verifica il piano del provider.

## Funzioni incluse

- Dashboard responsive con tema chiaro, filtri per stato partita e modale di dettaglio.
- Endpoint server-side `/api/fixtures` per partite live e prossime partite da API-Football, con fallback alle partite archiviate in Supabase.
- Endpoint protetto `/api/sync` per importare le ultime partite concluse e le statistiche squadra (corner, tiri, possesso e cartellini) in Supabase.
- Endpoint `/api/analysis` per statistiche descrittive sugli ultimi 5 o 10 incontri e stime sperimentali Over/Under basate su Poisson.
- Endpoint `/api/odds` che restituisce solo snapshot delle quote già archiviati nel database e calcola la media aritmetica per selezione/mercato. Non scarica né inventa quote.
- Test unitari del modello statistico (`npm test`).

## Stack

- Vite + JavaScript ES modules
- Cloudflare Pages Functions
- Supabase PostgreSQL + PostgREST
- API-Football (chiave opzionale, solo lato server)

## Requisiti

- Node.js 20.19+ o 22.12+ consigliato per Vite 7
- Account GitHub
- Account Cloudflare
- Progetto Supabase
- Chiave API-Football, se vuoi usare dati dal provider

## Avvio locale

```bash
npm install
npm test
npm run build
npm run dev
```

Il comando `npm run dev` serve la dashboard, ma le Pages Functions potrebbero non essere eseguite come su Cloudflare Pages. Per testare localmente anche le Functions usa Wrangler/Cloudflare Pages dev, configurando le variabili locali in `.dev.vars` (mai committare questo file).

## Variabili Cloudflare Pages

In **Workers & Pages → il progetto → Settings → Variables and Secrets**, imposta:

| Variabile | Tipo | Necessaria per |
|---|---|---|
| `API_FOOTBALL_KEY` | Secret | Partite e statistiche dal provider |
| `API_FOOTBALL_BASE_URL` | Variabile opzionale | Default `https://v3.football.api-sports.io` |
| `SUPABASE_URL` | Variabile | URL del progetto Supabase |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret | Lettura/scrittura server-side nel database |
| `SYNC_SECRET` | Secret | Protezione dell'endpoint di sincronizzazione |

**Non inserire `SUPABASE_SERVICE_ROLE_KEY`, `API_FOOTBALL_KEY` o `SYNC_SECRET` nel frontend, in GitHub, in screenshot o in file committati.** La chiave `service_role` bypassa le policy RLS ed è esclusivamente server-side.

## Schema Supabase

La migrazione SQL è in `supabase/migrations/202610290001_initial_schema.sql`. Contiene competizioni, stagioni, squadre, partite, statistiche squadra-partita, previsioni e snapshot quote.

Il database del progetto era stato già inizializzato in precedenza. Prima di eseguire la migrazione su un database esistente, controlla le tabelle e le policy: non applicare alla cieca migrazioni su un progetto con dati importanti.

## Sincronizzare storico e statistiche

Dopo il deploy e la configurazione delle variabili, invia una richiesta `POST` all'endpoint:

`https://TUO-DOMINIO.pages.dev/api/sync`

Header:
`x-sync-secret: IL_TUO_SYNC_SECRET`

Body JSON:
```json
{"last": 10}
```

`last` può essere da 1 a 20. La sincronizzazione usa una richiesta per la directory squadre, una per l’elenco delle ultime partite e una richiesta aggiuntiva per ogni partita completata per recuperare le statistiche. Quindi, per 10 partite, usa indicativamente 12 richieste API (più eventuali retry), oltre alle richieste per la dashboard. Controlla il limite del tuo piano prima di usarla. Non esporre mai il secret in un'app pubblica o in un frontend; esegui la chiamata da un ambiente privato.

L'endpoint importa le ultime partite concluse della stagione 2026/27, i dati delle squadre, le partite e le statistiche disponibili. I dati mancanti (ad esempio corner non forniti dal provider) restano `null`.

## Endpoint

### `GET /api/fixtures`
Restituisce le partite live e le prossime partite di Serie A; fallback su Supabase. Se non ci sono dati configurati restituisce `demo: true` e un array vuoto. La dashboard mostra quindi esempi identificati come demo.

### `POST /api/sync`
Richiede `x-sync-secret` e le chiavi Supabase/API-Football. Importa fino a 20 partite concluse recenti e recupera le relative statistiche.

### `GET /api/analysis?homeTeamId=ID&awayTeamId=ID&matches=5`
Restituisce medie e stime sperimentali. `matches` accetta 5 o 10. Gli ID sono gli ID interni di `teams` in Supabase, non gli ID del provider.

### `GET /api/odds?fixtureId=ID`
Restituisce snapshot già salvati in `odds_snapshots`, con media semplice delle quote per mercato, linea, selezione e stato live. Non importa quote da un bookmaker in questa versione.

## Quote e limiti del modello

- Le quote non sono incluse finché non viene collegato e autorizzato un provider di quote e salvati gli snapshot nel database.
- L'endpoint di analisi usa medie semplici e distribuzione di Poisson come baseline dimostrativa. Non considera ancora forza avversaria aggiustata, separazione casa/trasferta, correzioni per lo stato live, calibrazione storica o value betting. Non interpretare le percentuali come probabilità affidabili senza una validazione out-of-sample.
- Le partite live non mostrano corner live finché non viene aggiunta una sincronizzazione delle statistiche in tempo reale.
- I limiti API dipendono dal piano effettivo del tuo account.

## Deploy su Cloudflare Pages collegato a GitHub

1. Carica il contenuto della repository su GitHub, mantenendo le cartelle.
2. In Cloudflare Pages, crea un progetto collegato alla repository.
3. Framework preset: **Vite**.
4. Build command: `npm run build`.
5. Build output directory: `dist`.
6. Configura le variabili e i secrets elencati sopra.
7. Dopo il deploy, prova `GET /api/fixtures` e verifica che `demo` sia `false` quando i dati reali sono disponibili.
8. Esegui `npm test` e `npm run build` prima di ogni aggiornamento importante.

## Struttura

```text
stay-live/
├── functions/
│   └── api/
│       ├── _lib.js
│       ├── analysis.js
│       ├── fixtures.js
│       ├── model.js
│       ├── odds.js
│       └── sync.js
├── public/
│   └── favicon.svg
├── src/
│   ├── main.js
│   └── style.css
├── supabase/
│   └── migrations/
│       └── 202610290001_initial_schema.sql
├── tests/
│   └── model.test.js
├── index.html
├── package.json
└── wrangler.toml
```
