import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { evaluateHealth, renderHealth } from "../scripts/tennis-history-monitor.js";
import { fingerprintRows } from "../scripts/tennis-history-shadow.js";

const NOW = Date.parse("2026-11-19T12:00:00Z");
const mk = (n, { stepH = 1, endAgoH = 2 } = {}) => Array.from({ length: n }, (_, i) => ({ match_key: `k${String(i).padStart(6, "0")}`, winner: 1, p1_id: `a${i % 50}`, p2_id: `b${i % 50}`, starts_at: new Date(NOW - endAgoH * 3600e3 - (n - 1 - i) * stepH * 3600e3).toISOString() }));
const base = (rows, extra = {}) => ({ rows, pages: Math.ceil(rows.length / 1000), duplicates: 0, truncated: false, dbCount: rows.length, secondFingerprint: fingerprintRows(rows), nowMs: NOW, loader: "keyset", ...extra });
const level = (h, id) => h.checks.find((c) => c.id === id).level;

test("caricamento completo e coerente: OK", () => { const h = evaluateHealth(base(mk(500))); assert.equal(h.status, "OK"); assert.ok(h.checks.every((c) => c.level === "ok")); });
test("conteggio diverso dal database: INCOMPLETO (oltre la tolleranza) o ATTENZIONE (aggiornamento in corso)", () => {
  const rows = mk(500); assert.equal(evaluateHealth(base(rows, { dbCount: 600 })).status, "INCOMPLETO"); assert.equal(level(evaluateHealth(base(rows, { dbCount: 510 })), "conteggio"), "attenzione");
  assert.equal(level(evaluateHealth(base(rows, { dbCount: null })), "conteggio"), "attenzione");
});
test("troncamento o errore di paginazione: INCOMPLETO con messaggio esplicito", () => {
  assert.equal(evaluateHealth(base(mk(50), { truncated: true })).status, "INCOMPLETO");
  const h = evaluateHealth({ error: "Storico: errore alla pagina 3: HTTP 503", nowMs: NOW }); assert.equal(h.status, "INCOMPLETO"); assert.match(h.checks[0].detail, /pagina 3/);
});
test("duplicati, righe senza vincitore valido, buchi temporali, riproducibilità diversa: ATTENZIONE", () => {
  assert.equal(level(evaluateHealth(base(mk(50), { duplicates: 3 })), "duplicati"), "attenzione");
  const bad = mk(50); bad[5].winner = 3; assert.equal(level(evaluateHealth(base(bad)), "concluse valide"), "attenzione");
  assert.equal(level(evaluateHealth(base(mk(50, { stepH: 24 * 9 }))), "buchi temporali"), "attenzione");
  assert.equal(level(evaluateHealth(base(mk(50), { secondFingerprint: "x" })), "riproducibilità"), "attenzione");
  assert.equal(level(evaluateHealth(base(mk(50), { secondFingerprint: null })), "riproducibilità"), "attenzione");
});
test("dati vecchi: oltre 48 ore ATTENZIONE, oltre 120 ore INCOMPLETO", () => {
  assert.equal(level(evaluateHealth(base(mk(50, { endAgoH: 60 }))), "ultima data"), "attenzione"); assert.equal(evaluateHealth(base(mk(50, { endAgoH: 130 }))).status, "INCOMPLETO");
});
test("giocatori sconosciuti tra le partite in programma e percorso operativo ancora a offset", () => {
  const rows = mk(200), known = new Set(rows.flatMap((r) => [r.p1_id, r.p2_id]));
  const ok = evaluateHealth(base(rows, { scheduledIds: new Set(["a1", "b2"]), knownIds: known })); assert.equal(level(ok, "giocatori sconosciuti"), "ok");
  const bad = evaluateHealth(base(rows, { scheduledIds: new Set(["a1", "zz1", "zz2", "zz3"]), knownIds: known })); assert.equal(level(bad, "giocatori sconosciuti"), "attenzione"); assert.match(bad.checks.find((c) => c.id === "giocatori sconosciuti").detail, /3 giocatori su 4/);
  const op = evaluateHealth(base(mk(300), { loader: "offset", cap: 100 })); assert.equal(level(op, "percorso operativo"), "attenzione"); assert.match(op.checks.find((c) => c.id === "percorso operativo").detail, /ne ignora 200/);
  assert.equal(level(evaluateHealth(base(mk(300), { loader: "keyset", cap: 100 })), "percorso operativo"), "ok");
});
test("il report dichiara l'esito e il workflow è di sola lettura, con avvio programmato e fallimento solo su INCOMPLETO", () => {
  assert.match(renderHealth(evaluateHealth(base(mk(50, { endAgoH: 130 }))), "x"), /INCOMPLETO/);
  const wf = fs.readFileSync(".github/workflows/tennis-history-monitor.yml", "utf8"); assert.ok(/schedule:/.test(wf) && /contents: read/.test(wf) && !/TENNIS_API_KEY|db push|migration/i.test(wf));
  const src = fs.readFileSync("scripts/tennis-history-monitor.js", "utf8").replace(/\/\*[\s\S]*?\*\//g, ""); assert.ok(!/supabaseUpsert|supabasePatch|supabaseDelete|makeDb|\.rpc\(|method: "(POST|PATCH|PUT|DELETE)"/.test(src));
});
