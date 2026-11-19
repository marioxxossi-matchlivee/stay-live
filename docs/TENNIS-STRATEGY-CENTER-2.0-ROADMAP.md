# Tennis Strategy Center 2.0 — Roadmap e registro di lavoro

Ultimo aggiornamento: 18/11/2026 (revisione tecnica). Si lavora direttamente su `main`, per scelta dell'utente.
**Stato generale: SPERIMENTALE E ISOLATO.** Nessuna classe A/B/C/D è attiva in produzione; `_tennis-strategy2.js` e `_tennis-history.js` non sono importati dal motore (lo verificano due test). Nessuna scrittura o migrazione remota da questo lavoro. Se non emerge un'evidenza statisticamente robusta, il comportamento corretto è l'astensione.

## 1. Completato e verificato (con esito riproducibile)
| Cosa | Verifica |
|---|---|
| Migrazione `202611180001_tennis_itf_shadow.sql` | Il file nella repo è **identico all'SQL originale** conservato nella cronologia remota (`supabase_migrations.schema_migrations`, versione `20261118065243`, nome `tennis_itf_shadow`, autore dell'account del progetto). Struttura remota letta in sola lettura e coerente: 25 colonne, PK `match_key`, FK verso `tennis_matches` (ON DELETE RESTRICT), 5 vincoli CHECK, indici `pkey` e `starts_idx`, RLS attiva con 0 policy, trigger `tennis_itf_shadow_freeze` attivo, funzione eseguibile solo da `postgres` e `service_role`. Il file è idempotente: non va rieseguito. Test `tests/tennis-itf-shadow.test.js` 14/14 |
| Correzione del refresh tennis (`scripts/tennis-sync.js`) | 4 test dedicati; errori 5xx del provider tollerati per circuito |
| Paginazione dello storico (`_tennis-history.js`) | 7 test: 96.369 righe caricate una volta sola e in ordine anche con orari uguali; limite di sicurezza esplicito che fallisce invece di troncare; filtro a chiave con virgolette |
| Walk-forward senza look-ahead | Test: cambiare gli esiti di un mese non altera le previsioni di quel mese né dei precedenti (con controllo positivo sui successivi) |
| Errori standard per blocchi, bootstrap, Holm | Test su dati correlati (errore robusto ≫ indipendente), bootstrap riproducibile, Holm su valori noti |
| Parità tra filtri della simulazione e strategia operativa | Test su 600+ combinazioni: `operationalFilter` e `evaluateBet` danno lo stesso verdetto |
| Audit end-to-end | Report completo su dati sintetici, nessun NaN; ≈18 s su 90.000 partite |
| Suite completa `node --test` | **480 test: 480 superati, 0 falliti** (include le modifiche dell'utente sul log loss; il calcio non è toccato da questo lavoro) |

## 2. Implementato ma NON ancora validato su dati reali
- Il report dell'audit **con la metodologia corretta** (v3): non è ancora stato lanciato sul database reale. Tutti i numeri del primo e del secondo audit (vedi §6) usavano una versione precedente e vanno rimpiazzati dopo il rilancio.
- Classi A/B/C/D e doppie (`_tennis-strategy2.js`): comportamento verificato su dati sintetici (su solo rumore la classe A non compare mai e A+B restano rare), non su dati reali.

## 3. Da correggere / problemi aperti
1. **`loadHistory` operativo ancora a 80 pagine** (`scripts/tennis-sync.js`): **NON corretto**. Pagina per offset, si ferma in silenzio a 80.000 righe ed esclude le partite più recenti (oggi 96.369 concluse negli ultimi 400 giorni: ~16.400 fuori, tutte successive al 25/09/2026). Il caricamento a chiave esiste ma non è attivato. Correzione operativa solo dopo autorizzazione e dopo l'esperimento A.
2. **Nomi delle migrazioni**: i file in `supabase/migrations/` hanno prefissi `2026111xxxx01`, la cronologia remota usa timestamp (es. `20261118065243`). Il contenuto coincide ma i numeri no: prima di usare `supabase db push` serve allinearli (non fatto).
3. Quote di chiusura di bookmaker non identificato; nessuna quota al momento della previsione; rigioco Elo+forma senza statistiche di servizio/H2H/ranking; l'«affidabilità alta» operativa non è riproducibile (ITF/Challenger valutati solo nella simulazione A*).
4. 2.613 partite WTA restano «Challenger/ITF non distinto» (2,7%).
5. Il filtro ITF a 8 punti valuta solo il lato pronosticato dal modello, non quello scelto dallo Strategy Center.

## 4. In attesa di verifica Supabase
Nulla di bloccante. Verifiche remote eseguite in sola lettura (migrazione, schema, RLS, policy, trigger, ACL, cronologia migrazioni, conteggi: 12.045 giocatori, 96.369 partite concluse in 400 giorni, 0 chiavi duplicate, 775 orari condivisi da più partite, 305 righe in `tennis_itf_shadow`). Non verificabile con le risorse disponibili: rilancio dell'audit sui dati reali (richiede il workflow GitHub con i secret).

## 5. Esperimenti in Shadow Mode
- Filtro ITF 8 punti: in registrazione prospettica su `tennis_itf_shadow` (non modifica BET né probabilità).
- Esperimento A (nell'audit, solo lettura): storico congelato a 80.000 contro storico completo, sulle stesse partite: probabilità, scarto dal mercato, Brier/ECE, **deriva di rating Elo e forma**, selezioni.
- Simulazioni retrospettive A / A* / B (stesse partite, stessa finestra): A = tutte le regole operative riproducibili sulla probabilità rimodulata; A* = senza il requisito «alta» per ITF/Challenger; B = solo quota ed EV minimi. Intervalli per blocchi torneo-settimana.

## 6. Risultati precedenti (v1/v2, da rimpiazzare dopo il rilancio)
Valgono come **indicazioni**, non come prove: regressione in-sample con errore standard che assume osservazioni indipendenti (c = 0,023 ± 0,016), simulazione con soli filtri di quota ed EV (147 selezioni, ROI +0,8%) **senza** il controllo sullo scarto dal mercato. Un ROI positivo non è prova di vantaggio: l'intervallo comprendeva lo zero. Risultati che restano solidi perché non dipendono da quelle scelte: Brier del modello peggiore del mercato in ogni fascia; sovrastima degli sfavoriti (quote 5–10: previsto 29,6%, reale 8,9%) e sottostima dei grandi favoriti; le 869 selezioni con le regole attuali perdono in media (ROI ≈ −18% sulle quote di chiusura); il filtro ITF 8 punti non migliora il ROI (mantenute −30,6%, escluse −25,3%).

## 7. Non autorizzato per la produzione
Collegare `_tennis-strategy2.js` o `_tennis-history.js` al motore; attivare classi A/B/C/D; pubblicare strategie; cambiare il limite di `loadHistory`; scritture o migrazioni sul database remoto; modifiche a secret e credenziali. Serve un'autorizzazione esplicita successiva.

## 8. Decisioni tecniche
- Coefficienti **in-sample** (diagnostici) separati da quelli **walk-forward** (ogni mese adattato solo ai mesi precedenti; categorie con almeno 300 partite di addestramento; mai dati del mese valutato). La prova che il modello aggiunge informazione è la riduzione di log loss out-of-sample (mercato ricalibrato → mercato + modello), con intervallo bootstrap per blocchi torneo-settimana e correzione di Holm sulle categorie.
- Strategy2: evidenza per categoria con errore standard = il maggiore tra indipendente e robusto, almeno 50 blocchi; soglie a priori (z 2,58 per B, 3,29 per A) fissate **prima** di vedere i risultati su dati reali; senza prova la classe massima è C; zero selezioni è un esito ammesso.
- Doppie: solo con due singole A/B non correlate, probabilità congiunta ≥ 30%, EV ≥ 8%, migliori delle singole.
- Il caricamento storico a chiave (starts_at, match_key) sostituisce l'offset nell'audit; fallisce se supera il limite di sicurezza.

## 9. File di questo lavoro
Nuovi: `functions/api/_tennis-strategy2.js`, `functions/api/_tennis-history.js`, `scripts/tennis-strategy-audit.js`, `.github/workflows/tennis-strategy-audit.yml`, `tests/tennis-strategy-audit.test.js`, `tests/tennis-history.test.js`, `supabase/migrations/202611180001_tennis_itf_shadow.sql`, questo documento. Modificati: `scripts/tennis-sync.js` e `tests/tennis-sync.test.js` (correzione refresh). Invariati: motore, strategie operative, calcio (le modifiche al log loss sono dell'utente).

## 10. Prossimo passo preciso
Pubblicare questi file su `main`, lanciare a mano il workflow «Tennis — audit Strategy Center» e leggere, in ordine: (1) «VALUTAZIONE OUT-OF-SAMPLE» (intervallo dell'informazione aggiunta), (2) simulazioni A / A* / B, (3) Esperimento A con la deriva dei rating. Solo dopo decidere se proporre l'attivazione del caricamento completo dello storico in Shadow Mode.
