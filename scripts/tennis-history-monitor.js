#!/usr/bin/env node
/**
 * Stay Live Tennis — MONITORAGGIO del caricamento storico (controllo periodico). SOLA LETTURA: nessuna scrittura, nessun provider, nessun effetto sul motore.
 * Rilegge lo storico completo con la paginazione a chiave e segnala ESPLICITAMENTE ogni caricamento incompleto o sospetto:
 *   totale righe, concluse valide, duplicati, partite mancanti (rispetto al database, al tetto operativo e a buchi temporali), giocatori sconosciuti
 *   tra le partite in programma, ultima data disponibile, errori di paginazione, riproducibilità (seconda lettura).
 * Esiti: OK · ATTENZIONE (da guardare, il workflow resta verde) · INCOMPLETO (il workflow fallisce con codice 1).
 * Segreti: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (mai stampati).
 */
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { loadFinishedKeyset } from "../functions/api/_tennis-history.js";
import { keysetQuery, toEntries, fingerprintRows, makeReaders, OPERATIVE_HISTORY_CAP } from "./tennis-history-shadow.js";
import { historyLoaderMode, buildBook } from "./tennis-sync.js";

const H = 3600e3, DAY = 24 * H;
const LEVEL = { ok: 0, attenzione: 1, incompleto: 2 };

/**
 * Funzione PURA: dalle misure all'esito. input = { rows, pages, duplicates, truncated, dbCount, secondFingerprint, scheduledIds, knownIds, nowMs, loader, cap, tolerance, error }.
 * Ogni controllo restituisce { id, level, detail }; l'esito è il peggiore dei livelli.
 */
export function evaluateHealth(m) {
  const checks = [], add = (id, level, detail) => checks.push({ id, level, detail });
  const cap = m.cap ?? OPERATIVE_HISTORY_CAP, tol = m.tolerance ?? 50, nowMs = m.nowMs ?? Date.now();
  if (m.error) { add("paginazione", "incompleto", `Errore di paginazione o lettura: ${m.error}`); return finish(checks, m); }
  const rows = m.rows ?? [], entries = toEntries(rows);
  add("paginazione", m.truncated ? "incompleto" : "ok", m.truncated ? "Caricamento TRONCATO dal limite di sicurezza." : `${m.pages} pagine, nessun troncamento.`);
  if (m.dbCount == null) add("conteggio", "attenzione", "Conteggio del database non disponibile: completezza non verificata.");
  else if (rows.length === m.dbCount) add("conteggio", "ok", `${rows.length} righe lette = ${m.dbCount} nel database.`);
  else add("conteggio", Math.abs(rows.length - m.dbCount) <= tol ? "attenzione" : "incompleto", `Righe lette ${rows.length}, database ${m.dbCount} (differenza ${rows.length - m.dbCount}${Math.abs(rows.length - m.dbCount) <= tol ? ": probabile aggiornamento durante la lettura, rilanciare" : ": PARTITE MANCANTI o in eccesso"}).`);
  add("duplicati", (m.duplicates ?? 0) === 0 ? "ok" : "attenzione", (m.duplicates ?? 0) === 0 ? "Nessun duplicato." : `${m.duplicates} righe duplicate scartate dal server di paginazione.`);
  add("concluse valide", entries.length === rows.length ? "ok" : "attenzione", `${entries.length} concluse valide su ${rows.length} righe${entries.length === rows.length ? "" : ` (${rows.length - entries.length} senza vincitore 1|2)`}.`);
  if ((m.loader ?? "offset") !== "keyset" && rows.length > cap) add("percorso operativo", "attenzione", `Il motore usa ancora il percorso OFFSET: legge ${cap} partite su ${rows.length}, ne ignora ${rows.length - cap} (le più recenti). Comportamento noto, in attesa della decisione di attivazione.`);
  else add("percorso operativo", "ok", `Caricamento operativo: ${m.loader ?? "offset"}${rows.length > cap ? "" : " (sotto il tetto)"}.`);
  const ts = entries.map((e) => e.t); let gap = 0, gapAt = null; for (let i = 1; i < ts.length; i++) if (ts[i] - ts[i - 1] > gap) { gap = ts[i] - ts[i - 1]; gapAt = ts[i - 1]; }
  add("buchi temporali", gap > 7 * DAY ? "attenzione" : "ok", gap > 7 * DAY ? `Buco di ${(gap / DAY).toFixed(1)} giorni dopo ${new Date(gapAt).toISOString()}: possibili partite mancanti.` : `Nessun buco oltre 7 giorni (massimo ${(gap / DAY).toFixed(2)}).`);
  const last = ts.at(-1), age = last == null ? Infinity : nowMs - last;
  add("ultima data", age > 120 * H ? "incompleto" : age > 48 * H || age < -30 * 60e3 ? "attenzione" : "ok", last == null ? "Nessuna partita." : `Ultima partita ${new Date(last).toISOString()} (${age >= 0 ? `${(age / H).toFixed(1)} ore fa` : `${(-age / H).toFixed(1)} ore NEL FUTURO: vedi controllo sulle date future`}).`);
  // Partite CONCLUSE con orario di inizio nel futuro: impossibile se i dati sono coerenti (fuso orario sbagliato, stato errato o data errata). Falsa l'ordine cronologico e il rigioco.
  const TOL = 30 * 60e3, fut = rows.filter((r) => Date.parse(r.starts_at) > nowMs + TOL).sort((a, b) => Date.parse(b.starts_at) - Date.parse(a.starts_at));
  add("concluse con data futura", fut.length === 0 ? "ok" : "attenzione", fut.length === 0 ? "Nessuna partita conclusa con inizio nel futuro." : `${fut.length} partite concluse con inizio nel futuro (fino a ${((Date.parse(fut[0].starts_at) - nowMs) / H).toFixed(1)} ore avanti; esempi: ${fut.slice(0, 3).map((r) => `${r.match_key} ${r.starts_at}`).join("; ")}). Verificare fuso orario e stato nella sincronizzazione.`);
  if (m.scheduledIds) { const known = m.knownIds ?? buildBook(entries).players, unknown = [...m.scheduledIds].filter((id) => !(known.has ? known.has(id) : false)).length, share = m.scheduledIds.size ? unknown / m.scheduledIds.size : 0; add("giocatori sconosciuti", share > 0.1 ? "attenzione" : "ok", `${unknown} giocatori su ${m.scheduledIds.size} in programma senza storico (${(share * 100).toFixed(1)}%).`); }
  if (m.secondFingerprint == null) add("riproducibilità", "attenzione", "Seconda lettura non eseguita.");
  else add("riproducibilità", m.secondFingerprint === fingerprintRows(rows) ? "ok" : "attenzione", m.secondFingerprint === fingerprintRows(rows) ? "Seconda lettura identica." : "Seconda lettura DIVERSA: il database è cambiato tra le due letture, rilanciare.");
  return finish(checks, m);
}
function finish(checks, m) {
  const worst = Math.max(0, ...checks.map((c) => LEVEL[c.level])), status = ["OK", "ATTENZIONE", "INCOMPLETO"][worst];
  return { status, checks, rows: m.rows?.length ?? null, loader: m.loader ?? "offset" };
}
export const renderHealth = (h, at) => `## Monitoraggio storico tennis — **${h.status}**\nControllo del ${at}. Percorso operativo: ${h.loader}. Sola lettura.\n\n| controllo | esito | dettaglio |\n|---|---|---|\n${h.checks.map((c) => `| ${c.id} | ${c.level.toUpperCase()} | ${c.detail} |`).join("\n")}\n`;

