import test from "node:test";
import assert from "node:assert/strict";
import { cornerHtml, cornerShort, cornerVerdicts } from "../src/corners.js";
import { absorbCorners, pendingCornerIds } from "../src/plays.js";

const fav = (side, h = 0.52, d = 0.18, a = 0.30) => ({ side, p: { home: h, draw: d, away: a }, odds: { home: 1.8, draw: 5.5, away: 2.4 }, best: { home: 1.9, draw: 5.8, away: 2.5 }, books: 7, margin: 0.07, verified: false });
const item = { home: "Inter", away: "Roma", status: "scheduled", corner: { best: { side: "over", line: 9.5, p: 0.58, odd: 1.8 }, main: 9.5, mainDetail: { line: 9.5, pOver: 0.58, pUnder: 0.42, over: 1.8, under: 2.0, books: 6 }, favorite: fav("home") } };

test("esiti corner: favorita e Over/Under confrontati con i corner reali", () => {
  const v = cornerVerdicts(item.corner, { home: 8, away: 3, total: 11 });
  assert.deepEqual(v.map((x) => [x.kind, x.ok]), [["favorite", true], ["best", true]]);
  const lost = cornerVerdicts(item.corner, { home: 2, away: 5, total: 7 });
  assert.deepEqual(lost.map((x) => [x.kind, x.ok]), [["favorite", false], ["best", false]]);
  const tie = cornerVerdicts(item.corner, { home: 5, away: 5, total: 10 });
  assert.equal(tie[0].ok, false); assert.equal(tie[0].tie, true);
  assert.equal(cornerVerdicts({ favorite: fav("even", 0.4, 0.2, 0.4) }, { home: 4, away: 6, total: 10 }).length, 0, "nessuna favorita: niente verdetto");
  assert.equal(cornerVerdicts({ best: { side: "over", line: 10, p: 0.5, odd: 1.9 } }, { home: 5, away: 5, total: 10 })[0].ok, null, "sulla linea intera: rimborso");
  assert.deepEqual(cornerVerdicts(item.corner, null), []);
  // linea principale diversa dal lato migliore: voce informativa senza giudizio
  const other = { ...item.corner, best: { side: "under", line: 12.5, p: 0.8, odd: 1.35 } };
  assert.deepEqual(cornerVerdicts(other, { home: 6, away: 4, total: 10 }).map((x) => x.kind), ["favorite", "best", "main"]);
});

test("scheda corner: preview con dettagli, a fine partita corner reali e verdetti; stessa funzione per le giocate salvate", () => {
  const pre = cornerHtml(item);
  assert.match(pre, /Più corner: <b>Inter<\/b> 52%/);
  assert.match(pre, /pari 18%/); assert.match(pre, /margine 7,0%/); assert.match(pre, /Linea 9,5|linea 9,5/);
  assert.match(pre, /non il nostro modello/); assert.doesNotMatch(pre, /Corner reali/);
  const done = cornerHtml({ ...item, status: "final", cornerActual: { home: 8, away: 3, total: 11 } });
  assert.match(done, /Corner reali: <b>Inter 8 – 3 Roma<\/b> · totale 11/);
  assert.match(done, /✓ Favorita rispettata: più corner Inter \(8 contro 3\)/);
  assert.match(done, /✓ Over 9,5: 11 corner in totale, previsione centrata/);
  const miss = cornerHtml({ ...item, status: "final", cornerActual: { home: 2, away: 6, total: 8 } });
  assert.match(miss, /✗ Favorita non rispettata: più corner Roma/); assert.match(miss, /class="pc-v no"/);
  assert.match(cornerHtml({ ...item, status: "final" }), /non ancora disponibili/);
  assert.match(cornerHtml({ home: "A", away: "B", status: "final", cornerActual: { home: 1, away: 2, total: 3 } }), /Nessuna previsione corner salvata/);
  assert.equal(cornerHtml({ home: "A", away: "B" }), "");
  assert.match(cornerHtml({ ...item, corner: { ...item.corner, favorite: fav("even", 0.4, 0.2, 0.4) } }), /Nessuna favorita/);
  assert.equal(cornerHtml({ ...item, home: "<b>X</b>" }).includes("<b>X</b>"), false, "i nomi sono escapati");
  assert.match(cornerHtml({ ...item, status: "final", cornerActual: { home: 8, away: 3, total: 11 } }, { compact: true }), /reali <b>8–3<\/b> ✓✓/);
});

test("testo/PDF: sintesi corner", () => {
  assert.equal(cornerShort(item), "più corner Inter 52% · Over 9,5 corner 58%");
  assert.equal(cornerShort({ ...item, cornerActual: { home: 8, away: 3, total: 11 } }), "più corner Inter 52% · Over 9,5 corner 58% · corner reali 8–3");
  assert.equal(cornerShort({ home: "A", away: "B" }), "");
});

test("giocate: i corner reali si copiano solo nelle gambe già finite e restano", () => {
  const plays = [{ legs: [{ matchId: "a", res: [1, 0] }, { matchId: "b" }, { matchId: "c", res: [0, 0], cres: { home: 1, away: 1, total: 2 } }] }];
  assert.deepEqual(pendingCornerIds(plays), ["a"]);
  assert.equal(absorbCorners(plays, { a: { home: 7, away: 4 }, b: { home: 3, away: 3 }, c: { home: 9, away: 9 } }), true);
  assert.deepEqual(plays[0].legs[0].cres, { home: 7, away: 4, total: 11 });
  assert.equal(plays[0].legs[1].cres, undefined, "partita non finita: nessun corner copiato");
  assert.equal(plays[0].legs[2].cres.total, 2, "già presenti: non si sovrascrivono");
  assert.equal(absorbCorners(plays, { a: { home: 1, away: 1 } }), false);
  assert.deepEqual(pendingCornerIds(plays), []);
});
