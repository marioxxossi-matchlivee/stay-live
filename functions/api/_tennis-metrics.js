// Stay Live Tennis — metriche e backtest cronologico. Logica pura (nessuna rete).
import { RatingBook, predictMatch, normalizeSurface, logit, logistic, TENNIS_MODEL } from "./_tennis-model.js";

const EPS = 1e-6;
const clip = (p) => Math.min(1 - EPS, Math.max(EPS, p));

/** Ogni elemento: { p (probabilità dichiarata per il giocatore 1), y (1 se ha vinto il giocatore 1, 0 altrimenti) }. */
export const brier = (rows) => (rows.length ? rows.reduce((s, r) => s + (r.p - r.y) ** 2, 0) / rows.length : null);
export const logLoss = (rows) => (rows.length ? rows.reduce((s, r) => s - (r.y ? Math.log(clip(r.p)) : Math.log(clip(1 - r.p))), 0) / rows.length : null);
export const accuracy = (rows) => (rows.length ? rows.filter((r) => (r.p >= 0.5 ? 1 : 0) === r.y).length / rows.length : null);

/** Calibrazione sul favorito: per fascia di probabilità del pronosticato, confronta probabilità media e frequenza reale. */
export function calibrationBins(rows, edges = [0.5, 0.55, 0.6, 0.65, 0.7, 0.8, 1.0001]) {
  const out = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const inBin = rows.map((r) => (r.p >= 0.5 ? { p: r.p, hit: r.y === 1 } : { p: 1 - r.p, hit: r.y === 0 })).filter((r) => r.p >= edges[i] && r.p < edges[i + 1]);
    out.push({
      from: edges[i], to: Math.min(edges[i + 1], 1), n: inBin.length,
      meanP: inBin.length ? inBin.reduce((s, r) => s + r.p, 0) / inBin.length : null,
      hitRate: inBin.length ? inBin.filter((r) => r.hit).length / inBin.length : null,
    });
  }
  return out;
}

export function summarize(rows) {
  return { n: rows.length, accuracy: accuracy(rows), brier: brier(rows), logLoss: logLoss(rows), calibration: calibrationBins(rows) };
}

/** Riassunto per gruppo (superficie, ATP/WTA, ...): key = funzione che dà il gruppo di una riga. */
export function groupSummary(rows, key) {
  const groups = new Map();
  for (const r of rows) { const k = key(r) ?? "n.d."; (groups.get(k) ?? groups.set(k, []).get(k)).push(r); }
  return Object.fromEntries([...groups].map(([k, v]) => [k, summarize(v)]));
}

/** Campione minimo sotto il quale non si dichiara nulla sull'affidabilità del modello. */
export const MIN_RELIABLE_SAMPLE = 300;
export const sampleVerdict = (n) => (n >= MIN_RELIABLE_SAMPLE ? "campione adeguato" : `campione insufficiente (${n}/${MIN_RELIABLE_SAMPLE})`);

/** Calibrazione di Platt: trova a, b che minimizzano la log loss di sigmoid(a*logit(p)+b). Discesa del gradiente (nessuna dipendenza). */
export function fitPlatt(rows, { iters = 800, lr = 0.05 } = {}) {
  if (rows.length < 50) return null; // pochi dati: nessuna calibrazione (meglio l'identità)
  let a = 1, b = 0;
  const xs = rows.map((r) => logit(clip(r.p)));
  for (let it = 0; it < iters; it++) {
    let ga = 0, gb = 0;
    for (let i = 0; i < rows.length; i++) {
      const err = logistic(a * xs[i] + b) - rows[i].y;
      ga += err * xs[i]; gb += err;
    }
    a -= (lr * ga) / rows.length; b -= (lr * gb) / rows.length;
  }
  return { a, b, n: rows.length };
}

/**
 * Backtest cronologico senza look-ahead. `history`: partite concluse
 * { t (ms), winnerId, loserId, surface, tour, bestOf?, p1Name?, p2Name?, extras? }.
 * Ordine: per giorno; tutte le partite del giorno sono previste con i rating di PRIMA di quel giorno, poi si aggiornano.
 * Per ogni partita il "giocatore 1" è scelto in modo deterministico e neutro (id più piccolo) per non codificare il vincitore.
 */
export function chronologicalBacktest(history, { warmup = 0, cfg = TENNIS_MODEL, calibrator = null } = {}) {
  const sorted = [...history].sort((a, b) => a.t - b.t || String(a.winnerId).localeCompare(String(b.winnerId)) || String(a.loserId).localeCompare(String(b.loserId)) || String(a.surface).localeCompare(String(b.surface)));
  const book = new RatingBook(cfg);
  const rows = [];
  let i = 0;
  while (i < sorted.length) {
    const day = Math.floor(sorted[i].t / 86400e3);
    let j = i;
    while (j < sorted.length && Math.floor(sorted[j].t / 86400e3) === day) j++;
    const batch = sorted.slice(i, j);
    for (const m of batch) {
      if (i < warmup) continue;
      const swap = String(m.winnerId) > String(m.loserId); // p1 = id minore → posizione indipendente dall'esito
      const [a, b] = swap ? [m.loserId, m.winnerId] : [m.winnerId, m.loserId];
      const pred = predictMatch(book, {
        t: m.t, surface: m.surface, tour: m.tour, bestOf: m.bestOf,
        p1: { id: a, name: swap ? m.p2Name : m.p1Name }, p2: { id: b, name: swap ? m.p1Name : m.p2Name },
      }, m.extras ? (swap ? flipExtras(m.extras) : m.extras) : {}, calibrator, cfg);
      rows.push({ t: m.t, tour: m.tour, surface: normalizeSurface(m.surface), published: pred.published, pick: pred.pick,
        p: pred.p1, y: a === m.winnerId ? 1 : 0, reliability: pred.reliability });
    }
    for (const m of batch) book.update({ t: m.t, winnerId: m.winnerId, loserId: m.loserId, surface: normalizeSurface(m.surface) });
    i = j;
  }
  const published = rows.filter((r) => r.published);
  return { rows, published, abstained: rows.length - published.length, summary: summarize(published.map(({ p, y }) => ({ p, y }))), verdict: sampleVerdict(published.length) };
}

function flipExtras(e) {
  return { h2h: e.h2h ? { p1Wins: e.h2h.p2Wins, p2Wins: e.h2h.p1Wins } : undefined, stats1: e.stats2, stats2: e.stats1 };
}
