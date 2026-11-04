/**
 * Schermata "Dati API-Football" di una partita: trasforma la risposta di /api/match-detail in sezioni (HTML).
 * Funzioni pure: ricevono i dati e restituiscono testo, senza toccare la pagina. Ogni valore dinamico passa da esc().
 */
import { dayKey, dayParts, esc, fmtTime, num } from "./format.js";

const dash = "—";
const val = (v) => (v == null || v === "" ? dash : esc(v));
const when = (iso) => (iso ? `${dayParts(dayKey(iso)).dm} ${fmtTime.format(new Date(iso))}` : dash);
const empty = (msg) => `<p class="af-empty">${esc(msg)}</p>`;
const sec = (title, body, { open = false, note = "" } = {}) =>
  `<details class="af-sec"${open ? " open" : ""}><summary>${esc(title)}${note ? `<small>${esc(note)}</small>` : ""}</summary><div class="af-body">${body}</div></details>`;
const kv = (rows) => `<dl class="af-kv">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join("")}</dl>`;
const table = (head, rows) =>
  `<div class="af-scroll"><table class="af-t"><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
const bar = (label, v) => {
  const n = Math.max(0, Math.min(100, parseFloat(v) || 0));
  return `<div class="af-bar"><span>${esc(label)}</span><i style="width:${n}%"></i><b>${val(v)}</b></div>`;
};
const yesNo = (v) => (v == null ? dash : v ? "Sì" : "No");

/** "-3.5" -> "Under 3,5"; "+2.5" -> "Over 2,5" (così API-Football indica il mercato gol consigliato). */
export function uoText(v) {
  const n = Number(String(v ?? "").replace("+", ""));
  if (!Number.isFinite(n) || v == null || v === "") return val(v);
  return n < 0 ? `Under ${num(Math.abs(n), 1)}` : `Over ${num(n, 1)}`;
}

/* ---------- Sezioni ---------- */
function matchInfo(d) {
  const f = d.fixture;
  if (!f) return empty("Dati della partita non disponibili.");
  const fx = f.fixture ?? {};
  const st = fx.status ?? {};
  const g = f.goals ?? {};
  const ht = f.score?.halftime ?? {};
  const ft = f.score?.fulltime ?? {};
  const score = g.home == null ? dash : `${esc(g.home)} – ${esc(g.away)}`;
  const rows = [
    ["Stato", `${val(st.long)}${st.elapsed ? ` (${esc(st.elapsed)}')` : ""}`],
    ["Orario", when(fx.date)],
    ["Stadio", val([fx.venue?.name, fx.venue?.city].filter(Boolean).join(", "))],
    ["Campionato", val([f.league?.name, f.league?.country].filter(Boolean).join(" · "))],
    ["Turno", val(f.league?.round)],
    ["Stagione", val(f.league?.season)],
    ["Risultato", score],
  ];
  if (ht.home != null) rows.push(["Primo tempo", `${esc(ht.home)} – ${esc(ht.away)}`]);
  if (ft.home != null && g.home != null && (ft.home !== g.home || ft.away !== g.away)) rows.push(["90 minuti", `${esc(ft.home)} – ${esc(ft.away)}`]);
  rows.push(["ID API-Football", val(d.apiFixtureId)]);
  return kv(rows);
}

function predictions(p) {
  if (!p) return empty("Pronostico non disponibile per questa partita (il provider non lo calcola per tutti i campionati).");
  const pr = p.predictions ?? {};
  const pc = pr.percent ?? {};
  const out = [];
  out.push(kv([
    ["Consiglio", val(pr.advice)],
    ["Vincente probabile", pr.winner?.name ? `${esc(pr.winner.name)}${pr.winner.comment ? ` <small>(${esc(pr.winner.comment)})</small>` : ""}` : dash],
    ["Doppia chance", yesNo(pr.win_or_draw)],
    ["Gol totali (Under/Over)", uoText(pr.under_over)],
    ["Gol casa / trasferta", `${val(pr.goals?.home)} / ${val(pr.goals?.away)}`],
  ]));
  out.push(`<div class="af-bars">${bar("1", pc.home)}${bar("X", pc.draw)}${bar("2", pc.away)}</div>`);
  const cmp = p.comparison;
  if (cmp) {
    const labels = { form: "Forma", att: "Attacco", def: "Difesa", poisson_distribution: "Distribuzione di Poisson", h2h: "Scontri diretti", goals: "Gol", total: "Totale" };
    out.push(`<h5>Confronto tra le squadre</h5>${table(["", d_home(p), d_away(p)], Object.entries(labels).filter(([k]) => cmp[k]).map(([k, l]) => [esc(l), val(cmp[k].home), val(cmp[k].away)]))}`);
  }
  const l5 = (t) => t?.last_5;
  if (l5(p.teams?.home) || l5(p.teams?.away)) {
    const row = (label, fn) => [esc(label), fn(p.teams?.home), fn(p.teams?.away)];
    out.push(`<h5>Ultime 5 partite</h5>${table(["", d_home(p), d_away(p)], [
      row("Forma", (t) => val(l5(t)?.form)),
      row("Attacco", (t) => val(l5(t)?.att)),
      row("Difesa", (t) => val(l5(t)?.def)),
      row("Gol fatti (media)", (t) => val(l5(t)?.goals?.for?.average)),
      row("Gol subiti (media)", (t) => val(l5(t)?.goals?.against?.average)),
    ])}`);
  }
  return out.join("");
}
const d_home = (p) => p.teams?.home?.name ?? "Casa";
const d_away = (p) => p.teams?.away?.name ?? "Trasferta";

const cell = (x) => (x ? `${num(x.best.odd)}<small> ${esc(x.best.book)} · mediana ${num(x.median)} · ${x.n} book.</small>` : dash);

function odds(o) {
  if (!o || !o.bookmakers) return empty("Quote non disponibili per questa partita (nessun bookmaker le ha ancora pubblicate o il campionato non è coperto).");
  const out = [];
  out.push(`<h5>Over/Under 2,5 gol</h5>${o.ou25 ? table(["Over 2,5", "Under 2,5"], [[cell(o.ou25.over), cell(o.ou25.under)]]) : empty("Linea 2,5 non quotata.")}`);
  if (o.goalLines?.length) out.push(`<h5>Tutte le linee gol</h5>${table(["Linea", "Over", "Under"], o.goalLines.map((l) => [num(l.line, 1), cell(l.over), cell(l.under)]))}`);
  out.push(`<h5>Calci d'angolo${o.corners?.mainLine != null ? ` · linea principale ${num(o.corners.mainLine, 1)}` : ""}</h5>`);
  out.push(o.corners?.lines?.length ? table(["Linea", "Over", "Under"], o.corners.lines.map((l) => [num(l.line, 1), cell(l.over), cell(l.under)])) : empty("Quote sui corner non disponibili per questa partita."));
  out.push(`<p class="af-note">Miglior quota e mediana tra ${esc(o.bookmakers)} bookmaker.</p>`);
  return out.join("");
}

