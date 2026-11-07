/**
 * Efficienza dei pronostici: confronta ogni selezione salvata SOLO con il risultato finale (gol segnati e subiti).
 * Si conta la singola selezione (gamba), non la giocata: una selezione presente sia in una singola sia in una multipla conta una volta.
 * Funzioni pure e testabili; riusa legStatus/outcomeOf di plays.js (nessuna altra statistica).
 */
import { legStatus } from "./plays.js";

const MARKETS = {
  home: "Esito 1X2", draw: "Esito 1X2", away: "Esito 1X2",
  dc1x: "Doppia chance", dcx2: "Doppia chance", dc12: "Doppia chance",
  over15: "Over/Under", under15: "Over/Under", over25: "Over/Under", under25: "Over/Under", over35: "Over/Under", under35: "Over/Under",
  btts: "Gol / No Gol", nobtts: "Gol / No Gol",
};
const LABELS = {
  home: "1 · Vittoria casa", draw: "X · Pareggio", away: "2 · Vittoria trasferta", dc1x: "1X", dcx2: "X2", dc12: "12",
  over15: "Over 1,5", under15: "Under 1,5", over25: "Over 2,5", under25: "Under 2,5", over35: "Over 3,5", under35: "Under 3,5",
  btts: "Gol", nobtts: "No Gol",
};
export const marketOf = (key) => MARKETS[key] ?? null;

/** Selezioni uniche (partita + tipo) già giudicabili: { key, status: "won" | "lost", p } (p = probabilità prudente salvata, se c'è). */
export function settledLegs(plays, results = {}) {
  const seen = new Map();
  for (const play of plays) for (const leg of play.legs ?? []) {
    const id = `${leg.matchId}|${leg.key}`;
    if (seen.has(id) || !(leg.key in MARKETS)) continue;
    const status = legStatus(leg, results[leg.matchId]);
    if (status === "won" || status === "lost") seen.set(id, { key: leg.key, status, p: Number.isFinite(leg.pLow) ? leg.pLow : null });
  }
  return [...seen.values()];
}

const bucket = (legs) => {
  const won = legs.filter((l) => l.status === "won").length, n = legs.length;
  const withP = legs.filter((l) => l.p != null);
  return { n, won, lost: n - won, rate: n ? won / n : null, expected: withP.length ? withP.reduce((t, l) => t + l.p, 0) / withP.length : null };
};

/** { total, byMarket, byKey }: percentuale di successo complessiva e per tipologia. `expected` = media delle probabilità prudenti dichiarate al momento del pronostico. */
export function efficiency(plays, results = {}) {
  const legs = settledLegs(plays, results);
  const group = (fn, label) => {
    const m = new Map();
    for (const l of legs) { const k = fn(l); (m.get(k) ?? m.set(k, []).get(k)).push(l); }
    return [...m].map(([k, ls]) => ({ id: k, label: label(k), ...bucket(ls) })).sort((a, b) => b.n - a.n || a.label.localeCompare(b.label, "it"));
  };
  return { total: bucket(legs), byMarket: group((l) => MARKETS[l.key], (k) => k), byKey: group((l) => l.key, (k) => LABELS[k] ?? k) };
}

/** HTML della scheda "Efficienza" (valori già sicuri: solo numeri e etichette interne, ma passano comunque da esc). */
export function efficiencyHtml(eff, { esc, pct }) {
  const t = eff.total;
  if (!t.n) return `<section class="ef-card"><h3>Efficienza dei pronostici</h3><p class="ef-empty">Appena una partita salvata sarà finita vedrai qui la percentuale di successo.</p></section>`;
  const row = (r) => `<li><span class="ef-name">${esc(r.label)}</span><span class="ef-bar" role="img" aria-label="${esc(pct(r.rate))}"><i style="width:${Math.round(r.rate * 100)}%"></i></span><span class="ef-val"><b>${esc(pct(r.rate))}</b><small>${r.won}/${r.n}</small></span></li>`;
  const gap = t.expected != null ? t.rate - t.expected : null;
  return `<section class="ef-card"><h3>Efficienza dei pronostici</h3>
    <div class="ef-head"><b>${esc(pct(t.rate))}</b><span>${t.won} centrati su ${t.n} selezioni giocate${gap != null ? ` · attesa ${esc(pct(t.expected))}` : ""}</span></div>
    <h4>Per mercato</h4><ul class="ef-list">${eff.byMarket.map(row).join("")}</ul>
    <h4>Per tipo di pronostico</h4><ul class="ef-list">${eff.byKey.map(row).join("")}</ul>
    ${t.n < 30 ? `<p class="ef-note">Campione ancora piccolo (${t.n} selezioni): sotto le 30 le percentuali sono poco affidabili.</p>` : ""}</section>`;
}
