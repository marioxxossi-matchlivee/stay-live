/**
 * Modello statistico Stay Live (gol; i corner hanno il loro modello in _cornerstats.js). Dati storici: solo API-Football.
 * Poisson indipendente con forza attacco/difesa pesata sulle ultime partite.
 * Tutte le costanti sono qui e vengono mostrate all'utente: nulla è nascosto.
 */
export const MODEL = {
  priorHome: 1.5, priorAway: 1.2, priorWeight: 30, // media gol di partenza (casa/trasferta) e peso in "partite"
  minLeagueMatches: 20,   // sotto questa soglia il campionato usa la media di tutti i campionati
  decay: 0.92,            // peso della k-esima partita più vecchia = decay^k
  shrinkK: 4,             // "partite fittizie" mescolate ai gol attesi stagionali del provider (afProbabilities)
  formShrinkK: 24,        // "partite fittizie" di valore medio mescolate alla forma recente della squadra (teamForm). Era 4: sui dati reali
                          // (2.126 partite, 2026) con 4 il modello storico peggiorava la media di campionato (Brier 0,251 vs 0,243) e dichiarava
                          // Under al 63% che uscivano al 46%. Con 24 (≈ 30 partite non pesate) le percentuali dichiarate coincidono con quelle reali.
  lambdaMin: 0.2, lambdaMax: 4,
  maxGoals: 10,
  uncertainty: 0.30,      // SOLO metodo "legacy" (confronto nei backtest): delta = uncertainty / sqrt(partite campione)
  // Probabilità prudente (metodo "posterior"): l'incertezza sui gol attesi viene dal numero effettivo di partite osservate
  // (varianza bayesiana: dati poissoniani + dispersione tra squadre `teamSd`), si propaga con una griglia 7x7 di scenari e si
  // prende il quantile `pLowQuantile` della probabilità. Non è più "la peggiore di 5 scenari" con un delta scelto a mano.
  pLowMethod: "posterior", pLowQuantile: 0.20, teamSd: 0.25, sdMax: 0.6,
  rho: 0,                 // Dixon-Coles: correzione dei punteggi bassi. 0 = Poisson indipendente. Va stimato con `npm run backtest -- --tune`; non attivato senza dati.
  minSample: 3, betSample: 5,
  betThreshold: 0.60,     // probabilità prudente minima per un BET senza quota
  minEdge: 0.08,          // la prob. prudente deve superare di 8 punti la frequenza storica dell'esito nel campionato
  edgeMode: "points",     // "points" (attuale): vantaggio in punti sulla media del campionato; "ratio": vantaggio relativo (solo per il backtest delle regole)
  minEdgeRatio: 0.145,    // con edgeMode "ratio": pLow almeno il 14,5% sopra la media (= +8 punti per un esito al 55%)
  maxUsefulProb: 0.80,    // oltre: quota equa < 1,25, esito non interessante
  edgeMargin: 1.03,       // valore atteso minimo: prob. prudente x quota >= 1,03
  longshotFloor: 0.40,    // con quota inserita non si consiglia sotto questa prob. prudente
  // Mercati preferiti: tra i BET della stessa partita passano davanti a 1X2, doppia chance, gol/no gol.
  // Per aggiungere i corner basta inserire qui il nome del mercato (es. "Corner totali") quando ci saranno i dati.
  preferredMarkets: [],   // nessun mercato preferito a priori: il mercato lo decide il valore atteso, non l'etichetta
  // Gestione del budget (puntate). Le quote reali non sono note: se non le inserisci si usa una stima.
  bookMargin: 0.06,       // margine medio del bookmaker: quota stimata = quota equa / (1 + margine)
  kellyFraction: 0.25,    // si punta un quarto della frazione di Kelly (molto più prudente del Kelly pieno)
  maxStakePct: 0.05,      // massimo 5% del budget su una singola
  maxAccStakePct: 0.02,   // massimo 2% sulla multipla
  maxTotalPct: 0.20,      // massimo 20% del budget esposto in totale
  stakeStep: 0.5,         // le puntate sono arrotondate a 0,50 €
  // CERVELLO UNICO: ogni probabilità è la fusione pesata di tre fonti, per ogni singola selezione (se una manca, i pesi si ridistribuiscono):
  //   storico = Poisson sulle ultime partite · api = pronostico di API-Football (1X2 e gol attesi stagionali) · mercato = quote di API-Football senza margine.
  weights: { storico: 0.25, api: 0.40, mercato: 0.35 },
  marketMargin: 0.03,     // sulla probabilità del mercato si tolgono 3 punti per la probabilità prudente
  spreadPenalty: 0.30,    // se le fonti sono in disaccordo, la probabilità prudente cala del 30% della distanza tra la più alta e la più bassa
  injPenalty: 0.008,      // ogni assente confermato (max 8) toglie 0,8 punti alla probabilità prudente: più incertezza, non una previsione sul singolo giocatore
  // Multiple: una gamba per partita, SOLO con quote reali di mercato e valore atteso prudente non negativo (pLow x quota >= legMinEv).
  // La multipla è proposta solo se anche la probabilità congiunta prudente x quota totale >= edgeMargin. Nessuna quota stimata: mai.
  legMinP: 0.62, legMinOdds: 1.15, legMinEv: 1.0,
  maxLegsPerLeague: 2,    // vincolo di rischio: al massimo 2 gambe dello stesso campionato nella stessa multipla
  maxCandidates: 12,      // partite considerate dalla ricerca esaustiva (ognuna con le sue 2 gambe migliori)
  multiTiers: [
    { key: "prudente", label: "Multipla prudente", lo: 1.8, hi: 3.0, maxLegs: 3, objective: "prob", note: "Poche selezioni, priorità alla probabilità congiunta prudente. Rischio comunque alto: nessuna multipla è sicura." },
    { key: "equilibrata", label: "Multipla equilibrata", lo: 3.0, hi: 6, maxLegs: 4, objective: "growth", note: "Massimizza la crescita attesa del capitale (Kelly) sulla probabilità congiunta prudente." },
    { key: "alto-rendimento", label: "Multipla ad alto rendimento", lo: 6, hi: 14, maxLegs: 5, objective: "growth", note: "Quota alta e probabilità congiunta bassa: si perde molto più spesso di quanto si vince." },
  ],
  afDelta: 0.15,          // incertezza dei gol attesi del provider (stagione intera: più stabile delle sole ultime partite)
  afMargin: 0.05,         // sulle percentuali 1X2 del provider si toglie 5 punti per la probabilità prudente
  afAdviceShift: 0,       // era +6 punti: il consiglio del provider deriva dagli stessi dati delle sue percentuali (doppio conteggio) e non era validato
  afAgree: 0.50,          // stima del provider >= 50% = conferma; < 35% = contraddice (il BET non passa)
  afContrast: 0.35,
};

