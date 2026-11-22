-- Multigol + Affidabilità del modello attuale (1X2, doppia chance, Multigol). GIÀ ESEGUITA su Supabase: non rieseguire. Tenuta qui come documentazione.
-- 1) Fasce Multigol: stessa regola del codice (functions/api/model.js, multigolOf). Gol totali ~ Poisson(lh+la) con gol indipendenti.
--    Fascia attesa = quella con la probabilità più alta PER GOL COPERTO (p / ampiezza); a parità, la più stretta.
create or replace function public.mg_lambda_from_over25(p double precision) returns double precision language plpgsql immutable as $$
declare lo double precision := 0.01; hi double precision := 12; mid double precision; f double precision; i int;
begin
  for i in 1..60 loop
    mid := (lo + hi) / 2; f := 1 - exp(-mid) * (1 + mid + mid * mid / 2);
    if f < p then lo := mid; else hi := mid; end if;
  end loop;
  return (lo + hi) / 2;
end $$;

create or replace function public.mg_bands(lam double precision) returns table(lo int, hi int, p double precision, is_pick boolean) language plpgsql immutable as $$
declare pmf double precision[] := array_fill(0::double precision, array[41]); k int; r record; w int; dens double precision;
        best_dens double precision := -1; best_w int := 99; bl int; bh int; acc double precision;
begin
  pmf[1] := exp(-lam);
  for k in 1..40 loop pmf[k + 1] := pmf[k] * lam / k; end loop;
  for r in select * from (values (1,3),(1,4),(2,4),(2,5),(3,6)) b(l, h) loop
    acc := 0; for k in r.l..r.h loop acc := acc + pmf[k + 1]; end loop;
    w := r.h - r.l + 1; dens := acc / w;
    if dens > best_dens + 1e-12 or (abs(dens - best_dens) <= 1e-12 and w < best_w) then best_dens := dens; best_w := w; bl := r.l; bh := r.h; end if;
  end loop;
  for r in select * from (values (1,3),(1,4),(2,4),(2,5),(3,6)) b(l, h) loop
    acc := 0; for k in r.l..r.h loop acc := acc + pmf[k + 1]; end loop;
    lo := r.l; hi := r.h; p := acc; is_pick := (r.l = bl and r.h = bh); return next;
  end loop;
end $$;

-- 2) Esito di ogni selezione a partita finita: aggiunte le fasce Multigol (stesse colonne di prima).
create or replace view public.prediction_leg_results with (security_invoker = true) as
 SELECT l.game_id, l.league, l.kickoff_at, l.sel_key, l.p, l.p_low, l.p_model, l.p_api, l.p_market, l.odds, l.n_books, l.verdict, l.basis, l.model_ver,
    m.status, m.home_score, m.away_score,
        CASE
            WHEN m.status = 'final'::text AND (COALESCE(m.decided_in, ''::text) <> ALL (ARRAY['extra_time'::text, 'penalties'::text])) THEN
            CASE l.sel_key
                WHEN 'home'::text THEN m.home_score > m.away_score
                WHEN 'draw'::text THEN m.home_score = m.away_score
                WHEN 'away'::text THEN m.away_score > m.home_score
                WHEN 'dc1x'::text THEN m.home_score >= m.away_score
                WHEN 'dcx2'::text THEN m.away_score >= m.home_score
                WHEN 'dc12'::text THEN m.home_score <> m.away_score
                WHEN 'over15'::text THEN (m.home_score + m.away_score) > 1
                WHEN 'under15'::text THEN (m.home_score + m.away_score) <= 1
                WHEN 'over25'::text THEN (m.home_score + m.away_score) > 2
                WHEN 'under25'::text THEN (m.home_score + m.away_score) <= 2
                WHEN 'over35'::text THEN (m.home_score + m.away_score) > 3
                WHEN 'under35'::text THEN (m.home_score + m.away_score) <= 3
                WHEN 'btts'::text THEN m.home_score > 0 AND m.away_score > 0
                WHEN 'nobtts'::text THEN NOT (m.home_score > 0 AND m.away_score > 0)
                WHEN 'mg13'::text THEN (m.home_score + m.away_score) BETWEEN 1 AND 3
                WHEN 'mg14'::text THEN (m.home_score + m.away_score) BETWEEN 1 AND 4
                WHEN 'mg24'::text THEN (m.home_score + m.away_score) BETWEEN 2 AND 4
                WHEN 'mg25'::text THEN (m.home_score + m.away_score) BETWEEN 2 AND 5
                WHEN 'mg36'::text THEN (m.home_score + m.away_score) BETWEEN 3 AND 6
                ELSE NULL::boolean
            END
            ELSE NULL::boolean
        END AS won
   FROM prediction_legs l
     LEFT JOIN matches m ON m.game_id = l.game_id;

