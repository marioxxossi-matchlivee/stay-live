/**
 * Prova end-to-end del giro di aggiornamento con Supabase e API-Football SIMULATI (nessuna rete reale):
 * verifica le chiamate effettivamente fatte, i dati scritti e riletti, la diagnostica, il recupero automatico e l'assenza di API Ninjas.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { LEAGUES } from "../functions/api/_lib.js";
import { runRefresh } from "../scripts/full-refresh.js";

const SB = "https://sb.test", AF = "https://v3.football.api-sports.io";
const PK = { matches: "game_id", sync_state: "league", af_cache: "cache_key", af_usage: "day", af_fixture_map: "game_id", app_snapshot: "id", refresh_tasks: "task_key", match_corners: "game_id", bet_predictions: "game_id", prediction_legs: "game_id,sel_key" };

function makeWorld() {
  const db = Object.fromEntries([...Object.keys(PK), "refresh_runs"].map((t) => [t, []]));
  const log = { af: [], urls: [] };
  const knobs = { rateLimitPredictionFor: null, noStatsFor: new Set(), remaining: 7500, used: 0 };
  const now = Date.now(), H = 3600e3;
  const teamsOf = (cfg) => ({ a: cfg.afId * 100 + 1, b: cfg.afId * 100 + 2, c: cfg.afId * 100 + 3, d: cfg.afId * 100 + 4 });
  const fixtureList = (cfg) => {
    const t = teamsOf(cfg), mk = (n, h, a, ms, st, g) => ({ fixture: { id: cfg.afId * 1000 + n, date: new Date(now + ms).toISOString(), status: { short: st } }, league: { id: cfg.afId, name: cfg.afName ?? cfg.name, country: cfg.afCountry, round: "Regular Season - 3" }, teams: { home: { id: h, name: `Team ${h}` }, away: { id: a, name: `Team ${a}` } }, goals: { home: g?.[0] ?? null, away: g?.[1] ?? null }, score: { fulltime: { home: g?.[0] ?? null, away: g?.[1] ?? null } } });
    return [mk(1, t.a, t.b, -3 * 24 * H, "FT", [2, 1]), mk(2, t.c, t.d, -2 * 24 * H, "FT", [0, 0]), mk(3, t.a, t.c, -1 * 24 * H, "FT", [1, 3]), mk(4, t.b, t.d, 20 * H, "NS"), mk(5, t.c, t.a, 5 * 24 * H, "NS")];
  };
  const matchesFilter = (rows, params) => {
    const cmp = (a, b) => { const x = Date.parse(a), y = Date.parse(b); return Number.isFinite(x) && Number.isFinite(y) && /\d{4}-\d\d/.test(String(a)) ? x - y : String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0; };
    const test1 = (row, col, spec) => {
      const v = row[col]; const dot = spec.indexOf("."); const op = spec.slice(0, dot), val = spec.slice(dot + 1);
      if (op === "eq") return String(v) === val; if (op === "neq") return String(v) !== val; if (op === "gte") return cmp(v, val) >= 0; if (op === "lte") return cmp(v, val) <= 0;
      if (op === "gt") return cmp(v, val) > 0; if (op === "lt") return cmp(v, val) < 0;
      if (op === "is") return val === "null" ? v == null : v != null;
      if (op === "in") return [...val.matchAll(/"((?:[^"\\]|\\.)*)"|([^,()]+)/g)].map((m) => m[1] ?? m[2]).includes(String(v));
      throw new Error(`filtro non gestito dal mock: ${spec}`);
    };
    let out = rows;
    for (const [k, spec] of params) {
      if (["select", "order", "limit", "offset", "on_conflict"].includes(k)) continue;
      if (k === "and") { for (const part of spec.slice(1, -1).split(",")) { const [col, ...rest] = part.split("."); out = out.filter((r) => test1(r, col, rest.join("."))); } continue; }
      out = out.filter((r) => test1(r, k, spec));
    }
    return out;
  };
  const sbFetch = async (url, opts = {}) => {
    const u = new URL(url), table = u.pathname.replace("/rest/v1/", ""), method = opts.method ?? "GET", params = [...u.searchParams];
    const rows = (db[table] ??= []);
    const ok = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    if (method === "GET") {
      const sel = u.searchParams.get("select");   // come PostgREST: solo le colonne richieste (un campo non richiesto arriva undefined)
      let r = matchesFilter(rows, params).map((x) => (sel && sel !== "*" ? Object.fromEntries(sel.split(",").map((c) => [c, x[c]])) : { ...x }));
      const order = u.searchParams.get("order");
      if (order) { const [col, dir] = order.split(",")[0].split("."); r.sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : 1) * (dir === "desc" ? -1 : 1)); }
      const off = Number(u.searchParams.get("offset") ?? 0), lim = Number(u.searchParams.get("limit") ?? 1000);
      return ok(r.slice(off, off + lim));
    }
    if (method === "POST") {
      const body = JSON.parse(opts.body), keys = (u.searchParams.get("on_conflict") ?? "").split(",").filter(Boolean);
      for (const row of body) {
        const i = keys.length ? rows.findIndex((x) => keys.every((k) => String(x[k]) === String(row[k]))) : -1;
        if (i >= 0) rows[i] = { ...rows[i], ...row }; else rows.push({ ...(table === "refresh_runs" ? { id: rows.length + 1 } : {}), ...row });
      }
      return ok([], 201);
    }
    if (method === "PATCH") { const hit = matchesFilter(rows, params); const body = JSON.parse(opts.body); hit.forEach((x) => Object.assign(x, body)); return ok(hit); }
    if (method === "DELETE") { const hit = new Set(matchesFilter(rows, params)); db[table] = rows.filter((x) => !hit.has(x)); return ok([...hit]); }
    throw new Error(`metodo ${method}`);
  };
  const afFetch = async (url) => {
    const u = new URL(url), ep = u.pathname.slice(1), q = Object.fromEntries(u.searchParams);
    log.af.push(`${ep}?${u.searchParams}`);
    let response = [], errors = [];
    if (ep === "fixtures" && q.league) response = fixtureList(LEAGUES.find((l) => String(l.afId) === q.league));
    else if (ep === "fixtures") response = [];
    else if (ep === "leagues") { const cfg = LEAGUES.find((l) => String(l.afId) === q.id); response = [{ seasons: [{ year: Number(q.season), coverage: { predictions: cfg.id !== "serbia", odds: true, injuries: true, standings: true, fixtures: { statistics_fixtures: true, lineups: true, events: true } } }] }]; }
    else if (ep === "odds/bets") response = [{ id: 5, name: "Goals Over/Under" }, { id: 1, name: "Match Winner" }, { id: 45, name: "Corners Over Under" }, { id: 55, name: "Corners 1x2" }];
    else if (ep === "predictions") {
      if (knobs.rateLimitPredictionFor === q.fixture) errors = { rateLimit: "Too many requests. You have exceeded the limit of requests per minute of your subscription." };
      else if (q.fixture.startsWith("286")) response = [];
      else response = [{ predictions: { winner: { name: "x" }, advice: "Double chance", percent: { home: "50%", draw: "30%", away: "20%" }, under_over: "-2.5" }, teams: { home: { name: "A", league: { goals: { for: { average: { home: "1.6" } }, against: { average: { home: "1.0" } } }, fixtures: { played: { total: 12 } } } }, away: { name: "B", league: { goals: { for: { average: { away: "1.1" } }, against: { average: { away: "1.4" } } }, fixtures: { played: { total: 12 } } } } } }];
    } else if (ep === "odds") {
      if (q.bet === "5") response = [{ bookmakers: [{ name: "Bk1", bets: [{ name: "Goals Over/Under", values: [{ value: "Over 2.5", odd: "1.9" }, { value: "Under 2.5", odd: "1.9" }] }] }] }];
      else if (q.bet === "1") response = [{ bookmakers: [{ name: "Bk1", bets: [{ name: "Match Winner", values: [{ value: "Home", odd: "2.0" }, { value: "Draw", odd: "3.4" }, { value: "Away", odd: "3.8" }] }] }] }];
      else response = [];
    } else if (ep === "fixtures/statistics") {
      const id = Number(q.fixture), cfg = LEAGUES.find((l) => Math.floor(id / 1000) === l.afId), t = teamsOf(cfg);
      response = knobs.noStatsFor.has(id) ? [] : [{ team: { id: t.a }, statistics: [{ type: "Corner Kicks", value: 6 }] }, { team: { id: t.b }, statistics: [{ type: "Corner Kicks", value: 4 }] }];
      // le squadre della partita: ricava dalle due righe sopra solo se coincidono; altrimenti il parser usa l'ordine
    } else response = [];
    knobs.used += 1;
    return new Response(JSON.stringify({ errors, results: Array.isArray(response) ? response.length : 0, response }), { status: 200, headers: { "content-type": "application/json", "x-ratelimit-requests-remaining": String(knobs.remaining - knobs.used), "x-ratelimit-requests-limit": "7500" } });
  };
  const fetchMock = async (url, opts) => {
    const s = String(url); log.urls.push(s);
    if (s.startsWith(SB)) return sbFetch(url, opts);
    if (s.startsWith(AF)) return afFetch(url, opts);
    throw new Error(`rete non prevista: ${s}`);
  };
  return { db, log, knobs, fetchMock, now };
}

const env = { SUPABASE_URL: SB, SUPABASE_SERVICE_ROLE_KEY: "sr", API_FOOTBALL_KEY: "k", SYNC_SECRET: "s", API_FOOTBALL_MIN_GAP_MS: "0", FIXTURES_DAYS: "7" };

test("giro completo + recupero automatico, con API-Football come unica fonte", async () => {
  const w = makeWorld(), real = globalThis.fetch;
  globalThis.fetch = w.fetchMock;
  // una partita vicina di Serie A: il pronostico incontra il limite di richieste durante il primo giro
  const seriea = LEAGUES.find((l) => l.id === "seriea"), limitedFixture = String(seriea.afId * 1000 + 4);
  w.knobs.rateLimitPredictionFor = limitedFixture;
  const wait = async () => {};
  try {
    /* ---- 1 · giro completo ---- */
    const m1 = await runRefresh(env, { mode: "full", wait, log: () => {} });
    assert.equal(m1.error, null, m1.error);
    assert.equal(m1.leagues.total, LEAGUES.length); assert.equal(m1.leagues.ok, LEAGUES.length, JSON.stringify(m1.leagues.failed));
    assert.equal(w.db.sync_state.length, LEAGUES.length, "ogni campionato ha lo stato di sincronizzazione");
    assert.equal(w.db.matches.length, LEAGUES.length * 5, "5 partite per campionato, tutte con id API-Football");
    assert.ok(w.db.matches.every((m) => /^af-\d+$/.test(m.game_id) && /^af-\d+$/.test(m.home_id)));
    assert.equal(w.log.urls.filter((u) => /ninja/i.test(u)).length, 0, "nessuna richiesta ad API Ninjas");
    assert.ok(w.log.af.some((c) => c.startsWith("fixtures?league=135")), "la Serie A (ex Ninjas) arriva da API-Football");
    assert.ok(w.log.af.some((c) => c.startsWith("fixtures?league=2&")), "anche la Champions League");
    assert.equal(m1.matches.eligible, LEAGUES.length * 2, "partite aperte nei prossimi 7 giorni: 2 per campionato");
    // quote reali di doppia chance (bet 12) e gol/no gol (bet 8): solo per le partite entro 36 ore (una per campionato nel mock), non per le lontane
    const dcCalls = w.log.af.filter((c) => c.startsWith("odds?") && /bet=12(&|$)/.test(c)).length, bttsCalls = w.log.af.filter((c) => c.startsWith("odds?") && /bet=8(&|$)/.test(c)).length;
    assert.ok(dcCalls >= LEAGUES.length - 2 && dcCalls <= LEAGUES.length + 2, `doppia chance: ${dcCalls} richieste (una per partita vicina)`); assert.equal(bttsCalls, dcCalls);
    // pronostico in errore temporaneo => parziale, con diagnostica precisa
    assert.equal(m1.status, "partial", JSON.stringify({ c: m1.components, e: m1.errors, p: m1.pending, n: m1.notes }));
    assert.equal(m1.components.prediction.temporary, 1);
    assert.deepEqual(m1.pending.map((p) => p.component).sort(), ["details", "prediction"], "anche la scheda dati della stessa partita resta incompleta");
    assert.deepEqual(w.db.refresh_tasks.map((t) => t.task_key).sort(), [`details:af-${limitedFixture}`, `prediction:af-${limitedFixture}`]);
    // Serbia: il piano non include i pronostici: NON è un errore
    assert.ok(m1.components.prediction.not_covered >= 2, JSON.stringify(m1.components.prediction));
    assert.equal(m1.components.prediction.error, 0);
    assert.ok(m1.components.prediction.ok >= 55);
    // partite lontane senza quote corner: "non ancora disponibile", non errore
    assert.equal(m1.components.corners.error, 0);
    assert.ok(m1.stats.updated > 100 && m1.stats.missing === 2, JSON.stringify(m1.stats));
    // istantanea scritta E riletta
    assert.equal(w.db.app_snapshot.length, 1); assert.equal(m1.verify.ok, true);
    const snap = w.db.app_snapshot[0];
    assert.ok(snap.payload.matches.length >= LEAGUES.length * 2 && snap.meta.v === 2 && snap.meta.status === "partial");
    assert.ok(snap.payload.matches.some((m) => m.pick), "i pronostici del modello sono calcolati");
    // corner storici reali scaricati e salvati (con le sole partite finite delle squadre in campo)
    assert.ok(w.db.match_corners.length > 0 && w.db.match_corners.every((r) => r.available && r.home_corners === 6 && r.away_corners === 4));
    assert.equal(m1.components.cornerStats.ok, w.db.match_corners.length);
    assert.equal(w.db.refresh_runs.length, 1);
    assert.ok(m1.requests.thisRun > 0 && m1.requests.remaining < 7500 && m1.requests.limit === 7500, JSON.stringify(m1.requests));
    // le chiamate ai dati del pronostico di una partita completata non si ripetono: cache
    const afCalls1 = w.log.af.length;

    /* ---- 2 · recupero: il limite è passato, il compito è scaduto ---- */
    w.knobs.rateLimitPredictionFor = null;
    for (const r of w.db.af_cache) if (r.error) r.expires_at = new Date(Date.now() - 1000).toISOString();
    for (const t of w.db.refresh_tasks) t.next_try_at = new Date(Date.now() - 1000).toISOString();
    const m2 = await runRefresh(env, { mode: "recover", wait, log: () => {} });
    const calls2 = w.log.af.length - afCalls1;
    assert.equal(m2.status, "ok", JSON.stringify({ c: m2.components, e: m2.errors, p: m2.pending, n: m2.notes }));
    assert.equal(w.db.refresh_tasks.length, 0, "compito chiuso dopo il recupero");
    assert.equal(m2.mode, "recover");
    assert.ok(calls2 < 40, `il recupero riprende solo ciò che manca: ${calls2} richieste (il giro completo ne ha fatte ${afCalls1})`);
    assert.ok(!w.log.af.slice(afCalls1).some((c) => c.startsWith("fixtures?league=")), "i campionati già aggiornati non si riscaricano");
    assert.equal(w.db.app_snapshot[0].meta.status, "ok"); assert.equal(m2.components.prediction.temporary, 0);
    assert.equal(m2.verify.ok, true);

    /* ---- 3 · recupero senza compiti: nessuna richiesta ---- */
    const before = w.log.urls.length;
    const m3 = await runRefresh(env, { mode: "recover", wait, log: () => {} });
    assert.equal(m3.status, "skipped");
    assert.ok(w.log.urls.slice(before).every((u) => u.startsWith(SB)), "nessuna chiamata ad API-Football");
    assert.equal(w.log.af.length, afCalls1 + calls2);
  } finally { globalThis.fetch = real; }
});

test("errori veri: un campionato che fallisce non ferma gli altri e resta da recuperare", async () => {
  const w = makeWorld(), real = globalThis.fetch;
  const base = w.fetchMock;
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes("/fixtures?league=135&")) { w.log.urls.push(String(url)); return new Response(JSON.stringify({ errors: { token: "Error/Missing application key" }, response: [] }), { status: 200 }); }
    return base(url, opts);
  };
  try {
    const m = await runRefresh(env, { mode: "full", wait: async () => {}, log: () => {} });
    assert.equal(m.leagues.ok, LEAGUES.length - 1); assert.equal(m.leagues.failed[0].id, "seriea");
    assert.match(m.leagues.failed[0].error, /application key/);
    assert.equal(m.status, "partial");
    assert.ok(w.db.refresh_tasks.some((t) => t.task_key === "league:seriea" && t.state === "error"));
    assert.ok(w.db.matches.some((x) => x.league === "epl"), "gli altri campionati sono stati salvati");
    assert.equal(m.errors[0].component, "league");
  } finally { globalThis.fetch = real; }
});
