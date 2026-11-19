create table if not exists public.tennis_itf_shadow (
  match_key       text primary key references public.tennis_matches (match_key) on delete restrict,
  starts_at       timestamptz not null,
  tour            text,
  category        text not null check (category = 'itf'),
  tournament      text,
  surface         text,
  pick            smallint check (pick in (1, 2)),
  pick_name       text,
  model_prob      real check (model_prob is null or (model_prob > 0 and model_prob < 1)),
  market_prob     real check (market_prob is null or (market_prob > 0 and market_prob < 1)),
  diff_pp         real,
  threshold_pp    real not null default 8,
  outcome         text not null check (outcome in ('excluded', 'kept', 'not_evaluable')),
  current_verdict text,
  would_remove    boolean not null default false,
  odds_book       text,
  odds_p1         real,
  odds_p2         real,
  pick_odds       real,
  odds_at         timestamptz,
  model_ver       text,
  rule_ver        text not null,
  reason          text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists tennis_itf_shadow_starts_idx on public.tennis_itf_shadow (starts_at desc);

create or replace function public.tennis_itf_shadow_freeze() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' and new.starts_at <= now() then return null; end if;
  if tg_op = 'UPDATE' and old.starts_at <= now() then return null; end if;
  if tg_op = 'DELETE' and old.starts_at <= now() then return null; end if;
  if tg_op = 'UPDATE' then new.updated_at := now(); new.created_at := old.created_at; end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
drop trigger if exists tennis_itf_shadow_freeze on public.tennis_itf_shadow;
create trigger tennis_itf_shadow_freeze before insert or update or delete on public.tennis_itf_shadow
  for each row execute function public.tennis_itf_shadow_freeze();
alter table public.tennis_itf_shadow enable row level security;
revoke all on function public.tennis_itf_shadow_freeze() from public, anon, authenticated;
