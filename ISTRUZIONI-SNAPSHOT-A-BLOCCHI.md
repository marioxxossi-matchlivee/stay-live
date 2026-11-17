# Stay Live — aggiornamento snapshot Supabase

## Cosa cambia

Il payload delle partite non viene più inviato in un'unica scrittura PostgREST. Quando la nuova modalità è attiva, `scripts/full-refresh.js` divide `payload.matches` in blocchi da 40 righe nella tabella già esistente `app_snapshot`; la riga `id=fixtures` diventa il manifest. Il manifest viene scritto per ultimo, quindi un errore durante il caricamento dei blocchi lascia attiva la versione precedente.

`/api/board` continua a inoltrare il manifest in streaming. Il client scarica i blocchi da `/api/board-chunks`, sempre in streaming lato Cloudflare, e ricompone localmente lo stesso array `payload.matches` usato finora.

**Non serve eseguire SQL o applicare nuove migrazioni su Supabase.** Non vengono cambiati pronostici, probabilità, quote, provider, API key o gestione dei crediti.

## Applicazione sicura

1. Sostituisci/aggiungi nel repository tutti i file contenuti nello ZIP, mantenendo i percorsi.
2. Pubblica il commit sul branch usato da Cloudflare Pages e attendi che il deploy Pages risulti completato con successo. La nuova interfaccia e gli endpoint devono essere online prima di attivare la scrittura a blocchi.
3. In GitHub apri **Settings → Secrets and variables → Actions → Variables** e crea la variabile di repository:
   - Nome: `SNAPSHOT_CHUNKS_ENABLED`
   - Valore: `true`
4. Da GitHub → Actions avvia manualmente **Aggiornamento completo** una sola volta e attendi il completamento.
5. Controlla il riepilogo: la verifica dello snapshot deve risultare `ok` e `chunksFound` deve coincidere con `chunksExpected`.

Finché la variabile non esiste o vale `false`, i workflow mantengono il vecchio formato a riga singola. Questo interruttore evita che un workflow scriva un manifest a blocchi prima che Cloudflare abbia pubblicato il client capace di leggerlo.

## File inclusi

- `functions/api/_snapshot.js` — costruzione dei blocchi e del manifest.
- `functions/api/board.js` — mantiene la lettura del manifest in streaming.
- `functions/api/board-chunks.js` — nuovo endpoint streaming per i blocchi.
- `src/snapshot.js` e `src/main.js` — ricomposizione lato dispositivo.
- `scripts/full-refresh.js` — pubblicazione ordinata, verifica e pulizia della versione precedente.
- `.github/workflows/aggiornamento-completo.yml` e `.github/workflows/recupero-aggiornamento.yml` — lettura della variabile di attivazione.
- Test e documentazione aggiornati.
