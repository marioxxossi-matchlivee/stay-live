#!/usr/bin/env node
/**
 * Backtest walk-forward OLD vs NEW sullo storico delle partite finali (sola lettura).
 *   node scripts/backtest-new-model.js --source supabase [--out cartella] [--warmup 0.3] [--write-params file.js]
 *   node scripts/backtest-new-model.js --file finals.json  [--legs prediction_legs.json]
 *
 * Procedura: replay cronologico del motore OLD (predict: ogni partita vede SOLO partite di giorni precedenti) -> gol attesi (lh, la).
 * Poi, per ogni MESE (dopo il rodaggio), i parametri del NEW (rho di Dixon-Coles; calibrazione Platt per 1X2, doppia chance e Multigol)
 * sono stimati SOLO sulle previsioni dei mesi PRECEDENTI e applicati al mese in corso. Le metriche sono tutte fuori campione.
 * OLD e NEW sono confrontati sulle STESSE partite e SOLO sui mercati presenti in entrambi (1X2 e doppia chance).
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { normalize, parseRows, predict } from "./backtest.js";
import { brier, calibration, fitPlatt, logLoss } from "./metrics.js";
import { wilson } from "../src/efficiency.js";
import { NM_FAMILY_LABEL, NM_KEYS, NM_MARKETS, NM_VERSION, fairFromOdds, marketsFromGrid, newMarkets, newOutcomes, totalPmf } from "../functions/api/_newmodel.js";
import { scoreMatrix } from "../functions/api/model.js";

export const RHO_GRID = [0, -0.03, -0.06, -0.1, -0.15];
export const MIN_TRAIN = 300;        // previsioni minime nei mesi precedenti per adattare i parametri
const PLATT_KEYS = NM_MARKETS.filter((m) => m.family !== "combo").map((m) => m.key);
const OLD_KEYS = ["home", "draw", "away", "dc1x", "dcx2", "dc12"];
const mean = (a) => (a.length ? a.reduce((t, v) => t + v, 0) / a.length : null);
const pc = (x, d = 1) => (x == null ? "—" : `${(x * 100).toFixed(d).replace(".", ",")}%`);
const f4 = (x) => (x == null ? "—" : x.toFixed(4).replace(".", ","));

/** Stato di validazione di un mercato dai risultati fuori campione. Criteri fissi e dichiarati. */
export function validationStatus({ n, p, freq, ci, ece, halves }) {
  const positives = n * Math.min(p, 1 - p);
  if (n < 100 || positives < 20) return "campione_insufficiente";
  if (n < 300) return "esplorativo";
  if (halves.every((h) => h != null) && Math.abs(halves[0] - halves[1]) > 0.06) return "instabile";   // lo scarto cambia troppo tra prima e seconda metà del periodo
  return ci.lo <= p && p <= ci.hi && ece <= 0.05 ? "validato" : "non_calibrato";
}

/** Riassunto di un mercato: n, probabilità media, frequenza reale, scarto, Brier, Log Loss, calibrazione, intervallo, stato. */
export function summarize(ps, ys, order = null) {
  const n = ps.length;
  if (!n) return { n: 0, status: "campione_insufficiente" };
  const p = mean(ps), freq = mean(ys), won = ys.reduce((t, v) => t + v, 0), ci = wilson(won, n);
  const cal = calibration(ps, ys, 5);
  const half = Math.floor(n / 2);
  const halves = [[0, half], [half, n]].map(([a, b]) => (b - a >= 50 ? mean(ps.slice(a, b)) - mean(ys.slice(a, b)) : null));
  const out = { n, p, freq, gap: p - freq, brier: brier(ps, ys), logLoss: logLoss(ps, ys), ece: cal.ece, bins: cal.table, ci, halves };
  return { ...out, status: validationStatus(out) };
}

