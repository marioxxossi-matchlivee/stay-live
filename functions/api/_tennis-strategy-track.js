// Stay Live Tennis — registro e verifica delle strategie. Logica PURA (nessuna rete): costruisce le righe da registrare PRIMA dell'inizio
// e, a partita finita, ricava esito, profitto e metriche dalle sole righe registrate. Nessun dato futuro entra mai nel calcolo.
// Registrazione = «primo momento utile»: la giocata si congela appena supera tutti i controlli e non si modifica più (né prima né dopo l'inizio).
import { brier, logLoss, calibrationBins, sampleVerdict, MIN_RELIABLE_SAMPLE } from "./_tennis-metrics.js";
import { STRATEGY, wilson } from "./_tennis-strategy.js";

const iso = (t) => new Date(t).toISOString();
const ms = (v) => { const t = Date.parse(v); return Number.isFinite(t) ? t : null; };
const round = (x, d = 4) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);

export const runId = (now) => `run-${iso(now)}`;

export function pickRow(s, { now, run }) {
  return {
    match_key: s.key, run_id: run, created_at: iso(now), starts_at: s.startsAt, tour: s.tour, surface: s.surface, category: s.category, tournament: s.tournament,
    p1_name: s.p1Name, p2_name: s.p2Name, side: s.side, selected_name: s.name, is_underdog: s.isUnderdog, tier: s.cls,
    p_model: s.p, p_used: s.pUsed, p_market: s.market, implied: s.implied, fair_odds: s.fairOdds, edge: s.edge, ev: s.evUsed,
    odds: s.odds, book: s.book, odds_at: s.oddsAt, reliability: s.reliability, model_ver: s.modelVersion ?? "n.d.", engine_ver: STRATEGY.version, stake_units: 1,
    calibration: s.calibration ?? {}, reasons: s.reasons ?? [],
  };
}

export function doubleRow(d, { now, run }) {
  const [a, b] = d.legs, leg = (x, n) => ({ [`leg${n}_match_key`]: x.key, [`leg${n}_side`]: x.side, [`leg${n}_name`]: x.name, [`leg${n}_p`]: x.pUsed, [`leg${n}_odds`]: x.odds, [`leg${n}_book`]: x.book, [`leg${n}_odds_at`]: x.oddsAt, [`leg${n}_starts_at`]: x.startsAt });
  return {
    pair_key: d.pairKey, run_id: run, created_at: iso(now), starts_at: [a.startsAt, b.startsAt].sort()[0], ...leg(a, 1), ...leg(b, 2),
    total_odds: d.totalOdds, joint_p: d.jointP, ev: d.evDouble, independence_assumed: true, comparison: d.comparison ?? [], model_ver: a.modelVersion ?? "n.d.", engine_ver: STRATEGY.version, stake_units: 1,
  };
}

export function runRow(strategy, { now, run }) {
  const d = strategy.dashboard;
  return {
    id: run, generated_at: iso(now), engine_ver: strategy.engineVersion, model_ver: strategy.evaluations.find((e) => e.prediction?.modelVersion)?.prediction.modelVersion ?? null, scope: strategy.range,
    analyzed: d.analyzed, evaluable: d.evaluable, value_found: d.valueFound, singles_selected: d.singles, double_status: d.double, class_counts: d.byClass, selected_keys: strategy.selected.map((s) => s.key), plan_kind: strategy.plan.kind,
    calibration: { sample: strategy.calibration.sample, validated: strategy.calibration.validated },
  };
}

/**
 * Righe NUOVE da registrare. `existing`: { pickKeys:Set, doubleLegKeys:Set, doublePairs:Set } già nel database.
 * Si registra solo prima dell'inizio, con quote lette prima dell'inizio e mai una seconda volta per la stessa partita o gamba.
 */
