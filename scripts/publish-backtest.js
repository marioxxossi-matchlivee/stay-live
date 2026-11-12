#!/usr/bin/env node
/**
 * Pubblica il rapporto del backtest cronologico (BET ed EVITA, sulle partite finali storiche) nella sezione «Affidabilità» dell'app.
 *   node scripts/publish-backtest.js --file finals.json [--warmup 0.3] [--n 8] [--dry]
 * Scrive UNA riga in app_snapshot (id "reliability-backtest"): non tocca altre tabelle. Con --dry stampa il riepilogo senza scrivere.
 * Variabili (solo senza --dry): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY. Nel passato non ci sono quote: la "convenienza" è un proxy dichiarato.
 */
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { normalize, parseRows, predict } from "./backtest.js";
import { byConfidence, globalCalibration, pickBreakdown, summarize } from "./backtest-evita.js";
import { supabaseUpsert } from "../functions/api/_lib.js";

export const SNAPSHOT_ID = "reliability-backtest";

/** Payload serializzabile e piccolo (nessuna riga di partita): solo aggregati. */
export function buildBacktestPayload(rows, preds, { warmup = 0.3, generatedAt = new Date().toISOString() } = {}) {
  const g = pickBreakdown(preds);
  const evitaAll = [...g.soglia, ...g.edge, ...g.campione];
  const gc = globalCalibration(preds);
  return {
    generatedAt, method: "replay cronologico: per ogni giornata il modello vede solo le partite precedenti",
    matches: rows.length, from: rows[0]?.kickoff_at?.slice(0, 10) ?? null, to: rows.at(-1)?.kickoff_at?.slice(0, 10) ?? null,
    warmup, analyzed: preds.length,
    bet: summarize(g.bet), evita: summarize(evitaAll),
    evitaByReason: { soglia: summarize(g.soglia), edge: summarize(g.edge), campione: summarize(g.campione) },
    calibration: { n: gc.total.n, ece: gc.total.ece, brier: gc.total.brier, table: gc.total.table.filter((b) => b.n) },
    byConfidence: byConfidence(preds),
    limits: "Nel passato non ci sono le quote: il rendimento è un proxy (mercato che quota la media del campionato con il margine del bookmaker), non un rendimento reale.",
  };
}

async function main() {
  const args = process.argv.slice(2), get = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const file = get("--file");
  if (!file) { console.error("Uso: node scripts/publish-backtest.js --file finals.json [--warmup 0.3] [--n 8] [--dry]"); process.exit(1); }
  const rows = normalize(parseRows(fs.readFileSync(file, "utf8"), file));
  const warm = Math.min(0.7, Math.max(0.1, Number(get("--warmup")) || 0.3)), rest = 1 - warm;
  const preds = predict(rows, { n: Number(get("--n")) || 8, trainFrac: warm, valFrac: rest / 2 });
  const payload = buildBacktestPayload(rows, preds, { warmup: warm });
  console.log(`Partite finali: ${payload.matches} · analizzate: ${payload.analyzed} · BET ${payload.bet.n} · EVITA ${payload.evita.n}`);
  if (args.includes("--dry")) { console.log(JSON.stringify(payload).length, "byte"); return; }
  const env = { SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY };
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) { console.error("Mancano SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY"); process.exit(1); }
  await supabaseUpsert(env, "app_snapshot", [{ id: SNAPSHOT_ID, payload, meta: { source: "scripts/publish-backtest.js" }, built_at: payload.generatedAt }], "id");
  console.log("Pubblicato in app_snapshot:", SNAPSHOT_ID);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
