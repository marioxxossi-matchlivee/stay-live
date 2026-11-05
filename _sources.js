/**
 * Parser PURI delle fonti: ricevono una stringa HTML e restituiscono dati normalizzati. Nessuna rete,
 * nessun database: si testano con frammenti HTML (tests/availability.test.js).
 * Se un sito cambia layout il parser restituisce [] e lo scraper lo tratta come errore (vedi _scrape.js).
 */
import { attr, decode, htmlToLines, stripTags, topLevel } from "./_html.js";

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, mag: 5, jun: 6, giu: 6, jul: 7, lug: 7, aug: 8, ago: 8, sep: 9, set: 9, oct: 10, ott: 10, nov: 11, dec: 12, dic: 12 };
const iso = (y, mo, d) => (mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}` : null);

/** "12/10/2026", "12.10.26", "Oct 12, 2026", "12 ott 2026", "2026-10-12" -> "2026-10-12" (o null). */
export function parseDate(text) {
  const t = String(text ?? "").trim();
  let m;
  if ((m = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/))) return iso(+m[1], +m[2], +m[3]);
  if ((m = t.match(/\b(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})\b/))) return iso(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  if ((m = t.match(/\b([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/))) return MONTHS[m[1].toLowerCase()] ? iso(+m[3], MONTHS[m[1].toLowerCase()], +m[2]) : null;
  if ((m = t.match(/\b(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?,?\s+(\d{4})\b/))) return MONTHS[m[2].toLowerCase()] ? iso(+m[3], MONTHS[m[2].toLowerCase()], +m[1]) : null;
  return null;
}

/** "€25.00m", "€800k", "25,00 mln €", "€1.20bn" -> euro (numero) o null. */
export function parseValue(text) {
  const m = String(text ?? "").match(/([\d][\d.,]*)\s*(bn|mld|mln|m|k|mila)?/i);
  if (!m || !/€|eur/i.test(text)) return null;
  let n = m[1];
  n = n.includes(".") && n.includes(",") ? n.replace(/\./g, "").replace(",", ".") : n.replace(",", ".");
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  const mult = { bn: 1e9, mld: 1e9, mln: 1e6, m: 1e6, k: 1e3, mila: 1e3 }[(m[2] ?? "").toLowerCase()] ?? 1;
  return Math.round(v * mult);
}

/** Ruolo -> G / D / M / F. Il centrocampo si controlla prima ("Defensive Midfield" è M, non D). */
export function roleOf(text) {
  const t = String(text ?? "").toLowerCase();
  if (/goalkeeper|portiere|torwart|keeper/.test(t)) return "G";
  if (/midfield|centrocamp|mediano|regista|trequart|mezzala|playmaker/.test(t)) return "M";
  if (/back|defen|difensor|terzino|centrale|libero|sweeper|verteidiger/.test(t)) return "D";
  if (/forward|striker|wing|attacc|punta|\bala\b|sturm/.test(t)) return "F";
  return null;
}

const SUSPENSION = /suspen|squalif|\bban\b|red card|yellow card|gesperrt|sperre|disciplin/i;

/* ---------- Transfermarkt: pagina "verletztespieler" di un campionato ---------- */
function clubName(h = "") {
  const a = h.match(/<a\b[^>]*\/verein\/\d+[^>]*>/i)?.[0];
  const title = a && attr(a, "title");
  if (title) return title;
  const img = h.match(/<img\b[^>]*>/i)?.[0] ?? "";
  return attr(img, "alt") || attr(img, "title") || stripTags(h) || null;
}

/**
 * Righe della tabella principale: giocatore (tabella interna "inline-table" con nome + ruolo), club (link /verein/ID
 * o stemma), motivo, date "dal/fino al", valore di mercato. Le colonne si riconoscono dal contenuto, non dalla posizione.
 */
export function parseTransfermarkt(html) {
  const out = [];
  for (const tr of topLevel(html, "tr")) {
    const tds = topLevel(tr.html, "td");
    if (tds.length < 4) continue;
    const pc = tds.find((td) => /inline-table/i.test(td.html));
    if (!pc) continue;
    const anchors = [...pc.html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)].map((m) => stripTags(m[1])).filter(Boolean);
    const name = anchors[0];
    if (!name) continue;
    const inner = topLevel(pc.html, "tr");
    const role = roleOf(stripTags(inner[1]?.html ?? ""));
    const clubCell = tds.find((td) => td !== pc && /\/verein\/\d+|wappen/i.test(td.html));
    const team = clubName(clubCell?.html);
    if (!team) continue;
    const rest = tds.filter((td) => td !== pc && td !== clubCell).map((td) => stripTags(td.html));
    const dates = rest.map(parseDate).filter(Boolean);
    const detail = rest.find((t) => t && !parseDate(t) && !/€|eur/i.test(t) && !/^\d{1,3}(\s*(days?|giorni|tage))?$/i.test(t) && !/^[-–?]$/.test(t)) ?? "";
    const value = parseValue(rest.find((t) => /€|eur/i.test(t)));
    out.push({ team, name, role, detail, since: dates[0] ?? null, until: dates[1] ?? null, value, playChance: 0, status: "out", kind: SUSPENSION.test(detail) ? "suspension" : "injury" });
  }
  return out;
}

/* ---------- PremierInjuries: una tabella per club (Player | Reason | Further Detail | Potential Return | Status) ---------- */
function cleanClub(text) {
  const t = String(text ?? "").replace(/\b(injur\w*|suspensions?|news|team|table|latest|updates?)\b/gi, "").replace(/\s+/g, " ").trim();
  return !t || t.length > 40 || /premier league/i.test(t) ? null : t;
}

export function parsePremierInjuries(html) {
  const marks = [];
  for (const m of String(html).matchAll(/<h[1-4]\b[^>]*>([\s\S]*?)<\/h[1-4]>/gi)) marks.push({ index: m.index, kind: "h", text: stripTags(m[1]) });
  for (const t of topLevel(html, "table")) marks.push({ index: t.index, kind: "t", html: t.html });
  marks.sort((a, b) => a.index - b.index);
  const out = [];
  let club = null;
  for (const mk of marks) {
    if (mk.kind === "h") { club = cleanClub(mk.text) ?? club; continue; }
    const cap = mk.html.match(/<caption\b[^>]*>([\s\S]*?)<\/caption>/i);
    const tableClub = (cap && cleanClub(stripTags(cap[1]))) || club;
    const rows = topLevel(mk.html, "tr");
    if (rows.length < 2) continue;
    const cells = (r) => topLevel(r.html, "t[dh]").map((c) => stripTags(c.html));
    const head = cells(rows[0]).map((h) => h.toLowerCase());
    const idx = (re) => head.findIndex((h) => re.test(h));
    const col = { player: idx(/player|name/), reason: idx(/reason|injury/), detail: idx(/detail/), ret: idx(/return/), status: idx(/status|condition|chance|likel|prob/) };
    if (col.player < 0 || !tableClub) continue;
    for (const r of rows.slice(1)) {
      const t = cells(r);
      const name = t[col.player];
      if (!name) continue;
      const reason = col.reason >= 0 ? t[col.reason] ?? "" : "";
      const extra = col.detail >= 0 ? t[col.detail] ?? "" : "";
      const ret = col.ret >= 0 ? t[col.ret] ?? "" : "";
      const statusText = `${col.status >= 0 ? t[col.status] ?? "" : ""} ${reason}`;
      const pct = statusText.match(/(\d{1,3})\s*%/);
      const playChance = pct ? Math.min(1, Number(pct[1]) / 100) : /\bout\b|ruled out|suspend/i.test(statusText) ? 0 : null;
      out.push({
        team: tableClub, name, role: null, detail: [reason, extra].filter(Boolean).join(" · "), since: null,
        until: parseDate(ret), returnText: ret || null, value: null, playChance,
        status: playChance === 0 ? "out" : "doubt", kind: SUSPENSION.test(statusText) ? "suspension" : "injury",
      });
    }
  }
  return out;
}

/* ---------- Probabili formazioni: formato testuale "SQUADRA (3-5-2): A; B, C ... Squalificati: ... Indisponibili: ..." ---------- */
const TEAM_LINE = /^([A-Za-zÀ-ÿ0-9][A-Za-zÀ-ÿ0-9 .'’-]{1,34}?)\s*\((\d(?:-\d){1,4})\)\s*:\s*(.+)$/;
const LABEL = /(squalificat[io]|indisponibil[ei]|diffidat[io]|ballottagg[io])\b[^:|]{0,30}:\s*/gi;
const NOBODY = /^\s*(nessuno|nessun[a]?|-|—|n\.?d\.?)\.?\s*$/i;
const KEY = { squal: "suspended", indis: "unavailable", diffi: "warned", ballo: "doubts" };

const splitNames = (raw) => (NOBODY.test(raw) ? [] : raw.split(/\s*[,;|]\s*|(?<=\d%)\s+/).map((s) => s.replace(/\.$/, "").trim()).filter((s) => s && !NOBODY.test(s)));

/** Un blocco per squadra: {team, formation, xi, complete, suspended, unavailable, warned, doubts}. */
export function parseProbableLineups(html) {
  const lines = htmlToLines(html);
  const heads = lines.map((l, i) => ({ i, m: l.match(TEAM_LINE) })).filter((x) => x.m);
  return heads.map((h, k) => {
    const end = heads[k + 1]?.i ?? lines.length;
    const seg = lines.slice(h.i + 1, end).join(" | ");
    const xiRaw = h.m[3].split(/\bAll\.|\bAllenatore\b|\bA disp\b/i)[0];
    const xi = xiRaw.split(/[;,]/).map((s) => s.replace(/\([^)]*\)/g, "").trim()).filter(Boolean);
    const block = { team: h.m[1].trim().replace(/\s+/g, " "), formation: h.m[2], xi, complete: xi.length === 11, suspended: [], unavailable: [], warned: [], doubts: [] };
    const hits = [...seg.matchAll(LABEL)];
    hits.forEach((hit, n) => {
      const raw = seg.slice(hit.index + hit[0].length, hits[n + 1]?.index ?? seg.length).replace(/[|\s]+$/, "");
      block[KEY[hit[1].toLowerCase().slice(0, 5)]].push(...splitNames(raw));
    });
    return block;
  });
}

/** Link alla pagina "probabili formazioni" più recente nella home di Sky Sport Serie A (URL con data nel percorso). */
export function discoverLineupUrl(hubHtml, now = Date.now()) {
  const found = new Map();
  for (const m of String(hubHtml).matchAll(/href=["']((?:https?:\/\/sport\.sky\.it)?\/calcio\/serie-a\/(\d{4})\/(\d{2})\/(\d{2})\/probabili-formazioni[^"'#?\s]*)(?:[?#][^"']*)?["']/gi)) {
    const t = Date.UTC(+m[2], +m[3] - 1, +m[4]);
    found.set(m[1].startsWith("http") ? m[1] : `https://sport.sky.it${m[1]}`, t);
  }
  const ok = [...found].filter(([, t]) => t <= now + 3 * 86400e3).sort((a, b) => b[1] - a[1]);
  return ok[0]?.[0] ?? null;
}

export const PARSERS = { transfermarkt: parseTransfermarkt, premierinjuries: parsePremierInjuries, lineups: parseProbableLineups };
export { decode };
