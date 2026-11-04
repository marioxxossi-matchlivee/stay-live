import { errorMessage, json, supabaseGet } from "./_lib.js";
import { betIdsFrom, loadSections, pickCoach, planFor, resolveFixture, summarizeOdds, ttlFor } from "./_apifootball.js";

const COLS = "game_id,league,season,kickoff_at,status,home_id,away_id,home_name,away_name";

/**
 * GET /api/match-detail?id=<game_id>
 * Restituisce, per una partita, TUTTO cio' che API-Football fornisce sul piano attivo: partita (arbitro, stadio, eventi, formazioni,
 * statistiche e giocatori a partita giocata), infortuni, pronostico del provider, quote Over/Under gol e corner, scontri diretti,
 * classifica, statistiche stagionali delle due squadre e copertura dati del campionato.
 * Ogni sezione ha `freshness` (da dove arriva, quando e' stata scaricata, eventuale errore): l'app non si rompe se una sezione manca.
 */
export async function onRequest({ request, env }) {
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!/^[\w-]{3,80}$/.test(id)) return json({ error: "Partita non valida." }, 400);
  const missing = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "API_FOOTBALL_KEY"].filter((k) => !env[k]);
  if (missing.length) return json({ error: `Variabili mancanti su Cloudflare: ${missing.join(", ")}` }, 503);
  try {
    const now = Date.now();
    const [match] = await supabaseGet(env, "matches", { select: COLS, game_id: `eq.${id}`, limit: 1 });
    if (!match) return json({ error: "Partita non trovata." }, 404);
    const game = { id: match.game_id, league: match.league, kickoffAt: match.kickoff_at, status: match.status, home: match.home_name, away: match.away_name };

    const mapped = await resolveFixture(env, match, now);
    if (!mapped.map) return json({ mapped: false, game, reason: mapped.error });

    const kickoff = Date.parse(match.kickoff_at);
    const finished = match.status === "final";
    const { sections: pre } = await loadSections(env, [{ section: "bets", endpoint: "odds/bets", params: {}, ttl: ttlFor("odds-bets") }], now);
    const plan = planFor({ fixtureId: mapped.map.fixture_id, leagueId: mapped.map.league_id, season: mapped.map.season, homeId: mapped.map.home_team_id, awayId: mapped.map.away_team_id, kickoff, finished, now, betIds: betIdsFrom(pre.bets?.data) });
    const { sections: s, usage } = await loadSections(env, plan, now);

    const fixture = s.fixture?.data?.[0] ?? null;
    const freshness = Object.fromEntries(Object.entries(s).map(([k, v]) => [k, { fetchedAt: v.fetchedAt, source: v.source, stale: v.stale, error: v.error, deferred: Boolean(v.deferred) }]));
    return json({
      mapped: true,
      game,
      apiFixtureId: mapped.map.fixture_id,
      fixture,                                        // include events, lineups, statistics, players quando la partita e' iniziata/finita
      injuries: s.injuries?.data ?? [],
      predictions: s.predictions?.data?.[0] ?? null,
      odds: { ...summarizeOdds(s.oddsGoals?.data, s.oddsCorners?.data), raw: { goals: s.oddsGoals?.data ?? [], corners: s.oddsCorners?.data ?? [] } },
      h2h: s.h2h?.data ?? [],
      standings: s.standings?.data?.[0]?.league?.standings ?? [],
      teamStats: { home: s.teamHome?.data ?? null, away: s.teamAway?.data ?? null },
      coaches: { home: pickCoach(s.coachHome?.data, mapped.map.home_team_id), away: pickCoach(s.coachAway?.data, mapped.map.away_team_id) },
      coverage: s.coverage?.data?.[0]?.seasons?.find((x) => x.year === mapped.map.season)?.coverage ?? null,
      freshness,
      usage,
    });
  } catch (error) {
    console.error("Stay Live match-detail:", errorMessage(error));
    return json({ error: errorMessage(error) }, 502);
  }
}
