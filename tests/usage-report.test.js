import test from "node:test";
import assert from "node:assert/strict";
import { reportMarkdown, usageReport } from "../scripts/usage-report.js";

const now = Date.parse("2026-11-14T13:00:00Z");
const run = (h, mode, requests, status = "ok") => ({ mode, status, started_at: `2026-11-14T${String(h).padStart(2, "0")}:10:00Z`, meta: { requests: { thisRun: requests, remaining: 100 }, notes: [] } });

test("ripartizione dei crediti: completo, recupero, app e altro", () => {
  const runs = [run(0, "full", 900), run(4, "full", 900), ...Array.from({ length: 12 }, (_, i) => run(1 + i % 3, "recover", 250, "partial"))];
  const r = usageReport({ usage: [{ day: "2026-11-14", requests: 5500, limit_day: 7500, remaining: 2000 }], runs, cache: [{ endpoint: "odds?fixture=1", fetched_at: "2026-11-14T09:00:00Z" }, { endpoint: "odds?fixture=2", fetched_at: "2026-11-14T09:05:00Z" }, { endpoint: "injuries", fetched_at: "2026-11-13T01:00:00Z" }], tasks: [{ component: "corners", state: "temporary", attempts: 8 }], now });
  assert.equal(r.byMode.full.requests, 1800); assert.equal(r.byMode.recover.requests, 3000); assert.equal(r.byMode.recover.partial, 12);
  assert.equal(r.other, 700); assert.deepEqual(r.endpoints, { odds: 2 });
  assert.ok(r.findings.some((f) => /recupero automatico/.test(f)), "segnala il recupero che consuma troppo");
  assert.ok(r.findings.some((f) => /8 tentativi/.test(f)));
  const md = reportMarkdown(r);
  assert.match(md, /Recupero \(ogni 30 min\)/); assert.match(md, /App e altro/); assert.match(md, /Cosa emerge/);
});
test("senza dati di oggi il rapporto non inventa nulla", () => {
  const r = usageReport({ now });
  assert.equal(r.total, null); assert.equal(r.other, null);
  assert.match(reportMarkdown(r), /Nessun contatore per oggi/);
});

test("un recupero enorme al primo giro del giorno viene segnalato come tale", () => {
  const r = usageReport({ usage: [{ day: "2026-11-14", requests: 3000, limit_day: 7500, remaining: 4500 }], runs: [{ ...run(0, "recover", 2185, "partial"), started_at: "2026-11-14T00:43:00Z" }, run(4, "full", 800)], now });
  assert.ok(r.findings.some((f) => /00:43/.test(f) && /2185/.test(f) && /mezzanotte/.test(f)));
});
