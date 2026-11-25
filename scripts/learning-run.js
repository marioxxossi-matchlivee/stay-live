#!/usr/bin/env node
/**
 * Stay Live — CONTINUOUS LEARNING: esecuzione della diagnostica e del laboratorio. SOLA LETTURA sul database (solo richieste GET), scrive UN file locale.
 *
 * Uso:
 *   node scripts/learning-run.js                       legge tennis e calcio da Supabase (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY) e scrive public/learning/report.json
 *   node scripts/learning-run.js --input dati.json     usa righe già estratte ({ tennis:{predictions,results}, football:{rows} }): nessuna rete
 *   opzioni: --sports tennis,football · --out percorso · --since AAAA-MM-GG (finestra di analisi) · --reps N · --no-lab · --dry-run (non scrive il file)
 * Non importa né modifica alcun motore operativo e non usa i secret del provider.
 */
import fs from "node:fs";
import path from "node:path";
import { buildReport } from "../functions/api/_learning-report.js";

const PAGE = 1000;

/** Legge TUTTE le righe con richieste GET paginate. Se il tetto di pagine è esaurito con una pagina piena, lancia (mai troncamento silenzioso). */
export async function getAll(env, table, query, { maxPages = 200, f = fetch } = {}) {
  const out = [];
  // maxPages limita le pagine di dati; una pagina di controllo aggiuntiva distingue il tetto esatto
  // (dataset completo con ultima pagina piena) da un dataset realmente troncato.
  for (let p = 0; p <= maxPages; p++) {
    const url = new URL(`/rest/v1/${table}`, env.SUPABASE_URL); for (const [k, v] of Object.entries({ ...query, limit: PAGE, offset: p * PAGE })) url.searchParams.set(k, String(v));
    const res = await f(url, { method: "GET", headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}` } });
    if (!res.ok) throw new Error(`Lettura di ${table}: HTTP ${res.status} ${(await res.text()).slice(0, 160)}`);
    const rows = await res.json();
    if (p === maxPages) {
      if (rows.length) throw new Error(`Lettura di ${table} oltre il tetto di ${maxPages * PAGE} righe: risultato incompleto, non usato`);
      return out;
    }
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
  return out;
}

export async function loadFromSupabase(env, sports, now, f = fetch) {
  const inputs = {}, nowIso = new Date(now).toISOString();
  if (sports.includes("tennis")) {
    const predictions = await getAll(env, "tennis_predictions", { select: "match_key,starts_at,tour,surface,published,p1,p2,missing,odds_p1,odds_p2,odds_at,model_ver", published: "eq.true", starts_at: `lt.${nowIso}`, order: "starts_at.asc,match_key.asc" }, { f });
    const results = await getAll(env, "tennis_prediction_results", { select: "match_key,winner", winner: "not.is.null", order: "match_key.asc" }, { f });
    inputs.tennis = { predictions, results };
  }
  if (sports.includes("football")) inputs.football = { rows: await getAll(env, "prediction_leg_results", { select: "game_id,league,kickoff_at,sel_key,p,p_model,p_api,p_market,odds,n_books,verdict,basis,model_ver,won", won: "not.is.null", order: "kickoff_at.asc,game_id.asc,sel_key.asc" }, { f }) };
  return inputs;
}

export function parseArgs(argv) {
  const a = { sports: ["tennis", "football"], out: "public/learning/report.json", input: null, since: null, reps: undefined, lab: true, dryRun: false };
  for (let i = 0; i < argv.length; i++) { const k = argv[i], v = () => argv[++i];
    if (k === "--input") a.input = v(); else if (k === "--out") a.out = v(); else if (k === "--sports") a.sports = v().split(",").filter(Boolean); else if (k === "--since") a.since = Date.parse(v()); else if (k === "--reps") a.reps = Number(v()); else if (k === "--no-lab") a.lab = false; else if (k === "--dry-run") a.dryRun = true;
    else throw new Error(`Opzione sconosciuta: ${k}`); }
  if (a.since != null && !Number.isFinite(a.since)) throw new Error("--since non è una data valida");
  if (a.reps != null && !(a.reps >= 100 && a.reps <= 5000)) throw new Error("--reps deve essere tra 100 e 5000");
  return a;
}

export async function run(argv = process.argv.slice(2), env = process.env, { f = fetch, now = Date.now(), log = console.log } = {}) {
  const a = parseArgs(argv);
  let inputs, kind;
  if (a.input) { inputs = JSON.parse(fs.readFileSync(a.input, "utf8")); kind = "file"; }
  else { if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Mancano SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY (oppure usa --input)"); inputs = await loadFromSupabase(env, a.sports, now, f); kind = "supabase"; }
  let previousLog = []; try { const old = JSON.parse(fs.readFileSync(a.out, "utf8")); if (Array.isArray(old.experimentLog)) previousLog = old.experimentLog; } catch { /* nessun report precedente */ }
  const report = buildReport(inputs, { now, reps: a.reps, lab: a.lab, since: a.since, previousLog, sourceKind: kind });
  const s = report.overview;
  log(`Previsioni analizzate: ${JSON.stringify(s.predictionsAnalyzed)} · anomalie: ${s.anomalies.total} (rilevate ${s.anomalies.detected}) · esperimenti nel registro: ${s.experiments.total} (questa esecuzione ${s.experiments.thisRun})`);
  if (a.dryRun) { log("Dry-run: nessun file scritto."); return report; }
  fs.mkdirSync(path.dirname(a.out), { recursive: true }); fs.writeFileSync(a.out, JSON.stringify(report)); log(`Report scritto: ${a.out} (${Math.round(JSON.stringify(report).length / 1024)} KB)`);
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) run().catch((e) => { console.error(`Errore: ${e.message}`); process.exit(1); });
