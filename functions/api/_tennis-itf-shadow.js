// Stay Live Tennis — FILTRO SPERIMENTALE ITF «8 punti», SOLO SHADOW MODE. Logica PURA: nessuna rete, nessun database, nessun import dal calcio.
// Non modifica pronostici, BET, Elo, forma, statistiche, pesi né strategie: calcola e descrive soltanto cosa avrebbe escluso.
//
//   DIFFERENZA (punti percentuali assoluti) = P_modello(selezione) − P_mercato(stessa selezione, senza margine)
//   se DIFFERENZA > 8  →  ITF «esclusa» dalla selezione BET sperimentale (8 esatto resta «mantenuta»)
//
// Mercato = coppia di quote di UN solo bookmaker (Pinnacle se presente) normalizzata: P1 = (1/q1)/((1/q1)+(1/q2)). Stessa selezione = il lato pronosticato.
// Quote assenti, scadute (oltre maxOddsAgeMs di TENNIS_BET) o non confrontabili → «non_valutabile»: mai un valore inventato.
// Applicabile SOLO a category === "itf". Challenger, challenger_itf (ambigua, mai forzata), ATP e WTA non hanno alcuna riga.
import { TENNIS_BET, pickOdds } from "./_tennis-bet.js";

export const ITF_SHADOW = Object.freeze({ version: "itf-shadow-v1", category: "itf", thresholdPp: 8, mode: "shadow" });
const round = (x, d = 4) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
const validP = (p) => Number.isFinite(p) && p > 0 && p < 1;

/** Differenza in punti percentuali, arrotondata a 1e-6 così che «esattamente 8» non diventi 8,0000000001 per colpa dei decimali binari. */
export const diffPoints = (modelProb, marketProb) => Math.round((modelProb - marketProb) * 1e8) / 1e6;
export const isExcluded = (diffPp, thresholdPp = ITF_SHADOW.thresholdPp) => Number.isFinite(diffPp) && diffPp > thresholdPp;

/**
 * Regola per una partita. Restituisce null se NON è un ITF (nessuna riga, nessun effetto), altrimenti
 * { outcome: "excluded" | "kept" | "not_evaluable", modelProb, marketProb, diffPp, thresholdPp, oddsBook, oddsP1, oddsP2, pickOdds, oddsAt, reason }.
 */
export function itfShadowRule({ category, pick, p1, p2, oddsSources, oddsFetchedAt, startsAt, status, now = Date.now() }, cfg = ITF_SHADOW) {
  if (category !== cfg.category) return null;
  const out = { outcome: "not_evaluable", modelProb: null, marketProb: null, diffPp: null, thresholdPp: cfg.thresholdPp, oddsBook: null, oddsP1: null, oddsP2: null, pickOdds: null, oddsAt: null, reason: "" };
  const no = (r) => { out.reason = r; return out; };
  if (pick !== 1 && pick !== 2) return no("Nessun pronostico pubblicato: nessuna selezione da confrontare.");
  const p = pick === 1 ? p1 : p2;
  if (!validP(p1) || !validP(p2) || Math.abs(p1 + p2 - 1) > 0.001) return no("Probabilità del modello assenti o incoerenti.");
  out.modelProb = round(p, 6);
  const start = Date.parse(startsAt);
  if (status !== "scheduled" || !Number.isFinite(start) || start <= now) return no("Partita già iniziata o non più programmata: quota pre-partita non utilizzabile.");
  const po = pickOdds(oddsSources, pick);
  if (!po) return no("Quote non disponibili o non valide: non confrontabili.");
  const age = oddsFetchedAt ? now - Date.parse(oddsFetchedAt) : Infinity;
  if (!(age <= TENNIS_BET.maxOddsAgeMs)) return no("Quote obsolete: non confrontabili.");
  if (po.reference.implied == null) return no("Coppia di quote dello stesso bookmaker non disponibile: probabilità di mercato non calcolabile.");
  const ref = (oddsSources ?? []).find((s) => String(s.book) === po.reference.book);
  out.marketProb = round(po.reference.implied, 6); out.diffPp = diffPoints(p, po.reference.implied);
  out.oddsBook = po.reference.book; out.oddsP1 = ref ? Number(ref.p1) : null; out.oddsP2 = ref ? Number(ref.p2) : null; out.pickOdds = po.odds; out.oddsAt = oddsFetchedAt;
  if (isExcluded(out.diffPp, cfg.thresholdPp)) { out.outcome = "excluded"; out.reason = `Modello ${(p * 100).toFixed(1)}% contro mercato ${(po.reference.implied * 100).toFixed(1)}% senza margine: +${out.diffPp.toFixed(1)} punti, oltre la soglia di ${cfg.thresholdPp}.`; }
  else { out.outcome = "kept"; out.reason = `Scarto ${out.diffPp > 0 ? "+" : ""}${out.diffPp.toFixed(1)} punti: entro la soglia di ${cfg.thresholdPp}.`; }
  return out;
}

