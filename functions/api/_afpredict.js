/**
 * Pronostico di API-Football (endpoint `predictions`) usato come input principale del modello.
 * - parseAfPrediction: risposta del provider -> numeri pronti per il modello (funzione pura, testabile).
 * - loadAfPredictions: per un gruppo di partite, collega l'id API-Football, scarica (o legge dalla cache) il pronostico.
 *   Procede a piccoli passi e senza insistere se il provider limita le richieste: restituisce `retry` e il browser richiede da solo.
 */
import { supabaseGet } from "./_lib.js";
import { AF_LEAGUES, RETRY_HINT, directMap, loadSections, resolveFixture, ttlFor } from "./_apifootball.js";

const pct = (s) => { const n = parseFloat(String(s ?? "").replace("%", "").replace(",", ".")); return Number.isFinite(n) ? n / 100 : null; };
const avg = (t, kind, venue) => { const n = parseFloat(t?.league?.goals?.[kind]?.average?.[venue]); return Number.isFinite(n) && n >= 0 ? n : null; };
const mean = (a, b) => (a != null && b != null ? (a + b) / 2 : null);

/**
 * item = response[0] dell'endpoint `predictions`. Restituisce null se il provider non ha nulla di utilizzabile.
 *  - percent: probabilita' 1X2 del provider (normalizzate a 1)
 *  - lambda: gol attesi dalle medie stagionali (gol fatti della squadra nel suo campo + gol subiti dall'avversaria nel suo)
 *  - underOver: consiglio sui gol (es. "-2.5" = Under 2,5), played: partite stagionali di campionato (la meno giocata delle due)
 */
export function parseAfPrediction(item) {
  const pr = item?.predictions;
  if (!pr) return null;
  const raw = { home: pct(pr.percent?.home), draw: pct(pr.percent?.draw), away: pct(pr.percent?.away) };
  const sum = (raw.home ?? NaN) + (raw.draw ?? NaN) + (raw.away ?? NaN);
  const r4 = (v) => Math.round(v * 1e4) / 1e4;
  const percent = Number.isFinite(sum) && sum > 0.9 && sum < 1.1 ? { home: r4(raw.home / sum), draw: r4(raw.draw / sum), away: r4(raw.away / sum) } : null;
  const uo = /([+-])\s*(\d+(?:\.\d+)?)/.exec(String(pr.under_over ?? ""));
  const underOver = uo ? { side: uo[1] === "+" ? "over" : "under", line: Number(uo[2]) } : null;
  const h = item.teams?.home, a = item.teams?.away;
  const lh = mean(avg(h, "for", "home"), avg(a, "against", "away"));
  const la = mean(avg(a, "for", "away"), avg(h, "against", "home"));
  const lambda = lh > 0 && la > 0 ? { home: lh, away: la } : null;
  const played = Math.min(Number(h?.league?.fixtures?.played?.total) || 0, Number(a?.league?.fixtures?.played?.total) || 0);
  if (!percent && !lambda && !underOver) return null;
  return { percent, underOver, lambda, played, advice: pr.advice ?? null, winner: pr.winner?.name ?? null, winOrDraw: Boolean(pr.win_or_draw) };
}

/**
 * Collega le partite dell'app a quelle di API-Football: id già salvati o diretti; le mancanti si cercano a piccoli passi (maxMap per volta).
 * Restituisce { maps: Map(game_id -> riga), waiting: [game_id], afterMs }.
 */
