/**
 * Giocate salvate del tennis (stesso comportamento del calcio): si salvano dalla lista o dalla scheda, restano nel dispositivo
 * (localStorage) e si confrontano con i risultati quando la partita è finita. Funzioni pure e testabili: lo storage si passa come argomento.
 */
export const TPLAYS_KEY = "stayLive.tennisPlays";
export const MAX_TPLAYS = 300;

const store = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };

export function loadTPlays(storage = store()) {
  try {
    const list = JSON.parse(storage?.getItem(TPLAYS_KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((p) => p && p.matchKey && (p.pick === 1 || p.pick === 2) && p.p1?.name && p.p2?.name) : [];
  } catch { return []; }
}
export function saveTPlays(plays, storage = store()) {
  try { storage?.setItem(TPLAYS_KEY, JSON.stringify(plays.slice(0, MAX_TPLAYS))); return true; } catch { return false; }
}

/** Una giocata è unica per partita e giocatore scelto. */
export const tSignature = (p) => `${p.matchKey}|${p.pick}`;

/** Quota reale del giocatore scelto (dal BET se c'è, altrimenti dal mercato); null se il provider non l'ha data. */
export function pickOdds(m) {
  const pick = m.prediction?.pick;
  const o = m.bet?.odds ?? (pick === 1 ? m.odds?.p1 : pick === 2 ? m.odds?.p2 : null);
  return Number.isFinite(Number(o)) && Number(o) > 1 ? Number(o) : null;
}

/** Giocata da una partita con pronostico pubblicato; null se non c'è nulla da salvare. */
export function playFromMatch(m) {
  const p = m?.prediction;
  if (!p?.published || (p.pick !== 1 && p.pick !== 2)) return null;
  const who = (x) => ({ name: x.name, country: x.country ?? null, rank: x.rank ?? null });
  return {
    matchKey: m.key, tour: m.tour, tournament: m.tournament ?? null, category: m.category ?? null, surface: m.surface ?? null, startsAt: m.startsAt,
    p1: who(m.p1), p2: who(m.p2), pick: p.pick, prob: p.pick === 1 ? p.p1 : p.p2, reliability: p.reliability ?? null,
    odds: pickOdds(m), verdict: m.bet ? (m.bet.verdict === "BET" ? "BET" : "EVITA") : null,
  };
}

/** Aggiunge in testa. { plays, added }: added=false se è già salvata. */
export function addTPlay(plays, play, now = Date.now()) {
  if (plays.some((p) => tSignature(p) === tSignature(play))) return { plays, added: false };
  const id = `${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return { plays: [{ ...play, id, savedAt: new Date(now).toISOString() }, ...plays].slice(0, MAX_TPLAYS), added: true };
}
export const removeTPlay = (plays, id) => plays.filter((p) => p.id !== id);

/** Esito della partita dal tabellone: { winner, score } se è finita regolarmente, { void: true } se non conta, altrimenti null. */
export function resultOfMatch(m) {
  if (!m) return null;
  if (m.status === "finished" && (m.winner === 1 || m.winner === 2)) return { winner: m.winner, score: m.score ?? null };
  if (m.status === "ended_other" || m.status === "cancelled") return { void: true, score: m.score ?? null };
  return null;
}

/** Copia nelle giocate l'esito definitivo, così resta anche quando la partita esce dalla finestra dei dati. true se qualcosa è cambiato. */
export function absorbTResults(plays, matches) {
  const byKey = new Map(matches.map((m) => [m.key, m]));
  let changed = false;
  for (const p of plays) {
    if (p.res) continue;
    const r = resultOfMatch(byKey.get(p.matchKey));
    if (r) { p.res = r; changed = true; }
  }
  return changed;
}

/** won | lost | pending | void */
export function tStatus(play, match) {
  const r = play.res ?? resultOfMatch(match);
  if (!r) return "pending";
  if (r.void) return "void";
  return r.winner === play.pick ? "won" : "lost";
}

/** Valuta le giocate: { rows: [{ play, status, score, profit }], total }. Rendimento per 1 € a giocata, solo dove c'è la quota reale. */
export function evaluateT(plays, matches = []) {
  const byKey = new Map(matches.map((m) => [m.key, m]));
  const rows = plays.map((play) => {
    const match = byKey.get(play.matchKey) ?? null, status = tStatus(play, match);
    const score = play.res?.score ?? resultOfMatch(match)?.score ?? null;
    const profit = play.odds > 1 && (status === "won" || status === "lost") ? (status === "won" ? Math.round((play.odds - 1) * 100) / 100 : -1) : null;
    return { play, match, status, score, profit };
  });
  const count = (s) => rows.filter((r) => r.status === s).length;
  const won = count("won"), lost = count("lost"), priced = rows.filter((r) => r.profit != null);
  return { rows, total: {
    won, lost, pending: count("pending"), void: count("void"), rate: won + lost ? won / (won + lost) : null,
    priced: priced.length, profit: Math.round(priced.reduce((t, r) => t + r.profit, 0) * 100) / 100,
  } };
}
