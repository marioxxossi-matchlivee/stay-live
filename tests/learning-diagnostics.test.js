import test from "node:test";
import assert from "node:assert/strict";
import { diagnose } from "../functions/api/_learning-diagnostics.js";
import { synth, T0, H } from "./learning-helpers.js";

const types = (d) => d.anomalies.map((a) => a.type);
const REPS = 300;

test("controllo dei falsi positivi: dati ben calibrati e omogenei non producono anomalie «rilevate»", () => {
  const d = diagnose(synth(3000, { seed: 21, truth: 1.0 }), { sport: "tennis", reps: REPS });
  assert.equal(d.available, true); assert.equal(d.n, 3000); assert.equal(d.anomalies.filter((a) => a.status === "rilevata").length, 0, JSON.stringify(d.anomalySummary));
  assert.ok(d.summary.logLoss.est > 0.55 && d.summary.logLoss.est < 0.7);
});

test("sovra-confidenza: rilevata con pendenza <1, evidenze numeriche, periodo, confidenza e spiegazioni solo come ipotesi", () => {
  const d = diagnose(synth(3000, { seed: 22, truth: 0.45 }), { sport: "tennis", reps: REPS }), a = d.anomalies.find((x) => x.type === "calibration_slope");
  assert.ok(a, types(d).join()); assert.equal(a.status, "rilevata"); assert.ok(a.evidence.slope < 0.8 && a.evidence.slopeCI[1] < 1); assert.equal(a.n, 3000); assert.ok(a.period.from < a.period.to); assert.equal(a.confidence.ci, 0.95); assert.equal(a.confidence.sufficient, true);
  assert.ok(a.explanations.length >= 1 && a.explanations.every((e) => e.status === "ipotesi non dimostrata")); assert.ok(a.limits.some((l) => /non dimostra una causa/.test(l))); assert.ok(typeof a.description === "string" && a.description.length > 20);
  for (const k of ["id", "type", "sport", "status", "title", "description", "evidence", "n", "period", "confidence", "explanations", "limits"]) assert.ok(a[k] != null, k);
});

test("campione piccolo: mai «rilevata», solo «segnale debole» con il limite dichiarato", () => {
  const d = diagnose(synth(150, { seed: 23, truth: 0.2 }), { sport: "tennis", reps: REPS });
  assert.ok(d.anomalies.length > 0, "il segnale c'è"); assert.ok(d.anomalies.every((a) => a.status === "segnale debole")); assert.ok(d.anomalies.every((a) => a.limits.some((l) => /sotto soglia/.test(l)))); assert.equal(d.sufficient, false);
});

test("differenza tra superfici: rileva il gruppo peggiore, corretta per test multipli, e lo dice con evidenze", () => {
  const d = diagnose(synth(4000, { seed: 24, truthBy: { clay: 0.2, hard: 1.0 } }), { sport: "tennis", reps: REPS }), a = d.anomalies.find((x) => x.type === "segment_gap" && x.evidence.dimension === "surface");
  assert.ok(a, types(d).join()); assert.equal(a.evidence.group, "clay"); assert.equal(a.status, "rilevata"); assert.ok(a.evidence.ci[0] > 0); assert.ok(a.confidence.adjustedP < 0.05);
  const rows = d.segments.filter((s) => s.dim === "surface"); assert.equal(rows.length, 2); assert.ok(rows.every((r) => r.diff && r.diff.adjP != null));
});

test("peggioramento nel tempo: rileva il periodo recente peggiore, non il contrario", () => {
  const a = synth(2400, { seed: 25, truth: 1.0 }), b = synth(800, { seed: 26, truth: 0.1 }).map((r, i) => ({ ...r, id: `late-${i}`, t: T0 + (2400 + i) * 2 * H, group: `late-${i}`, block: `L${i % 25}|${Math.floor((2400 + i) / 84)}` }));
  const d = diagnose([...a, ...b], { sport: "tennis", reps: REPS }), x = d.anomalies.find((y) => y.type === "performance_degradation");
  assert.ok(x, types(d).join()); assert.ok(x.evidence.diff > 0 && x.evidence.ci[0] > 0); assert.equal(d.periods.recentVsEarlier.n.length, 2); assert.ok(d.periods.weekly.length > 3);
  const rev = diagnose([...synth(800, { seed: 27, truth: 0.1 }), ...synth(2400, { seed: 28, truth: 1.0 }).map((r, i) => ({ ...r, id: `x${i}`, t: T0 + (800 + i) * 2 * H, group: `x${i}` }))], { sport: "tennis", reps: REPS }); assert.ok(!rev.anomalies.some((y) => y.type === "performance_degradation"), "un miglioramento non è un peggioramento");
});

