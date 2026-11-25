import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildReport, REPORT_SCHEMA } from "../functions/api/_learning-report.js";
import { run, getAll, parseArgs, loadFromSupabase } from "../scripts/learning-run.js";
import { synth, T0, H } from "./learning-helpers.js";

const NOW = Date.parse("2026-12-31T00:00:00Z"), read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const tennisRows = (n, seed = 1, truth = 0.5) => { const recs = synth(n, { seed, truth }); return { predictions: recs.map((r, i) => ({ match_key: `T${i % 25}|r|${i}a|${i}b`, starts_at: new Date(r.t).toISOString(), tour: "atp", surface: i % 2 ? "clay" : "hard", published: true, p1: r.p, p2: 1 - r.p, missing: i % 2 ? ["scontri diretti"] : [], odds_p1: null, odds_p2: null, odds_at: null, model_ver: "tennis-v2" })), results: recs.map((r, i) => ({ match_key: `T${i % 25}|r|${i}a|${i}b`, winner: r.y ? 1 : 2 })) }; };

test("report: struttura versionata, sezioni per sport, registro e riepilogo coerenti; nessun dato inventato", () => {
  const rep = buildReport({ tennis: tennisRows(2400) }, { now: NOW, reps: 200 });
  assert.equal(rep.schema, REPORT_SCHEMA); assert.equal(rep.status, "ok"); assert.equal(rep.source.readOnly, true); assert.ok(rep.sports.tennis.diagnosis.available); assert.equal(rep.sports.football, undefined);
  assert.equal(rep.overview.predictionsAnalyzed.tennis, 2400); assert.equal(rep.overview.anomalies.total, rep.sports.tennis.diagnosis.anomalies.length); assert.equal(rep.overview.experiments.total, rep.experimentLog.length); assert.equal(rep.overview.experiments.thisRun, rep.sports.tennis.lab.experiments.length);
  assert.ok(rep.sports.tennis.lab.experiments.length >= 3); assert.equal(JSON.parse(JSON.stringify(rep)).generatedAt, "2026-12-31T00:00:00.000Z");
});

test("report: stessi dati → stesso report; nuova esecuzione con dati diversi aggiunge al registro senza modificare i record precedenti", () => {
  const a = buildReport({ tennis: tennisRows(2400, 1) }, { now: NOW, reps: 200 }), b = buildReport({ tennis: tennisRows(2400, 1) }, { now: NOW, reps: 200, previousLog: a.experimentLog });
  assert.deepEqual(b.experimentLog, a.experimentLog); const c = buildReport({ tennis: tennisRows(2700, 2) }, { now: NOW + 864e5, reps: 200, previousLog: b.experimentLog });
  assert.ok(c.experimentLog.length > b.experimentLog.length); assert.deepEqual(c.experimentLog.slice(0, b.experimentLog.length), b.experimentLog);
});

test("report: i dati ricostruiti del calcio restano fuori e sono contati; --since limita la finestra", () => {
  const rows = synth(1500, { seed: 3, sport: "football", surfaces: ["home", "draw", "away"], gsize: 3 }).map((r, i) => ({ game_id: Math.floor(i / 3), league: `lg${i % 4}`, kickoff_at: new Date(r.t).toISOString(), sel_key: ["home", "draw", "away"][i % 3], p: r.p, p_model: r.p, p_api: null, p_market: null, verdict: "EVITA", basis: i % 10 === 0 ? "ricostruita" : "storico", model_ver: "abc", won: !!r.y }));
  const rep = buildReport({ football: { rows } }, { now: NOW, reps: 200, lab: false }); assert.equal(rep.sports.football.skipped.reconstructed, 150); assert.equal(rep.sports.football.analyzed, 1350); assert.deepEqual(rep.sports.football.lab.experiments, []);
  const since = buildReport({ football: { rows } }, { now: NOW, reps: 200, lab: false, since: Date.parse(rows[900].kickoff_at) }); assert.ok(since.sports.football.analyzed < 700);
});

function fakeSupabase(tables) {
  const calls = []; const f = async (url, init) => { const u = new URL(url), name = u.pathname.split("/").pop(); calls.push({ method: init?.method ?? "GET", name, q: Object.fromEntries(u.searchParams) });
    const all = tables[name]; if (!all) return new Response("{}", { status: 404 }); const off = Number(u.searchParams.get("offset") ?? 0), lim = Number(u.searchParams.get("limit") ?? 1000); return new Response(JSON.stringify(all.slice(off, off + lim)), { status: 200 }); };
  return { f, calls };
}
const ENV = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k" };

