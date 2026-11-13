// Stay Live Tennis — logica pura dell'elenco (filtri, giorni, gruppi). Nessun DOM: si testa con node --test.
import { dayKey } from "../format.js";
import { normalizeSurface } from "../../functions/api/_tennis-model.js";
import { summarizeHistory } from "../../functions/api/_tennis-snapshot.js";

export const SURFACE_LABEL = { hard: "Cemento", clay: "Terra", grass: "Erba" };
export const surfaceOf = (m) => normalizeSurface(m.surface);
export const surfaceLabel = (m) => SURFACE_LABEL[surfaceOf(m)] ?? (m.surface ? String(m.surface) : "n.d.");
export const isOpen = (m) => m.status === "scheduled" || m.status === "live";

export const GENDER_LABEL = { atp: "Uomini (ATP)", wta: "Donne (WTA)" };
export const CATEGORY_LABEL = { tour: "Tour", challenger: "Challenger", itf: "ITF", challenger_itf: "Challenger/ITF", unknown: "Altro" };
export const categoryLabel = (m) => (m.category === "tour" ? `${String(m.tour).toUpperCase()} Tour` : CATEGORY_LABEL[m.category] ?? CATEGORY_LABEL.unknown);
export const STATUS_FILTERS = [["all", "Tutte"], ["live", "Live"], ["scheduled", "In programma"], ["finished", "Concluse"]];

// Bandiere: il provider usa codici a tre lettere (IOC); se il codice non è in tabella si mostra il codice, mai una bandiera sbagliata.
const IOC2 = { ARG: "AR", AUS: "AU", AUT: "AT", BEL: "BE", BLR: "BY", BRA: "BR", BUL: "BG", CAN: "CA", CHI: "CL", CHN: "CN", COL: "CO", CRO: "HR", CZE: "CZ", DEN: "DK", ECU: "EC", EGY: "EG", ESP: "ES", EST: "EE", FIN: "FI", FRA: "FR", GBR: "GB", GEO: "GE", GER: "DE", GRE: "GR", HUN: "HU", INA: "ID", IND: "IN", IRL: "IE", ISR: "IL", ITA: "IT", JPN: "JP", KAZ: "KZ", KOR: "KR", LAT: "LV", LTU: "LT", MAR: "MA", MDA: "MD", MEX: "MX", MON: "MC", NED: "NL", NOR: "NO", NZL: "NZ", PAR: "PY", PER: "PE", PHI: "PH", POL: "PL", POR: "PT", ROU: "RO", RSA: "ZA", RUS: "RU", SRB: "RS", SUI: "CH", SVK: "SK", SLO: "SI", SWE: "SE", THA: "TH", TPE: "TW", TUN: "TN", TUR: "TR", UKR: "UA", URU: "UY", USA: "US", UZB: "UZ", VEN: "VE", BIH: "BA", MNE: "ME", CYP: "CY", LUX: "LU", BOL: "BO", DOM: "DO", ISL: "IS", HKG: "HK", MKD: "MK", ALB: "AL", ARM: "AM", AZE: "AZ", TKM: "TM", JOR: "JO", QAT: "QA", UAE: "AE", KSA: "SA", ZIM: "ZW", KEN: "KE", NGR: "NG" };
export function flag(code) {
  const a2 = IOC2[String(code ?? "").toUpperCase()];
  return a2 ? String.fromCodePoint(...[...a2].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : "";
}

export const DEFAULT_FILTERS = Object.freeze({ tour: "all", category: "all", surface: "all", tournament: "all", day: "all", status: "all", q: "", onlyPicks: false, onlyBet: false });
const fold = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Valori disponibili per i filtri, calcolati sui dati reali (nessuna lista fissa di tornei). */
export function facets(matches) {
  const tournaments = [...new Set(matches.map((m) => m.tournament).filter(Boolean))].sort((a, b) => a.localeCompare(b, "it"));
  const surfaces = ["hard", "clay", "grass"].filter((s) => matches.some((m) => surfaceOf(m) === s));
  const days = [...new Set(matches.map((m) => dayKey(m.startsAt)))].sort();
  const tours = ["atp", "wta"].filter((t) => matches.some((m) => m.tour === t));
  const categories = ["tour", "challenger", "itf", "challenger_itf", "unknown"].filter((c) => matches.some((m) => (m.category ?? "unknown") === c));
  return { tournaments, surfaces, days, tours, categories };
}

export function filterMatches(matches, f = DEFAULT_FILTERS) {
  const q = fold(f.q).trim();
  return matches.filter((m) =>
    (f.tour === "all" || m.tour === f.tour) &&
    (!f.category || f.category === "all" || (m.category ?? "unknown") === f.category) &&
    (f.surface === "all" || surfaceOf(m) === f.surface) &&
    (f.tournament === "all" || m.tournament === f.tournament) &&
    (f.day === "all" || dayKey(m.startsAt) === f.day) &&
    (!f.status || f.status === "all" || m.status === f.status) &&
    (!f.onlyPicks || m.prediction?.published === true) &&
    (!f.onlyBet || m.bet?.verdict === "BET") &&
    (!q || fold(`${m.p1.name} ${m.p2.name} ${m.tournament ?? ""}`).includes(q)),
  );
}

/** Sezioni della schermata: Live, Oggi (programmate oggi), Prossimi giorni, Concluse. `now` e il fuso sono quelli dell'app (Europa/Roma). */
export function sections(matches, now = Date.now()) {
  const today = dayKey(new Date(now).toISOString());
  const by = (fn) => matches.filter(fn);
  const sortAsc = (l) => [...l].sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt));
  const defs = [
    { id: "live", title: "In corso", matches: by((m) => m.status === "live") },
    { id: "today", title: "Oggi", matches: by((m) => m.status === "scheduled" && dayKey(m.startsAt) <= today) },
    { id: "upcoming", title: "Prossimi giorni", matches: by((m) => m.status === "scheduled" && dayKey(m.startsAt) > today) },
    { id: "finished", title: "Concluse", matches: [...by((m) => m.status === "finished" || m.status === "ended_other")].sort((a, b) => new Date(b.startsAt) - new Date(a.startsAt)) },
    { id: "other", title: "Altre (sospese, rinviate, esito non ricevuto)", matches: by((m) => ["unknown", "cancelled", "postponed", "interrupted"].includes(m.status)) },
  ];
  return defs.filter((d) => d.matches.length).map((d) => ({ ...d, matches: d.id === "finished" ? d.matches : sortAsc(d.matches) }));
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
  if (out.category !== "all" && !fx.categories.includes(out.category)) out.category = "all";
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

