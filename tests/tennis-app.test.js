import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { filterMatches, sections, DEFAULT_FILTERS, sanitizeFilters, filterHistory, flag, facets } from "../src/tennis/board.js";
import { diagnosticsHtml, historyViewHtml, matchCardHtml, detailHtml, sectionsHtml } from "../src/tennis/view.js";
import { groupByTournament } from "../src/tennis/board.js";
import { buildBoard, historyRow, summarizeHistory, effectiveStatus } from "../functions/api/_tennis-snapshot.js";

const NOW = Date.parse("2026-11-13T10:00:00Z");
const mk = (o = {}) => ({ key: "k" + Math.random(), tour: "atp", category: "tour", tournament: "Torino", surface: "I.hard", startsAt: "2026-11-13T14:00:00Z", status: "scheduled", p1: { id: "1", name: "Alexander Zverev", country: "GER", rank: 1 }, p2: { id: "2", name: "Rafael Jódar", rank: 30 }, prediction: null, bet: null, odds: null, ...o });
const list = [mk(), mk({ status: "live", live: { sets: [[6, 4], [3, 3]] } }), mk({ status: "finished", winner: 1, score: "6-4 6-4", startsAt: "2026-11-12T10:00:00Z" }), mk({ tour: "wta", category: "itf", tournament: "W35 Weston", p1: { id: "3", name: "Ashley Lahey" }, p2: { id: "4", name: "Brooke Black" }, startsAt: "2026-11-15T10:00:00Z" }), mk({ status: "ended_other", resultType: "walkover", startsAt: "2026-11-12T09:00:00Z" })];

test("sezioni: live, oggi, prossimi giorni, concluse; ritiri/walkover non tra le concluse regolari ma mostrati", () => {
  const s = sections(list, NOW); assert.deepEqual(s.map((x) => x.id), ["live", "today", "upcoming", "finished"]);
  assert.equal(s.find((x) => x.id === "finished").matches.length, 2);
  assert.match(sectionsHtml(s, groupByTournament), /walkover/);
});
test("filtri reali: ricerca senza accenti, categoria, genere, stato, solo BET", () => {
  assert.equal(filterMatches(list, { ...DEFAULT_FILTERS, q: "jodar" }).length, 4);
  assert.equal(filterMatches(list, { ...DEFAULT_FILTERS, q: "weston" }).length, 1);
  assert.equal(filterMatches(list, { ...DEFAULT_FILTERS, category: "itf" }).length, 1);
  assert.equal(filterMatches(list, { ...DEFAULT_FILTERS, tour: "wta" }).length, 1);
  assert.equal(filterMatches(list, { ...DEFAULT_FILTERS, status: "live" }).length, 1);
  assert.equal(filterMatches(list, { ...DEFAULT_FILTERS, onlyBet: true }).length, 0);
  assert.equal(sanitizeFilters({ category: "challenger" }, list).category, "all"); assert.deepEqual(facets(list).categories, ["tour", "itf"]);
});
test("bandiere solo per codici noti; scheda con BET, punteggio live e categoria", () => {
  assert.equal(flag("GER"), "🇩🇪"); assert.equal(flag("N/A"), "");
  const h = matchCardHtml(mk({ status: "live", live: { sets: [[6, 4]] }, bet: { verdict: "BET", reasons: ["ok"] } }));
  assert.match(h, /6-4/); assert.match(h, /BET/); assert.match(h, /ATP Tour/);
  const d = detailHtml(mk({ bet: { verdict: "EVITA", reasons: ["Quote non disponibili"] } })); assert.match(d, /EVITA/); assert.match(d, /Quote, EV/);
  assert.match(detailHtml(mk()), /non ha restituito quote/);
});
const preds = (n) => Array.from({ length: n }, (_, i) => ({ match_key: "p" + i, starts_at: new Date(NOW - (i + 1) * 86400e3).toISOString(), tour: i % 2 ? "wta" : "atp", surface: "Hard", published: i % 5 !== 0, pick: 1, p1: 0.65, reliability: "media", abstain_reason: "x", bet: i % 3 === 0 ? { verdict: "BET", odds: 1.8, ev: 0.1 } : null, model_ver: "tennis-v2", tennis_matches: { status: "finished", winner: i % 4 === 0 ? 2 : 1, score: "6-4 6-4", category: i % 2 ? "itf" : "tour", tournament: "T", p1_name: "A", p2_name: "B" } }));
test("storico: filtri periodo/categoria/esito, metriche sul filtro, astenuti separati, ROI dei BET", () => {
  const rows = preds(20).map(historyRow);
  assert.equal(filterHistory(rows, { period: "7", category: "all", tour: "all", outcome: "all" }, NOW).length, 7);
  assert.equal(filterHistory(rows, { period: "all", category: "itf", tour: "all", outcome: "all" }, NOW).every((r) => r.category === "itf"), true);
  assert.ok(filterHistory(rows, { period: "all", category: "all", tour: "all", outcome: "abstained" }, NOW).every((r) => !r.published));
  const s = summarizeHistory(rows); assert.equal(s.hits + s.misses, s.summary.n); assert.equal(s.abstained, 4); assert.match(s.verdict, /insufficiente/);
  assert.ok(s.bet.n > 0 && Number.isFinite(s.bet.roi));
  assert.match(historyViewHtml({ ...s, rows, backtest: null }, undefined, NOW), /Pronostici registrati/);
});
test("snapshot: stato live dal feed fresco, esito non ricevuto dopo 12 ore, diagnostica senza segreti", () => {
  const row = { status: "scheduled", starts_at: new Date(NOW - 3600e3).toISOString() };
  assert.equal(effectiveStatus(row, { status: "live", seen_at: new Date(NOW - 60e3).toISOString() }, NOW), "live");
  assert.equal(effectiveStatus(row, { status: "live", seen_at: new Date(NOW - 3600e3).toISOString() }, NOW), "scheduled");
  assert.equal(effectiveStatus({ status: "scheduled", starts_at: new Date(NOW - 20 * 3600e3).toISOString() }, null, NOW), "unknown");
  const b = buildBoard({ now: NOW, matches: [], players: new Map(), rankings: new Map(), stats: new Map(), live: new Map(), predictions: new Map(), historyRows: [], sync: new Map(), usage: [], totals: {} });
  const html = diagnosticsHtml(b.diagnostics, b.updatedAt); assert.match(html, /Provider/); assert.match(html, /Limitazioni/); assert.match(html, /nessuna sincronizzazione riuscita/);
});
test("isolamento dal calcio: nessun file del calcio importa il tennis e viceversa", () => {
  for (const f of ["functions/api/model.js", "functions/api/_brain.js", "functions/api/board.js", "src/main.js"]) assert.doesNotMatch(fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), /tennis/i, f);
  for (const f of ["scripts/tennis-sync.js", "functions/api/_tennis-snapshot.js", "functions/api/_tennis-bet.js", "functions/api/_tennis-client.js"]) assert.doesNotMatch(fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), /_brain|_apifootball|app_snapshot|\bmatches"\s*[,)]/, f);
  assert.doesNotMatch(fs.readFileSync(new URL("../supabase/migrations/202611150001_tennis_sync.sql", import.meta.url), "utf8"), /drop table|delete from|truncate/i);
});
