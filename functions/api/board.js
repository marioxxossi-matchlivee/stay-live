import { json, missingConfig } from "./_lib.js";

/**
 * GET /api/board: l'elenco partite GIÀ PRONTO, costruito ogni 4 ore dal giro completo (scripts/full-refresh.js) e salvato su Supabase.
 * Qui non c'è nessun calcolo: la risposta di Supabase passa così com'è (stream), quindi la CPU usata è trascurabile
 * (il piano Free di Cloudflare concede 10 ms a richiesta). Forma: { payload: <come /api/fixtures>, meta: <rapporto del giro>, built_at }.
 * 404 se l'istantanea non esiste ancora (migrazione non applicata o primo giro non fatto): l'app ripiega su /api/fixtures.
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
