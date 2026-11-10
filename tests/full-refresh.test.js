import test from "node:test";
import assert from "node:assert/strict";
import { FRESH_FAR, FRESH_NEAR, eligibleOpen, freshForAt, statusOf, summaryMarkdown, syncAll, tally } from "../scripts/full-refresh.js";
import { LEAGUES } from "../functions/api/_lib.js";

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

const base = () => ({ error: null, budgetStop: false, verify: { ok: true }, leagues: { total: 32, ok: 32, failed: [] }, matches: { window: 200, eligible: 100, processed: 100, waiting: 0 },
  components: { prediction: { ok: 90, not_yet: 8, not_covered: 2, temporary: 0, error: 0 }, market: { ok: 60, not_yet: 30, not_covered: 10, temporary: 0, error: 0 }, corners: { ok: 40, not_yet: 30, not_covered: 30, temporary: 0, error: 0 } },
  details: { matches: 40, sections: 500, skipped: false }, requests: { thisRun: 900, today: 3000, remaining: 4500, limit: 7500 }, pending: [], notes: [], durationSec: 600, mode: "full" });

test("esito del giro: i dati non forniti dal provider NON rendono il giro parziale", () => {
  assert.equal(statusOf(base()), "ok", "non ancora disponibili / non previsti = situazione normale");
  assert.equal(statusOf({ ...base(), leagues: { total: 32, ok: 31, failed: [{ id: "x", error: "e" }] } }), "partial");
  assert.equal(statusOf({ ...base(), components: { ...base().components, prediction: { ok: 50, not_yet: 0, not_covered: 0, temporary: 10, error: 0 } } }), "partial");
  assert.equal(statusOf({ ...base(), components: { ...base().components, corners: { ok: 1, not_yet: 0, not_covered: 0, temporary: 0, error: 3 } } }), "partial");
  assert.equal(statusOf({ ...base(), budgetStop: true }), "partial");
  assert.equal(statusOf({ ...base(), verify: { ok: false } }), "partial");
  assert.equal(statusOf({ ...base(), leagues: { total: 32, ok: 0, failed: [{ id: "x" }] } }), "failed");
  assert.equal(statusOf({ ...base(), error: "boom" }), "failed");
});

test("riassunto leggibile", () => {
  const md = summaryMarkdown({ ...base(), status: "partial", leagues: { total: 32, ok: 31, failed: [{ id: "serieb", error: "Too many requests" }] }, pending: [{ component: "prediction", count: 4, nextTryAt: "2026-11-09T12:40:00Z" }] });
  assert.match(md, /parziale/); assert.match(md, /31\/32/); assert.match(md, /serieb \(Too many requests\)/); assert.match(md, /4500 restanti su 7500/); assert.match(md, /Da completare: Pronostici API-Football \(4\)/);
});

test("campionati: riprova dopo il limite di richieste, segnala gli errori veri, solo API-Football", async () => {
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
  assert.deepEqual(res.filter((r) => !r.ok).map((r) => r.id), ["serieb"]);
  assert.equal(res.length, LEAGUES.length, "tutti i campionati passano da API-Football");
  const only = await syncAll({ SYNC_SECRET: "s" }, { call, wait: async () => {}, only: ["seriea", "ucl"] });
  assert.deepEqual(only.map((r) => r.id), ["seriea", "ucl"]);
});
