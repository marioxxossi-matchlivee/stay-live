/**
 * Politica di acquisizione dati (funzioni PURE, nessuna rete): quando una partita merita una richiesta ad API-Football.
 *
 * Priorità per vicinanza al calcio d'inizio (giorno di calendario a Roma):
 *   imminent    entro 3 ore dal fischio (o in corso)           -> massima priorità, dati rinnovati spesso
 *   today       oggi                                           -> priorità massima, tutti i dati
 *   tomorrow    domani                                         -> priorità alta, completezza progressiva
 *   week        da dopodomani a 7 giorni                       -> programmata: dati essenziali, controlli radi
 *   background  tutto il resto (storico corner, copertura…)    -> solo con crediti avanzati
 *
 * Regola di fondo: nessun dato si riscarica finché non può essere cambiato, e una risposta VUOTA (quote non ancora
 * pubblicate) non si richiede di nuovo prima che la pubblicazione diventi probabile (`emptyRecheckMs`).
 */
const H = 3600e3, MIN = 60e3, D = 24 * H;

export const TIERS = ["imminent", "today", "tomorrow", "week", "background"];
export const TIER_RANK = Object.fromEntries(TIERS.map((t, i) => [t, i]));

const fmtDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Rome", year: "numeric", month: "2-digit", day: "2-digit" });
/** Giorno di calendario a Roma (AAAA-MM-GG) di un istante. */
export const romeDay = (ms) => fmtDay.format(new Date(ms));
const dayDiff = (a, b) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / D);

/** Priorità di una partita in base al calcio d'inizio. */
export function tierOf(kickoff, now = Date.now()) {
  const ko = typeof kickoff === "number" ? kickoff : Date.parse(kickoff);
  if (!Number.isFinite(ko)) return "background";
  const toKo = ko - now;
  if (toKo <= 3 * H && toKo >= -3 * H) return "imminent";
  if (toKo < -3 * H) return "background";                   // iniziata da molto e ancora aperta: rinviata/dato vecchio, non è urgente
  const d = dayDiff(romeDay(ko), romeDay(now));
  return d <= 0 ? "today" : d === 1 ? "tomorrow" : d <= 7 ? "week" : "background";
}

/** Età massima accettata di un dato valido, per tipo e priorità (oltre questa si riscarica). */
export const FRESH = {
  odds:        { imminent: 60 * MIN, today: 3 * H, tomorrow: 6 * H, week: 24 * H, background: 48 * H },
  predictions: { imminent: 6 * H,    today: 8 * H, tomorrow: 24 * H, week: 48 * H, background: 72 * H },
};
FRESH["corner-odds"] = FRESH.odds;
FRESH["odds-extra"] = FRESH.odds;

export const freshMs = (kind, tier) => (FRESH[kind] ?? FRESH.odds)[tier] ?? 24 * H;

/**
 * Dopo una risposta VUOTA (nessuna quota ancora pubblicata): tra quanto ha senso richiedere.
 * Più il fischio è lontano, più è improbabile che le quote siano comparse nel frattempo.
 */
export function emptyRecheckMs(toKo) {
  if (!Number.isFinite(toKo)) return 24 * H;
  if (toKo > 96 * H) return 24 * H;
  if (toKo > 48 * H) return 12 * H;
  if (toKo > 24 * H) return 6 * H;
  if (toKo > 12 * H) return 3 * H;
  if (toKo > 3 * H) return 90 * MIN;
  return 20 * MIN;
}

/** Politica pronta per un giro: freshFor(m, kind) = età massima, emptyFor(m, kind) = attesa dopo una risposta vuota, tierFor(m). */
export function policyFor(now = Date.now()) {
  const tierFor = (m) => tierOf(m.kickoff_at ?? m.kickoffAt, now);
  const koOf = (m) => Date.parse(m.kickoff_at ?? m.kickoffAt) - now;
  return {
    tierFor,
    freshFor: (m, kind = "odds") => freshMs(kind, tierFor(m)),
    emptyFor: (m, kind = "odds") => (kind === "predictions" ? freshMs("predictions", tierFor(m)) : Math.min(freshMs(kind, tierFor(m)), emptyRecheckMs(koOf(m)))),
  };
}

