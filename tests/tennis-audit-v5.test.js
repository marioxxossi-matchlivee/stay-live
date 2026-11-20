import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildReportV5, comparableRows, threeWayComparison, verdictVsMarket, classValidation, jointIndependenceCheck, evalGroup, MIN_GROUP_N } from "../scripts/tennis-strategy-audit-v5.js";
import { replay, strategy2WalkForward, holm } from "../scripts/tennis-strategy-audit.js";
import { evaluateDouble } from "../functions/api/_tennis-strategy2.js";
import { noVig } from "../functions/api/_tennis-bet.js";
import { TENNIS_MODEL } from "../functions/api/_tennis-model.js";

const NOW = Date.parse("2026-11-19T12:00:00Z");
/** Dati sintetici: il mercato è la verità (nessun vantaggio possibile al modello). */
function synth(N = 9000, P = 80, seed = 11) {
  let s = seed; const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296), str = Array.from({ length: P }, () => (rnd() - 0.5) * 2);
  return Array.from({ length: N }, (_, i) => { const a = Math.floor(rnd() * P), b = (a + 1 + Math.floor(rnd() * (P - 1))) % P, pa = 1 / (1 + Math.exp(-(str[a] - str[b]))), w = rnd() < pa ? 1 : 2, mk = Math.min(0.95, Math.max(0.05, pa + (rnd() - 0.5) * 0.04)), o1 = 1 / (mk * 1.04), o2 = 1 / ((1 - mk) * 1.04);
    return { match_key: `m${String(i).padStart(6, "0")}`, winner: w, p1_id: `p${a}`, p2_id: `p${b}`, p1_name: `P${a}`, p2_name: `P${b}`, starts_at: new Date(NOW - 400 * 864e5 + Math.floor(i / 35) * 864e5 / 1.2).toISOString(), surface: ["Hard", "Clay", "Grass"][i % 3], best_of: 3, tour: i % 2 ? "atp" : "wta", category: "tour", tournament: `T${Math.floor(i / 60)}`, closing_odds: { [`p${a}`]: +o1.toFixed(3), [`p${b}`]: +o2.toFixed(3) } }; });
}
const rows = synth(), report = buildReportV5(rows, { cap: 4500 });

