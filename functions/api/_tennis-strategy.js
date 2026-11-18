// Stay Live Tennis — STRATEGY ENGINE. Livello decisionale SEPARATO dal Prediction Engine (_tennis-model.js).
// Logica PURA: nessuna rete, nessun database, nessun import dal calcio. Riceve le partite GIÀ presenti nella snapshot del tennis
// (tennis-board: matchView) e restituisce classificazione, singole, eventuale doppia e motivazioni.
//
// Il Prediction Engine stabilisce le probabilità dei due giocatori; qui si decide solo SE esiste una giocata di valore:
//   P_implicita = 1/quota · P_mercato (senza margine) = (1/q1)/((1/q1)+(1/q2)) · Quota_equa = 1/P_modello · EV = P_modello × quota − 1
// Mercato: SOLO vincente della partita (lato 1 o lato 2). Nessuna multipla oltre le due gambe.
import { TENNIS_BET, pickOdds } from "./_tennis-bet.js";
import { MIN_RELIABLE_SAMPLE } from "./_tennis-metrics.js";

export const STRATEGY = {
  version: "tennis-strategy-v1",
  // Soglie di mercato: SONO quelle di _tennis-bet.js (lette a ogni chiamata, mai copiate né abbassate qui).
  eliteEv: 0.08,            // VALUE ELEVATO: EV almeno doppio della soglia minima attuale (4%)
  eliteEdge: 0.03,          // e almeno 3 punti percentuali sopra il mercato senza margine
  highProb: 0.65,           // «probabilità alta»: il modello dà al lato almeno il 65%
  minBinSample: 50,         // casi minimi in una fascia di calibrazione per usarla
  minSegmentSample: 100,    // casi minimi per circuito (ATP/WTA) e per superficie nel backtest
  minValidatedSample: MIN_RELIABLE_SAMPLE,
  maxSingles: 5,            // la strategia propone poche giocate: oltre la quinta non si va
  maxLegs: 2,               // una doppia al massimo: nessuna multipla da 3 o più eventi
};

export const CLASSES = {
  value_high: { rank: 0, label: "VALUE ELEVATO", short: "Value elevato" },
  value_interesting: { rank: 1, label: "VALUE INTERESSANTE", short: "Value interessante" },
  high_prob_bad_price: { rank: 2, label: "PROBABILITÀ ALTA MA QUOTA NON CONVENIENTE", short: "Probabile, quota non conveniente" },
  no_value: { rank: 3, label: "NESSUN VALUE", short: "Nessun value" },
  not_evaluable: { rank: 4, label: "NON VALUTABILE PER DATI INSUFFICIENTI", short: "Non valutabile" },
};
export const INDEPENDENCE_NOTE = "La probabilità congiunta P1 × P2 vale solo se i due eventi sono indipendenti: è un'ipotesi di lavoro, non una certezza.";

const round = (x, d = 4) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
const pctText = (x, d = 1) => `${(x * 100).toFixed(d).replace(".", ",")}%`;
const oddsText = (x) => x.toFixed(2).replace(".", ",");
const validP = (p) => Number.isFinite(p) && p > 0 && p < 1;
const RELIABILITY_RANK = { alta: 2, media: 1, bassa: 0 };

// ───────────── Calendario italiano (Europe/Rome) ─────────────
const romeDayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome" });
export const romeDay = (ms) => romeDayFmt.format(new Date(ms));
const addDays = (day, n) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86400e3).toISOString().slice(0, 10); // aritmetica di calendario: nessun errore da ora legale
const dowOf = (day) => new Date(`${day}T12:00:00Z`).getUTCDay(); // 0 domenica … 6 sabato

/** Giorni (Europe/Rome) del prossimo weekend; se oggi è sabato o domenica, quello in corso. */
export function weekendDays(now) {
  const today = romeDay(now), d = dowOf(today);
  if (d === 6) return [today, addDays(today, 1)];
  if (d === 0) return [today];
  const sat = addDays(today, 6 - d);
  return [sat, addDays(sat, 1)];
}

