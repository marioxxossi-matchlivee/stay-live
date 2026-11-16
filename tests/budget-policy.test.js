import test from "node:test";
import assert from "node:assert/strict";
import { allowance, capFor, ceilingOf, createBudget, memoryStore, RESERVE } from "../functions/api/_budget.js";
import { emptyRecheckMs, leaguesDue, pruneTasks, retryDelayMs, tierOf, policyFor, MAX_RECOVER_ATTEMPTS } from "../functions/api/_policy.js";
import { dueTasks, isParked, buildTasks } from "../functions/api/_diag.js";
import { completenessOf } from "../functions/api/_completeness.js";
import { completenessSummary, summarizeBudget } from "../functions/api/_budgetreport.js";
import { loadSections, splitOddsBundle } from "../functions/api/_apifootball.js";
import { saveDayState, dqChipHtml } from "../src/dataquality.js";

const H = 3600e3, NOW = Date.parse("2026-11-16T10:00:00Z");

test("priorità: imminente, oggi, domani, settimana, fondo", () => {
  assert.equal(tierOf(NOW + 2 * H, NOW), "imminent");
  assert.equal(tierOf(NOW + 8 * H, NOW), "today");
  assert.equal(tierOf(NOW + 24 * H, NOW), "tomorrow");
  assert.equal(tierOf(NOW + 4 * 24 * H, NOW), "week");
  assert.equal(tierOf(NOW + 9 * 24 * H, NOW), "background");
  assert.equal(tierOf(NOW - 6 * H, NOW), "background");
});

test("quote vuote: più il fischio è lontano, più si aspetta prima di richiedere di nuovo", () => {
  assert.ok(emptyRecheckMs(5 * 24 * H) >= 24 * H);
  assert.ok(emptyRecheckMs(60 * H) === 12 * H);
  assert.ok(emptyRecheckMs(2 * H) <= 30 * 60e3);
  const p = policyFor(NOW), far = { kickoff_at: new Date(NOW + 5 * 24 * H).toISOString() }, near = { kickoff_at: new Date(NOW + 2 * H).toISOString() };
  assert.ok(p.freshFor(far, "odds") > p.freshFor(near, "odds"));
  assert.ok(p.emptyFor(far, "odds") >= 24 * H);
});

test("budget: tetto con margine, riserva per priorità e curva giornaliera", () => {
  assert.equal(ceilingOf(), 7250);
  assert.equal(allowance({ tier: "imminent", used: 7249, now: NOW }).ok, true);
  assert.equal(allowance({ tier: "imminent", used: 7250, now: NOW }).ok, false);
  assert.equal(allowance({ tier: "today", used: 7250 - RESERVE.today, now: NOW }).ok, false);
  assert.equal(allowance({ tier: "week", used: 6500, now: Date.parse("2026-11-16T23:00:00Z") }).ok, false, "la settimana lascia la riserva a chi ha priorità più alta");
  const morning = Date.parse("2026-11-16T01:00:00Z");
  assert.ok(capFor("week", morning) < capFor("week", Date.parse("2026-11-16T20:00:00Z")), "la mattina i crediti non si bruciano");
  assert.ok(capFor("background", NOW) < capFor("week", NOW));
  assert.ok(capFor("tomorrow", NOW, { extraReserve: 300 }) < capFor("tomorrow", NOW), "riserva dinamica per le partite imminenti");
});

test("budget esaurito: le richieste non essenziali sono bloccate, le imminenti passano fino al tetto", async () => {
  const store = memoryStore({ official: 7100 });
  const b = createBudget({ store, now: () => NOW, leaseSize: 1 });
  assert.equal((await b.acquire({ tier: "week", endpoint: "odds" })).ok, false);
  assert.equal((await b.acquire({ tier: "background", endpoint: "fixtures/statistics" })).ok, false);
  let ok = 0; for (let i = 0; i < 400; i++) if ((await b.acquire({ tier: "imminent", endpoint: "odds" })).ok) ok += 1;
  assert.equal(ok, 7250 - 7100, "mai oltre il tetto con margine");
  assert.ok(b.stats().blocked >= 2);
});

