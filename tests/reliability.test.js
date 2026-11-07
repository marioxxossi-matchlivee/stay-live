import test from "node:test";
import assert from "node:assert/strict";
import { reliabilityFrom } from "../functions/api/_reliability.js";
import { legRows, modelVersion, predictionRow } from "../functions/api/_predictions.js";
import { MODEL } from "../functions/api/model.js";
import { bucket, calibrationBuckets, reliabilityHtml, wilson } from "../src/efficiency.js";

const r = (id, key, hs, as, o = {}) => ({ game_id: id, sel_key: key, verdict: "BET", p: 0.7, p_low: 0.6, odds: null, basis: "storico", model_ver: "v1", status: "final", home_score: hs, away_score: as, decided_in: null, kickoff_at: "2026-11-01T18:00:00Z", ...o });

test("conta solo i BET conclusi della versione indicata; EVITA, annullate e da giocare restano fuori", () => {
  const rows = [r("a", "over25", 2, 1), r("b", "over25", 0, 0), r("c", "btts", 1, 1, { odds: 2 }), r("d", "over25", 3, 0, { verdict: "EVITA" }),
    r("e", "over25", null, null, { status: "scheduled", home_score: null, away_score: null }), r("f", "over25", 1, 0, { status: "canceled" }), r("g", "over25", 3, 3, { model_ver: "v0" })];
  const x = reliabilityFrom(rows, { ver: "v1" });
  assert.deepEqual([x.total.n, x.total.won, x.total.lost], [3, 2, 1]);
  assert.equal(x.pending, 1); assert.equal(x.olderVersions, 1);
  assert.equal(reliabilityFrom(rows).total.n, 4);                       // senza filtro anche la versione vecchia
  assert.ok(Math.abs(x.total.expected - 0.7) < 1e-9 && Math.abs(x.total.floor - 0.6) < 1e-9);
});
test("partite decise ai supplementari o ai rigori non contano", () => {
  assert.equal(reliabilityFrom([r("a", "over25", 3, 2, { decided_in: "extra_time" })], {}).total.n, 0);
});
test("rendimento solo dove c'è una quota reale", () => {
  const b = bucket([{ status: "won", odds: 2, p: 0.6 }, { status: "lost", odds: 2, p: 0.6 }, { status: "won", odds: null, p: 0.6 }]);
  assert.equal(b.roiN, 2); assert.equal(b.roi, 0);
});
test("intervallo di Wilson: campione piccolo = intervallo largo", () => {
  const small = wilson(3, 5), big = wilson(300, 500);
  assert.ok(small.hi - small.lo > 0.4); assert.ok(big.hi - big.lo < 0.1);
  assert.equal(wilson(0, 0), null);
});
test("taratura: fasce per probabilità dichiarata", () => {
  const legs = [{ status: "won", p: 0.65 }, { status: "lost", p: 0.62 }, { status: "won", p: 0.85 }];
  const c = calibrationBuckets(legs);
  assert.deepEqual(c.map((b) => b.n), [2, 1]);
});
test("scheda vuota e scheda con dati senza errori", () => {
  const fmt = { esc: String, pct: (x) => `${Math.round(x * 100)}%` };
  assert.match(reliabilityHtml(reliabilityFrom([], {}), fmt), /Nessun BET ancora concluso/);
  assert.match(reliabilityHtml(reliabilityFrom([r("a", "over25", 2, 1)], { ver: "v1" }), fmt), /BET centrati su 1/);
});

const analysis = (o = {}) => ({ confidence: "media", basis: "api", sample: 8, n: 8, pick: { key: "over25", p: 0.7, pLow: 0.62, pModel: 0.66, pApi: 0.7, pMarket: null, verdict: "BET", odds: { median: 1.9 } }, ...o });
test("riga registrata: solo prima del calcio d'inizio e con campione sufficiente", () => {
  const now = Date.parse("2026-11-08T10:00:00Z");
  const m = { game_id: "x1", league: "seriea", status: "scheduled", kickoff_at: "2026-11-08T19:45:00Z" };
  const row = predictionRow(m, analysis(), { now, ver: "v1" });
  assert.equal(row.sel_key, "over25"); assert.equal(row.odds, 1.9); assert.equal(row.verdict, "BET"); assert.equal(row.model_ver, "v1");
  assert.equal(predictionRow({ ...m, kickoff_at: "2026-11-08T09:00:00Z" }, analysis(), { now }), null);   // già iniziata
  assert.equal(predictionRow({ ...m, status: "final" }, analysis(), { now }), null);
  assert.equal(predictionRow(m, analysis({ confidence: "insufficiente" }), { now }), null);
  assert.equal(predictionRow(m, analysis({ pick: null }), { now }), null);
});
test("la versione del modello cambia se cambia un parametro che influisce sui pronostici", () => {
  const v = modelVersion();
  assert.equal(v, modelVersion());
  assert.notEqual(v, modelVersion({ ...MODEL, betThreshold: 0.65 }));
  assert.equal(v, modelVersion({ ...MODEL, kellyFraction: 0.5 }));       // le puntate non cambiano i pronostici
});

test("righe di tutti i mercati: una per selezione, con le tre fonti, solo prima del calcio d'inizio", () => {
  const now = Date.parse("2026-11-08T10:00:00Z");
  const m = { game_id: "x1", league: "seriea", status: "scheduled", kickoff_at: "2026-11-08T19:45:00Z" };
  const sel = (key, extra = {}) => ({ key, p: 0.5, pLow: 0.4, pModel: 0.48, pApi: 0.52, pMarket: null, verdict: "EVITA", odds: null, ...extra });
  const a = analysis({ selections: [sel("over25", { odds: { median: 1.9 }, pMarket: 0.51 }), sel("under25"), sel("btts")], fusion: { books: 7 } });
  const rows = legRows(m, a, { now, ver: "v1" });
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.sel_key), ["over25", "under25", "btts"]);
  assert.equal(rows[0].odds, 1.9); assert.equal(rows[0].p_market, 0.51); assert.equal(rows[1].odds, null); assert.equal(rows[0].n_books, 7); assert.equal(rows[0].model_ver, "v1");
  assert.deepEqual(legRows({ ...m, kickoff_at: "2026-11-08T09:00:00Z" }, a, { now }), []);   // già iniziata
  assert.deepEqual(legRows({ ...m, status: "final" }, a, { now }), []);
  assert.deepEqual(legRows(m, { ...a, confidence: "insufficiente" }, { now }), []);
  assert.deepEqual(legRows(m, analysis({ selections: [] }), { now }), []);
});
