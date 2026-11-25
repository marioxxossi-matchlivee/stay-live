/**
 * Stay Live — CONTINUOUS LEARNING: nucleo statistico PURO (nessuna rete, nessun database, nessun file, nessuna dipendenza).
 * Lavora su «record normalizzati»: { id, sport, t (ms), p (probabilità dell'evento), y (0/1), group (previsioni dipendenti), block (blocco temporale/torneo/campionato) }.
 * Isolato dai motori operativi: non importa nulla da essi e non li modifica.
 */
export const LEARNING = { version: "learning-v1", minSample: 300, minBlocks: 50, minSegment: 60, minBin: 30, bins: 10, reps: 1000, seed: 20261124, alpha: 0.05, eps: 1e-4, weekMs: 7 * 864e5 };

export const clip = (p, e = LEARNING.eps) => Math.min(1 - e, Math.max(e, p));
export const logit = (p) => { const q = clip(p); return Math.log(q / (1 - q)); };
export const sigmoid = (x) => 1 / (1 + Math.exp(-x));
export const lossLog = (p, y) => -(y ? Math.log(clip(p)) : Math.log(clip(1 - p)));
export const lossBrier = (p, y) => (p - y) ** 2;
export const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
export const r4 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1e4) / 1e4);
export const weekOf = (t) => Math.floor(t / LEARNING.weekMs);

/** Generatore pseudo-casuale con seme (riproducibile). */
export function rng(seed = LEARNING.seed) { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); }

/** Impronta deterministica a 128 bit (non crittografica): identificatori di esperimenti e insiemi di dati. */
export function hash128(str) {
  let a = 0xdeadbeef, b = 0x41c6ce57, c = 0x9e3779b1, d = 0x85ebca6b;
  for (let i = 0; i < str.length; i++) { const x = str.charCodeAt(i); a = Math.imul(a ^ x, 2654435761); b = Math.imul(b ^ x, 1597334677); c = Math.imul(c ^ x, 2246822519); d = Math.imul(d ^ x, 3266489917); a ^= a >>> 15; b ^= b >>> 13; c ^= c >>> 16; d ^= d >>> 11; }
  return [a ^ (b >>> 7), b ^ (c >>> 9), c ^ (d >>> 5), d ^ (a >>> 3)].map((v) => (v >>> 0).toString(16).padStart(8, "0")).join("");
}
export function fingerprint(records) {
  const rows = records.map((r) => `${r.id}|${r.t}|${Number(r.p).toFixed(6)}|${r.y}`).sort();
  return hash128(rows.join("\n"));
}

/** Intervallo di Wilson (proporzione osservata). */
export function wilson(k, n, z = 1.96) {
  if (!n) return [null, null];
  const ph = k / n, den = 1 + (z * z) / n, c = ph + (z * z) / (2 * n), w = z * Math.sqrt((ph * (1 - ph)) / n + (z * z) / (4 * n * n));
  return [r4((c - w) / den), r4((c + w) / den)];
}

/** Aggrega valori per blocco: { sums, counts, keys }. */
export function blockAgg(values, blocks) {
  const idx = new Map(), sums = [], counts = [];
  for (let i = 0; i < values.length; i++) { const k = blocks[i]; let j = idx.get(k); if (j === undefined) { j = sums.length; idx.set(k, j); sums.push(0); counts.push(0); } sums[j] += values[i]; counts[j]++; }
  return { sums, counts, keys: [...idx.keys()] };
}

/**
 * Bootstrap a blocchi della media di `values` (blocchi ricampionati con reinserimento, seme fisso).
 * Restituisce stima, IC 95% percentile, p bilaterale per H0: media = 0, numero di blocchi.
 */
export function blockMean(values, blocks, { reps = LEARNING.reps, seed = LEARNING.seed } = {}) {
  const n = values.length; if (!n) return { est: null, lo: null, hi: null, p: null, blocks: 0, n: 0 };
  const g = blockAgg(values, blocks), B = g.sums.length, est = g.sums.reduce((s, x) => s + x, 0) / n;
  if (B < 2) return { est: r4(est), lo: null, hi: null, p: null, blocks: B, n };
  const rnd = rng(seed), out = new Array(reps);
  for (let r = 0; r < reps; r++) { let s = 0, c = 0; for (let j = 0; j < B; j++) { const k = Math.floor(rnd() * B); s += g.sums[k]; c += g.counts[k]; } out[r] = s / c; }
  const sorted = out.slice().sort((a, b) => a - b), le = out.filter((x) => x <= 0).length, ge = out.filter((x) => x >= 0).length;
  return { est: r4(est), lo: r4(sorted[Math.floor(0.025 * reps)]), hi: r4(sorted[Math.ceil(0.975 * reps) - 1]), p: Math.max(1 / (reps + 1), Math.min(1, (2 * Math.min(le, ge)) / reps)), blocks: B, n };
}

