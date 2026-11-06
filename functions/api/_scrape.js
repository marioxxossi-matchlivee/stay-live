/**
 * Scraping di infortuni, squalifiche e probabili formazioni: parte pura (politica di aggiornamento, abbinamento
 * squadre, fusione tra fonti) + il solo fetch HTML. L'accesso a Supabase sta in availability.js.
 * Principio: ogni errore finisce in scrape_state con backoff e NON arriva mai al calcolo: senza dati l'app usa il
 * modello statistico standard.
 */
import { nameSimilarity, nameTokens } from "./_names.js";
import { discoverLineupUrl } from "./_sources.js";

const TM = (slug, code) => ({ url: `https://www.transfermarkt.com/${slug}/verletztespieler/wettbewerb/${code}` });

/** Fonti per campionato. Per aggiungere un campionato o una fonte basta una riga (l'id campionato è quello di LEAGUES). */
export const SOURCES = {
  transfermarkt: { label: "Transfermarkt", leagues: { seriea: TM("serie-a", "IT1"), epl: TM("premier-league", "GB1"), laliga: TM("laliga", "ES1"), bundesliga: TM("bundesliga", "L1"), ligue1: TM("ligue-1", "FR1") } },
  premierinjuries: { label: "PremierInjuries", leagues: { epl: { url: "https://www.premierinjuries.com/injury-table.php" } } },
  lineups: { label: "Probabili formazioni (Sky Sport)", leagues: { seriea: { hub: "https://sport.sky.it/calcio/serie-a", envUrl: "LINEUPS_URL_SERIEA" } } },
};

/* ---------- Quando aggiornare ---------- */
export const WINDOW_MS = 48 * 3600e3;                       // si scrapano solo partite entro 48 ore
export const SCRAPE_TTL = { far: 60 * 60e3, near: 30 * 60e3, nearWithin: 24 * 3600e3 }; // 60 min tra 24 e 48 h, 30 min nelle ultime 24 h
export const MAX_JOBS_PER_CALL = 3;                         // limite di richieste esterne per chiamata (Cloudflare: 50 subrequest sul piano free)
export const backoffMs = (fails) => Math.min(6 * 3600e3, 10 * 60e3 * 2 ** Math.max(0, fails - 1));

/** Aggiornare solo se: non in backoff e l'ultimo scrape riuscito è più vecchio del TTL (più corto vicino al match). */
export function scrapeDue(state, nearestKickoff, now) {
  if (state?.blocked_until && Date.parse(state.blocked_until) > now) return false;
  if (!state?.scraped_at) return true;
  const ttl = nearestKickoff - now <= SCRAPE_TTL.nearWithin ? SCRAPE_TTL.near : SCRAPE_TTL.far;
  return now - Date.parse(state.scraped_at) >= ttl;
}

/** Lavori da fare: una coppia (fonte, campionato) per ogni gruppo di partite in finestra e con TTL scaduto. */
export function planJobs(matches, states, now, sources = SOURCES) {
  const groups = new Map();
  for (const m of matches) {
    const t = Date.parse(m.kickoff_at);
    if (m.status !== "scheduled" || !(t > now) || t - now > WINDOW_MS) continue;
    for (const [source, def] of Object.entries(sources)) {
      if (!def.leagues[m.league]) continue;
      const key = `${source}|${m.league}`;
      const g = groups.get(key) ?? { source, league: m.league, nearest: Infinity };
      g.nearest = Math.min(g.nearest, t);
      groups.set(key, g);
    }
  }
  return [...groups.values()]
    .filter((g) => scrapeDue(states.find((s) => s.source === g.source && s.league === g.league), g.nearest, now))
    .sort((a, b) => a.nearest - b.nearest);
}

/* ---------- Rete ---------- */
export class ScrapeError extends Error {
  constructor(message, { status = null, blocked = false } = {}) { super(message); this.status = status; this.blocked = blocked; }
}
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

/** Una richiesta GET con timeout. Nessun trucco anti-rilevamento: se la fonte blocca si registra l'errore e si riprova più tardi. */
export async function fetchHtml(url, { timeoutMs = 8000, maxBytes = 3_000_000 } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctl.signal, redirect: "follow",
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml", "accept-language": "it-IT,it;q=0.9,en;q=0.8" },
      cf: { cacheTtl: 300, cacheEverything: true },
    });
    const html = (await res.text()).slice(0, maxBytes);
    const challenge = html.length < 60000 && /cf-chl|just a moment|captcha|access denied|are you a robot/i.test(html.slice(0, 8000));
    if ([403, 429, 503].includes(res.status) || challenge) throw new ScrapeError(`HTTP ${res.status}: probabile blocco anti-bot`, { status: res.status, blocked: true });
    if (!res.ok) throw new ScrapeError(`HTTP ${res.status}`, { status: res.status });
    return { status: res.status, html };
  } catch (e) {
    if (e?.name === "AbortError") throw new ScrapeError("Timeout", {});
    throw e;
  } finally { clearTimeout(timer); }
}

/** URL da scaricare per (fonte, campionato). Le formazioni cambiano URL ogni giornata: override da env o ricerca nella home Sky. */
export async function resolveUrl(env, source, league, now = Date.now()) {
  const cfg = SOURCES[source].leagues[league];
  if (cfg.url) return cfg.url;
  const fixed = cfg.envUrl && env[cfg.envUrl];
  if (fixed) return fixed;
  const hub = await fetchHtml(cfg.hub);
  const url = discoverLineupUrl(hub.html, now);
  if (!url) throw new ScrapeError("Pagina probabili formazioni non trovata nella home (imposta LINEUPS_URL_SERIEA).");
  return url;
}

