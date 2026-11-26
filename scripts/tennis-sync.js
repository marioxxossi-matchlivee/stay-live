#!/usr/bin/env node
/**
 * Stay Live Tennis — sincronizzazione completa con SportsAPI365 Direct (GitHub Actions). Un solo script coordinato, quattro modalità:
 *   live      ogni 10 minuti: feed live (1 richiesta) + ricostruzione della snapshot
 *   refresh   ogni 30 minuti: programma ATP/WTA, risultati di oggi e ieri, pronostici + quote/EV, snapshot
 *   static    ogni giorno: ranking, tornei, statistiche dei giocatori in programma, backtest cronologico, snapshot
 *   backfill  manuale: scarica i risultati degli ultimi N giorni (storico per il modello), nei limiti di richieste indicati
 * Catena: provider → client → normalizzazione → Supabase (tennis_*) → modello → snapshot (tennis_snapshot) → app.
 * Ogni giro prende un blocco a scadenza (tennis_acquire_lock): due giri dello stesso tipo non girano mai insieme.
 * Variabili (secrets): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TENNIS_API_KEY; facoltativa TENNIS_API_BASE. La chiave non viene mai stampata.
 * Il calcio non è coinvolto: nessuna tabella, funzione o workflow del calcio è letto o scritto.
 */
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { errorMessage, supabaseDelete, supabaseGet, supabaseGetAll, supabasePatch, supabaseUpsert } from "../functions/api/_lib.js";
import { loadFinishedKeyset } from "../functions/api/_tennis-history.js";
import { createClient, DIRECT_BASE, TennisApiError } from "../functions/api/_tennis-client.js";
import { TOURS, normalizeUpcoming, normalizeResult, normalizeLive, normalizeRankingPage, normalizeMatchStats, normalizeTournamentFilters, readPage, readLiveFeed } from "../functions/api/_tennis-provider.js";
import { RatingBook, predictMatch, normalizeSurface, inferBestOf, TENNIS_MODEL } from "../functions/api/_tennis-model.js";
import { chronologicalBacktest, fitPlatt, groupSummary, MIN_RELIABLE_SAMPLE } from "../functions/api/_tennis-metrics.js";
import { anchorToMarket, evaluateBet } from "../functions/api/_tennis-bet.js";
import { buildBoard } from "../functions/api/_tennis-snapshot.js";
import { computeItfShadow } from "../functions/api/_tennis-itf-shadow.js";
import { recordLiveObservation, insertIgnore } from "../functions/api/_tennis-observation-run.js";
import { buildStrategy } from "../functions/api/_tennis-strategy.js";
import { planRecords, buildStrategyHistory } from "../functions/api/_tennis-strategy-track.js";

const H = 3600e3, DAY = 24 * H;
export const LIMITS = { live: 6, refresh: 160, static: 450, backfill: 6000 };   // richieste massime per giro (la quota mensile è 200.000)
export const QUOTA_RESERVE = 3000;                                              // sotto questa quota residua si lavora solo sull'essenziale
export const CFG = { finishedWindowH: 48, historyDays: 400, statsTtlDays: 7, statsCapPerRun: 400, rankPages: 3, resultPages: 24, upcomingPages: 10, snapshotMaxAgeMin: 90 };
const iso = (t) => new Date(t).toISOString();
export const ymd = (t) => iso(t).slice(0, 10);
/** Date UTC (YYYY-MM-DD) dei `n` giorni che finiscono a `now`, dal più recente. */
export const datesBack = (now, n) => Array.from({ length: n }, (_, i) => ymd(now - i * DAY));

// ───────────── Accesso a Supabase (sostituibile nei test) ─────────────
export function makeDb(env) {
  const hdr = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json" };
  return {
    getAll: (table, query, pageSize = 1000, maxPages = 40) => supabaseGetAll(env, table, query, pageSize, maxPages),
    fetchPage: (params) => supabaseGet(env, "tennis_matches", params), // sola lettura: usata solo dal caricamento a chiave (interruttore sotto)
    upsert: (table, rows, conflict) => (rows.length ? supabaseUpsert(env, table, rows, conflict) : Promise.resolve()),
    patch: (table, filter, body) => supabasePatch(env, table, filter, body),
    del: (table, filter) => supabaseDelete(env, table, filter),
    insertIgnore: (table, rows, conflict) => (rows.length ? insertIgnore(env, table, rows, conflict) : Promise.resolve()), // solo LIVE OBSERVATION (INSERT che ignora i duplicati)
    async rpc(name, args) {
      const res = await fetch(new URL(`/rest/v1/rpc/${name}`, env.SUPABASE_URL), { method: "POST", headers: hdr, body: JSON.stringify(args) });
      if (!res.ok) throw new Error(`Supabase rpc ${name}: HTTP ${res.status}`);
      return res.json();
    },
  };
}