/** Differenza di medie tra due gruppi INDIPENDENTI (a − b), blocchi ricampionati separatamente. */
export function blockDiffIndependent(a, b, { reps = LEARNING.reps, seed = LEARNING.seed } = {}) {
  if (!a.values.length || !b.values.length) return { est: null, lo: null, hi: null, p: null, blocksA: 0, blocksB: 0 };
  const ga = blockAgg(a.values, a.blocks), gb = blockAgg(b.values, b.blocks), est = mean(a.values) - mean(b.values);
  if (ga.sums.length < 2 || gb.sums.length < 2) return { est: r4(est), lo: null, hi: null, p: null, blocksA: ga.sums.length, blocksB: gb.sums.length };
  const rnd = rng(seed), out = new Array(reps), draw = (g) => { let s = 0, c = 0; const B = g.sums.length; for (let j = 0; j < B; j++) { const k = Math.floor(rnd() * B); s += g.sums[k]; c += g.counts[k]; } return s / c; };
  for (let r = 0; r < reps; r++) out[r] = draw(ga) - draw(gb);
  const sorted = out.slice().sort((x, y) => x - y), le = out.filter((x) => x <= 0).length, ge = out.filter((x) => x >= 0).length;
  return { est: r4(est), lo: r4(sorted[Math.floor(0.025 * reps)]), hi: r4(sorted[Math.ceil(0.975 * reps) - 1]), p: Math.max(1 / (reps + 1), Math.min(1, (2 * Math.min(le, ge)) / reps)), blocksA: ga.sums.length, blocksB: gb.sums.length };
}

/** Correzione di Holm: restituisce i p aggiustati nello stesso ordine. */
export function holm(ps) {
  const idx = ps.map((p, i) => [p ?? 1, i]).sort((a, b) => a[0] - b[0]), m = ps.length, out = new Array(m); let run = 0;
  idx.forEach(([p, i], rank) => { run = Math.max(run, Math.min(1, p * (m - rank))); out[i] = r4(run); });
  return out;
}

/** Fasce di calibrazione: probabilità dichiarata media, frequenza osservata con IC di Wilson, scarto. */
export function calibrationBins(recs, k = LEARNING.bins) {
  const b = Array.from({ length: k }, () => ({ n: 0, p: 0, y: 0 }));
  for (const r of recs) { const j = Math.min(k - 1, Math.floor(r.p * k)); b[j].n++; b[j].p += r.p; b[j].y += r.y; }
  return b.map((x, i) => { if (!x.n) return null; const claimed = x.p / x.n, observed = x.y / x.n, [lo, hi] = wilson(x.y, x.n); return { lo: i / k, hi: (i + 1) / k, n: x.n, claimed: r4(claimed), observed: r4(observed), gap: r4(observed - claimed), ciLo: lo, ciHi: hi }; }).filter(Boolean);
}
export const ece = (bins, n) => (n ? r4(bins.reduce((s, x) => s + (x.n / n) * Math.abs(x.gap), 0)) : null);

/** Regressione logistica pesata y ~ sigmoid(a + b·x) con piccola penalità ridge (stabilità). Newton–Raphson. */
export function logisticFit(xs, ys, w = null, { iters = 30, ridge = 1e-6, a0 = 0, b0 = 1 } = {}) {
  let a = a0, b = b0; const n = xs.length;
  for (let it = 0; it < iters; it++) {
    let g0 = 0, g1 = 0, h00 = ridge, h01 = 0, h11 = ridge;
    for (let i = 0; i < n; i++) { const wi = w ? w[i] : 1; if (!wi) continue; const p = sigmoid(a + b * xs[i]), r = ys[i] - p, v = p * (1 - p) * wi; g0 += wi * r; g1 += wi * r * xs[i]; h00 += v; h01 += v * xs[i]; h11 += v * xs[i] * xs[i]; }
    g0 -= ridge * a; g1 -= ridge * (b - 1);
    const det = h00 * h11 - h01 * h01; if (Math.abs(det) < 1e-12) break;
    const da = (h11 * g0 - h01 * g1) / det, db = (-h01 * g0 + h00 * g1) / det; a += da; b += db;
    if (Math.abs(da) + Math.abs(db) < 1e-9) break;
  }
  return { a, b };
}

