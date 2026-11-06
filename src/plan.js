import { MODEL, accumulatorPlan, applyCap, buildMultiples, planFor, totalsOf } from "../functions/api/model.js";

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
 * Piano di puntate per un'anteprima. oddsMap: quote inserite a mano per la giocata singola.
 * Priorità quota delle singole: inserita > mercato (quota reale di API-Football per la selezione consigliata) > stimata. Le multiple usano solo gambe con quota reale di API-Football e valore atteso prudente positivo (una per partita); senza, nessuna multipla.
 * Restituisce singole e multiple separate.
 */
export function computePlan(pv, bankroll, oddsMap = new Map()) {
  const afOdds = (i) => (i.pick?.odds?.median > 1 ? i.pick.odds.median : null);       // quota reale di API-Football (mediana) per la selezione consigliata
  const quoteOf = (i) => oddsMap.get(i.id) ?? afOdds(i);
  const sourceOf = (i) => (oddsMap.has(i.id) ? "inserita" : afOdds(i) ? "mercato" : "stimata");
  const bets = pv.items.filter(isBetItem);
  const singles = bets.map((i) => planFor(i.pick, quoteOf(i), bankroll, { source: oddsMap.has(i.id) || afOdds(i) ? sourceOf(i) : null }));
  const multis = buildMultiples(pv.items).map((m) => ({ m, plan: accumulatorPlan(m.legs.map((l) => ({ pLow: l.leg.pLow, p: l.leg.p, odds: l.leg.odds, real: l.leg.oddsSource === "mercato" })), bankroll) }));
  const raw = [...singles, ...multis.map((x) => x.plan)];
  const capped = applyCap(raw.map(eff), bankroll);
  const cs = capped.slice(0, singles.length), cm = capped.slice(singles.length);
  return {
    bankroll,
    rows: new Map(bets.map((i, k) => [i.id, { plan: singles[k], eff: cs[k], quote: afOdds(i) ? { median: i.pick.odds.median, best: i.pick.odds.best ?? null } : null }])),
    multiples: multis.map(({ m, plan }, k) => ({
      key: m.key, label: m.label, note: m.note, items: m.legs.map((l) => l.item),
      legs: m.legs.map((l) => ({ item: l.item, sel: l.leg, odds: l.leg.odds, source: l.leg.oddsSource })),
      plan, eff: cm[k], p: m.p, ev: m.ev, evLow: m.evLow, source: m.source,
      minOdds: Math.ceil((MODEL.edgeMargin / plan.pLow) * 100) / 100,
    })),
    totals: totalsOf(capped),
    totalsSingles: totalsOf(cs),
    totalsMultiples: totalsOf(cm),
    hypothetical: raw.some((x) => x && !x.play), // almeno una giocata dipende da una quota da trovare
  };
}
