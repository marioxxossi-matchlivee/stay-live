import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { loadHistory, buildBook, computePredictions } from "../scripts/tennis-sync.js";
import { OPERATIVE_HISTORY_CAP, operativeQuery, keysetQuery, toEntries, toEntry, emulateOldRows, runShadow, evaluateFrozenVsFresh, replayFrozenVsFresh, compareBooks, comparePredictionRows, SHADOW_ENABLED, scoreRows, fingerprintBook } from "../scripts/tennis-history-shadow.js";
import { RatingBook } from "../functions/api/_tennis-model.js";

const NOW = Date.parse("2026-11-19T12:00:00Z"), DAY = 86400e3;
// Generatore deterministico (sintetico): 3.000 giocatori, `perTime` partite per orario, vincitore pseudo-casuale con leggera forza.
function synth(n, { perTime = 4, players = 3000, start = NOW - 390 * DAY, seed = 7 } = {}) {
  let s = seed; const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296);
  return Array.from({ length: n }, (_, i) => { const a = Math.floor(rnd() * players), b = (a + 1 + Math.floor(rnd() * (players - 1))) % players, w = (rnd() < 0.5 + (b - a) / (4 * players) ? 1 : 2);
    return { match_key: `m${String(i).padStart(6, "0")}`, status: "finished", winner: w, p1_id: `p${a}`, p2_id: `p${b}`, p1_name: `P${a}`, p2_name: `P${b}`, starts_at: new Date(start + Math.floor(i / perTime) * 3600e3).toISOString().replace(".000Z", "+00:00"), surface: ["Hard", "Clay", "Grass"][i % 3], best_of: 3, tour: i % 2 ? "atp" : "wta", category: "tour", tournament: "T", closing_odds: i % 5 ? { [`p${a}`]: 1.8, [`p${b}`]: 2.0 } : null }; });
}
/** Database finto con i filtri usati: status, winner, starts_at gte, ordine e filtro a chiave, offset/limit. */
function table(rows) {
  const cmp = (a, b) => (a.starts_at < b.starts_at ? -1 : a.starts_at > b.starts_at ? 1 : a.match_key < b.match_key ? -1 : a.match_key > b.match_key ? 1 : 0);
  const base = (q) => rows.filter((r) => (!q.status || r.status === q.status.replace("eq.", "")) && (q.winner !== "not.is.null" || r.winner != null) && (!q.starts_at || r.starts_at >= q.starts_at.replace("gte.", ""))).sort(cmp);
  const page = (q) => { let l = base(q); if (q.or) { const m = q.or.match(/starts_at\.gt\."([^"]*)",and\(starts_at\.eq\."([^"]*)",match_key\.gt\."([^"]*)"\)\)/); l = l.filter((r) => r.starts_at > m[1] || (r.starts_at === m[2] && r.match_key > m[3])); } if (q.offset) l = l.slice(q.offset); return l.slice(0, q.limit); };
  return { fetchPage: async (q) => page(q), page, getAll: async (name, q, size = 1000, maxPages = 12) => { if (name === "tennis_matches" && q.status === "eq.finished") { const out = []; for (let p = 0; p < maxPages; p++) { const r = page({ ...q, limit: size, offset: p * size }); out.push(...r); if (r.length < size) break; } return out; } return []; } };
}

test("la query OLD e la trasformazione coincidono con quelle del vero loadHistory", async () => {
  let seen; const rows = synth(50), db = { getAll: async (name, q, size, pages) => { seen = { q, size, pages }; return table(rows).page({ ...q, limit: 1000 }); } };
  const real = await loadHistory(db, NOW);
  assert.deepEqual(operativeQuery(NOW), { select: seen.q.select, status: seen.q.status, winner: seen.q.winner, starts_at: seen.q.starts_at }); // stessi filtri e colonne
  assert.equal(seen.size * seen.pages, OPERATIVE_HISTORY_CAP); // il tetto dichiarato è quello reale (1.000 × 80)
  const mine = toEntries(table(rows).page({ ...keysetQuery(NOW), limit: 1000 }));
  assert.deepEqual(mine.map(({ t, winnerId, loserId, surface, tour, bestOf, category, p1Name, p2Name }) => ({ t, winnerId, loserId, surface, tour, bestOf, category, p1Name, p2Name })), real);
});
test("il codice operativo di loadHistory è invariato: offset, 80 pagine da 1.000", () => {
  const src = fs.readFileSync("scripts/tennis-sync.js", "utf8"); assert.ok(/order: "starts_at\.asc,match_key\.asc" \}, 1000, 80\);/.test(src));
  assert.ok(!/_tennis-history|tennis-history-shadow/.test(src), "tennis-sync.js non deve richiamare né il loader a chiave né la Shadow Mode");
});
test("oltre 80.000 righe: OLD si ferma al tetto, NEW le legge tutte; le perse sono le più recenti; nessuna duplicazione", async () => {
  const rows = synth(96400), t = table(rows);
  const { report } = await runShadow({ fetchPage: t.fetchPage, getAll: t.getAll, count: async () => 96400, realOld: (now) => loadHistory({ getAll: t.getAll }, now) }, { now: NOW, repeat: false });
  assert.equal(report.table.rowsLoaded.new, 96400); assert.equal(report.table.rowsLoaded.old, 80000); assert.equal(report.lost.rawRows, 16400);
  assert.equal(report.loader.duplicatesDiscarded, 0); assert.equal(report.loader.truncated, false); assert.equal(report.loader.countMatchesRows, true);
  assert.equal(report.lost.allAfterOldLastMatch, true); assert.ok(report.table.lastMatch.new > report.table.lastMatch.old);
  assert.equal(report.oldVerification.identical, true, "l'OLD emulato coincide con il vero loadHistory"); assert.equal(report.evaluation.evaluated, 16400);
  assert.ok(report.table.distinctPlayers.new >= report.table.distinctPlayers.old);
}); // sintetico: nessun dato reale
test("il loader a chiave supera il limite di sicurezza con errore esplicito dentro la Shadow Mode", async () => {
  const t = table(synth(5000)); await assert.rejects(() => runShadow({ fetchPage: t.fetchPage, getAll: t.getAll }, { now: NOW, maxPages: 2, repeat: false }), /nessun troncamento silenzioso/);
});
test("solo concluse valide: future, incomplete e senza vincitore non entrano nello storico", async () => {
  const rows = synth(40); rows[3].status = "scheduled"; rows[3].winner = null; rows[5].status = "ended_other"; rows[5].winner = null; rows[7].winner = 3;
  const t = table(rows), { report } = await runShadow({ fetchPage: t.fetchPage, getAll: t.getAll }, { now: NOW, repeat: false });
  assert.equal(report.table.rowsLoaded.new, 38); // 40 − scheduled − ended_other (la query filtra status e winner)
  assert.equal(report.table.validFinished.new, 37); // winner 3 non è un esito valido
});
test("nessun look-ahead: cambiare l'esito di una partita non cambia la sua previsione né quelle dello stesso giorno; cambia quelle dei giorni dopo", () => {
  const base = Date.parse("2026-01-01T10:00:00Z"), E = (t, w, l) => ({ t, winnerId: w, loserId: l, surface: "Hard", tour: "atp", bestOf: 3, winnerName: w, loserName: l, odds: null });
  const mk = (mWinner) => { const e = [];
    for (let i = 0; i < 30; i++) { e.push(E(base + i * DAY, "a", `x${i}`)); e.push(E(base + i * DAY, "b", `y${i}`)); }
    e.push(mWinner === "a" ? E(base + 30 * DAY, "a", "b") : E(base + 30 * DAY, "b", "a"));                 // M: a contro b
    e.push(E(base + 30 * DAY + 3600e3, "a", "b")); e.push(E(base + 30 * DAY + 7200e3, "b", "a"));           // stesso giorno di M
    e.push(E(base + 31 * DAY, "a", "b")); e.push(E(base + 31 * DAY, "b", "a"));                              // giorno dopo
    return e; };
  const rowsOf = (w) => replayFrozenVsFresh(mk(w), 0), A = rowsOf("a"), B = rowsOf("b"), n = A.length; assert.equal(n, 65);
  assert.ok(A.slice(60).every((r) => r.pNew != null), "previsioni presenti per le ultime 5 partite");
  for (let i = 0; i < 63; i++) assert.equal(A[i].pNew, B[i].pNew, `riga ${i}: partita M e partite dello stesso giorno non vedono l'esito di M`);
  assert.ok(A[63].pNew !== B[63].pNew || A[64].pNew !== B[64].pNew, "il giorno dopo l'esito di M conta (controllo positivo)");
});
test("stesso momento temporale: l'ordine delle partite dello stesso giorno non cambia le previsioni", () => {
  const base = Date.parse("2026-03-01T08:00:00Z"), mk = () => [0, 1, 2, 3, 4, 5].map((i) => ({ t: base + (i % 2) * 3600e3, winnerId: `w${i}`, loserId: "z", surface: "Clay", tour: "wta", bestOf: 3, winnerName: "W", loserName: "Z", odds: null }));
  const warm = Array.from({ length: 40 }, (_, i) => ({ t: base - (i + 2) * DAY, winnerId: `w${i % 6}`, loserId: "z", surface: "Clay", tour: "wta", bestOf: 3, winnerName: "W", loserName: "Z", odds: null })).reverse();
  const x = evaluateFrozenVsFresh([...warm, ...mk()], 40), y = evaluateFrozenVsFresh([...warm, ...mk().reverse().map((e, i) => ({ ...e, t: mk()[5 - i].t }))], 40);
  assert.equal(x.new.brier, y.new.brier); assert.equal(x.evaluated, 6);
});
test("riproducibilità: due esecuzioni complete danno gli stessi risultati", async () => {
  const t = table(synth(3000)), io = { fetchPage: t.fetchPage, getAll: t.getAll }, r1 = await runShadow(io, { now: NOW, cap: 2000 }), r2 = await runShadow(io, { now: NOW, cap: 2000 });
  assert.equal(r1.report.reproducibility.rowsIdentical, true); assert.equal(r1.report.reproducibility.booksIdentical, true); assert.equal(r1.report.reproducibility.evaluationIdentical, true);
  const strip = (r) => JSON.stringify({ ...r.report, generatedAt: 0 }); assert.equal(strip(r1), strip(r2));
});
test("la Shadow Mode non cambia il motore operativo: libro e probabilità identici prima e dopo, dati in ingresso non modificati", async () => {
  const rows = synth(4000), t = table(rows), frozen = JSON.stringify(rows);
  const sched = [{ match_key: "s1", status: "scheduled", starts_at: new Date(NOW + 3600e3).toISOString(), tour: "atp", surface: "Hard", best_of: 3, p1_id: "p1", p2_id: "p2", p1_name: "P1", p2_name: "P2", category: "tour", odds_sources: [], odds_fetched_at: null }];
  const op = () => { const book = buildBook(toEntries(emulateOldRows(rows, 3000))); return JSON.stringify([fingerprintBook(book), computePredictions({ matches: sched, book, stats: new Map(), ranks: new Map(), calibrator: null, now: NOW })]); };
  const before = op(); await runShadow({ fetchPage: t.fetchPage, getAll: async (n) => (n === "tennis_matches" ? sched : []) }, { now: NOW, repeat: false, cap: 3000 });
  assert.equal(op(), before); assert.equal(JSON.stringify(rows), frozen);
});
test("confronti: Elo/forma/probabilità — OLD coincide con NEW quando lo storico non è troncato", async () => {
  const entries = toEntries(synth(1500)), a = buildBook(entries), b = buildBook(entries), c = compareBooks(a, b);
  assert.equal(c.meanAbsEloDiff, 0); assert.equal(c.meanAbsFormDiff, 0); assert.equal(c.unknownInScheduled.old, 0);
  assert.equal(comparePredictionRows([{ match_key: "k", published: true, p1: 0.6, pick: 1, bet: { verdict: "EVITA" } }], [{ match_key: "k", published: true, p1: 0.65, pick: 1, bet: { verdict: "BET" } }]).meanAbsProbDiffPt, 5);
  assert.deepEqual(scoreRows([{ p: 0.5, y: 1 }, { p: 0.5, y: 0 }]).brier, 0.25);
});
test("lo script è di SOLA LETTURA e isolato: nessuna scrittura, nessun importatore operativo, workflow solo manuale", () => {
  const src = fs.readFileSync("scripts/tennis-history-shadow.js", "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.ok(!/supabaseUpsert|supabasePatch|supabaseDelete|makeDb|\.upsert\(|\.rpc\(|method: "(POST|PATCH|PUT|DELETE)"|writeFileSync\([^)]*supabase/i.test(src), "scritture non ammesse");
  assert.ok(/method: "GET"/.test(src));
  const wf = fs.readFileSync(".github/workflows/tennis-history-shadow.yml", "utf8"); assert.ok(!/schedule:|TENNIS_API_KEY|db push|migration/i.test(wf)); assert.ok(/workflow_dispatch/.test(wf));
  const walk = (d, out = []) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { if (["node_modules", ".git", "tests"].includes(f.name)) continue; const p = `${d}/${f.name}`; if (f.isDirectory()) walk(p, out); else if (/\.(js|mjs|yml|yaml|toml|html)$/.test(f.name) && fs.readFileSync(p, "utf8").includes("tennis-history-shadow") && p !== "./.github/workflows/tennis-history-shadow.yml") out.push(p); } return out; };
  assert.deepEqual(walk(".").filter((p) => !/^\.\/scripts\/tennis-history-shadow\.js$/.test(p)), []);
});
test("interruttore: senza TENNIS_HISTORY_SHADOW=on lo script non legge nulla ed esce con 0; con 'off' idem", () => {
  assert.equal(SHADOW_ENABLED({}), false); assert.equal(SHADOW_ENABLED({ TENNIS_HISTORY_SHADOW: "off" }), false); assert.equal(SHADOW_ENABLED({ TENNIS_HISTORY_SHADOW: "on" }), true);
  for (const v of [undefined, "off"]) { const env = { PATH: process.env.PATH }; if (v) env.TENNIS_HISTORY_SHADOW = v; const r = spawnSync(process.execPath, ["scripts/tennis-history-shadow.js"], { env, encoding: "utf8" }); assert.equal(r.status, 0); assert.match(r.stdout, /disattivata/); }
});
test("attivata ma senza credenziali: errore chiaro, nessun segreto stampato", () => {
  const r = spawnSync(process.execPath, ["scripts/tennis-history-shadow.js"], { env: { PATH: process.env.PATH, TENNIS_HISTORY_SHADOW: "on" }, encoding: "utf8" }); assert.equal(r.status, 1); assert.match(r.stderr, /Variabile mancante/);
});
void RatingBook; void toEntry;
