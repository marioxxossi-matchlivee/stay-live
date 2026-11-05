/**
 * Scudetti delle squadre (logo di API-Football).
 * - Partite sincronizzate da API-Football: l'id squadra e' nell'id dell'app ("af-<team>") e il logo ha un indirizzo fisso.
 * - Partite di API Ninjas (campionati principali): le squadre si abbinano per nome all'elenco squadre del campionato
 *   (endpoint `teams`, 1 richiesta per campionato, tenuta in cache 30 giorni) con lo stesso abbinamento usato per le partite.
 * Funzioni pure e testabili; l'unico I/O e' la lettura della cache di Supabase (nessuna richiesta ad API-Football qui).
 */
import { LEAGUES, supabaseGet } from "./_lib.js";
import { bestTeam } from "./_scrape.js";

export const CREST_TTL = 30 * 24 * 3600e3;
const MEDIA = "https://media.api-sports.io/football/teams";

/** Indirizzo del logo di una squadra API-Football (o null se l'id non e' valido). */
export const crestUrl = (teamId) => (Number.isInteger(Number(teamId)) && Number(teamId) > 0 ? `${MEDIA}/${Number(teamId)}.png` : null);

/** "af-123" -> 123; qualsiasi altro id -> null. */
export const afTeamId = (id) => { const m = /^af-(\d+)$/.exec(String(id ?? "")); return m ? Number(m[1]) : null; };

/** Campionati con partite da API Ninjas che hanno bisogno dell'elenco squadre per gli scudetti. */
export const needsTeamList = (leagueId) => { const l = LEAGUES.find((x) => x.id === leagueId); return Boolean(l?.afId && l.provider !== "apifootball"); };

/** Righe af_cache (endpoint `teams`) -> mappa id API-Football del campionato -> [{ id, name, logo }]. */
export function buildLogoIndex(rows) {
  const index = new Map();
  for (const r of rows ?? []) {
    const lg = Number(r.params?.league);
    if (!lg || !Array.isArray(r.response)) continue;
    index.set(lg, r.response.map((x) => ({ id: x.team?.id, name: x.team?.name, logo: x.team?.logo ?? crestUrl(x.team?.id) })).filter((x) => x.name && x.logo));
  }
  return index;
}

/** Logo di una squadra di una partita dell'app. */
export function logoFor(leagueId, teamId, teamName, index) {
  const direct = afTeamId(teamId);
  if (direct) return crestUrl(direct);
  const lg = LEAGUES.find((l) => l.id === leagueId)?.afId;
  const teams = index?.get(lg);
  if (!teams?.length || !teamName) return null;
  const hit = bestTeam(teamName, teams.map((t) => t.name));
  return teams.find((t) => t.name === hit)?.logo ?? null;
}

/** Aggiunge homeLogo/awayLogo a una riga partita (campi `league`, `home_id`, `home_name`, `away_id`, `away_name`). */
export const withLogos = (match, index) => ({ homeLogo: logoFor(match.league, match.home_id, match.home_name, index), awayLogo: logoFor(match.league, match.away_id, match.away_name, index) });

/** Legge dalla cache gli elenchi squadre gia' scaricati (nessuna richiesta al provider). */
export async function loadLogoIndex(env) {
  try {
    return buildLogoIndex(await supabaseGet(env, "af_cache", { select: "params,response", endpoint: "eq.teams", error: "is.null", limit: 60 }));
  } catch (e) {
    console.error("Stay Live crests:", e?.message ?? e);
    return new Map();                // gli scudetti sono un di piu': senza cache restano le sigle
  }
}
