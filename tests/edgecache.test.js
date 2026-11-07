import test from "node:test";
import assert from "node:assert/strict";
import { edgeCached } from "../functions/api/_edgecache.js";

/** Cache finta con la stessa interfaccia di caches.default (match/put per URL). */
const fakeCache = () => { const m = new Map(); return { m, async match(req) { const r = m.get(req.url); return r ? r.clone() : undefined; }, async put(req, res) { m.set(req.url, res.clone()); } }; };
const okJson = (data = { n: 1 }) => new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const setup = () => {
  const cache = fakeCache(); let t = 1_000_000, builds = 0; const jobs = [];
  const run = (opts = {}) => edgeCached({ cache, keyUrl: `https://x.test/api/fixtures${opts.k ?? ""}`, waitUntil: (p) => jobs.push(p), build: opts.build ?? (async () => { builds += 1; return okJson({ n: builds }); }), now: () => t, ...opts.extra });
  return { cache, run, advance: (ms) => { t += ms; }, builds: () => builds, jobs };
};

test("prima richiesta: calcola, risponde e memorizza", async () => {
  const s = setup(); const r = await s.run();
  assert.equal(r.status, 200); assert.equal(r.headers.get("x-cache"), "miss"); assert.deepEqual(await r.json(), { n: 1 });
  assert.equal(s.builds(), 1); assert.equal(s.cache.m.size, 1);
});

test("copia fresca: nessun ricalcolo e risposta no-store per il browser", async () => {
  const s = setup(); await s.run(); s.advance(10e3);
  const r = await s.run();
  assert.equal(r.headers.get("x-cache"), "hit"); assert.equal(r.headers.get("cache-control"), "no-store"); assert.deepEqual(await r.json(), { n: 1 });
  assert.equal(s.builds(), 1);
});

test("copia vecchia ma non scaduta: serve subito la vecchia e rinnova in secondo piano", async () => {
  const s = setup(); await s.run(); s.advance(120e3);
  const r = await s.run();
  assert.equal(r.headers.get("x-cache"), "stale"); assert.deepEqual(await r.json(), { n: 1 }, "all'utente arriva la copia già pronta");
  await Promise.all(s.jobs); assert.equal(s.builds(), 2);
  s.advance(5e3); const r2 = await s.run(); assert.deepEqual(await r2.json(), { n: 2 });
});

test("se il rinnovo in secondo piano fallisce, resta la copia buona", async () => {
  const s = setup(); await s.run(); s.advance(120e3);
  const r = await s.run({ build: async () => { throw new Error("1102"); } });
  assert.equal(r.headers.get("x-cache"), "stale"); await Promise.all(s.jobs);
  s.advance(1e3); const again = await s.run({ build: async () => { throw new Error("1102"); } });
  assert.deepEqual(await again.json(), { n: 1 });
});

test("copia troppo vecchia o bypass: si ricalcola", async () => {
  const s = setup(); await s.run(); s.advance(31 * 60e3);
  const old = await s.run(); assert.equal(old.headers.get("x-cache"), "miss"); assert.deepEqual(await old.json(), { n: 2 });
  const fresh = await s.run({ extra: { bypass: true } }); assert.deepEqual(await fresh.json(), { n: 3 });
});

test("gli errori non si memorizzano e passano così come sono", async () => {
  const s = setup();
  const r = await s.run({ k: "?e", build: async () => new Response(JSON.stringify({ error: "x" }), { status: 503 }) });
  assert.equal(r.status, 503); assert.equal(s.cache.m.size, 0);
});

test("richieste contemporanee: un solo ricalcolo", async () => {
  const s = setup(); let calls = 0; const slow = async () => { calls += 1; await new Promise((r) => setTimeout(r, 20)); return okJson({ n: calls }); };
  const [a, b] = await Promise.all([s.run({ k: "?c", build: slow }), s.run({ k: "?c", build: slow })]);
  assert.equal(calls, 1); assert.deepEqual(await a.json(), await b.json());
});

test("senza Cache API (sviluppo locale) calcola e basta", async () => {
  let n = 0; const r = await edgeCached({ cache: undefined, keyUrl: "https://x.test/a", build: async () => { n += 1; return okJson(); } });
  assert.equal(r.status, 200); assert.equal(n, 1);
});