test("richieste parallele: 500 richieste contemporanee da due processi non superano il tetto", async () => {
  const store = memoryStore({ official: 6900 });
  const a = createBudget({ store, now: () => NOW, leaseSize: 20 }), c = createBudget({ store, now: () => NOW, leaseSize: 20 });
  const res = await Promise.all(Array.from({ length: 500 }, (_, i) => (i % 2 ? a : c).acquire({ tier: "today", endpoint: "odds" })));
  const granted = res.filter((r) => r.ok).length;
  assert.ok(granted <= 7250 - 120 - 6900 + 40, `concessi ${granted}`);   // al più la riserva della priorità + i crediti prenotati e non ancora spesi
  assert.ok(store.state.reserved <= 7250, "il contatore di prenotazione non supera il tetto");
  await a.flush(); await c.flush();
  assert.ok(store.state.reserved <= 7250 - 120 + 1);
});

test("Supabase non raggiungibile: il manager non blocca l'app (conteggio locale)", async () => {
  const bad = { reserve: async () => { throw new Error("rete"); }, release: async () => {}, ledgerAdd: async () => { throw new Error("rete"); } };
  const b = createBudget({ store: bad, now: () => NOW, onWarn: () => {} });
  assert.equal((await b.acquire({ tier: "today", endpoint: "odds" })).ok, true);
  assert.equal(b.stats().failOpen, true);
  b.observe({ remaining: 100 });
  assert.equal((await b.acquire({ tier: "today", endpoint: "odds" })).ok, false, "con meno del margine residuo comunicato dal provider ci si ferma");
});

test("retry: intervalli progressivi, al massimo 3 tentativi, compiti sospesi non ripresi dal recupero", () => {
  assert.deepEqual([1, 2, 3, 9].map((n) => retryDelayMs("temporary", n) / 60e3), [30, 90, 240, 240]);
  assert.equal(MAX_RECOVER_ATTEMPTS, 3);
  const tasks = [{ attempts: 1, next_try_at: new Date(NOW - 1).toISOString() }, { attempts: 3, next_try_at: new Date(NOW - 1).toISOString() }, { attempts: 1, next_try_at: new Date(NOW + H).toISOString() }];
  assert.equal(dueTasks(tasks, NOW).length, 1);
  assert.equal(isParked(tasks[1]), true);
});

test("compiti obsoleti: partita finita/uscita dalla finestra o compito vecchio di 48 ore, eliminati", () => {
  const open = new Map([["af-1", NOW + 5 * H]]);
  const { keep, drop } = pruneTasks([
    { scope: "af-1", component: "market", first_seen_at: new Date(NOW - H).toISOString() },
    { scope: "af-2", component: "market" },
    { scope: "af-1", component: "prediction", first_seen_at: new Date(NOW - 50 * H).toISOString() },
  ], open, NOW);
  assert.equal(keep.length, 1); assert.equal(drop.length, 2);
});

test("campionati da sincronizzare: solo quelli che servono, nessuno resta indietro oltre 11 ore", () => {
  const leagues = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  const iso = (ms) => new Date(ms).toISOString();
  const states = [
    { league: "a", synced_at: iso(NOW - 1 * H) },           // fresco, nessuna partita vicina -> no
    { league: "b", synced_at: iso(NOW - 4 * H) },           // partita nelle 48 ore -> sì
    { league: "c", synced_at: iso(NOW - 12 * H) },          // calendario vecchio -> sì
    { league: "d", synced_at: iso(NOW - 2 * H) },           // partita iniziata da oltre 100 minuti -> sì (risultato)
  ];
  const matches = [{ league: "b", status: "scheduled", kickoff_at: iso(NOW + 10 * H) }, { league: "d", status: "in_progress", kickoff_at: iso(NOW - 2 * H) }];
  assert.deepEqual(leaguesDue(leagues, matches, states, NOW).sort(), ["b", "c", "d"]);
  assert.equal(leaguesDue(leagues, [], [], NOW).length, 4, "mai sincronizzati: tutti");
});

