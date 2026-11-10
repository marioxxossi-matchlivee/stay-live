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
 * Le vecchie partite GIOCATE senza abbinamento non si toccano (finiscono nel rapporto: lo storico valido non va perso); quelle NON giocate
 * senza abbinamento passano allo stato "superseded" (non si cancella nulla) perché il calendario ufficiale è quello di API-Football.
 * Servono SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, API_FOOTBALL_KEY.
 */
import { LEAGUES, SEASON, errorMessage, supabaseDelete, supabaseGetAll, supabasePatch, supabaseUpsert } from "../functions/api/_lib.js";
import { fetchAfSeason } from "../functions/api/_apifootball.js";
import { bestTeam } from "../functions/api/_scrape.js";

const H = 3600e3;
export const isLegacyId = (id) => !/^af-\d+$/.test(String(id ?? ""));
const REKEY_TABLES = ["bet_predictions", "prediction_legs", "odds_quotes", "match_availability"];

/**
 * Abbina vecchie partite (id Ninjas) e partite API-Football, uno-a-uno.
 * 1) Passo rigoroso: stesso orario (±3 ore) e nomi di entrambe le squadre uguali.
 * 2) Passi con apprendimento: ogni coppia sicura insegna "nome Ninjas -> nome API-Football" (es. "FC Cologne" -> "1. FC Köln", valido
 *    per tutti i campionati: la mappa `learned` è condivisa). Poi si abbinano le partite in cui una squadra coincide (per nome o per mappa)
 *    e l'altra non contraddice la mappa, purché il candidato sia UNICO nella finestra di orario; si ripete finché si trovano nuove coppie.
 * 3) Con entrambe le squadre note dalla mappa basta lo stesso giorno (±36 ore: gli orari Ninjas e API-Football a volte differiscono).
 */
export function planMigration(oldRows, afRows, learned = new Map()) {
  const usedOld = new Set(), usedAf = new Set(), pairs = [];
  const take = (o, a, how) => {
    usedOld.add(o.game_id); usedAf.add(a.game_id); pairs.push({ from: o.game_id, to: a.game_id, league: o.league, how });
    learned.set(o.home_name, a.home_name); learned.set(o.away_name, a.away_name);
  };
  const same = (oName, aName) => Boolean(bestTeam(oName, [aName])) || learned.get(oName) === aName;
  const conflict = (oName, aName) => learned.has(oName) && learned.get(oName) !== aName && !bestTeam(oName, [aName]);
  const dtOf = (o, a) => Math.abs(Date.parse(a.kickoff_at) - Date.parse(o.kickoff_at));

  // 1 · rigoroso
  const strict = [];
  for (const o of oldRows) for (const a of afRows) { const dt = dtOf(o, a); if (dt <= 3 * H && bestTeam(o.home_name, [a.home_name]) && bestTeam(o.away_name, [a.away_name])) strict.push({ o, a, dt }); }
  strict.sort((x, y) => x.dt - y.dt);
  for (const c of strict) if (!usedOld.has(c.o.game_id) && !usedAf.has(c.a.game_id)) take(c.o, c.a, "nomi");

  // 2 e 3 · con apprendimento
  for (let round = 0; round < 6; round += 1) {
    let progress = false;
    for (const o of oldRows) {
      if (usedOld.has(o.game_id)) continue;
      const free = afRows.filter((a) => !usedAf.has(a.game_id));
      const both = free.filter((a) => dtOf(o, a) <= 36 * H && same(o.home_name, a.home_name) && same(o.away_name, a.away_name)).sort((x, y) => dtOf(o, x) - dtOf(o, y));
      if (both.length && (both.length === 1 || dtOf(o, both[0]) < dtOf(o, both[1]))) { take(o, both[0], "mappa"); progress = true; continue; }
      const one = free.filter((a) => dtOf(o, a) <= 3 * H && ((same(o.home_name, a.home_name) && !conflict(o.away_name, a.away_name)) || (same(o.away_name, a.away_name) && !conflict(o.home_name, a.home_name))));
      if (one.length === 1) { take(o, one[0], "una squadra"); progress = true; }
    }
    if (!progress) break;
  }
  return { pairs, unmatchedOld: oldRows.filter((o) => !usedOld.has(o.game_id)), unmatchedAf: afRows.filter((a) => !usedAf.has(a.game_id)), learned };
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
  const report = [], learned = new Map(), data = [];
  for (const cfg of LEAGUES.filter((l) => l.afId)) {
    const old = (await supabaseGetAll(env, "matches", { select: "game_id,league,kickoff_at,home_name,away_name,status,home_id,away_id", league: `eq.${cfg.id}`, season: `eq.${SEASON}` })).filter((r) => isLegacyId(r.game_id));
    if (!old.length) continue;
    data.push({ cfg, old, af: await fetchAfSeason(env, cfg, Date.now()) });
  }
  for (const d of data) planMigration(d.old, d.af, learned);          // 1° giro: impara i nomi da tutti i campionati
  for (const { cfg, old, af } of data) {
    const plan = planMigration(old, af, learned);                       // 2° giro: abbinamento definitivo con la mappa completa
    const unFinal = plan.unmatchedOld.filter((u) => u.status === "final"), unOpen = plan.unmatchedOld.filter((u) => u.status !== "final");
    const line = { league: cfg.id, vecchie: old.length, api_football: af.length, abbinate: plan.pairs.length, senza_abbinamento_finali: unFinal.length, senza_abbinamento_non_giocate: unOpen.length };
    console.log(JSON.stringify(line));
    for (const u of unFinal.slice(0, 10)) console.log(`   ? FINALE ${u.kickoff_at?.slice(0, 16)} ${u.home_name} - ${u.away_name} non abbinata (resta com'è)`);
    if (unOpen.length) console.log(`   (${unOpen.length} partite non giocate senza abbinamento: calendari Ninjas superati, passano allo stato "superseded")`);
    if (apply) {
      await supabaseUpsert(env, "matches", af, "game_id");
      for (const p of plan.pairs) {
        for (const t of REKEY_TABLES) await rekey(env, t, p.from, p.to);
        await supabaseDelete(env, "matches", { game_id: `eq.${p.from}` });
      }
      // vecchie partite NON giocate e senza corrispondenza: il calendario ufficiale è quello di API-Football, quindi non devono comparire doppie.
      // Non si cancella nulla: lo stato diventa "superseded" (reversibile) e l'app le ignora.
      for (let i = 0; i < unOpen.length; i += 40) await supabasePatch(env, "matches", { game_id: `in.(${unOpen.slice(i, i + 40).map((u) => `"${u.game_id}"`).join(",")})` }, { status: "superseded" });
      line.applicata = true;
    }
    report.push(line);
  }
  console.log("\nRiepilogo:", JSON.stringify(report, null, 1));
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(errorMessage(e)); process.exit(1); });
