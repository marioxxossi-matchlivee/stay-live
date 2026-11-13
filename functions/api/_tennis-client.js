/**
 * Stay Live Tennis — client di SportsAPI365 Direct. SOLO lato server (script di GitHub Actions): la chiave sta in X-Gravitee-Api-Key,
 * non finisce mai in URL, log, errori o risposte. Gestisce timeout, nuovi tentativi con attesa progressiva, limite di richieste,
 * quota residua (intestazioni x-quota-*), paginazione e un tetto di richieste per giro. Nessuna dipendenza dal calcio.
 */
export const DIRECT_BASE = "https://api.sportsapi365.com/v1/tennis";

export class TennisApiError extends Error {
  constructor(message, { status = 0, path = "", retryable = false, code = "" } = {}) { super(message); this.name = "TennisApiError"; this.status = status; this.path = path; this.retryable = retryable; this.code = code; }
}
const redact = (text, key) => (key ? String(text).split(key).join("***") : String(text));
const sleepReal = (ms) => new Promise((r) => setTimeout(r, ms));

export function createClient({ key, base = DIRECT_BASE, fetchImpl = fetch, sleep = sleepReal, now = Date.now, timeoutMs = 20000, retries = 2, minGapMs = 220, maxRequests = Infinity } = {}) {
  if (!key) throw new TennisApiError("Manca TENNIS_API_KEY");
  const root = String(base).replace(/\/+$/, "");
  const stats = { requests: 0, errors: 0, byPath: {}, quota: { limit: null, remaining: null, resetAt: null }, rate: { limit: null, remaining: null }, lastAt: null, lastOkAt: null, lastError: null };
  let lastCall = 0;

  const bucket = (path) => path.split("?")[0].replace(/\/\d{4}-\d{2}-\d{2}$/, "/{data}").replace(/\/\d+$/, "/{id}");
  const readHeaders = (h) => {
    const g = (n) => { const v = h.get?.(n); const x = Number(v); return v != null && Number.isFinite(x) ? x : null; };
    const ql = g("x-quota-limit"), qr = g("x-quota-remaining"), qs = g("x-quota-reset"), rl = g("x-ratelimit-limit"), rr = g("x-ratelimit-remaining");
    if (ql !== null) stats.quota.limit = ql; if (qr !== null) stats.quota.remaining = qr; if (qs !== null) stats.quota.resetAt = new Date(qs).toISOString();
    if (rl !== null) stats.rate.limit = rl; if (rr !== null) stats.rate.remaining = rr;
  };

  /** GET con nuovi tentativi su 429/5xx/rete/timeout. 4xx diversi da 429 NON si ritentano (sono errori della richiesta o del piano). */
  async function get(path) {
    if (!String(path).startsWith("/") || /\s|\.\.|:\/\//.test(path)) throw new TennisApiError(`Percorso non valido: ${path}`, { path });
    let last;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (stats.requests >= maxRequests) throw new TennisApiError(`Tetto di ${maxRequests} richieste per giro raggiunto`, { path, code: "cap" });
      const wait = minGapMs - (now() - lastCall); if (wait > 0) await sleep(wait);
      if (stats.rate.remaining !== null && stats.rate.remaining <= 2) await sleep(1500); // vicini al limite al minuto: si rallenta
      lastCall = now(); stats.requests++; stats.lastAt = new Date(now()).toISOString();
      const b = bucket(path); (stats.byPath[b] ??= { requests: 0, errors: 0 }).requests++;
      const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), timeoutMs);
      try {
        const res = await fetchImpl(`${root}${path}`, { headers: { "X-Gravitee-Api-Key": key, Accept: "application/json" }, signal: ctl.signal });
        readHeaders(res.headers);
        const text = await res.text();
        if (res.status === 429 || res.status >= 500) {
          const ra = Number(res.headers.get?.("retry-after"));
          last = new TennisApiError(`HTTP ${res.status}`, { status: res.status, path, retryable: true });
          stats.errors++; stats.byPath[b].errors++; stats.lastError = `${path} → HTTP ${res.status}`;
          if (attempt < retries) { await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 15000) : 800 * 2 ** attempt); continue; }
          throw last;
        }
        if (!res.ok) {
          stats.errors++; stats.byPath[b].errors++; stats.lastError = `${path} → HTTP ${res.status}`;
          throw new TennisApiError(`HTTP ${res.status}: ${redact(text.slice(0, 160), key)}`, { status: res.status, path });
        }
        let body; try { body = JSON.parse(text); } catch { throw new TennisApiError("Risposta non JSON", { status: res.status, path }); }
        stats.lastOkAt = new Date(now()).toISOString();
        return body;
      } catch (e) {
        if (e instanceof TennisApiError) { if (!e.retryable || attempt >= retries) throw e; last = e; continue; }
        const msg = e?.name === "AbortError" ? "timeout" : redact(e?.message ?? "errore di rete", key);
        last = new TennisApiError(msg, { path, retryable: true }); stats.errors++; stats.byPath[b].errors++; stats.lastError = `${path} → ${msg}`;
        if (attempt < retries) { await sleep(800 * 2 ** attempt); continue; }
        throw last;
      } finally { clearTimeout(timer); }
    }
    throw last;
  }

  /**
   * Scorre tutte le pagine (pageNo) finché hasNextPage è vero. Difese: massimo `maxPages`; se la pagina successiva ripete gli stessi
   * elementi della precedente (il provider ignora il parametro) ci si ferma e si segnala. `readPage` è l'estrattore del provider.
   */
  async function paginate(pathFor, readPage, { maxPages = 12, idOf = (x) => x?.id ?? x?.matchId } = {}) {
    const items = []; const warnings = []; let prevFirst = null;
    for (let page = 1; page <= maxPages; page++) {
      let body;
      try { body = await get(pathFor(page)); }
      catch (e) {
        // Tetto di richieste raggiunto: NON è un errore del giro. Si tiene ciò che è già stato letto e si segnala (capped).
        if (e instanceof TennisApiError && e.code === "cap") return { items, warnings: [...warnings, `Tetto di richieste raggiunto alla pagina ${page}: letto solo in parte`], complete: false, capped: true };
        throw e;
      }
      const r = readPage(body);
      if (r.problem) { if (page === 1) warnings.push(r.problem); break; }
      const first = r.items.length ? String(idOf(r.items[0])) : null;
      if (page > 1 && first !== null && first === prevFirst) { warnings.push("La pagina successiva ripete la precedente: paginazione non supportata, si usa solo ciò che è stato letto."); break; }
      items.push(...r.items); prevFirst = first;
      if (!r.hasNext || !r.items.length) return { items, warnings, complete: true };
    }
    return { items, warnings: [...warnings, `Fermato dopo ${maxPages} pagine`], complete: false };
  }

  return { get, paginate, stats, redact: (t) => redact(t, key) };
}