export function planRecords(strategy, existing, now, run = runId(now)) {
  const okTimes = (startsAt, oddsAt) => { const s = ms(startsAt), o = ms(oddsAt); return s != null && o != null && s > now && o < s && o <= now; };
  const picks = (strategy.selected ?? []).filter((s) => !existing.pickKeys.has(s.key) && okTimes(s.startsAt, s.oddsAt)).map((s) => pickRow(s, { now, run }));
  let doubles = [];
  const d = strategy.double;
  if (d?.status === "recommended" && d.legs?.length === STRATEGY.maxLegs) {
    const [a, b] = d.legs;
    const free = !existing.doublePairs.has(d.pairKey) && !existing.doubleLegKeys.has(a.key) && !existing.doubleLegKeys.has(b.key);
    if (free && okTimes(a.startsAt, a.oddsAt) && okTimes(b.startsAt, b.oddsAt)) doubles = [doubleRow(d, { now, run })];
  }
  return { run: runRow(strategy, { now, run }), picks, doubles };
}

// ───────────── Esiti ─────────────
const void_ = new Set(["ended_other", "cancelled"]);
/** Esito di una gamba/singola dalla partita registrata. Ritiri e walkover (ended_other) e annullate non contano: le regole dei bookmaker variano, non si stimano. */
export function settleLeg(side, odds, match) {
  if (!match) return { state: "pending", profit: null };
  if (match.status === "finished" && (match.winner === 1 || match.winner === 2)) { const won = match.winner === side; return { state: won ? "won" : "lost", won, profit: won ? odds - 1 : -1 }; }
  if (void_.has(match.status)) return { state: "void", profit: 0 };
  return { state: "pending", profit: null };
}
export function settleDouble(rec, m1, m2) {
  const a = settleLeg(rec.leg1_side, rec.leg1_odds, m1), b = settleLeg(rec.leg2_side, rec.leg2_odds, m2);
  if (a.state === "lost" || b.state === "lost") return { state: "lost", won: false, profit: -1, legs: [a.state, b.state] };
  if (a.state === "pending" || b.state === "pending") return { state: "pending", profit: null, legs: [a.state, b.state] };
  if (a.state === "void" || b.state === "void") return { state: "void", profit: 0, legs: [a.state, b.state] };
  return { state: "won", won: true, profit: rec.total_odds - 1, legs: [a.state, b.state] };
}

/** Una riga è valida solo se registrata e con quote lette PRIMA dell'inizio: altrimenti sarebbe una ricostruzione a posteriori e non si conta. */
export const recordedBeforeStart = (createdAt, oddsAts, startsAt) => { const s = ms(startsAt), c = ms(createdAt); return s != null && c != null && c < s && oddsAts.every((o) => { const t = ms(o); return t != null && t < s && t <= c; }); };

export function singleHistoryRow(r, match) {
  const valid = recordedBeforeStart(r.created_at, [r.odds_at], r.starts_at), res = valid ? settleLeg(r.side, r.odds, match) : { state: "invalid", profit: null };
  return { key: r.match_key, createdAt: r.created_at, startsAt: r.starts_at, tour: r.tour, surface: r.surface, category: r.category, tournament: r.tournament, p1Name: r.p1_name, p2Name: r.p2_name, side: r.side, name: r.selected_name, isUnderdog: r.is_underdog, tier: r.tier, p: r.p_model, pUsed: r.p_used, odds: r.odds, book: r.book, oddsAt: r.odds_at, ev: r.ev, reliability: r.reliability, modelVersion: r.model_ver, engineVersion: r.engine_ver, state: res.state, profit: res.profit, score: match?.score ?? null };
}
export function doubleHistoryRow(r, m1, m2) {
  const valid = recordedBeforeStart(r.created_at, [r.leg1_odds_at, r.leg2_odds_at], r.starts_at), res = valid ? settleDouble(r, m1, m2) : { state: "invalid", profit: null, legs: [] };
  const leg = (n, m) => ({ key: r[`leg${n}_match_key`], name: r[`leg${n}_name`], odds: r[`leg${n}_odds`], p: r[`leg${n}_p`], book: r[`leg${n}_book`], oddsAt: r[`leg${n}_odds_at`], startsAt: r[`leg${n}_starts_at`], state: res.legs?.[n - 1] ?? "pending", score: m?.score ?? null });
  return { key: r.pair_key, createdAt: r.created_at, startsAt: r.starts_at, totalOdds: r.total_odds, jointP: r.joint_p, ev: r.ev, legs: [leg(1, m1), leg(2, m2)], modelVersion: r.model_ver, engineVersion: r.engine_ver, state: res.state, profit: res.profit };
}

