import { errorMessage, json, loadFinals, missingConfig, supabaseGet } from "./_lib.js";
import { analyzeMatch, buildContext, MODEL } from "./model.js";
import { loadLogoIndex, withLogos } from "./_crests.js";
import { brainStatusOf, loadBrainInputs } from "./_brain.js";

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
    // Cervello unico: ultime partite + pronostico di API-Football + quote di mercato (+ assenti se già in cache).
    // Senza chiave o con il provider al limite si calcola con ciò che c'è e il browser riprova da solo.
    const none = { byGame: new Map(), state: new Map(), marketState: new Map(), retry: { pending: 0, afterMs: 0 } };
    const br = env.API_FOOTBALL_KEY ? await loadBrainInputs(env, [match], Date.now(), { maxMap: 2, maxLive: 4 }).catch((e) => { console.error("Stay Live brain:", errorMessage(e)); return none; }) : none;
    const analysis = analyzeMatch(match, buildContext(finals), { n, ...(br.byGame.get(match.game_id) ?? {}) });
    const afStatus = { ...brainStatusOf(br, [match.game_id]), off: !env.API_FOOTBALL_KEY };
    return json({
      match: { id: match.game_id, league: match.league, kickoffAt: match.kickoff_at, status: match.status, home: match.home_name, away: match.away_name, ...withLogos(match, logos), homeScore: match.home_score, awayScore: match.away_score, neutral: match.neutral_site },
      analysis, model: MODEL, afStatus,
    });
  } catch (error) {
    console.error("Stay Live analysis:", errorMessage(error));
    return json({ error: errorMessage(error) }, 502);
  }
}
