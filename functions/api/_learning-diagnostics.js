/**
 * Stay Live — CONTINUOUS LEARNING: motore di DIAGNOSTICA (puro, osservativo). Non modifica modelli, probabilità o dati.
 * Ogni anomalia porta descrizione, evidenze numeriche, numerosità, periodo, livello di confidenza, spiegazioni POSSIBILI (mai attribuite come cause) e limiti.
 * «rilevata» richiede: campione sufficiente (≥300 osservazioni e ≥50 blocchi nel gruppo più piccolo), p corretto con Holm < 0,05 e intervallo al 95% che esclude lo zero.
 * Altrimenti il segnale è «debole»: indicativo, non una conclusione.
 */
import { LEARNING, summarize, period, blockMean, blockDiffIndependent, holm, calibrationFit, calibrationBins, ece, psi, lossLog, lossBrier, mean, r4, hash128, weekOf } from "./_learning-core.js";

const DIMS = { tennis: ["surface", "tour"], football: ["market", "league", "basis", "version"] };
const FLAG_LABEL = { h2h: "scontri diretti", ranking: "ranking", serveStats: "statistiche di servizio e risposta", history: "storico partite", format: "formato dell'incontro", form: "forma recente", noApi: "probabilità dell'API", noMarket: "quote di mercato" };
const dimOf = (r, d) => (d === "version" ? r.version ?? "n.d." : r.segs[d] ?? "n.d.");
const LIMIT_COMMON = ["Le previsioni della stessa partita, torneo o campionato non sono indipendenti: gli intervalli usano blocchi (torneo/campionato e settimana), ma restano stime.", "Un'associazione statistica non dimostra una causa.", "Analisi sui soli dati registrati dall'app: nessun dato esterno."];
const EXPLAIN = {
  calibration_slope: ["Le probabilità potrebbero essere troppo estreme (o troppo caute) rispetto alla frequenza reale.", "Potrebbe dipendere da dati mancanti o da uno storico non aggiornato (verificabile con l'analisi dei dati mancanti)."],
  calibration_intercept: ["Le probabilità potrebbero essere in media troppo alte o troppo basse per questo evento.", "Potrebbe riflettere la scelta dell'evento (lato 1, mercato) e non un difetto del modello."],
  bin_bias: ["Nella fascia indicata le probabilità dichiarate non corrispondono alla frequenza osservata.", "Con pochi casi per fascia lo scarto può essere casuale."],
  segment_gap: ["Il gruppo potrebbe avere caratteristiche che il modello coglie peggio (ipotesi).", "Il gruppo potrebbe concentrare altre differenze (periodo, qualità dei dati) non separabili con questi dati."],
  performance_degradation: ["Le condizioni (stagione, composizione dei tornei o campionati, versione del modello, fonti disponibili) potrebbero essere cambiate.", "Il periodo recente è più breve: l'incertezza è maggiore."],
  missing_data_effect: ["Il dato mancante potrebbe segnalare partite meno documentate e quindi più difficili.", "Il dato mancante potrebbe coincidere con altri fattori (circuito, livello): non è isolabile."],
  source_divergence: ["Le fonti potrebbero contenere informazioni diverse (o una potrebbe riflettere margini del bookmaker).", "Una quota non normalizzata include il margine e non è una probabilità."],
  distribution_shift: ["La composizione delle partite o la fiducia del modello potrebbe essere cambiata nel tempo.", "Un cambio di versione del modello o delle fonti potrebbe produrre lo stesso effetto."],
};

function makeAnomaly(sport, type, key, f) {
  const sufficient = !!f.sufficient, adj = f.adjP ?? null, ciOk = f.ciExcludes ?? false;
  const detected = sufficient && ciOk && adj != null && adj < LEARNING.alpha;
  const level = !sufficient ? "bassa" : adj != null && adj < 0.01 && ciOk ? "alta" : detected ? "media" : "bassa";
  return { id: hash128(`${sport}|${type}|${key}`).slice(0, 16), type, sport, severity: f.severity ?? (detected ? "media" : "informativa"), status: detected ? "rilevata" : "segnale debole", title: f.title, description: String(f.description).replace(/(\d)\.(\d)/g, "$1,$2"), evidence: f.evidence,
    n: f.n, blocks: f.blocks ?? null, period: f.period ?? null, confidence: { ci: 0.95, method: f.method ?? "bootstrap a blocchi", correction: f.correction ?? "Holm", adjustedP: adj, level, sufficient },
    explanations: (EXPLAIN[type] ?? []).map((text) => ({ text, status: "ipotesi non dimostrata" })), limits: [...(f.limits ?? []), ...LIMIT_COMMON, ...(sufficient ? [] : [`Campione sotto soglia (${LEARNING.minSample} osservazioni e ${LEARNING.minBlocks} blocchi nel gruppo più piccolo): segnale solo indicativo.`])] };
}
const ciExcl = (x) => x.lo != null && x.hi != null && (x.lo > 0 || x.hi < 0);
const suff = (n, blocks) => n >= LEARNING.minSample && blocks >= LEARNING.minBlocks;
const vals = (recs, f) => ({ values: recs.map(f), blocks: recs.map((r) => r.block) });

