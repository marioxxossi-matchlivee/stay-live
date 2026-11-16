// Verifica reale (3 crediti) che `odds?fixture=ID` SENZA filtro restituisca tutti i mercati usati da Stay Live.
// Uso: node scripts/odds-probe.js <fixtureId>   (env: API_FOOTBALL_KEY)
import { BUNDLE_BETS, splitOddsBundle } from "../functions/api/_apifootball.js";
const key = process.env.API_FOOTBALL_KEY, fx = process.argv[2];
if (!key || !fx) { console.error("Servono API_FOOTBALL_KEY e l'id di una partita con quote pubblicate."); process.exit(2); }
const get = async (q) => { const r = await fetch(`https://v3.football.api-sports.io/odds?${q}`, { headers: { "x-apisports-key": key } }); return r.json(); };
const all = await get(`fixture=${fx}`);
const count = (resp, id) => (resp ?? []).reduce((n, f) => n + (f.bookmakers ?? []).filter((b) => (b.bets ?? []).some((x) => Number(x.id) === id)).length, 0);
const parts = splitOddsBundle(all.response);
let ok = true;
console.log(`pagine: ${all.paging?.current}/${all.paging?.total}, bookmaker: ${(all.response?.[0]?.bookmakers ?? []).length}`);
if ((all.paging?.total ?? 1) > 1) { ok = false; console.log("ATTENZIONE: risposta paginata, il cumulativo non è completo -> AF_ODDS_BUNDLE=0"); }
for (const id of [5, 1]) {
  const single = await get(`fixture=${fx}&bet=${id}`);
  const a = count(all.response, id), b = count(single.response, id);
  console.log(`mercato ${id}: cumulativo ${a} bookmaker, filtrato ${b} bookmaker`);
  if (a < b) ok = false;
}
for (const id of BUNDLE_BETS) console.log(`  mercato ${id}: ${parts.get(id).reduce((n, f) => n + f.bookmakers.length, 0)} bookmaker`);
console.log(ok ? "OK: la richiesta cumulativa è equivalente. Lasciare AF_ODDS_BUNDLE attivo." : "NON equivalente: impostare AF_ODDS_BUNDLE=0.");
process.exit(ok ? 0 : 1);