export const SELECTIONS = [
  { key: "home", market: "Esito finale 1X2", label: "1 · Vittoria casa" },
  { key: "draw", market: "Esito finale 1X2", label: "X · Pareggio" },
  { key: "away", market: "Esito finale 1X2", label: "2 · Vittoria trasferta" },
  { key: "dc1x", market: "Doppia chance", label: "1X · Casa o pareggio" },
  { key: "dcx2", market: "Doppia chance", label: "X2 · Pareggio o trasferta" },
  { key: "dc12", market: "Doppia chance", label: "12 · Niente pareggio" },
  { key: "over15", market: "Gol totali", label: "Over 1,5" },
  { key: "under15", market: "Gol totali", label: "Under 1,5" },
  { key: "over25", market: "Gol totali", label: "Over 2,5" },
  { key: "under25", market: "Gol totali", label: "Under 2,5" },
  { key: "over35", market: "Gol totali", label: "Over 3,5" },
  { key: "under35", market: "Gol totali", label: "Under 3,5" },
  { key: "btts", market: "Entrambe segnano", label: "Gol (entrambe segnano)" },
  { key: "nobtts", market: "Entrambe segnano", label: "No Gol" },
];

export const isPreferred = (sel) => MODEL.preferredMarkets.includes(sel.market);

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const POW10 = [1, 10, 100, 1e3, 1e4, 1e5, 1e6];
const round = (v, d = 4) => (Number.isFinite(v) ? Math.round(v * (POW10[d] ?? 10 ** d)) / (POW10[d] ?? 10 ** d) : null);   // niente toFixed: converte in stringa ed è lentissimo se chiamato migliaia di volte

export function poissonPmf(lambda, max = MODEL.maxGoals) {
  const out = [Math.exp(-lambda)];
  for (let k = 1; k <= max; k += 1) out.push((out[k - 1] * lambda) / k);
  return out;
}

/** Matrice P(casa=i, trasferta=j), normalizzata a 1 (la coda oltre 10 gol è trascurabile). */
export function scoreMatrix(lh, la, rho = MODEL.rho) {
  const ph = poissonPmf(lh);
  const pa = poissonPmf(la);
  const m = ph.map((a) => pa.map((b) => a * b));
  if (rho) {                                    // Dixon-Coles (1997): corregge solo 0-0, 0-1, 1-0, 1-1
    m[0][0] *= Math.max(0, 1 - lh * la * rho);
    m[0][1] *= Math.max(0, 1 + lh * rho);
    m[1][0] *= Math.max(0, 1 + la * rho);
    m[1][1] *= Math.max(0, 1 - rho);
  }
  const total = m.reduce((t, row) => t + row.reduce((u, v) => u + v, 0), 0);
  return m.map((row) => row.map((v) => v / total));
}

export function marketsFromMatrix(m) {
  const p = Object.fromEntries(SELECTIONS.map((s) => [s.key, 0]));
  m.forEach((row, i) => row.forEach((v, j) => {
    if (i > j) p.home += v; else if (i === j) p.draw += v; else p.away += v;
    const t = i + j;
    if (t > 1) p.over15 += v;
    if (t > 2) p.over25 += v;
    if (t > 3) p.over35 += v;
    if (i > 0 && j > 0) p.btts += v;
  }));
  p.dc1x = p.home + p.draw; p.dcx2 = p.draw + p.away; p.dc12 = p.home + p.away;
  p.under15 = 1 - p.over15; p.under25 = 1 - p.over25; p.under35 = 1 - p.over35;
  p.nobtts = 1 - p.btts;
  return p;
}

const ZERO_MARKETS = Object.fromEntries(SELECTIONS.map((s) => [s.key, 0]));
/**
 * Probabilità di tutti i mercati per gol attesi (lh, la): stesso risultato di marketsFromMatrix(scoreMatrix(lh, la)) ma senza creare
 * matrici (nessun array annidato): è la funzione chiamata decine di volte per partita, e su Cloudflare il tempo di calcolo è limitato.
 */
