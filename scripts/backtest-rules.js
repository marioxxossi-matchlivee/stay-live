#!/usr/bin/env node
/**
 * Confronto delle REGOLE di BET senza quote (il ripiego quando una selezione non ha quota reale):
 *   node scripts/backtest-rules.js --file finals.json [--n 8]
 * Replay cronologico (come backtest.js): per ogni variante conta i BET, quali esiti, quanti ne ha centrati e quanto dichiarava (probabilità prudente).
 * Una regola è migliore solo se, su abbastanza BET, la percentuale centrata resta all'altezza di quella dichiarata. Con meno di
 * MIN_BETS_FOR_CLAIM BET di test nessuna conclusione è dimostrata. Non scrive nulla nel modello: serve a decidere.
 */
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { normalize, parseRows, predict, withModel } from "./backtest.js";
import { MIN_BETS_FOR_CLAIM } from "./metrics.js";

export const VARIANTS = {
  attuale: {},
  relativa_14: { edgeMode: "ratio", minEdgeRatio: 0.145 },
  relativa_10: { edgeMode: "ratio", minEdgeRatio: 0.10 },
  soglia_55: { betThreshold: 0.55 },
  punti_5: { minEdge: 0.05 },
};

/** Sintesi dei BET di una variante su uno split ("val" | "test"). */
export function summarizeBets(preds, split) {
  const bets = preds.filter((x) => x.split === split && x.a.pick?.verdict === "BET" && x.a.confidence !== "insufficiente");
  const byKey = {};
  for (const x of bets) {
    const k = x.a.pick.key, o = (byKey[k] ??= { n: 0, won: 0, claimed: 0 });
    o.n += 1; o.won += x.y[k] ? 1 : 0; o.claimed += x.a.pick.pLow;
  }
  const n = bets.length, won = bets.filter((x) => x.y[x.a.pick.key]).length, claimed = n ? bets.reduce((t, x) => t + x.a.pick.pLow, 0) / n : null;
  return { n, won, rate: n ? won / n : null, claimed, gap: n ? won / n - claimed : null, enough: n >= MIN_BETS_FOR_CLAIM, byKey: Object.fromEntries(Object.entries(byKey).map(([k, o]) => [k, { n: o.n, rate: o.won / o.n, claimed: o.claimed / o.n }])) };
}

export function compare(rows, variants = VARIANTS, opts = { n: 8 }) {
  const out = {};
  for (const [name, ov] of Object.entries(variants)) {
    const preds = withModel(ov, () => predict(rows, opts));
    out[name] = { matches: preds.filter((x) => x.split === "test").length, val: summarizeBets(preds, "val"), test: summarizeBets(preds, "test") };
  }
  return out;
}

const pc = (v) => (v == null ? "—" : `${(v * 100).toFixed(1).replace(".", ",")}%`);
export function report(res) {
  const L = ["| Regola | BET test | Centrati | Dichiarato | Scarto | Esiti (n) | BET validazione |", "|---|---|---|---|---|---|---|"];
  for (const [name, r] of Object.entries(res)) {
    const keys = Object.entries(r.test.byKey).sort((a, b) => b[1].n - a[1].n).map(([k, o]) => `${k} ${o.n}`).join(", ") || "—";
    L.push(`| ${name} | ${r.test.n}${r.test.enough ? "" : " ⚠"} | ${pc(r.test.rate)} | ${pc(r.test.claimed)} | ${r.test.gap == null ? "—" : `${r.test.gap >= 0 ? "+" : ""}${(r.test.gap * 100).toFixed(1).replace(".", ",")} pt`} | ${keys} | ${r.val.n} |`);
  }
  L.push("", `⚠ = meno di ${MIN_BETS_FOR_CLAIM} BET di test: nessuna conclusione dimostrata. «Scarto» = percentuale centrata meno quella dichiarata (prudente): positivo o vicino a zero = regola onesta; molto negativo = regola che promette troppo.`);
  return L.join("\n");
}

function main() {
  const args = process.argv.slice(2), get = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const file = get("--file");
  if (!file) { console.error("Uso: node scripts/backtest-rules.js --file finals.json [--n 8]"); process.exit(1); }
  const rows = normalize(parseRows(fs.readFileSync(file, "utf8"), file));
  console.log(`## Confronto regole BET senza quota · ${rows.length} partite finali (${rows[0]?.kickoff_at?.slice(0, 10)} → ${rows.at(-1)?.kickoff_at?.slice(0, 10)})\n`);
  const text = report(compare(rows, VARIANTS, { n: Number(get("--n")) || 8 }));
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Confronto regole BET\n\n${text}\n`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
