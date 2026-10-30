import { MODEL, accumulatorPlan, applyCap, estimateOdds, planFor, totalsOf } from "../functions/api/model.js";

/** Una giocata è "da piano" solo se il verdetto è BET e il campione è sufficiente. */
export const isBetItem = (i) => Boolean(i.pick) && i.confidence !== "insufficiente" && i.pick.verdict === "BET";

// Piano effettivo: a quota con valore usa quella; altrimenti la puntata "se la quota è almeno la minima".
const eff = (x) => {
  if (!x) return null;
  if (x.play) return x;
  if (x.conditional?.play) return { ...x.conditional, odds: x.need, pLow: x.pLow, p: x.p, source: "minima" };
  return null;
};

/** Le multiple proposte, dalla più sicura alla più ambiziosa (una sola partita per gamba). */
export const MULTIPLE_TIERS = [
  { key: "sicura", label: "Multipla sicura", size: 2, note: "Le 2 giocate più probabili: quota bassa, più possibilità di entrare." },
  { key: "equilibrata", label: "Multipla equilibrata", size: 3, note: "Le 3 giocate più probabili." },
  { key: "ambiziosa", label: "Multipla ambiziosa", size: 5, note: "Fino a 5 giocate: quota più alta ma probabilità più bassa." },
];

export function multipleSets(bets) {
  const ranked = [...bets].sort((a, b) => b.pick.pLow - a.pick.pLow);
  const out = [];
  let prev = 0;
  for (const t of MULTIPLE_TIERS) {
    const size = Math.min(t.size, ranked.length);
    if (size < 2 || size <= prev) continue; // con poche giocate le multiple si ripeterebbero
    out.push({ ...t, size, items: ranked.slice(0, size).sort((a, b) => Date.parse(a.kickoffAt) - Date.parse(b.kickoffAt)) });
    prev = size;
  }
  return out;
}

/**
 * Piano di puntate per un'anteprima. oddsMap: quote inserite a mano; marketMap: quote di mercato.
 * Priorità quota: inserita > mercato > stimata. Restituisce singole e multiple separate.
 */
export function computePlan(pv, bankroll, oddsMap = new Map(), marketMap = new Map()) {
  const quoteOf = (id) => oddsMap.get(id) ?? marketMap.get(id)?.median ?? null;
  const sourceOf = (id) => (oddsMap.has(id) ? "inserita" : marketMap.has(id) ? "mercato" : "stimata");
  const bets = pv.items.filter(isBetItem);
  const singles = bets.map((i) => planFor(i.pick, quoteOf(i.id), bankroll, { source: marketMap.has(i.id) || oddsMap.has(i.id) ? sourceOf(i.id) : null }));
  const multis = multipleSets(bets).map((set) => {
    const legs = set.items.map((i) => ({ pLow: i.pick.pLow, p: i.pick.p, odds: quoteOf(i.id) }));
    return { set, plan: accumulatorPlan(legs, bankroll), legs: set.items.map((i, k) => ({ item: i, odds: legs[k].odds ?? estimateOdds(i.pick.p), source: sourceOf(i.id) })) };
  });
  const raw = [...singles, ...multis.map((m) => m.plan)];
  const capped = applyCap(raw.map(eff), bankroll);
  const cs = capped.slice(0, singles.length), cm = capped.slice(singles.length);
  return {
    bankroll,
    rows: new Map(bets.map((i, k) => [i.id, { plan: singles[k], eff: cs[k], quote: marketMap.get(i.id) ?? null }])),
    multiples: multis.map((m, k) => ({
      key: m.set.key, label: m.set.label, note: m.set.note, items: m.set.items, legs: m.legs, plan: m.plan, eff: cm[k],
      minOdds: Math.ceil((MODEL.edgeMargin / m.plan.pLow) * 100) / 100,
    })),
    totals: totalsOf(capped),
    totalsSingles: totalsOf(cs),
    totalsMultiples: totalsOf(cm),
    hypothetical: raw.some((x) => x && !x.play), // almeno una giocata dipende da una quota da trovare
  };
}
