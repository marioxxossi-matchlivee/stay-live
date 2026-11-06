import test from "node:test";
import assert from "node:assert/strict";
import {
  MODEL, analyzeMatch, buildMultiples, applyCap, accumulatorPlan, buildContext, estimateOdds, isPreferred, planFor, stakePlan, totalsOf, poissonPmf, probabilities, scoreMatrix, stressedProbabilities, verdictFor,
} from "../functions/api/model.js";
import { matchEvent, nameSimilarity, pricesFor, summarizePrices } from "../functions/api/_odds.js";
import { computePlan } from "../src/plan.js";
import { CONTINENTS, LEAGUES, syncDue, TTL } from "../functions/api/_lib.js";

const day = 86400e3;
function league(nRounds = 12) {
  const teams = ["a", "b", "c", "d"]; const finals = []; let t = Date.parse("2026-08-20T18:00:00Z");
  for (let r = 0; r < nRounds; r += 1) {
    for (const [h, a] of [["a", "b"], ["c", "d"]]) {
      const [x, y] = r % 2 ? [a, h] : [h, a];
      finals.push({ league: "seriea", kickoff_at: new Date(t).toISOString(), home_id: x, away_id: y, home_name: x, away_name: y,
        home_score: x === "a" ? 3 : 1, away_score: y === "a" ? 3 : 1, neutral_site: false });
      t += day;
    }
  }
  return { finals, teams };
}

test("la matrice dei punteggi somma a 1 e il Poisson è coerente", () => {
  const m = scoreMatrix(1.6, 1.1);
  assert.ok(Math.abs(m.flat().reduce((s, v) => s + v, 0) - 1) < 1e-9);
  assert.ok(Math.abs(poissonPmf(2).slice(0, 3).reduce((s, v) => s + v, 0) - 0.6767) < 1e-3);
});

test("i mercati sono coerenti tra loro", () => {
  const p = probabilities(1.7, 1.2);
  assert.ok(Math.abs(p.home + p.draw + p.away - 1) < 1e-9);
  assert.ok(Math.abs(p.over25 + p.under25 - 1) < 1e-9);
  assert.ok(p.over15 > p.over25 && p.over25 > p.over35);
  assert.ok(Math.abs(p.dc1x - (p.home + p.draw)) < 1e-12);
  const sym = probabilities(1.3, 1.3);
  assert.ok(Math.abs(sym.home - sym.away) < 1e-12);
});

test("la probabilità prudente non supera mai quella base", () => {
  const base = probabilities(1.8, 1.0);
  const low = stressedProbabilities(1.8, 1.0, 0.15);
  for (const k of Object.keys(base)) assert.ok(low[k] <= base[k] + 1e-12, k);
});

test("la squadra forte ha lambda più alto e vince più spesso", () => {
  const { finals } = league();
  const ctx = buildContext(finals);
  const a = analyzeMatch({ league: "seriea", kickoff_at: "2026-10-30T18:00:00Z", home_id: "a", away_id: "b", neutral_site: false }, ctx, { n: 8 });
  assert.ok(a.lambda.home > a.lambda.away);
  assert.ok(a.selections.find((s) => s.key === "home").p > a.selections.find((s) => s.key === "away").p);
  assert.equal(a.sample, 8);
  assert.equal(a.confidence, "buona");
});

test("campione piccolo: mai BET", () => {
  const ctx = buildContext(league(1).finals);
  const a = analyzeMatch({ league: "seriea", kickoff_at: "2026-10-30T18:00:00Z", home_id: "a", away_id: "b" }, ctx, { n: 8 });
  assert.ok(a.selections.every((s) => s.verdict === "EVITA"));
});

test("con quota inserita decide il valore atteso prudente", () => {
  const sel = { pLow: 0.6, minOdds: 1.72 };
  assert.equal(verdictFor(sel, 8, 1.8).verdict, "BET");
  assert.equal(verdictFor(sel, 8, 1.6).verdict, "EVITA");
  assert.equal(verdictFor({ pLow: 0.3, minOdds: 3.4 }, 8, 5).verdict, "EVITA");
  assert.equal(verdictFor({ pLow: 0.7, minOdds: 1.47, edge: 0.15 }, 8).verdict, "BET");
  assert.equal(verdictFor({ pLow: 0.7, minOdds: 1.47, edge: 0.03 }, 8).verdict, "EVITA");
  assert.equal(verdictFor({ pLow: 0.55, minOdds: 1.9, edge: 0.2 }, 8).verdict, "EVITA");
});

