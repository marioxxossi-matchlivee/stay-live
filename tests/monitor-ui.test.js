import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { backtestHtml, groupCard, liveHtml, monitorHtml } from "../src/monitor-view.js";
import { buildMonitor } from "../functions/api/_monitor.js";

const row = (o) => ({ model_ver: "7983f41f", verdict: "BET", sel_key: "over25", bin: 8, n: 10, won: 8, sum_p: 7.71, sum_plow: 6.29, sum_brier: 1.5, sum_logloss: 5, n_odds: 0, sum_pnl: 0, first_kickoff: "2026-11-07T15:00:00Z", last_kickoff: "2026-11-10T20:00:00Z", ...o });
const data = buildMonitor({
  picks: [row({}), row({ verdict: "EVITA", n: 175, won: 109, sum_p: 102.9, sum_plow: 89.6, bin: 6 })],
  legs: [row({ verdict: "EVITA", n: 2575, won: 1282, sum_p: 1282, sum_plow: 1058, bin: 5 })],
  status: [{ model_ver: "7983f41f", verdict: "BET", stato: "concluse", n: 185 }, { model_ver: "648b7a68", verdict: "EVITA", stato: "in_attesa", n: 9 }],
  ver: "648b7a68",
});

test("la sezione mostra le percentuali, il campione e l'intervallo", () => {
  const html = liveHtml(data);
  assert.match(html, /80%/); assert.match(html, /8 centrati su 10/); assert.match(html, /62%/); assert.match(html, /109 centrati su 175/);
  assert.match(html, /Intervallo al 95%/); assert.match(html, /10 su 300 necessari/); assert.match(html, /Campione troppo piccolo/);
  assert.match(html, /Taratura: dichiarato contro reale/); assert.match(html, /Per versione del modello/); assert.match(html, /7983f41f/);
  assert.match(html, /EVITA non significa che perde/);
});

test("nessuna conclusione dimostrata presentata con campioni piccoli", () => {
  const html = liveHtml(data);
  assert.doesNotMatch(html, /dimostrato che|garantit|sicuramente/i);
  assert.match(groupCard("X", { n: 0 }), /Ancora nessun caso concluso/);
});

test("storico: stato vuoto spiegato e rapporto completo", () => {
  assert.match(backtestHtml(null), /non ancora calcolato/); assert.match(backtestHtml(null), /Backtest affidabilità/);
  const b = { generatedAt: "2026-11-15T03:00:00Z", method: "replay cronologico", matches: 22703, from: "2018-08-01", to: "2026-11-10", warmup: 0.3, analyzed: 15000,
    bet: { n: 400, won: 280, rate: 0.7, ci: { lo: 0.65, hi: 0.74 }, claimed: 0.71, floor: 0.6, base: 0.5, gap: -0.01 }, evita: { n: 14000, won: 8000, rate: 0.57, ci: { lo: 0.56, hi: 0.58 }, claimed: 0.58, floor: 0.48, base: 0.5, gap: -0.01 },
    evitaByReason: { soglia: { n: 9000, rate: 0.55, ci: { lo: 0.54, hi: 0.56 }, claimed: 0.56, base: 0.5 }, edge: { n: 4000, rate: 0.6, ci: { lo: 0.58, hi: 0.62 }, claimed: 0.6, base: 0.55 }, campione: { n: 1000, rate: 0.5, ci: { lo: 0.47, hi: 0.53 }, claimed: 0.5, base: 0.5 } },
    calibration: { n: 200000, ece: 0.012, brier: 0.2, table: [{ lo: 0.5, hi: 0.6, n: 1000, predicted: 0.55, observed: 0.54 }] }, byConfidence: [{ label: "campione buono", n: 100, rate: 0.6, claimed: 0.6 }], limits: "Nel passato non ci sono le quote: proxy." };
  const html = backtestHtml(b);
  assert.match(html, /22\.703/); assert.match(html, /EVITA per motivo/); assert.match(html, /Taratura sull'archivio/); assert.match(html, /proxy/);
  assert.match(monitorHtml({ ...data, backtest: b }, "hist"), /Storico · 22\.703/);
});

test("nessuna iniezione HTML dai dati", () => {
  const evil = buildMonitor({ picks: [row({ model_ver: "<img src=x onerror=alert(1)>" })], legs: [row({ model_ver: "<img src=x onerror=alert(1)>", sel_key: "over25" })] });
  assert.doesNotMatch(liveHtml(evil), /<img src=x/);
});

test("collegamento: scheda nella barra, vista dedicata, main.js intatto", () => {
  const html = fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(html, /data-view="reliability"/); assert.match(html, /id="view-reliability"/); assert.match(html, /id="rel-root"/);
  assert.match(fs.readFileSync(new URL("../src/sport.js", import.meta.url), "utf8"), /monitor-tab\.js/);
  assert.match(fs.readFileSync(new URL("../src/monitor-tab.js", import.meta.url), "utf8"), /import\("\.\/monitor\.js"\)/);
  assert.doesNotMatch(fs.readFileSync(new URL("../src/main.js", import.meta.url), "utf8"), /monitor|tennis/i);
  assert.equal(fs.existsSync(new URL("../functions/api/_odds.js", import.meta.url)), false);
  assert.equal(fs.existsSync(new URL("../functions/api/quotes.js", import.meta.url)), false);
});