test("risposta cumulativa delle quote: divisa per mercato nello stesso formato del filtro bet", () => {
  const resp = [{ fixture: { id: 9 }, bookmakers: [{ id: 1, name: "B", bets: [{ id: 5, name: "Goals Over/Under", values: [] }, { id: 1, name: "Match Winner", values: [] }, { id: 45, name: "Corners Over Under", values: [] }] }] }];
  const p = splitOddsBundle(resp, [5, 1, 45, 12, 55]);
  assert.equal(p.get(5)[0].bookmakers[0].bets.length, 1); assert.equal(p.get(5)[0].bookmakers[0].bets[0].id, 5);
  assert.deepEqual(p.get(12), []); assert.deepEqual(p.get(55), []);
  assert.equal(p.get(45)[0].fixture.id, 9);
});

/* ---------- loadSections con provider e Supabase finti ---------- */
function world({ cache = [], usage = [], odds = null } = {}) {
  const log = { af: [], sb: [] }, db = { af_cache: cache, af_usage: usage };
  const bundle = [{ fixture: { id: 1 }, bookmakers: [{ id: 1, name: "B", bets: [{ id: 5, name: "Goals Over/Under", values: [{ value: "Over 2.5", odd: "1.9" }] }, { id: 1, name: "Match Winner", values: [] }, { id: 45, name: "Corners Over Under", values: [] }] }] }];
  globalThis.fetch = async (url, opts = {}) => {
    const u = new URL(url), r = (b, st = 200) => new Response(JSON.stringify(b), { status: st, headers: { "content-type": "application/json", "x-ratelimit-requests-remaining": "4000", "x-ratelimit-requests-limit": "7500" } });
    if (u.hostname.includes("api-sports")) { log.af.push(`${u.pathname.slice(1)}?${u.searchParams}`); return r({ errors: [], results: odds === "empty" ? 0 : 1, response: odds === "empty" ? [] : bundle, paging: { current: 1, total: 1 } }); }
    const t = u.pathname.replace("/rest/v1/", "");
    if (t.startsWith("rpc/")) return r(t === "rpc/af_budget_reserve" ? { granted: JSON.parse(opts.body).p_credits, used: 1 } : null);
    if ((opts.method ?? "GET") === "GET") return r(db[t] ?? []);
    const body = JSON.parse(opts.body); for (const x of body) { const i = (db[t] ??= []).findIndex((y) => y.cache_key && y.cache_key === x.cache_key); if (i >= 0) db[t][i] = x; else db[t].push(x); }
    return r([], 201);
  };
  return { log, db };
}
const env = () => ({ SUPABASE_URL: "https://sb.test", SUPABASE_SERVICE_ROLE_KEY: "k", API_FOOTBALL_KEY: "k", API_FOOTBALL_MIN_GAP_MS: "0" });
const oddsReq = (bet, extra = {}) => ({ section: `b${bet}`, endpoint: "odds", params: { fixture: 1, bet }, ttl: 12 * H, tier: "week", ...extra });

test("quote: una sola richiesta per partita per tutti i mercati, salvata in ogni chiave di cache", async () => {
  const real = globalThis.fetch; const w = world();
  try {
    const r = await loadSections(env(), [oddsReq(5), oddsReq(1), oddsReq(45), oddsReq(12), oddsReq(8)], NOW);
    assert.equal(w.log.af.length, 1, "una richiesta, non cinque");
    assert.equal(w.log.af[0], "odds?fixture=1");
    assert.equal(r.sections.b5.results, 1);
    assert.equal(r.sections.b12.results, 0);
    assert.ok(w.db.af_cache.some((x) => x.cache_key === "odds?bet=55&fixture=1"), "anche i mercati non richiesti ora sono in cache");
    assert.equal(r.saved.bundled, 4);
  } finally { globalThis.fetch = real; }
});

