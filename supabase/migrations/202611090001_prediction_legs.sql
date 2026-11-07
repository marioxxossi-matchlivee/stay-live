-- Stay Live: registro di TUTTI i mercati di ogni partita (non solo la selezione principale), registrati PRIMA del calcio d'inizio.
-- Serve a misurare, per mercato e per fonte (modello storico, pronostico API-Football, quote senza margine), quale predice meglio
-- e dove c'è valore sulla quota reale: base per scegliere il mercato giusto per la partita giusta.
-- ~14 righe per partita (~120 byte l'una): circa 60 MB a stagione con ~100 partite al giorno.

create table if not exists public.prediction_legs (
  game_id     text not null,
  sel_key     text not null,                 -- home, draw, away, dc1x, dcx2, dc12, over15, under15, over25, under25, over35, under35, btts, nobtts
  league      text not null,
  kickoff_at  timestamptz not null,
  p           real not null,                 -- probabilità finale (fusione delle fonti)
  p_low       real not null,                 -- probabilità prudente
  p_model     real,                          -- fonte storico (Poisson)
  p_api       real,                          -- fonte pronostico API-Football
  p_market    real,                          -- fonte quote senza margine
  odds        real,                          -- quota reale mediana, se il mercato quota la selezione
  n_books     smallint,                      -- bookmaker che quotano la partita
  verdict     text not null check (verdict in ('BET', 'EVITA')),
  basis       text,
  sample      smallint,
  model_ver   text not null,
  computed_at timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  primary key (game_id, sel_key)
);
create index if not exists prediction_legs_kickoff_idx on public.prediction_legs (kickoff_at);
alter table public.prediction_legs enable row level security;   -- nessuna policy: accesso solo con la service_role key (lato server)

create or replace function public.prediction_legs_freeze() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.kickoff_at <= now() then return null; end if;
  if tg_op = 'UPDATE' and old.kickoff_at <= now() then return null; end if;      -- congelata dopo il calcio d'inizio
  if tg_op = 'UPDATE' then new.updated_at := now(); end if;
  return new;
end $$;
drop trigger if exists prediction_legs_freeze on public.prediction_legs;
create trigger prediction_legs_freeze before insert or update on public.prediction_legs
  for each row execute function public.prediction_legs_freeze();

-- Esito di ogni selezione a partita finita (esclusi supplementari e rigori).
create or replace view public.prediction_leg_results with (security_invoker = true) as
select l.game_id, l.league, l.kickoff_at, l.sel_key, l.p, l.p_low, l.p_model, l.p_api, l.p_market, l.odds, l.n_books, l.verdict, l.basis, l.model_ver,
       m.status, m.home_score, m.away_score,
       case when m.status = 'final' and coalesce(m.decided_in, '') not in ('extra_time', 'penalties') then
         case l.sel_key
           when 'home' then m.home_score > m.away_score when 'draw' then m.home_score = m.away_score when 'away' then m.away_score > m.home_score
           when 'dc1x' then m.home_score >= m.away_score when 'dcx2' then m.away_score >= m.home_score when 'dc12' then m.home_score <> m.away_score
           when 'over15' then m.home_score + m.away_score > 1 when 'under15' then m.home_score + m.away_score <= 1
           when 'over25' then m.home_score + m.away_score > 2 when 'under25' then m.home_score + m.away_score <= 2
           when 'over35' then m.home_score + m.away_score > 3 when 'under35' then m.home_score + m.away_score <= 3
           when 'btts' then m.home_score > 0 and m.away_score > 0 when 'nobtts' then not (m.home_score > 0 and m.away_score > 0)
         end
       end as won
from public.prediction_legs l
left join public.matches m on m.game_id = l.game_id;

-- Pagella per mercato: quanto predice bene ciascuna fonte (Brier, più basso = meglio) sulle STESSE partite (quelle con tutte e tre le fonti).
create or replace view public.prediction_leg_scorecard with (security_invoker = true) as
select sel_key, model_ver, count(*) n, round(avg(won::int)::numeric, 3) hit, round(avg(p)::numeric, 3) avg_p,
       count(*) filter (where p_api is not null and p_market is not null) n_cmp,
       round(avg((p_model - won::int) ^ 2) filter (where p_api is not null and p_market is not null)::numeric, 4) brier_model,
       round(avg((p_api - won::int) ^ 2) filter (where p_api is not null and p_market is not null)::numeric, 4) brier_api,
       round(avg((p_market - won::int) ^ 2) filter (where p_api is not null and p_market is not null)::numeric, 4) brier_market,
       round(avg((p - won::int) ^ 2) filter (where p_api is not null and p_market is not null)::numeric, 4) brier_fused,
       count(odds) n_odds,
       round(avg(case when won then odds - 1 else -1 end) filter (where odds is not null)::numeric, 3) roi_flat   -- ROI a puntata fissa su TUTTE le selezioni quotate
from public.prediction_leg_results where won is not null
group by sel_key, model_ver;

revoke all on public.prediction_legs, public.prediction_leg_results, public.prediction_leg_scorecard from anon, authenticated;
comment on table public.prediction_legs is 'Tutti i mercati di ogni partita, registrati prima del calcio d''inizio e congelati dopo.';
