/**
 * The Odds API: funzioni pure (abbinamento partite, lettura quote). Nessun accesso a rete o database,
 * così si possono testare. Il piano gratuito ha 500 crediti al mese: vedi quotes.js per come si risparmiano.
 */
export const ODDS_URL = "https://api.the-odds-api.com/v4";
export const QUOTE_TTL = 3 * 3600e3;   // una quota resta valida 3 ore (poi si ripreleva solo se serve)
export const MIN_CREDITS = 40;         // sotto questa soglia l'app smette di spendere crediti
export const MAX_EVENTS_PER_CALL = 12; // tetto di partite interrogate per singola richiesta

/** Per ogni selezione del modello: quali mercati chiedere (costano 1 credito ciascuno se restituiscono dati). */
export const QUOTE_SPEC = {
  home: { markets: "h2h", kind: "h2h", side: "home" },
  draw: { markets: "h2h", kind: "h2h", side: "draw" },
  away: { markets: "h2h", kind: "h2h", side: "away" },
  dc1x: { markets: "double_chance", kind: "dc", side: "1X" },
  dcx2: { markets: "double_chance", kind: "dc", side: "X2" },
  dc12: { markets: "double_chance", kind: "dc", side: "12" },
  over15: { markets: "totals,alternate_totals", kind: "totals", side: "over", line: 1.5 },
  under15: { markets: "totals,alternate_totals", kind: "totals", side: "under", line: 1.5 },
  over25: { markets: "totals,alternate_totals", kind: "totals", side: "over", line: 2.5 },
  under25: { markets: "totals,alternate_totals", kind: "totals", side: "under", line: 2.5 },
  over35: { markets: "totals,alternate_totals", kind: "totals", side: "over", line: 3.5 },
  under35: { markets: "totals,alternate_totals", kind: "totals", side: "under", line: 3.5 },
  btts: { markets: "btts", kind: "btts", side: "yes" },
  nobtts: { markets: "btts", kind: "btts", side: "no" },
};

const STOP = new Set(["fc", "cf", "ac", "as", "ss", "sc", "afc", "us", "ssc", "club", "de", "di", "the", "calcio", "1", "rc", "cd", "ud", "sv", "vfl", "vfb", "tsg", "fk"]);

/** Nome squadra -> parole minuscole senza accenti né sigle ("AC Milan" -> ["milan"]). */
export function nameTokens(name) {
  return String(name ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/&/g, " ").replace(/[^a-z0-9]+/g, " ").split(" ").filter((t) => t && !STOP.has(t));
}

const tokenMatch = (a, b) => a === b || (Math.min(a.length, b.length) >= 3 && (a.startsWith(b) || b.startsWith(a)));

/** Somiglianza 0..1 tra due nomi: quota di parole del nome più corto presenti nell'altro. */
export function nameSimilarity(a, b) {
  const ta = nameTokens(a), tb = nameTokens(b);
  if (!ta.length || !tb.length) return 0;
  const [short, long] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  return short.filter((s) => long.some((l) => tokenMatch(s, l))).length / short.length;
}

/**
 * Trova l'evento The Odds API che corrisponde a una nostra partita.
 * Servono orario vicino (±3 h) e nomi simili; se un solo evento cade nella stessa fascia (±30 min)
 * basta una somiglianza più bassa.
 */
export function matchEvent(match, events) {
  const t = Date.parse(match.kickoff_at);
  if (!Number.isFinite(t)) return null;
  const near = events.map((e) => ({ e, dt: Math.abs(Date.parse(e.commence_time) - t) })).filter((x) => x.dt <= 3 * 3600e3);
  const scored = near.map((x) => ({ ...x, s: nameSimilarity(match.home_name, x.e.home_team) + nameSimilarity(match.away_name, x.e.away_team) }))
    .sort((a, b) => b.s - a.s || a.dt - b.dt);
  const best = scored[0];
  if (!best) return null;
  const sameSlot = near.filter((x) => x.dt <= 30 * 60e3).length;
  if (best.s >= 1.5 || (best.s >= 1 && best.dt <= 30 * 60e3) || (sameSlot === 1 && best.dt <= 30 * 60e3 && best.s >= 0.5)) return best.e;
  return null;
}

const same = (a, b) => nameTokens(a).join(" ") === nameTokens(b).join(" ");
const hasTeam = (outcomeName, team) => nameSimilarity(outcomeName, team) >= 1 || nameTokens(outcomeName).join(" ").includes(nameTokens(team).join(" "));

/** Prezzo di una selezione in un singolo mercato di un bookmaker (o null). */
function outcomePrice(spec, market, event) {
  const outs = market.outcomes ?? [];
  const key = market.key;
  if (spec.kind === "h2h" && (key === "h2h" || key === "h2h_3_way")) {
    const o = outs.find((x) => (spec.side === "draw" ? /^draw$|^pareggio$/i.test(String(x.name).trim())
      : same(x.name, spec.side === "home" ? event.home_team : event.away_team)));
    return o?.price ?? null;
  }
  if (spec.kind === "totals" && (key === "totals" || key === "alternate_totals")) {
    const o = outs.find((x) => new RegExp(`^${spec.side}$`, "i").test(String(x.name).trim()) && Number(x.point) === spec.line);
    return o?.price ?? null;
  }
  if (spec.kind === "btts" && key === "btts") {
    const o = outs.find((x) => new RegExp(`^${spec.side}$`, "i").test(String(x.name).trim()));
    return o?.price ?? null;
  }
  if (spec.kind === "dc" && key === "double_chance") {
    const o = outs.find((x) => {
      const n = String(x.name).trim();
      if (n.toUpperCase() === spec.side) return true;
      const draw = /\bdraw\b|pareggio/i.test(n), h = hasTeam(n, event.home_team), a = hasTeam(n, event.away_team);
      return spec.side === "1X" ? h && draw && !a : spec.side === "X2" ? a && draw && !h : h && a && !draw;
    });
    return o?.price ?? null;
  }
  return null;
}

/** Tutti i prezzi (un bookmaker = un prezzo) per una selezione dentro la risposta di un evento. */
export function pricesFor(selKey, event) {
  const spec = QUOTE_SPEC[selKey];
  if (!spec) return [];
  const out = [];
  for (const bk of event.bookmakers ?? []) {
    for (const mk of bk.markets ?? []) {
      const price = Number(outcomePrice(spec, mk, event));
      if (Number.isFinite(price) && price > 1) { out.push({ bookmaker: bk.title ?? bk.key, price }); break; }
    }
  }
  return out;
}

/** Mediana (quota "di mercato", prudente), migliore e numero di bookmaker. */
export function summarizePrices(prices) {
  if (!prices.length) return null;
  const sorted = [...prices].sort((a, b) => a.price - b.price);
  const mid = sorted.length >> 1;
  const median = sorted.length % 2 ? sorted[mid].price : (sorted[mid - 1].price + sorted[mid].price) / 2;
  const best = sorted[sorted.length - 1];
  return { median: Number(median.toFixed(3)), best: best.price, bestBookmaker: best.bookmaker, books: prices.length };
}

export const isoNoMs = (ms) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
