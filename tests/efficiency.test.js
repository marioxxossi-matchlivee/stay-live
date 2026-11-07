import test from "node:test";
import assert from "node:assert/strict";
import { efficiency, efficiencyHtml, settledLegs } from "../src/efficiency.js";

const leg = (matchId, key, pLow = 0.6) => ({ matchId, key, pLow });
const plays = [
  { kind: "single", legs: [leg("a", "over25", 0.6)] },
  { kind: "multiple", legs: [leg("a", "over25", 0.6), leg("b", "btts", 0.5)] }, // a|over25 già contata
  { kind: "single", legs: [leg("c", "under25", 0.7)] },
  { kind: "single", legs: [leg("d", "dc1x")] },
  { kind: "single", legs: [leg("e", "over25")] },
];
const results = {
  a: { status: "final", homeScore: 2, awayScore: 1 },   // over25 vinta
  b: { status: "final", homeScore: 1, awayScore: 0 },   // btts persa
  c: { status: "final", homeScore: 3, awayScore: 0 },   // under25 persa
  d: { status: "canceled" },                             // annullata: esclusa
  e: { status: "scheduled" },                            // da giocare: esclusa
};

test("conta le selezioni uniche già giudicabili, escluse annullate e da giocare", () => {
  assert.equal(settledLegs(plays, results).length, 3);
});
test("percentuale complessiva e per mercato / tipo", () => {
  const e = efficiency(plays, results);
  assert.equal(e.total.n, 3); assert.equal(e.total.won, 1);
  assert.ok(Math.abs(e.total.rate - 1 / 3) < 1e-9);
  assert.ok(Math.abs(e.total.expected - (0.6 + 0.5 + 0.7) / 3) < 1e-9);
  const ou = e.byMarket.find((m) => m.id === "Over/Under"); assert.deepEqual([ou.n, ou.won], [2, 1]);
  assert.deepEqual([e.byKey.find((k) => k.id === "btts").won, e.byKey.find((k) => k.id === "btts").n], [0, 1]);
});
test("senza risultati: nessuna percentuale e nessun errore", () => {
  const e = efficiency(plays, {});
  assert.equal(e.total.n, 0); assert.equal(e.total.rate, null);
  assert.match(efficiencyHtml(e, { esc: String, pct: String }), /Appena una partita/);
});
test("usa il risultato salvato nella gamba (res) anche senza dati live", () => {
  const e = efficiency([{ legs: [{ matchId: "z", key: "over15", res: [1, 1] }] }], {});
  assert.equal(e.total.won, 1);
});
