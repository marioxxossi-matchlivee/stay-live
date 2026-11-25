import test from "node:test";
import assert from "node:assert/strict";
import { runLab, splitTime, assertNoLeakage, CANDIDATES, defaultSpecs, proposeHypotheses, mergeLog, logEntry, LAB } from "../functions/api/_learning-lab.js";
import { diagnose } from "../functions/api/_learning-diagnostics.js";
import { LEARNING } from "../functions/api/_learning-core.js";
import { synth, T0, H } from "./learning-helpers.js";

const R = 200, NOW = Date.parse("2026-12-31T00:00:00Z");
const lab = (recs, extra = {}) => runLab(recs, { sport: "tennis", now: NOW, reps: R, ...extra });
const byCand = (out, c) => out.experiments.find((e) => e.change.candidate === c);

test("divisione: cronologica, per gruppi, holdout 20% all'ultimo tratto; fold in avanti senza sovrapposizioni", () => {
  const recs = synth(2000, { seed: 41, gsize: 3 }), s = splitTime(recs);
  assert.equal(s.dev.length + s.holdout.length, 2000); assert.ok(Math.abs(s.holdout.length - 400) <= 6);
  const devG = new Set(s.dev.map((r) => r.group)); assert.ok(s.holdout.every((r) => !devG.has(r.group)), "nessun gruppo a cavallo di sviluppo e holdout");
  assert.ok(Math.max(...s.dev.map((r) => r.t)) <= Math.min(...s.holdout.map((r) => r.t)), "l'holdout è tutto successivo");
  assert.equal(s.folds.length, LAB.folds); for (const f of s.folds) { assert.ok(f.val.length > 0); assert.doesNotThrow(() => assertNoLeakage(f.train, f.val, s.gmin)); assert.ok(Math.max(...f.train.map((r) => r.t)) <= Math.min(...f.val.map((r) => r.t))); }
  assert.ok(s.folds[1].train.length > s.folds[0].train.length, "finestra espansa");
});

test("anti-contaminazione: un gruppo condiviso o dati futuri nell'adattamento fanno fallire il confronto", () => {
  const recs = synth(600, { seed: 42, gsize: 2 }), s = splitTime(recs), f = s.folds[1];
  assert.throws(() => assertNoLeakage([...f.train, f.val[0]], f.val, s.gmin), /Contaminazione/);
  assert.throws(() => assertNoLeakage(f.val, f.train, s.gmin), /posteriori/);
});

test("dati sovra-confidenti: UN candidato validato su sviluppo e holdout; gli altri non toccano l'holdout; nulla applicato ai modelli", () => {
  const out = lab(synth(3200, { seed: 43, truth: 0.5 })), valid = out.experiments.filter((e) => e.verdict.status === "validato_storico");
  assert.equal(valid.length, 1); const v = valid[0]; assert.ok(["temperature", "platt", "shrink"].includes(v.change.candidate));
  assert.ok(v.comparison.logLossGain.lo > 0 && v.comparison.adjustedP < 0.05 && v.comparison.foldsImproved >= 2 / 3); assert.equal(v.holdout.evaluated, true); assert.ok(v.holdout.logLossGain.lo > 0); assert.ok(v.holdout.metrics.candidate.ece <= v.holdout.metrics.baseline.ece + LAB.eceTolerance);
  assert.equal(out.experiments.filter((e) => e.holdout.evaluated).length, 1, "l'holdout è valutato una sola volta");
  assert.ok(out.experiments.every((e) => e.change.appliedToOperationalModel === false)); assert.match(v.verdict.reasons[0], /Non adottato/);
});

test("dati già calibrati: nessun candidato è dichiarato migliore e l'holdout resta intatto", () => {
  const out = lab(synth(3200, { seed: 44, truth: 1.0 })); assert.equal(out.experiments.filter((e) => e.verdict.status === "validato_storico").length, 0);
  assert.ok(out.experiments.every((e) => e.holdout.evaluated === false && /intatto/.test(e.holdout.reason)));
});

test("contaminazione impossibile: cambiare gli esiti dell'holdout non modifica nessun risultato di sviluppo", () => {
  const recs = synth(3200, { seed: 45, truth: 0.5 }), s = splitTime(recs), hold = new Set(s.holdout.map((r) => r.id));
  const tampered = recs.map((r) => (hold.has(r.id) ? { ...r, y: 1 - r.y } : r)), a = lab(recs), b = lab(tampered);
  for (let i = 0; i < a.experiments.length; i++) { assert.deepEqual(a.experiments[i].comparison, b.experiments[i].comparison); assert.deepEqual(a.experiments[i].folds, b.experiments[i].folds); assert.deepEqual(a.experiments[i].metrics, b.experiments[i].metrics); }
});

