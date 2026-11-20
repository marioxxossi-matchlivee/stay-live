#!/usr/bin/env node
/**
 * Stay Live Tennis — SHADOW MODE del caricamento storico (confronto OLD / NEW). SOLA LETTURA, ISOLATA DAL MOTORE.
 *
 *   OLD  = percorso operativo di oggi: `loadHistory` di scripts/tennis-sync.js (offset, tetto 80 pagine × 1.000 righe) + `buildBook`.
 *   NEW  = `loadFinishedKeyset` (paginazione a chiave (starts_at, match_key)) + lo STESSO `buildBook`. Formule Elo/forma invariate.
 *
 * Isolamento (verificato dai test):
 *   - nessuna scrittura: il file usa solo supabaseGet / supabaseGetAll (GET) e una GET con `Prefer: count=exact`; nessun provider sportivo;
 *   - nessun file del motore, delle API, dell'app o dei workflow operativi lo importa; non è richiamato da tennis-sync.js;
 *   - l'esito resta in `audit-out/` (file locale del runner) e nel riepilogo del workflow: niente tabelle, niente snapshot, niente probabilità pubblicate.
 * Attivazione: variabile TENNIS_HISTORY_SHADOW=on (il workflow «Tennis — Shadow Mode storico» la imposta dal parametro `shadow`).
 * Disattivazione: parametro `shadow` = off (o variabile assente) → lo script esce subito senza leggere nulla. Il motore non cambia né in un caso né nell'altro.
 * Segreti: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (solo lettura, mai stampati).
 */
import fs from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { supabaseGet, supabaseGetAll } from "../functions/api/_lib.js";
import { loadFinishedKeyset } from "../functions/api/_tennis-history.js";
import { RatingBook, predictMatch, normalizeSurface, TENNIS_MODEL } from "../functions/api/_tennis-model.js";
import { noVig } from "../functions/api/_tennis-bet.js";
import { loadHistory, buildBook, computePredictions, CFG } from "./tennis-sync.js";

const H = 3600e3, DAY = 24 * H;
const iso = (t) => new Date(t).toISOString();

/** Tetto del percorso OLD: 80 pagine × 1.000 righe (scripts/tennis-sync.js, loadHistory). Un test lo confronta con il codice operativo. */
export const OPERATIVE_HISTORY_CAP = 80 * 1000;
export const SHADOW_ENABLED = (env = process.env) => /^(on|1|true|yes)$/i.test(String(env.TENNIS_HISTORY_SHADOW ?? ""));

/** Filtro e colonne del caricamento operativo (identici a loadHistory) — la chiave `match_key` e i dati per Brier/ECE sono aggiunti SOLO nel percorso NEW. */
export const operativeQuery = (now, days = CFG.historyDays) => ({ select: "p1_id,p2_id,winner,starts_at,surface,best_of,tour,category,p1_name,p2_name", status: "eq.finished", winner: "not.is.null", starts_at: `gte.${iso(now - days * DAY)}` });
export const keysetQuery = (now, days = CFG.historyDays) => { const q = operativeQuery(now, days); return { ...q, select: `match_key,${q.select},tournament,closing_odds` }; };

/** Stessa trasformazione di loadHistory (+ chiave, nomi per id e quote di chiusura per la sola valutazione). */
export const isValidFinished = (r) => r.winner === 1 || r.winner === 2;
export const toEntry = (r) => ({
  t: Date.parse(r.starts_at), winnerId: r.winner === 1 ? r.p1_id : r.p2_id, loserId: r.winner === 1 ? r.p2_id : r.p1_id, surface: r.surface, tour: r.tour, bestOf: r.best_of, category: r.category, p1Name: r.p1_name, p2Name: r.p2_name,
  key: r.match_key ?? null, winnerName: r.winner === 1 ? r.p1_name : r.p2_name, loserName: r.winner === 1 ? r.p2_name : r.p1_name, odds: r.closing_odds ?? null, p1Id: r.p1_id, p2Id: r.p2_id,
});
export const toEntries = (rows) => rows.filter(isValidFinished).map(toEntry);
/** Il percorso OLD, ricostruito sulle STESSE righe: le prime 80.000 nello stesso ordine (starts_at, match_key) = ciò che l'offset legge prima di fermarsi. */
export const emulateOldRows = (rows, cap = OPERATIVE_HISTORY_CAP) => rows.slice(0, cap);

