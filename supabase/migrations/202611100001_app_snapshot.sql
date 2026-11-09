-- Stay Live: istantanea dei dati dell'app, costruita ogni 4 ore dal giro completo (GitHub Actions, scripts/full-refresh.js).
-- Contiene l'elenco partite già calcolato (consigli, Over/Under, corner, stato dei campionati) e il rapporto dell'ultimo giro:
-- l'app lo legge da /api/board senza alcun calcolo (su Cloudflare Free il tempo di CPU è di 10 ms a richiesta).
-- Una riga sola per tipo (id = 'fixtures'), sovrascritta a ogni giro: occupa meno di 1 MB.

create table if not exists public.app_snapshot (
  id        text primary key,
  payload   jsonb not null,                       -- risposta di /api/fixtures: matches, leagues, continents, needsSync…
  meta      jsonb not null default '{}'::jsonb,   -- rapporto del giro: esito, fasi, copertura, crediti API-Football
  built_at  timestamptz not null default now()
);

-- Come le altre tabelle: nessun accesso con la chiave pubblica, solo con la service role (che salta le regole).
alter table public.app_snapshot enable row level security;
