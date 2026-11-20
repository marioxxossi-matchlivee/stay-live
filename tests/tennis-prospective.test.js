import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildForecastRecord, validateForecastRecord, settleForecastRecord, ratingsVersion } from "../scripts/tennis-prospective-record.js";

const match = { match_key: "k1", p1_id: "a", p2_id: "b", starts_at: "2026-11-20T12:00:00Z" };
const quote = { odds1: 1.8, odds2: 2.1, bookmaker: "X", source: "feed", quotedAt: "2026-11-20T08:00:00Z" };
const mk = (o = {}) => buildForecastRecord({ match, p1: 0.58, published: true, modelVersion: "m1", ratings: { historyMatches: 96489, lastMatchAt: "2026-11-19", loader: "offset" }, predictedAt: "2026-11-20T09:00:00Z", quote, ...o });

test("record valido: quota normalizzata senza margine, versione dei rating, nessun esito", () => {
  const r = mk(); assert.deepEqual(validateForecastRecord(r), []); assert.ok(Math.abs(r.market.noVigP1 - (1 / 1.8) / (1 / 1.8 + 1 / 2.1)) < 1e-12); assert.ok(r.market.margin > 0); assert.equal(r.outcome, null);
  assert.equal(r.ratingsVersion, ratingsVersion({ historyMatches: 96489, lastMatchAt: "2026-11-19", loader: "offset" })); assert.notEqual(r.ratingsVersion, ratingsVersion({ historyMatches: 80000, lastMatchAt: "2026-09-25", loader: "offset" }));
});
test("disallineamento temporale: quota successiva alla previsione, previsione a partita iniziata, campi mancanti", () => {
  assert.match(validateForecastRecord(mk({ quote: { ...quote, quotedAt: "2026-11-20T09:30:00Z" } })).join(), /quota successiva/);
  assert.match(validateForecastRecord(mk({ predictedAt: "2026-11-20T12:00:01Z" })).join(), /look-ahead/);
  assert.match(validateForecastRecord(mk({ quote: { ...quote, quotedAt: undefined } })).join(), /senza timestamp/);
  assert.match(validateForecastRecord(mk({ quote: { odds1: 1.8, odds2: 2.1, quotedAt: "2026-11-20T08:00:00Z" } })).join(), /senza fonte/);
  assert.match(validateForecastRecord({ ...mk(), modelVersion: "" }).join(), /modelVersion/);
});
test("astensione registrata senza probabilità; probabilità valorizzata su una astensione è un errore", () => {
  const r = mk({ published: false, p1: 0.6 }); assert.equal(r.p1, null); assert.deepEqual(validateForecastRecord(r), []); assert.match(validateForecastRecord({ ...r, p1: 0.6 }).join(), /non pubblicata/);
});
test("chiusura: aggiunge quota di chiusura ed esito senza toccare la previsione; l'esito non si riscrive; esito prima dell'inizio rifiutato", () => {
  const r = mk(), s = settleForecastRecord(r, { winner: 1, settledAt: "2026-11-20T15:00:00Z", closing: { odds1: 1.7, odds2: 2.2, at: "2026-11-20T11:55:00Z" } });
  assert.equal(s.p1, r.p1); assert.equal(s.predictedAt, r.predictedAt); assert.deepEqual(s.market, r.market); assert.equal(s.outcome, 1); assert.equal(r.outcome, null);
  assert.throws(() => settleForecastRecord(s, { winner: 2, settledAt: "2026-11-20T16:00:00Z" }), /non si riscrive/);
  assert.throws(() => settleForecastRecord(r, { winner: 1, settledAt: "2026-11-20T10:00:00Z" }), /prima dell'inizio/);
});
test("nessuna struttura remota: nessun file in supabase/ né nel codice crea tennis_forecast_log; il modulo non è importato dal motore", () => {
  const walk = (d, out = []) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { if (["node_modules", ".git", "tests", "docs"].includes(f.name)) continue; const p = `${d}/${f.name}`; if (f.isDirectory()) walk(p, out); else if (fs.readFileSync(p, "utf8").includes("tennis_forecast_log") || fs.readFileSync(p, "utf8").includes("tennis-prospective-record")) out.push(p); } return out; };
  assert.deepEqual(walk(".").filter((p) => !p.endsWith("scripts/tennis-prospective-record.js")), []);
});
