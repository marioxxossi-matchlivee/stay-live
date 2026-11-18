# Tennis Strategy Center 2.0 — Roadmap e registro di lavoro

Ultimo aggiornamento: 18/11/2026 · **Si lavora direttamente su `main`, per scelta dell'utente (nessun ramo separato).**
Regole che restano: nessuna scrittura sul database di produzione da questo lavoro, nessuna chiamata al provider sportivo per l'audit, motore e strategie operative invariati finché non si approva l'attivazione; ogni novità sperimentale è isolata (script a mano, Shadow Mode). Poiché `main` è ora l'unico ramo, i file di questa tappa sono tutti **nuovi o a effetto nullo sul motore**: il workflow di audit parte solo a mano e non scrive su Supabase.

## Stato delle fasi
| Fase | Stato |
|---|---|
| 1 Audit Value e sfavoriti | **Codice e dati di produzione letti (sola lettura): findings sotto.** Tabelle storiche per fascia: da produrre lanciando il workflow «Tennis — audit Strategy Center» |
| 2 Calibrazione | Script pronto (ECE, Brier, scarto per fascia/categoria); esecuzione da fare. Platt/isotonica: non applicate |
| 3 Classificazione tornei | Audit del codice fatto; `competitionLabel` pronta (solo audit); UI da modificare dopo la validazione |
| 4 Filtro ITF 8 punti | Verificato: tabella presente su Supabase (233 righe), migrazione **assente nella repo**; copre solo il lato pronosticato dal modello |
| 5–10 Classi A/B/C/D, doppie, tre livelli, simulatore, backtest comparativo, UI | Non iniziate (dipendono dai risultati dell'audit) |

## Findings dal codice (`functions/api/_tennis-strategy.js`, `_tennis-bet.js`)
1. **Graduatoria per EV decrescente** (`compareValue`): a parità di classe vince l'EV più alto. EV = P×quota−1 cresce con la quota, quindi la cima della lista è per costruzione dove modello e mercato divergono di più, cioè dove l'errore del modello pesa di più (maledizione del vincitore).
2. **Il tetto di scarto è 15 punti** (`maxModelGap`) e tutte e cinque le selezioni segnalate stanno a 12,7–14,6 punti: sono i massimi scarti consentiti. Nessuna fascia di quota è limitata (nessun massimo di quota).
3. **EV sulla quota migliore tra i bookmaker, mercato da un solo bookmaker** (`pickOdds`: quota massima tra le fonti, riferimento Pinnacle o la prima fonte). Su 3 delle 5 giocate la quota è di Marathonbet e il mercato è di un altro book: l'EV include il vantaggio del book più generoso (spesso un valore anomalo sulle quote lunghe) e nessun controllo sugli outlier.
4. **Tutte e 5 sono ITF** (W15, M25, W50) con affidabilità «alta»: la categoria con dati più poveri e mercato meno liquido ha l'affidabilità massima. La «affidabilità» è un'etichetta del Prediction Engine, non misura la calibrazione per categoria.
5. **La calibrazione non protegge gli sfavoriti** (`calibrationCheck`): usa solo fasce del favorito (≥50%), corregge soltanto al ribasso e solo se l'intervallo di Wilson sta sotto la media dichiarata; è calcolata sul backtest Elo+forma su tutte le partite, non sulle partite in cui il modello contraddice il mercato. Nessuna validazione per fascia di quota o per categoria ITF.
6. **Validazione solo per «elevato»**: una Value non validata diventa comunque «interessante» e finisce nelle singole selezionate (fino a 5, `maxSingles`).
7. **Doppia**: pescata fra le prime 5 singole (quindi i massimi EV), probabilità congiunta P1×P2 (indipendenza assunta), nessun filtro su probabilità minima, rischio o qualità. Se la doppia non vince il confronto viene comunque mostrata con stato `not_preferred` e il suo EV (+273% nel caso osservato): il messaggio è contraddittorio perché il confronto usa EV per unità di rischio, mentre la UI mostra l'EV grezzo.
8. **Classificazione tornei** (`classifyCategory`): maschile/femminile dal circuito del provider (atp/wta); ITF solo se il nome inizia con `M/W + 2-3 cifre`; il livello 1 del provider unisce Challenger e ITF e se il nome non basta resta `challenger_itf` (non coperto dal filtro ITF né da nessuna etichetta chiara). Livelli W35/W50/W75/W100 non vengono distinti oltre il nome.
9. **Filtro ITF 8 punti** (`_tennis-itf-shadow.js`): valuta solo il lato pronosticato dal modello; le giocate dello Strategy Center sugli sfavoriti non sono il lato pronosticato, quindi **non sono coperte**. Con la regola applicata al lato selezionato, tutte e cinque (scarti 12,7–14,6) sarebbero escluse. Stato Supabase: 121 mantenute, 20 escluse (6 avrebbero rimosso un BET), 92 non valutabili.

## Finding critico sui dati (da confermare con l'audit, NON ancora corretto)
**Il motore legge solo le prime 80.000 partite concluse.** `loadHistory` (`scripts/tennis-sync.js`) usa `getAll(..., 1000, 80)` con ordine cronologico crescente. Le partite concluse negli ultimi 400 giorni sono **96.211**: ne restano fuori **16.194**, tutte le più recenti (dopo il 25/09/2026). Il backtest statico lo conferma (`history: 80000`). Conseguenza: i rating Elo e la forma ignorano circa 8 settimane di risultati; il mercato li conosce. Verificato su Supabase in sola lettura. Candidato n. 1 come causa dei grandi scarti modello−mercato, specie nei circuiti minori dove i giocatori cambiano forma in fretta. È una modifica ai dati d'ingresso del motore: va provata in Shadow Mode come esperimento isolato, non applicata direttamente.

## Casi da ricostruire
Cinque selezioni registrate in `tennis_strategy_picks` (tutte ITF, nessuna ancora conclusa): Cirpanli 17,48 (P 18,2% / mercato 5,5%), Tailleu 12,22 (21,4% / 7,8%), Peet 6,05 (33,1% / 18,9%), Vrancken Peeters 4,25 (43,9% / 29,3%), Novak 6,25 (29,4% / 15,2%). Dati coerenti con i valori indicati dall'utente. Storico prospettico della strategia: 5 giocate, 1 esecuzione, quindi **nessun risultato storico utilizzabile**: l'analisi storica usa il rigioco cronologico con le quote di chiusura (proxy, dichiarato).

## Esperimento A (nel workflow di audit, solo lettura)
Sulle partite successive al taglio delle 80.000, confronta rating **congelati** (come il motore oggi) e **aggiornati** ogni giorno, sulle stesse partite e gli stessi lati: differenza media di probabilità, scarto medio dal mercato, Brier, ECE, numero/quota media/ROI delle selezioni attuali e quota di sfavoriti. Se i rating aggiornati riducono lo scarto dal mercato e le selezioni sugli sfavoriti, la correzione del tetto di lettura diventa il primo intervento (da attivare in Shadow Mode, non direttamente).

## File di questa tappa
Nuovi: `scripts/tennis-strategy-audit.js`, `.github/workflows/tennis-strategy-audit.yml`, `tests/tennis-strategy-audit.test.js`, `supabase/migrations/202611180001_tennis_itf_shadow.sql`, questo documento. Modificati (correzione del refresh tennis, già consegnata): `scripts/tennis-sync.js`, `tests/tennis-sync.test.js`. Motore e strategie: invariati.

## (Elenco iniziale)
- `scripts/tennis-strategy-audit.js` (sola lettura; rigioco cronologico senza look-ahead; tabelle per fascia di quota, favoriti/sfavoriti, categoria, scarto dal mercato, filtro ITF)
- `.github/workflows/tennis-strategy-audit.yml` (solo avvio manuale)
- `tests/tennis-strategy-audit.test.js` (8 test, tutti superati)
- questo documento

## Test eseguiti
Suite completa `node --test`: tutti superati (il fallimento precedente era la migrazione shadow mancante, ora presente). Audit: 9 test.

## Prossimo passo preciso
1. Lanciare a mano il workflow «Tennis — audit Strategy Center» e leggere il riepilogo (fasce di quota, ROI, Brier, ECE, scarto per categoria, ITF ≤8 vs >8).
2. Con quei numeri, esperimento isolato A: stesso rigioco con la storia completa (senza tetto di 80 pagine) per misurare quanto cambia lo scarto dal mercato. Poi, uno alla volta e in Shadow Mode: B) quota di riferimento coerente (stesso book per EV e mercato) e controllo outlier; C) tetto di scarto e filtro ITF sul lato selezionato; D) classi A/B/C/D.
3. ~~Riaggiungere la migrazione mancante dello shadow ITF~~ **Fatto**: `supabase/migrations/202611180001_tennis_itf_shadow.sql`, ricostruita dallo schema reale di produzione, idempotente (la tabella esiste già: non va eseguita a mano).

## Decisioni tecniche
- Audit separato dal motore: solo funzioni pure + letture; nessun import dal client del provider (verificato da un test).
- Le quote storiche disponibili sono di chiusura (`closing_odds`): nessuna ricostruzione di quote al momento della previsione, dichiarato nei report.
