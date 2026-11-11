/**
 * Backtest cronologico di Stay Live.
 *   node scripts/backtest.js --file finals.json|csv [--n 8] [--compare] [--tune] [--json out.json]
 *
 * Input: righe di partite finali con  league, kickoff_at, home_id, away_id, home_name, away_name, home_score, away_score, neutral_site
 * e, facoltative, le quote decimali disponibili PRIMA del calcio d'inizio: odds_home, odds_draw, odds_away, odds_over15, odds_under15,
 * odds_over25, odds_under25, odds_over35, odds_under35. Senza quote si misura solo la qualità delle probabilità (non il rendimento).
 * Export dei dati da Supabase (SQL Editor → esporta CSV): `select * from public.backtest_finals;`
 * (vista creata da supabase/migrations/202611070001_backtest_finals_view.sql; esclude supplementari e rigori).
 *
 * Garanzie: 60% storico / 20% validazione / 20% test in ordine di tempo; per ogni giornata il modello vede SOLO partite precedenti;
 * le soglie si scelgono sulla validazione e si giudicano sul test. Con meno di MIN_BETS_FOR_CLAIM giocate nessun miglioramento è "dimostrato".
 */
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { MODEL, SELECTIONS, analyzeMatch, buildContext, buildMultiples, outcomes } from "../functions/api/model.js";
import { MIN_BETS_FOR_CLAIM, applyPlatt, bettingSummary, brier, calibration, classification, fitPlatt, logLoss } from "./metrics.js";

const ODDS_KEYS = SELECTIONS.map((s) => s.key);

export function parseRows(text, name = "") {
  if (name.endsWith(".json") || text.trim().startsWith("[")) return JSON.parse(text);
  const [head, ...lines] = text.trim().split(/\r?\n/);
  const cols = head.split(",").map((c) => c.trim());
  return lines.filter(Boolean).map((l) => Object.fromEntries(l.split(",").map((v, i) => [cols[i], v.trim()])));
}

const num = (v) => (v === "" || v == null ? null : Number(v));
export function normalize(rows) {
  return rows.map((r) => ({
    ...r, home_score: num(r.home_score), away_score: num(r.away_score), neutral_site: r.neutral_site === true || r.neutral_site === "true" || r.neutral_site === "t",
    odds: Object.fromEntries(ODDS_KEYS.map((k) => [k, num(r[`odds_${k}`])]).filter(([, v]) => v > 1)),
  })).filter((r) => Number.isFinite(r.home_score) && Number.isFinite(r.away_score) && Date.parse(r.kickoff_at)).sort((a, b) => Date.parse(a.kickoff_at) - Date.parse(b.kickoff_at));
}

/** Esegue `fn` con parametri del modello temporaneamente sostituiti. */
export function withModel(overrides, fn) {
  const saved = Object.fromEntries(Object.keys(overrides).map((k) => [k, MODEL[k]]));
  Object.assign(MODEL, overrides);
  try { return fn(); } finally { Object.assign(MODEL, saved); }
}

/** Previsioni walk-forward: per ogni partita di validazione/test usa solo partite con calcio d'inizio precedente al GIORNO della partita. */
export function predict(rows, { n = 8, trainFrac = 0.6, valFrac = 0.2 } = {}) {
  const i1 = Math.floor(rows.length * trainFrac), i2 = Math.floor(rows.length * (trainFrac + valFrac));
  const out = [];
  let day = null, ctx = null, hist = 0;
  rows.forEach((r, idx) => {
    if (idx < i1) return;
    const d = r.kickoff_at.slice(0, 10);
    if (d !== day) { day = d; const cut = Date.parse(`${d}T00:00:00Z`); hist = rows.filter((x) => Date.parse(x.kickoff_at) < cut).length; ctx = buildContext(rows.slice(0, hist)); }
    const market = Object.keys(r.odds).length ? { odds: Object.fromEntries(Object.entries(r.odds).map(([k, v]) => [k, { median: v, best: v, book: "storico", n: 1 }])) } : null;
    const a = withModel({ requireRealOdds: false }, () => analyzeMatch(r, ctx, { n, market }));   // nel passato non ci sono quote: si misura la componente statistica
    if (a.sample < MODEL.betSample) return;                       // la partita che l'app non giocherebbe mai
    out.push({ id: `${idx}`, split: idx < i2 ? "val" : "test", league: r.league, day: d, kickoffAt: r.kickoff_at, y: outcomes(r.home_score, r.away_score), a });
  });
  return out;
}