-- 3) Ricostruzione dei Multigol per le partite già registrate (righe marcate «ricostruita»): i gol totali dipendono solo da lh+la, ricavato
--    esattamente dalla probabilità pura del modello di Over 2,5 salvata PRIMA della partita, con lo stesso istante di registrazione.
alter table public.prediction_legs disable trigger prediction_legs_freeze;
insert into public.prediction_legs (game_id, sel_key, league, kickoff_at, p, p_low, p_model, p_api, p_market, odds, n_books, verdict, basis, sample, model_ver, computed_at)
select l.game_id, 'mg' || b.lo || b.hi, l.league, l.kickoff_at, b.p::real, b.p::real, b.p::real, null, null, null, null, 'EVITA',
       case when b.is_pick then 'ricostruita-atteso' else 'ricostruita' end, l.sample, l.model_ver, l.computed_at
from public.prediction_legs l
cross join lateral public.mg_bands(public.mg_lambda_from_over25(l.p_model::double precision)) b
where l.sel_key = 'over25' and l.p_model is not null and l.computed_at < l.kickoff_at
on conflict (game_id, sel_key) do nothing;
alter table public.prediction_legs enable trigger prediction_legs_freeze;

-- 4) Viste di sola lettura per l'Affidabilità: ultime 48 ore, andamento giornaliero, fascia Multigol attesa.
create or replace view public.monitor_window_agg with (security_invoker = true) as
select sel_key, (coalesce(basis, '') like '%atteso') as is_pick,
       count(*)::int as n, count(distinct game_id)::int as partite, sum(won::int)::int as won, sum(p)::float8 as sum_p,
       sum((p - won::int) ^ 2)::float8 as sum_brier,
       sum(case when won then -ln(greatest(p, 1e-6)) else -ln(greatest(1 - p, 1e-6)) end)::float8 as sum_logloss
from public.prediction_leg_results
where won is not null and kickoff_at >= now() - interval '48 hours'
  and sel_key in ('home','draw','away','dc1x','dcx2','dc12','mg13','mg14','mg24','mg25','mg36')
group by 1, 2;

create or replace view public.monitor_daily_agg with (security_invoker = true) as
select (kickoff_at at time zone 'Europe/Rome')::date as day, sel_key,
       count(*)::int as n, count(distinct game_id)::int as partite, sum(won::int)::int as won, sum(p)::float8 as sum_p,
       sum((p - won::int) ^ 2)::float8 as sum_brier,
       sum(case when won then -ln(greatest(p, 1e-6)) else -ln(greatest(1 - p, 1e-6)) end)::float8 as sum_logloss
from public.prediction_leg_results
where won is not null and kickoff_at >= now() - interval '21 days'
  and sel_key in ('home','draw','away','dc1x','dcx2','dc12','mg13','mg14','mg24','mg25','mg36')
group by 1, 2;

create or replace view public.monitor_mg_pick_agg with (security_invoker = true) as
select sel_key, (basis like 'ricostruita%') as ricostruita,
       count(*)::int as n, sum(won::int)::int as won, sum(p)::float8 as sum_p,
       sum((p - won::int) ^ 2)::float8 as sum_brier,
       sum(case when won then -ln(greatest(p, 1e-6)) else -ln(greatest(1 - p, 1e-6)) end)::float8 as sum_logloss,
       min(kickoff_at) as first_kickoff, max(kickoff_at) as last_kickoff
from public.prediction_leg_results
where won is not null and sel_key like 'mg%' and basis like '%atteso'
group by 1, 2;

revoke all on public.monitor_window_agg, public.monitor_daily_agg, public.monitor_mg_pick_agg from anon, authenticated;
