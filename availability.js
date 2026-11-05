import { errorMessage, json, missingConfig, supabaseGet, supabaseUpsert } from "./_lib.js";
import { MAX_JOBS_PER_CALL, SOURCES, ScrapeError, WINDOW_MS, backoffMs, buildRows, coverageOf, fetchHtml, planJobs, resolveUrl } from "./_scrape.js";
import { PARSERS } from "./_sources.js";

const MATCH_COLS = "game_id,league,kickoff_at,status,home_name,away_name";

/** Scarica UNA fonte per UN campionato e aggiorna tutte le partite in finestra. Non lancia mai: registra l'esito in scrape_state. */
async function runJob(env, job, state, now) {
  const { source, league } = job;
  const at = (ms) => new Date(ms).toISOString();
  try {
    // "claim": segna il tentativo e blocca 90 s, così due richieste simultanee non scaricano la stessa pagina due volte.
    await supabaseUpsert(env, "scrape_state", [{ source, league, attempted_at: at(now), blocked_until: at(now + 90e3) }], "source,league");
    const url = await resolveUrl(env, source, league, now);
    const { status, html } = await fetchHtml(url);
    const parsed = PARSERS[source](html);
    if (!parsed.length) throw new ScrapeError("Nessun dato riconosciuto: layout cambiato o pagina caricata via JavaScript.", { status });
    const matches = await supabaseGet(env, "matches", {
      select: MATCH_COLS, league: `eq.${league}`, status: "eq.scheduled",
      and: `(kickoff_at.gte.${at(now)},kickoff_at.lte.${at(now + WINDOW_MS)})`, limit: 60,
    });
    const ids = matches.map((m) => `"${m.game_id}"`).join(",");
    const existing = new Map((matches.length ? await supabaseGet(env, "match_availability", { select: "game_id,sources", game_id: `in.(${ids})`, limit: 60 }) : []).map((r) => [r.game_id, r]));
    const rows = buildRows({ source, parsed, matches, existing, now });
    if (rows.length) await supabaseUpsert(env, "match_availability", rows, "game_id");
    await supabaseUpsert(env, "scrape_state", [{ source, league, scraped_at: at(now), attempted_at: at(now), last_error: null, last_status: status, fail_count: 0, blocked_until: null, items_count: parsed.length }], "source,league");
    return { ...job, ok: true, items: parsed.length, matches: rows.length };
  } catch (error) {
    const fails = (state?.fail_count ?? 0) + 1;
    console.error(`Stay Live scrape ${source}/${league}:`, errorMessage(error));
    // Non si tocca scraped_at: i dati precedenti restano in cache (con la loro data) e l'app continua a funzionare.
    await supabaseUpsert(env, "scrape_state", [{ source, league, attempted_at: at(now), last_error: errorMessage(error).slice(0, 300), last_status: error?.status ?? null, fail_count: fails, blocked_until: at(now + backoffMs(fails)) }], "source,league").catch(() => {});
    return { ...job, ok: false, error: errorMessage(error), blocked: Boolean(error?.blocked) };
  }
}

const shape = (row, health) => ({
  injuries: row?.injuries ?? { home: [], away: [] },
  suspensions: row?.suspensions ?? { home: [], away: [] },
  probableLineups: row?.probable_lineups ?? { home: null, away: null },
  lastScrapedAt: row?.last_scraped_at ?? null,
  coverage: coverageOf(row),
  sources: Object.fromEntries(Object.entries(row?.sources ?? {}).map(([k, s]) => [k, { ok: s.ok, at: s.at, count: s.count }])),
  health,
});

/**
 * GET /api/availability?ids=a,b,c[&wait=1]
 * Legge dalla cache Supabase e, SOLO per partite entro 48 ore con TTL scaduto (60 min, 30 min nelle ultime 24 h),
 * riscarica le fonti: in background (risposta subito, dati freschi alla richiesta successiva) oppure aspettando con wait=1.
 * Non risponde mai con un errore per colpa di una fonte: `health` dice cosa non funziona e l'app usa il modello standard.
 */
export async function onRequest({ request, env, waitUntil }) {
  const url = new URL(request.url);
  const ids = [...new Set((url.searchParams.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean))];
  if (!ids.length || ids.length > 40 || !ids.every((id) => /^[\w-]{3,80}$/.test(id))) return json({ error: "Seleziona da 1 a 40 partite." }, 400);
  const missing = missingConfig(env);
  if (missing.length) return json({ error: `Variabili mancanti su Cloudflare: ${missing.join(", ")}` }, 503);
  try {
    const now = Date.now();
    const inList = `in.(${ids.map((i) => `"${i}"`).join(",")})`;
    const [matches, states] = await Promise.all([
      supabaseGet(env, "matches", { select: MATCH_COLS, game_id: inList, limit: 40 }),
      supabaseGet(env, "scrape_state", { select: "*" }),
    ]);
    const jobs = planJobs(matches, states, now).slice(0, MAX_JOBS_PER_CALL);
    const run = Promise.all(jobs.map((j) => runJob(env, j, states.find((s) => s.source === j.source && s.league === j.league), now)));
    let results = [];
    if (jobs.length && url.searchParams.get("wait") === "1") results = await run;
    else if (jobs.length) waitUntil?.(run);
    const [rows, freshStates] = await Promise.all([
      supabaseGet(env, "match_availability", { select: "*", game_id: inList, limit: 40 }),
      results.length ? supabaseGet(env, "scrape_state", { select: "*" }) : states,
    ]);
    const byId = new Map(rows.map((r) => [r.game_id, r]));
    const items = {};
    for (const m of matches) {
      const health = Object.entries(SOURCES).filter(([, d]) => d.leagues[m.league]).map(([source, d]) => {
        const s = freshStates.find((x) => x.source === source && x.league === m.league);
        return { source, label: d.label, ok: !s?.last_error, error: s?.last_error ?? null, blockedUntil: s?.blocked_until && Date.parse(s.blocked_until) > now ? s.blocked_until : null, scrapedAt: s?.scraped_at ?? null };
      });
      items[m.game_id] = shape(byId.get(m.game_id), health);
    }
    return json({ generatedAt: new Date(now).toISOString(), refreshing: jobs.map((j) => `${j.source}/${j.league}`), items });
  } catch (error) {
    // Anche qui: niente 5xx "duri" per l'interfaccia, ma risposta esplicita che i dati qualitativi non ci sono.
    console.error("Stay Live availability:", errorMessage(error));
    return json({ error: errorMessage(error), items: {} }, 502);
  }
}
