#!/usr/bin/env node
/**
 * Stay Live Tennis — AUDIT dello Strategy Center (Strategy Center 2.0, Fase 1-2-4). SOLA LETTURA.
 * Nessuna chiamata al provider sportivo, nessuna scrittura su Supabase, nessuna modifica a motore, soglie o strategie operative.
 * Rigioca in ordine cronologico (rating di PRIMA di ogni giorno, nessun look-ahead) il Prediction Engine ATTUALE sulle partite concluse
 * che hanno le quote di chiusura (tennis_matches.closing_odds), applica le regole ATTUALI di _tennis-bet.js e produce tabelle per fascia di quota,
 * favoriti/sfavoriti, categoria, scarto dal mercato e filtro ITF degli 8 punti.
 * LIMITE DICHIARATO: le quote sono quelle di CHIUSURA (non quelle disponibili al momento della previsione) e il rigioco riproduce la parte Elo+forma
 * (nessuna statistica di servizio, H2H o ranking storici): è un proxy, non la riproduzione esatta delle giocate passate.
 * Segreti: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (solo GET). Uso: node scripts/tennis-strategy-audit.js
 */
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { supabaseGet } from "../functions/api/_lib.js";
import { loadFinishedKeyset } from "../functions/api/_tennis-history.js";
import { RatingBook, predictMatch, normalizeSurface, TENNIS_MODEL } from "../functions/api/_tennis-model.js";
import { TENNIS_BET, noVig } from "../functions/api/_tennis-bet.js";
import { STRATEGY2, classifySide, adjustProbability } from "../functions/api/_tennis-strategy2.js";
export { STRATEGY2 }; // riesportata per l'audit v5 (solo lettura della configurazione)

export const BANDS = [[1.2, 1.5, "1,20–1,50"], [1.5, 2, "1,50–2,00"], [2, 3, "2,00–3,00"], [3, 5, "3,00–5,00"], [5, 10, "5,00–10,00"], [10, Infinity, "oltre 10,00"]];
export const bandOf = (odds) => BANDS.find(([a, b]) => odds >= a && odds < b)?.[2] ?? "sotto 1,20";
export const GAP_BANDS = [[-Infinity, 0, "modello ≤ mercato"], [0, 0.04, "0–4 pt"], [0.04, 0.08, "4–8 pt"], [0.08, 0.12, "8–12 pt"], [0.12, 0.15, "12–15 pt"], [0.15, Infinity, "oltre 15 pt"]];
export const gapOf = (g) => GAP_BANDS.find(([a, b]) => g >= a && g < b)?.[2];

/** Etichetta leggibile: circuito (dal provider: atp = maschile, wta = femminile) + categoria + livello dal nome del torneo. */
export function competitionLabel(tour, category, tournament) {
  const lvl = String(tournament ?? "").match(/^\s*([MW]\d{2,3})\b/i)?.[1]?.toUpperCase() ?? null;
  if (category === "itf") return `ITF ${tour === "wta" ? "FEMMINILE" : "MASCHILE"}${lvl ? ` ${lvl}` : ""}`;
  if (category === "challenger") return tour === "wta" ? "CHALLENGER FEMMINILE" : "CHALLENGER";
  if (category === "challenger_itf") return `CHALLENGER/ITF NON DISTINTO (${tour === "wta" ? "femminile" : "maschile"})`;
  if (category === "tour") return tour === "wta" ? "WTA TOUR" : "ATP TOUR";
  return "CATEGORIA SCONOSCIUTA";
}

// ───────────── Metriche ─────────────
const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
const r = (x, d = 4) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
const EPS = 1e-6, clip = (p) => Math.min(1 - EPS, Math.max(EPS, p));
/** rows: { p (probabilità del lato), y (1 vince), odds, mkt }. ROI a puntata fissa 1 sulle quote del lato. */
export function summarizeSides(rows) {
  const n = rows.length; if (!n) return { n: 0 };
  const prof = rows.map((x) => (x.y ? x.odds - 1 : -1)), mProf = sum(prof, (z) => z) / n, roiSe = n > 1 ? r(Math.sqrt(sum(prof, (z) => (z - mProf) ** 2) / (n - 1) / n)) : null;
  const wins = sum(rows, (x) => x.y), withOdds = rows.filter((x) => x.odds > 1), cal = [];
  for (let i = 0; i < 10; i++) { const b = rows.filter((x) => x.p >= i / 10 && x.p < (i + 1) / 10 + (i === 9 ? 1e-9 : 0)); if (b.length) cal.push({ from: i / 10, n: b.length, meanP: r(sum(b, (x) => x.p) / b.length), hit: r(sum(b, (x) => x.y) / b.length) }); }
  const ece = cal.reduce((s, b) => s + (b.n / n) * Math.abs(b.meanP - b.hit), 0);
  return {
    n, wins, hitRate: r(wins / n), avgP: r(sum(rows, (x) => x.p) / n), avgMarket: r(sum(rows, (x) => x.mkt) / n), avgOdds: withOdds.length ? r(sum(withOdds, (x) => x.odds) / withOdds.length, 2) : null,
    avgEv: r(sum(rows, (x) => x.p * x.odds - 1) / n), roi: r(sum(rows, (x) => (x.y ? x.odds - 1 : -1)) / n), roiSe, brierModel: r(sum(rows, (x) => (x.p - x.y) ** 2) / n), brierMarket: r(sum(rows, (x) => (x.mkt - x.y) ** 2) / n),
    logLossModel: r(sum(rows, (x) => -(x.y ? Math.log(clip(x.p)) : Math.log(clip(1 - x.p)))) / n), ece: r(ece), calibration: cal,
    calibrationGapPt: r((sum(rows, (x) => x.y) / n - sum(rows, (x) => x.p) / n) * 100, 2),
  };
}
export const groupBy = (rows, keyFn) => { const m = new Map(); for (const x of rows) { const k = keyFn(x); if (k == null) continue; (m.get(k) ?? m.set(k, []).get(k)).push(x); } return Object.fromEntries([...m].map(([k, v]) => [k, summarizeSides(v)])); };

