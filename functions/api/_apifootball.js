/**
 * Client API-Football (v3) + cache su Supabase.
 * Parte pura (testabile): stagione, chiave di cache, TTL, scelta della partita, id dei mercati, riepilogo quote.
 * Parte con I/O: afFetch (una richiesta), loadSections (cache -> richieste solo se scadute), resolveFixture (abbinamento).
 * Ogni errore diventa un campo `error` nella sezione: il chiamante non riceve mai eccezioni per colpa del provider.
 */
import { LEAGUES, SEASON, supabaseGet, supabaseUpsert } from "./_lib.js";
import { bestTeam } from "./_scrape.js";
import { AfBudgetBlocked, budgetFor } from "./_budget.js";
import { emptyRecheckMs, tierOf } from "./_policy.js";

/** id campionato di Stay Live -> id campionato di API-Football (si definisce in LEAGUES, _lib.js). */
export const AF_LEAGUES = Object.fromEntries(LEAGUES.filter((l) => l.afId).map((l) => [l.id, l.afId]));
const CALENDAR_YEAR = new Set(LEAGUES.filter((l) => l.calendarYear).map((l) => l.id));
/** Competizioni la cui stagione su API-Football non segue la regola dell'app (es. qualificazioni "2027", Nations League CONCACAF "2025"): `afSeason` in LEAGUES. */
export const AF_SEASON = new Map(LEAGUES.filter((l) => l.afSeason).map((l) => [l.id, l.afSeason]));
const MIN = 60e3, H = 3600e3, D = 24 * H;

export class AfError extends Error {
  constructor(message, { status = null } = {}) { super(message); this.status = status; }
}

const iso = (ms) => new Date(ms).toISOString();
const num = (x) => (x == null || x === "" || !Number.isFinite(Number(x)) ? null : Number(x));
export const dayKey = (ms) => iso(ms).slice(0, 10);

/** Stagione di API-Football: l'anno di inizio (da luglio in poi) per l'Europa, l'anno solare per la MLS. */
export function seasonFor(league, kickoffIso) {
  if (AF_SEASON.has(league)) return AF_SEASON.get(league);          // stagione API-Football fissata a mano
  const d = new Date(kickoffIso);
  const y = d.getUTCFullYear();
  return CALENDAR_YEAR.has(league) ? y : d.getUTCMonth() >= 6 ? y : y - 1;
}

export const cacheKey = (endpoint, params = {}) =>
  `${endpoint}?${Object.entries(params).filter(([, v]) => v != null && v !== "").sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("&")}`;

/**
 * Quanto resta valida una risposta in cache. Regola: scaricata una volta, non si riscarica finché non può essere cambiata.
 * Dati stabili (scontri diretti, allenatori, copertura) = settimane; dati che cambiano poco (pronostico, infortuni, classifica) = mezza giornata o più;
 * si accorcia solo avvicinandosi al fischio d'inizio (formazioni, quote). Partita finita = definitivo.
 */
export function ttlFor(kind, { kickoff = null, now = Date.now(), finished = false } = {}) {
  const toKo = kickoff == null ? Infinity : kickoff - now;
  const over = kickoff != null && toKo < -3 * H;                    // finita da un po': i dati non cambiano più
  const done = finished || over;
  const live = toKo <= 3 * H && toKo >= -3 * H;
  switch (kind) {
    case "fixture": return done ? 30 * D : live ? (toKo <= 90 * MIN ? 5 * MIN : 20 * MIN) : toKo <= 48 * H ? 12 * H : 48 * H;      // formazioni escono ~1 ora prima
    case "fixture-list": return 6 * H;
    case "injuries": return done ? 30 * D : toKo <= 3 * H ? 2 * H : toKo <= 24 * H ? 8 * H : 24 * H;
    case "predictions": return done ? 30 * D : 12 * H;
    case "odds": return done ? 30 * D : toKo <= 3 * H ? 90 * MIN : toKo <= 24 * H ? 4 * H : 12 * H;
    case "corner-odds": return done ? 30 * D : 27 * H;                // quote corner: cercate ogni notte a mezzanotte, valide fino alla notte dopo (più un margine)
    case "odds-bets": return 30 * D;
    case "h2h": return 30 * D;
    case "team-stats": return 2 * D;
    case "standings": return D;
    case "coverage": return 30 * D;
    default: return 12 * H;
  }
}

