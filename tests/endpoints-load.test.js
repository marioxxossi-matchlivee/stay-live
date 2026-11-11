import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Ogni endpoint deve almeno caricarsi: un errore di sintassi qui fa fallire il deploy su Cloudflare Pages, i test degli altri moduli non lo vedono.
const dir = path.resolve("functions/api");
for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".js"))) {
  test(`si carica: functions/api/${f}`, async () => {
    const mod = await import(pathToFileURL(path.join(dir, f)).href);
    assert.ok(mod && typeof mod === "object");
  });
}
