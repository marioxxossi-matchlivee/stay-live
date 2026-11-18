-- Stay Live Tennis — Strategy Center: registro prospettico delle strategie. SOLO additiva e rieseguibile (if not exists / create or replace / drop trigger if exists).
-- Nessuna tabella del calcio toccata, nessun dato esistente modificato o cancellato, nessun trigger esistente cambiato (tennis_predictions_freeze resta com'è).
-- Accesso solo dal server con la service_role key: RLS attiva e nessuna policy (come le altre tabelle tennis_*).
-- Modello di registrazione: «primo momento utile». Una giocata si registra quando supera tutti i controlli, con le quote lette in quel momento, e da lì
-- è IMMUTABILE (UPDATE e DELETE sono ignorati dal trigger, sempre). Dopo l'inizio dell'incontro non si registra più nulla (INSERT ignorato).
-- L'esito NON è mai scritto qui: si ricava dal risultato di tennis_matches (come per tennis_predictions).

-- ── Esecuzioni del motore (una per giro di aggiornamento): quante partite, quante Value, quale piano ──
create table if not exists public.tennis_strategy_runs (
  id               text primary key,                 -- 'run-' + istante ISO della generazione
  generated_at     timestamptz not null,
  engine_ver       text not null,
  model_ver        text,
  scope            text not null default 'd7',
  analyzed         integer not null default 0,       -- partite pre-match analizzate
  evaluable        integer not null default 0,       -- con dati sufficienti (probabilità, quote fresche, affidabilità)
  value_found      integer not null default 0,
  singles_selected integer not null default 0,
  double_status    text,                             -- none | not_preferred | recommended
  plan_kind        text,                             -- none | single | singles | double
  class_counts     jsonb not null default '{}'::jsonb,
  selected_keys    jsonb not null default '[]'::jsonb,
  calibration      jsonb not null default '{}'::jsonb  -- {sample, validated} del backtest usato
);
create index if not exists tennis_strategy_runs_at_idx on public.tennis_strategy_runs (generated_at desc);

-- ── Singole selezionate (una per partita) ──
create table if not exists public.tennis_strategy_picks (
  match_key     text primary key references public.tennis_matches (match_key) on delete restrict,
  run_id        text,
  created_at    timestamptz not null default now(),
  starts_at     timestamptz not null,
  tour          text not null check (tour in ('atp', 'wta')),
  surface       text,
  category      text,
  tournament    text,
  p1_name       text,
  p2_name       text,
  side          smallint not null check (side in (1, 2)),   -- lato scelto: può essere anche lo sfavorito
  selected_name text,
  is_underdog   boolean not null default false,
  tier          text not null check (tier in ('value_high', 'value_interesting')),
  p_model       real not null check (p_model > 0 and p_model < 1),   -- probabilità del Prediction Engine per il lato scelto
  p_used        real not null check (p_used > 0 and p_used < 1),     -- dopo l'eventuale correzione empirica di calibrazione (solo al ribasso)
  p_market      real check (p_market is null or (p_market > 0 and p_market < 1)),   -- probabilità di mercato senza margine
  implied       real,                                                  -- 1 / quota
  fair_odds     real,                                                  -- 1 / p_model
  edge          real,
  ev            real,                                                  -- EV usato per la decisione (p_used × quota − 1)
  odds          real not null check (odds > 1),
  book          text,
  odds_at       timestamptz not null,                                  -- istante di lettura delle quote
  reliability   text check (reliability in ('alta', 'media', 'bassa')),
  model_ver     text not null,
  engine_ver    text not null,
  stake_units   real not null default 1 check (stake_units = 1),      -- puntata teorica unitaria: ROI a puntata fissa, indipendente dal capitale dell'utente
  calibration   jsonb not null default '{}'::jsonb,
  reasons       jsonb not null default '[]'::jsonb,
  constraint tennis_strategy_picks_before_start check (odds_at < starts_at)
);
create index if not exists tennis_strategy_picks_starts_idx on public.tennis_strategy_picks (starts_at desc);

-- ── Doppie (esattamente due gambe, partite diverse) ──
create table if not exists public.tennis_strategy_doubles (
  pair_key       text primary key,                  -- chiavi delle due partite ordinate e unite da '+'
  run_id         text,
  created_at     timestamptz not null default now(),
  starts_at      timestamptz not null,              -- inizio della prima gamba
  leg1_match_key text not null,
  leg1_side      smallint not null check (leg1_side in (1, 2)),
  leg1_name      text,
  leg1_p         real not null check (leg1_p > 0 and leg1_p < 1),
  leg1_odds      real not null check (leg1_odds > 1),
  leg1_book      text,
  leg1_odds_at   timestamptz not null,
  leg1_starts_at timestamptz not null,
  leg2_match_key text not null,
  leg2_side      smallint not null check (leg2_side in (1, 2)),
  leg2_name      text,
  leg2_p         real not null check (leg2_p > 0 and leg2_p < 1),
  leg2_odds      real not null check (leg2_odds > 1),
  leg2_book      text,
  leg2_odds_at   timestamptz not null,
  leg2_starts_at timestamptz not null,
  total_odds     real not null check (total_odds > 1),
  joint_p        real not null check (joint_p > 0 and joint_p < 1),   -- P1 × P2: valida solo con eventi indipendenti
  ev             real,
  independence_assumed boolean not null default true,
  comparison     jsonb not null default '[]'::jsonb,                    -- confronto con singola e due singole al momento della scelta
  model_ver      text not null,
  engine_ver     text not null,
  stake_units    real not null default 1 check (stake_units = 1),
  constraint tennis_strategy_doubles_distinct check (leg1_match_key <> leg2_match_key),
  constraint tennis_strategy_doubles_leg1_fkey foreign key (leg1_match_key) references public.tennis_matches (match_key) on delete restrict,
  constraint tennis_strategy_doubles_leg2_fkey foreign key (leg2_match_key) references public.tennis_matches (match_key) on delete restrict,
  constraint tennis_strategy_doubles_before_start check (leg1_odds_at < leg1_starts_at and leg2_odds_at < leg2_starts_at)
);
create index if not exists tennis_strategy_doubles_starts_idx on public.tennis_strategy_doubles (starts_at desc);
create index if not exists tennis_strategy_doubles_leg1_idx on public.tennis_strategy_doubles (leg1_match_key);
create index if not exists tennis_strategy_doubles_leg2_idx on public.tennis_strategy_doubles (leg2_match_key);

-- ── Congelamento ──
-- Singole: INSERT ignorato se la partita è già iniziata; UPDATE e DELETE sempre ignorati (registrazione immutabile).
create or replace function public.tennis_strategy_picks_freeze() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.starts_at <= now() then return null; end if;
    return new;
  end if;
  return null; -- UPDATE / DELETE: nessuna modifica retroattiva, mai
end $$;

-- Doppie: INSERT ignorato se una delle due gambe è già iniziata; UPDATE e DELETE sempre ignorati.
create or replace function public.tennis_strategy_doubles_freeze() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.leg1_starts_at <= now() or new.leg2_starts_at <= now() then return null; end if;
    return new;
  end if;
  return null;
end $$;

-- Esecuzioni: solo inserimento.
create or replace function public.tennis_strategy_runs_freeze() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then return new; end if;
  return null;
end $$;

drop trigger if exists tennis_strategy_picks_freeze on public.tennis_strategy_picks;
create trigger tennis_strategy_picks_freeze before insert or update or delete on public.tennis_strategy_picks
  for each row execute function public.tennis_strategy_picks_freeze();
drop trigger if exists tennis_strategy_doubles_freeze on public.tennis_strategy_doubles;
create trigger tennis_strategy_doubles_freeze before insert or update or delete on public.tennis_strategy_doubles
  for each row execute function public.tennis_strategy_doubles_freeze();
drop trigger if exists tennis_strategy_runs_freeze on public.tennis_strategy_runs;
create trigger tennis_strategy_runs_freeze before insert or update or delete on public.tennis_strategy_runs
  for each row execute function public.tennis_strategy_runs_freeze();

alter table public.tennis_strategy_runs    enable row level security;
alter table public.tennis_strategy_picks   enable row level security;
alter table public.tennis_strategy_doubles enable row level security;

revoke all on function public.tennis_strategy_picks_freeze()   from public, anon, authenticated;
revoke all on function public.tennis_strategy_doubles_freeze() from public, anon, authenticated;
revoke all on function public.tennis_strategy_runs_freeze()    from public, anon, authenticated;
