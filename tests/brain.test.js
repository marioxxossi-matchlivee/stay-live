import test from "node:test";
import assert from "node:assert/strict";
import { MODEL, analyzeMatch, buildContext, fusionWeights, fuse } from "../functions/api/model.js";
import { parseAfPrediction } from "../functions/api/_afpredict.js";
import { marketFrom } from "../functions/api/_market.js";
import { brainStatusOf, countAbsent, loadBrainInputs } from "../functions/api/_brain.js";

const finals = [];
for (let i = 0; i < 48; i += 1) finals.push({ league: "seriea", kickoff_at: new Date(Date.parse("2026-09-01T18:00:00Z") + i * 864e5).toISOString(), home_id: `t${i % 8}`, away_id: `t${(i + 3) % 8}`, home_name: "x", away_name: "y", home_score: (i * 3) % 4, away_score: (i + 1) % 3, neutral_site: false });
const ctx = buildContext(finals);
const match = { league: "seriea", kickoff_at: "2026-11-05T19:45:00Z", home_id: "t1", away_id: "t4", neutral_site: false };

const afItem = (percent = { home: "55%", draw: "25%", away: "20%" }) => ({
  predictions: { winner: { name: "Inter" }, win_or_draw: true, under_over: "+2.5", advice: "Double chance : Inter or draw and +2.5 goals", percent },
  teams: { home: { name: "Inter", league: { fixtures: { played: { total: 10 } }, goals: { for: { average: { home: "2.0" } }, against: { average: { home: "0.9" } } } } },
    away: { name: "Milan", league: { fixtures: { played: { total: 10 } }, goals: { for: { average: { away: "1.2" } }, against: { average: { away: "1.5" } } } } } },
});
const bk = (name, over25, under25, h, d, a) => ({ name, bets: [
  { name: "Goals Over/Under", values: [{ value: "Over 2.5", odd: String(over25) }, { value: "Under 2.5", odd: String(under25) }, { value: "Over 1.5", odd: "1.28" }, { value: "Under 1.5", odd: "3.7" }] },
  { name: "Match Winner", values: [{ value: "Home", odd: String(h) }, { value: "Draw", odd: String(d) }, { value: "Away", odd: String(a) }] }] });
const marketResp = (over25, under25, h, d, a) => [{ bookmakers: [bk("Bet365", over25, under25, h, d, a), bk("Pinnacle", over25, under25, h, d, a)] }];

test("pesi: sommano sempre a 1 e si ridistribuiscono sulle fonti disponibili", () => {
  for (const [a, m] of [[false, false], [true, false], [false, true], [true, true]]) {
    const w = fusionWeights(a, m);
    assert.ok(Math.abs(w.storico + w.api + w.mercato - 1) < 1e-9);
    assert.equal(w.api > 0, a); assert.equal(w.mercato > 0, m);
  }
  const all = fusionWeights(true, true);
  assert.ok(all.api > all.mercato && all.mercato > all.storico, "API-Football prima, poi il mercato, poi le ultime partite");
});

test("fuse: media pesata, distanza tra le fonti e penalità sulla probabilità prudente", () => {
  const w = fusionWeights(true, true);
  const agree = fuse({ storico: { p: 0.7, low: 0.6 }, api: { p: 0.7, low: 0.62 }, mercato: { p: 0.7, low: 0.65 } }, w);
  const split = fuse({ storico: { p: 0.9, low: 0.8 }, api: { p: 0.7, low: 0.62 }, mercato: { p: 0.5, low: 0.47 } }, w);
  assert.ok(Math.abs(agree.p - 0.7) < 1e-9 && agree.spread === 0);
  assert.ok(split.spread > 0.39);
  assert.ok(split.pLow < agree.pLow, "fonti in disaccordo => probabilità prudente più bassa");
  assert.equal(agree.agree, "conferma");
  assert.equal(fuse({ storico: { p: 0.7, low: 0.6 }, api: { p: 0.2, low: 0.15 }, mercato: null }, fusionWeights(true, false)).agree, "contraddice");
  assert.equal(fuse({ storico: { p: 0.7, low: 0.6 } }, fusionWeights(false, false)).agree, null);
  assert.ok(fuse({ storico: { p: 0.7, low: 0.6 } }, fusionWeights(false, false), 0.05).pLow < 0.6, "assenti: più incertezza");
});