const sha = (s) => createHash("sha256").update(s).digest("hex");
export const fingerprintRows = (rows) => sha(rows.map((r) => `${r.match_key}|${r.starts_at}|${r.winner}`).join("\n"));
export const fingerprintBook = (book) => sha([...book.players].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)).map(([id, p]) => `${id}:${p.elo.toFixed(6)}:${p.n}:${p.results.length}`).join("\n"));

// ───────────── Statistiche ─────────────
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
export const percentile = (a, q) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))]; };
const rd = (x, d = 4) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
const EPS = 1e-6, clip = (p) => Math.min(1 - EPS, Math.max(EPS, p));
/** rows con (p, y): p = probabilità dell'evento «giocatore 1 vince». ECE simmetrica a 10 fasce sui due lati (come l'audit). */
export function scoreRows(rows, pf = (r) => r.p) {
  const n = rows.length; if (!n) return { n: 0, brier: null, logLoss: null, ece: null, accuracy: null };
  const sides = rows.flatMap((r) => [{ p: pf(r), y: r.y }, { p: 1 - pf(r), y: 1 - r.y }]), bins = Array.from({ length: 10 }, () => ({ n: 0, p: 0, y: 0 }));
  for (const s of sides) { const b = bins[Math.min(9, Math.floor(s.p * 10))]; b.n++; b.p += s.p; b.y += s.y; }
  const ece = bins.reduce((acc, b) => acc + (b.n ? (b.n / sides.length) * Math.abs(b.p / b.n - b.y / b.n) : 0), 0);
  return { n, brier: rd(mean(rows.map((r) => (pf(r) - r.y) ** 2))), logLoss: rd(mean(rows.map((r) => -(r.y ? Math.log(clip(pf(r))) : Math.log(clip(1 - pf(r))))))), ece: rd(ece), accuracy: rd(mean(rows.map((r) => ((pf(r) >= 0.5 ? 1 : 0) === r.y ? 1 : 0)))) };
}

// ───────────── Rating e forma: confronto dei due libri ─────────────
const playerIds = (book) => [...book.players.keys()];
export function compareBooks(oldBook, newBook, { activeAfterCutoff = new Set(), scheduledIds = new Set(), cfg = TENNIS_MODEL } = {}) {
  const eloOf = (b, id) => b.players.get(id)?.elo ?? cfg.baseElo;
  const meanElo = (b) => mean(playerIds(b).map((id) => b.players.get(id).elo));
  const meanForm = (b) => mean(playerIds(b).map((id) => b.form(id)?.score).filter((x) => x != null));
  const ids = playerIds(newBook), diffs = ids.map((id) => Math.abs(eloOf(newBook, id) - eloOf(oldBook, id)));
  const activeDiffs = [...activeAfterCutoff].filter((id) => newBook.has(id)).map((id) => Math.abs(eloOf(newBook, id) - eloOf(oldBook, id)));
  const formDiffs = ids.map((id) => { const a = newBook.form(id), b = oldBook.form(id); return a && b ? Math.abs(a.score - b.score) : null; }).filter((x) => x != null);
  const unknown = (b, set) => [...set].filter((id) => !b.has(id)).length;
  return {
    players: { old: oldBook.players.size, new: newBook.players.size },
    unknownInScheduled: { scheduledPlayers: scheduledIds.size, old: unknown(oldBook, scheduledIds), new: unknown(newBook, scheduledIds) },
    unknownAmongActiveAfterCutoff: { activePlayers: activeAfterCutoff.size, old: unknown(oldBook, activeAfterCutoff), new: unknown(newBook, activeAfterCutoff) },
    meanElo: { old: rd(meanElo(oldBook), 2), new: rd(meanElo(newBook), 2) },
    meanAbsEloDiff: rd(mean(diffs), 2), p90AbsEloDiff: rd(percentile(diffs, 0.9), 2), shareAbsEloDiffOver50: rd(diffs.length ? diffs.filter((d) => d > 50).length / diffs.length : null),
    activeAfterCutoffMeanAbsEloDiff: rd(mean(activeDiffs), 2), activeAfterCutoffP90AbsEloDiff: rd(percentile(activeDiffs, 0.9), 2),
    meanForm: { old: rd(meanForm(oldBook)), new: rd(meanForm(newBook)) }, meanAbsFormDiff: rd(mean(formDiffs)), formComparedPlayers: formDiffs.length,
  };
}

