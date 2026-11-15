import { errorMessage, json, missingConfig, supabaseGet } from "./_lib.js";

/**
 * GET /api/usage
 * Crediti API-Football: richieste fatte oggi, limite giornaliero del piano e residuo comunicato dal provider.
 * Una sola lettura leggera di `af_usage` (la riga di oggi; se non c'è ancora, l'ultima nota con il residuo azzerato al limite).
 * Nessuna chiamata a API-Football: non consuma crediti.
 */
export function usageFrom(today, last, now = Date.now()) {
  const day = new Date(now).toISOString().slice(0, 10);
  if (today) {
    return { day: today.day ?? day, requests: today.requests ?? 0, limit: today.limit_day ?? null, remaining: today.remaining ?? null, updatedAt: today.updated_at ?? null, assumed: false };
  }
  // Prima richiesta del giorno non ancora registrata: i crediti si azzerano alla mezzanotte UTC, quindi il residuo coincide con il limite.
  if (last?.limit_day) return { day, requests: 0, limit: last.limit_day, remaining: last.limit_day, updatedAt: last.updated_at ?? null, assumed: true };
  return { day, requests: null, limit: null, remaining: null, updatedAt: null, assumed: false };
}

export async function onRequest({ env }) {
  const missing = missingConfig(env);
  if (missing.length) return json({ error: `Variabili mancanti: ${missing.join(", ")}` }, 503);
  try {
    const now = Date.now(), d = new Date(now), day = d.toISOString().slice(0, 10);
    const [todayRows, lastRows] = await Promise.all([
      supabaseGet(env, "af_usage", { select: "*", day: `eq.${day}`, limit: 1 }),
      supabaseGet(env, "af_usage", { select: "*", order: "day.desc", limit: 1 }),
    ]);
    const resetsAt = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1)).toISOString();
    return json({ ...usageFrom(todayRows[0], lastRows[0], now), resetsAt }, 200, { "cache-control": "public, max-age=20" });
  } catch (error) {
    console.error("Stay Live usage:", errorMessage(error));
    return json({ error: errorMessage(error) }, 502);
  }
}
