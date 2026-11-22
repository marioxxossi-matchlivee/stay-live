import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { RatingBook } from "../functions/api/_tennis-model.js";
import { OBSERVATION, REVISION_REASONS, planObservations, revisionReason, observationState, prospectiveMetrics, revisionStats, blockBootstrap, ratingsVersion, historyFingerprint, checkHistoryPrematch, modelInputs } from "../functions/api/_tennis-observation.js";
import { buildBook, computePredictions } from "../scripts/tennis-sync.js";
import { predictMatch } from "../functions/api/_tennis-model.js";
import { PAGE, parseParams, decodeCursor, loadObservationPage, getAllStrict, inList } from "../functions/api/_tennis-observation-read.js";
import { recordLiveObservation, liveObservationEnabled } from "../functions/api/_tennis-observation-run.js";
import { buildModel, filterItems, detailHtml, liveObservationHtml, DEFAULT_LO } from "../src/tennis/observation.js";

const NOW = Date.parse("2026-11-21T10:00:00Z"), H = 36e5, ISO = (t) => new Date(t).toISOString();
const mkHist = (n = 50, o = {}) => Array.from({ length: n }, (_, i) => ({ t: NOW - (n - i + 1) * 864e5, winnerId: `w${i % 7}`, loserId: `l${i % 5}`, surface: "Clay", tour: "atp", ...o }));
const history = mkHist(), fp = historyFingerprint(history, "offset", NOW), ratings = fp;
const mkMatch = (n, o = {}) => ({ match_key: `t|r|${n}a|${n}b`, status: "scheduled", starts_at: ISO(NOW + 5 * H), tour: "atp", tournament_id: "T1", tournament: "Torneo 1", category: "challenger", round_id: 5, p1_id: `${n}a`, p2_id: `${n}b`, p1_name: `Uno ${n}`, p2_name: `Due ${n}`, best_of: 3, ...o });
const mkRow = (m, o = {}) => ({ match_key: m.match_key, surface: "clay", model_ver: "tennis-v2", published: true, pick: 1, p1: 0.62, p2: 0.38, reliability: "media", missing: ["scontri diretti"], components: { eloDiff: 40 }, reasons: ["x"], abstain_reason: null, ...o });
const emptyEx = () => ({ observed: new Set(), last: new Map() });
const book = () => { const b = new RatingBook(); b.players.set("1a", { elo: 1620, n: 30, surf: { clay: { elo: 1650, n: 10 } }, results: [{ t: NOW - 3 * 864e5, win: true, exp: 0.5 }] }); return b; };

function memDb() {
  const t = { tennis_observations: [], tennis_observation_versions: [] };
  return { t, async getAll(table) { return (t[table] ?? []).map((r) => ({ ...r })); },
    async insertIgnore(table, rows, conflict) { const ks = conflict.split(","); for (const r of rows) if (!t[table].some((x) => ks.every((k) => x[k] === r[k]))) t[table].push(JSON.parse(JSON.stringify(r))); } };
}
const run = (db, matches, rows, now = NOW, b = book(), h = history) => recordLiveObservation({ db, matches, rows, book: b, stats: new Map(), ranks: new Map(), now, history: h, loader: "offset", enabled: true });

test("2) prima valutazione: rev 1 'initial' con Elo, forma, dati mancanti, versioni e istante precedente all'inizio", () => {
  const m = mkMatch(1), plan = planObservations({ matches: [m], rows: [mkRow(m)], book: book(), stats: new Map(), ranks: new Map(), existing: emptyEx(), now: NOW, ratings: fp });
  assert.equal(plan.observations.length, 1); assert.equal(plan.versions.length, 1);
  const v = plan.versions[0]; assert.equal(v.rev, 1); assert.equal(v.reason, "initial"); assert.equal(v.model_ver, "tennis-v2"); assert.equal(v.ratings_ver, ratingsVersion(fp)); assert.equal(v.history_matches, 50); assert.ok(Date.parse(v.history_last_at) <= Date.parse(v.recorded_at));
  assert.ok(v.elo1 > 1600 && v.form1 != null && v.elo2 === 1500 && v.form2 === null, "Elo e forma letti dal RatingBook; forma assente = null, non inventata");
  assert.deepEqual(v.missing, ["scontri diretti"]); assert.ok(Date.parse(v.recorded_at) < Date.parse(v.starts_at)); assert.equal(plan.observations[0].p1_id, "1a");
});

test("1) 6) solo partite future 'scheduled' con id e modello; le altre sono saltate con motivo (nessun dato dopo l'inizio)", () => {
  const ms = [mkMatch(1, { status: "live" }), mkMatch(2, { starts_at: ISO(NOW - H) }), mkMatch(3, { status: "finished" }), mkMatch(4, { p2_id: null }), mkMatch(5), mkMatch(6, { status: "postponed" }), mkMatch(7, { status: "cancelled" })];
  const plan = planObservations({ matches: ms, rows: ms.map((m) => mkRow(m)), book: book(), existing: emptyEx(), now: NOW, ratings: fp });
  assert.deepEqual(plan.versions.map((v) => v.match_key), [ms[4].match_key]); assert.equal(plan.skipped.length, 6);
  assert.ok(plan.skipped.some((s) => /pre-match/.test(s.why)));
});