// ───────── Storico ─────────
export const DEFAULT_HISTORY_FILTERS = Object.freeze({ period: "all", category: "all", tour: "all", outcome: "all" });
export const PERIODS = [["7", "7 giorni"], ["30", "30 giorni"], ["90", "90 giorni"], ["all", "Tutto"]];
export const OUTCOMES = [["all", "Tutti"], ["hit", "Corretti"], ["miss", "Errati"], ["abstained", "Astenuti"], ["pending", "In attesa"]];
export function filterHistory(rows, f = DEFAULT_HISTORY_FILTERS, now = Date.now()) {
  const from = f.period === "all" ? -Infinity : now - Number(f.period) * 86400e3;
  return (rows ?? []).filter((r) => Date.parse(r.startsAt) >= from && (f.category === "all" || r.category === f.category) && (f.tour === "all" || r.tour === f.tour) && (
    f.outcome === "all" || (f.outcome === "hit" && r.hit === true) || (f.outcome === "miss" && r.hit === false) || (f.outcome === "abstained" && !r.published) || (f.outcome === "pending" && r.published && r.hit === null)));
}
/** Metriche ricalcolate sui soli pronostici registrati che passano il filtro (periodo, categoria, circuito). */
export const historySummary = (rows, f = DEFAULT_HISTORY_FILTERS, now = Date.now()) => summarizeHistory(filterHistory(rows, { ...f, outcome: "all" }, now));