/** Adatta rho (e la calibrazione) SOLO su `train` = previsioni di mesi precedenti. Pura: nessun accesso a dati successivi. */
export function fitParams(train) {
  if (train.length < MIN_TRAIN) return null;
  let best = { rho: 0, loss: Infinity };
  for (const rho of RHO_GRID) {
    let tot = 0;
    for (const t of train) {
      const m = scoreMatrix(t.lh, t.la, rho), p = marketsFromGrid(m), y = t.y12;
      const res = Math.max(1e-9, y === "home" ? p.home : y === "draw" ? p.draw : p.away);
      const tp = Math.max(1e-9, totalPmf(m)[Math.min(t.total, m.length * 2 - 2)] ?? 1e-9);
      tot += -Math.log(res) - Math.log(tp);
    }
    if (tot / train.length < best.loss) best = { rho, loss: tot / train.length };
  }
  const rawP = Object.fromEntries(PLATT_KEYS.map((k) => [k, []])), rawY = Object.fromEntries(PLATT_KEYS.map((k) => [k, []]));
  for (const t of train) {
    const p = marketsFromGrid(scoreMatrix(t.lh, t.la, best.rho));
    for (const k of PLATT_KEYS) { rawP[k].push(p[k]); rawY[k].push(t.y[k]); }
  }
  const platt = {};
  for (const k of PLATT_KEYS) {
    const pos = rawY[k].reduce((a, b) => a + b, 0);
    if (pos >= 30 && train.length - pos >= 30) { const c = fitPlatt(rawP[k], rawY[k]); if (c.fitted) platt[k] = { a: c.a, b: c.b }; }
  }
  return { rho: best.rho, platt, n: train.length };
}

const monthOf = (day) => day.slice(0, 7);

/** Cuore: walk-forward per mese. Restituisce le previsioni fuori campione con OLD, NEW0 (nessuna calibrazione) e NEW. */
export function walkForward(items, { minTrain = MIN_TRAIN } = {}) {
  const months = [...new Set(items.map((x) => monthOf(x.day)))].sort();
  const oos = [], folds = [];
  for (const mo of months) {
    const train = items.filter((x) => monthOf(x.day) < mo), test = items.filter((x) => monthOf(x.day) === mo);
    if (train.length < minTrain) { folds.push({ month: mo, n: test.length, skipped: "rodaggio" }); continue; }
    const params = fitParams(train);
    if (!params) { folds.push({ month: mo, n: test.length, skipped: "dati insufficienti" }); continue; }
    folds.push({ month: mo, n: test.length, trainN: train.length, trainTo: train.reduce((m, x) => (x.day > m ? x.day : m), ""), rho: params.rho, plattKeys: Object.keys(params.platt).length });
    for (const t of test) {
      const base = newMarkets(t.lh, t.la, { rho: 0, platt: {} }).p, nw = newMarkets(t.lh, t.la, params).p;
      oos.push({ ...t, p0: base, pn: nw });
    }
  }
  return { oos, folds };
}

/** Tabelle per mercato per le tre varianti. */
export function perMarket(oos) {
  const out = {};
  for (const k of NM_KEYS) {
    const ys = oos.map((x) => x.y[k]);
    out[k] = { new: summarize(oos.map((x) => x.pn[k]), ys), new0: summarize(oos.map((x) => x.p0[k]), ys) };
    if (OLD_KEYS.includes(k)) out[k].old = summarize(oos.map((x) => x.old[k]), ys);
  }
  return out;
}

const multi = (oos, src) => {
  const rows = oos.map((x) => ({ p: [x[src].home, x[src].draw, x[src].away], k: ["home", "draw", "away"].indexOf(x.y12) }));
  return { n: rows.length, accuracy: mean(rows.map((r) => (r.p.indexOf(Math.max(...r.p)) === r.k ? 1 : 0))), brier: mean(rows.map((r) => r.p.reduce((t, v, i) => t + (v - (i === r.k ? 1 : 0)) ** 2, 0))), logLoss: mean(rows.map((r) => -Math.log(Math.max(1e-9, r.p[r.k])))) };
};
const oldAsP = (o) => ({ ...o });

