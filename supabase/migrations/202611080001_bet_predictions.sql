-- Stay Live: registro dei pronostici fatti PRIMA del calcio d'inizio, per misurare l'affidabilità reale dei BET su tutte le partite.
-- Una riga per partita (la selezione principale dell'app, BET o EVITA): ~200 byte, circa 2 MB a stagione con tutti i campionati.
-- Dopo il calcio d'inizio la riga è congelata (trigger): la previsione non può essere ritoccata a risultato noto.

create table if not exists public.bet_predictions (
  game_id     text primary key,
  league      text not null,
  kickoff_at  timestamptz not null,
  sel_key     text not null,                 -- selezione principale (over25, btts, dc1x, ...)
  p           real not null,                 -- probabilità centrale dichiarata
  p_low       real not null,                 -- probabilità prudente
  p_model     real,                          -- fonte storico (Poisson)
  p_api       real,                          -- fonte API-Football
  p_market    real,                          -- fonte quote di mercato
  odds        real,                          -- quota reale mediana, se il mercato quota la selezione
  verdict     text not null check (verdict in ('BET', 'EVITA')),
  basis       text,                          -- fonti usate: storico | api | mercato | api+mercato
  sample      integer,
  n           integer,
  model_ver   text not null,                 -- versione dei parametri del modello (cambia se ne modifichi uno)
  computed_at timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists bet_predictions_kickoff_idx on public.bet_predictions (kickoff_at);
create index if not exists bet_predictions_verdict_idx on public.bet_predictions (verdict, kickoff_at);

alter table public.bet_predictions enable row level security;   -- nessuna policy: accesso solo con la service_role key (lato server)

create or replace function public.bet_predictions_freeze() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.kickoff_at <= now() then return null; end if;      -- partita già iniziata: non si registra
  if tg_op = 'UPDATE' and old.kickoff_at <= now() then return null; end if;      -- congelata: nessuna modifica dopo il calcio d'inizio
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  return new;
end $$;

drop trigger if exists bet_predictions_freeze on public.bet_predictions;
create trigger bet_predictions_freeze before insert or update on public.bet_predictions
  for each row execute function public.bet_predictions_freeze();

-- Pronostici con il risultato (se la partita è finita): usata da /api/reliability. Solo lettura, solo lato server.
create or replace view public.bet_prediction_results
with (security_invoker = true) as
select p.game_id, p.league, p.kickoff_at, p.sel_key, p.p, p.p_low, p.odds, p.verdict, p.basis, p.model_ver,
       m.status, m.home_score, m.away_score, m.decided_in
from public.bet_predictions p
left join public.matches m on m.game_id = p.game_id;

revoke all on public.bet_prediction_results from anon, authenticated;
comment on table public.bet_predictions is 'Pronostici registrati prima del calcio d''inizio (una riga per partita), congelati dopo.';
