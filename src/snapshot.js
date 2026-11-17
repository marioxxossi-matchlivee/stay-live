/** Ricompone in memoria sul dispositivo lo snapshot consegnato a blocchi da /api/board-chunks. */
export function restoreBoardPayload(payload, storage, rows) {
  if (!storage || storage.format !== 1 || !Number.isInteger(storage.chunkCount) || storage.chunkCount < 0 || !Number.isInteger(storage.matchCount) || storage.matchCount < 0) {
    throw new Error("Manifest snapshot non valido o formato non supportato.");
  }
  if (!Array.isArray(rows) || rows.length !== storage.chunkCount) {
    throw new Error(`Snapshot incompleto: attesi ${storage.chunkCount} blocchi, ricevuti ${rows?.length ?? 0}.`);
  }
  const ordered = [...rows].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const matches = [];
  for (const row of ordered) {
    if (!Array.isArray(row?.payload?.matches)) throw new Error("Blocco snapshot non valido: elenco partite assente.");
    matches.push(...row.payload.matches);
  }
  if (matches.length !== storage.matchCount) {
    throw new Error(`Snapshot incompleto: attese ${storage.matchCount} partite, ricevute ${matches.length}.`);
  }
  return { ...payload, matches };
}