/* ---------- Campionati da sincronizzare ---------- */
/**
 * Campionati da riscaricare in questo giro (una richiesta ciascuno). Prima si riscaricavano TUTTI a ogni giro (69 x 6 al giorno).
 * Servono davvero solo se: mai sincronizzati o in errore; hanno partite iniziate e senza risultato (si leggono i risultati);
 * hanno partite nelle prossime 48 ore (l'orario può cambiare); oppure il calendario ha più di 11 ore. Nessun campionato resta fuori a lungo:
 * il calendario dei 7 giorni resta completo.
 * leagues = elenco LEAGUES; matches = partite non finali della finestra; states = righe di sync_state.
 */
export function leaguesDue(leagues, matches, states, now = Date.now(), { staleMs = 11 * H, nearMs = 48 * H, liveEveryMs = 50 * MIN, nearEveryMs = 3.5 * H } = {}) {
  const st = new Map((states ?? []).map((s) => [s.league, s]));
  const by = new Map();
  for (const m of matches ?? []) { if (m.status === "final") continue; (by.get(m.league) ?? by.set(m.league, []).get(m.league)).push(m); }
  const due = [];
  for (const l of leagues) {
    const s = st.get(l.id), age = s?.synced_at ? now - Date.parse(s.synced_at) : Infinity;
    const ms = by.get(l.id) ?? [];
    const started = ms.some((m) => { const t = Date.parse(m.kickoff_at); return t <= now - 100 * MIN && t >= now - 14 * H; });   // iniziata da oltre 100 minuti: il risultato è probabile
    const live = ms.some((m) => { const t = Date.parse(m.kickoff_at); return t <= now && t >= now - 4 * H; });
    const near = ms.some((m) => { const t = Date.parse(m.kickoff_at); return t > now && t - now <= nearMs; });
    if (!s?.synced_at || s?.last_error || age >= staleMs || (started && age >= liveEveryMs) || (live && age >= liveEveryMs) || (near && age >= nearEveryMs)) due.push(l.id);
  }
  return due;
}

/* ---------- Tentativi ---------- */
export const MAX_RECOVER_ATTEMPTS = 3;                       // per una stessa condizione temporanea: oltre, il recupero non insiste (riprova il giro completo programmato)
export const RETRY_DELAYS = { temporary: [30 * MIN, 90 * MIN, 4 * H], error: [60 * MIN, 3 * H, 8 * H] };   // intervalli progressivi
export function retryDelayMs(cls, attempts) {
  const l = RETRY_DELAYS[cls] ?? RETRY_DELAYS.error;
  return l[Math.max(0, Math.min(l.length - 1, (attempts ?? 1) - 1))];
}

/**
 * Compiti obsoleti: partita non più aperta (finita, iniziata da oltre 3 ore, uscita dalla finestra) o compito vecchio di oltre 48 ore.
 * Restituisce { keep, drop }. I compiti non legati a una partita (campionato, corner storici) restano finché non scadono.
 */
export function pruneTasks(tasks, openKickoff, now = Date.now()) {
  const keep = [], drop = [];
  for (const t of tasks ?? []) {
    const isGame = /^af-\d+$/.test(String(t.scope ?? "")) || (t.component !== "league" && t.component !== "cornerStats");
    const ko = openKickoff?.get?.(t.scope);
    const obsolete = (isGame && t.component !== "cornerStats" && (ko == null || ko < now - 3 * H)) || (t.first_seen_at && now - Date.parse(t.first_seen_at) > 48 * H);
    (obsolete ? drop : keep).push(t);
  }
  return { keep, drop };
}
