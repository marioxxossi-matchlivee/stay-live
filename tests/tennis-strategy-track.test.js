import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildStrategy } from "../functions/api/_tennis-strategy.js";
import { planRecords, settleLeg, settleDouble, buildStrategyHistory, recordedBeforeStart } from "../functions/api/_tennis-strategy-track.js";
import { recordStrategy, loadStrategyHistory } from "../scripts/tennis-sync.js";

const NOW = Date.parse("2026-11-17T10:00:00Z"), H = 3600e3;
const bt = { published: 800, summary: { n: 800, calibration: [{ from: 0.65, to: 0.7, n: 200, meanP: 0.675, hitRate: 0.67 }] }, byTour: { atp: { n: 400 }, wta: { n: 400 } }, bySurface: { hard: { n: 500 } } };
const mk = (key, hours = 5) => ({ key, tour: "atp", tournament: "T", category: "tour", court: "hard", status: "scheduled", startsAt: new Date(NOW + hours * H).toISOString(), p1: { id: "a" + key, name: "A" + key }, p2: { id: "b" + key, name: "B" + key },
  prediction: { published: true, pick: 1, p1: 0.66, p2: 0.34, reliability: "alta", reasons: [], missing: [], components: {}, modelVersion: "tennis-v2" }, odds: { p1: 1.7, p2: 2.2, source: "Pinnacle", at: new Date(NOW - 600e3).toISOString(), sources: [{ book: "Pinnacle", p1: 1.7, p2: 2.2 }] } });
const strat = () => buildStrategy([mk("a"), mk("b", 6), mk("c", 7)], { range: "d7", now: NOW, calibration: bt });
const empty = () => ({ pickKeys: new Set(), doubleLegKeys: new Set(), doublePairs: new Set() });

test("registrazione: solo prima dell'inizio, una volta per partita, quote lette prima", () => {
  const s = strat(), r = planRecords(s, empty(), NOW);
  assert.equal(r.picks.length, s.selected.length); assert.ok(r.picks.every((p) => Date.parse(p.odds_at) < Date.parse(p.starts_at) && p.stake_units === 1 && p.engine_ver));
  const again = planRecords(s, { ...empty(), pickKeys: new Set(r.picks.map((p) => p.match_key)) }, NOW); assert.equal(again.picks.length, 0);   // immutabile: nessuna seconda registrazione
  const late = planRecords(s, empty(), NOW + 8 * H); assert.equal(late.picks.length, 0);                                                              // dopo l'inizio non si registra
  assert.ok(r.doubles.length <= 1); for (const d of r.doubles) assert.ok(d.leg1_match_key !== d.leg2_match_key);
});
test("nessuna doppia registrata se non consigliata o se una gamba è già in una doppia", () => {
  const s = strat(); const r = planRecords(s, empty(), NOW);
  assert.equal(r.doubles.length, s.double.status === "recommended" ? 1 : 0);
  if (s.double.status === "recommended") assert.equal(planRecords(s, { ...empty(), doubleLegKeys: new Set([s.double.legs[0].key]) }, NOW).doubles.length, 0);
});
test("esiti: vinta, persa, ritiro non conteggiato, doppia persa se una gamba perde", () => {
  assert.deepEqual(settleLeg(1, 1.7, { status: "finished", winner: 1 }), { state: "won", won: true, profit: 0.7 });
  assert.equal(settleLeg(1, 1.7, { status: "finished", winner: 2 }).profit, -1);
  assert.equal(settleLeg(1, 1.7, { status: "ended_other", winner: null }).state, "void");
  assert.equal(settleLeg(1, 1.7, { status: "scheduled" }).state, "pending");
  const rec = { leg1_side: 1, leg1_odds: 1.7, leg2_side: 2, leg2_odds: 2, total_odds: 3.4 };
  assert.equal(settleDouble(rec, { status: "finished", winner: 2 }, { status: "scheduled" }).state, "lost");
  assert.ok(Math.abs(settleDouble(rec, { status: "finished", winner: 1 }, { status: "finished", winner: 2 }).profit - 2.4) < 1e-9);
});
test("storico: ROI a puntata unitaria, campione piccolo senza conclusioni, righe non valide escluse (no data leakage)", () => {
  const s = strat(), r = planRecords(s, empty(), NOW), matches = new Map(r.picks.map((p, i) => [p.match_key, { status: "finished", winner: i === 0 ? 2 : 1, score: "6-4" }]));
  const h = buildStrategyHistory({ picks: r.picks, doubles: [], matches });
  assert.equal(h.singles.settled, r.picks.length); assert.match(h.singles.verdict, /Campione in costruzione/);
  const wins = r.picks.slice(1).reduce((t, p) => t + (p.odds - 1), 0); assert.ok(Math.abs(h.singles.profit - (wins - 1)) < 0.01);
  const bad = { ...r.picks[0], created_at: new Date(NOW + 9 * H).toISOString() };   // registrata dopo l'inizio = ricostruzione a posteriori
  assert.equal(recordedBeforeStart(bad.created_at, [bad.odds_at], bad.starts_at), false);
  const h2 = buildStrategyHistory({ picks: [bad], doubles: [], matches: new Map([[bad.match_key, { status: "finished", winner: 1 }]]) });
  assert.equal(h2.singles.settled, 0); assert.equal(h2.rejected, 1);
});
test("migrazione: additiva, RLS, trigger di congelamento, nessuna cancellazione", () => {
  const sql = fs.readFileSync(new URL("../supabase/migrations/202611170001_tennis_strategy.sql", import.meta.url), "utf8");
  assert.ok(!/drop\s+table|truncate|delete\s+from/i.test(sql)); assert.equal((sql.match(/enable row level security/g) ?? []).length, 3);
  for (const t of ["runs", "picks", "doubles"]) assert.match(sql, new RegExp(`tennis_strategy_${t}`));
  assert.match(sql, /create table if not exists public\.tennis_strategy_picks/); assert.ok(!/tennis_predictions_freeze/.test(sql.replace(/--.*$/gm, "")));
});

function fakeDb() {
  const t = {};
  const tab = (n) => (t[n] ??= []);
  return { t, async getAll(table, q = {}) { return tab(table).map((r) => ({ ...r })); }, async upsert(table, rows, conflict) { const ks = conflict.split(","); for (const r of rows) { const i = tab(table).findIndex((x) => ks.every((k) => x[k] === r[k])); if (i < 0) tab(table).push({ ...r }); /* il trigger ignora gli UPDATE */ } } };
}
test("recordStrategy: scrive run e giocate una sola volta (rieseguibile)", async () => {
  const db = fakeDb(), payload = { matches: [mk("a"), mk("b", 6)], history: { backtest: bt } };
  const meta = {}; await recordStrategy(db, payload, NOW, meta); const n = db.t.tennis_strategy_picks.length;
  assert.ok(n >= 1); assert.equal(db.t.tennis_strategy_runs.length, 1); assert.equal(meta.strategy.newPicks, n);
  await recordStrategy(db, payload, NOW + 60e3, {}); assert.equal(db.t.tennis_strategy_picks.length, n);
  const h = await loadStrategyHistory(db); assert.equal(h.total.singles, n);
});

// L'interfaccia «Strategia» (valore atteso, doppie, capitale) è stata sostituita dal cruscotto statistico: vedi tests/tennis-strategy-dashboard.test.js.