export const RANGES = [["today", "Oggi"], ["h48", "Prossime 48 ore"], ["weekend", "Weekend"], ["d7", "Prossimi 7 giorni"]];
/** Finestra temporale: test(ms) è vero per le partite FUTURE dentro la finestra. */
export function rangeTest(range, now) {
  const future = (t) => Number.isFinite(t) && t > now;
  switch (range) {
    case "today": { const day = romeDay(now); return (t) => future(t) && romeDay(t) === day; }
    case "h48": return (t) => future(t) && t <= now + 48 * 3600e3;
    case "weekend": { const days = new Set(weekendDays(now)); return (t) => future(t) && days.has(romeDay(t)); }
    case "d7": return (t) => future(t) && t <= now + 7 * 86400e3;
    default: return () => false;
  }
}

// ───────────── Calibrazione (solo dati reali del backtest cronologico) ─────────────
/** Intervallo di Wilson (95%) per una frequenza osservata k su n. */
export function wilson(k, n, z = 1.96) {
  if (!(n > 0)) return [0, 1];
  const ph = k / n, d = 1 + (z * z) / n, c = ph + (z * z) / (2 * n), s = z * Math.sqrt((ph * (1 - ph)) / n + (z * z) / (4 * n * n));
  return [Math.max(0, (c - s) / d), Math.min(1, (c + s) / d)];
}

/** Normalizza il backtest della snapshot (history.backtest) in {n, bins, byTour, bySurface}. Assente → campione zero. */
export function calibrationFrom(bt) {
  const n = Number(bt?.published ?? bt?.summary?.n ?? 0) || 0;
  const seg = (o) => Object.fromEntries(Object.entries(o ?? {}).map(([k, v]) => [k, { n: Number(v?.n) || 0, bins: Array.isArray(v?.calibration) ? v.calibration : [] }]));
  return { n, bins: Array.isArray(bt?.summary?.calibration) ? bt.summary.calibration : [], byTour: seg(bt?.byTour), bySurface: seg(bt?.bySurface), hasSegments: Boolean(bt?.byTour && bt?.bySurface), modelVersion: bt?.modelVersion ?? null };
}

/**
 * Verifica statistica della probabilità `p` di un lato contro la fascia di calibrazione che la contiene.
 * Metodo: frequenza osservata della fascia con intervallo di Wilson 95%. Se l'estremo superiore sta SOTTO la probabilità media dichiarata
 * dal modello nella fascia, il modello è significativamente troppo ottimista: la probabilità usata si corregge dello scarto osservato
 * (correzione empirica, solo al ribasso). Con meno di minBinSample casi la fascia non si usa: stato «insufficiente».
 */
export function calibrationCheck(p, calib, cfg = STRATEGY) {
  const fav = Math.max(p, 1 - p), bin = (calib?.bins ?? []).find((b) => fav >= b.from && fav < b.to);
  if (!bin || !(bin.n >= cfg.minBinSample) || bin.hitRate == null || bin.meanP == null) return { status: "insufficient", n: bin?.n ?? 0, adjustedP: p };
  const isFav = p >= 0.5, modelMean = isFav ? bin.meanP : 1 - bin.meanP, observed = isFav ? bin.hitRate : 1 - bin.hitRate;
  const [lo, hi] = wilson(Math.round(observed * bin.n), bin.n);
  const over = hi < modelMean;
  return { status: over ? "overconfident" : "ok", n: bin.n, modelMean: round(modelMean), observed: round(observed), lo: round(lo), hi: round(hi), adjustedP: over ? Math.min(0.99, Math.max(0.01, p + (observed - modelMean))) : p };
}

function validation(calib, tour, surface, check, cfg = STRATEGY) {
  const why = [];
  if (calib.n < cfg.minValidatedSample) why.push(`Campione del backtest insufficiente (${calib.n}/${cfg.minValidatedSample}): probabilità non validata.`);
  if (!calib.hasSegments) why.push("Campione per circuito e superficie non disponibile: probabilità non validata per questo segmento.");
  else {
    const nt = calib.byTour[tour]?.n ?? 0, ns = surface ? calib.bySurface[surface]?.n ?? 0 : 0;
    if (nt < cfg.minSegmentSample) why.push(`Campione ${String(tour).toUpperCase()} insufficiente (${nt}/${cfg.minSegmentSample}).`);
    if (!surface) why.push("Superficie sconosciuta: nessuna validazione per superficie.");
    else if (ns < cfg.minSegmentSample) why.push(`Campione sulla superficie insufficiente (${ns}/${cfg.minSegmentSample}).`);
  }
  if (check.status === "insufficient") why.push(`Fascia di probabilità con pochi casi (${check.n}/${cfg.minBinSample}): calibrazione non verificabile.`);
  if (check.status === "overconfident") why.push(`Nella fascia il modello è risultato troppo ottimista (osservato ${pctText(check.observed)} contro ${pctText(check.modelMean)} dichiarato): probabilità corretta.`);
  return { validated: why.length === 0, why };
}

