import test from "node:test";
import assert from "node:assert/strict";
import { buildStrategy, evaluateMatch, compareStructures, rangeTest, weekendDays, calibrationCheck, calibrationFrom, wilson, STRATEGY } from "../functions/api/_tennis-strategy.js";
import { planBankroll, stakeOf, applyOutcome, simulateSequence, sanitizeBankroll, weekKey, DEFAULT_BANKROLL, STAKE_PROFILES } from "../functions/api/_tennis-bankroll.js";
import { noVig } from "../functions/api/_tennis-bet.js";

const NOW = Date.parse("2026-11-17T10:00:00Z"); // martedì
const H = 3600e3;
const bt = { published: 800, summary: { n: 800, calibration: [{ from: 0.55, to: 0.6, n: 200, meanP: 0.575, hitRate: 0.58 }, { from: 0.6, to: 0.65, n: 200, meanP: 0.625, hitRate: 0.62 }, { from: 0.65, to: 0.7, n: 200, meanP: 0.675, hitRate: 0.67 }, { from: 0.7, to: 0.8, n: 200, meanP: 0.74, hitRate: 0.74 }] },
  byTour: { atp: { n: 400, calibration: [] }, wta: { n: 400, calibration: [] } }, bySurface: { hard: { n: 500, calibration: [] }, clay: { n: 200, calibration: [] }, grass: { n: 100, calibration: [] } } };
const mk = (o = {}) => ({
  key: o.key ?? "m1", tour: o.tour ?? "atp", tournament: o.tournament ?? "Torneo A", category: o.category ?? "tour", court: "hard", surface: "Hard", status: o.status ?? "scheduled",
  startsAt: o.startsAt ?? new Date(NOW + 5 * H).toISOString(), p1: { id: o.id1 ?? "a" + (o.key ?? "m1"), name: o.n1 ?? "Rossi " + (o.key ?? "m1") }, p2: { id: o.id2 ?? "b" + (o.key ?? "m1"), name: o.n2 ?? "Bianchi " + (o.key ?? "m1") },
  prediction: o.prediction === null ? null : { published: true, pick: 1, p1: 0.7, p2: 0.3, reliability: "alta", reasons: ["Elo"], missing: [], components: { eloDiff: 120, formAdj: 10, rankAdj: 0, h2hAdj: 0, fatigueAdj: 0, n1: 50, n2: 50, nSurf1: 20, nSurf2: 20 }, modelVersion: "tennis-v2", ...(o.prediction ?? {}) },
  odds: o.odds === null ? null : { p1: 1.7, p2: 2.2, source: "Pinnacle", at: new Date(NOW - 20 * 60e3).toISOString(), sources: [{ book: "Pinnacle", p1: 1.7, p2: 2.2 }], ...(o.odds ?? {}) },
});

test("probabilità implicita, senza margine, quota equa ed EV (esempi del video)", () => {
  assert.equal((1 / 1.3 * 100).toFixed(1), "76.9"); assert.equal((1 / 1.7 * 100).toFixed(1), "58.8");
  const nv = noVig(1.7, 2.2); assert.ok(Math.abs(nv.p1 + nv.p2 - 1) < 1e-12);
  assert.ok(Math.abs(0.65 * 1.7 - 1 - 0.105) < 1e-9);          // 65% su 1,70: EV +10,5%
  assert.ok(Math.abs(1.7 * 1.7 - 2.89) < 1e-12);
});

