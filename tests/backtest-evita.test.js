import test from "node:test";
import assert from "node:assert/strict";
import { bestCombo, buildReport, byConfidence, globalCalibration, judgeEvita, pickBreakdown, pickFor, summarize, sweep } from "../scripts/backtest-evita.js";
import { normalize, predict, withModel } from "../scripts/backtest.js";
import { SELECTIONS } from "../functions/api/model.js";

let seed = 11; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const pois = (l) => { let k = 0, p = 1; const L = Math.exp(-l); do { k += 1; p *= rnd(); } while (p > L); return k - 1; };
const strength = Array.from({ length: 16 }, () => 0.6 + rnd() * 1.0);
const rows = [];
for (let d = 0; d < 70; d += 1) for (let g = 0; g < 8; g += 1) {
  const a = Math.floor(rnd() * 16), b = (a + 1 + Math.floor(rnd() * 15)) % 16;
  rows.push({ league: "seriea", kickoff_at: new Date(Date.parse("2026-08-15T18:00:00Z") + d * 3 * 86400e3 + g * 3600e3).toISOString(), home_id: `t${a}`, away_id: `t${b}`, home_name: `T${a}`, away_name: `T${b}`, home_score: pois(strength[a] * 1.1), away_score: pois(strength[b] * 0.9), neutral_site: false });
}
const data = normalize(rows), preds = withModel({ formShrinkK: 4 }, () => predict(data, { trainFrac: 0.3, valFrac: 0.35 }));

test("pickFor con i parametri attuali coincide con la scelta del modello", () => {
  const same = preds.filter((x) => x.a.confidence !== "insufficiente").every((x) => { const p = pickFor(x.a); return p && p.sel.key === x.a.pick.key && p.verdict === x.a.pick.verdict; });
  assert.ok(same);
});
test("ogni scelta finisce in un solo gruppo: BET o EVITA per motivo", () => {
  const g = pickBreakdown(preds), n = Object.values(g).flat().length;
  assert.equal(n, preds.filter((x) => x.a.confidence !== "insufficiente").length);
  assert.ok(g.bet.length > 0 && g.soglia.length + g.edge.length > 0);
});
test("summarize: percentuali coerenti e rendimento teorico finito", () => {
  const s = summarize(pickBreakdown(preds).edge);
  assert.ok(s.rate >= 0 && s.rate <= 1 && Number.isFinite(s.proxyRoi) && s.ci.lo <= s.rate && s.rate <= s.ci.hi);
});
test("taratura globale: tutti gli esiti del modello, ECE finita", () => {
  const c = globalCalibration(preds);
  assert.equal(c.per.length, SELECTIONS.length);
  assert.ok(Number.isFinite(c.total.ece) && c.per.every((r) => r.n > 0));
});
test("fiducia e griglia soglie producono righe e una combinazione consigliata o nessuna", () => {
  assert.ok(byConfidence(preds).length > 0);
  const cells = sweep(preds); assert.equal(cells.length, 16);
  const best = bestCombo(cells); assert.ok(best === null || best.val.bet.n >= 30);
});
test("soglie più alte non aumentano i BET", () => {
  const cells = sweep(preds), at = (t) => cells.find((c) => c.betThreshold === t && c.minEdge === 0.05).val.bet.n;
  assert.ok(at(0.55) >= at(0.6) && at(0.6) >= at(0.65) && at(0.65) >= at(0.7));
});
test("verdetti: campioni piccoli non concludono, soglia troppo severa è segnalata", () => {
  assert.match(judgeEvita("edge", { n: 20, rate: 0.7, lift: 0.0 }, 0.7), /campione piccolo/);
  assert.match(judgeEvita("soglia", { n: 200, rate: 0.7, lift: 0.1 }, 0.7), /TROPPO SEVERO/);
  assert.match(judgeEvita("edge", { n: 200, rate: 0.6, lift: 0.01 }, 0.7), /evitare è giusto/);
});
test("report Markdown completo, e senza dati non va in errore", () => {
  assert.match(buildReport(data, preds), /## 4\. Taratura delle soglie/);
  assert.match(buildReport(data.slice(0, 3), []), /Nessuna partita analizzabile/);
});
