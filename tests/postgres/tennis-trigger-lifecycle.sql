-- Test d'integrazione eseguiti dal motore PostgreSQL reale in un database effimero CI.
-- Le migrazioni di produzione vengono applicate prima di questo file: qui si verificano i trigger,
-- senza modificare Supabase o dati reali.

DO $roles$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
END
$roles$;

-- Partite sintetiche per soddisfare le FK delle tabelle reali.
INSERT INTO public.tennis_matches
  (match_key, tour, starts_at, p1_id, p2_id, status)
VALUES
  ('ci-pred-past', 'atp', now() - interval '1 day', 'p1', 'p2', 'scheduled'),
  ('ci-pred-future', 'atp', now() + interval '1 day', 'p3', 'p4', 'scheduled'),
  ('ci-pick-future', 'atp', now() + interval '2 day', 'p5', 'p6', 'scheduled'),
  ('ci-pick-past', 'atp', now() - interval '1 hour', 'p7', 'p8', 'scheduled'),
  ('ci-double-a', 'atp', now() + interval '3 day', 'p9', 'p10', 'scheduled'),
  ('ci-double-b', 'atp', now() + interval '4 day', 'p11', 'p12', 'scheduled'),
  ('ci-observation', 'atp', now() + interval '5 day', 'p13', 'p14', 'scheduled');

DO $test$
DECLARE
  n integer;
  original_updated timestamptz;