// ───────────── Rigioco cronologico senza look-ahead ─────────────
/** history: righe tennis_matches concluse con winner 1|2. Restituisce un record per OGNI lato con quota di chiusura valida. */
export function replay(matches, cfg = TENNIS_MODEL, { freezeAfterMs = null } = {}) {
  const sorted = [...matches].sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at) || String(a.match_key).localeCompare(String(b.match_key)));
  const book = new RatingBook(cfg), out = []; let i = 0;
  const id = (m, s) => (s === 1 ? m.p1_id : m.p2_id);
  while (i < sorted.length) {
    const day = Math.floor(Date.parse(sorted[i].starts_at) / 86400e3); let j = i;
    while (j < sorted.length && Math.floor(Date.parse(sorted[j].starts_at) / 86400e3) === day) j++;
    const batch = sorted.slice(i, j);
    for (const m of batch) {
      const t = Date.parse(m.starts_at), a = String(m.p1_id), b = String(m.p2_id);
      const pred = predictMatch(book, { t, surface: m.surface, tour: m.tour, bestOf: m.best_of ?? undefined, p1: { id: a, name: m.p1_name }, p2: { id: b, name: m.p2_name } }, {}, null, cfg);
      const co = m.closing_odds, o1 = Number(co?.[a]), o2 = Number(co?.[b]), nv = noVig(o1, o2);
      if (!pred.published || !nv) continue;
      for (const s of [1, 2]) {
        const p = s === 1 ? pred.p1 : pred.p2, odds = s === 1 ? o1 : o2, mkt = s === 1 ? nv.p1 : nv.p2;
        out.push({ key: m.match_key, t, tour: m.tour, category: m.category ?? "unknown", tournament: m.tournament, label: competitionLabel(m.tour, m.category, m.tournament), slot: s, p, odds, mkt, gap: p - mkt, y: m.winner === s ? 1 : 0, isUnderdog: p < 0.5, marketUnderdog: mkt < 0.5, reliability: pred.reliability, modelPick: pred.pick === s });
      }
    }
    for (const m of batch) if (freezeAfterMs == null || Date.parse(m.starts_at) <= freezeAfterMs) book.update({ t: Date.parse(m.starts_at), winnerId: m.winner === 1 ? String(m.p1_id) : String(m.p2_id), loserId: m.winner === 1 ? String(m.p2_id) : String(m.p1_id), surface: normalizeSurface(m.surface) });
    i = j;
  }
  return out;
}

/** Regole ATTUALI di _tennis-bet.js applicate a un lato (con le quote di chiusura). */
export function passesCurrentRules(x, cfg = TENNIS_BET, { ignoreReliability = false } = {}) {
  if (!ignoreReliability && x.reliability === "bassa") return false;
  if (!ignoreReliability && cfg.strictCategories.includes(x.category) && x.reliability !== "alta") return false;
  return x.odds >= cfg.minOdds && x.p * x.odds - 1 >= cfg.minEv && Math.abs(x.gap) <= cfg.maxModelGap;
}
/** Un solo lato per partita: quello con EV maggiore (come la graduatoria dello Strategy Center). */
export function pickBestPerMatch(sides) { const m = new Map(); for (const s of sides) { const c = m.get(s.key); if (!c || s.p * s.odds > c.p * c.odds) m.set(s.key, s); } return [...m.values()]; }

export function analyze(sides) {
  const eligible = pickBestPerMatch(sides.filter((x) => passesCurrentRules(x)));
  const itf = eligible.filter((x) => x.category === "itf");
  return {
    allSides: summarizeSides(sides),
    allByBand: groupBy(sides, (x) => bandOf(x.odds)),
    allByCategory: groupBy(sides.filter((x) => x.p >= 0.5), (x) => x.label),
    allByGapBand: groupBy(sides.filter((x) => passesCurrentRules({ ...x, gap: 0 })), (x) => gapOf(x.gap)),
    currentRules: { selections: summarizeSides(eligible), byBand: groupBy(eligible, (x) => bandOf(x.odds)), byUnderdog: groupBy(eligible, (x) => (x.isUnderdog ? "sfavorito (modello)" : "favorito (modello)")), byCategory: groupBy(eligible, (x) => x.label), byGapBand: groupBy(eligible, (x) => gapOf(x.gap)) },
    itf8: { kept: summarizeSides(itf.filter((x) => x.gap * 100 <= 8)), excluded: summarizeSides(itf.filter((x) => x.gap * 100 > 8)), threshold: 8 },
  };
}


/** Selezioni con le regole attuali SENZA il requisito di affidabilità (nel rigioco non è riproducibile: l'«alta» degli ITF dipende da dati che lo storico non ha). Serve a vedere ITF/Challenger e il filtro degli 8 punti. */
export function analyzeRelaxed(sides) {
  const el = pickBestPerMatch(sides.filter((x) => passesCurrentRules(x, TENNIS_BET, { ignoreReliability: true }))), itf = el.filter((x) => x.category === "itf");
  return { selections: summarizeSides(el), byCategory: groupBy(el, (x) => x.label), byUnderdog: groupBy(el, (x) => (x.isUnderdog ? "sfavorito (modello)" : "favorito (modello)")), itf8: { kept: summarizeSides(itf.filter((x) => x.gap * 100 <= 8)), excluded: summarizeSides(itf.filter((x) => x.gap * 100 > 8)) } };
}

// ───────────── Il modello aggiunge qualcosa al mercato? Regressione logistica walk-forward ─────────────
const lg = (p) => { const q = clip(p); return Math.log(q / (1 - q)); }, sig = (z) => 1 / (1 + Math.exp(-z));
const ll = (p, y) => -(y ? Math.log(clip(p)) : Math.log(clip(1 - p))), br = (p, y) => (p - y) ** 2;
function solveLinear(A, b) {
  const n = b.length, M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c; for (let i = c + 1; i < n; i++) if (Math.abs(M[i][c]) > Math.abs(M[piv][c])) piv = i;
    if (Math.abs(M[piv][c]) < 1e-12) return null; [M[c], M[piv]] = [M[piv], M[c]];
    for (let i = 0; i < n; i++) if (i !== c) { const f = M[i][c] / M[c][c]; for (let j = c; j <= n; j++) M[i][j] -= f * M[c][j]; }
  }
  return M.map((row, i) => row[n] / row[i]);
}
/** Generatore pseudo-casuale riproducibile (stessi dati → stessi intervalli). */
export const rng = (seed) => { let s = seed >>> 0; return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296; };
/** Cluster di correlazione: partite dello stesso torneo nella stessa settimana (stessi giocatori, stesse condizioni). */
export const clusterOf = (x) => `${x.tournament ?? ""}|${Math.floor(x.t / (7 * 864e5))}`;

