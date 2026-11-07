/**
 * Efficienza dei pronostici: confronta ogni selezione SOLO con il risultato finale (gol segnati e subiti).
 * Si conta la singola selezione (gamba), non la giocata. Funzioni pure e testabili, usate sia dal browser (giocate salvate)
 * sia dal server (tutti i BET registrati su Supabase: functions/api/_reliability.js).
 *  - `expected` = media della probabilità CENTRALE `p` dichiarata prima della partita: è il numero da confrontare con la percentuale reale (taratura).
 *  - `floor`    = media della probabilità PRUDENTE `pLow`: è volutamente pessimistica, la percentuale reale dovrebbe superarla quasi sempre.
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
export const knownKey = (key) => key in MARKETS;
const mean = (xs) => (xs.length ? xs.reduce((t, x) => t + x, 0) / xs.length : null);

/** Intervallo di Wilson al 95% della percentuale di successo: dice quanto fidarsi di un campione piccolo. */
export function wilson(won, n, z = 1.96) {
  if (!n) return null;
  const ph = won / n, d = 1 + z * z / n, c = ph + z * z / (2 * n), m = z * Math.sqrt(ph * (1 - ph) / n + z * z / (4 * n * n));
  return { lo: Math.max(0, (c - m) / d), hi: Math.min(1, (c + m) / d) };
}

/** Selezioni uniche (partita + tipo) già giudicabili: { key, status: "won" | "lost", p, pLow, odds }. */
export function settledLegs(plays, results = {}) {
  const seen = new Map();
  for (const play of plays) for (const leg of play.legs ?? []) {
    const id = `${leg.matchId}|${leg.key}`;
    if (seen.has(id) || !knownKey(leg.key)) continue;
    const status = legStatus(leg, results[leg.matchId]);
    if (status === "won" || status === "lost") seen.set(id, { key: leg.key, status, p: Number.isFinite(leg.p) ? leg.p : null, pLow: Number.isFinite(leg.pLow) ? leg.pLow : null, odds: null });
  }
  return [...seen.values()];
}

/** n, vinte, percentuale, intervallo, attesa (media p), soglia prudente (media pLow) e rendimento per unità puntata (solo dove c'è una quota reale). */
export function bucket(legs) {
  const won = legs.filter((l) => l.status === "won").length, n = legs.length;
  const priced = legs.filter((l) => l.odds > 1);
  const profit = priced.reduce((t, l) => t + (l.status === "won" ? l.odds - 1 : -1), 0);
  return {
    n, won, lost: n - won, rate: n ? won / n : null, ci: wilson(won, n),
    expected: mean(legs.filter((l) => l.p != null).map((l) => l.p)), floor: mean(legs.filter((l) => l.pLow != null).map((l) => l.pLow)),
    roi: priced.length ? profit / priced.length : null, roiN: priced.length,
  };
}

/** Raggruppa le selezioni giudicate: { total, byMarket, byKey } ordinati per numero di selezioni. */
export function efficiencyFromLegs(legs) {
  const group = (fn, label) => {
    const m = new Map();
    for (const l of legs) { const k = fn(l); (m.get(k) ?? m.set(k, []).get(k)).push(l); }
    return [...m].map(([k, ls]) => ({ id: k, label: label(k), ...bucket(ls) })).sort((a, b) => b.n - a.n || a.label.localeCompare(b.label, "it"));
  };
  return { total: bucket(legs), byMarket: group((l) => MARKETS[l.key], (k) => k), byKey: group((l) => l.key, (k) => LABELS[k] ?? k) };
}
export const efficiency = (plays, results = {}) => efficiencyFromLegs(settledLegs(plays, results));

/** Taratura: la probabilità dichiarata `p` contro la frequenza reale, per fasce. Fascia ben tarata = attesa ≈ reale. */
export const CAL_EDGES = [0, 0.6, 0.7, 0.8, 1.0001];
export function calibrationBuckets(legs) {
  return CAL_EDGES.slice(0, -1).map((lo, i) => {
    const hi = CAL_EDGES[i + 1], ls = legs.filter((l) => l.p != null && l.p >= lo && l.p < hi);
    return { lo, hi: Math.min(hi, 1), ...bucket(ls) };
  }).filter((b) => b.n);
}

/* ---------- HTML ---------- */
const pc = (x, pct) => pct(x);
const row = (r, { esc, pct }) => `<li><span class="ef-name">${esc(r.label)}</span><span class="ef-bar" role="img" aria-label="${esc(pct(r.rate))}"><i style="width:${Math.round(r.rate * 100)}%"></i></span><span class="ef-val"><b>${esc(pct(r.rate))}</b><small>${r.won}/${r.n}</small></span></li>`;
const range = (t, { esc, pct }) => (t.ci ? ` <small class="ef-ci">(tra ${esc(pct(t.ci.lo))} e ${esc(pct(t.ci.hi))})</small>` : "");

