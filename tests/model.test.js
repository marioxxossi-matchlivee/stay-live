import test from "node:test";
import assert from "node:assert/strict";
import {
  MODEL, analyzeMatch, buildMultiples, applyCap, accumulatorPlan, buildContext, estimateOdds, isPreferred, jointProbability, kellyGrowth, planFor, stakePlan, totalsOf, poissonPmf, probabilities, scoreMatrix, stressedProbabilities, verdictFor,
} from "../functions/api/model.js";
import { nameSimilarity } from "../functions/api/_names.js";
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

const legE = (key, p, pLow, odds, extra = {}) => ({ ...leg(key, p, pLow, odds), evLow: Math.round((pLow * odds - 1) * 1000) / 1000, ...extra });

test("multiple: solo quote reali, EV congiunto prudente positivo, una gamba per partita, quota nella fascia", () => {
  const items = [1, 2, 3, 4, 5].map((i) => mItem(i, [legE("over25", 0.70, 0.64, 1.75), legE("home", 0.66, 0.62, 1.72)]));
  const ms = buildMultiples(items);
  assert.ok(ms.length >= 2);
  const sigs = new Set();
  for (const m of ms) {
    const tier = MODEL.multiTiers.find((t) => t.key === m.key);
    assert.ok(m.odds >= tier.lo - 0.01 && m.odds <= tier.hi + 0.01, `${m.key}: quota ${m.odds} fuori fascia`);
    assert.ok(m.legs.length >= 2 && m.legs.length <= tier.maxLegs);
    assert.equal(new Set(m.legs.map((l) => l.item.id)).size, m.legs.length, "una sola gamba per partita");
    assert.ok(Math.abs(m.odds - m.legs.reduce((a, l) => a * l.leg.odds, 1)) < 0.01);
    const jp = jointProbability(m.legs.map((l) => l.leg));
    assert.ok(Math.abs(m.pLow - jp.pLow) < 1e-3 && m.pLow <= m.p);
    assert.ok(m.pLow * m.odds >= MODEL.edgeMargin - 1e-3 && m.evLow >= MODEL.edgeMargin - 1 - 1e-3, "EV congiunto prudente positivo");
    assert.equal(m.source, "mercato");
    const times = m.legs.map((l) => Date.parse(l.item.kickoffAt)); assert.deepEqual(times, [...times].sort((x, y) => x - y));
    const sig = m.legs.map((l) => `${l.item.id}:${l.leg.key}`).sort().join("|"); assert.ok(!sigs.has(sig), "multiple diverse"); sigs.add(sig);
  }
  assert.ok(!ms.some((m) => /sicura/i.test(m.key + m.label)), "nessuna multipla è mai \"sicura\"");
  assert.deepEqual(buildMultiples([mItem(1, [legE("over15", 0.8, 0.7, 1.5)])]), [], "una sola partita: nessuna multipla");
  assert.deepEqual(buildMultiples([mItem(1, []), mItem(2, [])]), []);
});

test("multiple: senza valore o senza quote reali non si genera nulla", () => {
  const noValue = [1, 2, 3].map((i) => mItem(i, [legE("over15", 0.7, 0.62, 1.5)]));             // 0,62 x 1,5 < 1: niente EV
  assert.deepEqual(buildMultiples(noValue), []);
  const est = [1, 2, 3].map((i) => mItem(i, [legE("over25", 0.7, 0.64, 1.75, { oddsSource: "stimata" })]));
  assert.deepEqual(buildMultiples(est), [], "una quota stimata non dimostra nulla");
  // singole gambe con EV ok ma congiunta prudente sotto 1,03: scartata
  const thin = [1, 2, 3, 4].map((i) => mItem(i, [legE("over25", 0.64, 0.58, 1.75)]));
  for (const m of buildMultiples(thin)) assert.ok(m.pLow * m.odds >= MODEL.edgeMargin);
});

test("multiple: al massimo 2 gambe dello stesso campionato", () => {
  const items = [1, 2, 3, 4].map((i) => ({ ...mItem(i, [legE("over25", 0.75, 0.7, 1.7)]), league: "seriea" }));
  for (const m of buildMultiples(items)) assert.ok(m.legs.length <= MODEL.maxLegsPerLeague);
  assert.ok(buildMultiples(items).length >= 1);
});

