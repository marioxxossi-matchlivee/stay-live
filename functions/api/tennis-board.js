import { json, missingConfig } from "./_lib.js";

/**
 * GET /api/tennis-board: elenco partite tennis GIÀ PRONTO (pronostici, filtri e storico), costruito dal giro di aggiornamento
 * del tennis (GitHub Actions) e salvato in tennis_snapshot. Nessun calcolo e NESSUNA chiave del provider qui: il provider
 * si interroga solo dal giro di aggiornamento, con i secrets di GitHub. Il calcio (/api/board) è un'altra tabella.
 * 404 se l'istantanea non esiste ancora: l'app mostra "nessun dato" (non è un errore).
 */
export async function onRequest({ env }) {
  const missing = missingConfig(env);
  if (missing.length) return json({ error: `Variabili mancanti: ${missing.join(", ")}` }, 503);
  try {
    const url = new URL("/rest/v1/tennis_snapshot", env.SUPABASE_URL);
    url.searchParams.set("select", "payload,meta,built_at");
    url.searchParams.set("id", "eq.board");
    const res = await fetch(url, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, accept: "application/vnd.pgrst.object+json" } });
    if (res.status === 406 || res.status === 404) return json({ error: "Nessun dato tennis disponibile." }, 404);
    if (!res.ok) return json({ error: `Supabase ha risposto ${res.status}.` }, 502);
    return new Response(res.body, { status: 200, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  } catch (error) {
    return json({ error: `Impossibile leggere l'istantanea tennis: ${error?.message ?? error}` }, 502);
  }
}
