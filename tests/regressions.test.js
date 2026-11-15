import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("i clic dentro il tennis non vengono gestiti anche dal calcio (le tendine si aprivano e richiudevano due volte)", () => {
  const main = read("src/main.js");
  assert.match(main, /document\.addEventListener\("click", \(e\) => \{\s*const t = e\.target;\s*if \(t\.closest\("\[data-sport-scope\]"\)\) return;/);
  assert.match(read("src/sport.js"), /root\.dataset\.sportScope/);
});
test("tennis: filtri come tendina animata e pulsante piccolo; seleziona-giocate aggiorna il selettore esistente", () => {
  const app = read("src/tennis/app.js");
  assert.match(app, /id="tn-facc"/); assert.match(app, /facc\.classList\.toggle\("open"/); assert.doesNotMatch(app, /lg-toggle/);
  assert.match(app, /function setPlayFilter/); assert.match(app, /seg\.style\.setProperty\("--i"/);
  assert.doesNotMatch(app, /if \(plf\) \{ state\.playFilter = plf\.dataset\.plf; return renderPlays\(\); \}/, "il selettore non si ricrea a ogni clic");
  const css = read("src/design/matchcard.css");
  assert.match(css, /\.tn-facc\s*\{[^}]*grid-template-rows:0fr/); assert.match(css, /\.tn-facc\.open\s*\{[^}]*grid-template-rows:1fr/);
});
test("selettori a segmenti: numero di voci nel markup e indicatore che scorre", () => {
  assert.match(read("index.html"), /id="mode-seg"[^>]*--segn:2/);
  assert.match(read("src/tennis/playsview.js"), /id="tn-pl-seg"[^>]*--segn:3/);
  assert.match(read("src/main.js"), /--segn:3;--i:\$\{PL_FILTERS/);
  const css = read("src/design/matchcard.css");
  assert.match(css, /\.seg::before[^{]*\{[^}]*left:calc\(3px \+ \(100% - 6px\) \/ var\(--segn\) \* var\(--i,0\)\)[^}]*transition:left/);
});
test("barra del tennis: ogni scheda ha la sua animazione dell'icona, come nel calcio", () => {
  const css = read("src/design/matchcard.css") + read("src/design/shell.css");
  for (const t of ["matches", "plays", "reliability", "settings"]) assert.match(css, new RegExp(`button\\[data-tab=${t}\\]\\[aria-pressed=true\\] \\.ic-f\\{animation`));
  const app = read("src/tennis/app.js");
  for (const t of ["matches", "plays", "reliability", "settings"]) assert.match(app, new RegExp(`data-tab="${t}"`));
});
test("barra in alto sopra il contenuto; segnalibro pieno e piatto; probabilità del tennis in due colori distinti", () => {
  const css = read("src/design/matchcard.css");
  assert.match(css, /\.top,\.tn-top\{z-index:var\(--z-top\)\}/); assert.match(css, /main,\.tn-main\{position:relative;isolation:isolate\}/);
  assert.match(css, /\.row-save\.done[^{]*\{[^}]*background:transparent!important/); assert.match(css, /\.row-save\.done svg\{fill:currentColor\}/);
  const a = css.match(/\.tn-bar \.a\{background:(#[0-9a-f]{6})/)[1], b = css.match(/\.tn-bar \.b\{background:(#[0-9a-f]{6})/)[1];
  const lum = (h) => { const [r, g, bl] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * bl; };
  const ratio = (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  assert.notEqual(a, b); assert.ok(Math.abs(parseInt(a.slice(1, 3), 16) - parseInt(b.slice(1, 3), 16)) > 100, "tinte lontane (blu contro arancio)");
  assert.ok(ratio >= 1.2);
  for (const c of [a, b]) assert.ok((1.05) / (lum(c) + 0.05) >= 4.5, `testo bianco leggibile su ${c}`);
});
test("giocate del calcio: salvano e mostrano tutti i mercati, con il resoconto a partita finita", () => {
  const main = read("src/main.js");
  assert.match(main, /mk: m\.mk \?\? null, cornerModel: m\.cornerModel \?\? null/);
  assert.match(main, /play\.snap\?\.mk && play\.kind === "single"/); assert.match(main, /result: final, idPrefix: "pk"/);
});
