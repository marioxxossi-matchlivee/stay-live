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

test("anchorToMarket: probabilità dal consenso di mercato, favorito di mercato, quota del favorito > 1,30, nessun pronostico senza quote fresche", async () => {
  const { anchorToMarket } = await import("../functions/api/_tennis-bet.js");
  const now = Date.parse("2026-11-26T10:00:00Z"), fresh = new Date(now - 3600e3).toISOString();
  const pred = { published: true, pick: 2, p1: 0.45, p2: 0.55, reliability: "media", reasons: [], components: {}, modelVersion: "tennis-v2" };
  const m = (oddsSources, oddsFetchedAt = fresh) => ({ status: "scheduled", startsAt: "2026-11-26T14:00:00Z", oddsSources, oddsFetchedAt });
  const a = anchorToMarket(pred, m([{ book: "A", p1: 1.55, p2: 2.55 }]), { now });
  assert.equal(a.published, true); assert.equal(a.pick, 1, "il pronostico diventa il favorito di mercato");
  assert.ok(Math.abs(a.p1 + a.p2 - 1) < 1e-3 && a.p1 > 0.6); assert.match(a.modelVersion, /\+mkt1$/);
  assert.equal(anchorToMarket(pred, m([{ book: "A", p1: 1.2, p2: 4.5 }]), { now }).published, false, "favorito con quota fino a 1,30: nessun pronostico");
  assert.equal(anchorToMarket(pred, m([]), { now }).published, false, "senza quote nessun pronostico");
  assert.equal(anchorToMarket(pred, m([{ book: "A", p1: 1.55, p2: 2.55 }], new Date(now - 5 * 3600e3).toISOString()), { now }).published, false, "quote vecchie");
  assert.equal(anchorToMarket(pred, m([{ book: "A", p1: 1.92, p2: 1.95 }]), { now }).published, false, "partita equilibrata");
  assert.equal(anchorToMarket(pred, m([{ book: "A", p1: 1.72, p2: 2.2 }]), { now }).published, false, "favorito sotto il 60%: nessun pronostico");
  const hi = anchorToMarket(pred, m([{ book: "A", p1: 1.38, p2: 3.2 }]), { now }); // favorito di mercato ~69%: correzione prudente verso l'alto
  assert.equal(hi.published, true); assert.ok(hi.p1 > 0.70 && hi.p1 < 0.75, `p1=${hi.p1}`);
  assert.equal(anchorToMarket({ ...pred, published: false, pick: null }, m([{ book: "A", p1: 1.55, p2: 2.55 }]), { now }).published, false, "l'astensione del modello resta");
});
