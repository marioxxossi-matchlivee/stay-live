#!/usr/bin/env node
/**
 * Aggiornamento di Stay Live, SOLO con API-Football. Tre modalità (variabile REFRESH_MODE o argomento):
 *   full     giro completo ogni 4 ore (.github/workflows/aggiornamento-completo.yml) e aggiornamento manuale dall'app
 *   recover  recupero automatico ogni 30 minuti (.github/workflows/recupero-aggiornamento.yml): riprende SOLO le operazioni
 *            rimaste incomplete (tabella refresh_tasks) quando è ora di riprovare; se non c'è nulla da fare non chiama nessuno
 *
 * Fasi: 1 campionati · 2 copertura del piano (flag `coverage`) · 3 pronostici, quote 1X2 e Over/Under, quote corner
 *       · 4 schede dati (prossime 48 ore) · 5 corner storici reali (modello corner) · 6 registro pronostici · 7 istantanea + verifica lettura.
 * Ogni componente di ogni partita ha UNO tra cinque esiti (ok / non ancora disponibile / non previsto dalla copertura / temporaneo / errore),
 * vedi functions/api/_diag.js: solo "temporaneo" ed "errore" rendono il giro "parziale" e generano compiti di recupero.
 * Il lavoro sta qui e non su Cloudflare: il piano Free concede 10 ms di CPU a richiesta.
 *
 * Variabili (secrets di GitHub): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, API_FOOTBALL_KEY; facoltative: SYNC_SECRET, FIXTURES_DAYS (7).
 */
import { LEAGUES, SEASON, errorMessage, supabaseDelete, supabaseGet, supabaseGetAll, supabasePatch, supabaseUpsert, loadFinals } from "../functions/api/_lib.js";
import { AF_LEAGUES, betIdsFrom, dayKey, loadSections, planFor, seasonFor, ttlFor } from "../functions/api/_apifootball.js";
import { loadBrainInputs } from "../functions/api/_brain.js";
import { loadCornerOdds } from "../functions/api/_corners.js";
import { backfillCorners, selectBackfill } from "../functions/api/_cornerstats.js";
import { COMPONENT_LABEL, TEMP_RE, buildTasks, classify, countClasses, coverageFlags, emptyCounts, pendingSummary, statusOf } from "../functions/api/_diag.js";
import { buildFixtures } from "../functions/api/fixtures.js";
import { onRequest as syncLeague } from "../functions/api/sync.js";
import { onRequest as snapshotPredictions } from "../functions/api/snapshot.js";

export { statusOf };
const H = 3600e3;
export const FRESH_NEAR = 3.5 * H, FRESH_FAR = 11 * H;           // età massima accettata a ogni giro (cadenza 4 ore)
export const NEAR_MS = 48 * H;                                   // "vicine": quote e schede si riscaricano a ogni giro
export const RESERVE_FOR_DETAILS = 1500;                         // sotto questi crediti restanti si salta la fase 4
export const RESERVE_HISTORY = 2500;                             // e i corner storici (la parte meno urgente)
export const HISTORY_CAP = { full: 400, recover: 150 };          // richieste massime per giro per i corner storici
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

/** Prossimo giro completo (00:10, 04:10, 08:10… UTC). */
export function nextFullRun(now = Date.now()) { const d = new Date(now); d.setUTCMinutes(10, 0, 0); for (let i = 0; i < 8; i += 1) { if (d.getUTCHours() % 4 === 0 && d.getTime() > now) return d.toISOString(); d.setUTCHours(d.getUTCHours() + 1); } return d.toISOString(); }