// ───────────── Probabilità sulle partite in programma (sola lettura: nulla viene scritto né pubblicato) ─────────────
export function comparePredictionRows(oldRows, newRows) {
  const byKey = new Map(newRows.map((r) => [r.match_key, r])), both = [];
  for (const o of oldRows) { const n = byKey.get(o.match_key); if (n) both.push([o, n]); }
  const d = both.filter(([o, n]) => o.published && n.published && o.p1 != null && n.p1 != null).map(([o, n]) => Math.abs(o.p1 - n.p1) * 100);
  const verdict = (r) => r.bet?.verdict ?? null;
  return {
    matches: both.length, publishedBoth: d.length, publishedOnlyOld: both.filter(([o, n]) => o.published && !n.published).length, publishedOnlyNew: both.filter(([o, n]) => !o.published && n.published).length,
    meanAbsProbDiffPt: rd(mean(d), 3), p90AbsProbDiffPt: rd(percentile(d, 0.9), 3), maxAbsProbDiffPt: rd(d.length ? Math.max(...d) : null, 3),
    pickChanged: both.filter(([o, n]) => o.published && n.published && o.pick !== n.pick).length,
    verdictChanged: both.filter(([o, n]) => verdict(o) !== verdict(n)).length, betOld: oldRows.filter((r) => verdict(r) === "BET").length, betNew: newRows.filter((r) => verdict(r) === "BET").length,
  };
}

// ───────────── Valutazione sulle partite che l'OLD non vede (rigioco senza look-ahead) ─────────────
const upd = (e) => ({ t: e.t, winnerId: e.winnerId, loserId: e.loserId, surface: normalizeSurface(e.surface) });
/**
 * entries: concluse valide in ordine (starts_at, match_key); oldCount = quante appartengono al percorso OLD (prefisso).
 * Le partite dopo il limite sono previste due volte: con i rating CONGELATI all'ultimo giorno OLD (come farebbe il motore di oggi) e con i rating
 * AGGIORNATI dallo storico completo. Ordine: per giorno UTC; tutte le partite del giorno sono previste con i rating di PRIMA di quel giorno, poi si aggiornano
 * (nessun esito entra nella previsione della stessa partita né di partite dello stesso giorno). Formule invariate (predictMatch / RatingBook).
 */
