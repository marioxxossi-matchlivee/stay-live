# PostgreSQL Operations Roadmap

**Data:** 25/11/2026  
**Branch di riferimento:** `main`  
**Stato iniziale:** roadmap creata; nessuna modifica al database remoto.

## Scopo e perimetro

Questo documento traccia esclusivamente attività infrastrutturali neutrali: disponibilità del servizio, gestione operativa PostgreSQL, backup e ripristino, osservabilità tecnica e documentazione.

Sono fuori perimetro le tabelle, le query, i processi e i workflow che alimentano o migliorano pronostici, quote, selezioni, strategie o valutazioni destinate alle scommesse. Non si devono modificare, ottimizzare o testare tali componenti nell'ambito di questa roadmap.

Ogni nuova attività deve essere classificata prima dell'esecuzione. Se non è possibile dimostrare che sia indipendente dalle funzionalità escluse, va sospesa.

## Registro fasi

| Fase | Attività | Stato |
|---|---|---|
| 1 | Fotografia iniziale delle metriche PostgreSQL | Completata — sola lettura |
| 2 | Inventario delle sole componenti infrastrutturali neutrali | Da avviare |
| 3 | Definizione dei controlli di disponibilità e connessione | Pianificata |
| 4 | Verifica della configurazione e della copertura dei backup | Pianificata |
| 5 | Procedura documentata di ripristino e verifica periodica | Pianificata |
| 6 | Monitoraggio tecnico di errori, connessioni e saturazione | Pianificata |
| 7 | CI per controlli infrastrutturali indipendenti | Pianificata |
| 8 | Manuale operativo e procedura di gestione incidenti | Pianificata |

## Fase 1 — Fotografia iniziale PostgreSQL

Rilevazione read-only del 25/11/2026:

- Progetto Supabase: `ACTIVE_HEALTHY`.
- PostgreSQL: versione 17.11.
- Dimensione database: circa 176 MB.
- Connessioni osservate: 12 totali, 1 attiva, 10 idle, 0 idle-in-transaction.
- Query attive oltre un minuto: 0.
- Deadlock registrati: 0.
- Buffer cache hit: 100% nella rilevazione.
- Tabelle nello schema `public`: 46.
- Righe vive stimate: 244.863; righe morte stimate: 28.522.
- Tabelle senza statistiche di analisi aggiornate negli ultimi 7 giorni: 19.
- Tabelle senza vacuum negli ultimi 7 giorni: 25.
- Advisor prestazioni: 2 foreign key senza indice e 19 indici segnalati come non utilizzati.
- Advisor salute: nessuna segnalazione.

Questi valori sono una fotografia puntuale, non soglie o diagnosi definitive. Le statistiche di utilizzo degli indici dipendono dal periodo di osservazione. Non eliminare indici sulla sola base del rapporto advisor.

### Vincoli della fase 1

- Nessuna scrittura sul database.
- Nessuna modifica a schema, tabelle, viste, funzioni, trigger o policy.
- Nessuna modifica a workflow o codice che alimenta funzionalità di pronostico/scommessa.
- Non è stata eseguita una revisione di sicurezza delle policy.

## Criteri di completamento delle fasi successive

Una fase può essere dichiarata completata solo quando:
1. il perimetro è documentato e indipendente dalle funzionalità escluse;
2. le verifiche sono ripetibili e non richiedono dati di pronostico o quote;
3. eventuali modifiche sono limitate a componenti neutrali e hanno test/rollback adeguati;
4. il risultato è verificato dopo l'intervento;
5. la roadmap riporta commit, workflow o evidenze pertinenti.

## Prossima attività

**Fase 2 — Inventario infrastrutturale neutrale.**

Raccogliere esclusivamente informazioni su configurazione generale del progetto, connessioni, estensioni PostgreSQL, dimensionamento, backup e workflow CI generici. Escludere dall'analisi le tabelle e i processi applicativi collegati a pronostici, quote e strategie di scommessa. Nessuna modifica remota durante l'inventario.


## Aggiornamento fase 2 — inventario infrastrutturale (25/11/2026)

### Evidenze PostgreSQL / Supabase

Verifiche eseguite in sola lettura sul progetto attivo:

- PostgreSQL 17.11; regione Supabase `eu-west-2`.
- `max_connections = 60`; fotografia contemporanea: 12 connessioni totali.
- Fuso orario database: `UTC`.
- `statement_timeout = 2min`.
- `idle_in_transaction_session_timeout = 0` (nessun timeout dedicato configurato a livello di questa impostazione).
- `track_io_timing = off`.
- Estensioni effettivamente installate: `pg_stat_statements 1.11`, `pgcrypto 1.3`, `plpgsql 1.0`, `supabase_vault 0.3.1`, `uuid-ossp 1.1`.

L'elenco delle estensioni disponibili nel catalogo Supabase è molto più ampio di quello installato. Non è stata abilitata o rimossa alcuna estensione.

### Inventario GitHub Actions

La directory `.github/workflows` contiene 23 workflow. Dalla sola nomenclatura e dalla prima classificazione non è stato identificato un workflow sicuramente indipendente dalle funzionalità applicative escluse dal perimetro. I workflow non sono stati modificati né eseguiti.

### Backup e ripristino — evidenza non ancora disponibile

Gli strumenti collegati in questa sessione non espongono una lettura diretta della configurazione di backup, della retention o dello storico dei restore del progetto. Non si può quindi attestare da questa verifica che i backup siano attivi, né indicarne la frequenza o la retention.

Verifica da completare tramite Supabase Dashboard, sezione Database / Backups (e, se previsto dal piano, Point-in-Time Recovery). Prima di dichiarare conclusa la fase 2 occorre registrare:
- disponibilità dei backup automatici;
- retention effettiva;
- eventuale disponibilità e finestra PITR;
- data dell'ultimo backup/restore point visibile;
- eventuale prova di ripristino in ambiente isolato, senza sovrascrivere produzione.

### Stato fase 2

**Parzialmente completata.** Inventario runtime PostgreSQL e catalogo estensioni completati. Restano da verificare backup/retention e classificazione tecnica dei workflow. Nessuna modifica a Supabase, nessuna modifica a workflow e nessuna scrittura su dati applicativi.