test("il validatore non si lascia ingannare: un candidato che migliora solo lo sviluppo ma peggiora il tratto finale non è validato", () => {
  const first = synth(2200, { seed: 46, truth: 0.5 }), last = synth(1000, { seed: 47, truth: 1.0 }).map((r, i) => ({ ...r, id: `z${i}`, t: T0 + (2200 + i) * 2 * H, group: `z${i}`, block: `Z${i % 25}|${2200 + i}` })), out = lab([...first, ...last]);
  assert.equal(out.experiments.filter((e) => e.verdict.status === "validato_storico").length, 0, JSON.stringify(out.experiments.map((e) => [e.change.candidate, e.verdict.status])));
});

test("campione insufficiente: NON CONCLUSIVO (o nessun esperimento se i dati sono troppo pochi)", () => {
  const few = lab(synth(500, { seed: 48, truth: 0.4 })); assert.ok(few.experiments.every((e) => e.verdict.status === "non_conclusivo" || e.verdict.status === "non_validato" || e.verdict.status === "peggiore"));
  assert.ok(few.experiments.some((e) => e.verdict.status === "non_conclusivo")); assert.ok(few.experiments.every((e) => e.verdict.status !== "validato_storico"));
  const tiny = lab(synth(100, { seed: 49 })); assert.deepEqual(tiny.experiments, []); assert.match(tiny.note, /insufficienti/);
});

test("candidati: market_blend solo con quote normalizzate sufficienti; segment_offset impara solo da gruppi grandi; temperatura >1 attenua", () => {
  assert.ok(!defaultSpecs("tennis", synth(2000, { seed: 50 })).some((s) => s.candidate === "market_blend")); assert.ok(defaultSpecs("tennis", synth(2000, { seed: 51, market: true })).some((s) => s.candidate === "market_blend"));
  assert.deepEqual(defaultSpecs("football", synth(2000, { seed: 52, sport: "football" })).find((s) => s.candidate === "segment_offset").params, { dim: "market" });
  const over = synth(3000, { seed: 53, truth: 0.5 }), m = CANDIDATES.temperature.fit(over); assert.ok(m.params.T > 1.2); const hi = over.find((r) => r.p > 0.85); assert.ok(m.predict(hi) < hi.p);
  const off = CANDIDATES.segment_offset.fit(synth(2000, { seed: 54, truthBy: { clay: 0.2, hard: 1.0 } }), { dim: "surface" }); assert.ok(Object.keys(off.params.offsets).length === 2);
});

test("registro degli esperimenti: id deterministici, record completi, append-only e immutabile", () => {
  const recs = synth(3200, { seed: 55, truth: 0.5 }), a = lab(recs), b = lab(recs, { now: NOW + 9e6 }), e = a.experiments[0];
  assert.equal(e.id, b.experiments[0].id, "stesso id a parità di dati e parametri");
  for (const k of ["id", "sport", "createdAt", "engine", "baseVersion", "change", "dataset", "design", "training", "validation", "folds", "metrics", "comparison", "holdout", "verdict", "limits"]) assert.ok(k in e, k);
  assert.ok(e.dataset.fingerprint.length === 32 && e.training.period.from && e.validation.period.from); assert.equal(e.baseVersion[0].version, "v1");
  const l1 = mergeLog([], a.experiments), l2 = mergeLog(l1, b.experiments); assert.equal(l2.length, l1.length, "nessun duplicato");
  const l3 = mergeLog(l2, lab(synth(3300, { seed: 56, truth: 0.5 })).experiments); assert.ok(l3.length > l2.length); assert.deepEqual(l3.slice(0, l2.length), l2, "i record esistenti non cambiano");
  const clone = JSON.parse(JSON.stringify(a.experiments[0])); clone.verdict = { status: "validato_storico", reasons: ["x"] }; assert.throws(() => mergeLog(l1, [clone]), /immutabile/);
  assert.equal(logEntry(e).id, e.id);
});

test("ipotesi: derivate dalle anomalie, marcate «da verificare», mai cause accertate", () => {
  const d = diagnose(synth(3000, { seed: 57, truth: 0.45 }), { sport: "tennis", reps: 200 }), h = proposeHypotheses(d);
  assert.ok(h.length > 0 && h.every((x) => x.status === "da verificare" && d.anomalies.some((a) => a.id === x.anomalyId))); assert.ok(h.some((x) => ["temperature", "platt"].includes(x.candidate))); assert.deepEqual(proposeHypotheses({ available: false }), []);
});