// ───────────── Quote ─────────────
function sourcesOf(m) {
  const list = Array.isArray(m.odds?.sources) ? m.odds.sources : [];
  if (list.length) return list;
  return m.odds && Number(m.odds.p1) > 1 && Number(m.odds.p2) > 1 ? [{ book: m.odds.source ?? "n.d.", p1: m.odds.p1, p2: m.odds.p2 }] : [];
}
/** Età delle quote in millisecondi (Infinity se l'istante di lettura manca o è illeggibile). */
const oddsAge = (m, now) => { const t = Date.parse(m.odds?.at); return Number.isFinite(t) ? now - t : Infinity; };

// ───────────── Valutazione di un lato ─────────────
function evaluateSide(m, slot, ctx) {
  const { now, calib, cfg } = ctx, pr = m.prediction, p = slot === 1 ? pr.p1 : pr.p2, name = slot === 1 ? m.p1.name : m.p2.name;
  const po = pickOdds(sourcesOf(m), slot);
  const side = { slot, name, p, isUnderdog: p < 0.5, odds: po?.odds ?? null, book: po?.book ?? null, implied: po ? round(1 / po.odds) : null, market: round(po?.reference?.implied ?? null), marketBook: po?.reference?.book ?? null, margin: round(po?.reference?.margin ?? null), fairOdds: round(1 / p, 3), edge: null, ev: null, pUsed: p, evUsed: null, check: null, validation: null, failures: [], eligible: false };
  if (!po) { side.failures.push("Quota reale non disponibile."); return side; }
  side.edge = round(p - side.market);
  side.check = calibrationCheck(p, calib, cfg);
  side.pUsed = round(side.check.adjustedP);
  side.ev = round(p * po.odds - 1);
  side.evUsed = round(side.pUsed * po.odds - 1);
  side.validation = validation(calib, m.tour, m.court ?? null, side.check, cfg);
  const f = side.failures;
  if (po.odds < TENNIS_BET.minOdds) f.push(`Quota ${oddsText(po.odds)} sotto il minimo di ${oddsText(TENNIS_BET.minOdds)}.`);
  if (side.evUsed < TENNIS_BET.minEv) f.push(`EV ${pctText(side.evUsed)} sotto la soglia del ${(TENNIS_BET.minEv * 100).toFixed(0)}%${side.check.status === "overconfident" ? " (dopo la correzione di calibrazione)" : ""}.`);
  if (Math.abs(p - side.market) > TENNIS_BET.maxModelGap) f.push(`Il modello (${pctText(p, 0)}) si discosta troppo dal mercato (${pctText(side.market, 0)} senza margine): probabile informazione mancante.`);
  side.eligible = f.length === 0;
  return side;
}

// ───────────── Fattori (dalle sole componenti già calcolate dal Prediction Engine: nessun dato nuovo) ─────────────
const fmtSigned = (v) => (v > 0 ? `+${Math.round(v * 10) / 10}` : `${Math.round(v * 10) / 10}`);
export function factorsFor(m, slot) {
  const pr = m.prediction, c = pr?.components ?? {}, sign = slot === 1 ? 1 : -1, who = slot === 1 ? m.p1.name : m.p2.name, other = slot === 1 ? m.p2.name : m.p1.name;
  const out = [], add = (label, v, min) => { if (v == null || !Number.isFinite(v) || Math.abs(v) < min) return; out.push({ label, favors: v * sign > 0, value: fmtSigned(v * sign) }); };
  const adj = (c.formAdj ?? 0) + (c.rankAdj ?? 0) + (c.h2hAdj ?? 0) + (c.fatigueAdj ?? 0);
  if (Number.isFinite(c.eloDiff)) add(`Elo di base (generale e superficie) · ${who} contro ${other}`, c.eloDiff - adj, 10); // eloDiff è il totale: si toglie il già contato nelle correzioni sotto
  add("Forma recente (risultati contro avversari di pari forza)", c.formAdj, 3);
  add("Ranking (solo con pochi dati nello storico)", c.rankAdj, 3);
  add("Scontri diretti (peso ridotto)", c.h2hAdj, 1);
  add("Carico recente", c.fatigueAdj, 1);
  if (Number.isFinite(c.pPoint)) { const ps = slot === 1 ? c.pPoint : 1 - c.pPoint; out.push({ label: `Servizio e risposta: ${pctText(ps, 0)} di vittoria per ${who}`, favors: ps >= 0.5, value: pctText(ps, 0) }); }
  return out;
}
const dataNotes = (m) => {
  const pr = m.prediction, c = pr?.components ?? {}, notes = [];
  if (Number.isFinite(c.n1)) notes.push(`Partite nello storico: ${c.n1} · ${c.n2}; sulla superficie: ${c.nSurf1 ?? "n.d."} · ${c.nSurf2 ?? "n.d."}.`);
  for (const x of pr?.missing ?? []) notes.push(`Dato mancante: ${x}.`);
  notes.push("Infortuni, ritiri recenti e condizione fisica: non disponibili dalla fonte, non considerati.");
  return notes;
};

