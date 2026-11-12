/**
 * Stay Live Tennis — adattatore del provider SportsAPI365 (Direct). Traduce le risposte REALI (campioni della sonda del 12/11/2026)
 * in righe uniformi per le tabelle tennis_*. Nessuna chiave qui: la chiave si usa solo nel client server-side.
 * Regole: nessun campo inventato; ciò che il provider non dà resta null e viene dichiarato "mancante".
 * Isolato dal calcio: non importa nulla di calcistico.
 */
export const TENNIS_BASE = "https://api.sportsapi365.com/v1/tennis";
export const TOURS = ["atp", "wta"]; // per il provider: atp = tennis maschile (Slam, Tour, Challenger, ITF), wta = femminile (idem). NON esiste "itf".

const num = (v) => { const n = typeof v === "string" ? Number(v.replace(",", ".")) : v; return Number.isFinite(n) ? n : null; };
const idOf = (v) => (v === null || v === undefined || v === "" ? null : String(v));
/** Quota decimale valida (> 1). Tutto il resto = nessuna quota (mai stimata). */
export const validOdd = (v) => { const n = num(v); return n !== null && n > 1 ? n : null; };
const isoOrNull = (v) => { const t = Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString() : null; };

/**
 * Categoria dal livello del provider (rankId) e dal nome del torneo. Nel livello 1 Challenger e ITF sono UNITI dal provider:
 * si separano solo col nome ("Challenger", "M25", "W35"); se il nome non basta resta "challenger_itf" (mai forzato).
 */
export function classifyCategory(rankId, tournamentName) {
  const name = String(tournamentName ?? "");
  if (/challenger/i.test(name)) return "challenger";
  if (/^\s*[MW]\d{2,3}\b/i.test(name)) return "itf";
  const r = Number(rankId);
  if (r === 0) return "itf";
  if (r === 1) return "challenger_itf";
  if (Number.isFinite(r) && r >= 2) return "tour";
  return "unknown";
}

/** Chiave STABILE e indipendente dall'ordine dei giocatori (nei risultati player1 è il vincitore, nel programma no). */
export function canonicalMatchKey(tournamentId, roundId, idA, idB) {
  const [lo, hi] = [String(idA), String(idB)].sort((x, y) => (Number(x) - Number(y)) || x.localeCompare(y));
  return `${tournamentId}|${roundId}|${lo}|${hi}`;
}

const isDoubles = (row) => Array.isArray(row?.player1?.members) || Array.isArray(row?.player2?.members) || /\//.test(`${row?.player1?.name ?? ""}${row?.player2?.name ?? ""}`);

function baseRow(tour, tournament, t, p1, p2, round, bestOf) {
  const lowFirst = Number(p1.id) <= Number(p2.id);
  const [a, b] = lowFirst ? [p1, p2] : [p2, p1]; // ordine canonico: id minore = giocatore 1 (nessun bias di posizione nello storico)
  return { swapped: !lowFirst, a, b, row: {
    tour, tournament_id: idOf(tournament?.id), tournament: tournament?.name ?? null, round_id: round ?? null,
    level_id: Number.isFinite(Number(tournament?.rankId)) ? Number(tournament.rankId) : null,
    category: classifyCategory(tournament?.rankId, tournament?.name),
    best_of: bestOf, starts_at: t,
    p1_id: a.id, p2_id: b.id, p1_name: a.name ?? null, p2_name: b.name ?? null,
  } };
}