/**
 * Logit(P(vince il giocatore 1)) = a + b·logit(mercato) [+ c·(logit(modello) − logit(mercato))]. k=3: modello completo; k=2: solo mercato (c = 0).
 * c ≈ 0: il modello non aggiunge nulla al mercato. Errori standard: `seC` assume osservazioni INDIPENDENTI (qui non lo sono: diagnostico, ottimistico);
 * `seCRobust` è lo stimatore «sandwich» con cluster torneo-settimana (con correzione G/(G−1)): è quello da usare per giudicare.
 */
export function fitLogit(rows, { k = 3, iters = 40, ridge = 1e-6 } = {}) {
  if (rows.length < 30) return null;
  const F = rows.map((x) => (k === 3 ? [1, x.x1, x.x2] : [1, x.x1]));
  let beta = k === 3 ? [0, 1, 0] : [0, 1], H = null;
  for (let it = 0; it < iters; it++) {
    const g = new Array(k).fill(0); H = Array.from({ length: k }, () => new Array(k).fill(0));
    for (let n = 0; n < rows.length; n++) { const f = F[n]; let z = 0; for (let i = 0; i < k; i++) z += f[i] * beta[i]; const pr = sig(z), w = pr * (1 - pr), e = rows[n].y - pr; for (let i = 0; i < k; i++) { g[i] += e * f[i]; for (let j = 0; j < k; j++) H[i][j] += w * f[i] * f[j]; } }
    for (let i = 0; i < k; i++) H[i][i] += ridge;
    const step = solveLinear(H, g); if (!step) return null; beta = beta.map((v, i) => v + step[i]);
    if (Math.max(...step.map(Math.abs)) < 1e-9) break;
  }
  const cols = Array.from({ length: k }, (_, i) => { const e = new Array(k).fill(0); e[i] = 1; return solveLinear(H, e); });
  if (cols.some((c) => !c)) return null;
  const Hi = Array.from({ length: k }, (_, rr) => Array.from({ length: k }, (_, cc) => cols[cc][rr])), S = Array.from({ length: k }, () => new Array(k).fill(0)), byG = new Map();
  for (let n = 0; n < rows.length; n++) { const f = F[n]; let z = 0; for (let i = 0; i < k; i++) z += f[i] * beta[i]; const e = rows[n].y - sig(z), key = rows[n].g ?? `#${n}`, sv = byG.get(key) ?? new Array(k).fill(0); for (let i = 0; i < k; i++) sv[i] += e * f[i]; byG.set(key, sv); }
  for (const sv of byG.values()) for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) S[i][j] += sv[i] * sv[j];
  const G = byG.size, corr = G > 1 ? G / (G - 1) : 1, mul = (A, B) => A.map((row) => B[0].map((_, j) => row.reduce((t, v, i) => t + v * B[i][j], 0))), V = mul(mul(Hi, S), Hi), ci = k === 3 ? 2 : 1;
  return { a: r(beta[0], 3), b: r(beta[1], 3), c: k === 3 ? r(beta[2], 3) : 0, seC: r(Math.sqrt(Math.max(0, Hi[ci][ci])), 3), seCRobust: r(Math.sqrt(Math.max(0, V[ci][ci] * corr)), 3), n: rows.length, clusters: G, beta, k };
}

/**
 * Bootstrap per BLOCCHI (cluster torneo-settimana) di un rapporto Σnum/Σden. contrib(item) → [num, den].
 * Restituisce stima, intervallo al 95% (percentili), numero di cluster e pLe0 = probabilità (con correzione +1) che la stima sia ≤ 0.
 */
export function clusterBootstrap(items, clusterFn, contrib, { B = 1000, seed = 12345 } = {}) {
  const m = new Map(); for (const it of items) { const g = clusterFn(it), c = contrib(it), e = m.get(g) ?? [0, 0]; e[0] += c[0]; e[1] += c[1]; m.set(g, e); }
  const cl = [...m.values()], n = cl.length, tot = cl.reduce((t, e) => [t[0] + e[0], t[1] + e[1]], [0, 0]), est = tot[1] ? tot[0] / tot[1] : null;
  if (n < 10 || !tot[1]) return { est, lo: null, hi: null, clusters: n, pLe0: null };
  const rnd = rng(seed), d = [];
  for (let b = 0; b < B; b++) { let x = 0, y = 0; for (let j = 0; j < n; j++) { const e = cl[Math.floor(rnd() * n)]; x += e[0]; y += e[1]; } if (y > 0) d.push(x / y); }
  d.sort((u, v) => u - v);
  return { est, lo: d[Math.floor(0.025 * d.length)], hi: d[Math.ceil(0.975 * d.length) - 1], clusters: n, pLe0: (d.filter((v) => v <= 0).length + 1) / (d.length + 1) };
}
const ciOf = (b) => ({ est: r(b.est), lo: r(b.lo), hi: r(b.hi), clusters: b.clusters, pLe0: r(b.pLe0, 4) });
const boot = (items, f, den = () => 1) => ciOf(clusterBootstrap(items, (x) => x.g ?? clusterOf(x), (x) => [f(x), den(x)]));

const monthOf = (t) => new Date(t).toISOString().slice(0, 7);
/** Un record per partita (giocatore 1 = slot 1), in ordine cronologico deterministico. */
export function matchRows(sides) {
  const byKey = new Map(); for (const s of sides) (byKey.get(s.key) ?? byKey.set(s.key, {}).get(s.key))[s.slot] = s;
  return [...byKey.values()].filter((m) => m[1] && m[2]).map((m) => ({ key: m[1].key, t: m[1].t, label: m[1].label, cat: m[1].category, g: clusterOf(m[1]), x1: lg(m[1].mkt), x2: lg(m[1].p) - lg(m[1].mkt), y: m[1].y, p: m[1].p, mkt: m[1].mkt, o: [m[1].odds, m[2].odds], rel: m[1].reliability })).sort((a, b) => a.t - b.t || String(a.key).localeCompare(String(b.key)));
}

/**
 * Previsioni OUT-OF-SAMPLE: ogni mese è previsto con modelli adattati ESCLUSIVAMENTE ai mesi precedenti (mercato+modello q1; solo mercato q0;
 * e, per ogni categoria con almeno minCategoryN partite di addestramento, gli stessi due modelli per categoria qL1/qL0). Nessun dato del mese
 * valutato, né successivo, entra nell'addestramento, nella scelta delle categorie o nelle soglie.
 */