/** Riga per tennis_itf_shadow, oppure null per ogni partita non ITF. `match`: riga tennis_matches; `pred`: riga già costruita da computePredictions (NON viene modificata). */
export function itfShadowRow(match, pred, now) {
  const r = itfShadowRule({ category: match.category, pick: pred.pick, p1: pred.p1, p2: pred.p2, oddsSources: match.odds_sources, oddsFetchedAt: match.odds_fetched_at, startsAt: match.starts_at, status: match.status, now });
  if (!r) return null;
  const verdict = pred.bet?.verdict ?? null;
  return {
    match_key: match.match_key, starts_at: match.starts_at, tour: match.tour, category: match.category, tournament: match.tournament ?? null, surface: pred.surface ?? null,
    pick: pred.pick ?? null, pick_name: pred.pick === 1 ? match.p1_name ?? null : pred.pick === 2 ? match.p2_name ?? null : null,
    model_prob: r.modelProb, market_prob: r.marketProb, diff_pp: r.diffPp, threshold_pp: r.thresholdPp, outcome: r.outcome,
    current_verdict: verdict, would_remove: verdict === "BET" && r.outcome === "excluded",
    odds_book: r.oddsBook, odds_p1: r.oddsP1, odds_p2: r.oddsP2, pick_odds: r.pickOdds, odds_at: r.oddsAt, model_ver: pred.model_ver ?? null, rule_ver: ITF_SHADOW.version, reason: r.reason, updated_at: new Date(now).toISOString(),
  };
}
export function computeItfShadow({ matches, predictions, now }) {
  const byKey = new Map(predictions.map((p) => [p.match_key, p]));
  return matches.map((m) => { const p = byKey.get(m.match_key); return p ? itfShadowRow(m, p, now) : null; }).filter(Boolean);
}

// ───────────── Confronto retroattivo A (attuale) contro B (con filtro ITF) ─────────────
const stats = (xs) => { const n = xs.length, m = n ? xs.reduce((t, x) => t + x, 0) / n : null; const v = n > 1 ? xs.reduce((t, x) => t + (x - m) ** 2, 0) / (n - 1) : null; return { n, mean: m, var: v }; };
function block(rows) {
  const n = rows.length, wins = rows.filter((r) => r.won).length, pr = rows.map((r) => (r.won ? r.odds - 1 : -1)), s = stats(pr), se = n > 1 ? Math.sqrt(s.var / n) : null;
  return { bets: n, wins, losses: n - wins, hitRate: n ? round(wins / n) : null, profit: round(pr.reduce((t, x) => t + x, 0), 3), roi: n ? round(s.mean) : null, roiCi95: se == null ? null : [round(s.mean - 1.96 * se), round(s.mean + 1.96 * se)], avgOdds: n ? round(rows.reduce((t, r) => t + r.odds, 0) / n, 3) : null, brier: n ? round(rows.reduce((t, r) => t + (r.p - (r.won ? 1 : 0)) ** 2, 0) / n) : null };
}

/**
 * rows normalizzate (vedi rowFromPrediction): { key, startsAt, category, published, pick, p, bet:{verdict, odds, implied, ev, oddsAt}, status, winner }.
 * Solo righe con quota e quota di mercato registrate PRIMA dell'inizio entrano nel confronto (niente dati futuri).
 */
