# Validazione prospettica — Tennis Strategy Center (PROGETTO, nessuna modifica remota)

> **Aggiornamento 23/11/2026.** Il registro prospettico proposto qui è stato realizzato in forma diversa: **LIVE OBSERVATION** (tabelle `tennis_observations` e `tennis_observation_versions`, vista `tennis_observation_results`), **attiva dal 21/11/2026**. La tabella `tennis_forecast_log` descritta più sotto **non è mai stata creata** e non va creata: la sezione «Schema proposto» resta solo come storia della decisione.
> Differenze rispetto al progetto: ogni partita ha una valutazione **iniziale immutabile** (rev 1) e **revisioni separate** (rev 2…), invece di un solo record per (partita, versione del modello); si registrano anche Elo, forma, statistiche, ranking, H2H, dati mancanti e l'impronta dello storico usato; un controllo indipendente impedisce la registrazione se lo storico contiene partite con data successiva all'elaborazione.
> **Non ancora realizzato:** il confronto con le quote **al momento della previsione** (il registro non le conserva: oggi si salva solo se erano disponibili). Senza quel confronto nessun risultato può essere dichiarato «Validato».
> La raccolta è prospettica e **non deve essere ricostruita retroattivamente**. I risultati sono ancora da validare: servono almeno 300 osservazioni valide su 50 blocchi indipendenti prima di trarre conclusioni.
> Non confondere LIVE OBSERVATION con Affidabilità → «Dal vivo» (`tennis_predictions`, ultima valutazione prima della partita): sono registri distinti, vedi la roadmap.


Stato: **solo progettazione e test locali** (`scripts/tennis-prospective-record.js`, `tests/tennis-prospective.test.js`). Nessuna tabella è stata creata, nessuna migrazione scritta in `supabase/`, nessuna scrittura eseguita. La creazione della struttura remota richiede una **decisione separata**.

## Perché serve
Ogni audit finora è retrospettivo: usa quote di **chiusura** e ricostruisce i rating a posteriori. Non può dire cosa il sistema sapeva e quali quote erano disponibili **al momento della previsione**. Solo un registro scritto alla generazione della previsione, e mai modificato, permette di valutare il modello contro il mercato senza look-ahead.

## Dati da registrare (un record per partita e per versione del modello)
| campo | note |
|---|---|
| `matchKey`, `p1Id`, `p2Id`, `startsAt` | identificativi; `matchKey` univoco per (partita, `modelVersion`) |
| `predictedAt` | istante di generazione; deve precedere `startsAt` |
| `modelVersion` | es. `TENNIS_MODEL.version`; la strategia ha il proprio `STRATEGY2.version` |
| `ratingsVersion` | impronta di (partite nello storico, ultima data, percorso di caricamento offset/keyset): cosa il motore sapeva |
| `published`, `p1` | probabilità del modello **solo** se pubblicata; le astensioni si registrano comunque (servono per misurare la copertura) |
| `market`: quote 1/2, `bookmaker`, `source`, `quotedAt`, `noVigP1`, `margin` | quota disponibile **alla previsione**; `quotedAt ≤ predictedAt` (altrimenti scartata) |
| `closing`: quote 1/2, `at` | aggiunta dopo, solo come benchmark secondario |
| `outcome`, `settledAt` | aggiunti a partita conclusa; mai riscritti |

Regole: il record è **append-only** (la chiusura aggiunge `closing`, `outcome`, `settledAt` e non tocca il resto); nessuna previsione registrata a partita iniziata; nessuna quota successiva alla previsione; ogni quota ha fonte e timestamp.

## Schema proposto (NON eseguire; solo per la decisione futura)
```sql
-- PROPOSTA — non è una migrazione. Da valutare e approvare separatamente.
create table tennis_forecast_log (
  id bigint generated always as identity primary key,
  match_key text not null,
  model_version text not null,
  ratings_version text,
  p1_id text not null, p2_id text not null,
  starts_at timestamptz not null,
  predicted_at timestamptz not null default now(),
  published boolean not null,
  p1 real check (p1 is null or (p1 > 0 and p1 < 1)),
  odds1 real, odds2 real, bookmaker text, odds_source text, quoted_at timestamptz,
  no_vig_p1 real, margin real,
  closing_odds1 real, closing_odds2 real, closing_at timestamptz,
  outcome smallint check (outcome in (1,2)), settled_at timestamptz,
  unique (match_key, model_version),
  check (predicted_at < starts_at),
  check (quoted_at is null or quoted_at <= predicted_at)
);
-- Scrittura: solo INSERT dal job di previsione; chiusura: UPDATE limitato a closing_*, outcome, settled_at (trigger che rifiuta modifiche agli altri campi).
```

## Piano di validazione (da fissare PRIMA di raccogliere i dati)
1. **Congelamento:** modello, rating, strategia e soglie bloccati per tutta la finestra; ogni cambio apre una nuova `modelVersion` e una nuova finestra.
2. **Metrica primaria (una sola):** Δ log loss tra mercato **normalizzato alla quota disponibile alla previsione** e modello, sulle stesse partite pubblicate. Secondarie: Brier, ECE, confronto con la chiusura. ROI solo descrittivo.
3. **Analisi:** bootstrap a blocchi torneo-settimana; test unilaterale «modello meglio del mercato»; correzione di Holm sulle categorie (ATP, WTA, Challenger, ITF, superficie) dichiarate in anticipo; categorie sotto 300 partite o 50 blocchi: non validate.
4. **Dimensione del campione:** fissata a priori con l'errore standard osservato negli audit (ordine di 0,02 per partita sulla differenza di log loss, da ricontrollare con i dati reali): per un intervallo di ±0,001 servono migliaia di partite; per le doppie molte di più. Nessuna analisi intermedia con decisioni (niente «peeking»).
5. **Doppie:** valutate solo su coppie registrate con probabilità congiunta stimata da un metodo scelto in anticipo; fino ad allora non validate.
6. **Criterio di esito:** vantaggio solo se l'intervallo è interamente sopra 0 **e** regge Holm. In ogni altro caso: l'astensione resta il comportamento corretto.

## Autorizzazioni necessarie prima di qualunque scrittura
Creazione della tabella, ruolo con permesso di sola INSERT, job di registrazione, politica di conservazione. Nulla di questo è stato fatto.
