# Tennis Strategy Center 2.0 — Roadmap e registro di lavoro

Ultimo aggiornamento: 19/11/2026 (Shadow Mode eseguita; interruttore del loader, monitoraggio, audit v5 e progetto di validazione prospettica predisposti). Si lavora direttamente su `main`, per scelta dell'utente.
**Stato generale: SPERIMENTALE E ISOLATO.** Nessuna classe A/B/C/D è attiva in produzione; `_tennis-strategy2.js` e `_tennis-history.js` non sono importati dal motore (lo verificano test dedicati; `_tennis-history.js` è usato solo dall'audit e dalla Shadow Mode, entrambi in sola lettura). Nessuna scrittura o migrazione remota da questo lavoro. Se non emerge un'evidenza statisticamente robusta, il comportamento corretto è l'astensione.


## 0. Stato del caricamento storico (19/11/2026) — leggere per primo
| Livello | Stato |
|---|---|
| Loader keyset `(starts_at, match_key)` | **Testato** (20 test su dati sintetici, fino a 96.400 righe: nessuna perdita/duplicazione, orari uguali, pagina vuota/incompleta, errori, chiave o data mancanti, cursore fermo, limite di sicurezza che fallisce). Rafforzato il 19/11: nuovi tentativi opzionali, errore con numero di pagina, rilevamento di pagine di sole righe già lette, confronto dei `match_key` lasciato al database (la collazione può differire dall'ordine di JavaScript). |
| Shadow Mode OLD/NEW | **Eseguita sul database reale il 19/11/2026** (istantanea 09:11 UTC; script `scripts/tennis-history-shadow.js`, workflow manuale «Tennis — Shadow Mode storico»). Risultati in §6b. Resta una misura in sola lettura: nessun effetto sul motore. |
| Motore operativo | **Invariato.** `loadHistory` (offset, 80 pagine × 1.000) è ancora il percorso usato da `runRefresh` e `runStatic` (pronostici e calibrazione). `scripts/tennis-sync.js` non è stato modificato. |
| Attivazione in produzione | **Non decisa.** Richiede una decisione separata ed esplicita. |
| Interruttore del loader in `tennis-sync.js` | **Predisposto, spento.** `TENNIS_HISTORY_LOADER=keyset` attiva il caricamento completo; senza variabile (o con qualunque altro valore) resta l'OFFSET di oggi. Nessun workflow imposta la variabile. Rollback = togliere la variabile. Verificato con test (default invariato, 80.000 vs 96.500 righe sintetiche, errore esplicito senza `fetchPage`). |

Flusso: Provider → `fetchResults`/`fetchUpcoming`/`saveMatches` (tennis-sync.js) → `tennis_matches` → `loadHistory` (offset, tetto 80.000, silenzioso) → `buildBook` (`RatingBook.update`) → `computePredictions` (`predictMatch`: Elo, forma) → `tennis_predictions` / snapshot → `/api/tennis-board`. `runStatic` usa lo stesso `loadHistory` per backtest e calibrazione (`tennis_snapshot` id `backtest`), che alimenta il calibratore usato dal refresh: il troncamento tocca quindi anche la calibrazione.

Altri limiti a pagine fisse in `tennis-sync.js`, **non corretti e non verificati sui conteggi reali** (fuori ambito): `tennis_players` 40 pagine (40.000; oggi 12.045 righe), partite programmate 12 pagine, statistiche giocatori 20 pagine, predizioni storiche per la snapshot 12 pagine (12.000), storico strategie 10 pagine. `supabaseGetAll` pagina per offset e, quando raggiunge il tetto, si ferma senza errore; le query senza `order` non hanno ordine deterministico.

## 0b. Risultati dell'audit del 19/11/2026 (v4, dati reali, lanciato dall'utente) — conservati
Il modello Elo+forma **non aggiunge informazione al mercato** (Δ log loss fuori campione −0,0001 [−0,0003; +0,0001], 36.112 partite); regole attuali ROI −23,2% su 11.204 selezioni (quote di chiusura); classi A/B/C/D quasi tutte D (astensione); filtro ITF 8 punti non supportato. Con lo storico troncato: 823 giocatori sconosciuti, scarto Elo medio 55 punti, Brier 0,2143 → 0,2102 con lo storico completo (miglioramento rispetto all'OLD, **non** rispetto al mercato, che resta migliore). Margine delle quote ≈ 8,7% costante, nessuna fuga dell'esito su 1.053 partite recenti. Limiti: quote di sola chiusura, rigioco senza statistiche di servizio/H2H/ranking. (Numeri riportati dai risultati dell'esecuzione dell'utente; questo documento in repo non li conteneva.)


## 0c. Fase successiva (19/11/2026): stato per livello
**Funzioni operative (invariate):** probabilità, segnali, strategie, classi, soglie, API e calcio; `loadHistory` resta a OFFSET (80.000) per impostazione predefinita. L'unica modifica nel file operativo è l'interruttore spento e il campo diagnostico `historyLoader` nei metadati del job.

**In Shadow Mode / sola lettura:**
| Funzione | Stato |
|---|---|
| Confronto OLD/NEW (`tennis-history-shadow.js`) | Eseguito sui dati reali il 19/11 (§6b). |
| Monitoraggio storico (`tennis-history-monitor.js`, workflow giornaliero 05:40 UTC + manuale) | **Scritto e testato su dati sintetici; non ancora eseguito.** Segnala INCOMPLETO (il workflow fallisce) o ATTENZIONE: errori di paginazione, troncamento, righe diverse dal conteggio del database, duplicati, righe senza vincitore valido, buchi oltre 7 giorni, ultima data oltre 48/120 ore, giocatori sconosciuti in programma, seconda lettura diversa, percorso operativo ancora a OFFSET. |
| Audit v5 (`tennis-strategy-audit-v5.js`, workflow manuale) | **Scritto e testato su dati sintetici; NON ancora eseguito sui dati reali: nessun risultato v5 esiste.** OLD (congelato)/NEW/mercato sulle stesse partite dopo il limite; per categoria, superficie, fasce di probabilità e di quota; bootstrap a blocchi torneo-settimana (1.000 ripetizioni, seme fisso); Holm su tutti i gruppi con almeno 300 partite; stato di ogni classe A/B/C/D; controllo empirico di indipendenza per le doppie. |
| Validazione prospettica (`docs/VALIDAZIONE-PROSPETTICA-TENNIS.md`, `scripts/tennis-prospective-record.js`) | **Solo progetto e controlli locali.** Nessuna tabella, nessuna migrazione, nessuna scrittura. |

**Non validate:** classi A/B/C/D (nessuna promossa: lo stato «validata» richiede ≥ 300 selezioni, ≥ 50 blocchi e Δ log loss contro il mercato con intervallo > 0; C non lo è per definizione; il ROI non conta); doppie (`evaluateDouble` ora dichiara `validated: false`, `independenceAssumed: true` e la limitazione: il prodotto delle probabilità presuppone indipendenza, mai dimostrata; tornei diversi non la provano); Strategy Center 2.0 nel suo insieme.

**Riferimento reale già disponibile (19/11, §6b):** NEW migliora l'OLD (Brier 0,2142 → 0,2102 sulle 6.750 con quote di chiusura) ma resta peggiore del mercato (0,1765). Nessun intervallo di confidenza era stato calcolato su quei numeri: lo calcola l'audit v5.

**Verifiche ancora necessarie:** esecuzione reale di monitoraggio e audit v5; intervalli e Holm sui gruppi reali; ricontrollo della dimensione del campione prospettico con l'errore standard reale; verifica dei limiti a pagine fisse di `tennis_players`, programma, statistiche e predizioni (§0).

**Richiedono autorizzazione separata:** attivazione di `TENNIS_HISTORY_LOADER=keyset` in produzione (cambia le probabilità e, nella misura del 19/11, dimezza i BET); creazione di qualunque tabella/ruolo/job per la validazione prospettica; qualsiasi promozione di classi o doppie.

**Test (19/11/2026):** 533 eseguiti, 533 superati, 0 falliti, 0 saltati (480 di riferimento + loader 7 + Shadow Mode 13 + interruttore 6 + monitoraggio 7 + audit v5 13 + prospettico 5 + test già presenti nella nuova repository). Il numero comprende anche i test del calcio e del nuovo modello presenti nella repository caricata.

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
| Suite completa `node --test` | 19/11/2026 prima delle modifiche: 480/480. Dopo la Shadow Mode: 500/500; **dopo la fase successiva: 533/533 (vedi §0c)** (+7 test sul loader, +13 sulla Shadow Mode; test preesistenti non rimossi). Il calcio non è toccato |

## 2. Implementato ma NON ancora validato su dati reali
- Il report dell'audit **con la metodologia corretta** (v3): non è ancora stato lanciato sul database reale. Tutti i numeri del primo e del secondo audit (vedi §6) usavano una versione precedente e vanno rimpiazzati dopo il rilancio.
- Classi A/B/C/D e doppie (`_tennis-strategy2.js`): comportamento verificato su dati sintetici (su solo rumore la classe A non compare mai e A+B restano rare), non su dati reali.

## 3. Da correggere / problemi aperti
1. **`loadHistory` operativo ancora a 80 pagine** (la Shadow Mode per misurarne l'effetto sui dati reali è pronta ma non lanciata) (`scripts/tennis-sync.js`): **NON corretto**. Pagina per offset, si ferma in silenzio a 80.000 righe ed esclude le partite più recenti (oggi 96.369 concluse negli ultimi 400 giorni: ~16.400 fuori, tutte successive al 25/09/2026). Il caricamento a chiave esiste ma non è attivato. Correzione operativa solo dopo autorizzazione e dopo l'esperimento A.
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

## 6b. Shadow Mode del caricamento storico: uso e disattivazione
- Avvio: GitHub → Actions → «Tennis — Shadow Mode storico» → `shadow` = on. Solo manuale, nessuna programmazione. Legge `tennis_matches` e le tabelle di programma/ranking/statistiche in **sola lettura** (nessun provider sportivo, nessuna scrittura, nessuna migrazione); l'esito è nel riepilogo dell'esecuzione e nell'artifact `tennis-history-shadow`.
- Disattivazione: `shadow` = off, oppure non lanciare il workflow (lo script senza `TENNIS_HISTORY_SHADOW=on` esce subito senza leggere nulla). Non c'è nulla da annullare: il motore non è collegato.
- Confronto: OLD = prime 80.000 righe nello stesso ordine (verificato contro il vero `loadHistory` nella stessa esecuzione); NEW = caricamento a chiave completo; stesso `buildBook`, stesse formule. Il conteggio è letto dal database all'esecuzione (nessun numero fisso). Indicatori: righe, concluse valide, duplicati, prima/ultima data, giocatori distinti e sconosciuti, Elo e forma medi e scarti, probabilità sulle partite in programma (non pubblicate), Brier/ECE/log loss sulle partite perse dall'OLD (rating congelati contro aggiornati, ordine per giorno senza look-ahead), confronto con il mercato su quote di chiusura, riproducibilità (due letture).
- **Risultati reali (esecuzione del 19/11/2026, riportati dall'utente):**
  - Caricamento a chiave: 96.489 righe in 97 pagine, 0 duplicati, non troncato, coincide col conteggio del database; secondo caricamento identico (righe, rating, valutazione). L'OLD reale (`loadHistory`) coincide con le prime 80.000 righe: 80.000 partite, ultima del 25/09/2026.
  - Perse dall'OLD: 16.489 partite (17,1%), tutte successive al limite. Giocatori distinti 10.975 → 11.798; sconosciuti all'OLD: 823 su 6.003 attivi dopo il limite e 3 su 304 in programma (0 con NEW).
  - Elo: scarto assoluto medio 28,0 su tutti i giocatori, 55,1 su quelli attivi dopo il limite (90° percentile 112; 23,1% oltre 50 punti). Forma: scarto medio 0,065.
  - Probabilità sulle 152 partite in programma (75 pubblicate da entrambi, nulla pubblicato né scritto): scarto medio 4,7 punti (90° perc. 12,1; max 21,7); pronostico cambiato 2; verdetto BET/EVITA cambiato 8; BET 8 (OLD) contro 4 (NEW).
  - Partite perse dall'OLD, stesse partite per OLD/NEW (8.440 confrontabili): Brier 0,2024 → 0,1986, ECE 0,0144 → 0,0093. Sulle 6.750 con quote di chiusura: Brier OLD 0,2142, NEW 0,2102, **mercato 0,1765**; ECE 0,0325 → 0,0126 (mercato 0,0297); accuratezza 67,1% → 67,7% (mercato 72,8%). **Lo storico completo migliora il modello ma resta peggiore del mercato.** Nessun intervallo di confidenza: differenze indicative. Nessun vantaggio sul mercato dimostrato; l'astensione resta il comportamento corretto.
  - Limiti: l'OLD nella valutazione è «rating congelati»; il confronto riguarda solo le partite pubblicate da entrambi (1.566 partite con giocatori sconosciuti all'OLD sono in parte escluse perché l'OLD si astiene); quote di sola chiusura; rigioco senza statistiche di servizio, H2H e ranking.

## 7. Non autorizzato per la produzione
Collegare `_tennis-strategy2.js` o `_tennis-history.js` al motore; attivare classi A/B/C/D; pubblicare strategie; cambiare il limite di `loadHistory`; scritture o migrazioni sul database remoto; modifiche a secret e credenziali. Serve un'autorizzazione esplicita successiva.

## 8. Decisioni tecniche
- Coefficienti **in-sample** (diagnostici) separati da quelli **walk-forward** (ogni mese adattato solo ai mesi precedenti; categorie con almeno 300 partite di addestramento; mai dati del mese valutato). La prova che il modello aggiunge informazione è la riduzione di log loss out-of-sample (mercato ricalibrato → mercato + modello), con intervallo bootstrap per blocchi torneo-settimana e correzione di Holm sulle categorie.
- Strategy2: evidenza per categoria con errore standard = il maggiore tra indipendente e robusto, almeno 50 blocchi; soglie a priori (z 2,58 per B, 3,29 per A) fissate **prima** di vedere i risultati su dati reali; senza prova la classe massima è C; zero selezioni è un esito ammesso.
- Doppie: solo con due singole A/B non correlate, probabilità congiunta ≥ 30%, EV ≥ 8%, migliori delle singole.
- Il caricamento storico a chiave (starts_at, match_key) sostituisce l'offset nell'audit; fallisce se supera il limite di sicurezza.

## 9. File di questo lavoro
Nuovi (19/11, Shadow Mode): `scripts/tennis-history-shadow.js`, `.github/workflows/tennis-history-shadow.yml`, `tests/tennis-history-shadow.test.js`; modificati: `functions/api/_tennis-history.js` (robustezza), `tests/tennis-history.test.js` (aggiunti 7 test; nell'unico test preesistente sugli importatori è stato aggiunto lo script della Shadow Mode all'elenco ammesso, e un nuovo test vieta il collegamento al motore). Precedenti — nuovi: `functions/api/_tennis-strategy2.js`, `functions/api/_tennis-history.js`, `scripts/tennis-strategy-audit.js`, `.github/workflows/tennis-strategy-audit.yml`, `tests/tennis-strategy-audit.test.js`, `tests/tennis-history.test.js`, `supabase/migrations/202611180001_tennis_itf_shadow.sql`, questo documento. Modificati: `scripts/tennis-sync.js` e `tests/tennis-sync.test.js` (correzione refresh). Invariati: motore, strategie operative, calcio (le modifiche al log loss sono dell'utente).

## 10. Prossimo passo preciso
1. Pubblicare questi file su `main` e lanciare a mano «Tennis — Shadow Mode storico» (`shadow` = on).
2. Leggere nel riepilogo: partite perse dall'OLD, giocatori sconosciuti, scarti Elo/forma, probabilità cambiate, Brier/ECE e **verdetto rispetto al mercato**. Se lo storico completo migliora Brier ed ECE ma resta peggiore del mercato, si riporta esattamente così: l'astensione resta il comportamento corretto.
3. Solo dopo, con decisione esplicita separata, valutare se correggere `loadHistory` nel percorso operativo.
