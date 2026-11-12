// Stay Live Tennis — modello del vincitore (1 o 2). Logica PURA: nessuna rete, nessun database.
// Il modello del calcio (model.js) non viene toccato né importato.
//
// Ingredienti (tutti verificabili, nessun dato inventato):
//  1. Elo generale + Elo per superficie, con K decrescente col numero di partite del giocatore.
//  2. Forma recente: media pesata (decadimento esponenziale) di "risultato − atteso" sulle ultime N partite,
//     quindi tiene conto della forza degli avversari affrontati.
//  3. H2H ristretto verso zero (pochi scontri pesano poco).
//  4. Carico recente: partite giocate negli ultimi giorni (effetto piccolo, solo penalità).
//  5. Modello a punti (servizio/risposta → game → set → match), usato solo se i dati di entrambi i giocatori ci sono.
// Se i dati sono insufficienti il modello si ASTIENE: nessun pronostico pubblicato.

export const TENNIS_MODEL = {
  version: "tennis-v1",
  baseElo: 1500,
  kBase: 250, kOffset: 5, kShape: 0.4,        // K = kBase / (n + kOffset)^kShape
  surfaceWeightMax: 0.6, surfaceWeightHalf: 25, // peso dell'Elo di superficie: max * n / (n + half)
  formWindow: 10, formDecay: 0.85, formPoints: 60,   // punti Elo per 1.0 di scarto di forma
  h2hPoints: 40, h2hMinMeetings: 2, h2hShrink: 4,
  fatigueDays: 7, fatigueFree: 3, fatiguePerMatch: 12,
  serveBlendMax: 0.35, serveMinMatches: 8,
  // Valori di riferimento (da ricalibrare sui dati reali): quota di punti vinti al servizio in media sul circuito.
  tourServeAvg: { atp: 0.645, wta: 0.565 },
  minMatches: 12,        // sotto questa soglia (per uno dei due giocatori) il modello si astiene
  minEdge: 0.05,         // sotto 55% per il favorito il match è considerato equilibrato: nessun pronostico
  probClip: 0.02,
};

const DAY = 86400e3;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
export const logistic = (x) => 1 / (1 + Math.exp(-x));
export const logit = (p) => Math.log(p / (1 - p));
const eloExpected = (diff) => 1 / (1 + 10 ** (-diff / 400));

/** Superficie del provider → famiglia usata dal modello. Sconosciuta → null (si usa solo l'Elo generale). */
export function normalizeSurface(name) {
  const s = String(name ?? "").trim().toLowerCase();
  if (!s) return null;
  if (s.includes("clay")) return "clay";
  if (s.includes("grass")) return "grass";
  if (s.includes("hard") || s.includes("carpet")) return "hard"; // indoor hard e carpet rientrano in "hard"
  return null;
}

// ───────────── Modello a punti: servizio/risposta → game → set → match ─────────────
export function gameWin(p) {
  const q = 1 - p;
  return p ** 4 * (1 + 4 * q + 10 * q * q) + 20 * p ** 3 * q ** 3 * (p * p) / (p * p + q * q);
}

/** Tie-break al meglio dei 7 punti (a 2 di scarto), punti i.i.d. con probabilità q per il giocatore A. */
export function tiebreakWin(q) {
  const p = 1 - q;
  let sum = 0, c = 1;
  for (let k = 0; k <= 5; k++) { // 7-k, k = 0..5
    if (k > 0) c = (c * (6 + k)) / k;
    sum += c * q ** 7 * p ** k;
  }
  return sum + 924 * q ** 6 * p ** 6 * (q * q) / (q * q + p * p); // 924 = C(12,6): 6-6 poi a oltranza
}

