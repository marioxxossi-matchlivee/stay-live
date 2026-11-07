/**
 * Backtest dei BET sulle partite già giocate: «quanti BET avrebbe centrato l'app, e le percentuali dichiarate erano oneste?»
 *   node scripts/backtest-bets.js --file finals.json|csv [--n 8] [--warmup 0.3]   (stampa un report in Markdown)
 *
 * Replay cronologico: per ogni partita dopo il periodo di rodaggio (`warmup` = prima quota di partite) il modello vede SOLO partite con
 * calcio d'inizio precedente al giorno della partita. Si valuta il consiglio principale (BET / EVITA) confrontandolo col punteggio finale.
 * LIMITE: nel passato non ci sono il pronostico di API-Football né le quote, quindi si misura SOLO la componente statistica (storico),
 * senza rendimento in euro. Il registro `bet_predictions` misura invece i BET veri, con tutte le fonti.
 */
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { normalize, parseRows, predict } from "./backtest.js";
import { calibrationBuckets, efficiencyFromLegs, marketOf } from "../src/efficiency.js";

/** BET e EVITA (controllo) dai pronostici del replay: { key, status, p, pLow, league, day }. */
export function splitPicks(preds) {
  const bets = [], skips = [];
  for (const x of preds) {
    const s = x.a.pick;
    if (!s || x.a.confidence === "insufficiente") continue;
    (s.verdict === "BET" ? bets : skips).push({ key: s.key, status: x.y[s.key] ? "won" : "lost", p: s.p, pLow: s.pLow, odds: null, league: x.league, day: x.day });
  }
  return { bets, skips };
}

const pc = (x, d = 1) => (x == null ? "—" : `${(x * 100).toFixed(d).replace(".", ",")}%`);
const table = (head, rows) => [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");
const line = (r, min = 1) => (r.n >= min ? [r.label, `${r.won}/${r.n}`, pc(r.rate), r.ci ? `${pc(r.ci.lo, 0)}–${pc(r.ci.hi, 0)}` : "—", pc(r.expected)] : null);

export function buildReport(rows, preds) {
  const { bets, skips } = splitPicks(preds);
  const E = efficiencyFromLegs(bets), S = efficiencyFromLegs(skips).total, t = E.total;
  const L = [`# Backtest storico dei BET`, "",
    `${rows.length} partite finali (${rows[0]?.kickoff_at?.slice(0, 10)} → ${rows.at(-1)?.kickoff_at?.slice(0, 10)}). Analizzate ${preds.length}: **${bets.length} BET**, ${skips.length} EVITA.`,
    `Solo componente statistica (nessun dato API-Football né quote nel passato): niente rendimento in euro.`, ""];
  if (!t.n) return [...L, "Nessun BET nel periodo: troppo poche partite per il rodaggio del modello."].join("\n");
  const gap = t.rate - t.expected;
  L.push("## Risultato complessivo",
    `- BET centrati: **${t.won} su ${t.n} = ${pc(t.rate)}** (intervallo al 95%: ${pc(t.ci.lo, 0)}–${pc(t.ci.hi, 0)})`,
    `- Probabilità dichiarata dal modello (media): **${pc(t.expected)}** · soglia prudente media: ${pc(t.floor)}`,
    `- Scarto reale − dichiarato: **${gap >= 0 ? "+" : ""}${(gap * 100).toFixed(1).replace(".", ",")} punti** → ${Math.abs(gap) <= 0.03 ? "ben tarato" : gap < 0 ? "SOVRASTIMA: il modello promette più di quanto mantiene" : "prudente: mantiene più di quanto promette"}`,
    `- Controllo, consigli EVITA: ${S.n ? `${S.won}/${S.n} = ${pc(S.rate)} (dichiarato ${pc(S.expected)})` : "—"}${S.n && t.rate - S.rate < 0.03 ? " → i BET non fanno meglio degli EVITA: la selezione non aggiunge valore" : ""}`, "");
  L.push("## Taratura (dichiarato contro reale)", table(["Fascia di probabilità", "Vinti", "Reale", "Dichiarato"], calibrationBuckets(bets).map((b) => [`${pc(b.lo, 0)}–${pc(b.hi, 0)}`, `${b.won}/${b.n}`, pc(b.rate), pc(b.expected)])), "");
  const head = ["", "Vinti", "Reale", "Int. 95%", "Dichiarato"];
  L.push("## Per mercato", table(head, E.byMarket.map((r) => line(r)).filter(Boolean)), "", "## Per tipo di pronostico", table(head, E.byKey.map((r) => line(r)).filter(Boolean)), "");
  const leagues = bets.reduce((m, b) => ((m[b.league] ??= []).push(b), m), {});
  const byLeague = Object.entries(leagues).map(([lg, ls]) => ({ label: lg, ...efficiencyFromLegs(ls).total })).sort((a, b) => b.n - a.n);
  L.push("## Per campionato (almeno 20 BET)", table(head, byLeague.map((r) => line(r, 20)).filter(Boolean)), "");
  const third = Math.ceil(bets.length / 3);
  const parts = [0, 1, 2].map((i) => bets.slice(i * third, (i + 1) * third)).filter((p) => p.length);
  L.push("## Stabilità nel tempo (il tasso si regge in tutti i periodi?)", table(["Periodo", "BET", "Reale", "Dichiarato"], parts.map((p) => { const b = efficiencyFromLegs(p).total; return [`${p[0].day} → ${p.at(-1).day}`, String(b.n), pc(b.rate), pc(b.expected)]; })), "",
    "_Lettura:_ con meno di ~100 BET per riga le differenze sono rumore; guarda l'intervallo. Una fascia ben tarata ha «reale» vicino a «dichiarato».");
  return L.join("\n");
}

async function main() {
  const args = process.argv.slice(2), get = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const file = get("--file");
  if (!file) { console.error("Uso: node scripts/backtest-bets.js --file finals.json|csv [--n 8] [--warmup 0.3]"); process.exit(1); }
  const rows = normalize(parseRows(fs.readFileSync(file, "utf8"), file));
  const warm = Math.min(0.8, Math.max(0.1, Number(get("--warmup")) || 0.3));
  console.log(buildReport(rows, predict(rows, { n: Number(get("--n")) || 8, trainFrac: warm, valFrac: 1 - warm })));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
