#!/usr/bin/env node
/**
 * Scopre TUTTE le competizioni con partite nei prossimi N giorni (default 7) disponibili sul tuo piano API-Football,
 * indicando quali sono già in Stay Live e quali no, con i flag di copertura (pronostici, quote, statistiche per partita).
 * Costo: N richieste (una per giorno) + una per ogni competizione non configurata (max 200, escluse giovanili/femminili/riserve) per la copertura. Non scrive nulla.
 *   API_FOOTBALL_KEY=... node scripts/discover-matches.js [giorni]
 */
import { LEAGUES, errorMessage } from "../functions/api/_lib.js";
import { coverageFlags } from "../functions/api/_diag.js";

const BASE = "https://v3.football.api-sports.io";
const SKIP_RE = /u-?\d\d|youth|women|femin|reserve|primavera|junior|j[uú]niores|academy|u\d\d/i;
const NATIONAL_RE = /nations league|friendl|qualif|world cup|euro(pean)? championship|copa am|africa cup|asian cup|gold cup|olympic|u-?\d\d|women/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const GAP_MS = 400;                 // ~2,5 richieste al secondo: sotto qualsiasi limite al minuto
const COVERAGE_BUDGET_MS = 6 * 60e3;   // la lettura della copertura si ferma dopo 6 minuti e stampa quanto ha letto

/** Raggruppa le partite per competizione. responses = array di `response` di fixtures?date=. */
export function summarizeFixtures(responses, configuredIds = new Set(LEAGUES.map((l) => l.afId))) {
  const by = new Map();
  for (const fx of responses.flat()) {
    const lg = fx.league ?? {};
    if (lg.id == null) continue;
    const o = by.get(lg.id) ?? { id: lg.id, name: lg.name, country: lg.country, season: lg.season, matches: 0, first: null, last: null, configured: configuredIds.has(lg.id) };
    o.matches += 1;
    const t = fx.fixture?.date;
    if (t && (!o.first || t < o.first)) o.first = t;
    if (t && (!o.last || t > o.last)) o.last = t;
    by.set(lg.id, o);
  }
  return [...by.values()].map((o) => ({ ...o, national: o.country === "World" && NATIONAL_RE.test(o.name ?? "") }))
    .sort((a, b) => Number(a.configured) - Number(b.configured) || b.matches - a.matches || String(a.country).localeCompare(String(b.country)));
}

async function af(key, path, params, tries = 3) {
  for (let i = 1; i <= tries; i += 1) {
    const url = new URL(path, BASE); for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    let res;
    try { res = await fetch(url, { headers: { "x-apisports-key": key }, signal: AbortSignal.timeout(25000) }); }   // mai più bloccato su una richiesta senza risposta
    catch (e) { if (i < tries) { await sleep(3000 * i); continue; } throw new Error(`timeout/rete: ${errorMessage(e).slice(0, 80)}`); }
    const body = await res.json().catch(() => ({}));
    const err = body.errors && !Array.isArray(body.errors) ? Object.values(body.errors).join(" ") : "";
    if (res.ok && !err) return { data: body.response ?? [], remaining: res.headers.get("x-ratelimit-requests-remaining") };
    if (i < tries && /limit|too many|rate/i.test(err)) { await sleep(15000 * i); continue; }
    throw new Error(err || `HTTP ${res.status}`);
  }
}

async function main() {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) { console.error("Manca API_FOOTBALL_KEY"); process.exit(1); }
  const days = Math.min(14, Math.max(1, Number(process.argv[2] || process.env.DAYS) || 7));
  const out = []; let remaining = null;
  for (let d = 0; d < days; d += 1) {
    const day = new Date(Date.now() + d * 86400e3).toISOString().slice(0, 10);
    const r = await af(key, "fixtures", { date: day, timezone: "UTC" }); remaining = r.remaining; out.push(r.data); await sleep(GAP_MS);
    console.log(`giorno ${day}: ${r.data.length} partite`);
  }
  const rows = summarizeFixtures(out);
  const missing = rows.filter((r) => !r.configured);
  const worth = missing.filter((r) => !SKIP_RE.test(r.name ?? ""));          // la copertura si legge solo per competizioni non giovanili/femminili/riserve
  const t0 = Date.now(); let done = 0;
  for (const r of worth.slice(0, 200)) {
    if (Date.now() - t0 > COVERAGE_BUDGET_MS) { console.log(`Tempo limite della lettura copertura: lette ${done} competizioni su ${Math.min(worth.length, 200)}.`); break; }
    try { const c = await af(key, "leagues", { id: r.id, season: r.season }); r.coverage = coverageFlags(c.data, r.season); remaining = c.remaining; } catch (e) { r.coverageError = errorMessage(e).slice(0, 60); }
    done += 1; if (done % 20 === 0) console.log(`copertura letta: ${done}/${Math.min(worth.length, 200)}`);
    await sleep(GAP_MS);
  }
  const mark = (v) => (v === true ? "sì" : v === false ? "no" : "?");
  const lines = [`## Partite dei prossimi ${days} giorni su API-Football`, "", `Totale: ${out.flat().length} partite in ${rows.length} competizioni · già in Stay Live: ${rows.length - missing.length} · NON configurate: ${missing.length} · richieste restanti oggi: ${remaining}`, "",
    "### Non ancora in Stay Live (id · paese · competizione · partite · pronostici/quote/statistiche)"];
  for (const r of missing) lines.push(`- ${r.national ? "🌍 " : ""}**${r.id}** · ${r.country} · ${r.name} · ${r.matches} partite (${String(r.first).slice(5, 10)} → ${String(r.last).slice(5, 10)}) · stagione ${r.season} · ${r.coverage ? `pron ${mark(r.coverage.predictions)} / quote ${mark(r.coverage.odds)} / stat ${mark(r.coverage.statistics)}` : "copertura non letta (giovanili/femminili/riserve)"}`);
  lines.push("", "### Già configurate");
  for (const r of rows.filter((x) => x.configured)) lines.push(`- ${r.id} · ${r.country} · ${r.name} · ${r.matches} partite`);
  console.log(lines.join("\n"));
  if (process.env.GITHUB_STEP_SUMMARY) (await import("node:fs")).appendFileSync(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n");
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(errorMessage(e)); process.exit(1); });
