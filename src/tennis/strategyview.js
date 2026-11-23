// Stay Live Tennis — «Strategia»: HTML del cruscotto statistico (stringhe pure, tutto passa da esc()). Tema chiaro, token --sl-*, mobile-first.
// Il grafico di taratura è disegnato dai DATI (SVG generato dal codice, nessuna immagine decorativa).
import { icon } from "../icons.js";
import { esc, pct, num } from "../format.js";
import { STRATEGY_TABS, STATUS, COIN_FLIP, OBSERVATION } from "./strategy.js";

const chip = (k) => `<span class="sd-chip s-${esc(k)}">${icon(STATUS[k].icon)}${esc(STATUS[k].label)}</span>`;
const when = (t) => (t ? new Date(t).toLocaleString("it-IT", { timeZone: "Europe/Rome", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).replace(/\./g, "") : "—");
const ci = (x, d = 3) => (x?.est == null ? "—" : num(x.est, d));
const range = (x, d = 3) => (x?.lo == null ? "intervallo n.d." : `IC 95% ${num(x.lo, d)} – ${num(x.hi, d)}`);
const bar = (v, max) => `<i class="sd-bar"><b style="width:${Math.max(0, Math.min(100, (v / max) * 100)).toFixed(1)}%"></b></i>`;
/** Cosa manca davvero per leggere il risultato (solo i requisiti non ancora raggiunti). */
const missingText = (m) => { const need = []; if (m.valid < OBSERVATION.minSample) need.push(`${OBSERVATION.minSample - m.valid} osservazioni valide in più (ora ${m.valid}/${OBSERVATION.minSample})`); if (m.blocks < OBSERVATION.minBlocks) need.push(`${OBSERVATION.minBlocks - m.blocks} blocchi indipendenti in più (ora ${m.blocks}/${OBSERVATION.minBlocks})`); return need.join(" e "); };
const kpi = (n, label, extra = "") => `<div class="sd-kpi"><b>${esc(n)}</b><span>${esc(label)}</span>${extra}</div>`;

export function tabsHtml(tab) {
  return `<div class="sd-tabs" role="group" aria-label="Sezioni della strategia">${STRATEGY_TABS.map(([k, l]) => `<button type="button" data-stab="${k}" aria-pressed="${tab === k}">${esc(l)}</button>`).join("")}</div>`;
}

/** Barra «n / soglia»: mostra quanto manca per poter leggere il risultato. */
const progress = (label, v, need) => `<div class="sd-prog"><div><span>${esc(label)}</span><b>${esc(v)} / ${esc(need)}</b></div>${bar(v, need)}</div>`;

/** Stato del sistema: cosa è operativo, cosa è sperimentale, quale versione, quanto è aggiornato. La parte «dai dati» è letta dal registro; la parte «dichiarata» no. */
export function systemHtml(d) {
  const y = d.system, o = d.overview, row = (k, v) => `<li><span>${esc(k)}</span><b>${v}</b></li>`;
  const models = y.models.length ? y.models.map(esc).join(", ") : "n.d.";
  const loader = y.loader == null ? "n.d." : `${esc(y.loader === "offset" ? "a offset" : y.loader === "keyset" ? "a chiave (KEYSET)" : y.loader)}${y.historyMatches != null ? ` · ${esc(y.historyMatches)} partite` : ""}`;
  const lag = y.historyLastAt ? `ultima partita nei rating: ${esc(when(y.historyLastAt))}` : "";
  return `<section class="sd-card sd-system"><h3>Stato del sistema</h3>
    <p class="sd-src">${icon("database")}Letto dal registro LIVE OBSERVATION</p>
    <ul class="sd-rows">${row("Motore operativo", `Tennis · modello ${models}`)}${row("Caricamento storico", loader)}${lag ? `<li class="sub"><span>${lag}</span></li>` : ""}
      ${row("Ultimo aggiornamento", esc(when(y.lastOk ?? y.lastRecorded)))}${row("Raccolta prospettica", y.registryEnabled === false ? "spenta" : y.error ? "con errore (vedi Integrità)" : y.registryEnabled ? "attiva" : "n.d.")}
      ${row("Osservazioni raccolte", esc(o.total))}${row("Partite concluse", esc(o.concluded))}${row("Osservazioni valide", `${esc(o.valid)} / ${esc(o.minSample)}`)}</ul>
    <h4>Campione sufficiente</h4><p class="sd-p">${y.sufficient.length ? esc(y.sufficient.join(", ")) : "Nessun gruppo: nessuna metrica ha ancora un campione sufficiente."}</p>
    <h4>Risultati non validati</h4><p class="sd-p">${esc(y.notValidated)} su ${esc(y.groupsTotal)} gruppi con dati: nessuno ha superato la validazione (manca il confronto con il mercato).</p>
    <p class="sd-src dec">${icon("info")}Elenco dichiarato dal codice, non letto dal database</p>
    <ul class="sd-rows">${row("Strategy Center 2.0 e relative selezioni", "sperimentale, isolato, non collegato all'app")}${row("Caricamento storico a chiave", y.keysetActive ? "ATTIVO nei dati registrati" : "non attivo (sperimentale)")}${row("Pronostici e verdetti BET/EVITA", "motore operativo, non validato come vantaggio sul mercato")}</ul>
    <p class="sd-meta">Nessun dato simulato: ogni numero di questa pagina viene dal database.</p></section>`;
}

export function overviewHtml(d) {
  const o = d.overview;
  return `<section class="sd-hero">
      <div class="sd-hero-top"><span class="sd-lbl">Osservazioni valide</span>${chip(o.status)}</div>
      <b class="sd-big">${esc(o.valid)}</b>
      <p class="sd-sub">Partite concluse con valutazione iniziale pubblicata e risultato verificato.</p>
      ${progress("Campione", o.valid, o.minSample)}${progress("Blocchi indipendenti", o.blocks, o.minBlocks)}
    </section>
    <div class="sd-kpis">${kpi(o.total, "Osservazioni registrate")}${kpi(o.concluded, "Partite concluse")}${kpi(o.waiting, "In attesa di esito")}${kpi(o.quality == null ? "—" : pct(o.quality, 0), "Dati completi")}</div>
    ${systemHtml(d)}
    <section class="sd-card"><h3>Stato della validazione</h3><p class="sd-p">${esc(STATUS[o.status].hint)}</p>
      <p class="sd-p">${o.sufficient ? "La soglia statistica è raggiunta, ma manca il confronto con le quote del mercato al momento della previsione: per questo nessun risultato è «Validato»." : `Servono almeno ${esc(o.minSample)} osservazioni valide su ${esc(o.minBlocks)} blocchi indipendenti (torneo e settimana) prima di leggere un risultato.`}</p>
      <p class="sd-meta">Ultimo aggiornamento: ${esc(when(o.lastUpdate))}${d.complete ? "" : ` · caricate ${esc(d.loaded)} di ${esc(d.total)}`}</p></section>
    <section class="sd-card sd-legend"><h3>Come leggere gli stati</h3><ul>${Object.keys(STATUS).map((k) => `<li>${chip(k)}<span>${esc(STATUS[k].hint)}</span></li>`).join("")}</ul></section>`;
}

/** Scheda metriche di un gruppo (circuito o superficie). */
export function groupCardHtml(g, { unavailableText } = {}) {
  const m = g.metrics, head = `<header><h3>${esc(g.label)}</h3>${chip(g.status)}</header>`;
  if (g.status === "unavailable") return `<article class="sd-card sd-group">${head}<p class="sd-p">${esc(unavailableText ?? "Nessun dato registrato per questo gruppo.")}</p></article>`;
  const na = m.valid === 0;
  return `<article class="sd-card sd-group">${head}
    <p class="sd-meta">${esc(g.total)} registrate · ${esc(g.concluded)} concluse · <b>${esc(m.valid)}</b> valide · ${esc(m.blocks)} blocchi</p>
    ${na ? `<p class="sd-p">Nessuna partita conclusa con valutazione pubblicata: nessuna metrica.</p>` : `<dl class="sd-metrics">
      <div><dt>Brier</dt><dd>${ci(m.brier)}</dd><small>${esc(range(m.brier))}</small></div><div><dt>Log loss</dt><dd>${ci(m.logLoss)}</dd><small>${esc(range(m.logLoss))}</small></div>
      <div><dt>ECE</dt><dd>${m.calibration.ece == null ? "—" : num(m.calibration.ece, 3)}</dd><small>taratura media · IC non stimato</small></div><div><dt>Accuratezza</dt><dd>${m.accuracy ? pct(m.accuracy.est, 1) : "—"}</dd><small>${m.accuracy?.lo != null ? `IC 95% ${pct(m.accuracy.lo, 1)} – ${pct(m.accuracy.hi, 1)}` : "intervallo n.d."}</small></div></dl>
    <p class="sd-meta">Riferimento «caso»: Brier ${num(COIN_FLIP.brier, 3)} · log loss ${num(COIN_FLIP.logLoss, 3)}.</p>`}
    ${m.sufficient ? "" : `<p class="sd-warn">${icon("warning")}<span>Mancano ${esc(missingText(m))}: numeri solo indicativi, nessuna conclusione.</span></p>`}</article>`;
}
export function toursHtml(d) {
  return `<p class="sd-lead">Metriche separate per circuito, sulla sola valutazione iniziale.</p><div class="sd-grid">${d.tours.map((g) => groupCardHtml(g)).join("")}</div>`;
}
export function surfacesHtml(d) {
  const i = d.integrity;
  return `<p class="sd-lead">Metriche separate per superficie. La numerosità è sempre indicata.</p><div class="sd-grid">${d.surfaces.map((g) => groupCardHtml(g)).join("")}
    <article class="sd-card sd-group"><header><h3>Indoor</h3>${chip("unavailable")}</header><p class="sd-p">Non è distinguibile: nei dati registrati il cemento al coperto rientra in «Cemento». Nessuna stima separata.</p></article></div>
    ${i.noSurface ? `<p class="sd-meta">${esc(i.noSurface)} osservazioni senza superficie riconosciuta: escluse da questa pagina.</p>` : ""}`;
}

/** Grafico di taratura: frequenza osservata (barre) contro probabilità dichiarata (diagonale ideale), con la numerosità per fascia. */
export function calibrationChartSvg(bins, insufficient) {
  const W = 300, H = 190, L = 30, R = 8, T = 10, B = 34, pw = W - L - R, ph = H - T - B, x = (p) => L + p * pw, y = (p) => T + (1 - p) * ph;
  const grid = [0, 0.25, 0.5, 0.75, 1].map((g) => `<line x1="${L}" x2="${W - R}" y1="${y(g).toFixed(1)}" y2="${y(g).toFixed(1)}" class="g"/><text x="${L - 4}" y="${(y(g) + 3).toFixed(1)}" class="t" text-anchor="end">${Math.round(g * 100)}</text>`).join("");
  const bw = (pw / 10) * 0.62;
  const bars = bins.map((b) => { const cx = x((b.lo + b.hi) / 2), h = b.observed * ph; return `<rect x="${(cx - bw / 2).toFixed(1)}" y="${(T + ph - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${Math.max(h, 1).toFixed(1)}" rx="3" class="b"/>`
    + `<circle cx="${cx.toFixed(1)}" cy="${y(b.claimed).toFixed(1)}" r="3.4" class="c"/><text x="${cx.toFixed(1)}" y="${H - 20}" class="t" text-anchor="middle">${Math.round(b.lo * 100)}</text><text x="${cx.toFixed(1)}" y="${H - 8}" class="n" text-anchor="middle">n=${b.n}</text>`; }).join("");
  return `<svg class="sd-svg${insufficient ? " dim" : ""}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Taratura: frequenza osservata contro probabilità dichiarata per fascia">${grid}<line x1="${x(0)}" y1="${y(0)}" x2="${x(1)}" y2="${y(1)}" class="d"/>${bars}</svg>`;
}
export function calibrationHtml(d) {
  const c = d.calibration, rows = c.bins;
  if (!rows.length) return `<section class="sd-card"><header><h3>Taratura</h3>${chip(c.status === "unavailable" ? "unavailable" : "observing")}</header><p class="sd-p">Nessuna partita conclusa con valutazione pubblicata: il grafico compare con i primi esiti.</p></section>`;
  const list = rows.map((b) => { const gap = (b.observed - b.claimed) * 100; return `<tr><th>${Math.round(b.lo * 100)}–${Math.round(b.hi * 100)}%</th><td>${esc(b.n)}</td><td>${pct(b.claimed, 0)}</td><td>${pct(b.observed, 0)}</td><td class="${Math.abs(gap) >= 10 ? "off" : ""}">${gap > 0 ? "+" : ""}${num(gap, 1)}</td></tr>`; }).join("");
  return `<section class="sd-card"><header><h3>Taratura</h3>${chip(c.status)}</header>
    <p class="sd-meta">ECE ${c.ece == null ? "—" : num(c.ece, 3)} · ${esc(c.valid)} osservazioni valide</p>
    ${calibrationChartSvg(rows, !c.sufficient)}
    <p class="sd-legendline"><span><i class="lb"></i>Frequenza osservata</span><span><i class="lc"></i>Probabilità dichiarata</span><span><i class="ld"></i>Taratura perfetta</span></p>
    <p class="sd-meta">Asse orizzontale: fascia di probabilità dichiarata (%); sotto, il numero di casi per fascia.</p>${c.sufficient ? "" : `<p class="sd-warn">${icon("warning")}<span>Campione insufficiente: mancano ${esc(missingText({ valid: c.valid, blocks: c.blocks }))}. Le fasce con pochi casi oscillano molto: non sono conclusioni.</span></p>`}</section>
    <section class="sd-card"><h3>Scostamento per fascia</h3><div class="sd-tablewrap"><table class="sd-table"><thead><tr><th>Fascia</th><th>Casi</th><th>Dichiar.</th><th>Osserv.</th><th>Scarto (pt)</th></tr></thead><tbody>${list}</tbody></table></div></section>`;
}

const li = (ok, text) => `<li class="${ok ? "ok" : "bad"}">${icon(ok ? "check-circle" : "warning")}<span>${text}</span></li>`;
export function integrityHtml(d) {
  const i = d.integrity, s = i.sync, ex = i.excluded;
  const missing = i.missing.length ? `<ul class="sd-rows">${i.missing.slice(0, 6).map(([k, n]) => `<li><span>${esc(k)}</span><b>${esc(n)}</b></li>`).join("")}</ul>` : `<p class="sd-p">Nessun dato mancante dichiarato dal modello.</p>`;
  const sync = s.unavailable ? li(false, "Diagnostica non leggibile.") : s.blocked ? li(false, `<b>Registrazione bloccata</b> (${esc(s.blocked.reason)}): ${esc(s.blocked.count ?? "?")} partite concluse con data dopo l'elaborazione; nulla è stato corretto.`)
    : s.error ? li(false, `Errore nell'ultimo giro: ${esc(s.error)}.`) : s.enabled === false ? li(false, "Raccolta prospettica spenta: nessuna nuova osservazione.") : li(true, `Ultimo giro regolare: ${esc(s.newObservations ?? 0)} nuove osservazioni, ${esc(s.newVersions ?? 0)} nuove versioni.`);
  return `<section class="sd-card"><h3>Raccolta prospettica</h3><ul class="sd-checks">${sync}${li(d.complete, d.complete ? `Storico completo: ${esc(d.loaded)} osservazioni.` : `Caricate ${esc(d.loaded)} di ${esc(d.total)} osservazioni.`)}</ul><p class="sd-meta">Ultimo giro riuscito: ${esc(when(s.lastOk))}</p></section>
    <section class="sd-card"><h3>Dati mancanti</h3><p class="sd-meta">${esc(i.withMissing)} valutazioni con dati mancanti · ${esc(i.abstained)} astensioni</p>${missing}</section>
    <section class="sd-card"><h3>Partite escluse dalle metriche</h3><ul class="sd-rows"><li><span>Astensioni del modello</span><b>${esc(ex.abstained)}</b></li><li><span>Non ancora concluse</span><b>${esc(ex.notConcluded)}</b></li><li><span>Ritiri o walkover</span><b>${esc(ex.retiredOrWalkover)}</b></li><li><span>Rinviate o annullate</span><b>${esc(ex.cancelledOrPostponed)}</b></li><li><span>Senza valutazione iniziale</span><b>${esc(ex.noInitial)}</b></li></ul></section>
    <section class="sd-card"><h3>Anomalie e identificazione</h3><ul class="sd-checks">${li(i.backdated === 0, i.backdated === 0 ? "Nessuna versione registrata a partita iniziata." : `${esc(i.backdated)} versioni con registrazione non precedente all'inizio.`)}
      ${li(i.awaitingLate === 0, i.awaitingLate === 0 ? "Nessuna partita senza esito da oltre 24 ore." : `${esc(i.awaitingLate)} partite senza esito verificato da oltre 24 ore (non considerate concluse).`)}
      ${li(i.identity === 0, i.identity === 0 ? "Identificativi dei giocatori coerenti." : `${esc(i.identity)} incongruenze negli id dei giocatori: nessun collegamento al risultato.`)}</ul>
      <p class="sd-meta">${esc(i.rescheduled)} cambi di orario registrati dopo la prima valutazione.</p></section>`;
}

export function strategyHtml(dash, ui, { loading = false, error = null } = {}) {
  const intro = `<section class="intro"><p class="eyebrow">${icon("target")}Tennis · Analisi del modello</p><h1>Strategia</h1><p class="summary">Come si comporta il modello sulle partite osservate prima dell'inizio. Analisi statistica e controllo dei dati: nessuna indicazione di gioco.</p></section>`;
  if (error && !dash) return `${intro}<section class="sd-card"><h3>Impossibile leggere i dati</h3><p class="sd-p">${esc(error)}</p></section>`;
  if (!dash) return `${intro}<section class="sd-card"><p class="sd-p">${loading ? "Carico i dati…" : "Dati non ancora caricati."}</p></section>`;
  if (!dash.available) return `${intro}<section class="sd-card"><header><h3>Registro non attivo</h3>${chip("unavailable")}</header><p class="sd-p">${esc(dash.reason)}</p></section>`;
  const body = { overview: overviewHtml, tours: toursHtml, surfaces: surfacesHtml, calibration: calibrationHtml, integrity: integrityHtml }[ui.tab] ?? overviewHtml;
  const more = dash.complete ? "" : `<div class="sd-more"><p class="sd-meta">${loading ? "Carico lo storico…" : `Caricate ${esc(dash.loaded)} di ${esc(dash.total)} osservazioni: i numeri sono parziali.`}</p>${loading ? "" : `<button type="button" data-lo-all>Carica tutto lo storico</button>`}</div>`;
  return `${intro}${tabsHtml(ui.tab)}${more}${body(dash)}<p class="foot">Stime statistiche sperimentali, non garanzie né consigli finanziari. Nessuna giocata viene piazzata da Stay Live.</p>`;
}
