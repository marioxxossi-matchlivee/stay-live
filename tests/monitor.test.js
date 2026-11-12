import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { MIN_SAMPLE, buildMonitor, calibration, judgeBet, judgeEvita, stats } from "../functions/api/_monitor.js";
import { buildBacktestPayload } from "../scripts/publish-backtest.js";
import { normalize, predict } from "../scripts/backtest.js";

const near = (a, b, e = 1e-9) => assert.ok(Math.abs(a - b) < e, `${a} ≠ ${b}`);
// riga aggregata come la restituiscono le viste monitor_*_agg
const row = (o) => ({ model_ver: "v1", verdict: "BET", sel_key: "over25", bin: 8, n: 10, won: 8, sum_p: 7.71, sum_plow: 6.29, sum_brier: 1.5, sum_logloss: 5, n_odds: 0, sum_pnl: 0, first_kickoff: "2026-11-07T15:00:00Z", last_kickoff: "2026-11-10T20:00:00Z", ...o });

test("stats: percentuale reale, dichiarata, prudente, scarto e intervallo", () => {
  const s = stats([row({})]);
  near(s.rate, 0.8); near(s.claimed, 0.771); near(s.floor, 0.629); near(s.gap, 0.029);
  assert.ok(s.ci.lo < 0.8 && 0.8 < s.ci.hi); near(s.brier, 0.15); near(s.logLoss, 0.5);
  assert.equal(s.roi, null);
  const empty = stats([]);
  assert.equal(empty.n, 0); assert.equal(empty.rate, null); assert.equal(empty.ci, null);
  const roi = stats([row({ n: 4, won: 2, n_odds: 4, sum_pnl: 1.2 })]); near(roi.roi, 0.3);
});

test("taratura: fasce da 10 punti aggregate sulle righe", () => {
  const c = calibration([row({ bin: 6, n: 10, won: 5, sum_p: 6 }), row({ bin: 6, sel_key: "btts", n: 10, won: 7, sum_p: 6 }), row({ bin: 9, n: 20, won: 18, sum_p: 18 })]);
  assert.equal(c.length, 2);
  near(c[0].lo, 0.5); near(c[0].hi, 0.6); assert.equal(c[0].n, 20); near(c[0].rate, 0.6); near(c[0].claimed, 0.6);
  near(c[1].lo, 0.8); assert.equal(c[1].n, 20);
});

