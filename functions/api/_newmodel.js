/**
 * MODELLO NEW (sperimentale, isolato): 1X2, doppia chance, Multigol a fasce e combinazioni risultato + Multigol.
 * Non sostituisce il motore OLD (model.js): ne legge solo i gol attesi (lh, la) e la funzione scoreMatrix.
 * NON produce nulla su Gol/NoGol, Over/Under, Corner. Nessuna raccomandazione: solo probabilità e stato di validazione.
 *
 * Le combinazioni NON si ottengono moltiplicando probabilità: ogni probabilità congiunta è la somma della matrice dei punteggi
 * P(casa=i, trasferta=j) sulle celle che soddisfano insieme risultato e fascia di gol (la dipendenza è già dentro la matrice).
 */
import { scoreMatrix } from "./model.js";
import { NM_PARAMS, NM_VALIDATION } from "./_newmodel-params.js";

export const NM_VERSION = "nm-1";
/** Fasce Multigol approvate (gol totali, estremi inclusi). */
export const NM_BANDS = [[1, 3], [1, 4], [2, 4], [2, 5], [3, 6]];
export const bandKey = ([lo, hi]) => `mg${lo}${hi}`;
export const bandLabel = ([lo, hi]) => `MG ${lo}-${hi}`;

export const NM_RESULTS = [
  { key: "home", label: "1", test: (h, a) => h > a },
  { key: "draw", label: "X", test: (h, a) => h === a },
  { key: "away", label: "2", test: (h, a) => h < a },
  { key: "dc1x", label: "1X", test: (h, a) => h >= a },
  { key: "dcx2", label: "X2", test: (h, a) => h <= a },
  { key: "dc12", label: "12", test: (h, a) => h !== a },
];

/** Elenco completo dei mercati NEW: { key, label, family }. family: esito | dc | multigol | combo. */
export const NM_MARKETS = [
  ...NM_RESULTS.slice(0, 3).map((r) => ({ key: r.key, label: r.label, family: "esito" })),
  ...NM_RESULTS.slice(3).map((r) => ({ key: r.key, label: r.label, family: "dc" })),
  ...NM_BANDS.map((b) => ({ key: bandKey(b), label: bandLabel(b), family: "multigol" })),
  ...NM_RESULTS.flatMap((r) => NM_BANDS.map((b) => ({ key: `${r.key}_${bandKey(b)}`, label: `${r.label} + ${bandLabel(b)}`, family: "combo" }))),
];
export const NM_KEYS = NM_MARKETS.map((m) => m.key);
export const NM_FAMILY_LABEL = { esito: "1X2", dc: "Doppia chance", multigol: "Multigol", combo: "Combinazioni" };

/** Probabilità grezze (senza calibrazione) di tutti i mercati NEW da una matrice di punteggi. */
export function marketsFromGrid(m) {
  const p = Object.fromEntries(NM_KEYS.map((k) => [k, 0]));
  m.forEach((row, h) => row.forEach((v, a) => {
    const t = h + a;
    const inBand = NM_BANDS.filter(([lo, hi]) => t >= lo && t <= hi).map(bandKey);
    for (const r of NM_RESULTS) {
      if (!r.test(h, a)) continue;
      p[r.key] += v;
      for (const b of inBand) p[`${r.key}_${b}`] += v;
    }
    for (const b of inBand) p[b] += v;
  }));
  return p;
}

/** Distribuzione dei gol totali (0..20) dalla matrice: serve all'adattamento del parametro rho. */
export function totalPmf(m) {
  const t = Array(m.length * 2 - 1).fill(0);
  m.forEach((row, h) => row.forEach((v, a) => { t[h + a] += v; }));
  return t;
}

const clip = (p) => Math.min(1 - 1e-9, Math.max(1e-9, p));
const platt = (cal, p) => 1 / (1 + Math.exp(-(cal.a * Math.log(clip(p) / (1 - clip(p))) + cal.b)));

/**
 * Probabilità NEW di una partita dai gol attesi. `params` = { rho, platt }, ottenuti SOLO da dati precedenti al periodo valutato
 * (si stimano con scripts/backtest-new-model.js). Con platt la calibrazione è per singolo mercato (1X2 rinormalizzato); le combinazioni
 * restano la congiunta della matrice, senza ritocchi.
 */
export function newMarkets(lh, la, params = NM_PARAMS) {
  const grid = scoreMatrix(lh, la, params?.rho ?? 0);
  const raw = marketsFromGrid(grid), p = { ...raw };
  const cal = params?.platt ?? {};
  for (const k of NM_KEYS) if (cal[k]?.a != null && NM_MARKETS.find((m) => m.key === k).family !== "combo") p[k] = platt(cal[k], raw[k]);
  if (cal.home || cal.draw || cal.away) { const s = p.home + p.draw + p.away; for (const k of ["home", "draw", "away"]) p[k] /= s; }
  return { version: NM_VERSION, p, raw };
}

/** Esito reale di tutti i mercati NEW dal punteggio finale (1/0). */
export function newOutcomes(h, a) {
  const t = h + a, y = {};
  for (const r of NM_RESULTS) {
    const ok = r.test(h, a) ? 1 : 0;
    y[r.key] = ok;
    for (const b of NM_BANDS) y[`${r.key}_${bandKey(b)}`] = ok && t >= b[0] && t <= b[1] ? 1 : 0;
  }
  for (const b of NM_BANDS) y[bandKey(b)] = t >= b[0] && t <= b[1] ? 1 : 0;
  return y;
}

/** Probabilità implicita dei tre esiti 1X2 depurata dal margine (proporzionale). Null se manca una quota. */
export function fairFromOdds(odds) {
  const o = [odds?.home, odds?.draw, odds?.away].map(Number);
  if (!o.every((v) => v > 1)) return null;
  const inv = o.map((v) => 1 / v), s = inv.reduce((a, b) => a + b, 0);
  return { home: inv[0] / s, draw: inv[1] / s, away: inv[2] / s, overround: s - 1 };
}

/** Stato di validazione di un mercato (dal backtest walk-forward); `non_validato` se il backtest non è mai stato eseguito. */
export const STATUS_LABEL = { validato: "validato", esplorativo: "esplorativo", non_calibrato: "non calibrato", instabile: "instabile", campione_insufficiente: "campione insufficiente", non_validato: "non validato" };
export const statusOf = (key, validation = NM_VALIDATION) => validation?.[key]?.status ?? "non_validato";
