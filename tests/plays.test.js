import test from "node:test";
import assert from "node:assert/strict";
import { absorbResults, addPlay, evaluate, legStatus, loadPlays, outcomeOf, pendingMatchIds, playFromItem, playStatus, profitOf, removePlay, savePlays } from "../src/plays.js";

const item = (id, key, label = key) => ({ id, league: "seriea", home: "A", away: "B", kickoffAt: "2026-11-05T19:45:00Z", pick: { key, label, p: 0.6, pLow: 0.55, minOdds: 1.8 } });

test("esito di ogni mercato dal risultato", () => {
  assert.equal(outcomeOf("over25", 2, 1), true);
  assert.equal(outcomeOf("over25", 1, 1), false);
  assert.equal(outcomeOf("under25", 1, 1), true);
  assert.equal(outcomeOf("over15", 1, 0), false);
  assert.equal(outcomeOf("btts", 1, 1), true);
  assert.equal(outcomeOf("nobtts", 2, 0), true);
  assert.equal(outcomeOf("dc1x", 1, 1), true);
  assert.equal(outcomeOf("dcx2", 2, 1), false);
  assert.equal(outcomeOf("dc12", 0, 0), false);
  assert.equal(outcomeOf("home", 1, 0), true);
  assert.equal(outcomeOf("draw", 0, 0), true);
  assert.equal(outcomeOf("away", 0, 0), false);
  assert.equal(outcomeOf("over25", null, 1), null);
  assert.equal(outcomeOf("boh", 1, 1), null);
});

test("stato gamba e giocata: partita non finita = in attesa; una persa = persa", () => {
  const leg = { key: "over25" };
  assert.equal(legStatus(leg, { status: "scheduled" }), "pending");
  assert.equal(legStatus(leg, { status: "in_progress", homeScore: 2, awayScore: 1 }), "pending");
  assert.equal(legStatus(leg, { status: "final", homeScore: 2, awayScore: 1 }), "won");
  assert.equal(legStatus(leg, { status: "final", homeScore: 0, awayScore: 1 }), "lost");
  assert.equal(legStatus(leg, { status: "canceled" }), "void");
  assert.equal(legStatus({ key: "over25", res: [3, 0] }, undefined), "won");   // risultato gia' copiato nella giocata
  assert.equal(playStatus(["won", "pending"]), "pending");
  assert.equal(playStatus(["won", "lost", "pending"]), "lost");
  assert.equal(playStatus(["won", "void"]), "won");
  assert.equal(playStatus(["void"]), "void");
});

test("guadagno netto solo con puntata e quota", () => {
  assert.equal(profitOf({ stake: 10, odds: 1.85 }, "won"), 8.5);
  assert.equal(profitOf({ stake: 10, odds: 1.85 }, "lost"), -10);
  assert.equal(profitOf({ stake: 10, odds: 1.85 }, "pending"), null);
  assert.equal(profitOf({ stake: null, odds: 1.85 }, "won"), null);
});

test("salvataggio: niente doppioni, rimozione, storage e riepilogo", () => {
  const mem = new Map();
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  let plays = [];
  let r = addPlay(plays, playFromItem(item("m1", "over25", "Over 2,5"), { odds: 1.9, stake: 10, source: "mercato" }));
  plays = r.plays; assert.equal(r.added, true);
  r = addPlay(plays, playFromItem(item("m1", "over25", "Over 2,5"))); assert.equal(r.added, false);
  plays = addPlay(plays, { kind: "multiple", label: "Multipla", odds: 3, stake: 5, legs: [playFromItem(item("m2", "btts")).legs[0], playFromItem(item("m3", "home")).legs[0]] }).plays;
  assert.equal(plays.length, 2);
  savePlays(plays, storage);
  assert.equal(loadPlays(storage).length, 2);
  assert.deepEqual(pendingMatchIds(plays).sort(), ["m1", "m2", "m3"]);

  const results = { m1: { status: "final", homeScore: 2, awayScore: 1 }, m2: { status: "final", homeScore: 1, awayScore: 1 }, m3: { status: "scheduled" } };
  const ev = evaluate(plays, results);
  const single = ev.rows.find((x) => x.play.kind === "single"), multi = ev.rows.find((x) => x.play.kind === "multiple");
  assert.equal(single.status, "won"); assert.equal(single.profit, 9);
  assert.equal(multi.status, "pending");
  assert.deepEqual(ev.total, { won: 1, lost: 0, pending: 1, void: 0, rate: 1, staked: 10, profit: 9 });

  assert.equal(absorbResults(plays, results), true);
  assert.deepEqual(pendingMatchIds(plays), ["m3"]);            // m1 e m2 ora hanno il risultato salvato
  assert.equal(evaluate(plays, {}).rows.find((x) => x.play.kind === "single").status, "won");
  plays = removePlay(plays, single.play.id);
  assert.equal(plays.length, 1);
  assert.deepEqual(loadPlays({ getItem: () => "non json" }), []);
});