function injuries(d) {
  const list = d.injuries ?? [];
  const cov = d.coverage?.injuries;
  if (!list.length) return empty(cov === false ? "Il campionato non ha la copertura infortuni su API-Football." : "Nessun assente segnalato da API-Football.");
  const by = new Map();
  for (const x of list) { const t = x.team?.name ?? "—"; (by.get(t) ?? by.set(t, []).get(t)).push(x); }
  return [...by].map(([team, rows]) => `<h5>${esc(team)} · ${rows.length}</h5>${table(["Giocatore", "Tipo", "Motivo"], rows.map((r) => [val(r.player?.name), val(r.player?.type), val(r.player?.reason)]))}`).join("");
}

function refereeCoaches(d) {
  const f = d.fixture;
  const ref = f?.fixture?.referee;
  const coach = (c) => (c ? `${esc(c.name)}<small>${[c.nationality, c.age ? `${c.age} anni` : null, c.since ? `dal ${c.since}` : null].filter(Boolean).map(esc).join(" · ")}</small>` : dash);
  return kv([
    ["Arbitro", ref ? esc(ref) : "Non ancora designato"],
    [`Allenatore ${esc(d.game?.home ?? "casa")}`, coach(d.coaches?.home)],
    [`Allenatore ${esc(d.game?.away ?? "trasferta")}`, coach(d.coaches?.away)],
  ]);
}

