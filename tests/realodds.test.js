import test from "node:test";
import assert from "node:assert/strict";
import { betIdsFrom, summarizeBtts, summarizeDoubleChance } from "../functions/api/_apifootball.js";
import { marketFrom } from "../functions/api/_market.js";
import { MODEL, verdictFor } from "../functions/api/model.js";

const resp = (name, values, books = ["A", "B", "C"]) => [{ bookmakers: books.map((b, i) => ({ name: b, bets: [{ name, values: values.map(([value, odd]) => ({ value, odd: String(Number(odd) + i * 0.02) })) }] })) }];
const dc = resp("Double Chance", [["Home/Draw", 1.3], ["Draw/Away", 1.9], ["Home/Away", 1.25]]);
const btts = resp("Both Teams Score", [["Yes", 1.8], ["No", 1.95]]);
const x12 = resp("Match Winner", [["Home", 1.9], ["Draw", 3.4], ["Away", 4.2]]);
const goals = resp("Goals Over/Under", [["Over 2.5", 1.9], ["Under 2.5", 1.9]]);

test("id dei mercati: doppia chance e gol/no gol si riconoscono dal nome, con valori di riserva", () => {
  const ids = betIdsFrom([{ id: 12, name: "Double Chance" }, { id: 8, name: "Both Teams Score" }, { id: 5, name: "Goals Over/Under" }]);
  assert.equal(ids.doubleChance, 12); assert.equal(ids.btts, 8);
  const none = betIdsFrom([]); assert.equal(none.doubleChance, 12); assert.equal(none.btts, 8);
});

test("doppia chance e gol/no gol: quote reali mediane e migliori; servono tutte le selezioni", () => {
  const d = summarizeDoubleChance(dc);
  assert.equal(d.dc1x.n, 3); assert.ok(d.dc1x.median >= 1.3 && d.dc1x.best.odd >= d.dc1x.median);
  assert.equal(summarizeDoubleChance(resp("Double Chance", [["Home/Draw", 1.3]])), null, "una sola doppia chance: inutilizzabile");
  const b = summarizeBtts(btts); assert.equal(b.btts.n, 3);
  assert.equal(summarizeBtts(resp("Both Teams Score", [["Yes", 1.8]])), null);
  assert.equal(summarizeDoubleChance(btts), null, "mercato sbagliato ignorato");
});

test("mercato: le quote reali di doppia chance e gol/no gol entrano in `odds`, senza toccare le probabilità della doppia chance", () => {
  const base = marketFrom(goals, x12);
  assert.equal(base.odds.dc1x, undefined, "senza le risposte extra, come prima");
  const m = marketFrom(goals, x12, dc, btts);
  for (const k of ["dc1x", "dcx2", "dc12", "btts", "nobtts"]) assert.ok(m.odds[k].median > 1, k);
  assert.equal(m.p.dc1x, base.p.dc1x, "la probabilità della doppia chance resta quella derivata dall'1X2");
  assert.ok(Math.abs(m.p.btts + m.p.nobtts - 1) < 0.001, "gol/no gol senza margine");
  assert.ok(m.p.btts > 0.5, "quota 1.80 contro 1.95: sì più probabile");
});

test("verdetto con quota reale: la doppia chance 1X può essere BET (valore atteso), senza la soglia 'punti sulla media' che la penalizzava", () => {
  const sel = { key: "dc1x", p: 0.8, pLow: 0.76, edge: 0.06, minOdds: +(MODEL.edgeMargin / 0.76).toFixed(2), odds: { median: 1.6 } };
  const v = verdictFor(sel, 20);
  assert.equal(v.verdict, "BET", v.reason);                   // 0,76 x 1,6 = 1,22 >= soglia di valore e quota >= 1,5
  const same = verdictFor({ ...sel, odds: null }, 20);
  assert.equal(same.verdict, "EVITA", "senza quota reale resta la regola prudente (+8 punti sulla media)");
  assert.equal(verdictFor({ ...sel, odds: { median: 1.2 } }, 20).verdict, "EVITA", "quota troppo bassa");
});
