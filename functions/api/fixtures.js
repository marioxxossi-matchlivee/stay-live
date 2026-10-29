import {
  apiFootball, formatKickoff, json, normalizeFixture, supabaseGet,
} from "./_lib.js";

async function loadProviderFixtures(env) {
  const [live, upcoming] = await Promise.all([
    apiFootball(env, "fixtures", { live: "all" }),
    apiFootball(env, "fixtures", { league: "135", season: "2026", next: "20" }),
  ]);
  const seriesA = [...live, ...upcoming].filter((item) =>
    String(item.league?.id) === "135" && String(item.league?.season) === "2026"
  );
  const byId = new Map(seriesA.map((item) => [String(item.fixture?.id), normalizeFixture(item)]));
  return [...byId.values()].sort((a, b) => {
    if (a.status === "live" && b.status !== "live") return -1;
    if (b.status === "live" && a.status !== "live") return 1;
    return String(a.kickoffAt ?? "").localeCompare(String(b.kickoffAt ?? ""));
  });
}

async function loadDatabaseFixtures(env) {
  const rows = await supabaseGet(env, "fixtures", {
    select: "id,provider_id,home_team_id,away_team_id,kickoff_at,status,elapsed_minute,home_goals,away_goals,home:teams!fixtures_home_team_id_fkey(name,logo_url,provider_id),away:teams!fixtures_away_team_id_fkey(name,logo_url,provider_id),season:seasons!inner(year,competition:competitions!inner(name,country))",
    "season.year": "eq.2026",
    "season.competition.name": "eq.Serie A",
    order: "kickoff_at.asc",
    limit: "50",
  });
  return rows.map((row) => ({
    id: String(row.provider_id ?? row.id),
    providerId: Number(row.provider_id ?? row.id),
    kickoffAt: row.kickoff_at ?? null,
    kickoff: formatKickoff(row.kickoff_at),
    statusCode: row.status ?? "NS",
    status: ["1H","HT","2H","ET","P","LIVE","BT"].includes(String(row.status).toUpperCase()) ? "live"
      : ["FT","AET","PEN","finished"].includes(String(row.status).toUpperCase()) ? "finished" : "upcoming",
    elapsed: row.elapsed_minute ?? null,
    home: row.home?.name ?? "Casa",
    away: row.away?.name ?? "Trasferta",
    homeId: Number(row.home?.provider_id ?? 0),
    awayId: Number(row.away?.provider_id ?? 0),
    homeTeamId: Number(row.home_team_id ?? 0),
    awayTeamId: Number(row.away_team_id ?? 0),
    homeLogo: row.home?.logo_url ?? "",
    awayLogo: row.away?.logo_url ?? "",
    homeGoals: row.home_goals ?? null,
    awayGoals: row.away_goals ?? null,
    goals: row.home_goals == null || row.away_goals == null ? "—" : `${row.home_goals} – ${row.away_goals}`,
    corners: "—",
    competition: "Serie A",
  }));
}

export async function onRequest({ env }) {
  try {
    const fixtures = await loadProviderFixtures(env);
    if (fixtures.length) {
      return json({ demo: false, source: "api-football", fixtures, updatedAt: new Date().toISOString() });
    }
  } catch (error) {
    console.error("Stay Live: API-Football non disponibile:", error.message);
  }

  try {
    const fixtures = await loadDatabaseFixtures(env);
    if (fixtures.length) {
      return json({ demo: false, source: "supabase", fixtures, updatedAt: new Date().toISOString() });
    }
  } catch (error) {
    console.error("Stay Live: Supabase non disponibile:", error.message);
  }

  return json({
    demo: true,
    source: "demo",
    fixtures: [],
    message: "Nessun dato reale disponibile. Gli esempi della dashboard sono dimostrativi.",
    updatedAt: new Date().toISOString(),
  });
}
