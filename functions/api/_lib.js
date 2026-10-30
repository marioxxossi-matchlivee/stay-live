export const SEASON = 2026;
export const NINJAS_URL = "https://api.api-ninjas.com/v1/soccermatches";

/**
 * Campionati disponibili. `continent` e `country`/`nation` alimentano il menu ad accordion:
 * continente > nazione > campionati. Le coppe internazionali stanno nel continente con un
 * gruppo proprio (international: true). `tier` = categoria (1 = massima serie).
 * Per aggiungere un campionato nuovo (se l'API lo espone) basta una riga qui. `oddsKey` = chiave sport di The Odds API per le quote.
 */
export const CONTINENTS = [
  { id: "europa", name: "Europa" },
  { id: "nord-america", name: "Nord America" },
  { id: "sud-america", name: "Sud America" },
  { id: "asia", name: "Asia" },
  { id: "africa", name: "Africa" },
  { id: "oceania", name: "Oceania" },
];

export const LEAGUES = [
  { id: "seriea", oddsKey: "soccer_italy_serie_a", name: "Serie A", short: "Serie A", continent: "europa", country: "IT", nation: "Italia", tier: 1 },
  { id: "epl", oddsKey: "soccer_epl", name: "Premier League", short: "Premier", continent: "europa", country: "GB", nation: "Inghilterra", tier: 1 },
  { id: "laliga", oddsKey: "soccer_spain_la_liga", name: "LaLiga", short: "LaLiga", continent: "europa", country: "ES", nation: "Spagna", tier: 1 },
  { id: "bundesliga", oddsKey: "soccer_germany_bundesliga", name: "Bundesliga", short: "Bundesliga", continent: "europa", country: "DE", nation: "Germania", tier: 1 },
  { id: "ligue1", oddsKey: "soccer_france_ligue_one", name: "Ligue 1", short: "Ligue 1", continent: "europa", country: "FR", nation: "Francia", tier: 1 },
  { id: "ucl", oddsKey: "soccer_uefa_champs_league", name: "Champions League", short: "Champions", continent: "europa", country: "UEFA-C", nation: "Coppe europee", international: true, tier: 0 },
  { id: "uel", oddsKey: "soccer_uefa_europa_league", name: "Europa League", short: "Europa League", continent: "europa", country: "UEFA-C", nation: "Coppe europee", international: true, tier: 0 },
  { id: "mls", oddsKey: "soccer_usa_mls", name: "MLS", short: "MLS", continent: "nord-america", country: "US", nation: "Stati Uniti", tier: 1 },
];
export const LEAGUE_IDS = new Set(LEAGUES.map((l) => l.id));

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

export const errorMessage = (e) => (e instanceof Error ? e.message : "Errore inatteso");

export function missingConfig(env, { ninjas = false } = {}) {
  const missing = [];
  if (!env.SUPABASE_URL) missing.push("SUPABASE_URL");
  if (!env.SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (ninjas && !env.API_NINJAS_KEY) missing.push("API_NINJAS_KEY");
  return missing;
}

/* ---------- Supabase (PostgREST) ---------- */
function sbHeaders(env, prefer) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    "content-type": "application/json",
    ...(prefer ? { prefer } : {}),
  };
}

export async function supabaseGet(env, table, query = {}) {
  const url = new URL(`/rest/v1/${table}`, env.SUPABASE_URL);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
  const res = await fetch(url, { headers: sbHeaders(env) });
  if (!res.ok) throw new Error(`Supabase ${table}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return res.json();
}

/** Legge tutte le righe superando il limite di 1000 righe di PostgREST. */
export async function supabaseGetAll(env, table, query = {}, pageSize = 1000, maxPages = 12) {
  const out = [];
  for (let page = 0; page < maxPages; page += 1) {
    const rows = await supabaseGet(env, table, { ...query, limit: pageSize, offset: page * pageSize });
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

export async function supabaseUpsert(env, table, rows, conflict) {
  for (let i = 0; i < rows.length; i += 400) {
    const url = new URL(`/rest/v1/${table}`, env.SUPABASE_URL);
    url.searchParams.set("on_conflict", conflict);
    const res = await fetch(url, {
      method: "POST",
      headers: sbHeaders(env, "resolution=merge-duplicates,return=minimal"),
      body: JSON.stringify(rows.slice(i, i + 400)),
    });
    if (!res.ok) throw new Error(`Supabase upsert ${table}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
}

export function loadFinals(env) {
  return supabaseGetAll(env, "matches", {
    select: "league,kickoff_at,home_id,away_id,home_name,away_name,home_score,away_score,neutral_site",
    status: "eq.final",
    season: `eq.${SEASON}`,
    order: "kickoff_at.desc,game_id.asc",
  });
}

/* ---------- API Ninjas ---------- */
export async function ninjasPage(env, league, offset) {
  const url = new URL(NINJAS_URL);
  url.searchParams.set("league", league);
  url.searchParams.set("season", String(SEASON));
  url.searchParams.set("offset", String(offset));
  const res = await fetch(url, { headers: { "X-Api-Key": env.API_NINJAS_KEY, accept: "application/json" } });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { throw new Error(`API Ninjas: risposta non JSON (HTTP ${res.status})`); }
  if (!res.ok) throw new Error(`API Ninjas HTTP ${res.status}: ${String(data?.error ?? text).slice(0, 200)}`);
  if (!Array.isArray(data)) throw new Error("API Ninjas: formato inatteso");
  return data;
}

export function normalizeNinjas(item, league) {
  const home = item.home_team ?? {};
  const away = item.away_team ?? {};
  const score = (v) => (Number.isFinite(v) ? v : null);
  return {
    game_id: String(item.game_id),
    league,
    season: Number(item.season ?? SEASON),
    season_type: item.season_type ?? null,
    round: item.round == null ? null : String(item.round),
    match_date: item.date ?? null,
    kickoff_at: item.start_time ?? (item.date ? `${item.date}T12:00:00Z` : null),
    status: String(item.status ?? "scheduled").toLowerCase(),
    home_id: String(home.team_id ?? home.name ?? "home"),
    home_name: home.name ?? "Casa",
    home_abbr: home.abbreviation ?? null,
    away_id: String(away.team_id ?? away.name ?? "away"),
    away_name: away.name ?? "Trasferta",
    away_abbr: away.abbreviation ?? null,
    home_score: score(item.home_score),
    away_score: score(item.away_score),
    decided_in: item.decided_in ?? null,
    neutral_site: Boolean(item.neutral_site),
    synced_at: new Date().toISOString(),
  };
}

/* ---------- Politica di aggiornamento (risparmia chiamate API) ---------- */
export const TTL = { idle: 6 * 3600e3, active: 15 * 60e3, retry: 2 * 60e3 };

/** Un campionato è "attivo" se ha partite iniziate da meno di 4 ore o in partenza a breve e non ancora finali. */
export function isActiveLeague(matches, league, now) {
  return matches.some((m) => m.league === league && m.status !== "final" && m.kickoff_at &&
    Date.parse(m.kickoff_at) >= now - 4 * 3600e3 && Date.parse(m.kickoff_at) <= now + 10 * 60e3);
}

export function syncDue(state, active, now) {
  if (state?.attempted_at && now - Date.parse(state.attempted_at) < TTL.retry && state.last_error) return false;
  if (!state?.synced_at) return true;
  return now - Date.parse(state.synced_at) >= (active ? TTL.active : TTL.idle);
}
