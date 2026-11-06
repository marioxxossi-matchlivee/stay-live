import test from "node:test";
import assert from "node:assert/strict";
import { renderAfDetail, uoText } from "../src/afdetail.js";

const bestOdd = (odd, book, median, n) => ({ best: { odd, book }, median, n });
const FULL = {
  mapped: true,
  game: { id: "x", home: "Coventry City", away: "Leeds <b>United</b>" },
  apiFixtureId: 1234,
  fixture: {
    fixture: { id: 1234, referee: "Michael Oliver, England", date: "2026-11-03T19:45:00+00:00", venue: { name: "Coventry Building Society Arena", city: "Coventry" }, status: { long: "Match Finished", short: "FT", elapsed: 90 } },
    league: { name: "Championship", country: "England", round: "Regular Season - 15", season: 2026 },
    teams: { home: { id: 10, name: "Coventry City" }, away: { id: 11, name: "Leeds United" } },
    goals: { home: 2, away: 2 }, score: { halftime: { home: 1, away: 0 }, fulltime: { home: 2, away: 2 } },
    events: [{ time: { elapsed: 23, extra: null }, team: { name: "Coventry City" }, player: { name: "Sheaf" }, assist: { name: "Hamer" }, type: "Goal", detail: "Normal Goal" }, { time: { elapsed: 90, extra: 3 }, team: { name: "Leeds United" }, player: { name: "Bamford" }, assist: { name: null }, type: "Card", detail: "Red Card" }],
    lineups: [{ team: { name: "Coventry City" }, formation: "3-4-2-1", coach: { name: "Frank Lampard" }, startXI: [{ player: { number: 1, name: "Wilson", pos: "G" } }], substitutes: [{ player: { number: 12, name: "Latibeaudiere" } }] }],
    statistics: [{ team: { name: "Coventry City" }, statistics: [{ type: "Corner Kicks", value: 7 }, { type: "Ball Possession", value: "55%" }] }, { team: { name: "Leeds United" }, statistics: [{ type: "Corner Kicks", value: 4 }, { type: "Ball Possession", value: "45%" }] }],
    players: [{ team: { name: "Coventry City" }, players: [{ player: { name: "Sheaf" }, statistics: [{ games: { minutes: 90, position: "M", rating: "7.4" }, goals: { total: 1, assists: 0 }, cards: { yellow: 1, red: 0 } }] }, { player: { name: "Panchinaro" }, statistics: [{ games: { minutes: null } }] }] }],
  },
  injuries: [{ player: { name: "Hamer", type: "Missing Fixture", reason: "Knee Injury" }, team: { name: "Coventry City" } }, { player: { name: "Piroe", type: "Questionable", reason: "Hamstring" }, team: { name: "Leeds United" } }],
  predictions: {
    predictions: { advice: "Double chance : Leeds United or draw", winner: { name: "Leeds United", comment: "Win or draw" }, win_or_draw: true, under_over: "-3.5", goals: { home: "-2.5", away: "-1.5" }, percent: { home: "20%", draw: "35%", away: "45%" } },
    comparison: { form: { home: "40%", away: "60%" }, att: { home: "55%", away: "45%" } },
    teams: { home: { name: "Coventry City", last_5: { form: "60%", att: "50%", def: "40%", goals: { for: { average: "1.6" }, against: { average: "1.0" } } } }, away: { name: "Leeds United", last_5: { form: "80%" } } },
  },
  odds: { bookmakers: 3, ou25: { over: bestOdd(1.95, "Pinnacle", 1.9, 3), under: bestOdd(1.95, "Unibet", 1.9, 3) }, goalLines: [{ line: 2.5, over: bestOdd(1.95, "Pinnacle", 1.9, 3), under: null }], corners: { lines: [{ line: 9.5, over: bestOdd(1.84, "Pinnacle", 1.82, 2), under: bestOdd(2, "Bet365", 1.98, 2) }], mainLine: 9.5 } },
  h2h: [{ fixture: { date: "2026-02-10T20:00:00+00:00" }, league: { name: "Championship" }, teams: { home: { name: "Leeds United" }, away: { name: "Coventry City" } }, goals: { home: 3, away: 1 } }, { fixture: { date: "2025-10-10T20:00:00+00:00" }, league: { name: "Championship" }, teams: { home: { name: "Coventry City" }, away: { name: "Leeds United" } }, goals: { home: 0, away: 1 } }],
  standings: [[{ rank: 1, team: { id: 11, name: "Leeds United" }, points: 33, goalsDiff: 14, form: "WWDWW", all: { played: 15, win: 10, draw: 3, lose: 2, goals: { for: 30, against: 16 } } }, { rank: 2, team: { id: 99, name: "Altri" }, points: 30, goalsDiff: 5, form: "LLWWD", all: { played: 15, win: 9, draw: 3, lose: 3, goals: { for: 25, against: 20 } } }]],
  teamStats: { home: { form: "WWDLWDLWWDW", fixtures: { played: { home: 7, away: 8, total: 15 } }, goals: { for: { total: { home: 12, away: 10, total: 22 }, average: { home: "1.7", away: "1.3", total: "1.5" } } }, lineups: [{ formation: "3-4-2-1", played: 9 }, { formation: "4-2-3-1", played: 3 }] }, away: null },
  coaches: { home: { name: "Frank Lampard", age: 48, nationality: "England", since: "2025-11-01" }, away: null },
  coverage: { fixtures: { events: true, lineups: true, statistics_fixtures: true, statistics_players: false }, standings: true, injuries: true, predictions: true, odds: true },
  freshness: { fixture: { source: "live", fetchedAt: "2026-11-03T18:00:00Z", error: null }, injuries: { source: "cache", fetchedAt: "2026-11-03T17:00:00Z", error: null }, oddsCorners: { source: "cache", fetchedAt: null, error: "Plan limit", stale: false } },
  usage: { requests: 40, remaining: 7460, limit: 7500 },
};

