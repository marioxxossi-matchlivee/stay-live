import { esc, num, pct } from "./format.js";
import { icon } from "./icons.js";

/**
 * Blocco "calci d'angolo" della card di una partita: la STESSA funzione per preview, giocate salvate e multiple.
 * item = { home, away, status, corner, cornerActual }
 *   corner = { best, main, mainDetail, favorite } dalle quote di API-Football (mercato, NON il nostro modello)
 *   cornerActual = { home, away, total } corner reali a partita finita
 */
const teamOf = (side, item) => (side === "home" ? item.home : side === "away" ? item.away : "Equilibrio");

/** Esiti a partita finita: previsione del mercato confrontata con i corner reali. ok = true | false | null (non giudicabile). */
export function cornerVerdicts(corner, actual) {
  if (!actual || !Number.isFinite(actual.home) || !Number.isFinite(actual.away)) return [];
  const out = [], f = corner?.favorite, b = corner?.best, md = corner?.mainDetail;
  const total = actual.home + actual.away;
  if (f && f.side !== "even") {
    const more = actual.home === actual.away ? null : actual.home > actual.away ? "home" : "away";
    out.push({ kind: "favorite", ok: more === f.side, more, tie: more === null });
  }
  if (b) out.push({ kind: "best", ok: total === b.line ? null : (total > b.line) === (b.side === "over"), side: b.side, line: b.line, total });
  if (md && !(b && b.line === md.line)) out.push({ kind: "main", ok: null, line: md.line, side: total > md.line ? "over" : total < md.line ? "under" : null, total });
  return out;
}

/** Riga breve per testo/PDF: "Corner: più corner Inter 52% · Over 9,5 54%". Vuota se non c'è nulla. */
export function cornerShort(item) {
  const c = item.corner, parts = [];
  if (c?.favorite) parts.push(c.favorite.side === "even" ? "corner: nessuna favorita" : `più corner ${teamOf(c.favorite.side, item)} ${pct(c.favorite.p[c.favorite.side])}`);
  if (c?.best) parts.push(`${c.best.side === "over" ? "Over" : "Under"} ${num(c.best.line, 1)} corner ${pct(c.best.p)}`);
  const a = item.cornerActual;
  if (a) parts.push(`corner reali ${a.home}–${a.away}`);
  return parts.join(" · ");
}

const verdictText = (v, item, actual) => {
  const sym = v.ok === true ? "✓" : v.ok === false ? "✗" : "•";
  if (v.kind === "favorite") return `${sym} Favorita ${v.ok ? "rispettata" : "non rispettata"}: ${v.tie ? `pari nei corner (${actual.home}–${actual.away})` : `più corner ${teamOf(v.more, item)} (${Math.max(actual.home, actual.away)} contro ${Math.min(actual.home, actual.away)})`}`;
  if (v.kind === "best") return `${sym} ${v.side === "over" ? "Over" : "Under"} ${num(v.line, 1)}: ${v.ok === null ? "esattamente sulla linea, rimborso" : `${v.total} corner in totale, ${v.ok ? "previsione centrata" : "previsione sbagliata"}`}`;
  return `${sym} Linea principale ${num(v.line, 1)}: ${v.side ? `uscito ${v.side === "over" ? "Over" : "Under"}` : "esattamente sulla linea"} (${v.total} corner)`;
};

