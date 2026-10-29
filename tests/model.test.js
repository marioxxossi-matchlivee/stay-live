import test from "node:test";
import assert from "node:assert/strict";
import { average, confidence, poissonProbabilityOver } from "../functions/api/model.js";

test("average ignores missing and invalid values", () => {
  assert.equal(average([1, 2, null, NaN, -3]), 1.5);
  assert.equal(average([null, NaN]), null);
});

test("Poisson over probability is bounded and decreases with a higher line", () => {
  const over15 = poissonProbabilityOver(2.5, 1.5);
  const over25 = poissonProbabilityOver(2.5, 2.5);
  const over35 = poissonProbabilityOver(2.5, 3.5);
  assert.ok(over15 > over25 && over25 > over35);
  assert.ok(over15 >= 0 && over15 <= 1);
});

test("Poisson probability handles zero mean", () => {
  assert.equal(poissonProbabilityOver(0, 0.5), 0);
});

test("confidence reflects sample size conservatively", () => {
  assert.equal(confidence(2), "insufficiente");
  assert.equal(confidence(5), "bassa");
  assert.equal(confidence(10), "media");
});
