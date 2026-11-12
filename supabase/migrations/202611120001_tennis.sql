-- Stay Live Tennis: ambiente dati indipendente dal calcio. SOLO migrazione additiva: tutte le tabelle hanno il prefisso tennis_,
-- nessuna tabella, vista o funzione del calcio viene toccata, nessun dato viene cancellato. Rieseguibile senza effetti (if not exists).
-- Accesso solo lato server con la service_role key (RLS attiva, nessuna policy): come le altre tabelle.

-- ── Giocatori ─────────────────────────────────────────────
create table if not exists public.tennis_players (
  id          text primary key,               -- id del provider (come stringa)
  tour        text not null check (tour in ('atp', 'wta')),
  name        text not null,
  country     text,
  updated_at  timestamptz not null default now()
);

-- ── Partite (programma + risultati: unica fonte dello storico del modello) ──
create table if not exists public.tennis_matches (
  match_key    text primary key,              -- chiave STABILE: giocatore1|giocatore2|torneo|turno (l'id del provider può cambiare a partita finita)
  provider_id  text,                          -- ultimo id visto dal provider (solo informativo)
  tour         text not null check (tour in ('atp', 'wta')),
  tournament   text,
  round        text,
  surface      text,                          -- grezza dal provider; il modello la normalizza (hard / clay / grass)
  best_of      smallint not null default 3 check (best_of in (3, 5)),
  starts_at    timestamptz not null,
  status       text not null default 'scheduled' check (status in ('scheduled', 'live', 'finished', 'cancelled', 'unknown')),
  p1_id        text not null,
  p2_id        text not null,
  p1_name      text,
  p2_name      text,
  p1_rank      integer,
  p2_rank      integer,
  winner       smallint check (winner in (1, 2)),   -- 1 o 2, solo a partita conclusa
  score        text,
  odds_p1      real,                          -- quota pre-partita, solo se il piano API la fornisce
  odds_p2      real,
  odds_source  text,
  odds_at      timestamptz,
  updated_at   timestamptz not null default now()
);
create index if not exists tennis_matches_starts_idx  on public.tennis_matches (starts_at);
create index if not exists tennis_matches_status_idx  on public.tennis_matches (status, starts_at);
create index if not exists tennis_matches_p1_idx      on public.tennis_matches (p1_id, starts_at);
create index if not exists tennis_matches_p2_idx      on public.tennis_matches (p2_id, starts_at);

-- ── Statistiche aggregate dei giocatori (servizio, risposta, break point…) ──
create table if not exists public.tennis_player_stats (
  player_id   text not null,
  tour        text not null check (tour in ('atp', 'wta')),
  surface     text not null default 'all',    -- 'all' oppure hard / clay / grass
  matches     integer,                        -- partite su cui si basano le quote
  serve_pts_won  real,                        -- quota 0-1 dei punti vinti al servizio
  return_pts_won real,                        -- quota 0-1 dei punti vinti in risposta
  stats       jsonb not null default '{}'::jsonb,   -- il dettaglio completo come arriva dal provider
  fetched_at  timestamptz not null default now(),
  primary key (player_id, tour, surface)
);

-- ── Scontri diretti ──────────────────────────────────────
create table if not exists public.tennis_h2h (
  pair_key    text primary key,               -- id minore|id maggiore
  low_id      text not null,
  high_id     text not null,
  low_wins    integer not null default 0,
  high_wins   integer not null default 0,
  payload     jsonb not null default '{}'::jsonb,
  fetched_at  timestamptz not null default now()
);

-- ── Pronostici: registrati PRIMA dell'inizio, congelati dopo ──
create table if not exists public.tennis_predictions (
  match_key    text primary key references public.tennis_matches (match_key) on delete restrict,
  starts_at    timestamptz not null,
  tour         text not null,
  surface      text,
  published    boolean not null,              -- false = il modello si è astenuto (si registra comunque il motivo)
  pick         smallint check (pick in (1, 2)),
  p1           real check (p1 is null or (p1 > 0 and p1 < 1)),
  p2           real check (p2 is null or (p2 > 0 and p2 < 1)),
  reliability  text check (reliability in ('alta', 'media', 'bassa')),
  reasons      jsonb not null default '[]'::jsonb,
  missing      jsonb not null default '[]'::jsonb,
  components   jsonb not null default '{}'::jsonb,
  abstain_reason text,
  odds_p1      real,
  odds_p2      real,
  model_ver    text not null,
  computed_at  timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint tennis_predictions_coherent check (
    (published and pick is not null and p1 is not null and p2 is not null and abs(p1 + p2 - 1) < 0.001)
    or (not published and pick is null)
  )
);
create index if not exists tennis_predictions_starts_idx on public.tennis_predictions (starts_at);

-- Congelamento: dopo l'inizio la riga non si modifica e non si cancella; a partita iniziata non si registra nulla di nuovo.
create or replace function public.tennis_predictions_freeze() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.starts_at <= now() then return null; end if;
  if tg_op = 'UPDATE' and old.starts_at <= now() then return null; end if;
  if tg_op = 'DELETE' and old.starts_at <= now() then return null; end if;
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists tennis_predictions_freeze on public.tennis_predictions;
create trigger tennis_predictions_freeze before insert or update or delete on public.tennis_predictions
  for each row execute function public.tennis_predictions_freeze();

-- Esiti: pronostico congelato + risultato (l'esito non è mai scritto nel pronostico).
create or replace view public.tennis_prediction_results with (security_invoker = true) as
  select p.match_key, p.starts_at, p.tour, p.surface, p.published, p.pick, p.p1, p.p2, p.reliability, p.model_ver,
         m.winner, case when p.published and m.winner is not null then (p.pick = m.winner) end as hit
  from public.tennis_predictions p
  join public.tennis_matches m using (match_key)
  where m.status = 'finished' and m.winner is not null;

-- ── Cache delle risposte del provider (evita richieste ripetute) ──
create table if not exists public.tennis_cache (
  cache_key   text primary key,               -- endpoint + parametri normalizzati
  payload     jsonb not null,
  fetched_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);
create index if not exists tennis_cache_expires_idx on public.tennis_cache (expires_at);

-- ── Consumo delle richieste al provider (per rispettare il limite mensile del piano) ──
create table if not exists public.tennis_api_usage (
  day         date not null,
  endpoint    text not null,
  requests    integer not null default 0,
  errors      integer not null default 0,
  primary key (day, endpoint)
);

-- ── Stato degli aggiornamenti + blocco anti-sovrapposizione ──
create table if not exists public.tennis_sync_state (
  id            text primary key,             -- 'refresh', 'history', ...
  locked_until  timestamptz,                  -- blocco a scadenza: se un giro muore, si libera da solo
  last_started  timestamptz,
  last_finished timestamptz,
  last_ok       timestamptz,
  last_error    text,                         -- mai segreti: solo il messaggio
  meta          jsonb not null default '{}'::jsonb
);

-- Prende il blocco in modo atomico: true se ottenuto, false se un altro giro è ancora in corso.
create or replace function public.tennis_acquire_lock(p_id text, p_seconds integer) returns boolean
language plpgsql set search_path = public as $$
declare got boolean;
begin
  insert into public.tennis_sync_state (id, locked_until, last_started)
  values (p_id, now() + make_interval(secs => p_seconds), now())
  on conflict (id) do update
    set locked_until = now() + make_interval(secs => p_seconds), last_started = now()
    where public.tennis_sync_state.locked_until is null or public.tennis_sync_state.locked_until <= now()
  returning true into got;
  return coalesce(got, false);
end $$;

-- ── Istantanea per l'app (stesso schema di app_snapshot: l'app legge, non calcola) ──
create table if not exists public.tennis_snapshot (
  id        text primary key,                 -- 'board'
  payload   jsonb not null,
  meta      jsonb not null default '{}'::jsonb,
  built_at  timestamptz not null default now()
);

alter table public.tennis_players       enable row level security;
alter table public.tennis_matches       enable row level security;
alter table public.tennis_player_stats  enable row level security;
alter table public.tennis_h2h           enable row level security;
alter table public.tennis_predictions   enable row level security;
alter table public.tennis_cache         enable row level security;
alter table public.tennis_api_usage     enable row level security;
alter table public.tennis_sync_state    enable row level security;
alter table public.tennis_snapshot      enable row level security;

revoke all on function public.tennis_acquire_lock(text, integer) from public, anon, authenticated;
revoke all on function public.tennis_predictions_freeze() from public, anon, authenticated;