export function oosPredictions(rows, { minTrainMonths = 3, minCategoryN = 300 } = {}) {
  const months = [...new Set(rows.map((x) => monthOf(x.t)))].sort(), test = [], path = [];
  for (let k = minTrainMonths; k < months.length; k++) {
    const train = rows.filter((x) => monthOf(x.t) < months[k]), f1 = fitLogit(train, { k: 3 }), f0 = fitLogit(train, { k: 2 }); if (!f1 || !f0) continue;
    path.push({ month: months[k], c: f1.c, seCRobust: f1.seCRobust, b: f1.b, trainMatches: train.length });
    const lab = {}; for (const l of new Set(train.map((x) => x.label))) { const v = train.filter((x) => x.label === l); if (v.length >= minCategoryN) { const m3 = fitLogit(v, { k: 3 }), m2 = fitLogit(v, { k: 2 }); if (m3 && m2) lab[l] = [m2, m3]; } }
    for (const x of rows.filter((z) => monthOf(z.t) === months[k])) {
      const at = (f, three) => sig(f.beta[0] + f.beta[1] * x.x1 + (three ? f.beta[2] * x.x2 : 0)), L = lab[x.label];
      test.push({ ...x, month: months[k], q0: at(f0, false), q1: at(f1, true), qL0: L ? at(L[0], false) : null, qL1: L ? at(L[1], true) : null });
    }
  }
  return { months, test, path };
}

/** Regole OPERATIVE (_tennis-bet.js, _tennis-strategy.js) applicate a un lato. pModel = probabilità grezza del modello (per lo scarto dal mercato), q = probabilità usata per l'EV. */
export function operationalFilter({ pModel, q, mkt, odds, reliability, category }, mode, cfg = TENNIS_BET) {
  const why = [];
  if (!(Number.isFinite(odds) && odds > 1)) return { ok: false, why: ["quota non valida"] };
  if (mode !== "B") {
    if (reliability === "bassa") why.push("affidabilità bassa");
    if (mode === "A" && cfg.strictCategories.includes(category) && reliability !== "alta") why.push("categoria ITF/Challenger senza affidabilità alta");
  }
  if (odds < cfg.minOdds) why.push("quota sotto il minimo");
  if (q * odds - 1 < cfg.minEv) why.push("EV sotto la soglia");
  if (mode !== "B" && mkt != null && Math.abs(pModel - mkt) > cfg.maxModelGap) why.push("scarto dal mercato oltre il massimo");
  return { ok: why.length === 0, why };
}
/**
 * Simulazione sulle previsioni OOS con la probabilità rimodulata q1. Modalità:
 *  A  = TUTTE le regole operative riproducibili (affidabilità, categorie ITF/Challenger con «alta», quota minima, EV minimo sulla q rimodulata, scarto massimo dal mercato sul modello grezzo);
 *  A* = come A ma SENZA il requisito «alta» nelle categorie rigide (nel rigioco non è riproducibile: serve a vedere ITF/Challenger);
 *  B  = esplorativa: solo quota minima ed EV minimo (le uniche soglie della versione precedente).
 * Non riproducibili in nessuna modalità: età delle quote, quota migliore tra più bookmaker, correzione di calibrazione operativa, limite di 5 giocate per elenco, classi elevato/interessante.
 */
export function simulateOOS(test, mode, cfg = TENNIS_BET) {
  const picks = [], rejected = {};
  for (const x of test) {
    const cands = [1, 2].map((s) => ({ s, side: { pModel: s === 1 ? x.p : 1 - x.p, q: s === 1 ? x.q1 : 1 - x.q1, mkt: s === 1 ? x.mkt : 1 - x.mkt, odds: x.o[s - 1], reliability: x.rel, category: x.cat } }));
    const ok = [];
    for (const c of cands) { const f = operationalFilter(c.side, mode, cfg); if (f.ok) ok.push(c); else if (mode === "A" && operationalFilter(c.side, "B", cfg).ok) rejected[f.why[0]] = (rejected[f.why[0]] ?? 0) + 1; }
    ok.sort((u, v) => v.side.q * v.side.odds - u.side.q * u.side.odds); const b = ok[0]; if (!b) continue;
    picks.push({ key: x.key, g: x.g, t: x.t, label: x.label, p: b.side.q, mkt: b.side.mkt, odds: b.side.odds, y: b.s === 1 ? x.y : 1 - x.y, isUnderdog: b.side.q < 0.5 });
  }
  const count = (f) => Object.fromEntries(Object.entries(picks.reduce((o, v) => ((o[f(v)] = (o[f(v)] ?? 0) + 1), o), {})).sort((u, v) => v[1] - u[1]));
  return {
    mode, matchesEvaluated: test.length, selections: summarizeSides(picks), roiCI: picks.length ? boot(picks, (v) => (v.y ? v.odds - 1 : -1)) : null,
    llVsMarket: picks.length ? boot(picks, (v) => ll(v.mkt, v.y) - ll(v.p, v.y)) : null, // >0: la probabilità rimodulata batte il mercato SULLE STESSE selezioni
    brierVsMarket: picks.length ? boot(picks, (v) => br(v.mkt, v.y) - br(v.p, v.y)) : null,
    byCategory: count((v) => v.label), byOddsBand: count((v) => bandOf(v.odds)), underdogs: picks.filter((v) => v.isUnderdog).length, rejectedByA: mode === "A" ? rejected : undefined, keys: new Set(picks.map((v) => v.key)),
  };
}

/** Holm-Bonferroni sui p unilaterali delle categorie: restituisce i p corretti nello stesso ordine. */
export function holm(ps) {
  const idx = ps.map((p, i) => [p, i]).sort((u, v) => u[0] - v[0]), m = ps.length, out = new Array(m); let run = 0;
  idx.forEach(([p, i], j) => { run = Math.max(run, Math.min(1, (m - j) * p)); out[i] = run; });
  return out;
}

function bootstrapC(rows, B = 200, seed = 99) {
  const m = new Map(); for (const x of rows) (m.get(x.g) ?? m.set(x.g, []).get(x.g)).push(x);
  const cl = [...m.values()], rnd = rng(seed), cs = [];
  for (let b = 0; b < B; b++) { const smp = []; for (let j = 0; j < cl.length; j++) for (const x of cl[Math.floor(rnd() * cl.length)]) smp.push(x); const f = fitLogit(smp, { k: 3, iters: 15 }); if (f) cs.push(f.c); }
  cs.sort((u, v) => u - v); return cs.length >= 20 ? { lo: r(cs[Math.floor(0.025 * cs.length)], 3), hi: r(cs[Math.ceil(0.975 * cs.length) - 1], 3), B: cs.length } : null;
}

