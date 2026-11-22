// Affidabilità del modello attuale: 1X2, doppia chance e Multigol. Funzioni PURE sulle righe aggregate dalle viste monitor_* (nessun dato inventato).
// Le previsioni sono salvate PRIMA della partita (trigger di congelamento) e confrontate con il risultato dei 90 minuti.
import { wilson } from "../../src/efficiency.js";
import { stats } from "./_monitor.js";

export const MIN_SAMPLE = 300;
export const FAMILIES = [
  { id: "esito", label: "1X2", keys: ["home", "draw", "away"] },
  { id: "dc", label: "Doppia chance", keys: ["dc1x", "dcx2", "dc12"] },
  { id: "multigol", label: "Multigol", keys: ["mg13", "mg14", "mg24", "mg25", "mg36"] },
];
export const KEY_LABEL = { home: "1 · Vittoria casa", draw: "X · Pareggio", away: "2 · Vittoria trasferta", dc1x: "1X", dcx2: "X2", dc12: "12", mg13: "Multigol 1-3", mg14: "Multigol 1-4", mg24: "Multigol 2-4", mg25: "Multigol 2-5", mg36: "Multigol 3-6" };
export const SCOPE_KEYS = FAMILIES.flatMap((f) => f.keys);
const inScope = (r) => SCOPE_KEYS.includes(r.sel_key);
const famOf = (key) => FAMILIES.find((f) => f.keys.includes(key))?.id ?? null;
const sum = (rows, k) => rows.reduce((t, r) => t + (Number(r[k]) || 0), 0);
const groupBy = (rows, fn) => { const m = new Map(); for (const r of rows) { const k = fn(r); (m.get(k) ?? m.set(k, []).get(k)).push(r); } return m; };

/** Brier e log loss medi (per esito valutato) di un insieme di righe aggregate. */
export function scores(rows) {
  const n = sum(rows, "n");
  if (!n) return { n: 0, partite: 0, won: 0, rate: null, claimed: null, brier: null, logLoss: null };
  const won = sum(rows, "won");
  return { n, partite: Math.max(0, ...rows.map((r) => Number(r.partite) || 0)), won, rate: won / n, claimed: sum(rows, "sum_p") / n, brier: sum(rows, "sum_brier") / n, logLoss: sum(rows, "sum_logloss") / n };
}

function calibration(rows) {
  return [...groupBy(rows, (r) => r.bin)].map(([bin, rs]) => { const s = stats(rs); return { lo: (bin - 1) / 10, hi: bin / 10, n: s.n, won: s.won, claimed: s.claimed, rate: s.rate, ci: s.ci }; }).sort((a, b) => a.lo - b.lo);
}

/** Ultime 48 ore e andamento giornaliero: per famiglia di mercati. */
/** Partite distinte: le righe per mercato possono essere divise (fascia attesa o no), quindi si somma per mercato e si prende il massimo. */
const gamesOf = (rows) => Math.max(0, ...[...groupBy(rows, (r) => r.sel_key)].map(([, rs]) => sum(rs, "partite")));
function windowBlock(rows) {
  const w = rows.filter(inScope);
  const out = FAMILIES.map((f) => { const rs = w.filter((r) => f.keys.includes(r.sel_key)); return { id: f.id, label: f.label, ...scores(rs), partite: gamesOf(rs) }; });
  const pick = scores(w.filter((r) => r.is_pick));
  return { families: out, total: scores(w), partite: gamesOf(w), multigolAtteso: pick };
}
function dailyBlock(rows) {
  const d = rows.filter(inScope);
  return [...groupBy(d, (r) => String(r.day).slice(0, 10))].map(([day, rs]) => ({
    day, partite: Math.max(0, ...rs.map((r) => Number(r.partite) || 0)),
    families: Object.fromEntries(FAMILIES.map((f) => { const s = scores(rs.filter((r) => f.keys.includes(r.sel_key))); return [f.id, { n: s.n, brier: s.brier, logLoss: s.logLoss }]; })),
  })).sort((a, b) => b.day.localeCompare(a.day));
}

/**
 * legs/picks = monitor_legs_agg / monitor_picks_agg; status = monitor_status; win = monitor_window_agg (ultime 48 ore); daily = monitor_daily_agg;
 * mgPick = monitor_mg_pick_agg. Tutto limitato ai mercati del modello attuale.
 */
export function buildModelMonitor({ legs = [], picks = [], status = [], win = [], daily = [], mgPick = [], now = new Date() } = {}) {
  const L = legs.filter(inScope), P = picks.filter(inScope).filter((r) => ["home", "draw", "away", "dc1x", "dcx2", "dc12"].includes(r.sel_key));
  const st = { concluse: 0, in_attesa: 0, rinviate_o_annullate: 0, non_valutabili: 0, senza_risultato: 0 };
  for (const r of status) st[r.stato] = (st[r.stato] ?? 0) + (Number(r.n) || 0);
  const families = FAMILIES.map((f) => {
    const rs = L.filter((r) => f.keys.includes(r.sel_key));
    return { id: f.id, label: f.label, total: stats(rs), keys: f.keys.map((k) => ({ key: k, label: KEY_LABEL[k], ...stats(rs.filter((r) => r.sel_key === k)) })), calibration: calibration(rs) };
  });
  const pickBy = (v) => stats(P.filter((r) => r.verdict === v));
  const mgStats = stats(mgPick.map((r) => ({ ...r, sum_plow: 0 })));
  const dates = [...L, ...P].flatMap((r) => [r.first_kickoff, r.last_kickoff]).filter(Boolean).sort();
  const at = (x) => (x.n ? x : { ...x, ci: null });
  return {
    generatedAt: now.toISOString(), minSample: MIN_SAMPLE,
    registered: { partite: Object.values(st).reduce((t, v) => t + v, 0), ...st },
    since: dates[0]?.slice(0, 10) ?? null, until: dates.at(-1)?.slice(0, 10) ?? null,
    window48: windowBlock(win), daily: dailyBlock(daily),
    total: stats(L), families, calibration: calibration(L),
    multigolAtteso: { ...at(mgStats), byBand: ["mg13", "mg14", "mg24", "mg25", "mg36"].map((k) => ({ key: k, label: KEY_LABEL[k], ...stats(mgPick.filter((r) => r.sel_key === k)) })).filter((b) => b.n), reconstructed: sum(mgPick.filter((r) => r.ricostruita), "n") },
    picks: { bet: pickBy("BET"), evita: pickBy("EVITA") },
  };
}
export { famOf, wilson };