/** Confronto con le quote reali (solo partite con le tre quote 1X2 registrate PRIMA del calcio d'inizio). */
export function oddsComparison(oos, legs) {
  const byGame = new Map();
  for (const l of legs ?? []) {
    if (!(Number(l.odds) > 1) || !(Date.parse(l.computed_at) < Date.parse(l.kickoff_at))) continue;
    (byGame.get(l.game_id) ?? byGame.set(l.game_id, {}).get(l.game_id))[l.sel_key] = Number(l.odds);
  }
  const rows = [];
  for (const x of oos) { const fair = fairFromOdds(byGame.get(x.gid)); if (fair) rows.push({ x, fair }); }
  if (!rows.length) return { n: 0 };
  const mc = (get) => { const r = rows.map(({ x, fair }) => ({ p: get(x, fair), k: ["home", "draw", "away"].indexOf(x.y12) })); return { brier: mean(r.map((q) => q.p.reduce((t, v, i) => t + (v - (i === q.k ? 1 : 0)) ** 2, 0))), logLoss: mean(r.map((q) => -Math.log(Math.max(1e-9, q.p[q.k])))), accuracy: mean(r.map((q) => (q.p.indexOf(Math.max(...q.p)) === q.k ? 1 : 0))) }; };
  const arr = (o) => [o.home, o.draw, o.away];
  return { n: rows.length, overround: mean(rows.map((r) => r.fair.overround)), model_new: mc((x) => arr(x.pn)), model_old: mc((x) => arr(x.old)), market_fair: mc((x, f) => arr(f)) };
}

function sliceBy(oos, keyFn, minN = 50) {
  const g = new Map();
  for (const x of oos) (g.get(keyFn(x)) ?? g.set(keyFn(x), []).get(keyFn(x))).push(x);
  return [...g].filter(([, v]) => v.length >= minN).sort((a, b) => String(a[0]).localeCompare(String(b[0]))).map(([label, v]) => ({
    label, n: v.length, old: multi(v, "old"), new: multi(v, "pn"),
    mg: summarize(v.flatMap((x) => ["mg13", "mg14", "mg24", "mg25", "mg36"].map((k) => x.pn[k])), v.flatMap((x) => ["mg13", "mg14", "mg24", "mg25", "mg36"].map((k) => x.y[k]))),
  }));
}

export function buildResults(items, legs = null) {
  const { oos, folds } = walkForward(items);
  const pm = perMarket(oos);
  const first = oos.map((x) => x.day).sort()[0] ?? null, last = oos.map((x) => x.day).sort().at(-1) ?? null;
  return {
    version: NM_VERSION, generated_at: new Date().toISOString(), previsioni_totali: items.length, fuori_campione: oos.length, periodo: { dal: first, al: last },
    folds, perMarket: pm,
    esito_1x2: { old: multi(oos, "old"), new0: multi(oos, "p0"), new: multi(oos, "pn") },
    per_campionato: sliceBy(oos, (x) => x.league), per_mese: sliceBy(oos, (x) => monthOf(x.day), 30),
    quote: oddsComparison(oos, legs),
  };
}

/** Parametri finali (tutti i dati) e stato di ogni mercato dalla valutazione fuori campione, in forma di modulo JS. */
export function paramsModule(items, results) {
  const fin = fitParams(items) ?? { rho: 0, platt: {}, n: 0 };
  const validation = Object.fromEntries(NM_KEYS.map((k) => { const s = results.perMarket[k]?.new; return [k, { status: s?.status ?? "non_validato", n: s?.n ?? 0, gap: s?.gap != null ? Math.round(s.gap * 1e4) / 1e4 : null }]; }));
  const days = items.map((x) => x.day).sort();
  return `/** Generato da scripts/backtest-new-model.js il ${new Date().toISOString().slice(0, 10)} (versione ${NM_VERSION}). Non modificare a mano. */\nexport const NM_PARAMS = ${JSON.stringify({ rho: fin.rho, platt: fin.platt, fittedOn: { n: fin.n, dal: days[0] ?? null, al: days.at(-1) ?? null } })};\nexport const NM_VALIDATION = ${JSON.stringify(validation)};\n`;
}

