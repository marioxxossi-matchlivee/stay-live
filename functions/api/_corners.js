/**
 * Corner: l'app non ha un modello per i calci d'angolo, quindi usa SOLO le quote di API-Football (mercato "Corners Over Under").
 * La percentuale è quella implicita nelle quote: 1/quota di ogni lato, normalizzata per togliere il margine dei bookmaker.
 * Si sceglie la linea e il lato con la percentuale più alta, ma solo tra quelli che pagano almeno MIN_CORNER_ODD
 * (altrimenti vincerebbero sempre linee banali, tipo "Under 14,5" a 1,05).
 *
 * ATTENZIONE: questa NON è una stima indipendente. Una probabilità ricavata dalla quota ha per costruzione valore atteso pari al
 * margine del bookmaker cambiato di segno: `verified: false`, `ev: null`. Non va mai presentata come opportunità di valore né usata nelle multiple.
 * Un vero modello (Poisson / binomiale negativa) richiede i corner storici per partita (API-Football `fixtures/statistics`, 1 richiesta a partita),
 * non scaricati dall'app: finché mancano, il mercato corner resta solo informativo.
 */
import { AF_LEAGUES, betIdsFrom, loadSections, summarizeMatchWinner, summarizeOdds, ttlFor } from "./_apifootball.js";
import { resolveMaps } from "./_afpredict.js";
import { RETRY_HINT } from "./_apifootball.js";

export const MIN_CORNER_ODD = 1.3;
const r4 = (v) => Math.round(v * 1e4) / 1e4;

export const CORNER_WINNER_RE = /^corners?\s*1x2$|^corner match bet$/i;
const EVEN_GAP = 0.03;     // sotto 3 punti di differenza tra casa e trasferta il mercato non indica una favorita

/**
 * Chi fa più corner secondo il mercato "Corners 1x2" (quote di API-Football, già aggregate da summarizeMatchWinner).
 * Probabilità = 1/quota mediana normalizzata (senza margine). NON è un modello: è l'opinione dei bookmaker (`verified: false`).
 * side: "home" | "away" | "even" (differenza < 3 punti). Restituisce null se mancano le quote.
 */
export function cornerFavorite(w) {
  if (!w?.home?.median || !w?.draw?.median || !w?.away?.median) return null;
  const inv = { home: 1 / w.home.median, draw: 1 / w.draw.median, away: 1 / w.away.median };
  const t = inv.home + inv.draw + inv.away;
  const p = { home: r4(inv.home / t), draw: r4(inv.draw / t), away: r4(inv.away / t) };
  const gap = Math.abs(p.home - p.away);
  return {
    side: gap < EVEN_GAP ? "even" : p.home > p.away ? "home" : "away", p, gap: r4(gap), margin: r4(t - 1),
    odds: { home: w.home.median, draw: w.draw.median, away: w.away.median }, best: { home: w.home.best.odd, draw: w.draw.best.odd, away: w.away.best.odd },
    books: Math.min(w.home.n, w.draw.n, w.away.n), verified: false,
  };
}

/** Linea principale del mercato totale: probabilità Over/Under senza margine e quote mediane (per mostrare i dettagli accanto alla favorita). */
export function mainLineDetail(corners) {
  const l = (corners?.lines ?? []).find((x) => x.line === corners?.mainLine && x.over?.median > 1 && x.under?.median > 1);
  if (!l) return null;
  const io = 1 / l.over.median, iu = 1 / l.under.median, t = io + iu;
  return { line: l.line, pOver: r4(io / t), pUnder: r4(iu / t), over: l.over.median, under: l.under.median, books: Math.min(l.over.n, l.under.n) };
}