export function evaluateFrozenVsFresh(entries, oldCount, cfg = TENNIS_MODEL) {
  return summarizeReplay(replayFrozenVsFresh(entries, oldCount, cfg));
}
/** Le singole previsioni (OLD congelato / NEW aggiornato) per ogni partita dopo il limite, senza esiti nelle probabilità. */
export function replayFrozenVsFresh(entries, oldCount, cfg = TENNIS_MODEL) {
  const seq = entries.map((e, i) => ({ e, old: i < oldCount })).sort((a, b) => a.e.t - b.e.t); // stabile: l'ordine del database resta a parità di orario
  const fresh = new RatingBook(cfg), frozen = new RatingBook(cfg), rows = []; let i = 0;
  const run = (book, e) => {
    const swap = String(e.winnerId) > String(e.loserId), [a, b] = swap ? [e.loserId, e.winnerId] : [e.winnerId, e.loserId], [na, nb] = swap ? [e.loserName, e.winnerName] : [e.winnerName, e.loserName];
    const pred = predictMatch(book, { t: e.t, surface: e.surface, tour: e.tour, bestOf: e.bestOf, p1: { id: a, name: na }, p2: { id: b, name: nb } }, {}, null, cfg);
    return { pred, a, b, y: a === e.winnerId ? 1 : 0 };
  };
  while (i < seq.length) {
    const day = Math.floor(seq[i].e.t / DAY); let j = i; while (j < seq.length && Math.floor(seq[j].e.t / DAY) === day) j++;
    const batch = seq.slice(i, j);
    for (const { e, old } of batch) {
      if (old) continue;
      const o = run(frozen, e), n = run(fresh, e), nv = noVig(Number(e.odds?.[String(o.a)]), Number(e.odds?.[String(o.b)]));
      rows.push({ t: e.t, y: o.y, pubOld: !!o.pred.published, pubNew: !!n.pred.published, pOld: o.pred.p1, pNew: n.pred.p1, mkt: nv ? nv.p1 : null, unknownOld: !frozen.has(String(o.a)) || !frozen.has(String(o.b)) });
    }
    for (const { e, old } of batch) { fresh.update(upd(e)); if (old) frozen.update(upd(e)); }
    i = j;
  }
  return rows;
}
function summarizeReplay(rows) {
  const cmp = rows.filter((r) => r.pubOld && r.pubNew), withMkt = cmp.filter((r) => r.mkt != null);
  const sc = (set, f) => scoreRows(set, f);
  const verdictVsMarket = withMkt.length ? (sc(withMkt, (r) => r.pNew).brier > sc(withMkt, (r) => r.mkt).brier ? "NEW resta PEGGIORE del mercato (Brier)" : "NEW non è peggiore del mercato (Brier): servono intervalli per concludere") : "n.d. (nessuna partita con quote di chiusura)";
  return {
    evaluated: rows.length, publishedOld: rows.filter((r) => r.pubOld).length, publishedNew: rows.filter((r) => r.pubNew).length, comparable: cmp.length, withClosingOdds: withMkt.length, withPlayerUnknownToOld: rows.filter((r) => r.unknownOld).length,
    meanAbsProbDiffPt: rd(mean(cmp.map((r) => Math.abs(r.pOld - r.pNew) * 100)), 3),
    old: sc(cmp, (r) => r.pOld), new: sc(cmp, (r) => r.pNew),
    onClosingOdds: withMkt.length ? { old: sc(withMkt, (r) => r.pOld), new: sc(withMkt, (r) => r.pNew), market: sc(withMkt, (r) => r.mkt) } : null,
    verdictVsMarket,
    note: "Stesse partite per OLD e NEW (solo quelle pubblicate da entrambi); nessun intervallo di confidenza: differenze indicative. Il confronto con il mercato usa quote di CHIUSURA e non prova un vantaggio.",
  };
}

// ───────────── Orchestrazione (funzione pura rispetto alla rete: riceve i lettori) ─────────────
/**
 * io = { fetchPage(params), getAll(table, query, pageSize, maxPages), count?(query), realOld?() } — tutti di SOLA LETTURA.
 * Restituisce { report, md }. Nulla viene scritto: lo fa soltanto main() su file locali.
 */
