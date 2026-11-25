/**
 * Stay Live — CONTINUOUS LEARNING: LABORATORIO SPERIMENTALE e VALIDATORE INDIPENDENTE (puro, isolato).
 * Sperimenta SOLO trasformazioni post-hoc delle probabilità già prodotte (ricalibrazioni): non esegue né modifica i modelli operativi e non scrive nulla.
 * Protezioni contro la contaminazione e il «ritocco sui dati già visti»:
 *  1. ultimo tratto cronologico (holdout, 20%) escluso da ogni adattamento e da ogni scelta;
 *  2. walk-forward a finestra espansa nel resto (sviluppo): si adatta sul passato, si valuta sul futuro successivo;
 *  3. nessuna partita/gruppo condivisa tra adattamento e valutazione (verificato con assertNoLeakage);
 *  4. confronto sulle STESSE osservazioni, bootstrap a blocchi, correzione di Holm sui candidati provati;
 *  5. l'holdout è valutato una sola volta e solo dai candidati che hanno superato lo sviluppo.
 * Un esito «validato» significa «migliore su dati storici indipendenti»: NON viene adottato; richiede una validazione prospettica separata.
 */
import { LEARNING, logit, sigmoid, clip, lossLog, lossBrier, mean, blockMean, calibrationBins, ece, logisticFit, holm, summarize, period, fingerprint, hash128, r4 } from "./_learning-core.js";

export const LAB = { holdoutShare: 0.2, folds: 4, eceTolerance: 0.01, minFoldsShare: 2 / 3, offsetPrior: 0.35 };
const pc = (p) => clip(p, LEARNING.eps);
const goldenMin = (f, lo, hi, it = 40) => { const g = (Math.sqrt(5) - 1) / 2; let a = lo, b = hi, c = b - g * (b - a), d = a + g * (b - a), fc = f(c), fd = f(d); for (let i = 0; i < it; i++) { if (fc < fd) { b = d; d = c; fd = fc; c = b - g * (b - a); fc = f(c); } else { a = c; c = d; fc = fd; d = a + g * (b - a); fd = f(d); } } return (a + b) / 2; };
const meanLoss = (recs, f) => mean(recs.map((r) => lossLog(f(r), r.y)));
const dimOf = (r, d) => (d === "version" ? r.version ?? "n.d." : r.segs[d] ?? "n.d.");

/** Candidati: ciascuno ha fit(train) → { params, predict(record) }. Nessuno dipende dal modello operativo. */
export const CANDIDATES = {
  temperature: { label: "Temperatura (scala della confidenza)", fit(train) { const x = train.map((r) => logit(r.p)), T = Math.exp(goldenMin((lt) => mean(train.map((r, i) => lossLog(sigmoid(x[i] / Math.exp(lt)), r.y))), Math.log(0.25), Math.log(4))); return { params: { T: r4(T) }, predict: (r) => pc(sigmoid(logit(r.p) / T)) }; } },
  platt: { label: "Platt (intercetta e pendenza)", fit(train) { const f = logisticFit(train.map((r) => logit(r.p)), train.map((r) => r.y), null, { ridge: 1e-3 }); return { params: { a: r4(f.a), b: r4(f.b) }, predict: (r) => pc(sigmoid(f.a + f.b * logit(r.p))) }; } },
  shrink: { label: "Contrazione verso il tasso base", fit(train) { const c = mean(train.map((r) => r.y)); let best = { l: Infinity, w: 0 }; for (let w = 0; w <= 0.6001; w += 0.02) { const l = meanLoss(train, (r) => (1 - w) * r.p + w * c); if (l < best.l) best = { l, w }; } return { params: { lambda: r4(best.w), baseRate: r4(c) }, predict: (r) => pc((1 - best.w) * r.p + best.w * c) }; } },
  market_blend: { label: "Miscela con la quota di mercato normalizzata", requires: (recs) => recs.filter((r) => r.sources.market != null && r.sources.marketNormalized).length >= LEARNING.minSample,
    fit(train) { const sub = train.filter((r) => r.sources.market != null && r.sources.marketNormalized); let best = { l: Infinity, w: 0 }; for (let w = 0; w <= 1.0001; w += 0.05) { const l = meanLoss(sub, (r) => (1 - w) * r.p + w * r.sources.market); if (l < best.l) best = { l, w }; } return { params: { w: r4(best.w), fittedOn: sub.length }, predict: (r) => (r.sources.market != null && r.sources.marketNormalized ? pc((1 - best.w) * r.p + best.w * r.sources.market) : r.p) }; } },
  segment_offset: { label: "Scostamento per gruppo (con contrazione)", fit(train, { dim }) {
    const by = new Map(); for (const r of train) { const v = dimOf(r, dim); (by.get(v) ?? by.set(v, []).get(v)).push(r); }
    const off = new Map(), s2 = LAB.offsetPrior ** 2;
    for (const [v, rs] of by) { if (rs.length < LEARNING.minSegment) continue; let d = 0; for (let i = 0; i < 20; i++) { let g = -d / s2, h = 1 / s2; for (const r of rs) { const p = sigmoid(logit(r.p) + d); g += r.y - p; h += p * (1 - p); } d += g / h; } off.set(v, d); }
    return { params: { dim, offsets: Object.fromEntries([...off].map(([k, v]) => [k, r4(v)])) }, predict: (r) => pc(sigmoid(logit(r.p) + (off.get(dimOf(r, dim)) ?? 0))) }; } },
};

