#!/usr/bin/env node
/**
 * Stay Live Tennis — sonda dell'API: chiama UNA volta ciascun percorso indicato e salva una risposta di esempio RIDOTTA
 * (massimo 2 elementi per elenco), così si vedono i nomi reali dei campi prima di scrivere/adattare il client.
 * Non usa retry e consuma 1 richiesta per percorso. La chiave non viene mai stampata né salvata.
 *
 * Variabili: TENNIS_API_KEY (obbligatoria), TENNIS_API_HOST (predefinita: tennis-api-atp-wta-itf.p.rapidapi.com),
 *            PROBE_PATHS = percorsi separati da virgola o a capo, es. "/tennis/v2/upcoming/matches/atp,/tennis/v2/..."
 * Uscita: tennis-probe-output.json (+ riepilogo in $GITHUB_STEP_SUMMARY se presente).
 */
import fs from "node:fs";
import { pathToFileURL } from "node:url";

export const DEFAULT_HOST = "tennis-api-atp-wta-itf.p.rapidapi.com";
export const DEFAULT_PATHS = ["/tennis/v2/upcoming/matches/atp"];

/** Riduce un JSON a un esempio leggibile: elenchi tagliati, stringhe lunghe accorciate, profondità limitata. */
export function shrink(value, { maxItems = 2, maxDepth = 6, maxString = 120 } = {}, depth = 0) {
  if (Array.isArray(value)) {
    const head = depth >= maxDepth ? [] : value.slice(0, maxItems).map((v) => shrink(v, { maxItems, maxDepth, maxString }, depth + 1));
    return value.length > maxItems ? { _length: value.length, _example: head } : head;
  }
  if (value && typeof value === "object") {
    if (depth >= maxDepth) return "{…}";
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shrink(v, { maxItems, maxDepth, maxString }, depth + 1)]));
  }
  if (typeof value === "string" && value.length > maxString) return value.slice(0, maxString) + "…";
  return value;
}

/** Toglie la chiave da qualunque testo (messaggi d'errore, URL, intestazioni). */
export const redact = (text, secret) => (secret ? String(text).split(secret).join("***") : String(text));

export function parsePaths(raw) {
  const list = String(raw ?? "").split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
  const paths = list.length ? list : DEFAULT_PATHS;
  for (const p of paths) if (!p.startsWith("/") || /\s|\.\.|:\/\//.test(p)) throw new Error(`Percorso non valido: ${p}`);
  return paths;
}

export const DIRECT_BASE = "https://api.sportsapi365.com/v1/tennis";

/** mode "direct" (SportsAPI365): `base` = URL base completo, chiave in X-Gravitee-Api-Key. mode "rapidapi": `host` e intestazioni RapidAPI. */
export async function probeOne(host, key, path, fetchImpl = fetch, timeoutMs = 15000, { mode = "rapidapi", base = DIRECT_BASE } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const direct = mode === "direct";
    const res = await fetchImpl(direct ? `${base.replace(/\/+$/, "")}${path}` : `https://${host}${path}`, {
      headers: direct ? { "X-Gravitee-Api-Key": key, Accept: "application/json" } : { "X-RapidAPI-Key": key, "X-RapidAPI-Host": host, Accept: "application/json" },
      signal: ctl.signal,
    });
    const text = await res.text();
    let body; try { body = JSON.parse(text); } catch { body = text.slice(0, 300); }
    return {
      path, status: res.status, ok: res.ok,
      rateLimit: Object.fromEntries([...res.headers].filter(([k]) => /ratelimit|quota|requests-remaining/i.test(k))),
      sample: res.ok ? shrink(body) : redact(typeof body === "string" ? body : JSON.stringify(body).slice(0, 300), key),
    };
  } catch (e) {
    return { path, status: 0, ok: false, sample: redact(e?.name === "AbortError" ? "timeout" : e?.message ?? "errore di rete", key) };
  } finally { clearTimeout(timer); }
}

async function main() {
  const key = process.env.TENNIS_API_KEY;
  if (!key) { console.error("Manca TENNIS_API_KEY"); process.exit(1); }
  // Predefinito: SportsAPI365 Direct. TENNIS_API_MODE=rapidapi per il vecchio provider. TENNIS_API_BASE sovrascrive l'URL base.
  const mode = (process.env.TENNIS_API_MODE || "direct").toLowerCase() === "rapidapi" ? "rapidapi" : "direct";
  const host = process.env.TENNIS_API_HOST || DEFAULT_HOST;
  const base = process.env.TENNIS_API_BASE || DIRECT_BASE;
  if (mode === "direct" && !String(process.env.PROBE_PATHS ?? "").trim()) { console.error("Indica almeno un percorso in PROBE_PATHS (nessun percorso predefinito per SportsAPI365)."); process.exit(1); }
  const paths = parsePaths(process.env.PROBE_PATHS);
  const results = [];
  for (const p of paths) {
    const r = await probeOne(host, key, p, fetch, 15000, { mode, base });
    console.log(`${r.ok ? "OK " : "ERR"} ${r.status} ${p}`);
    results.push(r);
    await new Promise((ok) => setTimeout(ok, 400)); // senza raffiche
  }
  const out = { provider: mode, base: mode === "direct" ? base : host, at: new Date().toISOString(), results };
  fs.writeFileSync("tennis-probe-output.json", JSON.stringify(out, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, "## Sonda Tennis-API\n" + results.map((r) => `- \`${r.path}\` → ${r.status}`).join("\n") + "\n\nIl file `tennis-probe-output.json` è negli artifact del giro.\n");
  }
  process.exit(results.some((r) => r.ok) ? 0 : 1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
