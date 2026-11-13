// Stay Live Tennis — costruzione della snapshot che l'app legge. Logica PURA (nessuna rete): riceve righe già lette da Supabase.
// Nessun calcolo avviene su Cloudflare e nessuna chiave del provider è qui. Ogni valore mostrato deriva da una riga reale; ciò che manca resta null.
import { summarize, groupSummary, sampleVerdict, MIN_RELIABLE_SAMPLE } from "./_tennis-metrics.js";
import { normalizeSurface } from "./_tennis-model.js";

const LIVE_FRESH_MS = 20 * 60e3;       // un evento live visto da più di 20 minuti non è più "in corso"
const NO_RESULT_AFTER_MS = 12 * 3600e3; // programmata da oltre 12 ore e senza risultato: esito non ricevuto
const iso = (v) => { const t = Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString() : null; };

export const roundLabel = (id) => (id == null ? null : `Turno cod. ${id}`); // il provider non documenta i codici dei turni: non si traducono a caso

/** Stato mostrato: si deriva dallo stato salvato + feed live + orario. Un risultato non si inventa mai. */
export function effectiveStatus(row, live, now) {
  if (row.status === "scheduled" || row.status === "live") {
    const seen = live && now - Date.parse(live.seen_at) <= LIVE_FRESH_MS;
    if (seen && live.status === "live") return "live";
    if (seen && live.status === "ended_unconfirmed") return "live"; // chiuso nel feed ma non ancora confermato dai risultati
    if (now - Date.parse(row.starts_at) > NO_RESULT_AFTER_MS) return "unknown";
  }
  return row.status;
}

const playerView = (id, name, country, seed, ctx, tour) => {
  const pl = ctx.players.get(id), rk = ctx.rankings.get(`${tour}|${id}`);
  return { id, name: name ?? pl?.name ?? null, country: country ?? pl?.country ?? null, seed: seed ?? null, rank: rk?.position ?? pl?.rank ?? null, points: rk?.points ?? pl?.points ?? null };
};
const statsView = (id, ctx) => { const s = ctx.stats.get(id); return s && (s.serve_pts_won != null || s.return_pts_won != null) ? { serve: s.serve_pts_won ?? null, ret: s.return_pts_won ?? null, matches: s.matches ?? null, fetchedAt: iso(s.fetched_at) } : null; };

export function matchView(row, ctx) {
  const now = ctx.now, live = ctx.live.get(row.match_key) ?? null, pred = ctx.predictions.get(row.match_key) ?? null;
  const status = effectiveStatus(row, live, now);
  const sources = Array.isArray(row.odds_sources) ? row.odds_sources : [];
  const primary = sources.find((s) => /pinnacle/i.test(s.book)) ?? sources[0] ?? null;
  const prediction = pred ? { published: pred.published, pick: pred.pick, p1: pred.p1, p2: pred.p2, reliability: pred.reliability, reasons: pred.reasons ?? [], missing: pred.missing ?? [], components: pred.components ?? {}, abstainReason: pred.abstain_reason, computedAt: iso(pred.computed_at), modelVersion: pred.model_ver, frozen: Date.parse(pred.starts_at) <= now } : null;
  return {
    key: row.match_key, tour: row.tour, tournament: row.tournament, tournamentId: row.tournament_id, category: row.category ?? "unknown", level: row.level_id,
    round: roundLabel(row.round_id), roundId: row.round_id, surface: row.surface, court: normalizeSurface(row.surface), bestOf: row.best_of, startsAt: iso(row.starts_at), status,
    resultType: row.result_type, winner: row.winner, score: row.score,
    p1: playerView(row.p1_id, row.p1_name, row.p1_country, row.p1_seed, ctx, row.tour), p2: playerView(row.p2_id, row.p2_name, row.p2_country, row.p2_seed, ctx, row.tour),
    live: status === "live" && live ? { sets: live.sets ?? null, points: live.points ?? null, seenAt: iso(live.seen_at) } : null,
    prediction, bet: pred?.bet ?? null,
    odds: primary ? { p1: primary.p1, p2: primary.p2, source: primary.book, at: iso(row.odds_fetched_at), sources } : null,
    h2h: row.h2h ?? null, stats: { p1: statsView(row.p1_id, ctx), p2: statsView(row.p2_id, ctx) },
    provenance: { source: row.source ?? "sportsapi365", endpoint: row.src_endpoint ?? null, fetchedAt: iso(row.fetched_at) },
  };
}