// ───────────── Righe per le tabelle (insiemi di colonne FISSI: l'aggiornamento non azzera ciò che l'altra fonte ha scritto) ─────────────
export function upcomingRow(n, nowIso) {
  return {
    match_key: n.match_key, provider_id: n.provider_id, tour: n.tour, tournament_id: n.tournament_id, tournament: n.tournament, round_id: n.round_id, level_id: n.level_id, category: n.category,
    surface: n.surface, starts_at: n.starts_at, status: n.status, p1_id: n.p1_id, p2_id: n.p2_id, p1_name: n.p1_name, p2_name: n.p2_name, p1_country: n.p1_country, p2_country: n.p2_country,
    p1_seed: n.p1_seed, p2_seed: n.p2_seed, live_match_id: n.live_match_id, odds_sources: n.odds_sources, odds_fetched_at: nowIso, h2h: n.h2h, src_endpoint: "upcoming", fetched_at: nowIso, source: "sportsapi365", updated_at: nowIso,
  };
}
export function resultRow(n, nowIso) {
  return {
    match_key: n.match_key, provider_id: n.provider_id, tour: n.tour, tournament_id: n.tournament_id, tournament: n.tournament, round_id: n.round_id, level_id: n.level_id, category: n.category,
    surface: n.surface, court_id: n.court_id, best_of: n.best_of, starts_at: n.starts_at, status: n.status, p1_id: n.p1_id, p2_id: n.p2_id, p1_name: n.p1_name, p2_name: n.p2_name,
    winner: n.winner, score: n.score, result_type: n.result_type, closing_odds: n.closing_odds, live_match_id: n.live_match_id, src_endpoint: "results", fetched_at: nowIso, source: "sportsapi365", updated_at: nowIso,
  };
}
/** Un incontro per chiave (l'ultimo visto vince); i risultati prevalgono sul programma. */
export const dedupe = (rows) => [...new Map(rows.map((r) => [r.match_key, r])).values()];

const note = (meta, msg) => { (meta.errors ??= []).unshift({ at: new Date().toISOString(), message: String(msg).slice(0, 300) }); meta.errors.length = Math.min(meta.errors.length, 20); };
/** Errore temporaneo del provider (5xx, 429, timeout, rete): non deve far saltare l'intero giro, lo si segnala e si va avanti. */
export const isTransient = (e) => e instanceof TennisApiError && e.retryable === true;
const lowQuota = (api) => api.stats.quota.remaining !== null && api.stats.quota.remaining < QUOTA_RESERVE;

// ───────────── Passi ─────────────
export async function fetchUpcoming(api, tours = TOURS, meta = {}) {
  const out = []; let dropped = 0;
  for (const tour of tours) {
    let r;
    try { r = await api.paginate((p) => `/upcoming/matches/${tour}?group=singles&limit=50&pageNo=${p}`, readPage, { maxPages: CFG.upcomingPages }); }
    catch (e) { if (!isTransient(e)) throw e; note(meta, `programma ${tour}: ${errorMessage(e)}`); (meta.providerFailures ??= []).push(`programma ${tour}`); continue; }
    for (const w of r.warnings) note(meta, `programma ${tour}: ${w}`);
    for (const row of r.items) { const n = normalizeUpcoming(row, tour); if (n) out.push(n); else dropped++; }
    if (r.capped) { meta.capped = true; break; }
  }
  meta.upcoming = { rows: out.length, dropped };
  return out;
}

export async function fetchResults(api, dates, tours = TOURS, meta = {}) {
  const out = []; let dropped = 0, doubles = 0; const failedTours = new Set();
  for (const date of dates) for (const tour of tours) {
    if (failedTours.has(tour)) continue; // il provider ha già risposto con un errore per questo circuito: niente altri tentativi in questo giro
    if (lowQuota(api) && date !== dates[0]) { note(meta, "quota quasi esaurita: risultati precedenti saltati"); return out; }
    let r;
    try { r = await api.paginate((p) => `/${tour}/results/${date}?pageNo=${p}&pageSize=50`, readPage, { maxPages: CFG.resultPages }); }
    catch (e) { if (!isTransient(e)) throw e; failedTours.add(tour); note(meta, `risultati ${tour} ${date}: ${errorMessage(e)}`); (meta.providerFailures ??= []).push(`risultati ${tour}`); continue; }
    for (const w of r.warnings) note(meta, `risultati ${tour} ${date}: ${w}`);
    for (const row of r.items) { const n = normalizeResult(row, tour); if (n) out.push(n); else if (Array.isArray(row?.player1?.members)) doubles++; else dropped++; }
    if (r.capped) { meta.capped = true; meta.results = { rows: out.length, dropped, doublesSkipped: doubles, dates: dates.length, capped: true }; return out; }
  }
  meta.results = { rows: out.length, dropped, doublesSkipped: doubles, dates: dates.length };
  return out;
}