export function evaluate(preds, split) {
  const P = preds.filter((x) => x.split === split);
  const perMarket = {};
  for (const s of SELECTIONS) {
    const ps = P.map((x) => x.a.selections.find((q) => q.key === s.key).p), ys = P.map((x) => x.y[s.key]);
    perMarket[s.key] = { n: ps.length, base: ys.length ? ys.reduce((t, v) => t + v, 0) / ys.length : null, brier: brier(ps, ys), logLoss: logLoss(ps, ys), ece: calibration(ps, ys).ece, ...classification(ps, ys) };
  }
  const triple = P.map((x) => ["home", "draw", "away"].map((k) => x.a.selections.find((q) => q.key === k).p));
  const res1x2 = P.map((x) => ["home", "draw", "away"].map((k) => x.y[k]));
  const x12 = {
    n: P.length,
    accuracy: P.length ? triple.filter((t, i) => res1x2[i][t.indexOf(Math.max(...t))] === 1).length / P.length : null,
    brier: P.length ? triple.reduce((t, p, i) => t + p.reduce((u, v, k) => u + (v - res1x2[i][k]) ** 2, 0), 0) / P.length : null,
    logLoss: P.length ? triple.reduce((t, p, i) => t - Math.log(Math.max(1e-12, p[res1x2[i].indexOf(1)])), 0) / P.length : null,
  };
  // Singole: 1 unità fissa dove il modello dice BET su quota reale (pLow x quota >= edgeMargin); le quote mancanti non generano giocate.
  const singles = [];
  for (const x of P) for (const s of x.a.selections) if (s.verified) singles.push({ day: x.day, league: x.league, market: s.market, key: s.key, odds: s.odds.median, stake: 1, profit: x.y[s.key] ? s.odds.median - 1 : -1 });
  const group = (list, f) => Object.fromEntries([...new Set(list.map(f))].map((g) => [g, bettingSummary(list.filter((b) => f(b) === g))]));
  // Multiple: ogni giorno, solo gambe con quota reale e valore; 1 unità fissa.
  const multiples = [];
  for (const day of [...new Set(P.map((x) => x.day))]) {
    const todays = P.filter((x) => x.day === day);
    const items = todays.map((x) => ({ id: x.id, league: x.league, kickoffAt: x.kickoffAt, legs: x.a.legs }));
    for (const m of buildMultiples(items)) {
      const won = m.legs.every((l) => todays.find((x) => x.id === l.item.id).y[l.leg.key] === 1);
      multiples.push({ day, tier: m.key, odds: m.odds, legs: m.legs.length, stake: 1, profit: won ? m.odds - 1 : -1 });
    }
  }
  const mSum = bettingSummary(multiples);
  return {
    matches: P.length, perMarket, x12,
    singles: { all: bettingSummary(singles), byLeague: group(singles, (b) => b.league), byMarket: group(singles, (b) => b.market) },
    multiples: { all: { ...mSum, avgLegs: multiples.length ? multiples.reduce((t, m) => t + m.legs, 0) / multiples.length : null }, byTier: group(multiples, (b) => b.tier) },
  };
}

/** Platt per mercato: si stima sulla validazione, si valuta sul test (log loss prima/dopo). */
export function calibrationGain(preds) {
  const out = {};
  for (const s of SELECTIONS) {
    const get = (sp) => { const P = preds.filter((x) => x.split === sp); return [P.map((x) => x.a.selections.find((q) => q.key === s.key).p), P.map((x) => x.y[s.key])]; };
    const [pv, yv] = get("val"), [pt, yt] = get("test");
    const cal = fitPlatt(pv, yv);
    out[s.key] = { fitted: cal.fitted, a: cal.a, b: cal.b, before: logLoss(pt, yt), after: cal.fitted ? logLoss(pt.map((p) => applyPlatt(cal, p)), yt) : null };
  }
  return out;
}

