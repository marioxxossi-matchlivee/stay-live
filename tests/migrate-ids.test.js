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

test("apprendimento dei nomi: 'FC Cologne' e 'Bayern Munich' si abbinano dalle partite sicure, anche tra campionati", () => {
  const learned = new Map();
  const o1 = [old("b1", "Bayern Munich", "RB Leipzig", "2026-10-17T16:30:00Z", { league: "bundesliga" }), old("b2", "FC Cologne", "Mainz", "2026-10-18T13:30:00Z", { league: "bundesliga" }), old("b3", "Eintracht Frankfurt", "FC Cologne", "2026-10-16T18:30:00Z", { league: "bundesliga" })];
  const a1 = [af(1, "FC Bayern München", "RB Leipzig", "2026-10-17T16:30:00Z"), af(2, "1. FC Köln", "FSV Mainz 05", "2026-10-18T13:30:00Z"), af(3, "Eintracht Frankfurt", "1. FC Köln", "2026-10-16T18:30:00Z")];
  const r = planMigration(o1, a1, learned);
  assert.deepEqual(Object.fromEntries(r.pairs.map((p) => [p.from, p.to])), { b1: "af-1", b2: "af-2", b3: "af-3" });
  assert.equal(learned.get("FC Cologne"), "1. FC Köln");
  // un altro campionato: Bayern impara dalla Champions grazie alla mappa condivisa, anche con orario diverso di 20 ore
  const o2 = [old("u1", "Bayern Munich", "Bodo/Glimt", "2026-09-10T19:00:00Z", { league: "ucl" })], a2 = [af(9, "FC Bayern München", "Bodo/Glimt", "2026-09-10T19:00:00Z")];
  assert.equal(planMigration(o2, a2, learned).pairs.length, 1);
  const o3 = [old("u2", "Bayern Munich", "Arsenal", "2026-10-21T19:00:00Z", { league: "ucl" })], a3 = [af(10, "FC Bayern München", "Arsenal FC", "2026-10-22T07:00:00Z")];
  assert.equal(planMigration(o3, a3, new Map([["Bayern Munich", "FC Bayern München"], ["Arsenal", "Arsenal FC"]])).pairs.length, 1, "entrambe note dalla mappa: tollera 12 ore di scarto");
});

test("nessun abbinamento ambiguo o sbagliato", () => {
  // stesso orario, due partite con una squadra in comune con la mappa: non si indovina
  const learned = new Map([["Bayern Munich", "FC Bayern München"]]);
  const o = [old("x", "Bayern Munich", "Pippo Calcio", "2026-10-21T19:00:00Z")];
  const a = [af(1, "FC Bayern München", "Squadra A", "2026-10-21T19:00:00Z"), af(2, "FC Bayern München", "Squadra B", "2026-10-21T19:30:00Z")];
  assert.equal(planMigration(o, a, learned).pairs.length, 0, "due candidati: ambiguo");
  // contraddizione con la mappa: l'avversaria è già associata a un'altra squadra
  const l2 = new Map([["Bayern Munich", "FC Bayern München"], ["Pippo Calcio", "Squadra Z"]]);
  assert.equal(planMigration(o, [af(1, "FC Bayern München", "Squadra A", "2026-10-21T19:00:00Z")], l2).pairs.length, 0);
  // orario lontano con una sola squadra nota: no
  assert.equal(planMigration(o, [af(1, "FC Bayern München", "Squadra A", "2026-10-22T19:00:00Z")], new Map([["Bayern Munich", "FC Bayern München"]])).pairs.length, 0);
});
