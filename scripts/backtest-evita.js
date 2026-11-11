#!/usr/bin/env node
/**
 * Analisi di AFFIDABILITÀ TOTALE: BET ed EVITA, non solo i BET.
 *   node scripts/backtest-evita.js --file finals.json [--n 8] [--warmup 0.3]
 *
 * Domande a cui risponde, sempre su replay cronologico (il modello vede solo il passato):
 *  1. Gli EVITA sono davvero da evitare? Ogni EVITA è classificato per MOTIVO (probabilità prudente sotto soglia / niente di speciale sul
 *     campionato / campione piccolo) e si misura quanto sarebbe uscito: se uscirebbe quanto la media, non c'era convenienza; se uscirebbe
 *     più dei BET, la regola è troppo severa.
 *  2. Le percentuali dichiarate sono oneste su TUTTE le selezioni (14 esiti x ogni partita), non solo sulla scelta: taratura, Brier,
 *     rispetto alla semplice media del campionato (Brier skill), copertura della soglia prudente.
 *  3. Con quale fiducia (campione, incertezza) il modello si merita fiducia?
 *  4. Quale combinazione di soglie (probabilità prudente x vantaggio sulla media) sarebbe la più onesta: scelta sulla VALIDAZIONE, giudicata sul TEST.
 *
 * LIMITE (dichiarato nel report): nel passato non ci sono le quote. La «convenienza» è quindi misurata con un PROXY: vantaggio sulla media del
 * campionato e rendimento teorico se il mercato quotasse la media con il margine del bookmaker. Il valore vero si vede solo sul registro
 * `bet_predictions` (quote reali). Con meno di MIN_BETS_FOR_CLAIM selezioni nessuna conclusione è dimostrata.
 */
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { MODEL, SELECTIONS, verdictFor } from "../functions/api/model.js";
import { normalize, parseRows, predict, withModel } from "./backtest.js";
import { MIN_BETS_FOR_CLAIM, brier, calibration } from "./metrics.js";
import { wilson } from "../src/efficiency.js";

