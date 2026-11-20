import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { loadHistory, historyLoaderMode, buildBook, CFG } from "../scripts/tennis-sync.js";

const NOW = Date.parse("2026-11-19T12:00:00Z");
const rows = Array.from({ length: 96500 }, (_, i) => ({ match_key: `m${String(i).padStart(6, "0")}`, status: "finished", winner: i % 3 ? 1 : 2, p1_id: `p${i % 500}`, p2_id: `p${(i * 7 + 1) % 500}`, p1_name: "A", p2_name: "B", starts_at: new Date(NOW - 300 * 864e5 + Math.floor(i / 4) * 3e5).toISOString(), surface: "Hard", best_of: 3, tour: "atp", category: "tour" }));
const cmp = (a, b) => (a.starts_at < b.starts_at ? -1 : a.starts_at > b.starts_at ? 1 : a.match_key < b.match_key ? -1 : 1);
const sorted = [...rows].sort(cmp);
const page = (q) => { let l = sorted; if (q.or) { const m = q.or.match(/starts_at\.gt\."([^"]*)",and\(starts_at\.eq\."([^"]*)",match_key\.gt\."([^"]*)"/); l = l.filter((r) => r.starts_at > m[1] || (r.starts_at === m[2] && r.match_key > m[3])); } return l.slice(q.offset ?? 0, (q.offset ?? 0) + q.limit); };
const calls = { getAll: 0, fetchPage: 0 };
const db = {
  getAll: async (name, q, size = 1000, maxPages = 40) => { calls.getAll++; const out = []; for (let p = 0; p < maxPages; p++) { const r = page({ ...q, limit: size, offset: p * size }); out.push(...r); if (r.length < size) break; } return out; },
  fetchPage: async (q) => { calls.fetchPage++; return page(q); },
};

test("interruttore: predefinito offset; solo TENNIS_HISTORY_LOADER=keyset attiva il percorso completo", () => {
  assert.equal(historyLoaderMode({}), "offset"); assert.equal(historyLoaderMode({ TENNIS_HISTORY_LOADER: "" }), "offset"); assert.equal(historyLoaderMode({ TENNIS_HISTORY_LOADER: "on" }), "offset"); assert.equal(historyLoaderMode({ TENNIS_HISTORY_LOADER: "off" }), "offset");
  assert.equal(historyLoaderMode({ TENNIS_HISTORY_LOADER: "keyset" }), "keyset"); assert.equal(historyLoaderMode({ TENNIS_HISTORY_LOADER: " KEYSET " }), "keyset");
});
test("senza variabile il percorso operativo è quello di prima: offset, 80.000 partite, nessuna lettura a chiave", async () => {
  const before = { ...calls }; delete process.env.TENNIS_HISTORY_LOADER;
  const h = await loadHistory(db, NOW);
  assert.equal(h.length, 80000); assert.equal(calls.fetchPage, before.fetchPage); assert.ok(calls.getAll > before.getAll);
  assert.deepEqual(h, await loadHistory(db, NOW, CFG.historyDays, { loader: "offset" })); // stesso risultato di una richiesta esplicita
});
test("con keyset: tutte le 96.500 partite, stesso ordine e stesso formato; l'OLD resta un prefisso di NEW", async () => {
  const o = await loadHistory(db, NOW, CFG.historyDays, { loader: "offset" }), n = await loadHistory(db, NOW, CFG.historyDays, { loader: "keyset" });
  assert.equal(n.length, 96500); assert.deepEqual(n.slice(0, 80000), o); assert.deepEqual(Object.keys(n[0]), Object.keys(o[0]));
});
test("rollback: tolta la variabile si torna esattamente all'OLD; il libro dei rating coincide con quello costruito sull'OLD", async () => {
  process.env.TENNIS_HISTORY_LOADER = "keyset"; const on = await loadHistory(db, NOW); delete process.env.TENNIS_HISTORY_LOADER; const off = await loadHistory(db, NOW);
  assert.equal(on.length, 96500); assert.equal(off.length, 80000);
  const a = buildBook(off), b = buildBook((await loadHistory(db, NOW, CFG.historyDays, { loader: "offset" })));
  assert.deepEqual([...a.players.entries()].map(([k, v]) => [k, v.elo, v.n]), [...b.players.entries()].map(([k, v]) => [k, v.elo, v.n]));
});
test("keyset senza db.fetchPage: errore esplicito, nessuna sostituzione silenziosa con l'offset", async () => {
  await assert.rejects(() => loadHistory({ getAll: db.getAll }, NOW, CFG.historyDays, { loader: "keyset" }), /fetchPage/);
});
test("nessun workflow operativo imposta TENNIS_HISTORY_LOADER: l'attivazione resta una decisione separata", () => {
  for (const f of fs.readdirSync(".github/workflows")) assert.ok(!fs.readFileSync(`.github/workflows/${f}`, "utf8").includes("TENNIS_HISTORY_LOADER"), f);
});
