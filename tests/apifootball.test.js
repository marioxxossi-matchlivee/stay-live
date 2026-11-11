import test from "node:test";
import assert from "node:assert/strict";
import { AF_LEAGUES, afFetch, rateGate, betIdsFrom, pickCoach, cacheKey, directMap, fetchAfSeason, leagueCheck, normalizeAfFixture, pickFixture, planFor, seasonFor, summarizeOdds, ttlFor } from "../functions/api/_apifootball.js";
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
  assert.equal(ttlFor("odds", { kickoff: ko(40), now }), 12 * 3600e3);
  assert.equal(ttlFor("odds", { kickoff: ko(10), now }), 4 * 3600e3);
  assert.equal(ttlFor("odds", { kickoff: ko(2), now }), 90 * 60e3);
  assert.equal(ttlFor("fixture", { kickoff: ko(1), now }), 5 * 60e3);
  assert.equal(ttlFor("fixture", { kickoff: ko(100), now }), 48 * 3600e3);
  assert.equal(ttlFor("injuries", { kickoff: ko(30), now }), 24 * 3600e3);
  assert.equal(ttlFor("predictions", { kickoff: ko(5), now }), 12 * 3600e3);
  assert.equal(ttlFor("fixture", { kickoff: ko(-5), now, finished: true }), 30 * 86400e3);
  assert.equal(ttlFor("predictions", { kickoff: ko(-5), now }), 30 * 86400e3, "partita finita da ore: dato definitivo anche se l'app non l'ha ancora segnata finale");
  assert.equal(ttlFor("h2h", {}), 30 * 86400e3);
  assert.equal(ttlFor("odds-bets", {}), 30 * 86400e3);
});

