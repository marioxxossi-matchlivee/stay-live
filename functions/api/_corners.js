/**
 * Corner: l'app non ha un modello per i calci d'angolo, quindi usa SOLO le quote di API-Football (mercato "Corners Over Under").
 * La percentuale è quella implicita nelle quote: 1/quota di ogni lato, normalizzata per togliere il margine dei bookmaker.
 * Si sceglie la linea e il lato con la percentuale più alta, ma solo tra quelli che pagano almeno MIN_CORNER_ODD
 * (altrimenti vincerebbero sempre linee banali, tipo "Under 14,5" a 1,05).
 */
import { AF_LEAGUES, betIdsFrom, loadSections, summarizeOdds, ttlFor } from "./_apifootball.js";
import { resolveMaps } from "./_afpredict.js";
import { RETRY_HINT } from "./_apifootball.js";

export const MIN_CORNER_ODD = 1.3;
const r4 = (v) => Math.round(v * 1e4) / 1e4;

/** corners = risultato di summarizeOdds().corners. Restituisce { best, main, lines } o null se non ci sono quote utilizzabili. */
export function cornerPick(corners, minOdd = MIN_CORNER_ODD) {
  const cands = [];
  for (const l of corners?.lines ?? []) {
    const mo = l.over?.median, mu = l.under?.median;
    if (!(mo > 1) || !(mu > 1)) continue;
    const io = 1 / mo, iu = 1 / mu, tot = io + iu;
    for (const [side, agg, inv] of [["over", l.over, io], ["under", l.under, iu]]) {
      if (agg.best.odd >= minOdd) cands.push({ line: l.line, side, p: r4(inv / tot), odd: agg.best.odd, book: agg.best.book, books: agg.n });
    }
  }
  cands.sort((a, b) => b.p - a.p || b.odd - a.odd);
  return cands[0] ? { best: cands[0], main: corners.mainLine ?? null } : null;
}

/**
 * Quote corner delle partite (stessa cache della scheda dati: una volta scaricate non si rifanno finché non possono essere cambiate).
 * live=false = solo cache. Restituisce { byGame: Map(game_id -> pick|null), state: Map(game_id -> "used"|"none"|"waiting"|"missing"), maps, retry }.
 */
export async function loadCornerOdds(env, matches, now = Date.now(), { live = true, maxMap = 4, maxLive = 6, maps: known = null } = {}) {
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
    const bet = betIdsFrom(pre.bets?.data).corners;
    const reqs = mapped.map((m) => ({ section: m.game_id, endpoint: "odds", params: { fixture: maps.get(m.game_id).fixture_id, bet }, ttl: ttlFor("odds", { kickoff: Date.parse(m.kickoff_at), now, finished: m.status === "final" }) }));
    const r = await loadSections(env, reqs, now, { maxLive: live ? maxLive : 0 });
    if (live && r.retry.pending) afterMs = Math.max(afterMs, r.retry.afterMs);
    for (const m of mapped) {
      const sec = r.sections[m.game_id];
      const pick = sec?.data ? cornerPick(summarizeOdds(null, sec.data).corners) : null;
      if (pick) { byGame.set(m.game_id, pick); state.set(m.game_id, "used"); }
      else state.set(m.game_id, sec?.deferred ? "waiting" : sec?.data ? "none" : "missing");
    }
  }
  for (const m of open) if (!state.has(m.game_id)) state.set(m.game_id, "missing");
  const pending = live ? [...state.values()].filter((v) => v === "waiting").length : 0;
  return { byGame, state, maps, retry: { pending, afterMs: pending ? afterMs || RETRY_HINT.batch : 0 } };
}
