// Stay Live Tennis — logica pura dell'elenco (filtri, giorni, gruppi). Nessun DOM: si testa con node --test.
import { dayKey } from "../format.js";
import { normalizeSurface } from "../../functions/api/_tennis-model.js";

export const SURFACE_LABEL = { hard: "Cemento", clay: "Terra", grass: "Erba" };
export const surfaceOf = (m) => normalizeSurface(m.surface);
export const surfaceLabel = (m) => SURFACE_LABEL[surfaceOf(m)] ?? (m.surface ? String(m.surface) : "n.d.");
export const isOpen = (m) => m.status === "scheduled" || m.status === "live";

export const DEFAULT_FILTERS = Object.freeze({ tour: "all", surface: "all", tournament: "all", day: "all", onlyPicks: false });

/** Valori disponibili per i filtri, calcolati sui dati reali (nessuna lista fissa di tornei). */
export function facets(matches) {
  const tournaments = [...new Set(matches.map((m) => m.tournament).filter(Boolean))].sort((a, b) => a.localeCompare(b, "it"));
  const surfaces = ["hard", "clay", "grass"].filter((s) => matches.some((m) => surfaceOf(m) === s));
  const days = [...new Set(matches.map((m) => dayKey(m.startsAt)))].sort();
  const tours = ["atp", "wta"].filter((t) => matches.some((m) => m.tour === t));
  return { tournaments, surfaces, days, tours };
}

export function filterMatches(matches, f = DEFAULT_FILTERS) {
  return matches.filter((m) =>
    (f.tour === "all" || m.tour === f.tour) &&
    (f.surface === "all" || surfaceOf(m) === f.surface) &&
    (f.tournament === "all" || m.tournament === f.tournament) &&
    (f.day === "all" || dayKey(m.startsAt) === f.day) &&
    (!f.onlyPicks || m.prediction?.published === true),
  );
}

/** Ordina per orario e raggruppa per torneo mantenendo l'ordine di prima comparsa. */
export function groupByTournament(matches) {
  const sorted = [...matches].sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt) || String(a.key).localeCompare(String(b.key)));
  const groups = new Map();
  for (const m of sorted) {
    const k = `${m.tour}|${m.tournament ?? "Altro"}`;
    if (!groups.has(k)) groups.set(k, { tour: m.tour, tournament: m.tournament ?? "Altro", surface: surfaceLabel(m), matches: [] });
    groups.get(k).matches.push(m);
  }
  return [...groups.values()];
}

/** Se il filtro del giorno non esiste più nei dati, si torna a "tutti" (evita liste vuote inspiegabili). */
export function sanitizeFilters(f, matches) {
  const fx = facets(matches);
  const out = { ...DEFAULT_FILTERS, ...f };
  if (out.tour !== "all" && !fx.tours.includes(out.tour)) out.tour = "all";
  if (out.surface !== "all" && !fx.surfaces.includes(out.surface)) out.surface = "all";
  if (out.tournament !== "all" && !fx.tournaments.includes(out.tournament)) out.tournament = "all";
  if (out.day !== "all" && !fx.days.includes(out.day)) out.day = "all";
  return out;
}

/** Controllo minimo del contenuto ricevuto: scarta le righe incomplete invece di rompere l'interfaccia. */
export function sanitizeMatches(list) {
  if (!Array.isArray(list)) return [];
  return list.filter((m) => m && m.key && m.startsAt && !Number.isNaN(new Date(m.startsAt).getTime()) && m.p1?.name && m.p2?.name && (m.tour === "atp" || m.tour === "wta"));
}
