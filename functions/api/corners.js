import { errorMessage, json, missingConfig, supabaseGet } from "./_lib.js";
import { loadCornerActuals, loadCornerOdds } from "./_corners.js";

const COLS = "game_id,league,season,kickoff_at,status,home_id,away_id,home_name,away_name";

/**
 * GET /api/corners?ids=a,b,c[&actual=1]
 * Con actual=1 aggiunge i corner REALI delle partite finite (`actual`), per confrontarli con la previsione salvata.
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
    const now = Date.now();
    const wantActual = new URL(request.url).searchParams.get("actual") === "1";
    const finals = wantActual ? matches.filter((m) => m.status === "final") : [];
    const live = matches.filter((m) => m.status !== "final" || !wantActual);          // le quote servono solo prima del fischio d'inizio
    const r = await loadCornerOdds(env, live, now, { maxLive: 8 });
    const a = finals.length ? await loadCornerActuals(env, finals, now, { maps: r.maps, maxLive: 6 }) : null;
    const retry = { pending: (r.retry.pending ?? 0) + (a?.retry.pending ?? 0), afterMs: Math.max(r.retry.afterMs ?? 0, a?.retry.afterMs ?? 0) };
    return json({
      corners: Object.fromEntries(matches.map((m) => [m.game_id, r.byGame.get(m.game_id) ?? null])),
      state: Object.fromEntries(matches.map((m) => [m.game_id, r.state.get(m.game_id) ?? "missing"])),
      ...(wantActual ? { actual: Object.fromEntries(finals.map((m) => [m.game_id, a?.byGame.get(m.game_id) ?? null])), actualState: Object.fromEntries(finals.map((m) => [m.game_id, a?.state.get(m.game_id) ?? "missing"])) } : {}),
      retry,
    });
  } catch (error) {
    console.error("Stay Live corners:", errorMessage(error));
    return json({ error: errorMessage(error) }, 502);
  }
}
