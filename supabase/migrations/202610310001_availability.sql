-- Stay Live v4: disponibilità giocatori (infortuni, squalifiche, probabili formazioni) da scraping. Additiva.
--
-- match_availability: UNA riga per partita, quella che legge l'app.
--   * `sources` è la verità per fonte: ogni fonte (transfermarkt, premierinjuries, lineups) scrive la propria
--     sezione {ok, at, count, matched, injuries, suspensions, lineups}. Così aggiornare una fonte non cancella le altre.
--   * `injuries`, `suspensions`, `probable_lineups`, `last_scraped_at` sono la vista UNITA di tutte le fonti
--     (giocatori duplicati fusi), ricalcolata ad ogni scrape. È ciò che mostra l'interfaccia e che usa il modello.
-- scrape_state: una riga per (fonte, campionato). Serve a non rifare richieste inutili (TTL 30/60 minuti nelle
--   48 ore prima del match) e a fermarsi con backoff esponenziale se la fonte blocca o cambia layout.
--
-- Forma dei JSON (tutti con chiavi "home" e "away"):
--   injuries / suspensions: {"home":[{"name","role":"G|D|M|F|null","detail","since","until","value","playChance","status":"out|doubt","src":["transfermarkt"]}], "away":[...]}
--   probable_lineups:       {"home":{"formation":"3-5-2","xi":["..."],"complete":true,"doubts":["A-B 55-45%"],"warned":["..."],"src":"lineups"}|null, "away":...}

create table if not exists public.match_availability (
  game_id          text primary key references public.matches(game_id) on delete cascade,
  injuries         jsonb not null default '{"home":[],"away":[]}'::jsonb,
  suspensions      jsonb not null default '{"home":[],"away":[]}'::jsonb,
  probable_lineups jsonb not null default '{"home":null,"away":null}'::jsonb,
  sources          jsonb not null default '{}'::jsonb,
  last_scraped_at  timestamptz,
  updated_at       timestamptz not null default now()
);

create index if not exists match_availability_scraped_idx on public.match_availability (last_scraped_at);

create table if not exists public.scrape_state (
  source        text not null,
  league        text not null,
  scraped_at    timestamptz,            -- ultimo scrape riuscito
  attempted_at  timestamptz,            -- ultimo tentativo (riuscito o no)
  last_error    text,
  last_status   integer,                -- ultimo codice HTTP
  fail_count    integer not null default 0,
  blocked_until timestamptz,            -- backoff dopo errori/blocchi; nessuna richiesta prima di questa data
  items_count   integer not null default 0,
  primary key (source, league)
);

alter table public.match_availability enable row level security;
alter table public.scrape_state enable row level security;

drop policy if exists "Public read match_availability" on public.match_availability;
create policy "Public read match_availability" on public.match_availability for select to anon, authenticated using (true);
-- scrape_state: nessuna policy pubblica. Accessibile solo con la service_role key (lato server).