const leg = (key, p, pLow, odds, src = "mercato") => ({ key, label: key, p, pLow, odds, oddsSource: src, spread: 0, agree: "conferma" });
const mItem = (i, legs) => ({ id: `g${i}`, kickoffAt: `2026-11-05T1${i}:00:00Z`, home: "A", away: "B", legs });

test("multiple: una gamba per partita, quota nella fascia, probabilità prudente congiunta massima", () => {
  const items = [mItem(1, [leg("over15", 0.8, 0.7, 1.5)]), mItem(2, [leg("home", 0.8, 0.7, 1.5), leg("dc1x", 0.9, 0.8, 1.2)]), mItem(3, [leg("over15", 0.8, 0.7, 1.5)]), mItem(4, [leg("away", 0.6, 0.5, 2.0)]), mItem(5, [leg("over25", 0.6, 0.5, 2.0)])];
  const ms = buildMultiples(items);
  assert.ok(ms.length >= 2);
  const sigs = new Set();
  for (const m of ms) {
    const tier = MODEL.multiTiers.find((t) => t.key === m.key);
    assert.ok(m.odds >= tier.lo - 0.01 && m.odds <= tier.hi + 0.01, `${m.key}: quota ${m.odds} fuori fascia`);
    assert.ok(m.legs.length >= 2 && m.legs.length <= tier.maxLegs);
    assert.equal(new Set(m.legs.map((l) => l.item.id)).size, m.legs.length, "una sola gamba per partita");
    assert.ok(Math.abs(m.odds - m.legs.reduce((a, l) => a * l.leg.odds, 1)) < 0.01);
    assert.ok(Math.abs(m.pLow - m.legs.reduce((a, l) => a * l.leg.pLow, 1)) < 1e-3);
    const times = m.legs.map((l) => Date.parse(l.item.kickoffAt)); assert.deepEqual(times, [...times].sort((x, y) => x - y));
    const sig = m.legs.map((l) => `${l.item.id}:${l.leg.key}`).sort().join("|"); assert.ok(!sigs.has(sig), "multiple diverse"); sigs.add(sig);
  }
  const sicura = ms.find((m) => m.key === "sicura");
  assert.ok(sicura.pLow >= 0.5, "la sicura sceglie le gambe più solide (0,7 x 0,7 = 0,49 o meglio)");
  assert.deepEqual(buildMultiples([mItem(1, [leg("over15", 0.8, 0.7, 1.5)])]), [], "una sola partita: nessuna multipla");
  assert.deepEqual(buildMultiples([mItem(1, []), mItem(2, [])]), []);
  assert.equal(buildMultiples([mItem(1, [leg("a", 0.8, 0.7, 1.5)]), mItem(2, [leg("b", 0.8, 0.7, 1.5)])])[0].source, "mercato");
  assert.equal(buildMultiples([mItem(1, [leg("a", 0.8, 0.7, 1.5, "stimata")]), mItem(2, [leg("b", 0.8, 0.7, 1.5)])])[0].source, "mista");
});

test("politica di sync: fresco = niente chiamate", () => {
  const now = Date.now();
  assert.equal(syncDue(null, false, now), true);
  assert.equal(syncDue({ synced_at: new Date(now - 60e3).toISOString() }, true, now), false);
  assert.equal(syncDue({ synced_at: new Date(now - TTL.active - 1e3).toISOString() }, true, now), true);
  assert.equal(syncDue({ synced_at: new Date(now - TTL.active - 1e3).toISOString() }, false, now), false);
  assert.equal(syncDue({ synced_at: null, attempted_at: new Date(now - 1e3).toISOString(), last_error: "x" }, false, now), false);
  assert.ok(MODEL.betThreshold > 0.5);
});

test("frequenze storiche: esiti coerenti", () => {
  const ctx = buildContext(league().finals);
  const r = ctx.baseRates("seriea");
  assert.ok(Math.abs(r.home + r.draw + r.away - 1) < 1e-9);
  assert.ok(Math.abs(r.over25 + r.under25 - 1) < 1e-9);
  assert.equal(ctx.baseRates("sconosciuto") !== null, true);
});

test("a parità di BET, Over/Under passano davanti agli altri mercati", () => {
  const ctx = buildContext(league(12).finals);
  const a = analyzeMatch({ league: "seriea", kickoff_at: "2026-10-30T18:00:00Z", home_id: "a", away_id: "b", neutral_site: false }, ctx, { n: 8 });
  const bets = a.selections.filter((s) => s.verdict === "BET");
  if (bets.some((s) => isPreferred(s)) && bets.some((s) => !isPreferred(s))) assert.ok(isPreferred(a.pick));
  assert.equal(a.pick.verdict === "BET" || bets.length === 0, true);
});

