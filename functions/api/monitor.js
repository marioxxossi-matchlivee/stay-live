import { errorMessage, json, missingConfig, supabaseGet } from "./_lib.js";
import { buildModelMonitor } from "./_modelmonitor.js";

/**
 * GET /api/monitor — affidabilità del modello attuale: 1X2, doppia chance e Multigol.
 * Sola lettura: pronostici registrati PRIMA della partita (prediction_legs / bet_predictions) contro il risultato dei 90 minuti, aggregati dalle viste
 * monitor_* (tutto ciò che si vede si aggiorna da solo a ogni partita conclusa). Ultime 48 ore e andamento giornaliero comprese.
 */
export async function onRequest({ env }) {
  const missing = missingConfig(env);
  if (missing.length) return json({ error: `Variabili mancanti: ${missing.join(", ")}` }, 503);
  try {
    const [legs, picks, status, win, daily, mgPick] = await Promise.all([
      supabaseGet(env, "monitor_legs_agg", { select: "*" }),
      supabaseGet(env, "monitor_picks_agg", { select: "*" }),
      supabaseGet(env, "monitor_status", { select: "*" }),
      supabaseGet(env, "monitor_window_agg", { select: "*" }),
      supabaseGet(env, "monitor_daily_agg", { select: "*", order: "day.desc", limit: 500 }),
      supabaseGet(env, "monitor_mg_pick_agg", { select: "*" }),
    ]);
    return json(buildModelMonitor({ legs, picks, status, win, daily, mgPick }), 200, { "cache-control": "public, max-age=30" });
  } catch (error) {
    console.error("Stay Live monitor:", errorMessage(error));
    return json({ error: errorMessage(error) }, 502);
  }
}
