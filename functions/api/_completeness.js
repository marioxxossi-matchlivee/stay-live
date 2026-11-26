/**
 * Stato di completezza dei dati di una partita (funzione pura, nessuna richiesta).
 * Determinato dai requisiti reali del motore di analisi: storico (consiglio), pronostico API-Football, quote del mercato, corner.
 *   complete | partial | waiting (quote non ancora pubblicate) | updating (recupero in corso) | error
 * Non modifica il modello, la logica EV o le soglie: decide solo SE mostrare l'opportunità BET (`betOk`).
 */
import { emptyRecheckMs } from "./_policy.js";
import { FEATURES } from "./_features.js";

const MIN = 60e3;
const FAR_MS = 3 * 3600e3;
/** 'ok' presente · 'waiting' richiesta in coda/rimandata · 'missing' non ancora disponibile · 'na' non previsto dal provider · 'error' errore di acquisizione */
export function partState(raw, { far = false } = {}) {
  if (raw === "used") return "ok";
  if (raw === "waiting") return "waiting";
  if (raw === "none") return far ? "missing" : "na";
  if (raw === "error") return "error";
  return far ? "missing" : "na";            // vicino al fischio senza dati: il provider non li ha (non è un guasto)
}

export function completenessOf({ now = Date.now(), kickoff, odds, predictions, stats, corners, tasks = [], updating = false }) {
  const ko = Date.parse(kickoff), far = ko - now > FAR_MS;
  const parts = {
    odds: partState(odds, { far }), predictions: partState(predictions, { far }),
    stats: stats ? "ok" : "missing", corners: partState(corners, { far }),
  };
  const hasErr = tasks.some((t) => t.state === "error") || Object.values(parts).includes("error");
  const retrying = updating || tasks.some((t) => t.state === "temporary") || Object.values(parts).includes("waiting");
  const need = FEATURES.corners ? ["odds", "predictions", "stats", "corners"] : ["odds", "predictions", "stats"];
  const missing = need.filter((k) => parts[k] === "missing" || parts[k] === "error" || parts[k] === "waiting");
  let status = "complete";
  if (hasErr) status = "error";
  else if (retrying && missing.length) status = "updating";
  else if (missing.length === 1 && missing[0] === "odds") status = "waiting";
  else if (missing.length) status = "partial";
  const nextTry = tasks.map((t) => Date.parse(t.next_try_at)).filter(Number.isFinite).sort((a, b) => a - b)[0]
    ?? (missing.length ? now + Math.max(emptyRecheckMs(ko - now), 20 * MIN) : null);
  return {
    status, parts,
    betOk: ["ok", "na"].includes(parts.odds) && ["ok", "na"].includes(parts.predictions) && parts.stats === "ok",   // requisiti minimi per mostrare un BET
    publishOk: parts.odds === "ok" && ["ok", "na"].includes(parts.predictions) && parts.stats === "ok",   // pronostico pubblicato solo con quote reali, statistiche e (se previsto dal provider) pronostico API-Football
    nextTryAt: nextTry ? new Date(nextTry).toISOString() : null,
  };
}
