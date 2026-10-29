import { errorMessage, json, loadFinals, missingConfig, supabaseGet } from "./_lib.js";
import { analyzeMatch, buildAccumulator, buildContext, compactPick } from "./model.js";

/** GET /api/preview?ids=a,b,c&n=8  ->  consiglio per ogni partita scelta + multipla suggerita. */
export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const ids = [...new Set((url.searchParams.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean))];
  const n = [5, 8, 10].includes(Number(url.searchParams.get("n"))) ? Number(url.searchParams.get("n")) : 8;
  if (!ids.length || ids.length > 40 || !ids.every((id) => /^[\w-]{3,80}$/.test(id))) {
    return json({ error: "Seleziona da 1 a 40 partite." }, 400);
  }
  const missing = missingConfig(env);
  if (missing.length) return json({ error: `Variabili mancanti: ${missing.join(", ")}` }, 503);
  try {
    const [matches, finals] = await Promise.all([
      supabaseGet(env, "matches", { select: "*", game_id: `in.(${ids.map((i) => `"${i}"`).join(",")})`, order: "kickoff_at.asc", limit: 40 }),
      loadFinals(env),
    ]);
    const ctx = buildContext(finals);
    const items = matches.map((m) => {
      const a = analyzeMatch(m, ctx, { n });
      return {
        id: m.game_id, league: m.league, kickoffAt: m.kickoff_at, status: m.status, home: m.home_name, away: m.away_name,
        pick: compactPick(a), alternatives: a.alternatives.slice(0, 2).map((s) => ({ label: s.label, p: s.p, pLow: s.pLow, minOdds: s.minOdds })),
        topScores: a.topScores, confidence: a.confidence, sample: a.sample, lambda: a.lambda,
      };
    });
    return json({
      n, generatedAt: new Date().toISOString(), items,
      summary: { selected: items.length, bets: items.filter((i) => i.pick?.verdict === "BET").length, accumulator: buildAccumulator(items) },
    });
  } catch (error) {
    console.error("Stay Live preview:", errorMessage(error));
    return json({ error: errorMessage(error) }, 502);
  }
}
