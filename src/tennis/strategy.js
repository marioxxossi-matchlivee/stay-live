// Stay Live Tennis — «Strategia»: cruscotto di analisi statistica e controllo del modello (logica PURA, nessun DOM: si testa con node --test).
// Fonte unica dei dati: il registro LIVE OBSERVATION (valutazioni registrate PRIMA dell'inizio, confrontate coi risultati). Nessuna indicazione di gioco,
// nessuna puntata, nessuna classe: solo quanto il modello si comporta sulle partite osservate e quanto sono affidabili i dati.
import { prospectiveMetrics, OBSERVATION } from "../../functions/api/_tennis-observation.js";
import { buildModel } from "./observation.js";

export const STRATEGY_TABS = [["overview", "Panoramica"], ["tours", "ATP · WTA"], ["surfaces", "Superfici"], ["calibration", "Calibrazione"], ["integrity", "Integrità"]];
export const DEFAULT_STRATEGY = Object.freeze({ tab: "overview" });
export const sanitizeTab = (t) => (STRATEGY_TABS.some(([k]) => k === t) ? t : DEFAULT_STRATEGY.tab);

/** Stati ammessi per ogni risultato mostrato. La mancanza di evidenza NON è mai presentata come evidenza positiva. */
export const STATUS = {
  validated: { label: "Validato", icon: "shield-check", hint: "Evidenza sufficiente e confronto con il mercato superato." },
  not_validated: { label: "Non validato", icon: "x-circle", hint: "Campione sufficiente, ma il risultato non è distinguibile dal caso." },
  observing: { label: "In osservazione", icon: "pulse", hint: "Dati in raccolta o campione sufficiente senza confronto con il mercato: nessuna conclusione." },
  insufficient: { label: "Campione insufficiente", icon: "hourglass", hint: "Troppo pochi casi o troppo pochi blocchi indipendenti." },
  unavailable: { label: "Non disponibile", icon: "prohibit", hint: "Nessun dato registrato per questo gruppo." },
};
export const COIN_FLIP = { brier: 0.25, logLoss: Math.LN2 };   // previsione costante al 50%: riferimento minimo da battere

/**
 * Stato di validazione di un gruppo. `m` = prospectiveMetrics del gruppo; `total` = osservazioni registrate nel gruppo.
 * «validated» richiede un confronto con il mercato (Δ log loss con intervallo > 0 e Holm < 0,05, come da protocollo): il registro prospettico non
 * contiene ancora quote al momento della previsione, quindi `marketComparison` non esiste e nessun gruppo può risultare «Validato».
 */
export function validationStatus(m, total, marketComparison = null) {
  if (!total) return "unavailable";
  if (!m || m.valid === 0) return "observing";
  if (!m.sufficient) return "insufficient";
  if (marketComparison && marketComparison.ciLow > 0 && marketComparison.holm < 0.05) return "validated";
  const better = m.logLoss?.hi != null && m.logLoss.hi < COIN_FLIP.logLoss;
  return better ? "observing" : "not_validated";
}

const SURFACES = [["hard", "Cemento"], ["clay", "Terra"], ["grass", "Erba"]];
const toItem = (i) => ({ initial: i.initial, state: i.state, winner: i.winner, startsAt: i.startsAt, tournamentId: i.tournamentId, tournament: i.tournament });
const WAITING = new Set(["upcoming", "live", "awaiting_result"]);

function group(items) {
  const m = prospectiveMetrics(items.map(toItem)), status = validationStatus(m, items.length);
  return { total: items.length, concluded: items.filter((i) => i.state === "concluded").length, metrics: m, status };
}
const pct1 = (a, b) => (b ? a / b : null);

/** Dall'API di LIVE OBSERVATION al modello del cruscotto. `loading` = caricamento in corso; `progress` = {loaded,total}. */
export function buildDashboard(payload, now = Date.now()) {
  const model = buildModel(payload, now);
  if (!model.available) return { available: false, reason: model.reason, diagnostics: model.diagnostics };
  const items = model.items, all = group(items), m = all.metrics;
  const waiting = items.filter((i) => WAITING.has(i.state)).length, late = items.filter((i) => i.state === "awaiting_result" && now - Date.parse(i.startsAt) > 24 * 36e5);
  const complete = items.filter((i) => !i.incomplete).length;
  const diag = model.diagnostics ?? null, lastRec = items.flatMap((i) => i.versions.map((v) => v.recorded_at)).sort().at(-1) ?? null;
  const tours = ["atp", "wta"].map((t) => ({ key: t, label: t.toUpperCase(), ...group(items.filter((i) => i.obs.tour === t)) }));
  const surfaces = SURFACES.map(([k, label]) => ({ key: k, label, ...group(items.filter((i) => i.obs.surface === k)) }));
  const noSurface = items.filter((i) => !SURFACES.some(([k]) => k === i.obs.surface)).length;
  const versions = items.flatMap((i) => i.versions);
  const integrity = {
    missing: Object.entries(m.missingData).sort((a, b) => b[1] - a[1]), withMissing: items.filter((i) => (i.initial?.missing ?? []).length > 0).length,
    abstained: items.filter((i) => i.initial && !i.initial.published).length, noInitial: items.filter((i) => !i.initial).length, excluded: m.excluded,
    awaitingLate: late.length, backdated: versions.filter((v) => Date.parse(v.recorded_at) >= Date.parse(v.starts_at)).length, rescheduled: versions.filter((v) => v.reason === "rescheduled").length,
    identity: items.filter((i) => i.state === "identity_mismatch").length, noSurface,
    sync: { enabled: diag?.enabled ?? null, error: diag?.error ?? null, blocked: diag?.blocked ?? null, lastOk: diag?.lastOk ?? null, newObservations: diag?.newObservations ?? null, newVersions: diag?.newVersions ?? null, unavailable: !!diag?.unavailable },
  };
  return {
    available: true, complete: model.complete, loaded: items.length, total: model.total ?? items.length,
    overview: { total: items.length, concluded: all.concluded, waiting, valid: m.valid, blocks: m.blocks, sufficient: m.sufficient, status: all.status, minSample: m.minSample, minBlocks: m.minBlocks,
      quality: pct1(complete, items.length), lastUpdate: lastRec ?? diag?.lastOk ?? null, brier: m.brier, logLoss: m.logLoss },
    all, tours, surfaces, calibration: { ...m.calibration, valid: m.valid, status: all.status, sufficient: m.sufficient, blocks: m.blocks }, integrity,
  };
}

export { OBSERVATION };
