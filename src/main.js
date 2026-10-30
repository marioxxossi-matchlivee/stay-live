import "./style.css";
import { MODEL, verdictFor } from "../functions/api/model.js";
import { computePlan, isBetItem } from "./plan.js";
import { dayKey, dayParts, eur, esc, fmtTime, num, pct } from "./format.js";
import { buildPreviewPdf } from "./report.js";

const $ = (s, r = document) => r.querySelector(s);
const state = {
  matches: [], leagues: [], continents: [], league: "all", navOpen: false, openKeys: new Set(), day: null, onlyBet: false, selected: new Set(),
  n: 8, loading: false, error: null, banner: null, syncTried: false, updatedAt: null,
};
const leagueName = (id, short = false) => state.leagues.find((l) => l.id === id)?.[short ? "short" : "name"] ?? id;
/** Filtro campionato: "all", id campionato oppure "n:<country>" per tutta una nazione. */
const inScope = (leagueId) => {
  if (state.league === "all") return true;
  if (state.league.startsWith("n:")) return state.leagues.find((l) => l.id === leagueId)?.country === state.league.slice(2);
  return leagueId === state.league;
};
const isOpen = (m) => m.status === "scheduled" || m.status === "in_progress";

/* ---------- Dati ---------- */
async function getJson(url) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Errore HTTP ${res.status}`);
  return data;
}

async function load({ sync = true } = {}) {
  if (state.loading) return;
  state.loading = true; state.error = null; render();
  try {
    let data = await getJson("/api/fixtures");
    if (sync && !state.syncTried && data.needsSync.length) {
      state.syncTried = true;
      const failures = [];
      for (const id of data.needsSync) {
        state.banner = `Aggiorno ${data.leagues.find((l) => l.id === id)?.name ?? id}…`; render();
        try { await getJson(`/api/sync?league=${id}`); } catch (e) { failures.push(`${id}: ${e.message}`); }
      }
      data = await getJson("/api/fixtures");
      state.banner = failures.length ? `Aggiornamento incompleto. ${failures[0]}` : null;
    } else state.banner = null;
    Object.assign(state, { matches: data.matches, leagues: data.leagues, continents: data.continents ?? [], updatedAt: data.updatedAt });
  } catch (e) {
    state.error = e.message;
  } finally {
    state.loading = false; render();
  }
}

/* ---------- Lista ---------- */
function meter(p) {
  return `<span class="meter" aria-hidden="true"><i style="width:${(p.pLow * 100).toFixed(1)}%"></i><b style="left:${(p.pLow * 100).toFixed(1)}%;width:${(Math.max(0, p.p - p.pLow) * 100).toFixed(1)}%"></b><u style="left:${MODEL.betThreshold * 100}%"></u></span>`;
}
function pickChip(p) {
  if (!p) return "";
  if (p.confidence === "insufficiente") return `<span class="pick none">Dati insufficienti: ${p.sample} gare di storico</span>`;
  return `<span class="pick ${p.verdict === "BET" ? "bet" : "skip"}"><span class="pick-head"><b>${p.verdict}</b><span>${esc(p.label)}</span><em>${pct(p.pLow)}</em></span>${meter(p)}</span>`;
}
function visibleMatches() {
  return state.matches.filter((m) => {
    if (!inScope(m.league)) return false;
    if (state.day === "results") return m.status === "final";
    if (!isOpen(m) || dayKey(m.kickoffAt) !== state.day) return false;
    return !state.onlyBet || m.pick?.verdict === "BET";
  });
}
function rowHtml(m) {
  const time = fmtTime.format(new Date(m.kickoffAt));
  const score = m.homeScore != null ? `<i></i><span class="score">${m.homeScore} – ${m.awayScore}</span>` : "";
  const live = m.status === "in_progress" ? `<span class="live-tag">In corso</span>` : "";
  const check = isOpen(m) ? `<input type="checkbox" data-sel="${esc(m.id)}" ${state.selected.has(m.id) ? "checked" : ""} aria-label="Seleziona ${esc(m.home)} – ${esc(m.away)}" />` : `<span></span>`;
  return `<div class="row ${state.selected.has(m.id) ? "sel" : ""}">${check}
    <button class="row-main" type="button" data-open="${esc(m.id)}">
      <span class="meta"><b>${time}</b><span>${esc(leagueName(m.league, true))}</span>${live}</span>
      <span class="teams">${esc(m.home)}<i>–</i>${esc(m.away)}${score}</span>
      ${pickChip(m.pick)}
    </button></div>`;
}
function renderDays() {
  const pool = state.matches.filter((m) => inScope(m.league));
  const counts = new Map();
  for (const m of pool.filter(isOpen)) counts.set(dayKey(m.kickoffAt), (counts.get(dayKey(m.kickoffAt)) ?? 0) + 1);
  const keys = [...counts.keys()].sort();
  const hasResults = pool.some((m) => m.status === "final");
  if (state.day !== "results" && !keys.includes(state.day)) state.day = keys[0] ?? (hasResults ? "results" : null);
  $("#day-strip").innerHTML = keys.map((k) => {
    const d = dayParts(k);
    return `<button class="day" type="button" data-day="${k}" aria-pressed="${k === state.day}"><b>${d.wd}</b><span>${d.dm}</span><small>${counts.get(k)} gare</small></button>`;
  }).join("") + (hasResults ? `<button class="day" type="button" data-day="results" aria-pressed="${state.day === "results"}"><b>Ultimi</b><span>Risultati</span></button>` : "");
}
/* Menu campionati: continente > nazione (accordion) > campionati */
function scopeLabel() {
  if (state.league === "all") return "Tutti i campionati";
  if (state.league.startsWith("n:")) return `${state.leagues.find((l) => l.country === state.league.slice(2))?.nation ?? ""} · tutti`;
  const l = state.leagues.find((x) => x.id === state.league);
  return l ? `${l.nation} · ${l.name}` : "Tutti i campionati";
}
function renderLeagueNav() {
  const toggle = $("#nav-toggle");
  toggle.textContent = `${scopeLabel()} ${state.navOpen ? "▴" : "▾"}`;
  toggle.setAttribute("aria-expanded", String(state.navOpen));
  const nav = $("#league-nav");
  nav.hidden = !state.navOpen;
  if (!state.navOpen) return;
  const chip = (id, label) => `<button class="chip" type="button" data-league="${esc(id)}" aria-pressed="${state.league === id}">${esc(label)}</button>`;
  const continents = state.continents.map((c) => {
    const inC = state.leagues.filter((l) => l.continent === c.id);
    if (!inC.length) return "";
    const nations = [...new Map(inC.map((l) => [l.country, l])).values()]
      .sort((a, b) => (b.international ? 1 : 0) - (a.international ? 1 : 0) || a.nation.localeCompare(b.nation, "it"));
    const items = nations.map((n) => {
      const ls = inC.filter((l) => l.country === n.country).sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name, "it"));
      const key = `${c.id}:${n.country}`;
      return `<details class="nation" data-key="${esc(key)}" ${state.openKeys.has(key) ? "open" : ""}>
        <summary><span>${n.international ? "🏆 " : ""}${esc(n.nation)}</span><small>${ls.length} ${ls.length === 1 ? "campionato" : "campionati"}</small></summary>
        <div class="nation-leagues">${ls.length > 1 ? chip(`n:${n.country}`, "Tutti") : ""}${ls.map((l) => chip(l.id, l.name)).join("")}</div>
      </details>`;
    }).join("");
    return `<section class="continent"><h3>${esc(c.name)}</h3>${items}</section>`;
  }).join("");
  nav.innerHTML = `<div class="nav-all">${chip("all", "Tutti i campionati")}</div>${continents}`;
}
function render() {
  renderLeagueNav();
  renderDays();
  const list = visibleMatches();
  const bets = list.filter((m) => m.pick?.verdict === "BET").length;
  const long = state.day && state.day !== "results" ? dayParts(state.day).long : "";
  $("#day-title").textContent = state.day === "results" ? "Ultimi risultati" : long ? long[0].toUpperCase() + long.slice(1) : "Partite";
  $("#summary").textContent = state.loading && !state.matches.length ? "Caricamento…"
    : state.error ? "Dati non disponibili."
    : `${list.length} partite${state.day === "results" ? "" : ` · ${bets} con BET`}${state.updatedAt ? ` · aggiornato alle ${fmtTime.format(new Date(state.updatedAt))}` : ""}`;
  const banner = $("#banner");
  banner.hidden = !(state.error || state.banner);
  banner.className = `banner${state.error ? " error" : ""}`;
  banner.textContent = state.error ?? state.banner ?? "";
  $("#list").innerHTML = list.length ? list.map(rowHtml).join("")
    : `<div class="empty">${state.loading ? "Carico i dati…" : state.error ? "" : state.onlyBet ? "Nessun BET in questa giornata con i filtri scelti." : "Nessuna partita per questa selezione."}</div>`;
  $("#refresh").disabled = state.loading;
  const count = state.selected.size;
  $("#selbar").hidden = !count;
  $("#sel-count").textContent = `${count} ${count === 1 ? "partita" : "partite"}`;
}

/* ---------- Dettaglio e calcolo ---------- */
const oddsInput = new Map();
let detailState = null;

async function openDetail(id) {
  $("#detail").showModal();
  $("#detail-body").innerHTML = `<p class="empty">Calcolo in corso…</p>`;
  try {
    detailState = { id, data: await getJson(`/api/analysis?id=${encodeURIComponent(id)}&n=${state.n}`) };
    renderDetail();
  } catch (e) {
    $("#detail-body").innerHTML = `<h2 class="d-title">Analisi non disponibile</h2><p class="d-sub">${esc(e.message)}</p>`;
  }
}
function selectionRow(s, sample, matchId) {
  const stored = oddsInput.get(`${matchId}:${s.key}`) ?? "";
  return `<div class="sl" data-row="${s.key}">
    <span class="sl-name">${esc(s.label)}</span>
    <span class="sl-p">${pct(s.pLow)}<small>modello ${pct(s.p, 1)}</small></span>
    <span class="sl-info">
      <span>Media campionato ${pct(s.base)}</span><span>Quota equa ${num(s.fairOdds)}</span><span>Quota minima ${num(s.minOdds)}</span>
      <label>Tua quota <input inputmode="decimal" data-odds="${s.key}" value="${esc(stored)}" placeholder="es. 1,85" aria-label="Quota per ${esc(s.label)}" /></label>
      <span class="res ${s.verdict === "BET" ? "bet" : "skip"}" data-res="${s.key}" title="${esc(s.reason)}">${s.verdict}</span>
    </span></div>`;
}
function formBox(name, f) {
  const last = f.last.map((r) => `<div><span>${r.venue === "C" ? "casa" : "trasf."} vs ${esc(r.opp)}</span><span>${r.gf}–${r.ga}</span></div>`).join("") || "<div>Nessuna partita</div>";
  return `<div class="form"><b>${esc(name)}</b>${last}</div>`;
}
function explain(match, a) {
  const i = a.inputs;
  const sel = (k) => a.selections.find((s) => s.key === k);
  const base = i.neutral ? `Campo neutro: uso ${num(i.baseline.perTeam, 3)} gol per squadra.` : `${num(i.baseline.home, 3)} gol in casa e ${num(i.baseline.away, 3)} in trasferta.`;
  const team = (name, f) => `${esc(name)}: ${f.n} partite usate (massimo ${a.n}), ognuna pesa ${num(MODEL.decay)} volte la successiva. Media gol fatti ${num(f.gfAvg)} e subiti ${num(f.gaAvg)} → attacco ${num(f.attackRaw, 3)}, difesa ${num(f.defenseRaw, 3)} (1,000 = media del campionato). Con ${MODEL.shrinkK} partite “medie” aggiunte per non esagerare: attacco <b>${num(f.attack, 3)}</b>, difesa <b>${num(f.defense, 3)}</b>.`;
  const steps = [
    ["Media gol di riferimento", `Nelle ${i.baseline.sample} partite di ${i.baseline.scope} già giocate: ${base} Il dato è mescolato con una media di partenza (${num(MODEL.priorHome, 1)} / ${num(MODEL.priorAway, 1)}) che pesa come ${MODEL.priorWeight} partite.`],
    ["Forma delle due squadre", `${team(match.home, i.home)}<br>${team(match.away, i.away)}`],
    ["Gol attesi", `${esc(match.home)}: ${num(i.neutral ? i.baseline.perTeam : i.baseline.home, 3)} × attacco ${num(i.home.attack, 3)} × difesa avversaria ${num(i.away.defense, 3)} = <b>${num(a.lambda.home, 2)}</b>. ${esc(match.away)}: ${num(i.neutral ? i.baseline.perTeam : i.baseline.away, 3)} × ${num(i.away.attack, 3)} × ${num(i.home.defense, 3)} = <b>${num(a.lambda.away, 2)}</b>. Totale atteso <b>${num(a.lambda.total, 2)}</b> gol.`],
    ["Probabilità di ogni esito", `Ogni punteggio i–j vale Poisson(${num(a.lambda.home)}; i) × Poisson(${num(a.lambda.away)}; j). Sommando le caselle giuste si ottengono tutti i mercati: ad esempio Over 2,5 = 1 − P(0, 1 o 2 gol totali) = <b>${pct(sel("over25").p, 1)}</b>; 1 = somma dei punteggi con più gol in casa = <b>${pct(sel("home").p, 1)}</b>. Più probabili: ${a.topScores.map((t) => `${t.score} (${pct(t.p, 1)})`).join(", ")}.`],
    ["Margine di prudenza", `Con ${a.sample} partite di campione le attese gol possono sbagliare di circa ±${pct(i.delta)} (${num(MODEL.uncertainty)} ÷ √${Math.max(a.sample, 1)}). Ricalcolo 5 scenari (base, entrambe su/giù, una su e l’altra giù) e tengo il peggiore: è la <b>probabilità prudente</b>, quella che vedi in grande.`],
    ["Verdetto BET / EVITA", `BET solo se il campione è di almeno ${MODEL.betSample} partite, la probabilità prudente è almeno ${pct(MODEL.betThreshold)} e supera di almeno ${MODEL.minEdge * 100} punti la frequenza storica di quell’esito nel campionato (così non consiglio mercati “facili” sempre probabili, come Over 1,5). Quota minima = ${num(MODEL.edgeMargin)} ÷ probabilità prudente: sotto quella quota non c’è margine. Se inserisci la tua quota, BET se probabilità prudente × quota ≥ ${num(MODEL.edgeMargin)}. Esiti con quota equa sotto 1,25 non vengono proposti come scelta migliore.`],
  ];
  return `<ol class="steps">${steps.map(([t, d]) => `<li><b>${t}</b><span>${d}</span></li>`).join("")}</ol>`;
}
function renderDetail() {
  const { match, analysis: a } = detailState.data;
  const p = a.pick;
  const isBet = p?.verdict === "BET";
  const kick = `${dayParts(dayKey(match.kickoffAt)).long} · ${fmtTime.format(new Date(match.kickoffAt))}`;
  const groups = [...new Set(a.selections.map((s) => s.market))];
  $("#detail-body").innerHTML = `
    <h2 class="d-title">${esc(match.home)} – ${esc(match.away)}</h2>
    <p class="d-sub">${esc(leagueName(match.league))} · ${esc(kick)}</p>
    <div class="verdict ${isBet ? "bet" : ""}">
      <h3>${p ? `${p.verdict}: ${esc(p.label)}` : "Nessun consiglio"}</h3>
      <p>${p ? esc(p.reason) : "Dati insufficienti."}</p>
      ${p ? `<p>Probabilità prudente <b>${pct(p.pLow)}</b> (modello ${pct(p.p, 1)}) · quota equa ${num(1 / p.p)} · quota minima <b>${num(p.minOdds)}</b></p>` : ""}
    </div>
    <div class="kv">
      <div><small>Gol attesi</small><strong>${num(a.lambda.total)}</strong></div>
      <div><small>Affidabilità</small><strong>${esc(a.confidence)}</strong></div>
      <div><small>Campione</small><strong>${a.inputs.home.n} + ${a.inputs.away.n} gare</strong></div>
    </div>
    <label class="hist" style="margin:0 0 6px">Storico usato
      <select id="detail-n">${[5, 8, 10].map((v) => `<option value="${v}" ${v === a.n ? "selected" : ""}>${v} gare</option>`).join("")}</select></label>
    <h4>Tutti i mercati · inserisci la quota del tuo bookmaker per il verdetto sul valore</h4>
    ${groups.map((g) => `<div class="mk"><h5>${esc(g)}</h5>${a.selections.filter((s) => s.market === g).map((s) => selectionRow(s, a.sample, match.id)).join("")}</div>`).join("")}
    <h4>Come è stato calcolato, passo per passo</h4>
    ${explain(match, a)}
    <h4>Ultime partite considerate</h4>
    <div class="formrow">${formBox(match.home, a.inputs.home)}${formBox(match.away, a.inputs.away)}</div>`;
  for (const s of a.selections) applyOdds(s.key);
}
function applyOdds(key) {
  const { match, analysis: a } = detailState.data;
  const s = a.selections.find((x) => x.key === key);
  const raw = oddsInput.get(`${match.id}:${key}`);
  const odds = raw ? Number(String(raw).replace(",", ".")) : null;
  const v = verdictFor(s, a.sample, odds);
  const el = $(`[data-res="${key}"]`);
  if (!el) return;
  el.textContent = v.verdict; el.title = v.reason;
  el.className = `res ${v.verdict === "BET" ? "bet" : "skip"}`;
}

/* ---------- Preview giornata ---------- */
let lastPreview = null;
let lastPlan = null;
const pvOdds = new Map(); // quote inserite a mano nel resoconto: id partita -> quota
const pvMarket = new Map(); // quote di mercato (The Odds API): id partita -> { median, best, bestBookmaker, books }
const BANK_KEY = "stayLive.bankroll";
let bankroll = (() => { try { const v = Number(localStorage.getItem(BANK_KEY)); return v > 0 ? v : 100; } catch { return 100; } })();
const parsePos = (v) => { const n = Number(String(v ?? "").replace(",", ".")); return Number.isFinite(n) && n > 0 ? n : null; };
async function makePreview() {
  const ids = [...state.selected];
  if (!ids.length) return;
  $("#preview").showModal();
  $("#preview-body").innerHTML = `<p class="empty">Genero la preview…</p>`;
  $("#make-preview").disabled = true;
  try {
    pvOdds.clear(); pvMarket.clear();
    lastPreview = await getJson(`/api/preview?ids=${ids.map(encodeURIComponent).join(",")}&n=${state.n}`);
    renderPreview();
  } catch (e) {
    $("#preview-body").innerHTML = `<h2 class="d-title">Preview non disponibile</h2><p class="d-sub">${esc(e.message)}</p>`;
  } finally { $("#make-preview").disabled = false; }
}
function previewText(pv) {
  const when = (i) => fmtTime.format(new Date(i.kickoffAt));
  const stakeOf = (e) => (e ? ` · punta ${eur(e.stake)}` : "");
  const multi = (lastPlan?.multiples ?? []).map((m) => `${m.label} (${m.items.length} gare): ${m.items.map((i) => `${i.home}-${i.away} ${i.pick.label}`).join(" + ")} · prob. prudente ${pct(m.plan.pLow)} · quota ${num(m.plan.odds)} ${m.plan.source}${stakeOf(m.eff)}${m.eff ? ` · vincita netta ${eur(m.eff.win)}` : ""}`);
  const singles = pv.items.filter(isBetItem).map((i) => `${when(i)} ${i.home} – ${i.away} → ${i.pick.label} (prudente ${pct(i.pick.pLow)}, quota min ${num(i.pick.minOdds)})${stakeOf(lastPlan?.rows.get(i.id)?.eff)}`);
  const skip = pv.items.filter((i) => !isBetItem(i)).map((i) => `${when(i)} ${i.home} – ${i.away}`);
  return [`Stay Live · preview ${dayParts(dayKey(pv.items[0].kickoffAt)).long}`,
    multi.length ? `\nMULTIPLE\n${multi.join("\n")}` : "", singles.length ? `\nSINGOLE\n${singles.join("\n")}` : "", skip.length ? `\nDA EVITARE\n${skip.join("\n")}` : "",
    "\nStime statistiche, non garanzie."].filter(Boolean).join("\n");
}
function singleCard(i) {
  return `<article class="pv-card${isBetItem(i) ? "" : " is-skip"}">
      <span class="meta"><b>${fmtTime.format(new Date(i.kickoffAt))}</b><span>${esc(leagueName(i.league, true))}</span></span>
      <span class="teams">${esc(i.home)}<i>–</i>${esc(i.away)}</span>
      ${i.pick ? pickChip({ ...i.pick, confidence: i.confidence, sample: i.sample }) : ""}
      <span class="pv-more"><span>Quota minima ${num(i.pick?.minOdds)}</span><span>Gol attesi ${num(i.lambda.total)}</span><span>Più probabile ${esc(i.topScores[0]?.score ?? "—")}</span>${i.alternatives[0] ? `<span>Alternativa: ${esc(i.alternatives[0].label)} ${pct(i.alternatives[0].pLow)}</span>` : ""}</span>
      ${isBetItem(i) ? `<span class="pv-stake"><span data-plan="${esc(i.id)}"></span><label class="pv-odds">Quota reale <input inputmode="decimal" data-pv-odds="${esc(i.id)}" placeholder="stima ${num(i.pick.estOdds)}" aria-label="Quota reale per ${esc(i.home)} – ${esc(i.away)}" /></label></span>` : ""}
      <button class="link" type="button" data-open="${esc(i.id)}" style="justify-self:start">Vedi il calcolo</button>
    </article>`;
}
function renderPreview() {
  const pv = lastPreview;
  if (!pv.items.length) { $("#preview-body").innerHTML = `<p class="empty">Nessuna partita trovata.</p>`; return; }
  const bets = pv.items.filter(isBetItem), rest = pv.items.filter((i) => !isBetItem(i));
  $("#preview-body").innerHTML = `
    <h2 class="d-title">Preview delle partite scelte</h2>
    <div class="pv-sum">
      <strong>${pv.summary.bets} BET su ${pv.summary.selected} partite</strong>
      <span>Prima le multiple, poi le singole consigliate, infine le partite da evitare.</span>
    </div>
    <div class="pv-bank">
      <label>Budget <input id="bankroll" inputmode="decimal" value="${esc(String(bankroll).replace(".", ","))}" aria-label="Budget in euro" /> €</label>
      <div id="pv-totals" class="pv-totals" aria-live="polite"></div>
    </div>
    <div class="pv-actions"><button class="primary" id="share-pdf" type="button">Condividi PDF</button><button class="ghost" id="load-quotes" type="button">Preleva quote reali</button><button class="ghost" id="copy-preview" type="button">Copia testo</button></div>
    <p class="pv-qstatus" id="quotes-status" aria-live="polite"></p>
    <section class="pv-section pv-multi-sec"><h3><span>Multiple consigliate</span></h3><div id="pv-multiples"></div></section>
    <section class="pv-section"><h3><span>Singole consigliate</span><small>${bets.length}</small></h3>${bets.length ? bets.map(singleCard).join("") : `<p class="empty">Nessun BET tra le partite scelte.</p>`}</section>
    ${rest.length ? `<section class="pv-section pv-skip-sec"><h3><span>Da evitare</span><small>${rest.length}</small></h3>${rest.map(singleCard).join("")}</section>` : ""}
    <p class="foot">Le quote minime sono quelle sotto cui non c’è margine secondo il modello. Controlla sempre la quota reale prima di giocare. Nessuna stima garantisce un guadagno: gioca solo ciò che puoi permetterti di perdere.</p>`;
  updatePlan();
}

function multiLine(m) {
  const { plan: p, eff: e } = m;
  if (!e) return `<em class="pv-no">Nessuna puntata consigliata${p.need ? `: servirebbe una quota combinata di almeno ${num(p.need)}` : ""}.</em>`;
  if (p.play) return `Quota ${num(p.odds)} <small>${p.source}</small> · punta <b>${eur(e.stake)}</b> · vincita netta <b>${eur(e.win)}</b>${e.capped ? " <small>(ridotta dal tetto di esposizione)</small>" : ""}`;
  return `Quota ${p.source} ${num(p.odds)} sotto la minima: gioca <b>solo se</b> la quota combinata è almeno <b>${num(p.need)}</b> → punta <b>${eur(e.stake)}</b>, vincita netta <b>${eur(e.win)}</b>`;
}
function renderMultiples(plan) {
  const el = $("#pv-multiples");
  if (!plan.multiples.length) { el.innerHTML = `<p class="empty">Servono almeno 2 BET per comporre una multipla.</p>`; return; }
  el.innerHTML = plan.multiples.map((m) => `<article class="pv-multi-card">
      <header><b>${esc(m.label)}</b><span class="pill">${m.items.length} gare</span></header>
      <p class="note">${esc(m.note)}</p>
      <ol class="legs">${m.legs.map((l) => `<li><span class="t">${fmtTime.format(new Date(l.item.kickoffAt))}</span><span class="m">${esc(l.item.home)} – ${esc(l.item.away)}</span><b>${esc(l.item.pick.label)}</b><small>${num(l.odds)} ${esc(l.source)}</small></li>`).join("")}</ol>
      <div class="mstats"><span>Probabilità prudente <b>${pct(m.plan.pLow)}</b></span><span>Quota minima <b>${num(m.minOdds)}</b></span></div>
      <div class="pv-stake">${multiLine(m)}</div>
    </article>`).join("");
}

async function loadQuotes(btn) {
  if (!lastPreview?.items.length) return;
  const label = btn.textContent, status = $("#quotes-status");
  btn.disabled = true; btn.textContent = "Cerco le quote…"; status.textContent = "";
  try {
    const data = await getJson(`/api/quotes?ids=${lastPreview.items.map((i) => encodeURIComponent(i.id)).join(",")}&n=${state.n}`);
    for (const [id, q] of Object.entries(data.quotes)) pvMarket.set(id, q);
    const bets = lastPreview.items.filter(isBetItem).length;
    const parts = [`Quote di mercato per ${Object.keys(data.quotes).length} BET su ${bets}`];
    if (data.usage?.spent) parts.push(`spesi ${data.usage.spent} crediti`);
    if (data.usage?.remaining != null) parts.push(`${data.usage.remaining} crediti residui nel mese`);
    if (data.unmatched?.length) parts.push(`${data.unmatched.length} senza quota (partita non trovata o mercato non offerto)`);
    if (data.skipped) parts.push(`${data.skipped} rinviate (massimo ${12} per volta)`);
    if (data.blocked) parts.push(data.blocked);
    if (data.errors?.length) parts.push(data.errors[0]);
    status.textContent = `${parts.join(" · ")}. Sono quote di bookmaker europei: confrontale con quelle del tuo.`;
    updatePlan();
  } catch (e) { status.textContent = `Quote non disponibili: ${e.message}`; }
  btn.textContent = label; btn.disabled = false;
}

function planLine(row) {
  if (!row?.eff) return `<em class="pv-no">Nessuna puntata consigliata${row?.plan?.need ? `: servirebbe una quota di almeno ${num(row.plan.need)}` : ""}.</em>`;
  const { plan: p, eff: e } = row;
  const q = row.quote && p.source === "mercato" ? ` <small>(mediana di ${row.quote.books} bookmaker · migliore ${num(row.quote.best)} su ${esc(row.quote.bestBookmaker ?? "—")})</small>` : "";
  if (p.play) return `Quota ${num(p.odds)} <small>${p.source}</small>${q} · punta <b>${eur(e.stake)}</b> · vincita netta <b>${eur(e.win)}</b>${e.capped ? " <small>(ridotta dal tetto di esposizione)</small>" : ""}`;
  return `Quota ${p.source} ${num(p.odds)}${q} sotto la minima: gioca <b>solo se</b> il bookmaker paga almeno <b>${num(p.need)}</b> → punta <b>${eur(e.stake)}</b>, vincita netta <b>${eur(e.win)}</b>`;
}
function updatePlan() {
  if (!lastPreview?.items.length) return;
  const plan = lastPlan = computePlan(lastPreview, bankroll, pvOdds, pvMarket);
  for (const el of document.querySelectorAll("[data-pv-odds]")) {
    const m = pvMarket.get(el.dataset.pvOdds);
    if (m) el.placeholder = `mercato ${num(m.median)}`;
  }
  for (const el of document.querySelectorAll("[data-plan]")) el.innerHTML = planLine(plan.rows.get(el.dataset.plan));
  renderMultiples(plan);
  const t = plan.totals, ts = plan.totalsSingles, tm = plan.totalsMultiples;
  const line = (label, x) => (x.count ? `${label}: ${x.count} ${x.count === 1 ? "giocata" : "giocate"}, puntata <b>${eur(x.stake)}</b>, vincita netta se entrano tutte <b>${eur(x.win)}</b>` : `${label}: nessuna puntata consigliata`);
  $("#pv-totals").innerHTML = t.count
    ? `<b>${plan.hypothetical ? "Piano se trovi almeno le quote minime" : "Piano"}</b><br>${line("Multiple", tm)}<br>${line("Singole", ts)}<br>Totale puntato <b>${eur(t.stake)}</b> (${pct(bankroll > 0 ? t.stake / bankroll : 0, 1)} del budget) · esito atteso prudente ${eur(t.ev)}${plan.hypothetical ? `<br><small>Dove la quota è solo stimata i BET non hanno margine. Premi “Preleva quote reali” o inserisci la quota del tuo bookmaker.</small>` : ""}`
    : `Nessuna puntata consigliata con queste quote. Inserisci la quota reale del bookmaker oppure non giocare.`;
}


/* ---------- PDF del riepilogo ---------- */
async function sharePdf(btn) {
  if (!lastPreview?.items.length) return;
  const label = btn.textContent;
  btn.disabled = true; btn.textContent = "Creo il PDF…";
  try {
    updatePlan();
    const bytes = buildPreviewPdf(lastPreview, leagueName, lastPlan);
    const name = `stay-live-${dayKey(lastPreview.items[0].kickoffAt)}.pdf`;
    const file = new File([bytes], name, { type: "application/pdf" });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: "Stay Live · preview", text: "Preview partite scelte" });
    } else {
      // Browser senza condivisione di file (es. desktop): scarica il PDF.
      const url = URL.createObjectURL(file);
      const a = Object.assign(document.createElement("a"), { href: url, download: name });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    }
  } catch (e) {
    if (e?.name !== "AbortError") btn.textContent = "Errore nel PDF";
    else btn.textContent = label;
    setTimeout(() => { btn.textContent = label; }, 2500);
    btn.disabled = false;
    return;
  }
  btn.textContent = label; btn.disabled = false;
}

/* ---------- Metodo ---------- */
function renderMethod() {
  const M = MODEL;
  $("#method-body").innerHTML = `<div class="method"><h2 class="d-title">Come calcoliamo le percentuali</h2>
  <p class="d-sub">Il modello usa solo i gol delle partite già giocate in questa stagione, in tutti i campionati e nelle coppe europee. Non vede quote, infortuni, formazioni né corner.</p>
  <ol class="steps">
    <li><b>Media gol di riferimento</b><span>Gol medi in casa e in trasferta del campionato (o di tutti i campionati se ci sono meno di ${M.minLeagueMatches} partite), mescolati con ${num(M.priorHome, 1)} / ${num(M.priorAway, 1)} come se fossero ${M.priorWeight} partite.</span></li>
    <li><b>Attacco e difesa</b><span>Per ogni squadra, ultime ${"5, 8 o 10"} partite (scegli tu). Gol fatti e subiti sono divisi per la media del campionato in cui sono stati segnati. Le partite più vecchie pesano meno (×${num(M.decay)} a ogni passo). Poi si aggiungono ${M.shrinkK} partite “medie” per evitare estremi.</span></li>
    <li><b>Gol attesi</b><span><code>λ casa = media casa × attacco casa × difesa trasferta</code> e <code>λ trasferta = media trasferta × attacco trasferta × difesa casa</code>, limitati tra ${M.lambdaMin} e ${M.lambdaMax}.</span></li>
    <li><b>Probabilità</b><span>Distribuzione di Poisson indipendente per le due squadre, punteggi da 0–0 a 10–10. 1X2, doppia chance, Over/Under 1,5 · 2,5 · 3,5 ed entrambe segnano sono somme di queste caselle, quindi sempre coerenti tra loro.</span></li>
    <li><b>Probabilità prudente</b><span>Il campione è piccolo, quindi le attese gol sono incerte di circa ±${num(M.uncertainty)} ÷ √partite. Si ricalcola in 5 scenari e si tiene il peggiore.</span></li>
    <li><b>BET o EVITA</b><span>BET se il campione è di almeno ${M.betSample} partite, la probabilità prudente è almeno ${pct(M.betThreshold)} e supera di ${M.minEdge * 100} punti la frequenza storica di quell’esito nel campionato. La <b>quota minima</b> è ${num(M.edgeMargin)} ÷ probabilità prudente. Con la tua quota: BET se probabilità prudente × quota ≥ ${num(M.edgeMargin)}.</span></li>
    <li><b>Mercati preferiti</b><span>Tra i BET della stessa partita, Over/Under sui gol passano davanti a 1X2, doppia chance ed entrambe segnano (a parità di BET, non cambia la soglia). I corner non sono calcolabili con i dati disponibili.</span></li>
    <li><b>Multiple</b><span>Tre proposte tra i BET di partite diverse: sicura (le 2 più probabili), equilibrata (3) e ambiziosa (fino a 5). La probabilità combinata è il prodotto (partite considerate indipendenti) e la quota combinata il prodotto delle quote: anche il margine del bookmaker si moltiplica, per questo le puntate sulle multiple sono più basse.</span></li>
  </ol>
  <p><b>Limiti.</b> Le soglie sono scelte ragionevoli ma non calibrate su uno storico lungo. I bookmaker conoscono molto più di questo modello e applicano un margine: senza la quota reale, un BET significa solo “alta probabilità”, non “scommessa di valore”.</p></div>`;
}

/* ---------- Eventi ---------- */
document.addEventListener("click", (e) => {
  const t = e.target;
  if (t.closest("[data-close]")) t.closest("dialog").close();
  else if (t.tagName === "DIALOG") t.close();
  const chip = t.closest("[data-league]");
  if (chip) {
    state.league = chip.dataset.league;
    const code = state.league.startsWith("n:") ? state.league.slice(2) : state.leagues.find((l) => l.id === state.league)?.country;
    const l = state.leagues.find((x) => x.country === code);
    if (l) state.openKeys.add(`${l.continent}:${l.country}`);
    state.navOpen = false; render();
  }
  if (t.closest("#nav-toggle")) { state.navOpen = !state.navOpen; render(); }
  const day = t.closest("[data-day]"); if (day) { state.day = day.dataset.day; render(); }
  const open = t.closest("[data-open]"); if (open) openDetail(open.dataset.open);
  if (t.closest("#copy-preview")) navigator.clipboard?.writeText(previewText(lastPreview)).then(() => { t.textContent = "Copiato"; });
  if (t.closest("#share-pdf")) sharePdf(t.closest("#share-pdf"));
  if (t.closest("#load-quotes")) loadQuotes(t.closest("#load-quotes"));
});
// <details> non propaga "toggle": lo ascoltiamo in cattura per ricordare quali nazioni sono aperte.
document.addEventListener("toggle", (e) => {
  const d = e.target;
  if (!(d instanceof HTMLDetailsElement) || !d.dataset.key) return;
  d.open ? state.openKeys.add(d.dataset.key) : state.openKeys.delete(d.dataset.key);
}, true);
document.addEventListener("change", (e) => {
  const t = e.target;
  if (t.matches("[data-sel]")) { t.checked ? state.selected.add(t.dataset.sel) : state.selected.delete(t.dataset.sel); render(); }
  if (t.id === "only-bet") { state.onlyBet = t.checked; render(); }
  if (t.id === "history-count") { state.n = Number(t.value); load({ sync: false }); }
  if (t.id === "detail-n") { state.n = Number(t.value); $("#history-count").value = String(state.n); openDetailKeep(); }
});
document.addEventListener("input", (e) => {
  const t = e.target;
  if (t.id === "bankroll") { const v = parsePos(t.value); if (v) { bankroll = v; try { localStorage.setItem(BANK_KEY, String(v)); } catch { /* storage non disponibile */ } updatePlan(); } return; }
  if (t.matches("[data-pv-odds]")) { const v = parsePos(t.value); v > 1 ? pvOdds.set(t.dataset.pvOdds, v) : pvOdds.delete(t.dataset.pvOdds); updatePlan(); return; }
  if (!t.matches("[data-odds]") || !detailState) return;
  oddsInput.set(`${detailState.id}:${t.dataset.odds}`, t.value);
  applyOdds(t.dataset.odds);
});
async function openDetailKeep() {
  const id = detailState.id;
  detailState = { id, data: await getJson(`/api/analysis?id=${encodeURIComponent(id)}&n=${state.n}`) };
  renderDetail();
}
$("#select-day").addEventListener("click", () => {
  const open = visibleMatches().filter(isOpen);
  const all = open.every((m) => state.selected.has(m.id));
  open.forEach((m) => (all ? state.selected.delete(m.id) : state.selected.add(m.id)));
  render();
});
$("#select-bets").addEventListener("click", () => {
  visibleMatches().filter((m) => isOpen(m) && m.pick?.verdict === "BET").forEach((m) => state.selected.add(m.id));
  render();
});
$("#sel-clear").addEventListener("click", () => { state.selected.clear(); render(); });
$("#make-preview").addEventListener("click", makePreview);
$("#open-method").addEventListener("click", () => { renderMethod(); $("#method").showModal(); });
$("#refresh").addEventListener("click", () => { state.syncTried = false; load(); });
setInterval(() => { if (document.visibilityState === "visible" && !state.error) { state.syncTried = false; load(); } }, 5 * 60e3);

render();
load();
