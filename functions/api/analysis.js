import { json, supabaseGet } from "./_lib.js";
import { average, confidence, poissonProbabilityOver } from "./model.js";

async function teamHistory(env, teamId, limit) {
  const rows = await supabaseGet(env, "team_match_stats", {
    select: "is_home,goals,corners,fixture:fixtures!inner(id,kickoff_at,status,home_goals,away_goals,home_team_id,away_team_id)",
    team_id: `eq.${teamId}`,
    "fixture.status": "in.(FT,AET,PEN,finished)",
    order: "fixture(kickoff_at).desc",
    limit: String(limit),
  });
  return rows;
}

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  let homeId = Number(url.searchParams.get("homeTeamId"));
  let awayId = Number(url.searchParams.get("awayTeamId"));
  const homeProviderId = Number(url.searchParams.get("homeProviderId"));
  const awayProviderId = Number(url.searchParams.get("awayProviderId"));
  const fixtureId = Number(url.searchParams.get("fixtureId"));
  const requested = Number(url.searchParams.get("matches") ?? 5);
  const limit = requested === 10 ? 10 : 5;
  if (Number.isInteger(homeProviderId) && homeProviderId > 0 && Number.isInteger(awayProviderId) && awayProviderId > 0) {
    try {
      const [homeTeamRows, awayTeamRows] = await Promise.all([
        supabaseGet(env, "teams", { select: "id", provider: "eq.api-football", provider_id: `eq.${homeProviderId}`, limit: "1" }),
        supabaseGet(env, "teams", { select: "id", provider: "eq.api-football", provider_id: `eq.${awayProviderId}`, limit: "1" }),
      ]);
      if (homeTeamRows[0]?.id && awayTeamRows[0]?.id) {
        homeId = Number(homeTeamRows[0].id);
        awayId = Number(awayTeamRows[0].id);
      }
    } catch (error) {
      console.error("Stay Live analysis team lookup:", error.message);
    }
  }
  if (Number.isInteger(fixtureId) && fixtureId > 0 && !(homeId > 0 && awayId > 0)) {
    try {
      const fixtureRows = await supabaseGet(env, "fixtures", {
        select: "id,provider_id,home_team_id,away_team_id,home:teams!fixtures_home_team_id_fkey(name),away:teams!fixtures_away_team_id_fkey(name)",
        provider: "eq.api-football",
        provider_id: `eq.${fixtureId}`,
        limit: "1",
      });
      if (fixtureRows.length) {
        homeId = Number(fixtureRows[0].home_team_id);
        awayId = Number(fixtureRows[0].away_team_id);
      }
    } catch (error) {
      console.error("Stay Live analysis fixture lookup:", error.message);
    }
  }
  if (!Number.isInteger(homeId) || homeId <= 0 || !Number.isInteger(awayId) || awayId <= 0 || homeId === awayId) {
    return json({ error: "Storico non disponibile per questa partita. Sincronizza prima le partite concluse in Supabase." }, 404);
  }
  try {
    const [homeRows, awayRows] = await Promise.all([
      teamHistory(env, homeId, limit),
      teamHistory(env, awayId, limit),
    ]);
    const homeGoalsFor = average(homeRows.map((r) => r.goals == null ? NaN : Number(r.goals)));
    const homeCornersFor = average(homeRows.map((r) => r.corners == null ? NaN : Number(r.corners)));
    const awayGoalsFor = average(awayRows.map((r) => r.goals == null ? NaN : Number(r.goals)));
    const awayCornersFor = average(awayRows.map((r) => r.corners == null ? NaN : Number(r.corners)));
    const homeOppGoals = average(homeRows.map((r) => {
      const f = r.fixture;
      if (!f) return NaN;
      const value = Number(f.home_team_id) === homeId ? f.away_goals : f.home_goals;
      return value == null ? NaN : Number(value);
    }));
    const awayOppGoals = average(awayRows.map((r) => {
      const f = r.fixture;
      if (!f) return NaN;
      const value = Number(f.home_team_id) === awayId ? f.away_goals : f.home_goals;
      return value == null ? NaN : Number(value);
    }));
    const expectedHomeGoals = homeGoalsFor == null || awayOppGoals == null ? null : (homeGoalsFor + awayOppGoals) / 2;
    const expectedAwayGoals = awayGoalsFor == null || homeOppGoals == null ? null : (awayGoalsFor + homeOppGoals) / 2;
    const expectedGoals = expectedHomeGoals == null || expectedAwayGoals == null ? null : expectedHomeGoals + expectedAwayGoals;
    const expectedCorners = homeCornersFor == null || awayCornersFor == null ? null : homeCornersFor + awayCornersFor;

    return json({
      source: "supabase-team-match-stats",
      teams: { homeTeamId: homeId, awayTeamId: awayId },
      sampleSize: { home: homeRows.length, away: awayRows.length, requested: limit },
      confidence: confidence(Math.min(homeRows.length, awayRows.length)),
      goals: {
        homeAverageFor: homeGoalsFor,
        awayAverageFor: awayGoalsFor,
        expectedHome: expectedHomeGoals,
        expectedAway: expectedAwayGoals,
        homeConcededAverage: homeOppGoals,
        awayConcededAverage: awayOppGoals,
        expectedTotal: expectedGoals,
        over15: expectedGoals == null ? null : Number((poissonProbabilityOver(expectedGoals, 1.5) * 100).toFixed(1)),
        over25: expectedGoals == null ? null : Number((poissonProbabilityOver(expectedGoals, 2.5) * 100).toFixed(1)),
        over35: expectedGoals == null ? null : Number((poissonProbabilityOver(expectedGoals, 3.5) * 100).toFixed(1)),
      },
      corners: {
        homeAverageFor: homeCornersFor,
        awayAverageFor: awayCornersFor,
        expectedTotal: expectedCorners,
        over75: expectedCorners == null ? null : Number((poissonProbabilityOver(expectedCorners, 7.5) * 100).toFixed(1)),
        over85: expectedCorners == null ? null : Number((poissonProbabilityOver(expectedCorners, 8.5) * 100).toFixed(1)),
        over95: expectedCorners == null ? null : Number((poissonProbabilityOver(expectedCorners, 9.5) * 100).toFixed(1)),
      },
      disclaimer: "Stime sperimentali basate su medie semplici e distribuzione di Poisson. Non sono un consiglio di scommessa e non sono validate; un campione ridotto aumenta l'incertezza.",
    });
  } catch (error) {
    console.error("Stay Live analysis error:", error.message);
    return json({ error: "Analisi non disponibile: verifica che Supabase contenga statistiche storiche per entrambe le squadre." }, 503);
  }
}
