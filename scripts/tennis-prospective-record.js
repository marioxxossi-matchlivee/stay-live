/**
 * Stay Live Tennis — VALIDAZIONE PROSPETTICA: struttura del record e controlli, SOLO LOCALI (funzioni pure, nessuna rete, nessun database).
 * Non crea tabelle, non scrive nulla, non è importata dal motore. Serve a fissare e a testare il formato che, dopo una DECISIONE SEPARATA,
 * verrebbe registrato al momento della previsione. Specifica e piano: docs/VALIDAZIONE-PROSPETTICA-TENNIS.md.
 */
import { createHash } from "node:crypto";
import { noVig } from "../functions/api/_tennis-bet.js";

export const RECORD_VERSION = 1;
const ts = (x) => (x == null ? NaN : Date.parse(x));
const pos = (x) => Number.isFinite(Number(x)) && Number(x) > 1;
/** Versione dei rating = impronta di (numero partite, ultima data, percorso di caricamento): identifica COSA il motore sapeva al momento della previsione. */
export const ratingsVersion = ({ historyMatches, lastMatchAt, loader }) => createHash("sha256").update(`${historyMatches}|${lastMatchAt}|${loader}`).digest("hex").slice(0, 16);

/** Crea il record al momento della previsione. quote = { odds1, odds2, bookmaker, source, quotedAt } disponibile ORA (mai la quota di chiusura). */
export function buildForecastRecord({ match, p1, published, modelVersion, ratings, predictedAt, quote = null }) {
  const nv = quote && pos(quote.odds1) && pos(quote.odds2) ? noVig(Number(quote.odds1), Number(quote.odds2)) : null;
  return {
    recordVersion: RECORD_VERSION, matchKey: match.match_key, p1Id: match.p1_id, p2Id: match.p2_id, startsAt: match.starts_at, predictedAt, modelVersion, ratingsVersion: ratings ? ratingsVersion(ratings) : null,
    published: !!published, p1: published ? p1 : null,
    market: quote ? { odds1: Number(quote.odds1), odds2: Number(quote.odds2), bookmaker: quote.bookmaker ?? null, source: quote.source ?? null, quotedAt: quote.quotedAt ?? null, noVigP1: nv ? nv.p1 : null, margin: nv ? 1 / Number(quote.odds1) + 1 / Number(quote.odds2) - 1 : null } : null,
    closing: null, outcome: null, settledAt: null,
  };
}
/** Controlli di integrità temporale: restituisce l'elenco dei problemi (vuoto = valido). */
export function validateForecastRecord(r) {
  const e = [];
  for (const k of ["matchKey", "p1Id", "p2Id", "startsAt", "predictedAt", "modelVersion"]) if (r?.[k] == null || r[k] === "") e.push(`campo mancante: ${k}`);
  if (r?.published && !(r.p1 > 0 && r.p1 < 1)) e.push("probabilità fuori da (0,1)");
  if (r?.published === false && r.p1 != null) e.push("previsione non pubblicata con probabilità valorizzata");
  if (ts(r?.predictedAt) >= ts(r?.startsAt)) e.push("previsione registrata a partita iniziata (look-ahead)");
  if (r?.market) { if (!pos(r.market.odds1) || !pos(r.market.odds2)) e.push("quote non valide"); if (r.market.quotedAt == null) e.push("quota senza timestamp"); else if (ts(r.market.quotedAt) > ts(r.predictedAt)) e.push("quota successiva alla previsione (disallineamento temporale)"); if (!r.market.bookmaker && !r.market.source) e.push("quota senza fonte né bookmaker"); }
  if (r?.closing) { if (!pos(r.closing.odds1) || !pos(r.closing.odds2)) e.push("quote di chiusura non valide"); if (ts(r.closing.at) < ts(r.predictedAt)) e.push("chiusura precedente alla previsione"); }
  if (r?.outcome != null) { if (![1, 2].includes(r.outcome)) e.push("esito non valido"); if (!(ts(r.settledAt) >= ts(r.startsAt))) e.push("esito registrato prima dell'inizio"); }
  return e;
}
/** Chiude il record con quota di chiusura ed esito, senza poter alterare ciò che era stato registrato alla previsione (restituisce una copia). */
export function settleForecastRecord(r, { winner, settledAt, closing = null }) {
  if (r.outcome != null) throw new Error("Record già chiuso: l'esito non si riscrive.");
  const out = { ...r, closing: closing ? { odds1: Number(closing.odds1), odds2: Number(closing.odds2), at: closing.at ?? null } : r.closing, outcome: winner, settledAt };
  const problems = validateForecastRecord(out); if (problems.length) throw new Error(`Record non valido: ${problems.join("; ")}`);
  return out;
}
