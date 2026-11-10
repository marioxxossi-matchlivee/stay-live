import test from "node:test";
import assert from "node:assert/strict";
import { summarizeFixtures } from "../scripts/discover-matches.js";

const fx = (id, name, country, date, season = 2026) => ({ league: { id, name, country, season }, fixture: { date } });

test("scoperta: raggruppa per competizione, segna le non configurate e mette le nuove per prime", () => {
  const rows = summarizeFixtures([
    [fx(135, "Serie A", "Italy", "2026-11-21T19:00:00Z"), fx(10, "Friendlies", "World", "2026-11-14T18:00:00Z"), fx(10, "Friendlies", "World", "2026-11-15T18:00:00Z")],
    [fx(5, "UEFA Nations League", "World", "2026-11-16T19:45:00Z"), fx(999, "Liga Nueva", "Peru", "2026-11-17T20:00:00Z")],
  ], new Set([135]));
  assert.deepEqual(rows.map((r) => r.id), [10, 999, 5, 135], "prima le nuove (più partite per prime, a pari partite per paese), in fondo le già configurate");
  assert.equal(rows[rows.length - 1].id, 135, "le già configurate in fondo");
  const friendlies = rows.find((r) => r.id === 10);
  assert.equal(friendlies.matches, 2); assert.equal(friendlies.configured, false); assert.equal(friendlies.first, "2026-11-14T18:00:00Z"); assert.equal(friendlies.last, "2026-11-15T18:00:00Z");
  assert.equal(friendlies.national, true); assert.equal(rows.find((r) => r.id === 5).national, true);
  assert.equal(rows.find((r) => r.id === 999).national, false);
  assert.equal(rows.find((r) => r.id === 135).configured, true);
  assert.equal(rows[0].id, 10, "la competizione nuova con più partite viene per prima");
});
