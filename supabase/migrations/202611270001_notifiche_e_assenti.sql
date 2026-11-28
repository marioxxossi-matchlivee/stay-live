-- Notifiche sul cambio di pronostico + registro degli assenti pesati. DA ESEGUIRE UNA VOLTA su Supabase (SQL Editor).
-- Solo additiva: crea 5 tabelle e 2 funzioni; non modifica né cancella nulla di esistente.
-- Accesso solo dal server con la service_role key: RLS attiva e NESSUNA policy (come le altre tabelle); nessun accesso per anon/authenticated.

-- 1) Dispositivi che ricevono le notifiche (sottoscrizione Web Push del browser/telefono).
create table if not exists public.push_devices (
  id uuid primary key default gen_random_uuid(),
  endpoint text not null unique check (length(endpoint) <= 1000),
  p256dh text not null,
  auth text not null,
  user_agent text,
  night_enabled boolean not null default false,   -- notifiche notturne (23:00–07:00 ora italiana): SPENTE di default
  failures int not null default 0,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  last_ok_at timestamptz
);

-- 2) Giocate salvate da seguire. `selection` = esito salvato (calcio: home|draw|away|dc1x|dcx2|dc12; tennis: 1|2).
--    `baseline_*` = pronostico del server visto l'ultima volta (alla prima lettura, poi a ogni notifica): si avvisa solo se cambia.
create table if not exists public.saved_picks (
  id uuid primary key default gen_random_uuid(),
  device_id uuid not null references public.push_devices(id) on delete cascade,
  sport text not null check (sport in ('football', 'tennis')),
  ref text not null check (length(ref) between 1 and 120),
  selection text not null,
  label text,
  home text,
  away text,
  kickoff_at timestamptz,
  baseline_set boolean not null default false,
  baseline_selection text,
  active boolean not null default true,
  saved_at timestamptz not null default now(),
  last_notified_at timestamptz,
  unique (device_id, sport, ref)
);
create index if not exists saved_picks_active_idx on public.saved_picks (active, kickoff_at) where active;

-- 3) Registro delle notifiche inviate (cosa è cambiato e com'è andata la consegna).
create table if not exists public.pick_change_log (
  id bigserial primary key,
  saved_pick_id uuid references public.saved_picks(id) on delete set null,
  sport text not null,
  ref text not null,
  from_selection text,
  to_selection text,
  message text,
  delivery text not null check (delivery in ('sent', 'failed', 'gone')),
  created_at timestamptz not null default now()
);

-- 4) Importanza dei giocatori (da statistiche di stagione di API-Football): quota di minuti giocati e contributo in gol/assist.
create table if not exists public.player_importance (
  af_team_id int not null,
  af_player_id int not null,
  season int not null,
  name text not null,
  position text,
  appearances int,
  minutes int,
  goals int,
  assists int,
  minutes_share numeric check (minutes_share between 0 and 1),
  importance numeric check (importance between 0 and 1),
  fetched_at timestamptz not null default now(),
  primary key (af_team_id, af_player_id, season)
);

-- 5) Assenti registrati per ogni partita al momento del calcolo, con importanza: serve a misurare quanto pesano oltre al mercato.
create table if not exists public.match_absence_log (
  id bigserial primary key,
  game_id text not null,
  side text not null check (side in ('home', 'away')),
  af_team_id int,
  af_player_id int,
  player_name text,
  kind text check (kind in ('injury', 'suspension')),
  reason text,
  importance numeric,
  odds_fetched_at timestamptz,
  recorded_at timestamptz not null default now()
);
create index if not exists match_absence_log_game_idx on public.match_absence_log (game_id, recorded_at desc);

-- Sincronizza le giocate di un dispositivo (chiamata da /api/push con la service_role key). Sostituisce l'elenco: elimina quelle sparite, aggiunge e aggiorna le altre.
create or replace function public.sync_saved_picks(p_endpoint text, p_p256dh text, p_auth text, p_ua text, p_picks jsonb, p_night boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_dev uuid; v_del int := 0; r jsonb;
begin
  if p_endpoint is null or length(p_endpoint) > 1000 or p_endpoint !~ '^https://' or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then raise exception 'sottoscrizione non valida'; end if;
  if p_picks is null or jsonb_typeof(p_picks) <> 'array' or jsonb_array_length(p_picks) > 300 then raise exception 'elenco giocate non valido'; end if;
  if (select count(*) from push_devices) >= 20 and not exists (select 1 from push_devices where endpoint = p_endpoint) then raise exception 'troppi dispositivi registrati'; end if;
  insert into push_devices (endpoint, p256dh, auth, user_agent, night_enabled) values (p_endpoint, p_p256dh, p_auth, left(p_ua, 300), coalesce(p_night, false))
  on conflict (endpoint) do update set p256dh = excluded.p256dh, auth = excluded.auth, user_agent = excluded.user_agent, night_enabled = excluded.night_enabled, failures = 0, last_seen_at = now()
  returning id into v_dev;
  delete from saved_picks s where s.device_id = v_dev and not exists (select 1 from jsonb_array_elements(p_picks) e where e->>'sport' = s.sport and e->>'ref' = s.ref);
  get diagnostics v_del = row_count;
  for r in select * from jsonb_array_elements(p_picks) loop
    insert into saved_picks (device_id, sport, ref, selection, label, home, away, kickoff_at)
    values (v_dev, r->>'sport', r->>'ref', r->>'selection', left(r->>'label', 120), left(r->>'home', 80), left(r->>'away', 80), nullif(r->>'kickoff', '')::timestamptz)
    on conflict (device_id, sport, ref) do update set selection = excluded.selection, label = excluded.label, home = excluded.home, away = excluded.away, kickoff_at = excluded.kickoff_at, active = true;
  end loop;
  return jsonb_build_object('device', v_dev, 'picks', jsonb_array_length(p_picks), 'removed', v_del);
end $$;

create or replace function public.unsubscribe_push(p_endpoint text) returns int language sql security definer set search_path = public as $$
  with d as (delete from push_devices where endpoint = p_endpoint returning 1) select count(*)::int from d
$$;

alter table public.push_devices enable row level security;
alter table public.saved_picks enable row level security;
alter table public.pick_change_log enable row level security;
alter table public.player_importance enable row level security;
alter table public.match_absence_log enable row level security;
revoke all on public.push_devices, public.saved_picks, public.pick_change_log, public.player_importance, public.match_absence_log from anon, authenticated;
revoke all on function public.sync_saved_picks(text, text, text, text, jsonb, boolean), public.unsubscribe_push(text) from public, anon, authenticated;
grant select, insert, update, delete on public.push_devices, public.saved_picks, public.player_importance to service_role;
grant select, insert on public.pick_change_log, public.match_absence_log to service_role;
grant usage, select on sequence public.pick_change_log_id_seq, public.match_absence_log_id_seq to service_role;
grant execute on function public.sync_saved_picks(text, text, text, text, jsonb, boolean), public.unsubscribe_push(text) to service_role;
