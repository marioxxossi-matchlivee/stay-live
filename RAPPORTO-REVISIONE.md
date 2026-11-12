# Stay Live — rapporto di revisione (stato al 12/11/2026)

Stato onesto: lavoro **in corso**. Test automatici: 274 su 274 passano. Build (`npm run build`) e prova nel browser **non eseguiti** (ambiente senza rete): vanno fatti prima del deploy.

## Fatto
- **Pulizia calcio**: eliminati `functions/api/_odds.js` (file vuoto, mai importato) e `functions/api/quotes.js` (risponde solo "non più disponibile" ai client vecchi). Verificato che nessun file, test o workflow li usa. Per recuperarli basta lo ZIP originale.
- **Sezione Affidabilità** (calcio): quarta scheda nella barra. Dal vivo: BET ed EVITA contro i risultati veri, con percentuale, numero di casi, intervallo al 95%, dichiarato dal modello, soglia prudente, taratura, esiti per tipo, versioni del modello. Storico: rapporto del backtest sull'intero archivio di partite finali.
  - `supabase/migrations/202611130001_monitor_views.sql` (viste di sola lettura, già applicata)
  - `functions/api/_monitor.js`, `functions/api/monitor.js`
  - `src/monitor-view.js`, `src/monitor.js`, `src/monitor.css`, `src/monitor-tab.js`
  - `scripts/publish-backtest.js` + passo nel workflow `backtest-evita.yml` (ora anche ogni domenica)
- **Messaggio chiaro nella scheda vecchia** quando i BET conclusi sono di versioni precedenti del modello (prima mostrava "Nessun BET ancora concluso").
- **Tennis**: modello (Elo per superficie, forma, H2H, carico, modello a punti, astensione), metriche e backtest senza look-ahead, migrazione `202611120001_tennis.sql` (già applicata), interfaccia con scelta sport, endpoint `/api/tennis-board`, sonda API.

## Non ancora fatto
- Client Tennis-API, script e workflow di aggiornamento del tennis: la sonda ha risposto 403 "not subscribed" (abbonamento RapidAPI mancante), quindi nessun campo reale visto.
- Analisi a fondo e riduzione di `src/main.js`, `src/style.css`, `functions/api/model.js`, `scripts/full-refresh.js`.
- Build e prova su dispositivo.

## Variabili d'ambiente
Esistenti: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SYNC_SECRET`, chiave API-Football. Tennis (solo secrets di GitHub): `TENNIS_API_KEY`, `TENNIS_API_HOST` (facoltativa).