export async function resolveMaps(env, open, now, { live = true, maxMap = 6, maps: known = null } = {}) {
  const maps = new Map(known ?? []);
  for (const m of open) { if (maps.has(m.game_id)) continue; const d = directMap(m); if (d) maps.set(m.game_id, d); }
  const rest = open.filter((m) => !maps.has(m.game_id));
  for (const part of chunk(rest, 60)) {
    const rows = await supabaseGet(env, "af_fixture_map", { select: "*", game_id: `in.(${part.map((m) => `"${m.game_id}"`).join(",")})`, limit: 60 });
    for (const r of rows) maps.set(r.game_id, r);
  }
  const waiting = [];
  let searched = 0, blocked = false, afterMs = 0;
  const unresolved = open.filter((m) => !maps.has(m.game_id)).sort((a, b) => a.league.localeCompare(b.league) || Date.parse(a.kickoff_at) - Date.parse(b.kickoff_at));
  for (const m of unresolved) {
    if (!live) { waiting.push(m.game_id); continue; }
    if (blocked || searched >= maxMap) { waiting.push(m.game_id); afterMs = Math.max(afterMs, blocked ? RETRY_HINT.rateLimit : RETRY_HINT.batch); continue; }
    searched += 1;
    try {
      const r = await resolveFixture(env, m, now);
      if (r.map) maps.set(m.game_id, r.map);
      else if (/too many|limite|per minute|rate/i.test(r.error ?? "")) { blocked = true; waiting.push(m.game_id); afterMs = Math.max(afterMs, RETRY_HINT.rateLimit); }
    } catch { /* partita non collegabile: resta senza */ }
  }
  return { maps, waiting, afterMs };
}

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

/**
 * matches: righe `matches`. Opzioni: live (false = solo cache, nessuna richiesta), maxMap (ricerche id partita per volta), maxLive (pronostici per volta).
 * Restituisce { byGame: Map(game_id -> parsed|null), state: Map(game_id -> "used"|"waiting"|"missing"), retry: { pending, afterMs } }.
 *  - used: pronostico disponibile (anche se un po' vecchio); waiting: da scaricare (limite richieste o coda); missing: il provider non lo ha / partita non collegata.
 */
export async function loadAfPredictions(env, matches, now = Date.now(), opts = {}) {
  const { live = true, maxMap = 6, maxLive } = opts;
  const byGame = new Map(), state = new Map();
  let afterMs = 0;
  const open = matches.filter((m) => AF_LEAGUES[m.league] && m.status !== "canceled");
  for (const m of matches) if (!open.includes(m)) state.set(m.game_id, "missing");
  if (!open.length) return { byGame, state, maps: new Map(), retry: { pending: 0, afterMs: 0 } };

  // 1) collegamento partita app -> partita API-Football
  const { maps, waiting, afterMs: mapWait } = await resolveMaps(env, open, now, { live, maxMap, maps: opts.maps });
  for (const id of waiting) state.set(id, "waiting");
  afterMs = Math.max(afterMs, mapWait);
  for (const m of open) if (!maps.has(m.game_id) && !state.has(m.game_id)) state.set(m.game_id, "missing");

  // 2) pronostici: cache valida -> nessuna richiesta; altrimenti scarico a passi (loadSections si ferma al primo limite superato)
  const mapped = open.filter((m) => maps.has(m.game_id));
  const reqs = mapped.map((m) => ({ section: m.game_id, endpoint: "predictions", params: { fixture: maps.get(m.game_id).fixture_id }, ttl: ttlFor("predictions", { kickoff: Date.parse(m.kickoff_at), now, finished: m.status === "final" }) }));
  let sections = {};
  for (const part of chunk(reqs, 40)) {
    const r = await loadSections(env, part, now, { ...(maxLive != null ? { maxLive } : {}), ...(live ? {} : { maxLive: 0 }) });
    Object.assign(sections, r.sections);
    if (live && r.retry.pending) afterMs = Math.max(afterMs, r.retry.afterMs);
  }
  for (const m of mapped) {
    const s = sections[m.game_id];
    const parsed = s?.data?.[0] ? parseAfPrediction(s.data[0]) : null;
    if (parsed) { byGame.set(m.game_id, parsed); state.set(m.game_id, "used"); }
    else state.set(m.game_id, s?.deferred ? "waiting" : "missing");
  }
  const pending = live ? [...state.values()].filter((v) => v === "waiting").length : 0;
  return { byGame, state, maps, retry: { pending, afterMs: pending ? afterMs || RETRY_HINT.batch : 0 } };
}

/** Riassunto per la risposta delle API: quante partite usano il pronostico del provider e se serve riprovare. */
export function afStatusOf(state, retry, ids) {
  const vals = ids.map((id) => state.get(id) ?? "missing");
  return { used: vals.filter((v) => v === "used").length, waiting: vals.filter((v) => v === "waiting").length, missing: vals.filter((v) => v === "missing").length, retry };
}
