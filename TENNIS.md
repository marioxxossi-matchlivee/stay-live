# Stay Live Tennis — messa in esercizio

Provider: SportsAPI365 Direct (`https://api.sportsapi365.com/v1/tennis`, chiave in `X-Gravitee-Api-Key`). Nessun altro provider.
Secrets GitHub: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `TENNIS_API_KEY` (facoltativo `TENNIS_API_BASE`). `TENNIS_API_HOST` e `TENNIS_API_MODE` non servono più.
Cloudflare Pages: solo `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` (l'app legge `/api/tennis-board`; nessuna chiave del provider).

## Passi
1. Eseguire su Supabase, nell'ordine, le migrazioni `202611120001_tennis.sql`, `202611140001_tennis_provider_fields.sql`, `202611150001_tennis_sync.sql` (additive, rieseguibili).
2. GitHub → Actions → «Tennis — sincronizzazione» → Run workflow: `backfill` con 120 giorni (storico per il modello), poi `static`, poi `refresh`.
3. Da lì partono da soli: live ogni 15 min, partite/pronostici ogni 30 min, ranking e statistiche ogni giorno.

## Endpoint usati (tutti verificati dalle sonde del 12/11/2026)
`/upcoming/matches/{atp|wta}?group=singles`, `/{tour}/results/{data}`, `/extend/api/events/live`, `/{tour}/ranking/singles`, `/upcoming/filters?include=options`, `/{tour}/player/match-stats/{id}`.
Non verificati, quindi NON usati: quote e statistiche per singola partita (i link `links.odds/stats` hanno il prefisso vecchio `/tennis/v2/`), `pageNo` sul programma (verificato solo su risultati e ranking: se ignorato la paginazione si ferma e lo segnala in Diagnostica).
Verificati ma non usati: profilo, surface-summary, perf-breakdown.

## Limiti dichiarati
Superficie dei risultati da `courtId` (1 Hard, 2 Clay, 3 I.hard, 5 Grass); codici dei turni non documentati; formato 3/5 set assente nel programma (assunto 3, dichiarato tra i dati mancanti); quote solo Marathonbet/Pinnacle dal programma.
