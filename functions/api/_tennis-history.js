/**
 * Stay Live Tennis — caricamento COMPLETO dello storico con paginazione a chiave (keyset). Funzione pura, testabile, SOLA LETTURA.
 * NON è collegata al motore operativo: oggi `loadHistory` (scripts/tennis-sync.js) pagina per offset con un tetto di 80 pagine × 1.000 righe e,
 * quando le righe sono di più, si ferma in silenzio escludendo le partite PIÙ RECENTI. Questo modulo serve all'audit e a un eventuale esperimento in Shadow Mode.
 *
 * Perché a chiave e non per offset:
 *  - ordine totale (starts_at, match_key): match_key è la chiave primaria, quindi lo stesso orario non crea ambiguità (nel database ci sono orari condivisi da più partite);
 *  - una riga inserita o modificata mentre si legge non sposta le pagine successive (con l'offset può duplicare o saltare righe);
 *  - ogni pagina riparte da dove finisce la precedente: nessun tetto implicito; il limite di sicurezza è esplicito e, se raggiunto, FALLISCE invece di troncare.
 */
const q = (v) => `"${String(v).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`; // valore PostgREST tra virgolette: sicuro con virgole, parentesi e spazi

/** Filtro «dopo la riga (startsAt, matchKey)» nell'ordine (starts_at asc, match_key asc). */
export const afterKey = (startsAt, matchKey) => `(starts_at.gt.${q(startsAt)},and(starts_at.eq.${q(startsAt)},match_key.gt.${q(matchKey)}))`;

/**
 * fetchPage(params) → Promise<righe[]>: esegue UNA richiesta con i parametri PostgREST dati (select, filtri, order, limit).
 * `query` contiene i filtri fissi (es. status, winner, starts_at: gte.…). `select` deve includere starts_at e match_key.
 */
export async function loadFinishedKeyset(fetchPage, { query = {}, pageSize = 1000, maxPages = 400, onLimit = "throw" } = {}) {
  const out = [], seen = new Set(); let last = null, pages = 0, duplicates = 0;
  while (true) {
    if (pages >= maxPages) { if (onLimit === "throw") throw new Error(`Storico: raggiunto il limite di sicurezza di ${maxPages} pagine (${out.length} righe): nessun troncamento silenzioso.`); return { rows: out, pages, duplicates, truncated: true }; }
    const params = { ...query, order: "starts_at.asc,match_key.asc", limit: pageSize };
    if (last) params.or = afterKey(last.starts_at, last.match_key);
    const rows = await fetchPage(params); pages++;
    if (!Array.isArray(rows)) throw new Error("Storico: risposta non valida.");
    for (const r of rows) { if (r?.match_key == null || r?.starts_at == null) throw new Error("Storico: la select deve includere starts_at e match_key."); if (seen.has(r.match_key)) { duplicates++; continue; } seen.add(r.match_key); out.push(r); }
    if (rows.length < pageSize) return { rows: out, pages, duplicates, truncated: false };
    const tail = rows[rows.length - 1];
    if (last && !(tail.starts_at > last.starts_at || (tail.starts_at === last.starts_at && tail.match_key > last.match_key))) throw new Error("Storico: la paginazione non avanza (ordine incoerente).");
    last = tail;
  }
}
