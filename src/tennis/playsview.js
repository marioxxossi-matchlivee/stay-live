// Stay Live Tennis — vista «Giocate» (stesso aspetto di quella del calcio) e «Impostazioni». Solo HTML: funzioni pure.
import { icon } from "../icons.js";
import { esc, pct, num, eur, dayKey, fmtTime, dayParts } from "../format.js";
import { crest } from "../ui.js";
import { accordionHtml, statusPill, groupByDay, filterRows } from "../playlist.js";
import { diagnosticsHtml } from "./view.js";
import { betSummaryHtml, statOf } from "./monitor.js";
import { groupCard } from "../monitor-view.js";

export const PL_FILTERS = [["all", "Tutte"], ["pending", "In attesa"], ["done", "Concluse"]];
const when = (iso) => `${dayParts(dayKey(iso)).dm} ${fmtTime.format(new Date(iso))}`;
const pickName = (p) => (p.pick === 1 ? p.p1.name : p.p2.name);

const headHtml = (r) => {
  const team = (x) => `<span class="pl-team">${crest(x.name, null, "crest md")}<span>${esc(x.name)}</span></span>`;
  return `<span class="pl-teams">${team(r.play.p1)}${team(r.play.p2)}</span><span class="pl-end">${statusPill(r.status)}</span>`;
};

function bodyHtml(r) {
  const p = r.play;
  const res = r.score ? `<p class="pl-foot">Risultato <b>${esc(r.score)}</b></p>` : r.status === "void" ? `<p class="pl-foot">Partita non conclusa regolarmente: la giocata non conta.</p>` : "";
  const line = `<p class="pl-foot">Pronostico <b>${esc(pickName(p))}</b> · ${pct(p.prob)}${p.odds ? ` · quota ${num(p.odds)}` : " · quota reale non disponibile"}${p.verdict ? ` · ${esc(p.verdict)}` : ""}</p>`;
  const gain = r.profit != null ? ` · a 1 € <b class="${r.profit >= 0 ? "pl-gain" : "pl-loss"}">${r.profit >= 0 ? "+" : ""}${eur(r.profit)}</b>` : "";
  return `<div class="pl-pane"><p class="pl-foot"><b>${esc(p.tournament ?? "")}</b>${p.tournament ? " · " : ""}${esc(when(p.startsAt))}</p>${line}${res}<p class="pl-foot">Salvata ${esc(when(p.savedAt))}${gain}</p>
    <span class="pv-btns"><button class="link" type="button" data-key="${esc(p.matchKey)}">Scheda partita</button><button class="link danger" type="button" data-del-play="${esc(p.id)}">Elimina</button></span></div>`;
}

const itemHtml = (r, open) => accordionHtml({ id: `p:${r.play.id}`, open: open.has(`p:${r.play.id}`), cls: `pl st-${r.status}`, headCls: "pl-head", head: headHtml(r), body: bodyHtml(r) });

export function listHtml(rows, filter, open) {
  if (!rows.length) return `<div class="empty"><p>Nessuna giocata salvata. Salvale dal segnalibro nella lista delle partite o dalla scheda: a partita finita le troverai qui, confrontate con il risultato.</p><button class="primary" type="button" data-goto="matches">Vai alle partite</button></div>`;
  const shown = filterRows(rows.map((r) => ({ ...r, legs: [{ kickoffAt: r.play.startsAt }] })), filter);
  if (!shown.length) return `<p class="empty">${filter === "pending" ? "Nessuna giocata in attesa." : "Nessuna giocata conclusa."}</p>`;
  return groupByDay(shown).map((g) => `<section class="pl-day"><h3 class="grp">${esc(g.label)}</h3>${g.rows.map((r) => itemHtml(r, open)).join("")}</section>`).join("");
}

