import { errorMessage, json, missingConfig, supabaseRpc } from "./_lib.js";

const SEL = { football: /^(home|draw|away|dc1x|dcx2|dc12)$/, tennis: /^[12]$/ };
const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : null);

/**
 * Notifiche sul cambio di pronostico.
 *  GET    -> { publicKey }                       chiave pubblica VAPID per sottoscrivere il dispositivo
 *  POST   -> { subscription, plays }             sincronizza le giocate salvate di questo dispositivo (sostituisce l'elenco)
 *  DELETE -> { endpoint }                        disattiva le notifiche del dispositivo
 * L'invio vero lo fa la edge function pick-change-notify (Supabase).
 */
export async function onRequest({ request, env }) {
  if (request.method === "GET") return json({ publicKey: env.VAPID_PUBLIC_KEY ?? null });
  if (request.method !== "POST" && request.method !== "DELETE") return json({ error: "Metodo non supportato." }, 405);
  const missing = missingConfig(env);
  if (missing.length) return json({ error: `Variabili mancanti: ${missing.join(", ")}` }, 503);
  let body;
  try { body = await request.json(); } catch { return json({ error: "Corpo della richiesta non valido." }, 400); }
  try {
    if (request.method === "DELETE") {
      const endpoint = str(body?.endpoint, 1000);
      if (!endpoint) return json({ error: "Endpoint mancante." }, 400);
      await supabaseRpc(env, "unsubscribe_push", { p_endpoint: endpoint });
      return json({ ok: true });
    }
    const sub = body?.subscription, endpoint = str(sub?.endpoint, 1000), p256dh = str(sub?.keys?.p256dh, 200), auth = str(sub?.keys?.auth, 100);
    if (!endpoint?.startsWith("https://") || !p256dh || !auth) return json({ error: "Sottoscrizione non valida." }, 400);
    if (!Array.isArray(body?.plays) || body.plays.length > 300) return json({ error: "Elenco giocate non valido." }, 400);
    const now = Date.now(), seen = new Set(), picks = [];
    for (const p of body.plays) {
      const sport = p?.sport, ref = str(p?.ref, 120), selection = str(String(p?.selection ?? ""), 20), kickoff = Date.parse(p?.kickoff);
      if (!SEL[sport]?.test(selection ?? "") || !ref || !Number.isFinite(kickoff) || kickoff < now - 3 * 3600e3 || seen.has(`${sport}:${ref}`)) continue;
      seen.add(`${sport}:${ref}`);
      picks.push({ sport, ref, selection, label: str(p.label, 120), home: str(p.home, 80), away: str(p.away, 80), kickoff: new Date(kickoff).toISOString() });
    }
    const res = await supabaseRpc(env, "sync_saved_picks", { p_endpoint: endpoint, p_p256dh: p256dh, p_auth: auth, p_ua: request.headers.get("user-agent") ?? "", p_picks: picks });
    return json({ ok: true, ...(res ?? {}) });
  } catch (error) {
    return json({ error: errorMessage(error) }, 502);
  }
}
