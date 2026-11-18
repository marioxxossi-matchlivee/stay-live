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

## Risultati del primo audit (18/11/2026, 96.240 partite, 36.355 con quote di chiusura)
Proxy dichiarato: quote di CHIUSURA di bookmaker non identificato; rigioco Elo+forma **non calibrato** e senza requisito di affidabilità riproducibile. I ROI sono quindi pessimistici in assoluto; contano di più calibrazione e Brier relativi al mercato.
1. **Il Brier del modello è peggiore di quello del mercato in tutte le fasce** (es. 2,00–3,00: 0,2686 contro 0,2317; 5,00–10,00: 0,1387 contro 0,0821). Nessuna evidenza di un vantaggio informativo sul mercato.
2. **Il modello è troppo «piatto»**: sovrastima gli sfavoriti (quote 3–5: 38,4% previsto, 21,2% reale; 5–10: 29,6% contro 8,9%; oltre 10: 24,4% contro 1,7%) e sottostima i grandi favoriti (sotto 1,20: 68,4% contro 88,9%). Per questo trova «valore» sulle quote alte per costruzione. ECE 0,15–0,23 in tutte le fasce.
3. **Le selezioni con le regole attuali (869) perdono**: ROI circa −18% (sfavoriti −20,2%, favoriti −14,9%); il modello sovrastima di 11 punti sugli sfavoriti e di 15,7 sui favoriti scelti. **Uno scarto maggiore dal mercato non migliora il risultato** (8–12 pt: −25%, 12–15 pt: −10%): sono errori del modello, non valore.
4. **Esperimento A (rating congelati contro aggiornati)**: i rating aggiornati migliorano Brier (0,2146→0,2105) ed ECE (0,034→0,013) e il ROI delle selezioni (−13,5%→−8,9%), ma restano peggiori del mercato (Brier 0,1764) e perdenti. La mancata lettura delle ultime 16.194 partite è un difetto reale ma **non la causa principale**. Le probabilità cambiano in media di 6,5 punti tra le due versioni.
5. **Buco dell'audit**: nelle selezioni compaiono solo ATP/WTA Tour; ITF e Challenger sono vuoti perché nel rigioco l'affidabilità «alta» richiesta dalle categorie rigide non è riproducibile. Il filtro ITF 8 punti non è stato valutato. Aggiunti: tabella calibrazione per categoria su tutti i lati e selezioni senza requisito di affidabilità.
6. **Classificazione**: 2.613 partite WTA restano «CHALLENGER/ITF NON DISTINTO» (2,7%); i livelli W15…W100 e M15/M25 sono distinti correttamente.

**Lettura**: il modello ha un potere informativo inferiore al mercato; i disaccordi sono in gran parte errori del modello. Direzione di progetto (da validare): non usare la probabilità grezza ma una **probabilità rimodulata sul mercato**, adattata walk-forward (c = peso dell'informazione del modello oltre il mercato). L'audit ora la stima (sezione «Il modello aggiunge qualcosa al mercato?») e applica le stesse soglie alla probabilità rimodulata: se non resta nessuna selezione, il sistema deve astenersi.

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
1. ~~Primo audit~~ **fatto** (risultati sopra). Rilanciare il workflow dopo l'aggiornamento dello script e leggere le nuove sezioni: calibrazione per categoria, ITF/Challenger senza requisito di affidabilità, regressione sul mercato.
2. Con quei numeri, esperimento isolato A: stesso rigioco con la storia completa (senza tetto di 80 pagine) per misurare quanto cambia lo scarto dal mercato. Poi, uno alla volta e in Shadow Mode: B) quota di riferimento coerente (stesso book per EV e mercato) e controllo outlier; C) tetto di scarto e filtro ITF sul lato selezionato; D) classi A/B/C/D.
3. ~~Riaggiungere la migrazione mancante dello shadow ITF~~ **Fatto**: `supabase/migrations/202611180001_tennis_itf_shadow.sql`, ricostruita dallo schema reale di produzione, idempotente (la tabella esiste già: non va eseguita a mano).

## Decisioni tecniche
- Audit separato dal motore: solo funzioni pure + letture; nessun import dal client del provider (verificato da un test).
- Le quote storiche disponibili sono di chiusura (`closing_odds`): nessuna ricostruzione di quote al momento della previsione, dichiarato nei report.
