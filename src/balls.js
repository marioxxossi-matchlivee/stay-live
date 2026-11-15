// Stay Live — palline a colori pieni (calcio e tennis), disegnate in SVG: nessuna immagine esterna, nitide a ogni dimensione.
// Ogni SVG è autosufficiente (gradienti con id unico): funziona anche quando il resto della pagina è nascosto.
let seq = 0;
const f = (n) => Math.round(n * 100) / 100;
const polar = (cx, cy, r, deg) => [cx + r * Math.cos((deg * Math.PI) / 180), cy + r * Math.sin((deg * Math.PI) / 180)];
const polygon = (cx, cy, r, startDeg) => Array.from({ length: 5 }, (_, k) => polar(cx, cy, r, startDeg + 72 * k).map(f).join(",")).join(" ");

const C = 128, R = 116; // centro e raggio nel riquadro 256 × 256

function soccer(id) {
  // Pentagono centrale con un vertice in alto; da ogni vertice parte una cucitura verso un pentagono sul bordo (tagliato dal cerchio).
  const core = polygon(C, C, 34, -90);
  const spokes = Array.from({ length: 5 }, (_, k) => {
    const [x1, y1] = polar(C, C, 34, -90 + 72 * k), [x2, y2] = polar(C, C, 84, -90 + 72 * k);
    return `<path d="M${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}"/>`;
  }).join("");
  const rim = Array.from({ length: 5 }, (_, k) => {
    const a = -90 + 72 * k, [cx, cy] = polar(C, C, 118, a);
    return `<polygon points="${polygon(cx, cy, 34, a + 180)}"/>`;
  }).join("");
  // Cuciture che dai pentagoni del bordo scendono verso il bordo tra un pentagono e l'altro.
  const seams = Array.from({ length: 5 }, (_, k) => {
    const a = -90 + 72 * k + 36, [x1, y1] = polar(C, C, 84, a - 20), [x2, y2] = polar(C, C, 124, a);
    return `<path d="M${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}"/>`;
  }).join("");
  return `<defs><radialGradient id="${id}b" cx="38%" cy="32%" r="78%"><stop offset="0" stop-color="#ffffff"/><stop offset=".6" stop-color="#f1f4f9"/><stop offset="1" stop-color="#c3ccdb"/></radialGradient><clipPath id="${id}c"><circle cx="${C}" cy="${C}" r="${R}"/></clipPath></defs>`
    + `<circle cx="${C}" cy="${C}" r="${R}" fill="url(#${id}b)"/>`
    + `<g clip-path="url(#${id}c)"><g fill="#111827" stroke="#111827" stroke-width="4" stroke-linejoin="round"><polygon points="${core}"/>${rim}</g>`
    + `<g fill="none" stroke="#111827" stroke-width="4.5" stroke-linecap="round">${spokes}</g></g>`
    + `<circle cx="${C}" cy="${C}" r="${R}" fill="none" stroke="#111827" stroke-width="6"/>`
    + `<ellipse cx="90" cy="72" rx="26" ry="13" fill="#fff" opacity=".55" transform="rotate(-32 90 72)"/>`;
}

function tennis(id) {
  return `<defs><radialGradient id="${id}b" cx="36%" cy="30%" r="80%"><stop offset="0" stop-color="#f3ff62"/><stop offset=".55" stop-color="#d3ec27"/><stop offset="1" stop-color="#97b80e"/></radialGradient><clipPath id="${id}c"><circle cx="${C}" cy="${C}" r="${R}"/></clipPath></defs>`
    + `<circle cx="${C}" cy="${C}" r="${R}" fill="url(#${id}b)"/>`
    + `<g clip-path="url(#${id}c)" fill="none" stroke="#fff" stroke-width="11" stroke-linecap="round"><path d="M36 38C112 84 112 172 36 218"/><path d="M220 38C144 84 144 172 220 218"/></g>`
    + `<circle cx="${C}" cy="${C}" r="${R}" fill="none" stroke="#6f8a0a" stroke-width="6"/>`
    + `<ellipse cx="90" cy="70" rx="28" ry="14" fill="#fff" opacity=".42" transform="rotate(-32 90 70)"/>`;
}

const BUILD = { football: soccer, tennis };

/** Pallina piena e colorata dello sport ("football" | "tennis"). Dimensione = font-size del contenitore (classe `ic`). */
export function ball(sport, cls = "") {
  const draw = BUILD[sport] ?? BUILD.football;
  seq += 1;
  return `<svg class="ic ball ball-${sport === "tennis" ? "tennis" : "soccer"}${cls ? ` ${cls}` : ""}" viewBox="0 0 256 256" aria-hidden="true" focusable="false">${draw(`bl${seq}`)}</svg>`;
}
