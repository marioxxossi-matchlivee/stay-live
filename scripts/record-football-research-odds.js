#!/usr/bin/env node
/**
 * Registra, PRIMA della partita, le quote dei mercati utili alla ricerca (1X2, doppia chance, Over/Under, Exact Goals Number,
 * Multigol a fasce, doppia chance + totale) in `football_research_odds`, a sola aggiunta. Non tocca matches, odds_quotes né le previsioni.
 *   node scripts/record-football-research-odds.js        (env: API_FOOTBALL_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY; DRY_RUN=1 per vedere il piano)
 * Ogni richiesta passa da afFetch: il Budget Manager (priorità "background") rispetta il tetto giornaliero condiviso con l'app.
 */
import { pathToFileURL } from "node:url";
import { AF_LEAGUES, afFetch } from "../functions/api/_apifootball.js";
import { AfBudgetBlocked } from "../functions/api/_budget.js";
import { supabaseGetAll, supabaseUpsert } from "../functions/api/_lib.js";

export const WANTED_BETS = new Set([1, 12, 38, 349, 186, 223]);   // 1X2, doppia chance e mercati sui gol totali (Multigol): niente Over/Under
export const WINDOW_H = 72;          // partite nelle prossime 72 ore
export const NEAR_H = 6;             // entro 6 ore dal calcio d'inizio: rilevazioni più frequenti (chiusura)
export const GAP_NEAR_H = 2.5, GAP_FAR_H = 11;
const H = 3600e3;

/** Partite da rilevare adesso: finestra, cadenza minima per partita, mai dopo il calcio d'inizio. Pura. */
export function selectFixtures(matches, lastCaptured, now, { max = 60 } = {}) {
  const out = [];
  for (const m of matches ?? []) {
    const ko = Date.parse(m.kickoff_at), fx = /^af-(\d+)$/.exec(String(m.game_id ?? ""));
    if (!fx || !AF_LEAGUES[m.league] || !Number.isFinite(ko) || m.status !== "scheduled") continue;
    const ahead = ko - now;
    if (ahead <= 0 || ahead > WINDOW_H * H) continue;
    const last = Date.parse(lastCaptured?.get(m.game_id));
    const gap = (ahead <= NEAR_H * H ? GAP_NEAR_H : GAP_FAR_H) * H;
    if (Number.isFinite(last) && now - last < gap) continue;
    out.push({ game_id: m.game_id, fixture_id: Number(fx[1]), kickoff_at: m.kickoff_at, ko });
  }
  return out.sort((a, b) => a.ko - b.ko).slice(0, max);
}

/** Righe da salvare da una pagina di risposta `odds`. Pura; scarta ciò che non è prima del calcio d'inizio. */
export function extractRows(resp, { game_id, fixture_id, kickoff_at }, capturedAtMs) {
  const rows = [];
  if (Number.isFinite(Date.parse(kickoff_at)) && capturedAtMs >= Date.parse(kickoff_at)) return rows;
  for (const f of resp ?? []) for (const bk of f.bookmakers ?? []) for (const bet of bk.bets ?? []) {
    if (!WANTED_BETS.has(Number(bet.id)) || !Array.isArray(bet.values) || !bet.values.length) continue;
    rows.push({
      game_id, fixture_id, bet_id: Number(bet.id), bet_name: String(bet.name ?? ""), bookmaker: String(bk.name ?? bk.id ?? ""),
      captured_at: new Date(capturedAtMs).toISOString(), provider_updated_at: Number.isFinite(Date.parse(f.update)) ? new Date(f.update).toISOString() : null,
      kickoff_at, odds: bet.values.map((v) => ({ value: String(v.value), odd: String(v.odd) })),
    });
  }
  return rows;
}

async function main() {
  const need = ["API_FOOTBALL_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].filter((k) => !process.env[k]);
  if (need.length) { console.error(`Mancano: ${need.join(", ")}`); process.exit(1); }
  const env = { ...process.env, AF_SOURCE: "ricerca-quote" };
  const now = Date.now();
  const iso = (ms) => new Date(ms).toISOString();
  const matches = await supabaseGetAll(env, "matches", { select: "game_id,league,kickoff_at,status", status: "eq.scheduled", and: `(kickoff_at.gte.${iso(now)},kickoff_at.lt.${iso(now + WINDOW_H * H)})`, order: "kickoff_at.asc" }, 1000, 10);
  const prior = await supabaseGetAll(env, "football_research_odds", { select: "game_id,captured_at", captured_at: `gte.${iso(now - 24 * H)}`, order: "captured_at.desc" }, 1000, 50);
  const last = new Map(); for (const r of prior) if (!last.has(r.game_id)) last.set(r.game_id, r.captured_at);
  const todo = selectFixtures(matches, last, now, { max: Number(process.env.MAX_FIXTURES) || 60 });
  console.log(`Partite programmate nelle prossime ${WINDOW_H} h: ${matches.length}; da rilevare ora: ${todo.length}`);
  if (process.env.DRY_RUN === "1") { for (const t of todo) console.log(`- ${t.game_id} ${t.kickoff_at}`); return; }
  let saved = 0, calls = 0, blocked = false;
  for (const t of todo) {
    try {
      const capturedAt = Date.now(), rows = [];
      let page = 1, total = 1;
      do {
        const r = await afFetch(env, "odds", { fixture: t.fixture_id, page }, { tier: "background", source: "ricerca-quote", retries: 1 });
        calls += 1; total = r.paging?.total ?? 1;
        rows.push(...extractRows(r.response, t, capturedAt));
        page += 1;
      } while (page <= Math.min(total, 4));
      if (rows.length) { await supabaseUpsert(env, "football_research_odds", rows, "game_id,bet_id,bookmaker,captured_at"); saved += rows.length; }
    } catch (e) {
      if (e instanceof AfBudgetBlocked) { blocked = true; console.log("Budget crediti: mi fermo, riprenderà al prossimo giro."); break; }
      console.error(`Errore su ${t.game_id}: ${String(e?.message ?? e).slice(0, 200)}`);
    }
  }
  console.log(`Richieste API: ${calls}; righe registrate: ${saved}${blocked ? " (interrotto per budget)" : ""}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => { console.error(String(e?.message ?? e).slice(0, 300)); process.exit(1); });