test("4) 13) revisioni separate: soglia sulla probabilità, versione del modello, pubblicazione, dati mancanti, orario; la rev 1 non cambia", async () => {
  const m = mkMatch(1), db = memDb(); await run(db, [m], [mkRow(m)]);
  const rev1 = JSON.stringify(db.t.tennis_observation_versions[0]);
  await run(db, [m], [mkRow(m, { p1: 0.625, p2: 0.375 })], NOW + H); assert.equal(db.t.tennis_observation_versions.length, 1, "scarto < 1 punto: nessuna riga");
  await run(db, [m], [mkRow(m, { p1: 0.64, p2: 0.36 })], NOW + 2 * H); await run(db, [m], [mkRow(m, { p1: 0.64, p2: 0.36, model_ver: "tennis-v3" })], NOW + 3 * H);
  await run(db, [m], [mkRow(m, { p1: 0.64, p2: 0.36, model_ver: "tennis-v3", missing: [] })], NOW + 3.5 * H);
  await run(db, [mkMatch(1, { starts_at: ISO(NOW + 6 * H) })], [mkRow(m, { p1: 0.64, p2: 0.36, model_ver: "tennis-v3", missing: [] })], NOW + 4 * H);
  await run(db, [mkMatch(1, { starts_at: ISO(NOW + 6 * H) })], [mkRow(m, { published: false, pick: null, p1: null, p2: null, model_ver: "tennis-v3", missing: [] })], NOW + 4.5 * H);
  const vs = db.t.tennis_observation_versions;
  assert.deepEqual(vs.map((v) => [v.rev, v.reason]), [[1, "initial"], [2, "probability"], [3, "model_version"], [4, "missing_data"], [5, "rescheduled"], [6, "publication"]]);
  assert.ok(REVISION_REASONS.includes("ratings_version"));
  assert.equal(JSON.stringify(vs[0]), rev1, "la valutazione iniziale resta byte per byte identica");
  assert.equal(db.t.tennis_observations.length, 1);
});

test("5) 17) senza duplicati: ripetere lo stesso giro non aggiunge nulla; due giri con lo stesso input danno lo stesso registro", async () => {
  const ms = [mkMatch(1), mkMatch(2)], rows = ms.map((m) => mkRow(m)), db = memDb();
  await run(db, ms, rows); const a = JSON.stringify(db.t); const r = await run(db, ms, rows, NOW + 1000);
  assert.equal(r.newVersions, 0); assert.equal(JSON.stringify(db.t), a);
  const db2 = memDb(); await run(db2, ms, rows); assert.deepEqual(db2.t, JSON.parse(a));
});

test("12) nessun look-ahead: i dati salvati sono una fotografia; cambiare il RatingBook dopo non modifica la registrazione; a partita iniziata non si registra", async () => {
  const m = mkMatch(1), db = memDb(), b = book(); await run(db, [m], [mkRow(m)], NOW, b);
  const saved = JSON.stringify(db.t.tennis_observation_versions[0]); b.players.get("1a").elo = 2000; b.players.get("1a").results.push({ t: NOW + 1, win: false, exp: 0.9 });
  assert.equal(JSON.stringify(db.t.tennis_observation_versions[0]), saved);
  const late = await run(memDb(), [m], [mkRow(m)], Date.parse(m.starts_at) + 1); assert.equal(late.newVersions, 0);
  const at = planObservations({ matches: [m], rows: [mkRow(m)], book: b, existing: emptyEx(), now: Date.parse(m.starts_at) - 1, ratings: historyFingerprint(history, "offset", Date.parse(m.starts_at) - 1) }).versions[0];
  assert.ok(at.form1 === null || Number.isFinite(at.form1)); // la forma ignora le partite con t >= inizio (RatingBook.form(id, at))
});

test("6) identificazione: collegamento per id; nomi uguali ma id diversi non si associano; stati dei risultati", () => {
  const o = { p1_id: "1a", p2_id: "1b" }, mt = (x) => ({ p1_id: "1a", p2_id: "1b", starts_at: ISO(NOW + H), status: "scheduled", ...x });
  assert.equal(observationState(o, mt({}), NOW), "upcoming");
  assert.equal(observationState(o, mt({ starts_at: ISO(NOW - H) }), NOW), "awaiting_result", "scheduled oltre l'orario non è conclusa");
  assert.equal(observationState(o, mt({ status: "finished", winner: null }), NOW), "awaiting_result");
  assert.equal(observationState(o, mt({ status: "finished", winner: 2 }), NOW), "concluded");
  for (const s of ["live", "postponed", "cancelled", "interrupted", "ended_other"]) assert.equal(observationState(o, mt({ status: s }), NOW), s);
  assert.equal(observationState(o, mt({ status: "finished", winner: 1, p1_id: "9a", p1_name: "Uno 1" }), NOW), "identity_mismatch");
  assert.equal(observationState(o, null, NOW), "unknown");
});

