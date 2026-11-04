import test from "node:test";
import assert from "node:assert/strict";
import { AF_LEAGUES, betIdsFrom, pickCoach, cacheKey, directMap, leagueCheck, normalizeAfFixture, pickFixture, planFor, seasonFor, summarizeOdds, ttlFor } from "../functions/api/_apifootball.js";
import { LEAGUES } from "../functions/api/_lib.js";

test("stagione: Europa dall'anno d'inizio (da luglio), MLS anno solare", () => {
  assert.equal(seasonFor("seriea", "2026-10-31T19:45:00Z"), 2026);
  assert.equal(seasonFor("seriea", "2027-02-10T19:45:00Z"), 2026);
  assert.equal(seasonFor("epl", "2026-07-01T12:00:00Z"), 2026);
  assert.equal(seasonFor("epl", "2026-06-30T12:00:00Z"), 2025);
  assert.equal(seasonFor("mls", "2026-03-01T20:00:00Z"), 2026);
  assert.equal(AF_LEAGUES.seriea, 135);
  assert.equal(AF_LEAGUES.ucl, 2);
});

test("chiave di cache stabile (parametri ordinati, vuoti ignorati)", () => {
  assert.equal(cacheKey("odds", { fixture: 7, bet: 5 }), "odds?bet=5&fixture=7");
  assert.equal(cacheKey("odds", { bet: 5, fixture: 7, x: null }), "odds?bet=5&fixture=7");
  assert.equal(cacheKey("odds/bets", {}), "odds/bets?");
});

test("TTL: piu' frequente vicino al match, stabile a partita finita", () => {
  const now = Date.parse("2026-10-30T12:00:00Z");
  const ko = (h) => now + h * 3600e3;
  assert.equal(ttlFor("odds", { kickoff: ko(40), now }), 60 * 60e3);
  assert.equal(ttlFor("odds", { kickoff: ko(10), now }), 30 * 60e3);
  assert.equal(ttlFor("odds", { kickoff: ko(3), now }), 15 * 60e3);
  assert.equal(ttlFor("fixture", { kickoff: ko(1), now }), 5 * 60e3);
  assert.equal(ttlFor("injuries", { kickoff: ko(30), now }), 60 * 60e3);
  assert.equal(ttlFor("fixture", { kickoff: ko(-5), now, finished: true }), 7 * 86400e3);
  assert.equal(ttlFor("h2h", {}), 7 * 86400e3);
  assert.equal(ttlFor("odds-bets", {}), 30 * 86400e3);
});

test("piano richieste: 12 sezioni con squadre note, 7 senza", () => {
  const base = { fixtureId: 99, leagueId: 135, season: 2026, kickoff: Date.parse("2026-10-31T19:45:00Z"), now: Date.parse("2026-10-30T12:00:00Z") };
  const full = planFor({ ...base, homeId: 489, awayId: 505 });
  assert.deepEqual(full.map((r) => r.section), ["fixture", "injuries", "predictions", "oddsGoals", "oddsCorners", "standings", "coverage", "h2h", "teamHome", "teamAway", "coachHome", "coachAway"]);
  assert.deepEqual(full.find((r) => r.section === "h2h").params, { h2h: "489-505", last: 10 });
  assert.deepEqual(full.find((r) => r.section === "oddsCorners").params, { fixture: 99, bet: 45 });
  assert.equal(planFor(base).length, 7);
});

test("abbinamento partita: orario e squadre; 'Milan' non diventa 'Inter'", () => {
  const match = { kickoff_at: "2026-10-31T19:45:00+00:00", home_name: "AC Milan", away_name: "Internazionale" };
  const fx = (id, date, h, a) => ({ fixture: { id, date }, teams: { home: { name: h }, away: { name: a } } });
  const list = [
    fx(1, "2026-10-31T19:45:00+00:00", "Inter", "AC Milan"),                 // squadre invertite: non e' questa
    fx(2, "2026-10-31T19:45:00+00:00", "AC Milan", "Inter"),
    fx(3, "2026-11-01T19:45:00+00:00", "AC Milan", "Inter"),                 // altro giorno
  ];
  assert.equal(pickFixture(match, list).fixture.id, 2);
  assert.equal(pickFixture(match, []), null);
  assert.equal(pickFixture({ ...match, home_name: "Lazio" }, list), null);
});

