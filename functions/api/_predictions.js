import { MODEL } from "./model.js";
import { errorMessage, supabaseUpsert } from "./_lib.js";

/** Parametri che cambiano i pronostici: se ne cambi uno, la versione cambia e le statistiche non si mescolano con quelle vecchie. */
const VERSIONED = [
  "priorHome", "priorAway", "priorWeight", "minLeagueMatches", "decay", "shrinkK", "formShrinkK", "lambdaMin", "lambdaMax", "pLowMethod", "pLowQuantile", "teamSd", "sdMax", "rho",
  "minSample", "betSample", "betThreshold", "minEdge", "maxUsefulProb", "minPlayOdds", "requireRealOdds", "edgeMargin", "longshotFloor", "weights", "marketMargin", "spreadPenalty", "injPenalty",
  "afDelta", "afMargin", "afAdviceShift", "afAgree", "afContrast",
];
export function modelVersion(model = MODEL) {
  const text = JSON.stringify(VERSIONED.map((k) => model[k]));
  let h = 0x811c9dc5;                                           // FNV-1a 32 bit
  for (let i = 0; i < text.length; i += 1) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, "0");
}

/**
 * Riga da registrare per una partita: la selezione principale dell'app (BET o EVITA), solo prima del calcio d'inizio.
 * null se la partita è già iniziata/finita o il campione è insufficiente. Una riga per partita (~200 byte).
 */
export function predictionRow(match, analysis, { now = Date.now(), ver = modelVersion() } = {}) {
  const s = analysis?.pick;
  const kickoff = Date.parse(match?.kickoff_at);
  if (!s || analysis.confidence === "insufficiente" || !Number.isFinite(kickoff) || kickoff <= now || (match.status && match.status !== "scheduled")) return null;
  return {
    game_id: match.game_id, league: match.league, kickoff_at: new Date(kickoff).toISOString(), sel_key: s.key,
    p: s.p, p_low: s.pLow, p_model: s.pModel ?? null, p_api: s.pApi ?? null, p_market: s.pMarket ?? null,
    odds: s.odds?.median > 1 ? s.odds.median : null, verdict: s.verdict, basis: analysis.basis ?? null,
    sample: analysis.sample ?? null, n: analysis.n ?? null, model_ver: ver, computed_at: new Date(now).toISOString(),
  };
}

/**
 * Righe per TUTTI i mercati della partita (una per selezione, ~14): probabilità di ogni fonte e quota reale, registrate prima del calcio d'inizio.
 * Stesse condizioni di `predictionRow`. Servono a misurare quale fonte e quale mercato predicono meglio (viste `prediction_leg_scorecard`).
 */
export function legRows(match, analysis, { now = Date.now(), ver = modelVersion() } = {}) {
  const kickoff = Date.parse(match?.kickoff_at);
  if (!analysis?.selections?.length || analysis.confidence === "insufficiente" || !Number.isFinite(kickoff) || kickoff <= now || (match.status && match.status !== "scheduled")) return [];
  const books = Number.isFinite(analysis.fusion?.books) ? analysis.fusion.books : null;
  return analysis.selections.map((s) => ({
    game_id: match.game_id, sel_key: s.key, league: match.league, kickoff_at: new Date(kickoff).toISOString(),
    p: s.p, p_low: s.pLow, p_model: s.pModel ?? null, p_api: s.pApi ?? null, p_market: s.pMarket ?? null,
    odds: s.odds?.median > 1 ? s.odds.median : null, n_books: books, verdict: s.verdict, basis: analysis.basis ?? null,
    sample: analysis.sample ?? null, model_ver: ver, computed_at: new Date(now).toISOString(),
  }));
}

/** Registra le righe (upsert per partita). Dopo il calcio d'inizio il database ignora ogni modifica (trigger): la previsione resta quella fatta prima. Non fa mai fallire la richiesta. */
export async function recordPredictions(env, rows) {
  if (!rows?.length) return 0;
  try { await supabaseUpsert(env, "bet_predictions", rows, "game_id"); return rows.length; } catch (e) { console.error("Stay Live predictions:", errorMessage(e)); return 0; }
}
/** Registra tutti i mercati (upsert per partita + selezione); come sopra, non fa mai fallire la richiesta. */
export async function recordLegs(env, rows) {
  if (!rows?.length) return 0;
  try { await supabaseUpsert(env, "prediction_legs", rows, "game_id,sel_key"); return rows.length; } catch (e) { console.error("Stay Live legs:", errorMessage(e)); return 0; }
}
/** Registra in coda alla risposta (waitUntil) se disponibile, altrimenti attende. `legs` = righe di tutti i mercati (facoltative). */
export const recordLater = (ctx, rows, legs = []) => {
  const p = Promise.all([recordPredictions(ctx.env, rows), recordLegs(ctx.env, legs)]).then(([a]) => a);
  if (ctx.waitUntil) { ctx.waitUntil(p); return Promise.resolve(0); }
  return p;
};
