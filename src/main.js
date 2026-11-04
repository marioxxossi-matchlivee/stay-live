import "./style.css";
import { MODEL, verdictFor } from "../functions/api/model.js";
import { computePlan, isBetItem } from "./plan.js";
import { dayKey, dayParts, eur, esc, fmtTime, num, pct } from "./format.js";
import { buildPreviewPdf } from "./report.js";
import { renderAfDetail } from "./afdetail.js";
import { crest, hideBrokenCrests, matchHeader } from "./ui.js";
import { absorbResults, addPlay, evaluate, legFromItem, loadPlays, pendingMatchIds, playFromItem, removePlay, savePlays, signature } from "./plays.js";

hideBrokenCrests();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RATE_RE = /too many requests|per minute|rate limit|limite di richieste/i;

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
      const queue = [...data.needsSync];
      const total = queue.length;
      let done = 0;
      const worker = async () => {          // 2 campionati alla volta: API-Football limita le richieste al minuto
        while (queue.length) {
          const id = queue.shift();
          let lastError = null;
          for (let attempt = 0; attempt < 4; attempt += 1) {   // limite di richieste al minuto: si aspetta e si riprova da soli
            try { await getJson(`/api/sync?league=${id}`); lastError = null; break; } catch (e) {
              lastError = e;
              if (!RATE_RE.test(e.message)) break;
              state.banner = `API-Football è occupata: nuovo tentativo tra ${10 * (attempt + 1)} s…`; render();
              await sleep(10000 * (attempt + 1));
            }
          }
          if (lastError) failures.push(`${data.leagues.find((l) => l.id === id)?.name ?? id}: ${lastError.message}`);
          done += 1;
          state.banner = `Aggiorno i campionati… ${done}/${total}`; render();
        }
      };
      state.banner = `Aggiorno i campionati… 0/${total}`; render();
      await Promise.all(Array.from({ length: Math.min(2, total) }, worker));
      data = await getJson("/api/fixtures");
      state.banner = failures.length ? `Aggiornamento incompleto. ${failures[0]}` : null;
    } else state.banner = null;
    Object.assign(state, { matches: data.matches, leagues: data.leagues, continents: data.continents ?? [], updatedAt: data.updatedAt });
    if (data.needsCrests?.length) fillCrests(data.needsCrests);
  } catch (e) {
    state.error = e.message;
  } finally {
    state.loading = false; render();
  }
}

