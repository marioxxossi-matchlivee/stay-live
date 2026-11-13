-- Stay Live Tennis: sincronizzazione completa con SportsAPI365. SOLO additiva e rieseguibile; nessuna tabella del calcio toccata, nessun dato cancellato.
-- Unica operazione su vincoli esistenti: la regola sugli stati di tennis_matches viene sostituita da una più ampia (accetta tutto ciò che accettava prima).
-- Distinzione chiave: tour = ATP/WTA (circuito maschile/femminile, come lo dà il provider); category = tour / challenger / itf / challenger_itf (livello competitivo).

-- ── Stati più ampi: ritiri, walkover, sospese, rinviate non sono "finite" ──
alter table public.tennis_matches drop constraint if exists tennis_matches_status_check;
alter table public.tennis_matches add constraint tennis_matches_status_check
  check (status in ('scheduled', 'live', 'finished', 'cancelled', 'unknown', 'ended_other', 'postponed', 'interrupted'));

-- ── Provenienza di ogni partita ──
alter table public.tennis_matches add column if not exists source        text not null default 'sportsapi365';
alter table public.tennis_matches add column if not exists src_endpoint  text;                 -- upcoming | results
alter table public.tennis_matches add column if not exists first_seen_at timestamptz not null default now();
alter table public.tennis_matches add column if not exists fetched_at    timestamptz;
alter table public.tennis_matches add column if not exists court_id      smallint;             -- courtId del provider (1 Hard, 2 Clay, 3 I.hard, 5 Grass)
alter table public.tennis_matches add column if not exists closing_odds  jsonb;                -- odd1/odd2 della riga dei risultati (storico, MAI usate per l'EV)

-- ── Giocatori: profilo e ranking correnti ──
alter table public.tennis_players add column if not exists rank           integer;
alter table public.tennis_players add column if not exists points         integer;
alter table public.tennis_players add column if not exists ranking_date   timestamptz;
alter table public.tennis_players add column if not exists profile        jsonb;
alter table public.tennis_players add column if not exists profile_at     timestamptz;
alter table public.tennis_players add column if not exists source         text not null default 'sportsapi365';

-- ── Ranking (ultima classifica letta) ──
create table if not exists public.tennis_rankings (
  tour         text not null check (tour in ('atp', 'wta')),
  player_id    text not null,
  position     integer not null check (position >= 1),
  points       integer,
  name         text,
  country      text,
  ranking_date timestamptz,
  fetched_at   timestamptz not null default now(),
  primary key (tour, player_id)
);
create index if not exists tennis_rankings_pos_idx on public.tennis_rankings (tour, position);

-- ── Tornei ──
create table if not exists public.tennis_tournaments (
  id          text primary key,
  tour        text check (tour in ('atp', 'wta')),
  name        text,
  level_id    smallint,
  category    text,
  surface     text,
  country     text,
  starts_at   timestamptz,
  last_seen   timestamptz not null default now()
);

-- ── Feed live (non è un risultato: solo lo stato dell'incontro in corso) ──
create table if not exists public.tennis_live (
  match_key     text primary key,
  live_event_id text,
  tour          text,
  tournament_id text,
  round_id      smallint,
  tournament    text,
  status        text,
  sets          jsonb,
  score_raw     text,
  points        text,
  starts_at     timestamptz,
  provider_updated_at timestamptz,
  seen_at       timestamptz not null default now()
);
create index if not exists tennis_live_seen_idx on public.tennis_live (seen_at);

-- ── Consumo del provider: quota letta dalle intestazioni ──
alter table public.tennis_api_usage add column if not exists quota_remaining bigint;
alter table public.tennis_api_usage add column if not exists quota_limit     bigint;
alter table public.tennis_api_usage add column if not exists last_at         timestamptz;

-- ── Pronostici: verdetto BET/EVITA e quote usate ──
alter table public.tennis_predictions add column if not exists bet       jsonb;       -- {verdict, reasons[], ev, odds, book, oddsAt, implied}
alter table public.tennis_predictions add column if not exists odds_book text;
alter table public.tennis_predictions add column if not exists odds_at   timestamptz;

alter table public.tennis_rankings   enable row level security;
alter table public.tennis_tournaments enable row level security;
alter table public.tennis_live       enable row level security;
