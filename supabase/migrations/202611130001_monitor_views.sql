-- Stay Live: viste di SOLA LETTURA per il monitoraggio dell'affidabilità (sezione "Affidabilità" dell'app).
-- Aggregano nel database i pronostici registrati PRIMA della partita (prediction_legs / bet_predictions) contro il risultato finale,
-- così l'app riceve poche righe invece di migliaia. Additiva: nessuna tabella viene modificata, nessun dato cancellato.
-- Conteggio solo di partite finali con esito noto (esclusi supplementari e rigori, come prediction_leg_results).

-- Tutte le selezioni (14 esiti per partita): per versione del modello, verdetto, esito e fascia di probabilità (10 fasce).
create or replace view public.monitor_legs_agg with (security_invoker = true) as
select model_ver, verdict, sel_key,
       least(width_bucket(p::numeric, 0, 1, 10), 10) as bin,
       count(*)::int                         as n,
       sum(won::int)::int                    as won,
       sum(p)::float8                        as sum_p,
       sum(p_low)::float8                    as sum_plow,
       sum((p - won::int) ^ 2)::float8       as sum_brier,
       sum(case when won then -ln(greatest(p, 1e-6)) else -ln(greatest(1 - p, 1e-6)) end)::float8 as sum_logloss,
       count(odds)::int                      as n_odds,
       coalesce(sum(case when odds is not null then (case when won then odds - 1 else -1 end) end), 0)::float8 as sum_pnl,
       min(kickoff_at)                       as first_kickoff,
       max(kickoff_at)                       as last_kickoff
from public.prediction_leg_results
where won is not null
group by 1, 2, 3, 4;

-- Scelta principale di ogni partita (la selezione che l'app ha mostrato come BET o EVITA), con il suo esito.
create or replace view public.monitor_picks_agg with (security_invoker = true) as
select b.model_ver, b.verdict, b.sel_key,
       least(width_bucket(l.p::numeric, 0, 1, 10), 10) as bin,
       count(*)::int                         as n,
       sum(l.won::int)::int                  as won,
       sum(l.p)::float8                      as sum_p,
       sum(l.p_low)::float8                  as sum_plow,
       sum((l.p - l.won::int) ^ 2)::float8   as sum_brier,
       sum(case when l.won then -ln(greatest(l.p, 1e-6)) else -ln(greatest(1 - l.p, 1e-6)) end)::float8 as sum_logloss,
       count(b.odds)::int                    as n_odds,
       coalesce(sum(case when b.odds is not null then (case when l.won then b.odds - 1 else -1 end) end), 0)::float8 as sum_pnl,
       min(b.kickoff_at)                     as first_kickoff,
       max(b.kickoff_at)                     as last_kickoff
from public.bet_predictions b
join public.prediction_leg_results l on l.game_id = b.game_id and l.sel_key = b.sel_key
where l.won is not null
group by 1, 2, 3, 4;

-- Stato delle partite registrate: quante concluse, in attesa, rinviate/annullate/sostituite.
create or replace view public.monitor_status with (security_invoker = true) as
select b.model_ver, b.verdict,
       case when m.status = 'final' and coalesce(m.decided_in, '') not in ('extra_time', 'penalties') then 'concluse'
            when m.status = 'final' then 'non_valutabili'
            when m.status in ('scheduled', 'in_progress') then 'in_attesa'
            when m.status is null then 'senza_risultato'
            else 'rinviate_o_annullate' end as stato,
       count(*)::int as n
from public.bet_predictions b
left join public.matches m on m.game_id = b.game_id
group by 1, 2, 3;

revoke all on public.monitor_legs_agg, public.monitor_picks_agg, public.monitor_status from anon, authenticated;