function lineups(f) {
  const L = f?.lineups ?? [];
  if (!L.length) return empty("Formazioni non ancora pubblicate (di solito circa un'ora prima del calcio d'inizio).");
  return L.map((t) => `<h5>${esc(t.team?.name)} · ${val(t.formation)} · all. ${val(t.coach?.name)}</h5>
    ${table(["N.", "Titolare", "Ruolo"], (t.startXI ?? []).map((x) => [val(x.player?.number), val(x.player?.name), val(x.player?.pos)]))}
    ${(t.substitutes ?? []).length ? `<p class="af-note">Panchina: ${(t.substitutes ?? []).map((x) => `${esc(x.player?.name)}${x.player?.number ? ` (${esc(x.player.number)})` : ""}`).join(", ")}</p>` : ""}`).join("");
}

const eventLabel = (e) => {
  const d = e.detail ?? "";
  if (e.type === "Goal") return d === "Own Goal" ? "Autogol" : d === "Penalty" ? "Gol su rigore" : d === "Missed Penalty" ? "Rigore sbagliato" : "Gol";
  if (e.type === "Card") return /red/i.test(d) ? "Espulsione" : "Ammonizione";
  if (e.type === "subst") return "Sostituzione";
  if (e.type === "Var") return `VAR: ${d}`;
  return `${e.type ?? ""} ${d}`.trim();
};
function events(f) {
  const E = f?.events ?? [];
  if (!E.length) return empty("Nessun evento (la partita non è ancora iniziata o non ci sono eventi registrati).");
  return table(["Min.", "Squadra", "Evento", "Giocatore"], E.map((e) => [
    `${esc(e.time?.elapsed ?? "")}${e.time?.extra ? `+${esc(e.time.extra)}` : ""}'`, val(e.team?.name), esc(eventLabel(e)),
    `${val(e.player?.name)}${e.assist?.name ? `<small>${e.type === "subst" ? "entra" : "assist"}: ${esc(e.assist.name)}</small>` : ""}`,
  ]));
}

const STAT_IT = {
  "Shots on Goal": "Tiri in porta", "Shots off Goal": "Tiri fuori", "Total Shots": "Tiri totali", "Blocked Shots": "Tiri bloccati", "Shots insidebox": "Tiri in area", "Shots outsidebox": "Tiri da fuori",
  Fouls: "Falli", "Corner Kicks": "Calci d'angolo", Offsides: "Fuorigioco", "Ball Possession": "Possesso palla", "Yellow Cards": "Ammonizioni", "Red Cards": "Espulsioni", "Goalkeeper Saves": "Parate",
  "Total passes": "Passaggi", "Passes accurate": "Passaggi riusciti", "Passes %": "Precisione passaggi", expected_goals: "Gol attesi (xG)", goals_prevented: "Gol evitati",
};
function statistics(f) {
  const S = f?.statistics ?? [];
  if (S.length < 2) return empty("Statistiche non disponibili (si popolano a partita in corso o finita).");
  const [h, a] = S;
  const get = (t, type) => (t.statistics ?? []).find((x) => x.type === type)?.value;
  const types = [...new Set([...(h.statistics ?? []), ...(a.statistics ?? [])].map((x) => x.type))];
  return table(["Statistica", h.team?.name ?? "Casa", a.team?.name ?? "Trasferta"], types.map((t) => [esc(STAT_IT[t] ?? t), val(get(h, t)), val(get(a, t))]));
}

