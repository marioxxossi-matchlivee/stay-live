import { formatKickoff, json } from "./_lib.js";

const API_URL = "https://api.api-ninjas.com/v1/soccermatches";
const LEAGUE = "seriea";
const SEASON = "2026"; // Serie A 2026-27
const PAGE_SIZE = 50;
const MAX_PAGES = 12;
const CACHE_SECONDS = 600;

function normalizeNinjaMatch(item) {
  const home = item.home_team ?? {};
  const away = item.away_team ?? {};
  const statusRaw = String(item.status ?? "scheduled").toLowerCase();
  const statusCode = statusRaw === "in_progress" ? "LIVE"
    : statusRaw === "final" ? (item.decided_in === "extra_time" ? "AET" : item.decided_in === "penalties" ? "PEN" : "FT")
    : statusRaw === "postponed" ? "PST"
    : statusRaw === "canceled" || statusRaw === "cancelled" ? "CANC"
    : statusRaw === "suspended" ? "SUSP" : "NS";
  const homeGoals = Number.isFinite(item.home_score) ? item.home_score : null;
  const awayGoals = Number.isFinite(item.away_score) ? item.away_score : null;
  const date = item.start_time ?? (item.date ? `${item.date}T12:00:00Z` : null);
  const isLive = statusRaw === "in_progress";
  const isFinished = statusRaw === "final";

  return {
    id: String(item.game_id ?? `${item.league ?? LEAGUE}-${item.date ?? "unknown"}-${home.team_id ?? home.name ?? "home"}-${away.team_id ?? away.name ?? "away"}`),
    providerId: String(item.game_id ?? ""),
    kickoffAt: date,
    kickoff: formatKickoff(date),
    statusCode,
    status: isLive ? "live" : isFinished ? "finished" : "upcoming",
    elapsed: null,
    home: home.name ?? "Casa",
    away: away.name ?? "Trasferta",
    // API Ninjas team IDs are strings, not API-Football numeric IDs.
    homeId: 0,
    awayId: 0,
    homeTeamId: String(home.team_id ?? ""),
    awayTeamId: String(away.team_id ?? ""),
    homeLogo: "",
    awayLogo: "",
    homeGoals,
    awayGoals,
    goals: homeGoals == null || awayGoals == null ? "—" : `${homeGoals} – ${awayGoals}`,
    // The free API plan does not provide corner statistics.
    corners: "—",
    competition: "Serie A",
    venue: item.venue?.name ?? "",
    source: "api-ninjas",
  };
}

async function getSeasonPage(env, offset) {
  const url = new URL(API_URL);
  url.searchParams.set("league", LEAGUE);
  url.searchParams.set("season", SEASON);
  url.searchParams.set("offset", String(offset));
  const response = await fetch(url.toString(), {
    headers: { "X-Api-Key": env.API_NINJAS_KEY, accept: "application/json" },
    cf: { cacheTtl: CACHE_SECONDS, cacheEverything: true },
  });
  const bodyText = await response.text();
  let payload;
  try { payload = JSON.parse(bodyText); }
  catch { throw new Error(`API Ninjas ha restituito una risposta non JSON (HTTP ${response.status}).`); }
  if (!response.ok) {
    const detail = typeof payload?.error === "string" ? payload.error : JSON.stringify(payload);
    throw new Error(`API Ninjas HTTP ${response.status}: ${detail.slice(0, 250)}`);
  }
  if (!Array.isArray(payload)) throw new Error("Formato inatteso dalla Football API di API Ninjas.");
  return payload;
}

async function loadSeason(env) {
  if (!env.API_NINJAS_KEY) throw new Error("Manca il secret API_NINJAS_KEY nelle variabili Cloudflare.");
  const all = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const rows = await getSeasonPage(env, page * PAGE_SIZE);
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  const byId = new Map();
  for (const item of all) {
    const id = item.game_id;
    if (id) byId.set(String(id), item);
  }
  return [...byId.values()].map(normalizeNinjaMatch).sort((a, b) =>
    String(a.kickoffAt ?? "").localeCompare(String(b.kickoffAt ?? ""))
  );
}

export async function onRequest({ env }) {
  try {
    const seasonMatches = await loadSeason(env);
    const now = Date.now();
    const live = seasonMatches.filter((m) => m.status === "live");
    const upcoming = seasonMatches.filter((m) => m.status === "upcoming" && (!m.kickoffAt || new Date(m.kickoffAt).getTime() >= now));
    const finished = seasonMatches.filter((m) => m.status === "finished" && (!m.kickoffAt || new Date(m.kickoffAt).getTime() < now));
    const fixtures = [
      ...live,
      ...upcoming.slice(0, 20),
      ...finished.slice(-20).reverse(),
    ];
    const unique = [...new Map(fixtures.map((m) => [m.id, m])).values()];
    unique.sort((a, b) => {
      if (a.status === "live" && b.status !== "live") return -1;
      if (b.status === "live" && a.status !== "live") return 1;
      if (a.status === "upcoming" && b.status !== "upcoming") return -1;
      if (b.status === "upcoming" && a.status !== "upcoming") return 1;
      if (a.status === "upcoming") return String(a.kickoffAt ?? "").localeCompare(String(b.kickoffAt ?? ""));
      return String(b.kickoffAt ?? "").localeCompare(String(a.kickoffAt ?? ""));
    });
    return json({
      demo: false,
      source: "api-ninjas",
      season: SEASON,
      fixtures: unique,
      updatedAt: new Date().toISOString(),
      message: "Dati da API Ninjas. Il piano gratuito non fornisce minuto/punteggio live né statistiche corner.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Errore inatteso durante il recupero delle partite.";
    console.error("Stay Live /api/fixtures API Ninjas:", message);
    return json({
      demo: true,
      source: "api-ninjas",
      fixtures: [],
      message,
      updatedAt: new Date().toISOString(),
    }, 502);
  }
}
