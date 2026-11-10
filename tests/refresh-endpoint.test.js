import test from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../functions/api/refresh.js";

const base = { SUPABASE_URL: "https://sb.test", SUPABASE_SERVICE_ROLE_KEY: "sr", GH_REPO: "mario/stay-live", GH_DISPATCH_TOKEN: "ghp_secret" };
const post = (env) => onRequest({ request: new Request("https://app.test/api/refresh", { method: "POST" }), env });

function withFetch(handler, fn) { const real = globalThis.fetch; globalThis.fetch = handler; return fn().finally(() => { globalThis.fetch = real; }); }

test("aggiornamento manuale: non configurato = messaggio chiaro, nessuna chiamata", async () => {
  let calls = 0;
  await withFetch(async () => { calls += 1; return new Response("[]"); }, async () => {
    const r = await post({ SUPABASE_URL: "https://sb.test", SUPABASE_SERVICE_ROLE_KEY: "sr" });
    assert.equal(r.status, 503); assert.match((await r.json()).error, /GH_DISPATCH_TOKEN/); assert.equal(calls, 0);
  });
});

test("aggiornamento manuale: avvia il workflow, registra la richiesta, limita a una ogni 10 minuti, il token non esce", async () => {
  let last = null; const gh = [];
  const handler = async (url, opts = {}) => {
    const u = String(url);
    if (u.startsWith("https://api.github.com/")) { gh.push({ u, opts }); return new Response(null, { status: 204 }); }
    if ((opts.method ?? "GET") === "GET") return new Response(JSON.stringify(last ? [{ built_at: last }] : []), { headers: { "content-type": "application/json" } });
    last = JSON.parse(opts.body)[0].built_at; return new Response("[]", { status: 201 });
  };
  await withFetch(handler, async () => {
    const r1 = await post(base); const b1 = await r1.json();
    assert.equal(r1.status, 202); assert.equal(b1.ok, true);
    assert.equal(gh.length, 1); assert.match(gh[0].u, /repos\/mario\/stay-live\/actions\/workflows\/aggiornamento-completo\.yml\/dispatches/);
    assert.equal(gh[0].opts.headers.authorization, "Bearer ghp_secret"); assert.deepEqual(JSON.parse(gh[0].opts.body), { ref: "main" });
    assert.ok(!JSON.stringify(b1).includes("ghp_secret"));
    const r2 = await post(base);
    assert.equal(r2.status, 429); assert.equal(gh.length, 1, "seconda richiesta ravvicinata: GitHub non viene richiamato");
    const g = await onRequest({ request: new Request("https://app.test/api/refresh"), env: base }); const gj = await g.json();
    assert.equal(gj.configured, true); assert.ok(gj.lastRequestedAt); assert.ok(!JSON.stringify(gj).includes("ghp_secret"));
  });
});

test("aggiornamento manuale: errore di GitHub riportato senza esporre il token", async () => {
  await withFetch(async (url) => (String(url).startsWith("https://api.github.com/") ? new Response("Bad credentials", { status: 401 }) : new Response("[]")), async () => {
    const r = await post(base); const b = await r.json();
    assert.equal(r.status, 502); assert.match(b.error, /401/); assert.ok(!JSON.stringify(b).includes("ghp_secret"));
  });
});