test("Value su favorito: classificazione, EV e campi del lato", () => {
  const e = evaluateMatch(mk({ prediction: { p1: 0.66, p2: 0.34 } }), { now: NOW, calib: calibrationFrom(bt) });
  assert.equal(e.cls, "value_high"); assert.equal(e.best.slot, 1);
  assert.ok(Math.abs(e.best.ev - (0.66 * 1.7 - 1)) < 1e-3); assert.equal(e.best.fairOdds, Math.round(1 / 0.66 * 1000) / 1000);
  assert.ok(e.best.market > 0 && e.best.market < 1 && e.best.edge > 0);
});
test("entrambi i lati valutati: Value sullo sfavorito senza cambiare il pronostico", () => {
  const m = mk({ prediction: { p1: 0.6, p2: 0.4 }, odds: { p1: 1.45, p2: 2.9, sources: [{ book: "Pinnacle", p1: 1.45, p2: 2.9 }] } });
  const e = evaluateMatch(m, { now: NOW, calib: calibrationFrom(bt) });
  assert.equal(e.sides.length, 2); assert.equal(e.best.slot, 2); assert.equal(e.best.isUnderdog, true);
  assert.equal(e.cls, "value_interesting");                      // sfavorito: mai «elevato»
  assert.equal(e.prediction.pick, 1);                            // pronostico principale invariato
});
test("quota mancante, scaduta, partita iniziata, probabilità incoerenti, affidabilità bassa", () => {
  const c = { now: NOW, calib: calibrationFrom(bt) };
  assert.equal(evaluateMatch(mk({ odds: null }), c).cls, "not_evaluable");
  assert.match(evaluateMatch(mk({ odds: null }), c).reasons[0], /Quote reali non disponibili/);
  const old = evaluateMatch(mk({ odds: { at: new Date(NOW - 4 * H).toISOString() } }), c); assert.equal(old.cls, "not_evaluable"); assert.match(old.reasons[0], /non aggiornate/);
  assert.equal(evaluateMatch(mk({ startsAt: new Date(NOW - 60e3).toISOString() }), c).excluded, true);
  assert.equal(evaluateMatch(mk({ status: "live" }), c).excluded, true);
  assert.equal(evaluateMatch(mk({ status: "finished" }), c).excluded, true);
  assert.equal(evaluateMatch(mk({ prediction: { p1: 0.7, p2: 0.4 } }), c).cls, "not_evaluable");
  assert.equal(evaluateMatch(mk({ prediction: { reliability: "bassa" } }), c).cls, "not_evaluable");
  assert.equal(evaluateMatch(mk({ prediction: { published: false, pick: null, abstainReason: "x" } }), c).cls, "not_evaluable");
  assert.equal(evaluateMatch(mk({ category: "itf", prediction: { reliability: "media" } }), c).cls, "not_evaluable");
});
test("probabilità alta ma quota non conveniente; nessun value; soglie non abbassate", () => {
  const c = { now: NOW, calib: calibrationFrom(bt) };
  const hp = evaluateMatch(mk({ prediction: { p1: 0.78, p2: 0.22 }, odds: { p1: 1.25, p2: 4.2, sources: [{ book: "Pinnacle", p1: 1.25, p2: 4.2 }] } }), c); assert.equal(hp.cls, "high_prob_bad_price");
  const nv = evaluateMatch(mk({ prediction: { p1: 0.6, p2: 0.4 }, odds: { p1: 1.6, p2: 2.4, sources: [{ book: "Pinnacle", p1: 1.6, p2: 2.4 }] } }), c); assert.equal(nv.cls, "no_value");
  assert.equal(STRATEGY.maxLegs, 2);
});
test("scarto eccessivo dal mercato: nessun value anche con EV positivo", () => {
  const e = evaluateMatch(mk({ prediction: { p1: 0.9, p2: 0.1 }, odds: { p1: 1.7, p2: 2.2, sources: [{ book: "Pinnacle", p1: 1.7, p2: 2.2 }] } }), { now: NOW, calib: calibrationFrom(bt) });
  assert.notEqual(e.cls, "value_high"); assert.notEqual(e.cls, "value_interesting");
});
test("senza campione validato non esiste «Value elevato»", () => {
  const e = evaluateMatch(mk({ prediction: { p1: 0.66, p2: 0.34 } }), { now: NOW, calib: calibrationFrom(null) });
  assert.equal(e.cls, "value_interesting"); assert.ok(e.reasons.some((r) => /insufficiente/.test(r)));
});
test("calibrazione: Wilson e correzione solo al ribasso", () => {
  const [lo, hi] = wilson(50, 100); assert.ok(lo < 0.5 && hi > 0.5);
  const over = calibrationFrom({ published: 800, summary: { calibration: [{ from: 0.65, to: 0.7, n: 400, meanP: 0.68, hitRate: 0.55 }] } });
  const c = calibrationCheck(0.68, over); assert.equal(c.status, "overconfident"); assert.ok(c.adjustedP < 0.68);
  assert.equal(calibrationCheck(0.68, calibrationFrom(null)).status, "insufficient");
});