const STATUS = { validato: "VALIDATO", esplorativo: "esplorativo", non_calibrato: "NON calibrato", instabile: "instabile", campione_insufficiente: "campione insufficiente", non_validato: "non validato" };
const table = (head, rows) => [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");
const ci = (s) => (s.ci ? `${pc(s.ci.lo, 0)}–${pc(s.ci.hi, 0)}` : "—");

export function reportMarkdown(r) {
  const L = [`# Backtest walk-forward OLD vs NEW (${r.version})`, "",
    `Previsioni replay: ${r.previsioni_totali}; fuori campione (valutate): **${r.fuori_campione}**, dal ${r.periodo.dal} al ${r.periodo.al}.`,
    "Tutti i parametri del NEW sono adattati solo su mesi precedenti a quello valutato. Nessuna quota nel passato lontano: si misura la componente statistica.", ""];
  L.push("## Passi walk-forward", table(["Mese", "Partite", "Allenamento", "Fino al", "rho", "Mercati calibrati"], r.folds.map((f) => f.skipped ? [f.month, f.n, "—", "—", "—", `saltato (${f.skipped})`] : [f.month, f.n, f.trainN, f.trainTo, f.rho, f.plattKeys])), "");
  const e = r.esito_1x2;
  L.push("## 1X2 complessivo (stesse partite)", table(["Modello", "n", "Accuratezza", "Brier (3 esiti)", "Log Loss"], [["OLD", e.old.n, pc(e.old.accuracy), f4(e.old.brier), f4(e.old.logLoss)], ["NEW senza calibrazione", e.new0.n, pc(e.new0.accuracy), f4(e.new0.brier), f4(e.new0.logLoss)], ["NEW", e.new.n, pc(e.new.accuracy), f4(e.new.brier), f4(e.new.logLoss)]]), "",
    "_Un Brier/Log Loss più basso è meglio. Differenze piccole rispetto al rumore di ~11k partite non sono prova di miglioramento._", "");
  const head = ["Mercato", "n", "Prob. media", "Frequenza", "Scarto", "Int. 95%", "Brier", "Log Loss", "ECE", "Stato"];
  const line = (m, s) => [m.label, s.n, pc(s.p), pc(s.freq), s.gap == null ? "—" : `${s.gap >= 0 ? "+" : ""}${(s.gap * 100).toFixed(1).replace(".", ",")}`, ci(s), f4(s.brier), f4(s.logLoss), f4(s.ece), STATUS[s.status] ?? s.status];
  for (const fam of ["esito", "dc", "multigol", "combo"]) {
    const ms = NM_MARKETS.filter((m) => m.family === fam);
    L.push(`## ${NM_FAMILY_LABEL[fam]} — NEW`, table(head, ms.map((m) => line(m, r.perMarket[m.key].new))), "");
    if (fam === "esito" || fam === "dc") L.push(`### ${NM_FAMILY_LABEL[fam]} — OLD (stesse partite)`, table(head, ms.map((m) => line(m, r.perMarket[m.key].old))), "");
    if (fam === "multigol" || fam === "combo") L.push(`### ${NM_FAMILY_LABEL[fam]} — effetto della calibrazione (Brier NEW senza calibrazione → NEW)`, table(["Mercato", "Brier senza", "Brier NEW", "Log Loss senza", "Log Loss NEW"], ms.map((m) => [m.label, f4(r.perMarket[m.key].new0.brier), f4(r.perMarket[m.key].new.brier), f4(r.perMarket[m.key].new0.logLoss), f4(r.perMarket[m.key].new.logLoss)])), "");
  }
  L.push("## Curve di calibrazione (NEW, 5 fasce)", table(["Mercato", "Fascia", "n", "Previsto", "Reale"], NM_MARKETS.filter((m) => m.family !== "combo").flatMap((m) => (r.perMarket[m.key].new.bins ?? []).filter((b) => b.n >= 20).map((b) => [m.label, `${pc(b.lo, 0)}–${pc(b.hi, 0)}`, b.n, pc(b.predicted), pc(b.observed)]))), "");
  const sl = (rows) => table(["", "n", "Brier OLD", "Brier NEW", "Accuratezza OLD", "Accuratezza NEW", "Scarto Multigol (NEW)"], rows.map((x) => [x.label, x.n, f4(x.old.brier), f4(x.new.brier), pc(x.old.accuracy), pc(x.new.accuracy), x.mg.gap == null ? "—" : `${(x.mg.gap * 100).toFixed(1).replace(".", ",")} pt`]));
  L.push("## Per campionato (almeno 50 partite)", sl(r.per_campionato), "", "## Per mese (stabilità temporale, almeno 30 partite)", sl(r.per_mese), "");
  const q = r.quote;
  L.push("## Confronto con le quote reali (1X2, quote registrate prima della partita)");
  if (!q.n) L.push("Nessuna partita valutata con le tre quote 1X2 prepartita: confronto non calcolabile.");
  else L.push(`Partite: **${q.n}** (campione ${q.n < 300 ? "ridotto: leggere con cautela" : "adeguato"}). Margine medio del bookmaker: ${pc(q.overround)}.`, table(["Fonte", "Brier", "Log Loss", "Accuratezza"], [["Quote depurate dal margine", f4(q.market_fair.brier), f4(q.market_fair.logLoss), pc(q.market_fair.accuracy)], ["NEW", f4(q.model_new.brier), f4(q.model_new.logLoss), pc(q.model_new.accuracy)], ["OLD", f4(q.model_old.brier), f4(q.model_old.logLoss), pc(q.model_old.accuracy)]]));
  L.push("", "_Il Multigol non ha quote storiche: nessun confronto con il mercato su quel mercato. «Validato» significa solo che la probabilità dichiarata coincide con la frequenza reale nel periodo; non implica alcun vantaggio sulle quote._");
  return L.join("\n");
}

/** Righe `matches` -> elementi per il walk-forward (gol attesi dal replay OLD + esiti). */
export function itemsFromPreds(preds, rows) {
  return preds.map((x) => {
    const r = rows[Number(x.id)], sel = Object.fromEntries(x.a.selections.map((s) => [s.key, s.p]));
    const y = newOutcomes(r.home_score, r.away_score);
    return { gid: r.game_id ?? null, league: x.league, day: x.day, lh: x.a.lambda.home, la: x.a.lambda.away, total: r.home_score + r.away_score, y, y12: y.home ? "home" : y.draw ? "draw" : "away", old: Object.fromEntries(OLD_KEYS.map((k) => [k, sel[k]])) };
  });
}

async function loadSupabase() {
  const { supabaseGetAll } = await import("../functions/api/_lib.js");
  const env = process.env;
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) { console.error("Mancano SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY."); process.exit(1); }
  const rows = await supabaseGetAll(env, "matches", { select: "game_id,league,kickoff_at,home_id,away_id,home_name,away_name,home_score,away_score,neutral_site", status: "eq.final", order: "kickoff_at.asc,game_id.asc" }, 1000, 60);
  const legs = await supabaseGetAll(env, "prediction_legs", { select: "game_id,sel_key,odds,computed_at,kickoff_at", sel_key: "in.(home,draw,away)", order: "game_id.asc,sel_key.asc" }, 1000, 60);
  return { rows, legs };
}

