// Etichette brevi degli esiti (1, X, 2, 1X, X2, GG, NG, Over 2,5…): la descrizione estesa resta nel dettaglio partita.
export const SHORT_PICK = {
  home: "1", draw: "X", away: "2", dc1x: "1X", dcx2: "X2", dc12: "12", btts: "GG", nobtts: "NG",
  over05: "Over 0,5", over15: "Over 1,5", under15: "Under 1,5", over25: "Over 2,5", under25: "Under 2,5", over35: "Over 3,5", under35: "Under 3,5",
};
export const shortPick = (p) => SHORT_PICK[p?.key] ?? String(p?.label ?? "").split(" · ")[0];