export async function runShadow(io, { now = Date.now(), days = CFG.historyDays, repeat = true, maxPages = 400, retries = 2, sleep, cap = OPERATIVE_HISTORY_CAP } = {}) {
  const q = keysetQuery(now, days), load = () => loadFinishedKeyset(io.fetchPage, { query: q, maxPages, retries, ...(sleep ? { sleep } : {}) });
  const nw = await load(), allRows = nw.rows, entriesNew = toEntries(allRows);
  const oldRows = emulateOldRows(allRows, cap), entriesOld = toEntries(oldRows);
  const lostRaw = allRows.length - oldRows.length, lostEntries = entriesNew.slice(entriesOld.length);
  const bookOld = buildBook(entriesOld), bookNew = buildBook(entriesNew);
  // Dati del programma e calibrazione: stesse letture del refresh operativo (solo GET).
  const since = iso(now - H);
  const [matches, stats, rankings, bt] = await Promise.all([
    io.getAll("tennis_matches", { select: "*", status: "eq.scheduled", starts_at: `gte.${since}`, order: "starts_at.asc" }, 1000, 12),
    io.getAll("tennis_player_stats", { select: "player_id,matches,serve_pts_won,return_pts_won,stats", surface: "eq.all" }, 1000, 20),
    io.getAll("tennis_rankings", { select: "tour,player_id,position" }, 1000, 12),
    io.getAll("tennis_snapshot", { select: "id,payload", id: "eq.backtest" }, 5, 1),
  ]);
  const mapBy = (rows, key) => new Map(rows.map((r) => [typeof key === "function" ? key(r) : r[key], r]));
  const calibrator = bt[0]?.payload?.calibrator ?? null, ranks = mapBy(rankings, (r) => `${r.tour}|${r.player_id}`), st = mapBy(stats, "player_id");
  const predOld = computePredictions({ matches, book: bookOld, stats: st, ranks, calibrator, now }), predNew = computePredictions({ matches, book: bookNew, stats: st, ranks, calibrator, now });
  const scheduledIds = new Set(matches.filter((m) => m.status === "scheduled" && Date.parse(m.starts_at) > now).flatMap((m) => [m.p1_id, m.p2_id]).filter(Boolean));
  const activeAfterCutoff = new Set(lostEntries.flatMap((e) => [e.winnerId, e.loserId]).filter((x) => x != null));
  const books = compareBooks(bookOld, bookNew, { activeAfterCutoff, scheduledIds });
  const evaluation = evaluateFrozenVsFresh(entriesNew, entriesOld.length);
  // Riproducibilità: secondo caricamento completo + secondo rigioco sugli stessi dati.
  let reproducibility = { checked: false };
  if (repeat) {
    const again = await load(), fpA = fingerprintRows(allRows), fpB = fingerprintRows(again.rows);
    const book2 = buildBook(toEntries(again.rows)), ev2 = evaluateFrozenVsFresh(toEntries(again.rows), toEntries(emulateOldRows(again.rows, cap)).length);
    reproducibility = { checked: true, rowsIdentical: fpA === fpB, secondLoadRows: again.rows.length, booksIdentical: fingerprintBook(bookNew) === fingerprintBook(book2), evaluationIdentical: JSON.stringify(evaluation) === JSON.stringify(ev2),
      note: fpA === fpB ? "Due letture complete consecutive: stesse righe, stessi rating, stessa valutazione." : "Le due letture differiscono: il database è cambiato tra l'una e l'altra (il refresh gira ogni 30 minuti). Rilanciare per un confronto stabile." };
  }
  // Controlli di coerenza con il database e con il percorso operativo REALE.
  let dbCount = null, countMatches = null; if (io.count) { dbCount = await io.count(q); countMatches = dbCount === allRows.length; }
  let oldVerification = { checked: false };
  if (io.realOld) {
    const real = await io.realOld(now), same = real.length === entriesOld.length && real.every((x, i) => x.t === entriesOld[i].t && x.winnerId === entriesOld[i].winnerId && x.loserId === entriesOld[i].loserId);
    oldVerification = { checked: true, realOperativeEntries: real.length, emulatedEntries: entriesOld.length, identical: same, note: same ? "Il percorso OLD reale (loadHistory) coincide con le prime 80.000 righe del caricamento a chiave." : "Differenza tra OLD reale ed emulato: dati cambiati tra le due letture o tetto diverso. Rilanciare." };
  }
  const report = {
    generatedAt: iso(Date.now()), snapshotNow: iso(now), engine: TENNIS_MODEL.version, mode: "SHADOW — sola lettura, nessuna scrittura, motore operativo invariato",
    loader: { pages: nw.pages, duplicatesDiscarded: nw.duplicates, truncated: nw.truncated, databaseCount: dbCount, countMatchesRows: countMatches },
    table: {
      rowsLoaded: { old: oldRows.length, new: allRows.length }, validFinished: { old: entriesOld.length, new: entriesNew.length }, duplicates: { old: "n.d. (OLD non conserva match_key)", new: nw.duplicates },
      firstMatch: { old: entriesOld[0] ? iso(entriesOld[0].t) : null, new: entriesNew[0] ? iso(entriesNew[0].t) : null }, lastMatch: { old: entriesOld.at(-1) ? iso(entriesOld.at(-1).t) : null, new: entriesNew.at(-1) ? iso(entriesNew.at(-1).t) : null },
      distinctPlayers: books.players, unknownPlayers: { inScheduledMatches: books.unknownInScheduled, amongActiveAfterCutoff: books.unknownAmongActiveAfterCutoff },
      meanElo: books.meanElo, meanAbsEloDiff: books.meanAbsEloDiff, p90AbsEloDiff: books.p90AbsEloDiff, meanForm: books.meanForm, meanAbsFormDiff: books.meanAbsFormDiff, probabilityDiffOnScheduled: { meanAbsPt: comparePredictionRows(predOld, predNew).meanAbsProbDiffPt },
    },
    lost: { rawRows: lostRaw, validEntries: lostEntries.length, firstLostMatch: lostEntries[0] ? iso(lostEntries[0].t) : null, allAfterOldLastMatch: lostEntries.every((e) => !entriesOld.length || e.t >= entriesOld.at(-1).t), shareOfNew: rd(allRows.length ? lostRaw / allRows.length : null) },
    books, predictions: comparePredictionRows(predOld, predNew), evaluation, reproducibility, oldVerification,
    limits: "Rigioco Elo+forma senza statistiche di servizio, H2H e ranking storici; quote di CHIUSURA. Migliorare Brier/ECE rispetto all'OLD non prova alcun vantaggio sul mercato.",
  };
  return { report, md: renderMarkdown(report) };
}

