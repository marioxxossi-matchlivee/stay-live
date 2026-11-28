import { errorMessage, json, missingConfig, supabaseGetAll } from "./_lib.js";

/**
 * GET /api/reliability-leagues
 * Affidabilità per campionato e mercato: l'esito più probabile di ogni mercato, registrato prima del calcio d'inizio, contro il risultato finale.
 * Legge la vista `league_market_reliability` (già aggregata: poche centinaia di righe).
 */
export async function onRequest({ env }) {
  const missing = missingConfig(env);
  if (missing.length) return json({ error: `Variabili mancanti: ${missing.join(", ")}` }, 503);
  try {
    const rows = await supabaseGetAll(env, "league_market_reliability", { select: "league,market,n,won,expected,n_q,won_q", order: "league.asc,market.asc" });
    return json({ rows });
  } catch (error) {
    console.error("Stay Live reliability-leagues:", errorMessage(error));
    return json({ error: errorMessage(error) }, 502);
  }
}
