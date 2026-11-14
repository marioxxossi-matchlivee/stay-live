import test from "node:test";
import assert from "node:assert/strict";
import { MARKET_GROUPS, MODEL, SELECTIONS, analyzeMatch, buildContext, marketsOf, rulesOf } from "../functions/api/model.js";
import { cornerView, marketsHtml, motivationOf, reliabilityOf, statusOf, whyNot } from "../src/markets.js";

let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const pois = (l) => { let k = 0, p = 1; const L = Math.exp(-l); do { k += 1; p *= rnd(); } while (p > L); return k - 1; };
const finals = [];
for (let d = 0; d < 60; d += 1) for (let g = 0; g < 6; g += 1) {
  const a = (d + g) % 12, b = (a + 1 + ((d * 5 + g * 3) % 11)) % 12;
  finals.push({ league: "seriea", kickoff_at: new Date(Date.parse("2026-01-10T18:00:00Z") + d * 86400e3 + g * 3600e3).toISOString(), home_id: `t${a}`, away_id: `t${b}`, home_name: `Squadra ${a}`, away_name: `Squadra ${b}`, home_score: pois(1.6), away_score: pois(1.2), status: "final" });
}
const ctx = buildContext(finals);
const match = { game_id: "x1", league: "seriea", kickoff_at: "2026-06-01T18:00:00Z", home_id: "t1", away_id: "t2", home_name: "Squadra 1", away_name: "Squadra 2", status: "scheduled" };
const analysis = analyzeMatch(match, ctx, { n: 8 });
const mk = marketsOf(analysis);
const item = { id: "x1", home: "Squadra 1", away: "Squadra 2", pick: { key: analysis.pick?.key, confidence: analysis.confidence, sample: analysis.sample }, mk, corner: null, cornerModel: null };

