/**
 * Stay Live — CONTINUOUS LEARNING: adattatori PURI dai registri esistenti ai record normalizzati.
 * Non scrivono né leggono nulla: ricevono righe già lette (in sola lettura) dagli script o dai test.
 * Nessun dato viene inventato: ciò che manca resta null e viene contato nella qualità dei dati.
 */
import { weekOf, r4 } from "./_learning-core.js";

const ts = (x) => (x == null ? NaN : Date.parse(x));
const num = (x) => (x == null || x === "" || !Number.isFinite(Number(x)) ? null : Number(x));
const prob = (x) => { const v = num(x); return v != null && v > 0 && v < 1 ? v : null; };

/** Categorie di dato mancante dichiarato dal modello tennis (testo → categoria stabile). */
export function missingFlags(list) {
  const t = (Array.isArray(list) ? list : []).map((s) => String(s).toLowerCase()), has = (re) => t.some((s) => re.test(s));
  return { h2h: has(/scontri/), ranking: has(/ranking/), serveStats: has(/statistiche di servizio/), history: has(/storico partite/), format: has(/formato/), form: has(/forma recente/) };
}

/**
 * Tennis: righe di `tennis_predictions` (previsione pubblicata, ultima versione prima della partita) + `winner` da `tennis_prediction_results`.
 * Evento: «vince il giocatore 1». Quote: spesso una sola quota (odds_p1): la probabilità implicita NON è normalizzata e lo si dichiara.
 */
export function tennisRecords(predictions, winners) {
  const win = new Map((winners ?? []).map((w) => [w.match_key, Number(w.winner)])), out = [], skipped = { notPublished: 0, noWinner: 0, badProbability: 0, badDate: 0 };
  for (const r of predictions ?? []) {
    if (!r.published) { skipped.notPublished++; continue; }
    const p = prob(r.p1), w = win.get(r.match_key), t = ts(r.starts_at);
    if (p == null) { skipped.badProbability++; continue; }
    if (w !== 1 && w !== 2) { skipped.noWinner++; continue; }
    if (!Number.isFinite(t)) { skipped.badDate++; continue; }
    const o1 = num(r.odds_p1), o2 = num(r.odds_p2), both = o1 > 1 && o2 > 1, m = both ? (1 / o1) / (1 / o1 + 1 / o2) : o1 > 1 ? 1 / o1 : null;
    const tid = String(r.match_key).split("|")[0] || "?", missing = Array.isArray(r.missing) ? r.missing : [];
    out.push({ id: r.match_key, sport: "tennis", t, p, y: w === 1 ? 1 : 0, group: r.match_key, block: `${tid}|${weekOf(t)}`, version: r.model_ver ?? null, prospective: true,
      segs: { surface: r.surface ?? "n.d.", tour: r.tour ?? "n.d." }, flags: missingFlags(missing), missing,
      sources: { model: p, api: null, market: m == null ? null : r4(m), marketNormalized: both }, oddsAgeMin: r.odds_at && Number.isFinite(ts(r.odds_at)) ? Math.round((t - ts(r.odds_at)) / 6e4) : null });
  }
  return { records: out, skipped };
}

/**
 * Calcio: righe di `prediction_leg_results` (una riga per mercato di una partita; `won` = esito). Le righe con basis «ricostruita» sono ricostruzioni a posteriori:
 * NON sono previsioni prospettiche e restano fuori dall'analisi principale (contate a parte).
 */
export function footballRecords(rows, { includeReconstructed = false } = {}) {
  const out = [], skipped = { reconstructed: 0, noOutcome: 0, badProbability: 0, badDate: 0 };
  for (const r of rows ?? []) {
    if (r.won == null) { skipped.noOutcome++; continue; }
    const recon = String(r.basis ?? "").startsWith("ricostruit");
    if (recon && !includeReconstructed) { skipped.reconstructed++; continue; }
    const p = prob(r.p), t = ts(r.kickoff_at);
    if (p == null) { skipped.badProbability++; continue; }
    if (!Number.isFinite(t)) { skipped.badDate++; continue; }
    out.push({ id: `${r.game_id}|${r.sel_key}`, sport: "football", t, p, y: r.won ? 1 : 0, group: String(r.game_id), block: `${r.league ?? "?"}|${weekOf(t)}`, version: r.model_ver ?? null, prospective: !recon,
      segs: { market: r.sel_key ?? "n.d.", league: r.league ?? "n.d.", basis: r.basis ?? "n.d.", verdict: r.verdict ?? "n.d." },
      flags: { noApi: prob(r.p_api) == null, noMarket: prob(r.p_market) == null, reconstructed: recon }, missing: [],
      sources: { model: prob(r.p_model), api: prob(r.p_api), market: prob(r.p_market), marketNormalized: true } });
  }
  return { records: out, skipped };
}

/** Qualità dei dati: copertura delle fonti e dati mancanti (nessuna interpretazione causale). */
export function sourceUsage(records) {
  const n = records.length, c = (f) => records.filter(f).length, frac = (k) => (n ? r4(k / n) : null);
  const base = { n, withModel: frac(c((r) => r.sources.model != null)), withApi: frac(c((r) => r.sources.api != null)), withMarket: frac(c((r) => r.sources.market != null)), withNormalizedMarket: frac(c((r) => r.sources.market != null && r.sources.marketNormalized)) };
  const flags = {}; for (const k of Object.keys(records[0]?.flags ?? {})) flags[k] = frac(c((r) => r.flags[k]));
  const ages = records.map((r) => r.oddsAgeMin).filter((x) => x != null).sort((a, b) => a - b);
  return { ...base, missingFlagShare: flags, oddsAgeMinutes: ages.length ? { n: ages.length, median: ages[Math.floor(ages.length / 2)], p10: ages[Math.floor(ages.length * 0.1)], p90: ages[Math.floor(ages.length * 0.9)] } : null };
}
