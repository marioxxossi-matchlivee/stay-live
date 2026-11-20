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
  assert.ok(users.every((u) => [ "scripts/tennis-strategy-audit.js", "scripts/tennis-history-shadow.js", "scripts/tennis-history-monitor.js", "scripts/tennis-strategy-audit-v5.js", "scripts/tennis-sync.js" ].includes(u)), `importatori non ammessi: ${users}`); // Shadow Mode (19/11/2026) e interruttore di tennis-sync.js (predefinito offset): le API in functions/ restano escluse
});

// ── Aggiunte 19/11/2026: robustezza del caricamento a chiave ──
test("almeno 96.000 righe sintetiche, orari condivisi e match_key diversi: nessuna perdita né duplicato, ordine corretto, ultima pagina incompleta", async () => {
  const rows = mkRows(96123, 5), t = fakeTable(rows), r = await loadFinishedKeyset(t.fetchPage);
  assert.equal(r.rows.length, 96123); assert.equal(r.duplicates, 0); assert.equal(r.pages, 97); // 96 pagine piene + 1 incompleta (123 righe)
  assert.deepEqual(r.rows.map((x) => x.match_key), t.sorted.map((x) => x.match_key));
});
test("pagina vuota: storico vuoto senza errori; pagina piena seguita da pagina vuota: fine regolare", async () => {
  assert.deepEqual(await loadFinishedKeyset(async () => []), { rows: [], pages: 1, duplicates: 0, truncated: false });
  const rows = mkRows(2000), t = fakeTable(rows), r = await loadFinishedKeyset(t.fetchPage); assert.equal(r.rows.length, 2000); assert.equal(r.pages, 3);
});
test("errore del database o di rete: errore esplicito con la pagina; nuovi tentativi solo se richiesti", async () => {
  const t = fakeTable(mkRows(3000)); let n = 0;
  const flaky = async (p) => { if (++n === 2) throw new Error("HTTP 503"); return t.fetchPage(p); };
  await assert.rejects(() => loadFinishedKeyset(flaky, {}), /pagina 2: HTTP 503/);
  n = 0; const ok = await loadFinishedKeyset(flaky, { retries: 1, sleep: async () => {} }); assert.equal(ok.rows.length, 3000);
  await assert.rejects(() => loadFinishedKeyset(async () => { throw new Error("rete"); }, { retries: 2, sleep: async () => {} }), /pagina 1: rete/);
  await assert.rejects(() => loadFinishedKeyset(async () => ({ rows: [] })), /risposta non valida/);
});
test("chiave o data mancante/non valida: errore esplicito, nessuna riga scartata in silenzio", async () => {
  await assert.rejects(() => loadFinishedKeyset(async () => [{ starts_at: "2026-01-01T00:00:00Z" }], {}), /starts_at e match_key/);
  await assert.rejects(() => loadFinishedKeyset(async () => [{ match_key: "a", starts_at: null }], {}), /starts_at e match_key/);
  await assert.rejects(() => loadFinishedKeyset(async () => [{ match_key: "", starts_at: "2026-01-01T00:00:00Z" }], {}), /starts_at e match_key/);
  await assert.rejects(() => loadFinishedKeyset(async () => [{ match_key: "a", starts_at: "non-una-data" }], {}), /data non valida/);
});
test("cursore che non avanza: pagina di sole righe già lette, stessa chiave, data in diminuzione; filtro `or` riservato", async () => {
  const same = [{ match_key: "a", starts_at: "2026-01-01T00:00:00Z" }, { match_key: "b", starts_at: "2026-01-01T00:00:00Z" }];
  await assert.rejects(() => loadFinishedKeyset(async () => same, { pageSize: 2 }), /non avanza/);
  const pages = [[{ match_key: "a", starts_at: "2026-01-02T00:00:00Z" }], [{ match_key: "b", starts_at: "2026-01-01T00:00:00Z" }]]; let i = 0;
  await assert.rejects(() => loadFinishedKeyset(async () => pages[i++], { pageSize: 1 }), /data in diminuzione/);
  await assert.rejects(() => loadFinishedKeyset(async () => [], { query: { or: "(a.eq.1)" } }), /riservato/);
});
test("chiavi con caratteri speciali attraversano due pagine senza perdite", async () => {
  const rows = ["a,b", 'c"d', "e)f", "g\\h", "i j", "k(l"].map((k) => ({ match_key: k, starts_at: "2026-01-01T00:00:00.000Z" }));
  const sorted = [...rows].sort((x, y) => (x.match_key < y.match_key ? -1 : 1)); let calls = 0;
  const fetchPage = async (p) => { calls++; if (!p.or) return sorted.slice(0, 3); const m = p.or.match(/match_key\.gt\."((?:[^"\\]|\\.)*)"\)\)$/); const last = m[1].replaceAll('\\"', '"').replaceAll("\\\\", "\\"); return sorted.filter((r) => r.match_key > last).slice(0, 3); };
  const r = await loadFinishedKeyset(fetchPage, { pageSize: 3 }); assert.equal(r.rows.length, 6); assert.equal(new Set(r.rows.map((x) => x.match_key)).size, 6); assert.ok(calls >= 2);
});
test("il loader a chiave è collegato a tennis-sync.js SOLO dietro interruttore (predefinito offset); API, app e Shadow Mode restano separate", () => {
  const sync = fs.readFileSync("scripts/tennis-sync.js", "utf8");
  assert.ok(/historyLoaderMode/.test(sync) && !/tennis-history-shadow/.test(sync), "tennis-sync.js non deve importare la Shadow Mode");
  for (const f of fs.readdirSync("functions/api").map((x) => `functions/api/${x}`)) { if (f.endsWith("_tennis-history.js")) continue; const s = fs.readFileSync(f, "utf8"); assert.ok(!/_tennis-history|tennis-history-shadow/.test(s.replace(/\/\*[\s\S]*?\*\//g, "")), `${f} collegato al loader`); }
});
