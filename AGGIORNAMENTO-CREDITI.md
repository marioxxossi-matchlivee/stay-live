# Ottimizzazione crediti API-Football (16 novembre 2026)

## Cosa è stato trovato (dati reali di Supabase, sola lettura)
- Oggi: 4.222 crediti usati a metà mattina; 15 e 14 novembre: 7.375 e 7.339 (tetto quasi raggiunto ogni giorno).
- La somma dei giri automatici di oggi (3 completi + 6 di recupero) = 4.221: tutto il consumo viene dagli script, non dall'app.
- Partite aperte nei prossimi 7 giorni: 567, ma solo 11 oggi e 7 domani. Il 97% dei crediti andava alle partite da 2 a 7 giorni: priorità invertita.
- Quote: ~2.200 chiavi richieste oggi (4–6 richieste per partita, una per mercato); circa metà delle risposte erano VUOTE (quote non ancora pubblicate: corner 1X2 70%, corner O/U 66%, gol 32%, 1X2 35%) e venivano richieste di nuovo ogni 11 ore.
- Il recupero ogni 30 minuti spendeva 150 crediti a ogni giro per i corner storici (6 giri = 1.432 crediti, 34%).
- Ogni giro completo risincronizzava tutti i 69 campionati (414 richieste/giorno).
- I compiti di recupero non avevano un massimo di tentativi.

## Cosa è cambiato
| Area | Prima | Dopo |
|---|---|---|
| Quote | 4–6 richieste per partita (una per mercato) | 1 richiesta `odds?fixture=ID` senza filtro, divisa nelle stesse chiavi di cache (1X2, gol, gol/no gol, doppia chance, corner, corner 1X2) |
| Quote vuote | ricontrollate ogni 4–12 h | attesa progressiva in base al calcio d'inizio (24 h oltre i 4 giorni … 20 min nell'ultima ora) |
| Priorità | uguale per tutte | imminenti / oggi / domani / 2–7 giorni / lavori di fondo, con età massima dei dati diversa |
| Campionati | tutti ogni giro | solo se servono risultati, partite nelle 48 h o calendario > 11 h |
| Recupero | ogni 30 min, 150 crediti di storico corner | ogni ora (:40), niente storico corner, rinfresca solo oggi/imminenti se la cache è scaduta |
| Tentativi | fino a 7 | 3 al massimo, intervalli 30 min → 90 min → 4 h (errori: 1 h → 3 h → 8 h); poi il compito resta sospeso fino al giro completo |
| Compiti obsoleti | restavano | eliminati (partita finita/iniziata/uscita dalla finestra, o vecchi di 48 h) |
| Budget | nessun controllo centrale | Budget Manager dentro `afFetch`: tetto 7.500 − 250, riserva per priorità, curva nelle 24 h, prenotazione atomica su Supabase, nessun superamento con richieste parallele |
| Duplicati | possibili | chiavi uguali (stessa chiamata e chiamate contemporanee) = una richiesta |
| Completezza | assente | stato per partita (completo / parziale / quote in attesa / aggiornamento / errore) e dettaglio espandibile |
| Dashboard | solo residuo | scheda «Consumo crediti (24 ore)» in Impostazioni (`/api/budget`) |
| Giocate | solo segnalibro per riga | pulsante «Salva i BET del giorno» in Calcio e Tennis |

Il contatore ufficiale `af_usage` non è stato modificato (il Budget Manager lo legge soltanto).
Modello, EV, soglie dinamiche e BET Selection Engine: invariati. Il BET è mostrato solo se pronostico, quote e statistiche sono presenti (o non previsti dal provider).

## Da fare
1. Pubblicare questi file su GitHub (Cloudflare si aggiorna da solo).
2. La migrazione `202611160001_budget_manager.sql` è già stata applicata al tuo Supabase (tabelle `af_budget_state`, `af_ledger`, 3 funzioni). Il codice funziona anche senza (conteggio locale).
3. Lancia una volta il workflow **Verifica quote cumulative** con l'id di una partita che ha già quote: usa 3 crediti e conferma che la richiesta unica è equivalente. Se dice NON equivalente: variabile `AF_ODDS_BUNDLE=0` (GitHub secrets/env e Cloudflare) e tutto torna come prima.

## Consumo atteso (stima, non misura)
Con il calendario di oggi (11 + 7 + 549 partite): quote ~650, pronostici ~300, campionati ~200, schede/dettagli ~100, storico corner ≤ 200 solo con crediti avanzati: circa 1.300–1.700 crediti/giorno contro ~7.300. Il giorno con calendario molto fitto resta sotto il tetto grazie al Budget Manager.

## Limiti dichiarati
- La richiesta cumulativa delle quote non è stata provata contro API-Football reale (dalla sandbox non è raggiungibile): è provata con provider simulato; vedi punto 3.
- `scripts/discover-matches.js` (workflow manuale «scopri partite») chiama il provider direttamente e non passa dal Budget Manager.
- Il gate BET su dati incompleti agisce su riga, filtro «Solo BET» e conteggio; le etichette dei singoli mercati dentro la scheda non sono state toccate.
- L'interfaccia è verificata con build e test dei moduli, non con prova visiva su telefono.