/** Riga dello storico a partire da un pronostico registrato (con l'incontro incorporato). */
export function historyRow(p) {
  const m = p.tennis_matches ?? {};
  const finished = m.status === "finished" && (m.winner === 1 || m.winner === 2);
  return {
    key: p.match_key, startsAt: iso(p.starts_at), tour: p.tour, category: m.category ?? "unknown", surface: normalizeSurface(p.surface ?? m.surface), tournament: m.tournament ?? null,
    p1Name: m.p1_name ?? null, p2Name: m.p2_name ?? null, published: p.published, pick: p.pick, p1: p.p1, reliability: p.reliability, abstainReason: p.abstain_reason ?? null,
    status: m.status ?? null, winner: finished ? m.winner : null, score: m.score ?? null, hit: p.published && finished ? p.pick === m.winner : null,
    bet: p.bet ? { verdict: p.bet.verdict, odds: p.bet.odds ?? null, ev: p.bet.ev ?? null } : null, modelVersion: p.model_ver,
  };
}

const band = (p) => (p < 0.6 ? "55–60%" : p < 0.65 ? "60–65%" : p < 0.7 ? "65–70%" : "70%+");
/** Riassunto dei pronostici REGISTRATI prima dell'inizio e conclusi (esclude astenuti e partite non concluse regolarmente). */
export function summarizeHistory(rows) {
  const done = rows.filter((r) => r.published && r.hit !== null);
  const pts = (r) => ({ p: r.p1, y: r.winner === 1 ? 1 : 0 });
  const dp = done.map((r) => ({ ...r, ...pts(r) }));
  const favP = (r) => (r.pick === 1 ? r.p1 : 1 - r.p1);
  const bets = rows.filter((r) => r.bet?.verdict === "BET" && r.hit !== null && Number.isFinite(r.bet.odds));
  const profit = bets.reduce((s, r) => s + (r.hit ? r.bet.odds - 1 : -1), 0);
  return {
    summary: summarize(done.map(pts)), verdict: sampleVerdict(done.length), minSample: MIN_RELIABLE_SAMPLE,
    hits: done.filter((r) => r.hit).length, misses: done.filter((r) => !r.hit).length,
    abstained: rows.filter((r) => !r.published).length, pending: rows.filter((r) => r.published && r.hit === null).length,
    byTour: groupSummary(dp, (r) => r.tour), byCategory: groupSummary(dp, (r) => r.category), bySurface: groupSummary(dp, (r) => r.surface),
    byBand: groupSummary(dp.map((r) => ({ ...r, _b: band(favP(r)) })), (r) => r._b), byReliability: groupSummary(dp, (r) => r.reliability),
    bet: { n: bets.length, hits: bets.filter((r) => r.hit).length, roi: bets.length ? profit / bets.length : null, verdict: sampleVerdict(bets.length) },
  };
}

// ───────────── Diagnostica ─────────────
export const PLAN_LIMITS = [
  "Il piano restituisce le quote pre-partita solo nel programma (Marathonbet e, dove presente, Pinnacle). Gli endpoint di quote e statistiche per singola partita indicati nei link delle risposte non sono stati verificati: non sono usati.",
  "Il pronostico del provider (modelPrediction) richiede un piano superiore e non è usato: i pronostici sono calcolati da Stay Live.",
  "Il provider non riporta la superficie nei risultati (solo courtId) e non documenta i codici dei turni: i turni si mostrano come codici.",
  "Le statistiche dei giocatori sono di carriera (valori di oggi): non si usano per rivalutare partite passate.",
];