test("id mercati letti dall'elenco ufficiale, con ripiego sui valori noti", () => {
  assert.deepEqual(betIdsFrom([{ id: 1, name: "Match Winner" }, { id: 5, name: "Goals Over/Under" }, { id: 45, name: "Corners Over Under" }, { id: 77, name: "Goals Over/Under First Half" }]), { goals: 5, corners: 45 });
  assert.deepEqual(betIdsFrom([{ id: 9, name: "Goals Over/Under" }, { id: 8, name: "Corners Over Under" }]), { goals: 9, corners: 8 });
  assert.deepEqual(betIdsFrom(undefined), { goals: 5, corners: 45 });
});

const book = (name, bets) => ({ name, bets });
const bet = (name, values) => ({ name, values: Object.entries(values).map(([value, odd]) => ({ value, odd })) });

test("riepilogo quote: Over/Under 2.5, linee gol, corner (linea piu' bilanciata)", () => {
  const goals = [{ bookmakers: [
    book("Bet365", [bet("Goals Over/Under", { "Over 2.5": "1.90", "Under 2.5": "1.90", "Over 3.5": "3.10", "Under 3.5": "1.33" }), bet("Goals Over/Under First Half", { "Over 2.5": "9.00", "Under 2.5": "1.05" })]),
    book("Pinnacle", [bet("Goals Over/Under", { "Over 2.5": "1.95", "Under 2.5": "1.88" })]),
    book("Unibet", [bet("Goals Over/Under", { "Over 2.5": "1.85", "Under 2.5": "1.95" })]),
  ] }];
  const corners = [{ bookmakers: [
    book("Bet365", [bet("Corners Over Under", { "Over 9.5": "1.80", "Under 9.5": "2.00", "Over 10.5": "2.30", "Under 10.5": "1.60" }), bet("Home Corners Over/Under", { "Over 5.5": "1.01", "Under 5.5": "9.00" })]),
    book("Pinnacle", [bet("Corners Over Under", { "Over 9.5": "1.84", "Under 9.5": "1.96" })]),
  ] }];
  const s = summarizeOdds(goals, corners);
  assert.deepEqual([s.ou25.over.best.odd, s.ou25.over.best.book, s.ou25.over.median, s.ou25.over.n], [1.95, "Pinnacle", 1.9, 3]);
  assert.equal(s.ou25.under.best.odd, 1.95);
  assert.deepEqual(s.goalLines.map((l) => l.line), [2.5, 3.5]);          // niente linee del primo tempo
  assert.deepEqual(s.corners.lines.map((l) => l.line), [9.5, 10.5]);     // niente corner di casa/trasferta
  assert.equal(s.corners.mainLine, 9.5);
  assert.equal(s.bookmakers, 3);
  assert.deepEqual(summarizeOdds([], []), { ou25: null, goalLines: [], corners: { lines: [], mainLine: null }, bookmakers: 0 });
});

const AF_FX = (over = {}) => ({
  fixture: { id: 1234, date: "2026-11-07T15:00:00+00:00", status: { short: "NS" } },
  league: { id: 88, name: "Eredivisie", country: "Netherlands", round: "Regular Season - 12" },
  teams: { home: { id: 194, name: "Ajax" }, away: { id: 197, name: "PSV Eindhoven" } },
  goals: { home: null, away: null }, score: { fulltime: { home: null, away: null } },
  ...over,
});

test("partita API-Football -> riga matches (stessa forma di API Ninjas)", () => {
  const cfg = LEAGUES.find((l) => l.id === "eredivisie");
  const now = Date.parse("2026-11-03T10:00:00Z");
  const next = normalizeAfFixture(AF_FX(), cfg, 2026, now);
  assert.deepEqual([next.game_id, next.league, next.season, next.round, next.status, next.home_id, next.away_id, next.home_score, next.match_date, next.season_type],
    ["af-1234", "eredivisie", 2026, "12", "scheduled", "af-194", "af-197", null, "2026-11-07", "regular"]);
  // partita finita ai supplementari: conta il risultato dei 90 minuti
  const aet = normalizeAfFixture(AF_FX({ fixture: { id: 5, date: "2026-11-07T15:00:00+00:00", status: { short: "AET" } }, goals: { home: 3, away: 2 }, score: { fulltime: { home: 2, away: 2 } } }), cfg, 2026, now);
  assert.deepEqual([aet.status, aet.home_score, aet.away_score, aet.decided_in], ["final", 2, 2, "extra_time"]);
  const live = normalizeAfFixture(AF_FX({ fixture: { id: 6, date: "2026-11-03T09:00:00+00:00", status: { short: "2H" } }, goals: { home: 1, away: 0 } }), cfg, 2026, now);
  assert.deepEqual([live.status, live.home_score, live.away_score], ["in_progress", 1, 0]);
  assert.equal(normalizeAfFixture(AF_FX({ fixture: { id: 7, date: "2026-11-07T15:00:00+00:00", status: { short: "PST" } } }), cfg, 2026, now).status, "postponed");
  const cup = LEAGUES.find((l) => l.id === "uecl");
  assert.equal(normalizeAfFixture(AF_FX({ league: { round: "League Phase - 3" } }), cup, 2026, now).season_type, "league_phase");
  assert.equal(normalizeAfFixture(AF_FX({ league: { round: "Quarter-finals" } }), cup, 2026, now).round, "Quarter-finals");
});