export async function saveMatches(db, upcoming, results, now) {
  const nowIso = iso(now);
  const since = iso(now - 5 * DAY);
  const existing = new Map((await db.getAll("tennis_matches", { select: "match_key,status", starts_at: `gte.${since}` })).map((r) => [r.match_key, r.status]));
  const resKeys = new Set(results.map((r) => r.match_key));
  // Il programma non riscrive un incontro già concluso né uno presente nei risultati di questo giro.
  // Gli stati speciali arrivati dal feed risultati non devono degradare a "unknown" per effetto del programma.
  // Una transizione a "scheduled" è ammessa solo quando il feed programma la dichiara esplicitamente.
  const specialStatuses = new Set(["postponed", "cancelled", "interrupted"]);
  const up = dedupe(upcoming.filter((u) => {
    if (resKeys.has(u.match_key)) return false; // i risultati di questo giro prevalgono sempre
    const status = existing.get(u.match_key);
    if (status === "finished" || status === "ended_other") return false;
    if (specialStatuses.has(status) && u.status !== "scheduled") return false;
    return true;
  })).map((n) => upcomingRow(n, nowIso));
  const rs = dedupe(results).map((n) => resultRow(n, nowIso));
  await db.upsert("tennis_matches", up, "match_key");
  await db.upsert("tennis_matches", rs, "match_key");
  // Giocatori visti (nome/paese): nessun ranking qui, lo scrive il giro statico.
  const players = new Map();
  for (const n of [...upcoming, ...results]) for (const [id, name, country] of [[n.p1_id, n.p1_name, n.p1_country ?? null], [n.p2_id, n.p2_name, n.p2_country ?? null]]) if (id && name) players.set(id, { id, tour: n.tour, name, country, updated_at: nowIso });
  const all = [...players.values()];
  // Due scritture a colonne uniformi: chi ha il paese lo aggiorna, chi non lo ha NON lo azzera.
  await db.upsert("tennis_players", all.filter((p) => p.country), "id");
  await db.upsert("tennis_players", all.filter((p) => !p.country).map(({ id, tour, name, updated_at }) => ({ id, tour, name, updated_at })), "id");
  return { upcoming: up.length, results: rs.length, players: players.size };
}

/**
 * Interruttore del caricamento storico. PREDEFINITO "offset": il percorso operativo storico (80 pagine × 1.000 righe = tetto di 80.000 partite).
 * "keyset" (paginazione a chiave, storico completo, errore esplicito oltre il limite di sicurezza) si attiva SOLO con TENNIS_HISTORY_LOADER=keyset:
 * nessun workflow lo imposta; attivarlo è una decisione separata, annullarla = togliere la variabile. La Shadow Mode confronta i due percorsi.
 */
export const historyLoaderMode = (env = process.env) => (String(env.TENNIS_HISTORY_LOADER ?? "").trim().toLowerCase() === "keyset" ? "keyset" : "offset");

/** Storico per il modello: SOLO incontri conclusi regolarmente (completed) con vincitore, in ordine cronologico. */
export async function loadHistory(db, now, days = CFG.historyDays, { loader = historyLoaderMode() } = {}) {
  const base = { select: "p1_id,p2_id,winner,starts_at,surface,best_of,tour,category,p1_name,p2_name", status: "eq.finished", winner: "not.is.null", starts_at: `gte.${iso(now - days * DAY)}` };
  let rows;
  if (loader === "keyset") {
    if (typeof db.fetchPage !== "function") throw new Error("Caricamento a chiave non disponibile: manca db.fetchPage.");
    rows = (await loadFinishedKeyset(db.fetchPage, { query: { ...base, select: `match_key,${base.select}` }, retries: 2 })).rows;
  } else {
    rows = await db.getAll("tennis_matches", { select: base.select, status: base.status, winner: base.winner, starts_at: base.starts_at, order: "starts_at.asc,match_key.asc" }, 1000, 80);
  }
  return rows.filter((r) => r.winner === 1 || r.winner === 2).map((r) => ({ t: Date.parse(r.starts_at), winnerId: r.winner === 1 ? r.p1_id : r.p2_id, loserId: r.winner === 1 ? r.p2_id : r.p1_id, surface: r.surface, tour: r.tour, bestOf: r.best_of, category: r.category, p1Name: r.p1_name, p2Name: r.p2_name }));
}

export function buildBook(history, cfg = TENNIS_MODEL) {
  const book = new RatingBook(cfg);
  for (const m of history) book.update({ t: m.t, winnerId: m.winnerId, loserId: m.loserId, surface: normalizeSurface(m.surface) });
  return book;
}

