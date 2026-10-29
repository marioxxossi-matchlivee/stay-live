import {
  apiFootball, json, normalizeFixture, requireSyncSecret, supabaseGet, supabaseUpsert,
} from "./_lib.js";

function apiTeamToRow(team) {
  return {
    provider: "api-football",
    provider_id: Number(team.id),
    name: team.name,
    short_name: team.name,
    logo_url: team.logo ?? null,
    country: "Italy",
  };
}

function mapStats(statistics) {
  const out = {};
  for (const stat of statistics ?? []) {
    const key = String(stat.type ?? "").toLowerCase();
    const value = stat.value;
    if (key === "corner kicks") out.corners = Number(value ?? 0);
    else if (key === "total shots") out.shots = Number(value ?? 0);
    else if (key === "shots on goal") out.shots_on_target = Number(value ?? 0);
    else if (key === "ball possession") out.possession = Number(String(value ?? "").replace("%", "")) || null;
    else if (key === "yellow cards") out.yellow_cards = Number(value ?? 0);
    else if (key === "red cards") out.red_cards = Number(value ?? 0);
  }
  return out;
}

async function ensureSeason(env) {
  const competitions = await supabaseGet(env, "competitions", {
    select: "id", provider: "eq.api-football", provider_id: "eq.135", limit: "1",
  });
  let competitionId = competitions[0]?.id;
  if (!competitionId) {
    const created = await supabaseUpsert(env, "competitions", [{
      provider: "api-football", provider_id: 135, name: "Serie A", country: "Italy", code: "SA", active: true,
    }], "provider,provider_id");
    competitionId = created[0]?.id;
  }
  if (!competitionId) throw new Error("Impossibile individuare la competizione Serie A in Supabase.");
  const seasons = await supabaseGet(env, "seasons", {
    select: "id", competition_id: `eq.${competitionId}`, year: "eq.2026", limit: "1",
  });
  let seasonId = seasons[0]?.id;
  if (!seasonId) {
    const created = await supabaseUpsert(env, "seasons", [{
      competition_id: competitionId, provider_season_id: 2026, year: 2026, current: true,
    }], "competition_id,year");
    seasonId = created[0]?.id;
  }
  if (!seasonId) throw new Error("Impossibile individuare la stagione 2026/27 in Supabase.");
  return { competitionId, seasonId };
}

export async function onRequest({ request, env }) {
  if (request.method !== "POST") {
    return json({ error: "Metodo non consentito. Usa POST." }, 405, { allow: "POST" });
  }
  if (!requireSyncSecret(request, env)) {
    return json({ error: "Non autorizzato. Configura SYNC_SECRET e invialo nell'header x-sync-secret." }, 401);
  }
  try {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
      return json({ error: "Configura SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY." }, 503);
    }
    const body = await request.json().catch(() => ({}));
    const last = Math.max(1, Math.min(20, Number(body.last ?? 10)));
    const { seasonId } = await ensureSeason(env);

    // Sync the league team directory once per manual run so upcoming fixtures can be analysed too.
    const leagueTeams = await apiFootball(env, "teams", { league: "135", season: "2026" });
    const teams = new Map();
    for (const item of leagueTeams) {
      if (item.team?.id) teams.set(Number(item.team.id), apiTeamToRow(item.team));
    }

    // One fixture-list request. Statistics are fetched only for the requested recent completed fixtures.
    const raw = await apiFootball(env, "fixtures", { league: "135", season: "2026", last });
    const completed = raw.filter((item) => ["FT", "AET", "PEN"].includes(item.fixture?.status?.short));
    for (const item of completed) {
      if (item.teams?.home?.id) teams.set(Number(item.teams.home.id), apiTeamToRow(item.teams.home));
      if (item.teams?.away?.id) teams.set(Number(item.teams.away.id), apiTeamToRow(item.teams.away));
    }
    const teamRows = await supabaseUpsert(env, "teams", [...teams.values()], "provider,provider_id");
    const teamDbIds = new Map(teamRows.map((team) => [Number(team.provider_id), Number(team.id)]));
    if (!completed.length) {
      return json({ ok: true, importedFixtures: 0, importedTeams: teamRows.length, importedStats: 0, message: "Squadre sincronizzate; nessuna partita conclusa trovata." });
    }

    const fixtureRows = completed.map((item) => ({
      provider: "api-football",
      provider_id: Number(item.fixture.id),
      season_id: seasonId,
      home_team_id: teamDbIds.get(Number(item.teams.home.id)),
      away_team_id: teamDbIds.get(Number(item.teams.away.id)),
      kickoff_at: item.fixture.date,
      status: item.fixture.status.short,
      elapsed_minute: item.fixture.status.elapsed ?? null,
      home_goals: item.goals.home ?? null,
      away_goals: item.goals.away ?? null,
      venue: item.fixture.venue?.name ?? null,
      referee: item.fixture.referee ?? null,
      last_synced_at: new Date().toISOString(),
    })).filter((row) => row.home_team_id && row.away_team_id);
    const fixtureDbRows = await supabaseUpsert(env, "fixtures", fixtureRows, "provider,provider_id");
    const fixtureDbIds = new Map(fixtureDbRows.map((row) => [Number(row.provider_id), Number(row.id)]));

    let statCount = 0;
    const failures = [];
    for (const item of completed) {
      const fixtureId = fixtureDbIds.get(Number(item.fixture.id));
      if (!fixtureId) continue;
      try {
        const stats = await apiFootball(env, "fixtures/statistics", { fixture: item.fixture.id });
        const rows = [];
        for (const teamStats of stats) {
          const providerTeamId = Number(teamStats.team?.id);
          const teamId = teamDbIds.get(providerTeamId);
          if (!teamId) continue;
          const mapped = mapStats(teamStats.statistics);
          rows.push({
            fixture_id: fixtureId,
            team_id: teamId,
            is_home: providerTeamId === Number(item.teams.home.id),
            goals: providerTeamId === Number(item.teams.home.id) ? item.goals.home : item.goals.away,
            corners: mapped.corners ?? null,
            shots: mapped.shots ?? null,
            shots_on_target: mapped.shots_on_target ?? null,
            possession: mapped.possession ?? null,
            yellow_cards: mapped.yellow_cards ?? null,
            red_cards: mapped.red_cards ?? null,
            stats_json: teamStats.statistics ?? [],
            collected_at: new Date().toISOString(),
          });
        }
        await supabaseUpsert(env, "team_match_stats", rows, "fixture_id,team_id");
        statCount += rows.length;
      } catch (error) {
        failures.push({ fixtureId: Number(item.fixture.id), error: error.message });
      }
    }
    return json({
      ok: true,
      season: "2026/27",
      requestedLast: last,
      importedFixtures: fixtureRows.length,
      importedTeams: teamRows.length,
      importedStats: statCount,
      statsFailures: failures,
      note: "Ogni partita richiede una chiamata API aggiuntiva per le statistiche. Controlla il limite del tuo piano prima di sincronizzare molti incontri.",
    });
  } catch (error) {
    console.error("Stay Live sync error:", error.message);
    return json({ error: error.message }, 500);
  }
}
