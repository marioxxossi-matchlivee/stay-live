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

/**
 * Pronostico ancorato al mercato (validato sulle partite pubblicate 13–26/11/2026 con quote registrate, 1.226 partite):
 * il consenso delle quote senza margine è molto meglio calibrato del modello (Brier 0,160 contro 0,201) e il suo favorito vince il 76,5% contro il 71,2% del pronostico del modello;
 * tra le partite con quota del favorito > 1,30 il favorito di mercato azzecca il 62,1% (quota media 1,55) contro il 57,6% del modello sulle stesse partite.
 * Regole: servono quote reali e fresche su entrambi i lati; la probabilità è quella di mercato; il pronostico è il favorito di mercato; si pronostica solo con quota migliore del favorito > minPickOdds.
 * Senza quote (o con quote vecchie) la partita non viene pronosticata e rientra al giro successivo. Le astensioni del modello (storico insufficiente) restano.
 */
export const TENNIS_ANCHOR = {
  version: "mkt1", minPickOdds: 1.3, maxOddsAgeMs: TENNIS_BET.maxOddsAgeMs,
  // Soglia del favorito (probabilità di mercato senza margine): 0,60. Sulle partite 13–26/11 con quota del favorito > 1,30: da 0,55 → 65,1% azzeccati (496 partite); da 0,60 → 69,2% (347); da 0,65 → 75,0% (204).
  // Tra 50% e 60% il favorito vince il 54%: è il punto in cui escono più pronostici sbagliati.
  minFavorite: 0.60,
  // Il mercato sottostima i favoriti netti (70–80%: dato 75,1%, reale 81,9% su 321 partite; 80–90%: 84,7% contro 90,9%): si applica metà dell'effetto osservato, con rampa da 62% a 70%.
  favoriteLift: { max: 0.03, from: 0.62, to: 0.70 },
};

/** Consenso di mercato senza margine: media delle probabilità senza margine di ogni fonte con entrambe le quote. */
export function marketConsensus(sources) {
  const list = (Array.isArray(sources) ? sources : []).map((s) => noVig(Number(s?.p1), Number(s?.p2))).filter(Boolean);
  if (!list.length) return null;
  const p1 = list.reduce((a, x) => a + x.p1, 0) / list.length;
  return { p1, p2: 1 - p1, books: list.length };
}

export function anchorToMarket(prediction, match, { now = Date.now(), cfg = TENNIS_ANCHOR } = {}) {
  if (!prediction?.published) return prediction;                      // astensione del modello: resta
  const stop = (why) => ({ ...prediction, published: false, pick: null, p1: null, p2: null, reliability: null, abstainReason: why, anchored: false });
  const start = Date.parse(match?.startsAt), fetched = Date.parse(match?.oddsFetchedAt);
  if (match?.status !== "scheduled" || !(start > now)) return stop("La partita è già iniziata o conclusa.");
  const mc = marketConsensus(match.oddsSources);
  if (!mc) return stop("Quote non ancora disponibili: nessun pronostico (rientra al prossimo aggiornamento).");
  if (!(now - fetched <= cfg.maxOddsAgeMs)) return stop("Quote non aggiornate: nessun pronostico (rientra al prossimo aggiornamento).");
  const clip = (x) => Math.min(0.98, Math.max(0.02, x));
  const pick = mc.p1 >= 0.5 ? 1 : 2, pFairFav = clip(Math.max(mc.p1, 1 - mc.p1));
  if (pFairFav < cfg.minFavorite) return stop("Nessun favorito netto sul mercato (sotto il 60%): nessun pronostico.");
  const lf = cfg.favoriteLift, lift = lf.max * Math.min(1, Math.max(0, (pFairFav - lf.from) / (lf.to - lf.from)));
  const pFav = Math.min(0.985, pFairFav + lift), p1 = Math.round((pick === 1 ? pFav : 1 - pFav) * 1e4) / 1e4, p2 = Math.round((1 - p1) * 1e4) / 1e4;
  const po = pickOdds(match.oddsSources, pick);
  if (!po || !(po.odds > cfg.minPickOdds)) return stop(`Quota del favorito ${po ? po.odds.toFixed(2).replace(".", ",") : "n.d."}: non superiore a ${cfg.minPickOdds.toFixed(2).replace(".", ",")}, nessun pronostico.`);
  return { ...prediction, p1, p2, pick, anchored: true, abstainReason: null, modelVersion: `${prediction.modelVersion}+${cfg.version}`,
    reasons: [`Probabilità dal consenso delle quote senza margine (${mc.books} ${mc.books === 1 ? "fonte" : "fonti"}); il modello dava ${Math.round((prediction.p1 ?? 0) * 100)}% a ${Math.round((prediction.p2 ?? 0) * 100)}%.`, ...(prediction.reasons ?? [])],
    components: { ...prediction.components, anchor: { v: cfg.version, pModel1: prediction.p1, pModelPick: prediction.pick, pMarket1: Math.round(mc.p1 * 1e4) / 1e4, books: mc.books, bestOdds: po.odds } } };
}