/** Pronostici per le partite in programma (prima dell'inizio): modello + quote reali + verdetto. Ogni partita ha una riga, anche l'astensione. */
export function computePredictions({ matches, book, stats, ranks, calibrator, now }) {
  const rows = [];
  for (const m of matches) {
    if (m.status !== "scheduled" || Date.parse(m.starts_at) <= now) continue;
    const st = (id) => { const s = stats.get(id); return s && s.serve_pts_won != null && s.return_pts_won != null ? { serve: s.serve_pts_won, ret: s.return_pts_won, matches: s.matches ?? null, servePoints: s.stats?.servePoints ?? null } : undefined; };
    const rk = (id) => ranks.get(`${m.tour}|${id}`)?.position;
    const extras = { h2h: m.h2h && m.h2h.p1Wins != null && m.h2h.p2Wins != null ? { p1Wins: m.h2h.p1Wins, p2Wins: m.h2h.p2Wins } : undefined, stats1: st(m.p1_id), stats2: st(m.p2_id), rank: rk(m.p1_id) && rk(m.p2_id) ? { p1: rk(m.p1_id), p2: rk(m.p2_id) } : undefined };
    const pred0 = predictMatch(book, { t: Date.parse(m.starts_at), surface: m.surface, tour: m.tour, bestOf: m.best_of ?? inferBestOf({ tour: m.tour, tournament: m.tournament }), p1: { id: m.p1_id, name: m.p1_name }, p2: { id: m.p2_id, name: m.p2_name } }, extras, calibrator);
    if (m.best_of == null) pred0.missing = [...pred0.missing, `formato dell'incontro (dedotto dal torneo: al meglio dei ${pred0.bestOf} set)`];
    const quoteInfo = { status: m.status, startsAt: m.starts_at, oddsSources: m.odds_sources, oddsFetchedAt: m.odds_fetched_at };
    const pred = anchorToMarket(pred0, quoteInfo, { now });                       // pronostico ancorato al mercato; senza quote fresche nessun pronostico
    const bet = evaluateBet(quoteInfo, pred, { now, category: m.category });
    rows.push({
      match_key: m.match_key, starts_at: m.starts_at, tour: m.tour, surface: normalizeSurface(m.surface), published: pred.published, pick: pred.published ? pred.pick : null,
      p1: pred.published ? pred.p1 : null, p2: pred.published ? pred.p2 : null, reliability: pred.published ? pred.reliability : null, reasons: pred.reasons ?? [], missing: pred.missing ?? [],
      components: pred.components ?? {}, abstain_reason: pred.abstainReason ?? null, odds_p1: bet.odds && pred.pick === 1 ? bet.odds : null, odds_p2: bet.odds && pred.pick === 2 ? bet.odds : null,
      odds_book: bet.book, odds_at: bet.ev !== null ? m.odds_fetched_at : null, bet, model_ver: pred.modelVersion, computed_at: iso(now), updated_at: iso(now),
    });
  }
  return rows;
}

// ───────────── Strategy Center: registrazione prospettica e storico (solo Supabase, nessuna richiesta al provider) ─────────────
/** Registra le giocate della strategia PRIMA dell'inizio (primo momento utile, poi immutabili). Un errore qui non ferma mai il giro. */
export async function recordStrategy(db, payload, now, meta = {}) {
  const strategy = buildStrategy(payload.matches, { range: "d7", tour: "all", now, calibration: payload.history?.backtest ?? null });
  const since = iso(now - 1 * H);
  const [picks, doubles] = await Promise.all([
    db.getAll("tennis_strategy_picks", { select: "match_key", starts_at: `gte.${since}` }, 1000, 5),
    db.getAll("tennis_strategy_doubles", { select: "pair_key,leg1_match_key,leg2_match_key", starts_at: `gte.${since}` }, 1000, 5),
  ]);
  const existing = { pickKeys: new Set(picks.map((r) => r.match_key)), doubleLegKeys: new Set(doubles.flatMap((r) => [r.leg1_match_key, r.leg2_match_key])), doublePairs: new Set(doubles.map((r) => r.pair_key)) };
  const rec = planRecords(strategy, existing, now);
  await db.upsert("tennis_strategy_runs", [rec.run], "id");
  await db.upsert("tennis_strategy_picks", rec.picks, "match_key");
  await db.upsert("tennis_strategy_doubles", rec.doubles, "pair_key");
  meta.strategy = { analyzed: strategy.dashboard.analyzed, evaluable: strategy.dashboard.evaluable, value: strategy.dashboard.valueFound, selected: strategy.dashboard.singles, double: strategy.dashboard.double, newPicks: rec.picks.length, newDoubles: rec.doubles.length };
  return rec;
}

