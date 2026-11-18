import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { itfShadowRule, itfShadowRow, computeItfShadow, simulateItfShadow, rowFromPrediction, diffPoints, isExcluded, ITF_SHADOW } from "../functions/api/_tennis-itf-shadow.js";
import { evaluateBet } from "../functions/api/_tennis-bet.js";
import { computePredictions, buildBook } from "../scripts/tennis-sync.js";
import { renderReport } from "../scripts/tennis-itf-shadow-report.js";

const NOW = Date.parse("2026-11-18T10:00:00Z"), H = 3600e3;
const fresh = new Date(NOW - 20 * 60e3).toISOString();
// quote Pinnacle p1/p2 → probabilità senza margine del lato 1 = (1/q1)/((1/q1)+(1/q2))
const base = (o = {}) => ({ category: "itf", pick: 1, p1: 0.6, p2: 0.4, oddsSources: [{ book: "Pinnacle", p1: 2.0, p2: 2.0 }], oddsFetchedAt: fresh, startsAt: new Date(NOW + 3 * H).toISOString(), status: "scheduled", now: NOW, ...o });
const withModel = (p, market) => base({ p1: p, p2: 1 - p, oddsSources: [{ book: "Pinnacle", p1: 1 / market, p2: 1 / (1 - market) }] });  // quote senza margine → mercato = market

test("soglia: sotto, uguale e sopra gli 8 punti assoluti", () => {
  assert.equal(itfShadowRule(withModel(0.57, 0.5)).outcome, "kept");      // +7
  assert.equal(itfShadowRule(withModel(0.58, 0.5)).outcome, "kept");      // +8 esatto: NON esclusa (serve > 8)
  assert.equal(itfShadowRule(withModel(0.581, 0.5)).outcome, "excluded"); // +8,1
  assert.equal(itfShadowRule(withModel(0.65, 0.5)).outcome, "excluded");
  assert.equal(itfShadowRule(withModel(0.45, 0.5)).outcome, "kept");      // modello SOTTO il mercato: mai esclusa
  assert.equal(diffPoints(0.58, 0.5), 8); assert.equal(isExcluded(8), false); assert.equal(isExcluded(8.000001), true);
});
test("punti percentuali ASSOLUTI, non incremento relativo dell'8%", () => {
  // 0,60 contro 0,5556: +4,4 punti = +8% relativo → resta mantenuta
  const r = itfShadowRule(withModel(0.6, 0.5556)); assert.equal(r.outcome, "kept"); assert.ok(r.diffPp < 5);
});
test("mercato senza margine, stessa selezione (anche pick = 2)", () => {
  const r = itfShadowRule(base({ pick: 2, p1: 0.3, p2: 0.7, oddsSources: [{ book: "Pinnacle", p1: 1.6, p2: 2.4 }] }));
  const nv2 = (1 / 2.4) / (1 / 1.6 + 1 / 2.4); assert.ok(Math.abs(r.marketProb - nv2) < 1e-5); assert.ok(Math.abs(r.diffPp - (0.7 - nv2) * 100) < 1e-3);
  assert.equal(r.oddsP1, 1.6); assert.equal(r.oddsP2, 2.4); assert.equal(r.oddsBook, "Pinnacle");
});
test("quote assenti, non valide, scadute, partita iniziata → non valutabile, mai inventate", () => {
  for (const o of [{ oddsSources: [] }, { oddsSources: undefined }, { oddsSources: [{ book: "X", p1: 1.0, p2: 2 }] }, { oddsSources: [{ book: "X", p1: "a", p2: 2 }] }, { oddsFetchedAt: new Date(NOW - 4 * H).toISOString() }, { oddsFetchedAt: null }, { status: "live" }, { startsAt: new Date(NOW - 60e3).toISOString() }, { pick: null }, { p1: 0.7, p2: 0.5 }]) {
    const r = itfShadowRule(base(o)); assert.equal(r.outcome, "not_evaluable", JSON.stringify(o)); assert.equal(r.diffPp, null); assert.ok(r.reason);
  }
});
test("solo ITF: ATP, WTA («tour»), Challenger e challenger_itf non hanno regola né riga", () => {
  for (const c of ["tour", "challenger", "challenger_itf", "unknown", null, undefined]) assert.equal(itfShadowRule(base({ category: c, p1: 0.9, p2: 0.1 })), null, String(c));
  const m = { match_key: "k", category: "challenger", starts_at: base().startsAt, status: "scheduled", odds_sources: base().oddsSources, odds_fetched_at: fresh };
  assert.equal(itfShadowRow(m, { pick: 1, p1: 0.9, p2: 0.1, bet: { verdict: "BET" } }, NOW), null);
});
test("riga shadow: campi richiesti, would_remove solo per BET attuali esclusi", () => {
  const m = { match_key: "k1", tour: "wta", category: "itf", tournament: "W15 Test", starts_at: base().startsAt, status: "scheduled", p1_name: "A", p2_name: "B", odds_sources: [{ book: "Pinnacle", p1: 1.6, p2: 2.4 }], odds_fetched_at: fresh };
  const pred = { pick: 1, p1: 0.75, p2: 0.25, surface: "hard", model_ver: "v", bet: { verdict: "BET" } };
  const r = itfShadowRow(m, pred, NOW);
  for (const k of ["match_key", "tournament", "category", "model_prob", "market_prob", "diff_pp", "outcome", "odds_p1", "odds_p2", "odds_at", "rule_ver", "current_verdict"]) assert.ok(k in r, k);
  assert.equal(r.outcome, "excluded"); assert.equal(r.would_remove, true); assert.equal(r.pick_name, "A");
  assert.equal(itfShadowRow(m, { ...pred, bet: { verdict: "EVITA" } }, NOW).would_remove, false);
});

