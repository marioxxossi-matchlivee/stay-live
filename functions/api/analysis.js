import { errorMessage, json, loadFinals, missingConfig, supabaseGet } from "./_lib.js";
import { analyzeMatch, buildContext, MODEL } from "./model.js";
import { loadLogoIndex, withLogos } from "./_crests.js";

/** GET /api/analysis?id=GAME_ID&n=8  ->  analisi completa con tutti i passaggi del calcolo. */
export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id") ?? "";
  const n = [5, 8, 10].includes(Number(url.searchParams.get("n"))) ? Number(url.searchParams.get("n")) : 8;
  if (!/^[\w-]{3,80}$/.test(id)) return json({ error: "Parametro id non valido." }, 400);
  const missing = missingConfig(env);
  if (missing.length) return json({ error: `Variabili mancanti: ${missing.join(", ")}` }, 503);
  try {
    const [[match], finals, logos] = await Promise.all([
      supabaseGet(env, "matches", { select: "*", game_id: `eq.${id}`, limit: 1 }),
      loadFinals(env),
      loadLogoIndex(env),
    ]);
    if (!match) return json({ error: "Partita non trovata." }, 404);
    const analysis = analyzeMatch(match, buildContext(finals), { n });
    return json({
      match: { id: match.game_id, league: match.league, kickoffAt: match.kickoff_at, status: match.status, home: match.home_name, away: match.away_name, ...withLogos(match, logos), homeScore: match.home_score, awayScore: match.away_score, neutral: match.neutral_site },
      analysis, model: MODEL,
    });
  } catch (error) {
    console.error("Stay Live analysis:", errorMessage(error));
    return json({ error: errorMessage(error) }, 502);
  }
}
