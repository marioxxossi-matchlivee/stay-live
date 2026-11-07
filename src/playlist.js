/**
 * Elenco compatto delle giocate salvate: riga chiusa (squadre, scudetti, esito) + pannello a fisarmonica con tutti i dettagli.
 * Funzioni pure: restituiscono HTML (ogni valore dell'utente passa da esc()) e non toccano gli stati o i risultati delle giocate.
 */
import { crest } from "./ui.js";
import { dayKey, dayParts, esc } from "./format.js";

/** Etichette degli stati già calcolati da plays.js (won | lost | pending | void): nessuno stato nuovo. */
export const STATUS_LABEL = { won: "VINTA", lost: "PERSA", pending: "IN ATTESA", void: "ANNULLATA" };
const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${d}</svg>`;
const STATUS_ICON = {
  won: svg(`<path d="M20 6 9 17l-5-5"/>`),
  lost: svg(`<path d="M6 6l12 12M18 6 6 18"/>`),
  pending: svg(`<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>`),
  void: svg(`<path d="M5 12h14"/>`),
};
/** Esito: testo + icona (mai solo il colore). */
export const statusPill = (s) => `<span class="st-pill st-${esc(s)}">${STATUS_ICON[s] ?? ""}${STATUS_LABEL[s] ?? esc(String(s).toUpperCase())}</span>`;

const CHEVRON = `<svg class="acc-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m6 9 6 6 6-6"/></svg>`;
const domId = (id) => `acc-${String(id).replace(/[^\w-]/g, "_")}`;

/**
 * Fisarmonica accessibile: il pulsante è l'intera testata (aria-expanded), il pannello chiuso è `inert` (niente focus, niente lettori di schermo).
 * L'animazione è in CSS (grid-template-rows 0fr -> 1fr): l'altezza segue il contenuto, nessuna altezza fissa.
 */
export function accordionHtml({ id, open = false, head, body, cls = "", headCls = "" }) {
  const pid = domId(id);
  return `<div class="acc${cls ? ` ${cls}` : ""}${open ? " open" : ""}" data-acc="${esc(id)}"><button class="acc-head${headCls ? ` ${headCls}` : ""}" type="button" aria-expanded="${open ? "true" : "false"}" aria-controls="${pid}">${head}${CHEVRON}</button><div class="acc-panel" id="${pid}"${open ? "" : " inert"}><div class="acc-inner">${body}</div></div></div>`;
}

/** Testata di una giocata (riga chiusa): singola = due squadre con scudetto + esito; multipla = "Multipla · N gare" + scudetti + esito. */
export function playHeadHtml({ play, legs, status }) {
  const pill = `<span class="pl-end">${statusPill(status)}</span>`;
  if (play?.kind === "multiple" || legs.length !== 1) {
    const stack = legs.slice(0, 3).map((l) => crest(l.home, l.homeLogo, "crest sm")).join("");
    const more = legs.length > 3 ? `<i class="pl-more">+${legs.length - 3}</i>` : "";
    return `<span class="pl-multi"><b>Multipla · ${legs.length} ${legs.length === 1 ? "gara" : "gare"}</b><span class="pl-stack">${stack}${more}</span></span>${pill}`;
  }
  const l = legs[0];
  const team = (n, logo) => `<span class="pl-team">${crest(n, logo, "crest md")}<span>${esc(n)}</span></span>`;
  return `<span class="pl-teams">${team(l.home, l.homeLogo)}${team(l.away, l.awayLogo)}</span>${pill}`;
}

/** Calcio d'inizio più vicino della giocata (ISO); se manca, la data di salvataggio. */
export function kickoffOf({ play, legs }) {
  const ts = (legs ?? play.legs ?? []).map((l) => Date.parse(l.kickoffAt)).filter(Number.isFinite);
  if (ts.length) return new Date(Math.min(...ts)).toISOString();
  const saved = Date.parse(play?.savedAt);
  return new Date(Number.isFinite(saved) ? saved : 0).toISOString();
}

/** "Oggi" / "Ieri" / "Domani" oppure la data estesa. `key` e `today` sono chiavi giorno (YYYY-MM-DD, fuso Europe/Rome). */
export function dayLabel(key, today) {
  const diff = Math.round((Date.parse(`${key}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 864e5);
  if (diff === 0) return "Oggi";
  if (diff === -1) return "Ieri";
  if (diff === 1) return "Domani";
  const long = dayParts(key).long;
  return long.charAt(0).toUpperCase() + long.slice(1);
}

/** Raggruppa per giorno della partita: giorni dal più recente, dentro ogni giorno per orario. */
export function groupByDay(rows, today = dayKey(new Date().toISOString())) {
  const map = new Map();
  for (const r of rows) {
    const iso = kickoffOf(r), k = dayKey(iso);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push({ r, t: Date.parse(iso) });
  }
  return [...map.keys()].sort().reverse().map((k) => ({
    key: k, label: dayLabel(k, today),
    rows: map.get(k).sort((a, b) => a.t - b.t).map((x) => x.r),
  }));
}

/** Filtro per stato: all | pending (ancora da risolvere) | done (vinta, persa o annullata). */
export function filterRows(rows, f) {
  if (f === "pending") return rows.filter((r) => r.status === "pending");
  if (f === "done") return rows.filter((r) => r.status !== "pending");
  return rows;
}
