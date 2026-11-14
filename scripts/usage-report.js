#!/usr/bin/env node
/**
 * Diagnosi dei crediti API-Football: da dove vengono le richieste di oggi.
 * Legge SOLO tabelle già esistenti (af_usage, refresh_runs, refresh_tasks, af_cache): nessuna richiesta ad API-Football, nessuna scrittura.
 * Uso: SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/usage-report.js  (o il workflow «Diagnosi crediti»).
 *
 * Come si ricava la ripartizione:
 *   - af_usage.requests            = tutte le richieste fatte da Stay Live oggi (script + app).
 *   - refresh_runs[].meta.requests = richieste di ogni giro dello script (completo / recupero / manuale).
 *   - «app e altro» = totale − somma dei giri. Contiene le aperture di schede partita, la ricerca corner dell'app, le anteprime.
 *     (I giri si misurano con la differenza del contatore: richieste dell'app fatte durante un giro finiscono nel giro.)
 *   - af_cache: righe scaricate oggi per tipo di dato (stima per difetto: una chiave riscaricata conta una volta sola).
 */
import { supabaseGet, supabaseGetAll } from "../functions/api/_lib.js";

const pad = (n) => String(n).padStart(2, "0");
const day = (t) => new Date(t).toISOString().slice(0, 10);
const hhmm = (t) => { const d = new Date(t); return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`; };
const sum = (a) => a.reduce((t, x) => t + x, 0);

/** Funzione pura: dai dati grezzi al rapporto (testabile senza rete). */
export function usageReport({ usage = [], runs = [], cache = [], tasks = [], now = Date.now() } = {}) {
  const today = day(now), u = usage.find((x) => x.day === today) ?? null;
  const todayRuns = runs.filter((r) => day(r.started_at) === today).sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at));
  const spent = (r) => Number(r.meta?.requests?.thisRun) || 0;
  const byMode = {};
  for (const r of todayRuns) { const m = r.mode ?? "?"; byMode[m] ??= { runs: 0, requests: 0, partial: 0 }; byMode[m].runs += 1; byMode[m].requests += spent(r); if (r.status !== "ok") byMode[m].partial += 1; }
  const total = u?.requests ?? null, runsTotal = sum(todayRuns.map(spent));
  const other = total == null ? null : Math.max(0, total - runsTotal);
  const dayStart = Date.parse(`${today}T00:00:00Z`);
  const endpoints = {};
  for (const c of cache) if (Date.parse(c.fetched_at) >= dayStart) { const k = String(c.endpoint ?? "?").split("?")[0]; endpoints[k] = (endpoints[k] ?? 0) + 1; }
  const pending = {};
  for (const t of tasks) { const k = `${t.component}/${t.state}`; pending[k] ??= { count: 0, maxAttempts: 0 }; pending[k].count += 1; pending[k].maxAttempts = Math.max(pending[k].maxAttempts, t.attempts ?? 1); }
  const share = (n) => (total ? Math.round((n / total) * 100) : null);
  const findings = [];
  const rec = byMode.recover;
  if (total != null && rec && share(rec.requests) >= 35) findings.push(`Il **recupero automatico** (ogni 30 minuti) ha speso ${rec.requests} richieste, il ${share(rec.requests)}% di oggi, in ${rec.runs} giri. Se ci sono sempre compiti in sospeso, ogni giro ne spende almeno 250: conviene passare il cron a ogni ora o fermare i compiti che non si chiudono mai.`);
  if (other != null && share(other) >= 30) findings.push(`**App e altro** pesano il ${share(other)}% (${other} richieste): aperture di schede partita, ricerca corner e anteprime fatte dall'app. Chiedi a chi usa l'app di non aprire molte schede, oppure di non premere «Aggiorna tutto ora».`);
  const full = byMode.full ?? byMode.manual;
  if (total != null && full && share(full.requests) >= 50) findings.push(`Gli **aggiornamenti completi** pesano il ${share(full.requests)}%: con molti campionati le partite vicine costano parecchio. Riduci FIXTURES_DAYS (oggi 7) o i campionati coperti.`);
  const stuck = Object.entries(pending).filter(([, v]) => v.maxAttempts >= 5);
  if (stuck.length) findings.push(`Compiti che si ripetono da molti tentativi: ${stuck.map(([k, v]) => `${k} (${v.count}, fino a ${v.maxAttempts} tentativi)`).join(", ")}. Ogni tentativo può costare crediti.`);
  if (u?.remaining != null && u.limit_day && u.remaining < u.limit_day * 0.1) findings.push(`Restano solo ${u.remaining} crediti su ${u.limit_day}: gli script si fermano da soli sotto le riserve (1.500 per le schede, 2.500 per i corner storici).`);
  return { today, usage: u, total, runsTotal, other, byMode, runs: todayRuns.map((r) => ({ at: hhmm(r.started_at), mode: r.mode, status: r.status, requests: spent(r), remaining: r.meta?.requests?.remaining ?? null, notes: (r.meta?.notes ?? []).length })), endpoints, pending, findings, history: usage.slice().sort((a, b) => (a.day < b.day ? 1 : -1)).slice(0, 7) };
}

export function reportMarkdown(r) {
  const L = [`## Consumo crediti API-Football · ${r.today}`, ""];
  if (r.usage) L.push(`- **Oggi:** ${r.total} richieste${r.usage.limit_day ? ` su ${r.usage.limit_day}` : ""}${r.usage.remaining != null ? ` · restanti ${r.usage.remaining}` : ""} (ultimo dato ${r.usage.updated_at ?? "n.d."})`);
  else L.push("- Nessun contatore per oggi (af_usage vuoto).");
  L.push("", "### Chi ha speso", "", "| Origine | Giri | Richieste | % |", "|---|---:|---:|---:|");
  const pc = (n) => (r.total ? `${Math.round((n / r.total) * 100)}%` : "—");
  for (const [m, v] of Object.entries(r.byMode)) L.push(`| ${m === "full" ? "Aggiornamento completo" : m === "recover" ? "Recupero (ogni 30 min)" : m === "manual" ? "Aggiornamento manuale" : m} | ${v.runs} (${v.partial} non riusciti) | ${v.requests} | ${pc(v.requests)} |`);
  L.push(`| App e altro (schede aperte, corner, anteprime) | — | ${r.other ?? "—"} | ${r.other == null ? "—" : pc(r.other)} |`);
  if (r.runs.length) { L.push("", "### Giri di oggi (UTC)", "", "| Ora | Tipo | Esito | Richieste | Restanti dopo |", "|---|---|---|---:|---:|"); for (const x of r.runs) L.push(`| ${x.at} | ${x.mode} | ${x.status} | ${x.requests} | ${x.remaining ?? "—"} |`); }
  const ep = Object.entries(r.endpoints).sort((a, b) => b[1] - a[1]);
  if (ep.length) { L.push("", "### Dati scaricati oggi per tipo (stima per difetto)", "", ...ep.map(([k, n]) => `- ${k}: ${n}`)); }
  const pe = Object.entries(r.pending);
  if (pe.length) { L.push("", "### Compiti ancora in sospeso", "", ...pe.map(([k, v]) => `- ${k}: ${v.count} (fino a ${v.maxAttempts} tentativi)`)); }
  L.push("", "### Cosa emerge", "", ...(r.findings.length ? r.findings.map((f) => `- ${f}`) : ["- Nessuna anomalia evidente: guarda la tabella dei giri per l'andamento."]));
  if (r.history.length) { L.push("", "### Ultimi giorni", "", "| Giorno | Richieste | Limite | Restanti |", "|---|---:|---:|---:|", ...r.history.map((h) => `| ${h.day} | ${h.requests} | ${h.limit_day ?? "—"} | ${h.remaining ?? "—"} |`)); }
  return `${L.join("\n")}\n`;
}

async function main() {
  const need = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].filter((k) => !process.env[k]);
  if (need.length) { console.error(`Mancano: ${need.join(", ")}`); process.exit(1); }
  const env = process.env, since = new Date(Date.now() - 36 * 3600e3).toISOString();
  const [usage, runs, tasks, cache] = await Promise.all([
    supabaseGet(env, "af_usage", { select: "*", order: "day.desc", limit: 7 }).catch(() => []),
    supabaseGetAll(env, "refresh_runs", { select: "mode,status,started_at,meta", started_at: `gte.${since}`, order: "started_at.asc" }, 500, 4).catch(() => []),
    supabaseGetAll(env, "refresh_tasks", { select: "component,state,attempts", order: "next_try_at.asc" }, 1000, 10).catch(() => []),
    supabaseGetAll(env, "af_cache", { select: "endpoint,fetched_at", fetched_at: `gte.${new Date(Date.now() - 26 * 3600e3).toISOString()}` }, 1000, 40).catch(() => []),
  ]);
  const out = reportMarkdown(usageReport({ usage, runs, cache, tasks }));
  console.log(out);
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(e); process.exit(1); });