/** Probabilità che A vinca un set, dati i punti vinti al servizio da A (pa) e da B (pb). Media sui due casi "chi serve per primo". */
export function setWin(pa, pb) {
  const hA = gameWin(pa), hB = gameWin(pb);
  const q = 0.5 * (pa + (1 - pb)); // punto medio per il tie-break
  const tb = tiebreakWin(q);
  const solve = (aFirst) => {
    const memo = new Map();
    const f = (a, b) => {
      if (a === 7) return 1;
      if (b === 7) return 0;
      if (a === 6 && b <= 4) return 1;
      if (b === 6 && a <= 4) return 0;
      if (a === 6 && b === 6) return tb;
      const key = a * 10 + b;
      if (memo.has(key)) return memo.get(key);
      const aServes = ((a + b) % 2 === 0) === aFirst;
      const pg = aServes ? hA : 1 - hB;
      const v = pg * f(a + 1, b) + (1 - pg) * f(a, b + 1);
      memo.set(key, v);
      return v;
    };
    return f(0, 0);
  };
  return 0.5 * (solve(true) + solve(false));
}

export function matchWin(s, bestOf = 3) {
  return bestOf === 5 ? s ** 3 * (10 - 15 * s + 6 * s * s) : s * s * (3 - 2 * s);
}

/**
 * Probabilità di vittoria di A dai punti: serve = quota punti vinti al servizio, ret = quota punti vinti in risposta.
 * Il servizio di A contro B vale: serve_A − (ret_B − ret_medio) (e simmetrico), con ret_medio = 1 − serve_medio del circuito.
 */
export function pointModelProb(a, b, { bestOf = 3, tour = "atp", cfg = TENNIS_MODEL } = {}) {
  const avgServe = cfg.tourServeAvg[tour] ?? 0.6;
  const avgRet = 1 - avgServe;
  const pa = clamp(a.serve - (b.ret - avgRet), 0.35, 0.85);
  const pb = clamp(b.serve - (a.ret - avgRet), 0.35, 0.85);
  return matchWin(setWin(pa, pb), bestOf);
}

// ───────────── Registro dei rating ─────────────
export class RatingBook {
  constructor(cfg = TENNIS_MODEL) { this.cfg = cfg; this.players = new Map(); }

  _get(id) {
    let p = this.players.get(id);
    if (!p) { p = { elo: this.cfg.baseElo, n: 0, surf: {}, results: [] }; this.players.set(id, p); }
    return p;
  }
  _surf(p, s) { return (p.surf[s] ??= { elo: this.cfg.baseElo, n: 0 }); }
  has(id) { return this.players.has(id); }

  /** Rating combinato (generale + superficie) con il numero di partite di supporto. */
  view(id, surface) {
    const p = this.players.get(id);
    if (!p) return { elo: this.cfg.baseElo, n: 0, nSurf: 0, eloSurf: null, eloAll: this.cfg.baseElo };
    const sv = surface ? p.surf[surface] : null;
    const nSurf = sv?.n ?? 0;
    const w = sv ? this.cfg.surfaceWeightMax * nSurf / (nSurf + this.cfg.surfaceWeightHalf) : 0;
    const elo = sv ? w * sv.elo + (1 - w) * p.elo : p.elo;
    return { elo, n: p.n, nSurf, eloSurf: sv?.elo ?? null, eloAll: p.elo };
  }

  /** Forma: media pesata di (esito − atteso) sulle ultime N partite prima di `at`. Restituisce null senza storico. */
  form(id, at = Infinity) {
    const p = this.players.get(id);
    if (!p) return null;
    let num = 0, den = 0, i = 0;
    for (let k = p.results.length - 1; k >= 0 && i < this.cfg.formWindow; k--) {
      const r = p.results[k];
      if (r.t >= at) continue;
      const w = this.cfg.formDecay ** i;
      num += w * ((r.win ? 1 : 0) - r.exp);
      den += w;
      i++;
    }
    return den ? { score: num / den, games: i } : null;
  }

  /** Partite giocate nei `days` giorni prima di `at` (carico recente). */
  load(id, at, days = this.cfg.fatigueDays) {
    const p = this.players.get(id);
    if (!p) return 0;
    let c = 0;
    for (let k = p.results.length - 1; k >= 0; k--) {
      const t = p.results[k].t;
      if (t >= at) continue;
      if (t < at - days * DAY) break;
      c++;
    }
    return c;
  }