/** Storico delle strategie dalle sole righe registrate + esiti delle partite (lette dal database). */
const inList = (ks) => `in.(${ks.map((k) => `"${String(k).split("\"").join("\\\"")}"`).join(",")})`; // filtro PostgREST: valori tra virgolette, virgolette interne con barra rovesciata
export async function loadStrategyHistory(db) {
  const [picks, doubles] = await Promise.all([
    db.getAll("tennis_strategy_picks", { select: "*", order: "starts_at.desc" }, 1000, 10),
    db.getAll("tennis_strategy_doubles", { select: "*", order: "starts_at.desc" }, 1000, 10),
  ]);
  const keys = [...new Set([...picks.map((r) => r.match_key), ...doubles.flatMap((r) => [r.leg1_match_key, r.leg2_match_key])])];
  const matches = new Map();
  for (let i = 0; i < keys.length; i += 40) {
    const part = keys.slice(i, i + 40);
    const rows = await db.getAll("tennis_matches", { select: "match_key,status,winner,score", match_key: inList(part) }, 1000, 1);
    for (const r of rows) matches.set(r.match_key, r);
  }
  return buildStrategyHistory({ picks, doubles, matches });
}

const mapBy = (rows, key) => new Map(rows.map((r) => [typeof key === "function" ? key(r) : r[key], r]));

/** Ricostruisce la snapshot dall'ultimo stato del database e la salva. */
export async function buildAndStoreSnapshot(db, now, meta = {}) {
  const since = iso(now - CFG.finishedWindowH * H);
  const [matches, players, rankings, stats, live, preds, sync, usage, histPreds, bt] = await Promise.all([
    db.getAll("tennis_matches", { select: "*", starts_at: `gte.${since}`, order: "starts_at.asc,match_key.asc" }, 1000, 20),
    db.getAll("tennis_players", { select: "id,name,country,rank,points" }, 1000, 40),
    db.getAll("tennis_rankings", { select: "tour,player_id,position,points" }, 1000, 12),
    db.getAll("tennis_player_stats", { select: "player_id,matches,serve_pts_won,return_pts_won,stats,fetched_at", surface: "eq.all" }, 1000, 20),
    db.getAll("tennis_live", { select: "*", seen_at: `gte.${iso(now - 2 * H)}` }, 1000, 3),
    db.getAll("tennis_predictions", { select: "*", starts_at: `gte.${since}` }, 1000, 20),
    db.getAll("tennis_sync_state", { select: "*" }, 100, 1),
    db.getAll("tennis_api_usage", { select: "endpoint,requests,errors", day: `eq.${ymd(now)}` }, 200, 1),
    db.getAll("tennis_predictions", { select: "match_key,starts_at,tour,surface,published,pick,p1,reliability,abstain_reason,bet,model_ver,tennis_matches(status,winner,score,category,tournament,p1_name,p2_name,surface)", starts_at: `lte.${iso(now)}`, order: "starts_at.desc" }, 1000, 12),
    db.getAll("tennis_snapshot", { select: "id,payload,built_at", id: "eq.backtest" }, 5, 1),
  ]);
  const ctx = {
    now, matches, players: mapBy(players, "id"), rankings: mapBy(rankings, (r) => `${r.tour}|${r.player_id}`), stats: mapBy(stats, "player_id"), live: mapBy(live, "match_key"),
    predictions: mapBy(preds, "match_key"), historyRows: histPreds, sync: mapBy(sync, "id"), usage, windowDays: Math.round(CFG.finishedWindowH / 24), backtest: bt[0]?.payload ?? null,
    totals: { players: players.length, playersWithStats: stats.filter((s) => s.serve_pts_won != null).length, rankedAtp: rankings.filter((r) => r.tour === "atp").length, rankedWta: rankings.filter((r) => r.tour === "wta").length, ...(meta.totals ?? {}) },
  };
  // Il giro in corso non ha ancora scritto il proprio stato: lo si anticipa nella snapshot (quota e conteggi reali di questo giro).
  if (meta.job && meta.api) {
    const row = ctx.sync.get(meta.job) ?? { id: meta.job };
    ctx.sync.set(meta.job, { ...row, last_ok: iso(now), last_started: row.last_started ?? iso(now), meta: { ...(row.meta ?? {}), ...(meta.jobMeta ?? {}), quota: meta.api.stats.quota, requests: meta.api.stats.requests } });
  }
  const payload = buildBoard(ctx);
  // Strategy Center: registrazione (solo nel giro «refresh», che rilegge le quote) e storico. Se le tabelle non esistono ancora
  // (migrazione non eseguita) o Supabase risponde con un errore, il giro continua: pronostici e snapshot non ne risentono.
  if (meta.job === "refresh") {
    try { await recordStrategy(db, payload, now, meta.jobMeta ?? (meta.jobMeta = {})); }
    catch (e) { (meta.jobMeta ??= {}).strategyError = String(e?.message ?? e).slice(0, 200); }
  }
  try { payload.strategy = await loadStrategyHistory(db); } catch (e) { payload.strategy = { unavailable: true, reason: String(e?.message ?? e).slice(0, 200) }; }
  await db.upsert("tennis_snapshot", [{ id: "board", payload, meta: { matches: payload.matches.length, builtBy: meta.job ?? null }, built_at: iso(now) }], "id");
  return { matches: payload.matches.length };
}

