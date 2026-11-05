import test from "node:test";
import assert from "node:assert/strict";
import { MIN_CORNER_ODD, cornerPick, loadCornerOdds } from "../functions/api/_corners.js";
import { ou25Of, analyzeMatch, buildContext } from "../functions/api/model.js";

const agg = (odd, median = odd, book = "Bet365") => ({ best: { odd, book }, median, n: 8 });

test("corner: percentuale implicita senza margine, solo lati che pagano almeno 1,30", () => {
  const corners = { mainLine: 9.5, lines: [
    { line: 8.5, over: agg(1.35), under: agg(3.1) },     // over 8,5: 1/1,35 contro 1/3,1
    { line: 9.5, over: agg(1.9), under: agg(1.9) },
    { line: 14.5, over: agg(8), under: agg(1.05) },       // Under 14,5 a 1,05: scartato (paga troppo poco)
  ] };
  const r = cornerPick(corners);
  assert.equal(r.best.side, "over"); assert.equal(r.best.line, 8.5);
  const io = 1 / 1.35, iu = 1 / 3.1;
  assert.ok(Math.abs(r.best.p - io / (io + iu)) < 1e-4);
  assert.equal(r.main, 9.5);
  const extreme = cornerPick({ lines: [{ line: 14.5, over: agg(8), under: agg(1.05) }] });
  assert.equal(extreme.best.side, "over", "Under 14,5 a 1,05 non è mai scelto");
  assert.equal(cornerPick({ lines: [] }), null);
  assert.equal(cornerPick(undefined), null);
  assert.equal(MIN_CORNER_ODD, 1.3);
});

test("ou25Of: lato migliore; null se il campione è insufficiente", () => {
  const finals = [];
  for (let i = 0; i < 40; i += 1) finals.push({ league: "seriea", kickoff_at: new Date(Date.parse("2026-09-01T18:00:00Z") + i * 864e5).toISOString(), home_id: `t${i % 8}`, away_id: `t${(i + 3) % 8}`, home_name: "x", away_name: "y", home_score: (i * 3) % 4, away_score: (i + 1) % 3, neutral_site: false });
  const a = analyzeMatch({ league: "seriea", kickoff_at: "2026-11-05T19:45:00Z", home_id: "t1", away_id: "t4", neutral_site: false }, buildContext(finals), { n: 8 });
  const o = ou25Of(a);
  assert.ok(o.best.p >= Math.min(o.over.p, o.under.p));
  assert.ok(["over25", "under25"].includes(o.best.key));
  assert.equal(ou25Of({ confidence: "insufficiente", selections: a.selections }), null);
});

test("loadCornerOdds: solo cache non fa richieste; con limite si ferma e segnala il ritardo", async () => {
  const env = { SUPABASE_URL: "http://sb.test", SUPABASE_SERVICE_ROLE_KEY: "k", API_FOOTBALL_KEY: "x", API_FOOTBALL_MIN_GAP_MS: "0" };
  const m = (n) => ({ game_id: `af-${2000 + n}`, league: "serieb", season: 2026, kickoff_at: "2026-11-05T19:45:00Z", home_id: `af-${n}`, away_id: `af-${n + 50}`, home_name: "A", away_name: "B", status: "scheduled" });
  let af = 0;
  globalThis.fetch = async (url) => { if (!String(url).includes("sb.test")) af += 1; return new Response("[]", { status: 200, headers: { "content-type": "application/json" } }); };
  const cache = await loadCornerOdds(env, [m(1), m(2)], Date.now(), { live: false });
  assert.equal(af, 0); assert.equal(cache.retry.pending, 0);

  const resp = { bookmakers: [{ name: "Bet365", bets: [{ id: 45, name: "Corners Over Under", values: [{ value: "Over 8.5", odd: "1.40" }, { value: "Under 8.5", odd: "2.90" }] }] }, { name: "Pinnacle", bets: [{ id: 45, name: "Corners Over Under", values: [{ value: "Over 8.5", odd: "1.42" }, { value: "Under 8.5", odd: "2.85" }] }] }] };
  let calls = 0;
  globalThis.fetch = async (url) => {
    if (String(url).includes("sb.test")) return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    calls += 1;
    // 1ª chiamata = elenco mercati (odds/bets), 2ª = quote corner della prima partita, poi il provider limita le richieste
    const body = calls <= 2 ? { errors: [], response: [calls === 1 ? { id: 45, name: "Corners Over Under" } : resp], results: 1 } : { errors: { rateLimit: "Too many requests." }, response: [] };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", "x-ratelimit-requests-remaining": "5000" } });
  };
  const r = await loadCornerOdds(env, [m(1), m(2), m(3)], Date.now(), { maxLive: 6 });
  assert.equal(r.state.get("af-2001"), "used");
  assert.equal(r.byGame.get("af-2001").best.side, "over");
  assert.equal(r.state.get("af-2002"), "waiting"); assert.equal(r.state.get("af-2003"), "waiting");
  assert.ok(r.retry.pending >= 1 && r.retry.afterMs >= 15000);
});
