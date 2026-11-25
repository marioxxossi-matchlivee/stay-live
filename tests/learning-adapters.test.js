import test from "node:test";
import assert from "node:assert/strict";
import { tennisRecords, footballRecords, missingFlags, sourceUsage } from "../functions/api/_learning-adapters.js";

const P = (o = {}) => ({ match_key: "21364|8|100|200", starts_at: "2026-11-20T10:00:00Z", tour: "atp", surface: "clay", published: true, p1: 0.62, p2: 0.38, missing: ["scontri diretti", "ranking"], odds_p1: 1.8, odds_p2: 2.1, odds_at: "2026-11-19T10:00:00Z", model_ver: "tennis-v2", ...o });

test("tennis: solo previsioni pubblicate con esito verificato; evento «vince il giocatore 1»; esclusioni contate", () => {
  const preds = [P(), P({ match_key: "a|1|2|3", published: false }), P({ match_key: "b|1|2|3" }), P({ match_key: "c|1|2|3", p1: null }), P({ match_key: "d|1|2|3", starts_at: "boh" }), P({ match_key: "e|1|2|3", p1: 0.7 })];
  const res = [{ match_key: "21364|8|100|200", winner: 2 }, { match_key: "c|1|2|3", winner: 1 }, { match_key: "d|1|2|3", winner: 1 }, { match_key: "e|1|2|3", winner: 1 }];
  const { records, skipped } = tennisRecords(preds, res);
  assert.equal(records.length, 2); assert.deepEqual(skipped, { notPublished: 1, noWinner: 1, badProbability: 1, badDate: 1 });
  const a = records.find((r) => r.id === "21364|8|100|200"), b = records.find((r) => r.id === "e|1|2|3");
  assert.equal(a.y, 0); assert.equal(b.y, 1); assert.equal(a.sport, "tennis"); assert.equal(a.group, a.id); assert.match(a.block, /^21364\|/); assert.equal(a.version, "tennis-v2"); assert.equal(a.prospective, true);
});

test("tennis: quote normalizzate solo con entrambe le quote; con una sola quota si dichiara che non è normalizzata; anticipo della quota", () => {
  const both = tennisRecords([P()], [{ match_key: "21364|8|100|200", winner: 1 }]).records[0], one = tennisRecords([P({ odds_p2: null })], [{ match_key: "21364|8|100|200", winner: 1 }]).records[0], none = tennisRecords([P({ odds_p1: null, odds_p2: null })], [{ match_key: "21364|8|100|200", winner: 1 }]).records[0];
  assert.equal(both.sources.marketNormalized, true); assert.ok(Math.abs(both.sources.market - (1 / 1.8) / (1 / 1.8 + 1 / 2.1)) < 1e-3);
  assert.equal(one.sources.marketNormalized, false); assert.ok(Math.abs(one.sources.market - 1 / 1.8) < 1e-3); assert.equal(none.sources.market, null);
  assert.equal(both.oddsAgeMin, 1440);
});

test("dati mancanti del tennis: testo → categorie stabili, nulla di inventato", () => {
  assert.deepEqual(missingFlags(["scontri diretti", "formato dell'incontro (dedotto dal torneo)", "statistiche di servizio e risposta", "ranking", "storico partite", "forma recente"]), { h2h: true, ranking: true, serveStats: true, history: true, format: true, form: true });
  assert.deepEqual(missingFlags([]), { h2h: false, ranking: false, serveStats: false, history: false, format: false, form: false }); assert.equal(missingFlags(null).h2h, false);
});

const F = (o = {}) => ({ game_id: 10, league: "serie_a", kickoff_at: "2026-11-18T18:00:00Z", sel_key: "home", p: 0.55, p_model: 0.5, p_api: 0.57, p_market: 0.54, verdict: "EVITA", basis: "api+mercato", model_ver: "63db1f35", won: true, ...o });

test("calcio: le ricostruzioni a posteriori restano fuori (non prospettiche); righe senza esito o con probabilità non valida escluse; fonti rispettate", () => {
  const rows = [F(), F({ sel_key: "draw", won: false, p_api: null }), F({ sel_key: "away", basis: "ricostruita" }), F({ sel_key: "dc1x", won: null }), F({ sel_key: "mg13", p: 1.2 }), F({ sel_key: "mg24", kickoff_at: null })];
  const { records, skipped } = footballRecords(rows); assert.equal(records.length, 2); assert.deepEqual(skipped, { reconstructed: 1, noOutcome: 1, badProbability: 1, badDate: 1 });
  assert.equal(records[0].group, "10"); assert.equal(records[0].segs.market, "home"); assert.equal(records[0].sources.api, 0.57); assert.equal(records[1].flags.noApi, true); assert.equal(records[1].sources.api, null);
  assert.equal(footballRecords(rows, { includeReconstructed: true }).records.length, 3); assert.equal(footballRecords(rows, { includeReconstructed: true }).records.find((r) => r.segs.basis === "ricostruita").prospective, false);
});

test("uso delle fonti: quote e frazioni calcolate sui dati, mai stimate", () => {
  const { records } = tennisRecords([P(), P({ match_key: "x|1|2|3", odds_p1: null, odds_p2: null, odds_at: null }), P({ match_key: "y|1|2|3", odds_p2: null })], [{ match_key: "21364|8|100|200", winner: 1 }, { match_key: "x|1|2|3", winner: 1 }, { match_key: "y|1|2|3", winner: 2 }]);
  const u = sourceUsage(records); assert.equal(u.n, 3); assert.equal(u.withMarket, 0.6667); assert.equal(u.withNormalizedMarket, 0.3333); assert.equal(u.withApi, 0); assert.equal(u.oddsAgeMinutes.n, 2); assert.equal(u.missingFlagShare.h2h, 1); assert.equal(sourceUsage([]).n, 0);
});