test("un solo cervello: ultime partite + API-Football + mercato in una probabilità, con le fonti visibili", () => {
  const af = parseAfPrediction(afItem());
  const market = marketFrom(marketResp(1.9, 1.95, 2.0, 3.3, 3.9), marketResp(1.9, 1.95, 2.0, 3.3, 3.9));
  const solo = analyzeMatch(match, ctx, { n: 8 });
  const a = analyzeMatch(match, ctx, { n: 8, af, market });
  assert.equal(solo.basis, "storico"); assert.equal(a.basis, "api+mercato");
  assert.ok(a.fusion.sources.api && a.fusion.sources.mercato && Math.abs(Object.values(a.fusion.weights).reduce((x, y) => x + y, 0) - 1) < 1e-9);
  const home = a.selections.find((s) => s.key === "home"), o25 = a.selections.find((s) => s.key === "over25");
  const w = a.fusion.weights;
  assert.ok(Math.abs(home.p - (w.storico * home.pModel + w.api * home.pApi + w.mercato * home.pMarket)) < 0.002);
  assert.ok(home.pMarket > 0 && home.pApi === 0.55 && home.odds.median === 2);
  assert.ok(o25.pMarket != null && o25.odds.median === 1.9);
  const dc = a.selections.find((s) => s.key === "dc1x");
  assert.equal(dc.odds, null, "la doppia chance non ha quota diretta: si stima");
  assert.ok(a.selections.every((s) => s.pLow <= s.p));
});

test("gli assenti confermati allargano l'incertezza (probabilità prudente più bassa)", () => {
  const af = parseAfPrediction(afItem());
  const a0 = analyzeMatch(match, ctx, { n: 8, af });
  const a1 = analyzeMatch(match, ctx, { n: 8, af, inj: { home: 3, away: 2 } });
  const a2 = analyzeMatch(match, ctx, { n: 8, af, inj: { home: 9, away: 9 } });
  const k = (x) => x.selections.find((s) => s.key === "over15").pLow;
  assert.ok(k(a1) < k(a0) && Math.abs(k(a0) - k(a1) - 5 * MODEL.injPenalty) < 0.002);
  assert.ok(Math.abs(k(a0) - k(a2) - 8 * MODEL.injPenalty) < 0.002, "tetto a 8 assenti");
  assert.equal(a1.fusion.absent.home, 3);
});