test("dati mancanti: effetto misurato con IC e dichiarato come associazione, non come causa", () => {
  const recs = synth(3000, { seed: 29, truth: 1.0 }).map((r, i) => (i % 5 === 0 ? { ...r, flags: { ...r.flags, serveStats: true }, y: (i * 7919) % 2 } : { ...r, flags: { ...r.flags, serveStats: false } }));
  const d = diagnose(recs, { sport: "tennis", reps: REPS }), a = d.anomalies.find((x) => x.type === "missing_data_effect" && x.evidence.flag === "serveStats");
  assert.ok(a, types(d).join()); assert.ok(a.evidence.diff > 0); assert.ok(a.limits.some((l) => /non dimostra una causa/.test(l))); assert.ok(d.missingEffects.find((m) => m.flag === "serveStats").nWith > 500);
});

test("fonti: sulle stesse partite il mercato migliore del modello è rilevato; una quota non normalizzata non entra nel confronto", () => {
  const d = diagnose(synth(3000, { seed: 30, truth: 0.4, market: true }).map((r, i) => ({ ...r, sources: { ...r.sources, market: Math.min(0.97, Math.max(0.03, 0.5 + (r.p - 0.5) * 0.4 + (r.y - 0.5) * 0.25)) } })), { sport: "tennis", reps: REPS });
  const a = d.anomalies.find((x) => x.type === "source_divergence"); assert.ok(a, types(d).join()); assert.equal(a.evidence.a, "model"); assert.ok(a.evidence.diff > 0 && a.evidence.ci[0] > 0); assert.ok(a.limits.some((l) => /entrambi i giocatori|entrambe/i.test(l) || /normalizzabili/.test(l)));
  const raw = synth(3000, { seed: 31, truth: 0.4, market: true }).map((r) => ({ ...r, sources: { ...r.sources, marketNormalized: false } })); const e = diagnose(raw, { sport: "tennis", reps: REPS }); assert.equal(e.sources.comparisons[0].available, false); assert.equal(e.sources.normalizedMarketN, 0);
});

test("cambio di distribuzione: PSI alto tra le due metà segnalato; stabile non segnalato", () => {
  const a = synth(1500, { seed: 32 }), b = synth(1500, { seed: 33 }).map((r, i) => ({ ...r, id: `s${i}`, t: T0 + (1500 + i) * 2 * H, group: `s${i}`, p: Math.min(0.97, r.p * 0.3 + 0.65) }));
  const d = diagnose([...a, ...b], { sport: "tennis", reps: REPS }); assert.ok(d.drift.psiP > 0.25); assert.ok(d.anomalies.some((x) => x.type === "distribution_shift"));
  assert.ok(!diagnose(synth(3000, { seed: 34 }), { sport: "tennis", reps: REPS }).anomalies.some((x) => x.type === "distribution_shift"));
});

test("calcio: segmenti per mercato/campionato/versione e gruppi di previsioni dipendenti; nessun dato → non disponibile", () => {
  const d = diagnose(synth(3000, { seed: 35, sport: "football", surfaces: ["home", "draw", "away"], gsize: 3, version: "63db1f35" }), { sport: "football", reps: REPS });
  assert.equal(d.available, true); for (const dim of ["market", "league", "basis", "version"]) assert.ok(d.segments.some((s) => s.dim === dim), dim); assert.deepEqual(diagnose([], { sport: "tennis" }), { available: false, sport: "tennis", reason: "Nessuna previsione conclusa disponibile per l'analisi." });
  assert.ok(d.missingEffects.some((m) => m.flag === "noMarket"));
});

test("determinismo: stessi dati e stessi parametri → stesso risultato", () => {
  const r = synth(1200, { seed: 36, truth: 0.6 }); assert.deepEqual(diagnose(r, { sport: "tennis", reps: REPS }), diagnose(r.slice(), { sport: "tennis", reps: REPS }));
});
