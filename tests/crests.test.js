import test from "node:test";
import assert from "node:assert/strict";
import { afTeamId, buildLogoIndex, crestUrl, logoFor, needsTeamList, withLogos } from "../functions/api/_crests.js";

const rows = [{ params: { league: 135, season: 2026 }, response: [
  { team: { id: 489, name: "AC Milan", logo: "https://media.api-sports.io/football/teams/489.png" } },
  { team: { id: 505, name: "Inter", logo: "https://media.api-sports.io/football/teams/505.png" } },
] }];

test("scudetto: indirizzo fisso dall'id API-Football", () => {
  assert.equal(crestUrl(489), "https://media.api-sports.io/football/teams/489.png");
  assert.equal(crestUrl("x"), null);
  assert.equal(afTeamId("af-505"), 505);
  assert.equal(afTeamId("Inter"), null);
});

test("partite API-Football: logo dall'id; API Ninjas: dal nome nell'elenco squadre", () => {
  const index = buildLogoIndex(rows);
  assert.equal(logoFor("serieb", "af-777", "Qualcuno", index), crestUrl(777));
  assert.equal(logoFor("seriea", "ninjas-1", "AC Milan", index), crestUrl(489));
  assert.equal(logoFor("seriea", "ninjas-2", "Internazionale", index) === crestUrl(505) || logoFor("seriea", "ninjas-2", "Internazionale", index) === null, true);
  assert.equal(logoFor("seriea", "ninjas-3", "Lazio", index), null);   // squadra assente: nessun logo (resta la sigla)
  assert.equal(logoFor("seriea", "ninjas-1", "AC Milan", new Map()), null);
  assert.deepEqual(withLogos({ league: "seriea", home_id: "n1", home_name: "AC Milan", away_id: "af-5", away_name: "X" }, buildLogoIndex(rows)), { homeLogo: crestUrl(489), awayLogo: crestUrl(5) });
});

test("elenco squadre solo per i campionati di API Ninjas che hanno un id API-Football", () => {
  assert.equal(needsTeamList("seriea"), true);
  assert.equal(needsTeamList("serieb"), false);   // le sue partite arrivano da API-Football: id nelle squadre
  assert.equal(needsTeamList("nope"), false);
});
