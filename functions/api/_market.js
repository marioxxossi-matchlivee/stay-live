/**
 * Mercato (quote di API-Football) come terza fonte del cervello unico, accanto a ultime partite e pronostico del provider.
 * Probabilità implicite: 1 / quota per ogni esito, normalizzate a 1 (si toglie il margine del bookmaker), mediana tra i bookmaker.
 * Funzioni pure; il caricamento dei dati sta in _brain.js.
 */
import { summarizeBtts, summarizeDoubleChance, summarizeMatchWinner, summarizeOdds } from "./_apifootball.js";

const r4 = (v) => Math.round(v * 1e4) / 1e4;
const pair = (a, b) => { const x = 1 / a, y = 1 / b; return [x / (x + y), y / (x + y)]; };

/**
 * goalsResp = risposta `odds` del mercato "Goals Over/Under"; winnerResp = mercato "Match Winner" (entrambe opzionali).
 * Restituisce { p, odds, books, hasOu, has1x2 } o null se non c'è nulla di utilizzabile.
 *  - p: probabilità senza margine per home/draw/away, doppia chance e Over/Under 1,5-2,5-3,5
 *  - odds: quote reali (mediana e migliore) per le selezioni che il mercato quota direttamente: 1X2, Over/Under, e (se scaricate) doppia chance e
 *    gol/no gol. Le probabilità della doppia chance restano quelle derivate dall'1X2; per gol/no gol si aggiunge la probabilità senza margine.
 */
export function marketFrom(goalsResp, winnerResp, doubleChanceResp = null, bttsResp = null) {
  const p = {}, odds = {};
  const sum = summarizeOdds(goalsResp, null);
  for (const l of sum.goalLines) {
    if (![1.5, 2.5, 3.5].includes(l.line) || !l.over || !l.under) continue;
    const k = String(l.line * 10);
    const [po, pu] = pair(l.over.median, l.under.median);
    p[`over${k}`] = r4(po); p[`under${k}`] = r4(pu);
    odds[`over${k}`] = { median: l.over.median, best: l.over.best.odd, book: l.over.best.book, n: l.over.n };
    odds[`under${k}`] = { median: l.under.median, best: l.under.best.odd, book: l.under.best.book, n: l.under.n };
  }
  const w = summarizeMatchWinner(winnerResp);
  if (w) {
    const inv = [1 / w.home.median, 1 / w.draw.median, 1 / w.away.median], t = inv[0] + inv[1] + inv[2];
    const [h, d, a] = inv.map((x) => r4(x / t));
    Object.assign(p, { home: h, draw: d, away: a, dc1x: r4(h + d), dcx2: r4(d + a), dc12: r4(h + a) });
    for (const [k, x] of [["home", w.home], ["draw", w.draw], ["away", w.away]]) odds[k] = { median: x.median, best: x.best.odd, book: x.best.book, n: x.n };
  }
  const dc = summarizeDoubleChance(doubleChanceResp);
  if (dc) for (const k of ["dc1x", "dcx2", "dc12"]) odds[k] = { median: dc[k].median, best: dc[k].best.odd, book: dc[k].best.book, n: dc[k].n };
  const bt = summarizeBtts(bttsResp);
  if (bt) {
    const [py, pn] = pair(bt.btts.median, bt.nobtts.median);
    p.btts = r4(py); p.nobtts = r4(pn);
    for (const k of ["btts", "nobtts"]) odds[k] = { median: bt[k].median, best: bt[k].best.odd, book: bt[k].best.book, n: bt[k].n };
  }
  const hasOu = ["over25", "under25"].every((k) => k in p), has1x2 = Boolean(w);
  return Object.keys(p).length ? { p, odds, books: Math.max(sum.bookmakers ?? 0, w ? Math.min(w.home.n, w.draw.n, w.away.n) : 0), hasOu, has1x2 } : null;
}
