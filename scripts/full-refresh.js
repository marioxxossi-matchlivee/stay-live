#!/usr/bin/env node
/**
 * Giro completo ogni 4 ore (GitHub Actions: .github/workflows/aggiornamento-completo.yml).
 *
 * Perché qui e non su Cloudflare: il piano Free concede 10 ms di CPU a richiesta, mentre scaricare e analizzare tutte le partite
 * richiede minuti. Qui non c'è quel limite: lo script riusa lo STESSO codice delle API (functions/api/*), lo esegue in Node e salva
 * il risultato già pronto su Supabase (tabella app_snapshot). L'app lo legge da /api/board: apertura istantanea, zero calcolo.
 *
 * Fasi: 1 campionati (risultati e stati) · 2 scudetti · 3 pronostici, quote Over/Under e 1X2, corner di tutte le partite della settimana
 *       · 4 schede dati (infortuni, formazioni, classifica, scontri diretti…) delle partite nelle prossime 48 ore
 *       · 5 istantanea + rapporto (+ registro dei pronostici per le statistiche, come il vecchio workflow "Registra i pronostici").
 * Crediti API-Football: si scaricano solo i dati più vecchi di FRESH_NEAR (partite entro 48 ore) o FRESH_FAR (più lontane);
 * sotto la riserva di crediti giornalieri le fasi facoltative si fermano (esito "parziale").
 *
 * Variabili (secrets di GitHub): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, API_FOOTBALL_KEY, API_NINJAS_KEY; facoltative: FIXTURES_DAYS (7).
 */
import { LEAGUES, SEASON, supabaseGet, supabaseGetAll, supabaseUpsert } from "../functions/api/_lib.js";
import { AF_LEAGUES, betIdsFrom, dayKey, loadSections, planFor, ttlFor } from "../functions/api/_apifootball.js";
import { loadBrainInputs } from "../functions/api/_brain.js";
import { loadCornerOdds } from "../functions/api/_corners.js";
import { needsTeamList } from "../functions/api/_crests.js";
import { buildFixtures } from "../functions/api/fixtures.js";
import { onRequest as syncLeague } from "../functions/api/sync.js";
import { onRequest as crestsLeague } from "../functions/api/crests.js";
import { onRequest as snapshotPredictions } from "../functions/api/snapshot.js";

const H = 3600e3;
export const FRESH_NEAR = 3.5 * H, FRESH_FAR = 11 * H;           // età massima accettata a ogni giro (cadenza 4 ore)
export const NEAR_MS = 48 * H;                                   // "vicine": quote e schede si riscaricano a ogni giro
export const RESERVE_FOR_DETAILS = 1500;                         // sotto questi crediti restanti si salta la fase 4
const RATE_RE = /limite|richieste|too many|rate/i;
const VOLATILE = new Set(["fixture", "injuries", "predictions", "oddsGoals", "oddsCorners", "odds1x2"]);

/** Quanto vecchio può essere un dato di questa partita (ms): 3,5 ore se si gioca entro 48 ore, 11 ore altrimenti. */
export const freshForAt = (now) => (m) => (Date.parse(m.kickoff_at) - now <= NEAR_MS ? FRESH_NEAR : FRESH_FAR);

/** Partite aperte (non finite) dei prossimi `days` giorni nei campionati coperti da API-Football. */
export function eligibleOpen(window, now, days = 7) {
  return window.filter((m) => (m.status === "scheduled" || m.status === "in_progress") && Date.parse(m.kickoff_at) < now + days * 86400e3 && AF_LEAGUES[m.league]);
}

/** Conta used / waiting / missing / none per un insieme di partite. */
export function tally(stateMap, ids) {
  const out = { used: 0, none: 0, waiting: 0, missing: 0 };
  for (const id of ids) { const s = stateMap?.get?.(id) ?? "missing"; out[s in out ? s : "missing"] += 1; }
  return out;
}

/** Esito del giro: ok | partial | failed. */
export function statusOf(meta) {
  if (meta.error) return "failed";
  const total = meta.matches.eligible;
  const predOk = total === 0 || meta.prediction.used / total >= 0.9;
  const cornerOk = total === 0 || (meta.corners.used + meta.corners.none) / total >= 0.9;
  if (meta.leagues.failed.length || !predOk || !cornerOk || meta.pending > 0 || meta.budgetStop) return "partial";
  return "ok";
}

