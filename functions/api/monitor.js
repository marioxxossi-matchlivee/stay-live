import { errorMessage, json, missingConfig, supabaseGet } from "./_lib.js";
import { buildMonitor } from "./_monitor.js";
import { modelVersion } from "./_predictions.js";

/**
 * GET /api/monitor — monitoraggio dell'affidabilità di BET ed EVITA.
 *  - Dal vivo: tutti i pronostici registrati PRIMA della partita (bet_predictions + prediction_legs) contro il risultato finale.
 *  - Storico: il rapporto del backtest cronologico sulle partite finali (pubblicato dal workflow in app_snapshot "reliability-backtest").
 * I conteggi sono aggregati dal database (viste monitor_*): poche righe, nessun limite di pagine.
 */
export async function onRequest({ env }) {
  const missing = missingConfig(env);
  if (missing.length) return json({ error: `Variabili mancanti: ${missing.join(", ")}` }, 503);
  try {
    const [legs, picks, status, snap] = await Promise.all([
      supabaseGet(env, "monitor_legs_agg", { select: "*" }),
      supabaseGet(env, "monitor_picks_agg", { select: "*" }),
      supabaseGet(env, "monitor_status", { select: "*" }),
      supabaseGet(env, "app_snapshot", { select: "payload,built_at", id: "eq.reliability-backtest", limit: 1 }).catch(() => []),
    ]);
    const backtest = snap[0] ? { ...snap[0].payload, builtAt: snap[0].built_at } : null;
    return json(buildMonitor({ legs, picks, status, backtest, ver: modelVersion() }), 200, { "cache-control": "public, max-age=120" });
  } catch (error) {
    console.error("Stay Live monitor:", errorMessage(error));
    return json({ error: errorMessage(error) }, 502);
  }
}
