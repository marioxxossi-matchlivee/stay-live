import { errorMessage, json } from "./_lib.js";
import { SOURCES, fetchHtml, resolveUrl } from "./_scrape.js";
import { PARSERS } from "./_sources.js";

/**
 * GET /api/scrape-debug?source=transfermarkt&league=seriea   (header x-sync-secret = SYNC_SECRET)
 * Scarica la pagina e mostra cosa riconoscono i parser, SENZA scrivere nulla su Supabase.
 * Serve a controllare in 1 minuto, dalla produzione, se la fonte risponde o blocca e se il layout è ancora quello atteso:
 *   curl -H "x-sync-secret: $SYNC_SECRET" "https://<tuo-sito>/api/scrape-debug?source=lineups&league=seriea"
 */
export async function onRequest({ request, env }) {
  if (!env.SYNC_SECRET || request.headers.get("x-sync-secret") !== env.SYNC_SECRET) return json({ error: "Non autorizzato." }, 401);
  const url = new URL(request.url);
  const source = url.searchParams.get("source") ?? "";
  const league = url.searchParams.get("league") ?? "";
  if (!SOURCES[source]?.leagues[league]) return json({ error: "source/league non validi.", available: Object.fromEntries(Object.entries(SOURCES).map(([k, d]) => [k, Object.keys(d.leagues)])) }, 400);
  const started = Date.now();
  try {
    const target = await resolveUrl(env, source, league);
    const { status, html } = await fetchHtml(target);
    const parsed = PARSERS[source](html);
    return json({
      ok: parsed.length > 0, url: target, status, bytes: html.length, ms: Date.now() - started,
      head: html.slice(0, 300), parsedCount: parsed.length,
      teams: [...new Set(parsed.map((p) => p.team))], sample: parsed.slice(0, 5),
      hint: parsed.length ? null : "Nessun dato riconosciuto: se `bytes` è piccolo la pagina è probabilmente una sfida anti-bot o caricata via JavaScript; altrimenti il layout è cambiato e va aggiornato il parser in _sources.js.",
    });
  } catch (error) {
    return json({ ok: false, error: errorMessage(error), blocked: Boolean(error?.blocked), status: error?.status ?? null, ms: Date.now() - started });
  }
}
