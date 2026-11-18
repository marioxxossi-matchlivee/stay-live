// Stay Live Tennis — report del filtro ITF «8 punti» (shadow mode). SOLA LETTURA su Supabase: nessuna chiamata al provider (zero crediti API),
// nessuna scrittura, nessuna modifica ai BET. Uso:  SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/tennis-itf-shadow-report.js [percorso-output.md]
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { makeDb } from "./tennis-sync.js";
import { simulateItfShadow, rowFromPrediction, ITF_SHADOW } from "../functions/api/_tennis-itf-shadow.js";

const pc = (x, d = 1) => (x == null ? "—" : `${(x * 100).toFixed(d).replace(".", ",")}%`);
const n3 = (x) => (x == null ? "—" : String(x).replace(".", ","));
const blockRow = (label, b) => `| ${label} | ${b.bets} | ${b.wins}/${b.losses} | ${pc(b.hitRate)} | ${pc(b.roi)} ${b.roiCi95 ? `[${pc(b.roiCi95[0], 0)} ; ${pc(b.roiCi95[1], 0)}]` : ""} | ${n3(b.profit)} | ${n3(b.avgOdds)} | ${n3(b.brier)} |`;

/** Markdown del confronto A/B a partire dal risultato di simulateItfShadow. Pura: testabile senza database. */
export function renderReport(sim, { title = "Confronto A/B", note = "" } = {}) {
  const hdr = "| Gruppo | BET | V/P | Successo | ROI [IC 95%] | Profitto (u.) | Quota media | Brier |\n|---|---|---|---|---|---|---|---|";
  const g = sim.itfReliabilityByGap, bk = (l, b) => `| ${l} | ${b.n} | ${pc(b.hitRate)} | ${n3(b.brier)} |`;
  return `## ${title}\n${note ? `\n${note}\n` : ""}
Regola: ITF con (probabilità modello − probabilità mercato senza margine) **> ${sim.rule.thresholdPp} punti percentuali** → esclusa (8 esatto = mantenuta). Puntata unitaria; ROI = profitto / puntate.

Partite in archivio: ${sim.totals.rows} (pubblicate ${sim.totals.published}; ITF ${sim.totals.itfRows}; ITF con quote confrontabili e concluse ${sim.totals.itfWithComparableOdds}). Scartate dal confronto perché la quota risultava letta dopo l'inizio: ${sim.rejectedAfterStart}. BET non conteggiati: ritirate/annullate ${sim.voided}, in attesa ${sim.pending}.

${hdr}
${blockRow("A · strategia attuale (tutti i BET)", sim.A)}
${blockRow("B · con filtro ITF 8 punti", sim.B)}
${blockRow("ITF escluse dal filtro", sim.itf.excluded)}
${blockRow("ITF mantenute", sim.itf.kept)}

Differenza B − A: BET ${sim.delta.bets}, ROI ${sim.delta.roi == null ? "—" : `${(sim.delta.roi * 100).toFixed(2).replace(".", ",")} punti`}, profitto ${n3(sim.delta.profit)} u. Test escluse contro mantenute (z di Welch sul profitto medio): ${n3(sim.itf.zExcludedVsKept)}.

Affidabilità delle previsioni ITF per scarto (tutte le pubblicate con quote confrontabili, anche non-BET):

| Scarto modello − mercato | Casi | Successo | Brier |
|---|---|---|---|
${bk("≤ 0", g.le0)}
${bk("0 – 4 punti", g.p0_4)}
${bk("4 – 8 punti", g.p4_8)}
${bk("> 8 punti", g.gt8)}

**Valutazione:** ${sim.verdict}\n`;
}

export async function buildReport(db, now = Date.now()) {
  const sel = "match_key,starts_at,published,pick,p1,p2,odds_at,bet,tennis_matches(status,winner,category)";
  const preds = await db.getAll("tennis_predictions", { select: sel, starts_at: `lte.${new Date(now).toISOString()}`, order: "starts_at.desc" }, 1000, 40);
  const rows = preds.map(rowFromPrediction);
  let first = null;
  try { const sh = await db.getAll("tennis_itf_shadow", { select: "match_key,created_at", order: "created_at.asc" }, 1000, 1); first = sh[0]?.created_at ?? null; } catch { /* tabella non ancora creata */ }
  const all = simulateItfShadow(rows);
  const parts = [`# Filtro ITF 8 punti — report (${new Date(now).toISOString().slice(0, 16)}Z)\n`, renderReport(all, { title: "Storico completo (retroattivo)", note: "Solo pronostici e quote già registrati prima dell'inizio (versione congelata). Nessun dato ricostruito a posteriori." })];
  if (first) parts.push(renderReport(simulateItfShadow(rows.filter((r) => r.startsAt >= first)), { title: `Solo da quando lo shadow è attivo (dal ${first.slice(0, 10)})`, note: "Campione prospettico." }));
  else parts.push("## Shadow attivo\n\nNessuna riga in `tennis_itf_shadow`: shadow non ancora attivo (migrazione non eseguita o nessun giro di aggiornamento dopo l'attivazione).\n");
  return parts.join("\n");
}

async function main() {
  const need = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].filter((k) => !process.env[k]);
  if (need.length) { console.error(`Mancano: ${need.join(", ")}`); process.exit(1); }
  const md = await buildReport(makeDb(process.env));
  if (process.argv[2]) fs.writeFileSync(process.argv[2], md); else console.log(md);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
export { ITF_SHADOW };
