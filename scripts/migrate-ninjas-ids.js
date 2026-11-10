#!/usr/bin/env node
/**
 * Riallinea lo storico delle 8 leghe che prima arrivavano da API Ninjas (id partita non "af-<n>") agli id ufficiali di API-Football.
 *
 *   node scripts/migrate-ninjas-ids.js            -> PROVA: scrive solo un rapporto, non cambia nulla
 *   node scripts/migrate-ninjas-ids.js --apply    -> applica
 *
 * Per ogni campionato: scarica la stagione da API-Football (1 richiesta), abbina ogni vecchia partita a una partita API-Football
 * (stesso orario ±3 ore e squadre con lo stesso nome; un abbinamento uno-a-uno), poi:
 *   1. salva le partite API-Football in `matches` (id "af-<n>");
 *   2. sposta sul nuovo id le righe di bet_predictions, prediction_legs, odds_quotes, match_availability;
 *   3. cancella SOLO la vecchia riga di `matches` abbinata (af_fixture_map si cancella da sola).
 * Le vecchie partite SENZA abbinamento non si toccano e finiscono nel rapporto: lo storico valido non va perso.
 * Servono SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, API_FOOTBALL_KEY.
 */
import { LEAGUES, SEASON, errorMessage, supabaseDelete, supabaseGetAll, supabasePatch, supabaseUpsert } from "../functions/api/_lib.js";
import { fetchAfSeason } from "../functions/api/_apifootball.js";
import { bestTeam } from "../functions/api/_scrape.js";

const H = 3600e3;
export const isLegacyId = (id) => !/^af-\d+$/.test(String(id ?? ""));
const REKEY_TABLES = ["bet_predictions", "prediction_legs", "odds_quotes", "match_availability"];

/** Abbina vecchie partite (id Ninjas) e partite API-Football: uno-a-uno, la più vicina nell'orario vince. */
export function planMigration(oldRows, afRows) {
  const cands = [];
  for (const o of oldRows) {
    const t = Date.parse(o.kickoff_at);
    for (const a of afRows) {
      const dt = Math.abs(Date.parse(a.kickoff_at) - t);
      if (!(dt <= 3 * H)) continue;
      if (bestTeam(o.home_name, [a.home_name]) && bestTeam(o.away_name, [a.away_name])) cands.push({ o, a, dt });
    }
  }
  cands.sort((x, y) => x.dt - y.dt);
  const usedOld = new Set(), usedAf = new Set(), pairs = [];
  for (const c of cands) {
    if (usedOld.has(c.o.game_id) || usedAf.has(c.a.game_id)) continue;
    usedOld.add(c.o.game_id); usedAf.add(c.a.game_id); pairs.push({ from: c.o.game_id, to: c.a.game_id, league: c.o.league });
  }
  return { pairs, unmatchedOld: oldRows.filter((o) => !usedOld.has(o.game_id)), unmatchedAf: afRows.filter((a) => !usedAf.has(a.game_id)) };
}

async function rekey(env, table, from, to) {
  try { await supabasePatch(env, table, { game_id: `eq.${from}` }, { game_id: to }); return "moved"; }
  catch (e) {
    if (/HTTP 404|PGRST205|42P01/.test(e.message)) return "absent";            // tabella non presente: niente da spostare
    if (/409|23505|duplicate/i.test(e.message)) { await supabaseDelete(env, table, { game_id: `eq.${from}` }); return "dedup"; }   // il nuovo id ha già la sua riga
    throw e;
  }
}

async function main() {
  const apply = process.argv.includes("--apply");
  const need = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "API_FOOTBALL_KEY"].filter((k) => !process.env[k]);
  if (need.length) { console.error(`Mancano le variabili: ${need.join(", ")}`); process.exit(1); }
  const env = { ...process.env, API_FOOTBALL_MIN_GAP_MS: process.env.API_FOOTBALL_MIN_GAP_MS || "210" };
  console.log(apply ? "== APPLICO la migrazione ==" : "== PROVA (nessuna modifica). Aggiungi --apply per applicare ==");
  const report = [];
  for (const cfg of LEAGUES.filter((l) => l.afId)) {
    const old = (await supabaseGetAll(env, "matches", { select: "game_id,league,kickoff_at,home_name,away_name,status,home_id,away_id", league: `eq.${cfg.id}`, season: `eq.${SEASON}` })).filter((r) => isLegacyId(r.game_id));
    if (!old.length) continue;
    const af = await fetchAfSeason(env, cfg, Date.now());
    const plan = planMigration(old, af);
    const line = { league: cfg.id, vecchie: old.length, api_football: af.length, abbinate: plan.pairs.length, senza_abbinamento: plan.unmatchedOld.length };
    console.log(JSON.stringify(line));
    for (const u of plan.unmatchedOld.slice(0, 8)) console.log(`   ? ${u.kickoff_at?.slice(0, 16)} ${u.home_name} - ${u.away_name} (${u.status}) non abbinata`);
    if (apply) {
      await supabaseUpsert(env, "matches", af, "game_id");
      for (const p of plan.pairs) {
        for (const t of REKEY_TABLES) await rekey(env, t, p.from, p.to);
        await supabaseDelete(env, "matches", { game_id: `eq.${p.from}` });
      }
      line.applicata = true;
    }
    report.push(line);
  }
  console.log("\nRiepilogo:", JSON.stringify(report, null, 1));
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(errorMessage(e)); process.exit(1); });