test("Under/Over del provider in italiano", () => {
  assert.equal(uoText("-3.5"), "Under 3,5");
  assert.equal(uoText("+2.5"), "Over 2,5");
  assert.equal(uoText(null), "—");
});

test("schermata completa: pronostico, infortuni, arbitro, allenatori, quote, corner", () => {
  const html = renderAfDetail(FULL);
  for (const piece of [
    "X2", "Doppia chance X2 (pareggio o trasferta)", "vince o pareggia", "Under 3,5", "Under 2,5", "45%",                           // pronostico
    "Hamer", "Infortunio: ginocchio", "Piroe", "Dubbio", "Assente",                                       // infortunati
    "Michael Oliver, Inghilterra", "Frank Lampard", "Inghilterra", "dal 2025-11-01",                          // arbitro e allenatori
    "Pinnacle", "mediana 1,90", "linea principale 9,5",                                    // quote e corner
    "Over 2,5 in <b>1</b> su 2", "Calci d&#39;angolo", "Possesso palla",     // h2h, statistiche
    "Espulsione", "Latibeaudiere", "Sheaf", "3-4-2-1 (9)",         // eventi, formazioni, giocatori, moduli
    "Plan limit", "7460",                                                                  // freschezza e utilizzo
  ]) assert.ok(html.includes(piece), `manca: ${piece}`);
  const noRef = renderAfDetail({ ...FULL, fixture: { ...FULL.fixture, fixture: { ...FULL.fixture.fixture, referee: null } } });
  assert.ok(noRef.includes("Non ancora designato"));
  assert.ok(!html.includes("Panchinaro"));                                                 // chi non ha giocato non compare
});

