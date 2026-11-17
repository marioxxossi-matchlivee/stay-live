import { json, missingConfig } from "./_lib.js";

/**
 * GET /api/board: restituisce il manifest dello snapshot calcio.
 * Il body Supabase viene inoltrato in streaming: il Worker non deve parsare/serializzare i dati delle partite.
 * Per gli snapshot a blocchi il client scarica i blocchi da /api/board-chunks e ricompone payload.matches.
 */
export async function onRequest({ env }) {
  const missing = missingConfig(env);
  if (missing.length) return json({ error: `Variabili mancanti: ${missing.join(", ")}` }, 503);
  try {
    const url = new URL("/rest/v1/app_snapshot", env.SUPABASE_URL);
    url.searchParams.set("select", "payload,meta,built_at");
    url.searchParams.set("id", "eq.fixtures");
    const res = await fetch(url, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, accept: "application/vnd.pgrst.object+json" } });
    if (res.status === 406 || res.status === 404) return json({ error: "Istantanea non ancora disponibile." }, 404);
    if (!res.ok) return json({ error: `Supabase ha risposto ${res.status}.` }, 502);
    return new Response(res.body, { status: 200, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  } catch (error) {
    return json({ error: `Impossibile leggere l'istantanea: ${error?.message ?? error}` }, 502);
  }
}
