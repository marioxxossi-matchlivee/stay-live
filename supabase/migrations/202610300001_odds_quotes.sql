-- Stay Live v3: cache delle quote reali (The Odds API) e contatore dei crediti. Additiva.
create table if not exists public.odds_quotes (
  game_id        text not null,
  selection      text not null,
  odds_median    numeric not null,
  odds_best      numeric not null,
  best_bookmaker text,
  books          integer not null default 0,
  line           numeric,
  event_id       text,
  captured_at    timestamptz not null default now(),
  primary key (game_id, selection)
);

create table if not exists public.odds_usage (
  id         integer primary key default 1 check (id = 1),
  remaining  integer,
  used       integer,
  last_cost  integer,
  updated_at timestamptz not null default now()
);

alter table public.odds_quotes enable row level security;
alter table public.odds_usage enable row level security;
-- Nessuna policy pubblica: accessibili solo con la service_role key (lato server).