// ───────────── Metriche ─────────────
/** Rendimento a puntata unitaria (flat): ROI, profitto in unità, intervallo al 95% sul ROI medio. Con campione scarso nessuna conclusione. */
function block(rows, pKey) {
  const done = rows.filter((r) => r.state === "won" || r.state === "lost"), n = done.length, wins = done.filter((r) => r.state === "won").length;
  const profit = done.reduce((t, r) => t + r.profit, 0), mean = n ? profit / n : null;
  let ci = null;
  if (n >= 2) { const v = done.reduce((t, r) => t + (r.profit - mean) ** 2, 0) / (n - 1), se = Math.sqrt(v / n); ci = [round(mean - 1.96 * se), round(mean + 1.96 * se)]; }
  const pts = done.map((r) => ({ p: r[pKey], y: r.state === "won" ? 1 : 0 }));
  const verdict = n < MIN_RELIABLE_SAMPLE ? `Campione in costruzione (${n}/${MIN_RELIABLE_SAMPLE}): nessuna conclusione sul rendimento.`
    : ci[0] > 0 ? "ROI positivo, distinguibile dal caso (intervallo al 95% sopra zero)." : ci[1] < 0 ? "ROI negativo, distinguibile dal caso (intervallo al 95% sotto zero)." : "ROI non distinguibile dallo zero con il campione disponibile.";
  return {
    registered: rows.length, settled: n, wins, losses: n - wins, pending: rows.filter((r) => r.state === "pending").length, voided: rows.filter((r) => r.state === "void").length,
    hitRate: n ? round(wins / n) : null, profit: round(profit, 2), roi: round(mean), roiCi95: ci, hitRateCi95: n ? wilson(wins, n).map((x) => round(x)) : null,
    brier: round(brier(pts)), logLoss: round(logLoss(pts)), calibration: calibrationBins(pts), sample: sampleVerdict(n), verdict,
  };
}
const group = (rows, key, pKey) => Object.fromEntries([...rows.reduce((m, r) => { const k = key(r) ?? "n.d."; (m.get(k) ?? m.set(k, []).get(k)).push(r); return m; }, new Map())].map(([k, v]) => { const b = block(v, pKey); return [k, { settled: b.settled, wins: b.wins, roi: b.roi, profit: b.profit }]; }));

export function summarizeStrategy(singles, doubles) {
  const s = singles.filter((r) => r.state !== "invalid"), d = doubles.filter((r) => r.state !== "invalid");
  return {
    singles: { ...block(s, "p"), byTour: group(s, (r) => r.tour, "p"), bySurface: group(s, (r) => r.surface, "p"), byTier: group(s, (r) => r.tier, "p"), byRole: group(s, (r) => (r.isUnderdog ? "sfavorito" : "favorito"), "p") },
    doubles: { ...block(d.map((r) => ({ ...r, p: r.jointP })), "p") },
    rejected: singles.length - s.length + doubles.length - d.length,
    note: "Solo giocate registrate prima dell'inizio, con quote lette prima dell'inizio. Puntata unitaria (1 unità). Ritiri, walkover e partite annullate non contano.",
  };
}

/** Storico completo per la snapshot. picks/doubles: righe del database; matches: Map match_key → { status, winner, score }. */
export function buildStrategyHistory({ picks, doubles, matches }, { maxRows = 200 } = {}) {
  const sr = picks.map((r) => singleHistoryRow(r, matches.get(r.match_key) ?? null)).sort((a, b) => String(b.startsAt).localeCompare(String(a.startsAt)));
  const dr = doubles.map((r) => doubleHistoryRow(r, matches.get(r.leg1_match_key) ?? null, matches.get(r.leg2_match_key) ?? null)).sort((a, b) => String(b.startsAt).localeCompare(String(a.startsAt)));
  return { engineVersion: STRATEGY.version, ...summarizeStrategy(sr, dr), singleRows: sr.slice(0, maxRows), doubleRows: dr.slice(0, maxRows), total: { singles: sr.length, doubles: dr.length }, minSample: MIN_RELIABLE_SAMPLE };
}