/** Scudetti dei campionati principali: l'elenco squadre si scarica una volta (poi sta in cache 30 giorni); si riprova da soli se il limite è superato. */
let crestsBusy = false;
async function fillCrests(leagueIds) {
  if (crestsBusy) return;
  crestsBusy = true;
  try {
    let any = false;
    for (const id of leagueIds) {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        try {
          const r = await getJson(`/api/crests?league=${encodeURIComponent(id)}`);
          if (r.retry?.pending) { await sleep(Math.min(60000, r.retry.afterMs || 20000)); continue; }
          any = any || r.teams > 0; break;
        } catch (e) { if (!RATE_RE.test(e.message)) break; await sleep(15000); }
      }
      await sleep(1200);
    }
    if (any) { const data = await getJson("/api/fixtures"); state.matches = data.matches; render(); }
  } catch { /* gli scudetti sono un di più: restano le sigle */ } finally { crestsBusy = false; }
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
const sideHtml = (name, logo, goals) => `<span class="side">${crest(name, logo)}<b>${esc(name)}</b>${goals != null ? `<span class="score">${goals}</span>` : ""}</span>`;
function rowHtml(m) {
  const time = fmtTime.format(new Date(m.kickoffAt));
  const live = m.status === "in_progress" ? `<span class="live-tag">In corso</span>` : "";
  const check = isOpen(m) ? `<input type="checkbox" data-sel="${esc(m.id)}" ${state.selected.has(m.id) ? "checked" : ""} aria-label="Seleziona ${esc(m.home)} – ${esc(m.away)}" />` : `<span></span>`;
  return `<div class="row ${state.selected.has(m.id) ? "sel" : ""}">${check}
    <button class="row-main" type="button" data-open="${esc(m.id)}">
      <span class="meta"><b>${time}</b><span>${esc(leagueName(m.league, true))}</span>${live}</span>
      <span class="fx">${sideHtml(m.home, m.homeLogo, m.homeScore)}${sideHtml(m.away, m.awayLogo, m.awayScore)}</span>
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
    detailState = { id, tab: "analysis", af: null, data: await getJson(`/api/analysis?id=${encodeURIComponent(id)}&n=${state.n}`) };
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
function formBox(name, f, logo) {
  const last = f.last.map((r) => `<div><span>${r.venue === "C" ? "casa" : "trasf."} vs ${esc(r.opp)}</span><span>${r.gf}–${r.ga}</span></div>`).join("") || "<div>Nessuna partita</div>";
  return `<div class="form"><b class="with-crest">${crest(name, logo, "crest sm")}${esc(name)}</b>${last}</div>`;
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
  const played = match.homeScore != null;
  const body = `
    ${matchHeader({ home: match.home, away: match.away, homeLogo: match.homeLogo, awayLogo: match.awayLogo, chips: [leagueName(match.league)],
      centre: played ? `<strong class="af-big">${esc(match.homeScore)}<i>–</i>${esc(match.awayScore)}</strong>` : `<strong class="af-big">${esc(fmtTime.format(new Date(match.kickoffAt)))}</strong>`,
      sub: played ? kick : dayParts(dayKey(match.kickoffAt)).long })}
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
    <div class="formrow">${formBox(match.home, a.inputs.home, match.homeLogo)}${formBox(match.away, a.inputs.away, match.awayLogo)}</div>`;
  $("#detail-body").innerHTML = `<div class="tabs" role="tablist" aria-label="Sezioni del dettaglio">
      <button class="tab" data-tab="analysis" aria-pressed="true">Analisi</button>
      <button class="tab" data-tab="data" aria-pressed="false">Dati API-Football</button></div>
    <div id="pane-analysis">${body}</div><div id="pane-data" hidden></div>`;
  for (const s of a.selections) applyOdds(s.key);
  if (detailState.tab === "data") showTab("data");
}

/** Cambia scheda; i dati API-Football si scaricano alla prima apertura (poi restano in memoria finché la modale è aperta). */
async function showTab(tab) {
  if (!detailState) return;
  detailState.tab = tab;
  for (const b of document.querySelectorAll("[data-tab]")) b.setAttribute("aria-pressed", String(b.dataset.tab === tab));
  $("#pane-analysis").hidden = tab !== "analysis";
  $("#pane-data").hidden = tab !== "data";
  if (tab !== "data") return;
  if (detailState.af) { showAf(detailState.af, detailState.id); scheduleAfRetry(); return; }
  loadAf(detailState.id, 0);
}
const MAX_AF_TRIES = 8;
let afTimer = null;
function showAf(data, id) { if (detailState?.id === id) $("#pane-data").innerHTML = renderAfDetail(data); }

/**
 * Scarica i dati API-Football. Il server scarica solo ciò che manca (il resto sta in cache) e, se il provider limita le richieste,
 * dice quanto attendere: qui si riprova da soli, mostrando subito ciò che è già arrivato.
 */
async function loadAf(id, attempt) {
  clearTimeout(afTimer);
  if (attempt === 0 && !detailState?.af) $("#pane-data").innerHTML = `<div class="af-loading"><i></i>Scarico i dati da API-Football…</div>`;
  try {
    const data = await getJson(`/api/match-detail?id=${encodeURIComponent(id)}`);
    if (detailState?.id !== id) return;
    detailState.af = data; detailState.afTries = attempt;
    if (detailState.tab === "data") showAf(data, id);
    scheduleAfRetry();
  } catch (e) {
    if (detailState?.id !== id) return;
    if (attempt < MAX_AF_TRIES && (RATE_RE.test(e.message) || /HTTP 5\d\d|Failed to fetch|NetworkError/i.test(e.message))) {
      detailState.afTries = attempt + 1;
      if (!detailState.af) $("#pane-data").innerHTML = `<div class="af-loading"><i></i>API-Football è occupata: nuovo tentativo tra pochi secondi…</div>`;
      afTimer = setTimeout(() => loadAf(id, attempt + 1), 6000 + attempt * 4000);
    } else if (!detailState.af) $("#pane-data").innerHTML = `<p class="af-empty">Dati API-Football non disponibili: ${esc(e.message)}<br><button class="ghost" type="button" data-af-retry>Riprova</button></p>`;
  }
}
/** Se mancano sezioni (rimandate dal server), richiede di nuovo dopo l'attesa suggerita: pazienza crescente, al massimo MAX_AF_TRIES volte. */
function scheduleAfRetry() {
  clearTimeout(afTimer);
  const d = detailState?.af;
  const tries = detailState?.afTries ?? 0;
  if (!d?.retry?.pending) return;
  const note = $("#af-retry span");
  if (tries >= MAX_AF_TRIES) { if (note) note.innerHTML = `Alcune sezioni non sono ancora arrivate. <button class="link" type="button" data-af-retry>Riprova ora</button>`; return; }
  const wait = Math.min(60000, Math.max(1500, (d.retry.afterMs || 3000) * (1 + 0.25 * tries)));
  let left = Math.ceil(wait / 1000);
  const id = detailState.id;
  const tick = () => {
    if (detailState?.id !== id) return;
    const n = $("#af-retry span");
    if (n) n.textContent = `${d.retry.pending} ${d.retry.pending === 1 ? "sezione ancora da scaricare" : "sezioni ancora da scaricare"}: nuovo tentativo tra ${left} s.`;
    if (left <= 0) { loadAf(id, tries + 1); return; }
    left -= 1; afTimer = setTimeout(tick, 1000);
  };
  tick();
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
      <span class="fx">${sideHtml(i.home, i.homeLogo)}${sideHtml(i.away, i.awayLogo)}</span>
      ${i.pick ? pickChip({ ...i.pick, confidence: i.confidence, sample: i.sample }) : ""}
      <span class="pv-more"><span>Quota minima ${num(i.pick?.minOdds)}</span><span>Gol attesi ${num(i.lambda.total)}</span><span>Più probabile ${esc(i.topScores[0]?.score ?? "—")}</span>${i.alternatives[0] ? `<span>Alternativa: ${esc(i.alternatives[0].label)} ${pct(i.alternatives[0].pLow)}</span>` : ""}</span>
      ${isBetItem(i) ? `<span class="pv-stake"><span data-plan="${esc(i.id)}"></span><label class="pv-odds">Quota reale <input inputmode="decimal" data-pv-odds="${esc(i.id)}" placeholder="stima ${num(i.pick.estOdds)}" aria-label="Quota reale per ${esc(i.home)} – ${esc(i.away)}" /></label></span>` : ""}
      <span class="pv-btns">${i.pick ? saveButton("data-save", i.id, isSaved(singleOf(i))) : ""}<button class="link" type="button" data-open="${esc(i.id)}">Vedi il calcolo</button></span>
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
    <div class="pv-actions"><button class="primary" id="share-pdf" type="button">Condividi PDF</button><button class="ghost" id="load-quotes" type="button">Preleva quote reali</button><button class="ghost" id="copy-preview" type="button">Copia testo</button><button class="ghost" id="save-bets" type="button">Salva le singole BET</button></div>
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
  el.innerHTML = plan.multiples.map((m, idx) => `<article class="pv-multi-card">
      <header><b>${esc(m.label)}</b><span class="pill">${m.items.length} gare</span></header>
      <p class="note">${esc(m.note)}</p>
      <ol class="legs">${m.legs.map((l) => `<li><span class="t">${fmtTime.format(new Date(l.item.kickoffAt))}</span><span class="m">${crest(l.item.home, l.item.homeLogo, "crest xs")}${crest(l.item.away, l.item.awayLogo, "crest xs")}${esc(l.item.home)} – ${esc(l.item.away)}</span><b>${esc(l.item.pick.label)}</b><small>${num(l.odds)} ${esc(l.source)}</small></li>`).join("")}</ol>
      <div class="mstats"><span>Probabilità prudente <b>${pct(m.plan.pLow)}</b></span><span>Quota minima <b>${num(m.minOdds)}</b></span></div>
      <div class="pv-stake">${multiLine(m)}</div>
      ${saveButton("data-save-multi", String(idx), isSaved(multiOf(m)))}
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


/* ---------- Giocate salvate: confronto con i risultati ---------- */
let plays = loadPlays();
let playResults = {};
const saveButton = (attr, value, saved) => `<button class="save${saved ? " done" : ""}" type="button" ${attr}="${esc(value)}"${saved ? " disabled" : ""}>${saved ? "✓ Salvata" : "Salva giocata"}</button>`;
const quoteOfRow = (id) => { const row = lastPlan?.rows.get(id); return { odds: row?.eff?.odds ?? row?.plan?.odds ?? null, stake: row?.eff?.stake ?? null, source: row?.plan?.source ?? null }; };
const singleOf = (item) => playFromItem(item, quoteOfRow(item.id));
const multiOf = (m) => ({ kind: "multiple", label: m.label, odds: m.eff?.odds ?? m.plan?.odds ?? null, stake: m.eff?.stake ?? null, oddsSource: m.plan?.source ?? null, legs: m.items.map(legFromItem) });
const isSaved = (cand) => plays.some((p) => signature(p) === signature(cand));
function commitPlay(cand) {
  const r = addPlay(plays, cand);
  if (r.added) { plays = r.plays; savePlays(plays); }
  updatePlaysBadge();
  return r.added;
}
function updatePlaysBadge() { $("#open-plays").textContent = plays.length ? `Giocate (${plays.length})` : "Giocate"; }

const PLAY_IT = { won: "Vinta", lost: "Persa", pending: "In attesa", void: "Annullata" };
const PLAY_PILL = { won: "ok", lost: "err", pending: "warn", void: "" };
const dayShort = (iso) => `${dayParts(dayKey(iso)).dm} ${fmtTime.format(new Date(iso))}`;
function legHtml(l) {
  const sc = l.res ?? (l.live?.status === "final" ? [l.live.homeScore, l.live.awayScore] : null);
  return `<li class="pl-leg ${l.status}"><span class="pl-t">${crest(l.home, l.homeLogo, "crest sm")}${crest(l.away, l.awayLogo, "crest sm")}<span><b>${esc(l.home)} – ${esc(l.away)}</b><small>${esc(leagueName(l.league, true))} · ${esc(dayShort(l.kickoffAt))}</small></span></span>
    <span class="pl-pick"><b>${esc(l.label)}</b><small>prudente ${pct(l.pLow)}</small></span>
    <span class="pl-res">${sc ? `<b>${sc[0]}–${sc[1]}</b>` : `<small>${l.live?.status === "in_progress" ? "in corso" : "da giocare"}</small>`}<span class="af-pill ${PLAY_PILL[l.status]}">${PLAY_IT[l.status]}</span></span></li>`;
}
function renderPlays(note = "") {
  const ev = evaluate(plays, playResults);
  const t = ev.total;
  const tile = (k, v, cls = "") => `<div class="${cls}"><small>${k}</small><b>${v}</b></div>`;
  const body = !plays.length
    ? `<p class="empty">Nessuna giocata salvata. Dal preview premi “Salva giocata” su una singola o su una multipla: il giorno dopo le troverai qui, confrontate con i risultati.</p>`
    : `<div class="pl-sum">${tile("Centrate", t.won + t.lost ? `${t.won} su ${t.won + t.lost}${t.rate != null ? ` · ${pct(t.rate)}` : ""}` : "—", t.won + t.lost && t.rate >= 0.5 ? "good" : "")}${tile("In attesa", String(t.pending))}${tile("Esito netto", t.staked ? eur(t.profit) : "—", t.staked ? (t.profit >= 0 ? "good" : "bad") : "")}</div>
      ${t.staked ? `<p class="pl-note">Esito netto calcolato sulle ${eur(t.staked)} puntate delle giocate già concluse (con puntata e quota salvate).</p>` : ""}
      ${ev.rows.map(({ play, legs, status, profit }) => `<article class="pl-card ${status}">
        <header><b>${esc(play.label)}</b><span class="af-pill ${PLAY_PILL[status]}">${PLAY_IT[status]}</span></header>
        <ul>${legs.map(legHtml).join("")}</ul>
        <footer><span>Salvata ${esc(dayShort(play.savedAt))}${play.odds ? ` · quota ${num(play.odds)}${play.oddsSource ? ` (${esc(play.oddsSource)})` : ""}` : ""}${play.stake ? ` · puntata ${eur(play.stake)}` : ""}${profit != null ? ` · <b class="${profit >= 0 ? "pl-gain" : "pl-loss"}">${profit >= 0 ? "+" : ""}${eur(profit)}</b>` : ""}</span><button class="link" type="button" data-del-play="${esc(play.id)}">Elimina</button></footer></article>`).join("")}`;
  $("#plays-body").innerHTML = `<h2 class="d-title">Le mie giocate</h2><p class="d-sub">Le previsioni salvate dal preview, confrontate con i risultati veri.</p>
    <div class="pv-actions"><button class="primary" id="refresh-plays" type="button">Aggiorna risultati</button></div><p class="pv-qstatus" id="plays-status" aria-live="polite">${esc(note)}</p>${body}
    <p class="foot">Le giocate restano salvate in questo dispositivo (non su Supabase). I risultati arrivano dalla sincronizzazione dei campionati: se una partita finita risulta ancora “in attesa”, premi Aggiorna risultati tra qualche minuto.</p>`;
}
let playsBusy = false;
async function refreshPlays() {
  if (playsBusy) return;
  playsBusy = true;
  const set = (m) => { const el = $("#plays-status"); if (el) el.textContent = m; };
  try {
    const ids = pendingMatchIds(plays);
    if (ids.length) {
      const now = Date.now();
      const stale = [...new Set(plays.flatMap((p) => p.legs).filter((l) => !l.res && Date.parse(l.kickoffAt) < now - 100 * 60e3).map((l) => l.league))];
      for (const [i, lg] of stale.entries()) {                    // aggiorna i campionati con partite già finite (la sincronizzazione salta se i dati sono freschi)
        set(`Aggiorno i campionati… ${i + 1}/${stale.length}`);
        try { await getJson(`/api/sync?league=${encodeURIComponent(lg)}`); } catch (e) { if (RATE_RE.test(e.message)) { await sleep(8000); try { await getJson(`/api/sync?league=${encodeURIComponent(lg)}`); } catch { /* si usano i dati già presenti */ } } }
      }
      set("Leggo i risultati…");
      for (let i = 0; i < ids.length; i += 50) Object.assign(playResults, (await getJson(`/api/results?ids=${ids.slice(i, i + 50).map(encodeURIComponent).join(",")}`)).matches);
      if (absorbResults(plays, playResults)) savePlays(plays);
    }
    renderPlays(ids.length ? `Risultati aggiornati alle ${fmtTime.format(new Date())}.` : "");
  } catch (e) { renderPlays(`Risultati non disponibili: ${e.message}`); } finally { playsBusy = false; }
}
function openPlays() { renderPlays(); $("#plays").showModal(); refreshPlays(); }

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
  if (t.closest("[data-af-retry]") && detailState) { detailState.afTries = 0; loadAf(detailState.id, 0); }
  const tab = t.closest("[data-tab]");
  if (tab) showTab(tab.dataset.tab);
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
  const sv = t.closest("[data-save]");
  if (sv) { const item = lastPreview?.items.find((i) => i.id === sv.dataset.save); if (item?.pick) { commitPlay(singleOf(item)); sv.textContent = "✓ Salvata"; sv.classList.add("done"); sv.disabled = true; } }
  const sm = t.closest("[data-save-multi]");
  if (sm && lastPlan?.multiples[Number(sm.dataset.saveMulti)]) { commitPlay(multiOf(lastPlan.multiples[Number(sm.dataset.saveMulti)])); sm.textContent = "✓ Salvata"; sm.classList.add("done"); sm.disabled = true; }
  if (t.closest("#save-bets") && lastPreview) {
    const bets = lastPreview.items.filter(isBetItem);
    const n = bets.filter((i) => commitPlay(singleOf(i))).length;
    t.closest("#save-bets").textContent = n ? `✓ ${n} salvate` : "Già salvate";
    for (const b of document.querySelectorAll("[data-save]")) if (bets.some((i) => i.id === b.dataset.save)) { b.textContent = "✓ Salvata"; b.classList.add("done"); b.disabled = true; }
  }
  if (t.closest("#open-plays")) openPlays();
  if (t.closest("#refresh-plays")) refreshPlays();
  const del = t.closest("[data-del-play]");
  if (del) { plays = removePlay(plays, del.dataset.delPlay); savePlays(plays); updatePlaysBadge(); renderPlays(); }
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
  detailState = { ...detailState, id, data: await getJson(`/api/analysis?id=${encodeURIComponent(id)}&n=${state.n}`) };
  renderDetail();
}
$("#detail").addEventListener("close", () => clearTimeout(afTimer));
updatePlaysBadge();
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
