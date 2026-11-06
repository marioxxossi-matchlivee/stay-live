/**
 * Abbinamento di nomi di squadra (funzioni pure, usate dal blocco di scraping delle assenze).
 * Prima stavano in _odds.js (The Odds API, non più usata).
 */
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