  /** Registra una partita conclusa: { t (ms), winnerId, loserId, surface }. Da chiamare in ordine cronologico. */
  update({ t, winnerId, loserId, surface = null }) {
    if (winnerId == null || loserId == null || winnerId === loserId) return false;
    const w = this._get(winnerId), l = this._get(loserId);
    const vw = this.view(winnerId, surface), vl = this.view(loserId, surface);
    const exp = eloExpected(vw.elo - vl.elo);
    const k = (n) => this.cfg.kBase / (n + this.cfg.kOffset) ** this.cfg.kShape;
    const kw = k(w.n), kl = k(l.n);
    const dAll = eloExpected(w.elo - l.elo);
    const wEloBefore = w.elo, lEloBefore = l.elo;
    w.elo = wEloBefore + kw * (1 - dAll);
    l.elo = lEloBefore - kl * (1 - dAll); // atteso del perdente = 1 − dAll; risultato 0
    if (surface) {
      const sw = this._surf(w, surface), sl = this._surf(l, surface);
      const dS = eloExpected(sw.elo - sl.elo);
      const kws = k(sw.n), kls = k(sl.n);
      sw.elo += kws * (1 - dS); sl.elo -= kls * (1 - dS); sw.n++; sl.n++;
    }
    w.n++; l.n++;
    w.results.push({ t, win: true, exp, opp: loserId, surface });
    l.results.push({ t, win: false, exp: 1 - exp, opp: winnerId, surface });
    return true;
  }
}

// ───────────── Pronostico ─────────────
const round4 = (x) => Math.round(x * 1e4) / 1e4;

/**
 * match: { t (ms inizio), surface (grezza o normalizzata), tour: "atp"|"wta", bestOf?, p1: {id, name?, rank?}, p2: {...} }
 * extras (tutti opzionali): { h2h: {p1Wins, p2Wins}, stats1/stats2: { serve, ret, matches } (quote 0-1 di punti vinti) }
 * calibrator: { a, b } scaling di Platt sul logit (identità se assente).
 * Restituisce SEMPRE un oggetto; se published=false non va mostrato come pronostico.
 */
