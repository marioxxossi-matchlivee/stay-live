-- Stay Live Tennis — LIVE OBSERVATION: registro prospettico delle valutazioni PRE-PARTITA.
-- *** BOZZA PER REVISIONE — NON APPLICATA. Non eseguire senza autorizzazione esplicita. ***
-- Solo additiva: crea 2 tabelle, 1 vista, 3 funzioni trigger, 4 trigger, soli GRANT a service_role. Non modifica né cancella nulla di esistente (nessuna tabella del calcio,
-- nessuna tabella tennis_* esistente, nessun trigger esistente). Rieseguibile (if not exists / create or replace / drop trigger if exists).
-- Accesso solo dal server con la service_role key: RLS attiva e NESSUNA policy (come le altre tabelle tennis_*); nessun accesso per anon/authenticated.
--
-- Modello:
--   tennis_observations          = anagrafica della partita osservata (una riga per match_key), IMMUTABILE.
--   tennis_observation_versions  = una riga per valutazione: rev 1 = valutazione iniziale (permanente), rev 2… = revisioni successive. APPEND-ONLY.
--   Il risultato NON è mai scritto qui: si legge da tennis_matches (collegamento per match_key, controllo di identità dei giocatori per id) tramite la vista.

-- ── Anagrafica (immutabile) ──────────────────────────────────────────────
create table if not exists public.tennis_observations (
  match_key         text primary key references public.tennis_matches (match_key) on delete restrict,
  first_recorded_at timestamptz not null default now(),
  first_starts_at   timestamptz not null,                 -- inizio programmato al momento della prima osservazione (può poi cambiare: vedi versions.starts_at)
  tour              text not null check (tour in ('atp', 'wta')),
  tournament_id     text,
  tournament        text,
  category          text,
  surface           text,
  round_id          smallint,
  p1_id             text not null,
  p2_id             text not null,
  p1_name           text,
  p2_name           text,
  observation_ver   text not null,                        -- versione del registro (formato dei dati), non del modello
  constraint tennis_observations_before_start check (first_recorded_at < first_starts_at)
);
create index if not exists tennis_observations_starts_idx on public.tennis_observations (first_starts_at desc, match_key desc);   -- paginazione a cursore dello storico completo
create index if not exists tennis_observations_tournament_idx on public.tennis_observations (tournament_id, first_starts_at desc);
create index if not exists tennis_observations_p1_idx on public.tennis_observations (p1_id);
create index if not exists tennis_observations_p2_idx on public.tennis_observations (p2_id);

-- ── Versioni (append-only) ───────────────────────────────────────────────
create table if not exists public.tennis_observation_versions (
  match_key       text not null references public.tennis_observations (match_key) on delete restrict,
  rev             integer not null check (rev >= 1),
  recorded_at     timestamptz not null default now(),
  starts_at       timestamptz not null,                   -- inizio programmato visto in QUESTA versione
  reason          text not null check (reason in ('initial', 'rescheduled', 'model_version', 'publication', 'probability', 'missing_data', 'ratings_version')),
  model_ver       text not null,                          -- es. tennis-v2
  ratings_ver     text,                                   -- impronta del CONTENUTO dello storico usato dal motore (partita per partita: data, vincitore, perdente, superficie, circuito) + conteggio + loader
  history_loader  text,                                   -- offset | keyset: cosa ha caricato il motore
  history_matches integer,
  history_last_at timestamptz not null,                   -- data più recente dello storico usato: deve precedere l'istante di registrazione (controllo anti look-ahead indipendente da starts_at)
  published       boolean not null,                       -- false = astensione (si registra comunque: serve a misurare la copertura)
  pick            smallint check (pick in (1, 2)),
  p1              real check (p1 is null or (p1 > 0 and p1 < 1)),
  p2              real check (p2 is null or (p2 > 0 and p2 < 1)),
  reliability     text check (reliability in ('alta', 'media', 'bassa')),
  abstain_reason  text,
  elo1            real, elo2 real,                        -- Elo combinato (generale + superficie) usato dal modello
  form1           real, form2 real,                       -- punteggio di forma usato dal modello (null = nessuno storico)
  inputs          jsonb not null default '{}'::jsonb,     -- componenti del modello, Elo generale/superficie, partite di supporto, H2H, ranking, statistiche di servizio disponibili
  missing         jsonb not null default '[]'::jsonb,     -- dati mancanti dichiarati dal modello
  primary key (match_key, rev),
  constraint tennis_obs_versions_initial check ((rev = 1) = (reason = 'initial')),
  constraint tennis_obs_versions_before_start check (recorded_at < starts_at),
  constraint tennis_obs_versions_history_before_record check (history_last_at <= recorded_at),
  constraint tennis_obs_versions_coherent check (
    (published and pick is not null and p1 is not null and p2 is not null and abs(p1 + p2 - 1) < 0.001)
    or (not published and pick is null and p1 is null and p2 is null)
  )
);
create index if not exists tennis_obs_versions_starts_idx on public.tennis_observation_versions (starts_at desc);
create index if not exists tennis_obs_versions_model_idx on public.tennis_observation_versions (model_ver, starts_at desc);
create index if not exists tennis_obs_versions_recorded_idx on public.tennis_observation_versions (recorded_at desc);

