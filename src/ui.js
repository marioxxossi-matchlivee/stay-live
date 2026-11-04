/** Pezzi di interfaccia condivisi (scudetti, intestazione partita). Funzioni pure: restituiscono HTML, ogni valore passa da esc(). */
import { esc } from "./format.js";

export const initials = (n) => {
  const w = String(n ?? "").split(/[\s.\-]+/).filter(Boolean);
  return esc((w.length > 1 ? w[0][0] + w[1][0] : (w[0] ?? "").slice(0, 3)).toUpperCase());
};

/** Scudetto: le iniziali sono sempre presenti, il logo (solo https) ci si sovrappone; se non si carica resta la sigla. */
export const crest = (name, logo, cls = "crest") =>
  `<span class="${cls}"><em>${initials(name)}</em>${/^https:\/\//.test(String(logo ?? "")) ? `<img src="${esc(logo)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ""}</span>`;

/** Logo che non si carica: si toglie e restano le iniziali (da chiamare una volta sola all'avvio). */
export function hideBrokenCrests(doc = document) {
  doc.addEventListener("error", (e) => { if (e.target?.tagName === "IMG" && e.target.closest?.(".crest,.af-crest")) e.target.remove(); }, true);
}

/** Intestazione scura con i due scudetti (stessa della scheda "Dati API-Football"). `centre` = punteggio o orario gia' in HTML. */
export function matchHeader({ home, away, homeLogo, awayLogo, chips = [], centre, sub = "" }) {
  return `<header class="af-hero">
    <div class="af-hero-top">${chips.filter(Boolean).map((x) => `<span class="af-chip">${esc(x)}</span>`).join("")}</div>
    <div class="af-versus">
      <div class="af-team">${crest(home, homeLogo, "af-crest")}<b>${esc(home)}</b></div>
      <div class="af-centre">${centre}${sub ? `<small>${esc(sub)}</small>` : ""}</div>
      <div class="af-team">${crest(away, awayLogo, "af-crest")}<b>${esc(away)}</b></div>
    </div>
  </header>`;
}
