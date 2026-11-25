// Stay Live — CONTINUOUS LEARNING: HTML della sezione (stringhe pure, tutto passa da esc()). Tema chiaro, token --sl-*.
// Mostra SOLO ciò che è nel report generato dallo script di diagnostica (sola lettura). Se manca, lo dice: nessun numero di esempio.
import { esc, pct, num } from "../format.js";

export const TABS = [["overview", "Panoramica"], ["tennis", "Tennis"], ["football", "Calcio"], ["errors", "Errori"], ["lab", "Laboratorio"], ["log", "Registro"]];
export const VERDICT = { validato_storico: ["Validato su dati storici (non adottato)", "ok"], non_validato: ["Non validato", "no"], non_conclusivo: ["Non conclusivo", "mid"], peggiore: ["Peggiore della base", "bad"] };
const SPORT = { tennis: "Tennis", football: "Calcio" };
const TYPE = { calibration_slope: "Calibrazione (pendenza)", calibration_intercept: "Calibrazione (scarto medio)", bin_bias: "Fascia di probabilità", segment_gap: "Gruppo con perdita più alta", performance_degradation: "Peggioramento nel tempo", missing_data_effect: "Dati mancanti", source_divergence: "Divergenza tra fonti", distribution_shift: "Cambio di distribuzione" };
const EV = { claimed: "dichiarata", observed: "osservata", gap: "scarto", slope: "pendenza", intercept: "intercetta", meanP: "prob. media", meanY: "frequenza", bias: "scarto medio", diff: "differenza", logLoss: "log loss", logLossA: "log loss A", logLossB: "log loss B", ece: "ECE", psi: "PSI", brierDiff: "diff. Brier", nWith: "casi con dato mancante", nWithout: "casi con dato presente", meanAbsDivergence: "divergenza media", group: "gruppo", dimension: "dimensione", flag: "dato", a: "fonte A", b: "fonte B" };
const pv = (x) => (x == null ? "n.d." : x < 0.001 ? "< 0,001" : num(x, 3));
const SRC = { model: "modello", api: "API", market: "mercato" };
const DIM = { surface: "superficie", tour: "circuito", market: "mercato", league: "campionato", basis: "base dati", version: "versione" };
const when = (t) => (t ? new Date(t).toLocaleString("it-IT", { timeZone: "Europe/Rome", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).replace(/\./g, "") : "n.d.");
const day = (t) => (t ? new Date(t).toLocaleDateString("it-IT", { timeZone: "Europe/Rome", day: "numeric", month: "short" }).replace(/\./g, "") : "n.d.");
const per = (p) => (p?.from ? `${day(p.from)} – ${day(p.to)}` : "n.d.");
const ci = (x, d = 3) => (x?.est == null ? "n.d." : `${num(x.est, d)}${x.lo != null ? ` [${num(x.lo, d)} ; ${num(x.hi, d)}]` : ""}`);
const ciP = (x) => (x?.est == null ? "n.d." : `${pct(x.est, 1)}${x.lo != null ? ` [${pct(x.lo, 1)} ; ${pct(x.hi, 1)}]` : ""}`);
const chip = (txt, kind) => `<span class="cl-chip k-${esc(kind)}">${esc(txt)}</span>`;
const kpi = (n, l) => `<div class="cl-kpi"><b>${esc(n)}</b><span>${esc(l)}</span></div>`;
const vchip = (s) => { const [t, k] = VERDICT[s] ?? [s, "mid"]; return chip(t, k); };
const na = (txt) => `<p class="cl-note">${esc(txt)}</p>`;

export function overviewHtml(r) {
  const o = r.overview, v = o.experiments.byVerdict, valid = v.validato_storico ?? 0, total = o.experiments.total, notValid = total - valid;
  const sp = Object.entries(o.predictionsAnalyzed).map(([k, n]) => `${SPORT[k] ?? k}: ${n}`).join(" · ") || "nessuna";
  return `<div class="cl-kpis">${kpi(Object.values(o.predictionsAnalyzed).reduce((s, n) => s + n, 0), "Previsioni analizzate")}${kpi(o.anomalies.total, "Errori classificati")}${kpi(o.anomalies.detected, "Anomalie rilevate")}${kpi(total, "Esperimenti nel registro")}${kpi(valid, "Versioni validate (storico)")}${kpi(notValid, "Non validate o non conclusive")}</div>
    <section class="cl-card"><h3>Stato del sistema</h3><ul class="cl-rows"><li><span>Ultimo report</span><b>${esc(when(r.generatedAt))}</b></li><li><span>Fonte</span><b>${esc(r.source.kind === "supabase" ? "registri esistenti (sola lettura)" : "file di dati")}</b></li><li><span>Per sport</span><b>${esc(sp)}</b></li><li><span>Anomalie deboli</span><b>${esc(o.anomalies.weak)}</b></li><li><span>Esperimenti in questa esecuzione</span><b>${esc(o.experiments.thisRun)}</b></li><li><span>Motore diagnostico</span><b>${esc(r.engine)}</b></li></ul>
    <p class="cl-note">Sistema osservativo e isolato: non modifica i modelli operativi, le probabilità né i dati. «Validato» significa solo migliore su dati storici indipendenti: non viene mai adottato in automatico e richiede una validazione prospettica separata.</p></section>
    <section class="cl-card"><h3>Come leggere gli stati</h3><ul class="cl-rows"><li>${chip("Rilevata", "ok")}<span>campione sufficiente, p corretto con Holm &lt; 0,05, intervallo che esclude lo zero</span></li><li>${chip("Segnale debole", "mid")}<span>indicativo: campione sotto soglia o test non corretto</span></li><li>${vchip("non_conclusivo")}<span>campione insufficiente per decidere</span></li></ul></section>`;
}

function metricsCard(s) {
  const d = s.diagnosis, m = d.summary;
  return `<section class="cl-card"><h3>Prestazioni complessive</h3><p class="cl-meta">${esc(d.n)} previsioni concluse · ${esc(d.blocks)} blocchi · ${esc(per(d.period))}${d.sufficient ? "" : " · campione insufficiente (servono 300 osservazioni e 50 blocchi)"}</p>
    <dl class="cl-metrics"><div><dt>Brier</dt><dd>${esc(num(m.brier.est, 3))}</dd><small>${m.brier.lo != null ? `IC 95% ${esc(num(m.brier.lo, 3))} – ${esc(num(m.brier.hi, 3))}` : "IC n.d."}</small></div><div><dt>Log loss</dt><dd>${esc(num(m.logLoss.est, 3))}</dd><small>${m.logLoss.lo != null ? `IC 95% ${esc(num(m.logLoss.lo, 3))} – ${esc(num(m.logLoss.hi, 3))}` : "IC n.d."}</small></div><div><dt>ECE</dt><dd>${esc(m.ece == null ? "n.d." : num(m.ece, 3))}</dd><small>IC non stimato</small></div><div><dt>Accuratezza</dt><dd>${esc(pct(m.accuracy.est, 1))}</dd><small>${m.accuracy.lo != null ? `IC 95% ${esc(pct(m.accuracy.lo, 1))} – ${esc(pct(m.accuracy.hi, 1))}` : "IC n.d."} · secondaria</small></div></dl>
    <p class="cl-meta">Probabilità media dichiarata ${esc(pct(m.meanP, 1))} · frequenza osservata ${esc(pct(m.meanY, 1))} · pendenza di calibrazione ${esc(d.calibration.fit.slope == null ? "n.d." : num(d.calibration.fit.slope, 2))}${d.calibration.fit.slopeCI[0] != null ? ` (IC ${esc(num(d.calibration.fit.slopeCI[0], 2))} – ${esc(num(d.calibration.fit.slopeCI[1], 2))})` : ""} (1 = ideale)</p></section>`;
}
function binsCard(d) {
  if (!d.calibration.bins.length) return "";
  return `<section class="cl-card"><h3>Calibrazione per fascia</h3><ul class="cl-bins">${d.calibration.bins.map((b) => `<li><span class="cl-bl">${Math.round(b.lo * 100)}–${Math.round(b.hi * 100)}%</span><span class="cl-track"><i class="cl-claimed" style="left:${(b.claimed * 100).toFixed(1)}%"></i><b style="width:${(b.observed * 100).toFixed(1)}%"></b></span><span class="cl-bv">${esc(pct(b.observed, 0))} <small>su ${esc(b.n)}</small></span></li>`).join("")}</ul>
    <p class="cl-note">Barra: frequenza osservata. Segno: probabilità dichiarata media della fascia. Se il segno è a destra della barra le probabilità sono state sovrastimate.</p></section>`;
}
function segCard(d) {
  const rows = d.segments.filter((x) => x.diff).slice(0, 14);
  if (!rows.length) return "";
  return `<section class="cl-card"><h3>Differenze tra gruppi</h3><p class="cl-meta">Log loss del gruppo meno quella del resto (positivo = peggiore). Solo gruppi con almeno 60 osservazioni; p corretto con Holm.</p><ul class="cl-rows cl-seg">${rows.map((x) => `<li><span>${esc(DIM[x.dim] ?? x.dim)} · <b>${esc(x.value)}</b><small>${esc(x.n)} casi · ${esc(x.blocks)} blocchi</small></span><b>${esc(num(x.diff.est, 3))}<small>[${esc(num(x.diff.lo, 3))} ; ${esc(num(x.diff.hi, 3))}] · p ${esc(pv(x.diff.adjP))}</small></b></li>`).join("")}</ul></section>`;
}
function periodCard(d) {
  const w = d.periods.weekly.slice(-8), rv = d.periods.recentVsEarlier, max = Math.max(...w.map((x) => x.logLoss ?? 0), 0.01);
  return `<section class="cl-card"><h3>Periodi</h3>${w.length ? `<ul class="cl-weeks">${w.map((x) => `<li><span>${esc(x.weekStart.slice(5))}</span><i><b style="width:${Math.min(100, (x.logLoss / max) * 100).toFixed(1)}%"></b></i><span>${esc(num(x.logLoss, 3))} <small>n=${esc(x.n)}</small></span></li>`).join("")}</ul><p class="cl-note">Log loss per settimana (barra più corta = migliore). Settimane con pochi casi oscillano molto.</p>` : na("Nessun dato.")}
    ${rv ? `<p class="cl-meta">Recente contro precedente (ultimo quarto): differenza di log loss ${esc(ci(rv.logLossDiff))}; n ${esc(rv.n[0])} contro ${esc(rv.n[1])}.</p>` : na("Periodo troppo breve per confrontare recente e precedente.")}</section>`;
}
function sourcesCard(s) {
  const d = s.diagnosis, u = s.usage, c = d.sources.comparisons;
  const share = (x) => (x == null ? "n.d." : pct(x, 1));
  return `<section class="cl-card"><h3>Fonti informative</h3><ul class="cl-rows"><li><span>Previsioni con probabilità del modello</span><b>${esc(share(u?.withModel))}</b></li><li><span>con probabilità dell'API</span><b>${esc(share(u?.withApi))}</b></li><li><span>con quota di mercato</span><b>${esc(share(u?.withMarket))}</b></li><li><span>quota normalizzata (utilizzabile come probabilità)</span><b>${esc(share(u?.withNormalizedMarket))}</b></li>${u?.oddsAgeMinutes ? `<li><span>Quota: anticipo mediano sull'inizio</span><b>${esc(Math.round(u.oddsAgeMinutes.median / 60))} ore (n=${esc(u.oddsAgeMinutes.n)})</b></li>` : ""}</ul>
    ${c.length ? `<h4>Confronto sulle stesse partite (log loss, differenza a − b; negativo = a migliore)</h4><ul class="cl-rows">${c.map((x) => (x.available ? `<li><span>${esc(SRC[x.a])} contro ${esc(SRC[x.b])}<small>${esc(x.n)} casi · divergenza media ${esc(num(x.meanAbsDivergence, 3))}</small></span><b>${esc(ci(x.diff))}</b></li>` : `<li><span>${esc(SRC[x.a])} contro ${esc(SRC[x.b])}</span><b>non disponibile (${esc(x.n)} casi)</b></li>`)).join("")}</ul>` : ""}
    ${s.sport === "tennis" ? na("Nel tennis la quota è spesso disponibile per un solo giocatore: senza il margine non si ottiene una probabilità e il confronto usa solo le partite con entrambe le quote.") : ""}</section>`;
}
function missingCard(d) {
  const rows = d.missingEffects.filter((x) => x.nWith > 0);
  if (!rows.length) return `<section class="cl-card"><h3>Dati mancanti</h3>${na("Nessun dato mancante registrato.")}</section>`;
  return `<section class="cl-card"><h3>Dati mancanti</h3><ul class="cl-rows">${rows.map((x) => `<li><span>${esc(x.label)}<small>${esc(x.nWith)} casi (${esc(pct(x.share, 0))})</small></span><b>${x.diff ? esc(ci(x.diff)) : "n.d."}</b></li>`).join("")}</ul><p class="cl-note">Differenza di log loss tra previsioni con il dato mancante e senza (positivo = peggiore). Non prova una causa: il dato mancante può coincidere con altre differenze.</p></section>`;
}
function driftCard(d) {
  return `<section class="cl-card"><h3>Distribuzione dei dati</h3><p class="cl-meta">PSI delle probabilità tra prima e seconda metà del periodo: <b>${esc(d.drift.psiP == null ? "n.d." : num(d.drift.psiP, 3))}</b> (0,10 moderato, 0,25 marcato)</p>${d.drift.mix.length ? `<p class="cl-meta">Composizione: ${d.drift.mix.map((m) => `${esc(DIM[m.dim] ?? m.dim)} ${esc(num(m.psi, 3))}`).join(" · ")}</p>` : ""}</section>`;
}
function qualityCard(s) {
  const k = Object.entries(s.skipped ?? {}).filter(([, n]) => n > 0);
  return `<section class="cl-card"><h3>Qualità dei dati</h3>${k.length ? `<ul class="cl-rows">${k.map(([a, n]) => `<li><span>${esc(({ notPublished: "previsioni non pubblicate (astensioni)", noWinner: "senza esito verificato", badProbability: "probabilità non valida", badDate: "data non valida", reconstructed: "ricostruite a posteriori (escluse: non prospettiche)", noOutcome: "senza esito" })[a] ?? a)}</span><b>${esc(n)}</b></li>`).join("")}</ul>` : na("Nessuna riga esclusa.")}</section>`;
}
export function sportHtml(r, sport) {
  const s = r.sports?.[sport];
  if (!s) return `<section class="cl-card"><h3>Diagnostica ${esc(SPORT[sport])}</h3>${na("Nessun dato disponibile: lo sport non è nel report.")}</section>`;
  if (!s.diagnosis.available) return `<section class="cl-card"><h3>Diagnostica ${esc(SPORT[sport])}</h3>${na(s.diagnosis.reason)}</section>${qualityCard(s)}`;
  return `${metricsCard(s)}${binsCard(s.diagnosis)}${segCard(s.diagnosis)}${periodCard(s.diagnosis)}${missingCard(s.diagnosis)}${sourcesCard(s)}${driftCard(s.diagnosis)}${qualityCard(s)}`;
}

function anomalyHtml(a) {
  const e = a.evidence, ev = Object.entries(e).filter(([, v]) => v != null && typeof v !== "object").slice(0, 6).map(([k, v]) => `${esc(EV[k] ?? k)} ${esc(typeof v === "number" ? num(v, 3) : v)}`).join(" · ");
  return `<article class="cl-anom"><header>${chip(a.status === "rilevata" ? "Rilevata" : "Segnale debole", a.status === "rilevata" ? "ok" : "mid")}${chip(SPORT[a.sport], "sp")}<span class="cl-ty">${esc(TYPE[a.type] ?? a.type)}</span></header>
    <h4>${esc(a.title)}</h4><p>${esc(a.description)}</p>
    <p class="cl-meta">${esc(a.n)} osservazioni${a.blocks ? ` · ${esc(a.blocks)} blocchi` : ""} · ${esc(per(a.period))} · confidenza ${esc(a.confidence.level)} (IC ${a.confidence.ci * 100}%, p corretto ${esc(pv(a.confidence.adjustedP))}, ${esc(a.confidence.correction)})</p>${ev ? `<p class="cl-meta">Evidenze: ${ev}</p>` : ""}
    <details><summary>Possibili spiegazioni (ipotesi non dimostrate)</summary><ul>${a.explanations.map((x) => `<li>${esc(x.text)}</li>`).join("")}</ul></details>
    <details><summary>Limiti dell'analisi</summary><ul>${a.limits.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></details></article>`;
}
export function errorsHtml(r, filter = "all") {
  const all = Object.values(r.sports ?? {}).flatMap((s) => s.diagnosis.anomalies ?? []), list = all.filter((a) => filter === "all" || (filter === "detected" ? a.status === "rilevata" : a.status !== "rilevata"));
  const types = all.reduce((m, a) => ((m[a.type] = (m[a.type] ?? 0) + 1), m), {});
  return `<div class="cl-filter" role="group" aria-label="Filtro">${[["all", `Tutte (${all.length})`], ["detected", `Rilevate (${all.filter((a) => a.status === "rilevata").length})`], ["weak", `Segnali deboli (${all.filter((a) => a.status !== "rilevata").length})`]].map(([k, l]) => `<button type="button" data-cl-filter="${k}" aria-pressed="${filter === k}">${esc(l)}</button>`).join("")}</div>
    ${Object.keys(types).length ? `<p class="cl-meta">Classificazione: ${Object.entries(types).map(([t, n]) => `${esc(TYPE[t] ?? t)} ${esc(n)}`).join(" · ")}</p>` : ""}${list.length ? list.map(anomalyHtml).join("") : `<section class="cl-card">${na("Nessuna anomalia in questa categoria. L'assenza di anomalie non dimostra che il modello sia corretto: con campioni piccoli molte differenze non sono rilevabili.")}</section>`}`;
}

function expHtml(e) {
  const c = e.comparison, h = e.holdout;
  return `<article class="cl-exp"><header>${vchip(e.verdict.status)}${chip(SPORT[e.sport], "sp")}<span class="cl-ty">${esc(e.change.label)}</span></header>
    <p class="cl-meta">ID ${esc(e.id)} · versione di partenza ${esc(e.baseVersion.map((v) => `${v.version} (${v.n})`).join(", "))} · dati ${esc(per(e.dataset.period))}, n=${esc(e.dataset.n)}</p>
    <p class="cl-meta">Addestramento ${esc(per(e.training.period))} (n=${esc(e.training.n)}) · validazione walk-forward ${esc(per(e.validation.period))} (n=${esc(e.validation.n)}, ${esc(e.validation.blocks)} blocchi, ${esc(e.design.folds)} fold)</p>
    ${c ? `<dl class="cl-metrics"><div><dt>Log loss base</dt><dd>${esc(num(e.metrics.baseline.logLoss, 4))}</dd></div><div><dt>Log loss candidato</dt><dd>${esc(num(e.metrics.candidate.logLoss, 4))}</dd></div><div><dt>Guadagno (base − candidato)</dt><dd>${esc(num(c.logLossGain.est, 4))}</dd><small>IC 95% ${esc(num(c.logLossGain.lo, 4))} – ${esc(num(c.logLossGain.hi, 4))}</small></div><div><dt>Fold in miglioramento</dt><dd>${esc(pct(c.foldsImproved, 0))}</dd><small>p corretto ${esc(pv(c.adjustedP))}</small></div></dl>` : na("Nessun confronto: dati insufficienti.")}
    <p class="cl-meta">Holdout: ${h.evaluated ? `valutato una volta su ${esc(h.n)} osservazioni (${esc(per(h.period))}); guadagno ${esc(h.logLossGain ? ci(h.logLossGain, 4) : "n.d.")}` : esc(h.reason)}</p>
    <ul class="cl-reasons">${e.verdict.reasons.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>
    <details><summary>Limiti statistici</summary><ul>${e.limits.map((x) => `<li>${esc(x)}</li>`).join("")}</ul></details></article>`;
}
export function labHtml(r) {
  const secs = Object.values(r.sports ?? {}).map((s) => ({ s, ex: s.lab.experiments, hy: s.lab.hypotheses }));
  if (!secs.some((x) => x.ex.length || x.hy.length)) return `<section class="cl-card"><h3>Laboratorio sperimentale</h3>${na(secs.map((x) => x.s.lab.note).filter(Boolean).join(" ") || "Nessun esperimento in questa esecuzione.")}</section>`;
  return secs.map(({ s, ex, hy }) => `<h3 class="cl-h">${esc(SPORT[s.sport])}</h3>${ex.length ? ex.map(expHtml).join("") : `<section class="cl-card">${na(s.lab.note ?? "Nessun esperimento.")}</section>`}${hy.length ? `<section class="cl-card"><h4>Ipotesi da verificare (non cause accertate)</h4><ul class="cl-reasons">${hy.map((x) => `<li>${esc(x.statement)}${x.candidate ? ` <small>Candidato: ${esc(x.candidate)}</small>` : ""}</li>`).join("")}</ul></section>` : ""}`).join("") + `<p class="cl-note">Gli esperimenti sono ricalibrazioni delle probabilità già prodotte, valutate in avanti nel tempo (walk-forward) e confermate su un tratto finale tenuto fuori. Nessuna modifica viene applicata ai modelli.</p>`;
}
export function logHtml(r) {
  const log = (r.experimentLog ?? []).slice().sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  if (!log.length) return `<section class="cl-card"><h3>Registro delle modifiche</h3>${na("Nessun esperimento registrato.")}</section>`;
  return `<p class="cl-meta">Registro append-only: ${esc(log.length)} esperimenti. I record esistenti non vengono mai modificati.</p><ul class="cl-log">${log.slice(0, 80).map((e) => `<li><header>${vchip(e.verdict.status)}${chip(SPORT[e.sport] ?? e.sport, "sp")}<span class="cl-ty">${esc(e.candidate)}</span></header><p class="cl-meta">${esc(when(e.createdAt))} · ID ${esc(e.id)} · dati n=${esc(e.dataset.n)} (${esc(per(e.dataset.period))}) · base ${esc(e.baseVersion.map((v) => v.version).join(", "))}</p>${e.comparison ? `<p class="cl-meta">Guadagno di log loss ${esc(ci(e.comparison.logLossGain, 4))}${e.holdoutGain ? ` · holdout ${esc(ci(e.holdoutGain, 4))}` : ""}</p>` : ""}<p class="cl-meta">${esc(e.verdict.reasons[0] ?? "")}</p></li>`).join("")}</ul>${log.length > 80 ? na(`Mostrati gli 80 più recenti su ${log.length}.`) : ""}`;
}

/** Sezione completa. ui = { open, tab, filter, report, loading, error, sport }. */
export function learningHtml(ui) {
  const head = `<section class="cl-wrap"><button type="button" class="cl-toggle" data-cl-toggle aria-expanded="${!!ui.open}"><span><b>CONTINUOUS LEARNING</b><small>Diagnostica dei modelli e laboratorio sperimentale · tennis e calcio · sola osservazione</small></span><i aria-hidden="true">${ui.open ? "−" : "+"}</i></button>`;
  if (!ui.open) return `${head}</section>`;
  if (ui.loading && !ui.report) return `${head}<p class="cl-note">Carico il report…</p></section>`;
  if (ui.error && !ui.report) return `${head}<div class="cl-card">${na(`Report non disponibile: ${ui.error}`)}</div></section>`;
  const r = ui.report;
  if (!r || r.status !== "ok") return `${head}<div class="cl-card"><h3>Nessun report generato</h3>${na(r?.note ?? "Nessun report disponibile.")}<p class="cl-note">Comando: <code>node scripts/learning-run.js</code> (sola lettura sul database). Finché non esiste un report, nessun numero viene mostrato.</p></div></section>`;
  const tabs = `<div class="cl-tabs" role="group" aria-label="Sezioni">${TABS.map(([k, l]) => `<button type="button" data-cl-tab="${k}" aria-pressed="${ui.tab === k}">${esc(l)}</button>`).join("")}</div>`;
  const body = { overview: () => overviewHtml(r), tennis: () => sportHtml(r, "tennis"), football: () => sportHtml(r, "football"), errors: () => errorsHtml(r, ui.filter), lab: () => labHtml(r), log: () => logHtml(r) }[ui.tab] ?? (() => overviewHtml(r));
  return `${head}${tabs}<div class="cl-body">${body()}</div></section>`;
}
