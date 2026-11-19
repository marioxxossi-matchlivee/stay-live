// Sonda in sola lettura: quali mercati sui gol espone API-Football e se esiste qualcosa di simile al Multigol.
// Uso: node scripts/goals-markets-probe.js [fixtureId]   (env: API_FOOTBALL_KEY)
// Costo: 1 richiesta per l'elenco dei mercati (+ 1-3 per la partita, se indicata). Nessuna scrittura, nessun segreto stampato.
const key = process.env.API_FOOTBALL_KEY, fx = process.argv[2];
if (!key) { console.error("Manca API_FOOTBALL_KEY."); process.exit(2); }
const base = process.env.API_FOOTBALL_BASE_URL || "https://v3.football.api-sports.io";
const get = async (path) => { const r = await fetch(`${base}/${path}`, { headers: { "x-apisports-key": key } }); if (!r.ok) throw new Error(`HTTP ${r.status} su /${path.split("?")[0]}`); return r.json(); };

export const GOAL_RE = /goal|score|multi|range|total|exact|band|1-3|2-4/i;
const FULL = new Set([25, 38, 49, 183, 186, 223, 349]);   // mercati candidati: si stampano tutte le fasce del primo bookmaker
export const MULTI_RE = /multi|range|band|\d\s*-\s*\d/i;

async function main() {
  const bets = await get("odds/bets");
  const list = bets.response ?? [];
  console.log(`## Catalogo mercati: ${list.length} totali`);
  console.log("\n### Mercati che riguardano i gol (id — nome)");
  for (const b of list.filter((x) => GOAL_RE.test(String(x.name)))) console.log(`- ${b.id} — ${b.name}`);
  const multi = list.filter((x) => MULTI_RE.test(String(x.name)));
  console.log(`\n### Possibili Multigol/fasce: ${multi.length ? multi.map((b) => `${b.id} — ${b.name}`).join("; ") : "NESSUNO nel catalogo"}`);
  console.log("\n### Catalogo completo");
  console.log(list.map((b) => `${b.id}:${b.name}`).join(" | "));
  if (!fx) { console.log("\n(Nessuna partita indicata: salto il controllo sulle quote reali.)"); return; }

  if (fx === "auto") {
    const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
    const find = async (offsets, status) => {
      for (const n of offsets) {
        const r = await get(`fixtures?date=${day(n)}&league=135&season=${process.env.SEASON || new Date().getUTCFullYear() - (new Date().getUTCMonth() < 6 ? 1 : 0)}`);
        const f = (r.response ?? []).find((x) => status.includes(x.fixture?.status?.short));
        if (f) return { id: f.fixture.id, label: `${f.teams.home.name} - ${f.teams.away.name} (${day(n)})` };
      }
      return null;
    };
    const fut = await find([1, 2, 3, 4, 5, 6, 7], ["NS"]);
    const old = await find([-21, -20, -19, -22, -23, -18, -24], ["FT"]);
    console.log(`\n## Partite scelte (Serie A)\n- futura: ${fut ? `${fut.id} — ${fut.label}` : "nessuna trovata"}\n- finita: ${old ? `${old.id} — ${old.label}` : "nessuna trovata"}`);
    if (fut) await probeFixture(fut.id, "FUTURA");
    if (old) await probeFixture(old.id, "FINITA DA ~3 SETTIMANE");
    return;
  }
  await probeFixture(fx, "");
}

async function probeFixture(fx, tag) {
  const rows = new Map();
  let page = 1, total = 1;
  do {
    const r = await get(`odds?fixture=${encodeURIComponent(fx)}&page=${page}`);
    total = r.paging?.total ?? 1;
    for (const f of r.response ?? []) for (const bk of f.bookmakers ?? []) for (const bet of bk.bets ?? []) {
      const e = rows.get(bet.id) ?? { name: bet.name, books: new Set(), sample: bet.values?.slice(0, 8).map((v) => `${v.value}@${v.odd}`).join(", "), all: bet.values?.map((v) => `${v.value}@${v.odd}`).join(", ") };
      e.books.add(bk.name); rows.set(bet.id, e);
    }
    page += 1;
  } while (page <= Math.min(total, 5));
  console.log(`\n## Quote per la partita ${fx} ${tag}: ${rows.size ? `${rows.size} mercati quotati` : "NESSUNA quota restituita (partita senza quote pubblicate o storico non più disponibile)"}`);
  for (const [id, e] of [...rows].sort((a, b) => Number(a[0]) - Number(b[0]))) {
    if (!GOAL_RE.test(String(e.name))) continue;
    console.log(`- ${id} — ${e.name}: ${e.books.size} bookmaker; esempio: ${FULL.has(Number(id)) ? e.all : e.sample}`);
  }
}
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) main().catch((e) => { console.error(String(e.message ?? e)); process.exit(1); });
