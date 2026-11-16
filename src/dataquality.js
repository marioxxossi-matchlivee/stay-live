/** Indicatori discreti di completezza dei dati (stessa logica per calcio e dettaglio), costruiti da `m.dq` (vedi functions/api/_completeness.js). */
export const DQ_LABEL = { complete: "Dati completi", waiting: "Quote in attesa", partial: "Analisi parziale", updating: "Aggiornamento in corso", error: "Analisi parziale" };
const PART_LABEL = { ok: "disponibili", waiting: "in coda", missing: "mancanti", na: "non previste", error: "errore" };
const PARTS = [["odds", "Quote"], ["predictions", "Predictions"], ["stats", "Statistiche"], ["corners", "Corner"]];

export const dqChipHtml = (dq, esc) => (dq ? `<span class="dq dq-${esc(dq.status)}" title="${esc(DQ_LABEL[dq.status] ?? "")}"><i aria-hidden="true"></i>${esc(DQ_LABEL[dq.status] ?? "")}</span>` : "");

/** Dettaglio espandibile: disponibili/mancanti per tipo, ultimo aggiornamento e prossimo tentativo previsto. */
export function dqDetailHtml(dq, { esc, updatedAt = null, time = (v) => String(v) } = {}) {
  if (!dq) return "";
  const rows = PARTS.map(([k, label]) => `<li class="dq-${esc(dq.parts[k])}"><span>${label}</span><b>${PART_LABEL[dq.parts[k]] ?? "—"}</b></li>`).join("");
  const last = updatedAt ? `<li><span>Ultimo aggiornamento</span><b>${esc(time(updatedAt))}</b></li>` : "";
  const next = dq.status !== "complete" && dq.nextTryAt ? `<li><span>Prossimo tentativo previsto</span><b>${esc(time(dq.nextTryAt))}</b></li>` : "";
  return `<details class="dq-det"><summary>Dati della partita</summary><ul class="dq-list">${rows}${last}${next}</ul></details>`;
}

/** Pulsante «salva i BET del giorno»: testo e stato dai conteggi (da salvare / già salvati). */
export function saveDayState(todo, done) {
  if (!todo && !done) return { hidden: true, disabled: true, label: "" };
  if (!todo) return { hidden: false, disabled: true, label: `✓ BET del giorno salvati (${done})` };
  return { hidden: false, disabled: false, label: `Salva i BET del giorno (${todo})` };
}
