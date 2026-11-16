import { errorMessage, json, missingConfig, supabaseGet } from "./_lib.js";
import { summarizeBudget } from "./_budgetreport.js";

/**
 * GET /api/budget: dashboard dei crediti API-Football. Solo letture su Supabase (nessuna chiamata al provider, nessun credito).
 * Usa il contatore esistente (af_usage), il registro af_ledger del Budget Manager, i compiti aperti e i contatori dell'ultima istantanea.
 */
export async function onRequest({ env }) {
  const missing = missingConfig(env);
  if (missing.length) return json({ error: `Variabili mancanti: ${missing.join(", ")}` }, 503);
  try {
    const now = Date.now(), day = new Date(now).toISOString().slice(0, 10), since = new Date(now - 48 * 3600e3).toISOString().slice(0, 10);
    const [usage, ledger, tasks, snap] = await Promise.all([
      supabaseGet(env, "af_usage", { select: "*", day: `eq.${day}`, limit: 1 }),
      supabaseGet(env, "af_ledger", { select: "*", day: `gte.${since}`, limit: 5000 }).catch(() => []),     // tabella assente = migrazione 202611160001 non applicata
      supabaseGet(env, "refresh_tasks", { select: "component,state,attempts,next_try_at" }).catch(() => []),
      supabaseGet(env, "app_snapshot", { select: "meta,built_at", id: "eq.fixtures", limit: 1 }).catch(() => []),
    ]);
    return json({ ...summarizeBudget({ usage: usage[0], ledger, tasks, completeness: snap[0]?.meta?.completeness ?? null, now }), ledgerReady: ledger.length > 0, builtAt: snap[0]?.built_at ?? null }, 200, { "cache-control": "public, max-age=30" });
  } catch (error) {
    return json({ error: `Impossibile leggere i dati: ${errorMessage(error)}` }, 502);
  }
}