/** Scheda sulle giocate salvate nel dispositivo. */
export function efficiencyHtml(eff, fmt) {
  const { esc, pct } = fmt, t = eff.total;
  if (!t.n) return `<section class="ef-card"><h3>Le tue giocate salvate</h3><p class="ef-empty">Appena una partita salvata sarà finita vedrai qui la percentuale di successo.</p></section>`;
  return `<section class="ef-card"><h3>Le tue giocate salvate</h3>
    <div class="ef-head"><b>${esc(pct(t.rate))}</b><span>${t.won} centrate su ${t.n} selezioni${t.expected != null ? ` · attesa ${esc(pct(t.expected))}` : ""}</span></div>
    <h4>Per mercato</h4><ul class="ef-list">${eff.byMarket.map((r) => row(r, fmt)).join("")}</ul>
    <h4>Per tipo di pronostico</h4><ul class="ef-list">${eff.byKey.map((r) => row(r, fmt)).join("")}</ul>
    ${t.n < 30 ? `<p class="ef-note">Campione ancora piccolo (${t.n} selezioni): sotto le 30 le percentuali sono poco affidabili.</p>` : ""}</section>`;
}

/**
 * Scheda "Affidabilità dei BET" su TUTTI i BET registrati dall'app (non solo quelli salvati).
 * data = risposta di /api/reliability: { total, byMarket, byKey, byBasis, calibration, pending, olderVersions, since }.
 */
export function reliabilityHtml(data, fmt) {
  const { esc, pct } = fmt, t = data?.total;
  const head = `<h3>Affidabilità dei BET dell'app</h3>`;
  if (!t?.n) return `<section class="ef-card">${head}<p class="ef-empty">${data?.pending ? `${data.pending} BET registrati, in attesa del risultato.` : "Nessun BET ancora concluso."} I pronostici si registrano da soli prima del calcio d'inizio: le percentuali compaiono man mano che le partite finiscono.</p></section>`;
  const gap = t.expected != null ? t.rate - t.expected : null;
  const verdict = gap == null || t.n < 30 ? "" : gap < -0.05 ? `<p class="ef-note">Il modello promette più di quanto mantiene: ${esc(pct(t.expected))} dichiarato contro ${esc(pct(t.rate))} reale. Le probabilità vanno riviste.</p>` : gap > 0.05 ? `<p class="ef-hint">Il modello è più prudente della realtà: ${esc(pct(t.rate))} reale contro ${esc(pct(t.expected))} dichiarato.</p>` : `<p class="ef-hint">Dichiarato e reale sono vicini: il modello è ben tarato su questi BET.</p>`;
  const cal = (data.calibration ?? []).map((b) => `<li><span class="ef-name">${esc(pct(b.lo))}–${esc(pct(b.hi))}</span><span class="ef-pair">dichiarato <b>${esc(pct(b.expected))}</b> · reale <b>${esc(pct(b.rate))}</b></span><small>${b.won}/${b.n}</small></li>`).join("");
  return `<section class="ef-card">${head}
    <div class="ef-head"><b>${esc(pct(t.rate))}</b><span>${t.won} BET centrati su ${t.n}${range(t, fmt)}</span></div>
    <p class="ef-line">Dichiarato dal modello <b>${t.expected != null ? esc(pct(t.expected)) : "—"}</b> · soglia prudente <b>${t.floor != null ? esc(pct(t.floor)) : "—"}</b>${t.roi != null ? ` · rendimento a quota reale <b class="${t.roi >= 0 ? "pl-gain" : "pl-loss"}">${t.roi >= 0 ? "+" : ""}${esc(pct(t.roi, 1))}</b> <small>(${t.roiN} BET con quota)</small>` : ""}</p>
    ${verdict}
    <h4>Per mercato</h4><ul class="ef-list">${data.byMarket.map((r) => row(r, fmt)).join("")}</ul>
    <h4>Per tipo di pronostico</h4><ul class="ef-list">${data.byKey.map((r) => row(r, fmt)).join("")}</ul>
    ${cal ? `<h4>Taratura: dichiarato contro reale</h4><ul class="ef-list ef-cal">${cal}</ul>` : ""}
    ${data.byBasis?.length ? `<h4>Per fonti usate</h4><ul class="ef-list">${data.byBasis.map((r) => row(r, fmt)).join("")}</ul>` : ""}
    ${t.n < 30 ? `<p class="ef-note">Campione ancora piccolo (${t.n} BET): sotto i 30 le percentuali dicono poco; guarda l'intervallo.</p>` : ""}
    <p class="ef-foot">${data.pending ? `${data.pending} BET in attesa del risultato · ` : ""}${data.since ? `dal ${esc(data.since)} · ` : ""}solo modello attuale${data.olderVersions ? ` (${data.olderVersions} BET di versioni precedenti esclusi)` : ""}</p></section>`;
}
