export const LEAGUE_ID = "135";
export const SEASON = "2026";
export const LIVE_STATUSES = new Set(["1H", "HT", "2H", "ET", "P", "LIVE", "BT"]);
export const FINISHED_STATUSES = new Set(["FT", "AET", "PEN"]);

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      ...extraHeaders,
    },
  });
}

export function errorMessage(error) {
  return error instanceof Error ? error.message : "Errore inatteso";
}

export function normalizeStatus(code) {
  if (LIVE_STATUSES.has(String(code ?? "").toUpperCase())) return "live";
  if (FINISHED_STATUSES.has(String(code ?? "").toUpperCase())) return "finished";
  return "upcoming";
}

export function formatKickoff(date) {
  if (!date) return "";
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("it-IT", {
    timeZone: "Europe/Rome",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

export function normalizeFixture(item) {
  const fixture = item.fixture ?? {};
  const league = item.league ?? {};
  const teams = item.teams ?? {};
  const goals = item.goals ?? {};
  const code = fixture.status?.short ?? "NS";
  return {
    id: String(fixture.id ?? ""),
    providerId: Number(fixture.id ?? 0),
    kickoffAt: fixture.date ?? null,
    kickoff: formatKickoff(fixture.date),
    statusCode: code,
    status: normalizeStatus(code),
    elapsed: fixture.status?.elapsed ?? null,
    home: teams.home?.name ?? "Casa",
    away: teams.away?.name ?? "Trasferta",
    homeId: Number(teams.home?.id ?? 0),
    awayId: Number(teams.away?.id ?? 0),
    homeLogo: teams.home?.logo ?? "",
    awayLogo: teams.away?.logo ?? "",
    homeGoals: goals.home ?? null,
    awayGoals: goals.away ?? null,
    goals: goals.home == null || goals.away == null ? "—" : `${goals.home} – ${goals.away}`,
    corners: "—",
    competition: league.name ?? "Serie A",
    venue: fixture.venue?.name ?? "",
  };
}

export async function apiFootball(env, endpoint, params = {}) {
  if (!env.API_FOOTBALL_KEY) throw new Error("API_FOOTBALL_KEY non configurata");
  const base = (env.API_FOOTBALL_BASE_URL || "https://v3.football.api-sports.io").replace(/\/+$/, "");
  const url = new URL(`${base}/${endpoint.replace(/^\/+/, "")}`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  const response = await fetch(url, {
    headers: { "x-apisports-key": env.API_FOOTBALL_KEY },
    cf: { cacheTtl: 30, cacheEverything: true },
  });
  if (!response.ok) throw new Error(`API-Football ha risposto HTTP ${response.status}`);
  const payload = await response.json();
  if (payload.errors && Object.keys(payload.errors).length) {
    throw new Error(`Errore API-Football: ${JSON.stringify(payload.errors).slice(0, 300)}`);
  }
  return payload.response ?? [];
}

export function supabaseHeaders(env, prefer = "return=representation") {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase non configurato");
  }
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "content-type": "application/json",
    prefer,
  };
}

export async function supabaseGet(env, table, query) {
  const url = new URL(`/rest/v1/${table}`, env.SUPABASE_URL);
  for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, String(value));
  const response = await fetch(url, { headers: supabaseHeaders(env, "return=representation") });
  if (!response.ok) throw new Error(`Supabase GET ${table}: HTTP ${response.status}`);
  return response.json();
}

export async function supabaseUpsert(env, table, rows, conflict) {
  if (!rows.length) return [];
  const url = new URL(`/rest/v1/${table}`, env.SUPABASE_URL);
  if (conflict) url.searchParams.set("on_conflict", conflict);
  const response = await fetch(url, {
    method: "POST",
    headers: supabaseHeaders(env, "resolution=merge-duplicates,return=representation"),
    body: JSON.stringify(rows),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 400);
    throw new Error(`Supabase upsert ${table}: HTTP ${response.status} ${detail}`);
  }
  return response.json();
}

export function requireSyncSecret(request, env) {
  const expected = env.SYNC_SECRET;
  const supplied = request.headers.get("x-sync-secret");
  return Boolean(expected && supplied && expected === supplied);
}