/** Il modello aggiunge informazione al mercato? Tre blocchi SEPARATI: diagnostica in-sample, valutazione out-of-sample walk-forward, simulazioni. */
export function walkForwardVsMarket(sides, { bootstrapCoef = true, ...opts } = {}) {
  const rows = matchRows(sides), { test, months, path } = oosPredictions(rows, opts), n = test.length;
  const mean = (f) => (n ? r(sum(test, f) / n) : null);
  const info = (x) => ll(x.q0, x.y) - ll(x.q1, x.y), infoB = (x) => br(x.q0, x.y) - br(x.q1, x.y);
  const labels = [...new Set(test.filter((x) => x.qL1 != null).map((x) => x.label))], byLabel = labels.map((l) => { const v = test.filter((x) => x.label === l && x.qL1 != null); return { label: l, n: v.length, infoLL: boot(v, (x) => ll(x.qL0, x.y) - ll(x.qL1, x.y)), meanC: null }; });
  const hp = holm(byLabel.map((x) => x.infoLL.pLe0 ?? 1)); byLabel.forEach((x, i) => { x.holmP = r(hp[i], 4); x.robust = x.infoLL.lo != null && x.infoLL.lo > 0 && hp[i] < 0.05; });
  const full = fitLogit(rows, { k: 3 }), lblFits = Object.fromEntries([...new Set(rows.map((x) => x.label))].map((l) => [l, rows.filter((x) => x.label === l)]).filter(([, v]) => v.length >= 300).map(([l, v]) => { const f = fitLogit(v, { k: 3 }); return [l, f && { n: f.n, b: f.b, c: f.c, seIndependent: f.seC, seRobust: f.seCRobust, clusters: f.clusters }]; }));
  const infoCI = n ? boot(test, info) : null;
  return {
    matches: rows.length, testedMatches: n, firstTestMonth: months[opts.minTrainMonths ?? 3] ?? null,
    inSample: { nota: "DIAGNOSTICO sull'intero campione (usa anche dati successivi a ogni partita): NON è una valutazione out-of-sample. seIndependent assume osservazioni indipendenti ed è ottimistico; seRobust è per cluster torneo-settimana.", full: full && { a: full.a, b: full.b, c: full.c, seIndependent: full.seC, seRobust: full.seCRobust, clusters: full.clusters, bootstrapCI95: bootstrapCoef ? bootstrapC(rows) : null }, byLabel: lblFits },
    oos: {
      nota: "Ogni mese previsto con modelli adattati SOLO ai mesi precedenti. Intervalli: bootstrap per blocchi torneo-settimana, 1.000 ripetizioni.",
      coefficientPath: path, meanMonthlyC: path.length ? r(sum(path, (x) => x.c) / path.length, 3) : null,
      logLoss: { modelRaw: mean((x) => ll(x.p, x.y)), market: mean((x) => ll(x.mkt, x.y)), marketRecalibrated: mean((x) => ll(x.q0, x.y)), modelOnMarket: mean((x) => ll(x.q1, x.y)) },
      brier: { modelRaw: mean((x) => br(x.p, x.y)), market: mean((x) => br(x.mkt, x.y)), marketRecalibrated: mean((x) => br(x.q0, x.y)), modelOnMarket: mean((x) => br(x.q1, x.y)) },
      infoLogLoss: infoCI, infoBrier: n ? boot(test, infoB) : null, // >0: aggiungere il modello al mercato RIDUCE l'errore fuori campione; intervallo che comprende 0 = nessuna prova
      recalibrationVsMarketLL: n ? boot(test, (x) => ll(x.mkt, x.y) - ll(x.q0, x.y)) : null, rawModelVsMarketLL: n ? boot(test, (x) => ll(x.mkt, x.y) - ll(x.p, x.y)) : null,
      byCategory: byLabel, categoriesTested: byLabel.length, informativeOverall: !!(infoCI && infoCI.lo > 0),
    },
    simulations: { A: simulateOOS(test, "A"), Astar: simulateOOS(test, "A*"), B: simulateOOS(test, "B") },
    limits: "Quote di chiusura (bookmaker non identificato), non quelle al momento della previsione: il ROI è una simulazione retrospettiva, non un rendimento realizzabile. Rigioco Elo+forma senza statistiche di servizio, H2H, ranking.",
  };
}

/**
 * Strategy Center 2.0 sperimentale, walk-forward: per ogni mese, rimodulazione e prova per categoria adattate SOLO ai mesi precedenti;
 * poi classe A/B/C/D (functions/api/_tennis-strategy2.js) per ciascun lato; si gioca al massimo un lato per partita (quello con vantaggio maggiore tra A/B/C).
 * Confronto con le regole attuali sulla STESSA finestra temporale.
 */