test("7) 10) 11) metriche: solo rev 1, esclusioni contate, campione insufficiente dichiarato, riproducibili", () => {
  const mk = (i, p1, winner, state = "concluded", pub = true) => ({ initial: { published: pub, p1, missing: i % 2 ? ["h2h"] : [] }, state, winner, startsAt: ISO(NOW + i * 864e5), tournamentId: `T${i % 7}`, tournament: `T${i % 7}` });
  const items = [mk(1, 0.7, 1), mk(2, 0.7, 2), mk(3, 0.6, 1), mk(4, 0.5, 1, "concluded", false), mk(5, 0.6, 1, "postponed"), mk(6, 0.6, 1, "cancelled"), mk(7, 0.6, 1, "ended_other"), mk(8, 0.6, 1, "awaiting_result"), { initial: null, state: "concluded", winner: 1 }, mk(9, 0.6, 1, "identity_mismatch")];
  const m = prospectiveMetrics(items);
  assert.equal(m.valid, 3); assert.deepEqual(m.excluded, { abstained: 1, notConcluded: 1, retiredOrWalkover: 1, cancelledOrPostponed: 2, identityMismatch: 1, noInitial: 1 });
  assert.equal(m.sufficient, false); assert.match(m.note, /insufficiente/); assert.ok(Math.abs(m.brier.est - (0.09 + 0.49 + 0.16) / 3) < 1e-4);
  assert.deepEqual(prospectiveMetrics(items), m, "stesso seme, stesso risultato"); assert.equal(prospectiveMetrics([]).brier, null);
  assert.ok(m.missingData.h2h >= 1);
  const big = Array.from({ length: 400 }, (_, i) => mk(i, 0.6, i % 5 ? 1 : 2)).map((x, i) => ({ ...x, tournamentId: `B${i % 60}`, startsAt: ISO(NOW + (i % 60) * 7 * 864e5) }));
  assert.equal(prospectiveMetrics(big).sufficient, true);
});

test("13) le revisioni non entrano nelle metriche: cambiare le versioni successive non cambia i risultati; analisi di stabilità separata", () => {
  const initial = { published: true, p1: 0.6, missing: [] }, a = [{ initial, state: "concluded", winner: 1, startsAt: ISO(NOW), tournamentId: "A" }], b = [{ initial, last: { p1: 0.95 }, state: "concluded", winner: 1, startsAt: ISO(NOW), tournamentId: "A" }];
  assert.deepEqual(prospectiveMetrics(a), prospectiveMetrics(b));
  const s = revisionStats(new Map([["k", [{ rev: 1, published: true, p1: 0.6, reason: "initial" }, { rev: 2, published: true, p1: 0.7, reason: "probability" }]], ["j", [{ rev: 1, published: true, p1: 0.6, reason: "initial" }]]]));
  assert.equal(s.withRevisions, 1); assert.equal(s.meanAbsShift, 0.1); assert.equal(blockBootstrap([], () => 0).est, null);
});

test("revisionReason: nessun cambiamento rilevante = nessuna riga", () => {
  const last = { rev: 1, starts_at: ISO(NOW + H), model_ver: "v", published: true, p1: 0.6, missing: ["a", "b"] };
  assert.equal(revisionReason(last, { ...last, missing: ["b", "a"], p1: 0.605 }), null);
  assert.equal(revisionReason(last, { ...last, p1: 0.61 }), "probability"); assert.equal(revisionReason(null, last), "initial");
});

test("9) 10) errori e spegnimento: spenta non tocca il database; un errore non lancia e finisce in diagnostica", async () => {
  const touched = []; const spy = { getAll: async () => touched.push("g"), insertIgnore: async () => touched.push("i") };
  assert.deepEqual(await recordLiveObservation({ db: spy, matches: [], rows: [], now: NOW, enabled: false }), { enabled: false }); assert.equal(touched.length, 0);
  const m = mkMatch(1), res = await recordLiveObservation({ db: { getAll: async () => { throw new Error("rete assente"); }, insertIgnore: async () => {} }, matches: [m], rows: [mkRow(m)], book: book(), now: NOW, history, loader: "offset", enabled: true });
  assert.match(res.error, /rete assente/); assert.equal(res.enabled, true);
  assert.equal(liveObservationEnabled({}), false); assert.equal(liveObservationEnabled({ TENNIS_LIVE_OBSERVATION: "on" }), true); assert.equal(liveObservationEnabled({ TENNIS_LIVE_OBSERVATION: "true" }), false);
});

test("riprendibile: se il giro si interrompe tra anagrafica e versione, il giro successivo completa senza perdere né duplicare", async () => {
  const m = mkMatch(1), db = memDb(), real = db.insertIgnore; let fail = true;
  db.insertIgnore = async (t, r, c) => { if (t === "tennis_observation_versions" && fail) throw new Error("interrotto"); return real(t, r, c); };
  const r1 = await run(db, [m], [mkRow(m)]); assert.ok(r1.error); assert.equal(db.t.tennis_observations.length, 1); assert.equal(db.t.tennis_observation_versions.length, 0);
  fail = false; await run(db, [m], [mkRow(m)], NOW + H); assert.equal(db.t.tennis_observations.length, 1); assert.equal(db.t.tennis_observation_versions.length, 1); assert.equal(db.t.tennis_observation_versions[0].rev, 1);
});

