-- Stay Live: diagnostica dell'aggiornamento, compiti da completare e storico dei corner (solo API-Football). Additiva: non cancella nulla.
--
-- refresh_tasks : operazioni NON completate (temporanee o in errore) con numero di tentativi e prossimo tentativo.
--                 Le crea e le chiude lo script scripts/full-refresh.js; il recupero automatico (ogni 30 min) riprende da qui.
-- refresh_runs  : rapporto di ogni giro (completo, recupero, manuale) per lo storico.
-- match_corners : corner reali per partita finita (API-Football fixtures/statistics): base del modello statistico dei corner.
--                 available = false -> il provider non fornisce le statistiche di quella partita (non si riscarica).

create table if not exists public.refresh_tasks (
  task_key      text primary key,                  -- es. "prediction:af-123456", "league:seriea"
  component     text not null,                     -- league | prediction | market | corners | cornerStats | details
  scope         text not null,
  league        text,
  state         text not null check (state in ('temporary','error')),
  attempts      integer not null default 1,
  last_error    text,
  next_try_at   timestamptz not null,
  first_seen_at timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists refresh_tasks_next_idx on public.refresh_tasks (next_try_at);

create table if not exists public.refresh_runs (
  id          bigint generated always as identity primary key,
  mode        text not null,                       -- full | recover | manual
  status      text not null,                       -- ok | partial | failed
  started_at  timestamptz not null,
  finished_at timestamptz,
  meta        jsonb not null default '{}'::jsonb
);
create index if not exists refresh_runs_started_idx on public.refresh_runs (started_at desc);

create table if not exists public.match_corners (
  game_id      text primary key,
  league       text not null,
  season       integer not null,
  kickoff_at   timestamptz,
  home_id      text not null,
  away_id      text not null,
  home_corners integer,
  away_corners integer,
  available    boolean not null default false,
  fetched_at   timestamptz not null default now()
);
create index if not exists match_corners_league_idx on public.match_corners (league, season, kickoff_at desc);

alter table public.refresh_tasks enable row level security;
alter table public.refresh_runs enable row level security;
alter table public.match_corners enable row level security;
-- Nessuna policy pubblica: si leggono e scrivono solo con la service role (lato server).
