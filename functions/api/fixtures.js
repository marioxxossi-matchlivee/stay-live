import {
  CONTINENTS, LEAGUES, SEASON, errorMessage, isActiveLeague, json, loadFinals, missingConfig, supabaseGet, supabaseGetAll, syncDue,
} from "./_lib.js";
import { analyzeMatch, buildContext, compactPick } from "./model.js";

const COLUMNS = "game_id,league,round,kickoff_at,status,home_id,home_name,away_id,away_name,home_score,away_score,neutral_site";

/** GET /api/fixtures: partite da 36 ore fa a 21 giorni avanti (variabile FIXTURES_DAYS, 3-30), con il consiglio rapido (BET / EVITA). */
export async function onRequest({ env }) {
  const days = Math.min(30, Math.max(3, Number(env.FIXTURES_DAYS) || 21));
  const missing = missingConfig(env);
  if (missing.length) return json({ error: `Variabili mancanti su Cloudflare: ${missing.join(", ")}` }, 503);
  try {
    const now = Date.now();
    const from = new Date(now - 36 * 3600e3).toISOString();
    const to = new Date(now + days * 86400e3).toISOString();
    const [window, finals, states] = await Promise.all([
      supabaseGetAll(env, "matches", { select: COLUMNS, season: `eq.${SEASON}`, and: `(kickoff_at.gte.${from},kickoff_at.lte.${to})`, order: "kickoff_at.asc,game_id.asc" }),
      loadFinals(env),
      supabaseGet(env, "sync_state", { select: "*" }),
    ]);
    const ctx = buildContext(finals);
    const byLeague = Object.fromEntries(states.map((s) => [s.league, s]));
    const matches = window.map((m) => {
      const open = m.status === "scheduled" || m.status === "in_progress";
      const analysis = open ? analyzeMatch(m, ctx, { n: 8 }) : null;
      return {
        id: m.game_id, league: m.league, round: m.round, kickoffAt: m.kickoff_at, status: m.status,
        home: m.home_name, away: m.away_name, homeScore: m.home_score, awayScore: m.away_score,
        pick: analysis ? compactPick(analysis) : null,
      };
    });
    return json({
      updatedAt: new Date(now).toISOString(),
      historyMatches: ctx.matchCount,
      continents: CONTINENTS,
      leagues: LEAGUES.map((l) => ({ ...l, syncedAt: byLeague[l.id]?.synced_at ?? null, count: byLeague[l.id]?.matches_count ?? 0, error: byLeague[l.id]?.last_error ?? null })),
      needsSync: LEAGUES.filter((l) => syncDue(byLeague[l.id], isActiveLeague(window, l.id, now), now)).map((l) => l.id),
      matches,
    });
  } catch (error) {
    console.error("Stay Live fixtures:", errorMessage(error));
    return json({ error: `Impossibile leggere i dati da Supabase: ${errorMessage(error)}. Hai applicato la migrazione 202610290002?` }, 502);
  }
}
