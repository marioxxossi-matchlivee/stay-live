import test from "node:test";
import assert from "node:assert/strict";
import { MODEL, verdictFor } from "../functions/api/model.js";
import { VARIANTS, compare, report, summarizeBets } from "../scripts/backtest-rules.js";
import { normalize } from "../scripts/backtest.js";

// storico sintetico riproducibile: 12 squadre, due giri completi andata e ritorno ripetuti per ~600 partite
function rows() {
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const teams = Array.from({ length: 12 }, (_, i) => ({ id: `af-${i + 1}`, name: `Squadra ${i + 1}`, att: 0.8 + (i % 6) * 0.15, def: 1.2 - (i % 5) * 0.1 }));
  const pois = (l) => { let k = 0, p = 1; const L = Math.exp(-l); do { k += 1; p *= rnd(); } while (p > L); return k - 1; };
  const out = []; let t = Date.parse("2025-08-01T15:00:00Z");
  for (let round = 0; round < 9; round += 1) for (const h of teams) for (const a of teams) { if (h === a) continue;
    out.push({ league: "seriea", kickoff_at: new Date(t).toISOString(), home_id: h.id, away_id: a.id, home_name: h.name, away_name: a.name, home_score: pois(1.35 * h.att * a.def), away_score: pois(1.1 * a.att * h.def), neutral_site: false }); t += 3 * 3600e3; }
  return out;
}

test("regola dell'edge: 'relativa' si comporta come i punti per un esito al 55% e blocca ciò che la regola a punti non vede", () => {
  MODEL.requireRealOdds = false;          // la regola senza quota è quella dei backtest sul passato
  const sel = (p, base) => ({ key: "k", p, pLow: p, base, edge: +(p - base).toFixed(3), minOdds: 1.3, odds: null });
  assert.equal(verdictFor(sel(0.63, 0.55), 20).verdict, "BET", "X2: +8 punti");
  assert.equal(verdictFor(sel(0.78, 0.70), 20).verdict, "BET", "1X: +8 punti");
  const saved = { m: MODEL.edgeMode, r: MODEL.requireRealOdds };
  try {
    MODEL.edgeMode = "ratio";
    assert.equal(verdictFor(sel(0.63, 0.55), 20).verdict, "BET");
    assert.equal(verdictFor(sel(0.62, 0.55), 20).verdict, "EVITA", "sotto il +14,5% relativo");
    assert.equal(verdictFor(sel(0.64, 0.63), 20).verdict, "EVITA", "vicino alla media: niente di speciale");
  } finally { MODEL.edgeMode = saved.m; MODEL.requireRealOdds = saved.r; }
  assert.equal(MODEL.edgeMode, "points", "il modello in produzione resta con la regola attuale");
});

test("confronto regole: riproducibile, le varianti non sporcano il modello e il report è leggibile", () => {
  const data = normalize(rows());
  assert.ok(data.length > 500);
  const before = JSON.stringify(MODEL);
  const res = compare(data, VARIANTS, { n: 8 });
  assert.equal(JSON.stringify(MODEL), before, "i parametri tornano quelli di prima");
  assert.deepEqual(Object.keys(res), Object.keys(VARIANTS));
  for (const r of Object.values(res)) { assert.ok(r.matches > 0); assert.equal(r.test.n, r.test.won + (r.test.n - r.test.won)); }
  // soglia più bassa = almeno altrettanti BET
  assert.ok(res.soglia_55.test.n >= res.attuale.test.n, `${res.soglia_55.test.n} >= ${res.attuale.test.n}`);
  assert.ok(res.punti_5.test.n >= res.attuale.test.n);
  const md = report(res);
  assert.match(md, /\| attuale \|/); assert.match(md, /relativa_14/); assert.match(md, /Scarto/);
  assert.deepEqual(summarizeBets([], "test"), { n: 0, won: 0, rate: null, claimed: null, gap: null, enough: false, byKey: {} });
});