// ── Interfaccia (14) ──
const payload = () => ({ available: true, days: 30, builtAt: ISO(NOW), diagnostics: { enabled: true, newObservations: 2, newVersions: 2 },
  observations: [
    { match_key: "k1", tour: "atp", tournament_id: "T1", tournament: "Torneo 1", surface: "clay", p1_id: "a", p2_id: "b", p1_name: "Mario <b>", p2_name: "Luca", first_starts_at: ISO(NOW - 5 * H), first_recorded_at: ISO(NOW - 9 * H), match_status: "finished", match_starts_at: ISO(NOW - 5 * H), winner: 1, score: "6-4 6-3", identity_ok: true, state: "concluded" },
    { match_key: "k2", tour: "atp", tournament_id: "T1", tournament: "Torneo 1", surface: "clay", p1_id: "c", p2_id: "d", p1_name: "Anna", p2_name: "Eva", first_starts_at: ISO(NOW + 3 * H), first_recorded_at: ISO(NOW - H), match_status: "scheduled", match_starts_at: ISO(NOW + 3 * H), winner: null, identity_ok: true, state: "upcoming" },
    { match_key: "k3", tour: "wta", tournament_id: "T2", tournament: "Torneo 2", surface: "hard", p1_id: "e", p2_id: "f", p1_name: "Zed", p2_name: "Yan", first_starts_at: ISO(NOW - 30 * H), first_recorded_at: ISO(NOW - 40 * H), match_status: "scheduled", match_starts_at: ISO(NOW - 30 * H), winner: null, identity_ok: true, state: "awaiting_result" }],
  versions: [
    { match_key: "k1", rev: 2, recorded_at: ISO(NOW - 7 * H), starts_at: ISO(NOW - 5 * H), reason: "probability", model_ver: "tennis-v2", published: true, pick: 1, p1: 0.7, p2: 0.3, elo1: 1640, elo2: 1590, form1: 0.1, form2: null, inputs: {}, missing: [] },
    { match_key: "k1", rev: 1, recorded_at: ISO(NOW - 9 * H), starts_at: ISO(NOW - 5 * H), reason: "initial", model_ver: "tennis-v2", published: true, pick: 1, p1: 0.62, p2: 0.38, reliability: "media", elo1: 1630, elo2: 1590, form1: 0.1, form2: null, inputs: { p1: { matches: 30 }, rank: {}, serveStats: {}, h2h: null }, missing: ["scontri diretti"], history_loader: "offset", history_matches: 80000 },
    { match_key: "k2", rev: 1, recorded_at: ISO(NOW - H), starts_at: ISO(NOW + 3 * H), reason: "initial", model_ver: "tennis-v2", published: false, p1: null, p2: null, elo1: 1500, elo2: 1500, inputs: {}, missing: [] }] });

test("14) storico e dettaglio: iniziale e revisioni distinte in ordine cronologico, risultato, nulla di inventato, HTML escapato", () => {
  const model = buildModel(payload(), NOW); const k1 = model.items.find((i) => i.key === "k1");
  assert.equal(k1.initial.rev, 1); assert.equal(k1.last.rev, 2); assert.deepEqual(k1.versions.map((v) => v.rev), [1, 2]); assert.equal(k1.state, "concluded");
  assert.equal(model.items.find((i) => i.key === "k3").state, "awaiting_result");
  const h = detailHtml(k1); assert.match(h, /Valutazione iniziale \(permanente\)/); assert.match(h, /rev 1.*rev 2/s); assert.ok(h.includes("62%")); assert.ok(h.includes("non disponibili")); assert.ok(!h.includes("<b>Mario"), "nessun HTML dai dati");
  assert.match(detailHtml(model.items.find((i) => i.key === "k3")), /NON è considerata conclusa/); assert.match(detailHtml(model.items.find((i) => i.key === "k2")), /astensione|astenuta/);
  assert.equal(filterItems(model.items, { ...DEFAULT_LO.f, state: "concluded" }).length, 1); assert.equal(filterItems(model.items, { ...DEFAULT_LO.f, q: "anna" }).length, 1); assert.equal(filterItems(model.items, { ...DEFAULT_LO.f, model: "nessuno" }).length, 0);
});