test("probabilità congiunta: indipendenza, incertezza in quadratura, Kelly", () => {
  const j = jointProbability([{ p: 0.7, pLow: 0.7 }, { p: 0.6, pLow: 0.6 }]);
  assert.ok(Math.abs(j.p - 0.42) < 1e-12 && Math.abs(j.pLow - 0.42) < 1e-12, "senza incertezza pLow = p");
  const k = jointProbability([{ p: 0.7, pLow: 0.6 }, { p: 0.7, pLow: 0.6 }]);
  const d = Math.log(0.7 / 0.6);
  assert.ok(Math.abs(k.pLow - 0.49 * Math.exp(-Math.sqrt(2) * d)) < 1e-12);
  assert.ok(k.pLow > 0.36 && k.pLow < 0.49, "meno severa del prodotto 0,6x0,6");
  assert.equal(kellyGrowth(0.5, 2), 0, "quota equa: nessuna crescita");
  assert.ok(kellyGrowth(0.6, 2) > 0 && kellyGrowth(0.4, 2) === 0);
  assert.ok(Math.abs(kellyGrowth(0.6, 2) - (0.6 * Math.log(1.2) + 0.4 * Math.log(0.8))) < 1e-12);
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

test("nessun mercato è preferito a priori; con quota reale decide il valore atteso", () => {
  assert.deepEqual(MODEL.preferredMarkets, []);
  const ctx = buildContext(league(12).finals);
  const m = { league: "seriea", kickoff_at: "2026-10-30T18:00:00Z", home_id: "a", away_id: "b", neutral_site: false };
  const odds = { under25: { median: 2.6, best: 2.7, book: "X", n: 5 }, over25: { median: 1.4, best: 1.45, book: "X", n: 5 } };
  const a = analyzeMatch(m, ctx, { n: 8, market: { odds } });
  const u = a.selections.find((s) => s.key === "under25");
  assert.ok(Math.abs(u.ev - (u.p * 2.6 - 1)) < 0.002 && Math.abs(u.evLow - (u.pLow * 2.6 - 1)) < 0.002);
  assert.equal(a.selections.find((s) => s.key === "dc1x").ev, null, "senza quota reale nessun EV");
  assert.ok(a.selections.every((s) => (s.verified ? s.odds && s.pLow * s.odds.median >= MODEL.edgeMargin : true)));
  const verified = a.selections.filter((s) => s.verified);
  if (verified.length) assert.ok(a.pick.verified && verified.every((s) => a.pick.evLow >= s.evLow - 1e-9), "tra i verificati vince l'EV prudente più alto");
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
  assert.ok(totalsOf(capped).stake <= 200 * 0.2 + 1e-9, "il tetto del 20% non si supera mai");
  const acc = accumulatorPlan([{ pLow: 0.65, p: 0.7 }, { pLow: 0.62, p: 0.66 }, { pLow: 0.6, p: 0.64 }], 100);
  const jp = jointProbability([{ pLow: 0.65, p: 0.7 }, { pLow: 0.62, p: 0.66 }, { pLow: 0.6, p: 0.64 }]);
  assert.ok(Math.abs(acc.pLow - jp.pLow) < 1e-9);
  assert.equal(accumulatorPlan([{ pLow: 0.6, p: 0.6 }], 100), null);
});

test("budget piccolo: niente puntata minima forzata sopra Kelly e sopra i tetti", () => {
  const tiny = stakePlan({ pLow: 0.65, odds: 2.4, bankroll: 5 });          // 5% di 5 € = 0,25 € < 0,50 € minimo
  assert.equal(tiny.play, false);
  assert.equal(tiny.belowMin, true);
  const many = Array.from({ length: 39 }, () => stakePlan({ pLow: 0.65, odds: 2.4, bankroll: 100 }));
  const capped = applyCap(many.map((x) => ({ ...x, odds: 2.4, pLow: 0.65 })), 100);
  assert.ok(totalsOf(capped).stake <= 20 + 1e-9, "39 BET con budget 100: totale <= 20");
  const small = applyCap(Array.from({ length: 39 }, () => ({ stake: 0.5, play: true, odds: 2, win: 0.5, ret: 1 })), 5);
  assert.ok(totalsOf(small).stake <= 1 + 1e-9, "budget 5: totale <= 1 (non 400%)");
});

test("abbinamento nomi squadra (assenze da fonti diverse)", () => {
  assert.ok(nameSimilarity("Internazionale", "Inter Milan") >= 1);
  assert.ok(nameSimilarity("Hellas Verona", "Verona") >= 1);
  assert.ok(nameSimilarity("Atlético Madrid", "Atletico Madrid") >= 1);
  assert.ok(nameSimilarity("Lazio", "Roma") < 0.5);
});

test("la quota reale di API-Football ha priorità sulla stima, quella inserita su entrambe", () => {
  const pick = { verdict: "BET", key: "over25", label: "Over 2,5", pLow: 0.62, p: 0.66, minOdds: 1.66, estOdds: 1.43 };
  const withOdds = { ...pick, odds: { median: 2.1, best: 2.2, book: "X" } };
  const mkPv = (pk) => ({ items: [{ id: "g1", pick: pk, confidence: "buona", home: "A", away: "B" }], summary: { accumulator: null } });
  const est = computePlan(mkPv(pick), 100);
  const mk = computePlan(mkPv(withOdds), 100);
  const user = computePlan(mkPv(withOdds), 100, new Map([["g1", 1.9]]));
  assert.equal(est.rows.get("g1").plan.source, "stimata");
  assert.equal(mk.rows.get("g1").plan.source, "mercato");
  assert.equal(mk.rows.get("g1").plan.odds, 2.1);
  assert.equal(user.rows.get("g1").plan.source, "inserita");
  assert.equal(user.rows.get("g1").plan.odds, 1.9);
});

test("piano: multiple dal cervello unico, singole separate, tetto di esposizione", () => {
  const mk = (i, pLow) => ({ id: `g${i}`, kickoffAt: `2026-10-31T1${i}:00:00Z`, home: "A", away: "B", confidence: "buona",
    pick: { verdict: "BET", key: "over25", label: "Over 2,5", pLow, p: pLow + 0.05, minOdds: 1.6, estOdds: 1.5 },
    legs: [legE("over15", pLow + 0.1, pLow, 1.75), legE("home", pLow + 0.05, pLow - 0.02, 1.9)] });
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
  assert.deepEqual(est.multiples, [], "con quote stimate non si compone nessuna multipla");
});

