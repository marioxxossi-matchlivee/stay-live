import test from "node:test";
import assert from "node:assert/strict";
import { isLegacyId, planMigration } from "../scripts/migrate-ninjas-ids.js";

const old = (id, home, away, at, extra = {}) => ({ game_id: id, league: "seriea", home_name: home, away_name: away, kickoff_at: at, status: "final", ...extra });
const af = (n, home, away, at) => ({ game_id: `af-${n}`, home_name: home, away_name: away, kickoff_at: at });

test("id storici: riconosce quelli non API-Football", () => {
  assert.equal(isLegacyId("seriea-20261031-int-mil"), true);
  assert.equal(isLegacyId("af-1234"), false);
});

test("abbinamento uno-a-uno per orario e squadre; i non abbinati restano", () => {
  const o = [old("n1", "AC Milan", "Internazionale", "2026-10-31T19:45:00Z"), old("n2", "Juventus", "Napoli", "2026-11-01T19:45:00Z"), old("n3", "Lazio", "Roma", "2026-11-02T19:45:00Z"), old("n4", "Lecce", "Genoa", "2026-11-03T19:45:00Z")];
  const a = [af(1, "AC Milan", "Inter", "2026-10-31T20:00:00Z"), af(2, "Juventus", "Napoli", "2026-11-01T19:45:00Z"), af(3, "Lazio", "AS Roma", "2026-11-02T22:00:00Z"), af(4, "Lecce", "Genoa", "2026-11-09T19:45:00Z"), af(5, "Torino", "Parma", "2026-11-04T19:45:00Z")];
  const r = planMigration(o, a);
  const m = Object.fromEntries(r.pairs.map((p) => [p.from, p.to]));
  assert.equal(m.n2, "af-2"); assert.equal(m.n3, "af-3");
  assert.ok(!("n4" in m), "orario troppo distante: non si abbina a caso");
  assert.deepEqual(r.unmatchedOld.map((x) => x.game_id).filter((x) => x === "n4"), ["n4"]);
  assert.equal(new Set(r.pairs.map((p) => p.to)).size, r.pairs.length, "ogni partita API-Football usata una sola volta");
  assert.ok(r.unmatchedAf.some((x) => x.game_id === "af-5"));
});

test("due partite uguali alla stessa ora: ognuna al suo abbinamento, senza duplicati", () => {
  const o = [old("a", "Milan", "Inter", "2026-10-31T19:45:00Z"), old("b", "Milan", "Inter", "2026-10-31T20:30:00Z")];
  const a = [af(1, "Milan", "Inter", "2026-10-31T19:45:00Z"), af(2, "Milan", "Inter", "2026-10-31T20:30:00Z")];
  const r = planMigration(o, a);
  assert.deepEqual(Object.fromEntries(r.pairs.map((p) => [p.from, p.to])), { a: "af-1", b: "af-2" });
});
