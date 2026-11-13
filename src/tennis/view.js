// Stay Live Tennis — HTML dell'interfaccia (stringhe pure, tutto passa da esc()).
import { esc, pct, num, fmtTime, dayKey, dayParts } from "../format.js";
import { surfaceOf, surfaceLabel, SURFACE_LABEL, categoryLabel, flag, CATEGORY_LABEL, DEFAULT_HISTORY_FILTERS, PERIODS, OUTCOMES, filterHistory } from "./board.js";
import { summarizeHistory } from "../../functions/api/_tennis-snapshot.js";

const timeOf = (iso) => fmtTime.format(new Date(iso));
const dateLabel = (iso) => { const d = dayParts(dayKey(iso)); return `${d.wd} ${d.dm}`; };
const rank = (r) => (Number.isFinite(Number(r)) && Number(r) > 0 ? `<i class="tn-rank" title="Ranking">#${Number(r)}</i>` : "");
const when = (iso) => new Date(iso).toLocaleString("it-IT", { timeZone: "Europe/Rome", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export const STATUS_LABEL = { scheduled: "In programma", live: "In corso", finished: "Conclusa", cancelled: "Annullata", unknown: "Esito non ricevuto", ended_other: "Conclusa (non regolare)", postponed: "Rinviata", interrupted: "Interrotta" };
const statusTag = (m) => `<span class="tn-status ${esc(m.status)}">${m.status === "live" ? "<b></b>" : ""}${esc(STATUS_LABEL[m.status] ?? STATUS_LABEL.unknown)}</span>`;
const surfTag = (m) => `<span class="tn-surf s-${surfaceOf(m) ?? "nd"}">${esc(surfaceLabel(m))}</span>`;

export const RELIABILITY_HINT = "Descrive la quantità di dati usati, non la probabilità di vincere.";
const relTag = (r) => (r ? `<span class="tn-rel r-${esc(r)}" title="${esc(RELIABILITY_HINT)}">Affidabilità ${esc(r)}</span>` : "");

const oddsText = (m) => (m.odds && (m.odds.p1 || m.odds.p2) ? `Quote ${num(m.odds.p1)} · ${num(m.odds.p2)}` : "");
const nameOf = (m, slot) => (slot === 1 ? m.p1.name : m.p2.name);

function pickBlock(m) {
  const p = m.prediction;
  if (!p) return `<div class="tn-pick none">In attesa di analisi</div>`;
  if (!p.published) return `<div class="tn-pick none"><b>Nessun pronostico</b><span>${esc(p.abstainReason ?? "Dati insufficienti.")}</span></div>`;
  const hit = m.status === "finished" && m.winner ? (p.pick === m.winner ? `<span class="tn-res ok">✓ Centrato</span>` : `<span class="tn-res ko">✗ Non centrato</span>`) : "";
  const prob = p.pick === 1 ? p.p1 : p.p2;
  return `<div class="tn-pick yes"><div class="tn-pick-head"><b>Pronostico ${p.pick}</b><span class="tn-pick-name">${esc(nameOf(m, p.pick))}</span><em>${pct(prob)}</em></div><div class="tn-pick-foot">${relTag(p.reliability)}${hit}</div></div>`;
}


const RESULT_TYPE_LABEL = (t) => (/walk|w\/o|wo\b/i.test(t ?? "") ? "walkover" : /retir/i.test(t ?? "") ? "ritiro" : t ? String(t) : "esito non regolare");
const nm = (p) => `${flag(p.country) ? `<span class="tn-flag" aria-hidden="true">${flag(p.country)}</span>` : ""}${esc(p.name)}`;
const catTag = (m) => `<span class="tn-cat c-${esc(m.category ?? "unknown")}">${esc(categoryLabel(m))}</span>`;
const betTag = (m) => (m.bet ? `<span class="tn-bet ${m.bet.verdict === "BET" ? "yes" : "no"}" title="${esc((m.bet.reasons ?? []).join(" "))}">${esc(m.bet.verdict)}</span>` : "");
const liveScore = (m) => (m.live?.sets?.length ? `<div class="tn-score live">${esc(m.live.sets.map(([a, b]) => `${a}-${b}`).join("  "))}${m.live.points ? ` <small>punti ${esc(m.live.points)}</small>` : ""}</div>` : m.status === "live" ? `<div class="tn-score live"><small>Punteggio non disponibile</small></div>` : "");

export function matchCardHtml(m) {
  const done = m.status === "finished";
  const score = done && m.score ? `<div class="tn-score">${esc(m.score)}</div>` : m.status === "ended_other" ? `<div class="tn-score"><small>${esc(RESULT_TYPE_LABEL(m.resultType))}${m.score ? ` · ${esc(m.score)}` : ""}</small></div>` : "";
  const win = (slot) => (done && m.winner === slot ? " win" : "");
  return `<button class="tn-card s-${surfaceOf(m) ?? "nd"}" type="button" data-key="${esc(m.key)}">
    <div class="tn-meta"><b>${esc(timeOf(m.startsAt))}</b><span>${esc(dateLabel(m.startsAt))}</span>${m.round ? `<span>${esc(m.round)}</span>` : ""}<span class="tn-grow"></span>${betTag(m)}${statusTag(m)}</div>
    <div class="tn-players"><div class="tn-pl${win(1)}"><span class="tn-n">${nm(m.p1)}</span>${rank(m.p1.rank)}</div><div class="tn-vs">contro</div><div class="tn-pl${win(2)}"><span class="tn-n">${nm(m.p2)}</span>${rank(m.p2.rank)}</div></div>
    ${liveScore(m)}${score}${pickBlock(m)}
    <div class="tn-foot">${surfTag(m)}${catTag(m)}<span class="tn-odds">${esc(oddsText(m))}</span></div>
  </button>`;
}

export function listHtml(groups) {
  return groups.map((g) => `<section class="tn-group"><h3 class="tn-gh"><span class="tn-tour">${esc(g.tour.toUpperCase())}</span>${esc(g.tournament)}<small>${esc(g.surface)}</small></h3><div class="tn-list">${g.matches.map(matchCardHtml).join("")}</div></section>`).join("");
}

/** Sezioni (In corso, Oggi, Prossimi giorni, Concluse): ognuna richiudibile, con il numero di partite. `groupFn` raggruppa per torneo. */
export function sectionsHtml(secs, groupFn, openIds = new Set(["live", "today", "upcoming"])) {
  return secs.map((sec) => `<details class="tn-sec" data-sec="${esc(sec.id)}"${openIds.has(sec.id) ? " open" : ""}><summary><b>${esc(sec.title)}</b><i>${sec.matches.length}</i></summary>${listHtml(groupFn(sec.matches))}</details>`).join("");
}

export function emptyHtml(kind, detail = "") {
  const text = {
    nodata: ["Nessun dato tennis disponibile", "I dati arriveranno dopo la prima sincronizzazione con il provider. Il calcio non è coinvolto."],
    filtered: ["Nessuna partita con questi filtri", "Prova a togliere qualche filtro."],
    error: ["Impossibile caricare il tennis", detail || "Riprova tra poco. Il calcio continua a funzionare."],
  }[kind];
  return `<div class="tn-empty"><div class="tn-ball" aria-hidden="true"></div><h2>${esc(text[0])}</h2><p>${esc(text[1])}</p></div>`;
}

const COMPONENT_LABELS = [
  ["eloDiff", "Differenza di rating (Elo)", (v) => (v > 0 ? "+" : "") + v],
  ["formAdj", "Correzione per la forma recente", (v) => (v > 0 ? "+" : "") + v],
  ["rankAdj", "Correzione per il ranking (solo con pochi dati)", (v) => (v > 0 ? "+" : "") + v],
  ["h2hAdj", "Correzione per gli scontri diretti", (v) => (v > 0 ? "+" : "") + num(v, 1)],
  ["fatigueAdj", "Correzione per il carico recente", (v) => (v > 0 ? "+" : "") + v],
  ["pElo", "Probabilità del giocatore 1 dal solo rating", (v) => pct(v, 1)],
  ["pPoint", "Probabilità del giocatore 1 da servizio e risposta", (v) => (v == null ? "non disponibile" : pct(v, 1))],
];

function statsRow(label, a, b, f) { return `<tr><th>${esc(label)}</th><td>${esc(a == null ? "—" : f(a))}</td><td>${esc(b == null ? "—" : f(b))}</td></tr>`; }


const sec = (title, body, open = false) => (body ? `<details class="tn-dsec"${open ? " open" : ""}><summary>${esc(title)}</summary><div class="tn-dbody">${body}</div></details>` : "");
const ago = (iso) => (iso ? when(iso) : "n.d.");

function betBlock(m) {
  const b = m.bet, o = m.odds;
  if (!b && !o) return `<p class="tn-note">Il provider non ha restituito quote per questa partita: senza quote non si calcolano EV né BET.</p>`;
  const rows = [];
  if (o) {
    rows.push(`<tr><th>Quota ${esc(m.p1.name)}</th><td>${esc(num(o.p1))}</td></tr><tr><th>Quota ${esc(m.p2.name)}</th><td>${esc(num(o.p2))}</td></tr>`);
    rows.push(`<tr><th>Fonte</th><td>${esc(o.source ?? "n.d.")}${o.sources?.length > 1 ? ` (+${o.sources.length - 1})` : ""}</td></tr><tr><th>Quote lette</th><td>${esc(ago(o.at))}</td></tr>`);
  }
  if (b?.odds != null) rows.push(`<tr><th>Quota del pronostico</th><td>${esc(num(b.odds))} (${esc(b.book ?? "")})</td></tr><tr><th>Probabilità implicita</th><td>${pct(b.rawImplied, 1)} (${pct(b.implied, 1)} senza margine)</td></tr>`);
  if (b?.ev != null) rows.push(`<tr><th>EV</th><td>${b.ev > 0 ? "+" : ""}${num(b.ev * 100, 1)}%</td></tr>`);
  const verdict = b ? `<div class="tn-verdict ${b.verdict === "BET" ? "bet" : "none"}"><b>${esc(b.verdict)}</b><span>${esc((b.reasons ?? []).join(" "))}</span></div>` : "";
  return `${verdict}${rows.length ? `<table class="tn-table"><tbody>${rows.join("")}</tbody></table>` : ""}<p class="tn-note">Solo quote pre-partita reali del provider; mai stimate. A partita iniziata non si usano.</p>`;
}

export function detailHtml(m) {
  const p = m.prediction;
  const s1 = m.stats?.p1, s2 = m.stats?.p2;
  const c = p?.components ?? {};
  const bar = p?.published ? `<div class="tn-bar" role="img" aria-label="Probabilità ${pct(p.p1)} contro ${pct(p.p2)}"><span class="a" style="width:${(p.p1 * 100).toFixed(1)}%">${pct(p.p1)}</span><span class="b" style="width:${(p.p2 * 100).toFixed(1)}%">${pct(p.p2)}</span></div>` : "";
  const reasons = p?.reasons?.length ? `<h4>Motivazioni</h4><ul class="tn-ul">${p.reasons.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : "";
  const missing = p?.missing?.length ? `<p class="tn-note"><b>Dati mancanti:</b> ${esc(p.missing.join(", "))}: il modello li ha ignorati, non inventati.</p>` : "";
  const comps = p ? `<table class="tn-table"><tbody>${COMPONENT_LABELS.filter(([k]) => k in c && c[k] != null).map(([k, l, f]) => `<tr><th>${esc(l)}</th><td colspan="2">${esc(f(c[k]))}</td></tr>`).join("")}${"n1" in c ? `<tr><th>Partite nello storico</th><td>${esc(c.n1)}</td><td>${esc(c.n2)}</td></tr>` : ""}</tbody></table>` : "";
  const stats = s1 || s2 ? `<table class="tn-table"><thead><tr><th></th><th>${esc(m.p1.name)}</th><th>${esc(m.p2.name)}</th></tr></thead><tbody>${statsRow("Punti vinti al servizio", s1?.serve, s2?.serve, (v) => pct(v, 1))}${statsRow("Punti vinti in risposta", s1?.ret, s2?.ret, (v) => pct(v, 1))}</tbody></table><p class="tn-note">Statistiche di carriera lette il ${esc(ago(s1?.fetchedAt ?? s2?.fetchedAt))} (valori di oggi, non storici).</p>` : `<p class="tn-note">Statistiche di servizio e risposta non disponibili per questi giocatori.</p>`;
  const h2h = m.h2h && (m.h2h.p1Wins || m.h2h.p2Wins) ? `<p class="tn-note">${esc(m.p1.name)} ${esc(m.h2h.p1Wins)} – ${esc(m.h2h.p2Wins)} ${esc(m.p2.name)}</p>` : `<p class="tn-note">Nessuno scontro diretto registrato dal provider.</p>`;
  const verdict = !p ? `<p class="tn-note">Il pronostico non è ancora stato calcolato.</p>` : p.published ? `<div class="tn-verdict"><b>Pronostico ${p.pick}: ${esc(nameOf(m, p.pick))}</b>${relTag(p.reliability)}</div>` : `<div class="tn-verdict none"><b>Nessun pronostico</b><span>${esc(p.abstainReason ?? "Dati insufficienti.")}</span></div>`;
  const pl = (x) => `<tr><th>${nm(x)}</th><td>${x.rank ? `#${esc(x.rank)}` : "n.d."}</td><td>${x.points != null ? esc(x.points) : "n.d."}</td><td>${x.seed ? esc(x.seed) : "—"}</td></tr>`;
  const players = `<table class="tn-table"><thead><tr><th>Giocatore</th><th>Ranking</th><th>Punti</th><th>Testa di serie</th></tr></thead><tbody>${pl(m.p1)}${pl(m.p2)}</tbody></table>`;
  const prov = m.provenance ? `<p class="tn-note">Fonte: SportsAPI365 (${esc(m.provenance.endpoint ?? "n.d.")}), letto il ${esc(ago(m.provenance.fetchedAt))}.</p>` : "";
  const live = m.status === "live" ? liveScore(m) : "";
  const final = (m.status === "finished" && m.score) || m.status === "ended_other" ? `<p class="tn-final"><b>${esc(m.score ?? RESULT_TYPE_LABEL(m.resultType))}</b>${m.status === "finished" && m.winner ? ` · ha vinto ${esc(nameOf(m, m.winner))}` : ` · ${esc(RESULT_TYPE_LABEL(m.resultType))}: non conta come vittoria regolare`}</p>` : "";
  return `<h2 class="tn-dt">${esc(m.p1.name)} <i>contro</i> ${esc(m.p2.name)}</h2>
    <p class="tn-ds">${esc(m.tour.toUpperCase())} · ${esc(categoryLabel(m))} · ${esc(m.tournament ?? "")}${m.round ? ` · ${esc(m.round)}` : ""} · ${esc(when(m.startsAt))}</p>
    <div class="tn-chips">${surfTag(m)}${statusTag(m)}${catTag(m)}${betTag(m)}${m.p1.rank || m.p2.rank ? `<span class="tn-chip">Ranking ${esc(m.p1.rank ?? "n.d.")} · ${esc(m.p2.rank ?? "n.d.")}</span>` : ""}</div>
    ${live}${final}${verdict}${bar}
    ${sec("Motivazioni e dati usati", `${reasons}${comps}${missing}`, true)}
    ${sec("Quote, EV e BET / EVITA", betBlock(m), true)}
    ${sec("Giocatori", players)}
    ${sec("Statistiche di servizio e risposta", stats)}
    ${sec("Scontri diretti", h2h)}
    ${sec("Provenienza dei dati", prov)}
    <p class="tn-disc">Stima statistica, non una garanzia di vittoria. ${p?.computedAt ? `Pronostico registrato il ${esc(when(p.computedAt))} (modello ${esc(p.modelVersion ?? "n.d.")}) e non modificato dopo l'inizio della partita.` : ""}</p>`;
}

// ───────── Storico e backtest ─────────
const row = (label, s) => `<tr><th>${esc(label)}</th><td>${esc(s.n)}</td><td>${pct(s.accuracy, 1)}</td><td>${num(s.brier, 3)}</td><td>${num(s.logLoss, 3)}</td></tr>`;
const groupTable = (title, obj, labelOf = (k) => k) => (obj && Object.keys(obj).length ? `<h4>${esc(title)}</h4><div class="tn-scroll"><table class="tn-table"><thead><tr><th></th><th>Partite</th><th>Esatti</th><th>Brier</th><th>Log loss</th></tr></thead><tbody>${Object.entries(obj).map(([k, v]) => row(labelOf(k), v)).join("")}</tbody></table></div>` : "");

export function historyHtml(h) {
  if (!h?.summary || !h.summary.n) return `<div class="tn-empty"><div class="tn-ball" aria-hidden="true"></div><h2>Storico non ancora disponibile</h2><p>Comparirà dopo le prime partite concluse con un pronostico registrato prima dell'inizio.${h?.abstained ? ` Finora il modello si è astenuto in ${esc(h.abstained)} partite.` : ""}</p></div>`;
  const s = h.summary;
  const bins = (s.calibration ?? []).filter((b) => b.n).map((b) => `<tr><th>${Math.round(b.from * 100)}–${Math.round(b.to * 100)}%</th><td>${b.n}</td><td>${pct(b.meanP, 1)}</td><td>${pct(b.hitRate, 1)}</td></tr>`).join("");
  const bet = h.bet?.n ? `<p class="tn-note">BET conclusi: ${esc(h.bet.n)} · centrati ${esc(h.bet.hits)} · ritorno medio per unità puntata ${h.bet.roi == null ? "n.d." : `${h.bet.roi > 0 ? "+" : ""}${num(h.bet.roi * 100, 1)}%`} (${esc(h.bet.verdict)}).</p>` : "";
  return `<div class="tn-kpis"><div><b>${s.n}</b><span>pronostici conclusi</span></div><div><b>${pct(s.accuracy, 1)}</b><span>esatti</span></div><div><b>${num(s.brier, 3)}</b><span>Brier</span></div><div><b>${num(s.logLoss, 3)}</b><span>Log loss</span></div></div>
    <p class="tn-note">${h.hits != null ? `Corretti ${esc(h.hits)} · errati ${esc(h.misses)}${h.pending ? ` · in attesa ${esc(h.pending)}` : ""}. ` : ""}${esc(h.verdict ?? "")}. Riferimenti: un lancio di moneta dà Brier 0,250 e log loss 0,693. Sotto le 300 partite i numeri non dimostrano nulla.</p>
    ${bet}${groupTable("Per superficie", h.bySurface, (k) => SURFACE_LABEL[k] ?? k)}${groupTable("ATP e WTA", h.byTour, (k) => k.toUpperCase())}${groupTable("Per categoria", h.byCategory, (k) => CATEGORY_LABEL[k] ?? k)}${groupTable("Per affidabilità", h.byReliability)}${groupTable("Per fascia di probabilità", h.byBand)}
    ${bins ? `<h4>Calibrazione</h4><div class="tn-scroll"><table class="tn-table"><thead><tr><th>Fascia</th><th>Partite</th><th>Dichiarata</th><th>Reale</th></tr></thead><tbody>${bins}</tbody></table></div><p class="tn-note">Se “Dichiarata” e “Reale” si somigliano, le probabilità sono ben tarate.</p>` : ""}
    ${h.abstained != null ? `<p class="tn-note">Partite in cui il modello si è astenuto: ${esc(h.abstained)}.</p>` : ""}`;
}

const chipRow = (attr, list, cur, label) => `<div class="tn-chips-row" role="group" aria-label="${esc(label)}">${list.map(([v, l]) => `<button type="button" ${attr}="${esc(v)}" aria-pressed="${cur === v}">${esc(l)}</button>`).join("")}</div>`;

function historyRowHtml(r) {
  const out = !r.published ? `<span class="tn-res na">Astenuto</span>` : r.hit === true ? `<span class="tn-res ok">✓ Centrato</span>` : r.hit === false ? `<span class="tn-res ko">✗ Errato</span>` : `<span class="tn-res na">In attesa</span>`;
  const pick = r.published ? `${esc(r.pick === 1 ? r.p1Name : r.p2Name)} ${pct(r.pick === 1 ? r.p1 : 1 - r.p1)}` : esc(r.abstainReason ?? "Dati insufficienti");
  return `<div class="tn-hrow"><div><b>${esc(r.p1Name ?? "?")} – ${esc(r.p2Name ?? "?")}</b><small>${esc(when(r.startsAt))} · ${esc(r.tournament ?? "")}${r.score ? ` · ${esc(r.score)}` : ""}</small><small>${r.published ? "Pronostico: " : "Motivo: "}${pick}${r.bet?.verdict === "BET" ? ` · BET` : ""}</small></div>${out}</div>`;
}

/** Storico interattivo: filtri periodo/categoria/circuito/esito, metriche ricalcolate sul filtro, elenco, backtest storico del modello. */
export function historyViewHtml(h, f = DEFAULT_HISTORY_FILTERS, now = Date.now()) {
  if (!h) return historyHtml(null);
  const rows = h.rows ?? [];
  const filtered = filterHistory(rows, f, now);
  const sum = summarizeHistory(filterHistory(rows, { ...f, outcome: "all" }, now));
  const cats = [["all", "Tutte"], ...Object.entries(CATEGORY_LABEL).filter(([k]) => rows.some((r) => r.category === k))];
  const filters = `${chipRow("data-hperiod", PERIODS, f.period, "Periodo")}${chipRow("data-hcat", cats, f.category, "Categoria")}${chipRow("data-htour", [["all", "ATP+WTA"], ["atp", "ATP"], ["wta", "WTA"]], f.tour, "Circuito")}${chipRow("data-hout", OUTCOMES, f.outcome, "Esito")}`;
  const list = filtered.length ? `<div class="tn-hlist">${filtered.slice(0, 200).map(historyRowHtml).join("")}</div>${filtered.length > 200 ? `<p class="tn-note">Mostrati i 200 più recenti su ${filtered.length}.</p>` : ""}` : `<div class="tn-empty"><div class="tn-ball" aria-hidden="true"></div><h2>Nessun pronostico con questi filtri</h2><p>Prova ad ampliare il periodo o a togliere un filtro.</p></div>`;
  const bt = h.backtest && h.backtest.published ? `<details class="tn-dsec"><summary>Backtest cronologico del modello (${esc(h.backtest.published)} partite)</summary><div class="tn-dbody"><p class="tn-note">Ogni partita è prevista con i soli dati precedenti (nessun look-ahead) sullo storico scaricato. Modello ${esc(h.backtest.modelVersion ?? "n.d.")}, calcolato il ${esc(when(h.backtest.at))}: ${esc(h.backtest.verdict)}. Astenuto in ${esc(h.backtest.abstained)} partite.</p><table class="tn-table"><tbody><tr><th>Esatti</th><td>${pct(h.backtest.summary?.accuracy, 1)}</td></tr><tr><th>Brier</th><td>${num(h.backtest.summary?.brier, 3)}</td></tr><tr><th>Log loss</th><td>${num(h.backtest.summary?.logLoss, 3)}</td></tr></tbody></table></div></details>` : `<p class="tn-note">Backtest cronologico non ancora disponibile (serve storico sufficiente: ${esc(h.backtest?.matches ?? 0)} partite scaricate finora).</p>`;
  return `<div class="tn-filters">${filters}</div>${historyHtml(sum)}<h4>Pronostici registrati (${filtered.length})</h4>${list}${bt}`;
}

// ───────── Diagnostica ─────────
const kv = (k, v) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`;
const dt = (iso) => (iso ? esc(when(iso)) : "mai");
const age = (min) => (min == null ? "" : min < 90 ? ` (${min} min fa)` : ` (${Math.round(min / 60)} h fa)`);
export function diagnosticsHtml(d, builtAt) {
  if (!d) return `<div class="tn-empty"><div class="tn-ball" aria-hidden="true"></div><h2>Diagnostica non disponibile</h2><p>Compare dopo la prima sincronizzazione.</p></div>`;
  const pr = d.provider ?? {}, q = pr.quota, c = d.counts ?? {}, jobs = d.jobs ?? {};
  const jobRow = (label, j) => kv(label, j ? `${j.lastOk ? `ultimo successo ${dt(j.lastOk)}${age(j.okAgeMin)}` : "nessun successo"}${j.lastError ? `<br><small class="tn-bad">Ultimo errore: ${esc(j.lastError)}</small>` : ""}` : "mai eseguito");
  const cats = Object.entries(c.byCategory ?? {}).map(([k, v]) => `${esc(CATEGORY_LABEL[k] ?? k)}: ${esc(v)}`).join(" · ") || "—";
  const errs = (d.errors ?? []).length ? `<ul class="tn-ul">${d.errors.map((e) => `<li><small>${dt(e.at)} · ${esc(e.job)}</small> ${esc(e.message)}</li>`).join("")}</ul>` : `<p class="tn-note">Nessun errore recente registrato.</p>`;
  return `<div class="tn-dg">
    <h4>Provider</h4><table class="tn-table"><tbody>${kv("Stato", esc(pr.status ?? "n.d."))}${kv("Provider", esc(pr.name ?? ""))}${kv("Ultima richiesta", dt(pr.lastRequestAt))}${kv("Ultima sincronizzazione riuscita", dt(pr.lastOkAt))}${kv("Quota residua", q?.remaining != null ? `${esc(q.remaining)} su ${esc(q.limit ?? "n.d.")}${q.resetAt ? `<br><small>rinnovo ${dt(q.resetAt)}</small>` : ""}` : "non ancora letta")}${kv("Richieste registrate oggi", esc(pr.requestsToday ?? 0))}</tbody></table>
    <h4>Aggiornamenti automatici</h4><table class="tn-table"><tbody>${jobRow("Live (ogni 15 min)", jobs.live)}${jobRow("Partite e pronostici (ogni 30 min)", jobs.refresh)}${jobRow("Ranking e statistiche (ogni giorno)", jobs.static)}${kv("Ultima snapshot", dt(d.snapshot?.builtAt ?? builtAt))}</tbody></table>
    <h4>Dati disponibili</h4><table class="tn-table"><tbody>${kv("Partite nella finestra", esc(c.matchesWindow ?? 0))}${kv("Per categoria", cats)}${kv("Uomini · Donne", `${esc(c.byTour?.atp ?? 0)} · ${esc(c.byTour?.wta ?? 0)}`)}${kv("Live · programmate · concluse", `${esc(c.live ?? 0)} · ${esc(c.scheduled ?? 0)} · ${esc(c.finished ?? 0)}`)}${kv("Con quote", esc(c.withOdds ?? 0))}${kv("Pronostici · astensioni · BET", `${esc(c.predictionsPublished ?? 0)} · ${esc(c.abstained ?? 0)} · ${esc(c.bet ?? 0)}`)}${kv("Giocatori noti", esc(c.players ?? "n.d."))}${kv("Con statistiche di servizio", esc(c.playersWithStats ?? "n.d."))}${kv("Ranking ATP · WTA", `${esc(c.rankedAtp ?? 0)} · ${esc(c.rankedWta ?? 0)}`)}</tbody></table>
    <h4>Errori recenti</h4>${errs}
    <h4>Limitazioni</h4><ul class="tn-ul">${(d.limits ?? []).map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
    <p class="tn-note">Nessuna credenziale è mostrata o inviata al browser: il provider si interroga solo dagli aggiornamenti automatici.</p></div>`;
}
