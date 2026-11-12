-- Stay Live Tennis: campi del provider SportsAPI365. SOLO additiva e rieseguibile (add column if not exists): nessuna tabella
-- del calcio toccata, nessun dato cancellato. Il circuito resta atp/wta (maschile/femminile, come li dà il provider);
-- livello e categoria (tour / challenger / itf / challenger_itf) sono colonne separate.
alter table public.tennis_matches add column if not exists tournament_id  text;
alter table public.tennis_matches add column if not exists round_id       smallint;
alter table public.tennis_matches add column if not exists level_id       smallint;   -- rankId del provider
alter table public.tennis_matches add column if not exists category       text;       -- tour | challenger | itf | challenger_itf | unknown
alter table public.tennis_matches add column if not exists live_match_id  text;
alter table public.tennis_matches add column if not exists result_type    text;       -- come arriva dal provider ("completed", ...)
alter table public.tennis_matches add column if not exists p1_country     text;
alter table public.tennis_matches add column if not exists p2_country     text;
alter table public.tennis_matches add column if not exists p1_seed        text;
alter table public.tennis_matches add column if not exists p2_seed        text;
alter table public.tennis_matches add column if not exists odds_sources   jsonb not null default '[]'::jsonb;  -- [{book, p1, p2}] solo quote reali
alter table public.tennis_matches add column if not exists odds_fetched_at timestamptz;
alter table public.tennis_matches add column if not exists h2h            jsonb;

-- Il formato (3/5 set) lo dà solo la riga dei risultati: se ignoto resta NULL (non si assume 3).
alter table public.tennis_matches alter column best_of drop not null;
alter table public.tennis_matches alter column best_of drop default;

create index if not exists tennis_matches_category_idx on public.tennis_matches (category, starts_at);
create index if not exists tennis_matches_tournament_idx on public.tennis_matches (tournament_id, starts_at);
