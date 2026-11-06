import test from "node:test";
import assert from "node:assert/strict";
import { MODEL } from "../functions/api/model.js";
import { MIN_BETS_FOR_CLAIM, applyPlatt, bettingSummary, brier, calibration, classification, fitPlatt, logLoss } from "../scripts/metrics.js";
import { evaluate, normalize, parseRows, predict, withModel } from "../scripts/backtest.js";

function synthetic(rounds = 40, teams = 12, seed = 7) {
  let s = seed; const rnd = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
  const pois = (l) => { const L = Math.exp(-l); let k = 0, p = 1; do { k += 1; p *= rnd(); } while (p > L); return k - 1; };
  const att = Array.from({ length: teams }, () => 0.7 + rnd() * 0.8), def = Array.from({ length: teams }, () => 0.7 + rnd() * 0.8);
  const rows = []; let t = Date.parse("2024-08-01T15:00:00Z");
  for (let r = 0; r < rounds; r += 1) { for (let i = 0; i < teams; i += 2) {
    const h = (i + r) % teams, a = (i + 1 + 3 * r) % teams; if (h === a) continue;
    rows.push({ league: "seriea", kickoff_at: new Date(t).toISOString(), home_id: `t${h}`, away_id: `t${a}`, home_name: `T${h}`, away_name: `T${a}`, home_score: pois(1.4 * att[h] * def[a]), away_score: pois(1.1 * att[a] * def[h]), neutral_site: false });
  } t += 2 * 864e5; }
  return rows;
}

test("metriche: valori noti", () => {
  assert.ok(Math.abs(brier([0.8, 0.2], [1, 0]) - 0.04) < 1e-12);
  assert.ok(Math.abs(logLoss([0.5, 0.5], [1, 0]) - Math.log(2)) < 1e-12);
  assert.ok(logLoss([1, 0], [1, 0]) < 1e-9, "previsione perfetta: log loss ~ 0 (mai infinito)");
  const c = calibration([0.1, 0.1, 0.9, 0.9], [0, 0, 1, 1]);
  assert.ok(Math.abs(c.ece - 0.1) < 1e-12);
  const k = classification([0.9, 0.8, 0.2, 0.3], [1, 0, 1, 0]);
  assert.deepEqual([k.accuracy, k.precision, k.recall], [0.5, 0.5, 0.5]);
});

test("giocate: ROI, drawdown massimo, campione insufficiente = non dimostrato", () => {
  const s = bettingSummary([{ stake: 1, profit: 1, odds: 2 }, { stake: 1, profit: -1, odds: 2 }, { stake: 1, profit: -1, odds: 2 }, { stake: 1, profit: 1.5, odds: 2.5 }]);
  assert.equal(s.n, 4); assert.ok(Math.abs(s.roi - 0.125) < 1e-12); assert.equal(s.maxDrawdown, 2);
  assert.equal(s.adequate, false, "4 giocate non dimostrano nulla");
  const many = bettingSummary(Array.from({ length: MIN_BETS_FOR_CLAIM }, (_, i) => ({ stake: 1, profit: i % 2 ? -1 : 1.2, odds: 2.2 })));
  assert.equal(many.n, MIN_BETS_FOR_CLAIM);
  assert.equal(bettingSummary([]).n, 0);
});

test("Platt: su probabilità già calibrate non peggiora; corregge un eccesso di fiducia", () => {
  let s = 99; const rnd = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
  const ps = Array.from({ length: 4000 }, () => 0.05 + 0.9 * rnd()), ys = ps.map((p) => +(rnd() < p));
  const ok = fitPlatt(ps, ys);
  assert.ok(Math.abs(ok.a - 1) < 0.15 && Math.abs(ok.b) < 0.15);
  const over = ps.map((p) => Math.min(0.99, Math.max(0.01, 0.5 + (p - 0.5) * 1.8)));
  const cal = fitPlatt(over, ys);
  assert.ok(logLoss(over.map((p) => applyPlatt(cal, p)), ys) < logLoss(over, ys));
  assert.equal(fitPlatt([0.5], [1]).fitted, false);
});

test("backtest: nessuna informazione futura (le partite successive non cambiano le previsioni precedenti)", () => {
  const rows = normalize(synthetic());
  const a = predict(rows);
  assert.ok(a.length > 50);
  const cutDay = a[Math.floor(a.length / 2)].day;
  const altered = rows.map((r) => (r.kickoff_at.slice(0, 10) > cutDay ? { ...r, home_score: r.home_score + 5, away_score: 0 } : r));
  const b = predict(altered);
  const early = (list) => list.filter((x) => x.day <= cutDay).map((x) => [x.id, x.a.selections.map((s) => s.p)]);
  assert.deepEqual(early(a), early(b));
});

test("backtest: split cronologici e metriche coerenti; senza quote nessuna giocata", () => {
  const rows = normalize(synthetic());
  const preds = predict(rows);
  assert.ok(preds.every((x, i, l) => i === 0 || x.kickoffAt >= l[i - 1].kickoffAt));
  assert.ok(preds.filter((x) => x.split === "val").every((v) => preds.filter((t) => t.split === "test").every((t) => v.kickoffAt <= t.kickoffAt)));
  const e = evaluate(preds, "test");
  assert.ok(e.matches > 10 && e.x12.logLoss > 0 && e.x12.logLoss < 1.3, "meglio del caso uniforme (ln 3 = 1,099) o vicino");
  assert.equal(e.singles.all.n, 0); assert.equal(e.multiples.all.n, 0);
  for (const m of Object.values(e.perMarket)) assert.ok(m.brier >= 0 && m.brier <= 1);
});

test("backtest con quote: le singole sono solo quelle con EV prudente >= soglia; ROI = profitto/puntato", () => {
  const rows = normalize(synthetic(60).map((r, i) => ({ ...r, odds_over25: 2.1, odds_under25: 1.8, odds_home: 2.5, odds_draw: 3.3, odds_away: 2.9 })));
  const e = evaluate(predict(rows), "test");
  const s = e.singles.all;
  if (s.n) { assert.ok(Math.abs(s.roi - s.profit / s.staked) < 1e-12); assert.equal(s.staked, s.n); }
  assert.equal(s.adequate, false, "campione sintetico piccolo: mai dichiarato dimostrato");
});

test("withModel ripristina i parametri; parseRows legge CSV e JSON", () => {
  const before = MODEL.rho;
  withModel({ rho: -0.1 }, () => assert.equal(MODEL.rho, -0.1));
  assert.equal(MODEL.rho, before);
  const csv = "league,kickoff_at,home_id,away_id,home_name,away_name,home_score,away_score,odds_over25\nseriea,2026-01-01T15:00:00Z,a,b,A,B,2,1,1.9";
  const r = normalize(parseRows(csv, "x.csv"));
  assert.equal(r[0].home_score, 2); assert.equal(r[0].odds.over25, 1.9);
  assert.equal(parseRows("[]", "x.json").length, 0);
});
