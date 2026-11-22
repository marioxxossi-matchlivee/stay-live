/**
 * Dati che l'app scarica dal provider (API-Football) e consuma crediti.
 * L'app ragiona e mostra solo 1X2, doppia chance e Multigol: corner e quote di Gol/NoGol e Over/Under non si scaricano più.
 * Per riattivarli basta mettere `true` (e togliere `visible`/`only`, vedi src/modelview.js e model.js).
 */
export const FEATURES = {
  corners: false,        // quote corner, corner storici (fixtures/statistics), giro notturno dei corner
  goalMarkets: false,    // quote Over/Under e Gol/NoGol
};
