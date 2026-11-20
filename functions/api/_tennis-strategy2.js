/**
 * Stay Live Tennis — Strategy Center 2.0, logica SPERIMENTALE (Shadow Mode). Funzioni pure: nessun accesso a rete o database.
 * Non è importata da nessun endpoint o job di produzione: oggi la usa solo lo script di audit (scripts/tennis-strategy-audit.js).
 *
 * Idea (dai risultati dell'audit del 18/11/2026): il modello Elo+forma, da solo, non aggiunge informazione misurabile al mercato (c = 0,02 ± 0,02).
 * Quindi la probabilità non si usa grezza: si rimodula sul mercato, p_adj = σ(a + b·logit(mercato) + c·(logit(modello) − logit(mercato))), con coefficienti
 * adattati SOLO a partite precedenti, e un lato diventa BET solo se c'è prova statistica che il modello aggiunge informazione nella sua categoria.
 * Le soglie sotto sono fissate a priori (non ottimizzate sui risultati del backtest).
 */
export const STRATEGY2 = Object.freeze({
  version: "2.0-shadow-1",
  minOdds: 1.5,          // come oggi (_tennis-bet.js)
  minEv: 0.04,           // come oggi: vantaggio minimo, ma calcolato sulla probabilità RIMODULATA
  strongEv: 0.06,        // per la classe A
  maxGap: 0.15,          // scarto massimo modello−mercato (anomalia oltre), come oggi
  // Prova statistica per categoria: c − z·errore standard > 0. Le soglie sono volutamente severe: la prova si ricalcola ogni mese su 11 categorie, e i controlli
  // ripetuti fanno comparire «prove» per puro caso (simulazione su dati di solo rumore: circa 1 caso su 10 con z = 2). Quindi z = 2,58 (≈ 99%) per B e 3,29 (≈ 99,9%) per A.
  zInteresting: 2.58,    // classe B
  zStrong: 3.29,         // classe A
  minCategoryN: 300,     // partite minime di addestramento per valutare una categoria
  minClusters: 50,       // blocchi (torneo-settimana) minimi: con pochi blocchi l'errore standard «robusto» è instabile e troppo ottimista
  minTrainMonths: 3,
  doubleMinJointProb: 0.3,
  doubleMinEv: 0.08,
});

const EPS = 1e-6, clip = (p) => Math.min(1 - EPS, Math.max(EPS, p));
export const logit = (p) => Math.log(clip(p) / (1 - clip(p)));
export const sigmoid = (z) => 1 / (1 + Math.exp(-z));

/** Probabilità del modello rimodulata sul mercato con i coefficienti {a, b, c} del walk-forward. */
export const adjustProbability = (fit, pModel, mkt) => sigmoid(fit.a + fit.b * logit(mkt) + fit.c * (logit(pModel) - logit(mkt)));

/**
 * Classe di una selezione: A VALUE FORTE · B VALUE INTERESSANTE · C DA MONITORARE · D SCARTATA. `reasons` spiega la decisione in italiano.
 * evidence = { c, se, clusters } della categoria (da dati precedenti; se = il maggiore tra l'errore standard indipendente e quello robusto per blocchi); assente o con meno di minClusters blocchi → il campione non basta.
 */
export function classifySide({ pAdj, pModel, mkt, odds, reliability, evidence }, cfg = STRATEGY2) {
  const edge = pAdj * odds - 1, reasons = [];
  if (!(odds > 1) || !(pAdj > 0 && pAdj < 1) || !(mkt > 0 && mkt < 1)) reasons.push("dati o quota non validi");
  else {
    if (reliability === "bassa") reasons.push("affidabilità dei dati bassa");
    if (odds < cfg.minOdds) reasons.push("quota sotto il minimo");
    if (Math.abs(pModel - mkt) > cfg.maxGap) reasons.push("scarto dal mercato anomalo (oltre 15 punti)");
    if (edge < cfg.minEv) reasons.push("vantaggio non dimostrato dopo la rimodulazione sul mercato");
  }
  if (reasons.length) return { tier: "D", edge, reasons };
  if (!evidence || !Number.isFinite(evidence.c) || !Number.isFinite(evidence.se) || !(evidence.clusters >= cfg.minClusters)) return { tier: "C", edge, reasons: ["campione insufficiente per questa categoria"] };
  if (evidence.c - cfg.zStrong * evidence.se > 0 && edge >= cfg.strongEv) return { tier: "A", edge, reasons: ["il modello aggiunge informazione al mercato in questa categoria (prova robusta)", "vantaggio netto dopo la rimodulazione"] };
  if (evidence.c - cfg.zInteresting * evidence.se > 0) return { tier: "B", edge, reasons: ["il modello aggiunge informazione al mercato in questa categoria", "prova non ancora robusta"] };
  return { tier: "C", edge, reasons: ["il modello non ha dimostrato di aggiungere informazione al mercato in questa categoria"] };
}

/** Una doppia si propone solo se entrambe le gambe sono A/B, gli eventi non sono correlati, la probabilità congiunta e l'EV superano le soglie e il rapporto EV/rischio batte la migliore singola. */
export function evaluateDouble(a, b, cfg = STRATEGY2) {
  const reasons = [], ok = (l) => l?.tier === "A" || l?.tier === "B";
  if (!ok(a) || !ok(b)) reasons.push("serve che entrambe le singole siano di classe A o B");
  if (a?.tournament && a.tournament === b?.tournament) reasons.push("stesso torneo: eventi correlati");
  const pJoint = (a?.pAdj ?? 0) * (b?.pAdj ?? 0), oddsJoint = (a?.odds ?? 0) * (b?.odds ?? 0), ev = pJoint * oddsJoint - 1;
  const ratio = (p, o) => ((p * o - 1) / (o * Math.sqrt(p * (1 - p)) || Infinity));
  const best = Math.max(ratio(a?.pAdj ?? 0.5, a?.odds ?? 1), ratio(b?.pAdj ?? 0.5, b?.odds ?? 1));
  if (pJoint < cfg.doubleMinJointProb) reasons.push("probabilità congiunta troppo bassa");
  if (ev < cfg.doubleMinEv) reasons.push("vantaggio della doppia insufficiente");
  if (!reasons.length && ratio(pJoint, oddsJoint) < best) reasons.push("peggiore delle singole a parità di rischio");
  // LIMITE DOCUMENTATO: pJoint = prodotto delle probabilità singole = ipotesi di INDIPENDENZA, mai verificata. Tornei diversi non dimostrano l'indipendenza
  // (stessa giornata, stessa superficie, stessi errori sistematici del modello e del mercato possono correlare i risultati). Finché non esiste una stima validata
  // delle probabilità congiunte (vedi `jointIndependenceCheck` in scripts/tennis-strategy-audit-v5.js e la validazione prospettica), una doppia NON è validata
  // e non va presentata con un vantaggio statistico: `propose` resta una proposta sperimentale in Shadow Mode, non una prova.
  return { propose: reasons.length === 0, pJoint, oddsJoint, ev, reasons, validated: false, independenceAssumed: true, limitation: "Probabilità congiunta = prodotto delle singole (indipendenza assunta, non verificata): doppia non validata, nessun vantaggio statistico attribuibile." };
}
