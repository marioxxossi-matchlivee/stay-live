/**
 * Dati che alimentano il cervello unico per un gruppo di partite: pronostico di API-Football, quote di mercato (gol e 1X2)
 * e numero di assenti (solo se già in cache). Una sola lettura/scarico per tutto: collega l'id partita, poi scarica a passi
 * (cache valida = nessuna richiesta; limite superato = ci si ferma e si segnala `retry`, il browser richiede da solo).
 */
import { AF_LEAGUES, RETRY_HINT, betIdsFrom, loadSections, ttlFor } from "./_apifootball.js";
import { parseAfPrediction, resolveMaps } from "./_afpredict.js";
import { marketFrom } from "./_market.js";

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

/** Assenti per squadra dalla risposta `injuries` (tipo "Missing Fixture"; i "dubbi" non contano). */
export function countAbsent(list, map) {
  const out = { home: 0, away: 0 };
  for (const x of list ?? []) {
    if (!/missing|out|suspen/i.test(String(x.player?.type ?? ""))) continue;
    if (x.team?.id === map?.home_team_id) out.home += 1;
    else if (x.team?.id === map?.away_team_id) out.away += 1;
  }
  return out;
}

/**
 * Opzioni: live (false = solo cache, nessuna richiesta), maxMap (ricerche id partita per volta), maxLive (richieste per volta),
 * market (false = non cercare le quote), maps (collegamenti già noti).
 * Restituisce { byGame: Map(game_id -> { af, market, inj }), state: Map(game_id -> "used"|"waiting"|"missing") (pronostico),
 *               marketState: Map(game_id -> "used"|"waiting"|"missing"), maps, retry: { pending, afterMs } }.
 */
const EXTRA_ODDS_MS = 36 * 3600e3, EXTRA_FRESH_MS = 6 * 3600e3;     // quote doppia chance / gol-no gol: partite entro 36 ore, rinfrescate al più ogni 6 ore