export function probabilities(lh, la, rho = MODEL.rho) {
  const n = MODEL.maxGoals;
  const ph = poissonPmf(lh, n), pa = poissonPmf(la, n);
  const c00 = rho ? Math.max(0, 1 - lh * la * rho) : 1, c01 = rho ? Math.max(0, 1 + lh * rho) : 1, c10 = rho ? Math.max(0, 1 + la * rho) : 1, c11 = rho ? Math.max(0, 1 - rho) : 1;
  let total = 0, home = 0, draw = 0, away = 0, o15 = 0, o25 = 0, o35 = 0, btts = 0;
  for (let i = 0; i <= n; i += 1) {
    for (let j = 0; j <= n; j += 1) {
      let v = ph[i] * pa[j];
      if (i < 2 && j < 2) v *= i === 0 ? (j === 0 ? c00 : c01) : (j === 0 ? c10 : c11);
      total += v;
      if (i > j) home += v; else if (i === j) draw += v; else away += v;
      const t = i + j;
      if (t > 1) o15 += v;
      if (t > 2) o25 += v;
      if (t > 3) o35 += v;
      if (i > 0 && j > 0) btts += v;
    }
  }
  const p = { ...ZERO_MARKETS };
  p.home = home / total; p.draw = draw / total; p.away = away / total;
  p.over15 = o15 / total; p.over25 = o25 / total; p.over35 = o35 / total; p.btts = btts / total;
  p.dc1x = p.home + p.draw; p.dcx2 = p.draw + p.away; p.dc12 = p.home + p.away;
  p.under15 = 1 - p.over15; p.under25 = 1 - p.over25; p.under35 = 1 - p.over35;
  p.nobtts = 1 - p.btts;
  return p;
}

/** Probabilità "prudente": la peggiore tra 5 scenari (attese gol base, entrambe +-delta, una +delta e l'altra -delta). */
export function stressedProbabilities(lh, la, delta) {
  const scenarios = [[1, 1], [1 - delta, 1 - delta], [1 + delta, 1 + delta], [1 - delta, 1 + delta], [1 + delta, 1 - delta]];
  const low = {};
  for (const [fh, fa] of scenarios) {
    const p = probabilities(clamp(lh * fh, 0.05, 6), clamp(la * fa, 0.05, 6));
    for (const key of Object.keys(p)) low[key] = key in low ? Math.min(low[key], p[key]) : p[key];
  }
  return low;
}

/** Varianza relativa di un tasso di squadra: dati poissoniani (neff partite, g gol medi) combinati con la dispersione `teamSd` tra squadre. */
export const relVar = (neff, g) => 1 / (1 / MODEL.teamSd ** 2 + Math.max(0, neff) * Math.max(g, 0.1));

const GRID = [-3, -2, -1, 0, 1, 2, 3];
const GRID_W = (() => { const w = GRID.map((z) => Math.exp(-z * z / 2)), t = w.reduce((a, b) => a + b, 0); return w.map((x) => x / t); })();

/**
 * Probabilità prudente "posterior": i gol attesi sono incerti (lognormali, media preservata, sd relativa sdH/sdA); si calcola la probabilità
 * su una griglia 7x7 e, per ogni mercato, si prende il quantile q (default 20%) della distribuzione risultante.
 */
export function posteriorLowProbabilities(lh, la, sdH, sdA, q = MODEL.pLowQuantile) {
  const ws = [], ps = [];
  GRID.forEach((zh, i) => GRID.forEach((za, j) => {
    const h = clamp(lh * Math.exp(sdH * zh - sdH * sdH / 2), 0.05, 6), a = clamp(la * Math.exp(sdA * za - sdA * sdA / 2), 0.05, 6);
    ws.push(GRID_W[i] * GRID_W[j]); ps.push(probabilities(h, a));
  }));
  const out = {}, order = ws.map((_, i) => i);
  for (const key of Object.keys(ps[0])) {
    order.sort((x, y) => ps[x][key] - ps[y][key]);       // sort stabile: stessi risultati di prima, ma senza creare oggetti a ogni mercato
    let c = 0; out[key] = ps[order[order.length - 1]][key];
    for (const i of order) { c += ws[i]; if (c >= q - 1e-12) { out[key] = ps[i][key]; break; } }
  }
  return out;
}

/**
 * Probabilità "secondo API-Football" per ogni selezione (null dove il provider non dà informazione).
 * 1X2 e doppia chance dalle sue percentuali; gol/Over/Under/BTTS da un Poisson sui suoi gol attesi (medie stagionali, avvicinate alla media del campionato
 * quando ha giocato poco); il consiglio Over/Under sposta di afAdviceShift la linea indicata.
 */
export function afProbabilities(af, base) {
  if (!af) return null;
  const p = {}, low = {};
  if (af.lambda) {
    const w = Math.max(af.played ?? 0, 0);
    const shrinkTo = (v, mu) => clamp((w * v + MODEL.shrinkK * mu) / (w + MODEL.shrinkK), MODEL.lambdaMin, MODEL.lambdaMax);
    const lh = shrinkTo(af.lambda.home, base.home), la = shrinkTo(af.lambda.away, base.away);
    Object.assign(p, probabilities(lh, la));
    Object.assign(low, stressedProbabilities(lh, la, MODEL.afDelta));
    p._lambda = { home: round(lh, 3), away: round(la, 3) };
  }
  if (af.percent) {
    const { home, draw, away } = af.percent;
    Object.assign(p, { home, draw, away, dc1x: home + draw, dcx2: draw + away, dc12: home + away });
    for (const k of ["home", "draw", "away", "dc1x", "dcx2", "dc12"]) low[k] = Math.max(0, p[k] - MODEL.afMargin);
  }
  const uo = af.underOver;
  const lineKey = uo && [1.5, 2.5, 3.5].includes(uo.line) ? String(uo.line * 10) : null;
  if (lineKey) {
    const key = `${uo.side}${lineKey}`, opp = `${uo.side === "over" ? "under" : "over"}${lineKey}`;
    if (key in p) { p[key] = Math.min(0.99, p[key] + MODEL.afAdviceShift); low[key] = Math.min(p[key], low[key] + MODEL.afAdviceShift); p[opp] = Math.max(0.01, p[opp] - MODEL.afAdviceShift); low[opp] = Math.max(0, low[opp] - MODEL.afAdviceShift); }
    else { p[key] = null; }
  }
  return { p, low };
}

