import test from "node:test";
import assert from "node:assert/strict";
import { modelInputs } from "../functions/api/_tennis-observation.js";

test("modelInputs: le quote di entrambi i lati si salvano nella prima valutazione; senza quote odds è nullo", () => {
  const base = { row: { surface: "hard" }, book: null, stats: null, ranks: null };
  const m = { p1_id: 1, p2_id: 2, tour: "atp", starts_at: "2026-11-27T10:00:00Z", odds_fetched_at: "2026-11-27T08:00:00Z", odds_sources: [{ book: "pinnacle", p1: 1.5, p2: 2.6 }, { book: "x", p1: 1.55, p2: 2.5 }] };
  const a = modelInputs({ ...base, match: m });
  assert.equal(a.oddsAvailable, true); assert.equal(a.odds.sources.length, 2); assert.equal(a.odds.sources[0].p2, 2.6); assert.equal(a.odds.fetchedAt, "2026-11-27T08:00:00Z");
  const b = modelInputs({ ...base, match: { ...m, odds_sources: [] } });
  assert.equal(b.oddsAvailable, false); assert.equal(b.odds, null);
});
