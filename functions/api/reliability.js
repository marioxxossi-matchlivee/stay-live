import { errorMessage, json, missingConfig, supabaseGetAll } from "./_lib.js";
import { reliabilityFrom } from "./_reliability.js";
import { modelVersion } from "./_predictions.js";

/**
 * GET /api/reliability[?all=1]
 * Affidabilità di TUTTI i BET che l'app ha consigliato (registrati prima del calcio d'inizio in `bet_predictions`), non solo di quelli salvati.
 * Di default conta solo la versione attuale del modello; con all=1 anche le precedenti.
 */
export async function onRequest({ request, env }) {
  const missing = missingConfig(env);
  if (missing.length) return json({ error: `Variabili mancanti: ${missing.join(", ")}` }, 503);
  try {
    const rows = await supabaseGetAll(env, "bet_prediction_results", {
      select: "game_id,league,kickoff_at,sel_key,p,p_low,odds,verdict,basis,model_ver,status,home_score,away_score,decided_in", verdict: "eq.BET", order: "kickoff_at.asc,game_id.asc",
    });
    const all = new URL(request.url).searchParams.get("all") === "1";
    return json({ ...reliabilityFrom(rows, { ver: all ? null : modelVersion() }), version: modelVersion() });
  } catch (error) {
    console.error("Stay Live reliability:", errorMessage(error));
    return json({ error: errorMessage(error) }, 502);
  }
}