// ───────────── Blocco, stato e consumo ─────────────
async function begin(db, job, seconds) { return db.rpc("tennis_acquire_lock", { p_id: job, p_seconds: seconds }); }
async function finish(db, job, now, { ok, error, meta }) {
  await db.patch("tennis_sync_state", { id: `eq.${job}` }, { locked_until: null, last_finished: iso(now), ...(ok ? { last_ok: iso(now), last_error: null } : { last_error: String(error).slice(0, 400) }), meta });
}
export async function recordUsage(db, api, now) {
  const day = ymd(now);
  const prev = new Map((await db.getAll("tennis_api_usage", { select: "endpoint,requests,errors", day: `eq.${day}` }, 200, 1)).map((r) => [r.endpoint, r]));
  const q = api.stats.quota;
  await db.upsert("tennis_api_usage", Object.entries(api.stats.byPath).map(([endpoint, v]) => ({ day, endpoint, requests: (prev.get(endpoint)?.requests ?? 0) + v.requests, errors: (prev.get(endpoint)?.errors ?? 0) + v.errors, quota_remaining: q.remaining, quota_limit: q.limit, last_at: iso(now) })), "day,endpoint");
}

// ───────────── Modalità ─────────────
export async function runLive({ api, db, now }) {
  const meta = {};
  const r = readLiveFeed(await api.get("/extend/api/events/live"));
  if (r.problem) throw new Error(r.problem);
  const rows = r.items.map(normalizeLive).filter(Boolean);
  await db.upsert("tennis_live", rows.map((x) => ({ match_key: x.match_key, live_event_id: x.live_event_id, tour: x.tour, tournament_id: x.tournament_id, round_id: x.round_id, tournament: x.tournament, status: x.status, sets: x.sets, score_raw: x.score_raw, points: x.points, starts_at: x.starts_at, provider_updated_at: x.updated_at, seen_at: iso(now) })), "match_key");
  await db.del("tennis_live", { seen_at: `lt.${iso(now - 6 * H)}` });
  meta.live = { events: r.items.length, recognised: rows.length };
  await buildAndStoreSnapshot(db, now, { job: "live", api, jobMeta: meta });
  return meta;
}

export async function runRefresh({ api, db, now }) {
  const meta = {};
  // Risultati: oggi; anche ieri solo nelle prime ore UTC (partite finite a cavallo della mezzanotte). Così si risparmia metà delle richieste.
  // NB: `days` (BACKFILL_DAYS, 30 di default) vale SOLO per il backfill: il refresh lo ignora (era la causa del tetto raggiunto).
  const nDays = new Date(now).getUTCHours() < 6 ? 2 : 1;
  // Prima i risultati (chiudono le partite finite e alimentano il modello), poi il programma: se il tetto scatta, restano i risultati.
  const results = await fetchResults(api, datesBack(now, nDays), TOURS, meta);
  const upcoming = await fetchUpcoming(api, TOURS, meta);
  meta.saved = await saveMatches(db, upcoming, results, now);
  const since = iso(now - 1 * H);
  const [matches, stats, rankings, bt] = await Promise.all([
    db.getAll("tennis_matches", { select: "*", status: "eq.scheduled", starts_at: `gte.${since}`, order: "starts_at.asc" }, 1000, 12),
    db.getAll("tennis_player_stats", { select: "player_id,matches,serve_pts_won,return_pts_won,stats", surface: "eq.all" }, 1000, 20),
    db.getAll("tennis_rankings", { select: "tour,player_id,position" }, 1000, 12),
    db.getAll("tennis_snapshot", { select: "id,payload", id: "eq.backtest" }, 5, 1),
  ]);
  const history = await loadHistory(db, now);
  const book = buildBook(history);
  const calibrator = bt[0]?.payload?.calibrator ?? null;
  const rows = computePredictions({ matches, book, stats: mapBy(stats, "player_id"), ranks: mapBy(rankings, (r) => `${r.tour}|${r.player_id}`), calibrator, now });
  await db.upsert("tennis_predictions", rows, "match_key");
  // Filtro sperimentale ITF (8 punti) in SHADOW MODE: registra soltanto cosa avrebbe escluso. Non tocca `rows` né i BET; nessuna richiesta al provider.
  // Un errore non ferma il giro: pronostici e snapshot restano identici.
  try {
    const shadow = computeItfShadow({ matches, predictions: rows, now });
    await db.upsert("tennis_itf_shadow", shadow, "match_key");
    meta.itfShadow = { rows: shadow.length, excluded: shadow.filter((x) => x.outcome === "excluded").length, wouldRemoveBet: shadow.filter((x) => x.would_remove).length, notEvaluable: shadow.filter((x) => x.outcome === "not_evaluable").length };
  } catch (e) { meta.itfShadowError = String(e?.message ?? e).slice(0, 200); }
  // LIVE OBSERVATION (sola osservazione, SPENTA se TENNIS_LIVE_OBSERVATION non è "on"): registra la valutazione pre-match già calcolata. Non lancia mai: l'esito (o l'errore) va in meta.liveObservation.
  meta.liveObservation = await recordLiveObservation({ db, matches, rows, book, stats: mapBy(stats, "player_id"), ranks: mapBy(rankings, (r) => `${r.tour}|${r.player_id}`), now, history, loader: historyLoaderMode() });
  meta.predictions = { total: rows.length, published: rows.filter((r) => r.published).length, abstained: rows.filter((r) => !r.published).length, bet: rows.filter((r) => r.bet?.verdict === "BET").length, historyMatches: history.length, historyLoader: historyLoaderMode(), calibrated: !!calibrator };
  await buildAndStoreSnapshot(db, now, { job: "refresh", api, jobMeta: meta });
  // Giro parziale (es. un circuito in errore): resta valido, con l'avviso in meta.errors. Se il provider non ha dato nulla, il giro risulta fallito
  // ma solo DOPO aver ricalcolato pronostici e snapshot dai dati già presenti, così l'app non resta ferma.
  if (meta.providerFailures?.length) {
    meta.partial = true;
    if (!meta.results?.rows && !meta.upcoming?.rows) throw new TennisApiError(`Provider non raggiungibile (${meta.providerFailures.join(", ")}): dati non aggiornati`, { retryable: true });
  }
  return meta;
}

