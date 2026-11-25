import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { learningHtml, overviewHtml, sportHtml, errorsHtml, labHtml, logHtml, TABS, VERDICT } from "../src/learning/view.js";
import { buildReport } from "../functions/api/_learning-report.js";
import { synth } from "./learning-helpers.js";

const NOW = Date.parse("2026-12-31T00:00:00Z"), read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const tennis = (n, seed, truth) => { const recs = synth(n, { seed, truth }); return { predictions: recs.map((r, i) => ({ match_key: `T${i % 25}|r|${i}a|${i}b`, starts_at: new Date(r.t).toISOString(), tour: "atp", surface: i % 2 ? "clay" : "hard", published: true, p1: r.p, p2: 1 - r.p, missing: i % 5 === 0 ? ["scontri diretti"] : [], odds_p1: 1.8, odds_p2: 2.1, odds_at: new Date(r.t - 864e5).toISOString(), model_ver: "tennis-v2" })), results: recs.map((r, i) => ({ match_key: `T${i % 25}|r|${i}a|${i}b`, winner: r.y ? 1 : 2 })) }; };
const football = (n, seed) => ({ rows: synth(n, { seed, sport: "football", surfaces: ["home", "draw", "away"], gsize: 3, truth: 0.6 }).map((r, i) => ({ game_id: Math.floor(i / 3), league: `lg${i % 4}`, kickoff_at: new Date(r.t).toISOString(), sel_key: ["home", "draw", "away"][i % 3], p: r.p, p_model: r.p, p_api: r.p, p_market: r.p, verdict: "EVITA", basis: "storico", model_ver: "abc12345", won: !!r.y })) });
const report = buildReport({ tennis: tennis(2600, 1, 0.5), football: football(2400, 2) }, { now: NOW, reps: 200 });
const ui = (o = {}) => ({ open: true, tab: "overview", filter: "all", report, loading: false, error: null, sport: "tennis", ...o });

test("stati: chiusa, in caricamento, errore, nessun report generato (nessun numero mostrato)", () => {
  assert.match(learningHtml({ ...ui(), open: false }), /CONTINUOUS LEARNING/); assert.ok(!/data-cl-tab/.test(learningHtml({ ...ui(), open: false })));
  assert.match(learningHtml(ui({ report: null, loading: true })), /Carico il report/); assert.match(learningHtml(ui({ report: null, error: "risposta 500" })), /Report non disponibile: risposta 500/);
  const stub = learningHtml(ui({ report: JSON.parse(read("public/learning/report.json")) })); assert.match(stub, /Nessun report generato/); assert.match(stub, /scripts\/learning-run\.js/); assert.ok(!/data-cl-tab/.test(stub)); assert.ok(!/\d+,\d{3}/.test(stub.replace(/<[^>]+>/g, "")), "nessun numero statistico");
});

test("sei schede come richiesto e tutte renderizzabili", () => {
  assert.deepEqual(TABS.map(([, l]) => l), ["Panoramica", "Tennis", "Calcio", "Errori", "Laboratorio", "Registro"]);
  for (const [k] of TABS) { const h = learningHtml(ui({ tab: k })); assert.ok(h.length > 500, k); assert.match(h, new RegExp(`data-cl-tab="${k}" aria-pressed="true"`)); }
});

test("panoramica: stato del sistema, previsioni analizzate, errori, anomalie, esperimenti, versioni validate/non validate", () => {
  const h = overviewHtml(report); for (const k of ["Previsioni analizzate", "Errori classificati", "Anomalie rilevate", "Esperimenti nel registro", "Versioni validate (storico)", "Non validate o non conclusive", "Stato del sistema", "Ultimo report", "sola lettura", "non modifica i modelli operativi", "non viene mai adottato in automatico"]) assert.ok(h.includes(k), k);
  assert.ok(h.includes(String(report.overview.predictionsAnalyzed.tennis + report.overview.predictionsAnalyzed.football)));
});

test("diagnostica per sport: metriche con IC, calibrazione, gruppi, periodi, dati mancanti, fonti, distribuzione, qualità", () => {
  for (const sport of ["tennis", "football"]) { const h = sportHtml(report, sport); for (const k of ["Prestazioni complessive", "Brier", "Log loss", "ECE", "Accuratezza", "IC 95%", "Calibrazione per fascia", "Periodi", "Fonti informative", "Distribuzione dei dati", "Qualità dei dati", "pendenza di calibrazione"]) assert.ok(h.includes(k), `${sport}: ${k}`); }
  assert.match(sportHtml(report, "tennis"), /Differenze tra gruppi/); assert.match(sportHtml(report, "tennis"), /Dati mancanti/); assert.match(sportHtml(report, "tennis"), /un solo giocatore|una sola quota|senza il margine/);
  assert.match(sportHtml({ ...report, sports: {} }, "football"), /Nessun dato disponibile/); assert.match(sportHtml({ ...report, sports: { tennis: { sport: "tennis", diagnosis: { available: false, reason: "Nessuna previsione conclusa disponibile per l'analisi." }, skipped: {} } } }, "tennis"), /Nessuna previsione conclusa/);
});

