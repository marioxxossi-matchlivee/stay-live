import test from "node:test";
import assert from "node:assert/strict";
import { partsHtml, shortPick } from "../src/pickview.js";

test("etichetta breve: niente descrizione estesa", () => {
  assert.equal(shortPick({ key: "dcx2", label: "X2 · Pareggio o trasferta" }), "X2");
  assert.equal(shortPick({ key: "over25", label: "Over 2,5" }), "Over 2,5");
  assert.equal(shortPick({ key: "btts", label: "Gol (entrambe segnano)" }), "Gol");
  assert.equal(shortPick({ key: "boh", label: "Qualcosa · descrizione" }), "Qualcosa");
});
test("percentuali delle opzioni: solo se presenti e numeriche, mai inventate", () => {
  assert.equal(partsHtml({ key: "dcx2", p: 0.63 }), "");
  assert.equal(partsHtml({ parts: [] }), "");
  assert.equal(partsHtml({ parts: [{ key: "draw", p: null }] }), "");
  const h = partsHtml({ parts: [{ key: "draw", p: 0.28 }, { key: "away", p: 0.35 }, { key: "x", p: "boh" }] });
  assert.match(h, /X<\/b> 28%/); assert.match(h, /2<\/b> 35%/); assert.equal((h.match(/pk-part"/g) ?? []).length, 2);
});
