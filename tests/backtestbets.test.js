import test from "node:test";
import assert from "node:assert/strict";
import { buildReport, splitPicks } from "../scripts/backtest-bets.js";
import { normalize, predict, withModel } from "../scripts/backtest.js";

let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const pois = (l) => { let k = 0, p = 1; const L = Math.exp(-l); do { k += 1; p *= rnd(); } while (p > L); return k - 1; };
const rows = [];
for (let d = 0; d < 60; d += 1) for (let g = 0; g < 8; g += 1) {
  const a = Math.floor(rnd() * 16), b = (a + 1 + Math.floor(rnd() * 15)) % 16;
  rows.push({ league: "seriea", kickoff_at: new Date(Date.parse("2026-08-15T18:00:00Z") + d * 3 * 86400e3 + g * 3600e3).toISOString(), home_id: `t${a}`, away_id: `t${b}`, home_name: `T${a}`, away_name: `T${b}`, home_score: pois(1.4), away_score: pois(1.1), neutral_site: false });
}
const data = normalize(rows), preds = predict(data, { trainFrac: 0.3, valFrac: 0.7 });

test("ogni consiglio del replay finisce in BET o EVITA con esito vinto/perso", () => {
  const { bets, skips } = splitPicks(preds);
  assert.ok(bets.length + skips.length > 100);
  assert.ok([...bets, ...skips].every((x) => ["won", "lost"].includes(x.status) && x.p >= 0 && x.p <= 1));
});
test("nel rodaggio non ci sono pronostici e nessuna partita vede il futuro", () => {
  assert.ok(preds.every((x) => x.kickoffAt >= data[Math.floor(data.length * 0.3)].kickoff_at));
});
test("su dati senza differenze reali tra squadre il modello non inventa vantaggi (formShrinkK alto), il vecchio 4 sì", () => {
  const old = withModel({ formShrinkK: 4 }, () => predict(data, { trainFrac: 0.3, valFrac: 0.7 }));
  const nBets = (pp) => splitPicks(pp).bets.length;
  assert.ok(nBets(old) > 0, "con formShrinkK 4 il rumore genera BET");
  assert.ok(nBets(preds) < nBets(old) * 0.5, "con il valore attuale i BET sul rumore calano di oltre la metà");
});
test("il report è Markdown completo e non va in errore con pochi dati", () => {
  const withBets = withModel({ formShrinkK: 4 }, () => predict(data, { trainFrac: 0.3, valFrac: 0.7 }));
  assert.match(buildReport(data, withBets), /## Taratura/);
  assert.match(buildReport(data.slice(0, 5), predict(data.slice(0, 5), { trainFrac: 0.3, valFrac: 0.7 })), /Nessun BET/);
});
