/**
 * Metriche per il backtest. Funzioni pure, senza dipendenze.
 * ps = probabilità previste (0-1), ys = esiti (0/1).
 */
const EPS = 1e-12;
const clip = (p) => Math.min(1 - EPS, Math.max(EPS, p));
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

export const brier = (ps, ys) => mean(ps.map((p, i) => (p - ys[i]) ** 2));
export const logLoss = (ps, ys) => mean(ps.map((p, i) => -(ys[i] * Math.log(clip(p)) + (1 - ys[i]) * Math.log(1 - clip(p)))));

/** Expected Calibration Error su `bins` fasce di uguale ampiezza; restituisce anche la tabella di affidabilità. */
export function calibration(ps, ys, bins = 10) {
  const rows = Array.from({ length: bins }, () => ({ n: 0, p: 0, y: 0 }));
  ps.forEach((p, i) => { const b = rows[Math.min(bins - 1, Math.floor(p * bins))]; b.n += 1; b.p += p; b.y += ys[i]; });
  const table = rows.map((b, k) => ({ lo: k / bins, hi: (k + 1) / bins, n: b.n, predicted: b.n ? b.p / b.n : null, observed: b.n ? b.y / b.n : null }));
  const ece = ps.length ? table.reduce((t, b) => t + (b.n / ps.length) * (b.n ? Math.abs(b.predicted - b.observed) : 0), 0) : null;
  return { ece, table };
}

/** Accuratezza, precisione e richiamo a soglia 0,5 sull'evento "esito = 1". */
export function classification(ps, ys, thr = 0.5) {
  let tp = 0, fp = 0, fn = 0, tn = 0;
  ps.forEach((p, i) => { const pred = p >= thr; if (pred && ys[i]) tp += 1; else if (pred) fp += 1; else if (ys[i]) fn += 1; else tn += 1; });
  const n = ps.length;
  return { n, accuracy: n ? (tp + tn) / n : null, precision: tp + fp ? tp / (tp + fp) : null, recall: tp + fn ? tp / (tp + fn) : null };
}

/** Riassunto di una serie di giocate a puntata fissa: bets = [{ stake, profit }] in ordine cronologico. */
export const MIN_BETS_FOR_CLAIM = 300;
export function bettingSummary(bets) {
  const n = bets.length;
  if (!n) return { n: 0, staked: 0, profit: 0, roi: null, hitRate: null, avgOdds: null, maxDrawdown: 0, se: null, z: null, adequate: false };
  const staked = bets.reduce((t, b) => t + b.stake, 0), profit = bets.reduce((t, b) => t + b.profit, 0);
  const rets = bets.map((b) => b.profit / b.stake), m = mean(rets);
  const sd = n > 1 ? Math.sqrt(rets.reduce((t, r) => t + (r - m) ** 2, 0) / (n - 1)) : null;
  const se = sd == null ? null : sd / Math.sqrt(n);
  let peak = 0, cum = 0, dd = 0;
  for (const b of bets) { cum += b.profit; peak = Math.max(peak, cum); dd = Math.max(dd, peak - cum); }
  return {
    n, staked, profit, roi: profit / staked, hitRate: bets.filter((b) => b.profit > 0).length / n,
    avgOdds: mean(bets.map((b) => b.odds).filter(Number.isFinite)), maxDrawdown: dd, se, z: se ? m / se : null,
    // "dimostrato" solo con campione ampio E rendimento medio > 2 errori standard sopra zero
    adequate: n >= MIN_BETS_FOR_CLAIM && se != null && m > 2 * se,
  };
}

/**
 * Platt scaling: p' = sigmoid(a * logit(p) + b), stimato con Newton-Raphson smorzato (ricerca del passo sulla log loss,
 * leggera regolarizzazione verso l'identità a=1, b=0). Con meno di 30 punti o un solo esito restituisce l'identità.
 */
export function fitPlatt(ps, ys, iters = 100, ridge = 1e-3) {
  const id = { a: 1, b: 0, fitted: false };
  if (ps.length < 30 || new Set(ys).size < 2) return id;
  const x = ps.map((p) => Math.log(clip(p) / (1 - clip(p))));
  const loss = (a, b) => x.reduce((t, xi, i) => { const q = clip(1 / (1 + Math.exp(-(a * xi + b)))); return t - (ys[i] ? Math.log(q) : Math.log(1 - q)); }, 0) / x.length + ridge * ((a - 1) ** 2 + b ** 2);
  let a = 1, b = 0, cur = loss(a, b);
  for (let it = 0; it < iters; it += 1) {
    let ga = 2 * ridge * (a - 1) * x.length, gb = 2 * ridge * b * x.length, haa = 2 * ridge * x.length, hab = 0, hbb = 2 * ridge * x.length;
    x.forEach((xi, i) => { const q = 1 / (1 + Math.exp(-(a * xi + b))), w = q * (1 - q); ga += (q - ys[i]) * xi; gb += q - ys[i]; haa += w * xi * xi; hab += w * xi; hbb += w; });
    const det = haa * hbb - hab * hab + 1e-12;
    const da = (hbb * ga - hab * gb) / det, db = (haa * gb - hab * ga) / det;
    let step = 1, moved = false;
    for (let k = 0; k < 30; k += 1, step /= 2) {            // passo dimezzato finché la log loss non scende: niente divergenze
      const na = a - step * da, nb = b - step * db, nl = loss(na, nb);
      if (Number.isFinite(nl) && nl <= cur) { moved = Math.abs(cur - nl) > 1e-12; a = na; b = nb; cur = nl; break; }
    }
    if (!moved) break;
  }
  return Number.isFinite(a) && Number.isFinite(b) ? { a, b, fitted: true } : id;
}
export const applyPlatt = (cal, p) => 1 / (1 + Math.exp(-(cal.a * Math.log(clip(p) / (1 - clip(p))) + cal.b)));
