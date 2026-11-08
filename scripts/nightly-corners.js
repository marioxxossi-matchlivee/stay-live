#!/usr/bin/env node
/**
 * Giro notturno dei corner: a mezzanotte (ora italiana) cerca le quote corner di TUTTE le partite in programma nei prossimi 7 giorni
 * e le lascia in cache su Supabase, così l'app le trova già pronte (nessuna ricerca manuale).
 * Lo lancia .github/workflows/corner-notturni.yml. Variabili: SITE_URL, SYNC_SECRET (come gli altri workflow), FORCE=true per saltare il controllo dell'ora.
 * Le quote si riscaricano ogni notte (`since` = inizio del giro); dentro lo stesso giro quelle già scaricate non si ripetono.
 */
const RATE_RE = /limite|richieste|too many|rate/i;
export const DAYS = 7, BATCH = 6, MAX_ATTEMPTS = 14;

/** Ora (0-23) a Roma di un istante. */
export function romeHour(date = new Date()) {
  return Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Rome", hour: "2-digit", hourCycle: "h23" }).format(date));
}

/** Partite da cercare: in programma (non iniziate) nei prossimi `days` giorni, in ordine di calcio d'inizio. */
export function selectTargets(matches, now = Date.now(), days = DAYS) {
  return (matches ?? [])
    .filter((m) => m.status === "scheduled" && Date.parse(m.kickoffAt) > now && Date.parse(m.kickoffAt) <= now + days * 86400e3)
    .sort((a, b) => Date.parse(a.kickoffAt) - Date.parse(b.kickoffAt))
    .map((m) => m.id);
}

export const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

/**
 * Cerca i corner a gruppi di BATCH partite. `get(path)` restituisce { status, body }; `sleep(ms)` attende.
 * Se il provider limita le richieste (o risponde `retry`) si aspetta e si riprova lo stesso gruppo, fino a MAX_ATTEMPTS volte.
 * Restituisce { total, used, none, missing, pending }.
 */
export async function runCorners(ids, { get, sleep, since, log = () => {} }) {
  const out = { total: ids.length, used: 0, none: 0, missing: 0, pending: 0 };
  for (const part of chunk(ids, BATCH)) {
    let state = {}, left = part.length;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const r = await get(`/api/corners?ids=${part.map(encodeURIComponent).join(",")}&since=${since}`);
      if (r.status !== 200) {
        const msg = String(r.body?.error ?? r.status);
        log(`… gruppo ${part[0]}… tentativo ${attempt}: ${msg.slice(0, 120)}`);
        await sleep(RATE_RE.test(msg) ? 20000 : 6000);
        continue;
      }
      state = r.body.state ?? {};
      left = r.body.retry?.pending ?? 0;
      if (!left) break;
      await sleep(Math.max(1500, Number(r.body.retry?.afterMs) || 1500));
    }
    for (const id of part) {
      const s = state[id] ?? "missing";
      if (s === "used") out.used += 1; else if (s === "none") out.none += 1; else if (s === "waiting") out.pending += 1; else out.missing += 1;
    }
  }
  return out;
}

async function main() {
  const { SITE_URL, SYNC_SECRET, FORCE } = process.env;
  if (!SITE_URL || !SYNC_SECRET) { console.error("Mancano i secrets SITE_URL e SYNC_SECRET"); process.exit(1); }
  if (FORCE !== "true" && romeHour() !== 0) { console.log(`Non è mezzanotte a Roma (ore ${romeHour()}): nessuna ricerca. Il workflow parte due volte per coprire ora solare e legale.`); return; }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const get = async (path) => {
    try {
      const res = await fetch(`${SITE_URL}${path}`, { headers: { "x-sync-secret": SYNC_SECRET }, signal: AbortSignal.timeout(110000) });
      const text = await res.text();
      let body = null; try { body = JSON.parse(text); } catch { body = { error: text.slice(0, 160) }; }
      return { status: res.status, body };
    } catch (e) { return { status: 0, body: { error: String(e?.message ?? e) } }; }
  };
  const since = Date.now();
  let fx = null;
  for (let i = 1; i <= 5 && !fx; i += 1) { const r = await get("/api/fixtures?fresh=1"); if (r.status === 200) fx = r.body; else { console.log(`… elenco partite tentativo ${i}: ${r.body?.error ?? r.status}`); await sleep(15000 * i); } }
  if (!fx) { console.error("Elenco partite non disponibile"); process.exit(1); }
  const ids = selectTargets(fx.matches, since);
  console.log(`Partite dei prossimi ${DAYS} giorni: ${ids.length}`);
  const res = await runCorners(ids, { get, sleep, since, log: console.log });
  console.log(`Corner trovati: ${res.used} · senza quote: ${res.none} · non cercabili: ${res.missing} · in sospeso: ${res.pending}`);
  await get("/api/fixtures?fresh=1");      // riscalda l'elenco con i corner appena salvati
  if (ids.length && res.used + res.none === 0) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
