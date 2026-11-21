/**
 * LIVE OBSERVATION — lettura paginata dello storico COMPLETO (sola lettura, nessuna scrittura).
 * Pagine a cursore su (first_starts_at DESC, match_key DESC): stabile anche con molte partite nello stesso istante e con righe aggiunte durante la lettura;
 * costo per pagina indipendente dalla dimensione della tabella (indice composto). Nessun troncamento silenzioso: ogni pagina dichiara `nextCursor`
 * (null = finito) e il totale esatto; ogni lettura interna che esaurisce il tetto di pagine con una pagina ancora piena lancia un errore invece di tacere.
 * Le revisioni sono lette per le sole partite della pagina e sono TUTTE (nessun limite per partita).
 */
export const PAGE = { def: 100, max: 200, keyChunk: 40, versionPages: 20 };
const clampInt = (v, d, lo, hi) => (v == null || v === "" || !Number.isFinite(Number(v)) ? d : Math.max(lo, Math.min(hi, Math.floor(Number(v)))));
const isIso = (v) => typeof v === "string" && Number.isFinite(Date.parse(v));

export const encodeCursor = (o) => `${o.first_starts_at}|${o.match_key}`;
export function decodeCursor(c) {
  if (c == null || c === "") return null;
  const i = String(c).indexOf("|"); if (i < 1) throw Object.assign(new Error("cursore non valido"), { status: 400 });
  const ts = c.slice(0, i), key = c.slice(i + 1);
  if (!isIso(ts) || !key) throw Object.assign(new Error("cursore non valido"), { status: 400 });
  return { ts, key };
}
export function parseParams(sp) {
  const from = sp.get("from"), to = sp.get("to"); if ((from && !isIso(from)) || (to && !isIso(to))) throw Object.assign(new Error("date non valide"), { status: 400 });
  return { limit: clampInt(sp.get("limit"), PAGE.def, 1, PAGE.max), cursor: decodeCursor(sp.get("before")), from: from || null, to: to || null, key: sp.get("key") || null };
}
const quote = (k) => `"${String(k).split('\\').join('\\\\').split('"').join('\\"')}"`;
export const inList = (ks) => `in.(${ks.map(quote).join(",")})`;

function headers(env, extra = {}) { return { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json", ...extra }; }
async function get(env, f, table, query, extra) {
  const url = new URL(`/rest/v1/${table}`, env.SUPABASE_URL); for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
  const res = await f(url, { headers: headers(env, extra) });
  if (!res.ok) throw new Error(`Supabase ${table}: HTTP ${res.status} ${(await res.text()).slice(0, 160)}`);
  return res;
}
/** Legge TUTTE le righe di una query; se esaurisce maxPages con l'ultima pagina piena lancia (mai troncamento silenzioso). */
export async function getAllStrict(env, f, table, query, pageSize = 1000, maxPages = PAGE.versionPages) {
  const out = [];
  for (let p = 0; p < maxPages; p++) { const rows = await (await get(env, f, table, { ...query, limit: pageSize, offset: p * pageSize })).json(); out.push(...rows); if (rows.length < pageSize) return out; }
  throw new Error(`lettura di ${table} oltre il tetto di ${maxPages * pageSize} righe: risultato incompleto, non restituito`);
}

export async function loadObservationPage(env, params, f = fetch) {
  const base = { select: "*", order: "first_starts_at.desc,match_key.desc" }, filt = {};
  if (params.key) filt.match_key = `eq.${params.key}`;
  const range = []; if (params.from) range.push(`first_starts_at.gte.${params.from}`); if (params.to) range.push(`first_starts_at.lte.${params.to}`);
  // Più condizioni sulla stessa colonna: si usa and=(…); il cursore usa or=(…).
  if (range.length) filt.and = `(${range.join(",")})`;
  if (params.cursor) filt.or = `(first_starts_at.lt.${params.cursor.ts},and(first_starts_at.eq.${params.cursor.ts},match_key.lt.${quote(params.cursor.key)}))`;
  const rows = await (await get(env, f, "tennis_observation_results", { ...base, ...filt, limit: params.limit + 1 })).json(); // +1: si sa se esiste una pagina successiva senza contare
  const hasMore = rows.length > params.limit, observations = rows.slice(0, params.limit);
  const nextCursor = hasMore ? encodeCursor(observations.at(-1)) : null;
  // Totale esatto (stesso filtro, senza cursore), solo sulla prima pagina: costa una richiesta, non cresce con la pagina.
  let total = null;
  if (!params.cursor) {
    const cf = { ...filt }; delete cf.or;
    const res = await get(env, f, "tennis_observation_results", { select: "match_key", ...cf, limit: 1 }, { prefer: "count=exact", range: "0-0" });
    const m = /\/(\d+)$/.exec(res.headers.get("content-range") ?? ""); total = m ? Number(m[1]) : null;
  }
  const versions = [];
  for (let i = 0; i < observations.length; i += PAGE.keyChunk) {
    const keys = observations.slice(i, i + PAGE.keyChunk).map((o) => o.match_key);
    versions.push(...(await getAllStrict(env, f, "tennis_observation_versions", { select: "*", match_key: inList(keys), order: "match_key.asc,rev.asc" })));
  }
  return { observations, versions, nextCursor, complete: nextCursor === null, total, limit: params.limit };
}