/* ---------- Abbinamento squadre e giocatori ---------- */
const jaccard = (a, b) => { const A = new Set(a), B = new Set(b); return [...A].filter((x) => B.has(x)).length / new Set([...A, ...B]).size; };

/** Squadra della fonte che corrisponde al nome API Ninjas ("Milan" non deve diventare "Inter Milan": nomi identici vincono). */
export function bestTeam(name, candidates, exclude = null) {
  const tn = nameTokens(name);
  let best = null, bestScore = 0;
  for (const c of candidates) {
    if (c === exclude) continue;
    const cn = nameTokens(c);
    const score = nameSimilarity(name, c) + (tn.join(" ") === cn.join(" ") ? 1 : 0) + 0.5 * jaccard(tn, cn);
    if (nameSimilarity(name, c) >= 1 && score > bestScore) { best = c; bestScore = score; }
  }
  return best;
}

/** Stesso giocatore in due fonti ("Bukayo Saka" / "B. Saka" / "Saka"): stesso cognome e stessa iniziale, se ci sono entrambe. */
export function samePlayer(a, b) {
  const ta = nameTokens(a), tb = nameTokens(b);
  if (!ta.length || !tb.length || ta.at(-1) !== tb.at(-1)) return false;
  return ta.length === 1 || tb.length === 1 || ta[0][0] === tb[0][0];
}

const emptySides = () => ({ home: [], away: [] });

function pushDedup(list, item, src) {
  const hit = list.find((x) => samePlayer(x.name, item.name));
  if (!hit) { list.push({ ...item, src: [src] }); return; }
  for (const k of ["role", "detail", "since", "until", "value", "playChance"]) if (hit[k] == null || hit[k] === "") hit[k] = item[k] ?? hit[k];
  if (!hit.src.includes(src)) hit.src.push(src);
  if (item.status === "out") hit.status = "out";
}

/** Vista unita di tutte le fonti (priorità: premierinjuries > transfermarkt > lineups; i campi mancanti si completano). */
export function mergeSources(sources) {
  const order = ["premierinjuries", "transfermarkt", "lineups"];
  const injuries = emptySides(), suspensions = emptySides();
  let lineups = { home: null, away: null }, last = 0;
  for (const id of order) {
    const s = sources?.[id];
    if (!s?.at) continue;
    last = Math.max(last, Date.parse(s.at) || 0);
    for (const side of ["home", "away"]) {
      for (const it of s.injuries?.[side] ?? []) pushDedup(injuries[side], it, id);
      for (const it of s.suspensions?.[side] ?? []) pushDedup(suspensions[side], it, id);
      if (s.lineups?.[side] && !lineups[side]) lineups[side] = { ...s.lineups[side], src: id };
    }
  }
  return { injuries, suspensions, probable_lineups: lineups, last_scraped_at: last ? new Date(last).toISOString() : null };
}

/**
 * Righe da salvare dopo uno scrape riuscito di UNA fonte. `parsed` = output del parser;
 * `matches` = partite del campionato in finestra; `existing` = Map(game_id -> riga match_availability).
 * Una squadra assente dall'elenco infortuni = nessun assente segnalato (le liste contengono solo chi è fuori).
 */
export function buildRows({ source, parsed, matches, existing, now }) {
  const at = new Date(now).toISOString();
  const teams = [...new Set(parsed.map((p) => p.team))];
  return matches.map((m) => {
    const sources = { ...(existing.get(m.game_id)?.sources ?? {}) };
    const home = bestTeam(m.home_name, teams);
    const away = bestTeam(m.away_name, teams, home);
    const entry = { ok: true, at, count: parsed.length, strict: source === "lineups", matched: { home: Boolean(home), away: Boolean(away) }, injuries: emptySides(), suspensions: emptySides(), lineups: { home: null, away: null } };
    for (const [side, team] of [["home", home], ["away", away]]) {
      if (!team) continue;
      if (source === "lineups") {
        const b = parsed.find((p) => p.team === team);
        entry.lineups[side] = { formation: b.formation, xi: b.xi, complete: b.complete, doubts: b.doubts, warned: b.warned };
        for (const name of b.unavailable) entry.injuries[side].push({ name, role: null, detail: "indisponibile (formazioni)", since: null, until: null, value: null, playChance: 0, status: "out", kind: "injury" });
        for (const name of b.suspended) entry.suspensions[side].push({ name, role: null, detail: "squalificato", since: null, until: null, value: null, playChance: 0, status: "out", kind: "suspension" });
      } else {
        for (const p of parsed.filter((x) => x.team === team)) {
          const { team: _t, kind, ...item } = p;
          (kind === "suspension" ? entry.suspensions : entry.injuries)[side].push(item);
        }
      }
    }
    sources[source] = entry;
    return { game_id: m.game_id, ...mergeSources(sources), sources, updated_at: at };
  });
}

/** Per l'interfaccia: quanto è completo il quadro di una partita. */
export function coverageOf(row) {
  const ok = Object.values(row?.sources ?? {}).filter((s) => s?.ok);
  if (!ok.length) return "none";
  // Solo le formazioni sono "strette": una squadra senza blocco = formazione mancante. Negli elenchi infortuni una squadra assente = nessun assente.
  return ok.every((s) => !s.strict || (s.matched?.home && s.matched?.away)) ? "full" : "partial";
}