/** Richieste da fare per una partita (una per sezione della schermata di dettaglio). Ogni richiesta porta la sua priorità (`tier`). */
export function planFor({ fixtureId, leagueId, season, homeId, awayId, kickoff, finished = false, now = Date.now(), betIds = { goals: 5, corners: 45 }, extra = false }) {
  const c = { kickoff, now, finished };
  const tier = finished || kickoff == null ? "week" : tierOf(kickoff, now);
  const emptyFresh = finished || kickoff == null ? undefined : emptyRecheckMs(kickoff - now);     // quote non ancora pubblicate: non richiederle prima che sia probabile
  // Essenziale (6 richieste): partita, infortuni, pronostico, quote gol e 1X2, copertura. Il resto solo a richiesta (`extra`): meno chiamate.
  const plan = [
    { section: "fixture", endpoint: "fixtures", params: { id: fixtureId }, ttl: ttlFor("fixture", c) },
    { section: "injuries", endpoint: "injuries", params: { fixture: fixtureId }, ttl: ttlFor("injuries", c) },
    { section: "predictions", endpoint: "predictions", params: { fixture: fixtureId }, ttl: ttlFor("predictions", c) },
    { section: "oddsGoals", endpoint: "odds", params: { fixture: fixtureId, bet: betIds.goals }, ttl: ttlFor("odds", c), emptyFresh },
    { section: "odds1x2", endpoint: "odds", params: { fixture: fixtureId, bet: betIds.winner ?? 1 }, ttl: ttlFor("odds", c), emptyFresh },
    { section: "coverage", endpoint: "leagues", params: { id: leagueId, season }, ttl: ttlFor("coverage", c) },
  ];
  if (extra) {
    plan.push({ section: "oddsCorners", endpoint: "odds", params: { fixture: fixtureId, bet: betIds.corners }, ttl: ttlFor("odds", c), emptyFresh });
    plan.push({ section: "standings", endpoint: "standings", params: { league: leagueId, season }, ttl: ttlFor("standings", c) });
    if (homeId && awayId) {
      plan.push({ section: "h2h", endpoint: "fixtures/headtohead", params: { h2h: `${homeId}-${awayId}`, last: 10 }, ttl: ttlFor("h2h", c) });
      plan.push({ section: "teamHome", endpoint: "teams/statistics", params: { league: leagueId, season, team: homeId }, ttl: ttlFor("team-stats", c) });
      plan.push({ section: "teamAway", endpoint: "teams/statistics", params: { league: leagueId, season, team: awayId }, ttl: ttlFor("team-stats", c) });
      plan.push({ section: "coachHome", endpoint: "coachs", params: { team: homeId }, ttl: ttlFor("h2h", c) });
      plan.push({ section: "coachAway", endpoint: "coachs", params: { team: awayId }, ttl: ttlFor("h2h", c) });
    }
  }
  return plan.map((r) => ({ ...r, tier }));
}

/** Allenatore attuale di una squadra: quello con un incarico senza data di fine presso quella squadra. */
export function pickCoach(list, teamId) {
  const coaches = Array.isArray(list) ? list : [];
  const current = (c) => (c.career ?? []).find((x) => x.team?.id === teamId && !x.end);
  const c = coaches.find(current) ?? coaches.find((x) => x.team?.id === teamId) ?? null;
  if (!c) return null;
  return { id: c.id, name: c.name, age: c.age ?? null, nationality: c.nationality ?? null, photo: c.photo ?? null, since: current(c)?.start ?? null };
}

/* ---------- Abbinamento partite ---------- */
/** Partita API-Football che corrisponde a quella dell'app: stesso orario (+-3 ore) e squadre abbinate entrambe. */
export function pickFixture(match, fixtures) {
  const t = Date.parse(match.kickoff_at);
  return (fixtures ?? [])
    .map((f) => ({ f, dt: Math.abs(Date.parse(f.fixture?.date) - t) }))
    .filter(({ f, dt }) => dt <= 3 * H && bestTeam(match.home_name, [f.teams?.home?.name ?? ""]) && bestTeam(match.away_name, [f.teams?.away?.name ?? ""]))
    .sort((a, b) => a.dt - b.dt)[0]?.f ?? null;
}

/* ---------- Quote: riepilogo Over/Under gol e corner ---------- */
/** Id dei mercati: letti dall'elenco ufficiale (odds/bets) per nome, con valori noti come ripiego. */
export function betIdsFrom(resp) {
  const find = (re) => (resp ?? []).find((b) => re.test(String(b.name ?? "")))?.id;
  return { goals: find(/^goals over\/under$/i) ?? 5, corners: find(/^corners over.?under$/i) ?? 45, winner: find(/^match winner$/i) ?? 1, doubleChance: find(/^double chance$/i) ?? 12, btts: find(/^both teams score$/i) ?? 8, cornerWinner: find(/^corners?\s*1x2$|^corner match bet$/i) ?? 55 };
}

const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null; };
const r2 = (x) => Math.round(x * 100) / 100;

function collect(response, nameRe, exRe) {
  const lines = {};
  for (const fx of response ?? []) for (const bk of fx.bookmakers ?? []) for (const bet of bk.bets ?? []) {
    if (!nameRe.test(String(bet.name ?? "")) || (exRe && exRe.test(String(bet.name ?? "")))) continue;
    for (const v of bet.values ?? []) {
      const m = String(v.value).match(/^(over|under)\s+(\d+(?:\.\d+)?)$/i);
      const odd = Number(v.odd);
      if (!m || !(odd > 1)) continue;
      ((lines[m[2]] ??= { over: [], under: [] })[m[1].toLowerCase()]).push({ odd, book: bk.name });
    }
  }
  return lines;
}

const agg = (arr) => (arr?.length ? { best: arr.reduce((a, b) => (b.odd > a.odd ? b : a)), median: r2(median(arr.map((x) => x.odd))), n: arr.length } : null);
const toLine = ([l, v]) => ({ line: Number(l), over: agg(v.over), under: agg(v.under) });