BEGIN
  -- tennis_predictions: inserimento nel passato ignorato.
  INSERT INTO public.tennis_predictions
    (match_key, starts_at, tour, published, pick, p1, p2, model_ver)
  VALUES
    ('ci-pred-past', now() - interval '1 day', 'atp', false, null, null, null, 'ci');
  IF EXISTS (SELECT 1 FROM public.tennis_predictions WHERE match_key = 'ci-pred-past') THEN
    RAISE EXCEPTION 'FAIL: prediction INSERT after start was not ignored';
  END IF;

  INSERT INTO public.tennis_predictions
    (match_key, starts_at, tour, published, pick, p1, p2, model_ver)
  VALUES
    ('ci-pred-future', now() + interval '1 day', 'atp', false, null, null, null, 'ci');
  SELECT updated_at INTO original_updated FROM public.tennis_predictions WHERE match_key = 'ci-pred-future';

  -- Caso limite documentato: OLD futura -> NEW passata è oggi consentito dal trigger.
  UPDATE public.tennis_predictions
     SET starts_at = now() - interval '1 minute'
   WHERE match_key = 'ci-pred-future';
  IF NOT EXISTS (SELECT 1 FROM public.tennis_predictions WHERE match_key = 'ci-pred-future' AND starts_at <= now()) THEN
    RAISE EXCEPTION 'FAIL: future-to-past transition was not reproduced';
  END IF;
  UPDATE public.tennis_predictions SET model_ver = 'changed' WHERE match_key = 'ci-pred-future';
  DELETE FROM public.tennis_predictions WHERE match_key = 'ci-pred-future';
  IF NOT EXISTS (SELECT 1 FROM public.tennis_predictions WHERE match_key = 'ci-pred-future' AND model_ver = 'ci') THEN
    RAISE EXCEPTION 'FAIL: started prediction was mutable/deletable';
  END IF;

  -- Strategy runs: INSERT-only.
  INSERT INTO public.tennis_strategy_runs (id, generated_at, engine_ver) VALUES ('ci-run', now(), 'v1');
  UPDATE public.tennis_strategy_runs SET engine_ver = 'v2' WHERE id = 'ci-run';
  DELETE FROM public.tennis_strategy_runs WHERE id = 'ci-run';
  IF NOT EXISTS (SELECT 1 FROM public.tennis_strategy_runs WHERE id = 'ci-run' AND engine_ver = 'v1') THEN
    RAISE EXCEPTION 'FAIL: strategy run was mutable/deletable';
  END IF;

  -- Strategy picks: future INSERT accepted; past INSERT and subsequent UPDATE/DELETE ignored.
  INSERT INTO public.tennis_strategy_picks
    (match_key, starts_at, tour, side, tier, p_model, p_used, odds, odds_at, model_ver, engine_ver)
  VALUES
    ('ci-pick-future', now() + interval '2 day', 'atp', 1, 'value_high', .6, .6, 1.8, now(), 'm1', 'e1');
  INSERT INTO public.tennis_strategy_picks
    (match_key, starts_at, tour, side, tier, p_model, p_used, odds, odds_at, model_ver, engine_ver)
  VALUES
    ('ci-pick-past', now() - interval '1 hour', 'atp', 1, 'value_high', .6, .6, 1.8, now() - interval '2 hour', 'm1', 'e1');
  UPDATE public.tennis_strategy_picks SET selected_name = 'changed' WHERE match_key = 'ci-pick-future';
  DELETE FROM public.tennis_strategy_picks WHERE match_key = 'ci-pick-future';
  IF NOT EXISTS (SELECT 1 FROM public.tennis_strategy_picks WHERE match_key = 'ci-pick-future')
     OR EXISTS (SELECT 1 FROM public.tennis_strategy_picks WHERE match_key = 'ci-pick-past') THEN
    RAISE EXCEPTION 'FAIL: strategy pick lifecycle mismatch';
  END IF;

  -- Strategy doubles: entrambe le partite devono essere future; UPDATE/DELETE ignorati.
  INSERT INTO public.tennis_strategy_doubles
    (pair_key, starts_at, leg1_match_key, leg1_side, leg1_p, leg1_odds, leg1_odds_at, leg1_starts_at,
     leg2_match_key, leg2_side, leg2_p, leg2_odds, leg2_odds_at, leg2_starts_at,
     total_odds, joint_p, model_ver, engine_ver)
  VALUES
    ('ci-double-ok', now() + interval '3 day', 'ci-double-a', 1, .6, 1.8, now(), now() + interval '3 day',
     'ci-double-b', 2, .6, 1.8, now(), now() + interval '4 day',
     3.24, .36, 'm1', 'e1');
  UPDATE public.tennis_strategy_doubles SET leg1_name = 'changed' WHERE pair_key = 'ci-double-ok';
  DELETE FROM public.tennis_strategy_doubles WHERE pair_key = 'ci-double-ok';
  IF NOT EXISTS (SELECT 1 FROM public.tennis_strategy_doubles WHERE pair_key = 'ci-double-ok') THEN
    RAISE EXCEPTION 'FAIL: strategy double was mutable/deletable';
  END IF;

  -- LIVE OBSERVATION anagrafica: inserimento valido; UPDATE e DELETE devono sollevare eccezione.
  INSERT INTO public.tennis_observations
    (match_key, first_starts_at, tour, p1_id, p2_id, observation_ver)
  VALUES ('ci-observation', now() + interval '5 day', 'atp', 'p13', 'p14', 'ci-v1');

  BEGIN
    UPDATE public.tennis_observations SET p1_name = 'mutated' WHERE match_key = 'ci-observation';
    RAISE EXCEPTION 'FAIL_SENTINEL: observation UPDATE unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL_SENTINEL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE 'tennis_observations è immutabile:%' THEN RAISE; END IF;
  END;

  -- Versione iniziale; duplicato identico è no-op; salto revisione rifiutato.
  INSERT INTO public.tennis_observation_versions
    (match_key, rev, starts_at, reason, model_ver, history_last_at, published, pick, p1, p2)
  VALUES ('ci-observation', 1, now() + interval '5 day', 'initial', 'ci-v1', now(), false, null, null, null);
  INSERT INTO public.tennis_observation_versions
    (match_key, rev, starts_at, reason, model_ver, history_last_at, published, pick, p1, p2)
  VALUES ('ci-observation', 1, now() + interval '5 day', 'initial', 'ci-v1', now(), false, null, null, null);
  SELECT count(*) INTO n FROM public.tennis_observation_versions WHERE match_key = 'ci-observation';
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: duplicate observation revision was not idempotent'; END IF;

  BEGIN
    INSERT INTO public.tennis_observation_versions
      (match_key, rev, starts_at, reason, model_ver, history_last_at, published, pick, p1, p2)
    VALUES ('ci-observation', 3, now() + interval '5 day', 'probability', 'ci-v1', now(), false, null, null, null);
    RAISE EXCEPTION 'FAIL_SENTINEL: revision gap unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL_SENTINEL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE 'tennis_observation_versions: rev % non consecutiva%' THEN RAISE; END IF;
  END;

  INSERT INTO public.tennis_observation_versions
    (match_key, rev, starts_at, reason, model_ver, history_last_at, published, pick, p1, p2)
  VALUES ('ci-observation', 2, now() + interval '5 day', 'probability', 'ci-v1', now(), false, null, null, null);

  BEGIN
    DELETE FROM public.tennis_observation_versions WHERE match_key = 'ci-observation' AND rev = 2;
    RAISE EXCEPTION 'FAIL_SENTINEL: observation version DELETE unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL_SENTINEL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE 'tennis_observation_versions è append-only:%' THEN RAISE; END IF;
  END;

  BEGIN
    TRUNCATE public.tennis_observations;
    RAISE EXCEPTION 'FAIL_SENTINEL: observations TRUNCATE unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL_SENTINEL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '% è immutabile: TRUNCATE rifiutato%' THEN RAISE; END IF;
  END;

  BEGIN
    TRUNCATE public.tennis_observation_versions;
    RAISE EXCEPTION 'FAIL_SENTINEL: versions TRUNCATE unexpectedly succeeded';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL_SENTINEL:%' THEN RAISE; END IF;
    IF SQLERRM NOT LIKE '% è immutabile: TRUNCATE rifiutato%' THEN RAISE; END IF;
  END;
END
$test$;

SELECT 'PostgreSQL trigger lifecycle integration tests: PASS' AS result;