/** compact = una riga di sintesi (per le gambe delle multiple); altrimenti scheda completa con dettagli e, a fine partita, i corner reali. */
export function cornerHtml(item, { compact = false } = {}) {
  const c = item.corner, a = item.cornerActual, f = c?.favorite;
  if (!c && !a) return "";
  const verdicts = cornerVerdicts(c, a);
  if (compact) {
    const bits = [];
    if (f) bits.push(f.side === "even" ? "nessuna favorita" : `più corner: <b>${esc(teamOf(f.side, item))}</b> ${pct(f.p[f.side])}`);
    if (a) bits.push(`reali <b>${a.home}–${a.away}</b>${verdicts.length ? ` ${verdicts.map((v) => (v.ok === true ? "✓" : v.ok === false ? "✗" : "•")).join("")}` : ""}`);
    return bits.length ? `<small class="lg-corner">Corner · ${bits.join(" · ")}</small>` : "";
  }
  const rows = [];
  if (f) {
    const side = (k) => `<i class="${k}" style="width:${(f.p[k] * 100).toFixed(1)}%"></i>`;
    rows.push(`<p class="pc-fav ${f.side}">${f.side === "even" ? "<b>Nessuna favorita</b>: il mercato vede casa e trasferta alla pari" : `Più corner: <b>${esc(teamOf(f.side, item))}</b> ${pct(f.p[f.side])}`}</p>
      <span class="pc-bar" aria-hidden="true">${side("home")}${side("draw")}${side("away")}</span>
      <p class="pc-sub"><span>${esc(item.home)} ${pct(f.p.home)}</span><span>pari ${pct(f.p.draw)}</span><span>${esc(item.away)} ${pct(f.p.away)}</span></p>
      <p class="pc-sub">Quote mediane ${num(f.odds.home)} · ${num(f.odds.draw)} · ${num(f.odds.away)} (${f.books} ${f.books === 1 ? "bookmaker" : "bookmaker"}) · margine ${pct(f.margin, 1)}</p>`);
  }
  if (c?.mainDetail) {
    const d = c.mainDetail;
    rows.push(`<p class="pc-line">Totale, linea ${num(d.line, 1)}: Over <b>${pct(d.pOver)}</b> (quota ${num(d.over)}) · Under <b>${pct(d.pUnder)}</b> (quota ${num(d.under)})</p>`);
  }
  if (c?.best) rows.push(`<p class="pc-line">Lato più probabile: <b>${c.best.side === "over" ? "Over" : "Under"} ${num(c.best.line, 1)}</b> ${pct(c.best.p)} · quota ${num(c.best.odd)}</p>`);
  if (a) {
    rows.push(`<p class="pc-act">Corner reali: <b>${esc(item.home)} ${a.home} – ${a.away} ${esc(item.away)}</b> · totale ${a.total ?? a.home + a.away}</p>`);
    for (const v of verdicts) rows.push(`<p class="pc-v ${v.ok === true ? "ok" : v.ok === false ? "no" : ""}">${esc(verdictText(v, item, a))}</p>`);
    if (!c) rows.push(`<p class="pc-sub">Nessuna previsione corner salvata per questa partita.</p>`);
  } else if (item.status === "final") rows.push(`<p class="pc-sub">Corner reali non ancora disponibili: premi “Aggiorna risultati” tra poco.</p>`);
  return `<div class="pv-corner"><b class="pc-h">Calci d’angolo <small>quote dei bookmaker, non il nostro modello</small></b>${rows.join("")}</div>`;
}

/**
 * Barra compatta per la lista partite: chi è favorita a fare più corner (quote dei bookmaker) con la barra casa / pari / trasferta.
 * Stringa vuota se non ci sono dati corner (le quote si scaricano con "Cerca i corner").
 */
export function cornerBarHtml(item) {
  const f = item?.corner?.favorite;
  if (!f?.p) return "";
  const w = (k) => `<i class="${k}" style="width:${(Math.max(0, Math.min(1, f.p[k])) * 100).toFixed(1)}%"></i>`;
  const head = f.side === "even" ? `<b>Nessuna favorita</b> nei corner` : `Più corner: <b>${esc(teamOf(f.side, item))}</b> ${pct(f.p[f.side])}`;
  return `<span class="cb ${f.side}">${icon("flag")}<span class="cb-t">${head}</span><span class="pc-bar" aria-hidden="true">${w("home")}${w("draw")}${w("away")}</span><span class="cb-s"><span>${esc(item.home)} ${pct(f.p.home)}</span><span>pari ${pct(f.p.draw)}</span><span>${esc(item.away)} ${pct(f.p.away)}</span></span></span>`;
}
