/**
 * Schermata "Dati API-Football" di una partita: trasforma la risposta di /api/match-detail in sezioni (HTML).
 * Funzioni pure: ricevono i dati e restituiscono testo, senza toccare la pagina. Ogni valore dinamico passa da esc().
 */
import { dayKey, dayParts, esc, fmtTime, num } from "./format.js";
import { crest as crestBase, initials } from "./ui.js";
import { adviceIt, commentIt, countryIt, eventIt, injuryTypeIt, posShortIt, reasonIt, roundIt } from "../functions/api/_it.js";

const dash = "—";
const val = (v) => (v == null || v === "" ? dash : esc(v));
const when = (iso) => (iso ? `${dayParts(dayKey(iso)).dm} ${fmtTime.format(new Date(iso))}` : dash);
const empty = (msg) => `<p class="af-empty">${esc(msg)}</p>`;

/* Icone (tratto, 24x24) usate nelle intestazioni delle sezioni */
const ICON = {
  match: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  pred: '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  odds: '<path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.2"/>',
  injuries: '<path d="M3 12h4l2-5 4 10 2-5h6"/>',
  people: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  lineups: '<circle cx="9" cy="8" r="3.5"/><path d="M2 21a7 7 0 0 1 14 0"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14.5a5.5 5.5 0 0 1 5 5.5"/>',
  events: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
  stats: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  h2h: '<path d="M7 7h13l-3-3M17 17H4l3 3"/>',
  table: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4"/>',
  season: '<path d="M3 3v18h18"/><path d="M7 15l4-4 3 3 5-6"/>',
  shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/><path d="M9 12l2 2 4-4"/>',
  pin: '<path d="M12 21s7-6.2 7-11a7 7 0 0 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  alert: '<path d="M12 3l10 18H2z"/><path d="M12 10v5M12 18h.01"/>',
};
const svg = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${ICON[name]}</svg>`;

const sec = (title, body, { open = false, note = "", icon = "match", tone = "slate" } = {}) =>
  `<details class="af-sec"${open ? " open" : ""}><summary><span class="af-ic" data-tone="${tone}">${svg(icon)}</span><span class="af-st">${esc(title)}</span>${note ? `<small>${esc(note)}</small>` : ""}<i class="af-chev" aria-hidden="true"></i></summary><div class="af-body">${body}</div></details>`;
const kv = (rows) => `<dl class="af-kv">${rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${v}</dd></div>`).join("")}</dl>`;
const table = (head, rows, { rowCls = [], numCols = [] } = {}) =>
  `<div class="af-scroll"><table class="af-t"><thead><tr>${head.map((h, i) => `<th${numCols.includes(i) ? ' class="n"' : ""}>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r, ri) => `<tr${rowCls[ri] ? ` class="${rowCls[ri]}"` : ""}>${r.map((c, i) => `<td${numCols.includes(i) ? ' class="n"' : ""}>${c}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
const yesNo = (v) => (v == null ? dash : v ? '<span class="af-pill ok">Sì</span>' : '<span class="af-pill off">No</span>');

const crest = (name, logo) => crestBase(name, logo, "af-crest");
const mini = (name, logo) => crestBase(name, logo, "crest sm");
const teamCell = (t) => `<span class="tcell">${mini(t?.name, t?.logo)}<span>${val(t?.name)}</span></span>`;

const STATUS_IT = { TBD: "Da definire", NS: "Da giocare", "1H": "Primo tempo", HT: "Intervallo", "2H": "Secondo tempo", ET: "Supplementari", BT: "Pausa", P: "Rigori", SUSP: "Sospesa", INT: "Interrotta", LIVE: "In corso", FT: "Finita", AET: "Dopo supplementari", PEN: "Dopo i rigori", PST: "Rinviata", CANC: "Annullata", ABD: "Abbandonata", AWD: "A tavolino", WO: "A tavolino" };
const statusTone = (short) => (["1H", "HT", "2H", "ET", "BT", "P", "LIVE", "SUSP", "INT"].includes(short) ? "live" : ["FT", "AET", "PEN", "AWD", "WO"].includes(short) ? "ft" : ["PST", "CANC", "ABD"].includes(short) ? "off" : "ns");