export async function loadBrainInputs(env, matches, now = Date.now(), { live = true, maxMap = 6, maxLive = 12, market = true, maps: known = null, freshFor = null } = {}) {
  const byGame = new Map(), state = new Map(), marketState = new Map(), errors = new Map();
  const open = matches.filter((m) => AF_LEAGUES[m.league] && m.status !== "canceled");
  for (const m of matches) if (!open.includes(m)) { state.set(m.game_id, "missing"); marketState.set(m.game_id, "missing"); }
  if (!open.length) return { byGame, state, marketState, errors, maps: new Map(), retry: { pending: 0, afterMs: 0 } };

  let afterMs = 0;
  const { maps, waiting, afterMs: mapWait } = await resolveMaps(env, open, now, { live, maxMap, maps: known });
  for (const id of waiting) { state.set(id, "waiting"); marketState.set(id, "waiting"); }
  afterMs = Math.max(afterMs, mapWait);

  const mapped = open.filter((m) => maps.has(m.game_id));
  const ttl = (kind, m) => ttlFor(kind, { kickoff: Date.parse(m.kickoff_at), now, finished: m.status === "final" });
  const fresh = (kind, m) => (freshFor ? Math.min(ttl(kind, m), freshFor(m)) : undefined);      // freshFor(m): età massima accettata dal giro completo (ms)
  const fx = (m) => maps.get(m.game_id).fixture_id;
  let bets = { goals: 5, winner: 1, doubleChance: 12, btts: 8 };
  if (market && mapped.length) {
    const { sections } = await loadSections(env, [{ section: "bets", endpoint: "odds/bets", params: {}, ttl: ttlFor("odds-bets") }], now, { maxLive: live ? 1 : 0 });
    bets = betIdsFrom(sections.bets?.data);
  }
  // Quote reali di doppia chance e gol/no gol: solo per le partite entro 36 ore (le lontane cambiano e costano richieste inutili). Con una quota
  // reale il verdetto usa il valore atteso (pLow x quota), non la soglia "punti sulla media del campionato" che favorisce solo gli esiti rari.
  const extra = market ? mapped.filter((m) => Date.parse(m.kickoff_at) - now <= EXTRA_ODDS_MS) : [];
  const freshExtra = (m) => (freshFor ? Math.min(ttl("odds", m), EXTRA_FRESH_MS, freshFor(m) * 2) : undefined);
  // Ordine: prima i pronostici di tutte le partite, poi le quote: se il provider limita le richieste, ogni partita ha almeno il pronostico.
  const reqs = [
    ...mapped.map((m) => ({ section: `${m.game_id}|pred`, endpoint: "predictions", params: { fixture: fx(m) }, ttl: ttl("predictions", m), fresh: fresh("predictions", m) })),
    ...(market ? mapped.flatMap((m) => [
      { section: `${m.game_id}|goals`, endpoint: "odds", params: { fixture: fx(m), bet: bets.goals }, ttl: ttl("odds", m), fresh: fresh("odds", m) },
      { section: `${m.game_id}|x12`, endpoint: "odds", params: { fixture: fx(m), bet: bets.winner }, ttl: ttl("odds", m), fresh: fresh("odds", m) },
    ]) : []),
    ...extra.flatMap((m) => [
      { section: `${m.game_id}|dc`, endpoint: "odds", params: { fixture: fx(m), bet: bets.doubleChance }, ttl: ttl("odds", m), fresh: freshExtra(m) },
      { section: `${m.game_id}|btts`, endpoint: "odds", params: { fixture: fx(m), bet: bets.btts }, ttl: ttl("odds", m), fresh: freshExtra(m) },
    ]),
  ];
  const sections = {};
  const parts = chunk(reqs, 60);
  if (live) {
    let budget = maxLive;
    for (const part of parts) {                                  // in sequenza: il tetto di richieste vale per tutto il giro
      const r = await loadSections(env, part, now, { maxLive: budget });
      Object.assign(sections, r.sections);
      budget = Math.max(0, budget - Object.values(r.sections).filter((s) => s.source === "live").length);
      if (r.retry.pending) afterMs = Math.max(afterMs, r.retry.afterMs);
    }
  } else {
    for (const r of await Promise.all(parts.map((part) => loadSections(env, part, now, { maxLive: 0 })))) Object.assign(sections, r.sections);
  }
  // Assenti: solo dalla cache (si scaricano aprendo la scheda dati della partita), mai una richiesta in più da qui.
  const injReqs = mapped.map((m) => ({ section: `${m.game_id}|inj`, endpoint: "injuries", params: { fixture: fx(m) }, ttl: ttl("injuries", m) }));
  for (const r of await Promise.all(chunk(injReqs, 60).map((part) => loadSections(env, part, now, { maxLive: 0 })))) Object.assign(sections, r.sections);

  for (const m of mapped) {
    const id = m.game_id;
    const sp = sections[`${id}|pred`], sg = sections[`${id}|goals`], sx = sections[`${id}|x12`], si = sections[`${id}|inj`], sd = sections[`${id}|dc`], sb = sections[`${id}|btts`];
    const af = sp?.data?.[0] ? parseAfPrediction(sp.data[0]) : null;
    const mk = market && (sg?.data || sx?.data) ? marketFrom(sg?.data, sx?.data, sd?.data, sb?.data) : null;
    const inj = si?.data ? countAbsent(si.data, maps.get(id)) : null;
    byGame.set(id, { af, market: mk, inj });
    if (!af && sp?.error && !sp.deferred) errors.set(`${id}|pred`, sp.error);
    if (market && !mk && !(sg?.deferred || sx?.deferred) && (sg?.error || sx?.error)) errors.set(`${id}|market`, sg?.error ?? sx?.error);
    state.set(id, af ? "used" : sp?.deferred ? "waiting" : "missing");
    marketState.set(id, !market ? "missing" : mk ? "used" : (sg?.deferred || sx?.deferred) ? "waiting" : "missing");
  }
  for (const m of open) { if (!state.has(m.game_id)) state.set(m.game_id, "missing"); if (!marketState.has(m.game_id)) marketState.set(m.game_id, "missing"); }
  const pending = live ? open.filter((m) => state.get(m.game_id) === "waiting" || marketState.get(m.game_id) === "waiting").length : 0;
  return { byGame, state, marketState, errors, maps, retry: { pending, afterMs: pending ? afterMs || RETRY_HINT.batch : 0 } };
}

/** Riassunto per le risposte delle API: quante partite hanno pronostico e quote, e se serve riprovare. */
export function brainStatusOf(r, ids) {
  const count = (map, v) => ids.filter((id) => (map.get(id) ?? "missing") === v).length;
  return { used: count(r.state, "used"), waiting: count(r.state, "waiting"), missing: count(r.state, "missing"), market: count(r.marketState, "used"), marketWaiting: count(r.marketState, "waiting"), retry: r.retry };
}
