/**
 * Copia pronta di una risposta JSON nella cache del data center Cloudflare (Cache API), con "serve la vecchia e rinnova in secondo piano".
 *
 * Perché: /api/fixtures analizza centinaia di partite (200–600 ms di CPU a freddo) e il piano Workers Free concede 10 ms di CPU a richiesta:
 * oltre, Cloudflare risponde "Error 1102 Worker exceeded resource limits". Con la copia pronta quasi tutte le aperture costano pochi
 * millisecondi; il ricalcolo pesante avviene al massimo una volta ogni `freshMs`, dietro le quinte (waitUntil), e se fallisce chi apre l'app
 * riceve comunque l'ultima copia buona.
 *
 *  - copia più giovane di freshMs: servita subito;
 *  - fra freshMs e maxStaleMs: servita subito (X-Cache: stale) e rinnovata in secondo piano;
 *  - più vecchia di maxStaleMs, assente o `bypass`: si ricalcola e si risponde con il dato nuovo (X-Cache: miss);
 *  - solo le risposte 200 vengono memorizzate (gli errori no).
 */
const inflight = new Map();     // un solo ricalcolo alla volta per istanza e per chiave

const asClientResponse = (hit, state) => new Response(hit.body, {
  status: 200,
  headers: {
    "content-type": hit.headers.get("content-type") ?? "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "x-cache": state,
    "x-built-at": hit.headers.get("x-built-at") ?? "",
  },
});

export async function edgeCached({ cache, keyUrl, waitUntil, build, freshMs = 60e3, maxStaleMs = 30 * 60e3, bypass = false, now = Date.now }) {
  if (!cache) return build();
  const key = new Request(keyUrl);

  // Il ricalcolo restituisce dati semplici (testo + stato), non un Response: più richieste che lo condividono ne costruiscono ciascuna uno proprio.
  const rebuild = () => {
    if (inflight.has(keyUrl)) return inflight.get(keyUrl);
    const p = (async () => {
      const res = await build();
      const body = await res.text();
      const type = res.headers.get("content-type") ?? "application/json; charset=utf-8";
      const builtAt = String(now());
      if (res.status === 200) await cache.put(key, new Response(body, { status: 200, headers: { "content-type": type, "cache-control": "public, max-age=3600", "x-built-at": builtAt } })).catch(() => {});
      return { status: res.status, body, type, builtAt };
    })();
    inflight.set(keyUrl, p);
    const clear = () => { if (inflight.get(keyUrl) === p) inflight.delete(keyUrl); };
    p.then(clear, clear);
    return p;
  };
  const fromBuilt = (r) => new Response(r.body, { status: r.status, headers: { "content-type": r.type, "cache-control": "no-store", "x-content-type-options": "nosniff", "x-cache": "miss", "x-built-at": r.builtAt } });

  if (!bypass) {
    const hit = await cache.match(key).catch(() => null);
    if (hit) {
      const age = now() - Number(hit.headers.get("x-built-at"));
      if (Number.isFinite(age) && age >= 0 && age < maxStaleMs) {
        if (age >= freshMs) { const job = rebuild().catch(() => {}); waitUntil?.(job); }
        return asClientResponse(hit, age >= freshMs ? "stale" : "hit");
      }
    }
  }
  return fromBuilt(await rebuild());
}
