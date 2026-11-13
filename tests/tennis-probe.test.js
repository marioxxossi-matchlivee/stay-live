import test from "node:test";
import assert from "node:assert/strict";
import { shrink, redact, parsePaths, probeOne, DEFAULT_PATHS } from "../scripts/tennis-probe.js";

test("shrink: taglia gli elenchi, accorcia le stringhe, limita la profondità", () => {
  const s = shrink({ data: [1, 2, 3, 4], nome: "x".repeat(300), a: { b: { c: 1 } } });
  assert.equal(s.data._length, 4); assert.deepEqual(s.data._example, [1, 2]);
  assert.ok(s.nome.length < 130);
  assert.equal(shrink({ a: { b: 1 } }, { maxDepth: 1 }).a, "{…}");
  assert.deepEqual(shrink([1, 2]), [1, 2]);
});

test("redact: la chiave non resta mai nel testo", () => {
  assert.equal(redact("errore con chiave SEGRETO123 nel testo", "SEGRETO123"), "errore con chiave *** nel testo");
  assert.equal(redact("ok", undefined), "ok");
});

test("parsePaths: predefinito, separatori e rifiuto di percorsi pericolosi", () => {
  assert.deepEqual(parsePaths(""), DEFAULT_PATHS);
  assert.deepEqual(parsePaths("/a/b, /c\n/d"), ["/a/b", "/c", "/d"]);
  assert.throws(() => parsePaths("https://evil.example/x"));
  assert.throws(() => parsePaths("/a/../b"));
  assert.throws(() => parsePaths("senza-slash"));
});

test("probeOne: chiave solo nell'intestazione, mai nell'URL; errori e timeout senza segreti", async () => {
  let seen;
  const ok = await probeOne("K1", "/x", async (url, opt) => { seen = { url, opt }; return new Response(JSON.stringify({ list: [1, 2, 3] }), { status: 200 }); }, 1000, { base: "https://b.example/v1/tennis/" });
  assert.equal(ok.ok, true); assert.equal(seen.url, "https://b.example/v1/tennis/x");
  assert.equal(seen.opt.headers["X-Gravitee-Api-Key"], "K1"); assert.ok(!seen.url.includes("K1"));
  const err = await probeOne("K1", "/x", async () => new Response("chiave K1 non valida", { status: 403 }));
  assert.equal(err.ok, false); assert.ok(!JSON.stringify(err).includes("K1"));
  const net = await probeOne("K1", "/x", async () => { throw new Error("giù K1"); });
  assert.equal(net.status, 0); assert.ok(!JSON.stringify(net).includes("K1"));
});

test("nessun riferimento a RapidAPI nel codice, nei workflow e nella sonda", async () => {
  const fs = await import("node:fs");
  for (const f of ["../scripts/tennis-probe.js", "../.github/workflows/tennis-probe.yml", "../functions/api/_tennis-provider.js", "../functions/api/_tennis-client.js"]) {
    const txt = fs.readFileSync(new URL(f, import.meta.url), "utf8");
    assert.doesNotMatch(txt, /X-RapidAPI|rapidapi\.com|TENNIS_API_HOST|TENNIS_API_MODE/i, f);
  }
});