/** Riga del PROGRAMMA (upcoming/matches/{atp|wta}). Restituisce null se non è un singolare valido. */
export function normalizeUpcoming(row, tour) {
  if (!row || isDoubles(row)) return null;
  const p1 = row.player1, p2 = row.player2, t = isoOrNull(row.date);
  if (!p1?.id || !p2?.id || !t || !row.tournament?.id) return null;
  const P = (p) => ({ id: String(p.id), name: p.name ?? null, country: p.countryAcr ?? null, seed: p.seed ?? null, odd: validOdd(p.odd) });
  const A = P(p1), B = P(p2);
  const { swapped, a, b, row: out } = baseRow(tour, row.tournament, t, A, B, row.roundId, null); // il programma NON dà il formato (3/5 set)
  const sources = [];
  if (a.odd && b.odd) sources.push({ book: String(p1.oddBookmaker ?? "Marathonbet"), p1: a.odd, p2: b.odd });
  const o = row.odds;
  if (o && validOdd(o.k1) && validOdd(o.k2) && o.id1_o && o.id2_o) { // Pinnacle: k1 → id1_o, k2 → id2_o (si mappa per ID, non per posizione)
    const byId = { [String(o.id1_o)]: validOdd(o.k1), [String(o.id2_o)]: validOdd(o.k2) };
    if (byId[a.id] && byId[b.id]) sources.push({ book: String(o.bookmaker ?? "Pinnacle"), p1: byId[a.id], p2: byId[b.id] });
  }
  const court = row.court ?? row.tournament?.court?.name ?? null;
  const status = row.startTimeStatus === "scheduled" ? "scheduled" : "unknown"; // altri valori non ancora osservati: non si interpretano
  return {
    ...out, match_key: canonicalMatchKey(out.tournament_id, row.roundId, a.id, b.id), provider_id: idOf(row.matchId ?? row.id),
    live_match_id: idOf(row.liveMatchId), surface: court, status, winner: null, score: null, result_type: null,
    p1_country: a.country, p2_country: b.country, p1_seed: a.seed, p2_seed: b.seed,
    odds_sources: sources, // [{book, p1, p2}] riferiti all'ordine canonico; vuoto = nessuna quota
    h2h: row.h2hSummary ? { matches: row.h2hSummary.matchCount ?? null, p1Wins: swapped ? row.h2hSummary.player2Wins ?? null : row.h2hSummary.player1Wins ?? null, p2Wins: swapped ? row.h2hSummary.player1Wins ?? null : row.h2hSummary.player2Wins ?? null } : null,
  };
}

/**
 * Riga dei RISULTATI (/{atp|wta}/results/{data}): player1 = VINCITORE, player2 = sconfitto. Il vincitore si lega all'ID, mai alla posizione.
 * Solo result_type "completed" è una vittoria normale; ogni altro valore (ritiro, walkover… non ancora osservati) NON registra un vincitore.
 */
export function normalizeResult(row, tour) {
  if (!row || isDoubles(row)) return null;
  const p1 = row.player1, p2 = row.player2, t = isoOrNull(row.date);
  const id1 = idOf(row.player1Id ?? p1?.id), id2 = idOf(row.player2Id ?? p2?.id);
  if (!id1 || !id2 || !t || !row.tournament?.id) return null;
  const A = { id: id1, name: p1?.name ?? null }, B = { id: id2, name: p2?.name ?? null };
  const bo = Number(row.best_of);
  const { a, b, row: out } = baseRow(tour, row.tournament, t, A, B, row.roundId, bo === 3 || bo === 5 ? bo : null);
  const normal = row.result_type === "completed";
  const wid = idOf(row.match_winner);
  const winner = normal && wid ? (wid === a.id ? 1 : wid === b.id ? 2 : null) : null;
  return {
    ...out, match_key: canonicalMatchKey(out.tournament_id, row.roundId, a.id, b.id), provider_id: idOf(row.matchId ?? row.id),
    live_match_id: idOf(row.matchKey), surface: null, // la riga dei risultati non riporta la superficie: si completa dal programma/torneo
    status: normal && winner ? "finished" : "unknown", winner, score: row.result ?? null, result_type: row.result_type ?? null,
  };
}

/** Estrae l'elenco da una risposta paginata (programma: `matches`, risultati: `data`). Risposta inattesa → elenco vuoto + motivo. */
export function readPage(body) {
  if (!body || typeof body !== "object") return { items: [], hasNext: false, problem: "risposta non valida" };
  const items = Array.isArray(body.matches) ? body.matches : Array.isArray(body.data) ? body.data : null;
  if (!items) return { items: [], hasNext: false, problem: "elenco non trovato nella risposta" };
  return { items, hasNext: body.hasNextPage === true, problem: null };
}