/** Pesi effettivi delle fonti disponibili (sommano a 1). */
export function fusionWeights(hasApi, hasMarket) {
  const w = { storico: MODEL.weights.storico, api: hasApi ? MODEL.weights.api : 0, mercato: hasMarket ? MODEL.weights.mercato : 0 };
  const t = w.storico + w.api + w.mercato;
  return { storico: w.storico / t, api: w.api / t, mercato: w.mercato / t };
}

/** Quote di mercato (già senza margine) -> probabilità e probabilità prudente (meno marketMargin). */
export function marketProbabilities(market) {
  if (!market?.p) return null;
  const p = { ...market.p };
  const low = Object.fromEntries(Object.entries(p).map(([k, v]) => [k, Math.max(0, v - MODEL.marketMargin)]));
  return { p, low };
}

/**
 * Il cervello: fonde le fonti di UNA selezione. src = { storico, api, mercato } con { p, low } (null se la fonte non ha quella selezione).
 * Restituisce p, pLow, distanza tra le fonti (spread) e il giudizio degli esterni (API-Football / mercato).
 */
export function fuse(src, weights, injPen = 0) {
  let p = 0, low = 0, wsum = 0;
  const ps = [];
  for (const k of ["storico", "api", "mercato"]) {
    if (!src[k] || !(weights[k] > 0)) continue;
    p += weights[k] * src[k].p; low += weights[k] * src[k].low; wsum += weights[k]; ps.push(src[k].p);
  }
  p /= wsum; low /= wsum;
  const spread = ps.length > 1 ? Math.max(...ps) - Math.min(...ps) : 0;
  const pLow = clamp(Math.min(p, low) - MODEL.spreadPenalty * spread - injPen, 0, 1);
  const ext = [["API-Football", src.api], ["il mercato", src.mercato]].filter(([, x]) => x);
  const worst = ext.reduce((m, [n, x]) => (!m || x.p < m.p ? { n, p: x.p } : m), null);
  const agree = !ext.length ? null : worst.p < MODEL.afContrast ? "contraddice" : ext.every(([, x]) => x.p >= MODEL.afAgree) ? "conferma" : "neutro";
  return { p, pLow, spread, agree, agreeBy: worst?.n ?? null, pWorst: worst?.p ?? null };
}

export function confidenceLabel(sample) {
  if (sample < MODEL.minSample) return "insufficiente";
  if (sample < MODEL.betSample) return "bassa";
  if (sample < 8) return "media";
  return "buona";
}

/** Esiti (0/1) di un risultato finale, per ogni selezione. */
export function outcomes(hg, ag) {
  const t = hg + ag;
  return {
    home: +(hg > ag), draw: +(hg === ag), away: +(hg < ag), dc1x: +(hg >= ag), dcx2: +(hg <= ag), dc12: +(hg !== ag),
    over15: +(t > 1), under15: +(t <= 1), over25: +(t > 2), under25: +(t <= 2), over35: +(t > 3), under35: +(t <= 3),
    btts: +(hg > 0 && ag > 0), nobtts: +!(hg > 0 && ag > 0),
  };
}

/** finals: righe {league,kickoff_at,home_id,away_id,home_name,away_name,home_score,away_score,neutral_site} */
export function buildContext(finals) {
  // Le partite decise ai supplementari o ai rigori hanno nel punteggio anche i gol oltre il 90': falserebbero medie e frequenze (nel database sono ~0,7%).
  const valid = finals.filter((f) => Number.isFinite(f.home_score) && Number.isFinite(f.away_score) && Date.parse(f.kickoff_at) && f.decided_in !== "extra_time" && f.decided_in !== "penalties");
  const acc = new Map();
  const pooled = { n: 0, h: 0, a: 0 };
  const freq = new Map(); // frequenza storica di ogni esito, per campionato e totale
  const bump = (id, probs) => {
    const x = freq.get(id) ?? { n: 0, hits: Object.fromEntries(SELECTIONS.map((s) => [s.key, 0])) };
    x.n += 1; for (const k of Object.keys(probs)) x.hits[k] += probs[k]; freq.set(id, x);
  };
  for (const f of valid) {
    const o = outcomes(f.home_score, f.away_score);
    bump(f.league, o); bump("*", o);
    if (f.neutral_site) continue;
    const a = acc.get(f.league) ?? { n: 0, h: 0, a: 0 };
    a.n += 1; a.h += f.home_score; a.a += f.away_score; acc.set(f.league, a);
    pooled.n += 1; pooled.h += f.home_score; pooled.a += f.away_score;
  }
  const shrink = (x) => ({
    n: x.n,
    home: (x.h + MODEL.priorWeight * MODEL.priorHome) / (x.n + MODEL.priorWeight),
    away: (x.a + MODEL.priorWeight * MODEL.priorAway) / (x.n + MODEL.priorWeight),
  });
  const pooledBase = shrink(pooled);
  const baseline = (league) => {
    const own = acc.get(league);
    const b = own && own.n >= MODEL.minLeagueMatches ? shrink(own) : pooledBase;
    return { ...b, avgGoals: b.home + b.away, perTeam: (b.home + b.away) / 2, scope: own && own.n >= MODEL.minLeagueMatches ? "campionato" : "tutti i campionati" };
  };
  const baseRates = (league) => {
    const own = freq.get(league);
    const x = own && own.n >= MODEL.minLeagueMatches ? own : freq.get("*");
    return x ? Object.fromEntries(Object.entries(x.hits).map(([k, v]) => [k, v / x.n])) : null;
  };
  const teams = new Map();
  const push = (id, row) => { if (!teams.has(id)) teams.set(id, []); teams.get(id).push(row); };
  for (const f of valid) {
    const g = baseline(f.league).perTeam;
    const t = Date.parse(f.kickoff_at);
    push(f.home_id, { t, gf: f.home_score, ga: f.away_score, att: f.home_score / g, def: f.away_score / g, venue: "C", opp: f.away_name, league: f.league });
    push(f.away_id, { t, gf: f.away_score, ga: f.home_score, att: f.away_score / g, def: f.home_score / g, venue: "T", opp: f.home_name, league: f.league });
  }
  for (const list of teams.values()) list.sort((x, y) => y.t - x.t);
  return { baseline, baseRates, teams, matchCount: valid.length };
}