function players(f) {
  const P = f?.players ?? [];
  if (!P.length) return empty("Statistiche dei giocatori non disponibili (partita non ancora giocata).");
  return P.map((t) => {
    const rows = (t.players ?? []).map((p) => ({ p, s: p.statistics?.[0] ?? {} })).filter(({ s }) => (s.games?.minutes ?? 0) > 0);
    rows.sort((x, y) => (Number(y.s.games?.rating) || 0) - (Number(x.s.games?.rating) || 0));
    return `<h5>${esc(t.team?.name)}</h5>${table(["Giocatore", "Ruolo", "Min.", "Voto", "Gol", "Assist", "Cart."], rows.map(({ p, s }) => [
      val(p.player?.name), val(s.games?.position), val(s.games?.minutes), val(s.games?.rating ? num(s.games.rating, 1) : null), val(s.goals?.total ?? 0), val(s.goals?.assists ?? 0),
      `${s.cards?.yellow ? `${esc(s.cards.yellow)}G ` : ""}${s.cards?.red ? `${esc(s.cards.red)}R` : ""}` || dash,
    ]))}`;
  }).join("");
}

function h2h(list) {
  if (!list?.length) return empty("Nessuno scontro diretto registrato.");
  const played = list.filter((x) => x.goals?.home != null);
  const over25 = played.filter((x) => x.goals.home + x.goals.away > 2.5).length;
  const avg = played.length ? played.reduce((t, x) => t + x.goals.home + x.goals.away, 0) / played.length : null;
  const head = played.length ? `<p class="af-note">Ultimi ${played.length} scontri: Over 2,5 in <b>${over25}</b> su ${played.length} · media <b>${num(avg)}</b> gol a partita.</p>` : "";
  return head + table(["Data", "Competizione", "Partita"], list.map((x) => [esc((x.fixture?.date ?? "").slice(0, 10)), val(x.league?.name), `${esc(x.teams?.home?.name)} <b>${val(x.goals?.home)}–${val(x.goals?.away)}</b> ${esc(x.teams?.away?.name)}`]));
}

function standings(d) {
  const groups = d.standings ?? [];
  if (!groups.length) return empty("Classifica non disponibile per questa competizione.");
  const ids = [d.fixture?.teams?.home?.id, d.fixture?.teams?.away?.id].filter(Boolean);
  const group = groups.find((g) => g.some((r) => ids.includes(r.team?.id))) ?? groups[0];
  return table(["#", "Squadra", "G", "V-N-P", "GF-GS", "DR", "Pt", "Forma"], group.map((r) => {
    const mine = ids.includes(r.team?.id);
    const w = (x) => (mine ? `<b>${x}</b>` : x);
    return [w(val(r.rank)), w(val(r.team?.name)), val(r.all?.played), `${val(r.all?.win)}-${val(r.all?.draw)}-${val(r.all?.lose)}`, `${val(r.all?.goals?.for)}-${val(r.all?.goals?.against)}`, val(r.goalsDiff), w(val(r.points)), val(r.form)];
  }));
}

function seasonStats(d) {
  const h = d.teamStats?.home, a = d.teamStats?.away;
  if (!h && !a) return empty("Statistiche stagionali non disponibili.");
  const pair = (fn) => [fn(h), fn(a)];
  const t3 = (o) => (o ? `${val(o.total)} <small>casa ${val(o.home)} · trasf. ${val(o.away)}</small>` : dash);
  const rows = [
    ["Forma recente", ...pair((t) => val(t?.form ? t.form.slice(-10) : null))],
    ["Partite giocate", ...pair((t) => t3(t?.fixtures?.played))],
    ["Vittorie", ...pair((t) => t3(t?.fixtures?.wins))],
    ["Pareggi", ...pair((t) => t3(t?.fixtures?.draws))],
    ["Sconfitte", ...pair((t) => t3(t?.fixtures?.loses))],
    ["Gol fatti", ...pair((t) => t3(t?.goals?.for?.total))],
    ["Gol fatti (media)", ...pair((t) => t3(t?.goals?.for?.average))],
    ["Gol subiti", ...pair((t) => t3(t?.goals?.against?.total))],
    ["Gol subiti (media)", ...pair((t) => t3(t?.goals?.against?.average))],
    ["Porta inviolata", ...pair((t) => t3(t?.clean_sheet))],
    ["Senza segnare", ...pair((t) => t3(t?.failed_to_score))],
    ["Moduli più usati", ...pair((t) => val((t?.lineups ?? []).slice().sort((x, y) => y.played - x.played).slice(0, 3).map((x) => `${x.formation} (${x.played})`).join(", ")))],
  ];
  return table(["", d.game?.home ?? "Casa", d.game?.away ?? "Trasferta"], rows);
}