// ───────────── Valutazione di una partita ─────────────
/**
 * Restituisce { excluded } per le partite non pre-match (iniziate, concluse, annullate, stato incerto: mai opportunità),
 * altrimenti la classificazione con motivi, i due lati e il lato migliore.
 */
export function evaluateMatch(m, { now = Date.now(), calib = calibrationFrom(null), cfg = STRATEGY } = {}) {
  const start = Date.parse(m.startsAt);
  const base = { key: m.key, tour: m.tour, tournament: m.tournament ?? null, category: m.category ?? "unknown", surface: m.court ?? null, startsAt: m.startsAt, p1: m.p1, p2: m.p2, prediction: m.prediction ? { pick: m.prediction.pick, p1: m.prediction.p1, p2: m.prediction.p2, reliability: m.prediction.reliability, reasons: m.prediction.reasons ?? [], missing: m.prediction.missing ?? [], modelVersion: m.prediction.modelVersion ?? null } : null };
  if (m.status !== "scheduled" || !Number.isFinite(start) || start <= now) return { ...base, excluded: true, why: "Partita iniziata, conclusa o non più pre-match: non è un'opportunità." };
  const out = { ...base, excluded: false, cls: "not_evaluable", sides: [], best: null, reasons: [], notes: dataNotes(m) };
  const no = (r) => { out.reasons.push(r); return out; };
  const pr = m.prediction;
  if (!pr) return no("Il Prediction Engine non ha ancora analizzato la partita.");
  if (!pr.published) return no(pr.abstainReason ?? "Il modello si è astenuto: nessuna probabilità pubblicata.");
  if (!validP(pr.p1) || !validP(pr.p2) || Math.abs(pr.p1 + pr.p2 - 1) > 0.001 || (pr.pick !== 1 && pr.pick !== 2)) return no("Probabilità del modello incoerenti: partita scartata.");
  const sources = sourcesOf(m);
  if (!sources.some((s) => Number(s?.p1) > 1 && Number(s?.p2) > 1)) return no("Quote reali non disponibili dal provider: senza quota non si valuta il Value (né positivo né negativo).");
  const age = oddsAge(m, now);
  if (!(age <= TENNIS_BET.maxOddsAgeMs)) return no(Number.isFinite(age) ? `Quote non aggiornate (lette ${Math.round(age / 60000)} minuti fa, massimo ${Math.round(TENNIS_BET.maxOddsAgeMs / 60000)}): non utilizzabili.` : "Istante di lettura delle quote sconosciuto: non utilizzabili.");
  if (pr.reliability === "bassa" || !(pr.reliability in RELIABILITY_RANK)) return no("Affidabilità del modello bassa: dati insufficienti per valutare il Value.");
  if (TENNIS_BET.strictCategories.includes(m.category) && pr.reliability !== "alta") return no("Challenger/ITF: mercato poco liquido, si richiede affidabilità alta.");

  const ctx = { now, calib, cfg };
  out.sides = [evaluateSide(m, 1, ctx), evaluateSide(m, 2, ctx)];
  out.oddsAgeMin = Math.round(age / 60000); out.oddsAt = m.odds?.at ?? null;
  const eligible = out.sides.filter((s) => s.eligible).sort((a, b) => b.evUsed - a.evUsed || b.p - a.p);
  if (eligible.length) {
    const b = eligible[0], v = b.validation;
    const elite = !b.isUnderdog && b.evUsed >= cfg.eliteEv && b.edge >= cfg.eliteEdge && pr.reliability === "alta" && v.validated;
    out.cls = elite ? "value_high" : "value_interesting";
    out.best = b;
    out.reasons.push(`EV ${pctText(b.evUsed)} su quota ${oddsText(b.odds)} (${b.book}): il modello dà ${pctText(b.pUsed)} a ${b.name}, il mercato ${pctText(b.market)} senza margine (quota equa ${oddsText(b.fairOdds)}).`);
    if (b.isUnderdog) out.reasons.push(`Giocata di valore sullo sfavorito: il pronostico principale del modello resta ${pr.pick === 1 ? m.p1.name : m.p2.name}.`);
    if (!elite) {
      if (b.isUnderdog) out.reasons.push("Sullo sfavorito la classe massima è «interessante»: le probabilità basse sono le meno verificate.");
      if (b.evUsed < cfg.eliteEv) out.reasons.push(`EV sotto il ${(cfg.eliteEv * 100).toFixed(0)}% richiesto per «elevato».`);
      if (b.edge < cfg.eliteEdge) out.reasons.push(`Scarto dal mercato sotto i ${(cfg.eliteEdge * 100).toFixed(0)} punti richiesti per «elevato».`);
      if (pr.reliability !== "alta") out.reasons.push("Affidabilità non alta: «elevato» non concesso.");
      out.reasons.push(...v.why);
    }
    return out;
  }
  const hp = out.sides.filter((s) => s.p >= cfg.highProb).sort((a, b) => b.p - a.p)[0];
  if (hp) {
    out.cls = "high_prob_bad_price"; out.best = hp;
    out.reasons.push(`${hp.name} ha il ${pctText(hp.p, 0)} secondo il modello, ma ${hp.failures.join(" ")}`);
    return out;
  }
  out.cls = "no_value";
  const bestBy = [...out.sides].sort((a, b) => (b.evUsed ?? -9) - (a.evUsed ?? -9))[0];
  out.best = null; out.closest = bestBy;
  out.reasons.push(`Nessuno dei due lati supera i controlli. ${bestBy.name}: ${bestBy.failures.join(" ")}`);
  return out;
}