export async function runStatic({ api, db, now }) {
  const meta = {};
  // 1) ranking
  for (const tour of TOURS) {
    const r = await api.paginate((p) => `/${tour}/ranking/singles?pageNo=${p}`, (b) => { const x = normalizeRankingPage(b, tour); return { items: x.rows, hasNext: x.hasNext, problem: x.problem }; }, { maxPages: CFG.rankPages, idOf: (x) => x.player_id });
    for (const w of r.warnings) note(meta, `ranking ${tour}: ${w}`);
    const rows = [...new Map(r.items.map((x) => [x.player_id, x])).values()].map((x) => ({ ...x, points: x.points == null ? null : Math.round(x.points), fetched_at: iso(now) }));
    await db.upsert("tennis_rankings", rows, "tour,player_id");
    await db.upsert("tennis_players", rows.map((x) => ({ id: x.player_id, tour, name: x.name ?? "?", country: x.country, rank: x.position, points: x.points, ranking_date: x.ranking_date, updated_at: iso(now) })), "id");
    (meta.ranking ??= {})[tour] = rows.length;
  }
  // 2) tornei
  const tf = normalizeTournamentFilters(await api.get("/upcoming/filters?include=options"));
  if (tf.problem) note(meta, `tornei: ${tf.problem}`);
  await db.upsert("tennis_tournaments", tf.tournaments.map((t) => ({ ...t, last_seen: iso(now) })), "id");
  meta.tournaments = tf.tournaments.length;
  // 3) statistiche dei giocatori in programma (scadenza 7 giorni, tetto per giro)
  const sched = await db.getAll("tennis_matches", { select: "tour,p1_id,p2_id,starts_at", status: "eq.scheduled", starts_at: `gte.${iso(now)}`, order: "starts_at.asc" }, 1000, 6);
  const need = new Map();
  for (const m of sched) for (const id of [m.p1_id, m.p2_id]) if (!need.has(id)) need.set(id, m.tour);
  const have = mapBy(await db.getAll("tennis_player_stats", { select: "player_id,fetched_at", surface: "eq.all" }, 1000, 20), "player_id");
  const todo = [...need].filter(([id]) => !have.has(id) || now - Date.parse(have.get(id).fetched_at) > CFG.statsTtlDays * DAY).slice(0, CFG.statsCapPerRun);
  let ok = 0, missing = 0;
  for (const [id, tour] of todo) {
    if (lowQuota(api)) { note(meta, "quota quasi esaurita: statistiche sospese"); break; }
    try {
      const st = normalizeMatchStats(await api.get(`/${tour}/player/match-stats/${id}`));
      await db.upsert("tennis_player_stats", [{ player_id: id, tour, surface: "all", matches: null, serve_pts_won: st.serve_pts_won, return_pts_won: st.return_pts_won, stats: { servePoints: st.serve_points, returnPoints: st.return_points, readAt: iso(now), scope: "carriera, valori del giorno di lettura" }, fetched_at: iso(now) }], "player_id,tour,surface");
      if (st.serve_pts_won != null) ok++; else missing++;
    } catch (e) { note(meta, `statistiche ${tour}/${id}: ${errorMessage(e)}`); }
  }
  meta.stats = { requested: todo.length, usable: ok, unusable: missing, stillToFetch: Math.max(0, need.size - todo.length) };
  // 4) backtest cronologico + calibrazione (solo se il campione basta)
  const history = await loadHistory(db, now);
  const bt = chronologicalBacktest(history, { warmup: 0 });
  const calibrator = bt.published.length >= MIN_RELIABLE_SAMPLE ? fitPlatt(bt.published.map((r) => ({ p: r.p, y: r.y }))) : null;
  const seg = bt.published.map((r) => ({ p: r.p, y: r.y, tour: r.tour, surface: r.surface }));
  const payload = { at: iso(now), matches: history.length, predicted: bt.rows.length, published: bt.published.length, abstained: bt.abstained, summary: bt.summary, verdict: bt.verdict, calibrator, modelVersion: TENNIS_MODEL.version,
    byTour: groupSummary(seg, (r) => r.tour), bySurface: groupSummary(seg, (r) => r.surface) }; // campioni per circuito e superficie: li usa lo Strategy Engine per dichiarare cosa è validato
  await db.upsert("tennis_snapshot", [{ id: "backtest", payload, meta: { n: bt.published.length }, built_at: iso(now) }], "id");
  meta.backtest = { history: history.length, published: bt.published.length, verdict: bt.verdict, calibrated: !!calibrator };
  await buildAndStoreSnapshot(db, now, { job: "static", api, jobMeta: meta });
  return meta;
}

