import test from "node:test";
import assert from "node:assert/strict";
import { addTPlay, evaluateT, playFromMatch, absorbTResults, tSignature, loadTPlays, saveTPlays } from "../src/tennis/plays.js";
import { shouldClose } from "../src/sheet.js";
import { reliabilityHtml } from "../src/efficiency.js";
import { sportMenuHtml } from "../src/sportmenu.js";
import { playsViewHtml } from "../src/tennis/playsview.js";

const m = (o = {}) => ({ key: "k1", tour: "atp", tournament: "T", category: "tour", surface: "Hard", startsAt: "2026-11-14T10:00:00Z", status: "scheduled",
  p1: { name: "Mario Rossi" }, p2: { name: "Luca Bianchi" }, odds: { p1: 1.8, p2: 2.1 }, bet: { verdict: "BET", odds: 1.8 },
  prediction: { published: true, pick: 1, p1: 0.62, p2: 0.38 }, ...o });

test("tennis: salvataggio, doppioni, esito e rendimento", () => {
  const play = playFromMatch(m());
  assert.equal(play.pick, 1); assert.equal(play.odds, 1.8); assert.equal(play.verdict, "BET");
  assert.equal(playFromMatch(m({ prediction: { published: false } })), null);
  let r = addTPlay([], play); assert.equal(r.added, true);
  assert.equal(addTPlay(r.plays, play).added, false);
  assert.equal(evaluateT(r.plays, [m()]).total.pending, 1);
  const fin = m({ status: "finished", winner: 1, score: "6-4 6-4" });
  assert.equal(absorbTResults(r.plays, [fin]), true);
  const ev = evaluateT(r.plays, []);                       // l'esito resta anche senza la partita nel tabellone
  assert.equal(ev.rows[0].status, "won"); assert.equal(ev.total.profit, 0.8);
  assert.equal(evaluateT(r.plays.map((p) => ({ ...p, res: { winner: 2 } })), []).total.profit, -1);
  assert.equal(evaluateT(r.plays.map((p) => ({ ...p, res: { void: true } })), []).rows[0].status, "void");
  const store = new Map(); const st = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  saveTPlays(r.plays, st); assert.equal(loadTPlays(st).length, 1); assert.equal(tSignature(loadTPlays(st)[0]), "k1|1");
});
test("tennis: vista giocate come quella del calcio", () => {
  const { plays } = addTPlay([], playFromMatch(m()));
  const html = playsViewHtml(evaluateT(plays, [m()]), { filter: "all", open: new Set(), history: null });
  assert.match(html, /Le mie giocate/); assert.match(html, /IN ATTESA/); assert.match(html, /data-del-play/); assert.match(html, /Statistiche e affidabilità/);
  assert.match(playsViewHtml(evaluateT([], []), {}), /Nessuna giocata salvata/);
});
test("cassetto: chiusura per distanza o per velocità", () => {
  assert.equal(shouldClose(150, 0), true); assert.equal(shouldClose(40, 0.1), false); assert.equal(shouldClose(40, 1), true); assert.equal(shouldClose(5, 3), false);
});
test("BET di versioni precedenti: mostrati con etichetta chiara invece di essere nascosti", () => {
  const fmt = { esc: (x) => String(x), pct: (x) => `${Math.round(x * 100)}%` };
  const data = { total: { n: 12, won: 7, rate: 7 / 12, expected: 0.7, floor: 0.6, ci: { lo: 0.3, hi: 0.8 } }, byMarket: [], byKey: [], calibration: [], olderVersions: 12, pending: 0 };
  const h = reliabilityHtml(data, fmt, { legacy: true });
  assert.match(h, /versioni precedenti/); assert.match(h, /non misurano il modello di oggi/); assert.match(h, /7 BET centrati su 12/);
  assert.doesNotMatch(reliabilityHtml(data, fmt), /non misurano il modello di oggi/);
});
test("menu sport: tendina con calcio e tennis, sport attuale selezionato", () => {
  const h = sportMenuHtml("tennis");
  assert.match(h, /data-sport-toggle/); assert.match(h, /data-sport-pick="football"/); assert.match(h, /data-sport-pick="tennis"/); assert.match(h, /aria-checked="true"/);
});
