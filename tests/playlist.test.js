import test from "node:test";
import assert from "node:assert/strict";
import { STATUS_LABEL, accordionHtml, dayLabel, filterRows, groupByDay, kickoffOf, playHeadHtml, statusPill } from "../src/playlist.js";

const leg = (o = {}) => ({ matchId: "m1", home: "Inter", away: "Milan", homeLogo: null, awayLogo: null, kickoffAt: "2026-11-07T19:45:00Z", key: "over25", label: "Over 2,5", p: 0.7, pLow: 0.62, ...o });
const row = (o = {}) => ({ play: { id: "a", kind: "single", savedAt: "2026-11-06T10:00:00Z", legs: [leg()], ...o.play }, legs: o.legs ?? [leg()], status: o.status ?? "pending", profit: null });

test("esiti: quattro stati esistenti con testo e icona", () => {
  assert.deepEqual(STATUS_LABEL, { won: "VINTA", lost: "PERSA", pending: "IN ATTESA", void: "ANNULLATA" });
  for (const s of Object.keys(STATUS_LABEL)) { const h = statusPill(s); assert.ok(h.includes(STATUS_LABEL[s])); assert.ok(h.includes("<svg")); assert.ok(h.includes(`st-${s}`)); }
});

test("riga chiusa singola: solo squadre, scudetti ed esito (nessun dettaglio)", () => {
  const h = playHeadHtml(row({ status: "won" }));
  assert.ok(h.includes("Inter") && h.includes("Milan") && h.includes("VINTA"));
  assert.equal((h.match(/class="crest md"/g) ?? []).length, 2);
  for (const hidden of ["Over 2,5", "prudente", "quota", "Risultato", "API", "BET", "EVITA", "corner", "Elimina"]) assert.ok(!h.includes(hidden), `non deve comparire: ${hidden}`);
});

test("riga chiusa multipla: conteggio gare e scudetti, niente scelte", () => {
  const legs = [leg(), leg({ matchId: "m2", home: "Roma" }), leg({ matchId: "m3", home: "Lazio" }), leg({ matchId: "m4", home: "Napoli" })];
  const h = playHeadHtml({ play: { kind: "multiple", legs }, legs, status: "pending" });
  assert.ok(h.includes("Multipla · 4 gare") && h.includes("+1") && h.includes("IN ATTESA"));
  assert.ok(!h.includes("Over 2,5"));
});

test("i nomi passano da esc()", () => {
  const h = playHeadHtml(row({ legs: [leg({ home: "<b>x</b>" })] }));
  assert.ok(!h.includes("<b>x</b>") && h.includes("&lt;b&gt;x&lt;/b&gt;"));
});

test("accordion: chiuso = aria-expanded false + pannello inert; aperto = senza inert", () => {
  const closed = accordionHtml({ id: "p:a1", head: "H", body: "B" });
  assert.ok(closed.includes('aria-expanded="false"') && /acc-panel"[^>]* inert/.test(closed) && !closed.includes(" open\""));
  const open = accordionHtml({ id: "p:a1", head: "H", body: "B", open: true });
  assert.ok(open.includes('aria-expanded="true"') && !/acc-panel"[^>]* inert/.test(open) && open.includes("acc open"));
  assert.ok(closed.includes('aria-controls="acc-p_a1"') && closed.includes('id="acc-p_a1"'));
});

test("giorni: etichette relative e ordine (giorno più recente prima, orario crescente dentro)", () => {
  assert.equal(dayLabel("2026-11-07", "2026-11-07"), "Oggi");
  assert.equal(dayLabel("2026-11-06", "2026-11-07"), "Ieri");
  assert.equal(dayLabel("2026-11-08", "2026-11-07"), "Domani");
  assert.match(dayLabel("2026-11-01", "2026-11-07"), /^Domenica 1 novembre$/);
  const a = row({ play: { id: "a" }, legs: [leg({ kickoffAt: "2026-11-07T20:00:00Z" })] });
  const b = row({ play: { id: "b" }, legs: [leg({ kickoffAt: "2026-11-07T12:00:00Z" })] });
  const c = row({ play: { id: "c" }, legs: [leg({ kickoffAt: "2026-11-06T12:00:00Z" })] });
  const g = groupByDay([a, c, b], "2026-11-07");
  assert.deepEqual(g.map((x) => x.label), ["Oggi", "Ieri"]);
  assert.deepEqual(g[0].rows.map((r) => r.play.id), ["b", "a"]);
});

test("kickoffOf: la gamba più vicina; senza date usa il salvataggio", () => {
  const legs = [leg({ kickoffAt: "2026-11-08T10:00:00Z" }), leg({ kickoffAt: "2026-11-07T10:00:00Z" })];
  assert.equal(kickoffOf({ play: { legs }, legs }), "2026-11-07T10:00:00.000Z");
  assert.equal(kickoffOf({ play: { legs: [], savedAt: "2026-11-01T08:00:00Z" }, legs: [] }), "2026-11-01T08:00:00.000Z");
});

test("filtro per stato usa solo gli stati esistenti", () => {
  const rows = ["pending", "won", "lost", "void"].map((status) => row({ status }));
  assert.equal(filterRows(rows, "all").length, 4);
  assert.deepEqual(filterRows(rows, "pending").map((r) => r.status), ["pending"]);
  assert.deepEqual(filterRows(rows, "done").map((r) => r.status), ["won", "lost", "void"]);
});