export function teamForm(teamId, before, ctx, n) {
  const rows = [];
  for (const r of ctx.teams.get(teamId) ?? []) {
    if (r.t < before) rows.push(r);
    if (rows.length >= n) break;
  }
  let w = 0, w2 = 0, att = 0, def = 0, gf = 0, ga = 0;
  rows.forEach((r, k) => {
    const wk = MODEL.decay ** k;
    w += wk; w2 += wk * wk; att += wk * r.att; def += wk * r.def; gf += wk * r.gf; ga += wk * r.ga;
  });
  const attRaw = w ? att / w : 1;
  const defRaw = w ? def / w : 1;
  return {
    n: rows.length,
    neff: w2 ? round((w * w) / w2, 3) : 0,        // numero effettivo di partite (Kish) dopo il decadimento temporale
    weightSum: round(w, 3),
    gfAvg: w ? round(gf / w, 2) : null,
    gaAvg: w ? round(ga / w, 2) : null,
    attackRaw: round(attRaw, 3),
    defenseRaw: round(defRaw, 3),
    attack: round((w * attRaw + MODEL.formShrinkK) / (w + MODEL.formShrinkK), 3),
    defense: round((w * defRaw + MODEL.formShrinkK) / (w + MODEL.formShrinkK), 3),
    last: rows.slice(0, 5).map((r) => ({ date: new Date(r.t).toISOString().slice(0, 10), opp: r.opp, venue: r.venue, gf: r.gf, ga: r.ga })),
  };
}

export function verdictFor(sel, sample, odds = null) {
  if (sample < MODEL.betSample) return { verdict: "EVITA", reason: `Campione troppo piccolo (${sample} partite, ne servono ${MODEL.betSample}).` };
  if (sel.agree === "contraddice") return { verdict: "EVITA", reason: `${sel.agreeBy ?? "API-Football"} non è d'accordo: stima ${((sel.pWorst ?? sel.pApi) * 100).toFixed(0)}% per questo esito.` };
  const real = sel.odds?.median > 1 ? sel.odds.median : null;     // quota reale di mercato per questa selezione (se il mercato la quota)
  if (!(Number.isFinite(odds) && odds > 1) && real) odds = real;
  if (Number.isFinite(odds) && odds > 1) {
    const ev = sel.pLow * odds;
    if (sel.pLow < MODEL.longshotFloor) return { verdict: "EVITA", reason: "Probabilità prudente troppo bassa anche con quota alta." };
    return ev >= MODEL.edgeMargin
      ? { verdict: "BET", reason: `Valore atteso prudente +${((ev - 1) * 100).toFixed(1).replace(".", ",")}%.` }
      : { verdict: "EVITA", reason: `Quota troppo bassa: serve almeno ${sel.minOdds.toFixed(2).replace(".", ",")}.` };
  }
  const edgePts = sel.edge == null ? null : `${sel.edge >= 0 ? "+" : "−"}${Math.abs(sel.edge * 100).toFixed(0)}`;
  const edgeText = edgePts == null ? "" : ` (${edgePts} punti sulla media del campionato)`;
  if (sel.pLow < MODEL.betThreshold) return { verdict: "EVITA", reason: `Probabilità prudente ${(sel.pLow * 100).toFixed(0)}% sotto la soglia ${(MODEL.betThreshold * 100).toFixed(0)}%.` };
  const edgeOk = MODEL.edgeMode === "ratio" ? sel.base > 0 && sel.pLow / sel.base - 1 >= MODEL.minEdgeRatio : sel.edge != null && sel.edge >= MODEL.minEdge;
  if (sel.edge == null || !edgeOk) return { verdict: "EVITA", reason: `Esito probabile ma ${edgePts == null ? "in linea con la media del campionato" : `${edgePts} punti sulla media del campionato`}: niente di speciale in questa partita.` };
  return { verdict: "BET", reason: `Probabilità prudente ${(sel.pLow * 100).toFixed(0)}%${edgeText}. Senza quota reale il valore NON è verificato: gioca solo se la quota è almeno ${sel.minOdds.toFixed(2).replace(".", ",")}.` };
}

const afRank = (s) => (s.agree === "conferma" ? 0 : s.agree === "contraddice" ? 2 : 1);

