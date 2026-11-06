/**
 * Giocate salvate dal preview, per confrontare le previsioni con i risultati (anche il giorno dopo).
 * Le giocate stanno nel browser (localStorage); i risultati si leggono da /api/results e, una volta definitivi, si copiano nella giocata.
 * Funzioni pure e testabili: lo storage si passa come argomento.
 */
export const PLAYS_KEY = "stayLive.plays";
export const MAX_PLAYS = 300;

/** true/false se la selezione (chiave del modello) e' entrata con questo risultato; null se il risultato manca. */
export function outcomeOf(key, hs, as) {
  if (!Number.isFinite(hs) || !Number.isFinite(as)) return null;
  const t = hs + as;
  const map = {
    home: hs > as, draw: hs === as, away: as > hs, dc1x: hs >= as, dcx2: as >= hs, dc12: hs !== as,
    over15: t > 1.5, under15: t < 1.5, over25: t > 2.5, under25: t < 2.5, over35: t > 3.5, under35: t < 3.5,
    btts: hs > 0 && as > 0, nobtts: hs === 0 || as === 0,
  };
  return key in map ? map[key] : null;
}

/** Stato di una gamba: won | lost | pending | void (partita annullata). `leg.res` = [casa, trasferta] salvato quando era definitivo. */
export function legStatus(leg, live) {
  if (live?.status === "canceled") return "void";
  const final = live?.status === "final" && Number.isFinite(live.homeScore) && Number.isFinite(live.awayScore);
  const [hs, as] = final ? [live.homeScore, live.awayScore] : leg.res ?? [];
  const o = outcomeOf(leg.key, hs, as);
  return o == null ? "pending" : o ? "won" : "lost";
}

/** Stato della giocata: una gamba persa la perde subito; vinta se tutte le gambe valide sono vinte. */
export function playStatus(statuses) {
  if (statuses.includes("lost")) return "lost";
  const valid = statuses.filter((s) => s !== "void");
  if (!valid.length) return "void";
  return valid.every((s) => s === "won") ? "won" : "pending";
}

/** Guadagno netto in euro se la puntata e la quota sono note; altrimenti null. */
export function profitOf(play, status) {
  const stake = Number(play.stake), odds = Number(play.odds);
  if (!(stake > 0) || !(odds > 1)) return null;
  return status === "won" ? Math.round(stake * (odds - 1) * 100) / 100 : status === "lost" ? -stake : null;
}

export const signature = (p) => `${p.kind}|${p.legs.map((l) => `${l.matchId}:${l.key}`).sort().join(",")}`;

/** Valuta tutte le giocate con i risultati noti: { rows: [{ play, legs, status, profit }], total }. */
export function evaluate(plays, results = {}) {
  const rows = plays.map((play) => {
    const legs = play.legs.map((l) => ({ ...l, status: legStatus(l, results[l.matchId]), live: results[l.matchId] ?? null }));
    const status = playStatus(legs.map((l) => l.status));
    return { play, legs, status, profit: profitOf(play, status) };
  });
  const count = (s) => rows.filter((r) => r.status === s).length;
  const won = count("won"), lost = count("lost");
  const settled = rows.filter((r) => r.profit != null);
  return { rows, total: {
    won, lost, pending: count("pending"), void: count("void"),
    rate: won + lost ? won / (won + lost) : null,
    staked: settled.reduce((t, r) => t + Number(r.play.stake), 0),
    profit: Math.round(settled.reduce((t, r) => t + r.profit, 0) * 100) / 100,
  } };
}

/** Copia nelle gambe i risultati definitivi, cosi' restano anche se la partita esce dalla finestra dei dati. Restituisce true se qualcosa e' cambiato. */
export function absorbResults(plays, results) {
  let changed = false;
  for (const p of plays) for (const l of p.legs) {
    const m = results[l.matchId];
    if (!l.res && m?.status === "final" && Number.isFinite(m.homeScore) && Number.isFinite(m.awayScore)) { l.res = [m.homeScore, m.awayScore]; changed = true; }
  }
  return changed;
}

/** Partite da chiedere al server: gambe senza risultato definitivo. */
export const pendingMatchIds = (plays) => [...new Set(plays.flatMap((p) => p.legs.filter((l) => !l.res).map((l) => l.matchId)))];

/* ---------- Storage ---------- */
const store = () => { try { return globalThis.localStorage ?? null; } catch { return null; } };

export function loadPlays(storage = store()) {
  try {
    const list = JSON.parse(storage?.getItem(PLAYS_KEY) ?? "[]");
    return Array.isArray(list) ? list.filter((p) => p && Array.isArray(p.legs) && p.legs.length) : [];
  } catch { return []; }
}
export function savePlays(plays, storage = store()) {
  try { storage?.setItem(PLAYS_KEY, JSON.stringify(plays.slice(0, MAX_PLAYS))); return true; } catch { return false; }
}

/** Aggiunge una giocata (la piu' recente in testa). Restituisce { plays, added }: added=false se identica a una gia' salvata. */
export function addPlay(plays, play, now = Date.now()) {
  if (plays.some((p) => signature(p) === signature(play))) return { plays, added: false };
  const id = `${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return { plays: [{ ...play, id, savedAt: new Date(now).toISOString() }, ...plays].slice(0, MAX_PLAYS), added: true };
}
export const removePlay = (plays, id) => plays.filter((p) => p.id !== id);

/** Giocata da una partita del preview (`item`) e dal piano (`quote` = { odds, stake, source }). */
export function playFromItem(item, quote = {}) {
  return { kind: "single", label: item.pick.label, odds: quote.odds ?? null, stake: quote.stake ?? null, oddsSource: quote.source ?? null, legs: [legFromItem(item)] };
}
/** `sel` = la selezione della gamba (per le multiple: la gamba scelta dal calcolo, che può non essere il consiglio singolo della partita). */
export function legFromItem(item, sel = item.pick) {
  return { matchId: item.id, league: item.league, home: item.home, away: item.away, homeLogo: item.homeLogo ?? null, awayLogo: item.awayLogo ?? null, kickoffAt: item.kickoffAt,
    key: sel.key, label: sel.label, p: sel.p, pLow: sel.pLow, minOdds: sel.minOdds ?? null,
    basis: item.pick?.basis ?? item.basis ?? null, pApi: sel.pApi ?? null };
}
