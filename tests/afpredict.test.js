import test from "node:test";
import assert from "node:assert/strict";
import { MODEL, afProbabilities, analyzeMatch, buildContext, compactPick, fusionWeights, probabilities } from "../functions/api/model.js";
import { parseAfPrediction } from "../functions/api/_afpredict.js";

const item = (over = {}) => ({
  predictions: { winner: { id: 1, name: "Inter" }, win_or_draw: true, under_over: "-2.5", advice: "Double chance : Inter or draw and -2.5 goals", percent: { home: "70%", draw: "20%", away: "10%" }, ...over.predictions },
  teams: {
    home: { league: { fixtures: { played: { total: 10 } }, goals: { for: { average: { home: "2.0" } }, against: { average: { home: "0.8" } } } } },
    away: { league: { fixtures: { played: { total: 10 } }, goals: { for: { average: { away: "0.9" } }, against: { average: { away: "1.6" } } } } },
  },
});

test("parse: percentuali normalizzate, consiglio gol, gol attesi dalle medie stagionali", () => {
  const a = parseAfPrediction(item());
  assert.deepEqual(a.percent, { home: 0.7, draw: 0.2, away: 0.1 });
  assert.deepEqual(a.underOver, { side: "under", line: 2.5 });
  assert.equal(a.lambda.home, (2.0 + 1.6) / 2); assert.equal(a.lambda.away, (0.9 + 0.8) / 2);
  assert.equal(a.played, 10);
  assert.equal(parseAfPrediction(null), null);
  assert.equal(parseAfPrediction({ predictions: { percent: { home: "x" } } }), null);
  assert.equal(parseAfPrediction(item({ predictions: { under_over: "+3.5" } })).underOver.side, "over");
});

const finals = [];
for (let i = 0; i < 40; i += 1) finals.push({ league: "seriea", kickoff_at: new Date(Date.parse("2026-09-01T18:00:00Z") + i * 864e5).toISOString(), home_id: `t${i % 8}`, away_id: `t${(i + 3) % 8}`, home_name: "x", away_name: "y", home_score: (i * 3) % 4, away_score: (i + 1) % 3, neutral_site: false });
const match = { league: "seriea", kickoff_at: "2026-11-05T19:45:00Z", home_id: "t1", away_id: "t4", neutral_site: false };
const ctx = buildContext(finals);

test("senza pronostico del provider il modello resta quello di prima", () => {
  const a = analyzeMatch(match, ctx, { n: 8 });
  assert.equal(a.basis, "storico"); assert.equal(a.api, null);
  assert.equal(a.selections[0].pApi, null);
  assert.equal(compactPick(a).basis, "storico");
});

test("con API-Football la probabilita' finale e' la media pesata di provider e ultime partite (pesi rinormalizzati senza mercato)", () => {
  const af = parseAfPrediction(item());
  const plain = analyzeMatch(match, ctx, { n: 8 });
  const a = analyzeMatch(match, ctx, { n: 8, af });
  assert.equal(a.basis, "api");
  const home = a.selections.find((s) => s.key === "home"), homePlain = plain.selections.find((s) => s.key === "home");
  const w = fusionWeights(true, false);
  assert.ok(Math.abs(w.storico + w.api + w.mercato - 1) < 1e-9 && w.mercato === 0);
  assert.ok(Math.abs(home.p - (w.api * 0.7 + w.storico * homePlain.p)) < 0.001);
  assert.equal(home.pApi, 0.7); assert.equal(home.agree, "conferma");
  assert.ok(home.pLow < home.p);
  assert.ok(a.api.lambda.home > 0 && a.api.underOver.side === "under");
  const lines = afProbabilities(af, ctx.baseline("seriea")).p;
  const pure = probabilities(a.api.lambda.home, a.api.lambda.away);
  assert.ok(Math.abs(lines.under25 - (pure.under25 + MODEL.afAdviceShift)) < 0.001, "il consiglio Under 2,5 alza quella probabilita'");
  assert.ok(a.sample >= 8 || a.sample === Math.max(Math.min(plain.sample, 8), 8), "il campione include la stagione del provider");
});

test("se il provider contraddice un esito, non diventa un BET", () => {
  const af = parseAfPrediction(item({ predictions: { percent: { home: "10%", draw: "20%", away: "70%" } } }));
  const a = analyzeMatch(match, ctx, { n: 8, af });
  const home = a.selections.find((s) => s.key === "home");
  assert.equal(home.agree, "contraddice"); assert.equal(home.verdict, "EVITA"); assert.match(home.reason, /API-Football non è d'accordo/);
  assert.notEqual(a.pick?.key, "home");
});
