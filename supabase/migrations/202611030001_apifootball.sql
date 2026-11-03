-- Stay Live v5: integrazione API-Football (piano a pagamento). Additiva.
--
-- af_fixture_map: collega l'id partita dell'app (game_id) all'id partita di API-Football (fixture_id) e ai team id.
-- af_cache: OGNI risposta di API-Football viene salvata cosi' com'e' (jsonb) con data di scarico e scadenza.
--   * la schermata di dettaglio mostra esattamente questi dati (cosa arriva dal piano a pagamento);
--   * le richieste si rifanno solo a cache scaduta (TTL per tipo di dato), cosi' si risparmia il limite giornaliero;
--   * se una chiamata fallisce si conserva la risposta precedente e si ritenta dopo qualche minuto (expires_at = ritentare dopo).
-- af_usage: richieste fatte oggi e residuo giornaliero comunicato da API-Football (per non esaurire il piano).
-- Nessuna policy pubblica: i dati del provider si leggono solo dalle Functions (service role), non direttamente dal browser.

create table if not exists public.af_fixture_map (
  game_id      text primary key references public.matches(game_id) on delete cascade,
  fixture_id   bigint not null,
  league_id    integer not null,
  season       integer not null,
  home_team_id integer,
  away_team_id integer,
  home_name    text,
  away_name    text,
  matched_at   timestamptz not null default now()
);

create index if not exists af_fixture_map_fixture_idx on public.af_fixture_map (fixture_id);

create table if not exists public.af_cache (
  cache_key   text primary key,                -- es. "injuries?fixture=123"
  endpoint    text not null,
  params      jsonb not null default '{}'::jsonb,
  response    jsonb,                            -- il campo "response" dell'API
  results     integer not null default 0,
  http_status integer,
  error       text,
  fetched_at  timestamptz not null default now(),
  expires_at  timestamptz not null              -- con error: ritentare dopo questa data
);

create index if not exists af_cache_endpoint_idx on public.af_cache (endpoint, fetched_at desc);

create table if not exists public.af_usage (
  day        date primary key,
  requests   integer not null default 0,        -- richieste fatte da Stay Live oggi
  limit_day  integer,                           -- limite giornaliero del piano
  remaining  integer,                           -- residuo comunicato da API-Football
  updated_at timestamptz not null default now()
);

alter table public.af_fixture_map enable row level security;
alter table public.af_cache enable row level security;
alter table public.af_usage enable row level security;
