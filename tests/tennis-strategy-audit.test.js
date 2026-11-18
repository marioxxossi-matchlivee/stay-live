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

import { staleExperiment } from "../scripts/tennis-strategy-audit.js";
test("esperimento A: dopo il taglio i rating congelati differiscono dagli aggiornati; senza taglio non è disponibile", () => {
  const ids = ["1", "2", "3", "4", "5", "6"];
  const mk = (i) => { const a = ids[i % 6], b = ids[(i * 5 + 1) % 6 === i % 6 ? (i + 1) % 6 : (i * 5 + 1) % 6], w = i % 3 === 0 ? 2 : 1; return { match_key: `m${i}`, p1_id: a, p2_id: b, p1_name: `P${a}`, p2_name: `P${b}`, winner: w, starts_at: new Date(Date.UTC(2026, 0, 1) + i * 86400e3).toISOString(), surface: "Hard", best_of: 3, tour: "atp", category: "tour", tournament: "T", closing_odds: { [a]: 1.9, [b]: 2.0 } }; };
  const ms = Array.from({ length: 160 }, (_, i) => mk(i)), cut = Date.parse(ms[99].starts_at);
  const e = staleExperiment(ms, cut);
  assert.equal(e.available, true); assert.ok(e.comparedSides > 0 && e.frozen.sides.n === e.fresh.sides.n && e.frozen.sides.n === e.comparedSides, "confronto sulle stesse partite e gli stessi lati");
  assert.ok(e.pDiffMeanPt > 0, "i rating congelati danno probabilità diverse da quelli aggiornati"); assert.ok(e.frozen.meanAbsGapPt >= 0);
  assert.equal(staleExperiment(ms, null).available, false);
});

import { fitLogit, walkForwardVsMarket, analyzeRelaxed } from "../scripts/tennis-strategy-audit.js";
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
test("walk-forward sul mercato: nessun look-ahead, struttura del risultato e ROI coerente", () => {
  const rnd = lcg(11), sides = [];
  for (let i = 0; i < 2400; i++) {
    const t = Date.UTC(2026, 0, 1) + i * 3 * 3600e3, truth = sigm((rnd() - 0.5) * 3), mkt = Math.min(0.95, Math.max(0.05, truth + (rnd() - 0.5) * 0.05)), p = Math.min(0.95, Math.max(0.05, mkt + (rnd() - 0.5) * 0.3)), y = rnd() < truth ? 1 : 0, ov = 0.95;
    for (const s of [1, 2]) sides.push({ key: `k${i}`, slot: s, t, tour: "atp", category: "tour", label: "ATP TOUR", p: s === 1 ? p : 1 - p, mkt: s === 1 ? mkt : 1 - mkt, odds: ov / (s === 1 ? mkt : 1 - mkt), y: s === 1 ? y : 1 - y, reliability: "media", isUnderdog: false });
  }
  const w = walkForwardVsMarket(sides);
  assert.ok(w.testedMatches > 0 && w.testedMatches < w.matches, "i primi mesi servono solo ad addestrare");
  assert.ok(w.full.c < 0.35, `c=${w.full.c}`); assert.ok(w.brier.adjusted <= w.brier.model, "rimodulare sul mercato non peggiora il Brier del modello rumoroso");
  assert.ok(w.adjustedSelections.n >= 0 && (w.adjustedSelections.n === 0 || w.adjustedSelections.roi != null));
});
test("selezioni senza requisito di affidabilità: i lati ITF compaiono, 8 punti separa mantenute ed escluse", () => {
  const mk = (key, gap) => ({ key, slot: 1, category: "itf", label: "ITF MASCHILE M25", reliability: "media", odds: 6, p: 0.17 + gap, mkt: 0.17, gap, y: 0, isUnderdog: true });
  const out = analyzeRelaxed([mk("a", 0.12), mk("b", 0.06)]);
  assert.equal(out.selections.n, 2); assert.equal(out.itf8.kept.n, 1); assert.equal(out.itf8.excluded.n, 1);
});