/** Corner reali di una partita dalla risposta `fixtures?id=` (statistiche di squadra, "Corner Kicks"). null se la partita non ha statistiche. */
export function cornersFromFixture(resp) {
  const fx = Array.isArray(resp) ? resp[0] : resp;
  const stats = fx?.statistics;
  if (!Array.isArray(stats) || !stats.length) return null;
  const hid = fx.teams?.home?.id, aid = fx.teams?.away?.id;
  const val = (t) => { const v = (t?.statistics ?? []).find((x) => /^corner kicks$/i.test(String(x.type ?? "")))?.value; const n = Number(v); return v != null && v !== "" && Number.isFinite(n) ? n : null; };
  const h = stats.find((t) => t.team?.id === hid) ?? stats[0], a = stats.find((t) => t.team?.id === aid) ?? stats[1];
  const home = val(h), away = val(a);
  return home == null || away == null ? null : { home, away, total: home + away };
}

/**
 * corners = risultato di summarizeOdds().corners; winner = summarizeMatchWinner(..., CORNER_WINNER_RE) (facoltativo).
 * Restituisce { best, main, mainDetail, favorite } (best può essere null se c'è solo la favorita) o null se non c'è nulla di utilizzabile.
 */
export function cornerPick(corners, minOdd = MIN_CORNER_ODD, winner = null) {
  const cands = [];
  for (const l of corners?.lines ?? []) {
    const mo = l.over?.median, mu = l.under?.median;
    if (!(mo > 1) || !(mu > 1)) continue;
    const io = 1 / mo, iu = 1 / mu, tot = io + iu;
    for (const [side, agg, inv] of [["over", l.over, io], ["under", l.under, iu]]) {
      if (agg.best.odd >= minOdd) cands.push({ line: l.line, side, p: r4(inv / tot), odd: agg.best.odd, book: agg.best.book, books: agg.n, verified: false, ev: null });
    }
  }
  cands.sort((a, b) => b.p - a.p || b.odd - a.odd);
  const favorite = cornerFavorite(winner);
  if (!cands[0] && !favorite) return null;
  return { best: cands[0] ?? null, main: corners?.mainLine ?? null, mainDetail: mainLineDetail(corners), favorite };
}

/**
 * Quote corner delle partite (stessa cache della scheda dati: una volta scaricate non si rifanno finché non possono essere cambiate).
 * live=false = solo cache. Restituisce { byGame: Map(game_id -> pick|null), state: Map(game_id -> "used"|"none"|"waiting"|"missing"), maps, retry }.
 */