const FRESH_IT = { fixture: "Partita", injuries: "Infortuni", predictions: "Pronostico", oddsGoals: "Quote gol", oddsCorners: "Quote corner", standings: "Classifica", coverage: "Copertura", h2h: "Scontri diretti", teamHome: "Statistiche casa", teamAway: "Statistiche trasferta", coachHome: "Allenatore casa", coachAway: "Allenatore trasferta", bets: "Elenco mercati" };
function coverage(d) {
  const c = d.coverage;
  const out = [];
  if (c) {
    out.push(`<h5>Cosa copre API-Football in questo campionato</h5>${table(["Dato", "Disponibile"], [
      ["Eventi", yesNo(c.fixtures?.events)], ["Formazioni", yesNo(c.fixtures?.lineups)], ["Statistiche di squadra", yesNo(c.fixtures?.statistics_fixtures)], ["Statistiche dei giocatori", yesNo(c.fixtures?.statistics_players)],
      ["Classifica", yesNo(c.standings)], ["Infortuni", yesNo(c.injuries)], ["Pronostici", yesNo(c.predictions)], ["Quote", yesNo(c.odds)],
    ].map(([a, b]) => [esc(a), b]))}`);
  }
  const fr = Object.entries(d.freshness ?? {});
  if (fr.length) {
    out.push(`<h5>Aggiornamento dei dati</h5>${table(["Dato", "Fonte", "Scaricato", "Esito"], fr.map(([k, v]) => [esc(FRESH_IT[k] ?? k), v.source === "live" ? "API-Football" : "memoria", when(v.fetchedAt), v.error ? `<span class="af-err">${esc(v.error)}</span>${v.stale ? " (dato precedente)" : ""}` : "ok"]))}`);
  }
  if (d.usage) out.push(`<p class="af-note">Richieste a API-Football oggi: ${val(d.usage.requests)} · residuo giornaliero ${val(d.usage.remaining)} su ${val(d.usage.limit)}.</p>`);
  return out.join("") || empty("Nessuna informazione.");
}

/** Pagina completa. `d` = risposta di /api/match-detail. */
export function renderAfDetail(d) {
  if (!d) return empty("Nessun dato.");
  if (d.mapped === false) return `<p class="af-empty">${esc(d.reason ?? "Partita non collegata ad API-Football.")}</p>`;
  const f = d.fixture;
  const errors = Object.entries(d.freshness ?? {}).filter(([, v]) => v.error && !v.stale && !v.deferred).map(([k]) => FRESH_IT[k] ?? k);
  const warn = errors.length ? `<p class="af-warn">Alcuni dati non sono stati ricevuti: ${esc(errors.join(", "))}. Dettagli in fondo, in “Copertura e aggiornamento”.</p>` : "";
  return `${warn}
    ${sec("Partita", matchInfo(d), { open: true })}
    ${sec("Pronostico di API-Football", predictions(d.predictions), { open: true })}
    ${sec("Quote: Over/Under gol e corner", odds(d.odds), { open: true })}
    ${sec("Infortunati e squalificati", injuries(d), { open: true, note: String((d.injuries ?? []).length) })}
    ${sec("Arbitro e allenatori", refereeCoaches(d), { open: true })}
    ${sec("Formazioni", lineups(f))}
    ${sec("Eventi", events(f))}
    ${sec("Statistiche della partita", statistics(f))}
    ${sec("Giocatori della partita", players(f))}
    ${sec("Scontri diretti", h2h(d.h2h))}
    ${sec("Classifica", standings(d))}
    ${sec("Statistiche stagionali delle squadre", seasonStats(d))}
    ${sec("Copertura e aggiornamento dati", coverage(d))}`;
}
