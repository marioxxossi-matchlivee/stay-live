import test from "node:test";
import assert from "node:assert/strict";
import { LEARNING, clip, logit, sigmoid, rng, hash128, fingerprint, wilson, blockMean, blockDiffIndependent, holm, calibrationBins, ece, logisticFit, calibrationFit, psi, summarize, lossLog, lossBrier } from "../functions/api/_learning-core.js";
import { synth } from "./learning-helpers.js";

test("funzioni di base: clip, logit/sigmoid inversi, perdite note, seme riproducibile", () => {
  assert.equal(clip(0), LEARNING.eps); assert.equal(clip(1), 1 - LEARNING.eps); assert.ok(Math.abs(sigmoid(logit(0.37)) - 0.37) < 1e-9);
  assert.ok(Math.abs(lossLog(0.5, 1) - Math.LN2) < 1e-12); assert.ok(Math.abs(lossBrier(0.7, 1) - 0.09) < 1e-12); assert.ok(lossLog(0, 1) < 12, "mai infinito");
  const a = rng(5), b = rng(5); assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
});

test("impronte: deterministiche e sensibili al contenuto; l'ordine delle righe non conta", () => {
  assert.equal(hash128("x"), hash128("x")); assert.notEqual(hash128("x"), hash128("y")); assert.match(hash128("x"), /^[0-9a-f]{32}$/);
  const r = synth(50), s = r.slice().reverse(); assert.equal(fingerprint(r), fingerprint(s)); const m = r.map((x, i) => (i === 3 ? { ...x, y: 1 - x.y } : x)); assert.notEqual(fingerprint(m), fingerprint(r));
});

test("Wilson e Holm: valori noti", () => {
  const [lo, hi] = wilson(50, 100); assert.ok(lo > 0.39 && lo < 0.41 && hi > 0.59 && hi < 0.61); assert.deepEqual(wilson(0, 0), [null, null]);
  assert.deepEqual(holm([0.01, 0.04, 0.03]), [0.03, 0.06, 0.06]); assert.deepEqual(holm([0.2]), [0.2]); assert.equal(holm([null])[0], 1);
});

test("bootstrap a blocchi: riproducibile, IC contiene la media, p piccolo se la media è lontana da 0, p grande se vicina", () => {
  const vals = Array.from({ length: 400 }, (_, i) => 0.3 + ((i * 37) % 11) / 50), blocks = vals.map((_, i) => `b${i % 40}`);
  const a = blockMean(vals, blocks), b = blockMean(vals, blocks); assert.deepEqual(a, b); assert.ok(a.lo < a.est && a.est < a.hi); assert.ok(a.p < 0.01); assert.equal(a.blocks, 40);
  const z = Array.from({ length: 400 }, (_, i) => (i % 2 ? 0.2 : -0.2)), zb = blockMean(z, z.map((_, i) => `b${i % 40}`)); assert.ok(zb.p > 0.2 && zb.lo < 0 && zb.hi > 0);
  assert.equal(blockMean([1, 2], ["a", "a"]).lo, null, "un solo blocco: nessun intervallo"); assert.equal(blockMean([], []).est, null);
});

test("differenza tra gruppi indipendenti: rileva uno scarto reale, non uno inesistente", () => {
  const mk = (n, mu, off) => ({ values: Array.from({ length: n }, (_, i) => mu + (((i * 31) % 9) - 4) / 40), blocks: Array.from({ length: n }, (_, i) => `${off}${i % 30}`) });
  const d = blockDiffIndependent(mk(300, 0.8, "a"), mk(300, 0.6, "b")); assert.ok(d.est > 0.15 && d.lo > 0 && d.p < 0.01);
  const e = blockDiffIndependent(mk(300, 0.7, "a"), mk(300, 0.7, "b")); assert.ok(e.lo < 0 && e.hi > 0 && e.p > 0.1);
});

test("calibrazione: fasce e ECE corretti su dati calibrati; regressione logistica recupera i parametri", () => {
  const r = synth(6000, { seed: 4, truth: 1.0 }), bins = calibrationBins(r); assert.ok(ece(bins, r.length) < 0.03); assert.ok(bins.every((b) => b.ciLo <= b.observed && b.observed <= b.ciHi));
  const rn = rng(9), xs = Array.from({ length: 5000 }, () => rn() * 4 - 2), ys = xs.map((x) => (rn() < sigmoid(0.4 + 0.7 * x) ? 1 : 0)), f = logisticFit(xs, ys); assert.ok(Math.abs(f.a - 0.4) < 0.1 && Math.abs(f.b - 0.7) < 0.1);
});

test("pendenza di calibrazione: ≈1 se calibrato, <1 e IC sotto 1 se sovra-confidente, >1 se troppo cauto", () => {
  const ok = calibrationFit(synth(3000, { seed: 6, truth: 1.0 }), { reps: 80 }); assert.ok(ok.slopeCI[0] < 1.05 && ok.slopeCI[1] > 0.9, JSON.stringify(ok));
  const over = calibrationFit(synth(3000, { seed: 7, truth: 0.5 }), { reps: 80 }); assert.ok(over.slope < 0.8 && over.slopeCI[1] < 1);
  const cautious = calibrationFit(synth(3000, { seed: 8, truth: 1.6 }), { reps: 80 }); assert.ok(cautious.slope > 1.1);
  assert.equal(calibrationFit([], {}).slope, null);
});

test("PSI: ≈0 per la stessa distribuzione, alto per distribuzioni diverse; summarize coerente", () => {
  const a = Array.from({ length: 500 }, (_, i) => (i % 100) / 100), b = a.slice().reverse(); assert.ok(psi(a, b) < 0.01); assert.ok(psi(a, a.map((x) => Math.min(0.99, x * 0.3 + 0.7))) > 0.25); assert.equal(psi([], a), null);
  const s = summarize(synth(400, { seed: 2 })); assert.equal(s.n, 400); assert.ok(s.brier.est > 0.15 && s.brier.est < 0.3); assert.equal(s.sufficient, s.blocks >= 50); assert.equal(summarize([]).n, 0);
});
