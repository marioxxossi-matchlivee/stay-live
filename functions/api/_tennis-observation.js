/**
 * Stay Live Tennis — LIVE OBSERVATION: logica PURA (nessuna rete, nessun database, nessuna scrittura).
 * Registro prospettico delle valutazioni PRE-PARTITA: valutazione iniziale permanente (rev 1) + revisioni separate (rev 2…).
 * Questo modulo NON è importato dal motore operativo (predictMatch, computePredictions, loadHistory) e non ne altera le uscite: legge soltanto
 * ciò che il motore ha già prodotto (righe di previsione) e lo stato del RatingBook (view/form, sola lettura).
 * Le metriche usano ESCLUSIVAMENTE la valutazione iniziale (rev 1).
 */

export const OBSERVATION = { version: "live-observation-v2", probStep: 0.01, minSample: 300, minBlocks: 50, bootstrapReps: 1000, seed: 20261121 };
export const REVISION_REASONS = ["initial", "rescheduled", "model_version", "publication", "probability", "missing_data", "ratings_version"];
export const STATES = ["upcoming", "awaiting_result", "live", "concluded", "postponed", "cancelled", "interrupted", "ended_other", "identity_mismatch", "unknown"];
const ts = (x) => (x == null ? NaN : Date.parse(x));
const r4 = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1e4) / 1e4);

/** Hash deterministico a 2×32 bit (cyrb-like), incrementale: nessuna dipendenza, gira anche nel browser. */
function hasher() {
  let a = 0xdeadbeef, b = 0x41c6ce57, c = 0x9e3779b1, d = 0x85ebca6b;
  const add = (str) => { for (let i = 0; i < str.length; i++) { const x = str.charCodeAt(i); a = Math.imul(a ^ x, 2654435761); b = Math.imul(b ^ x, 1597334677); c = Math.imul(c ^ x, 2246822519); d = Math.imul(d ^ x, 3266489917); } a ^= a >>> 15; b ^= b >>> 13; c ^= c >>> 16; d ^= d >>> 11; };
  const hex = () => [a ^ (b >>> 7), b ^ (c >>> 9), c ^ (d >>> 5), d ^ (a >>> 3)].map((v) => (v >>> 0).toString(16).padStart(8, "0")).join("");
  return { add, hex };
}

/**
 * Impronta del CONTENUTO dello storico effettivamente usato dal motore (RatingBook = f(storico)): per ogni partita t, vincitore, perdente, superficie
 * e circuito, in ordine; più numero di partite, caricamento e date estreme. Nessuna lettura aggiuntiva: lavora sull'array già in memoria.
 * Controlla anche l'integrità temporale: righe con data successiva all'istante di elaborazione (`future`) o non valida (`invalid`).
 */
export function historyFingerprint(history, loader, now) {
  const h = hasher(); let firstAt = null, lastAt = null, invalid = 0; const future = { count: 0, latestAt: null, sample: [] };
  for (const m of history ?? []) {
    const t = Number(m.t);
    if (!Number.isFinite(t)) { invalid++; h.add(`!|${m.winnerId}|${m.loserId}\n`); continue; }
    if (firstAt === null || t < firstAt) firstAt = t; if (lastAt === null || t > lastAt) lastAt = t;
    if (now != null && t > now) { future.count++; if (future.latestAt === null || t > future.latestAt) future.latestAt = t; if (future.sample.length < 5) future.sample.push({ at: new Date(t).toISOString(), winnerId: m.winnerId ?? null, loserId: m.loserId ?? null, tour: m.tour ?? null, surface: m.surface ?? null }); }
    h.add(`${t}|${m.winnerId}|${m.loserId}|${m.surface ?? ""}|${m.tour ?? ""}\n`);
  }
  const n = (history ?? []).length;
  h.add(`#${n}|${loader ?? ""}`);
  return { version: h.hex().slice(0, 32), matches: n, loader: loader ?? null, firstAt, lastAt, invalid, future: { ...future, latestAt: future.latestAt === null ? null : new Date(future.latestAt).toISOString() } };
}
/** Compatibilità: la versione dei rating è l'impronta del contenuto (non più solo conteggio/ultima data/loader). */
export const ratingsVersion = (fp) => fp?.version ?? null;

/**
 * Controllo INDIPENDENTE anti look-ahead sullo storico usato (non modifica loadHistory/buildBook): nessuna registrazione se lo storico è vuoto
 * o contiene partite concluse con data successiva all'istante di elaborazione. Non corregge nulla: restituisce la diagnostica.
 */