// ───────────── Ordinamento e singole ─────────────
const compareValue = (a, b) => CLASSES[a.cls].rank - CLASSES[b.cls].rank || b.best.evUsed - a.best.evUsed || (RELIABILITY_RANK[b.prediction.reliability] ?? 0) - (RELIABILITY_RANK[a.prediction.reliability] ?? 0) || b.best.edge - a.best.edge || String(a.key).localeCompare(String(b.key));

function singleOf(ev, rank) {
  const b = ev.best;
  return {
    rank, key: ev.key, cls: ev.cls, tour: ev.tour, tournament: ev.tournament, category: ev.category, surface: ev.surface, startsAt: ev.startsAt,
    p1Name: ev.p1.name, p2Name: ev.p2.name, p1Id: ev.p1.id ?? null, p2Id: ev.p2.id ?? null,
    side: b.slot, name: b.name, isUnderdog: b.isUnderdog, modelPick: ev.prediction.pick, p: b.p, pUsed: b.pUsed, market: b.market, implied: b.implied, fairOdds: b.fairOdds, edge: b.edge, ev: b.ev, evUsed: b.evUsed,
    odds: b.odds, book: b.book, marketBook: b.marketBook, oddsAt: ev.oddsAt, oddsAgeMin: ev.oddsAgeMin, reliability: ev.prediction.reliability, modelVersion: ev.prediction.modelVersion, calibration: { status: b.check.status, n: b.check.n, validated: b.validation.validated, why: b.validation.why },
    reasons: ev.reasons, criticalities: criticalitiesOf(ev), factors: null,
  };
}
function criticalitiesOf(ev) {
  const b = ev.best, out = [...b.validation.why];
  if (ev.prediction.reliability !== "alta") out.push(`Affidabilità ${ev.prediction.reliability}.`);
  for (const x of ev.prediction.missing ?? []) out.push(`Dato mancante: ${x}.`);
  if (ev.category !== "tour") out.push("Circuito minore: mercato meno liquido.");
  return out;
}