const f = (v) => (v == null ? "n.d." : v);
export function renderMarkdown(r) {
  const t = r.table, e = r.evaluation, p = r.predictions;
  const rows = [
    ["Partite caricate", t.rowsLoaded.old, t.rowsLoaded.new], ["Partite concluse valide", t.validFinished.old, t.validFinished.new], ["Partite duplicate", t.duplicates.old, t.duplicates.new],
    ["Data della prima partita", f(t.firstMatch.old), f(t.firstMatch.new)], ["Data dell'ultima partita", f(t.lastMatch.old), f(t.lastMatch.new)], ["Giocatori distinti", t.distinctPlayers.old, t.distinctPlayers.new],
    [`Giocatori sconosciuti (su ${t.unknownPlayers.inScheduledMatches.scheduledPlayers} in programma)`, t.unknownPlayers.inScheduledMatches.old, t.unknownPlayers.inScheduledMatches.new],
    [`Giocatori sconosciuti (su ${t.unknownPlayers.amongActiveAfterCutoff.activePlayers} attivi dopo il limite)`, t.unknownPlayers.amongActiveAfterCutoff.old, t.unknownPlayers.amongActiveAfterCutoff.new],
    ["Rating Elo medio", f(t.meanElo.old), f(t.meanElo.new)], ["Differenza media Elo (assoluta)", "—", f(t.meanAbsEloDiff)], ["Differenza Elo assoluta al 90° percentile", "—", f(t.p90AbsEloDiff)],
    ["Forma media", f(t.meanForm.old), f(t.meanForm.new)], ["Differenza media della forma (assoluta)", "—", f(t.meanAbsFormDiff)], ["Differenza media delle probabilità (punti, partite in programma)", "—", f(t.probabilityDiffOnScheduled.meanAbsPt)],
  ];
  const sc = (s) => `Brier ${f(s.brier)} · ECE ${f(s.ece)} · log loss ${f(s.logLoss)} · accuratezza ${f(s.accuracy)}`;
  return `## Shadow Mode — caricamento storico OLD (offset, tetto 80.000) contro NEW (chiave, completo)\n> ${r.mode}. Istantanea: ${r.snapshotNow}. ${r.limits}\n\n| Indicatore | OLD | NEW |\n|---|---|---|\n${rows.map((x) => `| ${x[0]} | ${x[1]} | ${x[2]} |`).join("\n")}\n\n` +
    `**Caricamento a chiave:** ${r.loader.pages} pagine, ${r.loader.duplicatesDiscarded} duplicati scartati, troncato: ${r.loader.truncated ? "SÌ" : "no"}; conteggio del database al momento dell'esecuzione: ${f(r.loader.databaseCount)} (${r.loader.countMatchesRows == null ? "non verificato" : r.loader.countMatchesRows ? "coincide con le righe lette" : "DIVERSO dalle righe lette: il database è cambiato durante la lettura, rilanciare"}).\n\n` +
    `**Partite perse dal percorso OLD:** ${r.lost.rawRows} righe (${f(r.lost.shareOfNew)} del totale), ${r.lost.validEntries} concluse valide; prima partita persa: ${f(r.lost.firstLostMatch)}; tutte successive all'ultima partita letta dall'OLD: ${r.lost.allAfterOldLastMatch ? "sì" : "NO"}.\n\n` +
    `**Elo e forma (sui ${r.books.players.new} giocatori NEW):** attivi dopo il limite: scarto Elo medio ${f(r.books.activeAfterCutoffMeanAbsEloDiff)} (90° percentile ${f(r.books.activeAfterCutoffP90AbsEloDiff)}); quota di giocatori con scarto oltre 50 punti: ${f(r.books.shareAbsEloDiffOver50)}.\n\n` +
    `**Probabilità sulle partite in programma (non pubblicate, non scritte):** ${p.matches} partite, ${p.publishedBoth} pubblicate da entrambi; scarto medio ${f(p.meanAbsProbDiffPt)} punti (90° percentile ${f(p.p90AbsProbDiffPt)}, massimo ${f(p.maxAbsProbDiffPt)}); pronostico cambiato: ${p.pickChanged}; verdetto BET/EVITA cambiato: ${p.verdictChanged}; BET OLD ${p.betOld} · BET NEW ${p.betNew}.\n\n` +
    `**Valutazione sulle ${e.evaluated} partite perse dall'OLD (${e.comparable} confrontabili):** OLD (rating congelati) → ${sc(e.old)}; NEW (storico completo) → ${sc(e.new)}; scarto medio di probabilità ${f(e.meanAbsProbDiffPt)} punti; partite con un giocatore sconosciuto all'OLD: ${e.withPlayerUnknownToOld}.\n` +
    (e.onClosingOdds ? `Sulle ${e.withClosingOdds} con quote di chiusura: OLD ${sc(e.onClosingOdds.old)} · NEW ${sc(e.onClosingOdds.new)} · MERCATO ${sc(e.onClosingOdds.market)}. **${e.verdictVsMarket}.**\n` : `Mercato: ${e.verdictVsMarket}.\n`) + `${e.note}\n\n` +
    `**Riproducibilità:** ${r.reproducibility.checked ? `righe identiche: ${r.reproducibility.rowsIdentical ? "sì" : "NO"}, rating identici: ${r.reproducibility.booksIdentical ? "sì" : "NO"}, valutazione identica: ${r.reproducibility.evaluationIdentical ? "sì" : "NO"}. ${r.reproducibility.note}` : "non verificata"}\n` +
    `**Verifica del percorso OLD reale:** ${r.oldVerification.checked ? `${r.oldVerification.identical ? "coincide con l'emulazione" : "NON coincide"} (${r.oldVerification.realOperativeEntries} contro ${r.oldVerification.emulatedEntries} partite). ${r.oldVerification.note}` : "non eseguita"}\n`;
}

