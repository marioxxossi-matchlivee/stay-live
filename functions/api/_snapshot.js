/**
 * Snapshot calcio: il manifest mantiene i campi comuni, mentre l'elenco partite
 * viene suddiviso in righe più piccole della stessa tabella app_snapshot.
 * Il manifest viene pubblicato per ultimo: /api/board vede sempre una versione completa.
 */
export const SNAPSHOT_MATCHES_PER_CHUNK = 40;

export function createSnapshotRows(payload, meta, builtAt, version, chunkSize = SNAPSHOT_MATCHES_PER_CHUNK) {
  if (!payload || typeof payload !== "object" || !Array.isArray(payload.matches)) {
    throw new TypeError("Snapshot non valido: payload.matches deve essere un array.");
  }
  if (!Number.isInteger(chunkSize) || chunkSize < 1) throw new RangeError("chunkSize deve essere un intero positivo.");
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(String(version))) throw new TypeError("Versione snapshot non valida.");

  const matches = payload.matches;
  const chunks = [];
  for (let i = 0; i < matches.length; i += chunkSize) {
    const index = chunks.length;
    chunks.push({
      id: `fixtures:chunk:${version}:${String(index).padStart(4, "0")}`,
      payload: { matches: matches.slice(i, i + chunkSize) },
      meta: {},
      built_at: builtAt,
    });
  }

  const snapshotStorage = {
    format: 1,
    version: String(version),
    chunkCount: chunks.length,
    matchCount: matches.length,
    chunkSize,
  };
  const manifest = {
    id: "fixtures",
    payload: { ...payload, matches: [] },
    meta: { ...meta, snapshotStorage },
    built_at: builtAt,
  };
  return { chunks, manifest, snapshotStorage };
}