export function analyzeMatch(match, ctx, { n = 8, af = null, market = null, inj = null } = {}) {
  const before = Date.parse(match.kickoff_at) || Date.now();
  const base = ctx.baseline(match.league);
  const home = teamForm(match.home_id, before, ctx, n);
  const away = teamForm(match.away_id, before, ctx, n);
  const neutral = Boolean(match.neutral_site);
  const muH = neutral ? base.perTeam : base.home;
  const muA = neutral ? base.perTeam : base.away;
  const lh = clamp(muH * home.attack * away.defense, MODEL.lambdaMin, MODEL.lambdaMax);
  const la = clamp(muA * away.attack * home.defense, MODEL.lambdaMin, MODEL.lambdaMax);
  const m = scoreMatrix(lh, la);
  const p = marketsFromMatrix(m);
  const recent = Math.min(home.n, away.n);
  const afP = afProbabilities(af, base);
  const mkP = marketProbabilities(market);
  // Con il pronostico del provider il campione è la stagione intera (fino a 8 partite contano come campione pieno).
  const sample = afP ? Math.max(recent, Math.min(af.played ?? 0, 8)) : recent;
  const g = base.perTeam;
  const sdH = Math.min(MODEL.sdMax, Math.sqrt(relVar(home.neff, g) + relVar(away.neff, g)));   // attacco casa + difesa trasferta
  const sdA = Math.min(MODEL.sdMax, Math.sqrt(relVar(away.neff, g) + relVar(home.neff, g)));
  const legacy = MODEL.pLowMethod === "legacy";
  const delta = legacy ? MODEL.uncertainty / Math.sqrt(Math.max(recent, 1)) : (sdH + sdA) / 2;
  const low = legacy ? stressedProbabilities(lh, la, delta) : posteriorLowProbabilities(lh, la, sdH, sdA);
  const base_ = ctx.baseRates(match.league);
  const weights = fusionWeights(Boolean(afP), Boolean(mkP));
  const absent = inj ? (inj.home ?? 0) + (inj.away ?? 0) : 0;
  const injPen = Math.min(8, absent) * MODEL.injPenalty;

  const selections = SELECTIONS.map((s) => {
    const src = {
      storico: { p: p[s.key], low: Math.min(low[s.key], p[s.key]) },
      api: afP?.p[s.key] != null ? { p: afP.p[s.key], low: afP.low[s.key] } : null,
      mercato: mkP?.p[s.key] != null ? { p: mkP.p[s.key], low: mkP.low[s.key] } : null,
    };
    const f = fuse(src, weights, injPen);
    const sel = {
      ...s,
      p: round(f.p),
      pLow: round(f.pLow),
      pModel: round(p[s.key]),
      pApi: src.api ? round(src.api.p) : null,
      pMarket: src.mercato ? round(src.mercato.p) : null,
      spread: round(f.spread),
      agree: f.agree, agreeBy: f.agreeBy, pWorst: f.pWorst == null ? null : round(f.pWorst),
      fairOdds: round(1 / f.p, 2),
      odds: market?.odds?.[s.key] ?? null,                              // quota reale (mediana/migliore) se il mercato quota direttamente questa selezione
    };
    sel.minOdds = round(MODEL.edgeMargin / sel.pLow, 2);
    // Valore atteso solo su quote REALI: ev = p x quota - 1 (centrale), evLow = pLow x quota - 1 (prudente). Senza quota reale: null, mai una stima.
    sel.ev = sel.odds ? round(sel.p * sel.odds.median - 1, 3) : null;
    sel.evLow = sel.odds ? round(sel.pLow * sel.odds.median - 1, 3) : null;
    sel.base = base_ ? round(base_[s.key]) : null;
    sel.edge = base_ ? round(sel.pLow - base_[s.key]) : null;
    Object.assign(sel, verdictFor(sel, sample));
    sel.verified = Boolean(sel.odds) && sel.verdict === "BET" && sel.pLow * sel.odds.median >= MODEL.edgeMargin;   // vantaggio dimostrato su quota reale
    return sel;
  });

  // Gambe per le multiple: solo selezioni con quota REALE di mercato e valore atteso prudente non negativo (pLow x quota >= legMinEv).
  // Nessuna quota stimata: una stima non può dimostrare un vantaggio. Ordinate per valore atteso prudente.
  const legs = sample < MODEL.betSample ? [] : selections
    .filter((x) => x.odds && x.agree !== "contraddice" && x.pLow >= MODEL.legMinP && x.odds.median >= MODEL.legMinOdds && x.pLow * x.odds.median >= MODEL.legMinEv)
    .map((x) => ({ key: x.key, label: x.label, market: x.market, p: x.p, pLow: x.pLow, spread: x.spread, agree: x.agree, odds: x.odds.median, oddsSource: "mercato", bestOdds: x.odds.best ?? null, book: x.odds.book ?? null,
      edge: round(x.p * x.odds.median - 1, 3), evLow: round(x.pLow * x.odds.median - 1, 3) }))
    .sort((x, y) => y.evLow - x.evLow)
    .slice(0, 3);

  // Con quota reale decide il valore atteso (nessun filtro sulla probabilità); senza quota resta il filtro "quota equa >= 1,25".
  const ranked = selections.filter((s) => s.odds || s.p <= MODEL.maxUsefulProb)
    .sort((x, y) => (y.verdict === "BET") - (x.verdict === "BET")
      || (y.verified) - (x.verified)                                   // prima il vantaggio dimostrato su quota reale...
      || (x.verified && y.verified ? y.evLow - x.evLow : 0)            // ...ordinato per valore atteso prudente
      || (y.verdict === "BET" && isPreferred(y)) - (x.verdict === "BET" && isPreferred(x))
      || afRank(x) - afRank(y)                                         // a parità, prima ciò che API-Football conferma
      || (y.edge ?? -1) - (x.edge ?? -1) || y.pLow - x.pLow);
  const pick = ranked[0] ?? null;
  const scores = [];
  m.forEach((row, i) => row.forEach((v, j) => scores.push({ score: `${i}-${j}`, p: round(v) })));
  scores.sort((a, b) => b.p - a.p);

  return {
    sample, confidence: confidenceLabel(sample), n,
    basis: afP && mkP ? "api+mercato" : afP ? "api" : mkP ? "mercato" : "storico",
    fusion: { weights, sources: { storico: true, api: Boolean(afP), mercato: Boolean(mkP) }, absent: inj ? { home: inj.home ?? 0, away: inj.away ?? 0 } : null, injPenalty: round(injPen), books: market?.books ?? null },
    api: af ? { used: Boolean(afP), weight: weights.api, percent: af.percent, underOver: af.underOver, advice: af.advice, adviceIt: af.adviceIt ?? null, winner: af.winner, lambda: afP?.p._lambda ?? null, played: af.played } : null,
    inputs: {
      baseline: { home: round(base.home, 3), away: round(base.away, 3), perTeam: round(base.perTeam, 3), sample: base.n, scope: base.scope },
      neutral, home, away, delta: round(delta, 3), sd: { home: round(sdH, 3), away: round(sdA, 3) }, pLowMethod: MODEL.pLowMethod, rho: MODEL.rho,
    },
    lambda: { home: round(lh, 3), away: round(la, 3), total: round(lh + la, 3) },
    selections, legs, pick, alternatives: ranked.slice(1, 4), topScores: scores.slice(0, 3),
    recommended: ranked.filter((s) => s.verdict === "BET").slice(0, 3).map((s) => s.key),      // solo ciò che si consiglia di giocare (max 3), in ordine
  };
}

