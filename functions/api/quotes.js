import { LEAGUES, errorMessage, json, missingConfig, supabaseGet, supabaseUpsert } from "./_lib.js";
import { MAX_EVENTS_PER_CALL, MIN_CREDITS, ODDS_URL, QUOTE_SPEC, QUOTE_TTL, isoNoMs, matchEvent, pricesFor, summarizePrices } from "./_odds.js";

const oddsKeyOf = Object.fromEntries(LEAGUES.map((l) => [l.id, l.oddsKey]));

async function oddsFetch(env, path, params) {
  const url = new URL(`${ODDS_URL}${path}`);
  url.searchParams.set("apiKey", env.ODDS_API_KEY);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
  const res = await fetch(url, { headers: { accept: "application/json" } });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* risposta non JSON */ }
  const num = (h) => (res.headers.get(h) == null ? null : Number(res.headers.get(h)));
  return { ok: res.ok, status: res.status, data, text, remaining: num("x-requests-remaining"), used: num("x-requests-used"), last: num("x-requests-last") };
}

/**
 * GET /api/quotes?picks=ID:selezione,ID:selezione
 * Preleva da The Odds API la quota reale SOLO per la selezione indicata di ogni partita (quella che l'anteprima sta consigliando:
 * il browser la manda, così la quota è sempre per la giocata mostrata, anche con il pronostico di API-Football e le quote di mercato).
 * Risparmia i crediti del piano gratuito (500/mese): elenco eventi gratis, 1 credito per partita e mercato,
 * cache di 3 ore su Supabase, stop automatico sotto MIN_CREDITS crediti residui.
 */
export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const picks = new Map();
  for (const part of (url.searchParams.get("picks") ?? "").split(",")) {
    const [id, key] = part.split(":").map((s) => s?.trim());
    if (id && /^[\w-]{3,80}$/.test(id) && QUOTE_SPEC[key]) picks.set(id, key);
  }
  const ids = [...picks.keys()];
  if (!ids.length || ids.length > 40) return json({ error: "Seleziona da 1 a 40 partite con una giocata valida." }, 400);
  const missing = missingConfig(env);
  if (!env.ODDS_API_KEY) missing.push("ODDS_API_KEY");
  if (missing.length) return json({ error: `Variabili mancanti su Cloudflare: ${missing.join(", ")}` }, 503);

  const regions = env.ODDS_REGIONS || "eu";
  const now = Date.now();
  try {
    const inList = `in.(${ids.map((i) => `"${i}"`).join(",")})`;
    const [matches, cached, [usage]] = await Promise.all([
      supabaseGet(env, "matches", { select: "game_id,league,status,kickoff_at,home_name,away_name", game_id: inList, order: "kickoff_at.asc", limit: 40 }),
      supabaseGet(env, "odds_quotes", { select: "*", game_id: inList, limit: 200 }),
      supabaseGet(env, "odds_usage", { select: "*", limit: 1 }),
    ]);
    const quotes = {};
    const need = [];
    for (const m of matches) {
      const pick = { key: picks.get(m.game_id) };                                        // la giocata che l'anteprima sta mostrando
      if (m.status !== "scheduled" || Date.parse(m.kickoff_at) < now) continue;          // non per partite già iniziate
      if (!oddsKeyOf[m.league]) continue;                                                // campionato senza chiave The Odds API (quote da API-Football)
      const hit = cached.find((c) => c.game_id === m.game_id && c.selection === pick.key);
      if (hit && now - Date.parse(hit.captured_at) < QUOTE_TTL) {
        quotes[m.game_id] = shape(hit, pick.key, true);
      } else need.push({ m, key: pick.key });
    }

    let remaining = usage?.remaining ?? null, spent = 0;
    const errors = [], unmatched = [];
    let blocked = null;
    if (need.length && remaining != null && remaining < MIN_CREDITS) blocked = `Crediti The Odds API quasi finiti (${remaining} rimasti): non ne spendo altri.`;
    const todo = blocked ? [] : need.slice(0, MAX_EVENTS_PER_CALL);
    const skipped = need.length - todo.length - (blocked ? need.length : 0);

    // 1) elenco eventi per campionato (gratuito)
    const eventsByLeague = new Map();
    for (const league of [...new Set(todo.map((x) => x.m.league))]) {
      const key = oddsKeyOf[league];
      const ts = todo.filter((x) => x.m.league === league).map((x) => Date.parse(x.m.kickoff_at));
      const r = await oddsFetch(env, `/sports/${key}/events`, { dateFormat: "iso", commenceTimeFrom: isoNoMs(Math.min(...ts) - 3 * 3600e3), commenceTimeTo: isoNoMs(Math.max(...ts) + 3 * 3600e3) });
      if (!r.ok) { errors.push(`${league}: elenco eventi HTTP ${r.status}`); eventsByLeague.set(league, []); continue; }
      eventsByLeague.set(league, Array.isArray(r.data) ? r.data : []);
    }

    // 2) quota del solo mercato consigliato, un evento alla volta (1 credito a mercato con dati)
    const rows = [];
    for (const { m, key } of todo) {
      const ev = matchEvent(m, eventsByLeague.get(m.league) ?? []);
      if (!ev) { unmatched.push(m.game_id); continue; }
      const spec = QUOTE_SPEC[key];
      const r = await oddsFetch(env, `/sports/${oddsKeyOf[m.league]}/events/${ev.id}/odds`, { regions, markets: spec.markets, oddsFormat: "decimal", dateFormat: "iso" });
      if (r.remaining != null) remaining = r.remaining;
      spent += r.last ?? 0;
      if (r.status === 401 || r.status === 429) { errors.push(r.status === 401 ? "The Odds API: chiave non valida o crediti esauriti." : "The Odds API: troppe richieste, riprova tra poco."); break; }
      if (!r.ok) { errors.push(`${m.home_name} – ${m.away_name}: HTTP ${r.status}`); continue; }
      const sum = summarizePrices(pricesFor(key, r.data ?? {}));
      if (!sum) { unmatched.push(m.game_id); continue; }
      const row = { game_id: m.game_id, selection: key, odds_median: sum.median, odds_best: sum.best, best_bookmaker: sum.bestBookmaker, books: sum.books, line: spec.line ?? null, event_id: ev.id, captured_at: new Date().toISOString() };
      rows.push(row);
      quotes[m.game_id] = shape(row, key, false);
    }
    if (rows.length) await supabaseUpsert(env, "odds_quotes", rows, "game_id,selection");
    if (spent || remaining !== (usage?.remaining ?? null)) {
      await supabaseUpsert(env, "odds_usage", [{ id: 1, remaining, used: null, last_cost: spent, updated_at: new Date().toISOString() }], "id");
    }
    return json({ quotes, unmatched, skipped: Math.max(0, skipped), blocked, errors, usage: { remaining, spent }, regions });
  } catch (error) {
    console.error("Stay Live quotes:", errorMessage(error));
    return json({ error: errorMessage(error) }, 502);
  }
}

function shape(r, selection, cached) {
  return { selection, median: Number(r.odds_median), best: Number(r.odds_best), bestBookmaker: r.best_bookmaker, books: r.books, line: r.line == null ? null : Number(r.line), capturedAt: r.captured_at, cached };
}
