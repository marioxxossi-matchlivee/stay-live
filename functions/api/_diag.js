/**
 * Diagnostica dell'aggiornamento: ogni componente di ogni partita ha UNO tra cinque esiti.
 *   ok          dato aggiornato correttamente
 *   not_yet     dato non ancora disponibile (es. quote non ancora pubblicate per una partita lontana)
 *   not_covered dato non previsto dalla copertura del provider (flag `coverage` di API-Football) o confermato assente dopo più tentativi
 *   temporary   temporaneamente non recuperabile (limite di richieste, timeout, coda, crediti): si riprova da soli
 *   error       errore effettivo di acquisizione
 * Solo `temporary` ed `error` rendono l'aggiornamento "parziale": un dato che il provider non offre non è un guasto.
 * Funzioni pure e testabili; la scrittura su Supabase sta in scripts/full-refresh.js.
 */
export const CLASSES = ["ok", "not_yet", "not_covered", "temporary", "error"];
export const TEMP_RE = /limite|too many|rate|timeout|in coda|quasi esaurito|HTTP 5\d\d|fetch failed|network|abort|riprovare|rimandat/i;
export const MAX_EMPTY_ATTEMPTS = 4;           // dopo tanti tentativi con risposta vuota il dato è considerato non fornito
const FAR_MS = 72 * 3600e3;                     // oltre 72 ore dal fischio d'inizio quote e pronostici di norma non esistono ancora

/** Flag di copertura di un campionato dalla risposta `leagues?id=&season=` (null = sconosciuto). */
export function coverageFlags(resp, season) {
  const seasons = resp?.[0]?.seasons;
  if (!Array.isArray(seasons) || !seasons.length) return null;
  const s = seasons.find((x) => Number(x.year) === Number(season)) ?? seasons[seasons.length - 1];
  const c = s?.coverage;
  if (!c) return null;
  const b = (v) => (typeof v === "boolean" ? v : null);
  return { predictions: b(c.predictions), odds: b(c.odds), injuries: b(c.injuries), standings: b(c.standings), statistics: b(c.fixtures?.statistics_fixtures), lineups: b(c.fixtures?.lineups), events: b(c.fixtures?.events), season: s.year ?? null };
}

const FLAG_OF = { prediction: "predictions", market: "odds", corners: "odds", cornerStats: "statistics", details: null };

/**
 * Esito di un componente di una partita.
 * state: "used" | "none" | "waiting" | "missing" (come negli elenchi di _brain.js / _corners.js); error: messaggio del provider, se c'è.
 * attempts: quante volte l'operazione è già stata tentata (da refresh_tasks); flags: copertura del campionato.
 */
export function classify(component, { state, error = null, kickoff = null, now = Date.now(), flags = null, attempts = 0 } = {}) {
  if (state === "used") return "ok";
  if (state === "waiting") return "temporary";
  const flag = FLAG_OF[component];
  const far = kickoff != null && Date.parse(kickoff) - now > FAR_MS;
  if (flag && flags?.[flag] === false) return "not_covered";
  if (state === "none") return far ? "not_yet" : "not_covered";          // il provider ha risposto: nessuna quota/statistica per questa partita
  if (error) return TEMP_RE.test(error) ? "temporary" : "error";
  if (far) return "not_yet";
  return attempts >= MAX_EMPTY_ATTEMPTS ? "not_covered" : "temporary";    // risposta vuota vicino al fischio: si riprova qualche volta, poi si accetta
}

export const emptyCounts = () => ({ ok: 0, not_yet: 0, not_covered: 0, temporary: 0, error: 0 });

/** Conteggi per classe di un elenco di esiti. */
export function countClasses(classes) { const c = emptyCounts(); for (const k of classes) c[k in c ? k : "error"] += 1; return c; }

/** Esito generale. failed = giro interrotto o nessun campionato aggiornato; partial = resta qualcosa da recuperare o verificare. */
export function statusOf(meta) {
  if (meta.error) return "failed";
  if (meta.leagues.total > 0 && meta.leagues.ok === 0) return "failed";
  const comps = Object.values(meta.components ?? {});
  const open = comps.some((c) => (c.temporary ?? 0) > 0 || (c.error ?? 0) > 0);
  if (meta.leagues.failed.length || open || meta.budgetStop || meta.verify?.ok === false) return "partial";
  return "ok";
}

const MIN = 60e3;
export const RETRY_AFTER = { temporary: 30 * MIN, error: 60 * MIN };

/**
 * Compiti ancora da completare. items = [{ component, scope ("game_id" o "league:<id>"), league, cls, error }].
 * prev = compiti già salvati (per contare i tentativi). Restituisce le righe di refresh_tasks per temporary ed error.
 */
export function buildTasks(items, prev = [], now = Date.now()) {
  const old = new Map(prev.map((t) => [t.task_key, t]));
  return items.filter((i) => i.cls === "temporary" || i.cls === "error").map((i) => {
    const key = `${i.component}:${i.scope}`, p = old.get(key);
    if (i.carry && p) return p;                                           // non ritentato in questo giro: resta com'è (stessi tentativi)
    const attempts = (p?.attempts ?? 0) + 1;
    return { task_key: key, component: i.component, scope: i.scope, league: i.league ?? null, state: i.cls, attempts, last_error: i.error ? String(i.error).slice(0, 300) : null,
      next_try_at: new Date(now + RETRY_AFTER[i.cls] * Math.min(4, attempts)).toISOString(), first_seen_at: p?.first_seen_at ?? new Date(now).toISOString(), updated_at: new Date(now).toISOString() };
  });
}

/** Riepilogo per la schermata: per componente, quanti compiti restano e quando si riprova. */
export function pendingSummary(tasks) {
  const by = {};
  for (const t of tasks) { const o = (by[t.component] ??= { component: t.component, count: 0, errors: 0, nextTryAt: null, sample: null }); o.count += 1; if (t.state === "error") o.errors += 1; if (!o.nextTryAt || t.next_try_at < o.nextTryAt) o.nextTryAt = t.next_try_at; o.sample ??= t.last_error; }
  return Object.values(by);
}

export const COMPONENT_LABEL = { league: "Campionati", prediction: "Pronostici API-Football", market: "Quote Over/Under e 1X2", corners: "Quote corner", cornerStats: "Statistiche corner storiche", details: "Schede dati" };