export async function loadCornerOdds(env, matches, now = Date.now(), { live = true, maxMap = 4, maxLive = 6, maps: known = null, refreshMs = null } = {}) {
  const byGame = new Map(), state = new Map();
  const open = matches.filter((m) => AF_LEAGUES[m.league] && m.status !== "canceled");
  for (const m of matches) if (!open.includes(m)) state.set(m.game_id, "missing");
  if (!open.length) return { byGame, state, maps: new Map(), retry: { pending: 0, afterMs: 0 } };
  let afterMs = 0;
  const { maps, waiting, afterMs: mapWait } = await resolveMaps(env, open, now, { live, maxMap, maps: known });
  for (const id of waiting) state.set(id, "waiting");
  afterMs = Math.max(afterMs, mapWait);
  const mapped = open.filter((m) => maps.has(m.game_id));
  if (mapped.length) {
    const { sections: pre } = await loadSections(env, [{ section: "bets", endpoint: "odds/bets", params: {}, ttl: ttlFor("odds-bets") }], now, { maxLive: live ? 1 : 0 });
    const ids = betIdsFrom(pre.bets?.data), bet = ids.corners;
    const ttl = (m) => ttlFor("corner-odds", { kickoff: Date.parse(m.kickoff_at), now, finished: m.status === "final" });
    const fresh = (m) => (refreshMs == null ? ttl(m) : Math.min(ttl(m), refreshMs));      // refreshMs: si riscaricano le quote più vecchie di così (lo usa solo il giro notturno)
    const reqs = mapped.flatMap((m) => [
      { section: m.game_id, endpoint: "odds", params: { fixture: maps.get(m.game_id).fixture_id, bet }, ttl: ttl(m), fresh: fresh(m) },
      { section: `cw:${m.game_id}`, endpoint: "odds", params: { fixture: maps.get(m.game_id).fixture_id, bet: ids.cornerWinner }, ttl: ttl(m), fresh: fresh(m) },   // chi fa più corner (1X2 corner)
    ]);
    const r = await loadSections(env, reqs, now, { maxLive: live ? maxLive : 0 });
    if (live && r.retry.pending) afterMs = Math.max(afterMs, r.retry.afterMs);
    for (const m of mapped) {
      const sec = r.sections[m.game_id], cw = r.sections[`cw:${m.game_id}`];
      const winner = cw?.data ? summarizeMatchWinner(cw.data, CORNER_WINNER_RE) : null;
      const pick = sec?.data || winner ? cornerPick(sec?.data ? summarizeOdds(null, sec.data).corners : null, MIN_CORNER_ODD, winner) : null;
      if (pick) { byGame.set(m.game_id, pick); state.set(m.game_id, sec?.deferred || cw?.deferred ? "waiting" : "used"); }
      else state.set(m.game_id, sec?.deferred || cw?.deferred ? "waiting" : sec?.data || cw?.data ? "none" : "missing");
    }
  }
  for (const m of open) if (!state.has(m.game_id)) state.set(m.game_id, "missing");
  const pending = live ? [...state.values()].filter((v) => v === "waiting").length : 0;
  return { byGame, state, maps, retry: { pending, afterMs: pending ? afterMs || RETRY_HINT.batch : 0 } };
}

/**
 * Corner REALI delle partite finite (statistiche di squadra di API-Football: stessa richiesta e stessa cache della scheda dati).
 * Restituisce { byGame: Map(game_id -> {home, away, total}), state: Map(game_id -> "used"|"none"|"waiting"|"missing"), retry }.
 */
export async function loadCornerActuals(env, matches, now = Date.now(), { live = true, maxMap = 4, maxLive = 6, maps: known = null } = {}) {
  const byGame = new Map(), state = new Map();
  const open = matches.filter((m) => AF_LEAGUES[m.league] && m.status === "final");
  for (const m of matches) if (!open.includes(m)) state.set(m.game_id, "missing");
  if (!open.length) return { byGame, state, maps: new Map(), retry: { pending: 0, afterMs: 0 } };
  let afterMs = 0;
  const { maps, waiting, afterMs: mapWait } = await resolveMaps(env, open, now, { live, maxMap, maps: known });
  for (const id of waiting) state.set(id, "waiting");
  afterMs = Math.max(afterMs, mapWait);
  const mapped = open.filter((m) => maps.has(m.game_id));
  if (mapped.length) {
    const reqs = mapped.map((m) => ({ section: m.game_id, endpoint: "fixtures", params: { id: maps.get(m.game_id).fixture_id }, ttl: ttlFor("fixture", { kickoff: Date.parse(m.kickoff_at), now, finished: true }) }));
    const r = await loadSections(env, reqs, now, { maxLive: live ? maxLive : 0 });
    if (live && r.retry.pending) afterMs = Math.max(afterMs, r.retry.afterMs);
    for (const m of mapped) {
      const sec = r.sections[m.game_id], c = sec?.data ? cornersFromFixture(sec.data) : null;
      if (c) { byGame.set(m.game_id, c); state.set(m.game_id, "used"); }
      else state.set(m.game_id, sec?.deferred ? "waiting" : sec?.data ? "none" : "missing");
    }
  }
  for (const m of open) if (!state.has(m.game_id)) state.set(m.game_id, "missing");
  const pending = live ? [...state.values()].filter((v) => v === "waiting").length : 0;
  return { byGame, state, maps, retry: { pending, afterMs: pending ? afterMs || RETRY_HINT.batch : 0 } };
}