// ── La strategia attuale non cambia: computePredictions identico, nessun input mutato ──
test("shadow attiva: pronostici e BET identici byte per byte; input non mutati", () => {
  const T = Date.parse("2025-01-01T00:00:00Z"), hist = [];
  for (let i = 0; i < 120; i++) hist.push({ t: T + i * 86400e3, winnerId: i % 3 ? "A" : "B", loserId: i % 3 ? "B" : "A", surface: "hard" });
  const book = buildBook(hist);
  const mk = (key, category) => ({ match_key: key, status: "scheduled", starts_at: new Date(NOW + 5 * H).toISOString(), tour: "atp", surface: "hard", category, tournament: "T", p1_id: "A", p2_id: "B", p1_name: "A", p2_name: "B", best_of: 3, odds_sources: [{ book: "Pinnacle", p1: 1.5, p2: 2.6 }, { book: "Marathonbet", p1: 1.55, p2: 2.5 }], odds_fetched_at: fresh });
  const matches = [mk("k-itf", "itf"), mk("k-ch", "challenger"), mk("k-tour", "tour"), mk("k-ci", "challenger_itf")];
  const args = { matches, book, stats: new Map(), ranks: new Map(), calibrator: null, now: NOW };
  const before = JSON.stringify(computePredictions(args));
  const rows = computePredictions(args), snapRows = JSON.stringify(rows), snapMatches = JSON.stringify(matches);
  const shadow = computeItfShadow({ matches, predictions: rows, now: NOW });
  assert.equal(JSON.stringify(rows), snapRows); assert.equal(JSON.stringify(matches), snapMatches); assert.equal(JSON.stringify(computePredictions(args)), before);
  assert.deepEqual(shadow.map((s) => s.match_key), ["k-itf"]);                        // solo l'ITF produce una riga
  assert.deepEqual(rows.map((r) => r.bet.verdict), computePredictions(args).map((r) => r.bet.verdict));
});
test("il verdetto BET attuale non dipende dal filtro ITF (evaluateBet invariato)", () => {
  const pred = { published: true, pick: 1, p1: 0.62, p2: 0.38, reliability: "alta" };
  const m = { status: "scheduled", startsAt: base().startsAt, oddsSources: [{ book: "Pinnacle", p1: 1.9, p2: 1.95 }], oddsFetchedAt: fresh };
  const a = evaluateBet(m, pred, { now: NOW, category: "itf" }), b = evaluateBet(m, pred, { now: NOW, category: "itf" });
  assert.deepEqual(a, b); assert.equal(a.verdict, "BET");                              // l'ITF con scarto ≈ +10 punti resta BET: lo shadow non lo tocca
  assert.equal(itfShadowRule({ ...base({ p1: 0.62, p2: 0.38 }), oddsSources: m.oddsSources }).outcome, "excluded");
});
test("nessun consumo di crediti: moduli senza rete, solo lettura", () => {
  for (const f of ["../functions/api/_tennis-itf-shadow.js", "../scripts/tennis-itf-shadow-report.js"]) {
    const src = fs.readFileSync(new URL(f, import.meta.url), "utf8");
    assert.ok(!/_tennis-client|createClient|fetch\(|TENNIS_API_KEY|api\.get/.test(src.replace(/\/\/.*$/gm, "")), f);
  }
  assert.ok(!/upsert|\.patch\(|\.del\(/.test(fs.readFileSync(new URL("../scripts/tennis-itf-shadow-report.js", import.meta.url), "utf8").replace(/\/\/.*$/gm, "")));
});
test("migrazione shadow: additiva, solo ITF, RLS, congelamento, nessuna tabella esistente toccata", () => {
  const sql = fs.readFileSync(new URL("../supabase/migrations/202611180001_tennis_itf_shadow.sql", import.meta.url), "utf8"), code = sql.replace(/--.*$/gm, "");
  assert.ok(!/drop\s+table|truncate|delete\s+from|alter\s+table\s+public\.tennis_predictions/i.test(code));
  assert.match(code, /category = 'itf'/); assert.match(code, /enable row level security/); assert.match(code, /tennis_itf_shadow_freeze/); assert.ok(!/create or replace function public\.tennis_predictions_freeze/.test(code));
});

// ── Confronto retroattivo ──
const pr = (i, { cat = "itf", p, implied, odds, win, oddsAt, verdict = "BET", status = "finished" }) => ({ match_key: "m" + i, starts_at: new Date(NOW - (100 - i) * H).toISOString(), published: true, pick: 1, p1: p, p2: 1 - p, odds_at: null, bet: { verdict, odds, implied, ev: p * odds - 1, oddsAt: oddsAt ?? new Date(NOW - (100 - i) * H - 3 * H).toISOString() }, tennis_matches: { status, winner: win ? 1 : 2, category: cat } });
test("simulazione A/B: escluse vs mantenute, ROI, quote medie, numeri esatti", () => {
  const rows = [
    pr(1, { p: 0.70, implied: 0.55, odds: 1.8, win: false }),   // ITF scarto 15 → esclusa, persa
    pr(2, { p: 0.66, implied: 0.55, odds: 1.8, win: false }),   // 11 → esclusa, persa
    pr(3, { p: 0.60, implied: 0.55, odds: 1.8, win: true }),    // 5 → mantenuta, vinta
    pr(4, { p: 0.58, implied: 0.50, odds: 2.0, win: true }),    // 8 esatto → mantenuta, vinta
    pr(5, { cat: "tour", p: 0.75, implied: 0.55, odds: 1.7, win: false }), // ATP con scarto 20: mai toccata dal filtro
    pr(6, { cat: "challenger", p: 0.70, implied: 0.55, odds: 1.8, win: true }),
  ].map(rowFromPrediction);
  const s = simulateItfShadow(rows);
  assert.equal(s.A.bets, 6); assert.equal(s.B.bets, 4); assert.equal(s.delta.bets, -2);
  assert.equal(s.itf.excluded.bets, 2); assert.equal(s.itf.excluded.wins, 0); assert.equal(s.itf.kept.bets, 2); assert.equal(s.itf.kept.wins, 2);
  assert.ok(Math.abs(s.A.profit - (-1 - 1 + 0.8 + 1 - 1 + 0.8)) < 1e-9); assert.ok(Math.abs(s.B.profit - (0.8 + 1 - 1 + 0.8)) < 1e-9);
  assert.ok(s.B.roi > s.A.roi); assert.equal(s.itf.excluded.avgOdds, 1.8);
  assert.match(s.verdict, /Non conclusivo/);                                   // pochi casi: nessun miglioramento dichiarato
  assert.equal(s.itfReliabilityByGap.gt8.n, 2);
});
test("senza dati futuri: quote lette dopo l'inizio scartate; ritirate e in attesa non contate", () => {
  const late = pr(1, { p: 0.7, implied: 0.55, odds: 1.8, win: true, oddsAt: new Date(NOW + 1 * H).toISOString() });
  const ret = pr(2, { p: 0.7, implied: 0.55, odds: 1.8, win: true, status: "ended_other" }), pend = pr(3, { p: 0.7, implied: 0.55, odds: 1.8, win: true, status: "scheduled" });
  const s = simulateItfShadow([late, ret, pend].map(rowFromPrediction));
  assert.equal(s.rejectedAfterStart, 1); assert.equal(s.A.bets, 0); assert.equal(s.voided, 1); assert.equal(s.pending, 1);
});
test("verdetto: con campione adeguato e escluse peggiori → evidenza; altrimenti non dimostrato", () => {
  const mkRows = (exW, keW) => [...Array.from({ length: 40 }, (_, i) => pr(i, { p: 0.7, implied: 0.55, odds: 1.8, win: i < exW })), ...Array.from({ length: 40 }, (_, i) => pr(100 + i, { p: 0.6, implied: 0.55, odds: 1.8, win: i < keW }))].map(rowFromPrediction);
  assert.match(simulateItfShadow(mkRows(8, 30)).verdict, /rendono peggio/);
  assert.match(simulateItfShadow(mkRows(20, 20)).verdict, /non è dimostrato|non distinguibile/);
  assert.match(simulateItfShadow(mkRows(2, 2)).verdict, /Non conclusivo|rendono|non distinguibile/);
});
test("report Markdown: dichiara soglia, gruppi e valutazione", () => {
  const md = renderReport(simulateItfShadow([]), { title: "T" });
  assert.match(md, /> 8 punti percentuali/); assert.match(md, /Valutazione/); assert.match(md, /Non conclusivo/); assert.equal(ITF_SHADOW.mode, "shadow");
});
