/**
 * Modello statistico dei corner di Stay Live: usa SOLO i corner reali delle partite finite (API-Football `fixtures/statistics`,
 * salvati in `match_corners`), non le quote dei bookmaker. Le quote restano in _corners.js come informazione separata.
 *
 * Per ogni squadra: corner fatti e subiti, in casa/trasferta e nelle ultime 5/10/15 partite, con restringimento verso la media del
 * campionato (poche partite = ci si fida poco). Corner attesi per squadra -> distribuzione binomiale negativa (Poisson se la
 * dispersione osservata è ~1) -> totale (convoluzione) -> probabilità Over/Under e "chi ne fa di più".
 * Funzioni pure e testabili. `verified: false`: finché non c'è un backtest dei corner, non è un "valore" dimostrato.
 */
import { AF_LEAGUES, directMap, loadSections, ttlFor } from "./_apifootball.js";
import { supabaseGetAll, supabaseUpsert, SEASON } from "./_lib.js";

export const MODEL_VERSION = "corner-v1";
export const WINDOWS = [5, 10, 15];
export const MIN_GAMES = 5;              // partite con corner disponibili per squadra, sotto le quali non si stima nulla
const SHRINK_K = 6;                      // peso della media di campionato (come partite "virtuali")
const FORM_WEIGHTS = { 5: 0.35, 10: 0.35, 15: 0.3 };
const LINES = [6.5, 7.5, 8.5, 9.5, 10.5, 11.5, 12.5, 13.5];
const MAX_K = 40;
const r4 = (v) => Math.round(v * 1e4) / 1e4;
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0);

/** Corner dalla risposta `fixtures/statistics?fixture=` (due oggetti squadra con "Corner Kicks"). null se il provider non ha statistiche. */
export function cornersFromStatistics(resp, homeId, awayId) {
  if (!Array.isArray(resp) || resp.length < 2) return null;
  const val = (t) => { const v = (t?.statistics ?? []).find((x) => /^corner kicks$/i.test(String(x.type ?? "")))?.value; const n = Number(v); return v != null && v !== "" && Number.isFinite(n) ? n : null; };
  const h = resp.find((t) => t.team?.id === homeId) ?? resp[0], a = resp.find((t) => t.team?.id === awayId) ?? resp[1];
  const home = val(h), away = val(a);
  return home == null || away == null ? null : { home, away, total: home + away };
}

/** Riga di match_corners. c = { home, away } oppure null (statistiche non fornite). */
export function cornerRow(m, c, now = Date.now()) {
  return { game_id: m.game_id, league: m.league, season: SEASON, kickoff_at: m.kickoff_at, home_id: m.home_id, away_id: m.away_id, home_corners: c?.home ?? null, away_corners: c?.away ?? null, available: Boolean(c), fetched_at: new Date(now).toISOString() };
}

/** Indice dei corner storici: righe di match_corners (solo `available`) -> medie di campionato e partite per squadra. */
export function buildCornerContext(rows) {
  const leagues = new Map(), teams = new Map();
  const per = new Map();
  for (const r of rows ?? []) {
    if (!r.available || r.home_corners == null || r.away_corners == null) continue;
    const t = Date.parse(r.kickoff_at);
    (per.get(r.league) ?? per.set(r.league, []).get(r.league)).push(r);
    for (const [id, own, opp, home] of [[r.home_id, r.home_corners, r.away_corners, true], [r.away_id, r.away_corners, r.home_corners, false]]) {
      (teams.get(id) ?? teams.set(id, []).get(id)).push({ t, own, opp, home, league: r.league });
    }
  }
  for (const [lg, rs] of per) {
    const h = rs.map((r) => r.home_corners), a = rs.map((r) => r.away_corners), tot = rs.map((r) => r.home_corners + r.away_corners);
    const all = [...h, ...a], m = mean(all), v = mean(all.map((x) => (x - m) ** 2));
    leagues.set(lg, { n: rs.length, meanHome: mean(h), meanAway: mean(a), disp: Math.min(2, Math.max(1, m > 0 ? v / m : 1)), meanTotal: mean(tot) });
  }
  for (const g of teams.values()) g.sort((x, y) => y.t - x.t);
  return { leagues, teams };
}

/** Rapporto (squadra / media di riferimento) con restringimento: (somma + k*base) / (n + k) / base. */
const shrunkRatio = (vals, base) => (base > 0 ? (vals.reduce((s, x) => s + x, 0) + SHRINK_K * base) / (vals.length + SHRINK_K) / base : 1);