const mean = (a) => (a.length ? a.reduce((t, v) => t + v, 0) / a.length : null);
const pc = (v, d = 1) => (v == null || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(d).replace(".", ",")}%`);
const pt = (v) => (v == null || !Number.isFinite(v) ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1).replace(".", ",")} pt`);
const table = (head, rows) => [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`)].join("\n");
const flag = (n) => (n >= MIN_BETS_FOR_CLAIM ? "" : " ⚠");

/** Motivo per cui una selezione è EVITA (stessa logica di verdictFor senza quote né provider, quella del passato). */
export function evitaReason(sel, sample) {
  if (sample < MODEL.betSample) return "campione";
  if (sel.pLow < MODEL.betThreshold) return "soglia";
  return "edge";
}
export const REASON_LABEL = { soglia: "Probabilità prudente sotto la soglia", edge: "Probabile ma in linea con la media del campionato", campione: "Campione troppo piccolo", bet: "BET" };

/** Scelta principale di una partita con parametri diversi: stessa classifica di analyzeMatch senza quote (BET, poi vantaggio, poi probabilità prudente). */
export function pickFor(a, overrides = {}) {
  return withModel({ requireRealOdds: false, ...overrides }, () => {
    const cand = a.selections.filter((s) => s.p <= MODEL.maxUsefulProb).map((s) => ({ s, v: verdictFor(s, a.sample).verdict }));
    cand.sort((x, y) => (y.v === "BET") - (x.v === "BET") || (y.s.edge ?? -1) - (x.s.edge ?? -1) || y.s.pLow - x.s.pLow);
    const top = cand[0];
    return top ? { sel: top.s, verdict: top.v, reason: top.v === "BET" ? "bet" : evitaReason(top.s, a.sample) } : null;
  });
}

/** Sintesi di un gruppo di scelte { sel, y }: reale, intervallo, dichiarato, soglia prudente, media del campionato, vantaggio e rendimento teorico. */
export function summarize(items) {
  const n = items.length, won = items.filter((x) => x.y[x.sel.key]).length;
  const rate = n ? won / n : null, claimed = mean(items.map((x) => x.sel.p)), floor = mean(items.map((x) => x.sel.pLow));
  const baseItems = items.filter((x) => x.sel.base != null), base = mean(baseItems.map((x) => x.sel.base));
  // Rendimento teorico: il mercato quota la media del campionato col margine del bookmaker (quota = 1 / (base x (1 + margine))).
  const proxy = baseItems.length ? mean(baseItems.map((x) => (x.y[x.sel.key] ? 1 / (x.sel.base * (1 + MODEL.bookMargin)) : 0) - 1)) : null;
  return { n, won, rate, ci: wilson(won, n), claimed, floor, base, lift: rate != null && base != null ? rate - base : null, gap: rate != null ? rate - claimed : null, proxyRoi: proxy };
}

/** Sezione 1-2: tutte le scelte principali del replay divise in BET ed EVITA per motivo. */
export function pickBreakdown(preds) {
  const groups = { bet: [], soglia: [], edge: [], campione: [] };
  for (const x of preds) {
    if (x.a.confidence === "insufficiente") continue;
    const p = pickFor(x.a);
    if (p) groups[p.reason].push({ sel: p.sel, y: x.y, league: x.league, day: x.day });
  }
  return groups;
}

/** Verdetto in italiano su un gruppo EVITA, con prudenza sui campioni piccoli. */
export function judgeEvita(reason, s, betRate) {
  if (!s.n) return "nessun caso";
  const small = s.n < 100;
  if (reason === "campione") return "il modello non è affidabile: evitare è giusto per definizione";
  if (reason === "soglia") {
    if (s.rate >= MODEL.betThreshold + 0.03 && !small) return "TROPPO SEVERO: sarebbero usciti più del necessario, soglia da abbassare";
    return small ? "campione piccolo: nessuna conclusione, ma nulla suggerisce di abbassare la soglia" : "evitare è giusto: escono meno di quanto richiede un BET";
  }
  if (s.lift != null && s.lift < 0.03) return small ? "vantaggio sulla media ≈ 0 (campione piccolo): evitare sembra giusto" : "nessun vantaggio sulla media del campionato: evitare è giusto";
  if (s.lift != null && betRate != null && s.rate >= betRate - 0.02 && !small) return "RISCHIO DI PERDERE VALORE: escono quanto i BET, la regola sul vantaggio è troppo severa";
  return small ? "campione piccolo: nessuna conclusione" : "vantaggio sulla media presente ma inferiore ai BET: zona grigia";
}

/** Taratura su TUTTE le selezioni (14 esiti per partita): per esito e globale. */
export function globalCalibration(preds) {
  const P = preds.filter((x) => x.a.confidence !== "insufficiente");
  const per = SELECTIONS.map((s) => {
    const rows = P.map((x) => ({ sel: x.a.selections.find((q) => q.key === s.key), y: x.y[s.key] }));
    const ps = rows.map((r) => r.sel.p), lows = rows.map((r) => r.sel.pLow), ys = rows.map((r) => r.y);
    const withBase = rows.filter((r) => r.sel.base != null);
    const bBase = withBase.length ? brier(withBase.map((r) => r.sel.base), withBase.map((r) => r.y)) : null;
    const bMod = withBase.length ? brier(withBase.map((r) => r.sel.p), withBase.map((r) => r.y)) : null;
    const rate = mean(ys), claimed = mean(ps);
    return {
      key: s.key, label: s.label, n: rows.length, rate, claimed, gap: rate - claimed, brier: brier(ps, ys), ece: calibration(ps, ys).ece,
      skill: bBase && bMod != null ? 1 - bMod / bBase : null,                         // > 0: meglio della semplice media del campionato
      floor: mean(lows), aboveFloor: rate - mean(lows),   // il reale deve stare SOPRA la soglia prudente media: sotto = la prudenza non basta
    };
  });
  const all = P.flatMap((x) => x.a.selections.map((s) => ({ p: s.p, pLow: s.pLow, y: x.y[s.key] })));
  const cal = calibration(all.map((v) => v.p), all.map((v) => v.y));
  const calLow = calibration(all.map((v) => v.pLow), all.map((v) => v.y));
  return { per, total: { n: all.length, ece: cal.ece, brier: brier(all.map((v) => v.p), all.map((v) => v.y)), table: cal.table, eceLow: calLow.ece, tableLow: calLow.table } };
}

/** Affidabilità per livello di fiducia: campione (partite osservate) e incertezza del modello (sd media sui gol attesi). */
export function byConfidence(preds) {
  const items = preds.filter((x) => x.a.confidence !== "insufficiente").map((x) => ({ x, p: pickFor(x.a) })).filter((o) => o.p);
  const out = [];
  const add = (label, list) => { if (list.length) out.push({ label, ...summarize(list.map((o) => ({ sel: o.p.sel, y: o.x.y }))), bets: list.filter((o) => o.p.verdict === "BET").length }); };
  for (const c of ["bassa", "media", "buona"]) add(`campione ${c}`, items.filter((o) => o.x.a.confidence === c));
  const sd = items.map((o) => (o.x.a.inputs.sd.home + o.x.a.inputs.sd.away) / 2).sort((a, b) => a - b);
  if (sd.length >= 30) {
    const q1 = sd[Math.floor(sd.length / 3)], q2 = sd[Math.floor((2 * sd.length) / 3)], u = (o) => (o.x.a.inputs.sd.home + o.x.a.inputs.sd.away) / 2;
    add("incertezza bassa", items.filter((o) => u(o) <= q1)); add("incertezza media", items.filter((o) => u(o) > q1 && u(o) <= q2)); add("incertezza alta", items.filter((o) => u(o) > q2));
  }
  return out;
}

export const SWEEP = { betThreshold: [0.55, 0.6, 0.65, 0.7], minEdge: [0.03, 0.05, 0.08, 0.1] };
/** Griglia soglie: per ogni combinazione, BET ed EVITA su validazione e test. La scelta si fa sulla validazione, il test giudica. */
export function sweep(preds) {
  const P = preds.filter((x) => x.a.confidence !== "insufficiente"), out = [];
  for (const betThreshold of SWEEP.betThreshold) for (const minEdge of SWEEP.minEdge) {
    const cell = { betThreshold, minEdge };
    for (const split of ["val", "test"]) {
      const bets = [], skips = [];
      for (const x of P.filter((q) => q.split === split)) { const p = pickFor(x.a, { betThreshold, minEdge }); if (p) (p.verdict === "BET" ? bets : skips).push({ sel: p.sel, y: x.y }); }
      cell[split] = { bet: summarize(bets), skip: summarize(skips) };
    }
    out.push(cell);
  }
  return out;
}

/** Combinazione consigliata: tra quelle oneste sulla validazione (scarto >= -2 pt, almeno 30 BET) quella con più BET; poi il test dice se regge. */
export function bestCombo(cells) {
  const ok = cells.filter((c) => c.val.bet.n >= 30 && c.val.bet.gap >= -0.02);
  return ok.sort((a, b) => b.val.bet.n - a.val.bet.n || b.val.bet.rate - a.val.bet.rate)[0] ?? null;
}

export function buildReport(rows, preds) {
  const L = ["# Affidabilità totale · BET ed EVITA", "",
    `${rows.length} partite finali (${rows[0]?.kickoff_at?.slice(0, 10)} → ${rows.at(-1)?.kickoff_at?.slice(0, 10)}). Analizzate ${preds.length} dopo il rodaggio.`,
    "Senza quote nel passato: la convenienza è un **proxy** (vantaggio sulla media del campionato), non un rendimento reale.", ""];
  if (!preds.length) return [...L, "Nessuna partita analizzabile: servono più dati dopo il rodaggio."].join("\n");

  const g = pickBreakdown(preds), tot = Object.values(g).flat().length, bet = summarize(g.bet);
  const rowFor = (label, s, verdict) => [label, `${s.n}${flag(s.n)}`, pc(s.rate), s.ci ? `${pc(s.ci.lo, 0)}–${pc(s.ci.hi, 0)}` : "—", pc(s.claimed), pc(s.base), pt(s.lift), verdict];
  L.push(`## 1. Scelta principale: BET contro EVITA (${tot} partite)`, table(["Gruppo", "n", "Reale", "Int. 95%", "Dichiarato", "Media camp.", "Vantaggio", "Verdetto"], [
    rowFor("BET", bet, bet.n ? (bet.gap >= -0.03 ? "onesto" : "SOVRASTIMA") : "—"),
    ...["soglia", "edge", "campione"].map((k) => rowFor(`EVITA · ${REASON_LABEL[k]}`, summarize(g[k]), judgeEvita(k, summarize(g[k]), bet.rate))),
  ]), "");
  const ev = [...g.soglia, ...g.edge, ...g.campione], evS = summarize(ev);
  if (bet.n && evS.n) L.push(`Differenza BET − EVITA: **${pt(bet.rate - evS.rate)}** (${bet.rate - evS.rate >= 0.03 ? "la selezione aggiunge valore" : "la selezione NON separa i buoni dai cattivi"}). Rendimento teorico a quota di mercato = media campionato + margine: BET ${pc(bet.proxyRoi)}, EVITA ${pc(evS.proxyRoi)}.`, "");

  const gc = globalCalibration(preds);
  L.push("## 2. Taratura di tutte le selezioni (ogni esito di ogni partita)", `Globale: ${gc.total.n} selezioni · ECE ${gc.total.ece.toFixed(3)} · Brier ${gc.total.brier.toFixed(3)} · ECE soglia prudente ${gc.total.eceLow.toFixed(3)}`, "",
    table(["Esito", "n", "Reale", "Dichiarato", "Scarto", "Brier skill", "Soglia prudente", "Reale − soglia"], gc.per.map((r) => [r.label, String(r.n), pc(r.rate), pc(r.claimed), pt(r.gap), r.skill == null ? "—" : pt(r.skill), pc(r.floor), pt(r.aboveFloor)])), "",
    "_Brier skill > 0 = meglio della semplice media del campionato; ≤ 0 = il modello non aggiunge nulla su quell'esito. «Reale − soglia» deve essere positivo: la soglia prudente è pensata per essere superata dalla percentuale reale; se è negativo, su quell'esito la prudenza non basta._", "",
    "### Curva di affidabilità (probabilità centrale)", table(["Fascia", "n", "Dichiarato", "Reale"], gc.total.table.filter((b) => b.n).map((b) => [`${pc(b.lo, 0)}–${pc(b.hi, 0)}`, String(b.n), pc(b.predicted), pc(b.observed)])), "");

  const bc = byConfidence(preds);
  L.push("## 3. Affidabilità per livello di fiducia", table(["Livello", "Partite", "BET", "Reale", "Dichiarato", "Scarto"], bc.map((r) => [r.label, `${r.n}${flag(r.n)}`, String(r.bets), pc(r.rate), pc(r.claimed), pt(r.gap)])), "");

  const cells = sweep(preds), best = bestCombo(cells), cur = cells.find((c) => c.betThreshold === MODEL.betThreshold && c.minEdge === MODEL.minEdge);
  const sw = (c) => [`${pc(c.betThreshold, 0)} / ${(c.minEdge * 100).toFixed(0)} pt${c === cur ? " (attuale)" : ""}${c === best ? " ★" : ""}`, `${c.val.bet.n}`, pt(c.val.bet.gap), `${c.test.bet.n}${flag(c.test.bet.n)}`, pc(c.test.bet.rate), pt(c.test.bet.gap), pc(c.test.skip.rate)];
  L.push("## 4. Taratura delle soglie (scelta sulla validazione, giudizio sul test)", table(["Soglia prob. / vantaggio", "BET val", "Scarto val", "BET test", "Reale test", "Scarto test", "EVITA reale test"], cells.map(sw)), "",
    best ? `★ Più onesta sulla validazione con più BET: soglia ${pc(best.betThreshold, 0)} e vantaggio ${(best.minEdge * 100).toFixed(0)} pt → sul test ${best.test.bet.n} BET, scarto ${pt(best.test.bet.gap)}${best.test.bet.n < MIN_BETS_FOR_CLAIM ? " (campione sotto soglia: nessuna conclusione dimostrata)" : ""}.` : "Nessuna combinazione onesta sulla validazione con almeno 30 BET.", "",
    `⚠ = meno di ${MIN_BETS_FOR_CLAIM} casi: nessuna conclusione dimostrata. Una modifica alle soglie va applicata solo se resta onesta anche sul test e con campione adeguato.`);
  return L.join("\n");
}

function main() {
  const args = process.argv.slice(2), get = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : null; };
  const file = get("--file");
  if (!file) { console.error("Uso: node scripts/backtest-evita.js --file finals.json [--n 8] [--warmup 0.3]"); process.exit(1); }
  const rows = normalize(parseRows(fs.readFileSync(file, "utf8"), file));
  const warm = Math.min(0.7, Math.max(0.1, Number(get("--warmup")) || 0.3)), rest = 1 - warm;
  const text = buildReport(rows, predict(rows, { n: Number(get("--n")) || 8, trainFrac: warm, valFrac: rest / 2 }));
  console.log(text);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
