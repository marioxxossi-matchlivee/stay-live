// Stay Live Tennis — gestione teorica del capitale. SOLO SIMULAZIONE: nessun piazzamento, nessuna integrazione con bookmaker.
// Regole (dal metodo del video, senza aggiunte): puntata = percentuale fissa del capitale CORRENTE; dopo una perdita il capitale scende e
// la puntata si ricalcola più bassa; non si insegue mai la perdita. Nessuna progressione, nessuna martingala, nessun Kelly.
import { romeDay } from "./_tennis-strategy.js";

export const STAKE_PROFILES = [
  { id: "prudente", pct: 0.01, label: "Prudente · 1%", hint: "Impostazione iniziale consigliata." },
  { id: "moderato", pct: 0.02, label: "Moderato · 2%", hint: "" },
  { id: "video", pct: 0.05, label: "Esempio del video · 5%", hint: "Percentuale aggressiva: disponibile, ma non consigliata.", aggressive: true },
];
export const DEFAULT_BANKROLL = Object.freeze({ bankroll: 1000, stakePct: 0.01, dailyLimitPct: 0.03, weeklyLimitPct: 0.08 });

const round2 = (x) => Math.round((x + Number.EPSILON) * 100) / 100;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const num = (v, d) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : d);

/** Impostazioni valide da qualsiasi input (anche corrotto): capitale 1–10.000.000 €, puntata 0,1–10%, limiti 0,5–50% del capitale. */
export function sanitizeBankroll(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  return {
    bankroll: round2(clamp(num(r.bankroll, DEFAULT_BANKROLL.bankroll), 1, 1e7)),
    stakePct: clamp(num(r.stakePct, DEFAULT_BANKROLL.stakePct), 0.001, 0.1),
    dailyLimitPct: clamp(num(r.dailyLimitPct, DEFAULT_BANKROLL.dailyLimitPct), 0.005, 0.5),
    weeklyLimitPct: clamp(num(r.weeklyLimitPct, DEFAULT_BANKROLL.weeklyLimitPct), 0.005, 0.5),
  };
}

/** Puntata teorica: percentuale del capitale ATTUALE (mai di quello iniziale, mai maggiorata per recuperare). */
export const stakeOf = (bankroll, pct) => round2(bankroll * pct);

/** Capitale dopo l'esito di una giocata: vinta +stake×(quota−1), persa −stake. */
export const applyOutcome = (bankroll, stake, odds, won) => round2(bankroll + (won ? stake * (odds - 1) : -stake));

/**
 * Simula una serie di esiti [{ odds, won }]: a ogni passo la puntata è la percentuale fissa del capitale corrente.
 * Esempio del video: 1.000 € al 5% → 50 €; persa → 950 €; nuova puntata 47,50 €.
 */
export function simulateSequence(start, pct, outcomes) {
  let bankroll = round2(start); const steps = [];
  for (const o of outcomes) {
    const stake = stakeOf(bankroll, pct), after = applyOutcome(bankroll, stake, o.odds, o.won);
    steps.push({ before: bankroll, stake, won: Boolean(o.won), after });
    bankroll = after;
  }
  return { steps, end: bankroll };
}

/** Lunedì (Europe/Rome) della settimana di un giorno AAAA-MM-GG: chiave della settimana per il limite settimanale. */
export const weekKey = (day) => { const d = new Date(`${day}T12:00:00Z`), back = (d.getUTCDay() + 6) % 7; return new Date(d.getTime() - back * 86400e3).toISOString().slice(0, 10); };

/**
 * Piano teorico per la strategia calcolata da buildStrategy. Una puntata per giocata (singola o doppia).
 * Se la strategia è la doppia, si gioca SOLO la doppia: le sue gambe non si giocano anche come singole (nessuna doppia esposizione).
 * I limiti giornaliero e settimanale (in % del capitale) si applicano alla giornata e alla settimana di inizio della giocata:
 * una giocata che li supererebbe NON entra nel piano e resta indicata come bloccata.
 */
export function planBankroll(strategy, settings) {
  const s = sanitizeBankroll(settings), stake = stakeOf(s.bankroll, s.stakePct), dailyMax = round2(s.bankroll * s.dailyLimitPct), weeklyMax = round2(s.bankroll * s.weeklyLimitPct);
  const warnings = [];
  if (s.stakePct >= 0.05) warnings.push("Puntata del 5% o più: profilo aggressivo, una serie di perdite riduce il capitale rapidamente.");
  if (stake > dailyMax) warnings.push("La puntata supera già il limite giornaliero: nessuna giocata può entrare nel piano.");
  const kind = strategy?.plan?.kind;
  let candidates = [];
  if (kind === "double" && strategy.double?.legs) {
    const [a, b] = strategy.double.legs;
    candidates = [{ type: "double", label: `Doppia: ${a.name} + ${b.name}`, odds: strategy.double.totalOdds, p: strategy.double.jointP, startsAt: [a.startsAt, b.startsAt].sort()[0], keys: [a.key, b.key] }];
  } else if (kind === "single" || kind === "singles") {
    candidates = (strategy.selected ?? []).map((x) => ({ type: "single", label: `${x.name} (${x.p1Name} – ${x.p2Name})`, odds: x.odds, p: x.pUsed, startsAt: x.startsAt, keys: [x.key] }));
  }
  const dayUsed = new Map(), weekUsed = new Map(); const slips = [];
  for (const c of candidates) {
    const day = romeDay(Date.parse(c.startsAt)), wk = weekKey(day);
    const d = dayUsed.get(day) ?? 0, w = weekUsed.get(wk) ?? 0;
    let blocked = null;
    if (round2(d + stake) > dailyMax) blocked = `Supererebbe il limite giornaliero (${dailyMax.toFixed(2).replace(".", ",")} €).`;
    else if (round2(w + stake) > weeklyMax) blocked = `Supererebbe il limite settimanale (${weeklyMax.toFixed(2).replace(".", ",")} €).`;
    if (!blocked) { dayUsed.set(day, round2(d + stake)); weekUsed.set(wk, round2(w + stake)); }
    slips.push({ ...c, day, stake: blocked ? 0 : stake, plannedStake: stake, potentialReturn: round2(stake * c.odds), profitIfWin: round2(stake * (c.odds - 1)), expected: round2(stake * (c.p * c.odds - 1)), blocked });
  }
  const live = slips.filter((x) => !x.blocked);
  const exposure = round2(live.reduce((t, x) => t + x.stake, 0));
  return {
    settings: s, stake, limits: { dailyMax, weeklyMax }, slips, warnings,
    totals: { exposure, exposurePct: round2((exposure / s.bankroll) * 100), maxLoss: exposure, potentialProfit: round2(live.reduce((t, x) => t + x.profitIfWin, 0)), expectedValue: round2(live.reduce((t, x) => t + x.expected, 0)), blocked: slips.length - live.length },
    note: "Simulazione: nessuna giocata viene piazzata. La puntata si ricalcola sul capitale corrente e non si aumenta mai per recuperare una perdita.",
  };
}