/** Miglior quota e mediana tra i bookmaker per l'Over/Under 2.5 e per ogni linea gol/corner. */
export function summarizeOdds(goalsResp, cornersResp) {
  const g = collect(goalsResp, /^goals over\/under$/i);
  const c = collect(cornersResp, /corners?.*over.?under|total corners/i, /1st|2nd|first|second|half|home|away|asian|team/i);
  const goalLines = Object.entries(g).map(toLine).sort((a, b) => a.line - b.line);
  const cornerLines = Object.entries(c).map(toLine).sort((a, b) => a.line - b.line);
  const balanced = cornerLines.filter((x) => x.over && x.under).sort((a, b) => Math.abs(a.over.median - a.under.median) - Math.abs(b.over.median - b.under.median));
  const books = new Set([...Object.values(g), ...Object.values(c)].flatMap((l) => [...l.over, ...l.under].map((x) => x.book)));
  return {
    ou25: g["2.5"] ? { over: agg(g["2.5"].over), under: agg(g["2.5"].under) } : null,
    goalLines,
    corners: { lines: cornerLines, mainLine: balanced[0]?.line ?? null },
    bookmakers: books.size,
  };
}

/**
 * Quote 1X2 (mercato "Match Winner"): migliore e mediana tra i bookmaker per casa, pareggio, trasferta.
 * Restituisce { home, draw, away } (ognuno come summarizeOdds: { best: { odd, book }, median, n }) o null.
 */
export function summarizeMatchWinner(resp, nameRe = /^match winner$/i) {
  const out = { home: [], draw: [], away: [] };
  for (const fx of resp ?? []) for (const bk of fx.bookmakers ?? []) for (const bet of bk.bets ?? []) {
    if (!nameRe.test(String(bet.name ?? ""))) continue;
    for (const v of bet.values ?? []) {
      const k = { home: "home", draw: "draw", away: "away", "1": "home", x: "draw", "2": "away" }[String(v.value).trim().toLowerCase()];
      const odd = Number(v.odd);
      if (k && odd > 1) out[k].push({ odd, book: bk.name });
    }
  }
  return out.home.length && out.draw.length && out.away.length ? { home: agg(out.home), draw: agg(out.draw), away: agg(out.away) } : null;
}

/**
 * Quote "Double Chance" (Home/Draw, Draw/Away, Home/Away) -> { dc1x, dcx2, dc12 } come summarizeMatchWinner, oppure null.
 * Tutte e tre servono per essere usabili (una doppia chance con una sola quota non è confrontabile).
 */
export function summarizeDoubleChance(resp) {
  const out = { dc1x: [], dcx2: [], dc12: [] };
  for (const fx of resp ?? []) for (const bk of fx.bookmakers ?? []) for (const bet of bk.bets ?? []) {
    if (!/^double chance$/i.test(String(bet.name ?? ""))) continue;
    for (const v of bet.values ?? []) {
      const k = { "home/draw": "dc1x", "draw/away": "dcx2", "home/away": "dc12", "1x": "dc1x", x2: "dcx2", 12: "dc12" }[String(v.value).trim().toLowerCase().replace(/\s+/g, "")];
      const odd = Number(v.odd);
      if (k && odd > 1) out[k].push({ odd, book: bk.name });
    }
  }
  return out.dc1x.length && out.dcx2.length && out.dc12.length ? { dc1x: agg(out.dc1x), dcx2: agg(out.dcx2), dc12: agg(out.dc12) } : null;
}

/** Quote "Both Teams Score" (Yes/No) -> { btts, nobtts } oppure null (servono entrambe). */
export function summarizeBtts(resp) {
  const out = { btts: [], nobtts: [] };
  for (const fx of resp ?? []) for (const bk of fx.bookmakers ?? []) for (const bet of bk.bets ?? []) {
    if (!/^both teams score$/i.test(String(bet.name ?? ""))) continue;
    for (const v of bet.values ?? []) {
      const k = { yes: "btts", no: "nobtts" }[String(v.value).trim().toLowerCase()];
      const odd = Number(v.odd);
      if (k && odd > 1) out[k].push({ odd, book: bk.name });
    }
  }
  return out.btts.length && out.nobtts.length ? { btts: agg(out.btts), nobtts: agg(out.nobtts) } : null;
}

/* ---------- Rete ---------- */
const RATE_RE = /too many requests|per minute|rate limit/i;
const RATE_RETRY_DELAYS = [1500, 4000];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let gateAt = 0;

/**
 * Distanzia le richieste: ne parte al massimo una ogni `gapMs` (default 250 ms = 4 al secondo, sotto il limite di 5 al secondo
 * del piano Pro). Senza questo, le 12 richieste di una schermata di dettaglio partivano tutte insieme e API-Football ne
 * rifiutava la maggior parte con "Too many requests" (il messaggio dice "al minuto" anche quando il limite superato e' quello al secondo).
 * Lo slot si prenota in modo sincrono: anche piu' chiamate contemporanee nello stesso worker restano in fila.
 */
export async function rateGate(gapMs = 250) {
  const slot = Math.max(Date.now(), gateAt);
  gateAt = slot + gapMs;
  const wait = slot - Date.now();
  if (wait > 0) await sleep(wait);
}

/**
 * Una richiesta ad API-Football, in fila con le altre. UNICO punto da cui parte ogni chiamata: qui il Budget Manager (_budget.js) concede
 * o nega il credito prima che la richiesta esca (tier = priorità della partita, source = cron/script che la fa).
 * Con `retries` riprova (con attesa crescente) se il limite di richieste e' superato.
 */