const ageMin = (t, now) => (t ? Math.max(0, Math.round((now - Date.parse(t)) / 60000)) : null);

/** `ctx.sync`: righe di tennis_sync_state; `ctx.usage`: righe di tennis_api_usage (oggi); `ctx.counts`: conteggi già calcolati dal giro. */
export function buildDiagnostics(ctx, matches) {
  const now = ctx.now;
  const state = (id) => { const r = ctx.sync.get(id); return r ? { lastStarted: iso(r.last_started), lastOk: iso(r.last_ok), lastFinished: iso(r.last_finished), lastError: r.last_error ?? null, okAgeMin: ageMin(r.last_ok, now), meta: r.meta ?? {} } : null; };
  const refresh = state("refresh"), live = state("live"), statics = state("static");
  const byCategory = {}; for (const m of matches) byCategory[m.category] = (byCategory[m.category] ?? 0) + 1;
  const quota = ctx.sync.get("refresh")?.meta?.quota ?? ctx.sync.get("live")?.meta?.quota ?? null;
  const errors = ["refresh", "live", "static"].flatMap((id) => (ctx.sync.get(id)?.meta?.errors ?? []).map((e) => ({ job: id, ...e }))).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 15);
  const published = matches.filter((m) => m.prediction?.published), bet = matches.filter((m) => m.bet?.verdict === "BET");
  const lastOk = [refresh?.lastOk, live?.lastOk].filter(Boolean).sort().pop() ?? null;
  const fresh = lastOk ? now - Date.parse(lastOk) < 2 * 3600e3 : false;
  return {
    provider: { name: "SportsAPI365 Direct", base: "https://api.sportsapi365.com/v1/tennis", status: !lastOk ? "nessuna sincronizzazione riuscita" : fresh ? "attivo" : "dati non recenti", lastRequestAt: refresh?.lastStarted ?? live?.lastStarted ?? null, lastOkAt: lastOk, quota, usageToday: [...ctx.usage].map((u) => ({ endpoint: u.endpoint, requests: u.requests, errors: u.errors })), requestsToday: ctx.usage.reduce((s, u) => s + (u.requests ?? 0), 0) },
    jobs: { refresh, live, static: statics },
    snapshot: { builtAt: new Date(now).toISOString(), matchesInWindow: matches.length, windowDays: ctx.windowDays ?? null },
    counts: {
      matchesWindow: matches.length, byCategory, live: matches.filter((m) => m.status === "live").length, finished: matches.filter((m) => m.status === "finished").length, scheduled: matches.filter((m) => m.status === "scheduled").length,
      byTour: { atp: matches.filter((m) => m.tour === "atp").length, wta: matches.filter((m) => m.tour === "wta").length },
      withOdds: matches.filter((m) => m.odds).length, predictionsPublished: published.length, abstained: matches.filter((m) => m.prediction && !m.prediction.published).length, bet: bet.length,
      ...ctx.totals,
    },
    errors, limits: PLAN_LIMITS,
  };
}

/** Snapshot completa. `ctx`: { now, matches (righe), players, rankings, stats, live, predictions: Map, historyRows, sync, usage, totals }. */
export function buildBoard(ctx) {
  const views = ctx.matches.map((r) => matchView(r, ctx)).filter((m) => m.startsAt && m.p1.name && m.p2.name);
  const rows = ctx.historyRows.map(historyRow).sort((a, b) => String(b.startsAt).localeCompare(String(a.startsAt)));
  const history = { ...summarizeHistory(rows), rows: rows.slice(0, 1500), total: rows.length, backtest: ctx.backtest ?? null };
  return { updatedAt: new Date(ctx.now).toISOString(), matches: views, history, diagnostics: buildDiagnostics(ctx, views) };
}
