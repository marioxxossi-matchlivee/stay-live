import { accumulatorPlan, applyCap, planFor, totalsOf } from "../functions/api/model.js";

/** Una giocata è "da piano" solo se il verdetto è BET e il campione è sufficiente. */
export const isBetItem = (i) => Boolean(i.pick) && i.confidence !== "insufficiente" && i.pick.verdict === "BET";

// Piano effettivo: a quota con valore usa quella; altrimenti la puntata "se la quota è almeno la minima".
const eff = (x) => {
  if (!x) return null;
  if (x.play) return x;
  if (x.conditional?.play) return { ...x.conditional, odds: x.need, pLow: x.pLow, p: x.p, source: "minima" };
  return null;
};

/**
 * Piano di puntate per un'anteprima. oddsMap: id partita -> quota reale inserita (opzionale).
 * Restituisce per ogni BET { plan, eff }: `plan` è il calcolo alla quota usata (inserita o stimata),
 * `eff` la puntata consigliata dopo il tetto di esposizione totale.
 */
export function computePlan(pv, bankroll, oddsMap = new Map(), marketMap = new Map()) {
  // Priorità: quota inserita a mano > quota di mercato (The Odds API, mediana) > quota stimata.
  const quoteOf = (id) => oddsMap.get(id) ?? marketMap.get(id)?.median ?? null;
  const sourceOf = (id) => (oddsMap.has(id) ? "inserita" : marketMap.has(id) ? "mercato" : null);
  const bets = pv.items.filter(isBetItem);
  const singles = bets.map((i) => planFor(i.pick, quoteOf(i.id), bankroll, { source: sourceOf(i.id) }));
  const byId = new Map(bets.map((i) => [i.id, i]));
  const legs = (pv.summary.accumulator?.ids ?? []).map((id) => byId.get(id)).filter(Boolean)
    .map((i) => ({ pLow: i.pick.pLow, p: i.pick.p, odds: quoteOf(i.id) }));
  const acc = legs.length >= 2 ? accumulatorPlan(legs, bankroll) : null;
  const raw = [...singles, acc];
  const capped = applyCap(raw.map(eff), bankroll);
  return {
    bankroll,
    rows: new Map(bets.map((i, k) => [i.id, { plan: singles[k], eff: capped[k], quote: marketMap.get(i.id) ?? null }])),
    acc: acc ? { plan: acc, eff: capped[singles.length], legs: legs.length } : null,
    totals: totalsOf(capped),
    hypothetical: raw.some((x) => x && !x.play), // almeno una giocata dipende da una quota da trovare
  };
}
