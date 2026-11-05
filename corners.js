import { errorMessage, json, missingConfig, supabaseGet } from "./_lib.js";
import { loadCornerOdds } from "./_corners.js";

const COLS = "game_id,league,season,kickoff_at,status,home_id,away_id,home_name,away_name";

/**
 * GET /api/corners?ids=a,b,c
 * Quote corner (API-Football) per le partite indicate, a piccoli passi: se il provider limita le richieste risponde `retry` e il browser riprova da solo.
 * Quello già scaricato resta in cache (la stessa della scheda dati): non si riscarica finché non può essere cambiato.
 */
export async function onRequest({ request, env }) {
  const ids = [...new Set((new URL(request.url).searchParams.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean))];
  if (!ids.length || ids.length > 40 || !ids.every((id) => /^[\w-]{3,80}$/.test(id))) return json({ error: "Indica da 1 a 40 partite." }, 400);
  const missing = missingConfig(env, { apifootball: true });
  if (missing.length) return json({ error: `Variabili mancanti su Cloudflare: ${missing.join(", ")}` }, 503);
  try {
    const matches = await supabaseGet(env, "matches", { select: COLS, game_id: `in.(${ids.map((i) => `"${i}"`).join(",")})`, limit: 40 });
    const r = await loadCornerOdds(env, matches, Date.now());
    return json({ corners: Object.fromEntries(matches.map((m) => [m.game_id, r.byGame.get(m.game_id) ?? null])), state: Object.fromEntries(matches.map((m) => [m.game_id, r.state.get(m.game_id) ?? "missing"])), retry: r.retry });
  } catch (error) {
    console.error("Stay Live corners:", errorMessage(error));
    return json({ error: errorMessage(error) }, 502);
  }
}
