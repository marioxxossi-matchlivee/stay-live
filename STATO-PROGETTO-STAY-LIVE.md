# STATO-PROGETTO-STAY-LIVE.md

**Documento di continuità tecnica --- Stay Live**\
**Aggiornato al:** 25 novembre 2026 (sezione 0b), 23 novembre 2026 (sezione 0); le sezioni 1–11 descrivono lo stato del 17 novembre 2026\
**Scopo:** permettere a una nuova sessione di Claude o a un altro
assistente tecnico di riprendere il lavoro senza ripetere inutilmente le
analisi e senza modificare aree non coinvolte.

------------------------------------------------------------------------

## 0. Aggiornamento del 23 novembre 2026

Fonti: repository, workflow e database Supabase letto in sola lettura. Quanto non è verificabile da qui è indicato.

**Calcio: snapshot a blocchi (sezioni 4–6).** I file della patch sono presenti nella repository (`functions/api/_snapshot.js`, `scripts/full-refresh.js`). I workflow `aggiornamento-completo.yml` e `recupero-aggiornamento.yml` leggono la variabile di repository `SNAPSHOT_CHUNKS_ENABLED` con valore predefinito `false`. Nel database `app_snapshot` risultano **23 righe `fixtures:chunk:…` aggiornate il 23/11/2026**: la modalità a blocchi risulta quindi in uso (inferenza dai dati; il valore della variabile non è leggibile da qui). **Non verificabile da qui:** se i timeout `57014` si siano ripetuti dopo il 17/11 (i log PostgreSQL non sono interrogabili); finché non è verificato, non dichiarare il problema risolto.

**Tennis.** Il modello operativo è `tennis-v2`; il caricamento storico attivo è OFFSET (80.000 partite, ultima del 25/09/2026); KEYSET è predisposto ma non attivo; Strategy Center 2.0 è sperimentale e isolato; la Shadow Mode confronta modalità di caricamento dello storico e non è un nuovo modello. **LIVE OBSERVATION è attiva** (registro prospettico: valutazione iniziale immutabile e revisioni separate); i risultati sono ancora da validare (campione insufficiente). Dettagli, tabella dei due registri prospettici («Dal vivo» e LIVE OBSERVATION) e stato delle migrazioni: `docs/TENNIS-STRATEGY-CENTER-2.0-ROADMAP.md`, sezione «Stato operativo al 23/11/2026».

**Interfaccia.** Il blocco del pinch-to-zoom e del doppio tocco in `index.html` è una **scelta intenzionale del proprietario**: non rimuoverlo. La sezione Strategia è un cruscotto statistico (Panoramica, ATP · WTA, Superfici, Calibrazione, Integrità) con la scheda «Stato del sistema».

**CONTINUOUS LEARNING (24/11/2026).** Nuova sezione in Affidabilità (tennis) e nel monitor (calcio): diagnostica dei modelli e laboratorio sperimentale, isolati e osservativi. Non attivata in automatico, non eseguita sui dati reali (report segnaposto), nessuna modifica a motori, workflow, database. Vedi `docs/CONTINUOUS-LEARNING.md`.

