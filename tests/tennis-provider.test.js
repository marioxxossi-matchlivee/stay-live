import test from "node:test";
import assert from "node:assert/strict";
import { classifyCategory, canonicalMatchKey, normalizeUpcoming, normalizeResult, readPage, validOdd } from "../functions/api/_tennis-provider.js";

// Campioni ridotti delle risposte REALI della sonda (12/11/2026).
const upcomingWta = { id: 1069756, matchId: 1069756, liveMatchId: "77934-18482-16758-8", tournament: { id: 16758, name: "WTA Finals - Indian Wells", rankId: 3, country: "USA", court: { name: "Hard" } }, court: "Hard", roundId: 8, rank: 3, date: "2026-11-13T20:00:00.000Z", type: "wta",
  odds: { id_b_o: 2, bookmaker: "Pinnacle", id1_o: 77934, id2_o: 18482, k1: 1.457, k2: 2.92 },
  player1: { name: "Mirra Andreeva", odd: "1.533", oddBookmaker: "Marathonbet", countryAcr: "RUS", seed: "3", id: 77934 }, player2: { id: 18482, name: "Karolina Muchova", odd: "2.52", oddBookmaker: "Marathonbet", countryAcr: "CZE", seed: "7" },
  h2hSummary: { matchCount: 1, player1Wins: 1, player2Wins: 0 }, startTimeStatus: "scheduled", modelPrediction: { available: false, error: "plan_restricted" } };
const upcomingAtpNoPin = { id: 2023567, matchId: 2023567, liveMatchId: "24008-99691-21364-8", tournament: { id: 21364, name: "Nitto ATP Finals - Turin", rankId: 7, court: { name: "I.hard" } }, court: "I.hard", roundId: 8, date: "2026-11-15T13:00:00.000Z",
  odds: { id_b_o: null, bookmaker: null, id1_o: null, id2_o: null, k1: null, k2: null }, player1: { name: "Alexander Zverev", odd: "1.39", oddBookmaker: "Marathonbet", id: 24008 }, player2: { id: 99691, name: "Rafael Jodar", odd: "3.04", oddBookmaker: "Marathonbet" },
  h2hSummary: { matchCount: 1, player1Wins: 1, player2Wins: 0 }, startTimeStatus: "scheduled" };
const resultSingles = { id: "202909793", matchId: "202909793", date: "2026-11-11T21:55:00.000Z", roundId: 5, player1Id: 53532, player2Id: 81784, tournamentId: 22198, match_winner: 53532, result: "6-3 6-3", result_type: "completed", best_of: "3", odd1: "1.3", odd2: "3.14",
  player1: { id: 53532, name: "Liam Draxl", countryAcr: "CAN" }, player2: { id: 81784, name: "Petr Nesterov", countryAcr: "BUL" }, tournament: { id: 22198, name: "Knoxville Challenger", rankId: 1 }, matchKey: "53532-81784-22198-5" };
const resultDoubles = { id: "204320605", date: "2026-11-11T23:18:00.000Z", roundId: 4, player1Id: 133235, player2Id: 125711, match_winner: 133235, result: "6-4 4-6 10-4", result_type: "completed", best_of: "3",
  player1: { id: 133235, name: "Hynek Barton/Maks Kasnikowski", members: [{ id: 86156 }, { id: 84060 }] }, player2: { id: 125711, name: "A/B", members: [{ id: 1 }] }, tournament: { id: 22198, name: "Knoxville Challenger", rankId: 1 } };

test("categorie: Challenger e ITF si separano solo col nome; livello 1 ambiguo resta tale", () => {
  assert.equal(classifyCategory(1, "Knoxville Challenger"), "challenger");
  assert.equal(classifyCategory(1, "W35 Weston"), "itf");
  assert.equal(classifyCategory(0, "M25 Santa Cruz do Sul"), "itf");
  assert.equal(classifyCategory(1, "Cundinamarca Open - Sopo"), "challenger_itf");
  assert.equal(classifyCategory(2, "Nordic Open"), "tour");
  assert.equal(classifyCategory(undefined, ""), "unknown");
});

test("chiave canonica: uguale in qualunque ordine dei giocatori", () => {
  assert.equal(canonicalMatchKey(1, 8, "20", "3"), canonicalMatchKey(1, 8, "3", "20"));
  assert.equal(canonicalMatchKey(1, 8, "3", "20"), "1|8|3|20");
});

test("programma: ordine canonico per id, quote mappate per ID, nessun formato inventato", () => {
  const m = normalizeUpcoming(upcomingWta, "wta");
  assert.equal(m.p1_id, "18482"); assert.equal(m.p2_id, "77934"); // id minore = giocatore 1
  assert.equal(m.best_of, null); assert.equal(m.status, "scheduled"); assert.equal(m.surface, "Hard");
  const mara = m.odds_sources.find((s) => s.book === "Marathonbet"), pin = m.odds_sources.find((s) => s.book === "Pinnacle");
  assert.deepEqual([mara.p1, mara.p2], [2.52, 1.533]); assert.deepEqual([pin.p1, pin.p2], [2.92, 1.457]);
  assert.deepEqual(m.h2h, { matches: 1, p1Wins: 0, p2Wins: 1 }); // gli scontri diretti seguono lo scambio
  assert.equal(m.category, "tour"); assert.equal(m.level_id, 3);
});

