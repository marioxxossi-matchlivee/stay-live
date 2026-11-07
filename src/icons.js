/**
 * Icone in stile Lucide (ISC license) con animazioni CSS: stessa idea del pacchetto «lucide-animated», ma senza React né librerie
 * (l'app è JavaScript puro). Le polilinee hanno pathLength="1" così il tratto si può "disegnare" con stroke-dashoffset.
 * Le animazioni stanno in style.css (.ic-*) e si spengono con prefers-reduced-motion.
 */
const P = {
  check: `<path pathLength="1" d="M20 6 9 17l-5-5"/>`,
  flag: `<path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" x2="4" y1="22" y2="15"/>`,
  "trending-up": `<polyline pathLength="1" points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/>`,
  "trending-down": `<polyline pathLength="1" points="22 17 13.5 8.5 8.5 13.5 2 7"/><polyline points="16 17 22 17 22 11"/>`,
  "grip-vertical": `<circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/>`,
};
export const iconNames = Object.keys(P);
/** SVG inline dell'icona `name` (stringa vuota se il nome non esiste). Decorativa: aria-hidden. */
export const icon = (name, cls = "") => (P[name]
  ? `<svg class="ic ic-${name}${cls ? ` ${cls}` : ""}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${P[name]}</svg>`
  : "");