test("cache e deduplicazione: il secondo passaggio non fa richieste; chiavi uguali nella stessa chiamata = una richiesta", async () => {
  const real = globalThis.fetch; const w = world();
  try {
    const e = env();
    const r1 = await loadSections(e, [oddsReq(5), { ...oddsReq(5), section: "dup" }], NOW);
    assert.equal(w.log.af.length, 1); assert.equal(r1.sections.dup.results, r1.sections.b5.results); assert.equal(r1.saved.dedup, 1);
    const r2 = await loadSections(e, [oddsReq(5)], NOW + 60e3);
    assert.equal(w.log.af.length, 1, "dato ancora valido: nessuna richiesta"); assert.equal(r2.saved.cacheHits, 1);
    // richieste contemporanee identiche da due chiamate: una sola esce
    const w2 = world(); const [a, b] = await Promise.all([loadSections(e, [oddsReq(5, { ttl: 1 })], NOW + 9 * H), loadSections(e, [oddsReq(5, { ttl: 1 })], NOW + 9 * H)]);
    assert.ok(w2.log.af.length <= 1, `richieste: ${w2.log.af.length}`); assert.ok(a.sections.b5 && b.sections.b5);
  } finally { globalThis.fetch = real; }
});

test("quote non ancora pubblicate: risposta vuota non richiesta di nuovo prima del tempo previsto", async () => {
  const real = globalThis.fetch; const w = world({ odds: "empty" });
  try {
    const e = env(), emptyFresh = 24 * H;
    await loadSections(e, [oddsReq(5, { emptyFresh })], NOW);
    assert.equal(w.log.af.length, 1);
    await loadSections(e, [oddsReq(5, { emptyFresh })], NOW + 13 * H);   // oltre il TTL normale di 12 ore, ma sotto l'attesa prevista
    assert.equal(w.log.af.length, 1, "nessuna richiesta inutile");
    await loadSections(e, [oddsReq(5, { emptyFresh })], NOW + 25 * H);
    assert.equal(w.log.af.length, 2, "dopo 24 ore si ricontrolla");
  } finally { globalThis.fetch = real; }
});

test("budget esaurito dentro loadSections: sezione rimandata, nessun errore in cache, nessuna richiesta al provider", async () => {
  const real = globalThis.fetch; const w = world();
  try {
    const e = { ...env(), __budget: createBudget({ store: memoryStore({ official: 7200 }), now: () => NOW }) };
    const r = await loadSections(e, [oddsReq(5, { tier: "week" })], NOW);
    assert.equal(w.log.af.length, 0);
    assert.equal(r.sections.b5.deferred, true); assert.equal(r.saved.blocked, 1);
    assert.equal(w.db.af_cache.length, 0, "nessun errore scritto in cache");
    assert.ok(r.retry.afterMs >= 60e3);
  } finally { globalThis.fetch = real; }
});

test("completezza: stati e requisiti per mostrare un BET", () => {
  const ko = new Date(NOW + 30 * H).toISOString();
  const full = completenessOf({ now: NOW, kickoff: ko, odds: "used", predictions: "used", stats: true, corners: "used" });
  assert.equal(full.status, "complete"); assert.equal(full.betOk, true);
  const waiting = completenessOf({ now: NOW, kickoff: new Date(NOW + 5 * 24 * H).toISOString(), odds: "missing", predictions: "used", stats: true, corners: "used" });
  assert.equal(waiting.status, "waiting"); assert.equal(waiting.betOk, false); assert.ok(waiting.nextTryAt);
  assert.equal(completenessOf({ now: NOW, kickoff: ko, odds: "waiting", predictions: "used", stats: true, corners: "used" }).status, "updating");
  assert.equal(completenessOf({ now: NOW, kickoff: ko, odds: "used", predictions: "missing", stats: true, corners: "used" }).status, "partial");
  assert.equal(completenessOf({ now: NOW, kickoff: ko, odds: "used", predictions: "used", stats: true, corners: "used", tasks: [{ state: "error" }] }).status, "error");
  assert.match(dqChipHtml(full, String), /Dati completi/);
});