test("14) sezione dentro Affidabilità: chiusa di default, schede Panoramica/Future/Registrate/Concluse/Metriche, registro non attivo gestito", () => {
  assert.match(liveObservationHtml(DEFAULT_LO, [], NOW), /LIVE OBSERVATION/); assert.ok(!/data-lo-tab/.test(liveObservationHtml(DEFAULT_LO, [], NOW)));
  const open = { ...DEFAULT_LO, open: true, data: payload() };
  for (const [tab, re] of [["overview", /non ancora elaborate/], ["future", /Anna/], ["registered", /data-lo-f="state"/], ["done", /Mario/], ["metrics", /Validazione prospettica/]]) assert.match(liveObservationHtml({ ...open, tab }, [{ key: "zz", status: "scheduled", startsAt: ISO(NOW + H) }], NOW), re, tab);
  assert.match(liveObservationHtml({ ...open, data: { available: false, reason: "tabelle non create" } }, [], NOW), /Registro non ancora attivo/);
  assert.match(liveObservationHtml({ ...open, tab: "overview", data: { ...payload(), diagnostics: { enabled: true, error: "boom" } } }, [], NOW), /ERRORE nell'ultimo giro: boom/);
});

// ── Isolamento (15, 16, 17) e schema ──
const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
test("15) 16) isolamento: il motore tennis e il calcio non importano né nominano LIVE OBSERVATION; la logica nuova non importa il motore", () => {
  const NEW = /tennis-observation|_tennis-observation/;
  const importers = []; const walk = (d) => { for (const f of fs.readdirSync(new URL(`../${d}`, import.meta.url), { withFileTypes: true })) { const p = `${d}/${f.name}`; if (f.isDirectory()) { if (!["node_modules", "tests", ".git"].includes(f.name)) walk(p); } else if (/\.(js|mjs|html|yml|toml)$/.test(f.name) && NEW.test(read(p))) importers.push(p); } };
  for (const d of ["functions", "scripts", "src", ".github"]) walk(d);
  for (const f of importers) assert.ok(["functions/api/_tennis-observation-run.js", "functions/api/_tennis-observation-read.js", "functions/api/tennis-observation.js", "functions/api/_tennis-observation.js", "scripts/tennis-sync.js", "src/tennis/app.js", "src/tennis/observation.js", "src/tennis/strategy.js"].includes(f), `import inatteso in ${f}`);
  for (const f of ["functions/api/_tennis-model.js", "functions/api/_tennis-bet.js", "functions/api/_tennis-snapshot.js", "functions/api/_tennis-history.js", "functions/api/_tennis-strategy2.js", "scripts/tennis-history-shadow.js", "scripts/tennis-prospective-record.js", "functions/api/_lib.js", "functions/api/tennis-board.js"]) assert.ok(!/observation/i.test(read(f)), `${f} non deve conoscere LIVE OBSERVATION`);
  for (const mod of ["functions/api/_tennis-observation.js", "functions/api/_tennis-observation-run.js"]) { const imports = [...read(mod).matchAll(/from "([^"]+)"/g)].map((m) => m[1]); assert.ok(imports.every((i) => /^node:|^\.\/_tennis-observation/.test(i)), `${mod}: ${imports}`); }
  assert.ok(!/KEYSET|keyset/i.test(read("functions/api/_tennis-observation-run.js")));
});

test("schema SQL: due tabelle, append-only, trigger di immutabilità, RLS senza policy, indici, vista per match_key; nessuna operazione distruttiva", () => {
  const sql = read("supabase/migrations/202611210001_tennis_live_observation.sql");
  for (const re of [/create table if not exists public\.tennis_observations/, /create table if not exists public\.tennis_observation_versions/, /primary key \(match_key, rev\)/, /enable row level security/g, /before truncate/, /create or replace view public\.tennis_observation_results/, /on m\.match_key|using \(match_key\)/, /identity_ok/])
    assert.match(sql, re);
  assert.ok(!/create policy/i.test(sql)); assert.ok(!/\b(drop table|drop column|alter table public\.tennis_(matches|predictions|players|snapshot)|delete from|truncate table|update public)/i.test(sql.replace(/--.*$/gm, "")));
  assert.ok(!/tennis_forecast_log/.test(sql)); assert.match(sql, /NON APPLICATA/);
  assert.equal((sql.match(/enable row level security/g) ?? []).length, 2);
});

test("API in sola lettura: nessuna scrittura, nessun segreto del provider", () => {
  const api = read("functions/api/tennis-observation.js"); assert.ok(!/supabaseUpsert|supabasePatch|supabaseDelete|method: "(POST|PATCH|DELETE|PUT)"/.test(api)); assert.ok(!/SPORTSAPI|apikey/i.test(api));
});

// ═══ Correzioni della revisione 2: rating, look-ahead, fotografia numerica, storico completo, permessi ═══
test("rating: una variazione effettiva dello storico genera la revisione 'ratings_version' anche a probabilità invariata; storico invariato = nessuna riga", async () => {
  const m = mkMatch(1), db = memDb(); await run(db, [m], [mkRow(m)]);
  await run(db, [m], [mkRow(m)], NOW + H); await run(db, [m], [mkRow(m)], NOW + 2 * H);
  assert.equal(db.t.tennis_observation_versions.length, 1, "stesso storico: nessuna riga inutile");
  const h2 = [...history, { t: NOW - 3600e3, winnerId: "1a", loserId: "x", surface: "Clay", tour: "atp" }];
  const r = await run(db, [m], [mkRow(m)], NOW + 3 * H, book(), h2);
  assert.equal(r.reasons.ratings_version, 1); const vs = db.t.tennis_observation_versions;
  assert.deepEqual(vs.map((v) => [v.rev, v.reason]), [[1, "initial"], [2, "ratings_version"]]); assert.notEqual(vs[0].ratings_ver, vs[1].ratings_ver); assert.equal(vs[0].p1, vs[1].p1, "probabilità invariata");
  await run(db, [m], [mkRow(m)], NOW + 4 * H, book(), h2); assert.equal(vs.length, 2, "nuova versione stabile: nessuna riga");
  assert.equal(revisionReason({ rev: 1, starts_at: ISO(NOW + H), model_ver: "v", published: true, p1: 0.6, missing: [], ratings_ver: null }, { starts_at: ISO(NOW + H), model_ver: "v", published: true, p1: 0.6, missing: [], ratings_ver: "abc" }), null, "versione precedente ignota: nessuna revisione spuria");
});

test("impronta dei rating: dipende dal CONTENUTO dello storico (non solo conteggio, ultima data, loader), è deterministica e non legge altro", () => {
  const base = historyFingerprint(history, "offset", NOW);
  assert.equal(historyFingerprint(mkHist(), "offset", NOW).version, base.version, "deterministica"); assert.match(base.version, /^[0-9a-f]{32}$/);
  const swapped = history.map((h, i) => (i === 10 ? { ...h, winnerId: h.loserId, loserId: h.winnerId } : h));   // stesso conteggio, stessa ultima data, stesso loader
  assert.equal(swapped.length, history.length); assert.equal(swapped.at(-1).t, history.at(-1).t); assert.notEqual(historyFingerprint(swapped, "offset", NOW).version, base.version, "un esito scambiato cambia l'impronta");
  assert.notEqual(historyFingerprint(history.map((h, i) => (i === 3 ? { ...h, t: h.t + 1 } : h)), "offset", NOW).version, base.version);
  assert.notEqual(historyFingerprint(history.map((h, i) => (i === 3 ? { ...h, surface: "Hard" } : h)), "offset", NOW).version, base.version);
  assert.notEqual(historyFingerprint(history, "keyset", NOW).version, base.version, "il loader fa parte dell'identità");
  assert.notEqual(historyFingerprint(history.slice(0, -1), "offset", NOW).version, base.version);
  assert.equal(base.matches, 50); assert.equal(base.lastAt, history.at(-1).t); assert.equal(base.future.count, 0);
});

test("look-ahead: una cronologia con una partita conclusa a data futura NON è accettata come base: nessuna lettura né scrittura, diagnostica esplicita, nulla corretto", async () => {
  const m = mkMatch(1), bad = [...history, { t: NOW + 2 * H, winnerId: "1a", loserId: "1b", surface: "Clay", tour: "wta" }], copy = JSON.stringify(bad);
  const touched = []; const spy = { getAll: async () => touched.push("g"), insertIgnore: async () => touched.push("i") };
  const r = await recordLiveObservation({ db: spy, matches: [m], rows: [mkRow(m)], book: book(), stats: new Map(), ranks: new Map(), now: NOW, history: bad, loader: "offset", enabled: true });
  assert.equal(touched.length, 0, "nessun accesso al database"); assert.match(r.error, /history_future_date/); assert.equal(r.blocked.reason, "history_future_date");
  assert.equal(r.blocked.count, 1); assert.equal(r.blocked.latestAt, ISO(NOW + 2 * H)); assert.equal(r.blocked.processedAt, ISO(NOW)); assert.equal(r.blocked.sample[0].winnerId, "1a"); assert.equal(r.blocked.historyMatches, 51);
  assert.equal(JSON.stringify(bad), copy, "lo storico non è stato modificato né corretto");
  // anche con recorded_at precedente a starts_at della partita futura: non basta
  assert.ok(Date.parse(r.at) < Date.parse(m.starts_at)); const db = memDb(); await recordLiveObservation({ db, matches: [m], rows: [mkRow(m)], book: book(), now: NOW, history: bad, loader: "offset", enabled: true }); assert.equal(db.t.tennis_observation_versions.length, 0);
  assert.throws(() => planObservations({ matches: [m], rows: [mkRow(m)], book: book(), existing: emptyEx(), now: NOW, ratings: historyFingerprint(bad, "offset", NOW) }), (e) => e.code === "history_future_date");
  assert.equal(checkHistoryPrematch(historyFingerprint(history, "offset", NOW), NOW).ok, true); assert.equal(checkHistoryPrematch(historyFingerprint([], "offset", NOW), NOW).code, "history_empty");
  assert.equal(checkHistoryPrematch(historyFingerprint([{ t: NOW, winnerId: "a", loserId: "b" }], "offset", NOW), NOW).ok, true, "data uguale all'istante di elaborazione: non futura");
  const ok = await run(memDb(), [m], [mkRow(m)]); assert.ok(!ok.error && ok.newVersions === 1);
});

test("fotografia numerica: statistiche di servizio/risposta, partite, ranking, H2H, Elo, forma; null se assenti; ricostruzione identica a predictMatch", () => {
  const hist = [], players = ["1a", "1b"];
  for (let i = 0; i < 40; i++) hist.push({ t: NOW - (60 - i) * 864e5, winnerId: players[i % 3 === 0 ? 1 : 0], loserId: players[i % 3 === 0 ? 0 : 1], surface: "Clay", tour: "atp" });
  const b = buildBook(hist), m = mkMatch(1, { h2h: { p1Wins: 3, p2Wins: 1 }, best_of: 3, surface: "clay" });
  const stats = new Map([["1a", { serve_pts_won: 0.64, return_pts_won: 0.4, matches: 22, stats: { servePoints: 1450 }, surface: "clay", tour: "atp", fetched_at: "2026-11-20T00:00:00Z" }]]), ranks = new Map([["atp|1a", { position: 25 }], ["atp|1b", { position: 140 }]]);
  const [row] = computePredictions({ matches: [m], book: b, stats, ranks, calibrator: null, now: NOW });
  const inp = modelInputs({ match: m, row, book: b, stats, ranks });
  assert.deepEqual(inp.stats.p1, { serve: 0.64, ret: 0.4, matches: 22, servePoints: 1450 }); assert.equal(inp.stats.p2, null, "nessuna statistica = null, non inventata");
  assert.deepEqual(inp.statsSource.p1, { surface: "clay", tour: "atp", fetchedAt: "2026-11-20T00:00:00Z" }); assert.equal(inp.statsSource.p2, null);
  assert.deepEqual(inp.rank, { p1: 25, p2: 140, used: true }); assert.deepEqual(inp.h2h, { p1Wins: 3, p2Wins: 1 }); assert.equal(inp.bestOf, 3);
  assert.ok(inp.p1.matches > 0 && inp.p1.elo != null && inp.p1.eloAll != null && inp.p1.form != null && inp.p1.formGames > 0);
  assert.deepEqual(inp.components, row.components); assert.ok(row.reasons.includes(`Elo misto generale/clay: ${Math.round(inp.p1.elo)} contro ${Math.round(inp.p2.elo)}.`), "Elo salvato = Elo citato dal motore nel calcolo"); assert.ok(Math.abs(inp.p1.elo - b.view("1a", "clay").elo) < 1e-3);
  // ricostruzione: dai SOLI dati salvati si riottiene la stessa previsione del motore
  const extras = { h2h: inp.h2h ?? undefined, stats1: inp.stats.p1 ?? undefined, stats2: inp.stats.p2 ?? undefined, rank: inp.rank.used ? { p1: inp.rank.p1, p2: inp.rank.p2 } : undefined };
  const again = predictMatch(b, { t: Date.parse(m.starts_at), surface: m.surface, tour: m.tour, bestOf: m.best_of, p1: { id: m.p1_id, name: m.p1_name }, p2: { id: m.p2_id, name: m.p2_name } }, extras, null);
  assert.equal(again.p1, row.p1); assert.deepEqual(again.components, row.components);
  // nessun dato: tutto null
  const bare = modelInputs({ match: mkMatch(9), row: mkRow(mkMatch(9)), book: new RatingBook(), stats: new Map(), ranks: new Map() });
  assert.equal(bare.h2h, null); assert.deepEqual(bare.rank, { p1: null, p2: null, used: false }); assert.deepEqual(bare.stats, { p1: null, p2: null }); assert.equal(bare.p1.form, null);
  // ranking presente per uno solo: salvato, ma 'used' = false (il motore lo ignora)
  assert.equal(modelInputs({ match: m, row, book: b, stats, ranks: new Map([["atp|1a", { position: 25 }]]) }).rank.used, false);
});

// ── Storico completo: lettura paginata senza troncamenti ──
function fakeRest({ obs, vers }) {
  const calls = [];
  const f = async (url, { headers }) => {
    const u = new URL(url), table = u.pathname.split("/").pop(), q = (k) => u.searchParams.get(k); calls.push({ table, q: Object.fromEntries(u.searchParams) });
    let rows = (table === "tennis_observation_results" ? obs : vers).map((r) => ({ ...r }));
    const eq = q("match_key")?.startsWith("eq.") ? q("match_key").slice(3) : null; if (eq) rows = rows.filter((r) => r.match_key === eq);
    if (q("match_key")?.startsWith("in.(")) { const ks = [...q("match_key").slice(4, -1).matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((x) => x[1].split('\\"').join('"').split("\\\\").join("\\")); rows = rows.filter((r) => ks.includes(r.match_key)); }
    if (q("and")) for (const c of q("and").slice(1, -1).split(",")) { const [, op, val] = /first_starts_at\.(gte|lte)\.(.+)/.exec(c); rows = rows.filter((r) => (op === "gte" ? r.first_starts_at >= val : r.first_starts_at <= val)); }
    if (q("or")) { const [, ts, , key] = /^\(first_starts_at\.lt\.(.+?),and\(first_starts_at\.eq\.(.+?),match_key\.lt\."(.*)"\)\)$/.exec(q("or")); const key2 = key.split('\\"').join('"').split("\\\\").join("\\"); rows = rows.filter((r) => r.first_starts_at < ts || (r.first_starts_at === ts && r.match_key < key2)); }
    if (table === "tennis_observation_results") rows.sort((a, b) => (a.first_starts_at < b.first_starts_at ? 1 : a.first_starts_at > b.first_starts_at ? -1 : a.match_key < b.match_key ? 1 : -1));
    else rows.sort((a, b) => (a.match_key < b.match_key ? -1 : a.match_key > b.match_key ? 1 : a.rev - b.rev));
    const total = rows.length, off = Number(q("offset") ?? 0), lim = Number(q("limit") ?? 1000); rows = rows.slice(off, off + lim);
    return new Response(JSON.stringify(rows), { status: 200, headers: { "content-range": `0-${Math.max(0, rows.length - 1)}/${total}` } });
  };
  return { f, calls };
}
const env = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k" };

test("storico completo: tutte le partite in pagine a cursore (anche con orari uguali), nessun duplicato, nessun troncamento, totale esatto, tutte le revisioni", async () => {
  const obs = Array.from({ length: 23 }, (_, i) => ({ match_key: `m|${String(i).padStart(2, "0")}|"x"`, first_starts_at: ISO(Date.UTC(2024, 0, 1) + Math.floor(i / 4) * 864e5 * 30) }));  // 4 partite per ogni istante: spareggio sul match_key; dati di anni fa
  const vers = obs.flatMap((o, i) => Array.from({ length: i === 5 ? 1200 : 1 + (i % 3) }, (_, r) => ({ match_key: o.match_key, rev: r + 1, reason: r ? "probability" : "initial" })));   // una partita con 1200 revisioni (> 1000 righe di PostgREST)
  const { f } = fakeRest({ obs, vers }), got = [], gotVers = []; let cur = null, pages = 0, total = null;
  do { const p = await loadObservationPage(env, parseParams(new URLSearchParams({ limit: "5", ...(cur ? { before: cur } : {}) })), f); pages++; got.push(...p.observations); gotVers.push(...p.versions); if (p.total != null) total = p.total; cur = p.nextCursor; assert.equal(p.complete, cur === null); } while (cur);
  assert.equal(pages, 5); assert.equal(total, 23); assert.equal(got.length, 23); assert.equal(new Set(got.map((o) => o.match_key)).size, 23, "nessun duplicato"); assert.equal(gotVers.length, vers.length, "TUTTE le revisioni, anche oltre 1000 righe");
  assert.ok(got[0].first_starts_at >= got.at(-1).first_starts_at, "dalle più recenti"); assert.ok(got.at(-1).first_starts_at.startsWith("2024"), "anche anni fa");
  const one = await loadObservationPage(env, parseParams(new URLSearchParams({ key: obs[5].match_key })), f); assert.equal(one.observations.length, 1); assert.equal(one.versions.length, 1200);
  const rng = await loadObservationPage(env, parseParams(new URLSearchParams({ from: ISO(Date.UTC(2024, 0, 31)), to: ISO(Date.UTC(2024, 1, 1)) })), f); assert.ok(rng.observations.length > 0 && rng.observations.every((o) => o.first_starts_at >= ISO(Date.UTC(2024, 0, 31))));
});

test("storico completo: parametri validati, limite massimo, e una lettura che supera il tetto lancia invece di troncare in silenzio", async () => {
  assert.equal(parseParams(new URLSearchParams({ limit: "99999" })).limit, PAGE.max); assert.equal(parseParams(new URLSearchParams({})).limit, PAGE.def);
  assert.throws(() => decodeCursor("senza-separatore"), /cursore/); assert.throws(() => decodeCursor("non-una-data|k"), /cursore/); assert.throws(() => parseParams(new URLSearchParams({ from: "ieri" })), /date/);
  const vers = Array.from({ length: 2500 }, (_, i) => ({ match_key: "k", rev: i + 1 })), { f } = fakeRest({ obs: [], vers });
  await assert.rejects(() => getAllStrict(env, f, "tennis_observation_versions", { select: "*" }, 1000, 2), /incompleto/);
  assert.equal((await getAllStrict(env, f, "tennis_observation_versions", { select: "*" }, 1000, 3)).length, 2500);
  assert.match(inList(['a"b']), /^in\.\("a\\"b"\)$/);
  const src = fs.readFileSync(new URL("../functions/api/tennis-observation.js", import.meta.url), "utf8"); assert.ok(!/days|90|30 giorni/.test(src.replace(/\/\*[\s\S]*?\*\//g, "")), "nessun limite temporale predefinito");
});

test("interfaccia: storico parziale dichiarato (mostrate X di Y, metriche parziali), blocco anti look-ahead visibile, statistiche numeriche nel dettaglio", () => {
  const p = { ...payload(), total: 250, complete: false, nextCursor: "c|k", diagnostics: { enabled: true, error: "history_future_date: x", blocked: { reason: "history_future_date", count: 2, latestAt: "2026-11-21T12:00:00.000Z" } } };
  const open = { ...DEFAULT_LO, open: true, data: p };
  const ov = liveObservationHtml({ ...open, tab: "overview" }, [], NOW); assert.match(ov, /REGISTRAZIONE BLOCCATA \(history_future_date\)/); assert.match(ov, /nulla è stato corretto/); assert.match(ov, /3 osservazioni caricate su 250/);
  assert.match(liveObservationHtml({ ...open, tab: "registered" }, [], NOW), /Mostrate 3 di 250[\s\S]*data-lo-more[\s\S]*data-lo-all/);
  assert.match(liveObservationHtml({ ...open, tab: "metrics" }, [], NOW), /Metriche PARZIALI/);
  assert.ok(!/Metriche PARZIALI/.test(liveObservationHtml({ ...open, data: { ...p, complete: true }, tab: "metrics" }, [], NOW)));
  const item = buildModel({ ...payload(), versions: payload().versions.map((v) => (v.match_key === "k1" && v.rev === 1 ? { ...v, inputs: { p1: { matches: 30, eloAll: 1620, eloSurface: 1650 }, p2: {}, stats: { p1: { serve: 0.64, ret: 0.4, matches: 22 }, p2: null }, rank: { p1: 25, p2: 140 }, h2h: { p1Wins: 3, p2Wins: 1 } }, history_last_at: ISO(NOW - 10 * H), ratings_ver: "abcdef0123456789ffff" } : v)) }, NOW).items.find((i) => i.key === "k1");
  const h = detailHtml(item); assert.match(h, /Punti vinti al servizio<\/dt><dd>64,0%<\/dd><dd>—/); assert.match(h, /Punti vinti in risposta<\/dt><dd>40,0%<\/dd><dd>—/); assert.match(h, /Partite nelle statistiche<\/dt><dd>22<\/dd><dd>—/); assert.match(h, /lo-legend/); assert.match(h, /3–1/); assert.match(h, /abcdef012345/);
});

test("permessi e schema: ratings_version nel vincolo, history_last_at <= recorded_at, GRANT solo a service_role (mai anon/authenticated), additiva", () => {
  const raw = read("supabase/migrations/202611210001_tennis_live_observation.sql"), sql = raw.replace(/--.*$/gm, "");
  assert.match(sql, /'missing_data', 'ratings_version'\)/); assert.match(sql, /history_last_at timestamptz not null/); assert.match(sql, /check \(history_last_at <= recorded_at\)/);
  const grants = [...sql.matchAll(/grant\s+([^;]+?)\s+on\s+([^;]+?)\s+to\s+([^;]+);/gi)]; assert.equal(grants.length, 2);
  for (const g of grants) { assert.equal(g[3].trim(), "service_role"); assert.ok(!/anon|authenticated|public\b(?!\.)/.test(g[3])); assert.ok(!/all|update|delete|truncate/i.test(g[1])); }
  assert.deepEqual(grants.map((g) => g[1].trim()), ["select, insert", "select"]); assert.match(sql, /revoke all on public\.tennis_observations, public\.tennis_observation_versions, public\.tennis_observation_results from anon, authenticated/);
  assert.ok(!/\b(drop table|drop column|alter table public\.tennis_(matches|predictions|players|snapshot)|delete from|truncate table|update public)/i.test(sql));
});