export function strategy2WalkForward(sides, cfg = STRATEGY2) {
  const rows = matchRows(sides);
  const months = [...new Set(rows.map((x) => monthOf(x.t)))].sort(), picks = { A: [], B: [], C: [] }, dReasons = {}; let dSides = 0, tested = 0;
  for (let k = cfg.minTrainMonths; k < months.length; k++) {
    const train = rows.filter((x) => monthOf(x.t) < months[k]), fit = fitLogit(train); if (!fit) continue;
    const ev = {}; for (const l of new Set(train.map((x) => x.label))) { const v = train.filter((x) => x.label === l); if (v.length >= cfg.minCategoryN) { const f = fitLogit(v); if (f) ev[l] = { c: f.c, se: Math.max(f.seC, f.seCRobust), clusters: f.clusters }; } }
    for (const x of rows.filter((z) => monthOf(z.t) === months[k])) {
      tested++; const q = adjustProbability(fit, x.p, x.mkt), best = [];
      for (const s of [1, 2]) {
        const pm = s === 1 ? x.p : 1 - x.p, mk = s === 1 ? x.mkt : 1 - x.mkt, pa = s === 1 ? q : 1 - q, o = x.o[s - 1];
        const c = classifySide({ pAdj: pa, pModel: pm, mkt: mk, odds: o, reliability: x.rel, evidence: ev[x.label] }, cfg);
        if (c.tier === "D") { dSides++; dReasons[c.reasons[0]] = (dReasons[c.reasons[0]] ?? 0) + 1; continue; }
        best.push({ tier: c.tier, edge: c.edge, p: pa, odds: o, mkt: mk, y: s === 1 ? x.y : 1 - x.y, label: x.label, isUnderdog: pa < 0.5, key: x.key, g: x.g, t: x.t });
      }
      best.sort((a, b) => b.edge - a.edge); if (best[0]) picks[best[0].tier].push(best[0]);
    }
  }
  const t0 = months[cfg.minTrainMonths] ? Date.parse(`${months[cfg.minTrainMonths]}-01T00:00:00Z`) : Infinity;
  const current = pickBestPerMatch(sides.filter((x) => x.t >= t0 && passesCurrentRules(x, TENNIS_BET, { ignoreReliability: true })));
  const all = [...picks.A, ...picks.B, ...picks.C];
  const result = { firstTestMonth: months[cfg.minTrainMonths] ?? null, testedMatches: tested, tiers: { A: summarizeSides(picks.A), B: summarizeSides(picks.B), C: summarizeSides(picks.C), "A+B": summarizeSides([...picks.A, ...picks.B]), "A+B+C": summarizeSides(all) }, underdogShare: { "A+B+C": all.length ? r(all.filter((x) => x.isUnderdog).length / all.length) : null, regoleAttuali: current.length ? r(current.filter((x) => x.isUnderdog).length / current.length) : null }, discardedSides: dSides, discardReasons: dReasons, currentRulesSameWindow: summarizeSides(current), byCategoryAB: groupBy([...picks.A, ...picks.B], (x) => x.label) };
  Object.defineProperty(result, "_picks", { value: picks, enumerable: false }); // selezioni con blocco e data, solo per l'audit v5 (non entra nel JSON)
  return result;
}

/** Deriva dei rating: giocatori attivi DOPO il taglio, rating Elo e forma con lo storico congelato al taglio (come il motore oggi) contro lo storico completo. Solo lettura del RatingBook. */
export function ratingDrift(matches, cutoffMs, cfg = TENNIS_MODEL) {
  if (!Number.isFinite(cutoffMs)) return null;
  const sorted = [...matches].sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at) || String(a.match_key).localeCompare(String(b.match_key))), frozen = new RatingBook(cfg), fresh = new RatingBook(cfg), active = new Set();
  for (const m of sorted) {
    const t = Date.parse(m.starts_at), u = { t, winnerId: m.winner === 1 ? String(m.p1_id) : String(m.p2_id), loserId: m.winner === 1 ? String(m.p2_id) : String(m.p1_id), surface: normalizeSurface(m.surface) };
    fresh.update(u); if (t <= cutoffMs) frozen.update(u); else { active.add(String(m.p1_id)); active.add(String(m.p2_id)); }
  }
  const d = [], f = []; let unknown = 0;
  for (const id of active) { if (!frozen.has(id)) { unknown++; } d.push(Math.abs(fresh.view(id).eloAll - frozen.view(id).eloAll)); const a = fresh.form(id), b = frozen.form(id); if (a && b) f.push(Math.abs(a.score - b.score)); }
  d.sort((u, v) => u - v); const mean = (a) => (a.length ? sum(a, (z) => z) / a.length : null);
  return { playersActiveAfterCutoff: active.size, unknownToFrozenBook: unknown, meanAbsEloDiff: r(mean(d), 1), p90AbsEloDiff: r(d[Math.floor(0.9 * (d.length - 1))], 1), shareAbsEloDiffOver50: d.length ? r(d.filter((z) => z > 50).length / d.length) : null, meanAbsFormDiff: r(mean(f), 3), formCompared: f.length };
}

/**
 * ESPERIMENTO A (isolato, solo audit): oggi il motore legge le prime 80.000 partite concluse e ignora le più recenti (tetto di 80 pagine).
 * Qui si confrontano, sulle SOLE partite successive al punto di taglio, i rating congelati al taglio (come il motore attuale) con rating aggiornati ogni giorno.
 * Nessuna modifica al motore: serve a misurare quanto pesa la mancanza delle partite recenti sullo scarto dal mercato, su Brier ed ECE e sulle selezioni.
 */
export function staleExperiment(matches, cutoffMs) {
  if (!Number.isFinite(cutoffMs)) return { available: false, reason: "Meno partite del tetto: nessun taglio da confrontare." };
  const after = (x) => x.t > cutoffMs, meanAbsGapPt = (a) => (a.length ? r((sum(a, (x) => Math.abs(x.gap)) / a.length) * 100, 2) : null);
  const idOf = (x) => `${x.key}|${x.slot}`;
  const fz = replay(matches, TENNIS_MODEL, { freezeAfterMs: cutoffMs }).filter(after), fr = replay(matches).filter(after);
  // Stesse partite e stessi lati nei due rigiochi (il modello può astenersi in una versione e non nell'altra): il confronto è sull'intersezione.
  const frIds = new Set(fr.map(idOf)), common = new Set(fz.map(idOf).filter((k) => frIds.has(k)));
  const A = fz.filter((x) => common.has(idOf(x))), B = fr.filter((x) => common.has(idOf(x)));
  const byId = new Map(B.map((x) => [idOf(x), x]));
  const pDiffMeanPt = A.length ? r((sum(A, (x) => Math.abs(x.p - byId.get(idOf(x)).p)) / A.length) * 100, 2) : null;
  const one = (sides) => { const el = pickBestPerMatch(sides.filter((x) => passesCurrentRules(x))), sel = summarizeSides(el); return { sides: summarizeSides(sides), meanAbsGapPt: meanAbsGapPt(sides), selections: sel, selectionsUnderdogShare: el.length ? r(el.filter((x) => x.isUnderdog).length / el.length) : null, selectionsAvgOdds: sel.avgOdds ?? null }; };
  return { available: true, ratingDrift: ratingDrift(matches, cutoffMs), cutoff: new Date(cutoffMs).toISOString(), comparedSides: A.length, onlyFrozen: fz.length - A.length, onlyFresh: fr.length - A.length, pDiffMeanPt, frozen: one(A), fresh: one(B) };
}