export function diagnose(records, { sport, reps = LEARNING.reps, dims = DIMS[sport] ?? [] } = {}) {
  const recs = records.filter((r) => r.sport === sport).sort((a, b) => a.t - b.t);
  if (!recs.length) return { available: false, sport, reason: "Nessuna previsione conclusa disponibile per l'analisi." };
  const opt = { reps }, overall = summarize(recs, opt), per = period(recs), fit = calibrationFit(recs, { reps: Math.min(300, reps) }), anomalies = [], tests = [];
  const full = suff(overall.n, overall.blocks);

  // ── Calibrazione ──
  if (fit.slopeCI[0] != null && (fit.slopeCI[1] < 1 || fit.slopeCI[0] > 1)) anomalies.push(makeAnomaly(sport, "calibration_slope", "all", { title: fit.slope < 1 ? "Probabilità troppo estreme (sovra-confidenza)" : "Probabilità troppo caute (sotto-confidenza)", description: `La pendenza di calibrazione è ${fit.slope} (1 = calibrazione ideale): ${fit.slope < 1 ? "le probabilità lontane da 50% sono più estreme della frequenza osservata" : "le probabilità sono più caute della frequenza osservata"}.`, evidence: { slope: fit.slope, slopeCI: fit.slopeCI, intercept: fit.intercept, ece: overall.ece }, n: overall.n, blocks: overall.blocks, period: per, sufficient: full, adjP: 0.01, ciExcludes: true, correction: "nessuna (singolo test)", severity: "alta" }));
  if (fit.interceptCI[0] != null && (fit.interceptCI[1] < 0 || fit.interceptCI[0] > 0)) anomalies.push(makeAnomaly(sport, "calibration_intercept", "all", { title: fit.intercept < 0 ? "Sovrastima media delle probabilità" : "Sottostima media delle probabilità", description: `Probabilità media dichiarata ${overall.meanP} contro frequenza osservata ${overall.meanY} (scarto ${overall.bias}). Intercetta di calibrazione ${fit.intercept}.`, evidence: { meanP: overall.meanP, meanY: overall.meanY, bias: overall.bias, intercept: fit.intercept, interceptCI: fit.interceptCI }, n: overall.n, blocks: overall.blocks, period: per, sufficient: full, adjP: 0.01, ciExcludes: true, correction: "nessuna (singolo test)" }));
  const binTests = overall.calibration.filter((b) => b.n >= LEARNING.minBin).map((b) => { const z = (b.observed - b.claimed) / Math.sqrt(Math.max(b.claimed * (1 - b.claimed), 1e-6) / b.n), p = 2 * (1 - 0.5 * (1 + erf(Math.abs(z) / Math.SQRT2))); return { b, z, p }; });
  const binAdj = holm(binTests.map((x) => x.p));
  binTests.forEach((x, i) => { const out = x.b.claimed < x.b.ciLo || x.b.claimed > x.b.ciHi; if (out) anomalies.push(makeAnomaly(sport, "bin_bias", `${x.b.lo}`, { title: `Fascia ${Math.round(x.b.lo * 100)}–${Math.round(x.b.hi * 100)}%: ${x.b.gap < 0 ? "sovrastima" : "sottostima"}`, description: `Probabilità dichiarata media ${x.b.claimed}, frequenza osservata ${x.b.observed} (IC 95% ${x.b.ciLo}–${x.b.ciHi}) su ${x.b.n} casi.`, evidence: { claimed: x.b.claimed, observed: x.b.observed, gap: x.b.gap, ci: [x.b.ciLo, x.b.ciHi] }, n: x.b.n, blocks: null, period: per, sufficient: x.b.n >= LEARNING.minSample && full, adjP: binAdj[i], ciExcludes: true, method: "intervallo di Wilson e test normale (le osservazioni della stessa partita non sono indipendenti)" })); });

  // ── Segmenti (superfici, campionati, mercati, versioni…) ──
  const segTable = [];
  for (const d of dims) {
    const values = [...new Set(recs.map((r) => dimOf(r, d)))];
    for (const v of values.sort()) {
      const inS = recs.filter((r) => dimOf(r, d) === v), out = recs.filter((r) => dimOf(r, d) !== v), s = summarize(inS, { reps: Math.min(reps, 300) });
      const row = { dim: d, value: v, n: s.n, blocks: s.blocks, logLoss: s.logLoss.est, brier: s.brier.est, accuracy: s.accuracy.est, ece: s.ece, bias: s.bias, diff: null };
      if (inS.length >= LEARNING.minSegment && out.length >= LEARNING.minSegment) { const diff = blockDiffIndependent(vals(inS, (r) => lossLog(r.p, r.y)), vals(out, (r) => lossLog(r.p, r.y)), opt); row.diff = diff; row.outN = out.length; tests.push({ row, diff, inS }); }
      segTable.push(row);
    }
  }
  const segAdj = holm(tests.map((t) => t.diff.p));
  tests.forEach((t, i) => { t.row.diff = { ...t.diff, adjP: segAdj[i] }; if (t.diff.est > 0 && ciExcl(t.diff)) { const small = Math.min(t.inS.length, t.row.outN), bl = Math.min(t.row.blocks, t.diff.blocksB ?? 0); anomalies.push(makeAnomaly(sport, "segment_gap", `${t.row.dim}=${t.row.value}`, { title: `${t.row.dim} «${t.row.value}»: perdita più alta del resto`, description: `Log loss ${t.row.logLoss} nel gruppo contro ${r4(mean(recs.filter((r) => dimOf(r, t.row.dim) !== t.row.value).map((r) => lossLog(r.p, r.y))))} nel resto (differenza ${t.diff.est}, IC 95% ${t.diff.lo}–${t.diff.hi}).`, evidence: { group: t.row.value, dimension: t.row.dim, logLoss: t.row.logLoss, diff: t.diff.est, ci: [t.diff.lo, t.diff.hi], ece: t.row.ece, bias: t.row.bias }, n: t.row.n, blocks: t.row.blocks, period: period(t.inS), sufficient: suff(small, Math.min(t.row.blocks, t.diff.blocksB ?? 0)), adjP: segAdj[i], ciExcludes: true })); } });

  // ── Periodi ──
  const wk = new Map(); for (const r of recs) { const k = weekOf(r.t); (wk.get(k) ?? wk.set(k, []).get(k)).push(r); }
  const weekly = [...wk.entries()].sort((a, b) => a[0] - b[0]).map(([k, rs]) => ({ weekStart: new Date(k * LEARNING.weekMs).toISOString().slice(0, 10), n: rs.length, logLoss: r4(mean(rs.map((r) => lossLog(r.p, r.y)))), brier: r4(mean(rs.map((r) => lossBrier(r.p, r.y)))), accuracy: r4(mean(rs.map((r) => ((r.p >= 0.5 ? 1 : 0) === r.y ? 1 : 0)))) }));
  const cut = Math.floor(recs.length * 0.75), early = recs.slice(0, cut), recent = recs.slice(cut);
  let recentVsEarlier = null;
  if (early.length >= LEARNING.minSegment && recent.length >= LEARNING.minSegment) {
    const d = blockDiffIndependent(vals(recent, (r) => lossLog(r.p, r.y)), vals(early, (r) => lossLog(r.p, r.y)), opt), dB = r4(mean(recent.map((r) => lossBrier(r.p, r.y))) - mean(early.map((r) => lossBrier(r.p, r.y))));
    recentVsEarlier = { n: [early.length, recent.length], logLossDiff: d, brierDiff: dB, earlier: period(early), recent: period(recent) };
    if (d.est > 0 && ciExcl(d)) anomalies.push(makeAnomaly(sport, "performance_degradation", "recent", { title: "Peggioramento nel periodo recente", description: `Log loss recente ${r4(mean(recent.map((r) => lossLog(r.p, r.y))))} contro ${r4(mean(early.map((r) => lossLog(r.p, r.y))))} del periodo precedente (differenza ${d.est}, IC 95% ${d.lo}–${d.hi}).`, evidence: { diff: d.est, ci: [d.lo, d.hi], brierDiff: dB }, n: recent.length, blocks: d.blocksA, period: period(recent), sufficient: suff(recent.length, d.blocksA), adjP: d.p, ciExcludes: true, correction: "nessuna (singolo test)" }));
  }

  // ── Dati mancanti ──
  const flagKeys = Object.keys(recs[0].flags).filter((k) => k !== "reconstructed"), missingEffects = [], mt = [];
  for (const k of flagKeys) {
    const a = recs.filter((r) => r.flags[k]), b = recs.filter((r) => !r.flags[k]), row = { flag: k, label: FLAG_LABEL[k] ?? k, nWith: a.length, nWithout: b.length, share: r4(a.length / recs.length), logLossWith: a.length ? r4(mean(a.map((r) => lossLog(r.p, r.y)))) : null, logLossWithout: b.length ? r4(mean(b.map((r) => lossLog(r.p, r.y)))) : null, diff: null };
    if (a.length >= LEARNING.minSegment && b.length >= LEARNING.minSegment) { row.diff = blockDiffIndependent(vals(a, (r) => lossLog(r.p, r.y)), vals(b, (r) => lossLog(r.p, r.y)), opt); mt.push({ row, a }); }
    missingEffects.push(row);
  }
  const mAdj = holm(mt.map((t) => t.row.diff.p));
  mt.forEach((t, i) => { t.row.diff = { ...t.row.diff, adjP: mAdj[i] }; if (ciExcl(t.row.diff)) anomalies.push(makeAnomaly(sport, "missing_data_effect", t.row.flag, { title: `Con «${t.row.label}» mancante la perdita è ${t.row.diff.est > 0 ? "più alta" : "più bassa"}`, description: `Log loss ${t.row.logLossWith} con il dato mancante (${t.row.nWith} casi) contro ${t.row.logLossWithout} con il dato presente (${t.row.nWithout} casi); differenza ${t.row.diff.est}, IC 95% ${t.row.diff.lo}–${t.row.diff.hi}.`, evidence: { flag: t.row.flag, nWith: t.row.nWith, nWithout: t.row.nWithout, diff: t.row.diff.est, ci: [t.row.diff.lo, t.row.diff.hi] }, n: t.row.nWith, blocks: t.row.diff.blocksA, period: period(t.a), sufficient: suff(Math.min(t.row.nWith, t.row.nWithout), Math.min(t.row.diff.blocksA, t.row.diff.blocksB)), adjP: mAdj[i], ciExcludes: true })); });

  // ── Fonti informative e divergenze (stesse osservazioni) ──
  const norm = recs.filter((r) => r.sources.market != null && r.sources.marketNormalized), comparisons = [], ct = [];
  const pairs = sport === "football" ? [["model", "market"], ["api", "market"], ["model", "api"]] : [["model", "market"]];
  for (const [x, y] of pairs) {
    const sub = (x === "market" || y === "market" ? norm : recs).filter((r) => r.sources[x] != null && r.sources[y] != null);
    if (sub.length < LEARNING.minSegment) { comparisons.push({ a: x, b: y, n: sub.length, available: false }); continue; }
    const diffs = sub.map((r) => lossLog(r.sources[x], r.y) - lossLog(r.sources[y], r.y)), m = blockMean(diffs, sub.map((r) => r.block), opt), absDiv = r4(mean(sub.map((r) => Math.abs(r.sources[x] - r.sources[y]))));
    const row = { a: x, b: y, n: sub.length, available: true, logLossA: r4(mean(sub.map((r) => lossLog(r.sources[x], r.y)))), logLossB: r4(mean(sub.map((r) => lossLog(r.sources[y], r.y)))), diff: m, meanAbsDivergence: absDiv }; comparisons.push(row); ct.push({ row, sub });
  }
  const cAdj = holm(ct.map((t) => t.row.diff.p));
  ct.forEach((t, i) => { t.row.diff = { ...t.row.diff, adjP: cAdj[i] }; if (ciExcl(t.row.diff)) anomalies.push(makeAnomaly(sport, "source_divergence", `${t.row.a}-${t.row.b}`, { title: `Fonti ${t.row.a} e ${t.row.b}: prestazioni diverse sulle stesse partite`, description: `Sulle stesse ${t.row.n} osservazioni la fonte «${t.row.diff.est < 0 ? t.row.a : t.row.b}» ha log loss minore (${t.row.logLossA} contro ${t.row.logLossB}; differenza ${t.row.diff.est}, IC 95% ${t.row.diff.lo}–${t.row.diff.hi}); divergenza media assoluta ${t.row.meanAbsDivergence}.`, evidence: { a: t.row.a, b: t.row.b, logLossA: t.row.logLossA, logLossB: t.row.logLossB, diff: t.row.diff.est, ci: [t.row.diff.lo, t.row.diff.hi], meanAbsDivergence: t.row.meanAbsDivergence }, n: t.row.n, blocks: t.row.diff.blocks, period: period(t.sub), sufficient: suff(t.row.n, t.row.diff.blocks), adjP: cAdj[i], ciExcludes: true, limits: sport === "tennis" ? ["Solo le partite con le quote di entrambi i giocatori (normalizzabili) entrano nel confronto."] : [] })); });
  const common = recs.filter((r) => r.sources.model != null && r.sources.market != null && r.sources.marketNormalized && (sport === "tennis" || r.sources.api != null));
  const commonSummary = common.length >= LEARNING.minSegment ? ["model", "api", "market"].filter((k) => common.every((r) => r.sources[k] != null)).map((k) => { const s = summarize(common.map((r) => ({ ...r, p: r.sources[k] })), { reps: Math.min(reps, 300) }); return { source: k, n: s.n, logLoss: s.logLoss, brier: s.brier, ece: s.ece, bias: s.bias }; }) : [];

  // ── Distribuzione dei dati ──
  const half = Math.floor(recs.length / 2), h1 = recs.slice(0, half), h2 = recs.slice(half), psiP = psi(h1.map((r) => r.p), h2.map((r) => r.p)), mix = [];
  for (const d of dims) { const vs = [...new Set(recs.map((r) => dimOf(r, d)))], share = (arr) => vs.map((v) => Math.max(arr.filter((r) => dimOf(r, d) === v).length / Math.max(arr.length, 1), 1e-4)), a = share(h1), b = share(h2); mix.push({ dim: d, psi: r4(a.reduce((s, x, i) => s + (x - b[i]) * Math.log(x / b[i]), 0)) }); }
  if (h1.length >= LEARNING.minSegment && psiP != null && psiP >= 0.1) anomalies.push(makeAnomaly(sport, "distribution_shift", "p", { title: psiP >= 0.25 ? "Cambio marcato nella distribuzione delle probabilità" : "Cambio moderato nella distribuzione delle probabilità", description: `Indice di stabilità della popolazione (PSI) tra prima e seconda metà del periodo: ${psiP} (0,10 moderato, 0,25 marcato).`, evidence: { psi: psiP, firstHalf: period(h1), secondHalf: period(h2) }, n: recs.length, blocks: overall.blocks, period: per, sufficient: full && psiP >= 0.25, adjP: psiP >= 0.25 ? 0.01 : 0.5, ciExcludes: psiP >= 0.25, method: "indice PSI (soglie convenzionali, nessun intervallo)", correction: "nessuna", severity: psiP >= 0.25 ? "media" : "informativa" }));

  const byStatus = anomalies.reduce((m, a) => ((m[a.status] = (m[a.status] ?? 0) + 1), m), {}), byType = anomalies.reduce((m, a) => ((m[a.type] = (m[a.type] ?? 0) + 1), m), {});
  const order = { rilevata: 0, "segnale debole": 1 };
  anomalies.sort((a, b) => order[a.status] - order[b.status] || (a.confidence.adjustedP ?? 1) - (b.confidence.adjustedP ?? 1));
  return { available: true, sport, period: per, n: recs.length, blocks: overall.blocks, sufficient: full, summary: { brier: overall.brier, logLoss: overall.logLoss, accuracy: overall.accuracy, ece: overall.ece, meanP: overall.meanP, meanY: overall.meanY, bias: overall.bias }, calibration: { fit, bins: overall.calibration },
    segments: segTable.sort((a, b) => b.n - a.n).slice(0, 60), periods: { weekly: weekly.slice(-26), recentVsEarlier }, missingEffects, sources: { comparisons, common: commonSummary, normalizedMarketN: norm.length }, drift: { psiP, mix }, anomalies, anomalySummary: { total: anomalies.length, byStatus, byType } };
}

/** Funzione d'errore (Abramowitz–Stegun) per i p-value normali. */
function erf(x) { const t = 1 / (1 + 0.3275911 * x), y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return y; }