test("se il mercato contraddice un esito, non è un BET e la ragione lo dice", () => {
  const resp = marketResp(1.9, 1.95, 7, 4.5, 1.4);                       // mercato: vince la trasferta
  const market = marketFrom(resp, resp);
  const a = analyzeMatch(match, ctx, { n: 8, market });
  const home = a.selections.find((s) => s.key === "home");
  assert.equal(home.agree, "contraddice"); assert.equal(home.verdict, "EVITA"); assert.match(home.reason, /il mercato non è d'accordo/);
  assert.ok(!a.legs.some((l) => l.key === "home"));
});

test("gambe per le multiple: solo quote reali di mercato e valore atteso prudente non negativo", () => {
  const af = parseAfPrediction(afItem());
  const market = marketFrom(marketResp(1.9, 1.95, 2.0, 3.3, 3.9), null);
  const a = analyzeMatch(match, ctx, { n: 8, af, market });
  assert.ok(a.legs.length <= 3);
  for (const l of a.legs) {
    assert.ok(l.pLow >= MODEL.legMinP && l.odds >= MODEL.legMinOdds && l.pLow * l.odds >= MODEL.legMinEv);
    assert.equal(l.oddsSource, "mercato");
    assert.notEqual(l.agree, "contraddice");
  }
  assert.deepEqual([...a.legs].sort((x, y) => y.evLow - x.evLow).map((l) => l.key), a.legs.map((l) => l.key), "ordinate per valore atteso prudente");
  assert.deepEqual(analyzeMatch(match, ctx, { n: 8, af }).legs, [], "senza quote reali nessuna gamba");
const few = analyzeMatch(match, buildContext(finals.slice(0, 3)), { n: 8 });
  assert.deepEqual(few.legs, [], "campione insufficiente: nessuna gamba");
});

/* ---- lettura dei dati (rete simulata) ---- */
const env = { SUPABASE_URL: "http://sb.test", SUPABASE_SERVICE_ROLE_KEY: "k", API_FOOTBALL_KEY: "x", API_FOOTBALL_MIN_GAP_MS: "0" };
const m = (n) => ({ game_id: `af-${3000 + n}`, league: "serieb", season: 2026, kickoff_at: "2026-11-05T19:45:00Z", home_id: `af-${n}`, away_id: `af-${n + 50}`, home_name: "A", away_name: "B", status: "scheduled" });

test("countAbsent: solo gli assenti veri, per squadra", () => {
  const map = { home_team_id: 1, away_team_id: 2 };
  assert.deepEqual(countAbsent([{ team: { id: 1 }, player: { type: "Missing Fixture" } }, { team: { id: 1 }, player: { type: "Questionable" } }, { team: { id: 2 }, player: { type: "Missing Fixture" } }, { team: { id: 2 }, player: { type: "Missing Fixture" } }], map), { home: 1, away: 2 });
  assert.deepEqual(countAbsent(null, map), { home: 0, away: 0 });
});

test("loadBrainInputs: pronostico + quote per partita; al limite si ferma e segnala cosa manca", async () => {
  const calls = [];
  globalThis.fetch = async (url) => {
    const u = String(url);
    if (u.includes("sb.test")) return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    calls.push(u);
    const hdr = { "content-type": "application/json", "x-ratelimit-requests-remaining": "5000" };
    if (u.includes("/odds/bets")) return new Response(JSON.stringify({ errors: [], response: [{ id: 5, name: "Goals Over/Under" }, { id: 1, name: "Match Winner" }], results: 2 }), { status: 200, headers: hdr });
    if (calls.length > 5) return new Response(JSON.stringify({ errors: { rateLimit: "Too many requests." }, response: [] }), { status: 200, headers: hdr });
    if (u.includes("/predictions")) return new Response(JSON.stringify({ errors: [], response: [afItem()], results: 1 }), { status: 200, headers: hdr });
    return new Response(JSON.stringify({ errors: [], response: marketResp(1.9, 1.95, 2.0, 3.3, 3.9), results: 1 }), { status: 200, headers: hdr });
  };
  const ms = [m(1), m(2), m(3)];
  const r = await loadBrainInputs(env, ms, Date.now(), { maxLive: 20 });
  // chiamate: 1 elenco mercati + predictions m1, m2, m3 (calls 2-4) + quote m1 gol (5) + quote m1 1X2 (6, già oltre il limite simulato)
  assert.equal(r.state.get("af-3001"), "used"); assert.equal(r.state.get("af-3003"), "used");
  assert.equal(r.byGame.get("af-3001").af.percent.home, 0.55);
  assert.ok(r.byGame.get("af-3001").market, "quote lette");
  assert.equal(r.marketState.get("af-3001"), "used");
  assert.equal(r.marketState.get("af-3002"), "waiting"); assert.equal(r.marketState.get("af-3003"), "waiting");
  const st = brainStatusOf(r, ms.map((x) => x.game_id));
  assert.equal(st.used, 3); assert.ok(st.market >= 1 && st.marketWaiting >= 1);
  assert.ok(r.retry.pending >= 2 && r.retry.afterMs >= 15000);
  // la risposta alle quote è del tipo giusto per il modello
  const a = analyzeMatch({ ...match, league: "seriea" }, ctx, { n: 8, ...r.byGame.get("af-3001") });
  assert.equal(a.basis, "api+mercato");
});

test("solo cache: nessuna richiesta ad API-Football", async () => {
  let af = 0;
  globalThis.fetch = async (url) => { if (!String(url).includes("sb.test")) af += 1; return new Response("[]", { status: 200, headers: { "content-type": "application/json" } }); };
  const r = await loadBrainInputs(env, [m(1), m(2)], Date.now(), { live: false });
  assert.equal(af, 0); assert.equal(r.retry.pending, 0);
});
