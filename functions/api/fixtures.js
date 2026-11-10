import {
  CONTINENTS, LEAGUES, SEASON, errorMessage, isActiveLeague, json, loadFinals, missingConfig, supabaseGet, supabaseGetAll, syncDue,
} from "./_lib.js";
import { analyzeMatch, buildContext, compactPick, ou25Of } from "./model.js";
import { loadCornerOdds } from "./_corners.js";
import { loadLogoIndex, needsTeamList, withLogos } from "./_crests.js";
import { loadBrainInputs } from "./_brain.js";
import { edgeCached } from "./_edgecache.js";
import { buildCornerContext, cornerModel, loadCornerRows } from "./_cornerstats.js";

/**
 * Memoria dell'isolate Cloudflare: il consiglio rapido di una partita dipende solo da storico, dati API-Football e dalla partita stessa.
 * Se nulla è cambiato (stessa firma) si riusa il risultato invece di rifare i calcoli: le aperture successive costano quasi zero CPU.
 */
const MEMO = new Map();
const CTX = { sig: "", ctx: null };      // anche il contesto (medie e forza delle squadre da ~3.800 partite) si ricostruisce solo quando lo storico cambia
const finalsSignature = (finals) => { let last = "", goals = 0; for (const f of finals) { if (f.kickoff_at > last) last = f.kickoff_at; goals += (f.home_score ?? 0) * 7 + (f.away_score ?? 0); } return `${finals.length}|${last}|${goals}`; };

const COLUMNS = "game_id,league,round,kickoff_at,status,home_id,home_name,away_id,away_name,home_score,away_score,neutral_site";

/**
 * GET /api/fixtures: partite da 36 ore fa a 21 giorni avanti (variabile FIXTURES_DAYS, 3-30), con il consiglio rapido (BET / EVITA).
 * La risposta resta pronta 60 secondi nella cache del data center (poi si rinnova in secondo piano, vedi _edgecache.js): così l'analisi
 * pesante non pesa su ogni apertura e non supera il limite di CPU di Cloudflare. `?fresh=1` salta la copia (aggiorna a mano, dopo la sincronizzazione).
 */
export async function onRequest(ctx) {
  const url = new URL(ctx.request.url);
  return edgeCached({
    cache: globalThis.caches?.default,
    keyUrl: `${url.origin}/api/fixtures`,
    waitUntil: ctx.waitUntil ? (p) => ctx.waitUntil(p) : undefined,
    bypass: url.searchParams.has("fresh"),
    build: () => fixturesResponse(ctx.env),
  });
}

async function fixturesResponse(env) {
  const r = await buildFixtures(env);
  return r.ok ? json(r.payload) : json({ error: r.error }, r.status);
}

/**
 * Elenco partite con consiglio rapido, corner e stato dei campionati, costruito SOLO dai dati già in cache (nessuna richiesta al provider).
 * Lo usano /api/fixtures (calcolo al volo, soluzione di ripiego) e il giro completo ogni 4 ore (scripts/full-refresh.js), che lo salva
 * già pronto su Supabase: l'app lo legge da /api/board senza nessun calcolo.
 */
