import { errorMessage, json, missingConfig, supabaseGet } from "./_lib.js";

/**
 * GET /api/results?ids=a,b,c
 * Stato e risultato delle partite indicate (anche di giorni fa): serve a confrontare le giocate salvate con quello che e' successo.
 * Legge solo la tabella `matches`; i risultati si aggiornano con la sincronizzazione dei campionati (/api/sync).
 */
export async function onRequest({ request, env }) {
  const ids = [...new Set((new URL(request.url).searchParams.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean))];
  if (!ids.length || ids.length > 60 || !ids.every((id) => /^[\w-]{3,80}$/.test(id))) return json({ error: "Indica da 1 a 60 partite." }, 400);
  const missing = missingConfig(env);
  if (missing.length) return json({ error: `Variabili mancanti: ${missing.join(", ")}` }, 503);
  try {
    const rows = await supabaseGet(env, "matches", { select: "game_id,league,status,kickoff_at,home_score,away_score", game_id: `in.(${ids.map((i) => `"${i}"`).join(",")})`, limit: 60 });
    return json({ matches: Object.fromEntries(rows.map((m) => [m.game_id, { league: m.league, status: m.status, kickoffAt: m.kickoff_at, homeScore: m.home_score, awayScore: m.away_score }])) });
  } catch (error) {
    console.error("Stay Live results:", errorMessage(error));
    return json({ error: errorMessage(error) }, 502);
  }
}
