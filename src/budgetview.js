/** Dashboard crediti (sola lettura da /api/budget): consumo, esiti, code, completezza e previsione. HTML puro, senza dati tecnici superflui. */
const n = (x) => Number(x ?? 0).toLocaleString("it-IT");
export function budgetHtml(d, esc) {
  if (!d || d.error) return `<p class="set-hint">${esc(d?.error ?? "Dati non ancora disponibili.")}</p>`;
  const c = d.credits, o = d.outcomes ?? {}, q = d.queue ?? {}, comp = d.completeness;
  const rows = (map, top = 8) => Object.entries(map ?? {}).sort((a, b) => (b[1].requests ?? b[1]) - (a[1].requests ?? a[1])).slice(0, top)
    .map(([k, v]) => `<li><span>${esc(k)}</span><b>${n(v.requests ?? v)}${v.failed ? ` <small>· ${n(v.failed)} fallite</small>` : ""}</b></li>`).join("") || `<li><span>—</span><b>0</b></li>`;
  const frac = (b) => (b && b.total ? `${n(b.complete)} su ${n(b.total)}` : "—");
  return `<div class="bd">
    <div class="bd-grid">
      <div><b>${n(c.used)}</b><span>usati oggi (${c.pct ?? "—"}%)</span></div>
      <div><b>${n(c.remaining)}</b><span>residui</span></div>
      <div><b>${n(c.last24h)}</b><span>ultime 24 ore</span></div>
      <div class="${d.forecast?.withinLimit ? "" : "bad"}"><b>${n(d.forecast?.next24h)}</b><span>previsti nelle prossime 24 ore</span></div>
    </div>
    <h3>Per tipo di dato</h3><ul class="bd-list">${rows(d.byEndpoint)}</ul>
    <h3>Per processo</h3><ul class="bd-list">${rows(d.bySource)}</ul>
    <h3>Richieste</h3><ul class="bd-list">
      <li><span>Riuscite</span><b>${n(o.ok + o.empty)}</b></li><li><span>Fallite</span><b>${n(o.failed + o.rateLimited)}</b></li>
      <li><span>Duplicate evitate</span><b>${n(o.avoidedDuplicates)}</b></li><li><span>Risparmiate con la richiesta unica delle quote</span><b>${n(o.bundledSaved)}</b></li>
      <li><span>Bloccate dal budget</span><b>${n(o.blockedBudget)}</b></li></ul>
    <h3>Code</h3><ul class="bd-list"><li><span>Attività in coda</span><b>${n(q.open)}</b></li><li><span>In nuovo tentativo</span><b>${n(q.retrying)}</b></li><li><span>Sospese (oltre 3 tentativi)</span><b>${n(q.parked)}</b></li></ul>
    <h3>Completezza</h3><ul class="bd-list"><li><span>Partite di oggi complete</span><b>${frac(comp?.today)}</b></li><li><span>Partite di domani complete</span><b>${frac(comp?.tomorrow)}</b></li><li><span>Partite con quote mancanti</span><b>${comp ? n(comp.missingOdds) : "—"}</b></li></ul>
    ${d.ledgerReady ? "" : `<p class="set-hint">Il registro dettagliato si riempie dal prossimo giro automatico.</p>`}
  </div>`;
}
