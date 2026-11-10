import { errorMessage, json, supabaseGet, supabaseUpsert } from "./_lib.js";

/**
 * POST /api/refresh: avvia dall'app un aggiornamento completo (lo stesso del giro ogni 4 ore) senza aprire GitHub.
 * Fa partire il workflow "Aggiornamento completo" tramite l'API di GitHub (workflow_dispatch). Variabili su Cloudflare Pages:
 *   GH_REPO            es. "mario/stay-live"
 *   GH_DISPATCH_TOKEN  token GitHub "fine-grained" limitato a QUEL repository, permesso Actions: Read and write (nient'altro). Secret.
 *   GH_REF             facoltativa, ramo (default "main")
 * Il token resta sul server. Protezione: al massimo una richiesta ogni 10 minuti (registrata in Supabase) e il workflow non parte
 * due volte insieme (concurrency). GET restituisce se la funzione è configurata e quando è stata richiesta l'ultima volta.
 */
const MIN_GAP_MS = 10 * 60e3;
const REQ_ID = "manual_request";

export async function onRequest({ request, env }) {
  const configured = Boolean(env.GH_REPO && env.GH_DISPATCH_TOKEN && env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
  const last = configured ? await supabaseGet(env, "app_snapshot", { select: "built_at", id: `eq.${REQ_ID}`, limit: 1 }).then((r) => r[0]?.built_at ?? null).catch(() => null) : null;
  if (request.method === "GET") return json({ configured, lastRequestedAt: last });
  if (request.method !== "POST") return json({ error: "Metodo non consentito." }, 405);
  if (!configured) return json({ error: "Aggiornamento manuale non configurato: servono GH_REPO e GH_DISPATCH_TOKEN su Cloudflare Pages (vedi README).", configured: false }, 503);
  const now = Date.now();
  if (last && now - Date.parse(last) < MIN_GAP_MS) return json({ error: "Aggiornamento già richiesto da poco: attendi qualche minuto.", retryAfterSec: Math.ceil((MIN_GAP_MS - (now - Date.parse(last))) / 1000) }, 429);
  try {
    const res = await fetch(`https://api.github.com/repos/${env.GH_REPO}/actions/workflows/aggiornamento-completo.yml/dispatches`, {
      method: "POST",
      headers: { authorization: `Bearer ${env.GH_DISPATCH_TOKEN}`, accept: "application/vnd.github+json", "x-github-version": "2022-11-28", "user-agent": "stay-live", "content-type": "application/json" },
      body: JSON.stringify({ ref: env.GH_REF || "main" }),
    });
    if (res.status !== 204) return json({ error: `GitHub ha risposto ${res.status}: ${(await res.text()).slice(0, 160)}` }, 502);
    await supabaseUpsert(env, "app_snapshot", [{ id: REQ_ID, payload: {}, meta: { by: "app" }, built_at: new Date(now).toISOString() }], "id");
    return json({ ok: true, requestedAt: new Date(now).toISOString() }, 202);
  } catch (error) {
    return json({ error: errorMessage(error) }, 502);
  }
}
