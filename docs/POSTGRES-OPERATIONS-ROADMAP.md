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
| 2 | Inventario delle sole componenti infrastrutturali neutrali | Parzialmente completata |
| 3 | Definizione dei controlli di disponibilità e connessione | Completata — verifica read-only del 25/11/2026 |
| 4 | Backup esterni | Accantonata su richiesta dell'utente — non proseguire |
| 5 | Procedura di ripristino | Accantonata su richiesta dell'utente — non proseguire |
| 6 | Monitoraggio tecnico di errori, connessioni e saturazione | Parzialmente completata — baseline read-only |
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

### Backup e ripristino — piano Free

Informazione confermata dall'utente il 25/11/2026: il progetto utilizza il piano Supabase Free e non dispone dei backup gestiti che l'utente si aspettava di trovare nella Dashboard.

Conseguenze operative:
- non esiste, allo stato attuale, una copertura di backup automatico gestita da Supabase su cui fare affidamento;
- retention e Point-in-Time Recovery gestiti da Supabase non sono disponibili/confermati per questo progetto;
- non è stato eseguito alcun backup né alcun restore durante questa verifica;
- il database deve essere considerato privo di una copia di sicurezza indipendente verificata finché non sarà predisposta e testata una procedura esterna.

La roadmap prevede di valutare una strategia esterna di esportazione PostgreSQL (ad esempio dump periodico tramite strumenti ufficiali PostgreSQL/Supabase), conservazione cifrata fuori dal progetto e verifica di ripristino in un ambiente separato. Prima di automatizzarla occorre definire destinazione, credenziali/segreti, frequenza, retention, cifratura e modalità di verifica. Non salvare mai password, token o chiavi nel repository Git.

### Stato fase 2

**Parzialmente completata.** Inventario runtime PostgreSQL, catalogo estensioni e condizione backup del piano Free documentati. Restano da classificare tecnicamente i workflow CI e da progettare/validare la strategia di backup esterna. Nessuna modifica a Supabase, nessuna modifica a workflow e nessuna scrittura su dati applicativi.

## Fase 3 — disponibilità e connessioni (25/11/2026)

Verifica read-only eseguita sul progetto Supabase:

- Stato progetto: `ACTIVE_HEALTHY`.
- PostgreSQL: 17.11.
- Connessioni osservate: 18 su un massimo configurato di 60 (30%).
- Distribuzione: 1 connessione `active`, 10 `idle`, 7 con stato `NULL` (sessioni di sistema/background o non classificabili come client idle/active).
- Connessioni `idle in transaction`: 0.
- Query attive da oltre un minuto: 0.
- Deadlock registrati: 0.

La differenza rispetto alla precedente fotografia (12 connessioni) è una variazione tra due istanti di rilevazione, non un errore: il conteggio attuale è stato scomposto per stato e torna a 18. Il valore resta al 30% del limite configurato. Nessuna evidenza puntuale di saturazione o query bloccata è emersa da questi controlli.

**Esito fase 3: completata**, limitatamente ai controlli read-only sopra elencati. Non sono state modificate impostazioni, connessioni o dati.

## Fase 6 — prima baseline di osservabilità (25/11/2026)

La rilevazione precedente costituisce la baseline iniziale per:
- stato del servizio;
- utilizzo del limite connessioni;
- sessioni idle-in-transaction;
- query attive di lunga durata;
- contatore cumulativo dei deadlock.

Contatori cumulativi PostgreSQL letti nella stessa sessione:
- transazioni committed: 2.166.060;
- transazioni rolled back: 341.

I contatori sono cumulativi dall'ultimo reset delle statistiche e non rappresentano un tasso di errore o una percentuale di fallimento. Per ricavare trend affidabili serviranno almeno due rilevazioni temporali comparabili. Non sono state lette tabelle applicative né statistiche di query riconducibili al motore di pronostico.

**Esito fase 6: parziale.** Baseline iniziale acquisita; non è stata configurata alcuna raccolta automatica né una soglia di allarme.

## Attività accantonate

Su esplicita indicazione dell'utente del 25/11/2026, non proseguire le attività relative a backup esterni e procedure di ripristino (fasi 4 e 5). Non riproporle come prossimo passo.

## Prossima attività

Valutare se esistono controlli CI/CD infrastrutturali chiaramente separabili dalle funzionalità applicative escluse. La classificazione deve basarsi su evidenze sufficienti; se un workflow è misto o ambiguo, lasciarlo invariato. In alternativa, completare la documentazione operativa dei controlli read-only già definiti.
