// Monitoraggio dell'affidabilità: funzioni PURE che trasformano le righe aggregate dalle viste monitor_* in numeri leggibili.
// Ogni percentuale arriva con numerosità e intervallo di Wilson; sotto MIN_SAMPLE nessuna conclusione è dichiarata.
import { LABELS, marketOf, wilson } from "../../src/efficiency.js";

export const MIN_SAMPLE = 300;          // come MIN_BETS_FOR_CLAIM del backtest
export const SMALL_SAMPLE = 30;         // sotto questa soglia le percentuali dicono poco

const sum = (rows, k) => rows.reduce((t, r) => t + (Number(r[k]) || 0), 0);

/** Statistiche di un insieme di righe aggregate (stessa forma delle viste monitor_*_agg). */
export function stats(rows) {
  const n = sum(rows, "n");
  if (!n) return { n: 0, won: 0, rate: null, ci: null, claimed: null, floor: null, gap: null, brier: null, logLoss: null, roi: null, roiN: 0 };
  const won = sum(rows, "won"), rate = won / n, claimed = sum(rows, "sum_p") / n, nOdds = sum(rows, "n_odds");
  return {
    n, won, rate, ci: wilson(won, n), claimed, floor: sum(rows, "sum_plow") / n, gap: rate - claimed,
    brier: sum(rows, "sum_brier") / n, logLoss: sum(rows, "sum_logloss") / n,
    roi: nOdds ? sum(rows, "sum_pnl") / nOdds : null, roiN: nOdds,
  };
}

const groupBy = (rows, fn) => { const m = new Map(); for (const r of rows) { const k = fn(r); (m.get(k) ?? m.set(k, []).get(k)).push(r); } return m; };

/** Curva di taratura: probabilità dichiarata contro frequenza reale per fasce di 10 punti. */
export function calibration(rows) {
  return [...groupBy(rows, (r) => r.bin)].map(([bin, rs]) => {
    const s = stats(rs);
    return { lo: (bin - 1) / 10, hi: bin / 10, n: s.n, won: s.won, claimed: s.claimed, rate: s.rate, ci: s.ci };
  }).sort((a, b) => a.lo - b.lo);
}

const overlap = (a, b) => Boolean(a?.ci && b?.ci && a.ci.lo <= b.ci.hi && b.ci.lo <= a.ci.hi);

/** Giudizio in italiano su BET (onestà delle percentuali) con prudenza sui campioni piccoli. */
export function judgeBet(s) {
  if (!s.n) return "Nessun BET concluso: niente da misurare.";
  if (s.n < SMALL_SAMPLE) return `Solo ${s.n} BET conclusi: le percentuali dicono poco, guarda l'intervallo.`;
  const inside = s.claimed >= s.ci.lo && s.claimed <= s.ci.hi;
  if (s.n < MIN_SAMPLE) return inside ? `Coerente con quanto dichiarato, ma con ${s.n} BET non è ancora dimostrato (servono ${MIN_SAMPLE}).` : `Scostamento dal dichiarato visibile, ma con ${s.n} BET non è ancora dimostrato (servono ${MIN_SAMPLE}).`;
  return s.gap < -0.05 ? "Il modello promette più di quanto mantiene: le probabilità vanno riviste." : s.gap > 0.05 ? "Il modello è prudente: esce più di quanto dichiara." : "Le percentuali dichiarate sono oneste.";
}

/** Giudizio su EVITA rispetto ai BET: serve a capire se la regola separa davvero le scelte buone da quelle da evitare. */
export function judgeEvita(bet, evita) {
  if (!evita.n) return "Nessun EVITA concluso.";
  if (!bet.n) return "Senza BET conclusi non c'è un confronto.";
  const diff = bet.rate - evita.rate;
  const base = `I BET escono il ${(bet.rate * 100).toFixed(0)}%, gli EVITA il ${(evita.rate * 100).toFixed(0)}%.`;
  if (Math.min(bet.n, evita.n) < SMALL_SAMPLE) return `${base} Campione troppo piccolo per concludere.`;
  if (overlap(bet, evita)) return `${base} Le due fasce di incertezza si sovrappongono: la differenza non è ancora distinguibile dal caso${bet.n < MIN_SAMPLE ? ` (servono ${MIN_SAMPLE} BET)` : ""}.`;
  return diff > 0 ? `${base} La differenza è oltre l'incertezza: la regola separa le scelte migliori.` : `${base} Gli EVITA escono più dei BET: la regola sembra troppo severa o sbagliata.`;
}

/**
 * legs/picks = righe di monitor_legs_agg / monitor_picks_agg; status = righe di monitor_status; backtest = payload pubblicato dal workflow (o null).
 * `ver` = versione attuale del modello. Di default si usano TUTTE le versioni (il conteggio non si azzera a ogni modifica del modello);
 * il dettaglio per versione resta visibile.
 */
export function buildMonitor({ legs = [], picks = [], status = [], backtest = null, ver = null, now = new Date() } = {}) {
  const pickBy = (v) => stats(picks.filter((r) => r.verdict === v));
  const bet = pickBy("BET"), evita = pickBy("EVITA");
  const versions = [...new Set([...picks, ...legs].map((r) => r.model_ver))].sort();
  const byVersion = versions.map((v) => ({
    ver: v, current: v === ver,
    bet: stats(picks.filter((r) => r.model_ver === v && r.verdict === "BET")),
    evita: stats(picks.filter((r) => r.model_ver === v && r.verdict === "EVITA")),
    legs: stats(legs.filter((r) => r.model_ver === v)),
  }));
  const st = { concluse: 0, in_attesa: 0, rinviate_o_annullate: 0, non_valutabili: 0, senza_risultato: 0 };
  for (const r of status) st[r.stato] = (st[r.stato] ?? 0) + (Number(r.n) || 0);
  const registered = Object.values(st).reduce((t, v) => t + v, 0);
  const allLegs = stats(legs);
  const byMarket = [...groupBy(legs, (r) => r.sel_key)].map(([k, rs]) => ({ key: k, label: LABELS[k] ?? k, market: marketOf(k), ...stats(rs) })).sort((a, b) => b.n - a.n);
  const dates = [...picks, ...legs].flatMap((r) => [r.first_kickoff, r.last_kickoff]).filter(Boolean).sort();
  return {
    generatedAt: now.toISOString(), currentVersion: ver, minSample: MIN_SAMPLE,
    registered: { partite: registered, ...st },
    since: dates[0]?.slice(0, 10) ?? null, until: dates.at(-1)?.slice(0, 10) ?? null,
    picks: { bet, evita, judgeBet: judgeBet(bet), judgeEvita: judgeEvita(bet, evita), betVsEvita: bet.n && evita.n ? bet.rate - evita.rate : null },
    legs: { total: allLegs, bet: stats(legs.filter((r) => r.verdict === "BET")), evita: stats(legs.filter((r) => r.verdict === "EVITA")), calibration: calibration(legs), byMarket },
    byVersion, backtest,
  };
}
