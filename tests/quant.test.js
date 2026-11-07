import test from "node:test";
import assert from "node:assert/strict";
import { MODEL, SELECTIONS, analyzeMatch, buildContext, marketsFromMatrix, posteriorLowProbabilities, probabilities, relVar, scoreMatrix, teamForm, verdictFor } from "../functions/api/model.js";

const sum2 = (m) => m.reduce((t, r) => t + r.reduce((u, v) => u + v, 0), 0);

test("Poisson: caso noto lambda 1,5 / 1,2", () => {
  const p = probabilities(1.5, 1.2);
  // P(0-0) = e^-2,7 ; over 2,5 = 1 - P(0..2 gol totali) con totale ~ Poisson(2,7)
  const m = scoreMatrix(1.5, 1.2, 0);
  assert.ok(Math.abs(m[0][0] - Math.exp(-2.7)) < 1e-4);
  const t = Math.exp(-2.7);
  assert.ok(Math.abs(p.under25 - (t + t * 2.7 + t * 2.7 ** 2 / 2)) < 1e-4);
  assert.ok(Math.abs(p.home + p.draw + p.away - 1) < 1e-9);
  assert.ok(Math.abs(p.over25 + p.under25 - 1) < 1e-9 && Math.abs(p.btts + p.nobtts - 1) < 1e-9);
  assert.ok(Math.abs(p.btts - (1 - Math.exp(-1.5)) * (1 - Math.exp(-1.2))) < 1e-4, "BTTS con Poisson indipendente");
});

test("Dixon-Coles: rho = 0 identico al Poisson, rho < 0 sposta massa su 0-0 e 1-1", () => {
  const a = scoreMatrix(1.5, 1.2, 0), b = scoreMatrix(1.5, 1.2, -0.12);
  assert.ok(Math.abs(sum2(b) - 1) < 1e-12);
  assert.ok(b[0][0] > a[0][0] && b[1][1] > a[1][1] && b[0][1] < a[0][1] && b[1][0] < a[1][0]);
  for (const [i, j] of [[2, 0], [2, 1], [0, 2], [3, 3]]) assert.ok(Math.abs(b[i][j] / a[i][j] - b[2][2] / a[2][2]) < 1e-9, "fuori dai 4 punteggi bassi cambia solo la normalizzazione");
  const pa = marketsFromMatrix(a), pb = marketsFromMatrix(b);
  assert.ok(pb.draw > pa.draw, "più pareggi con rho negativo");
  assert.equal(MODEL.rho, 0, "rho resta 0 finché un backtest non lo giustifica");
});

test("probabilità prudente posteriore: coerente, <= centrale, più bassa con più incertezza", () => {
  const p = probabilities(1.6, 1.1);
  const lo = posteriorLowProbabilities(1.6, 1.1, 0.15, 0.15), hi = posteriorLowProbabilities(1.6, 1.1, 0.40, 0.40);
  for (const k of Object.keys(p)) assert.ok(lo[k] >= 0 && lo[k] <= 1 && lo[k] <= p[k] + 0.02, `${k}: pLow non sopra la centrale`);
  assert.ok(hi.over15 < lo.over15 && hi.home < lo.home, "più incertezza, più prudenza");
  const same = posteriorLowProbabilities(1.6, 1.1, 0, 0);
  for (const k of Object.keys(p)) assert.ok(Math.abs(same[k] - p[k]) < 1e-9, "senza incertezza pLow = p");
});

test("incertezza: più partite effettive, meno varianza; mai sotto il minimo teorico", () => {
  assert.ok(relVar(3, 1.35) > relVar(8, 1.35) && relVar(8, 1.35) > relVar(30, 1.35));
  assert.ok(relVar(0, 1.35) <= MODEL.teamSd ** 2 + 1e-12 && relVar(1000, 1.35) > 0);
});

function league(teams = 8, rounds = 14) {
  const finals = []; let t = Date.parse("2026-01-01T15:00:00Z");
  for (let r = 0; r < rounds; r += 1) for (let i = 0; i < teams; i += 2) {
    const h = (i + r) % teams, a = (i + 1 + 3 * r) % teams; if (h === a) continue;
    finals.push({ league: "seriea", kickoff_at: new Date(t).toISOString(), home_id: `t${h}`, away_id: `t${a}`, home_name: `T${h}`, away_name: `T${a}`, home_score: (h + r) % 4, away_score: (a + r * 2) % 3, neutral_site: false });
    t += 36e5 * 6;
  }
  return finals;
}