export async function runBackfill({ api, db, now, days, dates }) {
  const meta = {};
  const results = await fetchResults(api, dates?.length ? dates : datesBack(now, days), TOURS, meta); // `dates`: ripasso mirato di giorni specifici
  meta.saved = await saveMatches(db, [], results, now);
  await buildAndStoreSnapshot(db, now, { job: "backfill", api, jobMeta: meta });
  return meta;
}

const JOBS = { live: { fn: runLive, lock: 600, id: "live" }, refresh: { fn: runRefresh, lock: 1500, id: "refresh" }, static: { fn: runStatic, lock: 3000, id: "static" }, backfill: { fn: runBackfill, lock: 3300, id: "backfill" } };

/** Esegue un giro con blocco, stato e consumo. Restituisce { ok, skipped?, meta }. Mai segreti nei messaggi. */
export async function runJob(mode, { api, db, now = Date.now(), days, dates }) {
  const job = JOBS[mode]; if (!job) throw new Error(`Modalità sconosciuta: ${mode}`);
  if (!(await begin(db, job.id, job.lock))) return { ok: true, skipped: "un altro giro dello stesso tipo è ancora in corso", meta: {} };
  let meta = {};
  try {
    meta = await job.fn({ api, db, now, days, dates });
    meta.quota = api.stats.quota; meta.requests = api.stats.requests; meta.errorsHttp = api.stats.errors; meta.byPath = api.stats.byPath;
    await recordUsage(db, api, now).catch(() => {});
    await finish(db, job.id, Date.now(), { ok: true, meta });
    return { ok: true, meta };
  } catch (e) {
    const msg = api.redact(errorMessage(e));
    meta.quota = api.stats.quota; meta.requests = api.stats.requests; note(meta, msg);
    await recordUsage(db, api, now).catch(() => {});
    await finish(db, job.id, Date.now(), { ok: false, error: msg, meta }).catch(() => {});
    return { ok: false, error: msg, meta, transient: isTransient(e) };
  }
}

async function main() {
  const mode = (process.argv[2] || process.env.TENNIS_SYNC_MODE || "refresh").toLowerCase();
  const need = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "TENNIS_API_KEY"].filter((k) => !process.env[k]);
  if (need.length) { console.error(`Variabili mancanti: ${need.join(", ")}`); process.exit(1); }
  const api = createClient({ key: process.env.TENNIS_API_KEY, base: process.env.TENNIS_API_BASE || DIRECT_BASE, maxRequests: Math.min(LIMITS[mode] ?? 200, Number(process.env.TENNIS_MAX_REQUESTS) || Infinity) });
  const days = Math.max(1, Math.min(400, Number(process.env.BACKFILL_DAYS) || 30));
  const dates = String(process.env.BACKFILL_DATES ?? "").split(/[,\s]+/).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  const res = await runJob(mode, { api, db: makeDb(process.env), days, dates });
  const partial = res.ok && res.meta?.partial ? ` — PARZIALE: ${(res.meta.providerFailures ?? []).join(", ")} non raggiungibile` : "";
  const line = res.skipped ? `Saltato: ${res.skipped}` : res.ok ? `OK ${mode}: ${api.stats.requests} richieste, quota residua ${api.stats.quota.remaining ?? "n.d."}${partial}` : res.transient ? `AVVISO ${mode}: il provider non risponde (${res.error}); riprova al prossimo giro` : `ERRORE ${mode}: ${res.error}`;
  console.log(line);
  if (process.env.GITHUB_ACTIONS && (res.transient || partial)) console.log(`::warning::${line}`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Tennis — ${mode}\n${line}\n\n\`\`\`json\n${JSON.stringify(res.meta, null, 2).slice(0, 4000)}\n\`\`\`\n`);
  process.exit(res.ok || res.transient ? 0 : 1); // un errore temporaneo del provider resta scritto in tennis_sync_state ma non manda in rosso il workflow
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