export function checkHistoryPrematch(fp, now) {
  if (!fp || !fp.matches) return { ok: false, code: "history_empty", detail: { matches: 0 } };
  if (fp.future.count > 0) return { ok: false, code: "history_future_date", detail: { count: fp.future.count, latestAt: fp.future.latestAt, processedAt: new Date(now).toISOString(), sample: fp.future.sample, historyMatches: fp.matches, loader: fp.loader } };
  if (fp.lastAt != null && fp.lastAt > now) return { ok: false, code: "history_future_date", detail: { latestAt: new Date(fp.lastAt).toISOString(), processedAt: new Date(now).toISOString() } };
  return { ok: true };
}

/**
 * Fotografia dei dati usati dal modello per questa partita, con i VALORI NUMERICI effettivi (null = non disponibile, mai inventato).
 * Ricalca la stessa estrazione di computePredictions (stats: solo se servizio E risposta presenti; ranking: solo se entrambi presenti;
 * H2H: solo se entrambi i conteggi presenti), così i dati salvati sono quelli passati a predictMatch (verificato nei test per ricostruzione).
 * Elo e forma sono letti dal RatingBook (sola lettura) con la stessa superficie e lo stesso istante usati dal modello.
 */
export function modelInputs({ match, row, book, stats, ranks }) {
  const surface = row.surface ?? null, t = Date.parse(match.starts_at);
  const side = (id) => {
    const v = book?.view?.(id, surface) ?? null, f = book?.form?.(id, t) ?? null;
    return { elo: v ? r4(v.elo) : null, eloAll: v ? r4(v.eloAll) : null, eloSurface: v?.eloSurf == null ? null : r4(v.eloSurf), matches: v?.n ?? null, matchesSurface: v?.nSurf ?? null, form: f ? r4(f.score) : null, formGames: f?.games ?? null };
  };
  const st = (id) => { const s = stats?.get?.(id); return s && s.serve_pts_won != null && s.return_pts_won != null ? { serve: s.serve_pts_won, ret: s.return_pts_won, matches: s.matches ?? null, servePoints: s.stats?.servePoints ?? null } : null; };
  const stRow = (id) => { const s = stats?.get?.(id); return s ? { surface: s.surface ?? null, tour: s.tour ?? null, fetchedAt: s.fetched_at ?? null } : null; };
  const pos = (id) => ranks?.get?.(`${match.tour}|${id}`)?.position ?? null;
  const r1 = pos(match.p1_id), r2 = pos(match.p2_id);
  return {
    p1: side(match.p1_id), p2: side(match.p2_id), components: row.components ?? {}, reasons: row.reasons ?? [], bestOf: match.best_of ?? null, surface,
    h2h: match.h2h && match.h2h.p1Wins != null && match.h2h.p2Wins != null ? { p1Wins: match.h2h.p1Wins, p2Wins: match.h2h.p2Wins } : null,
    rank: { p1: r1, p2: r2, used: !!(r1 && r2) },
    stats: { p1: st(match.p1_id), p2: st(match.p2_id) }, statsSource: { p1: stRow(match.p1_id), p2: stRow(match.p2_id) },
    oddsAvailable: Array.isArray(match.odds_sources) && match.odds_sources.length > 0,
  };
}

/** Perché una nuova revisione? null = nessun cambiamento rilevante (nessuna riga: evita un record ogni 30 minuti). */
export function revisionReason(last, next, step = OBSERVATION.probStep) {
  if (!last) return "initial";
  if (ts(last.starts_at) !== ts(next.starts_at)) return "rescheduled";
  if (last.model_ver !== next.model_ver) return "model_version";
  if (!!last.published !== !!next.published) return "publication";
  if (next.published && Math.abs(Number(last.p1) - Number(next.p1)) >= step - 1e-9) return "probability";
  const a = JSON.stringify([...(last.missing ?? [])].sort()), b = JSON.stringify([...(next.missing ?? [])].sort());
  if (a !== b) return "missing_data";
  if (last.ratings_ver != null && next.ratings_ver != null && last.ratings_ver !== next.ratings_ver) return "ratings_version";
  return null;
}

/**
 * Pianifica le scritture del giro (funzione pura). matches = righe tennis_matches (programma), rows = righe di previsione GIÀ calcolate dal motore,
 * existing = { observed: Set(match_key), last: Map(match_key → ultima versione {rev, starts_at, model_ver, published, p1, missing}) }.
 * `ratings` = historyFingerprint(): se lo storico ha date future o è vuoto NON si registra nulla (eccezione con codice). Registra SOLO partite `scheduled`
 * con inizio futuro e solo se `now` precede l'inizio. La sola relazione recorded_at < starts_at della partita NON basta: conta anche history_last_at <= recorded_at.
 */