/** Divisione cronologica per GRUPPI (un gruppo sta tutto da una parte): sviluppo + holdout, e fold walk-forward nello sviluppo. */
export function splitTime(records, { holdoutShare = LAB.holdoutShare, folds = LAB.folds } = {}) {
  const gmin = new Map(); for (const r of records) gmin.set(r.group, Math.min(gmin.get(r.group) ?? Infinity, r.t));
  const sorted = records.slice().sort((a, b) => gmin.get(a.group) - gmin.get(b.group) || a.t - b.t || String(a.id).localeCompare(String(b.id)));
  const cutAt = (arr, share) => { const target = Math.floor(arr.length * share); let i = target; while (i < arr.length && i > 0 && gmin.get(arr[i].group) === gmin.get(arr[i - 1].group) && arr[i].group === arr[i - 1].group) i++; return i; };
  const iDev = cutAt(sorted, 1 - holdoutShare), dev = sorted.slice(0, iDev), holdout = sorted.slice(iDev);
  const chunks = []; let start = 0;
  for (let k = 1; k <= folds + 1; k++) { let end = k === folds + 1 ? dev.length : Math.floor((dev.length * k) / (folds + 1)); while (end < dev.length && end > start && dev[end].group === dev[end - 1].group) end++; chunks.push(dev.slice(start, end)); start = end; }
  const out = []; for (let i = 0; i < folds; i++) { const train = chunks.slice(0, i + 1).flat(), val = chunks[i + 1] ?? []; if (train.length >= LEARNING.minSegment && val.length) out.push({ train, val }); }
  return { dev, holdout, folds: out, gmin };
}

/** Garanzia anti-contaminazione: nessun gruppo in comune e adattamento interamente anteriore alla valutazione. */
export function assertNoLeakage(train, val, gmin) {
  const g = new Set(train.map((r) => r.group)); for (const r of val) if (g.has(r.group)) throw new Error(`Contaminazione: il gruppo ${r.group} compare sia nell'adattamento sia nella valutazione`);
  const tMax = Math.max(...train.map((r) => gmin.get(r.group))), vMin = Math.min(...val.map((r) => gmin.get(r.group)));
  if (tMax > vMin) throw new Error("Contaminazione: l'adattamento contiene dati posteriori all'inizio della valutazione");
  return true;
}

const evalPaired = (recs, base, cand, opts) => {
  const pb = recs.map(base), pcand = recs.map(cand), bl = recs.map((r) => r.block);
  const dLL = recs.map((r, i) => lossLog(pb[i], r.y) - lossLog(pcand[i], r.y)), dBr = recs.map((r, i) => lossBrier(pb[i], r.y) - lossBrier(pcand[i], r.y));   // > 0 = il candidato è migliore
  const bb = calibrationBins(recs.map((r, i) => ({ ...r, p: pb[i] }))), cb = calibrationBins(recs.map((r, i) => ({ ...r, p: pcand[i] })));
  return { n: recs.length, blocks: new Set(bl).size, logLossGain: blockMean(dLL, bl, opts), brierGain: blockMean(dBr, bl, opts), baseline: { logLoss: r4(mean(recs.map((r, i) => lossLog(pb[i], r.y)))), brier: r4(mean(recs.map((r, i) => lossBrier(pb[i], r.y)))), ece: ece(bb, recs.length) }, candidate: { logLoss: r4(mean(recs.map((r, i) => lossLog(pcand[i], r.y)))), brier: r4(mean(recs.map((r, i) => lossBrier(pcand[i], r.y)))), ece: ece(cb, recs.length) } };
};