test("doppia: probabilità congiunta, EV, due gambe, stesso giocatore escluso", () => {
  const a = mk({ key: "a", prediction: { p1: 0.66, p2: 0.34 } }), b = mk({ key: "b", prediction: { p1: 0.66, p2: 0.34 }, startsAt: new Date(NOW + 6 * H).toISOString() });
  const s = buildStrategy([a, b], { range: "d7", now: NOW, calibration: bt });
  assert.equal(s.singles.length, 2); assert.ok(s.double.legs.length === 2);
  assert.ok(Math.abs(s.double.jointP - Math.round(s.singles[0].pUsed * s.singles[1].pUsed * 1e4) / 1e4) < 2e-4);
  assert.ok(Math.abs(s.double.totalOdds - 1.7 * 1.7) < 1e-3);
  assert.ok(Math.abs(s.double.evDouble - (0.66 * 0.66 * 2.89 - 1)) < 2e-3);
  const dup = buildStrategy([mk({ key: "a", id1: "x", n1: "Stesso", prediction: { p1: 0.66, p2: 0.34 } }), mk({ key: "b", id1: "x", n1: "Stesso", prediction: { p1: 0.66, p2: 0.34 } })], { range: "d7", now: NOW, calibration: bt });
  assert.equal(dup.double.status, "none");
});
test("confronto strutture: a rischio omogeneo le singole battono la doppia; nessuna multipla oltre 2", () => {
  const leg = { pUsed: 0.65, odds: 1.7, name: "X" };
  const c = compareStructures(leg, leg); assert.equal(c.preferred, "two_singles");
  const many = Array.from({ length: 6 }, (_, i) => mk({ key: "k" + i, prediction: { p1: 0.66, p2: 0.34 } }));
  const s = buildStrategy(many, { range: "d7", now: NOW, calibration: bt });
  assert.ok(s.selected.length <= 5); assert.ok((s.double.legs?.length ?? 2) === 2);
});
test("nessuna Value: nessuna doppia e piano «nessuna giocata»", () => {
  const s = buildStrategy([mk({ prediction: { p1: 0.6, p2: 0.4 }, odds: { p1: 1.6, p2: 2.4, sources: [{ book: "Pinnacle", p1: 1.6, p2: 2.4 }] } })], { range: "d7", now: NOW, calibration: bt });
  assert.equal(s.singles.length, 0); assert.equal(s.double.status, "none"); assert.equal(s.plan.kind, "none");
});

test("finestre temporali in fuso Europe/Rome (oggi, 48 ore, weekend, 7 giorni)", () => {
  const sat = Date.parse("2026-11-21T12:00:00Z"), mon = Date.parse("2026-11-23T12:00:00Z");
  assert.deepEqual(weekendDays(NOW), ["2026-11-21", "2026-11-22"]);
  const wk = rangeTest("weekend", NOW); assert.ok(wk(sat)); assert.ok(!wk(mon));
  // 23:30 UTC del 17/11 sono le 00:30 del 18/11 a Roma: non è «oggi»
  assert.ok(!rangeTest("today", NOW)(Date.parse("2026-11-17T23:30:00Z"))); assert.ok(rangeTest("today", NOW)(Date.parse("2026-11-17T22:30:00Z")));
  assert.ok(rangeTest("h48", NOW)(NOW + 47 * H)); assert.ok(!rangeTest("h48", NOW)(NOW + 49 * H));
  assert.ok(rangeTest("d7", NOW)(NOW + 6 * 24 * H)); assert.ok(!rangeTest("d7", NOW)(NOW - 1));
  assert.deepEqual(weekendDays(Date.parse("2026-11-22T09:00:00Z")), ["2026-11-22"]);
});

test("bankroll: esempio del video, puntata ricalcolata, mai aumentata dopo una perdita", () => {
  assert.equal(stakeOf(1000, 0.05), 50); assert.equal(applyOutcome(1000, 50, 1.7, false), 950); assert.equal(stakeOf(950, 0.05), 47.5);
  const seq = simulateSequence(1000, 0.05, [{ odds: 1.7, won: false }, { odds: 1.7, won: false }, { odds: 1.7, won: false }]);
  for (let i = 1; i < seq.steps.length; i++) assert.ok(seq.steps[i].stake < seq.steps[i - 1].stake);
  assert.equal(DEFAULT_BANKROLL.stakePct, 0.01); assert.ok(STAKE_PROFILES.find((p) => p.pct === 0.05).aggressive);
  assert.equal(sanitizeBankroll({ bankroll: "x", stakePct: 9 }).stakePct, 0.1);
  assert.equal(weekKey("2026-11-22"), "2026-11-16");
});
test("piano: limiti giornaliero/settimanale, nessuna doppia esposizione", () => {
  const many = Array.from({ length: 5 }, (_, i) => mk({ key: "k" + i, prediction: { p1: 0.66, p2: 0.34 } }));
  const s = buildStrategy(many, { range: "d7", now: NOW, calibration: bt });
  const p = planBankroll(s, { bankroll: 1000, stakePct: 0.01, dailyLimitPct: 0.03, weeklyLimitPct: 0.08 });
  assert.ok(p.totals.exposure <= 30); assert.equal(p.slips.filter((x) => !x.blocked).length, 3); assert.equal(p.slips.filter((x) => x.blocked).length, 2);
  const keys = p.slips.flatMap((x) => x.keys); assert.equal(new Set(keys).size, keys.length);
  const none = planBankroll(buildStrategy([], { now: NOW }), {}); assert.equal(none.slips.length, 0);
});