/** Quanto "attacca"/"concede" una squadra (rapporti sulla media di campionato): stagione per campo e forma sulle ultime 5/10/15. */
export function teamProfile(ctx, teamId, league, beforeMs, venueHome) {
  const lg = ctx.leagues.get(league);
  const games = (ctx.teams.get(teamId) ?? []).filter((g) => g.league === league && g.t < beforeMs);
  if (!lg || games.length < MIN_GAMES) return null;
  const baseAll = (lg.meanHome + lg.meanAway) / 2;
  const venue = games.filter((g) => g.home === venueHome);
  const baseOwn = venueHome ? lg.meanHome : lg.meanAway, baseOpp = venueHome ? lg.meanAway : lg.meanHome;
  const season = { for: shrunkRatio(venue.map((g) => g.own), baseOwn), against: shrunkRatio(venue.map((g) => g.opp), baseOpp) };
  let formFor = 0, formAgainst = 0;
  for (const w of WINDOWS) { const g = games.slice(0, w); formFor += FORM_WEIGHTS[w] * shrunkRatio(g.map((x) => x.own), baseAll); formAgainst += FORM_WEIGHTS[w] * shrunkRatio(g.map((x) => x.opp), baseAll); }
  return { games: games.length, venueGames: venue.length, for: 0.5 * season.for + 0.5 * formFor, against: 0.5 * season.against + 0.5 * formAgainst,
    avgFor: r4(mean(games.map((g) => g.own))), avgAgainst: r4(mean(games.map((g) => g.opp))), last: Object.fromEntries(WINDOWS.map((w) => [w, { for: r4(mean(games.slice(0, w).map((g) => g.own))), against: r4(mean(games.slice(0, w).map((g) => g.opp))), n: Math.min(w, games.length) }])) };
}

/** Funzione di massa della binomiale negativa (media mu, varianza = disp*mu); con disp ~1 è una Poisson. */
export function nbPmf(mu, disp, kmax = MAX_K) {
  const out = new Array(kmax + 1).fill(0);
  if (!(mu > 0)) { out[0] = 1; return out; }
  if (disp <= 1.0001) { out[0] = Math.exp(-mu); for (let k = 0; k < kmax; k += 1) out[k + 1] = (out[k] * mu) / (k + 1); return out; }
  const p = 1 / disp, r = (mu * p) / (1 - p);
  out[0] = p ** r;
  for (let k = 0; k < kmax; k += 1) out[k + 1] = (out[k] * (k + r) * (1 - p)) / (k + 1);
  return out;
}

const convolve = (a, b) => { const o = new Array(a.length + b.length - 1).fill(0); for (let i = 0; i < a.length; i += 1) for (let j = 0; j < b.length; j += 1) o[i + j] += a[i] * b[j]; return o; };

/**
 * Previsione corner di una partita. match: { league, kickoff_at, home_id, away_id }. null + reason se mancano dati (mai inventati).
 * Restituisce corner attesi per squadra e totali, Over/Under per linea, probabilità che una squadra ne faccia più dell'altra.
 */
export function cornerModel(ctx, match, { lines = LINES } = {}) {
  const lg = ctx?.leagues?.get(match.league);
  if (!lg) return { ok: false, reason: "Nessun corner storico per questo campionato." };
  const t = Date.parse(match.kickoff_at);
  const H = teamProfile(ctx, match.home_id, match.league, t, true), A = teamProfile(ctx, match.away_id, match.league, t, false);
  if (!H || !A) return { ok: false, reason: `Corner storici insufficienti (servono almeno ${MIN_GAMES} partite per squadra).`, sample: { home: H?.games ?? (ctx.teams.get(match.home_id) ?? []).length, away: A?.games ?? (ctx.teams.get(match.away_id) ?? []).length, league: lg.n } };
  const lamH = lg.meanHome * H.for * A.against, lamA = lg.meanAway * A.for * H.against;
  const pH = nbPmf(lamH, lg.disp), pA = nbPmf(lamA, lg.disp), tot = convolve(pH, pA);
  const sumTo = (arr, f) => arr.reduce((s, x, i) => (f(i) ? s + x : s), 0);
  const lineRows = lines.map((line) => { const under = sumTo(tot, (i) => i < line); return { line, over: r4(1 - under), under: r4(under) }; });
  let pHome = 0, pAway = 0, pEq = 0;
  for (let i = 0; i < pH.length; i += 1) for (let j = 0; j < pA.length; j += 1) { const q = pH[i] * pA[j]; if (i > j) pHome += q; else if (i < j) pAway += q; else pEq += q; }
  const norm = pHome + pAway + pEq;
  const probs = { home: r4(pHome / norm), away: r4(pAway / norm), even: r4(pEq / norm) };
  const gap = Math.abs(probs.home - probs.away);
  const mainLine = [...lineRows].sort((x, y) => Math.abs(x.over - 0.5) - Math.abs(y.over - 0.5))[0]?.line ?? null;
  return {
    ok: true, version: MODEL_VERSION, verified: false, source: "stay-live",
    lambda: { home: r4(lamH), away: r4(lamA), total: r4(lamH + lamA) },
    lines: lineRows, mainLine, moreCorners: { ...probs, side: gap < 0.03 ? "even" : probs.home > probs.away ? "home" : "away", gap: r4(gap) },
    sample: { home: H.games, away: A.games, league: lg.n }, form: { home: { for: H.last, against: H.avgAgainst, avgFor: H.avgFor }, away: { for: A.last, against: A.avgAgainst, avgFor: A.avgFor } }, leagueMean: { home: r4(lg.meanHome), away: r4(lg.meanAway), disp: r4(lg.disp) },
  };
}