/** Fase di sviluppo di un candidato: walk-forward, previsioni fuori campione raccolte e confrontate con la base sulle stesse osservazioni. */
function developCandidate(records, spec, split, opts) {
  const cand = CANDIDATES[spec.candidate], oos = [], oosCand = [], foldRows = [];
  for (const [i, f] of split.folds.entries()) {
    assertNoLeakage(f.train, f.val, split.gmin);
    const model = cand.fit(f.train, spec.params ?? {}), pcs = f.val.map((r) => model.predict(r));
    f.val.forEach((r, j) => { oos.push(r); oosCand.push(pcs[j]); });
    const d = mean(f.val.map((r, j) => lossLog(r.p, r.y) - lossLog(pcs[j], r.y)));
    foldRows.push({ fold: i + 1, trainN: f.train.length, valN: f.val.length, trainPeriod: period(f.train), valPeriod: period(f.val), logLossGain: r4(d), params: model.params });
  }
  const map = new Map(oos.map((r, i) => [r, oosCand[i]]));
  const cmp = oos.length ? evalPaired(oos, (r) => r.p, (r) => map.get(r), opts) : null;
  return { cmp, folds: foldRows, improvedShare: foldRows.length ? foldRows.filter((x) => x.logLossGain > 0).length / foldRows.length : 0 };
}