export function playsViewHtml(ev, { filter = "all", open = new Set(), history = null } = {}) {
  const t = ev.total, has = ev.rows.length;
  const tile = (k, v, cls = "") => `<div class="${cls}"><small>${k}</small><b>${v}</b></div>`;
  const strip = has ? `<div class="pl-sum pl-strip">${tile("Centrate", t.won + t.lost ? `${t.won} su ${t.won + t.lost}${t.rate != null ? ` · ${pct(t.rate)}` : ""}` : "—", t.won + t.lost && t.rate >= 0.5 ? "good" : "")}${tile("In attesa", String(t.pending))}${tile("Con 1 € a giocata", t.priced ? eur(t.profit) : "—", t.priced ? (t.profit >= 0 ? "good" : "bad") : "")}</div>` : "";
  const seg = has ? `<div class="seg" id="tn-pl-seg" role="group" aria-label="Filtro giocate" style="--i:${PL_FILTERS.findIndex(([k]) => k === filter)}">${PL_FILTERS.map(([k, l]) => `<button type="button" data-plf="${k}" aria-pressed="${filter === k}">${l}</button>`).join("")}</div>` : "";
  const settled = ev.rows.filter((r) => r.status === "won" || r.status === "lost").map((r) => ({ hit: r.status === "won", pick: r.play.pick, p1: r.play.pick === 1 ? r.play.prob : 1 - r.play.prob, bet: r.play.odds ? { odds: r.play.odds } : null }));
  const mine = settled.length ? groupCard("Le tue giocate salvate", statOf(settled), { min: 30 }) : `<section class="mn-card"><h3>Le tue giocate salvate</h3><p class="mn-empty">Appena una partita salvata sarà finita vedrai qui la percentuale di successo.</p></section>`;
  const stats = accordionHtml({ id: "stats", open: open.has("stats"), cls: "stats-acc", headCls: "stats-head",
    head: `<span class="stats-t"><b>Statistiche e affidabilità</b><small>Efficienza dei pronostici e dei BET dell'app</small></span>`,
    body: `<div class="pl-pane">${betSummaryHtml(history)}${mine}</div>` });
  return `<h2 class="d-title">Le mie giocate</h2>${strip}${seg}<div class="pl-list${ev.rows.length > 40 ? " long" : ""}" id="tn-pl-list">${listHtml(ev.rows, filter, open)}</div>${stats}
    <p class="foot">Le giocate restano salvate in questo dispositivo. Si aggiornano da sole con i risultati del tabellone: se una partita finita risulta ancora «in attesa», riprova tra qualche minuto.</p>`;
}

/** Impostazioni: stato dei dati in breve, dettagli tecnici richiudibili, giocate salvate. */
export function settingsHtml(d, builtAt, playsCount) {
  const stamp = (iso) => (iso ? new Date(iso).toLocaleString("it-IT", { timeZone: "Europe/Rome", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "mai");
  const pr = d?.provider ?? {}, c = d?.counts ?? {};
  const row = (k, v) => `<div class="set-row"><span><b>${esc(k)}</b><small>${v}</small></span></div>`;
  const status = d ? `${row("Provider", esc(pr.status ?? "n.d."))}${row("Ultimo aggiornamento", esc(stamp(pr.lastOkAt ?? builtAt)))}${row("Partite nel tabellone", `${esc(c.matchesWindow ?? 0)} · con pronostico ${esc(c.predictionsPublished ?? 0)} · BET ${esc(c.bet ?? 0)}`)}<details class="st-more"><summary>Dettagli tecnici</summary>${diagnosticsHtml(d, builtAt)}</details>` : `<p class="set-hint">Compare dopo la prima sincronizzazione.</p>`;
  return `<p class="eyebrow">${icon("gear")}Preferenze</p><h1 class="vtitle">Impostazioni</h1>
    <div class="set-group"><h2>Stato dei dati</h2>${status}</div>
    <div class="set-group"><h2>Giocate salvate</h2><button class="set-btn danger" id="tn-clear-plays" type="button"${playsCount ? "" : " disabled"}>${icon("trash")}Elimina tutte le giocate salvate</button><p class="set-hint">Le giocate stanno solo in questo dispositivo (${playsCount}).</p></div>
    <p class="foot">Stay Live · stime statistiche sperimentali. Non sono garanzie né consigli finanziari.</p>`;
}
