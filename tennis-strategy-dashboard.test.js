import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildDashboard, validationStatus, STATUS, STRATEGY_TABS, sanitizeTab, COIN_FLIP } from "../src/tennis/strategy.js";
import { strategyHtml, groupCardHtml, calibrationChartSvg, tabsHtml } from "../src/tennis/strategyview.js";

const NOW = Date.parse("2026-11-21T12:00:00Z"), H = 36e5, ISO = (t) => new Date(t).toISOString();
const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
let seed = 7; const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);

/** Registro sintetico (solo per questi test): n osservazioni su blocchi torneo-settimana distinti, esiti calibrati o casuali. */
function registry(n, { concluded = 1, edge = 0.8, tours = ["atp", "wta"], surfaces = ["hard", "clay", "grass"], diagnostics = { enabled: true, newObservations: 1, newVersions: 1 } } = {}) {
  const observations = [], versions = [];
  for (let i = 0; i < n; i++) {
    const past = rnd() < concluded, start = past ? NOW - (2 + i) * 24 * H : NOW + (1 + (i % 30)) * H, p = 0.3 + rnd() * 0.6, y = rnd() < 0.5 + (p - 0.5) * edge, key = `k${i}`;
    observations.push({ match_key: key, tour: tours[i % tours.length], tournament_id: `T${i}`, tournament: `Torneo ${i % 9}`, surface: surfaces[i % surfaces.length], p1_id: `${i}a`, p2_id: `${i}b`, p1_name: `Uno ${i}`, p2_name: `Due ${i}`, first_starts_at: ISO(start), first_recorded_at: ISO(start - 12 * H), match_status: past ? "finished" : "scheduled", match_starts_at: ISO(start), winner: past ? (y ? 1 : 2) : null, identity_ok: true, state: past ? "concluded" : "upcoming" });
    versions.push({ match_key: key, rev: 1, recorded_at: ISO(start - 12 * H), starts_at: ISO(start), reason: "initial", model_ver: "tennis-v2", published: true, pick: 1, p1: p, p2: 1 - p, missing: i % 2 ? ["scontri diretti"] : [], inputs: {}, elo1: 1500, elo2: 1500 });
  }
  return { available: true, observations, versions, nextCursor: null, complete: true, total: n, diagnostics };
}

test("stati di validazione: la mancanza di evidenza non è mai evidenza; «Validato» solo con confronto col mercato", () => {
  assert.deepEqual(Object.keys(STATUS), ["validated", "not_validated", "observing", "insufficient", "unavailable"]);
  assert.equal(validationStatus(null, 0), "unavailable");
  assert.equal(validationStatus({ valid: 0 }, 12), "observing");
  assert.equal(validationStatus({ valid: 120, sufficient: false, logLoss: { hi: 0.5 } }, 200), "insufficient", "campione troppo piccolo anche con numeri belli");
  const big = { valid: 500, sufficient: true };
  assert.equal(validationStatus({ ...big, logLoss: { hi: COIN_FLIP.logLoss + 0.01 } }, 500), "not_validated");
  assert.equal(validationStatus({ ...big, logLoss: { hi: 0.60 } }, 500), "observing", "meglio del caso ma senza mercato: non validato");
  assert.equal(validationStatus({ ...big, logLoss: { hi: 0.60 } }, 500, { ciLow: 0.01, holm: 0.2 }), "observing");
  assert.equal(validationStatus({ ...big, logLoss: { hi: 0.60 } }, 500, { ciLow: -0.01, holm: 0.01 }), "observing");
  assert.equal(validationStatus({ ...big, logLoss: { hi: 0.60 } }, 500, { ciLow: 0.01, holm: 0.01 }), "validated");
  const d = buildDashboard(registry(420, { edge: 1.0 }), NOW);   // anche con un campione grande e ben tarato…
  assert.notEqual(d.overview.status, "validated"); assert.ok([d.all.status, ...d.tours.map((t) => t.status), ...d.surfaces.map((s) => s.status)].every((s) => s !== "validated"));
});

