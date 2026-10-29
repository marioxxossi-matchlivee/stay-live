import {
  apiFootball, formatKickoff, json, normalizeFixture, supabaseGet,
} from "./_lib.js";

const LEAGUE_ID = "135"; // Serie A italiana
const SEASON = "2026";  // stagione 2026/27 secondo API-Football

async function loadProviderFixtures(env, diagnostics) {
  if (!env.API_FOOTBALL_KEY) {
    diagnostics.apiFootball = "Variabile API_FOOTBALL_KEY assente su Cloudflare Pages.";
    return [];
  }

  const results = [];
  // Chiamate indipendenti: se il provider rifiuta la richiesta live,
  // proviamo comunque a recuperare le prossime partite.
  for (const [label, params] of [
    ["live", { live: "all" }],
    ["upcoming", { league: LEAGUE_ID, season: SEASON, next: "20" }],
  ]) {
    try {
      const rows = await apiFootball(env, "fixtures", params);
      diagnostics[label] = { ok: true, count: rows.length };
      for (const item of rows) {
        if (String(item.league?.id) !== LEAGUE_ID) continue;
        // Per la richiesta upcoming il provider ha già filtrato lega e stagione.
        // Per la richiesta live evitiamo di scartare partite valide per differenze
        // nel campo season restituito dal provider.
        if (label === "live" && item.league?.season && String(item.league.season) !== SEASON) continue;
        results.push(normalizeFixture(item));
      }
    } catch (error) {
      diagnostics[label] = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  const unique = new Map(results.filter((f) => f.id && f.id !== "undefined").map((f) => [String(f.id), f]));
  return [...unique.values()].sort((a, b) => {
    if (a.status === "live" && b.status !== "live") return -1;
    if (b.status === "live" && a.status !== "live") return 1;
    return String(a.kickoffAt ?? "").localeCompare(String(b.kickoffAt ?? ""));
  });
}

async function loadDatabaseFixtures(env, diagnostics) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    diagnostics.supabase = "Configurazione incompleta: servono SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.";
    return [];
  }
  try {
    const rows = await supabaseGet(env, "fixtures", {
      select: "id,provider_id,home_team_id,away_team_id,kickoff_at,status,elapsed_minute,home_goals,away_goals,home:teams!fixtures_home_team_id_fkey(name,logo_url,provider_id),away:teams!fixtures_away_team_id_fkey(name,logo_url,provider_id),season:seasons!inner(year,competition:competitions!inner(name,country))",
      "season.year": `eq.${SEASON}`,
      "season.competition.name": "eq.Serie A",
      order: "kickoff_at.asc",
      limit: "50",
    });
    diagnostics.supabase = { ok: true, count: rows.length };
    return rows.map((row) => ({
      id: String(row.provider_id ?? row.id),
      providerId: Number(row.provider_id ?? row.id),
      kickoffAt: row.kickoff_at ?? null,
      kickoff: formatKickoff(row.kickoff_at),
      statusCode: row.status ?? "NS",
      status: ["1H", "HT", "2H", "ET", "P", "LIVE", "BT"].includes(String(row.status).toUpperCase()) ? "live"
        : ["FT", "AET", "PEN", "finished"].includes(String(row.status).toUpperCase()) ? "finished" : "upcoming",
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
  } catch (error) {
    diagnostics.supabase = { ok: false, error: error instanceof Error ? error.message : String(error) };
    return [];
  }
}

export async function onRequest({ env }) {
  const diagnostics = {
    configured: {
      apiFootballKey: Boolean(env.API_FOOTBALL_KEY),
      supabaseUrl: Boolean(env.SUPABASE_URL),
      supabaseSecret: Boolean(env.SUPABASE_SERVICE_ROLE_KEY),
    },
  };

  const providerFixtures = await loadProviderFixtures(env, diagnostics);
  if (providerFixtures.length) {
    return json({ demo: false, source: "api-football", fixtures: providerFixtures, diagnostics, updatedAt: new Date().toISOString() });
  }

  const databaseFixtures = await loadDatabaseFixtures(env, diagnostics);
  if (databaseFixtures.length) {
    return json({ demo: false, source: "supabase", fixtures: databaseFixtures, diagnostics, updatedAt: new Date().toISOString() });
  }

  // La dashboard resta compatibile, ma l'endpoint ora mostra la causa probabile
  // nel campo diagnostics invece di nascondere tutti gli errori.
  return json({
    demo: true,
    source: "demo",
    fixtures: [],
    message: "Nessuna partita reale restituita dai servizi configurati.",
    diagnostics,
    updatedAt: new Date().toISOString(),
  });
}
