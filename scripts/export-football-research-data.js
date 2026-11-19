#!/usr/bin/env node
/**
 * Esportazione di ricerca del calcio — SOLA LETTURA.
 *   node scripts/export-football-research-data.js [cartella_output]   (default: export-football/)
 *
 * Legge da Supabase (solo richieste GET, nessuna scrittura, nessuna chiamata ad API-Football) e scrive file JSON distinti:
 *   matches.json            tutte le partite finali (TUTTE le stagioni, nessun filtro sui supplementari: c'è `decided_in`)
 *   prediction_legs.json    previsioni registrate prima del calcio d'inizio, una riga per partita+selezione (con quota reale e `computed_at`)
 *   bet_predictions.json    selezione principale per partita (BET/EVITA)
 *   odds_quotes.json        ultima quota per partita+selezione (tabella con upsert: NON conserva lo storico delle rilevazioni)
 *   odds_snapshots.json     storico quote della prima versione dell'app (se esiste)
 *   completeness-report.json / .md   quante partite hanno davvero ciascun dato; temporalità delle quote
 *   manifest.json           conteggi, data dell'esportazione, hash dei file
 * Nessuna chiave o segreto entra nei file. Righe deduplicate per chiave primaria: ripetibile.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL } from "node:url";
import { supabaseGetAll } from "../functions/api/_lib.js";

const MIN = 60e3;
/** Tabelle esportate: chiave primaria (per la deduplicazione) e ordinamento stabile. */
export const TABLES = {
  matches: { file: "matches.json", key: ["game_id"], order: "game_id.asc", query: { select: "*", status: "eq.final" } },
  prediction_legs: { file: "prediction_legs.json", key: ["game_id", "sel_key"], order: "game_id.asc,sel_key.asc", query: { select: "*" } },
  bet_predictions: { file: "bet_predictions.json", key: ["game_id"], order: "game_id.asc", query: { select: "*" } },
  odds_quotes: { file: "odds_quotes.json", key: ["game_id", "selection"], order: "game_id.asc,selection.asc", query: { select: "*" } },
  odds_snapshots: { file: "odds_snapshots.json", key: ["id"], order: "id.asc", query: { select: "*" }, optional: true },
  football_research_odds: { file: "football_research_odds.json", key: ["id"], order: "id.asc", query: { select: "*" }, optional: true },
};

export function dedupe(rows, key) {
  const seen = new Map();
  for (const r of rows ?? []) seen.set(key.map((k) => r?.[k]).join("|"), r);
  return [...seen.values()];
}

const has = (v) => v !== null && v !== undefined && v !== "";
const ts = (v) => (has(v) ? Date.parse(v) : NaN);
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);

/** Classe temporale di una rilevazione rispetto al calcio d'inizio. */
export function timingOf(capturedAt, kickoffAt) {
  const c = ts(capturedAt), k = ts(kickoffAt);
  if (!Number.isFinite(c)) return "senza_timestamp";
  if (!Number.isFinite(k)) return "senza_calcio_inizio";
  return c < k ? "prima_della_partita" : "dopo_l_inizio";
}