// ───────────── Lettori reali (solo GET) ─────────────
export function makeReaders(env) {
  const headers = { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, prefer: "count=exact" };
  return {
    fetchPage: (params) => supabaseGet(env, "tennis_matches", params),
    getAll: (table, query, pageSize, maxPages) => supabaseGetAll(env, table, query, pageSize, maxPages),
    async count(query) { // conteggio esatto dal database, con gli stessi filtri (GET con limit=1, legge l'intestazione content-range)
      const url = new URL("/rest/v1/tennis_matches", env.SUPABASE_URL);
      for (const [k, v] of Object.entries({ ...query, select: "match_key", limit: 1 })) url.searchParams.set(k, String(v));
      const res = await fetch(url, { method: "GET", headers });
      if (!res.ok) throw new Error(`Supabase tennis_matches (conteggio): HTTP ${res.status}`);
      const total = Number(String(res.headers.get("content-range") ?? "").split("/")[1]);
      return Number.isFinite(total) ? total : null;
    },
    realOld: (now) => loadHistory({ getAll: (table, query, pageSize, maxPages) => supabaseGetAll(env, table, query, pageSize, maxPages) }, now, CFG.historyDays, { loader: "offset" }), // il vero percorso operativo, con il suo tetto
  };
}

async function main() {
  if (!SHADOW_ENABLED()) { console.log("Shadow Mode disattivata (TENNIS_HISTORY_SHADOW non è «on»): nessuna lettura, nessun effetto. Il motore operativo non cambia."); return; }
  for (const k of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) if (!process.env[k]) { console.error(`Variabile mancante: ${k}`); process.exit(1); }
  const io = makeReaders(process.env); if (process.env.SHADOW_VERIFY_OLD === "0") delete io.realOld;
  const { report, md } = await runShadow(io, { repeat: process.env.SHADOW_REPEAT !== "0" });
  fs.mkdirSync("audit-out", { recursive: true });
  fs.writeFileSync("audit-out/tennis-history-shadow.json", JSON.stringify(report, null, 2));
  fs.writeFileSync("audit-out/tennis-history-shadow.md", md);
  console.log(md.slice(0, 6000));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