-- ── Immutabilità ─────────────────────────────────────────────────────────
-- Anagrafica: INSERT ignorato se la partita è già iniziata; UPDATE, DELETE e TRUNCATE rifiutati (errore esplicito: nessun processo legittimo li usa).
create or replace function public.tennis_observations_guard() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.first_starts_at <= now() then return null; end if;                      -- mai registrare a partita iniziata
    if new.first_recorded_at > now() + interval '1 minute' or new.first_recorded_at < now() - interval '1 hour' then
      raise exception 'tennis_observations: first_recorded_at non plausibile (%)', new.first_recorded_at;
    end if;
    return new;
  end if;
  raise exception 'tennis_observations è immutabile: % rifiutato', tg_op;
end $$;
drop trigger if exists tennis_observations_guard on public.tennis_observations;
create trigger tennis_observations_guard before insert or update or delete on public.tennis_observations
  for each row execute function public.tennis_observations_guard();

-- Versioni: INSERT consentito solo se (a) la revisione non esiste già (idempotenza: ripetere lo stesso inserimento è un no-op),
-- (b) rev = ultima + 1 (nessun salto), (c) la partita non è iniziata e recorded_at è plausibile. UPDATE, DELETE, TRUNCATE sempre rifiutati.
create or replace function public.tennis_observation_versions_guard() returns trigger language plpgsql set search_path = public as $$
declare last_rev integer;
begin
  if tg_op = 'INSERT' then
    if exists (select 1 from public.tennis_observation_versions v where v.match_key = new.match_key and v.rev = new.rev) then return null; end if;
    if new.starts_at <= now() then return null; end if;                            -- mai registrare a partita iniziata
    if new.recorded_at > now() + interval '1 minute' or new.recorded_at < now() - interval '1 hour' then
      raise exception 'tennis_observation_versions: recorded_at non plausibile (%)', new.recorded_at;
    end if;
    select coalesce(max(v.rev), 0) into last_rev from public.tennis_observation_versions v where v.match_key = new.match_key;
    if new.rev <> last_rev + 1 then raise exception 'tennis_observation_versions: rev % non consecutiva (ultima %)', new.rev, last_rev; end if;
    return new;
  end if;
  raise exception 'tennis_observation_versions è append-only: % rifiutato', tg_op;
end $$;
drop trigger if exists tennis_observation_versions_guard on public.tennis_observation_versions;
create trigger tennis_observation_versions_guard before insert or update or delete on public.tennis_observation_versions
  for each row execute function public.tennis_observation_versions_guard();

create or replace function public.tennis_observation_no_truncate() returns trigger language plpgsql set search_path = public as $$
begin raise exception '% è immutabile: TRUNCATE rifiutato', tg_table_name; end $$;
drop trigger if exists tennis_observations_no_truncate on public.tennis_observations;
create trigger tennis_observations_no_truncate before truncate on public.tennis_observations for each statement execute function public.tennis_observation_no_truncate();
drop trigger if exists tennis_observation_versions_no_truncate on public.tennis_observation_versions;
create trigger tennis_observation_versions_no_truncate before truncate on public.tennis_observation_versions for each statement execute function public.tennis_observation_no_truncate();

-- ── Collegamento ai risultati (sola lettura) ─────────────────────────────
-- Legame ESCLUSIVAMENTE per match_key (chiave stabile torneo|turno|id|id) + controllo che gli id dei due giocatori coincidano: mai per nome.
-- Una partita rimasta «scheduled» dopo l'orario previsto è «awaiting_result», non conclusa. Il vincitore conta solo con status finished e winner 1|2.
create or replace view public.tennis_observation_results with (security_invoker = true) as
  select o.match_key, o.tour, o.tournament_id, o.tournament, o.category, o.surface, o.round_id, o.p1_id, o.p2_id, o.p1_name, o.p2_name,
         o.first_starts_at, o.first_recorded_at,
         m.status as match_status, m.starts_at as match_starts_at, m.winner, m.score, m.result_type, m.updated_at as match_updated_at,
         (m.p1_id = o.p1_id and m.p2_id = o.p2_id) as identity_ok,
         case
           when not (m.p1_id = o.p1_id and m.p2_id = o.p2_id) then 'identity_mismatch'
           when m.status = 'finished' and m.winner in (1, 2) then 'concluded'
           when m.status = 'finished' then 'awaiting_result'
           when m.status = 'live' then 'live'
           when m.status = 'postponed' then 'postponed'
           when m.status = 'cancelled' then 'cancelled'
           when m.status = 'interrupted' then 'interrupted'
           when m.status = 'ended_other' then 'ended_other'
           when m.status in ('scheduled', 'unknown') and m.starts_at <= now() then 'awaiting_result'
           when m.status = 'scheduled' then 'upcoming'
           else 'unknown'
         end as state
  from public.tennis_observations o join public.tennis_matches m using (match_key);

-- ── Sicurezza ────────────────────────────────────────────────────────────
alter table public.tennis_observations enable row level security;
alter table public.tennis_observation_versions enable row level security;
revoke all on public.tennis_observations, public.tennis_observation_versions, public.tennis_observation_results from anon, authenticated;
revoke all on function public.tennis_observations_guard(), public.tennis_observation_versions_guard(), public.tennis_observation_no_truncate() from public, anon, authenticated;

-- Permessi minimi per service_role (usata solo dal server): lettura e inserimento delle due tabelle, lettura della vista. Nessun permesso ad anon/authenticated.
-- (Su Supabase le tabelle create in public ereditano già privilegi di default per service_role; qui sono esplicitati. UPDATE/DELETE non sono concessi qui e i trigger li rifiutano comunque.)
grant select, insert on public.tennis_observations, public.tennis_observation_versions to service_role;
grant select on public.tennis_observation_results to service_role;
