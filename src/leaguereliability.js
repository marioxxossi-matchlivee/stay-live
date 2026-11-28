/**
 * Affidabilità per campionato e mercato (vista `league_market_reliability`, via /api/reliability-leagues).
 * Per ogni campionato: quante volte l'esito più probabile del mercato è uscito, con l'intervallo di Wilson al 95%.
 * La classifica usa il LIMITE INFERIORE dell'intervallo: un campionato con pochi casi non scavalca uno con molti casi solo per fortuna.
 */
import { wilson } from "./efficiency.js";

export const LR_MARKETS = [["dc", "Doppia chance"], ["1x2", "1X2"], ["ou15", "Over/Under 1,5"], ["ou25", "Over/Under 2,5"], ["ou35", "Over/Under 3,5"], ["gg", "Gol/NoGol"]];
const MIN_SHOWN = 10, MIN_SOLID = 30, TOP = 10;

export function leagueRows(rows, market) {
  return (rows ?? []).filter((r) => r.market === market && r.n >= MIN_SHOWN).map((r) => {
    const ci = wilson(r.won, r.n), ciQ = r.n_q ? wilson(r.won_q, r.n_q) : null;
    return { ...r, rate: r.won / r.n, ci, expected: Number(r.expected), rateQ: r.n_q ? r.won_q / r.n_q : null, ciQ };
  }).sort((a, b) => b.ci.lo - a.ci.lo || b.n - a.n);
}

export function leagueReliabilityHtml({ rows, market, error }, { esc, pct, leagueName }) {
  const head = `<h3>Campionati e mercati</h3>`;
  if (error) return `<section class="ef-card">${head}<p class="ef-empty">Non disponibile: ${esc(error)}</p></section>`;
  if (!rows) return `<section class="ef-card">${head}<p class="ef-empty">Calcolo in corso…</p></section>`;
  const tabs = LR_MARKETS.map(([k, l]) => `<button type="button" class="lr-tab" data-lr-market="${k}" aria-pressed="${k === market}">${esc(l)}</button>`).join("");
  const list = leagueRows(rows, market), total = (rows ?? []).filter((r) => r.market === market);
  const item = (r) => `<li><span class="ef-name">${esc(leagueName(r.league))}${r.n < MIN_SOLID ? ` <small class="ef-ci" title="Pochi casi: poco affidabile">⚠</small>` : ""}</span><span class="ef-bar" role="img" aria-label="${esc(pct(r.rate))}"><i style="width:${Math.round(r.rate * 100)}%"></i></span><span class="ef-val"><b>${esc(pct(r.rate))}</b><small>${r.won}/${r.n}${r.rateQ != null && r.n_q !== r.n ? ` · quota ≥ 1,20: ${esc(pct(r.rateQ))} su ${r.n_q}` : ""}</small></span></li>`;
  const sum = total.reduce((t, r) => ({ n: t.n + r.n, won: t.won + r.won }), { n: 0, won: 0 });
  const body = list.length
    ? `<ul class="ef-list">${list.slice(0, TOP).map(item).join("")}</ul>${list.length > TOP ? `<details class="lr-more"><summary>Altri ${list.length - TOP} campionati</summary><ul class="ef-list">${list.slice(TOP).map(item).join("")}</ul></details>` : ""}`
    : `<p class="ef-empty">Ancora nessun campionato con almeno ${MIN_SHOWN} partite per questo mercato.</p>`;
  return `<section class="ef-card lr-card">${head}<div class="lr-tabs" role="group" aria-label="Mercato">${tabs}</div>
    ${sum.n ? `<p class="ef-line">Tutti i campionati: <b>${esc(pct(sum.won / sum.n))}</b> (${sum.won}/${sum.n})</p>` : ""}${body}
    <p class="ef-foot">Esito più probabile di ogni mercato, registrato prima della partita. In ordine di affidabilità (limite inferiore dell'intervallo al 95%). ⚠ = meno di ${MIN_SOLID} partite: differenze di pochi punti sono rumore. Gli esiti con quota bassa escono spesso ma rendono poco.</p></section>`;
}

/**
 * Monta la scheda «Campionati e mercati» in un contenitore autonomo (scheda Affidabilità): carica i dati, gestisce i pulsanti dei mercati e si ricarica al massimo ogni 5 minuti.
 * `deps` = { esc, pct, leagueName }.
 */
export function mountLeagueReliability(host, deps) {
  const st = { rows: null, market: "dc", error: null, at: 0 };
  const paint = () => { host.innerHTML = leagueReliabilityHtml(st, deps); };
  host.addEventListener("click", (e) => { const b = e.target instanceof Element ? e.target.closest("[data-lr-market]") : null; if (b) { st.market = b.dataset.lrMarket; paint(); } });
  async function reload() {
    if (st.rows && Date.now() - st.at < 5 * 60e3) return;
    try {
      const res = await fetch("/api/reliability-leagues"), j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? `Errore ${res.status}`);
      st.rows = j.rows ?? []; st.error = null; st.at = Date.now();
    } catch (e) { st.error = e.message; }
    paint();
  }
  paint(); void reload();
  return { reload };
}