test("cruscotto: panoramica, circuiti separati, superfici, indoor non distinto, taratura e integrità dai dati reali del registro", () => {
  const d = buildDashboard(registry(420), NOW), o = d.overview;
  assert.equal(o.total, 420); assert.equal(o.valid + d.integrity.excluded.notConcluded + d.integrity.excluded.abstained + d.integrity.excluded.retiredOrWalkover + d.integrity.excluded.cancelledOrPostponed + d.integrity.excluded.identityMismatch + d.integrity.excluded.noInitial, 420);
  assert.equal(d.tours.length, 2); assert.equal(d.tours[0].key, "atp"); assert.equal(d.tours[0].total + d.tours[1].total, 420); assert.ok(d.tours.every((t) => t.metrics.brier && t.metrics.logLoss && t.metrics.accuracy && t.metrics.calibration));
  assert.deepEqual(d.surfaces.map((s) => s.key), ["hard", "clay", "grass"]); assert.equal(d.surfaces.reduce((a, s) => a + s.total, 0), 420);
  assert.ok(d.calibration.bins.length > 0 && d.calibration.bins.every((b) => b.n > 0 && b.observed >= 0 && b.observed <= 1));
  assert.ok(d.integrity.missing.some(([k]) => k === "scontri diretti")); assert.equal(d.integrity.identity, 0);
  const small = buildDashboard(registry(40, { concluded: 0 }), NOW); assert.equal(small.overview.valid, 0); assert.equal(small.overview.status, "observing"); assert.equal(small.overview.waiting, 40);
  const noSurf = buildDashboard(registry(30, { surfaces: ["hard"] }), NOW); assert.equal(noSurf.surfaces[1].status, "unavailable"); assert.equal(noSurf.surfaces[2].status, "unavailable");
  assert.equal(buildDashboard({ available: false, reason: "x" }, NOW).available, false);
});

test("anomalie: esiti mancanti oltre 24 ore, incongruenza degli id, blocco anti look-ahead e errori di sincronizzazione sono mostrati", () => {
  const r = registry(30), late = r.observations[0];
  late.state = "awaiting_result"; late.match_status = "scheduled"; late.winner = null; late.match_starts_at = ISO(NOW - 30 * H);
  r.observations[1].identity_ok = false; r.versions[2].recorded_at = r.versions[2].starts_at;   // registrata «a partita iniziata»
  r.diagnostics = { enabled: true, error: "history_future_date: registrazione bloccata", blocked: { reason: "history_future_date", count: 2, latestAt: "2026-11-21T22:00:00Z" }, lastOk: ISO(NOW - H) };
  const d = buildDashboard(r, NOW), i = d.integrity;
  assert.equal(i.awaitingLate, 1); assert.equal(i.identity, 1); assert.equal(i.backdated, 1); assert.equal(i.sync.blocked.count, 2);
  const html = strategyHtml(d, { tab: "integrity" }); assert.match(html, /Registrazione bloccata/); assert.match(html, /history_future_date/); assert.match(html, /senza esito verificato da oltre 24 ore/); assert.match(html, /incongruenze negli id/);
  assert.match(strategyHtml(buildDashboard({ ...r, diagnostics: { enabled: false } }, NOW), { tab: "integrity" }), /Raccolta prospettica spenta/);
});

test("interfaccia: cinque aree, stati dichiarati, campione insufficiente segnalato, grafico dai dati, niente HTML dai dati", () => {
  assert.deepEqual(STRATEGY_TABS.map(([k]) => k), ["overview", "tours", "surfaces", "calibration", "integrity"]); assert.equal(sanitizeTab("boh"), "overview");
  const d = buildDashboard(registry(180), NOW);   // 180 < 300: insufficiente
  const t = tabsHtml("tours"); for (const l of ["Panoramica", "ATP · WTA", "Superfici", "Calibrazione", "Integrità"]) assert.ok(t.includes(l)); assert.match(t, /data-stab="tours"/);
  const ov = strategyHtml(d, { tab: "overview" }); assert.match(ov, /Campione insufficiente/); assert.match(ov, /Osservazioni valide/); assert.match(ov, /Ultimo aggiornamento/); assert.match(ov, /Dati completi/);
  assert.ok(!/class="sd-chip s-validated"/.test(ov.replace(/<section class="sd-card sd-legend">[\s\S]*?<\/section>/, "")), "nessun risultato mostrato come validato (la sola legenda elenca lo stato)");
  const tours = strategyHtml(d, { tab: "tours" }); assert.match(tours, />ATP</); assert.match(tours, />WTA</); for (const k of ["Brier", "Log loss", "ECE", "Accuratezza", "IC 95%", "blocchi"]) assert.ok(tours.includes(k), k); assert.match(tours, /Mancano \d+ osservazioni valide in più/);
  const surf = strategyHtml(d, { tab: "surfaces" }); for (const k of ["Cemento", "Terra", "Erba", "Indoor"]) assert.ok(surf.includes(k), k); assert.match(surf, /Non disponibile/);
  const cal = strategyHtml(d, { tab: "calibration" }); assert.match(cal, /<svg class="sd-svg dim"/); assert.match(cal, /Frequenza osservata/); assert.match(cal, /Scostamento per fascia/); assert.match(cal, /Campione insufficiente: mancano/);
  assert.match(calibrationChartSvg([{ lo: 0.6, hi: 0.7, n: 12, claimed: 0.65, observed: 0.58 }], false), /n=12/);
  assert.match(groupCardHtml({ label: "<img>", total: 0, concluded: 0, metrics: { valid: 0 }, status: "unavailable" }), /&lt;img&gt;/);
  assert.match(strategyHtml(buildDashboard(registry(30, { concluded: 0 }), NOW), { tab: "tours" }), /Nessuna partita conclusa con valutazione pubblicata: nessuna metrica/);
  assert.match(strategyHtml({ available: false, reason: "Registro non attivo." }, { tab: "overview" }), /Registro non attivo/); assert.match(strategyHtml(null, { tab: "overview" }, { loading: true }), /Carico i dati/); assert.match(strategyHtml(null, { tab: "overview" }, { error: "rete" }), /Impossibile leggere i dati/);
  assert.match(strategyHtml({ ...d, complete: false, total: 900 }, { tab: "overview" }), /Caricate 180 di 900[\s\S]*data-lo-all/);
});