/** Confronto a due lati: valore casa a sinistra, trasferta a destra, barra proporzionale (verde = casa, blu = trasferta). */
const splitRow = (label, h, a, { lower = false } = {}) => {
  const n = (v) => { const x = parseFloat(String(v ?? "").replace(",", ".")); return Number.isFinite(x) && x >= 0 ? x : null; };
  const hn = n(h), an = n(a);
  const none = hn == null || an == null || hn + an === 0;
  const hv = none ? 1 : hn, av = none ? 1 : an;
  const cls = none || hn === an ? (none ? "none" : "") : (hn > an) !== lower ? "lead-h" : "lead-a";
  return `<div class="af-split ${cls}"><div class="af-split-head"><b>${val(h)}</b><span>${esc(label)}</span><b>${val(a)}</b></div><div class="af-split-bar"><i style="flex:${hv}"></i><u style="flex:${av}"></u></div></div>`;
};
const splitTeams = (home, away) => `<div class="af-split-teams"><span class="h">${esc(home)}</span><span class="a">${esc(away)}</span></div>`;

/** "-3.5" -> "Under 3,5"; "+2.5" -> "Over 2,5" (così API-Football indica il mercato gol consigliato). */
export function uoText(v) {
  const n = Number(String(v ?? "").replace("+", ""));
  if (!Number.isFinite(n) || v == null || v === "") return val(v);
  return n < 0 ? `Under ${num(Math.abs(n), 1)}` : `Over ${num(n, 1)}`;
}

