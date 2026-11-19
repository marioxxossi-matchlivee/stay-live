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
export async function loadFinishedKeyset(fetchPage, { query = {}, pageSize = 1000, maxPages = 400, onLimit = "throw", retries = 0, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  if (query.or != null) throw new Error("Storico: il filtro `or` è riservato alla paginazione a chiave.");
  if (!Number.isInteger(pageSize) || pageSize < 1) throw new Error("Storico: pageSize non valido.");
  const out = [], seen = new Set(); let last = null, pages = 0, duplicates = 0;
  // Una richiesta con eventuali nuovi tentativi (solo errori di rete/lettura): l'errore finale dice a quale pagina è avvenuto.
  const read = async (params, n) => {
    for (let attempt = 0; ; attempt++) {
      try { return await fetchPage(params); }
      catch (e) { if (attempt >= retries) throw new Error(`Storico: errore alla pagina ${n}: ${e?.message ?? e}`, { cause: e }); await sleep(250 * 2 ** attempt); }
    }
  };
  while (true) {
    if (pages >= maxPages) { if (onLimit === "throw") throw new Error(`Storico: raggiunto il limite di sicurezza di ${maxPages} pagine (${out.length} righe): nessun troncamento silenzioso.`); return { rows: out, pages, duplicates, truncated: true }; }
    const params = { ...query, order: "starts_at.asc,match_key.asc", limit: pageSize };
    if (last) params.or = afterKey(last.starts_at, last.match_key);
    const rows = await read(params, pages + 1); pages++;
    if (!Array.isArray(rows)) throw new Error("Storico: risposta non valida.");
    let fresh = 0;
    for (const r of rows) {
      if (r?.match_key == null || r?.starts_at == null || String(r.match_key) === "") throw new Error("Storico: la select deve includere starts_at e match_key (riga senza chiave o senza data).");
      if (Number.isNaN(Date.parse(r.starts_at))) throw new Error(`Storico: data non valida nella riga ${r.match_key}.`);
      if (seen.has(r.match_key)) { duplicates++; continue; }
      seen.add(r.match_key); out.push(r); fresh++;
    }
    if (rows.length < pageSize) return { rows: out, pages, duplicates, truncated: false }; // pagina incompleta o vuota = ultima
    const tail = rows[rows.length - 1];
    // Il cursore deve avanzare. Il confronto tra match_key a parità di orario spetta al database (la sua collazione può differire dall'ordine di JavaScript): qui si rilevano solo i casi certi.
    if (fresh === 0) throw new Error("Storico: la paginazione non avanza (pagina composta solo da righe già lette).");
    if (last && (tail.match_key === last.match_key && tail.starts_at === last.starts_at)) throw new Error("Storico: la paginazione non avanza (stessa chiave della pagina precedente).");
    if (last && Date.parse(tail.starts_at) < Date.parse(last.starts_at)) throw new Error("Storico: la paginazione non avanza (ordine incoerente: data in diminuzione).");
    last = tail;
  }
}
