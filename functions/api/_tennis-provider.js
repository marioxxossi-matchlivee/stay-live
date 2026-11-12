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

// ───────────── Live, ranking, profili e statistiche (campioni reali della sonda del 12/11/2026) ─────────────
const surfaceFamily = (name) => { const s = String(name ?? "").toLowerCase(); return s.includes("clay") ? "clay" : s.includes("grass") ? "grass" : s.includes("hard") || s.includes("carpet") ? "hard" : null; };
const asInt = (v) => { const n = Number(v); return Number.isInteger(n) ? n : null; };

/** matchKey del provider = id1-id2-torneo-turno (stesso formato di liveMatchId del programma e di matchKey dei risultati). */
export function parseMatchKey(key) {
  const m = /^(\d+)-(\d+)-(\d+)-(\d+)$/.exec(String(key ?? ""));
  return m ? { id1: m[1], id2: m[2], tournamentId: m[3], roundId: Number(m[4]) } : null;
}

/** "6-4,4-6,4-4" → [[6,4],[4,6],[4,4]]; testo non riconosciuto → null (non si inventano punteggi). */
export function parseLiveScore(score) {
  const parts = String(score ?? "").split(",").map((s) => /^(\d{1,2})-(\d{1,2})$/.exec(s.trim()));
  return parts.length && parts.every(Boolean) ? parts.map((m) => [Number(m[1]), Number(m[2])]) : null;
}

/**
 * Riga del feed LIVE. Non dà mai un vincitore: "Ended" nel feed live NON è un risultato confermato (lo confermano solo i risultati).
 * I set sono riportati nell'ordine canonico (id minore = giocatore 1), come le altre tabelle.
 */
export function normalizeLive(row) {
  const k = parseMatchKey(row?.matchKey ?? row?.matchId);
  if (!k || row?.tourType === undefined || ![...TOURS].includes(row.tourType)) return null;
  const swapped = Number(k.id1) > Number(k.id2);
  const sets = parseLiveScore(row.score);
  const status = row.status === "InPlay" ? "live" : row.status === "Upcoming" ? "scheduled" : row.status === "Ended" ? "ended_unconfirmed" : "unknown";
  return {
    match_key: canonicalMatchKey(k.tournamentId, k.roundId, k.id1, k.id2), live_event_id: idOf(row.id), tour: row.tourType, tournament_id: k.tournamentId, round_id: k.roundId,
    tournament: row.tournament?.name ?? row.league ?? null, status, sets: sets ? (swapped ? sets.map(([a, b]) => [b, a]) : sets) : null, score_raw: row.score ?? null,
    points: row.points ?? null, indicator_raw: row.indicator ?? null, // il significato di "indicator" non è documentato con certezza: non si interpreta
    starts_at: Number.isFinite(row.startTimestamp) ? new Date(row.startTimestamp * 1000).toISOString() : null,
    updated_at: Number.isFinite(row.updatedAt) ? new Date(row.updatedAt * 1000).toISOString() : null,
  };
}

/** Pagina del ranking attuale (/{tour}/ranking/singles). */
export function normalizeRankingPage(body, tour) {
  const page = readPage(body);
  if (page.problem) return { ...page, rows: [] };
  const rows = [];
  for (const r of page.items) {
    const id = idOf(r?.player?.id), pos = asInt(r?.position), pts = num(r?.rankingPoints ?? r?.point);
    if (!id || !pos || pos < 1) continue;
    rows.push({ tour, player_id: id, name: r.player.name ?? null, country: r.player.countryAcr ?? null, position: pos, points: pts, ranking_date: isoOrNull(r.date) });
  }
  return { items: page.items, hasNext: page.hasNext, problem: null, rows };
}

export function normalizeProfile(body) {
  const d = body?.data;
  if (!d || typeof d !== "object" || !d.id) return null;
  return { player_id: String(d.id), name: d.name ?? null, country: d.countryAcr ?? null, status: d.playerStatus ?? null, current_rank: asInt(d.currentRank) || null, points: num(d.points), ranking_date: isoOrNull(d.rankingDate), plays: d.information?.plays ?? null };
}

/**
 * Statistiche di CARRIERA (valori di OGGI, non storici: vanno salvati con l'ora di lettura e MAI usati per rivalutare partite passate).
 * Servizio: punti vinti al servizio = (vinti su 1ª + vinti su 2ª) / punti al servizio.
 * Risposta: il provider riporta i punti vinti dall'AVVERSARIO al servizio contro di lui; la quota del giocatore è il complemento.
 * Questa lettura è dedotta dall'ordine di grandezza (≈62% sarebbe assurdo come quota in risposta) e protetta da un limite di buon senso;
 * va confermata con la documentazione dell'endpoint. Fuori dai limiti → null (dato mancante), mai corretto.
 */
export function normalizeMatchStats(body) {
  const s = body?.data?.serviceStats, r = body?.data?.rtnStats;
  const out = { serve_pts_won: null, return_pts_won: null, serve_points: null, return_points: null };
  const ratio = (st) => (st && num(st.firstServeOfGm) > 0 ? (num(st.winningOnFirstServeGm) + num(st.winningOnSecondServeGm)) / num(st.firstServeOfGm) : null);
  const sv = ratio(s), rt = ratio(r);
  if (sv !== null && sv > 0.4 && sv < 0.85) { out.serve_pts_won = sv; out.serve_points = num(s.firstServeOfGm); }
  if (rt !== null && rt > 0.45 && rt < 0.8) { out.return_pts_won = 1 - rt; out.return_points = num(r.firstServeOfGm); }
  return out;
}

/** Record per superficie e per anno (il dettaglio per anno permette di usare solo gli anni precedenti nel backtest). */
export function normalizeSurfaceSummary(body) {
  const years = Array.isArray(body?.data) ? body.data : null;
  if (!years) return { byYear: [], total: {} };
  const byYear = [], total = {};
  for (const y of years) {
    const yr = asInt(y?.year); if (!yr || !Array.isArray(y.surfaces)) continue;
    const rec = {};
    for (const s of y.surfaces) {
      const fam = surfaceFamily(s?.court), w = asInt(s?.courtWins), l = asInt(s?.courtLosses);
      if (!fam || w === null || l === null) continue;
      rec[fam] = { w: (rec[fam]?.w ?? 0) + w, l: (rec[fam]?.l ?? 0) + l };
      total[fam] = { w: (total[fam]?.w ?? 0) + w, l: (total[fam]?.l ?? 0) + l };
    }
    byYear.push({ year: yr, ...rec });
  }
  return { byYear, total };
}