const s2Md = (w) => `\n### Strategy Center 2.0 sperimentale — walk-forward da ${w.firstTestMonth} su ${w.testedMatches} partite (classi A/B/C/D, soglie fissate a priori)\n| classe | selezioni | vinte | quota media | P rimodulata | ROI | ± 2 err. std. |\n|---|---|---|---|---|---|---|\n${Object.entries(w.tiers).map(([k, v]) => `| ${k} | ${v.n} | ${v.wins ?? 0} | ${v.avgOdds ?? ""} | ${v.avgP ?? ""} | ${v.roi ?? ""} | ${v.roiSe != null ? r(2 * v.roiSe) : ""} |`).join("\n")}\n| regole ATTUALI, stessa finestra | ${w.currentRulesSameWindow.n} | ${w.currentRulesSameWindow.wins ?? 0} | ${w.currentRulesSameWindow.avgOdds ?? ""} | ${w.currentRulesSameWindow.avgP ?? ""} | ${w.currentRulesSameWindow.roi ?? ""} | ${w.currentRulesSameWindow.roiSe != null ? r(2 * w.currentRulesSameWindow.roiSe) : ""} |\nQuota di sfavoriti (P<50%): nuova A+B+C ${w.underdogShare["A+B+C"]}, regole attuali ${w.underdogShare.regoleAttuali}. Lati scartati (D): ${w.discardedSides}; motivi principali: ${Object.entries(w.discardReasons).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join("; ")}. Classi A+B per categoria: ${Object.entries(w.byCategoryAB).map(([k, v]) => `${k} ${v.n}`).join("; ") || "nessuna"}.\n`;

const f3 = (x) => (x == null ? "n.d." : x), ci = (c) => (c ? `${f3(c.est)} [${f3(c.lo)} ; ${f3(c.hi)}] su ${c.clusters} blocchi` : "n.d.");
const marketMd = (m) => {
  const o = m.oos, i = m.inSample, sim = m.simulations;
  const cat = o.byCategory.map((x) => `${x.label} Δ=${f3(x.infoLL.est)} [${f3(x.infoLL.lo)} ; ${f3(x.infoLL.hi)}] n=${x.n}, p Holm ${x.holmP}${x.robust ? " ← PROVA ROBUSTA" : ""}`).join("\n- ");
  const row = (k, v) => `| ${k} | ${v.matchesEvaluated} | ${v.selections.n} | ${v.selections.wins ?? 0} | ${f3(v.selections.avgOdds)} | ${f3(v.selections.roi)} [${f3(v.roiCI?.lo)} ; ${f3(v.roiCI?.hi)}] | ${f3(v.llVsMarket?.est)} [${f3(v.llVsMarket?.lo)} ; ${f3(v.llVsMarket?.hi)}] | ${v.underdogs} |`;
  return `\n### Il modello aggiunge informazione al mercato? VALUTAZIONE OUT-OF-SAMPLE (walk-forward da ${m.firstTestMonth}, ${m.testedMatches} partite)\n${o.nota}\n- Log loss: modello grezzo ${o.logLoss.modelRaw} · mercato ${o.logLoss.market} · mercato ricalibrato ${o.logLoss.marketRecalibrated} · mercato + modello ${o.logLoss.modelOnMarket}. Brier: ${o.brier.modelRaw} · ${o.brier.market} · ${o.brier.marketRecalibrated} · ${o.brier.modelOnMarket}.\n- **Informazione aggiunta dal modello** (riduzione di log loss, >0 = utile): ${ci(o.infoLogLoss)} → ${o.informativeOverall ? "intervallo sopra zero" : "NESSUNA PROVA (l'intervallo comprende lo zero o è negativo)"}. Brier: ${ci(o.infoBrier)}.\n- Ricalibrare il solo mercato rispetto al mercato grezzo: ${ci(o.recalibrationVsMarketLL)}. Modello grezzo rispetto al mercato: ${ci(o.rawModelVsMarketLL)}.\n- c mensile medio ${o.meanMonthlyC} (percorso: ${o.coefficientPath.map((x) => `${x.month} ${x.c}±${x.seCRobust}`).join("; ")}).\n- Per categoria (confronti multipli: Holm su ${o.categoriesTested} categorie):\n- ${cat}\n\n### DIAGNOSTICO in-sample (NON è una valutazione out-of-sample)\n${i.nota}\nTutto il campione: c = ${i.full?.c}, errore standard indipendente ${i.full?.seIndependent}, robusto per cluster ${i.full?.seRobust} (${i.full?.clusters} blocchi), IC95 bootstrap ${i.full?.bootstrapCI95 ? `[${i.full.bootstrapCI95.lo} ; ${i.full.bootstrapCI95.hi}]` : "n.d."}; b = ${i.full?.b}. Per categoria: ${Object.entries(i.byLabel).map(([k, v]) => `${k} c=${v?.c} (se ind. ${v?.seIndependent}, robusto ${v?.seRobust})`).join("; ")}.\n\n### Simulazioni retrospettive sulle STESSE partite e finestra (quote di chiusura: NON rendimento realizzabile)\n| simulazione | partite valutate | selezioni | vinte | quota media | ROI [IC95] | Δ log loss vs mercato [IC95] | sfavoriti |\n|---|---|---|---|---|---|---|---|\n${row("A: tutte le regole operative riproducibili", sim.A)}\n${row("A*: come A senza «alta» per ITF/Challenger", sim.Astar)}\n${row("B: esplorativa, solo quota ed EV minimi", sim.B)}\nIntervalli: bootstrap per blocchi torneo-settimana. Δ log loss vs mercato > 0 = la probabilità rimodulata batte il mercato sulle selezioni. A scarta per: ${Object.entries(sim.A.rejectedByA ?? {}).map(([k, v]) => `${k} ${v}`).join("; ") || "n.d."}. Categorie A*: ${Object.entries(sim.Astar.byCategory).slice(0, 8).map(([k, v]) => `${k} ${v}`).join("; ")}. Fasce di quota A*: ${Object.entries(sim.Astar.byOddsBand).map(([k, v]) => `${k} ${v}`).join("; ")}.\nRegole operative NON riproducibili nel rigioco: età delle quote, quota migliore tra più bookmaker, correzione di calibrazione operativa, limite di 5 giocate, classi elevato/interessante. ${m.limits}\n`;
};