export function summaryMarkdown(m) {
  const icon = { ok: "✅", partial: "⚠️", failed: "❌" }[m.status] ?? "•";
  const L = [`## ${icon} Aggiornamento completo: ${m.status === "ok" ? "riuscito" : m.status === "partial" ? "parziale" : "fallito"}`, ""];
  if (m.error) L.push(`**Errore:** ${m.error}`, "");
  L.push(`- Durata: ${Math.round(m.durationSec / 60)} min · partite aperte coperte: ${m.matches.eligible}`);
  L.push(`- Campionati: ${m.leagues.ok}/${m.leagues.total} aggiornati${m.leagues.failed.length ? ` · errori: ${m.leagues.failed.map((f) => `${f.id} (${f.error})`).join("; ")}` : ""}`);
  L.push(`- Pronostici API-Football: ${m.prediction.used}/${m.matches.eligible} · Quote gol/1X2: ${m.market.used}/${m.matches.eligible}`);
  L.push(`- Corner: ${m.corners.used} con quote · ${m.corners.none} senza quote dei bookmaker · ${m.corners.missing + m.corners.waiting} non trovati`);
  L.push(`- Schede dati (prossime 48 ore): ${m.details.matches} partite${m.details.skipped ? " (saltate: crediti sotto la riserva)" : ""}`);
  if (m.registry) L.push(`- Registro pronostici per le statistiche: ${m.registry.stored} righe (${m.registry.bets} BET)`);
  if (m.credits.remaining != null) L.push(`- Crediti API-Football: ${m.credits.used ?? "?"} usati oggi · ${m.credits.remaining} restanti su ${m.credits.limit ?? "?"}`);
  for (const n of m.notes) L.push(`- ${n}`);
  return L.join("\n") + "\n";
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const COLUMNS = "game_id,league,round,kickoff_at,status,home_id,home_name,away_id,away_name,home_score,away_score,neutral_site";

async function readUsage(env, now) {
  try { const [u] = await supabaseGet(env, "af_usage", { select: "*", day: `eq.${dayKey(now)}`, limit: 1 }); return u ?? null; } catch { return null; }
}

/** Fase 1: campionati. API-Football uno alla volta (limite al secondo), API Ninjas tre alla volta; si riprova se il limite è superato. */
export async function syncAll(env, { call = syncLeague, wait = sleep, log = () => {} } = {}) {
  const run = async (cfg) => {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const res = await call({ request: new Request(`https://job.local/api/sync?league=${cfg.id}&force=1`, { headers: { "x-sync-secret": env.SYNC_SECRET } }), env });
      const body = await res.json().catch(() => ({}));
      if (res.ok) return { id: cfg.id, ok: true };
      const msg = String(body.error ?? res.status);
      if (attempt < 3 && RATE_RE.test(msg)) { log(`… ${cfg.id}: ${msg.slice(0, 80)} (attendo)`); await wait(20000 * attempt); continue; }
      return { id: cfg.id, ok: false, error: msg.slice(0, 160) };
    }
  };
  const results = [];
  const viaAf = LEAGUES.filter((l) => l.provider === "apifootball"), viaNinjas = LEAGUES.filter((l) => l.provider !== "apifootball");
  const queue = [...viaNinjas];
  const worker = async () => { while (queue.length) results.push(await run(queue.shift())); };
  await Promise.all([
    (async () => { for (const cfg of viaAf) { results.push(await run(cfg)); await wait(250); } })(),
    ...Array.from({ length: 3 }, worker),
  ]);
  return results;
}