export const GRID = { rho: [0, -0.05, -0.1, -0.15], formShrinkK: [4, 12, 24, 40], decay: [0.92, 0.96] };
/** Taratura sulla VALIDAZIONE (log loss su 1X2 + Over/Under 2,5 + BTTS); il test non viene mai guardato qui. */
export function tune(rows, opts = {}) {
  const results = [];
  for (const rho of GRID.rho) for (const formShrinkK of GRID.formShrinkK) for (const decay of GRID.decay) {
    const preds = withModel({ rho, formShrinkK, decay }, () => predict(rows, opts));
    const e = evaluate(preds, "val");
    const score = (e.x12.logLoss ?? 9) + (e.perMarket.over25.logLoss ?? 9) + (e.perMarket.btts.logLoss ?? 9);
    results.push({ rho, formShrinkK, decay, score, matches: e.matches });
  }
  results.sort((a, b) => a.score - b.score);
  return results;
}

const f = (v, d = 3) => (v == null || !Number.isFinite(v) ? "n/d" : v.toFixed(d));
export function report(name, e) {
  const L = [`\n=== ${name} · ${e.matches} partite di test ===`];
  L.push(`1X2: accuracy ${f(e.x12.accuracy)} · Brier ${f(e.x12.brier)} · log loss ${f(e.x12.logLoss)}`);
  for (const [k, m] of Object.entries(e.perMarket)) L.push(`  ${k.padEnd(8)} n=${m.n} base ${f(m.base)} Brier ${f(m.brier)} LL ${f(m.logLoss)} ECE ${f(m.ece)} acc ${f(m.accuracy)} prec ${f(m.precision)} rec ${f(m.recall)}`);
  const b = (t, s) => `${t}: n=${s.n} ROI ${f(s.roi)} hit ${f(s.hitRate)} quota media ${f(s.avgOdds, 2)} profitto ${f(s.profit, 2)} drawdown ${f(s.maxDrawdown, 2)} z ${f(s.z, 2)} → ${s.n === 0 ? "nessuna giocata" : s.adequate ? "vantaggio statisticamente supportato" : `NON DIMOSTRABILE (servono >= ${MIN_BETS_FOR_CLAIM} giocate e ROI > 2 errori standard)`}`;
  L.push(b("Singole (EV su quote reali)", e.singles.all), b("Multiple", e.multiples.all));
  for (const [lg, s] of Object.entries(e.singles.byLeague)) L.push(`  campionato ${lg}: n=${s.n} ROI ${f(s.roi)}`);
  for (const [mk, s] of Object.entries(e.singles.byMarket)) L.push(`  mercato ${mk}: n=${s.n} ROI ${f(s.roi)}`);
  return L.join("\n");
}

async function main() {
  const args = process.argv.slice(2), get = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const file = get("--file");
  if (!file) { console.error("Uso: node scripts/backtest.js --file finals.json|csv [--n 8] [--compare] [--tune] [--json out.json]"); process.exit(1); }
  const rows = normalize(parseRows(fs.readFileSync(file, "utf8"), file));
  const opts = { n: Number(get("--n")) || 8 };
  console.log(`${rows.length} partite finali (${rows[0]?.kickoff_at} → ${rows.at(-1)?.kickoff_at})`);
  if (rows.length < 600) console.log("ATTENZIONE: meno di 600 partite. I risultati sono indicativi e nessun miglioramento può essere dimostrato.");
  const result = {};
  if (args.includes("--tune")) {
    const t = tune(rows, opts); result.tune = t.slice(0, 5);
    console.log("\nMigliori parametri sulla VALIDAZIONE (rho, formShrinkK, decay):"); t.slice(0, 5).forEach((r) => console.log(`  rho ${r.rho} formShrinkK ${r.formShrinkK} decay ${r.decay} → score ${f(r.score, 4)}`));
    console.log("Applicali in functions/api/model.js solo se il test conferma il miglioramento (--compare).");
  }
  const variants = args.includes("--compare") ? { legacy: { pLowMethod: "legacy", rho: 0 }, attuale: {} } : { attuale: {} };
  for (const [name, ov] of Object.entries(variants)) {
    const preds = withModel(ov, () => predict(rows, opts));
    result[name] = evaluate(preds, "test");
    console.log(report(name, result[name]));
    result[`${name}_platt`] = calibrationGain(preds);
  }
  const jf = get("--json"); if (jf) fs.writeFileSync(jf, JSON.stringify(result, null, 2));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