/**
 * Pendenza e intercetta di calibrazione (y ~ a + b·logit(p)): b<1 = previsioni troppo estreme (sovra-confidenza), b>1 = troppo caute.
 * IC 95% con bootstrap a blocchi (pesi = molteplicità dei blocchi), seme fisso.
 */
export function calibrationFit(recs, { reps = 300, seed = LEARNING.seed } = {}) {
  if (recs.length < 10) return { slope: null, intercept: null, slopeCI: [null, null], interceptCI: [null, null], n: recs.length };
  const xs = recs.map((r) => logit(r.p)), ys = recs.map((r) => r.y), base = logisticFit(xs, ys), g = blockAgg(xs.map(() => 1), recs.map((r) => r.block)), B = g.keys.length;
  if (B < 2) return { slope: r4(base.b), intercept: r4(base.a), slopeCI: [null, null], interceptCI: [null, null], n: recs.length };
  const pos = new Map(g.keys.map((k, i) => [k, i])), bi = recs.map((r) => pos.get(r.block)), rnd = rng(seed), sl = [], ic = [];
  for (let r = 0; r < reps; r++) { const mult = new Array(B).fill(0); for (let j = 0; j < B; j++) mult[Math.floor(rnd() * B)]++; const w = bi.map((j) => mult[j]); const f = logisticFit(xs, ys, w, { iters: 12, a0: base.a, b0: base.b }); sl.push(f.b); ic.push(f.a); }
  const q = (arr) => { const s = arr.slice().sort((x, y) => x - y); return [r4(s[Math.floor(0.025 * s.length)]), r4(s[Math.ceil(0.975 * s.length) - 1])]; };
  return { slope: r4(base.b), intercept: r4(base.a), slopeCI: q(sl), interceptCI: q(ic), n: recs.length, blocks: B };
}

/** Indice di stabilità della popolazione tra due distribuzioni di probabilità (fasce uguali). */
export function psi(a, b, k = LEARNING.bins) {
  if (!a.length || !b.length) return null;
  const h = (v) => { const c = new Array(k).fill(0); for (const x of v) c[Math.min(k - 1, Math.floor(x * k))]++; return c.map((n) => Math.max(n / v.length, 1e-4)); }, pa = h(a), pb = h(b);
  return r4(pa.reduce((s, x, i) => s + (x - pb[i]) * Math.log(x / pb[i]), 0));
}

/** Sintesi di un insieme di record con IC a blocchi per Brier, log loss e accuratezza (secondaria). */
export function summarize(recs, opts = {}) {
  const n = recs.length, blocks = new Set(recs.map((r) => r.block)).size;
  if (!n) return { n: 0, blocks: 0, brier: null, logLoss: null, accuracy: null, ece: null, meanP: null, meanY: null, bias: null, calibration: [] };
  const bl = recs.map((r) => r.block), bins = calibrationBins(recs), meanP = mean(recs.map((r) => r.p)), meanY = mean(recs.map((r) => r.y));
  return { n, blocks, brier: blockMean(recs.map((r) => lossBrier(r.p, r.y)), bl, opts), logLoss: blockMean(recs.map((r) => lossLog(r.p, r.y)), bl, opts), accuracy: blockMean(recs.map((r) => ((r.p >= 0.5 ? 1 : 0) === r.y ? 1 : 0)), bl, opts),
    ece: ece(bins, n), meanP: r4(meanP), meanY: r4(meanY), bias: r4(meanP - meanY), calibration: bins, sufficient: n >= LEARNING.minSample && blocks >= LEARNING.minBlocks };
}
export const period = (recs) => (recs.length ? { from: new Date(Math.min(...recs.map((r) => r.t))).toISOString(), to: new Date(Math.max(...recs.map((r) => r.t))).toISOString() } : { from: null, to: null });
