import test from "node:test";
import assert from "node:assert/strict";
import { loadSections } from "../functions/api/_apifootball.js";

const env = { SUPABASE_URL: "http://sb.test", SUPABASE_SERVICE_ROLE_KEY: "k", API_FOOTBALL_KEY: "x", API_FOOTBALL_MIN_GAP_MS: "0" };
const reqs = ["a", "b", "c", "d", "e"].map((s, i) => ({ section: s, endpoint: "fixtures", params: { id: i }, ttl: 60e3 }));

function mockFetch({ okCount, limitAfter = true }) {
  const af = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("sb.test")) return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    af.push(u);
    const ok = af.length <= okCount;
    const body = ok ? { errors: [], response: [{ n: af.length }], results: 1 } : { errors: { rateLimit: "Too many requests. You have exceeded the limit of requests per minute of your subscription." }, response: [] };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", "x-ratelimit-requests-remaining": "5000", "x-ratelimit-requests-limit": "7500" } });
  };
  return af;
}

test("al primo 'Too many requests' ci si ferma: niente raffica, il resto resta rimandato con tempo di attesa", async () => {
  const af = mockFetch({ okCount: 2 });
  const { sections, retry } = await loadSections(env, reqs, Date.now(), { reserve: 0 });
  assert.equal(sections.a.source, "live"); assert.equal(sections.b.source, "live");
  assert.equal(sections.c.deferred, true); assert.match(sections.c.error, /Too many requests/);
  assert.equal(sections.d.deferred, true); assert.equal(sections.e.deferred, true);
  assert.equal(af.length, 4, "2 riuscite + la terza con un solo nuovo tentativo; d ed e non vengono nemmeno chiamate");
  assert.equal(retry.pending, 3);
  assert.ok(retry.afterMs >= 15000);
});

test("tetto per volta: le sezioni in coda sono rimandate subito e il browser riprova dopo poco", async () => {
  const af = mockFetch({ okCount: 99 });
  const { sections, retry } = await loadSections(env, reqs, Date.now(), { maxLive: 3, reserve: 0 });
  assert.equal(af.length, 3);
  assert.equal(sections.d.deferred, true); assert.equal(sections.e.deferred, true);
  assert.deepEqual(retry, { pending: 2, afterMs: 1500 });
});

test("tutto in cache o scaricato: nessuna attesa", async () => {
  mockFetch({ okCount: 99 });
  const { retry } = await loadSections(env, reqs, Date.now(), { reserve: 0 });
  assert.deepEqual(retry, { pending: 0, afterMs: 0 });
});
