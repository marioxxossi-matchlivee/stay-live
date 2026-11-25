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
