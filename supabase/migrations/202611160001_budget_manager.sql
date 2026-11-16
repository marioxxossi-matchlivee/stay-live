-- Budget Manager: prenotazione atomica dei crediti API-Football e registro dei consumi.
-- Additiva: NON tocca af_usage (il contatore ufficiale resta com'è).
create table if not exists af_budget_state (
  day date primary key,
  reserved integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists af_ledger (
  day date not null,
  hour smallint not null,
  source text not null,
  endpoint text not null,
  bet text not null default '-',
  tier text not null,
  outcome text not null,      -- ok | empty | failed | rate_limited | blocked_budget | cache_hit | skipped_backoff | dedup_inflight | bundled
  n integer not null default 0,
  credits integer not null default 0,
  primary key (day, hour, source, endpoint, bet, tier, outcome)
);
create index if not exists af_ledger_day_idx on af_ledger (day);

alter table af_budget_state enable row level security;
alter table af_ledger enable row level security;

-- Prenota fino a p_credits senza superare p_cap (soglia di consumo della priorità). Atomica: due processi non superano mai il tetto.
create or replace function af_budget_reserve(p_day date, p_credits int, p_cap int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cur int; off int; granted int;
begin
  insert into af_budget_state(day, reserved) values (p_day, 0) on conflict (day) do nothing;
  select reserved into cur from af_budget_state where day = p_day for update;
  select coalesce(requests, 0) into off from af_usage where day = p_day;   -- contatore ufficiale: solo letto
  cur := greatest(cur, coalesce(off, 0));
  granted := greatest(0, least(p_credits, p_cap - cur));
  update af_budget_state set reserved = cur + granted, updated_at = now() where day = p_day;
  return jsonb_build_object('granted', granted, 'used', cur + granted);
end $$;

create or replace function af_budget_release(p_day date, p_credits int)
returns void language sql security definer set search_path = public as $$
  update af_budget_state set reserved = greatest(0, reserved - p_credits), updated_at = now() where day = p_day;
$$;

create or replace function af_ledger_add(p_rows jsonb)
returns void language sql security definer set search_path = public as $$
  insert into af_ledger (day, hour, source, endpoint, bet, tier, outcome, n, credits)
  select (r->>'day')::date, (r->>'hour')::smallint, r->>'source', r->>'endpoint', coalesce(r->>'bet','-'), r->>'tier', r->>'outcome', (r->>'n')::int, (r->>'credits')::int
  from jsonb_array_elements(p_rows) r
  on conflict (day, hour, source, endpoint, bet, tier, outcome)
  do update set n = af_ledger.n + excluded.n, credits = af_ledger.credits + excluded.credits;
$$;

revoke all on function af_budget_reserve(date,int,int), af_budget_release(date,int), af_ledger_add(jsonb) from public, anon, authenticated;
grant execute on function af_budget_reserve(date,int,int), af_budget_release(date,int), af_ledger_add(jsonb) to service_role;
