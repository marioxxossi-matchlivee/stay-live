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
    async insertIgnore(table, rows, conflict) { if (db.failInsert) throw new Error("scrittura rifiutata (simulata)"); calls.inserts = (calls.inserts ?? 0) + rows.length; const ks = conflict.split(","); for (const r of rows) if (!tab(table).some((x) => ks.every((k) => x[k] === r[k]))) tab(table).push({ ...r }); },
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

const routes = () => [
  [/^\/upcoming\/matches\/atp/, F.upcomingAtp], [/^\/upcoming\/matches\/wta/, F.upcomingWta],
  [/^\/atp\/results\/2026-11-1[12]/, page(F.resultsAtp)], [/^\/wta\/results\/2026-11-1[12]/, page(F.resultsWta)],
  [/^\/extend\/api\/events\/live/, { success: true, results: F.live, count: F.live.length }],
  [/^\/atp\/ranking\/singles/, page(F.rankAtp)], [/^\/wta\/ranking\/singles/, page(F.rankWta)],
  [/^\/upcoming\/filters/, F.filters], [/\/player\/match-stats\//, F.stats24008],
];


// ═══ LIVE OBSERVATION: integrazione con il giro «refresh» (spenta per impostazione predefinita, mai bloccante, mai alteranti) ═══
const withEnv = async (v, fn) => { const old = process.env.TENNIS_LIVE_OBSERVATION; if (v == null) delete process.env.TENNIS_LIVE_OBSERVATION; else process.env.TENNIS_LIVE_OBSERVATION = v; try { return await fn(); } finally { if (old == null) delete process.env.TENNIS_LIVE_OBSERVATION; else process.env.TENNIS_LIVE_OBSERVATION = old; } };
const refresh = async (db, now = NOW) => runJob("refresh", { api: client(routes()), db, now });
const snap = (db) => JSON.stringify({ p: db.t.tennis_predictions, m: db.t.tennis_matches });

test("LIVE OBSERVATION spenta (predefinito): nessuna scrittura nelle nuove tabelle, meta.enabled=false", async () => {
  const db = fakeDb(); const r = await withEnv(null, () => refresh(db));
  assert.equal(r.meta.liveObservation.enabled, false); assert.equal((db.t.tennis_observations ?? []).length, 0); assert.equal((db.t.tennis_observation_versions ?? []).length, 0); assert.equal(db.calls.inserts ?? 0, 0);
});

test("accesa: registra rev 1 delle partite future pre-match e NON altera le probabilità operative né le scritture in tennis_predictions", async () => {
  const off = fakeDb(), on = fakeDb();
  await withEnv(null, () => refresh(off)); const r = await withEnv("on", () => refresh(on));
  assert.equal(snap(on), snap(off), "tennis_predictions e tennis_matches identici con e senza LIVE OBSERVATION");
  assert.ok(r.meta.liveObservation.enabled && !r.meta.liveObservation.error);
  const obs = on.t.tennis_observations, ver = on.t.tennis_observation_versions;
  assert.ok(obs.length > 0 && ver.length === obs.length && ver.every((v) => v.rev === 1 && v.reason === "initial"));
  for (const v of ver) { const p = on.t.tennis_predictions.find((x) => x.match_key === v.match_key); assert.equal(v.model_ver, p.model_ver); assert.equal(v.published, p.published); if (p.published) assert.ok(Math.abs(v.p1 - p.p1) < 1e-9); assert.ok(Date.parse(v.recorded_at) < Date.parse(v.starts_at)); }
  assert.deepEqual(r.meta.predictions, (await withEnv(null, () => refresh(fakeDb()))).meta.predictions);
});

test("idempotente: un secondo giro con gli stessi dati non crea né osservazioni né revisioni", async () => {
  const db = fakeDb(); await withEnv("on", () => refresh(db)); const n1 = db.t.tennis_observation_versions.length, o1 = db.t.tennis_observations.length;
  const r2 = await withEnv("on", () => refresh(db, NOW + 60e3));
  assert.equal(db.t.tennis_observation_versions.length, n1); assert.equal(db.t.tennis_observations.length, o1); assert.equal(r2.meta.liveObservation.newVersions, 0);
});

test("se la registrazione fallisce il refresh ordinario completa come prima e l'errore è nella diagnostica", async () => {
  const base = fakeDb(); await withEnv(null, () => refresh(base));
  const bad = fakeDb(); bad.failInsert = true; const r = await withEnv("on", () => refresh(bad));
  assert.ok(r.ok !== false); assert.match(r.meta.liveObservation.error, /rifiutata/); assert.equal(snap(bad), snap(base));
  const noMethod = fakeDb(); delete noMethod.insertIgnore; const r2 = await withEnv("on", () => refresh(noMethod));
  assert.match(r2.meta.liveObservation.error, /insertIgnore/); assert.equal(snap(noMethod), snap(base));
});

test("l'aggancio non dipende dal motore: computePredictions, loadHistory e la scrittura di tennis_predictions non nominano LIVE OBSERVATION", () => {
  const src = fs.readFileSync(new URL("../scripts/tennis-sync.js", import.meta.url), "utf8");
  for (const name of ["computePredictions", "loadHistory", "buildBook"]) { const i = src.indexOf(`function ${name}`); assert.ok(i >= 0, name); const body = src.slice(i, src.indexOf("\n}\n", i)); assert.ok(!/observation/i.test(body), `${name} non deve conoscere LIVE OBSERVATION`); }
  assert.ok(src.includes('db.upsert("tennis_predictions"'));
  assert.equal((src.match(/recordLiveObservation\(/g) ?? []).length, 1);
});