/** Report di completezza: funzione pura sui dati esportati (nessuna rete). Non scarta e non inventa nulla. */
export function buildCompleteness({ matches = [], legs = [], bets = [], quotes = [], snapshots = [], research = [] }) {
  const byId = new Map(matches.map((m) => [m.game_id, m]));
  const legsBy = new Map(), quotesBy = new Map();
  for (const l of legs) (legsBy.get(l.game_id) ?? legsBy.set(l.game_id, []).get(l.game_id)).push(l);
  for (const q of quotes) (quotesBy.get(q.game_id) ?? quotesBy.set(q.game_id, []).get(q.game_id)).push(q);
  const betIds = new Set(bets.map((b) => b.game_id));
  const finals = matches.filter((m) => Number.isFinite(m.home_score) && Number.isFinite(m.away_score));
  const final = new Set(finals.map((m) => m.game_id));

  const sel = (id, keys) => keys.every((k) => (legsBy.get(id) ?? []).some((l) => l.sel_key === k));
  const selOdds = (id, keys) => keys.every((k) => (legsBy.get(id) ?? []).some((l) => l.sel_key === k && Number(l.odds) > 1));
  const ids = [...final];
  const count = (fn) => ids.filter(fn).length;

  const resBy = new Map();
  for (const r of research) (resBy.get(r.game_id) ?? resBy.set(r.game_id, new Set()).get(r.game_id)).add(Number(r.bet_id));
  const researchTiming = {};
  for (const r of research) { const c = timingOf(r.captured_at, r.kickoff_at); researchTiming[c] = (researchTiming[c] ?? 0) + 1; }
  const timing = { prediction_legs: {}, bet_predictions: {}, odds_quotes: {}, odds_snapshots: {}, football_research_odds: researchTiming };
  const tally = (bucket, cls) => { bucket[cls] = (bucket[cls] ?? 0) + 1; };
  for (const l of legs) tally(timing.prediction_legs, timingOf(l.computed_at, l.kickoff_at));
  for (const b of bets) tally(timing.bet_predictions, timingOf(b.computed_at, b.kickoff_at));
  for (const q of quotes) tally(timing.odds_quotes, timingOf(q.captured_at, byId.get(q.game_id)?.kickoff_at));
  for (const s of snapshots) tally(timing.odds_snapshots, timingOf(s.captured_at, byId.get(String(s.fixture_id))?.kickoff_at));

  const withLegs = count((id) => legsBy.has(id));
  const withOdds = count((id) => (legsBy.get(id) ?? []).some((l) => Number(l.odds) > 1));
  const x12 = ["home", "draw", "away"], dc = ["dc1x", "dcx2", "dc12"];
  const verifiable = count((id) => (legsBy.get(id) ?? []).some((l) => Number(l.odds) > 1 && timingOf(l.computed_at, l.kickoff_at) === "prima_della_partita"));
  const leagues = {};
  for (const m of finals) { const L = (leagues[m.league] ??= { finali: 0, con_previsioni: 0, con_quote: 0 }); L.finali += 1; if (legsBy.has(m.game_id)) L.con_previsioni += 1; if ((legsBy.get(m.game_id) ?? []).some((l) => Number(l.odds) > 1)) L.con_quote += 1; }
  const seasons = {};
  for (const m of finals) seasons[m.season ?? "n/d"] = (seasons[m.season ?? "n/d"] ?? 0) + 1;
  const days = finals.map((m) => ts(m.kickoff_at)).filter(Number.isFinite).sort((a, b) => a - b);

  return {
    generated_at: new Date().toISOString(),
    righe: { matches: matches.length, prediction_legs: legs.length, bet_predictions: bets.length, odds_quotes: quotes.length, odds_snapshots: snapshots.length, football_research_odds: research.length },
    periodo: days.length ? { dal: new Date(days[0]).toISOString(), al: new Date(days.at(-1)).toISOString() } : null,
    dataset_A: { partite_finali_con_punteggio: finals.length, per_stagione: seasons, per_campionato: leagues },
    dataset_B: {
      partite_finali_con_previsione_registrata: withLegs,
      partite_finali_con_almeno_una_quota_reale: withOdds,
      con_quota_verificabile_prima_della_partita: verifiable,
      con_1X2_completo_nelle_previsioni: count((id) => sel(id, x12)),
      con_1X2_con_quote_complete_di_tutti_e_tre_gli_esiti: count((id) => selOdds(id, x12)),
      con_doppia_chance_completa: count((id) => sel(id, dc)),
      con_doppia_chance_con_quote_complete: count((id) => selOdds(id, dc)),
      con_selezione_principale_BET_EVITA: count((id) => betIds.has(id)),
      con_quote_ricerca_registrate_prima_della_partita: resBy.size,
      con_quote_Multigol_a_fasce_349_186_223: [...resBy.values()].filter((b) => [349, 186, 223].some((x) => b.has(x))).length,
      con_quote_Exact_Goals_Number_38: [...resBy.values()].filter((b) => b.has(38)).length,
      con_quote_in_odds_quotes: count((id) => quotesBy.has(id)),
      percentuale_su_finali: { previsioni: pct(withLegs, finals.length), quote: pct(withOdds, finals.length) },
    },
    temporalita: timing,
    note: [
      "odds_quotes è una tabella con upsert (una riga per partita+selezione): lo storico delle rilevazioni successive NON è conservato.",
      "prediction_legs.odds è la quota mediana al momento del calcolo; il trigger di congelamento impedisce scritture dopo il calcio d'inizio.",
      "Il Multigol non è calcolato dall'app. Le quote dei mercati a fasce (349, 186, 223) si registrano in football_research_odds solo da quando è attivo il workflow di registrazione: per le partite precedenti non esistono.",
      "Partite finali nelle previsioni ma assenti in matches (id non collegati): " + legs.filter((l) => !byId.has(l.game_id)).map((l) => l.game_id).filter((v, i, a) => a.indexOf(v) === i).length,
    ],
  };
}