test("programma: Pinnacle assente → solo Marathonbet; nessuna quota inventata", () => {
  const m = normalizeUpcoming(upcomingAtpNoPin, "atp");
  assert.equal(m.odds_sources.length, 1); assert.equal(m.odds_sources[0].book, "Marathonbet");
  const none = normalizeUpcoming({ ...upcomingAtpNoPin, player1: { ...upcomingAtpNoPin.player1, odd: null }, player2: { ...upcomingAtpNoPin.player2, odd: "0" } }, "atp");
  assert.deepEqual(none.odds_sources, []);
  assert.equal(validOdd("1.0"), null); assert.equal(validOdd("abc"), null); assert.equal(validOdd("1,5"), 1.5);
});

test("programma: stato sconosciuto non interpretato, righe malformate scartate", () => {
  assert.equal(normalizeUpcoming({ ...upcomingAtpNoPin, startTimeStatus: "boh" }, "atp").status, "unknown");
  assert.equal(normalizeUpcoming({ ...upcomingAtpNoPin, date: "non-una-data" }, "atp"), null);
  assert.equal(normalizeUpcoming({ ...upcomingAtpNoPin, player2: null }, "atp"), null);
  assert.equal(normalizeUpcoming(null, "atp"), null);
});

test("risultati: vincitore legato all'ID (player1 = vincitore), formato dal provider, doppi scartati", () => {
  const r = normalizeResult(resultSingles, "atp");
  assert.equal(r.p1_id, "53532"); assert.equal(r.winner, 1); assert.equal(r.best_of, 3); assert.equal(r.status, "finished"); assert.equal(r.score, "6-3 6-3");
  const swapped = normalizeResult({ ...resultSingles, player1Id: 81784, player2Id: 53532, match_winner: 81784, player1: resultSingles.player2, player2: resultSingles.player1 }, "atp");
  assert.equal(swapped.p1_id, "53532"); assert.equal(swapped.winner, 2); // stesso incontro, stessa chiave, vincitore coerente
  assert.equal(swapped.match_key, r.match_key);
  assert.equal(normalizeResult(resultDoubles, "atp"), null);
});

test("risultati: esito non 'completed' o vincitore ignoto NON diventa una vittoria normale", () => {
  const ret = normalizeResult({ ...resultSingles, result_type: "retired" }, "atp");
  assert.equal(ret.winner, null); assert.equal(ret.status, "unknown"); assert.equal(ret.result_type, "retired");
  assert.equal(normalizeResult({ ...resultSingles, match_winner: 999 }, "atp").winner, null);
  assert.equal(normalizeResult({ ...resultSingles, best_of: "7" }, "atp").best_of, null);
});

test("programma e risultati dello stesso incontro condividono la chiave", () => {
  const up = normalizeUpcoming({ ...upcomingAtpNoPin, roundId: 5, tournament: { id: 22198, name: "Knoxville Challenger", rankId: 1 }, player1: { id: 81784, name: "Petr Nesterov", odd: "3.14" }, player2: { id: 53532, name: "Liam Draxl", odd: "1.3" } }, "atp");
  assert.equal(up.match_key, normalizeResult(resultSingles, "atp").match_key);
});

test("readPage: programma, risultati e risposte inattese", () => {
  assert.equal(readPage({ matches: [1], hasNextPage: true }).hasNext, true);
  assert.equal(readPage({ data: [1, 2] }).items.length, 2);
  assert.ok(readPage({ boh: 1 }).problem); assert.ok(readPage(null).problem); assert.ok(readPage("testo").problem);
});

test("il file del provider non contiene chiavi né importa moduli del calcio", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../functions/api/_tennis-provider.js", import.meta.url), "utf8");
  assert.doesNotMatch(src, /process\.env|API_KEY\s*=|x-gravitee|import .* from/i);
});

test("migrazione provider: solo additiva, nessuna operazione distruttiva né sul calcio", async () => {
  const fs = await import("node:fs");
  const sql = fs.readFileSync(new URL("../supabase/migrations/202611140001_tennis_provider_fields.sql", import.meta.url), "utf8").replace(/--.*$/gm, "");
  assert.doesNotMatch(sql, /\b(drop\s+(table|column|index|view|function)|delete\s+from|truncate|rename)\b/i);
  for (const stmt of sql.split(";").map((s) => s.trim()).filter(Boolean)) assert.match(stmt, /public\.tennis_|tennis_matches/i);
});
