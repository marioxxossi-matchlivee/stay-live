import test from "node:test";
import assert from "node:assert/strict";
import { adviceIt, commentIt, countryIt, eventIt, injuryTypeIt, posIt, posLongIt, reasonIt, roundIt } from "../functions/api/_it.js";

test("consiglio di API-Football in codici 1X2 e Over/Under in italiano", () => {
  assert.deepEqual(adviceIt("Double chance : Inter or draw", "Inter", "AC Milan"), { code: "1X", goals: null, label: "1X", long: "Doppia chance 1X (casa o pareggio)" });
  assert.equal(adviceIt("Double chance : draw or AC Milan", "Inter", "AC Milan").label, "X2");
  assert.equal(adviceIt("Double chance : Inter or AC Milan", "Inter", "AC Milan").label, "12");
  assert.equal(adviceIt("Winner : Inter", "Inter", "AC Milan").label, "1");
  assert.equal(adviceIt("Winner : AC Milan", "Inter", "AC Milan").label, "2");
  assert.equal(adviceIt("Combo Double chance : draw or Milan and -2.5 goals", "Inter", "AC Milan").label, "X2 + Under 2,5");
  assert.equal(adviceIt("Combo Winner : Inter and +1.5 goals", "Inter", "AC Milan").label, "1 + Over 1,5");
  assert.equal(adviceIt("Combo Double chance : Inter or draw and +3.5 goals", "FC Internazionale", "Milan").label, "1X + Over 3,5", "nomi con sigle diverse");
  assert.equal(adviceIt("No predictions available"), null);
  assert.equal(adviceIt(""), null);
  assert.equal(adviceIt("Qualcosa di strano", "A", "B").label, "Qualcosa di strano");
  assert.equal(adviceIt("Double chance : Sconosciuta or draw", "Inter", "Milan").label, "Sconosciuta o X".replace("Sconosciuta o X", "Sconosciuta o X"));
});

test("assenze, ruoli, eventi, turni e nazionalità in italiano", () => {
  assert.equal(commentIt("Win or draw"), "vince o pareggia");
  assert.equal(reasonIt("Knee Injury"), "Infortunio: ginocchio");
  assert.equal(reasonIt("Hamstring Injury"), "Infortunio: bicipite femorale");
  assert.equal(reasonIt("Suspended"), "Squalificato");
  assert.equal(reasonIt("Yellow Cards"), "Squalifica per ammonizioni");
  assert.equal(reasonIt("Qualcosa di raro"), "Qualcosa di raro");
  assert.equal(injuryTypeIt("Missing Fixture"), "Assente");
  assert.equal(injuryTypeIt("Questionable"), "Dubbio");
  assert.equal(posIt("G"), "P"); assert.equal(posIt("M"), "C"); assert.equal(posIt("F"), "A");
  assert.equal(posLongIt("Attacker"), "Attaccante"); assert.equal(posLongIt("Goalkeeper"), "Portiere");
  assert.equal(eventIt("Card", "Second Yellow card"), "Doppia ammonizione (espulsione)");
  assert.equal(eventIt("Card", "Yellow Card"), "Ammonizione");
  assert.equal(eventIt("Var", "Goal cancelled"), "VAR: gol annullato");
  assert.equal(roundIt("Regular Season - 12"), "Giornata 12");
  assert.equal(roundIt("Quarter-finals"), "Quarti di finale");
  assert.equal(roundIt("League Stage - 5"), "Fase campionato · giornata 5");
  assert.equal(countryIt("Italy"), "Italia"); assert.equal(countryIt("Atlantis"), "Atlantis");
});
