export const SEASON = 2026;

/**
 * Campionati disponibili. `continent` e `country`/`nation` alimentano il menu ad accordion:
 * continente > nazione > campionati. Le coppe internazionali stanno nel continente con un
 * gruppo proprio (international: true). `tier` = categoria (1 = massima serie).
 * Per aggiungere un campionato basta una riga qui. Tutte le partite arrivano da API-Football, unico provider (`afId` = id campionato, `afCountry`/`afName` = controllo anti-errore sull'id, `calendarYear` = stagione che coincide con l'anno solare).
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
  { id: "seriea", afId: 135, name: "Serie A", short: "Serie A", continent: "europa", country: "IT", nation: "Italia", tier: 1, provider: "apifootball", afCountry: "Italy", afName: "Serie A" },
  { id: "epl", afId: 39, name: "Premier League", short: "Premier", continent: "europa", country: "GB", nation: "Inghilterra", tier: 1, provider: "apifootball", afCountry: "England", afName: "Premier League" },
  { id: "laliga", afId: 140, name: "LaLiga", short: "LaLiga", continent: "europa", country: "ES", nation: "Spagna", tier: 1, provider: "apifootball", afCountry: "Spain", afName: "La Liga" },
  { id: "bundesliga", afId: 78, name: "Bundesliga", short: "Bundesliga", continent: "europa", country: "DE", nation: "Germania", tier: 1, provider: "apifootball", afCountry: "Germany", afName: "Bundesliga" },
  { id: "ligue1", afId: 61, name: "Ligue 1", short: "Ligue 1", continent: "europa", country: "FR", nation: "Francia", tier: 1, provider: "apifootball", afCountry: "France", afName: "Ligue 1" },
  { id: "ucl", afId: 2, name: "Champions League", short: "Champions", continent: "europa", country: "UEFA-C", nation: "Coppe europee", international: true, tier: 0, provider: "apifootball", afCountry: "World", afName: "Champions League" },
  { id: "uel", afId: 3, name: "Europa League", short: "Europa League", continent: "europa", country: "UEFA-C", nation: "Coppe europee", international: true, tier: 0, provider: "apifootball", afCountry: "World", afName: "Europa League" },
  { id: "mls", afId: 253, calendarYear: true, name: "MLS", short: "MLS", continent: "nord-america", country: "US", nation: "Stati Uniti", tier: 1, provider: "apifootball", afCountry: "USA", afName: "Major League Soccer" },
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
  // Aggiunti dopo la scoperta delle partite disponibili (scripts/discover-matches.js): solo competizioni con pronostici E quote sul piano
  // API-Football, serie professionistiche o semi-professionistiche (niente giovanili, femminili, riserve, coppe con formazioni miste, amichevoli senza quote).
  { id: "efl2", name: "League Two", short: "League Two", continent: "europa", country: "GB", nation: "Inghilterra", tier: 4, provider: "apifootball", afId: 42, afCountry: "England", afName: "League Two" },
  { id: "national_league", name: "National League", short: "National League", continent: "europa", country: "GB", nation: "Inghilterra", tier: 5, provider: "apifootball", afId: 43, afCountry: "England", afName: "National League" },
  { id: "national_north", name: "National League North", short: "Nat. North", continent: "europa", country: "GB", nation: "Inghilterra", tier: 6, provider: "apifootball", afId: 50, afCountry: "England", afName: "National League - North" },
  { id: "eerste", name: "Eerste Divisie", short: "Eerste Divisie", continent: "europa", country: "NL", nation: "Paesi Bassi", tier: 2, provider: "apifootball", afId: 89, afCountry: "Netherlands", afName: "Eerste Divisie" },
  { id: "superlig2", name: "2. Lig", short: "2. Lig", continent: "europa", country: "TR", nation: "Turchia", tier: 2, provider: "apifootball", afId: 205, afCountry: "Turkey", afName: "2. Lig" },
  { id: "serie_c_a", name: "Serie C - Girone A", short: "Serie C A", continent: "europa", country: "IT", nation: "Italia", tier: 3, provider: "apifootball", afId: 138, afCountry: "Italy", afName: "Serie C" },
  { id: "serie_c_b", name: "Serie C - Girone B", short: "Serie C B", continent: "europa", country: "IT", nation: "Italia", tier: 3, provider: "apifootball", afId: 942, afCountry: "Italy", afName: "Serie C" },
  { id: "serie_c_c", name: "Serie C - Girone C", short: "Serie C C", continent: "europa", country: "IT", nation: "Italia", tier: 3, provider: "apifootball", afId: 943, afCountry: "Italy", afName: "Serie C" },
  { id: "rfef1", name: "Primera RFEF - Gruppo 1", short: "RFEF 1", continent: "europa", country: "ES", nation: "Spagna", tier: 3, provider: "apifootball", afId: 435, afCountry: "Spain", afName: "RFEF" },
  { id: "rfef2", name: "Primera RFEF - Gruppo 2", short: "RFEF 2", continent: "europa", country: "ES", nation: "Spagna", tier: 3, provider: "apifootball", afId: 436, afCountry: "Spain", afName: "RFEF" },
  { id: "wales", name: "FAW Championship", short: "Galles", continent: "europa", country: "GB-WLS", nation: "Galles", tier: 2, provider: "apifootball", afId: 111, afCountry: "Wales", afName: "Championship" },
  { id: "nirl", name: "Championship", short: "N. Irlanda", continent: "europa", country: "GB-NIR", nation: "Irlanda del Nord", tier: 2, provider: "apifootball", afId: 407, afCountry: "Northern-Ireland", afName: "Championship" },
  { id: "brasileirao", name: "Brasileirão Serie A", short: "Brasileirão", continent: "sud-america", country: "BR", nation: "Brasile", tier: 1, provider: "apifootball", afId: 71, afCountry: "Brazil", afName: "Serie A", calendarYear: true },
  { id: "j2", name: "J2 League", short: "J2", continent: "asia", country: "JP", nation: "Giappone", tier: 2, provider: "apifootball", afId: 99, afCountry: "Japan", afName: "J2" },
  { id: "j3", name: "J3 League", short: "J3", continent: "asia", country: "JP", nation: "Giappone", tier: 3, provider: "apifootball", afId: 100, afCountry: "Japan", afName: "J3" },
  { id: "ligamx", name: "Liga MX", short: "Liga MX", continent: "nord-america", country: "MX", nation: "Messico", tier: 1, provider: "apifootball", afId: 262, afCountry: "Mexico", afName: "Liga MX" },
  { id: "saudipro", name: "Saudi Pro League", short: "Arabia", continent: "asia", country: "SA", nation: "Arabia Saudita", tier: 1, provider: "apifootball", afId: 307, afCountry: "Saudi-Arabia", afName: "Pro League" },
  { id: "j1", name: "J1 League", short: "J1", continent: "asia", country: "JP", nation: "Giappone", tier: 1, provider: "apifootball", afId: 98, afCountry: "Japan", afName: "J1", afSeason: 2027 },
  { id: "liga3", name: "3. Liga", short: "3. Liga", continent: "europa", country: "DE", nation: "Germania", tier: 3, provider: "apifootball", afId: 80, afCountry: "Germany", afName: "3. Liga" },
  { id: "lig1tr", name: "1. Lig", short: "1. Lig", continent: "europa", country: "TR", nation: "Turchia", tier: 2, provider: "apifootball", afId: 204, afCountry: "Turkey", afName: "1. Lig" },
  { id: "austria2", name: "2. Liga", short: "2. Liga AT", continent: "europa", country: "AT", nation: "Austria", tier: 2, provider: "apifootball", afId: 219, afCountry: "Austria", afName: "2. Liga" },
  { id: "scot_champ", name: "Scottish Championship", short: "Scozia 2", continent: "europa", country: "GB-SCT", nation: "Scozia", tier: 2, provider: "apifootball", afId: 180, afCountry: "Scotland", afName: "Championship" },
  { id: "scot_l1", name: "Scottish League One", short: "Scozia 3", continent: "europa", country: "GB-SCT", nation: "Scozia", tier: 3, provider: "apifootball", afId: 183, afCountry: "Scotland", afName: "League One" },
  { id: "scot_l2", name: "Scottish League Two", short: "Scozia 4", continent: "europa", country: "GB-SCT", nation: "Scozia", tier: 4, provider: "apifootball", afId: 184, afCountry: "Scotland", afName: "League Two" },
  { id: "poland1", name: "I Liga", short: "I Liga", continent: "europa", country: "PL", nation: "Polonia", tier: 2, provider: "apifootball", afId: 107, afCountry: "Poland", afName: "I Liga" },
  { id: "greece2", name: "Super League 2", short: "Grecia 2", continent: "europa", country: "GR", nation: "Grecia", tier: 2, provider: "apifootball", afId: 494, afCountry: "Greece", afName: "Super League 2" },
  { id: "romania2", name: "Liga II", short: "Liga II", continent: "europa", country: "RO", nation: "Romania", tier: 2, provider: "apifootball", afId: 284, afCountry: "Romania", afName: "Liga II" },
  { id: "serbia2", name: "Prva Liga", short: "Prva Liga", continent: "europa", country: "RS", nation: "Serbia", tier: 2, provider: "apifootball", afId: 287, afCountry: "Serbia", afName: "Prva Liga" },
  { id: "russia2", name: "First League", short: "Russia 2", continent: "europa", country: "RU", nation: "Russia", tier: 2, provider: "apifootball", afId: 236, afCountry: "Russia", afName: "First League" },
  { id: "ligue3", name: "Ligue 3", short: "Ligue 3", continent: "europa", country: "FR", nation: "Francia", tier: 3, provider: "apifootball", afId: 63, afCountry: "France", afName: "Ligue 3" },
  { id: "nirl_prem", name: "Premiership", short: "N. Irlanda 1", continent: "europa", country: "GB-NIR", nation: "Irlanda del Nord", tier: 1, provider: "apifootball", afId: 408, afCountry: "Northern-Ireland", afName: "Premiership" },
  { id: "brasileirao_b", name: "Brasileirão Serie B", short: "Serie B BR", continent: "sud-america", country: "BR", nation: "Brasile", tier: 2, provider: "apifootball", afId: 72, afCountry: "Brazil", afName: "Serie B", calendarYear: true },
  { id: "colombia", name: "Primera A", short: "Colombia", continent: "sud-america", country: "CO", nation: "Colombia", tier: 1, provider: "apifootball", afId: 239, afCountry: "Colombia", afName: "Primera A", calendarYear: true },
  { id: "peru", name: "Primera División", short: "Perù", continent: "sud-america", country: "PE", nation: "Perù", tier: 1, provider: "apifootball", afId: 281, afCountry: "Peru", calendarYear: true },
  { id: "bolivia", name: "Primera División", short: "Bolivia", continent: "sud-america", country: "BO", nation: "Bolivia", tier: 1, provider: "apifootball", afId: 344, afCountry: "Bolivia", calendarYear: true },
  { id: "arg_nacional", name: "Primera Nacional", short: "Arg. Nacional", continent: "sud-america", country: "AR", nation: "Argentina", tier: 2, provider: "apifootball", afId: 129, afCountry: "Argentina", afName: "Primera Nacional", calendarYear: true },
  { id: "belarus", name: "Premier League", short: "Bielorussia", continent: "europa", country: "BY", nation: "Bielorussia", tier: 1, provider: "apifootball", afId: 116, afCountry: "Belarus", afName: "Premier League", calendarYear: true },
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

export function missingConfig(env, { apifootball = false } = {}) {
  const missing = [];
  if (!env.SUPABASE_URL) missing.push("SUPABASE_URL");
  if (!env.SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
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

/** PATCH con filtro PostgREST (es. { game_id: "eq.x" }). Restituisce il numero di righe cambiate. */
export async function supabasePatch(env, table, filter, body) {
  const url = new URL(`/rest/v1/${table}`, env.SUPABASE_URL);
  for (const [k, v] of Object.entries(filter)) url.searchParams.set(k, String(v));
  const res = await fetch(url, { method: "PATCH", headers: sbHeaders(env, "return=representation"), body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`Supabase patch ${table}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json().catch(() => [])).length;
}

/** DELETE con filtro PostgREST obbligatorio (mai una cancellazione senza filtro). */
export async function supabaseDelete(env, table, filter) {
  if (!Object.keys(filter ?? {}).length) throw new Error("supabaseDelete richiede un filtro.");
  const url = new URL(`/rest/v1/${table}`, env.SUPABASE_URL);
  for (const [k, v] of Object.entries(filter)) url.searchParams.set(k, String(v));
  const res = await fetch(url, { method: "DELETE", headers: sbHeaders(env, "return=representation") });
  if (!res.ok) throw new Error(`Supabase delete ${table}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  return (await res.json().catch(() => [])).length;
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
    select: "league,kickoff_at,home_id,away_id,home_name,away_name,home_score,away_score,neutral_site,decided_in",
    status: "eq.final",
    season: `eq.${SEASON}`,
    order: "kickoff_at.desc,game_id.asc",
  });
  finalsMemo.set(key, { at: now, promise });
  promise.catch(() => { if (finalsMemo.get(key)?.promise === promise) finalsMemo.delete(key); });   // un errore non resta in memoria
  return promise;
}
export const clearFinalsMemo = () => finalsMemo.clear();

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