test("errori: ogni anomalia con stato, evidenze, numerosità, periodo, confidenza, ipotesi e limiti; filtri funzionanti", () => {
  const all = errorsHtml(report), det = errorsHtml(report, "detected"), weak = errorsHtml(report, "weak"), n = report.overview.anomalies;
  assert.ok(n.total > 0); assert.equal((all.match(/class="cl-anom"/g) ?? []).length, n.total); assert.equal((det.match(/class="cl-anom"/g) ?? []).length, n.detected); assert.equal((weak.match(/class="cl-anom"/g) ?? []).length, n.weak);
  for (const k of ["Possibili spiegazioni (ipotesi non dimostrate)", "Limiti dell'analisi", "confidenza", "osservazioni", "Classificazione:"]) assert.ok(all.includes(k), k);
  assert.match(errorsHtml({ ...report, sports: { tennis: { ...report.sports.tennis, diagnosis: { ...report.sports.tennis.diagnosis, anomalies: [] } } } }), /L(&#39;|')assenza di anomalie non dimostra/);
});

test("laboratorio e registro: esperimenti con periodi, metriche, holdout, verdetto e limiti; ipotesi «da verificare»; registro completo", () => {
  const lab = labHtml(report); for (const k of ["Log loss base", "Log loss candidato", "Guadagno (base − candidato)", "Fold in miglioramento", "Holdout:", "Limiti statistici", "Addestramento", "validazione walk-forward", "Ipotesi da verificare (non cause accertate)", "Nessuna modifica viene applicata ai modelli"]) assert.ok(lab.includes(k), k);
  for (const v of Object.values(VERDICT)) assert.ok(v[0]); assert.ok(report.experimentLog.length > 0);
  const log = logHtml(report); assert.match(log, /Registro append-only/); assert.equal((log.match(/<li><header>/g) ?? []).length, report.experimentLog.length); assert.match(log, /ID [0-9a-f]{16}/);
  assert.match(labHtml({ ...report, sports: { tennis: { ...report.sports.tennis, lab: { experiments: [], hypotheses: [], note: "Dati insufficienti per un'analisi walk-forward." } } } }), /Dati insufficienti/); assert.match(logHtml({ experimentLog: [] }), /Nessun esperimento registrato/);
});

test("sicurezza e onestà: tutto escapato; nessun dato dimostrativo nel codice; formulazioni prudenti", () => {
  const evil = JSON.parse(JSON.stringify(report)); evil.sports.tennis.diagnosis.anomalies[0].title = "<img src=x onerror=alert(1)>"; evil.sports.tennis.diagnosis.segments[0].value = "<b>x</b>";
  const h = errorsHtml(evil) + sportHtml(evil, "tennis"); assert.ok(!/<img src=x/.test(h)); assert.ok(!/<b>x<\/b>/.test(h)); assert.match(h, /&lt;img src=x/);
  const src = read("src/learning/view.js") + read("src/learning/mount.js"); assert.ok(!/demo|esempio|lorem|fittizi|simulat|Math\.random/i.test(src.replace(/\/\/.*$/gm, "")), "nessun dato dimostrativo"); assert.ok(!/garantit|certament|sicuramente|causa accertata/i.test(src));
  assert.match(read("src/learning/learning.css"), /var\(--sl-/); assert.ok(!/#[0-9a-f]{3,8}\b/i.test(read("src/learning/learning.css")), "solo token, nessun colore fisso"); assert.ok(!/prefers-color-scheme/.test(read("src/learning/learning.css")));
});

test("montaggio: tennis (Affidabilità) e calcio (scheda monitor) usano un modulo autonomo; il report è letto da un file statico", () => {
  assert.match(read("src/tennis/app.js"), /import \{ mountLearning \} from "\.\.\/learning\/mount\.js"/); assert.match(read("src/tennis/app.js"), /<div id="tn-learning"><\/div>/); assert.match(read("src/tennis/app.js"), /mountLearning\(\$\("#tn-learning"\), \{ sport: "tennis" \}\)/);
  assert.match(read("src/monitor-tab.js"), /learning\/mount\.js/); assert.match(read("src/monitor-tab.js"), /sport: "football"/); assert.match(read("src/monitor-tab.js"), /catch \(e\) \{ console\.warn/, "se non carica il monitor resta com'è");
  const m = read("src/learning/mount.js"); assert.match(m, /\/learning\/report\.json/); assert.match(m, /learning-report-v1/); assert.ok(!/method:\s*["'](POST|PUT|PATCH|DELETE)/i.test(m)); assert.ok(!/\/api\//.test(m), "nessuna API operativa");
});

test("formattazione italiana: decimali con la virgola nelle descrizioni, etichette in italiano, p-value minuscoli come «< 0,001»", () => {
  const all = Object.values(report.sports).flatMap((s) => s.diagnosis.anomalies); assert.ok(all.length > 0);
  assert.ok(all.every((a) => !/\d\.\d/.test(a.description)), "nessun decimale con il punto nel testo");
  const h = errorsHtml(report); assert.ok(!/\bclaimed\b|\bobserved\b|\bgap\b/.test(h), "chiavi inglesi non mostrate"); assert.match(h, /dichiarata [\d,]+/); assert.match(h, /p corretto (< 0,001|0,\d{3})/);
});
