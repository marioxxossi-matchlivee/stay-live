import test from "node:test";
import assert from "node:assert/strict";
import { createSnapshotRows, SNAPSHOT_MATCHES_PER_CHUNK } from "../functions/api/_snapshot.js";
import { restoreBoardPayload } from "../src/snapshot.js";

test("snapshot a blocchi: crea blocchi limitati e manifest compatibile", () => {
  const matches = Array.from({ length: 95 }, (_, id) => ({ id: `m${id}`, pick: id % 2 === 0 }));
  const source = { updatedAt: "2026-11-17T20:00:00.000Z", leagues: [{ id: "seriea" }], matches };
  const { chunks, manifest, snapshotStorage } = createSnapshotRows(source, { status: "ok" }, "2026-11-17T20:00:00.000Z", "v1", 40);
  assert.equal(chunks.length, 3);
  assert.deepEqual(chunks.map((c) => c.payload.matches.length), [40, 40, 15]);
  assert.equal(manifest.id, "fixtures");
  assert.deepEqual(manifest.payload.matches, []);
  assert.equal(manifest.meta.snapshotStorage.matchCount, 95);
  assert.deepEqual(restoreBoardPayload(manifest.payload, manifest.meta.snapshotStorage, [...chunks].reverse()), source);
  assert.equal(snapshotStorage.chunkCount, 3);
});

test("snapshot vuoto: manifest valido senza righe blocco", () => {
  const { chunks, manifest } = createSnapshotRows({ matches: [], leagues: [] }, {}, "2026-11-17T20:00:00Z", "empty");
  assert.equal(chunks.length, 0);
  assert.deepEqual(restoreBoardPayload(manifest.payload, manifest.meta.snapshotStorage, []), { matches: [], leagues: [] });
});

test("snapshot incompleto o corrotto non viene restituito come valido", () => {
  const { manifest, chunks } = createSnapshotRows({ matches: [{ id: 1 }, { id: 2 }] }, {}, "2026-11-17T20:00:00Z", "v2", 1);
  assert.throws(() => restoreBoardPayload(manifest.payload, manifest.meta.snapshotStorage, chunks.slice(0, 1)), /incompleto/);
  assert.throws(() => restoreBoardPayload(manifest.payload, manifest.meta.snapshotStorage, [{ id: chunks[0].id, payload: {} }, chunks[1]]), /elenco partite assente/);
});

test("dimensione blocco predefinita contenuta", () => {
  const matches = Array.from({ length: SNAPSHOT_MATCHES_PER_CHUNK + 1 }, (_, id) => ({ id }));
  const { chunks } = createSnapshotRows({ matches }, {}, "2026-11-17T20:00:00Z", "default");
  assert.deepEqual(chunks.map((c) => c.payload.matches.length), [SNAPSHOT_MATCHES_PER_CHUNK, 1]);
});
