import test from "node:test";
import assert from "node:assert/strict";
import { valueSingles, valueMultiples, valueCardHtml } from "../src/tennis/value.js";
import { evaluateBet } from "../functions/api/_tennis-bet.js";

const now = Date.parse("2026-11-27T08:00:00Z");
const mk = (key, pick, p, odds, tournament, h, verdict = "BET") => ({ key, status: "scheduled", startsAt: new Date(now + h * 3600e3).toISOString(), tournament, p1: { name: `A${key}` }, p2: { name: `B${key}` },
  prediction: { published: true, pick, p1: pick === 1 ? p : 1 - p, p2: pick === 2 ? p : 1 - p }, bet: { verdict, odds, ev: p * odds - 1 } });

test("valueSingles: solo BET di partite non iniziate, ordinate per probabilità", () => {
  const s = valueSingles([mk(1, 1, 0.74, 1.42, "T1", 3), mk(2, 2, 0.8, 1.36, "T2", 4), mk(3, 1, 0.9, 1.1, "T3", 4, "EVITA"), { ...mk(4, 1, 0.8, 1.4, "T4", -2) }], now);
  assert.deepEqual(s.map((x) => x.key), [2, 1]);
});

test("valueMultiples: gambe almeno al 75%, probabilità congiunta almeno 50%, tornei diversi preferiti, massimo tre gambe", () => {
  const singles = valueSingles([mk(1, 1, 0.78, 1.38, "T1", 3), mk(2, 2, 0.76, 1.4, "T2", 5), mk(3, 1, 0.74, 1.42, "T3", 6), mk(4, 1, 0.8, 1.36, "T4", 8)], now);
  const m = valueMultiples(singles, now);
  assert.equal(m.length, 1); assert.equal(m[0].kind, "Doppia"); assert.ok(m[0].joint >= 0.5 && m[0].ev > 0);
  assert.ok(m[0].legs.every((l) => l.p >= 0.75), "nessuna gamba sotto il 75%");
  assert.deepEqual(valueMultiples(valueSingles([mk(1, 1, 0.6, 1.8, "T1", 3), mk(2, 1, 0.62, 1.7, "T2", 3)], now), now), [], "gambe poco probabili: nessuna multipla");
  assert.match(valueCardHtml([], now), /Nessuna giocata di valore/);
});

test("evaluateBet su pronostico ancorato: BET solo con probabilità >= 70%, quota > 1,30 e valore atteso >= 3%", () => {
  const pred = { published: true, anchored: true, pick: 1, p1: 0.75, p2: 0.25, reliability: "media" };
  const m = (o) => ({ status: "scheduled", startsAt: new Date(now + 3600e3).toISOString(), oddsSources: [{ book: "A", p1: o, p2: 3.2 }], oddsFetchedAt: new Date(now - 600e3).toISOString() });
  assert.equal(evaluateBet(m(1.4), pred, { now }).verdict, "BET");
  assert.equal(evaluateBet(m(1.28), pred, { now }).verdict, "EVITA", "quota fino a 1,30");
  assert.equal(evaluateBet(m(1.34), pred, { now }).verdict, "EVITA", "valore atteso sotto il 3%");
  assert.equal(evaluateBet(m(1.5), { ...pred, p1: 0.66, p2: 0.34 }, { now }).verdict, "EVITA", "probabilità sotto il 70%");
});