/** Costruisce report (JSON) e riepilogo (Markdown) dalle righe lette: funzione pura, usata da main() e dai test. */
export function buildReport(rows, hist = {}) {
  const ok = rows.filter((m) => m.winner === 1 || m.winner === 2);
  const cats = Object.fromEntries(Object.entries(ok.reduce((o, m) => ((o[competitionLabel(m.tour, m.category, m.tournament)] = (o[competitionLabel(m.tour, m.category, m.tournament)] ?? 0) + 1), o), {})).sort((a, b) => b[1] - a[1]));
  const sides = replay(ok);
  const CAP = 80000, cutoffMs = ok.length > CAP ? Date.parse(ok[CAP - 1].starts_at) : null;
  const rep = { history: { rows: rows.length, pages: hist.pages ?? null, duplicatesDiscarded: hist.duplicates ?? null, truncated: hist.truncated ?? null }, generatedAt: new Date().toISOString(), engine: TENNIS_MODEL.version, matchesLoaded: ok.length, firstMatch: ok[0]?.starts_at ?? null, lastMatch: ok.at(-1)?.starts_at ?? null, matchesWithClosingOdds: new Set(sides.map((s) => s.key)).size, classification: cats, limits: "Quote di CHIUSURA (non quelle al momento della previsione); rigioco Elo+forma senza statistiche di servizio, H2H, ranking.", ...analyze(sides), experimentA: staleExperiment(ok, cutoffMs), relaxed: analyzeRelaxed(sides), market: walkForwardVsMarket(sides), strategy2: strategy2WalkForward(sides) };
  const row = (k, v) => `| ${k} | ${v.n} | ${v.avgP ?? ""} | ${v.hitRate ?? ""} | ${v.calibrationGapPt ?? ""} | ${v.avgEv ?? ""} | ${v.roi ?? ""} | ${v.brierModel ?? ""} | ${v.brierMarket ?? ""} | ${v.ece ?? ""} |`;
  const table = (t, o) => `\n### ${t}\n| gruppo | n | P modello | vittorie | scarto pt | EV medio | ROI | Brier mod. | Brier merc. | ECE |\n|---|---|---|---|---|---|---|---|---|---|\n${Object.entries(o).map(([k, v]) => row(k, v)).join("\n")}\n`;
  const md = `## Audit Strategy Center (sola lettura)\nPartite: ${rep.matchesLoaded} (${rep.firstMatch} → ${rep.lastMatch}); con quote di chiusura: ${rep.matchesWithClosingOdds}.\n> ${rep.limits}\n${table("Tutti i lati per fascia di quota", rep.allByBand)}${table("Selezioni con le regole ATTUALI, per fascia", rep.currentRules.byBand)}${table("Selezioni attuali: favoriti/sfavoriti", rep.currentRules.byUnderdog)}${table("Selezioni attuali per scarto modello−mercato", rep.currentRules.byGapBand)}${table("Selezioni attuali per categoria", rep.currentRules.byCategory)}${table("Favoriti del modello (P ≥ 50%) per categoria: calibrazione per circuito", rep.allByCategory)}${table("Selezioni attuali SENZA requisito di affidabilità, per categoria", rep.relaxed.byCategory)}${table("Idem: favoriti/sfavoriti", rep.relaxed.byUnderdog)}${table("Idem: filtro ITF 8 punti", { "ITF mantenute (≤8)": rep.relaxed.itf8.kept, "ITF escluse (>8)": rep.relaxed.itf8.excluded })}${marketMd(rep.market)}${s2Md(rep.strategy2)}${table("Filtro ITF 8 punti (rigioco)", { "ITF mantenute (≤8)": rep.itf8.kept, "ITF escluse (>8)": rep.itf8.excluded })}${rep.experimentA.available ? table(`Esperimento A — dopo il ${rep.experimentA.cutoff.slice(0, 10)}: rating congelati (come oggi) contro aggiornati`, { "congelati: tutti i lati": rep.experimentA.frozen.sides, "aggiornati: tutti i lati": rep.experimentA.fresh.sides, "congelati: selezioni attuali": rep.experimentA.frozen.selections, "aggiornati: selezioni attuali": rep.experimentA.fresh.selections }) + `\nScarto medio assoluto modello−mercato (punti): congelati ${rep.experimentA.frozen.meanAbsGapPt}, aggiornati ${rep.experimentA.fresh.meanAbsGapPt}. Quota media delle selezioni: ${rep.experimentA.frozen.selectionsAvgOdds} contro ${rep.experimentA.fresh.selectionsAvgOdds}. Deriva dei rating (giocatori attivi dopo il taglio): ${rep.experimentA.ratingDrift ? `${rep.experimentA.ratingDrift.playersActiveAfterCutoff} giocatori, ${rep.experimentA.ratingDrift.unknownToFrozenBook} sconosciuti al motore con storico troncato, scarto Elo medio ${rep.experimentA.ratingDrift.meanAbsEloDiff} punti (90° percentile ${rep.experimentA.ratingDrift.p90AbsEloDiff}; oltre 50 punti: ${rep.experimentA.ratingDrift.shareAbsEloDiffOver50}), scarto medio di forma ${rep.experimentA.ratingDrift.meanAbsFormDiff}` : "n.d."}. Differenza media assoluta di probabilità tra le due versioni: ${rep.experimentA.pDiffMeanPt} punti su ${rep.experimentA.comparedSides} lati (solo in una versione: ${rep.experimentA.onlyFrozen} congelati, ${rep.experimentA.onlyFresh} aggiornati).\n` : `\nEsperimento A: ${rep.experimentA.reason}\n`}\n### Classificazione tornei\n${Object.entries(cats).map(([k, v]) => `- ${k}: ${v}`).join("\n")}\n`;
  return { rep, md };
}

async function main() {
  for (const k of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) if (!process.env[k]) { console.error(`Variabile mancante: ${k}`); process.exit(1); }
  const env = process.env, since = new Date(Date.now() - 400 * 86400e3).toISOString();
  // Paginazione a chiave (starts_at, match_key): nessun tetto implicito (il motore operativo si ferma a 80.000 partite), nessun salto né duplicato se i dati cambiano durante la lettura.
  const hist = await loadFinishedKeyset((params) => supabaseGet(env, "tennis_matches", params), { query: { select: "match_key,p1_id,p2_id,p1_name,p2_name,winner,starts_at,surface,best_of,tour,category,tournament,closing_odds", status: "eq.finished", winner: "not.is.null", starts_at: `gte.${since}` } });
  const rows = hist.rows;
  const { rep, md } = buildReport(rows, hist);
  fs.mkdirSync("audit-out", { recursive: true });
  fs.writeFileSync("audit-out/tennis-strategy-audit.json", JSON.stringify(rep, null, 2));
  console.log(md.slice(0, 6000));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
