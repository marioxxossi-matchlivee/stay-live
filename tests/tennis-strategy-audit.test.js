import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { bandOf, gapOf, competitionLabel, summarizeSides, replay, analyze, passesCurrentRules, pickBestPerMatch } from "../scripts/tennis-strategy-audit.js";

test("fasce di quota e di scarto", () => {
  assert.equal(bandOf(1.2), "1,20–1,50"); assert.equal(bandOf(1.5), "1,50–2,00"); assert.equal(bandOf(17.48), "oltre 10,00"); assert.equal(bandOf(10), "oltre 10,00"); assert.equal(bandOf(9.99), "5,00–10,00");
  assert.equal(gapOf(0.127), "12–15 pt"); assert.equal(gapOf(-0.1), "modello ≤ mercato");
});
test("etichette: circuito maschile/femminile distinto dalla categoria", () => {
  assert.equal(competitionLabel("atp", "itf", "M25 Vale do Lobo"), "ITF MASCHILE M25");
  assert.equal(competitionLabel("wta", "itf", "W50 Funchal"), "ITF FEMMINILE W50");
  assert.equal(competitionLabel("wta", "itf", "W15 Alcala de Henares"), "ITF FEMMINILE W15");
  assert.equal(competitionLabel("atp", "tour", "Paris"), "ATP TOUR"); assert.equal(competitionLabel("wta", "tour", "Linz"), "WTA TOUR");
  assert.equal(competitionLabel("atp", "challenger", "Knoxville Challenger"), "CHALLENGER");
  assert.match(competitionLabel("atp", "challenger_itf", "X"), /NON DISTINTO/); assert.match(competitionLabel("atp", "unknown", null), /SCONOSCIUTA/);
});
test("metriche: ROI, scarto di calibrazione, Brier", () => {
  const s = summarizeSides([{ p: 0.5, y: 1, odds: 3, mkt: 0.4 }, { p: 0.5, y: 0, odds: 3, mkt: 0.4 }]);
  assert.equal(s.n, 2); assert.equal(s.roi, 0.5); assert.equal(s.brierModel, 0.25); assert.equal(s.calibrationGapPt, 0); assert.equal(s.avgEv, 0.5);
});
test("regole attuali: quota minima, EV minimo, scarto massimo 15 punti, affidabilità", () => {
  const base = { reliability: "alta", category: "itf", odds: 6, p: 0.3, gap: 0.13 };
  assert.equal(passesCurrentRules(base), true);
  assert.equal(passesCurrentRules({ ...base, gap: 0.16 }), false);
  assert.equal(passesCurrentRules({ ...base, odds: 1.4 }), false);
  assert.equal(passesCurrentRules({ ...base, p: 0.16 }), false);
  assert.equal(passesCurrentRules({ ...base, reliability: "media" }), false); // ITF: serve «alta»
  assert.equal(passesCurrentRules({ ...base, category: "tour", reliability: "media" }), true);
});
test("un solo lato per partita: quello con EV maggiore", () => {
  const out = pickBestPerMatch([{ key: "a", p: 0.6, odds: 1.8 }, { key: "a", p: 0.4, odds: 3 }, { key: "b", p: 0.5, odds: 2 }]);
  assert.equal(out.length, 2); assert.equal(out.find((x) => x.key === "a").odds, 3);
});
test("rigioco: nessun look-ahead (stessa partita, risultato opposto → stessa probabilità) e struttura dei lati", () => {
  const mk = (i, w) => ({ match_key: `m${i}`, p1_id: "1", p2_id: "2", p1_name: "A", p2_name: "B", winner: w, starts_at: new Date(Date.UTC(2026, 0, 1 + i)).toISOString(), surface: "Hard", best_of: 3, tour: "atp", category: "tour", tournament: "T", closing_odds: { 1: 1.9, 2: 2.0 } });
  const a = replay([mk(0, 1), mk(1, 1), mk(2, 1)]), b = replay([mk(0, 1), mk(1, 1), mk(2, 2)]);
  const last = (x) => x.filter((s) => s.key === "m2" && s.slot === 1)[0]?.p;
  assert.equal(last(a), last(b), "l'esito dell'ultima partita non entra nella sua previsione");
  assert.ok(a.every((s) => s.odds > 1 && s.mkt > 0 && s.mkt < 1 && (s.y === 0 || s.y === 1)));
});
test("rigioco senza quote di chiusura: nessun lato; analyze su insieme vuoto non si rompe", () => {
  const m = { match_key: "x", p1_id: "1", p2_id: "2", winner: 1, starts_at: "2026-01-01T10:00:00Z", surface: "Hard", tour: "atp", category: "tour", closing_odds: null };
  assert.equal(replay([m]).length, 0);
  const a = analyze([]); assert.equal(a.allSides.n, 0); assert.equal(a.itf8.excluded.n, 0);
});
test("lo script di audit è di sola lettura: nessuna scrittura su Supabase né richiesta al provider", () => {
  const src = fs.readFileSync(new URL("../scripts/tennis-strategy-audit.js", import.meta.url), "utf8");
  assert.ok(!/supabase(Upsert|Patch|Delete)|_tennis-client|createClient|method:\s*["']?(POST|PATCH|DELETE|PUT)/i.test(src));
});

import { staleExperiment, ratingDrift, buildReport } from "../scripts/tennis-strategy-audit.js";
test("esperimento A: dopo il taglio i rating congelati differiscono dagli aggiornati; senza taglio non è disponibile", () => {
  const ids = ["1", "2", "3", "4", "5", "6"];
  const mk = (i) => { const a = ids[i % 6], b = ids[(i * 5 + 1) % 6 === i % 6 ? (i + 1) % 6 : (i * 5 + 1) % 6], w = i % 3 === 0 ? 2 : 1; return { match_key: `m${i}`, p1_id: a, p2_id: b, p1_name: `P${a}`, p2_name: `P${b}`, winner: w, starts_at: new Date(Date.UTC(2026, 0, 1) + i * 86400e3).toISOString(), surface: "Hard", best_of: 3, tour: "atp", category: "tour", tournament: "T", closing_odds: { [a]: 1.9, [b]: 2.0 } }; };
  const ms = Array.from({ length: 160 }, (_, i) => mk(i)), cut = Date.parse(ms[99].starts_at);
  const e = staleExperiment(ms, cut);
  assert.equal(e.available, true); assert.ok(e.comparedSides > 0 && e.frozen.sides.n === e.fresh.sides.n && e.frozen.sides.n === e.comparedSides, "confronto sulle stesse partite e gli stessi lati");
  assert.ok(e.pDiffMeanPt > 0, "i rating congelati danno probabilità diverse da quelli aggiornati"); assert.ok(e.frozen.meanAbsGapPt >= 0);
  assert.equal(staleExperiment(ms, null).available, false);
});

import { fitLogit, walkForwardVsMarket, analyzeRelaxed, oosPredictions, matchRows, clusterBootstrap, holm, operationalFilter, simulateOOS } from "../scripts/tennis-strategy-audit.js";
import { TENNIS_BET, evaluateBet } from "../functions/api/_tennis-bet.js";
const lcg = (seed) => () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const logit = (p) => Math.log(p / (1 - p)), sigm = (z) => 1 / (1 + Math.exp(-z));
/** Dati sintetici: il «vero» esito segue la probabilità vera; il mercato la conosce, il modello è rumoroso (o viceversa). */
function synth(n, { marketKnowsTruth }, seed = 7) {
  const rnd = lcg(seed), rows = [];
  for (let i = 0; i < n; i++) {
    const truth = sigm((rnd() - 0.5) * 4), noisy = Math.min(0.97, Math.max(0.03, truth + (rnd() - 0.5) * 0.3)), y = rnd() < truth ? 1 : 0;
    const mkt = marketKnowsTruth ? truth : noisy, model = marketKnowsTruth ? noisy : truth;
    rows.push({ x1: logit(mkt), x2: logit(model) - logit(mkt), y });
  }
  return rows;
}
test("regressione sul mercato: modello rumoroso → c vicino a 0; modello più informato del mercato → c alto", () => {
  const a = fitLogit(synth(6000, { marketKnowsTruth: true })), b = fitLogit(synth(6000, { marketKnowsTruth: false }));
  assert.ok(a.c < 0.2 && a.b > 0.8, `c=${a.c} b=${a.b}`);
  assert.ok(b.c > 0.6, `c=${b.c}`);
  assert.equal(fitLogit([]), null);
});
test("selezioni senza requisito di affidabilità: i lati ITF compaiono, 8 punti separa mantenute ed escluse", () => {
  const mk = (key, gap) => ({ key, slot: 1, category: "itf", label: "ITF MASCHILE M25", reliability: "media", odds: 6, p: 0.17 + gap, mkt: 0.17, gap, y: 0, isUnderdog: true });
  const out = analyzeRelaxed([mk("a", 0.12), mk("b", 0.06)]);
  assert.equal(out.selections.n, 2); assert.equal(out.itf8.kept.n, 1); assert.equal(out.itf8.excluded.n, 1);
});

import { STRATEGY2, classifySide, evaluateDouble, adjustProbability } from "../functions/api/_tennis-strategy2.js";
import { strategy2WalkForward } from "../scripts/tennis-strategy-audit.js";
test("strategy2: classi A/B/C/D motivate; senza prova statistica il vantaggio resta «da monitorare»", () => {
  const base = { pAdj: 0.3, pModel: 0.3, mkt: 0.2, odds: 5, reliability: "media" }; // EV rimodulato +50%
  assert.equal(classifySide({ ...base, evidence: { c: 0.02, se: 0.02, clusters: 200 } }).tier, "C");
  assert.equal(classifySide({ ...base, evidence: { c: 0.6, se: 0.2, clusters: 200 } }).tier, "B");         // c − 2,58·se > 0; c − 3,29·se < 0
  assert.equal(classifySide({ ...base, evidence: { c: 0.8, se: 0.1, clusters: 200 } }).tier, "A");         // robusta e EV ≥ 6%
  assert.equal(classifySide({ ...base }).tier, "C");                                         // niente evidenza per categoria
  const d1 = classifySide({ ...base, pModel: 0.4, evidence: { c: 0.8, se: 0.1, clusters: 200 } }); assert.equal(d1.tier, "D"); assert.match(d1.reasons[0], /anomalo/); // 20 punti di scarto
  assert.equal(classifySide({ ...base, pAdj: 0.21, evidence: { c: 0.8, se: 0.1, clusters: 200 } }).tier, "B"); // EV +5%: sopra il minimo ma sotto la soglia della classe A
  assert.equal(classifySide({ ...base, pAdj: 0.19, evidence: { c: 0.8, se: 0.1, clusters: 200 } }).tier, "D"); // EV −5%: scartata
});
test("strategy2: rimodulazione verso il mercato; c=0 → coincide con il mercato (con b=1)", () => {
  assert.ok(Math.abs(adjustProbability({ a: 0, b: 1, c: 0 }, 0.4, 0.2) - 0.2) < 1e-9);
  assert.ok(Math.abs(adjustProbability({ a: 0, b: 1, c: 1 }, 0.4, 0.2) - 0.4) < 1e-9);
});
test("strategy2: doppia solo con due singole A/B non correlate e migliore delle singole; altrimenti zero", () => {
  const A = { tier: "A", pAdj: 0.7, odds: 1.9, tournament: "X" }, B = { tier: "B", pAdj: 0.68, odds: 1.95, tournament: "Y" };
  assert.equal(evaluateDouble(A, { ...B, tier: "C" }).propose, false);
  assert.equal(evaluateDouble(A, { ...B, tournament: "X" }).propose, false);
  const under = evaluateDouble({ tier: "B", pAdj: 0.33, odds: 6.05, tournament: "P" }, { tier: "B", pAdj: 0.44, odds: 4.25, tournament: "Q" });
  assert.equal(under.propose, false); assert.match(under.reasons.join(" "), /probabilità congiunta/); // il caso reale Peet + Vrancken Peeters (congiunta 14,5%)
});
test("strategy2 walk-forward: su dati di solo rumore le classi A/B restano rare e la A non compare mai", () => {
  const world = (seed) => { const rnd = lcg(seed), sides = []; for (let i = 0; i < 4000; i++) { const t = Date.UTC(2026, 0, 1) + i * 2 * 3600e3, truth = sigm((rnd() - 0.5) * 3), mkt = Math.min(0.95, Math.max(0.05, truth + (rnd() - 0.5) * 0.03)), p = Math.min(0.95, Math.max(0.05, mkt + (rnd() - 0.5) * 0.3)), y = rnd() < truth ? 1 : 0; for (const s of [1, 2]) sides.push({ key: `k${i}`, slot: s, t, tournament: `T${Math.floor(i / 40)}`, tour: "atp", category: "tour", label: "ATP TOUR", p: s === 1 ? p : 1 - p, mkt: s === 1 ? mkt : 1 - mkt, odds: 0.95 / (s === 1 ? mkt : 1 - mkt), y: s === 1 ? y : 1 - y, reliability: "media", isUnderdog: false }); } return sides; };
  let worldsWithAB = 0, a = 0, ab = 0, tested = 0;
  for (let seed = 1; seed <= 12; seed++) { const w = strategy2WalkForward(world(seed)); tested += w.testedMatches; a += w.tiers.A.n; ab += w.tiers["A+B"].n; if (w.tiers["A+B"].n) worldsWithAB++; assert.ok(w.discardedSides > 0); }
  assert.ok(tested > 0); assert.equal(a, 0, "classe A mai su rumore"); assert.ok(worldsWithAB <= 3, `mondi con A/B: ${worldsWithAB}/12`); assert.ok(ab / tested < 0.02, `quota A+B ${ab / tested}`);
});


// ───────────── Correzioni metodologiche (revisione del 18/11/2026) ─────────────
/** Mondo sintetico: il «vero» esito segue la probabilità vera; informed=true → il modello conosce la verità e il mercato è rumoroso. */
function world({ n = 6000, step = 2.5 * 3600e3, informed = false, cat = "tour", seed = 3 } = {}) {
  const rnd = lcg(seed), sides = [];
  for (let i = 0; i < n; i++) {
    const t = Date.UTC(2026, 0, 1) + i * step, truth = sigm((rnd() - 0.5) * 3.2), noisy = Math.min(0.95, Math.max(0.05, truth + (rnd() - 0.5) * 0.3)), y = rnd() < truth ? 1 : 0;
    const mkt = informed ? noisy : Math.min(0.95, Math.max(0.05, truth + (rnd() - 0.5) * 0.03)), p = informed ? truth : noisy;
    for (const s of [1, 2]) sides.push({ key: `k${i}`, slot: s, t, tournament: `T${Math.floor(i / 40)}`, tour: "atp", category: cat, label: cat === "itf" ? "ITF MASCHILE M25" : "ATP TOUR", p: s === 1 ? p : 1 - p, mkt: s === 1 ? mkt : 1 - mkt, odds: 0.97 / (s === 1 ? mkt : 1 - mkt), y: s === 1 ? y : 1 - y, reliability: "media", isUnderdog: false });
  }
  return sides;
}
test("walk-forward: nessun look-ahead — cambiare gli esiti di un mese non altera le previsioni di quel mese né dei precedenti", () => {
  const sides = world({ n: 3200 }), rows = matchRows(sides), D1 = oosPredictions(rows, { minCategoryN: 100 });
  const months = D1.months, M = months[5]; assert.ok(months.length >= 7, `mesi ${months.length}`);
  const flipped = rows.map((r) => (r.t >= Date.parse(`${M}-01T00:00:00Z`) && r.t < Date.parse(`${months[6]}-01T00:00:00Z`) ? { ...r, y: 1 - r.y } : r));
  const D2 = oosPredictions(flipped, { minCategoryN: 100 }), by = (d) => new Map(d.test.map((r) => [r.key, r]));
  const m1 = by(D1), m2 = by(D2); let changedAfter = 0;
  for (const [k, a] of m1) { const b = m2.get(k); if (a.month <= M) for (const f of ["q0", "q1", "qL0", "qL1"]) assert.equal(a[f], b[f], `look-ahead su ${a.month} ${f}`); else if (a.q1 !== b.q1) changedAfter++; }
  assert.ok(changedAfter > 0, "controllo positivo: dal mese successivo le previsioni dipendono dagli esiti passati");
  D1.path.forEach((p) => assert.equal(p.trainMatches, rows.filter((r) => r.t < Date.parse(`${p.month}-01T00:00:00Z`)).length, "si addestra solo sui mesi precedenti"));
});
test("errori standard: con osservazioni correlate (blocchi) l'errore robusto è molto maggiore di quello che assume l'indipendenza", () => {
  const rnd = lcg(21), rows = [];
  for (let g = 0; g < 300; g++) { const u = (rnd() - 0.5) * 2.4, w = (rnd() - 0.5) * 2; for (let j = 0; j < 20; j++) { const x1 = (rnd() - 0.5) * 2; rows.push({ g: `g${g}`, x1, x2: w, y: rnd() < sigm(x1 + u) ? 1 : 0 }); } }
  const f = fitLogit(rows); assert.ok(f.seCRobust > 1.4 * f.seC, `robusto ${f.seCRobust} vs indipendente ${f.seC}`); assert.equal(f.clusters, 300);
});
test("bootstrap per blocchi riproducibile; Holm corregge i confronti multipli", () => {
  const items = Array.from({ length: 400 }, (_, i) => ({ g: `c${i % 40}`, v: 1 + (i % 7) * 0.1 })), run = () => clusterBootstrap(items, (z) => z.g, (z) => [z.v, 1], { B: 500, seed: 5 });
  const a = run(), b = run(); assert.deepEqual(a, b); assert.ok(a.lo < a.est && a.est < a.hi && a.pLe0 < 0.01);
  assert.deepEqual(holm([0.01, 0.02, 0.04]).map((v) => Math.round(v * 1000) / 1000), [0.03, 0.04, 0.04]);
  assert.equal(clusterBootstrap(items.slice(0, 5), (z) => z.g, (z) => [z.v, 1]).lo, null, "pochi blocchi: nessun intervallo affidabile dichiarato");
});
test("filtri operativi: la simulazione e _tennis-bet.js (evaluateBet) danno lo stesso verdetto su una griglia di casi", () => {
  let n = 0, bets = 0; const now = Date.parse("2026-11-18T12:00:00Z");
  for (const category of ["tour", "itf", "challenger", "challenger_itf"]) for (const reliability of ["alta", "media", "bassa"]) for (const odds of [1.3, 1.5, 1.8, 3, 6.05, 12]) for (const mkt of [0.05, 0.16, 0.3, 0.55, 0.8]) for (const p of [0.1, 0.17, 0.3, 0.45, 0.6, 0.85]) {
    const o2 = odds * mkt / (1 - mkt); if (!(o2 > 1)) continue; // la quota dell'altro lato si ricava dalla probabilità di mercato senza margine
    const match = { status: "scheduled", startsAt: new Date(now + 3600e3).toISOString(), oddsFetchedAt: new Date(now - 600e3).toISOString(), oddsSources: [{ book: "Pinnacle", p1: odds, p2: o2 }] };
    const verdict = evaluateBet(match, { published: true, pick: 1, p1: p, p2: 1 - p, reliability }, { now, category }).verdict === "BET";
    assert.equal(operationalFilter({ pModel: p, q: p, mkt, odds, reliability, category }, "A").ok, verdict, JSON.stringify({ category, reliability, odds, mkt, p })); n++; bets += verdict;
  }
  assert.ok(n > 300 && bets > 5 && bets < n, `casi ${n}, BET ${bets}`);
  assert.equal(operationalFilter({ pModel: 0.3, q: 0.3, mkt: 0.16, odds: 6, reliability: "media", category: "itf" }, "A*").ok, true, "A* ignora solo il requisito «alta»");
  assert.equal(operationalFilter({ pModel: 0.3, q: 0.3, mkt: 0.16, odds: 6, reliability: "media", category: "itf" }, "B").ok, true);
  assert.equal(operationalFilter({ pModel: 0.45, q: 0.3, mkt: 0.16, odds: 6, reliability: "media", category: "tour" }, "A").ok, false, "scarto dal mercato 29 punti sul modello grezzo");
});
test("simulazioni A/A*/B: stesse partite, A ⊆ A* ⊆ B, ogni selezione rispetta tutte le regole dichiarate", () => {
  const sides = world({ informed: true, cat: "tour" }), { test } = oosPredictions(matchRows(sides), { minCategoryN: 100 });
  const A = simulateOOS(test, "A"), As = simulateOOS(test, "A*"), B = simulateOOS(test, "B");
  assert.equal(A.matchesEvaluated, B.matchesEvaluated); assert.equal(As.matchesEvaluated, test.length);
  assert.ok(B.selections.n > 0, "con un modello informato la simulazione esplorativa trova qualcosa");
  assert.ok(A.selections.n <= As.selections.n && As.selections.n <= B.selections.n, `${A.selections.n} ≤ ${As.selections.n} ≤ ${B.selections.n}`);
  for (const k of A.keys) assert.ok(B.keys.has(k));
  const sel = simulateOOS(test, "A"); assert.ok(sel.selections.avgOdds >= TENNIS_BET.minOdds);
  const itf = oosPredictions(matchRows(world({ informed: true, cat: "itf" })), { minCategoryN: 100 }).test;
  assert.equal(simulateOOS(itf, "A").selections.n, 0, "ITF: senza affidabilità «alta» la strategia operativa non seleziona");
  assert.ok(simulateOOS(itf, "A").rejectedByA["categoria ITF/Challenger senza affidabilità alta"] > 0); assert.ok(simulateOOS(itf, "A*").selections.n > 0);
});
test("walkForwardVsMarket: in-sample e out-of-sample sono blocchi separati e il modello rumoroso non risulta informativo", () => {
  const w = walkForwardVsMarket(world({ n: 4000, seed: 9 }), { bootstrapCoef: false, minCategoryN: 100 });
  assert.match(w.inSample.nota, /NON è una valutazione out-of-sample/); assert.ok(w.oos && w.simulations.A && w.simulations.B);
  assert.ok(w.testedMatches > 0 && w.testedMatches < w.matches);
  assert.equal(w.oos.informativeOverall, false, `intervallo ${JSON.stringify(w.oos.infoLogLoss)}`); assert.ok(w.oos.infoLogLoss.lo <= 0);
  assert.ok(w.oos.byCategory.every((c) => !c.robust), "nessuna categoria robusta su rumore");
  const inf = walkForwardVsMarket(world({ n: 4000, informed: true, seed: 9 }), { bootstrapCoef: false, minCategoryN: 100 });
  assert.equal(inf.oos.informativeOverall, true, `controllo positivo: ${JSON.stringify(inf.oos.infoLogLoss)}`); assert.ok(inf.oos.infoLogLoss.est > 0);
});
test("il modulo sperimentale strategy2 NON è importato dal motore operativo, né dalle pagine o dai workflow di produzione", () => {
  const users = [], walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { if (["node_modules", ".git"].includes(f.name)) continue; const p = `${d}/${f.name}`; if (f.isDirectory()) walk(p); else if (/\.(js|mjs|yml|yaml|toml|html|json)$/.test(f.name) && /_tennis-strategy2/.test(fs.readFileSync(p, "utf8"))) users.push(p); } };
  for (const d of ["functions", "scripts", "src", ".github", "public"]) if (fs.existsSync(d)) walk(d);
  for (const f of ["index.html", "wrangler.toml", "package.json"]) if (fs.existsSync(f) && /_tennis-strategy2/.test(fs.readFileSync(f, "utf8"))) users.push(f);
  assert.deepEqual(users.filter((u) => u !== "scripts/tennis-strategy-audit.js" && u !== "functions/api/_tennis-strategy2.js"), [], "solo l'audit può importarlo");
});

test("strategy2: con pochi blocchi l'evidenza non basta (classe C), con abbastanza blocchi e prova solida può essere B/A", () => {
  const base = { pAdj: 0.3, pModel: 0.3, mkt: 0.2, odds: 5, reliability: "media" };
  assert.equal(classifySide({ ...base, evidence: { c: 0.8, se: 0.1, clusters: 20 } }).tier, "C");
  assert.equal(classifySide({ ...base, evidence: { c: 0.8, se: 0.1, clusters: 120 } }).tier, "A");
});

test("deriva dei rating: con lo storico troncato i giocatori hanno rating diversi e i nuovi sono sconosciuti; senza taglio non c'è confronto", () => {
  const ms = []; let w = 0; for (let i = 0; i < 120; i++) { const a = String(1 + (i % 5)), b = String(1 + ((i * 3 + 1) % 5)); if (a === b) continue; ms.push({ match_key: `m${i}`, p1_id: i > 100 ? "99" : a, p2_id: b, winner: (w++ % 3 === 0) ? 2 : 1, starts_at: new Date(Date.UTC(2026, 0, 1) + i * 864e5).toISOString(), surface: "Hard" }); }
  const d = ratingDrift(ms, Date.parse(ms[80].starts_at)); assert.ok(d.playersActiveAfterCutoff >= 5); assert.ok(d.meanAbsEloDiff > 0); assert.ok(d.unknownToFrozenBook >= 1, "il giocatore 99 compare solo dopo il taglio");
  assert.equal(ratingDrift(ms, null), null);
});
test("buildReport end-to-end su dati sintetici: tutte le sezioni presenti, nessun NaN, esperimento A con deriva dei rating", () => {
  let seed = 11; const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const players = Array.from({ length: 300 }, (_, i) => ({ id: String(1000 + i), s: (rnd() - 0.5) * 2 })), cats = [["atp", "tour", "Paris"], ["wta", "itf", "W15 Alcala"], ["atp", "itf", "M25 Faro"], ["atp", "challenger", "Knoxville"]], rows = [];
  for (let i = 0; i < 7000; i++) { const [tour, category, tn] = cats[i % 4], a = players[Math.floor(rnd() * 300)], b = players[Math.floor(rnd() * 300)]; if (a === b) continue; const truth = sigm(a.s - b.s), mk = Math.min(0.95, Math.max(0.05, truth + (rnd() - 0.5) * 0.05)); rows.push({ match_key: `m${i}`, p1_id: a.id, p2_id: b.id, p1_name: "A", p2_name: "B", winner: rnd() < truth ? 1 : 2, starts_at: new Date(Date.UTC(2025, 10, 16) + i * 3e5 * 3.6).toISOString(), surface: "Hard", best_of: 3, tour, category, tournament: `${tn} ${Math.floor(i / 50)}`, closing_odds: { [a.id]: +(0.95 / mk).toFixed(2), [b.id]: +(0.95 / (1 - mk)).toFixed(2) } }); }
  const { rep, md } = buildReport(rows, { pages: 1, duplicates: 0, truncated: false });
  for (const sec of ["VALUTAZIONE OUT-OF-SAMPLE", "DIAGNOSTICO in-sample", "Simulazioni retrospettive", "Strategy Center 2.0 sperimentale", "Classificazione tornei", "Esperimento"]) assert.ok(md.includes(sec) || sec === "Esperimento", `manca: ${sec}`);
  assert.ok(!/NaN|undefined/.test(md)); assert.equal(rep.history.truncated, false); assert.ok(rep.market.simulations.A.matchesEvaluated === rep.market.simulations.B.matchesEvaluated);
});