test("piano richieste: essenziale 6 sezioni, 13 con i dati extra (7 senza squadre note)", () => {
  const base = { fixtureId: 99, leagueId: 135, season: 2026, kickoff: Date.parse("2026-10-31T19:45:00Z"), now: Date.parse("2026-10-30T12:00:00Z") };
  assert.deepEqual(planFor({ ...base, homeId: 489, awayId: 505 }).map((r) => r.section), ["fixture", "injuries", "predictions", "oddsGoals", "odds1x2", "coverage"]);
  const full = planFor({ ...base, homeId: 489, awayId: 505, extra: true });
  assert.deepEqual(full.map((r) => r.section).sort(), ["coachAway", "coachHome", "coverage", "fixture", "h2h", "injuries", "odds1x2", "oddsCorners", "oddsGoals", "predictions", "standings", "teamAway", "teamHome"]);
  assert.deepEqual(full.find((r) => r.section === "h2h").params, { h2h: "489-505", last: 10 });
  assert.deepEqual(full.find((r) => r.section === "oddsCorners").params, { fixture: 99, bet: 45 });
  assert.equal(planFor({ ...base, extra: true }).length, 8);   // senza squadre note: niente h2h, statistiche e allenatori
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
  const ids = betIdsFrom([{ id: 1, name: "Match Winner" }, { id: 5, name: "Goals Over/Under" }, { id: 45, name: "Corners Over Under" }, { id: 77, name: "Goals Over/Under First Half" }, { id: 56, name: "Corners 1x2" }]);
  assert.deepEqual(ids, { goals: 5, corners: 45, winner: 1, doubleChance: 12, btts: 8, cornerWinner: 56 });
  assert.deepEqual(betIdsFrom([{ id: 9, name: "Goals Over/Under" }, { id: 8, name: "Corners Over Under" }]), { goals: 9, corners: 8, winner: 1, doubleChance: 12, btts: 8, cornerWinner: 55 });
  assert.deepEqual(betIdsFrom(undefined), { goals: 5, corners: 45, winner: 1, doubleChance: 12, btts: 8, cornerWinner: 55 });
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

test("partita API-Football -> riga matches", () => {
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
  assert.equal(directMap({ ...m, game_id: "seriea-20261031-int-mil", league: "seriea" }), null);   // id storico non API-Football: si cerca per orario e nomi (poi lo riallinea scripts/migrate-ninjas-ids.js)
});

test("configurazione campionati: tutte le voci coerenti", () => {
  assert.ok(LEAGUES.length >= 69, "32 originali + aggiunti dopo la scoperta delle partite");
  assert.equal(new Set(LEAGUES.map((l) => l.id)).size, LEAGUES.length, "id app unici");
  assert.equal(new Set(LEAGUES.map((l) => l.afId)).size, LEAGUES.length, "ogni id API-Football una sola volta (niente partite doppie)");
  assert.equal(new Set(LEAGUES.map((l) => l.id)).size, LEAGUES.length);
  assert.equal(new Set(LEAGUES.map((l) => l.afId)).size, LEAGUES.length);                       // nessun id API-Football ripetuto
  for (const l of LEAGUES) {
    assert.ok(l.afId > 0 && l.name && l.short && l.continent && l.country && l.nation && Number.isInteger(l.tier), l.id);
    assert.ok(!("oddsKey" in l), `${l.id}: The Odds API non è più usata`);
    assert.equal(l.provider, "apifootball", `${l.id}: tutti i campionati arrivano da API-Football`);
    assert.ok(l.afCountry, l.id);
  }
  assert.equal(LEAGUES.filter((l) => l.provider === "apifootball").length, LEAGUES.length);
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

test("rateGate: le richieste partono distanziate, anche se chieste insieme", async () => {
  const t0 = Date.now();
  const starts = await Promise.all([0, 1, 2, 3].map(() => rateGate(60).then(() => Date.now() - t0)));
  starts.sort((a, b) => a - b);
  for (let i = 1; i < starts.length; i += 1) assert.ok(starts[i] - starts[i - 1] >= 45, `distanza ${starts[i] - starts[i - 1]} ms`);
});

test("afFetch: riprova dopo 'Too many requests' e poi riesce", async () => {
  const real = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    const limited = calls < 2;
    return new Response(JSON.stringify(limited ? { errors: { rateLimit: "Too many requests. You have exceeded the limit of requests per minute of your subscription." }, response: [] } : { errors: [], results: 1, response: [{ ok: 1 }] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const r = await afFetch({ API_FOOTBALL_KEY: "k", API_FOOTBALL_MIN_GAP_MS: "0" }, "fixtures", { id: 1 }, { retries: 2 });
    assert.equal(calls, 2);
    assert.deepEqual(r.response, [{ ok: 1 }]);
    calls = -10;   // sempre limitato: senza retries l'errore arriva subito, marcato come rateLimited
    await assert.rejects(afFetch({ API_FOOTBALL_KEY: "k", API_FOOTBALL_MIN_GAP_MS: "0" }, "fixtures", { id: 1 }), (e) => e.rateLimited === true);
  } finally { globalThis.fetch = real; }
});

test("sincronizzazione: nessuna partita restituita = errore esplicito (stagione o id sbagliati), non '0 partite' in silenzio", async () => {
  const real = globalThis.fetch, cfg = LEAGUES.find((l) => l.id === "efl2");
  globalThis.fetch = async (url) => (String(url).includes("/rest/v1/") ? new Response("[]", { headers: { "content-type": "application/json" } }) : new Response(JSON.stringify({ errors: [], results: 0, response: [] }), { headers: { "content-type": "application/json" } }));
  try {
    await assert.rejects(fetchAfSeason({ SUPABASE_URL: "https://sb.test", SUPABASE_SERVICE_ROLE_KEY: "sr", API_FOOTBALL_KEY: "k", API_FOOTBALL_MIN_GAP_MS: "0" }, cfg, Date.parse("2026-11-10T10:00:00Z")), /stagione o id da verificare/);
  } finally { globalThis.fetch = real; }
});

test("stagione API-Football fissata a mano (afSeason): richieste con la stagione del provider, nell'app la stagione corrente", async () => {
  const { AF_SEASON } = await import("../functions/api/_apifootball.js");
  const { SEASON } = await import("../functions/api/_lib.js");
  assert.equal(AF_SEASON.get("j1"), 2027);
  for (const id of ["j1"]) assert.equal(seasonFor(id, "2026-11-20T10:00:00Z"), AF_SEASON.get(id), `${id}: stagione del provider`);
  assert.equal(seasonFor("seriea", "2026-11-20T10:00:00Z"), 2026, "le altre seguono la regola normale");
  const cfg = LEAGUES.find((l) => l.id === "j1");
  const row = normalizeAfFixture({ fixture: { id: 9, date: "2026-11-20T10:00:00Z", status: { short: "NS" } }, league: { id: 98, name: "J1 League", country: "Japan", round: "Regular Season - 38" }, teams: { home: { id: 1, name: "A" }, away: { id: 2, name: "B" } }, goals: {}, score: {} }, cfg, 2027);
  assert.equal(row.season, SEASON, "la riga resta nella stagione corrente dell'app, altrimenti sparirebbe dall'elenco");
  assert.equal(directMap({ game_id: "af-9", league: "j1", season: SEASON, kickoff_at: "2026-11-20T10:00:00Z", home_id: "af-1", away_id: "af-2" }).season, 2027, "gli endpoint di API-Football ricevono la sua stagione");
});
