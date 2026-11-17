import { json, missingConfig } from "./_lib.js";

/**
 * GET /api/board-chunks?version=<version>&count=<n>
 * Proxy in streaming dei blocchi di partite. Il client ricompone l'array; il Worker non parse/serializza il payload.
 */
export async function onRequest({ request, env }) {
  const missing = missingConfig(env);
  if (missing.length) return json({ error: `Variabili mancanti: ${missing.join(", ")}` }, 503);
  const params = new URL(request.url).searchParams;
  const version = params.get("version") ?? "";
  const count = Number(params.get("count"));
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(version) || !Number.isInteger(count) || count < 0 || count > 1000) {
    return json({ error: "Parametri dello snapshot non validi." }, 400);
  }
  if (count === 0) return new Response("[]", { status: 200, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
  try {
    const url = new URL("/rest/v1/app_snapshot", env.SUPABASE_URL);
    url.searchParams.set("select", "id,payload");
    url.searchParams.set("id", `like.fixtures:chunk:${version}:%`);
    url.searchParams.set("order", "id.asc");
    url.searchParams.set("limit", String(count));
    const res = await fetch(url, { headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, accept: "application/json" } });
    if (!res.ok) return json({ error: `Supabase ha risposto ${res.status} durante il recupero dei blocchi.` }, 502);
    return new Response(res.body, { status: 200, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  } catch (error) {
    return json({ error: `Impossibile leggere i blocchi dell'istantanea: ${error?.message ?? error}` }, 502);
  }
}
