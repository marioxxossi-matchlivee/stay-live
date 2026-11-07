import { calibrationBuckets, efficiencyFromLegs, knownKey } from "../../src/efficiency.js";
import { outcomeOf } from "../../src/plays.js";

const BASIS = { storico: "Solo storico", api: "Storico + API-Football", mercato: "Storico + quote", "api+mercato": "Storico + API + quote" };

/**
 * Affidabilità dei BET registrati: confronta la selezione salvata PRIMA della partita con il punteggio finale (solo gol).
 * rows = righe della vista `prediction_results`. Vengono contati solo i BET della versione del modello indicata (`ver`, null = tutte).
 */
export function reliabilityFrom(rows, { ver = null } = {}) {
  const bets = rows.filter((r) => r.verdict === "BET" && knownKey(r.sel_key));
  const used = ver ? bets.filter((r) => r.model_ver === ver) : bets;
  const legs = [], pendingRows = [];
  for (const r of used) {
    const final = r.status === "final" && !["extra_time", "penalties"].includes(r.decided_in ?? "");
    const ok = final ? outcomeOf(r.sel_key, r.home_score, r.away_score) : null;
    if (ok == null) { if (r.status !== "canceled" && !(r.status === "final")) pendingRows.push(r); continue; }
    legs.push({ key: r.sel_key, status: ok ? "won" : "lost", p: r.p, pLow: r.p_low, odds: r.odds, basis: r.basis, kickoff: r.kickoff_at });
  }
  const eff = efficiencyFromLegs(legs);
  const basisMap = new Map();
  for (const l of legs) (basisMap.get(l.basis) ?? basisMap.set(l.basis, []).get(l.basis)).push(l);
  const byBasis = [...basisMap].map(([k, ls]) => ({ id: k, label: BASIS[k] ?? k ?? "—", ...efficiencyFromLegs(ls).total })).sort((a, b) => b.n - a.n);
  const first = legs.map((l) => l.kickoff).sort()[0];
  return {
    ...eff, byBasis, calibration: calibrationBuckets(legs), pending: pendingRows.length, olderVersions: bets.length - used.length,
    since: first ? first.slice(0, 10).split("-").reverse().join("/") : null,
  };
}
