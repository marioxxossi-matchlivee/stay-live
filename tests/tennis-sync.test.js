import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createClient } from "../functions/api/_tennis-client.js";
import { runJob, datesBack, ymd, dedupe, computePredictions, buildBook, upcomingRow, resultRow, LIMITS } from "../scripts/tennis-sync.js";
import { normalizeUpcoming, normalizeResult, readPage } from "../functions/api/_tennis-provider.js";
import { RatingBook } from "../functions/api/_tennis-model.js";

// Fixture = risposte REALI delle sonde del 12/11/2026 (elenchi ridotti dalla sonda a 3–10 elementi). Dati di prova creati nei test sono marcati "sintetico".
const F = JSON.parse(fs.readFileSync(new URL("./fixtures/tennis-real.json", import.meta.url), "utf8"));
const NOW = Date.parse("2026-11-12T23:00:00Z");

// ── Database simulato in memoria (solo filtri usati dallo script) ──
function fakeDb(seed = {}) {
  const t = {}; for (const [k, v] of Object.entries(seed)) t[k] = v.map((r) => ({ ...r }));
  const tab = (n) => (t[n] ??= []);
  const keyOf = { tennis_matches: ["match_key"], tennis_players: ["id"], tennis_predictions: ["match_key"], tennis_snapshot: ["id"], tennis_rankings: ["tour", "player_id"], tennis_player_stats: ["player_id", "tour", "surface"], tennis_live: ["match_key"], tennis_tournaments: ["id"], tennis_api_usage: ["day", "endpoint"], tennis_sync_state: ["id"] };
  const test = (row, f, v) => {
    const [op, ...rest] = String(v).split("."), val = rest.join(".");
    const x = row[f];
    if (op === "eq") return String(x) === val;
    if (op === "gte") return x != null && String(x) >= val; if (op === "lte") return x != null && String(x) <= val; if (op === "lt") return x != null && String(x) < val;
    if (op === "not") return val === "is.null" ? x != null : true;
    return true;
  };
  const calls = { upserts: [], rpc: [] };
  const db = {
    t, calls,
    async getAll(table, q = {}) {
      let rows = tab(table).filter((r) => Object.entries(q).every(([f, v]) => ["select", "order", "limit", "offset"].includes(f) || test(r, f, v)));
      if (table === "tennis_predictions" && /tennis_matches\(/.test(q.select ?? "")) rows = rows.map((p) => ({ ...p, tennis_matches: tab("tennis_matches").find((m) => m.match_key === p.match_key) ?? null }));
      return rows.map((r) => ({ ...r }));
    },
    async upsert(table, rows, conflict) {
      calls.upserts.push({ table, n: rows.length });
      const ks = conflict.split(",");
      for (const r of rows) { const i = tab(table).findIndex((x) => ks.every((k) => x[k] === r[k])); if (i >= 0) Object.assign(tab(table)[i], r); else tab(table).push({ ...r }); }
    },
    async patch(table, filter, body) { for (const r of tab(table)) if (Object.entries(filter).every(([f, v]) => test(r, f, v))) Object.assign(r, body); return 1; },
    async del(table, filter) { t[table] = tab(table).filter((r) => !Object.entries(filter).every(([f, v]) => test(r, f, v))); return 0; },
    async rpc(name, args) { calls.rpc.push(name); const r = tab("tennis_sync_state").find((x) => x.id === args.p_id); if (r?.locked_until && Date.parse(r.locked_until) > NOW) return false; if (r) r.locked_until = new Date(NOW + args.p_seconds * 1000).toISOString(); else tab("tennis_sync_state").push({ id: args.p_id, locked_until: new Date(NOW + args.p_seconds * 1000).toISOString() }); return true; },
  };
  return db;
}

// ── Provider simulato con le risposte reali ──
function fakeFetch(routes, log = []) {
  return async (url) => {
    const path = String(url).replace("https://api.sportsapi365.com/v1/tennis", ""); log.push(path);
    for (const [re, body] of routes) if (re.test(path)) return new Response(JSON.stringify(typeof body === "function" ? body(path) : body), { status: 200, headers: { "x-quota-limit": "200000", "x-quota-remaining": "199000", "x-ratelimit-remaining": "2999" } });
    return new Response("{}", { status: 404 });
  };
}
const client = (routes, log, o = {}) => createClient({ key: "SEGRETO-XYZ", fetchImpl: fakeFetch(routes, log), sleep: async () => {}, minGapMs: 0, ...o });
const page = (items, hasNext = false) => ({ data: items, page: 1, pageNo: 1, hasNextPage: hasNext });

test("client: chiave solo nell'intestazione, quota e limite letti dalle intestazioni, percorsi pericolosi rifiutati", async () => {
  let seen; const c = createClient({ key: "SEGRETO-XYZ", fetchImpl: async (u, o) => { seen = { u, o }; return new Response("{}", { headers: { "x-quota-remaining": "5", "x-quota-limit": "10", "x-ratelimit-remaining": "9" } }); }, sleep: async () => {}, minGapMs: 0 });
  await c.get("/atp/ranking/singles");
  assert.ok(!seen.u.includes("SEGRETO")); assert.equal(seen.o.headers["X-Gravitee-Api-Key"], "SEGRETO-XYZ");
  assert.equal(c.stats.quota.remaining, 5); assert.equal(c.stats.quota.limit, 10);
  await assert.rejects(() => c.get("https://evil.example/x")); await assert.rejects(() => c.get("/a/../b"));
});
test("client: 429/5xx ritentati, 4xx no, errori senza segreti, tetto di richieste", async () => {
  let n = 0; const c = createClient({ key: "K9", fetchImpl: async () => (++n < 3 ? new Response("x", { status: 503 }) : new Response("{\"ok\":1}", { status: 200 })), sleep: async () => {}, minGapMs: 0 });
  assert.deepEqual(await c.get("/x"), { ok: 1 }); assert.equal(n, 3); assert.equal(c.stats.errors, 2);
  let m = 0; const d = createClient({ key: "K9", fetchImpl: async () => { m++; return new Response("chiave K9 negata", { status: 403 }); }, sleep: async () => {}, minGapMs: 0 });
  await assert.rejects(() => d.get("/x"), (e) => !/K9/.test(e.message) && e.status === 403); assert.equal(m, 1);
  const e = createClient({ key: "K9", fetchImpl: async () => { throw new Error("rete giù K9"); }, sleep: async () => {}, minGapMs: 0, retries: 1 });
  await assert.rejects(() => e.get("/x"), (x) => !/K9/.test(x.message));
  const cap = createClient({ key: "K9", fetchImpl: async () => new Response("{}"), sleep: async () => {}, minGapMs: 0, maxRequests: 2 });
  await cap.get("/a"); await cap.get("/b"); await assert.rejects(() => cap.get("/c"), /Tetto/);
  const to = createClient({ key: "K9", fetchImpl: (u, o) => new Promise((_, rej) => o.signal.addEventListener("abort", () => rej(Object.assign(new Error("x"), { name: "AbortError" })))), sleep: async () => {}, minGapMs: 0, timeoutMs: 5, retries: 0 });
  await assert.rejects(() => to.get("/x"), /timeout/);
});
test("paginazione: scorre le pagine, si ferma se la pagina si ripete o supera il massimo", async () => {
  const mk = (id) => ({ id }); let calls = 0;
  const c = createClient({ key: "K", fetchImpl: async (u) => { calls++; const p = Number(/pageNo=(\d+)/.exec(u)[1]); return new Response(JSON.stringify({ data: [mk(p * 10), mk(p * 10 + 1)], hasNextPage: p < 3 })); }, sleep: async () => {}, minGapMs: 0 });
  const r = await c.paginate((p) => `/x?pageNo=${p}`, readPage); assert.equal(r.items.length, 6); assert.equal(r.complete, true); assert.equal(calls, 3);
  const same = createClient({ key: "K", fetchImpl: async () => new Response(JSON.stringify({ data: [mk(1)], hasNextPage: true })), sleep: async () => {}, minGapMs: 0 });
  const r2 = await same.paginate((p) => `/x?pageNo=${p}`, readPage); assert.equal(r2.items.length, 1); assert.equal(r2.complete, false); assert.match(r2.warnings.join(" "), /ripete/);
  const r3 = await createClient({ key: "K", fetchImpl: async (u) => new Response(JSON.stringify({ data: [mk(Math.random())], hasNextPage: true })), sleep: async () => {}, minGapMs: 0 }).paginate((p) => `/x?pageNo=${p}`, readPage, { maxPages: 3 });
  assert.equal(r3.items.length, 3); assert.equal(r3.complete, false);
});

test("date: giorni UTC a ritroso", () => { assert.deepEqual(datesBack(NOW, 3), ["2026-11-12", "2026-11-11", "2026-11-10"]); assert.equal(ymd(NOW), "2026-11-12"); });

test("righe per il database: colonne fisse, programma e risultati non si sovrascrivono a vicenda", () => {
  const up = normalizeUpcoming(F.upcomingWta.matches[0], "wta"), rs = normalizeResult(F.resultsWta[0], "wta");
  const a = upcomingRow(up, "x"), b = resultRow(rs, "x");
  assert.ok(!("winner" in a) && !("best_of" in a) && !("score" in a));      // il programma non può azzerare l'esito
  assert.ok(!("odds_sources" in b) && !("h2h" in b));                       // i risultati non azzerano le quote
  assert.equal(b.src_endpoint, "results"); assert.equal(a.src_endpoint, "upcoming"); assert.equal(a.source, "sportsapi365");
  assert.equal(dedupe([{ match_key: "k", v: 1 }, { match_key: "k", v: 2 }]).length, 1);
});

const routes = () => [
  [/^\/upcoming\/matches\/atp/, F.upcomingAtp], [/^\/upcoming\/matches\/wta/, F.upcomingWta],
  [/^\/atp\/results\/2026-11-1[12]/, page(F.resultsAtp)], [/^\/wta\/results\/2026-11-1[12]/, page(F.resultsWta)],
  [/^\/extend\/api\/events\/live/, { success: true, results: F.live, count: F.live.length }],
  [/^\/atp\/ranking\/singles/, page(F.rankAtp)], [/^\/wta\/ranking\/singles/, page(F.rankWta)],
  [/^\/upcoming\/filters/, F.filters], [/\/player\/match-stats\//, F.stats24008],
];

test("giro refresh: programma e risultati reali → database → pronostici → snapshot", async () => {
  const db = fakeDb(); const log = [];
  const r = await runJob("refresh", { api: client(routes(), log), db, now: NOW });
  assert.equal(r.ok, true, r.error);
  const matches = db.t.tennis_matches; assert.ok(matches.length >= 20, `partite ${matches.length}`);
  assert.ok(matches.some((m) => m.src_endpoint === "upcoming" && m.status === "scheduled")); assert.ok(matches.some((m) => m.src_endpoint === "results" && m.status === "finished" && m.winner));
  assert.ok(matches.every((m) => !/\//.test(`${m.p1_name}${m.p2_name}`)), "nessun doppio");
  assert.ok(matches.some((m) => m.category === "challenger") && matches.some((m) => m.category === "itf") && matches.some((m) => m.category === "tour"));
  assert.ok(matches.filter((m) => m.src_endpoint === "results").every((m) => m.surface), "superficie dai risultati via courtId");
  // senza storico sufficiente il modello si astiene e lo registra
  const preds = db.t.tennis_predictions; assert.ok(preds.length >= 1); assert.ok(preds.every((p) => p.published === false && p.abstain_reason && p.bet.verdict === "EVITA"));
  const snap = db.t.tennis_snapshot.find((s) => s.id === "board").payload;
  assert.ok(snap.matches.length >= 20); assert.equal(snap.diagnostics.counts.live, 0);
  assert.ok(snap.diagnostics.provider.quota.remaining === 199000); assert.ok(!JSON.stringify(snap).includes("SEGRETO"));
  assert.ok(log.length <= LIMITS.refresh); assert.ok(log.every((p) => !p.includes("SEGRETO")));
  const st = db.t.tennis_sync_state.find((s) => s.id === "refresh"); assert.ok(st.last_ok && st.locked_until === null);
  assert.ok(db.t.tennis_api_usage.length >= 1);
});

test("giro refresh: un risultato già concluso non viene riportato a 'programmata'; nuova esecuzione = stesse righe (idempotenza)", async () => {
  const db = fakeDb(); await runJob("refresh", { api: client(routes()), db, now: NOW });
  const n1 = db.t.tennis_matches.length;
  const fin = db.t.tennis_matches.find((m) => m.status === "finished");
  const upKey = fin.match_key; // il programma ripropone la stessa chiave come "scheduled": deve restare conclusa
  const r2 = routes(); r2[0] = [/^\/upcoming\/matches\/atp/, { matches: [{ ...F.upcomingAtp.matches[0] }], hasNextPage: false }];
  db.t.tennis_sync_state.forEach((s) => { s.locked_until = null; });
  await runJob("refresh", { api: client(r2), db, now: NOW + 60e3 });
  assert.equal(db.t.tennis_matches.find((m) => m.match_key === upKey).status, "finished"); assert.ok(db.t.tennis_matches.length >= n1 - 3);
});

test("giro live: feed reale, set in ordine canonico, snapshot con partita in corso", async () => {
  const db = fakeDb(); await runJob("refresh", { api: client(routes()), db, now: NOW });
  db.t.tennis_sync_state.forEach((s) => { s.locked_until = null; });
  // una partita del feed live presente anche in tennis_matches (programmata): deve risultare "in corso"
  const lv = F.live[0], [a, b, tn, rd] = lv.matchKey.split("-");
  const key = `${tn}|${rd}|${[a, b].sort((x, y) => x - y).join("|")}`;
  db.t.tennis_matches.push({ match_key: key, tour: lv.tourType, tournament: lv.league, tournament_id: tn, round_id: Number(rd), category: "itf", surface: "Hard", starts_at: "2026-11-12T20:00:00.000Z", status: "scheduled", p1_id: String(Math.min(a, b)), p2_id: String(Math.max(a, b)), p1_name: "Giocatore A", p2_name: "Giocatore B", odds_sources: [] });
  const r = await runJob("live", { api: client(routes()), db, now: NOW });
  assert.equal(r.ok, true, r.error); assert.equal(r.meta.live.recognised, F.live.length);
  const snap = db.t.tennis_snapshot.find((s) => s.id === "board").payload;
  const m = snap.matches.find((x) => x.key === key); assert.equal(m.status, "live"); assert.ok(Array.isArray(m.live.sets) && m.live.sets.length >= 2);
  assert.equal(snap.diagnostics.counts.live >= 1, true);
});

test("blocco anti-sovrapposizione: un secondo giro dello stesso tipo viene saltato senza richieste", async () => {
  const db = fakeDb(); const log = [];
  await db.rpc("tennis_acquire_lock", { p_id: "refresh", p_seconds: 600 });
  const r = await runJob("refresh", { api: client(routes(), log), db, now: NOW });
  assert.ok(r.skipped); assert.equal(log.length, 0);
});

test("errore del provider: giro fallito con messaggio senza segreti, stato registrato, blocco rilasciato", async () => {
  const db = fakeDb();
  const bad = createClient({ key: "SEGRETO-XYZ", fetchImpl: async () => new Response("chiave SEGRETO-XYZ non valida", { status: 401 }), sleep: async () => {}, minGapMs: 0 });
  const r = await runJob("live", { api: bad, db, now: NOW });
  assert.equal(r.ok, false); assert.ok(!r.error.includes("SEGRETO"));
  const st = db.t.tennis_sync_state.find((s) => s.id === "live"); assert.ok(st.last_error && !st.last_error.includes("SEGRETO") && st.locked_until === null && !st.last_ok);
  assert.ok(!JSON.stringify(db.t).includes("SEGRETO"));
});

test("giro statico: ranking, tornei, statistiche (solo valori plausibili), backtest registrato", async () => {
  const db = fakeDb(); await runJob("refresh", { api: client(routes()), db, now: NOW });
  db.t.tennis_sync_state.forEach((s) => { s.locked_until = null; });
  const r = await runJob("static", { api: client(routes()), db, now: NOW });
  assert.equal(r.ok, true, r.error);
  assert.equal(db.t.tennis_rankings.filter((x) => x.tour === "atp").length, F.rankAtp.length); assert.ok(db.t.tennis_rankings.every((x) => x.position >= 1));
  assert.ok(db.t.tennis_tournaments.length >= 3); assert.ok(db.t.tennis_player_stats.length >= 1);
  const s = db.t.tennis_player_stats[0]; assert.ok(s.serve_pts_won > 0.4 && s.serve_pts_won < 0.85 && s.return_pts_won > 0.2 && s.return_pts_won < 0.55);
  const bt = db.t.tennis_snapshot.find((x) => x.id === "backtest").payload; assert.match(bt.verdict, /insufficiente/); assert.equal(bt.calibrator, null);
  const snap = db.t.tennis_snapshot.find((x) => x.id === "board").payload; assert.ok(snap.diagnostics.counts.rankedAtp === F.rankAtp.length);
});

test("pronostici: con storico sintetico il modello pubblica, quote reali → verdetto; senza quote EVITA; dopo l'inizio non si ricalcola", () => {
  // SINTETICO (solo test): 40 giocatori che si affrontano per costruire uno storico sufficiente.
  const book = new RatingBook(); let t = Date.parse("2026-06-01");
  for (let i = 0; i < 40; i++) { book.update({ t: t += 86400e3, winnerId: "A", loserId: `x${i % 8}`, surface: "hard" }); book.update({ t: t += 86400e3, winnerId: `y${i % 8}`, loserId: "B", surface: "hard" }); }
  const m = (o) => ({ match_key: "k", status: "scheduled", starts_at: "2026-11-13T15:00:00Z", tour: "atp", surface: "Hard", best_of: null, category: "tour", p1_id: "A", p2_id: "B", p1_name: "A", p2_name: "B", h2h: null, odds_fetched_at: "2026-11-13T13:50:00Z", odds_sources: [{ book: "Pinnacle", p1: 1.6, p2: 2.4 }], ...o });
  const now = Date.parse("2026-11-13T14:00:00Z");
  const [p] = computePredictions({ matches: [m({})], book, stats: new Map(), ranks: new Map(), calibrator: null, now });
  assert.equal(p.published, true); assert.equal(p.pick, 1); assert.ok(Math.abs(p.p1 + p.p2 - 1) < 0.001); assert.ok(p.missing.some((x) => /formato/.test(x)));
  assert.ok(["BET", "EVITA"].includes(p.bet.verdict)); assert.ok(p.bet.odds === 1.6 && p.bet.ev !== null);
  const [q] = computePredictions({ matches: [m({ odds_sources: [] })], book, stats: new Map(), ranks: new Map(), calibrator: null, now });
  assert.equal(q.bet.verdict, "EVITA"); assert.equal(q.bet.ev, null); assert.equal(q.odds_p1, null);
  assert.equal(computePredictions({ matches: [m({ starts_at: "2026-11-13T13:00:00Z" })], book, stats: new Map(), ranks: new Map(), calibrator: null, now }).length, 0); // già iniziata: nessun nuovo pronostico
  const [r] = computePredictions({ matches: [m({})], book, stats: new Map(), ranks: new Map(), calibrator: null, now: now + 1 });
  assert.equal(r.p1, p.p1); // deterministico
});

test("storico del modello: solo conclusi regolarmente con vincitore", async () => {
  const { loadHistory } = await import("../scripts/tennis-sync.js");
  const db = fakeDb({ tennis_matches: [
    { match_key: "a", status: "finished", winner: 1, p1_id: "1", p2_id: "2", starts_at: "2026-11-10T10:00:00Z", surface: "Hard", tour: "atp" },
    { match_key: "b", status: "ended_other", winner: null, p1_id: "1", p2_id: "3", starts_at: "2026-11-10T11:00:00Z", surface: "Hard", tour: "atp" },
    { match_key: "c", status: "finished", winner: 2, p1_id: "4", p2_id: "5", starts_at: "2026-11-11T11:00:00Z", surface: "Clay", tour: "wta" } ] });
  const h = await loadHistory(db, NOW); assert.equal(h.length, 2); assert.deepEqual([h[0].winnerId, h[0].loserId, h[1].winnerId], ["1", "2", "5"]);
});
test("buildBook: aggiornamento in ordine", () => { const b = buildBook([{ t: 1, winnerId: "a", loserId: "b", surface: "Hard" }]); assert.ok(b.view("a", "hard").elo > b.view("b", "hard").elo); });
