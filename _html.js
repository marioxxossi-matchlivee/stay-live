/**
 * Mini parser HTML senza dipendenze (nessun cheerio, nessun browser): abbastanza per tabelle e testo.
 * `topLevel` rispetta l'annidamento: le <tr>/<td> dentro una tabella interna non spezzano quelle esterne
 * (Transfermarkt annida una "inline-table" dentro ogni riga).
 */
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const cp = (n) => (n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : "");

export const decode = (s) => String(s ?? "")
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => cp(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => cp(Number(d)))
  .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);

const NOISE = /<(script|style)\b[\s\S]*?<\/\1>|<!--[\s\S]*?-->/gi;

export const stripTags = (html) => decode(String(html ?? "").replace(NOISE, " ").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

/** Elementi `tag` di primo livello (anche regex tipo "t[dh]"): [{index, open, html}] con html = contenuto interno. */
export function topLevel(html, tag) {
  const re = new RegExp(`<(/?)${tag}(?=[\\s>/])[^>]*>`, "gi");
  const out = [];
  let depth = 0, start = 0, openEnd = 0, m;
  while ((m = re.exec(html))) {
    if (!m[1]) { if (depth === 0) { start = m.index; openEnd = re.lastIndex; } depth += 1; }
    else if (depth > 0) {
      depth -= 1;
      if (depth === 0) out.push({ index: start, open: html.slice(start, openEnd), html: html.slice(openEnd, m.index) });
    }
  }
  return out;
}

/** Valore di un attributo dentro un tag di apertura. */
export function attr(openTag, name) {
  const m = String(openTag ?? "").match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"));
  return m ? decode(m[1] ?? m[2]) : "";
}

/** HTML -> righe di testo (i tag di blocco diventano a-capo). Indipendente dal layout: utile per le formazioni. */
export function htmlToLines(html) {
  return decode(String(html ?? "").replace(NOISE, " ")
    .replace(/<\/?(?:br|p|div|li|tr|h[1-6]|section|article|ul|ol|table|header|footer)\b[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, " "))
    .split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
}
