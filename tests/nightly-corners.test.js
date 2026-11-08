import test from "node:test";
import assert from "node:assert/strict";
import { BATCH, chunk, romeHour, runCorners, selectTargets } from "../scripts/nightly-corners.js";

test("mezzanotte a Roma: ora solare e ora legale", () => {
  assert.equal(romeHour(new Date("2026-01-15T23:05:00Z")), 0);     // CET (UTC+1)
  assert.equal(romeHour(new Date("2026-01-15T22:05:00Z")), 23);
  assert.equal(romeHour(new Date("2026-07-15T22:05:00Z")), 0);     // CEST (UTC+2)
  assert.equal(romeHour(new Date("2026-07-15T23:05:00Z")), 1);
});

test("partite da cercare: solo in programma, nei prossimi 7 giorni, in ordine", () => {
  const now = Date.parse("2026-11-08T00:00:00Z"), d = (h) => new Date(now + h * 3600e3).toISOString();
  const m = [
    { id: "late", status: "scheduled", kickoffAt: d(24 * 6) }, { id: "soon", status: "scheduled", kickoffAt: d(5) },
    { id: "far", status: "scheduled", kickoffAt: d(24 * 8) }, { id: "live", status: "in_progress", kickoffAt: d(-1) },
    { id: "done", status: "final", kickoffAt: d(-30) }, { id: "past", status: "scheduled", kickoffAt: d(-2) },
  ];
  assert.deepEqual(selectTargets(m, now), ["soon", "late"]);
  assert.deepEqual(selectTargets(undefined, now), []);
});

test("gruppi da BATCH partite", () => {
  const ids = Array.from({ length: BATCH * 2 + 1 }, (_, i) => `m${i}`);
  assert.deepEqual(chunk(ids, BATCH).map((c) => c.length), [BATCH, BATCH, 1]);
});

test("runCorners: conta gli esiti, riprova se il provider limita e aspetta il suggerimento del server", async () => {
  const calls = [], waits = [];
  let n = 0;
  const get = async (path) => {
    calls.push(path); n += 1;
    if (n === 1) return { status: 502, body: { error: "Limite di richieste al minuto" } };
    if (n === 2) return { status: 200, body: { state: { a: "used", b: "waiting" }, retry: { pending: 1, afterMs: 4000 } } };
    return { status: 200, body: { state: { a: "used", b: "none" }, retry: { pending: 0, afterMs: 0 } } };
  };
  const r = await runCorners(["a", "b"], { get, sleep: async (ms) => { waits.push(ms); }, since: 123 });
  assert.deepEqual(r, { total: 2, used: 1, none: 1, missing: 0, pending: 0 });
  assert.deepEqual(waits, [20000, 4000]);
  assert.ok(calls.every((c) => c.includes("since=123") && c.includes("ids=a,b")));
});

test("runCorners: dopo troppi tentativi le partite restano in sospeso", async () => {
  const r = await runCorners(["x"], { get: async () => ({ status: 200, body: { state: { x: "waiting" }, retry: { pending: 1, afterMs: 1 } } }), sleep: async () => {}, since: 1 });
  assert.equal(r.pending, 1); assert.equal(r.used, 0);
});
