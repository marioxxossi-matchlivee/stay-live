import { errorMessage, json, loadFinals, missingConfig, supabaseGet } from "./_lib.js";
import { analyzeMatch, buildContext } from "./model.js";
import { loadBrainInputs } from "./_brain.js";
import { modelVersion, predictionRow, recordPredictions } from "./_predictions.js";

/**
 * GET|POST /api/snapshot?hours=36&live=0   (header x-sync-secret = SYNC_SECRET)
 * Registra su Supabase il pronostico principale di TUTTE le partite in programma nelle prossime `hours` ore, anche quelle mai aperte nell'app,
 * così l'affidabilità si misura su tutti i BET. Usa solo i dati già in cache di API-Football (nessuna richiesta in più):
 * `live=N` consente fino a N richieste fresche per giro (default 0, per non consumare il limite giornaliero).
 * Ogni riga indica le fonti usate (`basis`): le partite senza dati API-Football sono calcolate solo sullo storico.
 */
export async function onRequest({ request, env }) {
  if (!env.SYNC_SECRET || request.headers.get("x-sync-secret") !== env.SYNC_SECRET) return json({ error: "Non autorizzato." }, 401);
  const missing = missingConfig(env);
  if (missing.length) return json({ error: `Variabili mancanti: ${missing.join(", ")}` }, 503);
  const url = new URL(request.url);
  const hours = Math.min(96, Math.max(1, Number(url.searchParams.get("hours")) || 36));
  const live = Math.min(30, Math.max(0, Number(url.searchParams.get("live")) || 0));
  const now = Date.now();
  try {
    const [matches, finals] = await Promise.all([
      supabaseGet(env, "matches", { select: "*", status: "eq.scheduled", and: `(kickoff_at.gt.${new Date(now).toISOString()},kickoff_at.lte.${new Date(now + hours * 3600e3).toISOString()})`, order: "kickoff_at.asc", limit: 300 }),
      loadFinals(env),
    ]);
    if (!matches.length) return json({ ok: true, matches: 0, stored: 0 });
    const ctx = buildContext(finals);
    const none = { byGame: new Map() };
    const br = env.API_FOOTBALL_KEY ? await loadBrainInputs(env, matches, now, live ? { live: true, maxMap: Math.max(1, Math.ceil(live / 3)), maxLive: live } : { live: false }).catch((e) => { console.error("Stay Live snapshot brain:", errorMessage(e)); return none; }) : none;
    const ver = modelVersion();
    const rows = matches.map((m) => predictionRow(m, analyzeMatch(m, ctx, { n: 8, ...(br.byGame.get(m.game_id) ?? {}) }), { now, ver })).filter(Boolean);
    const stored = await recordPredictions(env, rows);
    const by = (f) => rows.reduce((o, r) => ({ ...o, [f(r)]: (o[f(r)] ?? 0) + 1 }), {});
    return json({ ok: true, matches: matches.length, stored, bets: rows.filter((r) => r.verdict === "BET").length, basis: by((r) => r.basis ?? "?"), version: ver });
  } catch (error) {
    console.error("Stay Live snapshot:", errorMessage(error));
    return json({ error: errorMessage(error) }, 502);
  }
}
