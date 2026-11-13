// Stay Live Tennis — quote reali, probabilità implicita, EV e verdetto BET / EVITA. Logica PURA, specifica per il tennis (mercato 1/2).
// Regole: si usano solo quote restituite dal provider (programma pre-partita); mai stimate. Senza quote aggiornate non si calcola l'EV
// e il verdetto è EVITA con la motivazione. Una quota pre-partita non si usa mai per una partita già iniziata.

export const TENNIS_BET = {
  version: "tennis-bet-v1",
  minOdds: 1.5,            // sotto questa quota una gamba non vale il rischio (anche in multipla)
  minEv: 0.04,             // EV minimo: +4% sulla puntata
  maxModelGap: 0.15,       // scarto massimo tra modello e mercato (senza margine): oltre, il modello è quasi certamente senza informazioni che il mercato ha
  maxOddsAgeMs: 3 * 3600e3, // quote più vecchie di 3 ore (il giro le rinnova ogni 30 minuti) = non aggiornate
  strictCategories: ["itf", "challenger", "challenger_itf"], // mercati meno liquidi e dati più poveri: serve affidabilità "alta"
};

const valid = (o) => Number.isFinite(o) && o > 1;
const round = (x, d = 4) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);

/** Probabilità implicita senza margine (normalizzata) di una coppia di quote. */
export function noVig(o1, o2) {
  if (!valid(o1) || !valid(o2)) return null;
  const a = 1 / o1, b = 1 / o2, s = a + b;
  return { p1: a / s, p2: b / s, margin: s - 1 };
}

/** Quote del giocatore `slot` (1|2) tra tutte le fonti reali: la migliore (più alta) e il consenso senza margine delle fonti. */
export function pickOdds(sources, slot) {
  const list = (Array.isArray(sources) ? sources : []).filter((s) => valid(Number(s?.p1)) && valid(Number(s?.p2)));
  if (!list.length) return null;
  const key = slot === 1 ? "p1" : "p2";
  const best = list.reduce((m, s) => (Number(s[key]) > Number(m[key]) ? s : m), list[0]);
  const pin = list.find((s) => /pinnacle/i.test(s.book)) ?? list[0]; // riferimento di mercato: Pinnacle se c'è
  const nv = noVig(Number(pin.p1), Number(pin.p2));
  return { odds: Number(best[key]), book: String(best.book), reference: { book: String(pin.book), implied: nv ? (slot === 1 ? nv.p1 : nv.p2) : null, margin: nv?.margin ?? null }, count: list.length };
}

/**
 * match: { status, startsAt, oddsSources, oddsFetchedAt }. prediction: uscita di predictMatch (published, pick, p1, p2, reliability).
 * Restituisce SEMPRE un verdetto spiegato. `ev` e `odds` sono null quando non calcolabili.
 */
export function evaluateBet(match, prediction, { now = Date.now(), cfg = TENNIS_BET, category = null } = {}) {
  const out = { verdict: "EVITA", pick: prediction?.pick ?? null, odds: null, book: null, oddsAt: match.oddsFetchedAt ?? null, ev: null, implied: null, rawImplied: null, modelProb: null, reasons: [], version: cfg.version };
  const no = (r) => { out.reasons.push(r); return out; };
  if (!prediction?.published || !prediction.pick) return no(prediction?.abstainReason ?? "Nessun pronostico: il modello si è astenuto.");
  const slot = prediction.pick, p = slot === 1 ? prediction.p1 : prediction.p2;
  out.modelProb = p;
  const start = Date.parse(match.startsAt);
  if (match.status !== "scheduled" || !Number.isFinite(start) || start <= now) return no("La partita è già iniziata o conclusa: la quota pre-partita non è più valida.");
  const po = pickOdds(match.oddsSources, slot);
  if (!po) return no("Quote non disponibili dal provider: senza quota non si calcola l'EV e non si propone un BET.");
  const age = match.oddsFetchedAt ? now - Date.parse(match.oddsFetchedAt) : Infinity;
  out.odds = po.odds; out.book = po.book; out.rawImplied = round(1 / po.odds); out.implied = round(po.reference.implied);
  if (!(age <= cfg.maxOddsAgeMs)) return no("Quote non aggiornate: nessun EV calcolato.");
  out.ev = round(p * po.odds - 1);
  const why = [];
  if (prediction.reliability === "bassa") why.push("Affidabilità bassa: pochi dati a supporto.");
  if (cfg.strictCategories.includes(category) && prediction.reliability !== "alta") why.push("Challenger/ITF: mercato poco liquido, si richiede affidabilità alta.");
  if (po.odds < cfg.minOdds) why.push(`Quota ${po.odds.toFixed(2).replace(".", ",")} sotto il minimo di ${cfg.minOdds.toFixed(2).replace(".", ",")}.`);
  if (out.ev < cfg.minEv) why.push(`EV ${(out.ev * 100).toFixed(1).replace(".", ",")}% sotto la soglia del ${(cfg.minEv * 100).toFixed(0)}%.`);
  if (po.reference.implied != null && Math.abs(p - po.reference.implied) > cfg.maxModelGap) why.push(`Il modello (${Math.round(p * 100)}%) si discosta troppo dal mercato (${Math.round(po.reference.implied * 100)}% senza margine).`);
  if (why.length) { out.reasons.push(...why); return out; }
  out.verdict = "BET";
  out.reasons.push(`EV ${(out.ev * 100).toFixed(1).replace(".", ",")}% su quota ${po.odds.toFixed(2).replace(".", ",")} (${po.book}); affidabilità ${prediction.reliability}.`);
  return out;
}