test("i campionati hanno continente e nazione per il menu", () => {
  for (const l of LEAGUES) { assert.ok(l.continent && l.country && l.nation, l.id); assert.ok(CONTINENTS.some((c) => c.id === l.continent), l.id); }
});

test("quota stimata: sotto la quota equa per il margine del bookmaker", () => {
  assert.equal(estimateOdds(0.5), 1.89);
  assert.ok(estimateOdds(0.7) < 1 / 0.7);
});

test("senza valore non si punta; con quota alta si punta con tetto", () => {
  const none = planFor({ pLow: 0.62, p: 0.66 }, null, 100);
  assert.equal(none.play, false);          // quota stimata < quota minima
  assert.ok(none.conditional.play && none.need >= 1.66 && none.conditional.stake > 0);
  const real = planFor({ pLow: 0.62, p: 0.66 }, 2.2, 100);
  assert.equal(real.play, true);
  assert.ok(real.stake <= 5 && real.stake >= 0.5);   // tetto 5% del budget
  assert.ok(Math.abs(real.win - real.stake * 1.2) < 0.01);
});

test("tetto di esposizione totale e multipla", () => {
  const plans = Array.from({ length: 8 }, () => stakePlan({ pLow: 0.65, odds: 2.4, bankroll: 200 }));
  const capped = applyCap(plans.map((x) => ({ ...x, odds: 2.4, pLow: 0.65 })), 200);
  assert.ok(totalsOf(capped).stake <= 200 * 0.2 + 0.5 * plans.length);
  const acc = accumulatorPlan([{ pLow: 0.65, p: 0.7 }, { pLow: 0.62, p: 0.66 }, { pLow: 0.6, p: 0.64 }], 100);
  assert.ok(Math.abs(acc.pLow - 0.65 * 0.62 * 0.6) < 1e-9);
  assert.equal(accumulatorPlan([{ pLow: 0.6, p: 0.6 }], 100), null);
});

test("abbinamento squadre tra API Ninjas e The Odds API", () => {
  assert.ok(nameSimilarity("Internazionale", "Inter Milan") >= 1);
  assert.ok(nameSimilarity("Hellas Verona", "Verona") >= 1);
  assert.ok(nameSimilarity("Atlético Madrid", "Atletico Madrid") >= 1);
  assert.ok(nameSimilarity("Lazio", "Roma") < 0.5);
  const events = [
    { id: "e1", commence_time: "2026-10-31T18:45:00Z", home_team: "Inter Milan", away_team: "Fiorentina" },
    { id: "e2", commence_time: "2026-10-31T18:45:00Z", home_team: "Napoli", away_team: "Lazio" },
    { id: "e3", commence_time: "2026-11-01T14:00:00Z", home_team: "AC Milan", away_team: "Torino" },
  ];
  assert.equal(matchEvent({ kickoff_at: "2026-10-31T18:45:00Z", home_name: "Internazionale", away_name: "Fiorentina" }, events).id, "e1");
  assert.equal(matchEvent({ kickoff_at: "2026-10-31T18:45:00Z", home_name: "Napoli", away_name: "SS Lazio" }, events).id, "e2");
  assert.equal(matchEvent({ kickoff_at: "2026-10-31T18:45:00Z", home_name: "Juventus", away_name: "Genoa" }, events), null);
});

test("lettura delle quote per mercato e mediana", () => {
  const ev = { home_team: "Inter Milan", away_team: "Fiorentina", bookmakers: [
    { key: "a", title: "Alfa", markets: [{ key: "h2h", outcomes: [{ name: "Inter Milan", price: 1.5 }, { name: "Draw", price: 4.2 }, { name: "Fiorentina", price: 6 }] },
      { key: "totals", outcomes: [{ name: "Over", point: 2.5, price: 1.8 }, { name: "Under", point: 2.5, price: 2 }] }] },
    { key: "b", title: "Beta", markets: [{ key: "h2h", outcomes: [{ name: "Inter Milan", price: 1.55 }, { name: "Draw", price: 4 }, { name: "Fiorentina", price: 5.5 }] },
      { key: "alternate_totals", outcomes: [{ name: "Over", point: 1.5, price: 1.3 }, { name: "Over", point: 2.5, price: 1.9 }] },
      { key: "btts", outcomes: [{ name: "Yes", price: 1.85 }, { name: "No", price: 1.95 }] },
      { key: "double_chance", outcomes: [{ name: "Inter Milan or Draw", price: 1.15 }, { name: "Fiorentina or Draw", price: 2.6 }] }] },
    { key: "c", title: "Gamma", markets: [{ key: "h2h", outcomes: [{ name: "Inter Milan", price: 1.6 }, { name: "Draw", price: 4 }, { name: "Fiorentina", price: 5 }] }] },
  ] };
  const home = summarizePrices(pricesFor("home", ev));
  assert.deepEqual([home.median, home.best, home.bestBookmaker, home.books], [1.55, 1.6, "Gamma", 3]);
  assert.equal(summarizePrices(pricesFor("over25", ev)).books, 2);
  assert.equal(pricesFor("over15", ev)[0].price, 1.3);
  assert.equal(pricesFor("btts", ev)[0].price, 1.85);
  assert.equal(pricesFor("dc1x", ev)[0].price, 1.15);
  assert.equal(pricesFor("dcx2", ev)[0].price, 2.6);
  assert.equal(pricesFor("under35", ev).length, 0);
});