test("controllo anti-errore sull'id campionato", () => {
  const ere = LEAGUES.find((l) => l.id === "eredivisie");
  assert.equal(leagueCheck(ere, { name: "Eredivisie", country: "Netherlands" }), null);
  assert.match(leagueCheck(ere, { name: "Eerste Divisie", country: "Netherlands" }), /non a Eredivisie/);
  assert.match(leagueCheck(ere, { name: "Eredivisie", country: "Belgium" }), /annullata/);
  const cz = LEAGUES.find((l) => l.id === "czech");
  assert.equal(leagueCheck(cz, { name: "Fortuna Liga", country: "Czech-Republic" }), null);   // solo il paese: il nome commerciale cambia
  assert.equal(leagueCheck(cz, undefined), null);
});

test("partite API-Football: collegamento diretto dal game_id", () => {
  const m = { game_id: "af-1234", league: "eredivisie", season: 2026, kickoff_at: "2026-11-07T15:00:00+00:00", home_id: "af-194", away_id: "af-197", home_name: "Ajax", away_name: "PSV" };
  assert.deepEqual([directMap(m).fixture_id, directMap(m).league_id, directMap(m).season, directMap(m).home_team_id, directMap(m).away_team_id], [1234, 88, 2026, 194, 197]);
  assert.equal(directMap({ ...m, game_id: "seriea-20261031-int-mil", league: "seriea" }), null);   // partite API Ninjas: si cerca per orario e nomi
});

test("configurazione campionati: 32 voci coerenti", () => {
  assert.equal(LEAGUES.length, 32);
  assert.equal(new Set(LEAGUES.map((l) => l.id)).size, LEAGUES.length);
  assert.equal(new Set(LEAGUES.map((l) => l.afId)).size, LEAGUES.length);                       // nessun id API-Football ripetuto
  for (const l of LEAGUES) {
    assert.ok(l.afId > 0 && l.name && l.short && l.continent && l.country && l.nation && Number.isInteger(l.tier), l.id);
    assert.ok(l.provider === "apifootball" ? Boolean(l.afCountry) && !l.oddsKey : Boolean(l.oddsKey), l.id);   // API Ninjas: chiave quote; API-Football: controllo paese
  }
  assert.equal(LEAGUES.filter((l) => l.provider === "apifootball").length, 24);
  assert.equal(seasonFor("eliteserien", "2026-11-03T10:00:00Z"), 2026);
  assert.equal(seasonFor("eliteserien", "2027-04-03T10:00:00Z"), 2027);                         // stagione solare
  assert.equal(seasonFor("eredivisie", "2027-04-03T10:00:00Z"), 2026);
  assert.equal(AF_LEAGUES.eredivisie, 88);
});

test("allenatore attuale: incarico senza data di fine presso la squadra", () => {
  const list = [
    { id: 1, name: "Ex Mister", age: 60, team: { id: 10 }, career: [{ team: { id: 10 }, start: "2019-01-01", end: "2024-06-30" }] },
    { id: 2, name: "Mister Attuale", age: 45, nationality: "Italy", team: { id: 10 }, career: [{ team: { id: 99 }, start: "2015-01-01", end: "2018-01-01" }, { team: { id: 10 }, start: "2024-07-01", end: null }] },
  ];
  assert.deepEqual([pickCoach(list, 10).name, pickCoach(list, 10).since, pickCoach(list, 10).nationality], ["Mister Attuale", "2024-07-01", "Italy"]);
  assert.equal(pickCoach([], 10), null);
  assert.equal(pickCoach(undefined, 10), null);
});
