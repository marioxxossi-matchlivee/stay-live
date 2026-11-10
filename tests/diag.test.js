import test from "node:test";
import assert from "node:assert/strict";
import { buildTasks, classify, countClasses, coverageFlags, pendingSummary } from "../functions/api/_diag.js";

const now = Date.parse("2026-11-09T12:00:00Z"), h = (n) => new Date(now + n * 3600e3).toISOString();

test("copertura del piano: flag per stagione", () => {
  const resp = [{ seasons: [{ year: 2025, coverage: { predictions: true } }, { year: 2026, coverage: { predictions: false, odds: true, injuries: true, standings: true, fixtures: { statistics_fixtures: false, lineups: true, events: true } } }] }];
  assert.deepEqual(coverageFlags(resp, 2026), { predictions: false, odds: true, injuries: true, standings: true, statistics: false, lineups: true, events: true, season: 2026 });
  assert.equal(coverageFlags([], 2026), null);
});

test("classificazione: cinque esiti distinti", () => {
  const fl = { predictions: true, odds: true, statistics: true };
  assert.equal(classify("prediction", { state: "used", kickoff: h(5), now }), "ok");
  assert.equal(classify("prediction", { state: "waiting", kickoff: h(5), now }), "temporary");
  assert.equal(classify("prediction", { state: "missing", error: "Too many requests", kickoff: h(5), now, flags: fl }), "temporary");
  assert.equal(classify("prediction", { state: "missing", error: "HTTP 500", kickoff: h(5), now, flags: fl }), "temporary");
  assert.equal(classify("prediction", { state: "missing", error: "Your plan does not include this endpoint", kickoff: h(5), now, flags: fl }), "error");
  assert.equal(classify("prediction", { state: "missing", kickoff: h(5), now, flags: { ...fl, predictions: false } }), "not_covered");
  assert.equal(classify("market", { state: "missing", kickoff: h(24 * 6), now, flags: fl }), "not_yet", "quote non ancora pubblicate per una partita lontana");
  assert.equal(classify("corners", { state: "none", kickoff: h(5), now, flags: fl }), "not_covered", "il provider ha risposto senza quote corner");
  assert.equal(classify("corners", { state: "none", kickoff: h(24 * 6), now, flags: fl }), "not_yet");
  assert.equal(classify("prediction", { state: "missing", kickoff: h(5), now, flags: fl, attempts: 0 }), "temporary", "risposta vuota vicino al fischio: si riprova");
  assert.equal(classify("prediction", { state: "missing", kickoff: h(5), now, flags: fl, attempts: 4 }), "not_covered", "dopo più tentativi vuoti si accetta");
  assert.deepEqual(countClasses(["ok", "ok", "error", "temporary", "not_yet"]), { ok: 2, not_yet: 1, not_covered: 0, temporary: 1, error: 1 });
});

test("compiti: solo temporaneo ed errore, tentativi che crescono, carry invariato", () => {
  const items = [
    { component: "prediction", scope: "af-1", league: "seriea", cls: "temporary", error: "Too many requests" },
    { component: "market", scope: "af-1", league: "seriea", cls: "ok" },
    { component: "corners", scope: "af-2", league: "epl", cls: "error", error: "HTTP 403" },
    { component: "league", scope: "league:serieb", league: "serieb", cls: "not_yet" },
  ];
  const t1 = buildTasks(items, [], now);
  assert.deepEqual(t1.map((t) => t.task_key).sort(), ["corners:af-2", "prediction:af-1"]);
  assert.ok(Date.parse(t1.find((t) => t.component === "prediction").next_try_at) - now === 30 * 60e3);
  const t2 = buildTasks(items, t1, now + 1800e3);
  assert.equal(t2.find((t) => t.task_key === "prediction:af-1").attempts, 2);
  assert.equal(t2.find((t) => t.task_key === "prediction:af-1").first_seen_at, t1[0].first_seen_at);
  const t3 = buildTasks(items.map((i) => ({ ...i, carry: true })), t2, now + 3600e3);
  assert.equal(t3.find((t) => t.task_key === "prediction:af-1").attempts, 2, "non ritentata: tentativi invariati");
  const s = pendingSummary(t2);
  assert.deepEqual(s.map((x) => [x.component, x.count, x.errors]).sort(), [["corners", 1, 1], ["prediction", 1, 0]]);
});