// ───────────── Doppia (al massimo due gambe) ─────────────
const bet = (p, o) => ({ ev: p * o - 1, sd: Math.sqrt(p * (1 - p)) * o });
const ratio = (x) => (x.sd > 0 ? x.ev / x.sd : -Infinity);

/**
 * Confronto a rischio omogeneo tra: una sola singola (la migliore), due singole separate, la doppia.
 * Criterio ESPLICITO: rendimento atteso per unità di rischio (EV / deviazione standard del profitto, indipendente dalla puntata);
 * le singole sono trattate come indipendenti. Vince la più alta; solo EV positivo.
 */
export function compareStructures(a, b) {
  const sa = bet(a.pUsed, a.odds), sb = bet(b.pUsed, b.odds);
  const pj = a.pUsed * b.pUsed, od = a.odds * b.odds, sd = bet(pj, od);
  const two = { ev: (sa.ev + sb.ev) / 2, sd: 0.5 * Math.sqrt(sa.sd ** 2 + sb.sd ** 2) };
  const best = ratio(sa) >= ratio(sb) ? a : b, sBest = ratio(sa) >= ratio(sb) ? sa : sb;
  const rows = [
    { id: "single", label: `Una sola singola (${best.name})`, ev: sBest.ev, sd: sBest.sd },
    { id: "two_singles", label: "Due singole separate", ev: two.ev, sd: two.sd },
    { id: "double", label: "Doppia", ev: sd.ev, sd: sd.sd },
  ].map((r) => ({ ...r, ev: round(r.ev), sd: round(r.sd), ratio: round(ratio(r)) }));
  const eligible = rows.filter((r) => r.ev > 0);
  const winner = eligible.length ? eligible.reduce((m, r) => (r.ratio > m.ratio ? r : m), eligible[0]) : null;
  return { rows, preferred: winner?.id ?? null, jointP: round(pj), totalOdds: round(od, 3), evDouble: round(sd.ev) };
}

function correlationOf(a, b) {
  const ids = (s) => [s.p1Id, s.p2Id].filter(Boolean).map(String), names = (s) => [s.p1Name, s.p2Name].map((x) => String(x).toLowerCase());
  if (a.key === b.key) return { blocked: "stessa partita" };
  const sharedId = ids(a).some((x) => ids(b).includes(x)), sharedName = names(a).some((x) => names(b).includes(x));
  if (sharedId || sharedName) return { blocked: "un giocatore compare in entrambe le partite" };
  const warns = [];
  if (a.tournament && a.tournament === b.tournament) warns.push("Stesso torneo: condizioni comuni (meteo, rinvii) rendono l'indipendenza meno certa.");
  return { blocked: null, warns };
}

function buildDouble(singles) {
  const pool = singles.slice(0, STRATEGY.maxSingles);
  if (pool.length < 2) return { status: "none", reason: pool.length ? "Una sola Value individuale: non c'è nulla da abbinare." : "Nessuna Value individuale: nessuna doppia.", candidates: 0 };
  const found = [], blockedPairs = [];
  for (let i = 0; i < pool.length; i++) for (let j = i + 1; j < pool.length; j++) {
    const a = pool[i], b = pool[j], cor = correlationOf(a, b);
    if (cor.blocked) { blockedPairs.push({ a: a.key, b: b.key, why: cor.blocked }); continue; }
    const cmp = compareStructures(a, b);
    found.push({ legs: [a, b], ...cmp, warnings: cor.warns });
  }
  if (!found.length) return { status: "none", reason: "Le Value individuali non sono combinabili (stessa partita o stesso giocatore).", candidates: 0, blockedPairs };
  const pref = found.filter((f) => f.preferred === "double"), pickFrom = pref.length ? pref : found;
  const dbl = (f) => f.rows.find((r) => r.id === "double");
  const best = pickFrom.reduce((m, f) => (dbl(f).ratio > dbl(m).ratio || (dbl(f).ratio === dbl(m).ratio && f.evDouble > m.evDouble) ? f : m), pickFrom[0]);
  const text = { single: "Matematicamente preferibile giocare una sola singola.", two_singles: "Matematicamente preferibile giocare le due singole separate." };
  return {
    status: best.preferred === "double" ? "recommended" : "not_preferred",
    pairKey: [best.legs[0].key, best.legs[1].key].sort().join("+"), legs: best.legs, totalOdds: best.totalOdds, jointP: best.jointP, evDouble: best.evDouble, comparison: best.rows, preferred: best.preferred,
    verdict: best.preferred === "double" ? "La doppia ha il miglior rendimento atteso per unità di rischio tra le alternative." : text[best.preferred] ?? "Nessuna alternativa ha un rendimento atteso positivo.",
    warnings: best.warnings, assumption: INDEPENDENCE_NOTE, candidates: found.length, blockedPairs,
  };
}