test("nessuna presentazione operativa: niente video, puntate, capitale, classi, doppie, pronostici consigliati, valore atteso", () => {
  const d = buildDashboard(registry(420), NOW), all = ["overview", "tours", "surfaces", "calibration", "integrity"].map((tab) => strategyHtml(d, { tab })).join("\n");
  for (const re of [/video/i, /puntat/i, /capitale/i, /bankroll/i, /\bdoppi[ae]\b/i, /consigliat/i, /\bValue\b/, /\bEV\b/, /\bROI\b/, /Classe [ABCD]\b/, /Singol[ae]/, /Esempio/i, /simulazion/i]) assert.ok(!re.test(all), `non deve comparire ${re}`);
  for (const f of ["src/tennis/strategy.js", "src/tennis/strategyview.js", "src/tennis/strategy.css", "src/tennis/app.js"]) assert.ok(!/video/i.test(read(f)), `${f}: nessun riferimento al video`);
  for (const f of ["src/tennis/strategy.js", "src/tennis/strategyview.js"]) assert.ok(!/_tennis-bankroll|_tennis-strategy\.js|_tennis-strategy-track|simulateSequence|planBankroll/.test(read(f)), `${f} non dipende dal vecchio motore di puntata`);
});

test("tema chiaro e design system: solo token --sl-*, nessun colore esadecimale, nessuno scuro", () => {
  const css = read("src/tennis/strategy.css"); assert.ok(!/#[0-9a-f]{3,8}\b/i.test(css), "nessun colore esadecimale: solo token"); assert.ok(!/prefers-color-scheme|color-scheme:\s*dark/.test(css)); assert.ok(/var\(--sl-/.test(css));
  const idx = read("index.html"); assert.match(idx, /name="color-scheme" content="light"/); assert.ok(!/prefers-color-scheme:\s*dark/.test(idx + read("src/design/shell.css") + css));
  assert.ok(!/background:[^;}]*(#0[0-9a-f]{2,5}\b|rgb\(\s*[0-3]?\d?\s*,)/i.test(css), "nessuno sfondo scuro");
});

test("responsive globale: viewport senza zoom, guardie iOS, input a 16px, barra a 5 voci proporzionata, nessuna larghezza fissa", () => {
  const idx = read("index.html"), vp = /<meta name="viewport" content="([^"]+)"/.exec(idx)[1];
  for (const k of ["width=device-width", "initial-scale=1", "maximum-scale=1", "user-scalable=no", "viewport-fit=cover"]) assert.ok(vp.includes(k), k);
  for (const k of ["gesturestart", "gesturechange", "touchmove", "touches.length>1", "preventDefault"]) assert.ok(idx.includes(k), k);
  assert.ok(!/touchstart/.test(idx.match(/<script>\/\* Nessuno zoom[\s\S]*?<\/script>/)[0]), "lo scorrimento a un dito non è intercettato");
  const shell = read("src/design/shell.css"); assert.match(shell, /touch-action:pan-x pan-y/); assert.match(shell, /html select,html textarea\{font-size:16px!important\}/); assert.match(shell, /overflow-wrap:break-word/); assert.ok(!/overflow-wrap:anywhere/.test(shell.replace(/\/\*[\s\S]*?\*\//g, "")), "anywhere schiaccia le colonne delle tabelle");
  const app = read("src/tennis/app.js"); assert.match(app, /const TABS = \["matches", "strategy", "plays", "reliability", "settings"\]/); assert.equal((app.match(/<button type="button" data-tab=/g) ?? []).length, 5);
  const css = read("src/tennis/strategy.css"); assert.ok(!/[^-a-z]width:\s*\d{3,}px/.test(css), "nessuna larghezza fissa oltre 99px"); assert.match(css, /@media \(max-width:360px\)/); assert.match(css, /@media \(min-width:768px\)/);
});
