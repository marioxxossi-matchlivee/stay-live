/**
 * Stay Live Tennis — LIVE OBSERVATION: registrazione nel giro «refresh» (I/O sottile attorno alla logica pura di _tennis-observation.js).
 * Garanzie:
 *  - NON lancia mai: ogni errore è catturato e restituito in `error` (finisce in meta.liveObservation, visibile nella diagnostica); il refresh ordinario prosegue.
 *  - SPENTO per impostazione predefinita: si attiva solo con TENNIS_LIVE_OBSERVATION=on (nessun workflow lo imposta; rollback = togliere la variabile).
 *  - Scrive SOLO in tennis_observations e tennis_observation_versions, SOLO con INSERT che ignora i duplicati (mai upsert/merge, mai update, mai delete).
 *  - Nessuna richiesta al provider; non tocca tennis_predictions, il modello, i rating, il loader.
 */
import { planObservations, historyFingerprint, checkHistoryPrematch, OBSERVATION } from "./_tennis-observation.js";

export const liveObservationEnabled = (env = process.env) => String(env.TENNIS_LIVE_OBSERVATION ?? "").trim().toLowerCase() === "on";

/** INSERT con `resolution=ignore-duplicates`: ripetere lo stesso inserimento non crea righe né modifica quelle esistenti. */
export async function insertIgnore(env, table, rows, conflict) {
  for (let i = 0; i < rows.length; i += 200) {
    const url = new URL(`/rest/v1/${table}`, env.SUPABASE_URL); url.searchParams.set("on_conflict", conflict);
    const res = await fetch(url, { method: "POST", headers: { apikey: env.SUPABASE_SERVICE_ROLE_KEY, authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`, "content-type": "application/json", prefer: "resolution=ignore-duplicates,return=minimal" }, body: JSON.stringify(rows.slice(i, i + 200)) });
    if (!res.ok) throw new Error(`insert ${table}: HTTP ${res.status} ${(await res.text()).slice(0, 160)}`);
  }
}

const inList = (ks) => `in.(${ks.map((k) => `"${String(k).split('"').join('\\"')}"`).join(",")})`;

/** Legge le ultime versioni delle partite future già osservate (sola lettura). */
export async function loadExisting(db, keys) {
  const observed = new Set(), last = new Map();
  for (let i = 0; i < keys.length; i += 40) {
    const part = keys.slice(i, i + 40);
    const [o, v] = await Promise.all([
      db.getAll("tennis_observations", { select: "match_key", match_key: inList(part) }, 1000, 1),
      db.getAll("tennis_observation_versions", { select: "match_key,rev,starts_at,model_ver,ratings_ver,published,p1,missing", match_key: inList(part), order: "rev.asc" }, 1000, 2),
    ]);
    for (const r of o) observed.add(r.match_key);
    for (const r of v) last.set(r.match_key, r); // ordine per rev crescente: resta l'ultima
  }
  return { observed, last };
}

/**
 * Registra le valutazioni pre-match di questo giro. `rows` = righe di previsione già calcolate dal motore (non vengono modificate né rilette dal database).
 * `history` = lo storico GIÀ in memoria usato dal motore (nessuna lettura aggiuntiva). Restituisce sempre un oggetto: { enabled, ..., blocked?, error? }.
 */
export async function recordLiveObservation({ db, matches, rows, book, stats, ranks, now, history, loader, enabled = liveObservationEnabled() }) {
  if (!enabled) return { enabled: false };
  const meta = { enabled: true, version: OBSERVATION.version, at: new Date(now).toISOString() };
  try {
    // Controllo indipendente anti look-ahead PRIMA di qualunque lettura o scrittura: storico con date future o vuoto = nessuna registrazione, nessuna correzione.
    const fp = historyFingerprint(history, loader, now), guard = checkHistoryPrematch(fp, now);
    meta.history = { matches: fp.matches, lastAt: fp.lastAt == null ? null : new Date(fp.lastAt).toISOString(), invalid: fp.invalid, ratingsVer: fp.version };
    if (!guard.ok) { meta.blocked = { reason: guard.code, ...guard.detail }; meta.error = `${guard.code}: registrazione bloccata (${guard.code === "history_future_date" ? `${guard.detail.count ?? "?"} partite concluse con data dopo l'istante di elaborazione, ultima ${guard.detail.latestAt}` : "storico vuoto"})`; return meta; }
    if (typeof db.insertIgnore !== "function") throw new Error("db.insertIgnore non disponibile");
    const keys = rows.map((r) => r.match_key);
    const existing = await loadExisting(db, keys);
    const plan = planObservations({ matches, rows, book, stats, ranks, existing, now, ratings: fp });
    await db.insertIgnore("tennis_observations", plan.observations, "match_key");
    await db.insertIgnore("tennis_observation_versions", plan.versions, "match_key,rev");
    const reasons = {}; for (const v of plan.versions) reasons[v.reason] = (reasons[v.reason] ?? 0) + 1;
    Object.assign(meta, { candidates: rows.length, newObservations: plan.observations.length, newVersions: plan.versions.length, reasons, skipped: plan.skipped.length, skippedSample: plan.skipped.slice(0, 5) });
  } catch (e) { meta.error = String(e?.message ?? e).slice(0, 300); }
  return meta;
}