async function main() {
  for (const k of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) if (!process.env[k]) { console.error(`Variabile mancante: ${k}`); process.exit(1); }
  const io = makeReaders(process.env), now = Date.now(), q = keysetQuery(now), meas = { loader: historyLoaderMode(), nowMs: now };
  try {
    const nw = await loadFinishedKeyset(io.fetchPage, { query: q, retries: 2 }); Object.assign(meas, { rows: nw.rows, pages: nw.pages, duplicates: nw.duplicates, truncated: nw.truncated });
    meas.dbCount = await io.count(q);
    meas.secondFingerprint = fingerprintRows((await loadFinishedKeyset(io.fetchPage, { query: q, retries: 2 })).rows);
    const sched = await io.getAll("tennis_matches", { select: "p1_id,p2_id,starts_at", status: "eq.scheduled", starts_at: `gte.${new Date(now - H).toISOString()}`, order: "starts_at.asc" }, 1000, 12);
    meas.scheduledIds = new Set(sched.flatMap((x) => [x.p1_id, x.p2_id]).filter(Boolean));
  } catch (e) { meas.error = String(e?.message ?? e).slice(0, 300); }
  const h = evaluateHealth(meas), md = renderHealth(h, new Date().toISOString());
  fs.mkdirSync("audit-out", { recursive: true }); fs.writeFileSync("audit-out/tennis-history-monitor.json", JSON.stringify({ ...h, at: new Date().toISOString() }, null, 2)); fs.writeFileSync("audit-out/tennis-history-monitor.md", md);
  console.log(md); if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  for (const c of h.checks) if (c.level !== "ok") console.log(`::${c.level === "incompleto" ? "error" : "warning"}::${c.id}: ${c.detail}`);
  if (h.status === "INCOMPLETO") process.exit(1);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