// ───────────── Strategia completa ─────────────
/**
 * matches: partite della snapshot (matchView). opts: { range, tour ("all"|"atp"|"wta"), now, calibration (history.backtest) }.
 * Restituisce dashboard, classificazione di tutte le partite analizzate, singole in graduatoria, doppia e piano.
 */
export function buildStrategy(matches, { range = "d7", tour = "all", now = Date.now(), calibration = null, cfg = STRATEGY } = {}) {
  const inRange = rangeTest(range, now), calib = calibrationFrom(calibration);
  const scope = (Array.isArray(matches) ? matches : []).filter((m) => m && (tour === "all" || m.tour === tour));
  const evals = []; let excluded = 0;
  for (const m of scope) {
    const t = Date.parse(m.startsAt);
    if (m.status === "scheduled" && Number.isFinite(t) && t > now && !inRange(t)) continue; // fuori finestra: non fa parte dell'analisi richiesta
    const e = evaluateMatch(m, { now, calib, cfg });
    if (e.excluded) { excluded++; continue; }
    evals.push(e);
  }
  const byMatch = new Map(scope.map((m) => [m.key, m]));
  const ranked = evals.filter((e) => e.cls === "value_high" || e.cls === "value_interesting").sort(compareValue);
  const singles = ranked.map((e, i) => { const s = singleOf(e, i + 1); s.factors = factorsFor(byMatch.get(e.key), s.side); return s; });
  const selected = singles.slice(0, cfg.maxSingles);
  const double = buildDouble(selected);
  const count = (c) => evals.filter((e) => e.cls === c).length;
  const evaluable = evals.filter((e) => e.cls !== "not_evaluable").length;
  const dashboard = {
    analyzed: evals.length, evaluable, valueFound: singles.length, discarded: count("no_value") + count("high_prob_bad_price"), notEvaluable: count("not_evaluable"),
    singles: selected.length, double: double.status, excludedStarted: excluded,
    byClass: Object.fromEntries(Object.keys(CLASSES).map((k) => [k, count(k)])),
  };
  const plan = singles.length === 0
    ? { kind: "none", text: "Nessuna opportunità sufficientemente valida: non giocare è la scelta corretta." }
    : double.status === "recommended" ? { kind: "double", text: "La doppia è la struttura con il miglior rendimento atteso per unità di rischio." }
    : selected.length === 1 ? { kind: "single", text: "Una sola Value: si gioca una singola, senza abbinamenti." }
    : { kind: "singles", text: double.status === "not_preferred" ? double.verdict : "Più Value individuali indipendenti: si giocano singole separate." };
  const sortedEvals = [...evals].sort((a, b) => CLASSES[a.cls].rank - CLASSES[b.cls].rank || (b.best?.evUsed ?? -9) - (a.best?.evUsed ?? -9) || String(a.startsAt).localeCompare(String(b.startsAt)) || String(a.key).localeCompare(String(b.key)));
  return {
    engineVersion: cfg.version, range, tour, generatedAt: new Date(now).toISOString(), dashboard, singles, selected, double, plan, evaluations: sortedEvals,
    calibration: { sample: calib.n, required: cfg.minValidatedSample, validated: calib.n >= cfg.minValidatedSample && calib.hasSegments, hasSegments: calib.hasSegments, note: calib.n >= cfg.minValidatedSample ? "Backtest cronologico (Elo e forma, senza look-ahead): descrive la parte del modello che il backtest riproduce." : "Campione in costruzione: nessuna stima è presentata come validata." },
    thresholds: { minOdds: TENNIS_BET.minOdds, minEv: TENNIS_BET.minEv, maxModelGap: TENNIS_BET.maxModelGap, maxOddsAgeMin: TENNIS_BET.maxOddsAgeMs / 60000, eliteEv: cfg.eliteEv, eliteEdge: cfg.eliteEdge, highProb: cfg.highProb, maxSingles: cfg.maxSingles, maxLegs: cfg.maxLegs },
  };
}