/** Versione compatta per le liste. */
export function compactPick(analysis) {
  const s = analysis.pick;
  if (!s) return null;
  return { key: s.key, label: s.label, market: s.market, preferred: isPreferred(s), p: s.p, pLow: s.pLow, minOdds: s.minOdds, estOdds: estimateOdds(s.p), verdict: s.verdict,
    reason: s.reason, confidence: analysis.confidence, sample: analysis.sample, expectedGoals: analysis.lambda.total,
    basis: analysis.basis, pApi: s.pApi, pModel: s.pModel, pMarket: s.pMarket, agree: s.agree,
    odds: s.odds ? { median: s.odds.median, best: s.odds.best ?? null, book: s.odds.book ?? null } : null, ev: s.ev, evLow: s.evLow, verified: s.verified };
}

/** Over/Under 2,5 in breve (per la modalità personalizzata): i due lati e il migliore. null se il campione è insufficiente. */
export function ou25Of(analysis) {
  if (!analysis || analysis.confidence === "insufficiente") return null;
  const pick = (k) => { const s = analysis.selections.find((x) => x.key === k); return s ? { key: s.key, side: k.startsWith("over") ? "over" : "under", p: s.p, pLow: s.pLow, pApi: s.pApi, agree: s.agree, minOdds: s.minOdds } : null; };
  const over = pick("over25"), under = pick("under25");
  const best = over && under ? (over.p >= under.p ? over : under) : over ?? under;
  return best ? { best, over, under, basis: analysis.basis, confidence: analysis.confidence } : null;
}

/**
 * Probabilità congiunta di gambe su partite DIVERSE (eventi indipendenti: l'ipotesi è dichiarata, non verificata sul campo).
 * p = prodotto delle probabilità; l'incertezza di ogni gamba (ln(p/pLow)) è indipendente dalle altre e si somma in quadratura,
 * non linearmente: pLow congiunta = p x exp(-sqrt(somma dei quadrati)). Il prodotto delle singole pLow sarebbe troppo severo.
 */
export function jointProbability(legs) {
  const p = legs.reduce((a, l) => a * l.p, 1);
  const d = Math.sqrt(legs.reduce((a, l) => a + Math.log(Math.max(l.p, 1e-9) / Math.max(Math.min(l.pLow, l.p), 1e-9)) ** 2, 0));
  return { p, pLow: p * Math.exp(-d) };
}

/** Crescita logaritmica attesa del capitale puntando la frazione di Kelly con probabilità q e quota o (0 se non c'è vantaggio). */
export function kellyGrowth(q, o) {
  if (!(o > 1) || !(q > 0)) return 0;
  const f = (q * o - 1) / (o - 1);
  return f > 0 ? q * Math.log(1 + f * (o - 1)) + (1 - q) * Math.log(1 - f) : 0;
}

/**
 * Multiple dal cervello unico. items = partite con `legs` (solo gambe con quota reale e valore atteso prudente >= legMinEv, vedi analyzeMatch).
 * Ricerca esaustiva (<= maxCandidates partite, 2 gambe ciascuna, 5 gambe al massimo, potatura sulla quota) di combinazioni di partite DIVERSE
 * con al massimo maxLegsPerLeague gambe per campionato. Una combinazione è ammessa solo se la probabilità congiunta prudente x quota totale >= edgeMargin.
 * Obiettivo per fascia: "prob" = probabilità congiunta prudente più alta; "growth" = crescita logaritmica attesa (Kelly) più alta.
 * Se nessuna combinazione ha valore, restituisce [] (meglio non giocare).
 * Restituisce [{ key, label, note, legs: [{ item, leg }], p, pLow, odds, source, ev, evLow, growth }].
 */
export function buildMultiples(items, tiers = MODEL.multiTiers) {
  const cands = items.map((item) => ({ item, opts: (item.legs ?? []).filter((l) => l.oddsSource === "mercato" && l.odds > 1).slice(0, 2) })).filter((c) => c.opts.length)
    .sort((a, b) => b.opts[0].evLow - a.opts[0].evLow).slice(0, MODEL.maxCandidates);
  const out = [], used = new Set();
  for (const t of tiers) {
    let best = null;
    const score = (jp, odds) => (t.objective === "prob" ? jp.pLow : kellyGrowth(jp.pLow, odds));
    const walk = (i, chosen, odds, perLeague) => {
      if (chosen.length >= 2 && odds >= t.lo - 1e-9 && odds <= t.hi + 1e-9) {
        const jp = jointProbability(chosen.map((c) => c.leg));
        if (jp.pLow * odds >= MODEL.edgeMargin) {
          const sig = chosen.map((c) => `${c.item.id}:${c.leg.key}`).sort().join("|");
          const sc = score(jp, odds);
          if (!used.has(sig) && (!best || sc > best.sc + 1e-12 || (Math.abs(sc - best.sc) <= 1e-12 && odds > best.odds))) best = { chosen: [...chosen], odds, jp, sc, sig };
        }
      }
      if (i >= cands.length || chosen.length >= t.maxLegs) return;
      for (let k = i; k < cands.length; k += 1) {
        const lg = cands[k].item.league;
        if (lg != null && (perLeague.get(lg) ?? 0) >= MODEL.maxLegsPerLeague) continue;
        for (const leg of cands[k].opts) {
          const o = odds * leg.odds;
          if (o > t.hi + 1e-9) continue;                                       // le quote si moltiplicano: oltre la fascia non si torna indietro
          const pl = new Map(perLeague); if (lg != null) pl.set(lg, (pl.get(lg) ?? 0) + 1);
          walk(k + 1, [...chosen, { item: cands[k].item, leg }], o, pl);
        }
      }
    };
    walk(0, [], 1, new Map());
    if (!best) continue;
    used.add(best.sig);
    const legs = best.chosen.sort((x, y) => Date.parse(x.item.kickoffAt) - Date.parse(y.item.kickoffAt));
    out.push({
      key: t.key, label: t.label, note: t.note, legs,
      p: round(best.jp.p), pLow: round(best.jp.pLow), odds: round(best.odds, 2), source: "mercato",
      ev: round(best.jp.p * best.odds - 1, 3), evLow: round(best.jp.pLow * best.odds - 1, 3), growth: round(kellyGrowth(best.jp.pLow, best.odds), 4),
    });
  }
  return out;
}