export function completenessMarkdown(r) {
  const B = r.dataset_B, row = (k, v) => `| ${k} | ${v} |`;
  return [
    "# Completezza dei dati — Stay Live calcio", "", `Generato: ${r.generated_at}`, "",
    `Periodo partite finali: ${r.periodo ? `${r.periodo.dal.slice(0, 10)} → ${r.periodo.al.slice(0, 10)}` : "n/d"}`, "",
    "| Dato | Partite |", "|---|---|",
    row("Dataset A: partite finali con punteggio", r.dataset_A.partite_finali_con_punteggio),
    ...Object.entries(B).filter(([k]) => k !== "percentuale_su_finali").map(([k, v]) => row(k.replace(/_/g, " "), v)),
    "", "## Righe esportate", "", "| Tabella | Righe |", "|---|---|", ...Object.entries(r.righe).map(([k, v]) => row(k, v)),
    "", "## Temporalità (rispetto al calcio d'inizio)", "", "| Tabella | Classe | Righe |", "|---|---|---|",
    ...Object.entries(r.temporalita).flatMap(([t, c]) => Object.entries(c).map(([k, v]) => `| ${t} | ${k.replace(/_/g, " ")} | ${v} |`)),
    "", "## Per campionato", "", "| Campionato | Finali | Con previsioni | Con quote |", "|---|---|---|---|",
    ...Object.entries(r.dataset_A.per_campionato).sort((a, b) => b[1].finali - a[1].finali).map(([k, v]) => `| ${k} | ${v.finali} | ${v.con_previsioni} | ${v.con_quote} |`),
    "", "## Note", "", ...r.note.map((n) => `- ${n}`),
  ].join("\n");
}

async function main() {
  const need = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].filter((k) => !process.env[k]);
  if (need.length) { console.error(`Mancano: ${need.join(", ")}`); process.exit(1); }
  const out = process.argv[2] || "export-football";
  fs.mkdirSync(out, { recursive: true });
  const data = {}, manifest = { generated_at: new Date().toISOString(), files: {} };
  for (const [name, t] of Object.entries(TABLES)) {
    try {
      const rows = dedupe(await supabaseGetAll(process.env, name, { ...t.query, order: t.order }, 1000, 2000), t.key);
      data[name] = rows;
    } catch (e) {
      if (!t.optional) { console.error(`Errore lettura ${name}: ${String(e.message ?? e).replace(/eyJ[\w.-]+/g, "[token]")}`); process.exit(1); }
      console.log(`${name}: tabella non disponibile, saltata`); data[name] = [];
    }
    const text = JSON.stringify(data[name]);
    fs.writeFileSync(path.join(out, t.file), text);
    manifest.files[t.file] = { rows: data[name].length, sha256: crypto.createHash("sha256").update(text).digest("hex") };
    console.log(`${name}: ${data[name].length} righe`);
  }
  const rep = buildCompleteness({ matches: data.matches, legs: data.prediction_legs, bets: data.bet_predictions, quotes: data.odds_quotes, snapshots: data.odds_snapshots, research: data.football_research_odds });
  fs.writeFileSync(path.join(out, "completeness-report.json"), JSON.stringify(rep, null, 2));
  fs.writeFileSync(path.join(out, "completeness-report.md"), completenessMarkdown(rep));
  fs.writeFileSync(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(completenessMarkdown(rep));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