async function main() {
  const args = process.argv.slice(2), get = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  let rows, legs = null;
  if (get("--file")) { rows = parseRows(fs.readFileSync(get("--file"), "utf8"), get("--file")); if (get("--legs")) legs = JSON.parse(fs.readFileSync(get("--legs"), "utf8")); }
  else if (get("--source") === "supabase") ({ rows, legs } = await loadSupabase());
  else { console.error("Uso: --source supabase | --file finals.json [--legs prediction_legs.json] [--out cartella] [--warmup 0.3] [--write-params file.js]"); process.exit(1); }
  rows = normalize(rows);
  const warm = Math.min(0.8, Math.max(0.1, Number(get("--warmup")) || 0.3));
  console.log(`Partite finali: ${rows.length}. Replay OLD…`);
  const preds = predict(rows, { n: 8, trainFrac: warm, valFrac: 1 - warm });
  const items = itemsFromPreds(preds, rows);
  const results = buildResults(items, legs);
  const out = get("--out") || "backtest-new-model";
  fs.mkdirSync(out, { recursive: true });
  const md = reportMarkdown(results);
  fs.writeFileSync(path.join(out, "report.md"), md);
  fs.writeFileSync(path.join(out, "results.json"), JSON.stringify(results));
  if (get("--write-params")) fs.writeFileSync(get("--write-params"), paramsModule(items, results));
  fs.writeFileSync(path.join(out, "_newmodel-params.generated.js"), paramsModule(items, results));
  console.log(md);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => { console.error(String(e?.message ?? e).replace(/eyJ[\w.-]+/g, "[token]").slice(0, 300)); process.exit(1); });
