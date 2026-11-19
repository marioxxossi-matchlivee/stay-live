import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { loadFinishedKeyset, afterKey } from "../functions/api/_tennis-history.js";

/** Database finto: applica order (starts_at, match_key) e il filtro `or` a chiave, come farebbe PostgREST. */
function fakeTable(rows) {
  const sorted = [...rows].sort((a, b) => (a.starts_at < b.starts_at ? -1 : a.starts_at > b.starts_at ? 1 : a.match_key < b.match_key ? -1 : a.match_key > b.match_key ? 1 : 0));
  const calls = [];
  const fetchPage = async (p) => {
    calls.push(p); let list = sorted;
    if (p.or) { const m = p.or.match(/starts_at\.gt\."([^"]*)",and\(starts_at\.eq\."([^"]*)",match_key\.gt\."([^"]*)"\)\)/); assert.ok(m, `filtro non riconosciuto: ${p.or}`); list = sorted.filter((r) => r.starts_at > m[1] || (r.starts_at === m[2] && r.match_key > m[3])); }
    return list.slice(0, p.limit);
  };
  return { fetchPage, calls, sorted };
}
const mkRows = (n, perTime = 3) => Array.from({ length: n }, (_, i) => ({ match_key: `${String(100000 + i).slice(1)}|x`, starts_at: new Date(Date.UTC(2025, 10, 16) + Math.floor(i / perTime) * 3600e3).toISOString() }));

test("storico oltre 80.000 righe: caricate tutte, una sola volta, in ordine, anche con orari uguali", async () => {
  const rows = mkRows(96369, 4); // 96.369 = numero reale di partite concluse negli ultimi 400 giorni al 18/11/2026; 4 partite per orario
  const t = fakeTable(rows), r = await loadFinishedKeyset(t.fetchPage, { query: { status: "eq.finished" } });
  assert.equal(r.rows.length, 96369); assert.equal(new Set(r.rows.map((x) => x.match_key)).size, 96369); assert.equal(r.duplicates, 0); assert.equal(r.truncated, false);
  assert.deepEqual(r.rows.map((x) => x.match_key), t.sorted.map((x) => x.match_key), "ordine totale (starts_at, match_key)");
  assert.equal(r.rows.at(-1).match_key, t.sorted.at(-1).match_key, "la partita PIÙ RECENTE è presente");
  assert.equal(r.pages, 97); assert.ok(t.calls.every((c) => c.limit === 1000 && c.status === "eq.finished"));
});
test("il vecchio schema a 80 pagine perde proprio le partite più recenti (documenta il difetto del motore operativo)", () => {
  const t = fakeTable(mkRows(96369, 4)); const old = t.sorted.slice(0, 80 * 1000);
  assert.equal(old.length, 80000); assert.ok(t.sorted.length - old.length === 16369); assert.ok(old.at(-1).starts_at < t.sorted.at(-1).starts_at);
});
test("orari condivisi a cavallo di due pagine: nessuna riga persa o duplicata", async () => {
  const rows = Array.from({ length: 2500 }, (_, i) => ({ match_key: `k${String(i).padStart(5, "0")}`, starts_at: "2026-01-01T00:00:00.000Z" })); // TUTTE allo stesso orario
  const r = await loadFinishedKeyset(fakeTable(rows).fetchPage);
  assert.equal(r.rows.length, 2500); assert.equal(new Set(r.rows.map((x) => x.match_key)).size, 2500);
});
test("limite di sicurezza esplicito: fallisce invece di troncare in silenzio; la paginazione che non avanza è un errore", async () => {
  const t = fakeTable(mkRows(5000));
  await assert.rejects(() => loadFinishedKeyset(t.fetchPage, { maxPages: 2 }), /nessun troncamento silenzioso/);
  const trunc = await loadFinishedKeyset(t.fetchPage, { maxPages: 2, onLimit: "return" }); assert.equal(trunc.truncated, true); assert.equal(trunc.rows.length, 2000);
  await assert.rejects(() => loadFinishedKeyset(async () => Array.from({ length: 1000 }, () => ({ match_key: "a", starts_at: "2026-01-01T00:00:00Z" })), {}), /non avanza/);
  await assert.rejects(() => loadFinishedKeyset(async () => [{ foo: 1 }], { pageSize: 1 }), /starts_at e match_key/);
});
test("righe duplicate restituite dal server (inserimento durante la lettura) vengono scartate e contate", async () => {
  const base = mkRows(30), pages = [base.slice(0, 5), [base[4], ...base.slice(5, 9)], base.slice(9, 11)]; let n = 0;
  const r = await loadFinishedKeyset(async () => pages[n++], { pageSize: 5 });
  assert.equal(r.duplicates, 1); assert.equal(r.rows.length, 11); assert.equal(new Set(r.rows.map((x) => x.match_key)).size, 11);
});
test("i valori del filtro a chiave sono tra virgolette (virgole, parentesi, apici non rompono la query)", () => {
  assert.equal(afterKey("2026-01-01T00:00:00+00:00", 'a,b)"c'), '(starts_at.gt."2026-01-01T00:00:00+00:00",and(starts_at.eq."2026-01-01T00:00:00+00:00",match_key.gt."a,b)\\"c"))');
});
test("il caricamento a chiave NON è collegato al motore operativo (solo audit e test)", () => {
  const users = [], walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { if (["node_modules", ".git"].includes(f.name)) continue; const p = `${d}/${f.name}`; if (f.isDirectory()) walk(p); else if (/\.(js|mjs|yml|yaml|toml|html)$/.test(f.name) && fs.readFileSync(p, "utf8").includes("_tennis-history")) users.push(p); } };
  for (const d of ["functions", "scripts", "src", ".github", "public"]) if (fs.existsSync(d)) walk(d);
  assert.ok(users.every((u) => u === "scripts/tennis-strategy-audit.js"), `importatori non ammessi: ${users}`);
});