export async function buildFixtures(env) {
  const days = Math.min(30, Math.max(3, Number(env.FIXTURES_DAYS) || 7));
  const missing = missingConfig(env);
  if (missing.length) return { ok: false, status: 503, error: `Variabili mancanti: ${missing.join(", ")}` };
  try {
    const now = Date.now();
    const from = new Date(now - 36 * 3600e3).toISOString();
    const to = new Date(now + days * 86400e3).toISOString();
    const [window, finals, states, logos] = await Promise.all([
      supabaseGetAll(env, "matches", { select: COLUMNS, season: `eq.${SEASON}`, and: `(kickoff_at.gte.${from},kickoff_at.lte.${to})`, order: "kickoff_at.asc,game_id.asc" }),
      loadFinals(env),
      supabaseGet(env, "sync_state", { select: "*" }),
      loadLogoIndex(env),
    ]);
    const sig = finalsSignature(finals);
    if (CTX.sig !== sig) { CTX.ctx = buildContext(finals); CTX.sig = sig; MEMO.clear(); }
    const ctx = CTX.ctx;
    // Pronostici di API-Football già in cache per le partite dei prossimi giorni (nessuna richiesta al provider da qui): il consiglio rapido ne tiene conto.
    const soon = window.filter((m) => (m.status === "scheduled" || m.status === "in_progress") && Date.parse(m.kickoff_at) < now + 3 * 86400e3);
    const br = env.API_FOOTBALL_KEY && soon.length ? await loadBrainInputs(env, soon, now, { live: false }).catch(() => null) : null;
    // Corner: quelli cercati ogni notte per tutte le partite della settimana, già in cache (nessuna richiesta al provider da qui).
    const week = window.filter((m) => (m.status === "scheduled" || m.status === "in_progress") && Date.parse(m.kickoff_at) < now + 7 * 86400e3);
    const cr = env.API_FOOTBALL_KEY && week.length ? await loadCornerOdds(env, week, now, { live: false, maps: br?.maps }).catch(() => null) : null;
    // Modello statistico dei corner (corner reali storici in match_corners): se la tabella manca o è vuota, nessun modello (mai dati inventati).
    const cctx = await loadCornerRows(env).then(buildCornerContext).catch(() => null);
    const byLeague = Object.fromEntries(states.map((s) => [s.league, s]));
    const matches = window.map((m) => {
      const open = m.status === "scheduled" || m.status === "in_progress";
      let pick = null, ou = null;
      if (open) {
        const extra = br?.byGame.get(m.game_id) ?? null;
        const key = `${sig}|${m.game_id}|${m.kickoff_at}|${m.status}|${extra ? JSON.stringify(extra) : ""}`;
        let hit = MEMO.get(key);
        if (!hit) { const analysis = analyzeMatch(m, ctx, { n: 8, ...(extra ?? {}) }); hit = { pick: compactPick(analysis), ou: ou25Of(analysis) }; if (MEMO.size > 3000) MEMO.clear(); MEMO.set(key, hit); }
        ({ pick, ou } = hit);
      }
      return {
        id: m.game_id, league: m.league, round: m.round, kickoffAt: m.kickoff_at, status: m.status,
        home: m.home_name, away: m.away_name, ...withLogos(m, logos), homeScore: m.home_score, awayScore: m.away_score,
        pick,
        ou,                                                                       // modalità personalizzata: Over/Under 2,5
        corner: cr?.byGame.get(m.game_id) ?? null,                                // corner (quote di API-Football), solo se già scaricati
        cornerModel: open && cctx && Date.parse(m.kickoff_at) < now + 7 * 86400e3 ? cornerModel(cctx, { league: m.league, kickoff_at: m.kickoff_at, home_id: m.home_id, away_id: m.away_id }) : null,   // modello Stay Live sui corner storici reali (distinto dalle quote)
      };
    });
    return { ok: true, payload: {
      updatedAt: new Date(now).toISOString(),
      historyMatches: ctx.matchCount,
      continents: CONTINENTS,
      leagues: LEAGUES.map((l) => ({ ...l, syncedAt: byLeague[l.id]?.synced_at ?? null, count: byLeague[l.id]?.matches_count ?? 0, error: byLeague[l.id]?.last_error ?? null })),
      needsCrests: LEAGUES.filter((l) => needsTeamList(l.id) && !logos.has(l.afId) && window.some((m) => m.league === l.id)).map((l) => l.id),   // campionati con partite ma senza scudetti in cache
      needsSync: LEAGUES.filter((l) => syncDue(byLeague[l.id], isActiveLeague(window, l.id, now), now)).map((l) => l.id),
      matches,
    } };
  } catch (error) {
    console.error("Stay Live fixtures:", errorMessage(error));
    return { ok: false, status: 502, error: `Impossibile leggere i dati da Supabase: ${errorMessage(error)}. Hai applicato la migrazione 202610290002?` };
  }
}