export async function afFetch(env, endpoint, params = {}, { timeoutMs = 9000, retries = 0, tier = "today", source } = {}) {
  const gap = num(env.API_FOOTBALL_MIN_GAP_MS) ?? 250;
  const bud = budgetFor(env);
  const meta = { endpoint, bet: params?.bet ?? null, tier, src: source };
  for (let attempt = 0; ; attempt += 1) {
    if (bud) {
      const g = await bud.acquire({ tier, endpoint, bet: meta.bet, src: source });
      if (!g.ok) throw new AfBudgetBlocked(`Budget crediti giornaliero: richiesta rimandata (${g.reason}), riprova più tardi`, g.reason);
    }
    await rateGate(gap);
    try {
      const v = await afFetchOnce(env, endpoint, params, { timeoutMs });
      bud?.observe(v); bud?.done(v.results ? "ok" : "empty", meta);
      return v;
    } catch (e) {
      if (e?.meta) bud?.observe(e.meta);
      bud?.done(e?.rateLimited ? "rate_limited" : "failed", meta);
      if (!e?.rateLimited || attempt >= retries) throw e;
      await sleep(RATE_RETRY_DELAYS[attempt] ?? 4000);
    }
  }
}

async function afFetchOnce(env, endpoint, params, { timeoutMs }) {
  const base = (env.API_FOOTBALL_BASE_URL || "https://v3.football.api-sports.io").replace(/\/$/, "");
  const url = new URL(`${base}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) if (v != null && v !== "") url.searchParams.set(k, String(v));
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { "x-apisports-key": env.API_FOOTBALL_KEY, accept: "application/json" } });
    const body = await res.json().catch(() => null);
    const errs = Array.isArray(body?.errors) ? body.errors : Object.values(body?.errors ?? {});
    const meta = {
      status: res.status,
      remaining: num(res.headers.get("x-ratelimit-requests-remaining")),   // residuo giornaliero
      limit: num(res.headers.get("x-ratelimit-requests-limit")),
      minuteRemaining: num(res.headers.get("x-ratelimit-remaining")),     // residuo del minuto in corso (se il piano lo comunica)
      minuteLimit: num(res.headers.get("x-ratelimit-limit")),
      retryAfterMs: num(res.headers.get("retry-after")) != null ? Number(res.headers.get("retry-after")) * 1000 : null,
    };
    if (!res.ok || !body || errs.length) {
      const rateLimited = res.status === 429 || errs.some((m) => RATE_RE.test(String(m)));
      throw Object.assign(new AfError(errs.join("; ") || `HTTP ${res.status}`, { status: res.status }), { meta, rateLimited });
    }
    return { response: body.response ?? [], results: body.results ?? 0, paging: body.paging ?? null, ...meta };
  } catch (e) {
    if (e?.name === "AbortError") throw new AfError("Timeout");
    throw e;
  } finally { clearTimeout(timer); }
}

/** Attese (ms) suggerite al browser prima di richiedere di nuovo i dati mancanti. */
export const RETRY_HINT = { batch: 1500, rateLimit: 20000, budget: 300000 };

/* ---------- Quote: una sola richiesta per partita ---------- */
/**
 * API-Football restituisce, per `odds?fixture=ID` SENZA il filtro `bet`, tutti i bookmaker con tutti i mercati in una sola risposta (1 credito).
 * Prima si facevano fino a 6 richieste per partita (gol, 1X2, doppia chance, gol/no gol, corner, corner 1X2), ciascuna con `bet=<id>`.
 * Ora si fa una richiesta sola e la risposta si divide nelle stesse chiavi di cache di prima (`odds?bet=<id>&fixture=<id>`): tutto il resto del
 * codice (riepiloghi, motore, schede) legge le stesse sezioni, con lo stesso formato. Si spegne con AF_ODDS_BUNDLE=0 (e si spegne da solo
 * se la risposta risulta paginata). Verifica reale: scripts/odds-probe.js (3 crediti).
 */
export const BUNDLE_BETS = [1, 5, 8, 12, 45, 55];
const BUNDLE_OFF = new WeakSet();
const bundleEnabled = (env) => env?.AF_ODDS_BUNDLE !== "0" && !BUNDLE_OFF.has(env);

/** Nome del mercato per id (ripiego se la risposta non riporta l'id del mercato). */
const BET_NAME = { 1: /^match winner$/i, 5: /^goals over\/under$/i, 8: /^both teams score$/i, 12: /^double chance$/i, 45: /^corners over.?under$/i, 55: /^corners?\s*1x2$|^corner match bet$/i };
const isBet = (b, id) => (b?.id != null && b.id !== "" ? Number(b.id) === Number(id) : BET_NAME[id] ? BET_NAME[id].test(String(b?.name ?? "")) : false);

/** Divide la risposta completa nelle risposte per singolo mercato (stesso formato del filtro `bet=<id>`; mercato assente = lista vuota). */
export function splitOddsBundle(resp, betIds = BUNDLE_BETS) {
  const out = new Map();
  for (const id of betIds) {
    const arr = [];
    for (const fx of resp ?? []) {
      const books = (fx.bookmakers ?? []).map((bk) => ({ ...bk, bets: (bk.bets ?? []).filter((b) => isBet(b, id)) })).filter((bk) => bk.bets.length);
      if (books.length) arr.push({ ...fx, bookmakers: books });
    }
    out.set(Number(id), arr);
  }
  return out;
}
const hasBets = (resp) => (resp ?? []).some((fx) => (fx.bookmakers ?? []).some((bk) => (bk.bets ?? []).length));
const hasAny = (resp, ids) => (resp ?? []).some((fx) => (fx.bookmakers ?? []).some((bk) => (bk.bets ?? []).some((b) => ids.some((id) => isBet(b, id)))));

/** Richieste identiche e contemporanee nello stesso processo: parte una sola, le altre attendono lo stesso esito. */
const INFLIGHT = new Map();

/**
 * Per ogni richiesta del piano: cache valida -> nessuna chiamata; altrimenti chiamata live, UNA ALLA VOLTA e in ordine.
 * - Una risposta VUOTA (quote non ancora pubblicate) vale `emptyFresh` (se indicato): non si richiede prima che la pubblicazione sia probabile.
 * - Le quote di una stessa partita si scaricano con UNA richiesta (vedi sopra) e si salvano in tutte le chiavi di mercato.
 * - Richieste duplicate (stessa chiave nella stessa chiamata o contemporanee da altre) = una sola richiesta.
 * - Il Budget Manager può negare il credito: la sezione resta «rimandata» (senza scrivere errori in cache) e `retry.afterMs` lo segnala.
 * - Al massimo `maxLive` chiamate per volta (env API_FOOTBALL_MAX_PER_CALL, default 8): le altre restano «rimandate» e il browser le richiede da solo.
 * - Al primo «Too many requests» (dopo un solo nuovo tentativo breve) ci si ferma: insistere peggiora solo il blocco. Anche se il piano comunica 0
 *   richieste residue nel minuto ci si ferma prima.
 * - Nessuna chiamata se il residuo giornaliero e' sotto `reserve`. In caso di errore si restituisce l'ultima risposta salvata (stale).
 * Risultato: `sections`, `usage`, `retry` ({ pending: sezioni ancora da scaricare, afterMs }) e `saved` (richieste evitate).
 */
export async function loadSections(env, reqs, now = Date.now(), { maxLive = num(env?.API_FOOTBALL_MAX_PER_CALL) ?? 8, reserve = 300, source } = {}) {
  if (!reqs.length) return { sections: {}, usage: null, retry: { pending: 0, afterMs: 0 }, saved: { cacheHits: 0, dedup: 0, bundled: 0, blocked: 0 } };
  const bud = budgetFor(env);
  const keys = reqs.map((r) => cacheKey(r.endpoint, r.params));
  // Le chiavi si leggono a gruppi (con molte partite l'indirizzo della richiesta diventerebbe troppo lungo).
  const chunks = []; for (let i = 0; i < keys.length; i += 40) chunks.push(keys.slice(i, i + 40));
  const [rowChunks, usageRows] = await Promise.all([
    Promise.all(chunks.map((ks) => supabaseGet(env, "af_cache", { select: "cache_key,response,results,fetched_at,expires_at,error", cache_key: `in.(${ks.map((k) => `"${k}"`).join(",")})`, limit: ks.length }))),
    supabaseGet(env, "af_usage", { select: "*", day: `eq.${dayKey(now)}`, limit: 1 }),
  ]);
  const rows = rowChunks.flat();
  const byKey = new Map(rows.map((r) => [r.cache_key, r]));
  const usage = usageRows[0] ?? null;
  const canSpend = !(usage?.remaining != null && usage.remaining < reserve);
  const sections = {};
  const todo = [];
  const dups = [];
  const seen = new Map();
  const saved = { cacheHits: 0, dedup: 0, bundled: 0, blocked: 0 };
  let afterMs = 0;
  const later = (ms) => { afterMs = Math.max(afterMs, ms); };
  const tierOfReq = (r) => r.tier ?? "today";
  const mark = (name, r, n = 1) => bud?.saved(name, { endpoint: r.endpoint, bet: r.params?.bet ?? null, tier: tierOfReq(r), src: source, n });
  reqs.forEach((r, i) => {
    const row = byKey.get(keys[i]);
    const view = (extra) => ({ data: row?.response ?? null, results: row?.results ?? 0, fetchedAt: row?.fetched_at ?? null, source: "cache", stale: false, error: null, ...extra });
    const blockedMs = row?.error ? Date.parse(row.expires_at) - now : 0;
    const empty = Boolean(row && !row.error && (row.results ?? 0) === 0);
    const maxAge = empty && r.emptyFresh != null ? r.emptyFresh : (r.fresh ?? r.ttl);       // `fresh` (facoltativo) accorcia la validità solo per questa lettura
    if (row && !row.error && now - Date.parse(row.fetched_at) < maxAge) {
      sections[r.section] = view({}); saved.cacheHits += 1;
      mark(empty && r.emptyFresh != null ? "skipped_backoff" : "cache_hit", r);
    } else if (row?.error && RATE_RE.test(row.error) && blockedMs > 0) {                       // limite appena superato: si aspetta, senza insistere
      sections[r.section] = view({ stale: Boolean(row.response), deferred: true, error: "Limite di richieste al minuto: nuovo tentativo automatico" });
      later(blockedMs + 500);
    } else if (row?.error && !RATE_RE.test(row.error) && blockedMs > 0) sections[r.section] = view({ stale: Boolean(row.response), error: row.error });   // errore recente: non si insiste
    else if (seen.has(keys[i])) { dups.push({ r, first: seen.get(keys[i]) }); saved.dedup += 1; mark("dedup_inflight", r); }                          // stessa chiave già in questa chiamata
    else { const t = { r, key: keys[i], row, view }; seen.set(keys[i], t); todo.push(t); }
  });
  // Quote della stessa partita: una richiesta sola (se attivo).
  const groups = new Map();
  if (bundleEnabled(env)) for (const t of todo) { const p = t.r.params; if (t.r.endpoint === "odds" && p?.fixture != null && p?.bet != null) (groups.get(p.fixture) ?? groups.set(p.fixture, []).get(p.fixture)).push(t); }
  const bundleDone = new Set(), bundleSkip = new Set();
  const live = [];
  const writes = [];
  let remaining = usage?.remaining ?? null, limit = usage?.limit_day ?? null;
  let spent = 0, stopped = null;
  const okWrite = (t, v) => writes.push({ cache_key: t.key, endpoint: t.r.endpoint, params: t.r.params, response: v.response, results: v.results, http_status: v.status, error: null, fetched_at: iso(now), expires_at: iso(now + t.r.ttl) });
  const fail = (e, list) => {
    remaining = e?.meta?.remaining ?? remaining; limit = e?.meta?.limit ?? limit;
    const msg = String(e?.message ?? e).slice(0, 300);
    if (e?.budgetBlocked) {                                             // credito negato dal Budget Manager: nessuna richiesta fatta, nessun errore in cache
      for (const t of list) { sections[t.r.section] = t.view({ stale: Boolean(t.row?.response), deferred: true, error: msg }); saved.blocked += 1; }
      later(RETRY_HINT.budget); return;
    }
    for (const t of list) writes.push({ cache_key: t.key, endpoint: t.r.endpoint, params: t.r.params, http_status: e?.status ?? null, error: msg, expires_at: iso(now + (e?.rateLimited ? RETRY_HINT.rateLimit : 10 * MIN)) });   // fetched_at e response restano quelli precedenti
    if (e?.rateLimited) {
      stopped = "Limite di richieste al minuto: nuovo tentativo automatico";
      for (const t of list) sections[t.r.section] = t.view({ stale: Boolean(t.row?.response), deferred: true, error: msg });
      later(Math.max(e?.meta?.retryAfterMs ?? 0, RETRY_HINT.rateLimit));
    } else for (const t of list) sections[t.r.section] = t.view({ stale: Boolean(t.row?.response), error: msg });
  };
  for (const t of todo) {
    if (sections[t.r.section]) continue;                                // già riempita da una richiesta cumulativa
    if (!canSpend) { sections[t.r.section] = t.view({ stale: Boolean(t.row?.response), deferred: true, error: "Limite giornaliero quasi esaurito" }); continue; }
    if (stopped || spent >= maxLive) {
      sections[t.r.section] = t.view({ stale: Boolean(t.row?.response), deferred: true, error: stopped ?? "In coda: lo scarico continua da solo" });
      later(stopped ? RETRY_HINT.rateLimit : RETRY_HINT.batch);
      continue;
    }
    const fx = t.r.endpoint === "odds" ? t.r.params?.fixture : null;
    const group = fx != null && groups.has(fx) && !bundleSkip.has(fx) ? groups.get(fx) : null;
    if (group) {
      const bkey = `bundle:${fx}`, running = INFLIGHT.get(bkey);
      if (running) { mark("dedup_inflight", t.r); saved.dedup += 1; } else { spent += 1; live.push(t); }   // già in corso in un'altra chiamata: si attende senza spendere
      const bets = [...new Set([...BUNDLE_BETS, ...group.map((g) => Number(g.r.params.bet))])];
      try {
        let p = running;
        if (!p) { p = afFetch(env, "odds", { fixture: fx }, { retries: 1, tier: tierOfReq(t.r), source }); INFLIGHT.set(bkey, p); p.catch(() => {}).finally(() => { if (INFLIGHT.get(bkey) === p) INFLIGHT.delete(bkey); }); }
        const v = await p;
        remaining = v.remaining ?? remaining; limit = v.limit ?? limit;
        if (v.paging?.total > 1 || (hasBets(v.response) && !hasAny(v.response, bets))) {      // risposta cumulativa non affidabile: si torna alle richieste per mercato
          if (v.paging?.total > 1) BUNDLE_OFF.add(env);
          bundleSkip.add(fx); spent -= 0;
          const again = t; const sub = await afFetch(env, again.r.endpoint, again.r.params, { retries: 1, tier: tierOfReq(again.r), source }).catch((e) => { fail(e, [again]); return null; });
          if (sub) { live.push(again); okWrite(again, sub); sections[again.r.section] = { data: sub.response, results: sub.results, fetchedAt: iso(now), source: "live", stale: false, error: null }; }
          continue;
        }
        const parts = splitOddsBundle(v.response, bets);
        for (const bet of bets) { const arr = parts.get(bet); writes.push({ cache_key: cacheKey("odds", { fixture: fx, bet }), endpoint: "odds", params: { fixture: fx, bet }, response: arr, results: arr.length, http_status: v.status, error: null, fetched_at: iso(now), expires_at: iso(now + (group[0].r.ttl ?? 12 * H)) }); }
        for (const g of group) { const arr = parts.get(Number(g.r.params.bet)); sections[g.r.section] = { data: arr, results: arr.length, fetchedAt: iso(now), source: "live", stale: false, error: null }; }
        bundleDone.add(fx); saved.bundled += Math.max(0, group.length - 1);
        if (group.length > 1) bud?.saved("bundled", { endpoint: "odds", tier: tierOfReq(t.r), src: source, n: group.length - 1 });
        if (v.minuteRemaining != null && v.minuteRemaining <= 0) { stopped = "Limite di richieste al minuto: nuovo tentativo automatico"; later(RETRY_HINT.rateLimit); }
      } catch (e) {
        if (e?.budgetBlocked && !running) { live.pop(); spent -= 1; }
        fail(e, group.filter((g) => !sections[g.r.section]));
      }
      continue;
    }
    // Richiesta già in corso nello stesso processo (altra chiamata contemporanea): si attende quella.
    const running = INFLIGHT.get(t.key);
    if (running) {
      mark("dedup_inflight", t.r); saved.dedup += 1;
      try { const v = await running; okWrite(t, v); sections[t.r.section] = { data: v.response, results: v.results, fetchedAt: iso(now), source: "live", stale: false, error: null }; }
      catch (e) { fail(e, [t]); }
      continue;
    }
    spent += 1; live.push(t);
    const p = afFetch(env, t.r.endpoint, t.r.params, { retries: 1, tier: tierOfReq(t.r), source });
    INFLIGHT.set(t.key, p); p.catch(() => {}).finally(() => { if (INFLIGHT.get(t.key) === p) INFLIGHT.delete(t.key); });
    try {
      const v = await p;
      remaining = v.remaining ?? remaining; limit = v.limit ?? limit;
      okWrite(t, v);
      sections[t.r.section] = { data: v.response, results: v.results, fetchedAt: iso(now), source: "live", stale: false, error: null };
      if (v.minuteRemaining != null && v.minuteRemaining <= 0) { stopped = "Limite di richieste al minuto: nuovo tentativo automatico"; later(RETRY_HINT.rateLimit); }
    } catch (e) {
      if (e?.budgetBlocked) { live.pop(); spent -= 1; }
      fail(e, [t]);
    }
  }
  for (const d of dups) sections[d.r.section] = sections[d.first.r.section] ?? { data: null, results: 0, fetchedAt: null, source: "cache", stale: false, deferred: true, error: "In coda" };
  if (writes.length) {
    await supabaseUpsert(env, "af_cache", writes, "cache_key").catch((e) => console.error("Stay Live af_cache:", e?.message ?? e));
  }
  if (live.length) {
    await supabaseUpsert(env, "af_usage", [{ day: dayKey(now), requests: (usage?.requests ?? 0) + live.length, limit_day: limit, remaining, updated_at: iso(now) }], "day").catch(() => {});
  }
  const pending = Object.values(sections).filter((x) => x.deferred).length;
  return { sections, usage: { day: dayKey(now), requests: (usage?.requests ?? 0) + live.length, limit, remaining }, retry: { pending, afterMs: pending ? afterMs || RETRY_HINT.batch : 0 }, saved };
}

/** Partite sincronizzate da API-Football: game_id "af-<fixture>", squadre "af-<team>". Nessuna ricerca necessaria. */
export function directMap(match) {
  const fx = /^af-(\d+)$/.exec(String(match.game_id ?? ""));
  const team = (id) => { const m = /^af-(\d+)$/.exec(String(id ?? "")); return m ? Number(m[1]) : null; };
  const leagueId = AF_LEAGUES[match.league];
  if (!fx || !leagueId) return null;
  return { game_id: match.game_id, fixture_id: Number(fx[1]), league_id: leagueId, season: AF_SEASON.get(match.league) ?? (Number(match.season) || seasonFor(match.league, match.kickoff_at)), home_team_id: team(match.home_id), away_team_id: team(match.away_id), home_name: match.home_name, away_name: match.away_name };
}

/** Collegamento partita dell'app -> partita API-Football (cercata per campionato, stagione e data; poi salvata). */
export async function resolveFixture(env, match, now = Date.now()) {
  const direct = directMap(match);
  if (direct) return { map: direct };
  const [saved] = await supabaseGet(env, "af_fixture_map", { select: "*", game_id: `eq.${match.game_id}`, limit: 1 });
  if (saved) return { map: saved };
  const leagueId = AF_LEAGUES[match.league];
  if (!leagueId) return { error: `Campionato "${match.league}" non collegato ad API-Football.` };
  const season = seasonFor(match.league, match.kickoff_at);
  const t = Date.parse(match.kickoff_at);
  const { sections } = await loadSections(env, [{ section: "list", endpoint: "fixtures", params: { league: leagueId, season, from: dayKey(t - D), to: dayKey(t + D), timezone: "UTC" }, ttl: ttlFor("fixture-list") }], now);
  const f = pickFixture(match, sections.list?.data);
  if (!f) return { error: sections.list?.error ? `API-Football: ${sections.list.error}` : "Partita non trovata su API-Football (squadre o orario non corrispondono)." };
  const map = { game_id: match.game_id, fixture_id: f.fixture.id, league_id: leagueId, season, home_team_id: f.teams.home.id, away_team_id: f.teams.away.id, home_name: f.teams.home.name, away_name: f.teams.away.name };
  await supabaseUpsert(env, "af_fixture_map", [map], "game_id").catch((e) => console.error("Stay Live af_fixture_map:", e?.message ?? e));
  return { map };
}

/* ---------- Partite da API-Football ---------- */
const AF_STATUS = {
  TBD: "scheduled", NS: "scheduled", "1H": "in_progress", HT: "in_progress", "2H": "in_progress", ET: "in_progress", BT: "in_progress", P: "in_progress", SUSP: "in_progress", INT: "in_progress", LIVE: "in_progress",
  FT: "final", AET: "final", PEN: "final", AWD: "final", WO: "final", PST: "postponed", CANC: "canceled", ABD: "canceled",
};

const roundText = (r) => { const t = String(r ?? "").trim(); const m = /^Regular Season - (\d+)$/i.exec(t); return m ? m[1] : t || null; };
const roundType = (r) => (/league phase|group/i.test(r ?? "") ? "league_phase" : /final|round of|play-?off|knockout|qualif/i.test(r ?? "") ? "knockout" : "regular");

/** Partita API-Football -> riga della tabella `matches`. Risultato = 90 minuti (senza supplementari/rigori). */
export function normalizeAfFixture(f, cfg, season, now = Date.now()) {
  const st = f.fixture?.status?.short ?? "NS";
  const status = AF_STATUS[st] ?? "scheduled";
  const ft = f.score?.fulltime ?? {};
  const final = status === "final";
  const pick = (a, b) => (final ? (Number.isFinite(a) ? a : Number.isFinite(b) ? b : null) : Number.isFinite(b) ? b : null);
  const date = f.fixture?.date ?? null;
  return {
    game_id: `af-${f.fixture.id}`,
    league: cfg.id,
    season: AF_SEASON.has(cfg.id) ? SEASON : season,       // nell'app la stagione è sempre quella corrente (SEASON); quella di API-Football resta in `afSeason`
    season_type: cfg.international ? roundType(f.league?.round) : "regular",
    round: roundText(f.league?.round),
    match_date: date ? date.slice(0, 10) : null,
    kickoff_at: date,
    status,
    home_id: `af-${f.teams.home.id}`,
    home_name: f.teams.home.name ?? "Casa",
    home_abbr: null,
    away_id: `af-${f.teams.away.id}`,
    away_name: f.teams.away.name ?? "Trasferta",
    away_abbr: null,
    home_score: pick(ft.home, f.goals?.home),
    away_score: pick(ft.away, f.goals?.away),
    decided_in: st === "AET" ? "extra_time" : st === "PEN" ? "penalties" : null,
    neutral_site: false,
    synced_at: new Date(now).toISOString(),
  };
}

/** Controllo anti-errore: l'id configurato deve davvero essere il campionato previsto (paese ed eventuale nome). */
export function leagueCheck(cfg, apiLeague) {
  if (!apiLeague) return null;
  const country = String(apiLeague.country ?? "").toLowerCase();
  const name = String(apiLeague.name ?? "").toLowerCase();
  const okCountry = !cfg.afCountry || country.includes(cfg.afCountry.toLowerCase());
  const okName = !cfg.afName || name.includes(cfg.afName.toLowerCase());
  return okCountry && okName ? null : `L'id ${cfg.afId} di API-Football corrisponde a "${apiLeague.name}" (${apiLeague.country}), non a ${cfg.name}: sincronizzazione annullata.`;
}

/** Conta le richieste fatte oggi e il residuo comunicato da API-Football (stessa tabella usata dalla schermata di dettaglio). */
export async function trackUsage(env, now, meta, spent = 1) {
  const [u] = await supabaseGet(env, "af_usage", { select: "*", day: `eq.${dayKey(now)}`, limit: 1 });
  await supabaseUpsert(env, "af_usage", [{ day: dayKey(now), requests: (u?.requests ?? 0) + spent, limit_day: meta?.limit ?? u?.limit_day ?? null, remaining: meta?.remaining ?? u?.remaining ?? null, updated_at: iso(now) }], "day");
}

const RATE_RETRY_MS = [4000, 10000];

/** Tutta la stagione di un campionato con UNA richiesta (partite giocate e da giocare). */
export async function fetchAfSeason(env, cfg, now = Date.now(), { reserve = 200 } = {}) {
  const [u] = await supabaseGet(env, "af_usage", { select: "remaining", day: `eq.${dayKey(now)}`, limit: 1 });
  if (u?.remaining != null && u.remaining < reserve) throw new AfError(`Limite giornaliero API-Football quasi esaurito (${u.remaining} richieste): sincronizzazione rimandata.`);
  const season = seasonFor(cfg.id, iso(now));
  let res;
  for (let attempt = 0; ; attempt += 1) {
    try {
      res = await afFetch(env, "fixtures", { league: cfg.afId, season, timezone: "UTC" }, { timeoutMs: 20000, tier: "today" });
      break;
    } catch (e) {
      await trackUsage(env, now, e?.meta, 1).catch(() => {});
      if (!e?.rateLimited || attempt >= RATE_RETRY_MS.length) throw e;   // limite al minuto: si aspetta e si riprova
      await new Promise((r) => setTimeout(r, RATE_RETRY_MS[attempt]));
    }
  }
  await trackUsage(env, now, res, 1).catch(() => {});
  const bad = leagueCheck(cfg, res.response[0]?.league);
  if (bad) throw new AfError(bad);
  // Nessuna partita = stagione o id sbagliati (un campionato in corso ne ha sempre): si segnala invece di salvare "0 partite" in silenzio.
  if (!res.response.length) throw new AfError(`API-Football non restituisce partite per ${cfg.name} (id ${cfg.afId}, stagione ${season}): stagione o id da verificare.`);
  const seen = new Map();
  for (const f of res.response) if (f.fixture?.id && f.teams?.home?.id && f.teams?.away?.id && f.fixture.date) seen.set(f.fixture.id, normalizeAfFixture(f, cfg, season, now));
  return [...seen.values()];
}
