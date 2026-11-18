# Filtro sperimentale ITF «8 punti» — stato del lavoro e report

Aggiornato: 18/11/2026 · Modalità: **SHADOW** (registra, non decide) · Nessun deploy. La migrazione shadow è stata eseguita su Supabase su richiesta esplicita; il ramo principale non è stato toccato da me.

## 1. Situazione iniziale (verificata nel codice)
- Probabilità del modello: `predictMatch` in `_tennis-model.js` (Elo generale/superficie, forma, statistiche servizio/risposta, ranking, scontri diretti, carico, calibrazione Platt). Salvate in `tennis_predictions` (`p1`, `p2`, `pick`).
- Probabilità di mercato: `noVig()` / `pickOdds()` in `_tennis-bet.js`: coppia di quote dello stesso bookmaker (Pinnacle se presente) normalizzata; salvata in `tennis_predictions.bet.implied` per il lato pronosticato.
- Categorie: `classifyCategory()` in `_tennis-provider.js` → `tour`, `challenger`, `itf` (nome tipo M25/W35 o rankId 0), `challenger_itf` (ambigua, mai forzata).
- Filtro attuale (`evaluateBet`): per ogni categoria quota ≥ 1,50, EV ≥ +4%, quote ≤ 3 h, **scarto modello–mercato ≤ 15 punti (valore assoluto, uguale per tutti)**; ITF/Challenger richiedono affidabilità «alta». Non esiste oggi una soglia a 8 punti.

## 2. Problema da verificare
Se, nelle ITF, un modello che supera il mercato di **oltre 8 punti percentuali** (tra 8 e 15 oggi passa) segnali previsioni meno affidabili e BET da evitare. **Non è dimostrato**: è l'ipotesi da misurare.

## 3. Regola implementata (solo shadow)
`DIFFERENZA = P_modello(selezione) − P_mercato(stessa selezione, senza margine)`; **> 8 punti assoluti → «esclusa»** (8 esatto = mantenuta; modello sotto il mercato = mai esclusa). Solo `category === "itf"`: ATP, WTA, Challenger e `challenger_itf` non hanno regola né righe. Quote assenti/non valide/scadute (> 3 h)/partita iniziata/pronostico assente → «non valutabile», mai valori inventati. Le raccomandazioni, i BET, i pronostici e la strategia restano **identici** (verificato dai test).

Per ogni ITF si registra in `tennis_itf_shadow`: id partita, torneo e categoria, probabilità modello, probabilità di mercato, differenza in punti, esito della regola, quote (coppia del bookmaker di riferimento + quota del lato), istante delle quote, verdetto attuale, `would_remove` (BET attuale che il filtro avrebbe tolto). L'esito finale si ricava da `tennis_matches` (non è scritto nella riga). Congelamento come `tennis_predictions`.

## 4. File
**Nuovi:** `functions/api/_tennis-itf-shadow.js` (regola e simulazione, pura) · `scripts/tennis-itf-shadow-report.js` (report, sola lettura) · `supabase/migrations/202611180001_tennis_itf_shadow.sql` · `tests/tennis-itf-shadow.test.js` · questo documento.
**Modificati:** `scripts/tennis-sync.js` (import + un blocco in `runRefresh`, protetto da try/catch, dopo l'upsert dei pronostici; non tocca `rows`) · `tests/tennis-sync.test.js` (un test aggiunto).
**Invariati:** modello, `_tennis-bet.js`, snapshot, frontend, workflow, calcio, crediti API.

`scripts/tennis-sync.js` in questo zip è la versione che contiene già lo Strategy Center più il blocco shadow: va sostituito per intero. La migrazione `202611180001_tennis_itf_shadow.sql` è già stata eseguita su Supabase (insieme a quella dello Strategy Center).

## 5. Test eseguiti
`node --test`: **443 superati, 0 falliti** (403 di base, 24 dello Strategy Center, 16 del filtro ITF; verificato con i due insiemi di file combinati). Coprono: soglia sotto/uguale/sopra, punti assoluti e non relativi, normalizzazione senza margine e stessa selezione (anche lato 2), quote mancanti/non valide/scadute, partita iniziata, ATP/WTA/Challenger/challenger_itf senza righe, `computePredictions` e `evaluateBet` identici con shadow attiva (JSON identico, input non mutati), giro `refresh` con tabella shadow assente (stessi pronostici, stessa snapshot, **stesso numero di richieste API**), assenza di import/chiamate di rete nei moduli, migrazione additiva con RLS e congelamento, simulazione A/B con numeri esatti, esclusione delle quote lette dopo l'inizio, verdetto con campione piccolo.
Non eseguito: `npm run build` (nessuna rete per installare Vite; nessun file del frontend è stato modificato).

## 6. Confronto storico vecchia/nuova strategia — **NON ESEGUITO sui dati reali**
I pronostici e le quote storiche sono nel tuo Supabase di produzione, non nello zip: qui posso solo verificare la logica su dati sintetici. Il confronto è pronto: 
```
SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/tennis-itf-shadow-report.js docs/ITF-SHADOW-REPORT.md
```
(sola lettura, nessuna chiamata al provider, zero crediti). Produce: partite totali, BET, vittorie/sconfitte, successo, ROI con intervallo al 95%, quota media, escluse e loro prestazioni, differenza A/B, affidabilità per fascia di scarto, e la valutazione. Usa solo la versione congelata prima dell'inizio (quote lette dopo l'inizio scartate; ritiri/annullate/in attesa non contati). Limite noto: il «retroattivo» copre solo i pronostici con quote registrate in `tennis_predictions.bet`; prima dell'introduzione delle quote non c'è confronto possibile.

## 7. Problemi aperti
- Eseguire la migrazione (solo dopo tua decisione), far girare qualche giorno di refresh, lanciare il report.
- Per il confronto prospettico servono molte ITF concluse con BET: gli ITF richiedono affidabilità alta, quindi il campione cresce lentamente (minimo 30 per gruppo, escluse e mantenute, prima di qualunque lettura).
- La soglia a 8 punti è un'ipotesi: tra 8 e 15 punti passano oggi sia i BET buoni sia quelli da evitare; il report lo mostra per fasce (≤0, 0–4, 4–8, >8).
- Challenger: gestione separata, non toccata (eventuale studio dedicato più avanti).

## 8. Valutazione oggettiva sull'efficacia
**Nessuna al momento: non esistono ancora risultati misurati.** Non si dichiara alcun miglioramento. L'attivazione operativa resta una decisione successiva, da prendere solo se il report mostrerà, con campione adeguato, escluse peggiori delle mantenute in modo statisticamente rilevante e confermato in avanti.

## Per riprendere
Fatto: analisi, regola, shadow nel sync, migrazione (eseguita), simulazione, report, test (443 verdi). Manca: caricare i file su GitHub, far girare qualche giorno di refresh, lanciare il report sui dati reali, leggere i risultati, decidere.