test("script: lettura paginata completa con SOLE richieste GET, nessuna scrittura; errore (non troncamento) oltre il tetto", async () => {
  const t = tennisRows(2300), { f, calls } = fakeSupabase({ tennis_predictions: t.predictions, tennis_prediction_results: t.results });
  const inputs = await loadFromSupabase(ENV, ["tennis"], NOW, f); assert.equal(inputs.tennis.predictions.length, 2300); assert.equal(inputs.tennis.results.length, 2300); assert.ok(calls.length >= 6); assert.ok(calls.every((c) => c.method === "GET"));
  await assert.rejects(() => getAll(ENV, "tennis_predictions", { select: "*" }, { maxPages: 2, f }), /incompleto/); await assert.rejects(() => getAll(ENV, "nome_inesistente", {}, { f }), /HTTP 404/);
});

test("script: dry-run non scrive; l'esecuzione scrive UN file locale e il registro cresce in modo append-only tra due esecuzioni", async () => {
  const t = tennisRows(2400), { f } = fakeSupabase({ tennis_predictions: t.predictions, tennis_prediction_results: t.results }), dir = fs.mkdtempSync(path.join(os.tmpdir(), "learn-")), out = path.join(dir, "learning", "report.json"), logs = [];
  const dry = await run(["--sports", "tennis", "--out", out, "--reps", "200", "--dry-run"], ENV, { f, now: NOW, log: (m) => logs.push(m) }); assert.ok(!fs.existsSync(out)); assert.equal(dry.status, "ok"); assert.ok(logs.some((l) => /Dry-run/.test(l)));
  const r1 = await run(["--sports", "tennis", "--out", out, "--reps", "200"], ENV, { f, now: NOW, log: () => {} }); assert.ok(fs.existsSync(out)); const saved = JSON.parse(fs.readFileSync(out, "utf8")); assert.equal(saved.schema, REPORT_SCHEMA); assert.equal(saved.experimentLog.length, r1.experimentLog.length);
  const r2 = await run(["--sports", "tennis", "--out", out, "--reps", "200"], ENV, { f, now: NOW + 864e5, log: () => {} }); assert.deepEqual(r2.experimentLog, saved.experimentLog, "stessi dati: registro invariato");
  fs.rmSync(dir, { recursive: true });
});

test("script: opzioni validate; input da file senza rete; mancano le credenziali → errore chiaro", async () => {
  assert.throws(() => parseArgs(["--boh"]), /sconosciuta/); assert.throws(() => parseArgs(["--reps", "5"]), /reps/); assert.throws(() => parseArgs(["--since", "ieri"]), /data/); assert.equal(parseArgs(["--no-lab"]).lab, false);
  await assert.rejects(() => run(["--out", "/tmp/x.json"], {}, { f: async () => { throw new Error("rete non deve essere usata"); }, log: () => {} }), /SUPABASE_URL/);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "learn-")), inp = path.join(dir, "in.json"); fs.writeFileSync(inp, JSON.stringify({ tennis: tennisRows(1200) }));
  const rep = await run(["--input", inp, "--out", path.join(dir, "o.json"), "--reps", "200", "--no-lab"], {}, { f: async () => { throw new Error("rete non deve essere usata"); }, now: NOW, log: () => {} }); assert.equal(rep.source.kind, "file"); fs.rmSync(dir, { recursive: true });
});

test("sola lettura garantita nel codice: nessun metodo di scrittura, nessuna tabella scritta, nessun import dei motori", () => {
  for (const f of ["scripts/learning-run.js", "functions/api/_learning-core.js", "functions/api/_learning-adapters.js", "functions/api/_learning-diagnostics.js", "functions/api/_learning-lab.js", "functions/api/_learning-report.js"]) {
    const src = read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, ""); assert.ok(!/method:\s*["'](POST|PATCH|PUT|DELETE)/i.test(src), `${f}: nessun metodo di scrittura`); assert.ok(!/supabase(Upsert|Patch|Delete|Insert)|\.upsert\(|\.insert\(|insertIgnore|\.del\(/.test(src), `${f}: nessuna scrittura`);
    for (const m of src.matchAll(/from\s+"([^"]+)"/g)) assert.ok(/^node:|^\.\/_learning|^\.\.\/functions\/api\/_learning/.test(m[1]), `${f} importa ${m[1]}`);
  }
  assert.match(read("scripts/learning-run.js"), /writeFileSync\(a\.out/); const stub = JSON.parse(read("public/learning/report.json")); assert.equal(stub.status, "not_generated"); assert.ok(!("sports" in stub));
});
