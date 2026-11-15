import test from "node:test";
import assert from "node:assert/strict";
import { usageFrom, onRequest } from "../functions/api/usage.js";

const NOW = Date.parse("2026-11-15T10:00:00Z");

test("crediti: usa la riga di oggi così com'è", () => {
  const u = usageFrom({ day: "2026-11-15", requests: 1200, limit_day: 7500, remaining: 6300, updated_at: "t" }, null, NOW);
  assert.deepEqual([u.requests, u.limit, u.remaining, u.assumed], [1200, 7500, 6300, false]);
});
test("crediti: senza la riga di oggi il residuo riparte dal limite noto e lo dichiara come stima", () => {
  const u = usageFrom(null, { limit_day: 7500 }, NOW);
  assert.deepEqual([u.requests, u.limit, u.remaining, u.assumed], [0, 7500, 7500, true]);
});
test("crediti: senza alcun dato non si inventa nulla", () => {
  const u = usageFrom(null, null, NOW);
  assert.deepEqual([u.requests, u.limit, u.remaining], [null, null, null]);
});
test("endpoint /api/usage: legge solo Supabase e restituisce il rinnovo alla mezzanotte UTC", async () => {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => { calls.push(String(url)); const q = new URL(url).searchParams; return new Response(JSON.stringify(q.get("day") ? [{ day: "2026-11-15", requests: 900, limit_day: 7500, remaining: 6600 }] : []), { status: 200 }); };
  try {
    const res = await onRequest({ env: { SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k" } });
    const j = await res.json();
    assert.equal(res.status, 200);
    assert.equal(j.remaining, 6600);
    assert.match(j.resetsAt, /T00:00:00\.000Z$/);
    assert.ok(calls.every((c) => c.includes("/rest/v1/af_usage")), "nessuna chiamata a API-Football");
  } finally { globalThis.fetch = real; }
});
test("endpoint /api/usage: senza configurazione risponde 503", async () => {
  const res = await onRequest({ env: {} });
  assert.equal(res.status, 503);
});
