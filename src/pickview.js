// Presentazione del consiglio nella card del calcio: etichetta breve e percentuali delle singole opzioni. Solo dati già presenti, mai calcolati qui.
import { esc, pct } from "./format.js";

const SHORT_PICK = { home: "1", draw: "X", away: "2", dc1x: "1X", dcx2: "X2", dc12: "12", btts: "Gol", nobtts: "No Gol" };

/** Esito breve (X2, 1, Over 2,5…): la descrizione estesa resta nel dettaglio partita. */
export const shortPick = (p) => SHORT_PICK[p.key] ?? String(p.label ?? "").split(" · ")[0];

/** «X 28% · 2 35%»: solo se il server fornisce `pick.parts` con probabilità numeriche. Altrimenti stringa vuota (nessun valore inventato). */
export function partsHtml(p) {
  const list = Array.isArray(p?.parts) ? p.parts.filter((x) => x && Number.isFinite(x.p)) : [];
  return list.length ? `<span class="pk-parts">${list.map((x) => `<span class="pk-part"><b>${esc(SHORT_PICK[x.key] ?? x.label ?? x.key)}</b> ${pct(x.p)}</span>`).join("")}</span>` : "";
}
