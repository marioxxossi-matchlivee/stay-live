/**
 * Regole personali dell'utente applicate nel browser alle scelte già calcolate (l'elenco pronto si ricalcola solo ogni 4 ore).
 * Oggi: quota minima per giocare (Impostazioni). Il verdetto si ricalcola con la stessa funzione del server (verdictFor).
 */
import { MODEL, verdictFor } from "../functions/api/model.js";

export const MIN_ODDS_DEFAULT = MODEL.minPlayOdds;
export const MIN_ODDS_RANGE = { min: 1, max: 3, step: 0.05 };
export const clampMinOdds = (v) => { const x = Number(String(v).replace(",", ".")); return Number.isFinite(x) ? Math.min(MIN_ODDS_RANGE.max, Math.max(MIN_ODDS_RANGE.min, Math.round(x * 100) / 100)) : MIN_ODDS_DEFAULT; };

const memo = new WeakMap();
/** Scelta di una partita con la quota minima dell'utente: verdetto, motivo e quota minima ricalcolati. */
export function adjustPick(p, minOdds = MIN_ODDS_DEFAULT) {
  if (!p || p.confidence === "insufficiente" || minOdds === MODEL.minPlayOdds) return p;
  const hit = memo.get(p); if (hit?.minOdds === minOdds) return hit.out;
  const saved = MODEL.minPlayOdds; MODEL.minPlayOdds = minOdds;
  let out;
  try {
    const sel = { ...p, minOdds: Math.round(Math.max(MODEL.edgeMargin / p.pLow, minOdds) * 100) / 100 };
    out = { ...p, minOdds: sel.minOdds, ...verdictFor(sel, p.sample ?? 99) };
  } finally { MODEL.minPlayOdds = saved; }
  memo.set(p, { minOdds, out });
  return out;
}