export function summaryMarkdown(m) {
  const icon = { ok: "✅", partial: "⚠️", failed: "❌" }[m.status] ?? "•";
  const L = [`## ${icon} Aggiornamento ${m.mode === "recover" ? "di recupero" : "completo"}: ${m.status === "ok" ? "riuscito" : m.status === "partial" ? "parziale" : "fallito"}`, ""];
  if (m.error) L.push(`**Errore:** ${m.error}`, "");
  L.push(`- Durata: ${Math.round(m.durationSec / 60)} min · partite aperte coperte: ${m.matches.eligible} (elaborate ${m.matches.processed}, in attesa ${m.matches.waiting})`);
  L.push(`- Campionati: ${m.leagues.ok}/${m.leagues.total} aggiornati${m.leagues.failed.length ? ` · errori: ${m.leagues.failed.map((f) => `${f.id} (${f.error})`).join("; ")}` : ""}`);
  for (const [k, c] of Object.entries(m.components ?? {})) L.push(`- ${COMPONENT_LABEL[k] ?? k}: ${c.ok} ok · ${c.not_yet} non ancora disponibili · ${c.not_covered} non previsti dal provider · ${c.temporary} temporanei · ${c.error} errori`);
  if (m.requests?.remaining != null) L.push(`- Richieste API-Football: ${m.requests.thisRun ?? "?"} in questo giro · ${m.requests.today ?? "?"} oggi · ${m.requests.remaining} restanti su ${m.requests.limit ?? "?"}`);
  for (const p of m.pending ?? []) L.push(`- Da completare: ${COMPONENT_LABEL[p.component] ?? p.component} (${p.count}), nuovo tentativo dalle ${String(p.nextTryAt).slice(11, 16)} UTC`);
  for (const n of m.notes) L.push(`- ${n}`);
  return L.join("\n") + "\n";
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const COLUMNS = "game_id,league,round,kickoff_at,status,home_id,home_name,away_id,away_name,home_score,away_score,neutral_site";

async function readUsage(env, now) {
  try { const [u] = await supabaseGet(env, "af_usage", { select: "*", day: `eq.${dayKey(now)}`, limit: 1 }); return u ?? null; } catch { return null; }
}

/** Fase 1: campionati, uno alla volta (limite di richieste al secondo); si riprova se il limite è superato. `only` = solo questi id. */
export async function syncAll(env, { call = syncLeague, wait = sleep, log = () => {}, only = null } = {}) {
  const run = async (cfg) => {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const res = await call({ request: new Request(`https://job.local/api/sync?league=${cfg.id}&force=1`, { headers: { "x-sync-secret": env.SYNC_SECRET } }), env });
      const body = await res.json().catch(() => ({}));
      if (res.ok) return { id: cfg.id, ok: true, matches: body.matches ?? null };
      const msg = String(body.error ?? res.status);
      if (attempt < 3 && RATE_RE.test(msg)) { log(`… ${cfg.id}: ${msg.slice(0, 80)} (attendo)`); await wait(20000 * attempt); continue; }
      return { id: cfg.id, ok: false, error: msg.slice(0, 160) };
    }
  };
  const results = [];
  for (const cfg of LEAGUES.filter((l) => !only || only.includes(l.id))) { results.push(await run(cfg)); await wait(250); }
  return results;
}

const loadTasks = async (env) => { try { return await supabaseGetAll(env, "refresh_tasks", { select: "*", order: "next_try_at.asc" }, 1000, 10); } catch { return null; } };

async function saveTasks(env, tasks, prev) {
  if (tasks.length) await supabaseUpsert(env, "refresh_tasks", tasks, "task_key");
  const keep = new Set(tasks.map((t) => t.task_key)), gone = prev.filter((t) => !keep.has(t.task_key)).map((t) => t.task_key);
  for (let i = 0; i < gone.length; i += 30) await supabaseDelete(env, "refresh_tasks", { task_key: `in.(${gone.slice(i, i + 30).map((k) => `"${k}"`).join(",")})` });
}

const errOf = (e) => String(e?.message ?? e).slice(0, 300);