test("la quota di mercato ha priorità sulla stima, quella inserita su entrambe", () => {
  const pick = { verdict: "BET", label: "Over 2,5", pLow: 0.62, p: 0.66, minOdds: 1.66, estOdds: 1.43 };
  const pv = { items: [{ id: "g1", pick, confidence: "buona", home: "A", away: "B" }], summary: { accumulator: null } };
  const est = computePlan(pv, 100);
  const mk = computePlan(pv, 100, new Map(), new Map([["g1", { median: 2.1, best: 2.2, bestBookmaker: "X", books: 5 }]]));
  const user = computePlan(pv, 100, new Map([["g1", 1.9]]), new Map([["g1", { median: 2.1 }]]));
  assert.equal(est.rows.get("g1").plan.source, "stimata");
  assert.equal(mk.rows.get("g1").plan.source, "mercato");
  assert.equal(mk.rows.get("g1").plan.odds, 2.1);
  assert.equal(user.rows.get("g1").plan.source, "inserita");
  assert.equal(user.rows.get("g1").plan.odds, 1.9);
});

test("piano: multiple dal cervello unico, singole separate, tetto di esposizione", () => {
  const mk = (i, pLow) => ({ id: `g${i}`, kickoffAt: `2026-10-31T1${i}:00:00Z`, home: "A", away: "B", confidence: "buona",
    pick: { verdict: "BET", key: "over25", label: "Over 2,5", pLow, p: pLow + 0.05, minOdds: 1.6, estOdds: 1.5 },
    legs: [leg("over15", pLow + 0.1, pLow, 1.45), leg("home", pLow + 0.05, pLow - 0.05, 1.75)] });
  const items = Array.from({ length: 5 }, (_, i) => mk(i, 0.72 - i * 0.02));
  const plan = computePlan({ items, summary: {} }, 100, new Map(items.map((i) => [i.id, 1.9])));
  assert.ok(plan.multiples.length >= 1);
  assert.equal(plan.rows.size, 5);
  const m0 = plan.multiples[0];
  assert.ok(Math.abs(m0.plan.odds - m0.legs.reduce((a, l) => a * l.odds, 1)) < 0.02);   // quota combinata = prodotto delle gambe
  assert.ok(m0.legs.every((l) => l.sel && l.sel.label));
  assert.equal(m0.plan.source, "reale", "tutte le gambe hanno quota di mercato");
  assert.ok(plan.totals.stake <= 100 * 0.2 + 0.5 * 7);                                    // tetto di esposizione
  assert.ok(plan.totalsMultiples.count + plan.totalsSingles.count === plan.totals.count);
  const est = computePlan({ items: items.map((i) => ({ ...i, legs: i.legs.map((l) => ({ ...l, oddsSource: "stimata" })) })), summary: {} }, 100);
  assert.equal(est.multiples[0].plan.source, "stimata", "una quota stimata non è mai etichettata reale");
});

test("la quota di mercato vale solo per la selezione per cui è stata prelevata", () => {
  const pick = { verdict: "BET", key: "over25", label: "Over 2,5", pLow: 0.62, p: 0.66, minOdds: 1.66, estOdds: 1.43 };
  const pv = { items: [{ id: "g1", pick, confidence: "buona", home: "A", away: "B", legs: [] }], summary: {} };
  const wrong = computePlan(pv, 100, new Map(), new Map([["g1", { selection: "home", median: 3.1 }]]));
  assert.equal(wrong.rows.get("g1").plan.source, "stimata");
  const right = computePlan(pv, 100, new Map(), new Map([["g1", { selection: "over25", median: 2.1 }]]));
  assert.equal(right.rows.get("g1").plan.odds, 2.1);
});
