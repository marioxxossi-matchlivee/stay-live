// Stay Live Tennis — Strategy Center: logica dell'interfaccia (pura, nessun DOM: si testa con node --test).
// Il motore gira nel browser sulla snapshot GIÀ scaricata (/api/tennis-board): nessuna richiesta in più, nessuna chiave.
import { buildStrategy, RANGES } from "../../functions/api/_tennis-strategy.js";
import { planBankroll, sanitizeBankroll, simulateSequence, DEFAULT_BANKROLL } from "../../functions/api/_tennis-bankroll.js";

export const BANKROLL_KEY = "sl-tennis-bankroll-v1";
export const TOURS = [["all", "Tutti"], ["atp", "ATP"], ["wta", "WTA"]];
export const DEFAULT_STRATEGY_VIEW = Object.freeze({ range: "h48", tour: "all" });

export const sanitizeView = (v) => ({
  range: RANGES.some(([k]) => k === v?.range) ? v.range : DEFAULT_STRATEGY_VIEW.range,
  tour: TOURS.some(([k]) => k === v?.tour) ? v.tour : DEFAULT_STRATEGY_VIEW.tour,
});

export function loadBankroll(storage = globalThis.localStorage) {
  try { return sanitizeBankroll(JSON.parse(storage?.getItem(BANKROLL_KEY) ?? "null")); } catch { return sanitizeBankroll(null); }
}
export function saveBankroll(settings, storage = globalThis.localStorage) {
  try { storage?.setItem(BANKROLL_KEY, JSON.stringify(sanitizeBankroll(settings))); } catch { /* spazio esaurito: le impostazioni restano in memoria */ }
}

/** Strategia + piano del capitale per la vista scelta. `history` è la snapshot (payload.history): il suo backtest dichiara cosa è validato. */
export function computeView(matches, view, settings, history, now = Date.now()) {
  const v = sanitizeView(view);
  const strategy = buildStrategy(matches, { range: v.range, tour: v.tour, now, calibration: history?.backtest ?? null });
  return { view: v, strategy, bankroll: planBankroll(strategy, settings) };
}

/** Esempio del video, calcolato (non scritto a mano): 1.000 € al 5% → 50 €; persa → 950 € → 47,50 €. */
export const videoExample = () => simulateSequence(1000, 0.05, [{ odds: 1.7, won: false }, { odds: 1.7, won: false }]);

/** Valori dei campi del capitale mostrati all'utente (percentuali intere/decimali) → impostazioni. */
export function settingsFromFields({ bankroll, stakePct, dailyPct, weeklyPct }) {
  const p = (x) => Number(String(x).replace(",", ".")) / 100;
  return sanitizeBankroll({ bankroll: Number(String(bankroll).replace(",", ".")), stakePct: p(stakePct), dailyLimitPct: p(dailyPct), weeklyLimitPct: p(weeklyPct) });
}
export { DEFAULT_BANKROLL };