/* ---------- Quote stimate e puntate ---------- */

/** Quota che un bookmaker pagherebbe in media per una probabilità p: quota equa ridotta del margine. */
export function estimateOdds(p) {
  return p > 0 && p < 1 ? Math.max(1.01, round(1 / (p * (1 + MODEL.bookMargin)), 2)) : null;
}

const floorStep = (v) => Math.floor(v / MODEL.stakeStep + 1e-9) * MODEL.stakeStep;

/**
 * Puntata con Kelly frazionato sulla probabilità prudente. Se il valore atteso prudente
 * (pLow x quota) è sotto edgeMargin non si punta: stake = 0 e play = false.
 */
export function stakePlan({ pLow, odds, bankroll, maxPct = MODEL.maxStakePct }) {
  const none = { stake: 0, win: 0, ret: 0, ev: null, play: false };
  if (!(bankroll > 0) || !(odds > 1) || !(pLow > 0)) return none;
  const ev = pLow * odds;
  if (ev < MODEL.edgeMargin) return { ...none, ev: round(ev, 3) };
  const kelly = (pLow * odds - 1) / (odds - 1);
  const raw = bankroll * Math.min(maxPct, MODEL.kellyFraction * kelly);
  const stake = Math.min(bankroll, floorStep(raw));
  // Sotto la puntata minima non si arrotonda per eccesso (sarebbe più di Kelly e oltre i tetti): non si gioca.
  if (stake < MODEL.stakeStep) return { ...none, ev: round(ev, 3), belowMin: true };
  return { stake, win: round(stake * (odds - 1), 2), ret: round(stake * odds, 2), ev: round(ev, 3), play: true };
}

/**
 * Piano per una giocata. `odds` = quota reale inserita (opzionale); altrimenti quota stimata.
 * Se a quella quota non c'è valore, `conditional` dice quanto puntare SE il bookmaker paga almeno `need`.
 */
export function planFor({ pLow, p }, odds, bankroll, { maxPct = MODEL.maxStakePct, source = null } = {}) {
  const real = Number.isFinite(odds) && odds > 1;
  const est = estimateOdds(p);
  const used = real ? odds : est;
  const base = stakePlan({ pLow, odds: used, bankroll, maxPct });
  const out = { ...base, odds: used, est, source: source ?? (real ? "inserita" : "stimata"), pLow, p };
  if (!base.play && pLow > 0) {
    out.need = Math.ceil((MODEL.edgeMargin / pLow) * 100) / 100;
    out.conditional = stakePlan({ pLow, odds: out.need, bankroll, maxPct });
  }
  return out;
}

/** Multipla: probabilità e quote delle gambe si moltiplicano. legs = [{pLow, p, odds?}]. */
export function accumulatorPlan(legs, bankroll) {
  if (legs.length < 2) return null;
  const prod = (f) => legs.reduce((a, l) => a * f(l), 1);
  const { p, pLow } = jointProbability(legs);
  const allReal = legs.every((l) => l.real ?? (Number.isFinite(l.odds) && l.odds > 1));   // `real` esplicito: una quota stimata non è "reale"
  const odds = round(prod((l) => (Number.isFinite(l.odds) && l.odds > 1 ? l.odds : estimateOdds(l.p))), 2);
  return planFor({ pLow, p }, odds, bankroll, { maxPct: MODEL.maxAccStakePct, source: allReal ? "reale" : "stimata" });
}

/**
 * Se la somma delle puntate supera maxTotalPct del budget, le riduce nella stessa proporzione (arrotondando per difetto).
 * Una puntata che scende sotto il minimo non viene alzata: la giocata viene tolta. Così il totale non supera mai il tetto.
 */
export function applyCap(plans, bankroll) {
  const total = plans.reduce((s, x) => s + (x?.play ? x.stake : 0), 0);
  const cap = bankroll * MODEL.maxTotalPct;
  if (!(total > cap) || !(cap > 0)) return plans;
  const k = cap / total;
  return plans.map((x) => {
    if (!x?.play) return x;
    const stake = floorStep(x.stake * k);
    if (stake < MODEL.stakeStep) return { ...x, stake: 0, win: 0, ret: 0, play: false, capped: true, belowMin: true };
    return { ...x, stake, win: round(stake * (x.odds - 1), 2), ret: round(stake * x.odds, 2), capped: true };
  });
}

/** Totali del resoconto. `plans` = piani già con tetto applicato. Vincita = netta se tutte le giocate entrano. */
export function totalsOf(plans) {
  const played = plans.filter((x) => x?.play);
  return {
    count: played.length,
    stake: round(played.reduce((s, x) => s + x.stake, 0), 2),
    win: round(played.reduce((s, x) => s + x.win, 0), 2),
    ev: round(played.reduce((s, x) => s + x.stake * (x.pLow * x.odds - 1), 0), 2), // esito atteso prudente
  };
}
