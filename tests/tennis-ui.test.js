import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { DEFAULT_FILTERS, facets, filterMatches, groupByTournament, sanitizeFilters, sanitizeMatches, surfaceLabel } from "../src/tennis/board.js";
import { detailHtml, emptyHtml, rowHtml as matchCardHtml } from "../src/tennis/view.js";
import { tennisMonitorHtml } from "../src/tennis/monitor.js";

const mk = (over = {}) => ({
  key: "a|b|t|r1", tour: "atp", tournament: "Torneo Uno", round: "Ottavi", surface: "Clay", bestOf: 3,
  startsAt: "2026-11-14T10:00:00Z", status: "scheduled", p1: { id: "a", name: "Mario Rossi", rank: 12 }, p2: { id: "b", name: "Luca Bianchi", rank: 40 },
  odds: { p1: 1.7, p2: 2.2, source: "Pinnacle" },
  prediction: { published: true, pick: 1, p1: 0.64, p2: 0.36, reliability: "media", reasons: ["Elo misto generale/clay: 1650 contro 1580."], missing: ["scontri diretti"], abstainReason: null,
    computedAt: "2026-11-13T08:00:00Z", modelVersion: "tennis-v1", components: { eloDiff: 70, formAdj: 8, h2hAdj: 0, fatigueAdj: 0, pElo: 0.62, pPoint: null, n1: 40, n2: 33, nSurf1: 12, nSurf2: 9, load1: 1, load2: 2 } },
  ...over,
});
const sample = [
  mk(),
  mk({ key: "c|d|t2|f", tour: "wta", tournament: "Torneo Due", surface: "Hard", startsAt: "2026-11-15T09:00:00Z", p1: { id: "c", name: "Anna Verdi" }, p2: { id: "d", name: "Eva Neri" }, prediction: { published: false, abstainReason: "Partita equilibrata.", reasons: [], missing: [] } }),
  mk({ key: "e|f|t|r2", surface: "Grass", startsAt: "2026-11-14T12:00:00Z", prediction: null }),
];

test("facets e filtri sui dati reali", () => {
  const fx = facets(sample);
  assert.deepEqual(fx.tours, ["atp", "wta"]); assert.deepEqual(fx.surfaces, ["hard", "clay", "grass"]);
  assert.deepEqual(fx.tournaments, ["Torneo Due", "Torneo Uno"]); assert.equal(fx.days.length, 2);
  assert.equal(filterMatches(sample, DEFAULT_FILTERS).length, 3);
  assert.equal(filterMatches(sample, { ...DEFAULT_FILTERS, tour: "wta" }).length, 1);
  assert.equal(filterMatches(sample, { ...DEFAULT_FILTERS, surface: "clay" }).length, 1);
  assert.equal(filterMatches(sample, { ...DEFAULT_FILTERS, tournament: "Torneo Uno" }).length, 2);
  assert.equal(filterMatches(sample, { ...DEFAULT_FILTERS, onlyPicks: true }).length, 1);
  assert.equal(filterMatches(sample, { ...DEFAULT_FILTERS, day: fx.days[1] }).length, 1);
});

test("filtri non più validi tornano a 'tutti'", () => {
  const f = sanitizeFilters({ tour: "wta", surface: "clay", tournament: "Inesistente", day: "2020-01-01" }, [sample[0]]);
  assert.equal(f.tour, "all"); assert.equal(f.surface, "clay"); assert.equal(f.tournament, "all"); assert.equal(f.day, "all");
});

test("righe incomplete scartate senza rompere la lista", () => {
  assert.deepEqual(sanitizeMatches(null), []);
  const bad = [null, {}, { key: "x" }, mk({ startsAt: "non-una-data" }), mk({ tour: "itf" }), mk({ p2: {} }), mk()];
  assert.equal(sanitizeMatches(bad).length, 1);
});

test("raggruppamento per torneo, ordine per orario", () => {
  const g = groupByTournament(sample);
  assert.equal(g.length, 2);
  assert.equal(g[0].tournament, "Torneo Uno"); assert.equal(g[0].matches.length, 2);
  assert.ok(new Date(g[0].matches[0].startsAt) <= new Date(g[0].matches[1].startsAt));
  assert.equal(surfaceLabel(mk({ surface: "I.hard" })), "Cemento");
});

