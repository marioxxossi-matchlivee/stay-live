// Stay Live Tennis — Strategy Center: HTML (stringhe pure, tutto passa da esc()). Nessun SVG disegnato a mano: solo icone della libreria e CSS.
import { icon } from "../icons.js";
import { esc, pct, num } from "../format.js";
import { RANGES, CLASSES, INDEPENDENCE_NOTE, romeDay } from "../../functions/api/_tennis-strategy.js";
import { STAKE_PROFILES } from "../../functions/api/_tennis-bankroll.js";
import { SURFACE_LABEL } from "./board.js";
import { TOURS, videoExample } from "./strategy.js";

const eur = (x) => new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(x ?? 0);
const evText = (ev) => (ev == null ? "—" : `${ev > 0 ? "+" : ""}${num(ev * 100, 1)}%`);
const whenIt = (iso) => new Date(iso).toLocaleString("it-IT", { timeZone: "Europe/Rome", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).replace(/\./g, "");
const surfText = (s) => SURFACE_LABEL[s] ?? "n.d.";
const tierClass = { value_high: "high", value_interesting: "mid", high_prob_bad_price: "price", no_value: "none", not_evaluable: "na" };
const chip = (cls) => `<span class="sc-tier t-${tierClass[cls]}">${esc(CLASSES[cls].label)}</span>`;
const ul = (items) => (items.length ? `<ul class="sc-ul">${items.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : "");
const tr = (k, v) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`;

// ───────── Controlli ─────────
export function controlsHtml(view) {
  const btn = (attr, val, label, cur) => `<button type="button" ${attr}="${esc(val)}" aria-pressed="${cur === val}">${esc(label)}</button>`;
  return `<div class="sc-ctl"><div class="tn-chips-row sc-range" role="group" aria-label="Periodo">${RANGES.map(([k, l]) => btn("data-srange", k, l, view.range)).join("")}</div>
    <div class="tn-seg2 sc-tours" role="group" aria-label="Circuito">${TOURS.map(([k, l]) => btn("data-stour", k, l, view.tour)).join("")}</div></div>`;
}

// ───────── Dashboard e piano ─────────
const DOUBLE_LABEL = { recommended: "Consigliata", not_preferred: "Valida, non preferibile", none: "Nessuna" };
export function dashboardHtml(s) {
  const d = s.dashboard, tile = (n, label, cls = "") => `<div class="sc-tile ${cls}"><b>${esc(n)}</b><span>${esc(label)}</span></div>`;
  return `<div class="sc-dash" role="group" aria-label="Riepilogo dell'analisi">
    ${tile(d.analyzed, "Partite analizzate")}${tile(d.evaluable, "Con dati sufficienti")}${tile(d.valueFound, "Value individuate", d.valueFound ? "good" : "")}
    ${tile(d.discarded, "Scartate")}${tile(d.notEvaluable, "Non valutabili")}${tile(d.singles, "Singole interessanti", d.singles ? "good" : "")}
    ${tile(DOUBLE_LABEL[d.double] ?? "—", "Doppia", d.double === "recommended" ? "good" : "")}</div>`;
}
export function planHtml(s) {
  const k = s.plan.kind, label = { none: "Nessuna giocata", single: "Una singola", singles: "Singole separate", double: "Doppia" }[k];
  return `<section class="sc-plan k-${esc(k)}" aria-label="Strategia preferibile"><span class="sc-plan-ic">${icon(k === "none" ? "prohibit" : "target")}</span><div><small>Strategia matematicamente preferibile</small><h2>${esc(label)}</h2><p>${esc(s.plan.text)}</p></div></section>`;
}
export function validationHtml(s) {
  const c = s.calibration;
  if (c.validated) return `<p class="sc-note ok">${icon("shield-check")}<span>Probabilità verificate: backtest cronologico su ${esc(c.sample)} partite pubblicate. ${esc(c.note)}</span></p>`;
  return `<p class="sc-note warn">${icon("warning")}<span><b>Campione in costruzione (${esc(c.sample)}/${esc(c.required)}).</b> Nessuna stima è presentata come validata: «Value elevato» non può essere assegnato.</span></p>`;
}

// ───────── Scheda singola ─────────
function checksHtml(s, th) {
  const ok = (cond, text) => `<li class="${cond ? "yes" : "no"}">${icon(cond ? "check" : "close")}<span>${esc(text)}</span></li>`;
  return `<ul class="sc-checks">${[
    ok(s.odds >= th.minOdds, `Quota ${num(s.odds)} ≥ ${num(th.minOdds)}`),
    ok(s.evUsed >= th.minEv, `EV ${evText(s.evUsed)} ≥ +${num(th.minEv * 100, 0)}%`),
    ok(Math.abs(s.p - s.market) <= th.maxModelGap, `Scarto dal mercato ${num(Math.abs(s.p - s.market) * 100, 1)} punti ≤ ${num(th.maxModelGap * 100, 0)}`),
    ok(s.oddsAgeMin * 60000 <= th.maxOddsAgeMin * 60000, `Quote lette ${s.oddsAgeMin} minuti fa (massimo ${th.maxOddsAgeMin})`),
    ok(s.reliability !== "bassa", `Affidabilità del modello ${s.reliability}`),
    ok(s.calibration.validated, s.calibration.validated ? "Probabilità validata dal backtest" : "Probabilità non ancora validata dal backtest"),
  ].join("")}</ul>`;
}

export function singleCardHtml(s, th, { open = false, rank = s.rank } = {}) {
  const fav = s.factors.filter((f) => f.favors), con = s.factors.filter((f) => !f.favors);
  const bars = `<div class="sc-cmp" aria-hidden="true"><div><i class="m" style="width:${(s.pUsed * 100).toFixed(1)}%"></i></div><div><i class="k" style="width:${(s.market * 100).toFixed(1)}%"></i></div></div>
    <div class="sc-cmp-l"><span><i class="m"></i>Modello ${pct(s.pUsed, 1)}</span><span><i class="k"></i>Mercato ${pct(s.market, 1)}</span></div>`;
  const detail = `<div class="sc-detail-in">
      <h4>Perché è in strategia</h4>${ul(s.reasons)}
      <h4>Confronto con il mercato</h4><table class="tn-table"><tbody>
        ${tr("Quota reale", `${esc(num(s.odds))} · ${esc(s.book)}`)}
        ${tr("Probabilità implicita (1/quota)", pct(s.implied, 1))}
        ${tr("Mercato senza margine", `${pct(s.market, 1)} · ${esc(s.marketBook)}`)}
        ${tr("Probabilità del modello", `${pct(s.p, 1)}${s.pUsed !== s.p ? ` → ${pct(s.pUsed, 1)} dopo la calibrazione` : ""}`)}
        ${tr("Quota equa del modello", esc(num(s.fairOdds)))}
        ${tr("Scarto modello − mercato", `${s.edge > 0 ? "+" : ""}${num(s.edge * 100, 1)} punti`)}
        ${tr("Expected Value", evText(s.evUsed))}
        ${tr("Quote lette", `${esc(s.oddsAgeMin)} minuti fa`)}</tbody></table>
      <h4>Controlli superati</h4>${checksHtml(s, th)}
      ${fav.length ? `<h4>Fattori favorevoli</h4><ul class="sc-ul pro">${fav.map((f) => `<li>${esc(f.label)} <b>${esc(f.value)}</b></li>`).join("")}</ul>` : ""}
      ${con.length ? `<h4>Fattori contrari</h4><ul class="sc-ul con">${con.map((f) => `<li>${esc(f.label)} <b>${esc(f.value)}</b></li>`).join("")}</ul>` : ""}
      ${s.criticalities.length ? `<h4>Criticità e dati mancanti</h4>${ul(s.criticalities)}` : ""}
      <button class="sc-link" type="button" data-key="${esc(s.key)}">Apri la partita ${icon("caret-right")}</button></div>`;
  return `<article class="sc-card t-${tierClass[s.cls]}${open ? " open" : ""}" data-sk="${esc(s.key)}">
    <header><span class="sc-rank">${esc(rank)}</span>${chip(s.cls)}${s.isUnderdog ? `<span class="sc-tag">Sfavorito</span>` : ""}<time>${esc(whenIt(s.startsAt))}</time></header>
    <p class="sc-ctx">${esc(s.tour.toUpperCase())} · ${esc(s.tournament ?? "Torneo n.d.")} · ${esc(surfText(s.surface))}</p>
    <h3 class="sc-pick"><small>Vince</small>${esc(s.name)}</h3><p class="sc-vs">${esc(s.p1Name)} – ${esc(s.p2Name)}</p>
    <dl class="sc-nums"><div><dt>Quota</dt><dd>${esc(num(s.odds))}<small>${esc(s.book)}</small></dd></div><div><dt>Modello</dt><dd>${pct(s.pUsed, 0)}</dd></div><div><dt>Implicita</dt><dd>${pct(s.implied, 1)}</dd></div><div><dt>EV</dt><dd class="ev">${esc(evText(s.evUsed))}</dd></div></dl>
    ${bars}
    <button class="sc-more" type="button" data-sx="${esc(s.key)}" aria-expanded="${open}"><span>Motivazioni e dati</span>${icon("caret-down")}</button>
    <div class="sc-detail"${open ? "" : " inert"}><div>${detail}</div></div></article>`;
}

export function singlesHtml(s, open) {
  if (!s.singles.length) return `<section class="sc-sec"><h2 class="sc-h">Graduatoria Value</h2><div class="sc-none">${icon("prohibit")}<div><b>Nessuna opportunità sufficientemente valida</b><p>${s.dashboard.analyzed ? `Analizzate ${esc(s.dashboard.analyzed)} partite: nessuna supera tutti i controlli di valore, affidabilità e qualità delle quote. Non giocare è una scelta valida.` : "Nessuna partita pre-match nel periodo scelto."}</p></div></div></section>`;
  const extra = s.singles.length - s.selected.length;
  return `<section class="sc-sec"><h2 class="sc-h">Graduatoria Value <i>${esc(s.singles.length)}</i></h2><div class="sc-list">${s.selected.map((x) => singleCardHtml(x, s.thresholds, { open: open.has(x.key) })).join("")}</div>${extra > 0 ? `<p class="sc-note">${icon("info")}<span>Altre ${esc(extra)} Value oltre il limite di ${esc(s.thresholds.maxSingles)} giocate della strategia: la selettività è voluta.</span></p>` : ""}</section>`;
}

// ───────── Doppia ─────────
export function doubleHtml(s, open) {
  const d = s.double;
  if (d.status === "none") return `<section class="sc-sec"><h2 class="sc-h">Doppia</h2><div class="sc-none dbl">${icon("prohibit")}<div><b>NESSUNA DOPPIA CONSIGLIATA</b><p>${esc(d.reason)}</p></div></div></section>`;
  const leg = (l, n) => `<li><span class="sc-leg-n">${n}</span><div><b>${esc(l.name)}</b><small>${esc(l.p1Name)} – ${esc(l.p2Name)} · ${esc(whenIt(l.startsAt))}</small></div><span class="sc-leg-o">${esc(num(l.odds))}<small>${pct(l.pUsed, 0)}</small></span></li>`;
  const cmp = `<table class="tn-table sc-cmp-t"><thead><tr><th>Struttura</th><th>EV</th><th>Rischio</th><th>EV/rischio</th></tr></thead><tbody>${d.comparison.map((r) => `<tr class="${r.id === d.preferred ? "win" : ""}"><th>${esc(r.label)}${r.id === d.preferred ? " ★" : ""}</th><td>${esc(evText(r.ev))}</td><td>${esc(num(r.sd, 2))}</td><td>${esc(num(r.ratio, 3))}</td></tr>`).join("")}</tbody></table>`;
  const rec = d.status === "recommended";
  const detail = `<div class="sc-detail-in"><h4>Perché</h4><p class="sc-p">${esc(d.verdict)}</p><h4>Confronto a parità di condizioni</h4>${cmp}
    <p class="sc-p small">Criterio: rendimento atteso per unità di rischio (EV diviso deviazione standard del profitto); le singole sono trattate come indipendenti. Non dipende dalla puntata.</p>
    <h4>Avvertenze sul rischio</h4>${ul([d.assumption, "Una doppia perde se anche una sola gamba perde: la probabilità di vincere è più bassa di quella di ciascuna gamba.", "Gli errori di stima delle due probabilità si moltiplicano.", ...(d.warnings ?? [])])}</div>`;
  return `<section class="sc-sec"><h2 class="sc-h">Doppia</h2><article class="sc-card dbl ${rec ? "t-high" : "t-price"}${open.has("double") ? " open" : ""}">
    <header>${rec ? `<span class="sc-tier t-high">DOPPIA CONSIGLIATA</span>` : `<span class="sc-tier t-price">VALIDA, NON PREFERIBILE</span>`}</header>
    <ul class="sc-legs">${leg(d.legs[0], 1)}${leg(d.legs[1], 2)}</ul>
    <dl class="sc-nums"><div><dt>Quota</dt><dd>${esc(num(d.totalOdds))}</dd></div><div><dt>Prob. congiunta</dt><dd>${pct(d.jointP, 1)}</dd></div><div><dt>EV</dt><dd class="ev">${esc(evText(d.evDouble))}</dd></div></dl>
    <p class="sc-verdict ${rec ? "ok" : ""}">${esc(d.verdict)}</p>
    <button class="sc-more" type="button" data-sx="double" aria-expanded="${open.has("double")}"><span>Spiegazione e rischi</span>${icon("caret-down")}</button>
    <div class="sc-detail"${open.has("double") ? "" : " inert"}><div>${detail}</div></div></article></section>`;
}

// ───────── Capitale ─────────
export function bankrollHtml(b) {
  const s = b.settings, ex = videoExample();
  const prof = STAKE_PROFILES.map((p) => `<button type="button" data-sprofile="${p.pct}" aria-pressed="${Math.abs(s.stakePct - p.pct) < 1e-9}" class="${p.aggressive ? "aggr" : ""}">${esc(p.label)}</button>`).join("");
  const field = (id, label, val, suffix, step = "0.1") => `<label class="sc-f"><span>${esc(label)}</span><span class="sc-in"><input id="${id}" type="number" inputmode="decimal" step="${step}" min="0" value="${esc(val)}">${suffix ? `<em>${suffix}</em>` : ""}</span></label>`;
  const slips = b.slips.length ? `<ul class="sc-slips">${b.slips.map((x) => `<li class="${x.blocked ? "blocked" : ""}"><div><b>${esc(x.label)}</b><small>${x.blocked ? esc(x.blocked) : `quota ${esc(num(x.odds))} · vince ${esc(eur(x.profitIfWin))} · ritorno ${esc(eur(x.potentialReturn))}`}</small></div><span>${x.blocked ? "—" : esc(eur(x.stake))}</span></li>`).join("")}</ul>` : `<p class="sc-p">Nessuna giocata nel piano: nessuna puntata teorica da impegnare.</p>`;
  const t = b.totals;
  return `<section class="sc-sec"><h2 class="sc-h">Capitale (simulazione)</h2><div class="sc-bank">
    <div class="sc-fields">${field("sc-bankroll", "Capitale disponibile", s.bankroll, "€", "1")}${field("sc-daily", "Limite giornaliero", +(s.dailyLimitPct * 100).toFixed(2), "%")}${field("sc-weekly", "Limite settimanale", +(s.weeklyLimitPct * 100).toFixed(2), "%")}</div>
    <div class="sc-prof" role="group" aria-label="Percentuale di puntata">${prof}</div>
    <div class="sc-fields one">${field("sc-stakepct", "Percentuale di puntata", +(s.stakePct * 100).toFixed(2), "%")}</div>
    <dl class="sc-nums b"><div><dt>Puntata teorica</dt><dd>${esc(eur(b.stake))}</dd></div><div><dt>Esposizione</dt><dd>${esc(eur(t.exposure))}<small>${esc(num(t.exposurePct, 1))}%</small></dd></div><div><dt>Se vincono tutte</dt><dd>${esc(eur(t.potentialProfit))}</dd></div><div><dt>EV atteso</dt><dd class="ev">${esc(eur(t.expectedValue))}</dd></div></dl>
    ${slips}${b.warnings.map((w) => `<p class="sc-note warn">${icon("warning")}<span>${esc(w)}</span></p>`).join("")}
    <p class="sc-note">${icon("info")}<span>Limiti: ${esc(eur(b.limits.dailyMax))} al giorno, ${esc(eur(b.limits.weeklyMax))} a settimana. ${esc(b.note)}</span></p>
    <details class="sc-ex"><summary>Esempio del video: puntata sul capitale corrente</summary><table class="tn-table"><thead><tr><th></th><th>Capitale</th><th>Puntata 5%</th></tr></thead><tbody>${ex.steps.map((x, i) => `<tr><th>${i === 0 ? "Inizio" : `Dopo ${i} ${i === 1 ? "perdita" : "perdite"}`}</th><td>${esc(eur(x.before))}</td><td>${esc(eur(x.stake))}</td></tr>`).join("")}</tbody></table><p class="sc-p small">Dopo una perdita la puntata scende: non si aumenta mai per recuperare. Il 5% è un profilo aggressivo, qui solo selezionabile; l'impostazione iniziale è l'1%.</p></details></div></section>`;
}

// ───────── Scartate e non valutabili ─────────
export function discardedHtml(s, open, showAll) {
  const rest = s.evaluations.filter((e) => e.cls !== "value_high" && e.cls !== "value_interesting");
  if (!rest.length) return "";
  // Ordine cronologico per orario italiano (Europe/Rome), con intestazione per giornata.
  const byTime = (a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt) || String(a.key).localeCompare(String(b.key));
  const groups = ["high_prob_bad_price", "no_value", "not_evaluable"].map((c) => [c, rest.filter((e) => e.cls === c).sort(byTime)]).filter(([, l]) => l.length);
  const dayHead = (e) => `<li class="sc-day" aria-hidden="true">${esc(new Date(e.startsAt).toLocaleDateString("it-IT", { timeZone: "Europe/Rome", weekday: "long", day: "numeric", month: "long" }))}</li>`;
  const LIMIT = 25;
  const item = (e) => {
    const sides = e.sides?.length ? `<table class="tn-table"><thead><tr><th></th><th>Modello</th><th>Quota</th><th>EV</th></tr></thead><tbody>${e.sides.map((x) => `<tr><th>${esc(x.name)}</th><td>${pct(x.p, 0)}</td><td>${x.odds ? esc(num(x.odds)) : "—"}</td><td>${x.evUsed != null ? esc(evText(x.evUsed)) : "—"}</td></tr>`).join("")}</tbody></table>` : "";
    return `<li class="sc-d${open.has(`d:${e.key}`) ? " open" : ""}"><button type="button" data-sx="d:${esc(e.key)}" aria-expanded="${open.has(`d:${e.key}`)}"><span><b>${esc(e.p1.name)} – ${esc(e.p2.name)}</b><small>${esc(e.tour.toUpperCase())} · ${esc(whenIt(e.startsAt))} · ${esc(e.reasons[0] ?? "")}</small></span>${icon("caret-down")}</button><div class="sc-detail"${open.has(`d:${e.key}`) ? "" : " inert"}><div><div class="sc-detail-in">${ul(e.reasons)}${sides}${ul(e.notes.slice(0, 4))}</div></div></div></li>`;
  };
  let shown = 0;
  const body = groups.map(([c, list]) => { const take = showAll ? list : list.slice(0, Math.max(0, LIMIT - shown)); shown += take.length; return take.length ? `<h3 class="sc-gh">${esc(CLASSES[c].label)} <i>${list.length}</i></h3><ul class="sc-dl">${take.map((e, i) => (i === 0 || romeDay(Date.parse(e.startsAt)) !== romeDay(Date.parse(take[i - 1].startsAt)) ? dayHead(e) : "") + item(e)).join("")}</ul>` : ""; }).join("");
  return `<section class="sc-sec"><h2 class="sc-h">Perché le altre sono state scartate <i>${rest.length}</i></h2>${body}${!showAll && rest.length > LIMIT ? `<button class="sc-link" type="button" data-sall="1">Mostra tutte le ${esc(rest.length)} ${icon("caret-down")}</button>` : ""}</section>`;
}

// ───────── Storico ─────────
const STATE_LABEL = { won: "Vinta", lost: "Persa", pending: "In attesa", void: "Non conteggiata", invalid: "Non valida" };
function blockHtml(title, b) {
  const kv = (k, v) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`;
  return `<div class="sc-hb"><h3>${esc(title)}</h3><dl class="sc-nums b">${kv("Registrate", esc(b.registered))}${kv("Concluse", esc(b.settled))}${kv("Successo", b.hitRate == null ? "—" : pct(b.hitRate, 0))}${kv("ROI", `<span class="ev">${b.roi == null ? "—" : esc(evText(b.roi))}</span>`)}${kv("Profitto", b.settled ? `${b.profit > 0 ? "+" : ""}${esc(num(b.profit, 2))} u.` : "—")}${kv("Brier · Log Loss", b.brier == null ? "—" : `${esc(num(b.brier, 3))} · ${esc(num(b.logLoss, 3))}`)}</dl><p class="sc-note ${b.settled >= 300 ? "" : "warn"}">${icon("info")}<span>${esc(b.verdict)}</span></p></div>`;
}
export function historyHtml(h) {
  if (!h) return `<section class="sc-sec"><h2 class="sc-h">Storico e backtest della strategia</h2><p class="sc-note warn">${icon("warning")}<span>Tracciamento non ancora attivo: compare dopo la migrazione del database e il primo aggiornamento automatico.</span></p></section>`;
  if (h.unavailable) return `<section class="sc-sec"><h2 class="sc-h">Storico e backtest della strategia</h2><p class="sc-note warn">${icon("warning")}<span>Storico non disponibile al momento. Se le tabelle non esistono ancora, eseguire la migrazione SQL del Strategy Center.</span></p></section>`;
  const segs = (title, o) => { const e = Object.entries(o ?? {}).filter(([, v]) => v.settled); return e.length ? `<div class="sc-seg"><h4>${esc(title)}</h4><ul>${e.map(([k, v]) => `<li><b>${esc(SURFACE_LABEL[k] ?? String(k).toUpperCase())}</b><span>${esc(v.settled)} concluse</span><em class="ev">${esc(evText(v.roi))}</em></li>`).join("")}</ul></div>` : ""; };
  const bins = (h.singles.calibration ?? []).filter((x) => x.n).map((x) => `<tr><th>${Math.round(x.from * 100)}–${Math.round(x.to * 100)}%</th><td>${esc(x.n)}</td><td>${pct(x.meanP, 0)}</td><td>${pct(x.hitRate, 0)}</td></tr>`).join("");
  const rows = h.singleRows.slice(0, 8).map((r) => `<li class="st-${esc(r.state)}"><div><b>${esc(r.name)}</b><small>${esc(r.p1Name)} – ${esc(r.p2Name)} · quota ${esc(num(r.odds))} · ${esc(whenIt(r.startsAt))}</small></div><span>${esc(STATE_LABEL[r.state] ?? r.state)}</span></li>`).join("");
  return `<section class="sc-sec"><h2 class="sc-h">Storico e backtest della strategia</h2>
    <p class="sc-p small">${esc(h.note)} Il tracciamento è prospettico: il campione cresce con le partite concluse.</p>
    ${blockHtml("Singole", h.singles)}${blockHtml("Doppie", h.doubles)}
    <div class="sc-segs">${segs("Per circuito", h.singles.byTour)}${segs("Per superficie", h.singles.bySurface)}${segs("Favorito / sfavorito", h.singles.byRole)}</div>
    ${bins ? `<h4 class="sc-h4">Calibrazione per fasce di probabilità (singole concluse)</h4><table class="tn-table"><thead><tr><th>Fascia</th><th>Casi</th><th>Dichiarata</th><th>Reale</th></tr></thead><tbody>${bins}</tbody></table>` : ""}
    ${rows ? `<h4 class="sc-h4">Ultime giocate registrate</h4><ul class="sc-hist">${rows}</ul>` : ""}</section>`;
}

// ───────── Pagina ─────────
export function strategyHtml(model, ui, { history = null, hasData = true } = {}) {
  const { view, strategy: s, bankroll } = model;
  const intro = `<section class="intro"><p class="eyebrow">${icon("target")}Tennis · Value Betting</p><h1>Tennis Strategy Center</h1><p class="summary">Analizza l'intero programma ATP e WTA, confronta la probabilità del modello con la quota reale e propone solo ciò che ha valore. Meno giocate, scelte meglio.</p></section>`;
  if (!hasData) return `${intro}<div class="sc-none">${icon("database")}<div><b>Nessun dato tennis disponibile</b><p>Il Strategy Center usa la snapshot del tennis: comparirà dopo la prima sincronizzazione.</p></div></div>`;
  return `${intro}${controlsHtml(view)}${dashboardHtml(s)}${planHtml(s)}${validationHtml(s)}${singlesHtml(s, ui.open)}${doubleHtml(s, ui.open)}${bankrollHtml(bankroll)}${discardedHtml(s, ui.open, ui.showAll)}${historyHtml(history)}
    <p class="foot">Stime statistiche sperimentali: non sono garanzie né consigli finanziari. Nessuna giocata viene piazzata da Stay Live. ${esc(INDEPENDENCE_NOTE)}</p>`;
}
