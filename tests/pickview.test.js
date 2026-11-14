import test from "node:test";
import assert from "node:assert/strict";
import { shortPick } from "../src/pickview.js";

test("etichetta breve: niente descrizione estesa", () => {
  assert.equal(shortPick({ key: "dcx2", label: "X2 · Pareggio o trasferta" }), "X2");
  assert.equal(shortPick({ key: "over25", label: "Over 2,5" }), "Over 2,5");
  assert.equal(shortPick({ key: "btts", label: "Gol (entrambe segnano)" }), "GG");
  assert.equal(shortPick({ key: "nobtts", label: "No Gol" }), "NG");
  assert.equal(shortPick({ key: "boh", label: "Qualcosa · descrizione" }), "Qualcosa");
});