/* ---------- Sezioni ---------- */
function matchHero(d) {
  const f = d.fixture;
  const g0 = d.game ?? {};
  const fx = f?.fixture ?? {};
  const st = fx.status ?? {};
  const goals = f?.goals ?? {};
  const home = f?.teams?.home?.name ?? g0.home ?? "Casa";
  const away = f?.teams?.away?.name ?? g0.away ?? "Trasferta";
  const logoH = f?.teams?.home?.logo ?? d.predictions?.teams?.home?.logo ?? d.crests?.home;
  const logoA = f?.teams?.away?.logo ?? d.predictions?.teams?.away?.logo ?? d.crests?.away;
  const iso = fx.date ?? g0.kickoffAt ?? null;
  const tone = statusTone(st.short);
  const played = goals.home != null;
  const centre = played
    ? `<strong class="af-big">${esc(goals.home)}<i>–</i>${esc(goals.away)}</strong><small>${iso ? esc(when(iso)) : ""}</small>`
    : iso ? `<strong class="af-big">${esc(fmtTime.format(new Date(iso)))}</strong><small>${esc(dayParts(dayKey(iso)).long)}</small>` : `<strong class="af-big">${dash}</strong>`;
  const statusText = STATUS_IT[st.short] ?? st.long ?? (f ? "" : "");
  const chips = [f?.league?.name, roundIt(f?.league?.round)].filter(Boolean).map((x) => `<span class="af-chip">${esc(x)}</span>`).join("");
  const venue = [fx.venue?.name, fx.venue?.city].filter(Boolean).join(", ");
  return `<header class="af-hero">
    <div class="af-hero-top">${chips}${statusText ? `<span class="af-status ${tone}">${tone === "live" ? "<b></b>" : ""}${esc(statusText)}${st.elapsed && tone === "live" ? ` ${esc(st.elapsed)}'` : ""}</span>` : ""}</div>
    <div class="af-versus">
      <div class="af-team">${crest(home, logoH)}<b>${esc(home)}</b></div>
      <div class="af-centre">${centre}</div>
      <div class="af-team">${crest(away, logoA)}<b>${esc(away)}</b></div>
    </div>
    ${venue ? `<p class="af-venue">${svg("pin")}<span>${esc(venue)}</span></p>` : ""}
  </header>`;
}

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
    ["Stato", `${val(STATUS_IT[st.short] ?? st.long)}${st.elapsed ? ` (${esc(st.elapsed)}')` : ""}`],
    ["Orario", when(fx.date)],
    ["Stadio", val([fx.venue?.name, fx.venue?.city].filter(Boolean).join(", "))],
    ["Campionato", val([f.league?.name, countryIt(f.league?.country)].filter(Boolean).join(" · "))],
    ["Turno", val(roundIt(f.league?.round))],
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
  const winner = pr.winner?.name ? `${esc(pr.winner.name)}${pr.winner.comment ? ` <small>(${esc(commentIt(pr.winner.comment))})</small>` : ""}` : null;
  const adv = adviceIt(pr.advice, d_home(p), d_away(p));
  out.push(`<div class="af-advice"><small>Consiglio di API-Football</small><strong>${adv ? esc(adv.label) : dash}</strong>${adv && adv.long !== adv.label ? `<span>${esc(adv.long)}</span>` : ""}${winner ? `<span>Vincente probabile: ${winner}</span>` : ""}</div>`);
  out.push(`<div class="af-tiles">
    <div><small>Doppia chance</small><b>${yesNo(pr.win_or_draw)}</b></div>
    <div><small>Gol totali</small><b>${uoText(pr.under_over)}</b></div>
    <div><small>Gol casa</small><b>${uoText(pr.goals?.home)}</b></div>
    <div><small>Gol trasferta</small><b>${uoText(pr.goals?.away)}</b></div>
  </div>`);
  const pct = (v) => { const x = parseFloat(v); return Number.isFinite(x) && x > 0 ? x : 0; };
  const [ph, pd, pa] = [pct(pc.home), pct(pc.draw), pct(pc.away)];
  if (ph + pd + pa > 0) {
    out.push(`<div class="af-prob"><div class="af-prob-bar"><i class="h" style="flex:${ph}"></i><i class="d" style="flex:${pd}"></i><i class="a" style="flex:${pa}"></i></div>
      <div class="af-prob-leg"><div class="h"><b>${val(pc.home)}</b><span>${esc(d_home(p))}</span></div><div class="d"><b>${val(pc.draw)}</b><span>Pareggio</span></div><div class="a"><b>${val(pc.away)}</b><span>${esc(d_away(p))}</span></div></div></div>`);
  }
  const cmp = p.comparison;
  if (cmp) {
    const labels = { form: "Forma", att: "Attacco", def: "Difesa", poisson_distribution: "Distribuzione di Poisson", h2h: "Scontri diretti", goals: "Gol", total: "Totale" };
    out.push(`<h5>Confronto tra le squadre</h5>${splitTeams(d_home(p), d_away(p))}${Object.entries(labels).filter(([k]) => cmp[k]).map(([k, l]) => splitRow(l, cmp[k].home, cmp[k].away)).join("")}`);
  }
  const l5 = (t) => t?.last_5;
  if (l5(p.teams?.home) || l5(p.teams?.away)) {
    const row = (label, fn, opts) => splitRow(label, fn(p.teams?.home), fn(p.teams?.away), opts);
    out.push(`<h5>Ultime 5 partite</h5>${splitTeams(d_home(p), d_away(p))}${[
      row("Forma", (t) => l5(t)?.form),
      row("Attacco", (t) => l5(t)?.att),
      row("Difesa", (t) => l5(t)?.def),
      row("Gol fatti (media)", (t) => l5(t)?.goals?.for?.average),
      row("Gol subiti (media)", (t) => l5(t)?.goals?.against?.average, { lower: true }),
    ].join("")}`);
  }
  return out.join("");
}
const d_home = (p) => p.teams?.home?.name ?? "Casa";
const d_away = (p) => p.teams?.away?.name ?? "Trasferta";

const cell = (x) => (x ? `<b class="af-odd">${num(x.best.odd)}</b><small>${esc(x.best.book)} · mediana ${num(x.median)} · ${x.n} book.</small>` : dash);
const oddTile = (label, x, tone) => `<div class="af-oddtile ${tone}"><small>${esc(label)}</small>${x ? `<strong>${num(x.best.odd)}</strong><span>${esc(x.best.book)} · mediana ${num(x.median)} · ${x.n} book.</span>` : "<strong>—</strong>"}</div>`;

function odds(o) {
  if (!o || !o.bookmakers) return empty("Quote non disponibili per questa partita (nessun bookmaker le ha ancora pubblicate o il campionato non è coperto).");
  const out = [];
  out.push(`<h5>Over/Under 2,5 gol</h5>${o.ou25 ? `<div class="af-oddtiles">${oddTile("Over 2,5", o.ou25.over, "over")}${oddTile("Under 2,5", o.ou25.under, "under")}</div>` : empty("Linea 2,5 non quotata.")}`);
  if (o.goalLines?.length) out.push(`<h5>Tutte le linee gol</h5>${table(["Linea", "Over", "Under"], o.goalLines.map((l) => [`<b>${num(l.line, 1)}</b>`, cell(l.over), cell(l.under)]))}`);
  out.push(`<h5>Calci d'angolo${o.corners?.mainLine != null ? ` · linea principale ${num(o.corners.mainLine, 1)}` : ""}</h5>`);
  out.push(o.corners?.lines?.length ? table(["Linea", "Over", "Under"], o.corners.lines.map((l) => [`<b>${num(l.line, 1)}</b>`, cell(l.over), cell(l.under)]), { rowCls: o.corners.lines.map((l) => (l.line === o.corners.mainLine ? "me" : "")) }) : empty("Quote sui corner non disponibili per questa partita."));
  out.push(`<p class="af-note">Miglior quota e mediana tra ${esc(o.bookmakers)} bookmaker.</p>`);
  return out.join("");
}

function injuries(d) {
  const list = d.injuries ?? [];
  const cov = d.coverage?.injuries;
  if (!list.length) return empty(cov === false ? "Il campionato non ha la copertura infortuni su API-Football." : "Nessun assente segnalato da API-Football.");
  const by = new Map();
  for (const x of list) { const t = x.team?.name ?? "—"; (by.get(t) ?? by.set(t, []).get(t)).push(x); }
  const tone = (t) => (/missing|out|suspen/i.test(String(t ?? "")) ? "err" : /question|doubt/i.test(String(t ?? "")) ? "warn" : "off");
  return [...by].map(([team, rows]) => `<h5 class="with-crest">${mini(team, rows[0]?.team?.logo)}${esc(team)} · ${rows.length}</h5><ul class="af-list">${rows.map((r) => `<li><span class="af-av">${initials(r.player?.name)}</span><div><b>${val(r.player?.name)}</b><small>${val(reasonIt(r.player?.reason))}</small></div><span class="af-pill ${tone(r.player?.type)}">${val(injuryTypeIt(r.player?.type))}</span></li>`).join("")}</ul>`).join("");
}

function refereeCoaches(d) {
  const f = d.fixture;
  const ref = f?.fixture?.referee;
  const coach = (c) => (c ? `${esc(c.name)}<small>${[countryIt(c.nationality), c.age ? `${c.age} anni` : null, c.since ? `dal ${c.since}` : null].filter(Boolean).map(esc).join(" · ")}</small>` : dash);
  return kv([
    ["Arbitro", ref ? esc(String(ref).replace(/,\s*([^,]+)$/, (_, c) => `, ${countryIt(c)}`)) : "Non ancora designato"],
    [`Allenatore ${d.game?.home ?? "casa"}`, coach(d.coaches?.home)],   // kv() fa già l'escape dell'etichetta
    [`Allenatore ${d.game?.away ?? "trasferta"}`, coach(d.coaches?.away)],
  ]);
}

function lineups(f) {
  const L = f?.lineups ?? [];
  if (!L.length) return empty("Formazioni non ancora pubblicate (di solito circa un'ora prima del calcio d'inizio).");
  return L.map((t) => `<h5 class="with-crest">${mini(t.team?.name, t.team?.logo)}${esc(t.team?.name)} · ${val(t.formation)} · all. ${val(t.coach?.name)}</h5>
    ${table(["N.", "Titolare", "Ruolo"], (t.startXI ?? []).map((x) => [val(x.player?.number), val(x.player?.name), val(posShortIt(x.player?.pos))]))}
    ${(t.substitutes ?? []).length ? `<p class="af-note">Panchina: ${(t.substitutes ?? []).map((x) => `${esc(x.player?.name)}${x.player?.number ? ` (${esc(x.player.number)})` : ""}`).join(", ")}</p>` : ""}`).join("");
}

const eventLabel = (e) => eventIt(e.type, e.detail);
const eventKind = (e) => (e.type === "Goal" ? (e.detail === "Missed Penalty" ? "miss" : "goal") : e.type === "Card" ? (/red|second yellow/i.test(e.detail ?? "") ? "red" : "yellow") : e.type === "subst" ? "sub" : "var");
function events(f) {
  const E = f?.events ?? [];
  if (!E.length) return empty("Nessun evento (la partita non è ancora iniziata o non ci sono eventi registrati).");
  const homeId = f?.teams?.home?.id;
  return `<ol class="af-tl">${E.map((e) => `<li class="${e.team?.id != null && e.team.id === homeId ? "home" : "away"}">
    <span class="min">${esc(e.time?.elapsed ?? "")}${e.time?.extra ? `+${esc(e.time.extra)}` : ""}'</span>
    <i class="ev ${eventKind(e)}" aria-hidden="true"></i>
    <div><b>${val(e.player?.name)}</b><small>${esc(eventLabel(e))} · ${val(e.team?.name)}${e.assist?.name ? ` · ${e.type === "subst" ? "entra" : "assist"}: ${esc(e.assist.name)}` : ""}</small></div></li>`).join("")}</ol>`;
}

const STAT_IT = {
  "Shots on Goal": "Tiri in porta", "Shots off Goal": "Tiri fuori", "Total Shots": "Tiri totali", "Blocked Shots": "Tiri bloccati", "Shots insidebox": "Tiri in area", "Shots outsidebox": "Tiri da fuori",
  Fouls: "Falli", "Corner Kicks": "Calci d'angolo", Offsides: "Fuorigioco", "Ball Possession": "Possesso palla", "Yellow Cards": "Ammonizioni", "Red Cards": "Espulsioni", "Goalkeeper Saves": "Parate",
  "Total passes": "Passaggi", "Passes accurate": "Passaggi riusciti", "Passes %": "Precisione passaggi", expected_goals: "Gol attesi (xG)", goals_prevented: "Gol evitati",
};
const LOWER_BETTER = new Set(["Fouls", "Offsides", "Yellow Cards", "Red Cards"]);
function statistics(f) {
  const S = f?.statistics ?? [];
  if (S.length < 2) return empty("Statistiche non disponibili (si popolano a partita in corso o finita).");
  const [h, a] = S;
  const get = (t, type) => (t.statistics ?? []).find((x) => x.type === type)?.value;
  const types = [...new Set([...(h.statistics ?? []), ...(a.statistics ?? [])].map((x) => x.type))];
  return splitTeams(h.team?.name ?? "Casa", a.team?.name ?? "Trasferta") + types.map((t) => splitRow(STAT_IT[t] ?? t, get(h, t), get(a, t), { lower: LOWER_BETTER.has(t) })).join("");
}

const rating = (r) => {
  const n = Number(r);
  if (!r || !Number.isFinite(n)) return dash;
  return `<span class="af-rate ${n >= 7.5 ? "hi" : n >= 6.5 ? "mid" : "lo"}">${num(n, 1)}</span>`;
};
function players(f) {
  const P = f?.players ?? [];
  if (!P.length) return empty("Statistiche dei giocatori non disponibili (partita non ancora giocata).");
  return P.map((t) => {
    const rows = (t.players ?? []).map((p) => ({ p, s: p.statistics?.[0] ?? {} })).filter(({ s }) => (s.games?.minutes ?? 0) > 0);
    rows.sort((x, y) => (Number(y.s.games?.rating) || 0) - (Number(x.s.games?.rating) || 0));
    return `<h5>${esc(t.team?.name)}</h5>${table(["Giocatore", "Ruolo", "Min.", "Voto", "Gol", "Assist", "Cart."], rows.map(({ p, s }) => [
      val(p.player?.name), val(posShortIt(s.games?.position)), val(s.games?.minutes), rating(s.games?.rating), val(s.goals?.total ?? 0), val(s.goals?.assists ?? 0),
      `${s.cards?.yellow ? `${esc(s.cards.yellow)}G ` : ""}${s.cards?.red ? `${esc(s.cards.red)}R` : ""}` || dash,
    ]), { numCols: [2, 3, 4, 5, 6] })}`;
  }).join("");
}

function h2h(list) {
  if (!list?.length) return empty("Nessuno scontro diretto registrato.");
  const played = list.filter((x) => x.goals?.home != null);
  const over25 = played.filter((x) => x.goals.home + x.goals.away > 2.5).length;
  const avg = played.length ? played.reduce((t, x) => t + x.goals.home + x.goals.away, 0) / played.length : null;
  const head = played.length ? `<p class="af-note">Ultimi ${played.length} scontri: Over 2,5 in <b>${over25}</b> su ${played.length} · media <b>${num(avg)}</b> gol a partita.</p>` : "";
  return head + `<ul class="af-list af-h2h">${list.map((x) => `<li><div><small>${esc((x.fixture?.date ?? "").slice(0, 10))} · ${val(x.league?.name)}</small><span class="h2h-t">${mini(x.teams?.home?.name, x.teams?.home?.logo)}${esc(x.teams?.home?.name)} <em>vs</em> ${mini(x.teams?.away?.name, x.teams?.away?.logo)}${esc(x.teams?.away?.name)}</span></div><b class="af-sc">${val(x.goals?.home)}–${val(x.goals?.away)}</b></li>`).join("")}</ul>`;
}

const FORM_CLS = { W: "w", D: "d", L: "l" };
const FORM_IT = { W: "V", D: "N", L: "P" };
const formBadges = (str) => (str ? `<span class="af-form">${[...String(str).slice(-5)].map((c) => `<i class="${FORM_CLS[c] ?? "d"}">${esc(FORM_IT[c] ?? c)}</i>`).join("")}</span>` : dash);
function standings(d) {
  const groups = d.standings ?? [];
  if (!groups.length) return empty("Classifica non disponibile per questa competizione.");
  const ids = [d.fixture?.teams?.home?.id, d.fixture?.teams?.away?.id].filter(Boolean);
  const group = groups.find((g) => g.some((r) => ids.includes(r.team?.id))) ?? groups[0];
  return table(["#", "Squadra", "G", "V-N-P", "GF-GS", "DR", "Pt", "Forma"], group.map((r) => [
    val(r.rank), teamCell(r.team), val(r.all?.played), `${val(r.all?.win)}-${val(r.all?.draw)}-${val(r.all?.lose)}`, `${val(r.all?.goals?.for)}-${val(r.all?.goals?.against)}`, val(r.goalsDiff), `<b>${val(r.points)}</b>`, formBadges(r.form),
  ]), { rowCls: group.map((r) => (ids.includes(r.team?.id) ? "me" : "")), numCols: [0, 2, 3, 4, 5, 6] });
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
  return table(["", d.game?.home ?? "Casa", d.game?.away ?? "Trasferta"], rows, { rowCls: [] });
}

const FRESH_IT = { fixture: "Partita", injuries: "Infortuni", predictions: "Pronostico", oddsGoals: "Quote gol", odds1x2: "Quote 1X2", oddsCorners: "Quote corner", standings: "Classifica", coverage: "Copertura", h2h: "Scontri diretti", teamHome: "Statistiche casa", teamAway: "Statistiche trasferta", coachHome: "Allenatore casa", coachAway: "Allenatore trasferta", bets: "Elenco mercati" };
function coverage(d) {
  const c = d.coverage;
  const out = [];
  if (c) {
    const items = [
      ["Eventi", c.fixtures?.events], ["Formazioni", c.fixtures?.lineups], ["Statistiche di squadra", c.fixtures?.statistics_fixtures], ["Statistiche dei giocatori", c.fixtures?.statistics_players],
      ["Classifica", c.standings], ["Infortuni", c.injuries], ["Pronostici", c.predictions], ["Quote", c.odds],
    ];
    out.push(`<h5>Cosa copre API-Football in questo campionato</h5><ul class="af-cov">${items.map(([k, v]) => `<li class="${v == null ? "na" : v ? "yes" : "no"}"><i aria-hidden="true">${v ? "✓" : v == null ? "·" : "✕"}</i>${esc(k)}</li>`).join("")}</ul>`);
  }
  const fr = Object.entries(d.freshness ?? {});
  if (fr.length) {
    out.push(`<h5>Aggiornamento dei dati</h5><ul class="af-fresh">${fr.map(([k, v]) => `<li><div class="af-fr-row"><b>${esc(FRESH_IT[k] ?? k)}</b><span class="src">${v.source === "live" ? "API-Football" : "memoria"} · ${when(v.fetchedAt)}</span>${v.deferred ? `<span class="af-pill warn">in attesa</span>` : v.error ? `<span class="af-pill err">errore</span>` : `<span class="af-pill ok">ok</span>`}</div>${v.error ? `<p class="${v.deferred ? "af-wait" : "af-err"}">${esc(v.error)}${v.stale ? " (dato precedente)" : ""}</p>` : ""}</li>`).join("")}</ul>`);
  }
  if (d.usage) {
    const used = Number(d.usage.limit) > 0 && d.usage.remaining != null ? Math.max(0, Math.min(100, 100 - (Number(d.usage.remaining) / Number(d.usage.limit)) * 100)) : 0;
    out.push(`<div class="af-usage"><div class="af-meter"><i style="width:${used.toFixed(1)}%"></i></div><p class="af-note">Richieste a API-Football oggi: ${val(d.usage.requests)} · residuo giornaliero ${val(d.usage.remaining)} su ${val(d.usage.limit)}.</p></div>`);
  }
  return out.join("") || empty("Nessuna informazione.");
}

const GOAL_KEY = /^(over|under)(15|25|35)$/;
const X12_KEY = /^(home|draw|away)$/;
const soonOf = (fr) => (keys, body) => (keys.some((k) => fr[k]?.deferred) && body.includes('class="af-empty"') ? `<p class="af-empty"><i class="af-spin" aria-hidden="true"></i> In arrivo: sto scaricando questi dati…</p>` : body);

/** Solo le linee Over/Under che l'app consiglia, con la quota del mercato a confronto con la quota minima. */
function recLines(d, rec) {
  const goalRecs = (rec ?? []).filter((r) => GOAL_KEY.test(r.key) || X12_KEY.test(r.key));
  if (!goalRecs.length) return empty("Nessuna linea Over/Under o esito 1X2 consigliato per questa partita.");
  const o = d.odds;
  return goalRecs.map((r) => {
    if (X12_KEY.test(r.key)) {                                       // 1X2: quota diretta del mercato "Match Winner"
      const x = o?.x12?.[r.key] ?? null, best = x?.best?.odd ?? null;
      const state = best == null ? `<span class="af-pill off">quota non ancora pubblicata</span>` : r.minOdds != null && best >= r.minOdds ? `<span class="af-pill ok">quota di valore</span>` : `<span class="af-pill warn">sotto la minima</span>`;
      return `<div class="af-rec"><div class="l"><b>${esc(r.label)}</b><small>quota minima ${num(r.minOdds)}</small></div><div class="q">${best != null ? `<strong>${num(best)}</strong><small>${esc(x.best.book)} · mediana ${num(x.median)}</small>` : "<strong>—</strong>"}</div>${state}</div>`;
    }
    const [, side, n] = GOAL_KEY.exec(r.key);
    const line = Number(n) / 10;
    const agg = (o?.goalLines ?? []).find((l) => l.line === line)?.[side] ?? (line === 2.5 ? o?.ou25?.[side] : null) ?? null;
    const best = agg?.best?.odd ?? null;
    const state = best == null ? `<span class="af-pill off">quota non ancora pubblicata</span>` : r.minOdds != null && best >= r.minOdds ? `<span class="af-pill ok">quota di valore</span>` : `<span class="af-pill warn">sotto la minima</span>`;
    return `<div class="af-rec"><div class="l"><b>${esc(r.label)}</b><small>quota minima ${num(r.minOdds)}</small></div><div class="q">${best != null ? `<strong>${num(best)}</strong><small>${esc(agg.best.book)} · mediana ${num(agg.median)}</small>` : "<strong>—</strong>"}</div>${state}</div>`;
  }).join("");
}

/** Pronostico in breve: consiglio e percentuali 1X2. */
function leanPrediction(p) {
  if (!p) return empty("Pronostico non disponibile per questa partita (il provider non lo calcola per tutti i campionati).");
  const pr = p.predictions ?? {}, pc = pr.percent ?? {};
  const n = (v) => { const x = parseFloat(v); return Number.isFinite(x) && x > 0 ? x : 0; };
  const [ph, pd, pa] = [n(pc.home), n(pc.draw), n(pc.away)];
  const adv = adviceIt(pr.advice, d_home(p), d_away(p));
  const advice = `<div class="af-advice"><small>Consiglio di API-Football</small><strong>${adv ? esc(adv.label) : dash}</strong>${adv && adv.long !== adv.label ? `<span>${esc(adv.long)}</span>` : ""}</div>`;
  const bar = ph + pd + pa > 0 ? `<div class="af-prob"><div class="af-prob-bar"><i class="h" style="flex:${ph}"></i><i class="d" style="flex:${pd}"></i><i class="a" style="flex:${pa}"></i></div><div class="af-prob-leg"><div class="h"><b>${val(pc.home)}</b><span>${esc(d_home(p))}</span></div><div class="d"><b>${val(pc.draw)}</b><span>Pareggio</span></div><div class="a"><b>${val(pc.away)}</b><span>${esc(d_away(p))}</span></div></div></div>` : "";
  return advice + bar;
}

/** Versione essenziale: cosa dice API-Football, le sole linee consigliate, assenti e (se ci sono) formazioni/eventi. Il resto è a richiesta. */
function renderLean(d, { rec = [], extra = false, unified = false, hidePrediction = false } = {}) {
  const f = d.fixture;
  const fr = d.freshness ?? {};
  const soon = soonOf(fr);
  const errors = Object.entries(fr).filter(([, v]) => v.error && !v.stale && !v.deferred).map(([k]) => FRESH_IT[k] ?? k);
  const warn = errors.length ? `<p class="af-warn">${svg("alert")}<span>Alcuni dati non sono stati ricevuti: ${esc(errors.join(", "))}.</span></p>` : "";
  const waiting = Object.values(fr).filter((v) => v.deferred).length;
  const wait = waiting ? `<p class="af-warn wait" id="af-retry" role="status"><i class="af-spin" aria-hidden="true"></i><span>${waiting} ${waiting === 1 ? "sezione ancora da scaricare" : "sezioni ancora da scaricare"}: riprovo da solo.</span></p>` : "";
  const has = (x) => Array.isArray(x) && x.length > 0;
  const latest = Object.values(fr).map((v) => v.fetchedAt).filter(Boolean).sort().pop();
  const more = extra
    ? [sec("Pronostico completo", predictions(d.predictions), { icon: "pred", tone: "green" }), sec("Quote complete: gol e corner", odds(d.odds), { icon: "odds", tone: "blue" }),
      sec("Statistiche stagionali delle squadre", seasonStats(d), { icon: "season", tone: "green" }), sec("Classifica", standings(d), { icon: "table", tone: "blue" }),
      sec("Scontri diretti", h2h(d.h2h), { icon: "h2h", tone: "amber" }), sec("Arbitro e allenatori", refereeCoaches(d), { icon: "people", tone: "slate" })].join("")
    : `<button class="ghost wide" type="button" data-af-extra>Carica anche classifica, scontri diretti, statistiche e allenatori</button><p class="af-note">Usa alcune richieste in più ad API-Football: premilo solo se ti serve.</p>`;
  // `unified` = parte di un'unica scheda partita (modello + API-Football): niente testata né pronostico/linee già mostrati dalla parte del modello.
  return `${unified ? `<h4 class="u-h">Dati della partita <small>da API-Football</small></h4>` : matchHero(d)}${wait}${warn}
    ${unified && hidePrediction ? "" : sec("Cosa dice API-Football", soon(["predictions"], leanPrediction(d.predictions)), { open: true, icon: "pred", tone: "green" })}
    ${unified ? "" : sec("Linee consigliate", `${soon(["oddsGoals", "odds1x2"], recLines(d, rec))}<p class="af-note">Corner e le altre linee non sono consigliati: l'app non li stima.</p>`, { open: true, icon: "odds", tone: "blue" })}
    ${has(d.injuries) ? sec("Infortunati e squalificati", injuries(d), { open: true, note: String(d.injuries.length), icon: "injuries", tone: "red" }) : ""}
    ${has(f?.lineups) ? sec("Formazioni", lineups(f), { icon: "lineups", tone: "green" }) : ""}
    ${has(f?.events) ? sec("Eventi", events(f), { icon: "events", tone: "amber" }) : ""}
    ${has(f?.statistics) ? sec("Statistiche della partita", statistics(f), { icon: "stats", tone: "blue" }) : ""}
    ${has(f?.players) ? sec("Giocatori della partita", players(f), { icon: "people", tone: "green" }) : ""}
    ${more}
    <div class="af-foot"><span>Dati scaricati ${latest ? when(latest) : dash}. Non si riscaricano finché non possono essere cambiati.</span><button class="link" type="button" data-af-refresh>Aggiorna</button></div>
    ${sec("Stato dei dati", coverage(d), { icon: "shield", tone: "slate" })}`;
}

/** Pagina. `d` = risposta di /api/match-detail. Con `lean` (l'app) mostra solo l'essenziale; senza, tutto (come prima). */
export function renderAfDetail(d, opts = {}) {
  if (!d) return empty("Nessun dato.");
  if (opts.lean && d.mapped !== false) return renderLean(d, opts);
  if (d.mapped === false) return `<p class="af-empty">${esc(d.reason ?? "Partita non collegata ad API-Football.")}</p>`;
  const f = d.fixture;
  const errors = Object.entries(d.freshness ?? {}).filter(([, v]) => v.error && !v.stale && !v.deferred).map(([k]) => FRESH_IT[k] ?? k);
  const warn = errors.length ? `<p class="af-warn">${svg("alert")}<span>Alcuni dati non sono stati ricevuti: ${esc(errors.join(", "))}. Dettagli in fondo, in “Copertura e aggiornamento”.</span></p>` : "";
  const waiting = Object.values(d.freshness ?? {}).filter((v) => v.deferred).length;
  const wait = waiting ? `<p class="af-warn wait" id="af-retry" role="status"><i class="af-spin" aria-hidden="true"></i><span>${waiting} ${waiting === 1 ? "sezione ancora da scaricare" : "sezioni ancora da scaricare"}: riprovo da solo.</span></p>` : "";
  const fr = d.freshness ?? {};
  const soon = (keys, body) => (keys.some((k) => fr[k]?.deferred) && body.includes('class="af-empty"') ? `<p class="af-empty"><i class="af-spin" aria-hidden="true"></i> In arrivo: sto scaricando questi dati…</p>` : body);
  return `${matchHero(d)}${wait}${warn}
    ${sec("Pronostico di API-Football", soon(["predictions"], predictions(d.predictions)), { open: true, icon: "pred", tone: "green" })}
    ${sec("Quote: Over/Under gol e corner", soon(["oddsGoals", "oddsCorners"], odds(d.odds)), { open: true, icon: "odds", tone: "blue" })}
    ${sec("Infortunati e squalificati", soon(["injuries"], injuries(d)), { open: true, note: String((d.injuries ?? []).length), icon: "injuries", tone: "red" })}
    ${sec("Arbitro e allenatori", refereeCoaches(d), { open: true, icon: "people", tone: "slate" })}
    ${sec("Dettagli partita", matchInfo(d), { icon: "match", tone: "slate" })}
    ${sec("Formazioni", soon(["fixture"], lineups(f)), { icon: "lineups", tone: "green" })}
    ${sec("Eventi", events(f), { icon: "events", tone: "amber" })}
    ${sec("Statistiche della partita", statistics(f), { icon: "stats", tone: "blue" })}
    ${sec("Giocatori della partita", players(f), { icon: "people", tone: "green" })}
    ${sec("Scontri diretti", soon(["h2h"], h2h(d.h2h)), { icon: "h2h", tone: "amber" })}
    ${sec("Classifica", soon(["standings"], standings(d)), { icon: "table", tone: "blue" })}
    ${sec("Statistiche stagionali delle squadre", soon(["teamHome", "teamAway"], seasonStats(d)), { icon: "season", tone: "green" })}
    ${sec("Copertura e aggiornamento dati", coverage(d), { icon: "shield", tone: "slate" })}`;
}
