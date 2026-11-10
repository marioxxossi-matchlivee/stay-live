import { fetchAfSeason } from "./_apifootball.js";
import {
  LEAGUES, LEAGUE_IDS, TTL, errorMessage, isActiveLeague, json, missingConfig,
  supabaseGet, supabaseUpsert, syncDue,
} from "./_lib.js";

/**
 * GET|POST /api/sync?league=seriea
 * Le partite arrivano solo da API-Football (una richiesta per campionato e stagione).
 * Pubblico ma "a prova di abuso": non chiama il provider se i dati sono ancora freschi
 * (15 min con partite in corso, 6 ore altrimenti). Con header x-sync-secret + force=1 si forza.
 */
export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const league = url.searchParams.get("league") ?? "";
  if (!LEAGUE_IDS.has(league)) return json({ error: "Parametro league non valido." }, 400);
  const cfg = LEAGUES.find((l) => l.id === league);
  const missing = missingConfig(env, { apifootball: true });
  if (missing.length) return json({ error: `Variabili mancanti su Cloudflare: ${missing.join(", ")}` }, 503);

  const now = Date.now();
  const force = url.searchParams.get("force") === "1" && env.SYNC_SECRET && request.headers.get("x-sync-secret") === env.SYNC_SECRET;
  try {
    const [state] = await supabaseGet(env, "sync_state", { select: "*", league: `eq.${league}`, limit: 1 });
    const from = new Date(now - 4 * 3600e3).toISOString();
    const recent = await supabaseGet(env, "matches", {
      select: "league,status,kickoff_at", league: `eq.${league}`, status: "neq.final",
      and: `(kickoff_at.gte.${from},kickoff_at.lte.${new Date(now + 10 * 60e3).toISOString()})`, limit: 5,
    });
    if (!force && !syncDue(state, isActiveLeague(recent, league, now), now)) {
      return json({ ok: true, skipped: true, league, syncedAt: state?.synced_at ?? null });
    }
    await supabaseUpsert(env, "sync_state", [{ league, attempted_at: new Date(now).toISOString(), last_error: state?.last_error ?? null, synced_at: state?.synced_at ?? null, matches_count: state?.matches_count ?? 0 }], "league");
    let rows;
    try {
      rows = await fetchAfSeason(env, cfg, now);
      await supabaseUpsert(env, "matches", rows, "game_id");
    } catch (error) {
      await supabaseUpsert(env, "sync_state", [{ league, attempted_at: new Date().toISOString(), last_error: errorMessage(error).slice(0, 300), synced_at: state?.synced_at ?? null, matches_count: state?.matches_count ?? 0 }], "league");
      throw error;
    }
    const doneAt = new Date().toISOString();
    await supabaseUpsert(env, "sync_state", [{ league, synced_at: doneAt, attempted_at: doneAt, matches_count: rows.length, last_error: null }], "league");
    return json({ ok: true, league, matches: rows.length, finals: rows.filter((r) => r.status === "final").length, syncedAt: doneAt, nextRefreshMinutes: TTL.active / 60e3 });
  } catch (error) {
    console.error("Stay Live sync:", errorMessage(error));
    return json({ error: errorMessage(error) }, 502);
  }
}
