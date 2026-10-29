/**
 * Generatore PDF minimale, senza dipendenze (Helvetica standard, codifica WinAnsi).
 * Coordinate in punti, origine in alto a sinistra (comoda per impaginare dall'alto in basso).
 */
const W_REG = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584, 761, 556, 761, 222, 556, 333, 1000, 556, 556, 333, 1000, 667, 333, 1000, 761, 611, 761, 761, 222, 222, 333, 333, 350, 556, 1000, 333, 1000, 500, 333, 944, 761, 500, 667, 278, 333, 556, 556, 556, 556, 260, 556, 333, 737, 370, 556, 584, 333, 737, 333, 400, 584, 333, 333, 333, 556, 537, 278, 333, 333, 365, 556, 834, 834, 834, 611, 667, 667, 667, 667, 667, 667, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278, 722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611, 556, 556, 556, 556, 556, 556, 889, 500, 556, 556, 556, 556, 278, 278, 278, 278, 556, 556, 556, 556, 556, 556, 556, 584, 611, 556, 556, 556, 556, 500, 556, 500];
const W_BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584, 761, 556, 761, 278, 556, 500, 1000, 556, 556, 333, 1000, 667, 333, 1000, 761, 611, 761, 761, 278, 278, 500, 500, 350, 556, 1000, 333, 1000, 556, 333, 944, 761, 500, 667, 278, 333, 556, 556, 556, 556, 280, 556, 333, 737, 370, 556, 584, 333, 737, 333, 400, 584, 333, 333, 333, 611, 556, 278, 333, 333, 365, 556, 834, 834, 834, 611, 722, 722, 722, 722, 722, 722, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278, 722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611, 556, 556, 556, 556, 556, 556, 889, 556, 556, 556, 556, 556, 278, 278, 278, 278, 611, 611, 611, 611, 611, 611, 611, 584, 611, 611, 611, 611, 611, 556, 611, 556];

export const PAGE = { w: 595.28, h: 841.89 };

// Unicode -> byte WinAnsi (cp1252). I caratteri senza equivalente vengono sostituiti.
const CP1252_HIGH = { 0x20ac: 128, 0x201a: 130, 0x0192: 131, 0x201e: 132, 0x2026: 133, 0x2020: 134, 0x2021: 135, 0x02c6: 136, 0x2030: 137, 0x0160: 138, 0x2039: 139, 0x0152: 140, 0x017d: 142, 0x2018: 145, 0x2019: 146, 0x201c: 147, 0x201d: 148, 0x2022: 149, 0x2013: 150, 0x2014: 151, 0x02dc: 152, 0x2122: 153, 0x0161: 154, 0x203a: 155, 0x0153: 156, 0x017e: 158, 0x0178: 159 };
const REPLACE = { "\u2192": "->", "\u221a": "radq", "\u2212": "-", "\u2009": " ", "\u00a0": " ", "\u2605": "*", "\u2713": "v" };

export function encode(str) {
  let out = "";
  for (const ch of String(str ?? "")) {
    const r = REPLACE[ch];
    if (r != null) { out += r; continue; }
    const c = ch.codePointAt(0);
    if (c >= 32 && c < 127) out += ch;
    else if (c >= 160 && c <= 255) out += ch;
    else if (CP1252_HIGH[c]) out += String.fromCharCode(CP1252_HIGH[c]);
    else out += c === 10 ? " " : "?";
  }
  return out;
}

export function textWidth(str, size, bold = false) {
  const table = bold ? W_BOLD : W_REG;
  let sum = 0;
  for (const ch of encode(str)) sum += table[ch.charCodeAt(0) - 32] ?? 556;
  return (sum * size) / 1000;
}

/** Spezza il testo in righe che stanno in maxWidth. */
export function wrap(str, size, maxWidth, bold = false) {
  const lines = [];
  let line = "";
  for (const word of String(str ?? "").split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (!line || textWidth(next, size, bold) <= maxWidth) line = next;
    else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines;
}

const esc = (s) => s.replace(/[\\()]/g, (c) => `\\${c}`);
const rgb = (hex) => {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => (v / 255).toFixed(3)).join(" ");
};
const f = (n) => Number(n.toFixed(2));

export class Pdf {
  constructor() { this.pages = []; this.cur = null; }

  addPage() { this.cur = []; this.pages.push(this.cur); return this.pages.length - 1; }

  /** Rettangolo pieno (x, y dall'alto a sinistra). */
  rect(x, y, w, h, fill) {
    this.cur.push(`${rgb(fill)} rg ${f(x)} ${f(PAGE.h - y - h)} ${f(w)} ${f(h)} re f`);
  }

  strokeRect(x, y, w, h, stroke, width = 0.8) {
    this.cur.push(`${rgb(stroke)} RG ${width} w ${f(x)} ${f(PAGE.h - y - h)} ${f(w)} ${f(h)} re S`);
  }

  /** Testo con la linea di base a y (dall'alto). */
  text(x, y, str, { size = 10, bold = false, color = "#0e1a2b", align = "left", page = null } = {}) {
    const enc = encode(str);
    const width = textWidth(str, size, bold);
    const px = align === "right" ? x - width : align === "center" ? x - width / 2 : x;
    const cmd = `BT ${rgb(color)} rg /${bold ? "F2" : "F1"} ${size} Tf ${f(px)} ${f(PAGE.h - y)} Td (${esc(enc)}) Tj ET`;
    (page == null ? this.cur : this.pages[page]).push(cmd);
  }

  /** Scrive righe già spezzate, restituisce la y dopo l'ultima riga. */
  lines(x, y, lines, opts = {}) {
    const lead = (opts.size ?? 10) * 1.3;
    lines.forEach((l, i) => this.text(x, y + i * lead, l, opts));
    return y + lines.length * lead;
  }

  /** Costruisce il file. Restituisce Uint8Array. */
  build({ title = "Documento", author = "Stay Live" } = {}) {
    const objs = [];
    const add = (body) => { objs.push(body); return objs.length; };
    const catalog = add(""); const pagesRoot = add("");
    const f1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    const f2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    const info = add(`<< /Title (${esc(encode(title))}) /Author (${esc(encode(author))}) /Producer (Stay Live) >>`);
    const kids = [];
    for (const ops of this.pages) {
      const stream = ops.join("\n");
      const content = add(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
      kids.push(add(`<< /Type /Page /Parent ${pagesRoot} 0 R /MediaBox [0 0 ${PAGE.w} ${PAGE.h}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R >> >> /Contents ${content} 0 R >>`));
    }
    objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesRoot} 0 R >>`;
    objs[pagesRoot - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`;

    let out = "%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n";
    const offsets = [];
    objs.forEach((body, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${body}\nendobj\n`; });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
    out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%EOF\n`;
    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i += 1) bytes[i] = out.charCodeAt(i) & 255;
    return bytes;
  }
}
