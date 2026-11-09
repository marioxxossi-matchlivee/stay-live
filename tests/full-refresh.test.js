import test from "node:test";
import assert from "node:assert/strict";
import { FRESH_FAR, FRESH_NEAR, eligibleOpen, freshForAt, statusOf, summaryMarkdown, syncAll, tally } from "../scripts/full-refresh.js";

const H = 3600e3, now = Date.parse("2026-11-09T12:00:00Z");
const m = (id, h, status = "scheduled", league = "seriea") => ({ game_id: id, league, status, kickoff_at: new Date(now + h * H).toISOString() });

test("freschezza: 3,5 ore entro 48 ore dal fischio, 11 ore oltre", () => {
  const f = freshForAt(now);
  assert.equal(f(m("a", 5)), FRESH_NEAR); assert.equal(f(m("b", 47)), FRESH_NEAR); assert.equal(f(m("c", 60)), FRESH_FAR);
  assert.ok(FRESH_NEAR < 4 * H, "deve essere minore della cadenza di 4 ore, altrimenti il giro salterebbe dati");
});

test("partite coperte: solo aperte, entro i giorni, campionati con API-Football", () => {
  const w = [m("ok1", 5), m("live", -1, "in_progress"), m("done", -30, "final"), m("far", 24 * 9), m("noaf", 5, "scheduled", "inesistente")];
  assert.deepEqual(eligibleOpen(w, now, 7).map((x) => x.game_id), ["ok1", "live"]);
});

test("conteggio degli stati", () => {
  const st = new Map([["a", "used"], ["b", "none"], ["c", "waiting"]]);
  assert.deepEqual(tally(st, ["a", "b", "c", "d"]), { used: 1, none: 1, waiting: 1, missing: 1 });
});

const base = () => ({ error: null, pending: 0, budgetStop: false, leagues: { total: 30, ok: 30, failed: [] }, matches: { window: 200, eligible: 100 },
  prediction: { used: 98, waiting: 0, missing: 2, none: 0 }, market: { used: 95, waiting: 0, missing: 5, none: 0 }, corners: { used: 80, none: 15, waiting: 0, missing: 5 },
  details: { matches: 40, sections: 500, skipped: false }, credits: { used: 3000, remaining: 4500, limit: 7500 }, notes: [], durationSec: 600 });

test("esito del giro: ok, parziale, fallito", () => {
  assert.equal(statusOf(base()), "ok");
  assert.equal(statusOf({ ...base(), leagues: { total: 30, ok: 29, failed: [{ id: "x", error: "e" }] } }), "partial");
  assert.equal(statusOf({ ...base(), prediction: { used: 50, waiting: 0, missing: 50, none: 0 } }), "partial");
  assert.equal(statusOf({ ...base(), corners: { used: 10, none: 10, waiting: 0, missing: 80 } }), "partial");
  assert.equal(statusOf({ ...base(), budgetStop: true }), "partial");
  assert.equal(statusOf({ ...base(), error: "boom" }), "failed");
});

test("riassunto leggibile", () => {
  const md = summaryMarkdown({ ...base(), status: "partial", leagues: { total: 30, ok: 29, failed: [{ id: "serieb", error: "Too many requests" }] } });
  assert.match(md, /parziale/); assert.match(md, /29\/30/); assert.match(md, /serieb \(Too many requests\)/); assert.match(md, /4500 restanti su 7500/);
});

test("campionati: riprova dopo il limite di richieste e segnala gli errori veri", async () => {
  const calls = {}, waits = [];
  const call = async ({ request }) => {
    const id = new URL(request.url).searchParams.get("league"); calls[id] = (calls[id] ?? 0) + 1;
    if (id === "epl" && calls[id] === 1) return new Response(JSON.stringify({ error: "Too many requests" }), { status: 502 });
    if (id === "serieb") return new Response(JSON.stringify({ error: "chiave non valida" }), { status: 502 });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
  const res = await syncAll({ SYNC_SECRET: "s" }, { call, wait: async (ms) => { waits.push(ms); } });
  assert.equal(calls.epl, 2); assert.ok(waits.includes(20000));
  assert.equal(calls.serieb, 1, "un errore non legato al limite non si ripete");
  const failed = res.filter((r) => !r.ok); assert.deepEqual(failed.map((r) => r.id), ["serieb"]);
  assert.ok(res.length >= 30);
});
