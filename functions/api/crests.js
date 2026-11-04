import { LEAGUES, LEAGUE_IDS, errorMessage, json, missingConfig } from "./_lib.js";
import { CREST_TTL, needsTeamList } from "./_crests.js";
import { loadSections, seasonFor } from "./_apifootball.js";

/**
 * GET /api/crests?league=seriea
 * Scarica (una volta al mese, poi dalla cache) l'elenco squadre del campionato per mostrare gli scudetti.
 * Una sola richiesta ad API-Football; se il limite al minuto e' superato risponde `retry` e il browser riprova da solo.
 */
export async function onRequest({ request, env }) {
  const league = new URL(request.url).searchParams.get("league") ?? "";
  if (!LEAGUE_IDS.has(league)) return json({ error: "Parametro league non valido." }, 400);
  if (!needsTeamList(league)) return json({ ok: true, league, skipped: true });
  const missing = missingConfig(env, { apifootball: true });
  if (missing.length) return json({ error: `Variabili mancanti su Cloudflare: ${missing.join(", ")}` }, 503);
  try {
    const now = Date.now();
    const cfg = LEAGUES.find((l) => l.id === league);
    const { sections, retry } = await loadSections(env, [{ section: "teams", endpoint: "teams", params: { league: cfg.afId, season: seasonFor(league, new Date(now).toISOString()) }, ttl: CREST_TTL }], now);
    const t = sections.teams;
    return json({ ok: !t.error || Boolean(t.data), league, teams: Array.isArray(t.data) ? t.data.length : 0, error: t.error, retry });
  } catch (error) {
    console.error("Stay Live crests:", errorMessage(error));
    return json({ error: errorMessage(error) }, 502);
  }
}
