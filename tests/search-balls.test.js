import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { ball } from "../src/balls.js";

const read = (p) => fs.readFileSync(p, "utf8");

test("palline: SVG pieni e colorati, ciascuno con i propri gradienti (id unici)", () => {
  const a = ball("football"), b = ball("tennis"), c = ball("football");
  assert.match(a, /ball-soccer/); assert.match(b, /ball-tennis/);
  assert.match(b, /#d3ec27/i, "pallina da tennis gialla");
  const id = (s) => s.match(/id="(bl\d+)b"/)[1];
  assert.notEqual(id(a), id(c));
});
test("schermata di scelta: nessun commento sotto Calcio e Tennis, palline colorate", () => {
  const s = read("src/sport.js");
  const gate = s.slice(s.indexOf("gate.innerHTML"), s.indexOf("const loader"));
  assert.doesNotMatch(gate, /<small>/);
  assert.match(gate, /ball\("football"\)/); assert.match(gate, /ball\("tennis"\)/);
});
test("barra del tennis: i due colori sono anche nel foglio del tennis (caricato per ultimo)", () => {
  const css = read("src/tennis/tennis.css");
  assert.match(css, /#tennis-root \.tn-bar \.a\{background:#1a2f9c/); assert.match(css, /#tennis-root \.tn-bar \.b\{background:#c2410c/);
});
test("calcio: ricerca per squadra, partita e campionato, senza accenti", () => {
  const main = read("src/main.js");
  assert.match(main, /function matchesQuery\(m\)/); assert.match(main, /if \(!matchesQuery\(m\)\) return false;/);
  assert.match(main, /inScope\(m\.league\) && matchesQuery\(m\)/);
  assert.match(read("index.html"), /id="searchbar"/);
});
test("calcio: nelle impostazioni compaiono i crediti residui", () => {
  assert.match(read("index.html"), /id="set-credits"/);
  assert.match(read("src/main.js"), /fetch\("\/api\/usage"/);
});