const stamp = (s) => (s == null ? null : r4(s));
/** Esegue un set di esperimenti su un insieme di record dello stesso sport. Restituisce i record completi degli esperimenti. */
export function runLab(records, { sport, specs = defaultSpecs(sport, records), now = Date.now(), reps = LEARNING.reps, holdoutShare = LAB.holdoutShare, folds = LAB.folds, diagnosis = null } = {}) {
  const recs = records.filter((r) => r.sport === sport && r.prospective !== false), opts = { reps }, dsFp = fingerprint(recs);
  if (recs.length < LEARNING.minSegment * 3) return { experiments: [], hypotheses: proposeHypotheses(diagnosis), note: "Dati insufficienti per un'analisi walk-forward: nessun esperimento eseguito." };
  const split = splitTime(recs, { holdoutShare, folds }), starting = Object.entries(recs.reduce((m, r) => ((m[r.version ?? "n.d."] = (m[r.version ?? "n.d."] ?? 0) + 1), m), {})).map(([version, n]) => ({ version, n }));
  const dev = specs.map((spec) => ({ spec, res: developCandidate(recs, spec, split, opts) }));
  const adj = holm(dev.map((d) => d.res.cmp?.logLossGain.p ?? 1));
  const passes = dev.map((d, i) => { const c = d.res.cmp; return !!c && c.n >= LEARNING.minSample && c.blocks >= LEARNING.minBlocks && c.logLossGain.lo > 0 && adj[i] < LEARNING.alpha && d.res.improvedShare >= LAB.minFoldsShare; });
  // Holdout: si sceglie UN solo candidato (il migliore tra quelli che hanno superato lo sviluppo, a parità il p più basso) e lo si valuta UNA volta sul tratto finale
  // tenuto fuori, adattandolo sull'intero sviluppo. Gli altri non toccano l'holdout (nessuna scelta sull'holdout, nessun test multiplo).
  const hold = new Array(dev.length).fill(null);
  let pick = -1; dev.forEach((d, i) => { if (passes[i] && (pick < 0 || d.res.cmp.logLossGain.est > dev[pick].res.cmp.logLossGain.est)) pick = i; });
  if (pick >= 0) { assertNoLeakage(split.dev, split.holdout, split.gmin); const model = CANDIDATES[dev[pick].spec.candidate].fit(split.dev, dev[pick].spec.params ?? {}), pcs = new Map(split.holdout.map((r) => [r, model.predict(r)])); hold[pick] = { model, cmp: split.holdout.length ? evalPaired(split.holdout, (r) => r.p, (r) => pcs.get(r), opts) : null }; }
  const holdAdj = hold.map((h) => (h?.cmp ? h.cmp.logLossGain.p : null));
  const experiments = dev.map((d, i) => {
    const c = d.res.cmp, h = hold[i], reasons = []; let status;
    const devOk = c && c.n >= LEARNING.minSample && c.blocks >= LEARNING.minBlocks;
    if (!devOk) { status = "non_conclusivo"; reasons.push(`Campione di sviluppo insufficiente (${c?.n ?? 0} osservazioni, ${c?.blocks ?? 0} blocchi; servono ${LEARNING.minSample} e ${LEARNING.minBlocks}).`); }
    else if (c.logLossGain.hi < 0) { status = "peggiore"; reasons.push("Il candidato peggiora la log loss fuori campione (intervallo interamente sotto zero)."); }
    else if (!passes[i]) { status = "non_validato"; reasons.push("Nessuna evidenza di miglioramento sufficiente fuori campione (intervallo che comprende lo zero, p corretto non significativo o instabilità tra i fold)."); }
    else if (!h) { status = "non_validato"; reasons.push("Ha superato lo sviluppo ma non è il candidato scelto per la conferma: l'holdout viene usato una sola volta, dal migliore."); }
    else if (!h?.cmp || h.cmp.n < LEARNING.minSample || h.cmp.blocks < LEARNING.minBlocks) { status = "non_conclusivo"; reasons.push(`Holdout insufficiente per confermare (${h?.cmp?.n ?? 0} osservazioni, ${h?.cmp?.blocks ?? 0} blocchi).`); }
    else if (h.cmp.logLossGain.hi < 0) { status = "peggiore"; reasons.push("Sul tratto finale tenuto fuori il candidato peggiora."); }
    else if (h.cmp.logLossGain.lo > 0 && holdAdj[i] < LEARNING.alpha && h.cmp.candidate.ece <= h.cmp.baseline.ece + LAB.eceTolerance) { status = "validato_storico"; reasons.push("Migliora su sviluppo (walk-forward) e sul tratto finale tenuto fuori, con taratura non peggiore. Non adottato: richiede validazione prospettica separata."); }
    else { status = "non_validato"; reasons.push("Non confermato dal tratto finale tenuto fuori (intervallo che comprende lo zero, p corretto non significativo o taratura peggiore)."); }
    const id = hash128(JSON.stringify([LEARNING.version, sport, d.spec, dsFp, LEARNING.seed, reps, holdoutShare, folds])).slice(0, 16);
    return { id, sport, createdAt: new Date(now).toISOString(), engine: LEARNING.version, baseVersion: starting, change: { candidate: d.spec.candidate, label: CANDIDATES[d.spec.candidate].label, request: d.spec.params ?? {}, appliedToOperationalModel: false },
      dataset: { fingerprint: dsFp, n: recs.length, period: period(recs), source: "registri di previsione già esistenti (sola lettura)", excluded: "previsioni ricostruite a posteriori" },
      design: { type: "walk-forward a finestra espansa + holdout cronologico", folds: split.folds.length, holdoutShare, seed: LEARNING.seed, reps, correction: "Holm sui candidati provati (sviluppo); un solo candidato confermato sull'holdout", candidatesTried: dev.length },
      training: { period: period(split.dev), n: split.dev.length }, validation: { period: c ? period(split.folds.flatMap((f) => f.val)) : null, n: c?.n ?? 0, blocks: c?.blocks ?? 0 }, folds: d.res.folds,
      metrics: c ? { baseline: c.baseline, candidate: c.candidate } : null, comparison: c ? { logLossGain: c.logLossGain, brierGain: c.brierGain, adjustedP: adj[i], foldsImproved: r4(d.res.improvedShare) } : null,
      holdout: h ? { evaluated: true, selected: true, n: h.cmp?.n ?? 0, blocks: h.cmp?.blocks ?? 0, period: period(split.holdout), params: h.model.params, metrics: h.cmp ? { baseline: h.cmp.baseline, candidate: h.cmp.candidate } : null, logLossGain: h.cmp?.logLossGain ?? null, brierGain: h.cmp?.brierGain ?? null, adjustedP: stamp(holdAdj[i]) } : { evaluated: false, n: split.holdout.length, period: period(split.holdout), reason: passes[i] ? "Non valutato: superato lo sviluppo ma non scelto per la conferma (l'holdout resta intatto)." : "Non valutato: il candidato non ha superato lo sviluppo (l'holdout resta intatto)." },
      verdict: { status, reasons }, limits: ["Sperimenta solo ricalibrazioni delle probabilità già prodotte; non esegue il modello con parametri diversi.", "Le previsioni della stessa partita non sono indipendenti: intervalli a blocchi.", "Un esito storico non prova un vantaggio futuro: serve una validazione prospettica separata.", `Candidati provati: ${dev.length}; il p è corretto con Holm.`] };
  });
  return { experiments, hypotheses: proposeHypotheses(diagnosis), design: { devN: split.dev.length, holdoutN: split.holdout.length, folds: split.folds.length } };
}

