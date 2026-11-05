import test from "node:test";
import assert from "node:assert/strict";
import { MODEL, afProbabilities, analyzeMatch, buildContext, compactPick, probabilities } from "../functions/api/model.js";
import { afStatusOf, loadAfPredictions, parseAfPrediction } from "../functions/api/_afpredict.js";

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

test("con API-Football la probabilita' finale e' 65% provider + 35% ultime partite", () => {
  const af = parseAfPrediction(item());
  const plain = analyzeMatch(match, ctx, { n: 8 });
  const a = analyzeMatch(match, ctx, { n: 8, af });
  assert.equal(a.basis, "api");
  const home = a.selections.find((s) => s.key === "home"), homePlain = plain.selections.find((s) => s.key === "home");
  assert.ok(Math.abs(home.p - (0.65 * 0.7 + 0.35 * homePlain.p)) < 0.001);
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

/* ---- lettura dal provider ---- */
const env = { SUPABASE_URL: "http://sb.test", SUPABASE_SERVICE_ROLE_KEY: "k", API_FOOTBALL_KEY: "x", API_FOOTBALL_MIN_GAP_MS: "0" };
const m = (n) => ({ game_id: `af-${1000 + n}`, league: "serieb", season: 2026, kickoff_at: "2026-11-05T19:45:00Z", home_id: `af-${n}`, away_id: `af-${n + 50}`, home_name: "A", away_name: "B", status: "scheduled" });

test("loadAfPredictions: scarica a passi, si ferma al limite e dice cosa manca", async () => {
  let calls = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes("sb.test")) return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    calls += 1;
    const ok = calls <= 2;
    return new Response(JSON.stringify(ok ? { errors: [], response: [item()], results: 1 } : { errors: { rateLimit: "Too many requests." }, response: [] }), { status: 200, headers: { "content-type": "application/json", "x-ratelimit-requests-remaining": "5000" } });
  };
  const ms = [m(1), m(2), m(3), m(4)];
  const r = await loadAfPredictions(env, ms, Date.now());
  assert.deepEqual(ms.map((x) => r.state.get(x.game_id)), ["used", "used", "waiting", "waiting"]);
  assert.equal(r.byGame.get("af-1001").percent.home, 0.7);
  assert.equal(r.retry.pending, 2); assert.ok(r.retry.afterMs >= 15000);
  assert.deepEqual(afStatusOf(r.state, r.retry, ms.map((x) => x.game_id)), { used: 2, waiting: 2, missing: 0, retry: r.retry });
});

test("solo cache: nessuna richiesta ad API-Football", async () => {
  let af = 0;
  globalThis.fetch = async (url) => { if (!String(url).includes("sb.test")) af += 1; return new Response("[]", { status: 200, headers: { "content-type": "application/json" } }); };
  const r = await loadAfPredictions(env, [m(1), m(2)], Date.now(), { live: false });
  assert.equal(af, 0); assert.equal(r.retry.pending, 0);
});
