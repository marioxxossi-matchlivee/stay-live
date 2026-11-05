/**
 * Modello statistico Stay Live (solo gol: API Ninjas non fornisce corner né quote).
 * Poisson indipendente con forza attacco/difesa pesata sulle ultime partite.
 * Tutte le costanti sono qui e vengono mostrate all'utente: nulla è nascosto.
 */
export const MODEL = {
  priorHome: 1.5, priorAway: 1.2, priorWeight: 30, // media gol di partenza (casa/trasferta) e peso in "partite"
  minLeagueMatches: 20,   // sotto questa soglia il campionato usa la media di tutti i campionati
  decay: 0.92,            // peso della k-esima partita più vecchia = decay^k
  shrinkK: 4,             // "partite fittizie" di valore medio mescolate alla forma della squadra
  lambdaMin: 0.2, lambdaMax: 4,
  maxGoals: 10,
  uncertainty: 0.30,      // delta = uncertainty / sqrt(partite campione)
  minSample: 3, betSample: 5,
  betThreshold: 0.60,     // probabilità prudente minima per un BET senza quota
  minEdge: 0.08,          // la prob. prudente deve superare di 8 punti la frequenza storica dell'esito nel campionato
  maxUsefulProb: 0.80,    // oltre: quota equa < 1,25, esito non interessante
  edgeMargin: 1.03,       // valore atteso minimo: prob. prudente x quota >= 1,03
  longshotFloor: 0.40,    // con quota inserita non si consiglia sotto questa prob. prudente
  // Mercati preferiti: tra i BET della stessa partita passano davanti a 1X2, doppia chance, gol/no gol.
  // Per aggiungere i corner basta inserire qui il nome del mercato (es. "Corner totali") quando ci saranno i dati.
  preferredMarkets: ["Gol totali"],
  // Gestione del budget (puntate). Le quote reali non sono note: se non le inserisci si usa una stima.
  bookMargin: 0.06,       // margine medio del bookmaker: quota stimata = quota equa / (1 + margine)
  kellyFraction: 0.25,    // si punta un quarto della frazione di Kelly (molto più prudente del Kelly pieno)
  maxStakePct: 0.05,      // massimo 5% del budget su una singola
  maxAccStakePct: 0.02,   // massimo 2% sulla multipla
  maxTotalPct: 0.20,      // massimo 20% del budget esposto in totale
  stakeStep: 0.5,         // le puntate sono arrotondate a 0,50 €
  // Pronostico di API-Football: input PRINCIPALE. Probabilità finale = afWeight x provider + (1 - afWeight) x ultime partite.
  afWeight: 0.65,         // peso del pronostico API-Football (percentuali 1X2 e gol attesi dalle medie stagionali)
  afDelta: 0.15,          // incertezza dei gol attesi del provider (stagione intera: più stabile delle sole ultime partite)
  afMargin: 0.05,         // sulle percentuali 1X2 del provider si toglie 5 punti per la probabilità prudente
  afAdviceShift: 0.06,    // se il provider consiglia Over/Under su una linea, quella probabilità sale di 6 punti
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
const round = (v, d = 4) => (Number.isFinite(v) ? Number(v.toFixed(d)) : null);

export function poissonPmf(lambda, max = MODEL.maxGoals) {
  const out = [Math.exp(-lambda)];
  for (let k = 1; k <= max; k += 1) out.push((out[k - 1] * lambda) / k);
  return out;
}

/** Matrice P(casa=i, trasferta=j), normalizzata a 1 (la coda oltre 10 gol è trascurabile). */
export function scoreMatrix(lh, la) {
  const ph = poissonPmf(lh);
  const pa = poissonPmf(la);
  let total = 0;
  const m = ph.map((a) => pa.map((b) => { total += a * b; return a * b; }));
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

export function probabilities(lh, la) {
  return marketsFromMatrix(scoreMatrix(lh, la));
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
  const valid = finals.filter((f) => Number.isFinite(f.home_score) && Number.isFinite(f.away_score) && Date.parse(f.kickoff_at));
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
  let w = 0, att = 0, def = 0, gf = 0, ga = 0;
  rows.forEach((r, k) => {
    const wk = MODEL.decay ** k;
    w += wk; att += wk * r.att; def += wk * r.def; gf += wk * r.gf; ga += wk * r.ga;
  });
  const attRaw = w ? att / w : 1;
  const defRaw = w ? def / w : 1;
  return {
    n: rows.length,
    weightSum: round(w, 3),
    gfAvg: w ? round(gf / w, 2) : null,
    gaAvg: w ? round(ga / w, 2) : null,
    attackRaw: round(attRaw, 3),
    defenseRaw: round(defRaw, 3),
    attack: round((w * attRaw + MODEL.shrinkK) / (w + MODEL.shrinkK), 3),
    defense: round((w * defRaw + MODEL.shrinkK) / (w + MODEL.shrinkK), 3),
    last: rows.slice(0, 5).map((r) => ({ date: new Date(r.t).toISOString().slice(0, 10), opp: r.opp, venue: r.venue, gf: r.gf, ga: r.ga })),
  };
}

export function verdictFor(sel, sample, odds = null) {
  if (sample < MODEL.betSample) return { verdict: "EVITA", reason: `Campione troppo piccolo (${sample} partite, ne servono ${MODEL.betSample}).` };
  if (sel.agree === "contraddice") return { verdict: "EVITA", reason: `API-Football non è d'accordo: stima ${(sel.pApi * 100).toFixed(0)}% per questo esito.` };
  if (Number.isFinite(odds) && odds > 1) {
    const ev = sel.pLow * odds;
    if (sel.pLow < MODEL.longshotFloor) return { verdict: "EVITA", reason: "Probabilità prudente troppo bassa anche con quota alta." };
    return ev >= MODEL.edgeMargin
      ? { verdict: "BET", reason: `Valore atteso prudente +${((ev - 1) * 100).toFixed(1).replace(".", ",")}%.` }
      : { verdict: "EVITA", reason: `Quota troppo bassa: serve almeno ${sel.minOdds.toFixed(2).replace(".", ",")}.` };
  }
  const edgeText = sel.edge == null ? "" : ` (+${(sel.edge * 100).toFixed(0)} punti sulla media del campionato)`;
  if (sel.pLow < MODEL.betThreshold) return { verdict: "EVITA", reason: `Probabilità prudente ${(sel.pLow * 100).toFixed(0)}% sotto la soglia ${(MODEL.betThreshold * 100).toFixed(0)}%.` };
  if (sel.edge == null || sel.edge < MODEL.minEdge) return { verdict: "EVITA", reason: `Esito probabile ma in linea con la media del campionato${edgeText}: niente di speciale in questa partita.` };
  return { verdict: "BET", reason: `Probabilità prudente ${(sel.pLow * 100).toFixed(0)}%${edgeText}. Gioca solo se la quota è almeno ${sel.minOdds.toFixed(2).replace(".", ",")}.` };
}

const afRank = (s) => (s.agree === "conferma" ? 0 : s.agree === "contraddice" ? 2 : 1);

export function analyzeMatch(match, ctx, { n = 8, af = null } = {}) {
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
  // Con il pronostico del provider il campione è la stagione intera (fino a 8 partite contano come campione pieno).
  const sample = afP ? Math.max(recent, Math.min(af.played ?? 0, 8)) : recent;
  const delta = MODEL.uncertainty / Math.sqrt(Math.max(recent, 1));
  const low = stressedProbabilities(lh, la, delta);
  const base_ = ctx.baseRates(match.league);

  const selections = SELECTIONS.map((s) => {
    const pa = afP?.p[s.key] ?? null;                                  // stima del provider per questa selezione (null = non la fornisce)
    const w = pa == null ? 0 : MODEL.afWeight;
    const pFinal = w * (pa ?? 0) + (1 - w) * p[s.key];
    const lowFinal = Math.min(pFinal, w * (afP?.low[s.key] ?? 0) + (1 - w) * Math.min(low[s.key], p[s.key]));
    const sel = {
      ...s,
      p: round(pFinal),
      pLow: round(lowFinal),
      pModel: round(p[s.key]),
      pApi: pa == null ? null : round(pa),
      agree: pa == null ? null : pa >= MODEL.afAgree ? "conferma" : pa < MODEL.afContrast ? "contraddice" : "neutro",
      fairOdds: round(1 / pFinal, 2),
    };
    sel.minOdds = round(MODEL.edgeMargin / sel.pLow, 2);
    sel.base = base_ ? round(base_[s.key]) : null;
    sel.edge = base_ ? round(sel.pLow - base_[s.key]) : null;
    Object.assign(sel, verdictFor(sel, sample));
    return sel;
  });

  const ranked = selections.filter((s) => s.p <= MODEL.maxUsefulProb)
    .sort((x, y) => (y.verdict === "BET") - (x.verdict === "BET")
      || (y.verdict === "BET" && isPreferred(y)) - (x.verdict === "BET" && isPreferred(x))
      || afRank(x) - afRank(y)                                         // a parità, prima ciò che API-Football conferma
      || (y.edge ?? -1) - (x.edge ?? -1) || y.pLow - x.pLow);
  const pick = ranked[0] ?? null;
  const scores = [];
  m.forEach((row, i) => row.forEach((v, j) => scores.push({ score: `${i}-${j}`, p: round(v) })));
  scores.sort((a, b) => b.p - a.p);

  return {
    sample, confidence: confidenceLabel(sample), n,
    basis: afP ? "api" : "storico",
    api: af ? { used: Boolean(afP), weight: MODEL.afWeight, percent: af.percent, underOver: af.underOver, advice: af.advice, winner: af.winner, lambda: afP?.p._lambda ?? null, played: af.played } : null,
    inputs: {
      baseline: { home: round(base.home, 3), away: round(base.away, 3), perTeam: round(base.perTeam, 3), sample: base.n, scope: base.scope },
      neutral, home, away, delta: round(delta, 3),
    },
    lambda: { home: round(lh, 3), away: round(la, 3), total: round(lh + la, 3) },
    selections, pick, alternatives: ranked.slice(1, 4), topScores: scores.slice(0, 3),
    recommended: ranked.filter((s) => s.verdict === "BET").slice(0, 3).map((s) => s.key),      // solo ciò che si consiglia di giocare (max 3), in ordine
  };
}

/** Versione compatta per le liste. */
export function compactPick(analysis) {
  const s = analysis.pick;
  if (!s) return null;
  return { key: s.key, label: s.label, market: s.market, preferred: isPreferred(s), p: s.p, pLow: s.pLow, minOdds: s.minOdds, estOdds: estimateOdds(s.p), verdict: s.verdict,
    reason: s.reason, confidence: analysis.confidence, sample: analysis.sample, expectedGoals: analysis.lambda.total,
    basis: analysis.basis, pApi: s.pApi, pModel: s.pModel, agree: s.agree };
}

/** Over/Under 2,5 in breve (per la modalità personalizzata): i due lati e il migliore. null se il campione è insufficiente. */
export function ou25Of(analysis) {
  if (!analysis || analysis.confidence === "insufficiente") return null;
  const pick = (k) => { const s = analysis.selections.find((x) => x.key === k); return s ? { key: s.key, side: k.startsWith("over") ? "over" : "under", p: s.p, pLow: s.pLow, pApi: s.pApi, agree: s.agree, minOdds: s.minOdds } : null; };
  const over = pick("over25"), under = pick("under25");
  const best = over && under ? (over.p >= under.p ? over : under) : over ?? under;
  return best ? { best, over, under, basis: analysis.basis, confidence: analysis.confidence } : null;
}

/** Multipla: fino a maxLegs BET con le probabilità prudenti più alte, una per partita. */
export function buildAccumulator(items, maxLegs = 4) {
  const legs = items.filter((i) => i.pick?.verdict === "BET").sort((a, b) => b.pick.pLow - a.pick.pLow).slice(0, maxLegs);
  if (legs.length < 2) return null;
  const pLow = legs.reduce((acc, l) => acc * l.pick.pLow, 1);
  return { ids: legs.map((l) => l.id), pLow: round(pLow), minOdds: round(MODEL.edgeMargin / pLow, 2) };
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
  const stake = Math.min(bankroll, Math.max(MODEL.stakeStep, floorStep(raw)));
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
  const pLow = prod((l) => l.pLow), p = prod((l) => l.p);
  const allReal = legs.every((l) => Number.isFinite(l.odds) && l.odds > 1);
  const odds = round(prod((l) => (Number.isFinite(l.odds) && l.odds > 1 ? l.odds : estimateOdds(l.p))), 2);
  return planFor({ pLow, p }, odds, bankroll, { maxPct: MODEL.maxAccStakePct, source: allReal ? "reale" : "stimata" });
}

/** Se la somma delle puntate supera maxTotalPct del budget, le riduce tutte nella stessa proporzione. */
export function applyCap(plans, bankroll) {
  const total = plans.reduce((s, x) => s + (x?.play ? x.stake : 0), 0);
  const cap = bankroll * MODEL.maxTotalPct;
  if (!(total > cap) || !(cap > 0)) return plans;
  const k = cap / total;
  return plans.map((x) => {
    if (!x?.play) return x;
    const stake = Math.max(MODEL.stakeStep, floorStep(x.stake * k));
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