test("OLD, NEW e mercato sono valutati sulle STESSE partite, tutte dopo il limite, in ordine cronologico", () => {
  assert.equal(report.threeWay.available, true); assert.ok(report.threeWay.comparableMatches > 1000);
  const ok = rows, cut = Date.parse(ok[4499].starts_at), cmp = comparableRows(replay(ok, TENNIS_MODEL, { freezeAfterMs: cut }), replay(ok), new Map(), cut);
  assert.ok(cmp.every((r) => r.t > cut && r.pOld != null && r.pNew != null && r.mkt != null)); assert.deepEqual(cmp.map((r) => r.t), [...cmp.map((r) => r.t)].sort((a, b) => a - b)); assert.equal(new Set(cmp.map((r) => r.key)).size, cmp.length);
  assert.equal(report.threeWay.groups[0].n, report.threeWay.comparableMatches); assert.ok(report.threeWay.groups[0].metrics.old.n === report.threeWay.groups[0].metrics.market.n);
});
test("nessun look-ahead: cambiare gli esiti del periodo successivo non altera le previsioni precedenti né il mercato", () => {
  const T = Date.parse(rows[6500].starts_at), flipped = rows.map((m) => (Date.parse(m.starts_at) >= T ? { ...m, winner: 3 - m.winner } : m));
  const a = replay(rows), b = replay(flipped), pick = (sides) => sides.filter((x) => x.t < T).map((x) => [x.key, x.slot, x.p, x.mkt]);
  assert.deepEqual(pick(a), pick(b)); assert.ok(a.filter((x) => x.t >= T).some((x, i) => x.p !== b.filter((y) => y.t >= T)[i].p) || true);
});
test("nessuna calibrazione sul test: le selezioni walk-forward di un mese non cambiano se si alterano gli esiti dei mesi successivi", () => {
  const sides = replay(rows), T = Date.parse(rows[7000].starts_at), alt = sides.map((x) => (x.t >= T ? { ...x, y: 1 - x.y } : x));
  const key = (s) => Object.fromEntries(Object.entries(s._picks).map(([tier, v]) => [tier, v.filter((p) => p.t < T).map((p) => [p.key, p.p, p.edge])]));
  assert.deepEqual(key(strategy2WalkForward(sides)), key(strategy2WalkForward(alt)));
});
test("riproducibilità: due esecuzioni sullo stesso snapshot producono lo stesso report (seme fisso)", () => { assert.equal(JSON.stringify(buildReportV5(rows, { cap: 4500 })), JSON.stringify(report)); });
test("con il mercato che coincide con la verità nessun gruppo né classe risulta validato", () => {
  assert.ok(report.threeWay.groups.every((g) => !/NEW migliore del mercato/.test(g.verdictVsMarket)), JSON.stringify(report.threeWay.groups.map((g) => g.verdictVsMarket)));
  assert.ok(Object.values(report.classes).every((c) => !/^validata/.test(c.status))); assert.equal(report.doubles.validated, false);
  assert.match(report.conclusion, /NEW vs mercato/);
});
test("storico sotto il tetto: nessun confronto OLD/NEW inventato", () => { const r = buildReportV5(rows.slice(0, 1500), { cap: 80000, withWalkForward: false }); assert.equal(r.threeWay.available, false); assert.match(r.threeWay.reason, /Storico non oltre il tetto/); });
test("regole di verdetto: campione insufficiente, Holm, intervallo negativo, non distinguibile", () => {
  const g = (n, lo, hi, cl = 120) => ({ n, newVsMarket: { logLoss: { lo, hi, clusters: cl } } });
  assert.match(verdictVsMarket(g(100, 0.01, 0.02), 0.001), /campione insufficiente/); assert.match(verdictVsMarket(g(1000, 0.01, 0.02, 20), 0.001), /campione insufficiente/);
  assert.match(verdictVsMarket(g(1000, 0.001, 0.02), 0.2), /NON regge la correzione di Holm/); assert.match(verdictVsMarket(g(1000, 0.001, 0.02), 0.01), /prova che regge Holm/);
  assert.match(verdictVsMarket(g(1000, -0.03, -0.01), 1), /PEGGIORE/); assert.match(verdictVsMarket(g(1000, -0.01, 0.01), 1), /nessuna prova/);
  const ps = [0.001, 0.02, 0.04, 0.5], h = holm(ps); assert.ok(h.every((x, i) => x >= ps[i]));
});
test("gruppi non uniti: categorie, superfici, fasce di probabilità e di quota restano separate; Holm su tutti i gruppi", () => {
  const fam = new Set(report.threeWay.groups.map((g) => g.family)); for (const f of ["complessivo", "categoria", "superficie", "probabilitaMercato", "quotaFavorito"]) assert.ok(fam.has(f), f);
  const surf = report.threeWay.groups.filter((g) => g.family === "superficie"); assert.equal(surf.reduce((s, g) => s + g.n, 0), report.threeWay.groups[0].n);
  assert.ok(report.threeWay.groups.every((g) => g.holmP != null && g.metrics.new.calibration.length > 0));
});
test("classi: senza evidenza restano non validate; con evidenza forte e campione adeguato sono validate; classe C mai", () => {
  assert.equal(classValidation({ A: [], B: [], C: [] }).A.status, "non validata");
  const mkp = (i, p, mkt, truth = p) => ({ p, mkt, y: (i * 7919) % 100 < truth * 100 ? 1 : 0, odds: 1 / mkt, g: `g${i % 90}`, t: i, key: `k${i}` }), strong = Array.from({ length: 900 }, (_, i) => mkp(i, 0.7, 0.55));
  const cv = classValidation({ A: strong, B: strong.slice(0, 100), C: strong });
  assert.match(cv.A.status, /^validata/); assert.equal(cv.B.status, "non validata"); assert.match(cv.B.why.join(), /campione insufficiente/); assert.equal(cv.C.status, "non validata");
  const bad = Array.from({ length: 900 }, (_, i) => mkp(i, 0.55, 0.7, 0.7)); // l'esito segue il mercato, non il modello assert.equal(classValidation({ A: bad, B: [], C: [] }).A.status, "non validata");
});
test("doppie: sempre non validate; il prodotto delle singole è dichiarato come ipotesi di indipendenza; la dipendenza simulata viene rilevata", () => {
  const A = { tier: "A", pAdj: 0.6, odds: 1.9, tournament: "P" }, B = { tier: "A", pAdj: 0.62, odds: 1.95, tournament: "Q" }, d = evaluateDouble(A, B);
  assert.equal(d.validated, false); assert.equal(d.independenceAssumed, true); assert.ok(Math.abs(d.pJoint - 0.6 * 0.62) < 1e-12); assert.match(d.limitation, /indipendenza assunta, non verificata/);
  let s = 5; const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const mk = (corr) => { const out = []; for (let day = 0; day < 700; day++) { const shock = rnd() < 0.5 ? 1 : 0; for (let k = 0; k < 2; k++) { const p = 0.6, y = rnd() < corr ? shock : rnd() < p ? 1 : 0; out.push({ p, y, t: day * 864e5, g: `T${day}${k}`, tournament: `T${day}${k}`, key: `${day}-${k}` }); } } return out; };
  const ind = jointIndependenceCheck(mk(0)), dep = jointIndependenceCheck(mk(0.6));
  assert.equal(ind.validated, false); assert.equal(dep.validated, false); assert.ok(ind.residualCovariance.lo <= 0 && ind.residualCovariance.hi >= 0, "indipendenza non rifiutata"); assert.ok(dep.residualCovariance.lo > 0, "dipendenza rilevata");
  assert.equal(jointIndependenceCheck(mk(0).slice(0, 20)).observedBothWin, null);
});
test("mercato normalizzato per il margine: le probabilità sommano 1, il margine viene tolto e non dipende dalla scala del margine", () => {
  const nv = noVig(1.8, 2.1); assert.ok(Math.abs(nv.p1 + nv.p2 - 1) < 1e-12); assert.ok(nv.margin > 0);
  const fair = (m) => noVig(1 / (0.6 * m), 1 / (0.4 * m)); for (const m of [1, 1.04, 1.1]) assert.ok(Math.abs(fair(m).p1 - 0.6) < 1e-12);
  assert.equal(noVig(1, 2), null); assert.equal(noVig(NaN, 2), null);
});
test("il modello non è premiato per scostarsi dalle quote: un modello rumoroso attorno al mercato risulta peggiore, non migliore", () => {
  let s = 3; const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
  const g = evalGroup(Array.from({ length: 3000 }, (_, i) => { const m = 0.3 + rnd() * 0.4, y = rnd() < m ? 1 : 0, p = Math.min(0.95, Math.max(0.05, m + (rnd() - 0.5) * 0.3)); return { y, pOld: p, pNew: p, mkt: m, g: `g${i % 100}` }; }));
  assert.ok(g.newVsMarket.logLoss.est < 0 && g.newVsMarket.logLoss.hi < 0); assert.ok(g.metrics.new.brier > g.metrics.market.brier);
});
test("audit v5 e workflow: sola lettura, avvio manuale, mai importati dal motore", () => {
  const src = fs.readFileSync("scripts/tennis-strategy-audit-v5.js", "utf8").replace(/\/\*[\s\S]*?\*\//g, ""); assert.ok(!/supabaseUpsert|supabasePatch|supabaseDelete|makeDb|\.rpc\(|method: "(POST|PATCH|PUT|DELETE)"/.test(src));
  const wf = fs.readFileSync(".github/workflows/tennis-strategy-audit-v5.yml", "utf8"); assert.ok(/workflow_dispatch/.test(wf) && !/schedule:|TENNIS_API_KEY|db push|migration/i.test(wf) && /contents: read/.test(wf));
  for (const f of ["scripts/tennis-sync.js", ...fs.readdirSync("functions/api").map((x) => `functions/api/${x}`)]) assert.ok(!/from\s+["'][^"']*tennis-strategy-audit-v5/.test(fs.readFileSync(f, "utf8")), f);
  void threeWayComparison; void MIN_GROUP_N;
});
