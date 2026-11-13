import test from "node:test";
import assert from "node:assert/strict";
import { noVig, pickOdds, evaluateBet, TENNIS_BET } from "../functions/api/_tennis-bet.js";

const NOW = Date.parse("2026-11-13T10:00:00Z");
const pred = (o = {}) => ({ published: true, pick: 1, p1: 0.7, p2: 0.3, reliability: "alta", ...o });
const m = (o = {}) => ({ status: "scheduled", startsAt: "2026-11-13T15:00:00Z", oddsFetchedAt: "2026-11-13T09:40:00Z", oddsSources: [{ book: "Pinnacle", p1: 1.6, p2: 2.5 }], ...o });

test("probabilità implicita senza margine: somma 1 e margine corretto", () => {
  const n = noVig(1.5, 3); assert.ok(Math.abs(n.p1 + n.p2 - 1) < 1e-12); assert.ok(Math.abs(n.margin - (1 / 1.5 + 1 / 3 - 1)) < 1e-12);
  assert.equal(noVig(1, 2), null); assert.equal(noVig(null, 2), null);
});
test("quota migliore tra le fonti e riferimento Pinnacle", () => {
  const o = pickOdds([{ book: "Marathonbet", p1: 1.7, p2: 2.2 }, { book: "Pinnacle", p1: 1.6, p2: 2.5 }], 1);
  assert.equal(o.odds, 1.7); assert.equal(o.book, "Marathonbet"); assert.equal(o.reference.book, "Pinnacle"); assert.equal(o.count, 2);
  assert.equal(pickOdds([], 1), null); assert.equal(pickOdds([{ book: "x", p1: 1, p2: 2 }], 1), null);
});
test("BET quando EV, quota, affidabilità e allineamento col mercato sono ok", () => {
  const v = evaluateBet(m(), pred({ p1: 0.7 }), { now: NOW, category: "tour" });
  assert.equal(v.verdict, "BET"); assert.ok(Math.abs(v.ev - (0.7 * 1.6 - 1)) < 1e-4); assert.equal(v.odds, 1.6);
});
test("senza quote: EVITA, nessun EV, nessuna quota inventata", () => {
  const v = evaluateBet(m({ oddsSources: [] }), pred(), { now: NOW });
  assert.equal(v.verdict, "EVITA"); assert.equal(v.ev, null); assert.equal(v.odds, null); assert.match(v.reasons[0], /non disponibili/);
});
test("quote vecchie: EVITA senza EV", () => {
  const v = evaluateBet(m({ oddsFetchedAt: "2026-11-13T05:00:00Z" }), pred(), { now: NOW });
  assert.equal(v.verdict, "EVITA"); assert.equal(v.ev, null); assert.match(v.reasons[0], /non aggiornate/);
});
test("partita iniziata: la quota pre-partita non vale; astensione del modello: EVITA con il motivo", () => {
  assert.equal(evaluateBet(m({ status: "live" }), pred(), { now: NOW }).verdict, "EVITA");
  assert.equal(evaluateBet(m({ startsAt: "2026-11-13T09:00:00Z" }), pred(), { now: NOW }).ev, null);
  const a = evaluateBet(m(), { published: false, pick: null, abstainReason: "Partita equilibrata." }, { now: NOW });
  assert.equal(a.verdict, "EVITA"); assert.equal(a.reasons[0], "Partita equilibrata.");
});
test("soglie: EV basso, quota bassa, affidabilità bassa, scarto dal mercato, Challenger senza affidabilità alta", () => {
  assert.equal(evaluateBet(m(), pred({ p1: 0.62 }), { now: NOW }).verdict, "EVITA");                       // EV < 4%
  assert.match(evaluateBet(m({ oddsSources: [{ book: "Pinnacle", p1: 1.3, p2: 3.6 }] }), pred({ p1: 0.85 }), { now: NOW }).reasons.join(" "), /sotto il minimo/);
  assert.equal(evaluateBet(m(), pred({ reliability: "bassa" }), { now: NOW }).verdict, "EVITA");
  assert.match(evaluateBet(m(), pred({ p1: 0.9 }), { now: NOW }).reasons.join(" "), /discosta troppo/);
  assert.equal(evaluateBet(m(), pred({ reliability: "media" }), { now: NOW, category: "challenger" }).verdict, "EVITA");
  assert.equal(evaluateBet(m(), pred({ reliability: "media" }), { now: NOW, category: "tour" }).verdict, "BET");
});
test("il pronostico sul giocatore 2 usa la quota del giocatore 2", () => {
  const v = evaluateBet(m({ oddsSources: [{ book: "Pinnacle", p1: 1.4, p2: 3.2 }] }), pred({ pick: 2, p1: 0.4, p2: 0.6 }), { now: NOW });
  assert.equal(v.odds, 3.2); assert.ok(Math.abs(v.ev - (0.6 * 3.2 - 1)) < 1e-4);
});
test("configurazione dichiarata", () => { assert.ok(TENNIS_BET.minOdds >= 1.5 && TENNIS_BET.minEv > 0); });