/* ---------- Scarico dei corner storici (priorità: squadre che giocano a breve) ---------- */
/**
 * Partite finite da scaricare: ultime `perTeam` di ogni squadra che gioca nelle partite aperte, senza riga in match_corners,
 * in ordine di prossimità del prossimo impegno. `have` = Set di game_id già in match_corners (anche quelli "non disponibili").
 */
export function selectBackfill(openMatches, finals, have, { perTeam = 15, limit = 300, now = Date.now(), minAgeMs = 6 * 3600e3 } = {}) {
  const order = new Map();
  [...openMatches].sort((a, b) => Date.parse(a.kickoff_at) - Date.parse(b.kickoff_at)).forEach((m, i) => { for (const id of [m.home_id, m.away_id]) if (!order.has(id)) order.set(id, i); });
  const byTeam = new Map();
  for (const f of finals) {
    if (!/^af-\d+$/.test(f.game_id) || !AF_LEAGUES[f.league] || Date.parse(f.kickoff_at) > now - minAgeMs) continue;    // statistiche complete solo qualche ora dopo la fine
    for (const id of [f.home_id, f.away_id]) if (order.has(id)) (byTeam.get(id) ?? byTeam.set(id, []).get(id)).push(f);
  }
  const chosen = new Map();
  for (const [id, list] of byTeam) { list.sort((a, b) => Date.parse(b.kickoff_at) - Date.parse(a.kickoff_at)); for (const f of list.slice(0, perTeam)) if (!have.has(f.game_id) && !chosen.has(f.game_id)) chosen.set(f.game_id, { f, rank: order.get(id) }); else if (chosen.has(f.game_id)) chosen.get(f.game_id).rank = Math.min(chosen.get(f.game_id).rank, order.get(id)); }
  return [...chosen.values()].sort((a, b) => a.rank - b.rank || Date.parse(b.f.kickoff_at) - Date.parse(a.f.kickoff_at)).slice(0, limit).map((x) => x.f);
}

export const loadCornerRows = (env) => supabaseGetAll(env, "match_corners", { select: "game_id,league,kickoff_at,home_id,away_id,home_corners,away_corners,available", season: `eq.${SEASON}`, order: "kickoff_at.desc" }, 1000, 20);

/**
 * Scarica i corner di `matches` (finite, id "af-<n>") e li salva in match_corners. Una richiesta per partita (cache 30 giorni, nessuna ripetizione).
 * Restituisce { stored, available, unavailable, waiting, errors: [{game_id, error}] }.
 */
export async function backfillCorners(env, matches, now = Date.now(), { maxLive = 100 } = {}) {
  const out = { stored: 0, available: 0, unavailable: 0, waiting: 0, errors: [] };
  const rows = [];
  for (let i = 0; i < matches.length; i += 40) {
    const part = matches.slice(i, i + 40).map((m) => ({ m, map: directMap(m) })).filter((x) => x.map);
    const reqs = part.map(({ m, map }) => ({ section: m.game_id, endpoint: "fixtures/statistics", params: { fixture: map.fixture_id }, ttl: ttlFor("fixture", { finished: true }) }));
    const r = await loadSections(env, reqs, now, { maxLive: Math.max(0, maxLive - out.stored - out.waiting) });
    for (const { m, map } of part) {
      const s = r.sections[m.game_id];
      if (!s || s.deferred) { out.waiting += 1; continue; }
      if (s.error && !s.data) { out.errors.push({ game_id: m.game_id, error: s.error }); continue; }
      const c = cornersFromStatistics(s.data, map.home_team_id, map.away_team_id);
      rows.push(cornerRow(m, c, now));
      if (c) out.available += 1; else out.unavailable += 1;
    }
    if (rows.length) { await supabaseUpsert(env, "match_corners", rows.splice(0), "game_id"); }
    out.stored = out.available + out.unavailable;
  }
  return out;
}