export async function runRefresh(env, { log = console.log, wait = sleep, now0 = Date.now() } = {}) {
  const startedAt = new Date(now0).toISOString();
  const days = Math.min(30, Math.max(3, Number(env.FIXTURES_DAYS) || 7));
  const meta = {
    v: 1, status: "failed", startedAt, finishedAt: null, durationSec: 0, everyHours: 4, windowDays: days, error: null, pending: 0, budgetStop: false,
    leagues: { total: LEAGUES.length, ok: 0, failed: [] }, matches: { window: 0, eligible: 0 },
    prediction: { used: 0, waiting: 0, missing: 0, none: 0 }, market: { used: 0, waiting: 0, missing: 0, none: 0 }, corners: { used: 0, none: 0, waiting: 0, missing: 0 },
    details: { matches: 0, sections: 0, skipped: false }, credits: { used: null, remaining: null, limit: null }, notes: [],
  };
  const usage0 = await readUsage(env, now0);
  try {
    log("1/5 Campionati…");
    const leagueResults = await syncAll(env, { wait, log });
    meta.leagues.ok = leagueResults.filter((r) => r.ok).length;
    meta.leagues.failed = leagueResults.filter((r) => !r.ok).map((r) => ({ id: r.id, name: LEAGUES.find((l) => l.id === r.id)?.name ?? r.id, error: r.error }));
    log(`   ${meta.leagues.ok}/${meta.leagues.total} aggiornati${meta.leagues.failed.length ? `, errori: ${meta.leagues.failed.map((f) => f.id).join(", ")}` : ""}`);

    log("2/5 Scudetti…");
    for (const cfg of LEAGUES.filter((l) => needsTeamList(l.id))) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const res = await crestsLeague({ request: new Request(`https://job.local/api/crests?league=${cfg.id}`), env });
        const body = await res.json().catch(() => ({}));
        if (body.retry?.pending) { await wait(Math.min(60000, body.retry.afterMs || 20000)); continue; }
        break;
      }
    }

    const now = Date.now();
    const from = new Date(now - 36 * H).toISOString(), to = new Date(now + days * 86400e3).toISOString();
    const window = await supabaseGetAll(env, "matches", { select: COLUMNS, season: `eq.${SEASON}`, and: `(kickoff_at.gte.${from},kickoff_at.lte.${to})`, order: "kickoff_at.asc,game_id.asc" });
    const open = eligibleOpen(window, now, days);
    meta.matches = { window: window.length, eligible: open.length };
    const freshFor = freshForAt(now);

    log(`3/5 Pronostici, quote e corner di ${open.length} partite…`);
    let br = null, cr = null, lastPending = Infinity, stalled = 0;
    for (let round = 1; round <= 14; round += 1) {
      const t = Date.now();
      br = await loadBrainInputs(env, open, t, { live: true, maxMap: 25, maxLive: 80, freshFor, maps: br?.maps });
      cr = await loadCornerOdds(env, open, t, { live: true, maxMap: 25, maxLive: 80, freshFor, maps: br.maps });
      const pending = (br.retry?.pending ?? 0) + (cr.retry?.pending ?? 0);
      const usage = await readUsage(env, t);
      if (usage?.remaining != null && usage.remaining < 300) { meta.budgetStop = true; meta.notes.push(`Crediti giornalieri quasi esauriti (${usage.remaining} restanti): scarico interrotto.`); break; }
      log(`   giro ${round}: in attesa ${pending}`);
      if (!pending) break;
      stalled = pending >= lastPending ? stalled + 1 : 0; lastPending = pending;
      if (round === 14 || stalled >= 2) { meta.pending = pending; meta.notes.push(`${pending} partite non trovate o ancora in coda dopo ${round} giri.`); break; }
      await wait(Math.max(3000, br.retry?.afterMs ?? 0, cr.retry?.afterMs ?? 0));
    }
    const ids = open.map((m) => m.game_id);
    meta.prediction = tally(br?.state, ids); meta.market = tally(br?.marketState, ids); meta.corners = tally(cr?.state, ids);

    log("4/5 Schede dati delle partite nelle prossime 48 ore…");
    const near = open.filter((m) => Date.parse(m.kickoff_at) - now <= NEAR_MS && br?.maps?.has(m.game_id));
    meta.details.matches = near.length;
    const usageMid = await readUsage(env, Date.now());
    if (usageMid?.remaining != null && usageMid.remaining < RESERVE_FOR_DETAILS) { meta.details.skipped = true; meta.notes.push("Schede dati saltate: crediti restanti sotto la riserva."); }
    else if (near.length) {
      const { sections: pre } = await loadSections(env, [{ section: "bets", endpoint: "odds/bets", params: {}, ttl: ttlFor("odds-bets") }], Date.now());
      const betIds = betIdsFrom(pre.bets?.data);
      const reqs = near.flatMap((m) => {
        const map = br.maps.get(m.game_id), kickoff = Date.parse(m.kickoff_at);
        return planFor({ fixtureId: map.fixture_id, leagueId: map.league_id, season: map.season, homeId: map.home_team_id, awayId: map.away_team_id, kickoff, finished: false, now, extra: true, betIds })
          .map((r) => ({ ...r, section: `${m.game_id}|${r.section}`, fresh: VOLATILE.has(r.section) ? Math.min(r.ttl, freshFor(m)) : r.ttl }));
      });
      meta.details.sections = reqs.length;
      let lastP = Infinity, stall = 0;
      for (let round = 1; round <= 10; round += 1) {
        let pending = 0, afterMs = 0;
        for (let i = 0; i < reqs.length; i += 40) {
          const r = await loadSections(env, reqs.slice(i, i + 40), Date.now(), { maxLive: 60 });
          pending += r.retry.pending; afterMs = Math.max(afterMs, r.retry.afterMs);
        }
        log(`   giro ${round}: sezioni in attesa ${pending}`);
        if (!pending) break;
        stall = pending >= lastP ? stall + 1 : 0; lastP = pending;
        if (stall >= 2) { meta.notes.push(`${pending} sezioni delle schede dati non scaricate.`); break; }
        const u = await readUsage(env, Date.now());
        if (u?.remaining != null && u.remaining < 300) { meta.budgetStop = true; break; }
        await wait(Math.max(3000, afterMs));
      }
    }

    log("Registro dei pronostici (statistiche)…");
    try {
      const r = await snapshotPredictions({ request: new Request("https://job.local/api/snapshot?hours=36", { headers: { "x-sync-secret": env.SYNC_SECRET } }), env });
      const b = await r.json().catch(() => ({}));
      meta.registry = r.ok ? { stored: b.stored ?? 0, bets: b.bets ?? 0 } : null;
      if (!r.ok) meta.notes.push(`Registro pronostici non aggiornato: ${String(b.error ?? r.status).slice(0, 100)}`);
    } catch (e) { meta.notes.push(`Registro pronostici non aggiornato: ${String(e?.message ?? e).slice(0, 100)}`); }

    log("5/5 Istantanea per l'app…");
    const built = await buildFixtures(env);
    if (!built.ok) throw new Error(built.error);
    const usage1 = await readUsage(env, Date.now());
    meta.credits = { used: usage1?.requests ?? null, remaining: usage1?.remaining ?? null, limit: usage1?.limit_day ?? null, thisRun: usage1 && usage0 ? Math.max(0, (usage1.requests ?? 0) - (usage0.requests ?? 0)) : null };
    meta.finishedAt = new Date().toISOString();
    meta.durationSec = Math.round((Date.parse(meta.finishedAt) - now0) / 1000);
    meta.status = statusOf(meta);
    await supabaseUpsert(env, "app_snapshot", [{ id: "fixtures", payload: built.payload, meta, built_at: meta.finishedAt }], "id");
    log(`Fatto: ${meta.status} in ${meta.durationSec}s · ${built.payload.matches.length} partite nell'istantanea`);
  } catch (error) {
    meta.error = String(error?.message ?? error).slice(0, 300);
    meta.finishedAt = new Date().toISOString(); meta.durationSec = Math.round((Date.parse(meta.finishedAt) - now0) / 1000);
    meta.status = "failed";
    if (/app_snapshot|relation|42P01|PGRST205/i.test(meta.error)) meta.notes.push("Hai applicato la migrazione 202611100001_app_snapshot.sql su Supabase?");
    log(`ERRORE: ${meta.error}`);
  }
  return meta;
}

async function main() {
  const need = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "API_FOOTBALL_KEY"].filter((k) => !process.env[k]);
  if (need.length) { console.error(`Mancano i secrets di GitHub: ${need.join(", ")}`); process.exit(1); }
  const env = { ...process.env, SYNC_SECRET: process.env.SYNC_SECRET || "full-refresh-local", API_FOOTBALL_MIN_GAP_MS: process.env.API_FOOTBALL_MIN_GAP_MS || "210" };   // ~4,7 richieste al secondo (limite: 5)
  const meta = await runRefresh(env);
  const md = summaryMarkdown(meta);
  console.log("\n" + md);
  if (process.env.GITHUB_STEP_SUMMARY) { const { appendFileSync } = await import("node:fs"); appendFileSync(process.env.GITHUB_STEP_SUMMARY, md); }
  process.exit(meta.status === "failed" ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
