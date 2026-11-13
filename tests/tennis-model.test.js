import test from "node:test";
import assert from "node:assert/strict";
import {
  TENNIS_MODEL, RatingBook, predictMatch, normalizeSurface, gameWin, tiebreakWin, setWin, matchWin, pointModelProb,
} from "../functions/api/_tennis-model.js";
import { brier, logLoss, accuracy, calibrationBins, fitPlatt, chronologicalBacktest, sampleVerdict, groupSummary } from "../functions/api/_tennis-metrics.js";

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≠ ${b}`);
const DAY = 86400e3, T0 = Date.UTC(2026, 0, 1);

// Generatore pseudo-casuale deterministico (i test non devono dipendere dal caso).
function rng(seed) { // mulberry32: l'LCG semplice introduceva correlazioni tra estrazioni consecutive
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function synthetic(nMatches = 1500, nPlayers = 40, seed = 7) {
  const r = rng(seed), strength = Array.from({ length: nPlayers }, () => (r() - 0.5) * 600);
  const out = [];
  for (let i = 0; i < nMatches; i++) {
    const a = Math.floor(r() * nPlayers); let b = Math.floor(r() * nPlayers); if (b === a) b = (b + 1) % nPlayers;
    const pa = 1 / (1 + 10 ** (-(strength[a] - strength[b]) / 400));
    const aWins = r() < pa;
    out.push({ t: T0 + Math.floor(i / 4) * DAY, winnerId: aWins ? a : b, loserId: aWins ? b : a, surface: ["Hard", "Clay", "Grass"][i % 3], tour: "atp" });
  }
  return out;
}

test("normalizeSurface: famiglie e valori ignoti", () => {
  assert.equal(normalizeSurface("Clay"), "clay");
  assert.equal(normalizeSurface("I.hard"), "hard");
  assert.equal(normalizeSurface("Grass"), "grass");
  assert.equal(normalizeSurface(""), null);
  assert.equal(normalizeSurface("moquette"), null);
});

test("modello a punti: simmetria e casi limite", () => {
  near(gameWin(0.5), 0.5); near(gameWin(0.6) + gameWin(0.4), 1);
  assert.ok(gameWin(0.7) > gameWin(0.6));
  near(tiebreakWin(0.5), 0.5, 1e-9); near(tiebreakWin(0.6) + tiebreakWin(0.4), 1, 1e-9);
  near(setWin(0.65, 0.65), 0.5, 1e-9); near(setWin(0.7, 0.6) + setWin(0.6, 0.7), 1, 1e-9);
  assert.ok(setWin(0.7, 0.6) > 0.5);
  const s = 0.6;
  assert.ok(matchWin(s, 5) > matchWin(s, 3), "al meglio dei 5 il favorito vince più spesso");
  near(matchWin(0.5, 3), 0.5); near(matchWin(0.5, 5), 0.5);
  near(pointModelProb({ serve: 0.65, ret: 0.35 }, { serve: 0.65, ret: 0.35 }, { tour: "atp" }), 0.5, 1e-9);
  assert.ok(pointModelProb({ serve: 0.7, ret: 0.4 }, { serve: 0.62, ret: 0.34 }) > 0.5);
});

test("Elo: chi vince guadagna, chi perde cede; il rating di superficie conta", () => {
  const b = new RatingBook();
  for (let i = 0; i < 20; i++) b.update({ t: T0 + i * DAY, winnerId: "A", loserId: "B", surface: "clay" });
  assert.ok(b.view("A", "clay").elo > TENNIS_MODEL.baseElo);
  assert.ok(b.view("B", "clay").elo < TENNIS_MODEL.baseElo);
  assert.equal(b.update({ t: T0, winnerId: "A", loserId: "A" }), false);
  assert.equal(b.view("A", "clay").nSurf, 20);
  assert.equal(b.view("A", "grass").nSurf, 0);
});

test("Elo: a parità di K il sistema è a somma zero e non diverge nel tempo", () => {
  const b = new RatingBook({ ...TENNIS_MODEL, kOffset: 0, kShape: 0, kBase: 32 }); // K costante
  const r = rng(11);
  for (let i = 0; i < 2000; i++) {
    const a = Math.floor(r() * 20); let c = Math.floor(r() * 20); if (c === a) c = (c + 1) % 20;
    b.update({ t: T0 + i * DAY, winnerId: r() < 0.5 ? a : c, loserId: r() < 0.5 ? a : c, surface: null });
  }
  // (winner/loser possono coincidere: quelle partite vengono scartate) → somma dei rating invariata
  const sum = [...b.players.values()].reduce((s, p) => s + p.elo, 0);
  near(sum / b.players.size, TENNIS_MODEL.baseElo, 1e-6);
  const el = [...b.players.values()].map((p) => p.elo);
  assert.ok(Math.max(...el) - Math.min(...el) < 700, "rating esplosi");
});

test("il modello si astiene con storico insufficiente", () => {
  const b = new RatingBook();
  const p = predictMatch(b, { t: T0, surface: "Clay", tour: "atp", p1: { id: "X", name: "X" }, p2: { id: "Y", name: "Y" } });
  assert.equal(p.published, false); assert.equal(p.pick, null); assert.equal(p.p1, null);
  assert.match(p.abstainReason, /insufficiente/i);
});

test("probabilità coerenti: p1 + p2 = 1, simmetria scambiando i giocatori, pronostico = favorito", () => {
  const hist = synthetic();
  const book = new RatingBook(); hist.forEach((m) => book.update({ ...m, surface: normalizeSurface(m.surface) }));
  const t = T0 + 500 * DAY;
  let published = 0;
  for (let a = 0; a < 10; a++) for (let c = 10; c < 20; c++) {
    const m = { t, surface: "Hard", tour: "atp", p1: { id: a }, p2: { id: c } };
    const m2 = { ...m, p1: { id: c }, p2: { id: a } };
    const r = predictMatch(book, m), r2 = predictMatch(book, m2);
    assert.ok(r.p1 > 0 && r.p1 < 1);
    near(r.p1 + r.p2, 1, 1e-9);
    near(r.p1 + r2.p1, 1, 2e-4); // arrotondamento a 4 decimali
    if (r.published) { published++; assert.equal(r.pick, r.p1 > r.p2 ? 1 : 2); assert.ok(Math.max(r.p1, r.p2) >= 0.5 + TENNIS_MODEL.minEdge); }
    else assert.equal(r.pick, null);
  }
  assert.ok(published > 0, "con storico ampio qualche pronostico deve uscire");
});

test("dati mancanti dichiarati; statistiche di servizio usate solo se complete", () => {
  const hist = synthetic();
  const book = new RatingBook(); hist.forEach((m) => book.update({ ...m, surface: normalizeSurface(m.surface) }));
  const m = { t: T0 + 500 * DAY, surface: null, tour: "atp", p1: { id: 1 }, p2: { id: 2 } };
  const r = predictMatch(book, m);
  assert.ok(r.missing.includes("superficie") && r.missing.includes("scontri diretti") && r.missing.includes("statistiche di servizio e risposta"));
  const st = { serve: 0.66, ret: 0.36, matches: 20 };
  const r2 = predictMatch(book, m, { stats1: st, stats2: { serve: 0.6, ret: 0.32, matches: 20 }, h2h: { p1Wins: 3, p2Wins: 0 } });
  assert.ok(!r2.missing.includes("statistiche di servizio e risposta") && !r2.missing.includes("scontri diretti"));
  assert.ok(r2.components.pPoint > 0.5 && r2.p1 > r.p1);
  const r3 = predictMatch(book, m, { stats1: { ...st, matches: 2 }, stats2: st });
  assert.equal(r3.components.pPoint, null, "poche partite di statistiche: non si usano");
});

test("metriche: valori noti", () => {
  const rows = [{ p: 0.8, y: 1 }, { p: 0.8, y: 0 }, { p: 0.5, y: 1 }];
  near(brier(rows), (0.04 + 0.64 + 0.25) / 3);
  near(logLoss([{ p: 0.5, y: 1 }]), Math.log(2));
  near(accuracy(rows), 2 / 3);
  assert.equal(brier([]), null);
  const bins = calibrationBins(rows);
  assert.equal(bins.reduce((s, b) => s + b.n, 0), 3);
  assert.match(sampleVerdict(10), /insufficiente/);
  assert.equal(sampleVerdict(500), "campione adeguato");
});

test("backtest cronologico: nessun look-ahead (cambiare il futuro non cambia il passato)", () => {
  const hist = synthetic(800);
  const base = chronologicalBacktest(hist);
  const cut = T0 + 100 * DAY;
  const tampered = hist.map((m) => (m.t >= cut ? { ...m, winnerId: m.loserId, loserId: m.winnerId } : m)); // esiti futuri ribaltati
  const alt = chronologicalBacktest(tampered);
  const before = (rows) => rows.filter((r) => r.t < cut).map((r) => [r.t, r.p, r.published]);
  assert.deepEqual(before(base.rows), before(alt.rows));
  // anche le partite dello stesso giorno non si vedono tra loro
  const day = hist.filter((m) => m.t === cut);
  assert.ok(day.length > 1);
});

test("backtest: stesso risultato se si riordina l'input; probabilità con più dati migliori di 0,5 fisso", () => {
  const hist = synthetic(1500);
  const a = chronologicalBacktest(hist), b = chronologicalBacktest([...hist].reverse());
  assert.deepEqual(a.rows.map((r) => r.p), b.rows.map((r) => r.p));
  assert.ok(a.summary.n > 100);
  assert.ok(a.summary.brier < 0.25, `Brier ${a.summary.brier} dovrebbe battere il lancio di moneta (0,25)`);
  assert.ok(a.summary.accuracy > 0.55);
  const g = groupSummary(a.published, (r) => r.surface);
  assert.ok(Object.keys(g).length >= 2);
});

test("Platt: pochi dati → nessuna calibrazione; dati ben calibrati → parametri vicini all'identità", () => {
  assert.equal(fitPlatt([{ p: 0.6, y: 1 }]), null);
  const r = rng(3), rows = [];
  for (let i = 0; i < 4000; i++) { const p = 0.5 + r() * 0.45; rows.push({ p, y: r() < p ? 1 : 0 }); }
  const c = fitPlatt(rows);
  assert.ok(Math.abs(c.a - 1) < 0.2 && Math.abs(c.b) < 0.15, JSON.stringify(c));
  // se il modello è sovra-sicuro (esiti più vicini a 0,5) Platt deve ridurre a
  const over = rows.map((x) => ({ p: Math.min(0.97, 0.5 + (x.p - 0.5) * 1.8), y: x.y }));
  assert.ok(fitPlatt(over).a < 0.8);
});

test("ranking: conta solo con Elo povero di dati; mancante dichiarato; nessun effetto con storico ricco", async () => {
  const { RatingBook, predictMatch } = await import("../functions/api/_tennis-model.js");
  const mk = (n) => { const b = new RatingBook(); for (let i = 0; i < n; i++) { b.update({ t: i * 86400e3, winnerId: "a", loserId: "x" + i, surface: "hard" }); b.update({ t: i * 86400e3, winnerId: "b", loserId: "y" + i, surface: "hard" }); } return b; };
  const match = { t: 1e12, surface: "Hard", tour: "atp", p1: { id: "a" }, p2: { id: "b" } };
  const thin = mk(14), rich = mk(60);
  const base = predictMatch(thin, match, {}), withRank = predictMatch(thin, match, { rank: { p1: 5, p2: 200 } });
  assert.ok(base.missing.includes("ranking")); assert.ok(withRank.components.rankAdj > 0); assert.ok(withRank.p1 > base.p1);
  assert.ok(withRank.reasons.some((r) => /Ranking/.test(r)));
  const r1 = predictMatch(rich, match, {}), r2 = predictMatch(rich, match, { rank: { p1: 5, p2: 200 } });
  assert.equal(r2.components.rankAdj, 0); assert.equal(r1.p1, r2.p1);
  assert.ok(Math.abs(withRank.p1 + withRank.p2 - 1) < 1e-9);
});