test("motore: Over 0,5 è un mercato coerente (sempre ≥ Over 1,5 ≥ Over 2,5 ≥ Over 3,5)", () => {
  assert.ok(SELECTIONS.some((s) => s.key === "over05"));
  const p = (k) => analysis.selections.find((s) => s.key === k).p;
  assert.ok(p("over05") >= p("over15") && p("over15") >= p("over25") && p("over25") >= p("over35"));
  assert.ok(Math.abs(p("home") + p("draw") + p("away") - 1) < 0.01, "1X2 somma 1");
  assert.ok(Math.abs(p("over25") + p("under25") - 1) < 0.01 && Math.abs(p("btts") + p("nobtts") - 1) < 0.01);
});
test("mercati compatti: stesse probabilità del motore, un esito più pronosticato per gruppo", () => {
  assert.ok(mk);
  for (const s of analysis.selections) assert.equal(mk.x[s.key].p, s.p);
  assert.equal(mk.b.esito, ["home", "draw", "away"].sort((a, b) => mk.x[b].p - mk.x[a].p)[0]);
  for (const g of Object.keys(MARKET_GROUPS)) assert.ok(MARKET_GROUPS[g].includes(mk.b[g]));
  assert.deepEqual(mk.rec, analysis.recommended);
  assert.equal(marketsOf({ ...analysis, confidence: "insufficiente" }), null, "campione insufficiente: mercati non valutabili");
  assert.ok(Object.keys(rulesOf()).includes("maxUseful") && rulesOf().thr === MODEL.betThreshold);
});
test("Solo BET è un filtro di Tutte: un mercato è BET solo se lo dice il motore", () => {
  for (const [k, x] of Object.entries(mk.x)) assert.equal(statusOf(x, 0.6) === "bet", analysis.selections.find((s) => s.key === k).verdict === "BET");
  assert.equal(statusOf({ p: 0.7, l: 0.6, g: 0, v: 0, o: null }, 0.6), "interesting");
  assert.equal(statusOf({ p: 0.7, l: 0.6, g: -1, v: 0, o: null }, 0.6), "analysed", "contraddetto da API-Football");
  assert.equal(statusOf({ p: 0.95, l: 0.9, g: 0, v: 0, o: null }, 0.6), "analysed", "troppo scontato senza quota");
});
test("scheda Tutte: 1X2, Gol, Over/Under e Corner (non disponibile se mancano i dati)", () => {
  const h = marketsHtml(item, { mode: "all", thr: 0.6 });
  for (const t of ["1X2", "Gol", "Over/Under", "Corner", "Mercati e motivazioni"]) assert.match(h, new RegExp(t));
  assert.match(h, /non disponibile|nessuna quota|dati non ancora/);
  assert.doesNotMatch(h, /NaN|undefined|null/);
  assert.equal((h.match(/data-g="esito"/g) ?? []).length, 1, "nessuna riga duplicata");
});
test("corner: modello Stay Live e quote dei bookmaker, mai BET", () => {
  const cornerModel = { ok: true, lambda: { home: 5.1, away: 4.2, total: 9.3 }, mainLine: 9.5, lines: [8.5, 9.5, 10.5].map((l, i) => ({ line: l, over: [0.62, 0.48, 0.33][i], under: [0.38, 0.52, 0.67][i] })), sample: { home: 12, away: 11 } };
  const cv = cornerView({ ...item, cornerModel }, 0.6);
  assert.equal(cv.state, "model"); assert.equal(cv.reliability, "bassa"); assert.notEqual(cv.status, "bet");
  const mc = cornerView({ ...item, cornerModel, corner: { best: { side: "over", line: 9.5, p: 0.72, odd: 1.8 } } }, 0.6);
  assert.equal(mc.state, "market"); assert.equal(mc.status, "interesting");
  const h = marketsHtml({ ...item, cornerModel }, { mode: "all", thr: 0.6 });
  assert.match(h, /non ancora tarato/); assert.doesNotMatch(h, /mk-tag bet[^]*Corner/);
});
test("motivazioni: specifiche della partita, dai dati reali, mai identiche per tutte", () => {
  const key = mk.b.ou, t = motivationOf(item, key);
  assert.match(t, /Squadra 1/); assert.match(t, /gol attesi/);
  const other = motivationOf({ ...item, home: "Altra A", away: "Altra B", mk: { ...mk, st: { ...mk.st, lh: 0.7, la: 2.4, tot: 3.1 } } }, key);
  assert.notEqual(t, other);
  assert.equal(motivationOf({ ...item, mk: { ...mk, st: null } }, key), "", "senza dati nessuna motivazione inventata");
  assert.match(whyNot("over25", { p: 0.55, l: 0.5, c: "T", v: 0, o: null }, mk), /soglia/);
  assert.match(whyNot("over05", { p: 0.93, l: 0.9, c: "M", v: 0, o: null }, mk), /troppo probabile/);
  assert.equal(whyNot("x", { v: 1 }, mk), "BET: supera le regole del motore");
});
test("affidabilità: campione, accordo tra le fonti e incertezza", () => {
  assert.equal(reliabilityOf({ p: 0.7, l: 0.66, g: 1, sp: 0.02 }, { c: "buona" }), "alta");
  assert.equal(reliabilityOf({ p: 0.7, l: 0.5, g: -1, sp: 0.2 }, { c: "bassa" }), "bassa");
  assert.equal(reliabilityOf({ p: 0.7, l: 0.64, g: 0, sp: 0.03 }, { c: "media" }), "media");
});
test("Solo BET: mostra solo i mercati BET della stessa analisi, con motivazione", () => {
  const bet = { ...mk, x: { ...mk.x, over25: { ...mk.x.over25, v: 1, c: "B", l: 0.64, p: 0.7 } }, rec: ["over25"] };
  const h = marketsHtml({ ...item, mk: bet }, { mode: "bet", thr: 0.6 });
  assert.match(h, /data-g="rec"/); assert.match(h, /Over 2,5/); assert.match(h, /Perché/); assert.doesNotMatch(h, /data-g="esito"/);
});

test("elenco non ancora rigenerato: il consiglio principale (es. X2) resta visibile con le sue cifre", () => {
  const pick = { key: "dcx2", label: "X2 · Pareggio o trasferta", p: 0.72, pLow: 0.63, verdict: "BET", confidence: "media", reason: "Probabilità prudente 63% (+11 punti sulla media del campionato).", odds: null };
  const h = marketsHtml({ id: "a", home: "A", away: "B", pick, mk: null, corner: null, cornerModel: null }, { mode: "all", thr: 0.6 });
  assert.match(h, /X2/); assert.match(h, /72%/); assert.match(h, /prudente 63%/); assert.match(h, /mk-tag bet/); assert.match(h, /dopo il prossimo aggiornamento/);
  assert.match(marketsHtml({ id: "a", home: "A", away: "B", pick, mk: null }, { mode: "bet" }), /Perché[^]*Probabilità prudente 63%/);
  assert.match(marketsHtml({ id: "a", home: "A", away: "B", pick: { ...pick, confidence: "insufficiente", sample: 2 }, mk: null }, { mode: "all" }), /Pochi dati/);
});