export function predictMatch(book, match, extras = {}, calibrator = null, cfg = TENNIS_MODEL) {
  const surface = normalizeSurface(match.surface);
  const bestOf = match.bestOf === 5 ? 5 : 3;
  const id1 = match.p1.id, id2 = match.p2.id;
  const missing = [], reasons = [];
  if (!surface) missing.push("superficie");

  const v1 = book.view(id1, surface), v2 = book.view(id2, surface);
  const base = {
    modelVersion: cfg.version, surface, bestOf,
    components: { n1: v1.n, n2: v2.n, nSurf1: v1.nSurf, nSurf2: v2.nSurf },
  };

  if (Math.min(v1.n, v2.n) < cfg.minMatches) {
    const who = v1.n < cfg.minMatches ? match.p1.name ?? "giocatore 1" : match.p2.name ?? "giocatore 2";
    return { ...base, published: false, pick: null, p1: null, p2: null, reliability: null, reasons: [], missing: [...missing, "storico partite"],
      abstainReason: `Storico insufficiente per ${who} (servono almeno ${cfg.minMatches} partite).` };
  }

  // 1) Elo (generale + superficie)
  let diff = v1.elo - v2.elo;
  reasons.push(`Elo ${surface ? "misto generale/" + surface : "generale"}: ${Math.round(v1.elo)} contro ${Math.round(v2.elo)}.`);

  // 2) Forma pesata
  const f1 = book.form(id1, match.t), f2 = book.form(id2, match.t);
  let formAdj = 0;
  if (f1 && f2 && Math.min(f1.games, f2.games) >= 3) {
    formAdj = cfg.formPoints * (f1.score - f2.score);
    diff += formAdj;
    if (Math.abs(f1.score - f2.score) >= 0.1) reasons.push(`Forma recente a favore di ${f1.score > f2.score ? match.p1.name ?? "giocatore 1" : match.p2.name ?? "giocatore 2"}.`);
  } else missing.push("forma recente");

  // 3) H2H ristretto
  const h = extras.h2h;
  let h2hAdj = 0;
  const meetings = h ? (h.p1Wins ?? 0) + (h.p2Wins ?? 0) : 0;
  if (h && meetings >= cfg.h2hMinMeetings) {
    h2hAdj = cfg.h2hPoints * ((h.p1Wins - h.p2Wins) / (meetings + cfg.h2hShrink));
    diff += h2hAdj;
    reasons.push(`Scontri diretti ${h.p1Wins}-${h.p2Wins}.`);
  } else missing.push("scontri diretti");

  // 4) Carico recente (solo penalità)
  const l1 = book.load(id1, match.t), l2 = book.load(id2, match.t);
  const pen = (l) => Math.max(0, l - cfg.fatigueFree) * cfg.fatiguePerMatch;
  const fatigueAdj = pen(l2) - pen(l1);
  if (fatigueAdj !== 0) { diff += fatigueAdj; reasons.push(`Carico recente: ${l1} partite contro ${l2} negli ultimi ${cfg.fatigueDays} giorni.`); }

  let logitFinal = (diff / 400) * Math.LN10; // Elo → logit
  const pElo = logistic(logitFinal);

  // 5) Modello a punti (solo con dati completi di entrambi)
  const s1 = extras.stats1, s2 = extras.stats2;
  const okStats = (s) => s && Number.isFinite(s.serve) && Number.isFinite(s.ret) && (s.matches ?? 0) >= cfg.serveMinMatches;
  let pPoint = null;
  if (okStats(s1) && okStats(s2)) {
    pPoint = clamp(pointModelProb(s1, s2, { bestOf, tour: match.tour, cfg }), 0.02, 0.98);
    const w = cfg.serveBlendMax;
    logitFinal = (1 - w) * logitFinal + w * logit(pPoint);
    reasons.push(`Statistiche di servizio e risposta (${Math.round(s1.serve * 100)}% e ${Math.round(s2.serve * 100)}% di punti vinti al servizio).`);
  } else missing.push("statistiche di servizio e risposta");

  // Calibrazione (Platt) e limiti
  const cal = calibrator && Number.isFinite(calibrator.a) && Number.isFinite(calibrator.b) ? calibrator : { a: 1, b: 0 };
  const p1raw = logistic(cal.a * logitFinal + cal.b);
  const p1 = clamp(p1raw, cfg.probClip, 1 - cfg.probClip);
  const p1r = round4(p1), p2r = round4(1 - p1r);
  const fav = p1r >= p2r ? 1 : 2, pFav = Math.max(p1r, p2r);

  // Affidabilità: criterio descrittivo basato su quantità di dati, NON una probabilità.
  let score = 0;
  const nMin = Math.min(v1.n, v2.n), sMin = Math.min(v1.nSurf, v2.nSurf);
  score += nMin >= 40 ? 2 : nMin >= 20 ? 1.5 : 1;
  if (surface && sMin >= 10) score += 1;
  if (pPoint != null) score += 1;
  if (meetings >= cfg.h2hMinMeetings) score += 0.5;
  if (formAdj !== 0) score += 0.5;
  if (pPoint != null) score += (pPoint >= 0.5) === (pElo >= 0.5) ? 1 : -1.5;
  const reliability = score >= 4 ? "alta" : score >= 2.5 ? "media" : "bassa";

  const common = { ...base, p1: p1r, p2: p2r, reliability, reasons, missing,
    components: { ...base.components, eloDiff: Math.round(diff), formAdj: Math.round(formAdj), h2hAdj: Math.round(h2hAdj * 10) / 10, fatigueAdj, pElo: round4(pElo), pPoint: pPoint == null ? null : round4(pPoint), load1: l1, load2: l2 } };

  if (pFav - 0.5 < cfg.minEdge) {
    return { ...common, published: false, pick: null, abstainReason: "Partita equilibrata: nessun favorito netto, nessun pronostico." };
  }
  return { ...common, published: true, pick: fav, abstainReason: null };
}
