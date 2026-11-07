import { errorMessage, json, loadFinals, missingConfig } from "./_lib.js";

/**
 * GET /api/export-finals   (header x-sync-secret = SYNC_SECRET)
 * Le partite finali della stagione nel formato di `npm run backtest` / `scripts/backtest-bets.js` (stesse esclusioni di `backtest_finals`:
 * niente supplementari né rigori). Serve al workflow GitHub «Backtest storico»: nessuna chiave Supabase fuori da Cloudflare.
 */
export async function onRequest({ request, env }) {
  if (!env.SYNC_SECRET || request.headers.get("x-sync-secret") !== env.SYNC_SECRET) return json({ error: "Non autorizzato." }, 401);
  const missing = missingConfig(env);
  if (missing.length) return json({ error: `Variabili mancanti: ${missing.join(", ")}` }, 503);
  try {
    const rows = (await loadFinals(env))
      .filter((m) => Number.isFinite(m.home_score) && Number.isFinite(m.away_score) && !["extra_time", "penalties"].includes(m.decided_in ?? ""))
      .map(({ decided_in, ...m }) => m)
      .sort((a, b) => Date.parse(a.kickoff_at) - Date.parse(b.kickoff_at));
    return json(rows);
  } catch (error) {
    console.error("Stay Live export-finals:", errorMessage(error));
    return json({ error: errorMessage(error) }, 502);
  }
}