export function defaultSpecs(sport, records) {
  const specs = [{ candidate: "temperature" }, { candidate: "platt" }, { candidate: "shrink" }];
  if (CANDIDATES.market_blend.requires(records.filter((r) => r.sport === sport))) specs.push({ candidate: "market_blend" });
  specs.push({ candidate: "segment_offset", params: { dim: sport === "tennis" ? "surface" : "market" } });
  return specs;
}

/** Ipotesi (NON cause accertate) derivate dalle anomalie; ciascuna indica quale candidato del laboratorio la mette alla prova. */
export function proposeHypotheses(diagnosis) {
  if (!diagnosis?.available) return [];
  const out = [], add = (a, statement, candidate) => out.push({ id: hash128(`${a.id}|${candidate ?? "none"}`).slice(0, 12), anomalyId: a.id, sport: a.sport, status: "da verificare", statement, candidate: candidate ?? null });
  for (const a of diagnosis.anomalies) {
    if (a.type === "calibration_slope") add(a, "Una ricalibrazione della confidenza (temperatura o Platt) potrebbe ridurre la sovra/sotto-confidenza.", a.evidence.slope < 1 ? "temperature" : "platt");
    else if (a.type === "calibration_intercept" || a.type === "bin_bias") add(a, "Una contrazione verso il tasso base potrebbe correggere lo scarto medio.", "shrink");
    else if (a.type === "segment_gap") add(a, `Uno scostamento specifico per «${a.evidence.dimension}» potrebbe correggere la perdita più alta del gruppo «${a.evidence.group}».`, "segment_offset");
    else if (a.type === "source_divergence") add(a, "Una miscela con la quota normalizzata potrebbe sfruttare informazione che il modello non usa.", "market_blend");
    else if (a.type === "missing_data_effect") add(a, "La differenza potrebbe dipendere da partite meno documentate: verificare la qualità e la disponibilità del dato (nessun candidato di ricalibrazione specifico).", null);
    else if (a.type === "performance_degradation") add(a, "Un peggioramento recente potrebbe richiedere finestre di valutazione più brevi e un controllo delle versioni (non ancora sperimentabile in questa fase).", null);
  }
  return out;
}

/** Registro append-only: i record esistenti non cambiano mai; un id già presente con contenuto diverso è un errore. */
export const logEntry = (e) => ({ id: e.id, sport: e.sport, createdAt: e.createdAt, engine: e.engine, candidate: e.change.candidate, request: e.change.request, baseVersion: e.baseVersion, dataset: { fingerprint: e.dataset.fingerprint, n: e.dataset.n, period: e.dataset.period }, training: e.training, validation: { n: e.validation.n, blocks: e.validation.blocks, period: e.validation.period }, holdout: { evaluated: e.holdout.evaluated, n: e.holdout.n }, metrics: e.metrics, comparison: e.comparison, holdoutGain: e.holdout.evaluated ? e.holdout.logLossGain : null, verdict: e.verdict, limits: e.limits });
export function mergeLog(existing, incoming) {
  const out = (existing ?? []).slice(), byId = new Map(out.map((e) => [e.id, e]));
  for (const e of incoming) {
    const entry = logEntry(e), old = byId.get(entry.id);
    if (!old) { out.push(entry); byId.set(entry.id, entry); continue; }
    const strip = (x) => JSON.stringify({ ...x, createdAt: undefined });
    if (strip(old) !== strip(entry)) throw new Error(`Registro immutabile: l'esperimento ${entry.id} esiste già con un contenuto diverso`);
  }
  return out;
}