test("dashboard: consumi per tipo e processo, esiti, previsione e completezza", () => {
  const led = [
    { day: "2026-11-16", hour: 9, source: "full", endpoint: "odds", bet: "-", tier: "week", outcome: "ok", n: 100, credits: 100 },
    { day: "2026-11-16", hour: 9, source: "full", endpoint: "odds", bet: "-", tier: "week", outcome: "empty", n: 60, credits: 60 },
    { day: "2026-11-16", hour: 9, source: "recover", endpoint: "predictions", bet: "-", tier: "today", outcome: "failed", n: 2, credits: 2 },
    { day: "2026-11-16", hour: 9, source: "full", endpoint: "odds", bet: "-", tier: "week", outcome: "cache_hit", n: 300, credits: 0 },
    { day: "2026-11-16", hour: 9, source: "full", endpoint: "odds", bet: "-", tier: "week", outcome: "blocked_budget", n: 4, credits: 0 },
  ];
  const s = summarizeBudget({ usage: { requests: 4222, limit_day: 7500, remaining: 3279 }, ledger: led, tasks: [{ attempts: 1 }, { attempts: 3 }], now: NOW });
  assert.equal(s.credits.pct, 56); assert.equal(s.credits.last24h, 162);
  assert.equal(s.byEndpoint.odds.requests, 160); assert.equal(s.bySource.recover.failed, 2);
  assert.equal(s.outcomes.avoidedDuplicates, 300); assert.equal(s.outcomes.blockedBudget, 4);
  assert.deepEqual(s.queue, { open: 2, retrying: 1, parked: 1 });
  const c = completenessSummary([{ kickoffAt: new Date(NOW + H).toISOString(), dq: { status: "complete", parts: { odds: "ok" } } }, { kickoffAt: new Date(NOW + 30 * H).toISOString(), dq: { status: "waiting", parts: { odds: "missing" } } }], NOW);
  assert.equal(c.today.complete, 1); assert.equal(c.tomorrow.total, 1); assert.equal(c.missingOdds, 1);
});

test("pulsante «salva i BET del giorno»: nascosto, attivo o già salvato", () => {
  assert.equal(saveDayState(0, 0).hidden, true);
  assert.match(saveDayState(3, 1).label, /Salva i BET del giorno \(3\)/);
  assert.equal(saveDayState(0, 4).disabled, true);
});

test("simulazione: giornata molto popolata (700 partite su 7 giorni) resta sotto 7.500 crediti", () => {
  // 1 richiesta quote cumulativa + 1 pronostico per controllo; frequenze della politica; 6 giri completi + 24 recuperi al giorno
  const dist = { imminent: 40, today: 90, tomorrow: 160, week: 410 };         // 700 partite aperte
  const perDay = (kind, tier) => Math.ceil(24 * H / (kind === "odds" ? policyFor(NOW).freshFor({ kickoff_at: tier === "imminent" ? new Date(NOW + H) : tier === "today" ? new Date(NOW + 7 * H) : tier === "tomorrow" ? new Date(NOW + 30 * H) : new Date(NOW + 4 * 24 * H) }, "odds") : policyFor(NOW).freshFor({ kickoff_at: tier === "imminent" ? new Date(NOW + H) : tier === "today" ? new Date(NOW + 7 * H) : tier === "tomorrow" ? new Date(NOW + 30 * H) : new Date(NOW + 4 * 24 * H) }, "predictions")));
  let credits = 0;
  for (const [tier, n] of Object.entries(dist)) credits += n * (Math.min(perDay("odds", tier), 6) + Math.min(perDay("predictions", tier), 4));   // i giri completi ogni 4 ore limitano a 6 rinfreschi al giorno
  credits += 69 * 2 + 150;                                                    // campionati (2 giri al giorno) + schede dati
  assert.ok(credits < ceilingOf(), `stima ${credits} crediti`);
  assert.ok(credits < 4222 + 1500, "molto meno del consumo reale precedente");
});