export function planObservations({ matches, rows, book, stats, ranks, existing, now, ratings }) {
  const guard = checkHistoryPrematch(ratings, now);
  if (!guard.ok) throw Object.assign(new Error(`${guard.code}: nessuna osservazione registrabile`), { code: guard.code, detail: guard.detail });
  const byKey = new Map(matches.map((m) => [m.match_key, m])), obs = [], versions = [], skipped = [];
  const rv = ratingsVersion(ratings), recordedAt = new Date(now).toISOString(), historyLastAt = new Date(ratings.lastAt).toISOString();
  for (const row of rows) {
    const m = byKey.get(row.match_key);
    if (!m) { skipped.push({ key: row.match_key, why: "partita assente dal programma" }); continue; }
    if (m.status !== "scheduled") { skipped.push({ key: m.match_key, why: `stato ${m.status}` }); continue; }
    if (!(ts(m.starts_at) > now)) { skipped.push({ key: m.match_key, why: "inizio non futuro (pre-match violato)" }); continue; }
    if (!m.p1_id || !m.p2_id || !row.model_ver) { skipped.push({ key: m.match_key, why: "identificativi o versione del modello mancanti" }); continue; }
    const inputs = modelInputs({ match: m, row, book, stats, ranks });
    const next = { starts_at: m.starts_at, model_ver: row.model_ver, published: !!row.published, p1: row.published ? row.p1 : null, missing: row.missing ?? [], ratings_ver: rv };
    const last = existing.last.get(m.match_key) ?? null, reason = revisionReason(last, next);
    if (!reason) continue;
    if (!existing.observed.has(m.match_key)) obs.push({ match_key: m.match_key, first_recorded_at: recordedAt, first_starts_at: m.starts_at, tour: m.tour, tournament_id: m.tournament_id ?? null, tournament: m.tournament ?? null, category: m.category ?? null, surface: row.surface ?? null, round_id: m.round_id ?? null, p1_id: m.p1_id, p2_id: m.p2_id, p1_name: m.p1_name ?? null, p2_name: m.p2_name ?? null, observation_ver: OBSERVATION.version });
    versions.push({
      match_key: m.match_key, rev: (last?.rev ?? 0) + 1, recorded_at: recordedAt, starts_at: m.starts_at, reason, model_ver: row.model_ver, ratings_ver: rv, history_loader: ratings.loader ?? null, history_matches: ratings.matches ?? null, history_last_at: historyLastAt,
      published: !!row.published, pick: row.published ? row.pick : null, p1: row.published ? row.p1 : null, p2: row.published ? row.p2 : null, reliability: row.published ? row.reliability : null, abstain_reason: row.abstain_reason ?? null,
      elo1: inputs.p1.elo, elo2: inputs.p2.elo, form1: inputs.p1.form, form2: inputs.p2.form, inputs, missing: row.missing ?? [],
    });
  }
  return { observations: obs, versions, skipped };
}

/** Stato di una osservazione rispetto al risultato: ricalca la vista SQL tennis_observation_results (collegamento per match_key + id dei giocatori, MAI per nome). */
export function observationState(obs, match, now = Date.now()) {
  if (!match) return "unknown";
  if (match.p1_id !== obs.p1_id || match.p2_id !== obs.p2_id) return "identity_mismatch";
  const s = match.status;
  if (s === "finished") return match.winner === 1 || match.winner === 2 ? "concluded" : "awaiting_result";
  if (["live", "postponed", "cancelled", "interrupted", "ended_other"].includes(s)) return s;
  if (s === "scheduled" || s === "unknown") return ts(match.starts_at) <= now ? "awaiting_result" : s === "scheduled" ? "upcoming" : "unknown";
  return "unknown";
}

// ───────────── Metriche prospettiche (SOLO valutazione iniziale) ─────────────
const EPS = 1e-6, clip = (p) => Math.min(1 - EPS, Math.max(EPS, p));
const ll = (p, y) => -(y ? Math.log(clip(p)) : Math.log(clip(1 - p))), br = (p, y) => (p - y) ** 2;
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const lcg = (seed) => { let s = seed >>> 0; return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296); };
export const blockOf = (r) => `${r.tournamentId ?? r.tournament ?? "?"}|${Math.floor(ts(r.startsAt) / (7 * 864e5))}`;

/** Bootstrap per BLOCCHI torneo-settimana della media di f(riga); seme fisso → riproducibile. */
export function blockBootstrap(rows, f, { reps = OBSERVATION.bootstrapReps, seed = OBSERVATION.seed } = {}) {
  const groups = new Map(); for (const r of rows) (groups.get(blockOf(r)) ?? groups.set(blockOf(r), []).get(blockOf(r))).push(f(r));
  const bl = [...groups.values()], est = mean(rows.map(f));
  if (bl.length < 2) return { est: r4(est), lo: null, hi: null, blocks: bl.length };
  const rnd = lcg(seed), out = [];
  for (let b = 0; b < reps; b++) { let s = 0, n = 0; for (let j = 0; j < bl.length; j++) { const g = bl[Math.floor(rnd() * bl.length)]; for (const v of g) { s += v; n++; } } out.push(s / n); }
  out.sort((a, b) => a - b);
  return { est: r4(est), lo: r4(out[Math.floor(0.025 * out.length)]), hi: r4(out[Math.ceil(0.975 * out.length) - 1]), blocks: bl.length };
}

