/**
 * Mercati che l'interfaccia mostra. Il motore e le sue probabilità (1X2, doppia chance) sono quelli di sempre;
 * Gol/NoGol, Over/Under e corner non vengono più mostrati né calcolati per i pronostici. Il Multigol si legge dai gol attesi del motore.
 * Per rimettere un mercato basta aggiungere il suo id qui (esito, dc, gol, ou, corner) e togliere `only` dalle chiamate di analyzeMatch.
 */
export const VISIBLE_GROUPS = ["esito", "dc", "multigol"];
export const SHOW_CORNERS = VISIBLE_GROUPS.includes("corner");
