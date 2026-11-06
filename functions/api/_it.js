/**
 * Traduzioni in italiano dei testi che arrivano in inglese da API-Football (funzioni pure, usate dal server e dal browser).
 * Il pronostico "Double chance : Inter or draw and -2.5 goals" diventa "1X + Under 2,5".
 */
const norm = (s) => String(s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const STOP = new Set(["fc", "cf", "ac", "as", "ss", "sc", "afc", "us", "ssc", "club", "de", "di", "the", "calcio", "rc", "cd", "ud", "sv", "fk"]);
const core = (s) => norm(s).split(" ").filter((t) => t && !STOP.has(t)).join(" ");
const sameTeam = (a, b) => { const x = core(a), y = core(b); return Boolean(x && y && (x === y || x.includes(y) || y.includes(x))); };
const dec = (n) => String(n).replace(".", ",");

/** "+2.5" -> "Over 2,5", "-3.5" -> "Under 3,5". */
export const goalsIt = (sign, line) => `${sign === "+" ? "Over" : "Under"} ${dec(Number(line))}`;

/**
 * advice di API-Football -> { code, goals, label, long } (null se non c'è un consiglio).
 *  code: 1, X, 2, 1X, X2, 12 · goals: "Over 2,5" / "Under 3,5" · label: "1X + Under 3,5" · long: con parole
 * home/away = nomi delle squadre come li scrive API-Football (servono per capire chi è "Inter" nel consiglio).
 */
export function adviceIt(advice, home, away) {
  const raw = String(advice ?? "").trim();
  if (!raw || /no predictions/i.test(raw)) return null;
  const m = /^(?:combo\s+)?(double chance|winner|draw)\s*:?\s*(.*)$/i.exec(raw);
  if (!m) return { code: null, goals: null, label: raw, long: raw };
  const kind = m[1].toLowerCase();
  let code = null, goals = null;
  for (const part of m[2].split(/\s+and\s+/i).map((p) => p.trim()).filter(Boolean)) {
    const g = /^([+-])\s*(\d+(?:\.\d+)?)\s*goals?$/i.exec(part);
    if (g) { goals = goalsIt(g[1], g[2]); continue; }
    const sides = new Set();
    for (const tok of part.split(/\s+or\s+/i).map((t) => t.trim()).filter(Boolean)) {
      if (/^draw$/i.test(tok)) sides.add("X");
      else if (home && sameTeam(tok, home)) sides.add("1");
      else if (away && sameTeam(tok, away)) sides.add("2");
      else sides.add(tok);
    }
    const known = ["1", "X", "2"].filter((c) => sides.has(c));
    code = known.length === sides.size ? known.join("") : [...sides].join(" o ");
  }
  if (!code && kind === "draw") code = "X";
  const label = [code, goals].filter(Boolean).join(" + ");
  const words = { 1: "vittoria casa", X: "pareggio", 2: "vittoria trasferta", "1X": "casa o pareggio", X2: "pareggio o trasferta", 12: "casa o trasferta (niente pareggio)" };
  const long = [code ? `${kind === "double chance" ? "Doppia chance" : "Esito"} ${code}${words[code] ? ` (${words[code]})` : ""}` : null, goals].filter(Boolean).join(" + ");
  return { code, goals, label: label || raw, long: long || raw };
}

/** Commento sul vincente probabile ("Win or draw" -> "vince o pareggia"). */
export function commentIt(c) {
  const s = String(c ?? "").trim();
  if (!s) return "";
  return s.replace(/\bwin or draw\b/i, "vince o pareggia").replace(/\bdraw or win\b/i, "pareggia o vince").replace(/\bwin\b/i, "vince").replace(/\bdraw\b/i, "pareggia").replace(/\bor\b/gi, "o");
}

const BODY = { knee: "ginocchio", muscle: "muscolare", hamstring: "bicipite femorale", ankle: "caviglia", groin: "inguine", calf: "polpaccio", thigh: "coscia", back: "schiena", hip: "anca", foot: "piede", shoulder: "spalla", achilles: "tendine d'Achille", head: "testa", leg: "gamba", arm: "braccio", rib: "costole", hand: "mano", wrist: "polso", toe: "dito del piede", neck: "collo", adductor: "adduttore", hernia: "ernia", cruciate: "legamento crociato", ligament: "legamenti", knock: "contusione", illness: "malattia", fever: "febbre", virus: "virus", surgery: "intervento chirurgico", concussion: "commozione cerebrale", fracture: "frattura", broken: "frattura", strain: "stiramento", sprain: "distorsione", tendon: "tendine" };
const REASONS = { suspended: "Squalificato", "red card": "Espulso (squalifica)", "yellow cards": "Squalifica per ammonizioni", "yellow card": "Squalifica per ammonizioni", rest: "Riposo", "coach's decision": "Scelta tecnica", "coachs decision": "Scelta tecnica", "international duty": "Impegno con la nazionale", "personal reasons": "Motivi personali", fitness: "Condizione fisica", other: "Altro", injury: "Infortunio", illness: "Malattia", "not in squad": "Non convocato", "lack of match fitness": "Condizione non ottimale", "on loan": "In prestito", disciplinary: "Motivi disciplinari", "inactive": "Inattivo" };
/** Motivo dell'assenza ("Knee Injury" -> "Infortunio al ginocchio"). Se non lo conosce restituisce il testo originale. */
export function reasonIt(r) {
  const s = String(r ?? "").trim();
  if (!s) return "";
  const k = s.toLowerCase();
  if (REASONS[k]) return REASONS[k];
  const m = /^(.+?)\s+(injury|problem|strain|sprain|surgery|issue)$/i.exec(s);
  if (m) {
    const part = m[1].toLowerCase().split(/[\s-]+/).map((w) => BODY[w]).filter(Boolean);
    if (part.length) return `Infortunio: ${part.join(" ")}`;
  }
  const words = k.split(/[\s-]+/).map((w) => BODY[w]).filter(Boolean);
  return words.length && words.length === k.split(/[\s-]+/).length ? `Infortunio: ${words.join(" ")}` : s;
}
export const injuryTypeIt = (t) => ({ "missing fixture": "Assente", questionable: "Dubbio", doubtful: "Dubbio", out: "Assente" }[String(t ?? "").toLowerCase()] ?? t ?? "");

/** Ruolo in formazione (G/D/M/F) e ruolo esteso delle statistiche giocatore. */
export const posIt = (p) => ({ G: "P", D: "D", M: "C", F: "A" }[String(p ?? "").toUpperCase()] ?? p ?? "");
export const posLongIt = (p) => ({ goalkeeper: "Portiere", defender: "Difensore", midfielder: "Centrocampista", attacker: "Attaccante", G: "Portiere", D: "Difensore", M: "Centrocampista", F: "Attaccante" }[String(p ?? "").toLowerCase()] ?? ({ G: "Portiere", D: "Difensore", M: "Centrocampista", F: "Attaccante" }[String(p ?? "").toUpperCase()]) ?? p ?? "");

/** Evento della partita: tipo + dettaglio -> etichetta italiana. */
export function eventIt(type, detail) {
  const d = String(detail ?? "");
  if (type === "Goal") return d === "Own Goal" ? "Autogol" : d === "Penalty" ? "Gol su rigore" : d === "Missed Penalty" ? "Rigore sbagliato" : "Gol";
  if (type === "Card") return /second yellow/i.test(d) ? "Doppia ammonizione (espulsione)" : /red/i.test(d) ? "Espulsione" : "Ammonizione";
  if (type === "subst") return "Sostituzione";
  if (type === "Var") {
    const v = { "goal cancelled": "gol annullato", "goal confirmed": "gol confermato", "penalty confirmed": "rigore confermato", "penalty cancelled": "rigore annullato", "card upgrade": "cartellino aggravato", "card downgrade": "cartellino ridotto", "card cancelled": "cartellino annullato", "red card cancelled": "espulsione annullata", "goal disallowed - offside": "gol annullato per fuorigioco", "goal disallowed - handball": "gol annullato per fallo di mano", "goal disallowed - foul": "gol annullato per fallo", "penalty not awarded": "rigore non assegnato", "mistaken identity": "errore di identità" }[d.toLowerCase()];
    return `VAR: ${v ?? d}`;
  }
  return `${type ?? ""} ${d}`.trim();
}

/** Turno della competizione ("Regular Season - 12" -> "Giornata 12", "Quarter-finals" -> "Quarti di finale"). */
export function roundIt(r) {
  const s = String(r ?? "").trim();
  if (!s) return s;
  let m;
  if ((m = /^Regular Season\s*-\s*(\d+)$/i.exec(s))) return `Giornata ${m[1]}`;
  if ((m = /^(?:League Stage|League Phase)\s*-\s*(\d+)$/i.exec(s))) return `Fase campionato · giornata ${m[1]}`;
  if ((m = /^Group Stage\s*-\s*(\d+)$/i.exec(s))) return `Fase a gironi · giornata ${m[1]}`;
  if ((m = /^Group ([A-Z0-9]+)\s*-\s*(\d+)$/i.exec(s))) return `Girone ${m[1]} · giornata ${m[2]}`;
  const map = { "round of 16": "Ottavi di finale", "quarter-finals": "Quarti di finale", "semi-finals": "Semifinali", final: "Finale", "3rd place final": "Finale 3º posto", "knockout round play-offs": "Spareggi", "play-offs": "Spareggi", "preliminary round": "Turno preliminare", "1st qualifying round": "1º turno di qualificazione", "2nd qualifying round": "2º turno di qualificazione", "3rd qualifying round": "3º turno di qualificazione", "round of 32": "Sedicesimi di finale", "play-offs - final": "Finale spareggi" };
  return map[s.toLowerCase()] ?? s;
}

const COUNTRIES = { italy: "Italia", spain: "Spagna", france: "Francia", germany: "Germania", england: "Inghilterra", portugal: "Portogallo", netherlands: "Paesi Bassi", belgium: "Belgio", brazil: "Brasile", argentina: "Argentina", croatia: "Croazia", serbia: "Serbia", switzerland: "Svizzera", austria: "Austria", denmark: "Danimarca", sweden: "Svezia", norway: "Norvegia", poland: "Polonia", "czech republic": "Repubblica Ceca", czechia: "Repubblica Ceca", turkey: "Turchia", greece: "Grecia", scotland: "Scozia", wales: "Galles", ireland: "Irlanda", "republic of ireland": "Irlanda", "northern ireland": "Irlanda del Nord", romania: "Romania", hungary: "Ungheria", slovenia: "Slovenia", slovakia: "Slovacchia", ukraine: "Ucraina", russia: "Russia", uruguay: "Uruguay", colombia: "Colombia", chile: "Cile", mexico: "Messico", usa: "Stati Uniti", "united states": "Stati Uniti", canada: "Canada", japan: "Giappone", "south korea": "Corea del Sud", australia: "Australia", morocco: "Marocco", senegal: "Senegal", nigeria: "Nigeria", ghana: "Ghana", "ivory coast": "Costa d'Avorio", cameroon: "Camerun", algeria: "Algeria", tunisia: "Tunisia", egypt: "Egitto", israel: "Israele", finland: "Finlandia", iceland: "Islanda", bulgaria: "Bulgaria", albania: "Albania", bosnia: "Bosnia", "bosnia and herzegovina": "Bosnia ed Erzegovina", montenegro: "Montenegro", "north macedonia": "Macedonia del Nord", kosovo: "Kosovo" };
export const countryIt = (c) => COUNTRIES[String(c ?? "").trim().toLowerCase()] ?? c ?? "";

/** Ruolo in sigla italiana (P, D, C, A) da G/D/M/F o dal nome esteso delle statistiche giocatore. */
export const posShortIt = (p) => ({ goalkeeper: "P", defender: "D", midfielder: "C", attacker: "A", forward: "A", g: "P", d: "D", m: "C", f: "A" }[String(p ?? "").toLowerCase()] ?? p ?? "");