test("i valori dinamici sono sempre escapati", () => {
  const html = renderAfDetail(FULL);
  assert.ok(!html.includes("<b>United</b>"));
  assert.ok(html.includes("Leeds &lt;b&gt;United&lt;/b&gt;"));
  const evil = renderAfDetail({ mapped: true, game: {}, injuries: [{ player: { name: "<img src=x onerror=alert(1)>", type: "x", reason: "y" }, team: { name: "T" } }] });
  assert.ok(!evil.includes("<img"));
});

test("dati mancanti, partita non collegata o errore: nessuna eccezione", () => {
  assert.match(renderAfDetail({ mapped: false, reason: "Partita non trovata su API-Football" }), /Partita non trovata/);
  assert.ok(renderAfDetail({ mapped: true, game: { home: "A", away: "B" }, fixture: null, injuries: [], predictions: null, odds: null, h2h: [], standings: [], teamStats: {}, coaches: {}, freshness: {} }).includes("Pronostico non disponibile"));
  assert.ok(renderAfDetail({}).length > 0);
  assert.equal(renderAfDetail(null), '<p class="af-empty">Nessun dato.</p>');
  assert.match(renderAfDetail({ mapped: true, injuries: [], coverage: { injuries: false } }), /non ha la copertura infortuni/);
});

test("vista essenziale: solo le linee consigliate, corner nascosti, extra a richiesta", () => {
  const goal = (line, over, under) => ({ line, over: { best: { odd: over, book: "Bet365" }, median: over - 0.05, n: 9 }, under: { best: { odd: under, book: "Pinnacle" }, median: under - 0.05, n: 9 } });
  const d = { mapped: true, game: { home: "Inter", away: "Milan" }, injuries: [], predictions: null, fixture: null, extra: false, freshness: {},
    odds: { bookmakers: 9, ou25: null, goalLines: [goal(1.5, 1.4, 2.9), goal(2.5, 1.95, 1.9), goal(3.5, 3.2, 1.3)], corners: { lines: [{ line: 9.5, over: { best: { odd: 1.9, book: "X" }, median: 1.85, n: 5 }, under: null }], mainLine: 9.5 } } };
  const html = renderAfDetail(d, { lean: true, rec: [{ key: "over25", label: "Over 2,5", minOdds: 1.85 }, { key: "home", label: "1 · Vittoria casa", minOdds: 2 }] });
  assert.ok(html.includes("Over 2,5") && html.includes("quota di valore"), "1,95 >= quota minima 1,85");
  assert.ok(!html.includes("Under 3,5") && !html.includes("Over 1,5"), "le altre linee non compaiono");
  assert.ok(!html.includes("Calci d'angolo") && !html.includes("9,5"), "i corner non compaiono");
  assert.ok(html.includes("data-af-extra") && html.includes("data-af-refresh"));
  assert.ok(!html.includes("Classifica"), "classifica solo a richiesta");
  const low = renderAfDetail(d, { lean: true, rec: [{ key: "over25", label: "Over 2,5", minOdds: 2.2 }] });
  assert.ok(low.includes("sotto la minima"));
  assert.ok(renderAfDetail(d, { lean: true, rec: [] }).includes("Nessuna linea Over/Under"));
  const withExtra = renderAfDetail({ ...d, extra: true, standings: [], h2h: [], teamStats: {}, coaches: {} }, { lean: true, rec: [], extra: true });
  assert.ok(withExtra.includes("Classifica") && withExtra.includes("Scontri diretti") && !withExtra.includes("data-af-extra"));
  assert.ok(renderAfDetail(d, { lean: true, rec: [] }).includes("Nessun assente") === false, "senza infortuni la sezione non compare");
});

test("niente inglese residuo nella scheda: consiglio, assenze, ruoli", () => {
  const html = renderAfDetail(FULL);
  for (const eng of ["Double chance", "Knee Injury", "Missing Fixture", "Questionable", "Win or draw", "England"]) assert.ok(!html.includes(eng), `ancora in inglese: ${eng}`);
});
