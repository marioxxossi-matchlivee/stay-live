export const SEASON = 2026;
export const NINJAS_URL = "https://api.api-ninjas.com/v1/soccermatches";

/**
 * Campionati disponibili. `continent` e `country`/`nation` alimentano il menu ad accordion:
 * continente > nazione > campionati. Le coppe internazionali stanno nel continente con un
 * gruppo proprio (international: true). `tier` = categoria (1 = massima serie).
 * Per aggiungere un campionato basta una riga qui. Senza `provider` le partite arrivano da API Ninjas (solo gli 8 campionati principali); con `provider: "apifootball"` arrivano da API-Football (`afId` = id campionato, `afCountry`/`afName` = controllo anti-errore sull'id, `calendarYear` = stagione che coincide con l'anno solare). `oddsKey` = chiave sport di The Odds API per le quote.
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
  { id: "seriea", afId: 135, name: "Serie A", short: "Serie A", continent: "europa", country: "IT", nation: "Italia", tier: 1 },
  { id: "epl", afId: 39, name: "Premier League", short: "Premier", continent: "europa", country: "GB", nation: "Inghilterra", tier: 1 },
  { id: "laliga", afId: 140, name: "LaLiga", short: "LaLiga", continent: "europa", country: "ES", nation: "Spagna", tier: 1 },
  { id: "bundesliga", afId: 78, name: "Bundesliga", short: "Bundesliga", continent: "europa", country: "DE", nation: "Germania", tier: 1 },
  { id: "ligue1", afId: 61, name: "Ligue 1", short: "Ligue 1", continent: "europa", country: "FR", nation: "Francia", tier: 1 },
  { id: "ucl", afId: 2, name: "Champions League", short: "Champions", continent: "europa", country: "UEFA-C", nation: "Coppe europee", international: true, tier: 0 },
  { id: "uel", afId: 3, name: "Europa League", short: "Europa League", continent: "europa", country: "UEFA-C", nation: "Coppe europee", international: true, tier: 0 },
  { id: "mls", afId: 253, calendarYear: true, name: "MLS", short: "MLS", continent: "nord-america", country: "US", nation: "Stati Uniti", tier: 1 },
  { id: "serieb", name: "Serie B", short: "Serie B", continent: "europa", country: "IT", nation: "Italia", tier: 2, provider: "apifootball", afId: 136, afCountry: "Italy", afName: "Serie B" },
  { id: "championship", name: "Championship", short: "Championship", continent: "europa", country: "GB", nation: "Inghilterra", tier: 2, provider: "apifootball", afId: 40, afCountry: "England", afName: "Championship" },
  { id: "league1", name: "League One", short: "League One", continent: "europa", country: "GB", nation: "Inghilterra", tier: 3, provider: "apifootball", afId: 41, afCountry: "England", afName: "League One" },
  { id: "bundesliga2", name: "2. Bundesliga", short: "2. Bundesliga", continent: "europa", country: "DE", nation: "Germania", tier: 2, provider: "apifootball", afId: 79, afCountry: "Germany", afName: "2. Bundesliga" },
  { id: "ligue2", name: "Ligue 2", short: "Ligue 2", continent: "europa", country: "FR", nation: "Francia", tier: 2, provider: "apifootball", afId: 62, afCountry: "France", afName: "Ligue 2" },
  { id: "segunda", name: "Segunda División", short: "Segunda", continent: "europa", country: "ES", nation: "Spagna", tier: 2, provider: "apifootball", afId: 141, afCountry: "Spain", afName: "Segunda" },
  { id: "eredivisie", name: "Eredivisie", short: "Eredivisie", continent: "europa", country: "NL", nation: "Paesi Bassi", tier: 1, provider: "apifootball", afId: 88, afCountry: "Netherlands", afName: "Eredivisie" },
  { id: "primeira", name: "Primeira Liga", short: "Primeira", continent: "europa", country: "PT", nation: "Portogallo", tier: 1, provider: "apifootball", afId: 94, afCountry: "Portugal", afName: "Primeira" },
  { id: "proleague", name: "Pro League", short: "Pro League", continent: "europa", country: "BE", nation: "Belgio", tier: 1, provider: "apifootball", afId: 144, afCountry: "Belgium" },
  { id: "scottish", name: "Scottish Premiership", short: "Scozia", continent: "europa", country: "GB-SCT", nation: "Scozia", tier: 1, provider: "apifootball", afId: 179, afCountry: "Scotland" },
  { id: "superlig", name: "Süper Lig", short: "Süper Lig", continent: "europa", country: "TR", nation: "Turchia", tier: 1, provider: "apifootball", afId: 203, afCountry: "Turkey" },
  { id: "greece", name: "Super League", short: "Grecia", continent: "europa", country: "GR", nation: "Grecia", tier: 1, provider: "apifootball", afId: 197, afCountry: "Greece" },
  { id: "austria", name: "Bundesliga austriaca", short: "Austria", continent: "europa", country: "AT", nation: "Austria", tier: 1, provider: "apifootball", afId: 218, afCountry: "Austria" },
  { id: "swiss", name: "Super League svizzera", short: "Svizzera", continent: "europa", country: "CH", nation: "Svizzera", tier: 1, provider: "apifootball", afId: 207, afCountry: "Switzerland" },
  { id: "denmark", name: "Superliga", short: "Superliga", continent: "europa", country: "DK", nation: "Danimarca", tier: 1, provider: "apifootball", afId: 119, afCountry: "Denmark" },
  { id: "poland", name: "Ekstraklasa", short: "Ekstraklasa", continent: "europa", country: "PL", nation: "Polonia", tier: 1, provider: "apifootball", afId: 106, afCountry: "Poland", afName: "Ekstraklasa" },
  { id: "czech", name: "Prima lega ceca", short: "Rep. Ceca", continent: "europa", country: "CZ", nation: "Repubblica Ceca", tier: 1, provider: "apifootball", afId: 345, afCountry: "Czech" },
  { id: "croatia", name: "HNL", short: "HNL", continent: "europa", country: "HR", nation: "Croazia", tier: 1, provider: "apifootball", afId: 210, afCountry: "Croatia" },
  { id: "romania", name: "Liga 1", short: "Romania", continent: "europa", country: "RO", nation: "Romania", tier: 1, provider: "apifootball", afId: 283, afCountry: "Romania" },
  { id: "serbia", name: "SuperLiga", short: "Serbia", continent: "europa", country: "RS", nation: "Serbia", tier: 1, provider: "apifootball", afId: 286, afCountry: "Serbia" },
  { id: "hungary", name: "NB I", short: "Ungheria", continent: "europa", country: "HU", nation: "Ungheria", tier: 1, provider: "apifootball", afId: 271, afCountry: "Hungary" },
  { id: "eliteserien", name: "Eliteserien", short: "Eliteserien", continent: "europa", country: "NO", nation: "Norvegia", tier: 1, provider: "apifootball", afId: 103, afCountry: "Norway", afName: "Eliteserien", calendarYear: true },
  { id: "allsvenskan", name: "Allsvenskan", short: "Allsvenskan", continent: "europa", country: "SE", nation: "Svezia", tier: 1, provider: "apifootball", afId: 113, afCountry: "Sweden", afName: "Allsvenskan", calendarYear: true },
  { id: "uecl", name: "Conference League", short: "Conference", continent: "europa", country: "UEFA-C", nation: "Coppe europee", tier: 0, international: true, provider: "apifootball", afId: 848, afCountry: "World", afName: "Conference" },
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

export function missingConfig(env, { ninjas = false, apifootball = false } = {}) {
  const missing = [];
  if (!env.SUPABASE_URL) missing.push("SUPABASE_URL");
  if (!env.SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (ninjas && !env.API_NINJAS_KEY) missing.push("API_NINJAS_KEY");
  if (apifootball && !env.API_FOOTBALL_KEY) missing.push("API_FOOTBALL_KEY");
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

/**
 * Tutte le partite finite della stagione (base di ogni calcolo). Si rilegge al massimo ogni 60 secondi per istanza: anteprima e analisi
 * (con i loro nuovi tentativi automatici) la chiamavano ogni volta, rileggendo migliaia di righe da Supabase per niente.
 */
const FINALS_TTL = 60e3;
const finalsMemo = new Map();
export function loadFinals(env, now = Date.now()) {
  const key = env.SUPABASE_URL ?? "";
  const hit = finalsMemo.get(key);
  if (hit && now - hit.at < FINALS_TTL) return hit.promise;
  const promise = supabaseGetAll(env, "matches", {
    select: "league,kickoff_at,home_id,away_id,home_name,away_name,home_score,away_score,neutral_site",
    status: "eq.final",
    season: `eq.${SEASON}`,
    order: "kickoff_at.desc,game_id.asc",
  });
  finalsMemo.set(key, { at: now, promise });
  promise.catch(() => { if (finalsMemo.get(key)?.promise === promise) finalsMemo.delete(key); });   // un errore non resta in memoria
  return promise;
}
export const clearFinalsMemo = () => finalsMemo.clear();

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