/** Calibrazione per fasce del lato 1 (probabilità dichiarata contro frequenza osservata) ed ECE. */
export function calibration(rows, bins = 10) {
  const b = Array.from({ length: bins }, () => ({ n: 0, p: 0, y: 0 }));
  for (const r of rows) { const k = Math.min(bins - 1, Math.floor(r.p1 * bins)); b[k].n++; b[k].p += r.p1; b[k].y += r.y; }
  const ece = rows.length ? b.reduce((s, x) => s + (x.n / rows.length) * (x.n ? Math.abs(x.p / x.n - x.y / x.n) : 0), 0) : null;
  return { ece: r4(ece), bins: b.map((x, i) => ({ lo: i / bins, hi: (i + 1) / bins, n: x.n, claimed: x.n ? r4(x.p / x.n) : null, observed: x.n ? r4(x.y / x.n) : null })).filter((x) => x.n) };
}

/**
 * Metriche prospettiche. items = [{ initial, state, winner, startsAt, tournamentId, tournament }] con `initial` = versione rev 1.
 * Valide solo: valutazione iniziale pubblicata, partita `concluded` con vincitore. Tutto il resto è ESCLUSO e contato per motivo.
 */
export function prospectiveMetrics(items) {
  const excluded = { abstained: 0, notConcluded: 0, retiredOrWalkover: 0, cancelledOrPostponed: 0, identityMismatch: 0, noInitial: 0 };
  const valid = [];
  for (const it of items) {
    if (!it.initial) { excluded.noInitial++; continue; }
    if (it.state === "identity_mismatch") { excluded.identityMismatch++; continue; }
    if (it.state === "ended_other") { excluded.retiredOrWalkover++; continue; }
    if (it.state === "cancelled" || it.state === "postponed") { excluded.cancelledOrPostponed++; continue; }
    if (it.state !== "concluded") { excluded.notConcluded++; continue; }
    if (!it.initial.published) { excluded.abstained++; continue; }
    valid.push({ p1: Number(it.initial.p1), y: it.winner === 1 ? 1 : 0, startsAt: it.startsAt, tournamentId: it.tournamentId, tournament: it.tournament });
  }
  const n = valid.length, blocks = new Set(valid.map(blockOf)).size, sufficient = n >= OBSERVATION.minSample && blocks >= OBSERVATION.minBlocks;
  const missing = {}; for (const it of items) for (const k of it.initial?.missing ?? []) missing[k] = (missing[k] ?? 0) + 1;
  const base = { valid: n, blocks, excluded, sufficient, missingData: missing, minSample: OBSERVATION.minSample, minBlocks: OBSERVATION.minBlocks, basis: "solo valutazione iniziale (rev 1), solo partite concluse con vincitore verificato" };
  if (!n) return { ...base, brier: null, logLoss: null, accuracy: null, calibration: { ece: null, bins: [] }, note: "Nessuna osservazione valida: nessuna metrica." };
  const acc = mean(valid.map((r) => ((r.p1 >= 0.5 ? 1 : 0) === r.y ? 1 : 0)));
  return { ...base, brier: blockBootstrap(valid, (r) => br(r.p1, r.y)), logLoss: blockBootstrap(valid, (r) => ll(r.p1, r.y)), accuracy: { est: r4(acc) }, calibration: calibration(valid),
    note: sufficient ? "Campione sufficiente per una lettura descrittiva (non è un'indicazione di gioco)." : `Campione insufficiente (${n}/${OBSERVATION.minSample} osservazioni, ${blocks}/${OBSERVATION.minBlocks} blocchi): numeri solo indicativi, nessuna conclusione.` };
}

/** Stabilità delle valutazioni: partite con revisioni, scarto medio tra prima e ultima versione, motivi. Analisi SEPARATA dalle metriche. */
export function revisionStats(versionsByKey) {
  let withRev = 0, total = 0, gaps = []; const reasons = {};
  for (const vs of versionsByKey.values()) {
    total++; if (vs.length > 1) withRev++;
    for (const v of vs.slice(1)) reasons[v.reason] = (reasons[v.reason] ?? 0) + 1;
    const first = vs[0], last = vs.at(-1); if (vs.length > 1 && first.published && last.published) gaps.push(Math.abs(Number(last.p1) - Number(first.p1)));
  }
  return { observed: total, withRevisions: withRev, reasons, meanAbsShift: gaps.length ? r4(mean(gaps)) : null, maxAbsShift: gaps.length ? r4(Math.max(...gaps)) : null };
}
