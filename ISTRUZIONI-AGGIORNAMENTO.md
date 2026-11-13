# Stay Live · Redesign "Electric SL" (v2, tema dell'icona)

## Cosa c'è di nuovo rispetto alla v1
- **Colori ripresi dall'icona SL**: nero profondo con sfumature blu notte, accento **blu elettrico** (#4D9BFF / #2F7BFF), secondo colore **argento** (#B4C3E6). Il Tennis usa **azzurro ghiaccio** (#46DCFF). BET = blu; il **verde è riservato agli esiti positivi** (vinta/centrata). Pallina tennis gialla come dettaglio sportivo.
- **Logo in alto a sinistra**: l'icona vera + scritta *StayLive* corsiva (Stay argento, Live blu con bagliore), come lo stile inclinato del logo. Uguale in Calcio, Tennis e schermata di scelta.
- **Icone PWA rigenerate** dalla tua immagine: icon-48…512, maskable 192/512 (con margine di sicurezza), apple-touch 120/152/167/180, favicon 16/32 e favicon.ico.
- Colori tema (`theme-color`, `manifest.webmanifest`) → #03060E.

## Resto invariato dalla v1
Icone Phosphor (incorporate, nessuna dipendenza), barra inferiore animata (Calcio e Tennis), card ridisegnate, filtri tennis comprimibili, design system in `src/design/` (`tokens.css` contiene tutta la palette: per cambiare colore si cambia lì). Nessuna modifica a API, modelli, Supabase, workflow.

## File nello ZIP (percorsi originali, tutti sostitutivi salvo `src/design/*` nuovi)
`index.html`, `src/icons.js`, `src/main.js` (solo import CSS/icone e 🏆→icona), `src/afdetail.js`, `src/playlist.js` (solo icone), `src/sport.js`, `src/sport.css`, `src/tennis/app.js`, `view.js`, `tennis.css`, `src/design/tokens.css`, `shell.css`, `football.css`, `public/manifest.webmanifest`, `public/favicon.ico`, `public/apple-touch-icon.png`, `public/icons/*.png` (tutte).

## Come applicare (da smartphone)
Decomprimi lo ZIP, su GitHub "Add file → Upload files" caricando i file nelle stesse cartelle (sovrascrive). Commit: il deploy riparte da solo. Nessun comando, nessuna installazione. Se l'icona sul telefono non cambia, rimuovi e rimetti l'app dalla schermata Home (la PWA tiene l'icona in cache).

## Test eseguiti davvero
- `node --test`: 328/329. L'unico fallimento (test 199, `monitor-ui`) c'era già prima: `functions/api/_odds.js` e `quotes.js` esistono ancora (vedi `ELIMINARE.txt`).
- Bundle esbuild riuscito; **`npm run build` (Vite) NON eseguito** (niente rete): lo farà il deploy.
- Verifica visiva con Chrome mobile 412×892 @2x (e desktop 1280 nella v1): scelta sport, partite, dettaglio, giocate, affidabilità, tennis lista/dettaglio/storico. Nessun errore JS in console.

## Limiti
Non provato su Android reale; font Inter visto solo come font locale; anteprima/preview e impostazioni non ri-fotografate dopo il cambio colore (stesse regole dei token, ma non verificate a vista); `:has()` richiede Chrome/WebView 105+; solo tema scuro.
