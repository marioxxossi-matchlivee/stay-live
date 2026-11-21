import { json, missingConfig, supabaseGetAll } from "./_lib.js";
import { parseParams, loadObservationPage } from "./_tennis-observation-read.js";

/**
 * GET /api/tennis-observation: LIVE OBSERVATION, SOLA LETTURA. Storico COMPLETO a pagine (cursore), senza limiti temporali.
 *   ?limit=100 (1–200) · ?before=<cursore della pagina precedente> · ?from=&to= (ISO, filtro sulla data di inizio) · ?key=<match_key> (una partita con tutte le revisioni)
 * Risposta: { available, observations, versions (TUTTE le revisioni delle partite della pagina), nextCursor, complete, total, diagnostics (solo prima pagina) }.
 * Nessuna scrittura, nessuna chiave del provider, nessun calcolo del modello. Tabelle assenti (migrazione non applicata): 200 con available:false.
 */
export async function onRequest({ env, request }) {
  const missing = missingConfig(env);
  if (missing.length) return json({ error: `Variabili mancanti: ${missing.join(", ")}` }, 503);
  let params; try { params = parseParams(new URL(request.url).searchParams); } catch (e) { return json({ error: e.message }, e.status ?? 400); }
  try {
    let page;
    try { page = await loadObservationPage(env, params); }
    catch (e) {
      if (/HTTP (404|400)/.test(String(e?.message))) return json({ available: false, reason: "Il registro LIVE OBSERVATION non è ancora attivo (tabelle non create).", diagnostics: null }, 200, { "cache-control": "no-store" });
      throw e;
    }
    let diagnostics;
    if (!params.cursor) {
      try { const st = await supabaseGetAll(env, "tennis_sync_state", { select: "id,last_ok,last_error,meta", id: "eq.refresh" }, 5, 1); diagnostics = { lastOk: st[0]?.last_ok ?? null, ...(st[0]?.meta?.liveObservation ?? { enabled: false, note: "Nessuna esecuzione registrata." }) }; } catch { diagnostics = { unavailable: true }; }
    }
    return json({ available: true, builtAt: new Date().toISOString(), ...page, ...(diagnostics ? { diagnostics } : {}) }, 200, { "cache-control": "no-store" });
  } catch (error) {
    return json({ error: `Impossibile leggere LIVE OBSERVATION: ${error?.message ?? error}` }, 502);
  }
}