export function simulateItfShadow(rows, cfg = ITF_SHADOW) {
  let rejected = 0, voided = 0, pending = 0;
  const ev = [];
  for (const r of rows) {
    const b = r.bet;
    if (!r.published || !b) continue;
    const okBefore = Number.isFinite(Date.parse(b.oddsAt)) && Date.parse(b.oddsAt) < Date.parse(r.startsAt);
    const settledState = r.status === "finished" && (r.winner === 1 || r.winner === 2) ? "done" : r.status === "ended_other" || r.status === "cancelled" ? "void" : "pending";
    const hasOdds = b.odds > 1 && b.ev != null;
    const diffPp = r.diffPp ?? (validP(b.implied) ? diffPoints(r.p, b.implied) : null);
    if (hasOdds && !okBefore) { rejected++; continue; }
    ev.push({ ...r, settledState, hasOdds, diffPp, isItf: r.category === cfg.category, isBet: b.verdict === "BET", won: settledState === "done" ? r.pick === r.winner : null, odds: b.odds });
  }
  const done = (x) => x.settledState === "done" && x.hasOdds;
  for (const x of ev) { if (x.isBet && x.settledState === "void") voided++; if (x.isBet && x.settledState === "pending") pending++; }
  const bets = ev.filter((x) => x.isBet && done(x));
  const excludedFlag = (x) => x.isItf && isExcluded(x.diffPp, cfg.thresholdPp);
  const A = bets, B = bets.filter((x) => !excludedFlag(x));
  const itfBets = bets.filter((x) => x.isItf), excluded = itfBets.filter(excludedFlag), kept = itfBets.filter((x) => !excludedFlag(x));
  const itfAll = ev.filter((x) => x.isItf && done(x) && x.diffPp != null);
  const bucket = (lo, hi) => { const g = itfAll.filter((x) => x.diffPp > lo && x.diffPp <= hi); const k = g.length, hit = g.filter((x) => x.won).length; return { n: k, hitRate: k ? round(hit / k) : null, brier: k ? round(g.reduce((t, x) => t + (x.p - (x.won ? 1 : 0)) ** 2, 0) / k) : null }; };
  const bBlock = block(B), aBlock = block(A), exB = block(excluded), keB = block(kept);
  // Confronto tra escluse e mantenute (ITF con BET): differenza dei profitti medi, test z di Welch (approssimazione normale)
  const sx = stats(excluded.map((r) => (r.won ? r.odds - 1 : -1))), sk = stats(kept.map((r) => (r.won ? r.odds - 1 : -1)));
  const z = sx.n > 1 && sk.n > 1 && sx.var + sk.var > 0 ? (sx.mean - sk.mean) / Math.sqrt(sx.var / sx.n + sk.var / sk.n) : null;
  const MIN = 30;
  let verdict;
  if (excluded.length < MIN || kept.length < MIN) verdict = `Non conclusivo: campione insufficiente (escluse ${excluded.length}, mantenute ${kept.length}, minimo ${MIN} per gruppo). Nessun miglioramento dichiarato.`;
  else if (z <= -1.96) verdict = "Le partite escluse rendono peggio di quelle mantenute in modo statisticamente rilevante (z ≤ −1,96): evidenza a favore del filtro, da confermare in avanti.";
  else if (z >= 1.96) verdict = "Le partite escluse rendono MEGLIO di quelle mantenute in modo rilevante: evidenza contro il filtro.";
  else verdict = "Differenza non distinguibile dal caso: il filtro non è dimostrato efficace.";
  return {
    rule: { version: cfg.version, thresholdPp: cfg.thresholdPp, category: cfg.category }, rejectedAfterStart: rejected, voided, pending,
    totals: { rows: rows.length, published: rows.filter((r) => r.published).length, itfRows: rows.filter((r) => r.category === cfg.category).length, itfWithComparableOdds: itfAll.length },
    A: aBlock, B: bBlock, delta: { bets: bBlock.bets - aBlock.bets, roi: aBlock.roi != null && bBlock.roi != null ? round(bBlock.roi - aBlock.roi) : null, profit: round(bBlock.profit - aBlock.profit, 3) },
    itf: { bets: itfBets.length, excluded: exB, kept: keB, zExcludedVsKept: z == null ? null : round(z, 3) },
    itfReliabilityByGap: { le0: bucket(-Infinity, 0), p0_4: bucket(0, 4), p4_8: bucket(4, 8), gt8: bucket(8, Infinity) },
    verdict,
  };
}

/** Riga normalizzata dai dati già registrati (tennis_predictions + esito della partita). p = probabilità del modello per il lato pronosticato. */
export function rowFromPrediction(p) {
  const m = p.tennis_matches ?? {};
  const prob = p.pick === 1 ? p.p1 : p.pick === 2 ? p.p2 ?? (p.p1 == null ? null : 1 - p.p1) : null;
  return { key: p.match_key, startsAt: p.starts_at, category: m.category ?? "unknown", published: Boolean(p.published), pick: p.pick, p: prob, bet: p.bet ? { verdict: p.bet.verdict, odds: p.bet.odds ?? null, implied: p.bet.implied ?? null, ev: p.bet.ev ?? null, oddsAt: p.bet.oddsAt ?? p.odds_at ?? null } : null, status: m.status ?? null, winner: m.winner ?? null };
}
