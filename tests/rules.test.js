import test from "node:test";
import assert from "node:assert/strict";
import { MIN_ODDS_DEFAULT, adjustPick, clampMinOdds } from "../src/rules.js";
import { MODEL } from "../functions/api/model.js";

const pick = (odds, extra = {}) => ({ key: "dc1x", label: "1X", p: 0.7, pLow: 0.62, edge: 0.1, minOdds: 1.66, confidence: "buona", sample: 8, verdict: "BET", reason: "x", odds: odds ? { median: odds } : null, ...extra });

test("quota minima nelle Impostazioni: valori limitati a 1,00-3,00 e virgola accettata", () => {
  assert.equal(clampMinOdds("1,45"), 1.45);
  assert.equal(clampMinOdds(0.2), 1);
  assert.equal(clampMinOdds(9), 3);
  assert.equal(clampMinOdds("abc"), MIN_ODDS_DEFAULT);
});
test("la quota minima cambia il verdetto della scelta già calcolata, in entrambi i sensi", () => {
  const p = pick(1.4);                                        // valore atteso 0,62 x 1,4 = 0,87 < 1,03: EVITA già per il valore
  const q = pick(1.7);                                        // 0,62 x 1,7 = 1,05: BET con minimo 1,30
  assert.equal(adjustPick(q, 1.3).verdict, "BET");
  assert.equal(adjustPick(q, 1.8).verdict, "EVITA", "alzando la quota minima la scelta cade");
  assert.match(adjustPick(q, 1.8).reason, /sotto il minimo/);
  assert.equal(adjustPick(pick(1.2, { pLow: 0.9, verdict: "EVITA" }), 1.3).verdict, "EVITA", "al minimo di default vale il verdetto già calcolato dal server");
  assert.equal(adjustPick(pick(1.2, { pLow: 0.9, verdict: "EVITA" }), 1.1).verdict, "BET", "abbassandola passa");
  assert.ok(p);
});
test("senza quota reale il BET resta, e la quota minima mostrata segue l'impostazione", () => {
  const p = pick(null);
  assert.equal(adjustPick(p, 1.8).minOdds, 1.8);
  assert.equal(adjustPick(p, 1.8).verdict, "BET");
  assert.equal(MODEL.minPlayOdds, 1.3, "il modello condiviso non viene alterato");
});
test("pochi dati e scelte assenti passano invariati", () => {
  assert.equal(adjustPick(null, 1.5), null);
  const low = pick(null, { confidence: "insufficiente" });
  assert.equal(adjustPick(low, 1.5), low);
});