test("teamForm: neff (Kish) tra 1 e il numero di partite, cresce con n", () => {
  const ctx = buildContext(league());
  const f5 = teamForm("t1", Date.parse("2026-12-01"), ctx, 5), f10 = teamForm("t1", Date.parse("2026-12-01"), ctx, 10);
  assert.ok(f5.neff > 1 && f5.neff <= 5 && f10.neff > f5.neff && f10.neff <= 10);
});

test("EV su quote reali: pLow x quota, quota mancante = nessun EV, verdetto usa la quota reale", () => {
  const ctx = buildContext(league());
  const m = { league: "seriea", kickoff_at: "2026-12-01T18:00:00Z", home_id: "t1", away_id: "t2" };
  const free = analyzeMatch(m, ctx, { n: 8 });
  assert.ok(free.selections.every((s) => s.ev === null && s.evLow === null && !s.verified));
  assert.deepEqual(free.legs, [], "senza quote reali nessuna gamba per le multiple");
  const top = [...free.selections].filter((s) => !s.key.startsWith("dc") && s.key !== "btts" && s.key !== "nobtts").sort((x, y) => y.pLow - x.pLow)[0];   // selezione con pLow più alta (supera la soglia dei longshot)
  const mk = (mult) => ({ market: { odds: { [top.key]: { median: 1 / top.pLow * mult, best: 9, book: "X", n: 3 } } } });
  const rich = analyzeMatch(m, ctx, { n: 8, ...mk(1.2) }), poor = analyzeMatch(m, ctx, { n: 8, ...mk(0.9) });
  const r = rich.selections.find((s) => s.key === top.key), q = poor.selections.find((s) => s.key === top.key);
  assert.ok(top.pLow >= MODEL.longshotFloor, "serve una selezione con probabilità prudente sopra il pavimento");
  assert.ok(r.evLow > 0.1 && r.verdict === "BET" && r.verified, JSON.stringify([r.evLow, r.verdict, r.reason]));
  assert.ok(q.evLow < 0 && q.verdict === "EVITA" && !q.verified);
  for (const a of [rich, poor]) for (const l of a.legs) assert.ok(l.pLow * l.odds >= MODEL.legMinEv && l.oddsSource === "mercato");
});

test("verdetto senza quota: avvisa che il valore non è verificato", () => {
  const v = verdictFor({ pLow: 0.7, minOdds: 1.47, edge: 0.15 }, 8);
  assert.equal(v.verdict, "BET");
  assert.match(v.reason, /NON è verificato/);
});

test("tutte le selezioni: probabilità in [0,1] e pLow <= p con dati completi", () => {
  const a = analyzeMatch({ league: "seriea", kickoff_at: "2026-12-01T18:00:00Z", home_id: "t3", away_id: "t4" }, buildContext(league()), { n: 8 });
  assert.equal(a.selections.length, SELECTIONS.length);
  for (const s of a.selections) assert.ok(s.p >= 0 && s.p <= 1 && s.pLow >= 0 && s.pLow <= s.p + 1e-9, s.key);
});

test("storico: le partite decise ai supplementari o ai rigori non entrano nelle medie", () => {
  const base = league();
  const withEt = [...base, { ...base[0], kickoff_at: "2026-02-01T15:00:00Z", home_score: 5, away_score: 4, decided_in: "extra_time" }, { ...base[1], kickoff_at: "2026-02-02T15:00:00Z", home_score: 3, away_score: 3, decided_in: "penalties" }];
  const a = buildContext(base), b = buildContext(withEt);
  assert.deepEqual(b.baseline("seriea"), a.baseline("seriea"), "medie gol del campionato invariate");
  assert.equal(b.matchCount, a.matchCount, "nessuna delle due partite è stata contata");
  const reg = buildContext([...base, { ...base[0], kickoff_at: "2026-02-01T15:00:00Z", home_score: 5, away_score: 4, decided_in: "regulation" }]);
  assert.equal(reg.matchCount, a.matchCount + 1, "una partita regolare invece conta");
});
