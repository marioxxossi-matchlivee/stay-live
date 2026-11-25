/**
 * Stay Live — CONTINUOUS LEARNING: costruzione del REPORT (puro). Unisce adattatori, diagnostica e laboratorio.
 * Input: righe già lette dai registri esistenti (sola lettura). Output: un oggetto JSON versionato, senza dati inventati.
 */
import { LEARNING } from "./_learning-core.js";
import { tennisRecords, footballRecords, sourceUsage } from "./_learning-adapters.js";
import { diagnose } from "./_learning-diagnostics.js";
import { runLab, mergeLog } from "./_learning-lab.js";

export const REPORT_SCHEMA = "learning-report-v1";

function sportSection(sport, adapted, { now, reps, lab, since }) {
  const recs = adapted.records.filter((r) => (since == null ? true : r.t >= since));
  const diagnosis = diagnose(recs, { sport, reps }), usage = recs.length ? sourceUsage(recs) : null;
  const labOut = lab && diagnosis.available ? runLab(recs, { sport, now, reps, diagnosis }) : { experiments: [], hypotheses: [], note: lab ? "Nessuna previsione da sperimentare." : "Laboratorio non eseguito (--no-lab)." };
  return { sport, skipped: adapted.skipped, analyzed: recs.length, diagnosis, usage, lab: labOut };
}

/** inputs: { tennis?: {predictions, results}, football?: {rows} }; previousLog = registro esperimenti già presente (append-only). */
export function buildReport(inputs, { now = Date.now(), reps = LEARNING.reps, lab = true, since = null, previousLog = [], sourceKind = "supabase", includeReconstructed = false } = {}) {
  const sports = {};
  if (inputs.tennis) sports.tennis = sportSection("tennis", tennisRecords(inputs.tennis.predictions, inputs.tennis.results), { now, reps, lab, since });
  if (inputs.football) sports.football = sportSection("football", footballRecords(inputs.football.rows, { includeReconstructed }), { now, reps, lab, since });
  const newExperiments = Object.values(sports).flatMap((s) => s.lab.experiments), experimentLog = mergeLog(previousLog, newExperiments);
  const anomalies = Object.values(sports).flatMap((s) => s.diagnosis.anomalies ?? []), byVerdict = {};
  for (const e of experimentLog) byVerdict[e.verdict.status] = (byVerdict[e.verdict.status] ?? 0) + 1;
  return { schema: REPORT_SCHEMA, status: "ok", generatedAt: new Date(now).toISOString(), engine: LEARNING.version,
    source: { kind: sourceKind, readOnly: true, note: "Registri di previsione esistenti letti in sola lettura; nessuna scrittura sul database; nessun modello operativo modificato." },
    params: { minSample: LEARNING.minSample, minBlocks: LEARNING.minBlocks, minSegment: LEARNING.minSegment, reps, seed: LEARNING.seed, alpha: LEARNING.alpha, since: since == null ? null : new Date(since).toISOString() },
    overview: { predictionsAnalyzed: Object.fromEntries(Object.entries(sports).map(([k, s]) => [k, s.analyzed])), anomalies: { total: anomalies.length, detected: anomalies.filter((a) => a.status === "rilevata").length, weak: anomalies.filter((a) => a.status !== "rilevata").length, byType: anomalies.reduce((m, a) => ((m[a.type] = (m[a.type] ?? 0) + 1), m), {}) }, experiments: { total: experimentLog.length, thisRun: newExperiments.length, byVerdict } },
    sports, experimentLog };
}
