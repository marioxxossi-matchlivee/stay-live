import { json } from "./_lib.js";

// RIMOSSO: The Odds API non è più usata. Le quote reali arrivano da API-Football (preview, scheda partita) e dal modello.
// Questo endpoint resta solo per rispondere "non più disponibile" a client vecchi in cache: puoi eliminare il file.
export function onRequest() {
  return json({ error: "Endpoint rimosso: le quote arrivano da API-Football." }, 410);
}
