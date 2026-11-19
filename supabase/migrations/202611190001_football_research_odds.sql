-- Ricerca statistica calcio: storico delle quote RILEVATE PRIMA DELLA PARTITA, una riga per partita + mercato + bookmaker + istante.
-- A sola aggiunta: nessuna riga viene mai modificata o cancellata (a differenza di odds_quotes, che si sovrascrive).
-- Additiva: non tocca nessuna tabella esistente.
create table if not exists public.football_research_odds (
  id                  bigint generated always as identity primary key,
  game_id             text not null,
  fixture_id          bigint not null,
  bet_id              integer not null,          -- id del mercato in API-Football (38 = Exact Goals Number, 349/186/223 = fasce di gol, ...)
  bet_name            text not null,
  bookmaker           text not null,
  captured_at         timestamptz not null,      -- quando Stay Live ha letto la quota
  provider_updated_at timestamptz,               -- ultimo aggiornamento comunicato dal provider (se presente)
  kickoff_at          timestamptz,
  odds                jsonb not null,            -- [{"value":"2 or 3 goals","odd":"2.10"}, ...]
  constraint football_research_odds_prematch check (kickoff_at is null or captured_at < kickoff_at),
  constraint football_research_odds_unique unique (game_id, bet_id, bookmaker, captured_at)
);
create index if not exists football_research_odds_game_idx on public.football_research_odds (game_id, captured_at desc);
create index if not exists football_research_odds_captured_idx on public.football_research_odds (captured_at desc);
alter table public.football_research_odds enable row level security;

create or replace function public.football_research_odds_append_only() returns trigger language plpgsql as $$
begin
  raise exception 'football_research_odds è a sola aggiunta: nessuna modifica o cancellazione di righe già registrate';
end $$;
drop trigger if exists football_research_odds_no_update on public.football_research_odds;
create trigger football_research_odds_no_update before update or delete on public.football_research_odds
  for each row execute function public.football_research_odds_append_only();