export async function runRefresh(env, { mode = "full", trigger = "schedule", log = console.log, wait = sleep, now0 = Date.now() } = {}) {
  const startedAt = new Date(now0).toISOString();
  const days = Math.min(30, Math.max(3, Number(env.FIXTURES_DAYS) || 7));
  const meta = {
    v: 2, mode: trigger === "workflow_dispatch" && mode === "full" ? "manual" : mode, status: "failed", startedAt, finishedAt: null, durationSec: 0, everyHours: 4, windowDays: days, error: null, budgetStop: false,
    nextRunAt: nextFullRun(now0), nextRecoverAt: null,
    leagues: { total: LEAGUES.length, ok: 0, failed: [], list: [] }, matches: { window: 0, eligible: 0, processed: 0, waiting: 0 },
    components: { prediction: emptyCounts(), market: emptyCounts(), corners: emptyCounts(), details: emptyCounts(), cornerStats: emptyCounts() },
    stats: { updated: 0, missing: 0, notAvailable: 0 }, cornerHistory: null, details: { matches: 0, sections: 0, skipped: false },
    requests: { thisRun: null, today: null, remaining: null, limit: null }, errors: [], pending: [], verify: null, registry: null, notes: [],
  };
  const items = [];                                   // esiti di ogni operazione -> compiti da completare
  const usage0 = await readUsage(env, now0);
  const prev = await loadTasks(env);
  if (prev === null) meta.notes.push("Tabelle di diagnostica assenti: applica la migrazione 202611110001_refresh_diagnostics.sql su Supabase (senza, il recupero automatico non può funzionare).");
  const prevTasks = prev ?? [];
  const attemptsOf = new Map(prevTasks.map((t) => [t.task_key, t.attempts]));
  const due = mode === "recover" ? prevTasks.filter((t) => Date.parse(t.next_try_at) <= now0) : [];
  try {
    if (mode === "recover") {
      if (!due.length) { meta.status = "skipped"; meta.notes.push("Nessuna operazione da riprendere."); return meta; }
      if (usage0?.remaining != null && usage0.remaining < 300) { meta.status = "skipped"; meta.notes.push(`Crediti restanti ${usage0.remaining}: recupero rimandato al reset giornaliero.`); return meta; }
      log(`Recupero: ${due.length} operazioni da riprendere (${[...new Set(due.map((t) => t.component))].join(", ")})`);
    }

    /* 1 · campionati */
    log("1 Campionati…");
    const onlyLeagues = mode === "recover" ? [...new Set(due.filter((t) => t.component === "league").map((t) => t.league))] : null;
    const leagueResults = await syncAll(env, { wait, log, only: onlyLeagues });
    const syncedIds = new Set(leagueResults.map((r) => r.id));
    for (const r of leagueResults) {
      const cfg = LEAGUES.find((l) => l.id === r.id);
      items.push({ component: "league", scope: r.id, league: r.id, cls: r.ok ? "ok" : TEMP_RE.test(r.error ?? "") ? "temporary" : "error", error: r.error });
      if (!r.ok) meta.errors.push({ component: "league", scope: cfg?.name ?? r.id, message: r.error });
    }
    for (const t of prevTasks.filter((t) => t.component === "league" && !syncedIds.has(t.league))) items.push({ component: "league", scope: t.scope, league: t.league, cls: t.state, error: t.last_error, carry: true });
    // Verifica di scrittura: ogni campionato dichiarato aggiornato deve avere sync_state fresco su Supabase.
    const states = await supabaseGet(env, "sync_state", { select: "league,synced_at,matches_count,last_error" }).catch(() => []);
    const byState = new Map(states.map((s) => [s.league, s]));
    for (const r of leagueResults.filter((x) => x.ok)) { const s = byState.get(r.id); if (!s?.synced_at || Date.parse(s.synced_at) < now0 - 1000) { r.ok = false; r.error = "Salvataggio su Supabase non verificato"; const it = items.find((i) => i.component === "league" && i.scope === r.id); it.cls = "error"; it.error = r.error; meta.errors.push({ component: "league", scope: r.id, message: r.error }); } }
    const failedNow = new Map(items.filter((i) => i.component === "league" && i.cls !== "ok").map((i) => [i.league, i]));
    meta.leagues.list = LEAGUES.map((l) => ({ id: l.id, name: l.name, ok: !failedNow.has(l.id), error: failedNow.get(l.id)?.error ?? null, count: byState.get(l.id)?.matches_count ?? 0, syncedAt: byState.get(l.id)?.synced_at ?? null }));
    meta.leagues.failed = meta.leagues.list.filter((l) => !l.ok).map((l) => ({ id: l.id, name: l.name, error: l.error ?? "errore" }));
    meta.leagues.ok = meta.leagues.total - meta.leagues.failed.length;
    log(`   ${meta.leagues.ok}/${meta.leagues.total} aggiornati${meta.leagues.failed.length ? `, in difficoltà: ${meta.leagues.failed.map((f) => f.id).join(", ")}` : ""}`);

    const now = Date.now();
    const from = new Date(now - 36 * H).toISOString(), to = new Date(now + days * 86400e3).toISOString();
    const window = await supabaseGetAll(env, "matches", { select: COLUMNS, season: `eq.${SEASON}`, and: `(kickoff_at.gte.${from},kickoff_at.lte.${to})`, order: "kickoff_at.asc,game_id.asc" });
    const open = eligibleOpen(window, now, days);
    meta.matches.window = window.length; meta.matches.eligible = open.length;
    const freshFor = freshForAt(now);

    /* 2 · copertura del piano (flag per campionato, cache 30 giorni) */
    log("2 Copertura del piano…");
    const flags = new Map();
    {
      const lgs = [...new Set(open.map((m) => m.league))];
      const reqs = lgs.map((id) => { const cfg = LEAGUES.find((l) => l.id === id); return { section: id, endpoint: "leagues", params: { id: cfg.afId, season: seasonFor(id, new Date(now).toISOString()) }, ttl: ttlFor("coverage") }; });
      for (let i = 0; i < reqs.length; i += 40) {
        const { sections } = await loadSections(env, reqs.slice(i, i + 40), now, { maxLive: 40 });
        for (const r of reqs.slice(i, i + 40)) { const f = coverageFlags(sections[r.section]?.data, r.params.season); if (f) flags.set(r.section, f); }
      }
    }

    /* 3 · pronostici, quote, corner */
    const dueIds = new Set(due.filter((t) => t.component !== "league" && t.component !== "cornerStats").map((t) => t.scope));
    const targetSet = mode === "recover" ? new Set(open.filter((m) => dueIds.has(m.game_id)).map((m) => m.game_id)) : new Set(open.map((m) => m.game_id));
    const target = open.filter((m) => targetSet.has(m.game_id)), rest = open.filter((m) => !targetSet.has(m.game_id));
    log(`3 Pronostici, quote e corner di ${target.length} partite${rest.length ? ` (altre ${rest.length} solo dalla cache)` : ""}…`);
    let br = null, cr = null, lastPending = Infinity, stalled = 0;
    if (target.length) for (let round = 1; round <= 14; round += 1) {
      const t = Date.now();
      br = await loadBrainInputs(env, target, t, { live: true, maxMap: 25, maxLive: 80, freshFor, maps: br?.maps });
      cr = await loadCornerOdds(env, target, t, { live: true, maxMap: 25, maxLive: 80, freshFor, maps: br.maps });
      const pending = (br.retry?.pending ?? 0) + (cr.retry?.pending ?? 0);
      const usage = await readUsage(env, t);
      if (usage?.remaining != null && usage.remaining < 300) { meta.budgetStop = true; meta.notes.push(`Crediti giornalieri quasi esauriti (${usage.remaining} restanti): scarico interrotto, riprende da solo.`); break; }
      log(`   giro ${round}: in attesa ${pending}`);
      if (!pending) break;
      stalled = pending >= lastPending ? stalled + 1 : 0; lastPending = pending;
      if (round === 14 || stalled >= 2) { meta.notes.push(`${pending} partite ancora in coda dopo ${round} giri: le riprende il recupero automatico.`); break; }
      await wait(Math.max(3000, br.retry?.afterMs ?? 0, cr.retry?.afterMs ?? 0));
    }
    const brR = rest.length ? await loadBrainInputs(env, rest, Date.now(), { live: false, maps: br?.maps }) : null;
    const crR = rest.length ? await loadCornerOdds(env, rest, Date.now(), { live: false, maps: brR?.maps ?? br?.maps }) : null;
    const sPred = (id) => (targetSet.has(id) ? br : brR)?.state?.get(id) ?? "missing", sMkt = (id) => (targetSet.has(id) ? br : brR)?.marketState?.get(id) ?? "missing", sCor = (id) => (targetSet.has(id) ? cr : crR)?.state?.get(id) ?? "missing";
    const eOf = (id, key) => (targetSet.has(id) ? br : brR)?.errors?.get(`${id}|${key}`), eCor = (id) => (targetSet.has(id) ? cr : crR)?.errors?.get(id);
    const per = new Map();                          // game_id -> classi dei componenti (per "elaborate / in attesa")
    for (const m of open) {
      const id = m.game_id, fl = flags.get(m.league) ?? null;
      const at = (c) => attemptsOf.get(`${c}:${id}`) ?? 0;
      const rows = [["prediction", sPred(id), eOf(id, "pred")], ["market", sMkt(id), eOf(id, "market")], ["corners", sCor(id), eCor(id)]];
      for (const [comp, state, error] of rows) {
        const cls = classify(comp, { state, error, kickoff: m.kickoff_at, now, flags: fl, attempts: at(comp) });
        meta.components[comp][cls] += 1;
        (per.get(id) ?? per.set(id, []).get(id)).push(cls);
        items.push({ component: comp, scope: id, league: m.league, cls, error, carry: !targetSet.has(id) });   // non ritentata in questo giro: i tentativi non aumentano
        if (cls === "error") meta.errors.push({ component: comp, scope: `${m.home_name} - ${m.away_name}`, message: error ?? "errore" });
      }
    }

    /* 4 · schede dati (prossime 48 ore) */
    log("4 Schede dati delle partite nelle prossime 48 ore…");
    const allMaps = new Map([...(brR?.maps ?? []), ...(br?.maps ?? [])]);
    const near = target.filter((m) => Date.parse(m.kickoff_at) - now <= NEAR_MS && allMaps.has(m.game_id));
    meta.details.matches = near.length;
    const usageMid = await readUsage(env, Date.now());
    const detailSections = {};
    if (usageMid?.remaining != null && usageMid.remaining < RESERVE_FOR_DETAILS) {
      meta.details.skipped = true; meta.notes.push("Schede dati rimandate: crediti restanti sotto la riserva.");
      for (const m of near) { meta.components.details.temporary += 1; items.push({ component: "details", scope: m.game_id, league: m.league, cls: "temporary", error: "Crediti sotto la riserva" }); }
    } else if (near.length) {
      const { sections: pre } = await loadSections(env, [{ section: "bets", endpoint: "odds/bets", params: {}, ttl: ttlFor("odds-bets") }], Date.now());
      const betIds = betIdsFrom(pre.bets?.data);
      const reqs = near.flatMap((m) => {
        const map = allMaps.get(m.game_id), kickoff = Date.parse(m.kickoff_at);
        return planFor({ fixtureId: map.fixture_id, leagueId: map.league_id, season: map.season, homeId: map.home_team_id, awayId: map.away_team_id, kickoff, finished: false, now, extra: true, betIds })
          .map((r) => ({ ...r, section: `${m.game_id}|${r.section}`, fresh: VOLATILE.has(r.section) ? Math.min(r.ttl, freshFor(m)) : r.ttl }));
      });
      meta.details.sections = reqs.length;
      let lastP = Infinity, stall = 0;
      for (let round = 1; round <= 10; round += 1) {
        let pending = 0, afterMs = 0;
        for (let i = 0; i < reqs.length; i += 40) {
          const r = await loadSections(env, reqs.slice(i, i + 40), Date.now(), { maxLive: 60 });
          Object.assign(detailSections, r.sections);
          pending += r.retry.pending; afterMs = Math.max(afterMs, r.retry.afterMs);
        }
        log(`   giro ${round}: sezioni in attesa ${pending}`);
        if (!pending) break;
        stall = pending >= lastP ? stall + 1 : 0; lastP = pending;
        if (stall >= 2) { meta.notes.push(`${pending} sezioni delle schede dati non scaricate: le riprende il recupero automatico.`); break; }
        const u = await readUsage(env, Date.now());
        if (u?.remaining != null && u.remaining < 300) { meta.budgetStop = true; break; }
        await wait(Math.max(3000, afterMs));
      }
      for (const m of near) {
        const secs = Object.entries(detailSections).filter(([k]) => k.startsWith(`${m.game_id}|`)).map(([, v]) => v);
        const deferred = secs.some((s) => s.deferred), hard = secs.find((s) => s.error && !s.deferred && !s.data);
        const cls = deferred ? "temporary" : hard ? (TEMP_RE.test(hard.error) ? "temporary" : "error") : "ok";
        meta.components.details[cls] += 1;
        items.push({ component: "details", scope: m.game_id, league: m.league, cls, error: deferred ? "Sezioni in coda" : hard?.error ?? null });
      }
    }
    // schede non rielaborate in questo giro (recupero): i compiti precedenti restano
    for (const t of prevTasks.filter((t) => t.component === "details" && !near.some((m) => m.game_id === t.scope))) items.push({ component: "details", scope: t.scope, league: t.league, cls: t.state, error: t.last_error, carry: true });

    /* 5 · corner storici reali (modello corner) */
    log("5 Corner storici (statistiche reali)…");
    try {
      const usage5 = await readUsage(env, Date.now());
      const finals = await loadFinals(env);
      const have = new Set((await supabaseGetAll(env, "match_corners", { select: "game_id", season: `eq.${SEASON}` }, 1000, 20)).map((r) => r.game_id));
      const queue = selectBackfill(open, finals, have, { limit: 5000, now });
      const cap = HISTORY_CAP[mode === "recover" ? "recover" : "full"];
      if (usage5?.remaining != null && usage5.remaining < RESERVE_HISTORY) {
        meta.cornerHistory = { stored: have.size, backlog: queue.length, fetched: 0, skipped: true };
        meta.notes.push(`Corner storici rimandati: crediti restanti ${usage5.remaining} sotto la riserva (${RESERVE_HISTORY}).`);
      } else if (queue.length) {
        const res = await backfillCorners(env, queue.slice(0, cap), Date.now(), { maxLive: cap });
        meta.components.cornerStats.ok += res.available; meta.components.cornerStats.not_covered += res.unavailable;
        for (const e of res.errors) { const cls = TEMP_RE.test(e.error) ? "temporary" : "error"; meta.components.cornerStats[cls] += 1; items.push({ component: "cornerStats", scope: e.game_id, cls, error: e.error }); if (cls === "error") meta.errors.push({ component: "cornerStats", scope: e.game_id, message: e.error }); }
        if (res.waiting) { meta.components.cornerStats.temporary += res.waiting; items.push({ component: "cornerStats", scope: "coda", cls: "temporary", error: `${res.waiting} partite in coda (limite di richieste)` }); }
        meta.cornerHistory = { stored: have.size + res.stored, backlog: Math.max(0, queue.length - res.stored), fetched: res.stored, available: res.available, unavailable: res.unavailable };
        if (meta.cornerHistory.backlog) meta.notes.push(`Corner storici: ${meta.cornerHistory.backlog} partite ancora da scaricare nei prossimi giri (crediti giornalieri).`);
      } else meta.cornerHistory = { stored: have.size, backlog: 0, fetched: 0 };
    } catch (e) {
      meta.components.cornerStats.error += 1; meta.errors.push({ component: "cornerStats", scope: "storico", message: errOf(e) });
      items.push({ component: "cornerStats", scope: "storico", cls: "error", error: errOf(e) });
      if (/match_corners|PGRST205|42P01/.test(errOf(e))) meta.notes.push("Tabella match_corners assente: applica la migrazione 202611110001_refresh_diagnostics.sql.");
    }

    /* 6 · registro pronostici */
    log("6 Registro dei pronostici…");
    try {
      const r = await snapshotPredictions({ request: new Request("https://job.local/api/snapshot?hours=36", { headers: { "x-sync-secret": env.SYNC_SECRET } }), env });
      const b = await r.json().catch(() => ({}));
      meta.registry = r.ok ? { stored: b.stored ?? 0, bets: b.bets ?? 0 } : null;
      if (!r.ok) { meta.notes.push(`Registro pronostici non aggiornato: ${String(b.error ?? r.status).slice(0, 100)}`); meta.errors.push({ component: "registry", scope: "registro", message: String(b.error ?? r.status).slice(0, 200) }); }
    } catch (e) { meta.notes.push(`Registro pronostici non aggiornato: ${errOf(e).slice(0, 100)}`); }

    /* 7 · istantanea + verifica */
    log("7 Istantanea per l'app…");
    const built = await buildFixtures(env);
    if (!built.ok) throw new Error(built.error);
    const usage1 = await readUsage(env, Date.now());
    meta.requests = { thisRun: usage1 && usage0 ? Math.max(0, (usage1.requests ?? 0) - (usage0.requests ?? 0)) : usage1?.requests ?? null, today: usage1?.requests ?? null, remaining: usage1?.remaining ?? null, limit: usage1?.limit_day ?? null };

    const tasks = buildTasks(items, prevTasks, Date.now());
    const waitingGames = new Set(tasks.filter((t) => t.component !== "league" && t.component !== "cornerStats").map((t) => t.scope));
    meta.matches.waiting = open.filter((m) => waitingGames.has(m.game_id)).length; meta.matches.processed = open.length - meta.matches.waiting;
    for (const c of Object.values(meta.components)) { meta.stats.updated += c.ok; meta.stats.missing += c.temporary + c.error; meta.stats.notAvailable += c.not_yet + c.not_covered; }
    meta.pending = pendingSummary(tasks);
    meta.errors = meta.errors.slice(0, 25);
    meta.nextRecoverAt = tasks.length ? tasks.map((t) => t.next_try_at).sort()[0] : null;
    meta.finishedAt = new Date().toISOString();
    meta.durationSec = Math.round((Date.parse(meta.finishedAt) - now0) / 1000);
    meta.status = statusOf(meta);

    await supabaseUpsert(env, "app_snapshot", [{ id: "fixtures", payload: built.payload, meta, built_at: meta.finishedAt }], "id");
    // Verifica: l'istantanea riletta da Supabase deve essere quella appena scritta.
    const [back] = await supabaseGet(env, "app_snapshot", { select: "built_at", id: "eq.fixtures", limit: 1 }).catch(() => []);
    meta.verify = { ok: Boolean(back) && Date.parse(back.built_at) === Date.parse(meta.finishedAt), checkedAt: new Date().toISOString() };
    if (!meta.verify.ok) { meta.notes.push("Istantanea scritta ma non rilevata in rilettura da Supabase."); meta.status = statusOf(meta); }
    await supabasePatch(env, "app_snapshot", { id: "eq.fixtures" }, { meta }).catch((e) => meta.notes.push(`Esito della verifica non salvato: ${errOf(e)}`));
    if (prev !== null) await saveTasks(env, tasks, prevTasks).catch((e) => { meta.notes.push(`Compiti di recupero non salvati: ${errOf(e)}`); });
    await supabaseUpsert(env, "refresh_runs", [{ mode: meta.mode, status: meta.status, started_at: startedAt, finished_at: meta.finishedAt, meta }], "id").catch(() => {});
    log(`Fatto: ${meta.status} in ${meta.durationSec}s · ${built.payload.matches.length} partite nell'istantanea · compiti aperti ${tasks.length}`);
  } catch (error) {
    meta.error = errOf(error);
    meta.finishedAt = new Date().toISOString(); meta.durationSec = Math.round((Date.parse(meta.finishedAt) - now0) / 1000);
    meta.status = "failed";
    if (/app_snapshot|relation|42P01|PGRST205/i.test(meta.error)) meta.notes.push("Hai applicato le migrazioni su Supabase (202611100001_app_snapshot.sql e 202611110001_refresh_diagnostics.sql)?");
    log(`ERRORE: ${meta.error}`);
    // anche un giro fallito lascia traccia (l'istantanea precedente resta valida)
    await supabaseUpsert(env, "refresh_runs", [{ mode: meta.mode, status: "failed", started_at: startedAt, finished_at: meta.finishedAt, meta }], "id").catch(() => {});
  }
  return meta;
}

async function main() {
  const need = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "API_FOOTBALL_KEY"].filter((k) => !process.env[k]);
  if (need.length) { console.error(`Mancano i secrets di GitHub: ${need.join(", ")}`); process.exit(1); }
  const mode = process.argv.includes("--recover") || process.env.REFRESH_MODE === "recover" ? "recover" : "full";
  const env = { ...process.env, SYNC_SECRET: process.env.SYNC_SECRET || "full-refresh-local", API_FOOTBALL_MIN_GAP_MS: process.env.API_FOOTBALL_MIN_GAP_MS || "210" };   // ~4,7 richieste al secondo (limite: 5)
  const meta = await runRefresh(env, { mode, trigger: process.env.GITHUB_EVENT_NAME || "schedule" });
  const md = summaryMarkdown({ ...meta, status: meta.status === "skipped" ? "ok" : meta.status });
  console.log("\n" + md);
  if (process.env.GITHUB_STEP_SUMMARY) { const { appendFileSync } = await import("node:fs"); appendFileSync(process.env.GITHUB_STEP_SUMMARY, md); }
  process.exit(meta.status === "failed" ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
