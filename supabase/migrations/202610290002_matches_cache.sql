-- Stay Live v2: cache delle partite (tutti i campionati, oggi solo da API-Football) in Supabase.
-- Additiva: non tocca le tabelle create dalla migrazione precedente.

create table if not exists public.matches (
  game_id      text primary key,
  league       text not null,
  season       integer not null,
  season_type  text,
  round        text,
  match_date   date,
  kickoff_at   timestamptz,
  status       text not null default 'scheduled',
  home_id      text not null,
  home_name    text not null,
  home_abbr    text,
  away_id      text not null,
  away_name    text not null,
  away_abbr    text,
  home_score   integer,
  away_score   integer,
  decided_in   text,
  neutral_site boolean not null default false,
  synced_at    timestamptz not null default now()
);

create index if not exists matches_league_kickoff_idx on public.matches (league, kickoff_at);
create index if not exists matches_status_kickoff_idx on public.matches (status, kickoff_at);
create index if not exists matches_season_status_idx on public.matches (season, status);

create table if not exists public.sync_state (
  league        text primary key,
  synced_at     timestamptz,
  attempted_at  timestamptz,
  matches_count integer not null default 0,
  last_error    text
);

alter table public.matches enable row level security;
alter table public.sync_state enable row level security;

drop policy if exists "Public read matches" on public.matches;
create policy "Public read matches" on public.matches for select to anon, authenticated using (true);
-- sync_state: nessuna policy pubblica. Accessibile solo con la service_role key (lato server).
