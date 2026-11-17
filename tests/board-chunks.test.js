import test from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../functions/api/board-chunks.js";

const env = { SUPABASE_URL: "https://sb.test", SUPABASE_SERVICE_ROLE_KEY: "service-secret" };
const withFetch = async (fn, run) => {
  const real = globalThis.fetch;
  globalThis.fetch = fn;
  try { return await run(); } finally { globalThis.fetch = real; }
};

test("board-chunks valida i parametri prima di contattare Supabase", async () => {
  let calls = 0;
  await withFetch(async () => { calls += 1; return new Response("[]"); }, async () => {
    const r = await onRequest({ request: new Request("https://app.test/api/board-chunks?version=bad%3Avalue&count=2"), env });
    assert.equal(r.status, 400);
    assert.equal(calls, 0);
  });
});

test("board-chunks inoltra in streaming la risposta e limita la query alla versione richiesta", async () => {
  let requested;
  await withFetch(async (url, options) => {
    requested = { url: new URL(url), options };
    return new Response('[{"id":"fixtures:chunk:v1:0000","payload":{"matches":[{"id":"m1"}]}}]', { status: 200, headers: { "content-type": "application/json" } });
  }, async () => {
    const r = await onRequest({ request: new Request("https://app.test/api/board-chunks?version=v1&count=1"), env });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), [{ id: "fixtures:chunk:v1:0000", payload: { matches: [{ id: "m1" }] } }]);
    assert.equal(requested.url.searchParams.get("id"), "like.fixtures:chunk:v1:%");
    assert.equal(requested.url.searchParams.get("limit"), "1");
    assert.equal(requested.options.headers.authorization, "Bearer service-secret");
  });
});

test("board-chunks vuoto non richiede chiamate al database", async () => {
  let calls = 0;
  await withFetch(async () => { calls += 1; return new Response("[]"); }, async () => {
    const r = await onRequest({ request: new Request("https://app.test/api/board-chunks?version=v1&count=0"), env });
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), []);
    assert.equal(calls, 0);
  });
});
