-- Stay Live: vista di sola lettura con le partite finali nel formato atteso da `npm run backtest` (scripts/backtest.js).
-- Esclude le partite decise ai supplementari o ai rigori (punteggio con gol oltre il 90'), come fa il modello.
-- security_invoker: rispetta l'RLS di public.matches (nessuna policy = nessun accesso da anon/authenticated); si legge dal SQL Editor o con la chiave di servizio.
-- GIÀ APPLICATA al progetto Supabase (migrazione "backtest_finals_view"): questo file serve solo a tenerla nel repository.
create or replace view public.backtest_finals
with (security_invoker = true) as
select league, kickoff_at, home_id, away_id, home_name, away_name, home_score, away_score, neutral_site
from public.matches
where status = 'final'
  and home_score is not null and away_score is not null
  and coalesce(decided_in, 'regulation') not in ('extra_time', 'penalties')
order by kickoff_at, game_id;

revoke all on public.backtest_finals from anon, authenticated;
comment on view public.backtest_finals is 'Partite finali per il backtest (npm run backtest -- --file finals.csv). Solo lettura.';