test("scheda: pronostico, astensione, in attesa; nessuna garanzia presentata", () => {
  const a = matchCardHtml(sample[0]);
  assert.match(a, /Vince Mario Rossi/); assert.match(a, /64%/); assert.match(a, /quota 1,70/); assert.match(a, /class="row/);
  assert.match(matchCardHtml(sample[1]), /Nessun pronostico/);
  assert.match(matchCardHtml(sample[2]), /In attesa di analisi/);
  assert.doesNotMatch(a, /garantit|sicur/i);
  assert.match(matchCardHtml(mk({ odds: null })), /quota reale non disponibile/);
});

test("scheda: esito a partita conclusa (centrato / non centrato)", () => {
  const ok = matchCardHtml(mk({ status: "finished", winner: 1, score: "6-4 6-3" }));
  assert.match(ok, /Centrato/); assert.match(ok, /6 6/);
  assert.match(matchCardHtml(mk({ status: "finished", winner: 2, score: "4-6 3-6" })), /Non centrato/);
});

test("nessuna iniezione HTML dai dati del provider", () => {
  const evil = mk({ tournament: '<img src=x onerror=alert(1)>', p1: { id: "a", name: '"><script>alert(1)</script>' } });
  for (const html of [matchCardHtml(evil), detailHtml(evil)]) {
    assert.doesNotMatch(html, /<script/i); assert.doesNotMatch(html, /<img src=x/i);
  }
});

test("dettaglio: statistiche usate, dati mancanti, avvertenza", () => {
  const html = detailHtml({ ...sample[0], stats: { p1: { serve: 0.66, ret: 0.38, matches: 20 }, p2: { serve: 0.62, ret: 0.35, matches: 18 } }, h2h: { p1Wins: 2, p2Wins: 1 } });
  assert.match(html, /Differenza di rating/); assert.match(html, /Punti vinti al servizio/); assert.match(html, /66,0%/);
  assert.match(html, /Scontri diretti/); assert.match(html, /scontri diretti: il modello li ha ignorati/);
  assert.match(html, /non una garanzia/); assert.match(html, /tennis-v1/);
  assert.match(html, /64%/);
  const none = detailHtml(sample[1]);
  assert.match(none, /Nessun pronostico/); assert.doesNotMatch(none, /class="tn-bar"/);
  assert.match(detailHtml(sample[2]), /non è ancora stato calcolato/);
});

test("stati vuoti e storico", () => {
  assert.match(emptyHtml("nodata"), /Nessun dato tennis/);
  assert.match(emptyHtml("filtered"), /Nessuna partita/);
  assert.match(emptyHtml("error", "<b>x</b>"), /&lt;b&gt;/);
  assert.match(tennisMonitorHtml({ rows: [], backtest: null }), /Ancora nessun caso concluso/);
  const row = (i, hit) => ({ key: "k" + i, published: true, pick: 1, p1: 0.62, hit, tour: "atp", category: "tour", surface: "clay", bet: null, modelVersion: "tennis-v2" });
  const h = tennisMonitorHtml({ rows: [row(1, true), row(2, false), row(3, true)], summary: { brier: 0.23 }, verdict: "campione insufficiente (3/300)", backtest: null });
  assert.match(h, /Pronostici · il vincitore/); assert.match(h, /Taratura/); assert.match(h, /Terra/); assert.match(h, /Per versione del modello/); assert.match(h, /Intervallo al 95%/);
  assert.match(tennisMonitorHtml({ rows: [], backtest: null }, "hist"), /Rapporto storico non ancora calcolato/);
});

test("collegamento nell'HTML: menu sport a tendina, script, nessuna schermata iniziale", () => {
  const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /id="sport-slot"/); assert.match(html, /src="\/src\/sport\.js"/); assert.match(html, /src="\/src\/main\.js"/);
  const sport = fs.readFileSync(new URL("../src/sport.js", import.meta.url), "utf8");
  assert.match(sport, /import\("\.\/tennis\/app\.js"\)/); assert.match(sport, /sport-loader/);
  assert.doesNotMatch(sport, /sport-gate|sg-card/);
  assert.doesNotMatch(fs.readFileSync(new URL("../src/main.js", import.meta.url), "utf8"), /tennis/i, "main.js del calcio non deve conoscere il tennis");
});

test("nessun segreto né chiave del provider nel codice servito al browser", () => {
  for (const f of ["src/sport.js", "src/tennis/app.js", "src/tennis/view.js", "src/tennis/board.js", "functions/api/tennis-board.js"]) {
    const t = fs.readFileSync(new URL(`../${f}`, import.meta.url), "utf8");
    assert.doesNotMatch(t, /TENNIS_API_KEY|X-RapidAPI|rapidapi/i, f);
  }
});
