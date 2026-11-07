import test from "node:test";
import assert from "node:assert/strict";
import { SWIPE, orderBy, reorder, swipeIntent } from "../src/gestures.js";
import { icon, iconNames } from "../src/icons.js";
import { cornerBarHtml } from "../src/corners.js";

test("swipe: serve distanza minima e gesto nettamente orizzontale", () => {
  assert.equal(swipeIntent(SWIPE.min + 1, 0), "right");
  assert.equal(swipeIntent(-(SWIPE.min + 1), 5), "left");
  assert.equal(swipeIntent(SWIPE.min - 1, 0), null, "troppo corto");
  assert.equal(swipeIntent(80, 70), null, "quasi diagonale: è uno scroll");
  assert.equal(swipeIntent(0, 200), null);
});
test("reorder e orderBy non modificano l'originale e reggono i bordi", () => {
  const l = ["a", "b", "c", "d"];
  assert.deepEqual(reorder(l, 0, 2), ["b", "c", "a", "d"]);
  assert.deepEqual(reorder(l, 3, 0), ["d", "a", "b", "c"]);
  assert.deepEqual(reorder(l, 1, 99), ["a", "c", "d", "b"]);
  assert.deepEqual(reorder(l, 9, 0), l);
  assert.deepEqual(l, ["a", "b", "c", "d"]);
  const items = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }];
  assert.deepEqual(orderBy(items, [3, 1]).map((x) => x.id), [3, 1, 2, 4], "i non citati restano in coda nel loro ordine");
  assert.deepEqual(orderBy(items, []).map((x) => x.id), [1, 2, 3, 4]);
});
test("icone: svg decorative, nome sconosciuto = vuoto", () => {
  assert.ok(iconNames.length >= 5);
  for (const n of iconNames) assert.match(icon(n), new RegExp(`^<svg class="ic ic-${n}"[^>]*aria-hidden="true"`));
  assert.equal(icon("non-esiste"), "");
});
test("barra corner in lista: favorita, pari, escape dei nomi, vuota senza dati", () => {
  const f = (side, h, d, a) => ({ side, p: { home: h, draw: d, away: a } });
  const item = { home: "Inter", away: "Roma", corner: { favorite: f("home", 0.52, 0.12, 0.36) } };
  const html = cornerBarHtml(item);
  assert.match(html, /Più corner: <b>Inter<\/b> 52%/); assert.match(html, /class="pc-bar"/); assert.match(html, /width:52\.0%/);
  assert.match(cornerBarHtml({ ...item, corner: { favorite: f("even", 0.4, 0.2, 0.4) } }), /Nessuna favorita/);
  assert.equal(cornerBarHtml({ home: "A", away: "B" }), "");
  assert.equal(cornerBarHtml({ ...item, home: "<i>X</i>", corner: { favorite: f("home", 0.5, 0.1, 0.4) } }).includes("<i>X</i>"), false);
});