**Test (esecuzione del 24/11/2026):** `npm test` (`node --test`) → **638 test eseguiti, 638 superati, 0 falliti, 0 saltati** (esecuzione del 24/11/2026, dopo l'aggiunta di CONTINUOUS LEARNING); `npm run build` (`vite build`, Vite 7.3.8) → riuscita, 61 moduli trasformati, nessun avviso. La build è stata eseguita dopo `npm install` (Vite ^7 come da `package.json`, senza lockfile).  Il «403/403» della sezione 11 è un dato del 17/11 e non è stato rieseguito come tale.

------------------------------------------------------------------------

## 0b. Motore calcio — aggiornamento del 25 novembre 2026

**Obiettivo unico del lavoro: migliorare la qualità dei pronostici generati** (non il rendimento delle scommesse). Ogni partita ha un pronostico giocabile; il verdetto BET/EVITA resta come informazione ma non decide più il pronostico mostrato.

**Perimetro mercati:** 1X2, doppia chance e Multigol (`MARKET_SCOPE = "1x2+dc"`).

**Modifiche in `functions/api/model.js`**
- Pesi di fusione: storico 0,10 · API-Football 0,05 · mercato 0,85 (prima 0,25 · 0,40 · 0,35). Motivo: su 2.634 partite con quote reali di football-data (22 campionati, 31/07–23/11/2026) il Brier 1X2 migliora al crescere del peso del mercato (0,597 con 58%, 0,5895 con 87%; solo mercato 0,588; solo storico 0,629). **API-Football:** sulle 958 partite concluse con tutte e tre le fonti registrate (`prediction_leg_results`, 7–26/11/2026) la combinazione migliore è il solo mercato (Brier 0,5716; col peso 0,25 sarebbe 0,5869, con 0,05 0,5747). Le percentuali 1X2 del provider sono molto distorte: al pareggio assegnano in media il 44,5% (reale 21,2%), alla vittoria in casa il 28,5% (reale 46,2%); Brier 0,703, peggio di una stima uniforme (0,667). Per questo il peso è minimo. Nota: il confronto BET usa ancora il «contraddice» del provider (`afAgree`/`afContrast`), che con percentuali così distorte può bloccare BET validi; non tocca il pronostico.
- `pick` = pronostico: esito più probabile tra 1X2 e doppia chance con quota di riferimento > 1,3 (reale; se manca, quota equa / (1 + `bookMargin`)). Se l'esito migliore con quota sufficiente ha probabilità < 0,40 si tiene il più probabile in assoluto e si segnala `lowOdds`. Parametri `forecastMinOdds`, `forecastMinP` (inclusi nella versione del modello).
- Modello NEW collegato (26/11/2026): il pronostico storico di 1X2 e doppia chance usa Dixon-Coles + Platt per mercato (`calibrateStorico`, parametri in `functions/api/_newmodel-params.js` generati da `scripts/backtest-new-model.js` su 6.334 partite, 21/08–25/11/2026). Fuori campione (confronto a coppie, blocchi settimanali, 6.006 partite) migliora il Brier di 0,0028 (IC 95% +0,0005/+0,0047) e il log loss di 0,0038; il pronostico azzeccato +1,3 punti non è significativo. Rho instabile (−0,15/−0,03/0 nei tre mesi). Col mercato disponibile (peso 0,85) l'effetto è minimo; conta nei campionati senza quote. Senza `fittedOn` nei parametri la funzione non fa nulla (si disattiva rigenerando il file con parametri vuoti). La versione del modello include i parametri. I parametri vanno rigenerati periodicamente con il workflow «Backtest nuovo modello» (`--write-params`).
- CONTINUOUS LEARNING: `continuous-learning-manual.yml` ora parte anche ogni lunedì alle 06:00 UTC (oltre che a mano); resta in sola lettura, nessun commit né scrittura, e conserva `report.json` come artifact per 30 giorni. I test di isolamento ammettono solo questo workflow.
- Snapshot a blocchi: verificato in sola lettura che è già attivo in produzione (19 righe `fixtures:chunk:*` più manifest, ultimo aggiornamento 26/11/2026 03:36 UTC, circa 0,9 MB complessivi). Nessuna azione.
- `betPick` = scelta storica per valore (BET/EVITA), mantenuta per i backtest di affidabilità.
- Test aggiornati: `tests/brain.test.js` (ordine dei pesi, nuovo test `forecastPick`), `tests/backtest-evita.test.js` (confronto con `betPick`).

**Esito del confronto (stesse 2.634 partite):** pronostico azzeccato nel 65,4% dei casi, quota media 1,50, dichiarato 62,6% (prudente). Solo statistico su 9.927 partite: reale 64,4%, dichiarato 63,9%. Nessuna regola di scelta batte il margine del bookmaker (ROI ≈ −5%): le quote di doppia chance del test sono ricavate dall'1X2, non reali.

**Limiti e punti aperti**
- Il test con quote riguarda solo i campionati principali presenti su football-data.co.uk; gli altri 50 campionati non hanno quote storiche.
- Multigol (verificato il 26/11 su 8.175 partite fuori campione): le fasce mostrate nell'app usano Poisson sui gol attesi e sono già calibrate entro circa 1,5 punti (fascia 1-3: 62,4% dichiarato, 61,1% reale); la scelta della fascia migliore azzecca il 62,0% contro il 63,9% dichiarato. La binomiale negativa e un fattore di scala sui gol attesi non migliorano il Brier in modo apprezzabile: nessuna modifica. Il Multigol non ha quote storiche. Le non-calibrazioni di MG 1-3/1-4 viste nel report riguardano il modello NEW, non attivo.
- Pareggio: la sovrastima (24,9% previsto, 23,9% reale su 9.927 partite) non è stabile nel tempo (novembre 21,2%) e la correzione non migliora la prima metà del campione; con il peso 0,85 al mercato l'effetto è minimo: nessuna modifica.
- Un test fallisce già prima di questo lavoro (`tests/learning-ui.test.js`, «stati»: nel repository c'è un `public/learning/report.json` e la vista non mostra lo stato «nessun report generato» atteso) e non riguarda il motore. I due test di isolamento di CONTINUOUS LEARNING ora passano.
- Il workflow `esporta-finals.yml` esporta `finals.json` (sola lettura).

## 1. Contesto del progetto

Stay Live è un'applicazione di pronostici e analisi sportive, con
funzionalità per calcio e tennis. Il progetto utilizza una repository
GitHub, workflow GitHub Actions, funzioni Cloudflare Pages e Supabase
per la persistenza dei dati.

Il proprietario del progetto lavora spesso da smartphone e applica le
modifiche tramite GitHub e Claude. Le istruzioni operative devono quindi
essere precise, ordinate e adatte anche a un flusso di lavoro mobile.

## 2. Problema tecnico oggetto dell'ultimo intervento

È stato osservato un errore durante il salvataggio dello snapshot dei
dati in Supabase.

Nei log PostgreSQL è stato rilevato un evento:

-   **Data/ora:** 17 novembre 2026, 19:40:53 UTC.
-   **Errore:** `57014 canceling statement due to statement timeout`.
-   **Operazione coinvolta:** `INSERT ... ON CONFLICT DO UPDATE` sulla
    tabella `public.app_snapshot`.
-   **Contesto:** il refresh costruiva un payload completo e lo salvava
    in un'unica riga della tabella.

La tabella `app_snapshot` conteneva, al momento delle verifiche, tre
righe. Lo snapshot identificato come `fixtures` conteneva circa 610
partite. Il JSON serializzato era di circa 2,53 MB; la dimensione JSONB
memorizzata era di circa 1,16 MB.

Questi dati descrivono quanto osservato durante l'analisi: non
dimostrano da soli che la dimensione sia l'unica causa del timeout. Il
timeout è stato rilevato nei log; la patch a blocchi è una mitigazione
architetturale da verificare in produzione, non una soluzione già
dimostrata.

### Distinzione da altri errori

In una precedente esecuzione del refresh tennis era stato segnalato
anche un errore HTTP 502 del provider. È un problema distinto dal
timeout Supabase sullo snapshot e non va considerato automaticamente
risolto dalla patch descritta qui.

## 3. Verifiche già effettuate

Durante l'analisi sono state eseguite verifiche in sola lettura sul
database e sulla repository.

Risultati rilevanti:

-   La tabella `app_snapshot` aveva una struttura semplice, con `id`
    come chiave primaria.
-   Non sono stati rilevati trigger sulla tabella durante l'ispezione.
-   Il refresh completo costruiva il payload tramite
    `buildFixtures(env)`.
-   Il vecchio flusso salvava l'intero payload nella riga
    `id='fixtures'`.
-   L'endpoint `/api/board` leggeva e restituiva lo snapshot completo.
-   Il client in `src/main.js` si aspettava un oggetto con
    `payload.matches`.
-   È stato osservato un evento di statement timeout nei log
    nell'intervallo controllato. Questo non consente di affermare che
    sia stato l'unico errore o che ogni precedente fallimento abbia la
    stessa causa.

Le query diagnostiche eseguite in sola lettura non hanno modificato i
dati di produzione. Non sono state applicate modifiche allo schema o
scritture di produzione durante la preparazione della patch.

## 4. Patch preparata: snapshot a blocchi

È stata preparata una patch che suddivide l'array `matches` in blocchi,
mantenendo la tabella `app_snapshot` esistente e senza richiedere
migrazioni SQL.

### Nuovo formato

-   Le partite vengono divise in blocchi da **40 elementi**.
-   Ogni blocco viene salvato in una riga con ID nel formato:
    `fixtures:chunk:<version>:0000`
-   La riga `id='fixtures'` diventa il **manifest**: conserva gli altri
    campi principali del payload e contiene `matches: []`.
-   Nel manifest viene inserito `meta.snapshotStorage` con i metadati
    del formato, tra cui versione, numero di blocchi, numero di partite
    e dimensione dei blocchi.
-   I blocchi vengono scritti prima del manifest.
-   Il manifest viene pubblicato per ultimo: in questo modo il client
    continua a fare riferimento alla versione precedente finché la nuova
    versione non è pronta.
-   Dopo la pubblicazione del nuovo manifest viene effettuata la pulizia
    dei blocchi della versione precedente.
-   Il client scarica i blocchi e ricostruisce `payload.matches`, così
    da mantenere la forma dati attesa dalle schermate esistenti.
-   I vecchi snapshot senza `snapshotStorage` continuano a seguire il
    percorso legacy.

### File inclusi nella patch

La patch ZIP preparata contiene esclusivamente file nuovi o modificati:

-   `.github/workflows/aggiornamento-completo.yml`
-   `.github/workflows/recupero-aggiornamento.yml`
-   `CHANGELOG-DEBUG.md`
-   `README.md`
-   `ISTRUZIONI-SNAPSHOT-A-BLOCCHI.md`
-   `functions/api/_snapshot.js`
-   `functions/api/board.js`
-   `functions/api/board-chunks.js`
-   `scripts/full-refresh.js`
-   `src/main.js`
-   `src/snapshot.js`
-   `tests/board-chunks.test.js`
-   `tests/refresh-e2e.test.js`
-   `tests/snapshot.test.js`

**Nome del pacchetto preparato:** `STAY-LIVE-SNAPSHOT-BLOCCHI-PATCH.zip`

La patch è stata preparata e verificata come archivio ZIP integro. Non è
stata caricata su GitHub e non è stata distribuita su Cloudflare da
questo intervento.

## 5. Attivazione controllata: variabile GitHub Actions

La nuova modalità è protetta dalla variabile di repository:

`SNAPSHOT_CHUNKS_ENABLED`

Valori:

-   `false`: modalità legacy, snapshot in una sola riga.
-   `true`: modalità snapshot a blocchi.

Nei workflow il valore predefinito è `false`. Questo evita che un
workflow pianificato inizi a scrivere snapshot a blocchi prima che il
nuovo client sia stato pubblicato.

### Sequenza obbligatoria

1.  Applicare alla repository i file contenuti nella ZIP, mantenendo
    esattamente i percorsi.
2.  Pubblicare le modifiche sul branch utilizzato da Cloudflare Pages.
3.  Attendere che il deploy Cloudflare Pages risulti completato con
    successo.
4.  Aprire GitHub: **Settings → Secrets and variables → Actions →
    Variables**.
5.  Creare la variabile repository:
    -   Name: `SNAPSHOT_CHUNKS_ENABLED`
    -   Value: `true`
6.  Aprire **Actions** e avviare manualmente una sola esecuzione di
    **Aggiornamento completo**.
7.  Esaminare il report prodotto dal workflow.

**Non impostare `true` prima del completamento del deploy Cloudflare
Pages.** Con la modalità a blocchi attiva, il manifest contiene
`matches: []`; il client aggiornato deve quindi essere già online per
scaricare e ricomporre i blocchi.

Non sono previste migrazioni SQL per questa patch.

## 6. Criteri per verificare il risultato

Nel report del primo aggiornamento completo in modalità a blocchi
controllare:

-   `meta.verify.ok` deve essere `true`.
-   `chunksFound` deve coincidere con `chunksExpected`.
-   Il numero di partite ricostruite deve essere coerente con
    `matchCount`.
-   L'app deve mostrare correttamente le partite e i relativi dati.
-   Nei log Supabase non devono ripresentarsi errori di statement
    timeout durante la pubblicazione dello snapshot.

La presenza di `verify.ok=true` dimostra che la verifica prevista dal
workflow è passata; non dimostra da sola che ogni schermata dell'app
funzioni correttamente. Va effettuato anche un controllo pratico
dell'app.

Se il timeout si ripresenta, non aumentare automaticamente
`statement_timeout` e non introdurre modifiche al database senza una
nuova diagnosi basata sui log e sul codice effettivamente distribuito.

## 7. Test e limiti della verifica locale

Dopo le modifiche della patch:

-   `npm test`: **403 test superati, 0 falliti**.
-   `node --check` sui file JavaScript modificati: superato.
-   `npm run build`: **non verificato**. Il comando non è riuscito
    perché nell'ambiente usato per il controllo non era installato Vite
    (`vite: not found`).

Non dichiarare quindi che la build sia stata completata con successo.
Dopo aver applicato la patch in un ambiente con le dipendenze
installate, eseguire almeno:

``` bash
npm install
npm test
npm run build
```

Se il progetto utilizza un lockfile e una procedura di installazione
riproducibile, preferire il comando coerente con la repository (ad
esempio `npm ci`) invece di modificare inutilmente il lockfile.

## 8. Stato crediti API-Football

Il controllo dei crediti API-Football è già stato verificato
dall'utente:

-   L'app mostrava **4221 crediti utilizzati**.
-   Il pannello API-Football mostrava **56%** e, nei dettagli, **4221
    crediti utilizzati**.
-   I due valori coincidevano.

**Non riaprire il debugging del calcolo dei crediti e non modificare
questa parte**, salvo che l'utente segnali un nuovo problema concreto.

## 9. Aree da non modificare senza richiesta esplicita

Questa patch riguarda esclusivamente il salvataggio e il caricamento
dello snapshot. Non deve diventare un pretesto per riscrivere altre
parti del progetto.

Non modificare senza una richiesta specifica:

-   Strategie e criteri di selezione dei pronostici.
-   Modelli, percentuali, probabilità e logiche di scoring.
-   Quote e logiche di acquisizione delle quote.
-   Provider/API tennis o calcio, endpoint, chiavi e configurazioni.
-   Sistema di conteggio e visualizzazione dei crediti API-Football.
-   UI/UX e navigazione, se non necessario per correggere un problema
    direttamente causato dalla ricostruzione dello snapshot.
-   Tabelle, policy, permessi o configurazioni Supabase non necessarie
    alla patch.

Non eseguire scritture o modifiche dirette al database di produzione
senza autorizzazione esplicita dell'utente.

## 10. Prossime attività

Ordine di lavoro raccomandato:

1.  Applicare la ZIP alla repository.
2.  Verificare il deploy Cloudflare Pages.
3.  Attivare `SNAPSHOT_CHUNKS_ENABLED=true`.
4.  Eseguire manualmente **Aggiornamento completo**.
5.  Analizzare il report e controllare `verify.ok`, `chunksFound` e
    `chunksExpected`.
6.  Aprire l'app e verificare che le partite siano presenti e complete.
7.  Controllare i log Supabase per eventuali nuovi timeout.
8.  Solo dopo questi controlli, dichiarare se la mitigazione ha risolto
    il problema o se serve un'ulteriore indagine.

## 11. Istruzioni per Claude nella prossima sessione

Prima di modificare il codice:

1.  Leggi questo documento per intero.
2.  Esamina la repository **nello stato attuale**, perché potrebbero
    essere già state applicate altre modifiche dopo la creazione di
    questo documento.
3.  Controlla se la patch snapshot a blocchi è stata applicata,
    distribuita e attivata. Non presumere che sia già successo.
4.  Confronta i file effettivi con le modifiche descritte qui.
5.  Chiedi o verifica i report più recenti prima di dichiarare risolto
    il timeout.
6.  Non ripetere controlli già documentati se non sono necessari; non
    dare però per attuali dati che potrebbero essere cambiati.
7.  Mantieni l'intervento circoscritto al problema richiesto e proteggi
    le aree elencate nella sezione 9.
8.  Non effettuare modifiche di produzione o al database senza
    autorizzazione esplicita.

### Stato sintetico da cui ripartire

**Patch preparata, non ancora dichiarata operativa in produzione.**\
I test automatici eseguiti sulla patch sono passati (403/403), ma la
build non è stata verificata nell'ambiente disponibile perché mancava
Vite. Restano da applicare i file, completare il deploy Cloudflare,
attivare la variabile GitHub e verificare il primo refresh reale.

------------------------------------------------------------------------

*Questo documento registra lo stato noto al 17 novembre 2026.
Aggiornarlo dopo l'attivazione e la verifica in produzione, riportando i
risultati effettivi e la data.*