test("giudizi: nessuna conclusione sotto la soglia minima di campione", () => {
  assert.match(judgeBet(stats([])), /Nessun BET/);
  assert.match(judgeBet(stats([row({ n: 10, won: 8 })])), /dicono poco/);
  assert.match(judgeBet(stats([row({ n: 100, won: 80, sum_p: 79 })])), /non è ancora dimostrato/);
  assert.match(judgeBet(stats([row({ n: MIN_SAMPLE, won: 180, sum_p: 240 })])), /promette più/);
  assert.match(judgeBet(stats([row({ n: MIN_SAMPLE, won: 240, sum_p: 240 })])), /oneste/);
  const bet = stats([row({ n: 10, won: 8 })]), ev = stats([row({ verdict: "EVITA", n: 175, won: 109 })]);
  assert.match(judgeEvita(bet, ev), /Campione troppo piccolo/);
  const bet2 = stats([row({ n: 400, won: 300 })]), ev2 = stats([row({ verdict: "EVITA", n: 400, won: 200 })]);
  assert.match(judgeEvita(bet2, ev2), /oltre l'incertezza: la regola separa/);
  const ev3 = stats([row({ verdict: "EVITA", n: 400, won: 360 })]);
  assert.match(judgeEvita(bet2, ev3), /troppo severa/);
  const ev4 = stats([row({ verdict: "EVITA", n: 400, won: 290 })]);
  assert.match(judgeEvita(bet2, ev4), /sovrappongono/);
});

test("monitor con i numeri reali: BET 8/10, EVITA 109/175, tutte le versioni contate", () => {
  const picks = [row({ model_ver: "7983f41f", verdict: "BET", n: 10, won: 8 }), row({ model_ver: "7983f41f", verdict: "EVITA", n: 175, won: 109, sum_p: 102.9, sum_plow: 89.6, bin: 6 })];
  const legs = [row({ model_ver: "7983f41f", verdict: "EVITA", n: 2575, won: 1282, sum_p: 1282, sum_plow: 1058, bin: 5 })];
  const status = [{ model_ver: "7983f41f", verdict: "BET", stato: "concluse", n: 10 }, { model_ver: "7983f41f", verdict: "EVITA", stato: "concluse", n: 175 }, { model_ver: "648b7a68", verdict: "EVITA", stato: "in_attesa", n: 9 }, { model_ver: "7983f41f", verdict: "EVITA", stato: "rinviate_o_annullate", n: 1 }];
  const m = buildMonitor({ picks, legs, status, ver: "648b7a68", now: new Date("2026-11-12T10:00:00Z") });
  near(m.picks.bet.rate, 0.8); assert.equal(m.picks.bet.n, 10);
  near(m.picks.evita.rate, 109 / 175);
  assert.match(m.picks.judgeEvita, /Campione troppo piccolo/);
  assert.equal(m.registered.concluse, 185); assert.equal(m.registered.in_attesa, 9); assert.equal(m.registered.partite, 195);
  assert.equal(m.byVersion.length, 1); assert.equal(m.byVersion[0].current, false);
  assert.equal(m.since, "2026-11-07"); assert.equal(m.until, "2026-11-10");
  assert.equal(m.legs.total.n, 2575); assert.equal(m.minSample, 300);
  assert.equal(m.backtest, null);
  assert.doesNotThrow(() => JSON.stringify(m));
});

test("monitor senza dati: nessuna eccezione, nessun numero inventato", () => {
  const m = buildMonitor({});
  assert.equal(m.picks.bet.n, 0); assert.equal(m.picks.bet.rate, null); assert.equal(m.registered.partite, 0); assert.equal(m.since, null);
});

test("endpoint /api/monitor: solo lettura", () => {
  const src = fs.readFileSync(new URL("../functions/api/monitor.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /supabase(Upsert|Patch|Delete)|method:\s*"(POST|PATCH|DELETE|PUT)"/);
  assert.match(src, /monitor_legs_agg/); assert.match(src, /reliability-backtest/);
});

// ── pubblicazione del backtest sulle partite storiche ──
let a = 5; const rnd = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pois = (l) => { let k = 0, p = 1; const L = Math.exp(-l); do { k += 1; p *= rnd(); } while (p > L); return k - 1; };
const strength = Array.from({ length: 16 }, () => 0.6 + rnd());
const rows = [];
for (let d = 0; d < 70; d++) for (let g = 0; g < 8; g++) {
  const h = Math.floor(rnd() * 16), w = (h + 1 + Math.floor(rnd() * 15)) % 16;
  rows.push({ league: "seriea", kickoff_at: new Date(Date.parse("2026-08-15T18:00:00Z") + d * 3 * 86400e3 + g * 3600e3).toISOString(), home_id: `t${h}`, away_id: `t${w}`, home_name: `T${h}`, away_name: `T${w}`, home_score: pois(strength[h] * 1.2), away_score: pois(strength[w]), neutral_site: false });
}

test("payload del backtest: solo aggregati, serializzabile e piccolo", () => {
  const data = normalize(rows), preds = predict(data, { trainFrac: 0.3, valFrac: 0.35 });
  const p = buildBacktestPayload(data, preds, { warmup: 0.3, generatedAt: "2026-11-12T00:00:00Z" });
  assert.equal(p.matches, 560); assert.equal(p.from, "2026-08-15"); assert.ok(p.analyzed > 50);
  assert.equal(p.bet.n + p.evita.n, preds.filter((x) => x.a.confidence !== "insufficiente").length);
  assert.ok(p.evita.rate >= 0 && p.evita.rate <= 1); assert.ok(Number.isFinite(p.calibration.ece));
  assert.deepEqual(Object.keys(p.evitaByReason).sort(), ["campione", "edge", "soglia"]);
  const back = JSON.parse(JSON.stringify(p));
  assert.deepEqual(back.bet.n, p.bet.n);
  assert.ok(JSON.stringify(p).length < 30000, "il payload deve restare piccolo");
  assert.match(p.limits, /proxy/);
});
