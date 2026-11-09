import "./style.css";
import { MODEL, verdictFor } from "../functions/api/model.js";
import { computePlan, isBetItem } from "./plan.js";
import { dayKey, dayParts, eur, esc, fmtTime, num, pct } from "./format.js";
import { buildPreviewPdf } from "./report.js";
import { renderAfDetail } from "./afdetail.js";
import { crest, hideBrokenCrests, matchHeader } from "./ui.js";
import { efficiency, efficiencyHtml, reliabilityHtml } from "./efficiency.js";
import { absorbCorners, absorbResults, addPlay, evaluate, legFromItem, loadPlays, pendingCornerIds, pendingMatchIds, playFromItem, savePlays, signature } from "./plays.js";
import { cornerBarHtml, cornerHtml, cornerShort } from "./corners.js";
import { icon } from "./icons.js";
import { enableSwipe } from "./gestures.js";
import { accordionHtml, filterRows, groupByDay, playHeadHtml } from "./playlist.js";
import { showToast } from "./toast.js";

hideBrokenCrests();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const RATE_RE = /too many requests|per minute|rate limit|limite di richieste/i;

const $ = (s, r = document) => r.querySelector(s);
/** Fisarmoniche aperte (giocate, statistiche, nazioni): stanno in memoria, così sopravvivono ai ridisegni delle viste. */
const openAcc = new Set();
const reduceMotion = () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
const state = {
  matches: [], leagues: [], continents: [], league: "all", navOpen: false, day: null, onlyBet: false, selected: new Set(),
  n: 8, loading: false, error: null, banner: null, syncTried: false, updatedAt: null,
};
// Modalità personalizzata: solo Over/Under 2,5 o corner sopra una soglia di probabilità.
const MODE_KEY = "stayLive.customMode", THR_KEY = "stayLive.customThr";
try { state.mode = localStorage.getItem(MODE_KEY) === "1" ? "custom" : "standard"; const t = Number(localStorage.getItem(THR_KEY)); state.thr = t >= 0.5 && t <= 0.9 ? t : 0.6; } catch { state.mode = "standard"; state.thr = 0.6; }
const isCustom = () => state.mode === "custom";
/** In modalità personalizzata una partita passa se Over/Under 2,5 (non contraddetto da API-Football) o un corner ha probabilità >= soglia. */
const qualifies = (m) => { const o = m.ou?.best, c = m.corner?.best; return Boolean((o && o.p >= state.thr && o.agree !== "contraddice") || (c && c.p >= state.thr)); };
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

/* Apertura istantanea: l'ultimo elenco ricevuto resta nel dispositivo e si mostra subito; poi l'app si aggiorna in secondo piano. */
const CACHE_KEY = "stayLive.fixtures";
const readCache = () => { try { const c = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null"); return c?.data?.matches && Date.now() - c.at < 36 * 3600e3 ? c : null; } catch { return null; } };
const writeCache = (data) => { try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data })); } catch { /* spazio esaurito: si salta */ } };
function applyData(data) {
  Object.assign(state, { matches: data.matches, leagues: data.leagues, continents: data.continents ?? [], updatedAt: data.updatedAt });
  writeCache(data);
  if (data.needsCrests?.length) fillCrests(data.needsCrests);
}

async function load({ sync = true, fresh = false } = {}) {
  if (state.loading || state.syncing) return;
  state.loading = true; state.error = null; render();
  try {
    let data = await getJson(fresh ? "/api/fixtures?fresh=1" : "/api/fixtures");
    applyData(data); state.banner = null;
    if (sync && !state.syncTried && data.needsSync.length) {
      state.syncTried = true;
      state.loading = false; state.syncing = true; render();            // l'elenco è già utilizzabile: l'aggiornamento prosegue in secondo piano
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
      data = await getJson("/api/fixtures?fresh=1");     // dopo la sincronizzazione si salta la copia pronta
      applyData(data);
      state.banner = failures.length ? `Aggiornamento incompleto. ${failures[0]}` : null;
    }
  } catch (e) {
    if (state.matches.length) state.banner = "Non riesco ad aggiornare: ti mostro gli ultimi dati salvati.";   // con dati già a schermo l'errore non blocca nulla
    else state.error = e.message;
  } finally {
    state.loading = false; state.syncing = false; render();
    if (fresh && !state.error) autoCorners({ force: true });      // aggiornamento a mano: si completano anche i corner mancanti
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
    if (any) { const data = await getJson("/api/fixtures?fresh=1"); state.matches = data.matches; render(); }
  } catch { /* gli scudetti sono un di più: restano le sigle */ } finally { crestsBusy = false; }
}

/* ---------- Lista ---------- */
/** Etichetta delle fonti usate dal cervello unico: API = pronostico di API-Football, Q = quote di mercato. */
const basisTag = (b) => (!b || b === "storico" ? "" : `<i class="api-tag" title="${b === "mercato" ? "Calcolato con le quote di mercato" : b === "api" ? "Calcolato con il pronostico di API-Football" : "Calcolato con il pronostico di API-Football e le quote di mercato"}">${b === "api+mercato" ? "API+Q" : b === "api" ? "API" : "Q"}</i>`);
function pickChip(p) {
  if (!p) return "";
  if (p.confidence === "insufficiente") return `<span class="pick none"><b class="vd-pill">Pochi dati</b><span class="pk-label">${p.sample} gare di storico</span></span>`;
  const bet = p.verdict === "BET";
  return `<span class="pick ${bet ? "bet" : "skip"}"><b class="vd-pill">${bet ? icon("check") : ""}${p.verdict}</b><span class="pk-label">${esc(p.label)}${basisTag(p.basis)}</span><em class="pk-pct" title="Probabilità prudente">${pct(p.pLow)}</em></span>`;
}
function customChips(m) {
  const cm = m.corner ?? cornerCache.get(m.id) ?? null;
  const o = m.ou?.best, c = cm?.best;
  const ou = o ? `<span class="cm ${o.p >= state.thr && o.agree !== "contraddice" ? "hi" : "lo"}"><b>${icon(o.side === "over" ? "trending-up" : "trending-down")}${o.side === "over" ? "Over" : "Under"} 2,5</b><em>${pct(o.p)}</em>${o.pApi != null ? `<small>API ${pct(o.pApi)}</small>` : ""}</span>` : `<span class="cm none"><b>Over/Under 2,5</b><small>dati insufficienti</small></span>`;
  const none = m.cornerState === "none" || m.cornerState === "missing";
  const co = c ? `<span class="cm ${c.p >= state.thr ? "hi" : "lo"}"><b>${icon("flag")}Corner ${c.side === "over" ? "Over" : "Under"} ${num(c.line, 1)}</b><em>${pct(c.p)}</em><small>quota ${num(c.odd)} · mercato</small></span>` : `<span class="cm none"><b>${icon("flag")}Corner</b><small>${none ? "nessuna quota" : "non cercati"}</small></span>`;
  return `<span class="cm-row">${ou}${co}</span>${cornerBarHtml({ ...m, corner: cm })}`;
}
function visibleMatches() {
  return state.matches.filter((m) => {
    if (!inScope(m.league)) return false;
    if (state.day === "results") return m.status === "final";
    if (!isOpen(m) || dayKey(m.kickoffAt) !== state.day) return false;
    if (isCustom()) return qualifies(m);
    return !state.onlyBet || m.pick?.verdict === "BET";
  });
}
const sideHtml = (name, logo, goals) => `<span class="side">${crest(name, logo)}<b>${esc(name)}</b>${goals != null ? `<span class="score">${goals}</span>` : ""}</span>`;
let animateNext = true, animTimer = null;
/** Filtro a tre voci: Tutte / Solo BET / O/U + corner (sostituisce interruttore e pulsanti separati). */
const segValue = () => (isCustom() ? "custom" : state.onlyBet ? "bet" : "all");
function setSeg(v) {
  state.onlyBet = v === "bet"; state.mode = v === "custom" ? "custom" : "standard";
  try { localStorage.setItem(MODE_KEY, isCustom() ? "1" : "0"); } catch { /* preferenza non salvata */ }
  animateNext = true; render();
}
/** Selezione che la riga mostra e si può salvare: il consiglio principale; in "O/U + corner" l'Over/Under 2,5 migliore (i corner non sono giocabili: nessun modello). */
function listSel(m) {
  if (isCustom()) {
    const o = m.ou?.best;
    if (!o) return null;
    return { key: o.key, label: o.side === "over" ? "Over 2,5" : "Under 2,5", market: "Gol totali", preferred: false, p: o.p, pLow: o.pLow, minOdds: o.minOdds ?? null,
      verdict: o.p >= state.thr && o.agree !== "contraddice" ? "BET" : "EVITA", reason: o.agree === "contraddice" ? "API-Football non conferma." : `Probabilità prudente ${pct(o.pLow)}.`,
      confidence: m.ou.confidence, basis: m.ou.basis ?? null, pApi: o.pApi ?? null, agree: o.agree ?? null, odds: null, ev: null };
  }
  const p = m.pick;
  return p && p.confidence !== "insufficiente" ? p : null;
}
/** Giocata dalla lista: stessa struttura e stessa fotografia del preview, ma senza puntata né quota (qui non c'è un piano). */
function playOfList(m) {
  const sel = listSel(m);
  if (!sel) return null;
  const item = { id: m.id, league: m.league, kickoffAt: m.kickoffAt, home: m.home, away: m.away, homeLogo: m.homeLogo ?? null, awayLogo: m.awayLogo ?? null, status: m.status ?? null, confidence: sel.confidence, pick: sel, corner: m.corner ?? cornerCache.get(m.id) ?? null };
  return { ...playFromItem(item, {}), snap: { kickoffAt: item.kickoffAt, league: item.league, home: item.home, away: item.away, homeLogo: item.homeLogo, awayLogo: item.awayLogo, confidence: item.confidence, status: item.status, pick: sel, corner: item.corner, plan: null } };
}
function rowSaveHtml(m) {
  const cand = isOpen(m) ? playOfList(m) : null;
  if (!cand) return "";
  const saved = isSaved(cand);
  return `<button class="row-save${saved ? " done" : ""}" type="button" data-row-save="${esc(m.id)}" aria-label="${saved ? `Giocata salvata: ${esc(cand.label)}` : `Salva giocata: ${esc(cand.label)}`}" aria-pressed="${saved}"${saved ? " disabled" : ""}>${icon("bookmark")}</button>`;
}
function rowHtml(m, k = 0) {
  const time = fmtTime.format(new Date(m.kickoffAt));
  const live = m.status === "in_progress" ? `<span class="live-tag">In corso</span>` : "";
  const check = isOpen(m) ? `<label class="chk"><input type="checkbox" data-sel="${esc(m.id)}" ${state.selected.has(m.id) ? "checked" : ""} aria-label="Seleziona ${esc(m.home)} – ${esc(m.away)}" /></label>` : `<span></span>`;
  return `<div class="row ${state.selected.has(m.id) ? "sel" : ""}${!isCustom() && m.pick?.verdict === "BET" && m.pick.confidence !== "insufficiente" ? " is-bet" : ""}" style="--i:${Math.min(k, 9)}">${check}
    <button class="row-main" type="button" data-open="${esc(m.id)}">
      <span class="meta"><b>${time}</b><span>${esc(leagueName(m.league, true))}</span>${live}</span>
      <span class="fx">${sideHtml(m.home, m.homeLogo, m.homeScore)}${sideHtml(m.away, m.awayLogo, m.awayScore)}</span>
      ${isCustom() ? customChips(m) : pickChip(m.pick)}
    </button>${rowSaveHtml(m)}</div>`;
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
  toggle.textContent = scopeLabel();
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
      return accordionHtml({ id: `nat:${key}`, open: openAcc.has(`nat:${key}`), cls: "nation", headCls: "nation-head",
        head: `<span>${n.international ? "🏆 " : ""}${esc(n.nation)}</span><small>${ls.length} ${ls.length === 1 ? "campionato" : "campionati"}</small>`,
        body: `<div class="nation-leagues">${ls.length > 1 ? chip(`n:${n.country}`, "Tutti") : ""}${ls.map((l) => chip(l.id, l.name)).join("")}</div>` });
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
  document.body.classList.toggle("mode-custom", isCustom());
  const seg = segValue();
  const segEl = $("#mode-seg");
  segEl.style.setProperty("--i", String(["all", "bet", "custom"].indexOf(seg)));
  for (const b of segEl.querySelectorAll("[data-seg]")) b.setAttribute("aria-pressed", String(b.dataset.seg === seg));
  $("#select-bets").textContent = isCustom() ? "Le filtrate" : "I BET";
  $("#custom-panel").hidden = !isCustom() || state.day === "results";
  $("#thr").value = String(state.thr);
  const long = state.day && state.day !== "results" ? dayParts(state.day).long : "";
  $("#day-title").textContent = state.day === "results" ? "Ultimi risultati" : long ? long[0].toUpperCase() + long.slice(1) : "Partite";
  const n = list.length, one = n === 1;
  $("#summary").innerHTML = (state.loading && !state.matches.length ? `<span class="stat">Caricamento…</span>`
    : state.error ? `<span class="stat">Dati non disponibili</span>`
    : isCustom() && state.day !== "results" ? `<span class="stat"><b>${n}</b> ${one ? "partita" : "partite"} con O/U 2,5 o corner ≥ ${pct(state.thr)}</span>`
    : `<span class="stat"><b>${n}</b> ${one ? "partita" : "partite"}</span>${state.day === "results" ? "" : `<span class="stat bet"><b>${bets}</b> con BET</span>`}`)
    + (state.cornerNote && !state.loading && !state.error ? `<span class="stat note">${esc(state.cornerNote)}</span>` : "");
  const banner = $("#banner");
  banner.hidden = !(state.error || state.banner);
  banner.className = `banner${state.error ? " error" : ""}`;
  banner.textContent = state.error ?? state.banner ?? "";
  const listEl = $("#list");
  if (animateNext) { listEl.classList.add("anim"); animateNext = false; clearTimeout(animTimer); animTimer = setTimeout(() => listEl.classList.remove("anim"), 700); } else listEl.classList.remove("anim");   // un ridisegno senza cambio di filtro non rilancia l'ingresso delle righe
  listEl.innerHTML = state.loading && !state.matches.length ? Array.from({ length: 4 }, () => `<div class="row skel" aria-hidden="true"><i></i><i></i><i></i></div>`).join("")
    : list.length ? list.map((m, k) => rowHtml(m, k)).join("")
    : `<div class="empty">${state.loading ? "Carico i dati…" : state.error ? "" : isCustom() ? "Nessuna partita sopra la soglia. Abbassa la soglia: i corner si cercano da soli ogni notte." : state.onlyBet ? "Nessun BET in questa giornata con i filtri scelti." : "Nessuna partita per questa selezione."}</div>`;
  $("#refresh").disabled = state.loading;
  $("#refresh").classList.toggle("spin", state.loading || Boolean(state.syncing));
  const stamps = state.leagues.map((l) => l.syncedAt).filter(Boolean).sort();
  const when = (iso) => `${dayParts(dayKey(iso)).dm} ${fmtTime.format(new Date(iso))}`;
  $("#set-updated").textContent = stamps.length ? `Più recente ${when(stamps.at(-1))} · più vecchio ${when(stamps[0])}` : "Nessun dato ancora";
  syncSelbar();
}
function syncSelbar() {
  const count = state.selected.size;
  $("#selbar").hidden = !count || document.body.dataset.view !== "matches";
  $("#sel-count").textContent = `${count} ${count === 1 ? "partita" : "partite"}`;
}

/* ---------- Dettaglio e calcolo ---------- */
const oddsInput = new Map();
let detailState = null;

async function openDetail(id) {
  $("#detail").showModal();
  $("#detail-body").innerHTML = `<div class="af-loading"><i></i>Calcolo in corso…</div>`;
  try {
    detailState = { id, af: null, afStarted: false, data: await getJson(`/api/analysis?id=${encodeURIComponent(id)}&n=${state.n}`) };
    renderDetail();
  } catch (e) {
    $("#detail-body").innerHTML = `<h2 class="d-title">Analisi non disponibile</h2><p class="d-sub">${esc(e.message)}</p>`;
  }
}
function selectionRow(s, sample, matchId) {
  const stored = oddsInput.get(`${matchId}:${s.key}`) ?? "";
  return `<div class="sl" data-row="${s.key}">
    <span class="sl-name">${esc(s.label)}</span>
    <span class="sl-p">${pct(s.pLow)}<small>${s.pApi != null ? `API ${pct(s.pApi)} · storico ${pct(s.pModel)}` : `solo storico ${pct(s.pModel ?? s.p)}`}</small></span>
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
  const team = (name, f) => `${esc(name)}: ${f.n} partite usate (massimo ${a.n}), ognuna pesa ${num(MODEL.decay)} volte la successiva. Media gol fatti ${num(f.gfAvg)} e subiti ${num(f.gaAvg)} → attacco ${num(f.attackRaw, 3)}, difesa ${num(f.defenseRaw, 3)} (1,000 = media del campionato). Con ${MODEL.formShrinkK} partite “medie” aggiunte per non esagerare: attacco <b>${num(f.attack, 3)}</b>, difesa <b>${num(f.defense, 3)}</b>.`;
  const steps = [
    ["Media gol di riferimento", `Nelle ${i.baseline.sample} partite di ${i.baseline.scope} già giocate: ${base} Il dato è mescolato con una media di partenza (${num(MODEL.priorHome, 1)} / ${num(MODEL.priorAway, 1)}) che pesa come ${MODEL.priorWeight} partite.`],
    ["Forma delle due squadre", `${team(match.home, i.home)}<br>${team(match.away, i.away)}`],
    ["Gol attesi", `${esc(match.home)}: ${num(i.neutral ? i.baseline.perTeam : i.baseline.home, 3)} × attacco ${num(i.home.attack, 3)} × difesa avversaria ${num(i.away.defense, 3)} = <b>${num(a.lambda.home, 2)}</b>. ${esc(match.away)}: ${num(i.neutral ? i.baseline.perTeam : i.baseline.away, 3)} × ${num(i.away.attack, 3)} × ${num(i.home.defense, 3)} = <b>${num(a.lambda.away, 2)}</b>. Totale atteso <b>${num(a.lambda.total, 2)}</b> gol.`],
    [a.api?.used ? "Probabilità dalle ultime partite" : "Probabilità di ogni esito", `Ogni punteggio i–j vale Poisson(${num(a.lambda.home)}; i) × Poisson(${num(a.lambda.away)}; j). Sommando le caselle giuste si ottengono tutti i mercati: ad esempio Over 2,5 = 1 − P(0, 1 o 2 gol totali) = <b>${pct(sel("over25").p, 1)}</b>; 1 = somma dei punteggi con più gol in casa = <b>${pct(sel("home").p, 1)}</b>. Più probabili: ${a.topScores.map((t) => `${t.score} (${pct(t.p, 1)})`).join(", ")}.`],
    ...(a.api?.used ? [
      ["Pronostico di API-Football", `${a.api.percent ? `Il provider stima ${esc(match.home)} ${pct(a.api.percent.home)}, pareggio ${pct(a.api.percent.draw)}, ${esc(match.away)} ${pct(a.api.percent.away)}. ` : ""}${a.api.lambda ? `Dalle medie gol della stagione (${a.api.played} partite giocate) ricavo ${num(a.api.lambda.home, 2)} gol attesi per ${esc(match.home)} e ${num(a.api.lambda.away, 2)} per ${esc(match.away)}, avvicinati alla media del campionato quando le partite sono poche. ` : ""}${a.api.underOver ? `Consiglio sui gol: ${a.api.underOver.side === "over" ? "Over" : "Under"} ${num(a.api.underOver.line, 1)} (+${MODEL.afAdviceShift * 100} punti a quella linea). ` : ""}`],
      ["Fusione delle fonti (un solo cervello)", `Per ogni esito la probabilità finale è la media pesata delle fonti disponibili: ${fusionText(a)}. Per la probabilità prudente: ultime partite stressate sui gol attesi, API-Football meno ${MODEL.afMargin * 100} punti sulle percentuali 1X2, mercato meno ${MODEL.marketMargin * 100} punti; poi si toglie il ${pct(MODEL.spreadPenalty)} della distanza tra la fonte più alta e la più bassa${a.fusion?.absent && (a.fusion.absent.home + a.fusion.absent.away) ? ` e ${num(MODEL.injPenalty * 100, 1)} punti per ogni assente confermato (${a.fusion.absent.home + a.fusion.absent.away} in totale)` : ""}. Se API-Football o il mercato stimano un esito sotto il ${pct(MODEL.afContrast)}, non può diventare BET.`],
    ] : []),
    ["Margine di prudenza", `Con ${a.sample} partite di campione le attese gol hanno un’incertezza di circa ±${pct(i.sd?.home ?? i.delta)} (dati poissoniani sul numero effettivo di partite, più la dispersione tra squadre). Ricalcolo la probabilità su una griglia di scenari e tengo il <b>quantile ${pct(MODEL.pLowQuantile)}</b>: è la <b>probabilità prudente</b>, quella che vedi in grande.`],
    ["Verdetto BET / EVITA", `BET solo se il campione è di almeno ${MODEL.betSample} partite, la probabilità prudente è almeno ${pct(MODEL.betThreshold)} e supera di almeno ${MODEL.minEdge * 100} punti la frequenza storica di quell’esito nel campionato (così non consiglio mercati “facili” sempre probabili, come Over 1,5). Quota minima = ${num(MODEL.edgeMargin)} ÷ probabilità prudente: sotto quella quota non c’è margine. Se inserisci la tua quota, BET se probabilità prudente × quota ≥ ${num(MODEL.edgeMargin)}. Esiti con quota equa sotto 1,25 non vengono proposti come scelta migliore.`],
  ];
  return `<ol class="steps">${steps.map(([t, d]) => `<li><b>${t}</b><span>${d}</span></li>`).join("")}</ol>`;
}
/** Pronostico di API-Football: cosa dice e quanto pesa nel verdetto (o perché manca). */
function apiBlock(a, st) {
  const api = a.api;
  if (api?.used) {
    const p = api.percent;
    const bar = p ? `<div class="api-bar" role="img" aria-label="Probabilità 1X2 secondo API-Football"><span class="h" style="flex:${p.home}">1 · ${pct(p.home)}</span><span class="d" style="flex:${p.draw}">X · ${pct(p.draw)}</span><span class="a" style="flex:${p.away}">2 · ${pct(p.away)}</span></div>` : "";
    const wApi = Math.round(api.weight * 100);
    return `<section class="api-card"><h4>Pronostico di API-Football</h4>${api.adviceIt ? `<p class="api-advice">Consiglio: <b>${esc(api.adviceIt.label)}</b> <small>${esc(api.adviceIt.long)}</small></p>` : ""}${bar}
      <p class="api-note">Peso nel verdetto: ${fusionText(a)}.</p></section>`;
  }
  if (st?.waiting) return `<p class="af-warn wait" role="status"><i class="af-spin" aria-hidden="true"></i><span>Scarico il pronostico di API-Football: il verdetto si aggiorna da solo appena arriva.</span></p>`;
  return `<p class="api-note warn">${st?.off ? "Chiave API-Football non configurata" : "Pronostico di API-Football non disponibile per questa partita"}: il verdetto si basa solo sulle ultime ${a.n} partite.</p>`;
}
/** Se il pronostico non è ancora arrivato (limite di richieste), ricalcola da solo dopo l'attesa suggerita. */
let anTimer = null;
function scheduleAnalysisRetry() {
  clearTimeout(anTimer);
  const st = detailState?.data?.afStatus;
  const tries = detailState?.anTries ?? 0;
  if (!st?.retry?.pending || tries >= 6) return;
  const id = detailState.id;
  anTimer = setTimeout(async () => {
    if (detailState?.id !== id) return;
    try {
      const data = await getJson(`/api/analysis?id=${encodeURIComponent(id)}&n=${state.n}`);
      if (detailState?.id !== id) return;
      const box = $("#detail"), y = box.scrollTop;
      detailState.data = data; detailState.anTries = tries + 1; renderDetail(); box.scrollTop = y;
    } catch { if (detailState?.id === id) { detailState.anTries = tries + 1; scheduleAnalysisRetry(); } }
  }, Math.min(60000, Math.max(2000, (st.retry.afterMs || 3000) * (1 + 0.25 * tries))));
}
/** Perché questa giocata: 2-3 righe, dai dati (API-Football prima, poi ultime partite). */
/** "API-Football 40% · mercato 35% · ultime partite 25%" per questa partita. */
function fusionText(a) {
  const w = a.fusion?.weights ?? { storico: 1, api: 0, mercato: 0 };
  return [w.api > 0 ? `API-Football <b>${Math.round(w.api * 100)}%</b>` : null, w.mercato > 0 ? `mercato <b>${Math.round(w.mercato * 100)}%</b>` : null, `ultime ${a.n} partite <b>${Math.round(w.storico * 100)}%</b>`].filter(Boolean).join(" · ");
}
function whyList(s, a) {
  const out = [];
  if (s.pApi != null) out.push(`API-Football stima il <b>${pct(s.pApi)}</b>${s.agree === "conferma" ? " e conferma" : ""}`);
  else out.push(a.basis === "storico" ? "API-Football non ha il pronostico: conto solo sulle ultime partite" : "API-Football non stima questo mercato");
  if (s.pMarket != null) out.push(`Mercato (quote senza margine): <b>${pct(s.pMarket)}</b>${s.odds ? ` · quota ${num(s.odds.median)}` : ""}`);
  out.push(`Ultime ${a.n} partite: <b>${pct(s.pModel ?? s.p)}</b>${s.base != null ? ` (media del campionato ${pct(s.base)})` : ""}`);
  if (s.spread >= 0.12) out.push(`Le fonti non sono del tutto d'accordo (distanza ${Math.round(s.spread * 100)} punti): probabilità prudente ridotta`);
  out.push(/^(over|under|btts|nobtts)/.test(s.key) ? `Gol attesi ${num(a.lambda.total)} · sotto la quota <b>${num(s.minOdds)}</b> non conviene` : `Sotto la quota <b>${num(s.minOdds)}</b> non conviene`);
  return out;
}
function recCard(s, a, matchId, i) {
  const stored = oddsInput.get(`${matchId}:${s.key}`) ?? "";
  return `<article class="rec" data-row="${s.key}">
    <header><span class="rec-tag">${i === 0 ? "Consigliata" : "Alternativa"}</span><b>${esc(s.label)}</b><span class="rec-p">${pct(s.pLow)}<small>prudente</small></span></header>
    <ul class="why">${whyList(s, a).map((x) => `<li>${x}</li>`).join("")}</ul>
    <div class="rec-q"><label>Hai la quota? <input inputmode="decimal" data-odds="${s.key}" value="${esc(stored)}" placeholder="es. 1,85" aria-label="Quota per ${esc(s.label)}" /></label>
      <span class="res ${s.verdict === "BET" ? "bet" : "skip"}" data-res="${s.key}" title="${esc(s.reason)}">${s.verdict}</span></div></article>`;
}
function renderDetail() {
  const { match, analysis: a } = detailState.data;
  const p = a.pick;
  const isBet = p?.verdict === "BET";
  const kick = `${dayParts(dayKey(match.kickoffAt)).long} · ${fmtTime.format(new Date(match.kickoffAt))}`;
  const played = match.homeScore != null;
  const recs = (a.recommended ?? []).map((k) => a.selections.find((x) => x.key === k)).filter(Boolean);
  const rest = a.selections.filter((x) => !recs.includes(x));
  const groups = [...new Set(rest.map((x) => x.market))];
  const noPlay = `<article class="rec none"><header><b>Nessuna giocata consigliata</b></header><p>${esc(p?.reason ?? "Dati insufficienti.")}</p>${a.api?.advice ? `<p class="why-line">API-Football suggerisce ${esc(a.api.adviceIt?.label ?? a.api.advice)}, ma il calcolo prudente non lo conferma.</p>` : ""}</article>`;
  const body = `
    ${matchHeader({ home: match.home, away: match.away, homeLogo: match.homeLogo, awayLogo: match.awayLogo, chips: [leagueName(match.league)],
      centre: played ? `<strong class="af-big">${esc(match.homeScore)}<i>–</i>${esc(match.awayScore)}</strong>` : `<strong class="af-big">${esc(fmtTime.format(new Date(match.kickoffAt)))}</strong>`,
      sub: played ? kick : dayParts(dayKey(match.kickoffAt)).long })}
    <section class="rec-sec"><h4>Cosa giocare <small>affidabilità ${esc(a.confidence)}</small></h4>${recs.length ? recs.map((x, i) => recCard(x, a, match.id, i)).join("") : noPlay}</section>
    <section class="rec-sec" id="detail-corner" hidden></section>
    ${apiBlock(a, detailState.data.afStatus)}
    <div id="pane-data" class="u-data"><div class="af-loading"><i></i>Scarico i dati da API-Football…</div></div>
    <details class="more"><summary>Tutti i mercati e come è calcolato</summary>
      ${a.legs?.length ? `<section class="legs-sec"><h4>Per le multiple <small>le gambe più solide di questa partita</small></h4>${a.legs.map((l) => `<div class="leg-row"><b>${esc(l.label)}</b><span>prudente ${pct(l.pLow)} · quota ${num(l.odds)}${l.oddsSource === "mercato" ? "" : "*"}</span></div>`).join("")}${a.legs.some((l) => l.oddsSource !== "mercato") ? `<p class="api-note">* quota stimata: senza la quota di mercato.</p>` : ""}</section>` : ""}
      <div class="kv">
        <div><small>Gol attesi</small><strong>${num(a.lambda.total)}</strong></div>
        <div><small>Basato su</small><strong>${a.basis === "api+mercato" ? "API + mercato + storico" : a.basis === "api" ? "API + storico" : a.basis === "mercato" ? "mercato + storico" : "solo storico"}</strong></div>
        <div><small>Campione</small><strong>${a.inputs.home.n} + ${a.inputs.away.n} gare</strong></div>
      </div>
      <label class="hist" style="margin:0 0 6px">Storico usato
        <select id="detail-n">${[5, 8, 10].map((v) => `<option value="${v}" ${v === a.n ? "selected" : ""}>${v} gare</option>`).join("")}</select></label>
      <h4>Altri mercati · inserisci la quota del bookmaker per il verdetto sul valore</h4>
      ${groups.map((g) => `<div class="mk"><h5>${esc(g)}</h5>${rest.filter((x) => x.market === g).map((x) => selectionRow(x, a.sample, match.id)).join("")}</div>`).join("")}
      <h4>Come è stato calcolato, passo per passo</h4>
      ${explain(match, a)}
      <h4>Ultime partite considerate</h4>
      <div class="formrow">${formBox(match.home, a.inputs.home, match.homeLogo)}${formBox(match.away, a.inputs.away, match.awayLogo)}</div>
    </details>`;
  $("#detail-body").innerHTML = `<div id="pane-analysis">${body}</div>`;
  for (const s of a.selections) applyOdds(s.key);
  showDetailCorner();
  if (detailState.af) { showAf(detailState.af, detailState.id); scheduleAfRetry(); }       // l'analisi si ridisegna (ricalcolo): i dati già scaricati tornano subito
  else if (!detailState.afStarted) { detailState.afStarted = true; loadAf(detailState.id, 0); }
  if (!cornerDone.has(detailState.id) || (played && !actualCache.has(detailState.id))) loadDetailCorner(detailState.id);
  scheduleAnalysisRetry();
}

/** Corner della partita aperta: previsione dal mercato (prima del calcio d'inizio) e corner reali (a partita finita), nella stessa scheda. */
function showDetailCorner() {
  const el = $("#detail-corner");
  if (!el || !detailState) return;
  const { match } = detailState.data, played = match.homeScore != null;
  const html = cornerHtml({ home: match.home, away: match.away, status: played ? "final" : "scheduled", corner: cornerCache.get(match.id) ?? null, cornerActual: actualOf(match.id) });
  el.innerHTML = html || (cornerDone.has(match.id) ? `<p class="af-note">Corner: nessuna quota disponibile per questa partita.</p>` : `<div class="af-loading"><i></i>Cerco i corner…</div>`);
  el.hidden = false;
}
async function loadDetailCorner(id) {
  const played = detailState?.data?.match?.homeScore != null;
  for (let tries = 0; tries < 4 && detailState?.id === id; tries += 1) {
    let r;
    try { r = await getJson(`/api/corners?ids=${encodeURIComponent(id)}${played ? "&actual=1" : ""}`); }
    catch (e) { if (RATE_RE.test(e.message)) { await sleep(15000); continue; } break; }
    const waiting = r.state[id] === "waiting" || (played && r.actualState?.[id] === "waiting");
    if (r.corners[id]) cornerCache.set(id, r.corners[id]);
    if (r.actual?.[id]) actualCache.set(id, r.actual[id]);
    if (!waiting) cornerDone.add(id);
    if (detailState?.id === id) showDetailCorner();
    if (!waiting) return;
    await sleep(Math.min(30000, r.retry?.afterMs || 15000));
  }
  if (detailState?.id === id) { cornerDone.add(id); showDetailCorner(); }
}
const MAX_AF_TRIES = 8;
let afTimer = null;
/** Linee consigliate dall'analisi (max 3), con etichetta e quota minima: servono a mostrare solo quelle nella scheda dati. */
const recommended = () => { const a = detailState?.data?.analysis; return (a?.recommended ?? []).map((k) => a.selections.find((x) => x.key === k)).filter(Boolean).map((x) => ({ key: x.key, label: x.label, minOdds: x.minOdds })); };
function showAf(data, id) { if (detailState?.id === id && $("#pane-data")) $("#pane-data").innerHTML = renderAfDetail(data, { lean: true, unified: true, hidePrediction: Boolean(detailState.data?.analysis?.api?.used), rec: recommended(), extra: Boolean(data.extra) }); }

/**
 * Scarica i dati API-Football. Il server scarica solo ciò che manca (il resto sta in cache) e, se il provider limita le richieste,
 * dice quanto attendere: qui si riprova da soli, mostrando subito ciò che è già arrivato.
 */
async function loadAf(id, attempt, { refresh = false } = {}) {
  clearTimeout(afTimer);
  if (attempt === 0 && !detailState?.af && $("#pane-data")) $("#pane-data").innerHTML = `<div class="af-loading"><i></i>Scarico i dati da API-Football…</div>`;
  try {
    const data = await getJson(`/api/match-detail?id=${encodeURIComponent(id)}${detailState?.extra ? "&extra=1" : ""}${refresh ? "&refresh=1" : ""}`);
    if (detailState?.id !== id) return;
    detailState.af = data; detailState.afTries = attempt;
    showAf(data, id);
    scheduleAfRetry();
  } catch (e) {
    if (detailState?.id !== id) return;
    if (attempt < MAX_AF_TRIES && (RATE_RE.test(e.message) || /HTTP 5\d\d|Failed to fetch|NetworkError/i.test(e.message))) {
      detailState.afTries = attempt + 1;
      if (!detailState.af && $("#pane-data")) $("#pane-data").innerHTML = `<div class="af-loading"><i></i>API-Football è occupata: nuovo tentativo tra pochi secondi…</div>`;
      afTimer = setTimeout(() => loadAf(id, attempt + 1), 6000 + attempt * 4000);
    } else if (!detailState.af && $("#pane-data")) $("#pane-data").innerHTML = `<p class="af-empty">Dati API-Football non disponibili: ${esc(e.message)}<br><button class="ghost" type="button" data-af-retry>Riprova</button></p>`;
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
const BANK_KEY = "stayLive.bankroll";
let bankroll = (() => { try { const v = Number(localStorage.getItem(BANK_KEY)); return v > 0 ? v : 100; } catch { return 100; } })();
const parsePos = (v) => { const n = Number(String(v ?? "").replace(",", ".")); return Number.isFinite(n) && n > 0 ? n : null; };
const previewUrl = (ids) => `/api/preview?ids=${ids.map(encodeURIComponent).join(",")}&n=${state.n}${isCustom() ? `&mode=ou25&thr=${state.thr}` : ""}`;
async function makePreview() {
  const ids = [...state.selected];
  if (!ids.length) return;
  $("#preview").showModal();
  $("#preview-body").innerHTML = `<div class="af-loading"><i></i>Genero la preview…</div>`;
  $("#make-preview").disabled = true;
  try {
    pvOdds.clear();
    lastPreview = await getJson(previewUrl(ids));
    renderPreview();
    schedulePreviewRetry(ids);
    loadPreviewCorners();
  } catch (e) {
    $("#preview-body").innerHTML = `<h2 class="d-title">Preview non disponibile</h2><p class="d-sub">${esc(e.message)}</p>`;
  } finally { $("#make-preview").disabled = false; }
}
function afPreviewNote(pv) {
  const st = pv.afStatus;
  if (!st || st.off) return `<p class="api-note warn">Chiave API-Football non configurata: pronostici calcolati solo sulle ultime partite.</p>`;
  const n = st.used + st.waiting + st.missing;
  if (st.retry?.pending) return `<p class="af-warn wait" id="pv-af" role="status"><i class="af-spin" aria-hidden="true"></i><span>Dati API-Football scaricati: pronostici ${st.used} su ${n}, quote ${st.market} su ${n}. Gli altri arrivano da soli e il consiglio si aggiorna.</span></p>`;
  return `<p class="api-note ${st.used ? "ok" : "warn"}">${st.used ? `Calcolo con pronostico di API-Football (${st.used} partite su ${n}) e quote di mercato (${st.market} su ${n})` : "API-Football non ha pronostici per queste partite"}${st.missing && st.used ? `; le altre solo con ciò che c’è` : ""}.</p>`;
}
let pvTimer = null;
function schedulePreviewRetry(ids, tries = 0) {
  clearTimeout(pvTimer);
  const st = lastPreview?.afStatus;
  if (!st?.retry?.pending || tries >= 8) return;
  pvTimer = setTimeout(async () => {
    if (!$("#preview").open) return;
    if (document.activeElement?.matches?.("#preview-body input")) return schedulePreviewRetry(ids, tries);   // non toglie il campo a chi sta scrivendo una quota
    try {
      const data = await getJson(previewUrl(ids));
      if (!$("#preview").open) return;
      const box = $("#preview-body"), y = box.scrollTop;
      lastPreview = data; renderPreview(); box.scrollTop = y;
      schedulePreviewRetry(ids, tries + 1);
    } catch { schedulePreviewRetry(ids, tries + 1); }
  }, Math.min(60000, Math.max(2000, (st.retry.afterMs || 3000) * (1 + 0.25 * tries))));
}
function previewText(pv) {
  const when = (i) => fmtTime.format(new Date(i.kickoffAt));
  const stakeOf = (e) => (e ? ` · punta ${eur(e.stake)}` : "");
  const multi = (lastPlan?.multiples ?? []).map((m) => `${m.label} (${m.items.length} gare): ${m.legs.map((l) => `${l.item.home}-${l.item.away} ${l.sel.label}`).join(" + ")} · prob. prudente ${pct(m.plan.pLow)} · quota ${num(m.plan.odds)} ${m.plan.source}${stakeOf(m.eff)}${m.eff ? ` · vincita netta ${eur(m.eff.win)}` : ""}`);
  const singles = pv.items.filter(isBetItem).map((i) => `${when(i)} ${i.home} – ${i.away} → ${i.pick.label} (prudente ${pct(i.pick.pLow)}, quota min ${num(i.pick.minOdds)})${stakeOf(lastPlan?.rows.get(i.id)?.eff)}${cornerShort(i) ? ` · ${cornerShort(i)}` : ""}`);
  const skip = pv.items.filter((i) => !isBetItem(i)).map((i) => `${when(i)} ${i.home} – ${i.away}`);
  return [`Stay Live · preview ${dayParts(dayKey(pv.items[0].kickoffAt)).long}`,
    multi.length ? `\nMULTIPLE\n${multi.join("\n")}` : "", singles.length ? `\nSINGOLE\n${singles.join("\n")}` : "", skip.length ? `\nDA EVITARE\n${skip.join("\n")}` : "",
    "\nStime statistiche, non garanzie."].filter(Boolean).join("\n");
}
/** Una riga di motivo: perché si gioca (o perché si evita). */
function whyShort(i) {
  const p = i.pick;
  if (!p) return "Dati insufficienti";
  if (!isBetItem(i)) return p.reason ?? "Da evitare";
  const parts = [];
  if (p.pApi != null) parts.push(`API-Football ${pct(p.pApi)}`);
  if (p.pMarket != null) parts.push(`mercato ${pct(p.pMarket)}`);
  if (p.pModel != null) parts.push(`ultime partite ${pct(p.pModel)}`);
  parts.push(`quota minima ${num(p.minOdds)}`);
  return parts.join(" · ");
}
/**
 * Card di una giocata singola: la STESSA nel preview e nelle giocate salvate (cambiano solo stato in alto, riga di puntata e pulsanti).
 * `i` = partita con consiglio (nel salvataggio se ne conserva una fotografia: quello che vedi qui è ciò che ritrovi nelle giocate).
 */
function singleCardHtml(i, { top = "", stake = "", actions = "", head = true }) {
  const bet = isBetItem(i), p = i.pick;
  return `<article class="pv-card${bet ? "" : " is-skip"}">
      <span class="meta"><b>${fmtTime.format(new Date(i.kickoffAt))}</b><span>${esc(leagueName(i.league, true))}</span>${top}</span>
      ${head ? `<span class="fx">${sideHtml(i.home, i.homeLogo, i.homeScore)}${sideHtml(i.away, i.awayLogo, i.awayScore)}</span>` : (i.homeScore != null && i.awayScore != null ? `<p class="pv-result">Risultato <b>${esc(i.homeScore)}–${esc(i.awayScore)}</b></p>` : "")}
      ${p ? `<div class="pv-pick"><span class="vd ${bet ? "bet" : "skip"}">${bet ? "BET" : "EVITA"}</span><b>${esc(p.label)}</b>${basisTag(p.basis)}<em>${pct(p.pLow)}</em></div>` : ""}
      <p class="pv-why">${esc(whyShort(i))}</p>
      ${cornerHtml(i)}
      ${stake}${actions}
    </article>`;
}
function singleCard(i) {
  const bet = isBetItem(i), p = i.pick;
  const stake = bet ? `<p class="pv-stake"><span data-plan="${esc(i.id)}"></span></p>
      <details class="pv-q"><summary>Ho la quota reale</summary><label class="pv-odds">Quota <input inputmode="decimal" data-pv-odds="${esc(i.id)}" placeholder="${p.odds?.median ? `mercato ${num(p.odds.median)}` : `stima ${num(p.estOdds)}`}" aria-label="Quota reale per ${esc(i.home)} – ${esc(i.away)}" /></label></details>` : "";
  return singleCardHtml(i, { stake, actions: `<span class="pv-btns">${p ? saveButton("data-save", i.id, isSaved(singleOf(i))) : ""}<button class="link" type="button" data-open="${esc(i.id)}">Scheda partita</button></span>` });
}
/* ---------- Corner: previsione dal mercato (preview) e corner reali (a partita finita) ---------- */
const cornerCache = new Map();    // id partita -> { best, main, mainDetail, favorite } | null
const actualCache = new Map();    // id partita -> { home, away, total }
const cornerDone = new Set();     // partite già interrogate (anche senza dati): non si richiedono di nuovo
const actualOf = (id) => actualCache.get(id) ?? plays.flatMap((p) => p.legs).find((l) => l.matchId === id && l.cres)?.cres ?? null;
function applyCorners(items) { for (const i of items) { i.corner = i.corner ?? cornerCache.get(i.id) ?? null; i.cornerActual = actualOf(i.id); } }
let pvCornerRun = 0;
/** Scarica in background i corner delle partite del preview (e quelli reali delle finite): il card si aggiorna da solo. */
async function loadPreviewCorners() {
  const run = ++pvCornerRun, items = lastPreview?.items ?? [];
  const isFinal = (id) => items.find((i) => i.id === id)?.status === "final";
  let pending = items.map((i) => i.id).filter((id) => !cornerDone.has(id) && !(isFinal(id) && actualCache.has(id)));
  let tries = 0;
  while (pending.length && tries < 10 && run === pvCornerRun && $("#preview").open) {
    const part = pending.slice(0, 8), wantActual = part.some(isFinal);
    let r;
    try { r = await getJson(`/api/corners?ids=${part.map(encodeURIComponent).join(",")}${wantActual ? "&actual=1" : ""}`); }
    catch (e) { if (RATE_RE.test(e.message)) { tries += 1; await sleep(15000); continue; } return; }     // i corner sono facoltativi: senza, il preview resta com'è
    for (const id of part) {
      const waiting = r.state[id] === "waiting" || (isFinal(id) && r.actualState?.[id] === "waiting");
      if (r.corners[id]) cornerCache.set(id, r.corners[id]);
      if (r.actual?.[id]) actualCache.set(id, r.actual[id]);
      if (!waiting) cornerDone.add(id);
    }
    pending = pending.filter((id) => !cornerDone.has(id));
    if (run === pvCornerRun && $("#preview").open && !document.activeElement?.matches?.("#preview-body input")) { const box = $("#preview-body"), y = box.scrollTop; renderPreview(); box.scrollTop = y; }
    if (r.retry?.pending) { tries += 1; await sleep(Math.min(60000, r.retry.afterMs || 20000)); }
  }
}
function renderPreview() {
  const pv = lastPreview;
  applyCorners(pv.items);
  if (!pv.items.length) { $("#preview-body").innerHTML = `<p class="empty">Nessuna partita trovata.</p>`; return; }
  const bets = pv.items.filter(isBetItem), rest = pv.items.filter((i) => !isBetItem(i));
  $("#preview-body").innerHTML = `
    <h2 class="d-title">Preview delle partite scelte</h2>
    <p class="pv-sum"><strong>${pv.summary.bets} BET su ${pv.summary.selected} partite</strong></p>
    <div class="pv-bank">
      <label>Budget <input id="bankroll" inputmode="decimal" value="${esc(String(bankroll).replace(".", ","))}" aria-label="Budget in euro" /> €</label>
      <div id="pv-totals" class="pv-totals" aria-live="polite"></div>
    </div>
    <div class="pv-actions"><button class="primary" id="save-bets" type="button"${bets.length ? (bets.every((i) => i.pick && isSaved(singleOf(i))) ? " disabled" : "") : " disabled"}>${bets.length && bets.every((i) => i.pick && isSaved(singleOf(i))) ? "✓ BET già salvate" : "Salva le BET"}</button><button class="ghost" id="share-pdf" type="button">Condividi PDF</button><button class="ghost" id="copy-preview" type="button">Copia testo</button></div>
    ${afPreviewNote(pv)}
    <section class="pv-section pv-multi-sec"><h3><span>Multiple consigliate</span></h3><div id="pv-multiples"></div></section>
    <section class="pv-section"><h3><span>Singole consigliate</span><small>${bets.length}</small></h3>${bets.length ? bets.map(singleCard).join("") : `<p class="empty">Nessun BET tra le partite scelte.</p>`}</section>
    ${rest.length ? `<section class="pv-section pv-skip-sec"><h3><span>Da evitare</span><small>${rest.length}</small></h3>${rest.map(singleCard).join("")}</section>` : ""}
    <p class="foot">Controlla sempre la quota reale: sotto la quota minima non c’è margine. Nessuna stima garantisce un guadagno: gioca solo ciò che puoi permetterti di perdere.</p>`;
  updatePlan();
}

function multiLine(m) {
  const { plan: p, eff: e } = m;
  if (!e) return `<em class="pv-no">Nessuna puntata consigliata${p.need ? `: servirebbe una quota combinata di almeno ${num(p.need)}` : ""}.</em>`;
  if (p.play) return `Punta <b>${eur(e.stake)}</b> · vincita netta <b>${eur(e.win)}</b> <small>quota ${num(p.odds)} ${p.source}</small>`;
  return `Quota combinata ${p.source} ${num(p.odds)}: <b>sotto la minima ${num(p.need)}</b>, non conviene. Gioca <b>solo se</b> il bookmaker paga almeno ${num(p.need)} → punta <b>${eur(e.stake)}</b>, vincita netta <b>${eur(e.win)}</b>`;
}
/** Card di una multipla: la STESSA nel preview e nelle giocate salvate. `m` = { label, legs: [{ item, sel, odds, source }], p, source, minOdds, plan, eff }. */
function multiCardHtml(m, { top = "", legExtra = () => "", stake = "", actions = "", head = true }) {
  const est = m.source !== "mercato";
  return `<article class="pv-multi-card">
      ${head ? `<header><b>${esc(m.label)}</b>${top}<span class="pill">${m.legs.length} gare</span></header>` : ""}
      <ol class="legs">${m.legs.map((l) => `<li><span class="t">${fmtTime.format(new Date(l.item.kickoffAt))}</span><span class="m">${crest(l.item.home, l.item.homeLogo, "crest xs")}${crest(l.item.away, l.item.awayLogo, "crest xs")}${esc(l.item.home)} – ${esc(l.item.away)}</span><b>${esc(l.sel.label)}</b><small class="lg-odd">${num(l.odds)}${l.source === "mercato" ? "" : "*"}</small>${legExtra(l)}${cornerHtml({ ...l.item, corner: l.item.corner ?? null, cornerActual: actualOf(l.item.id) }, { compact: true })}</li>`).join("")}</ol>
      <p class="pv-why">Entrano tutte: <b>${pct(m.p)}</b> (prudente ${pct(m.plan.pLow)}) · quota totale ${num(m.plan.odds)}${est ? "*" : ""} · quota minima ${num(m.minOdds)}${est ? "<br><small>* quota stimata: preleva le quote reali per confermarla</small>" : ""}</p>
      <div class="pv-stake">${stake}</div>${actions}
    </article>`;
}
function renderMultiples(plan) {
  const el = $("#pv-multiples");
  if (!plan.multiples.length) { el.innerHTML = `<p class="empty">Nessuna multipla con valore atteso positivo sulle quote reali di mercato: meglio non giocare. (Servono almeno 2 partite con quota reale e vantaggio dimostrato.)</p>`; return; }
  el.innerHTML = plan.multiples.map((m, idx) => multiCardHtml(m, { stake: multiLine(m), actions: saveButton("data-save-multi", String(idx), isSaved(multiOf(m))) })).join("");
}

function planLine(row) {
  if (!row?.eff) return `<em class="pv-no">Nessuna puntata consigliata${row?.plan?.need ? `: servirebbe una quota di almeno ${num(row.plan.need)}` : ""}.</em>`;
  const { plan: p, eff: e } = row;
  if (p.play) return `Punta <b>${eur(e.stake)}</b> · vincita netta <b>${eur(e.win)}</b> <small>quota ${num(p.odds)} ${p.source}</small>`;
  return `Quota ${p.source} ${num(p.odds)}: <b>sotto la minima ${num(p.need)}</b>, non conviene. Gioca <b>solo se</b> il bookmaker paga almeno ${num(p.need)} → punta <b>${eur(e.stake)}</b>, vincita netta <b>${eur(e.win)}</b>`;
}
function updatePlan() {
  if (!lastPreview?.items.length) return;
  const plan = lastPlan = computePlan(lastPreview, bankroll, pvOdds);
  for (const el of document.querySelectorAll("[data-plan]")) el.innerHTML = planLine(plan.rows.get(el.dataset.plan));
  renderMultiples(plan);
  const t = plan.totals, ts = plan.totalsSingles, tm = plan.totalsMultiples;
  $("#pv-totals").innerHTML = t.count
    ? `Totale puntato <b>${eur(t.stake)}</b> <small>(${pct(bankroll > 0 ? t.stake / bankroll : 0, 1)} del budget)</small>${plan.hypothetical ? `<br><small>Calcolato sulle quote minime: API-Football non ha ancora quote reali per queste giocate. Se hai la quota del tuo bookmaker, inseriscila nella card.</small>` : ""}`
    : `Nessuna puntata consigliata con queste quote.`;
}

/* ---------- Giocate salvate: confronto con i risultati ---------- */
let plays = loadPlays();
let playResults = {};
const saveButton = (attr, value, saved) => `<button class="save${saved ? " done" : ""}" type="button" ${attr}="${esc(value)}"${saved ? " disabled" : ""}>${saved ? "✓ Salvata" : "Salva giocata"}</button>`;
const quoteOfRow = (id) => { const row = lastPlan?.rows.get(id); return { odds: row?.eff?.odds ?? row?.plan?.odds ?? null, stake: row?.eff?.stake ?? null, source: row?.plan?.source ?? null }; };
/** Fotografia di ciò che vedi nel preview (consiglio, motivi, quote, puntata): è ciò che le giocate salvate mostrano, identico. */
const snapOfSingle = (item) => {
  const row = lastPlan?.rows.get(item.id);
  return { kickoffAt: item.kickoffAt, league: item.league, home: item.home, away: item.away, homeLogo: item.homeLogo ?? null, awayLogo: item.awayLogo ?? null, confidence: item.confidence, status: item.status ?? null, pick: item.pick, corner: item.corner ?? null,
    plan: row ? { plan: { play: row.plan?.play, odds: row.plan?.odds, source: row.plan?.source, need: row.plan?.need }, eff: row.eff ? { stake: row.eff.stake, win: row.eff.win } : null } : null };
};
const snapOfMulti = (m) => ({ label: m.label, p: m.p, source: m.source, minOdds: m.minOdds,
  plan: { pLow: m.plan.pLow, odds: m.plan.odds, need: m.plan.need, play: m.plan.play, source: m.plan.source }, eff: m.eff ? { stake: m.eff.stake, win: m.eff.win } : null,
  legs: m.legs.map((l) => ({ item: { id: l.item.id, league: l.item.league, kickoffAt: l.item.kickoffAt, home: l.item.home, away: l.item.away, homeLogo: l.item.homeLogo ?? null, awayLogo: l.item.awayLogo ?? null, corner: l.item.corner ?? null }, sel: { key: l.sel.key, label: l.sel.label, p: l.sel.p, pLow: l.sel.pLow }, odds: l.odds, source: l.source })) });
const singleOf = (item) => ({ ...playFromItem(item, quoteOfRow(item.id)), snap: snapOfSingle(item) });
const multiOf = (m) => ({ kind: "multiple", label: m.label, odds: m.eff?.odds ?? m.plan?.odds ?? null, stake: m.eff?.stake ?? null, oddsSource: m.plan?.source ?? null, legs: m.legs.map((l) => legFromItem(l.item, l.sel)), snap: snapOfMulti(m) });
const isSaved = (cand) => plays.some((p) => signature(p) === signature(cand));
function commitPlay(cand) {
  const r = addPlay(plays, cand);
  if (r.added) { plays = r.plays; savePlays(plays); }
  updatePlaysBadge();
  return r.added;
}
function updatePlaysBadge() { const b = $("#plays-badge"); b.hidden = !plays.length; b.textContent = String(plays.length); }

const PLAY_IT = { won: "Vinta", lost: "Persa", pending: "In attesa", void: "Annullata" };
const PLAY_PILL = { won: "ok", lost: "err", pending: "warn", void: "" };
const dayShort = (iso) => `${dayParts(dayKey(iso)).dm} ${fmtTime.format(new Date(iso))}`;
function legHtml(l) {
  const sc = l.res ?? (l.live?.status === "final" ? [l.live.homeScore, l.live.awayScore] : null);
  return `<li class="pl-leg ${l.status}"><button class="pl-t pl-open" type="button" data-open="${esc(l.matchId)}" title="Apri la scheda della partita">${crest(l.home, l.homeLogo, "crest sm")}${crest(l.away, l.awayLogo, "crest sm")}<span><b>${esc(l.home)} – ${esc(l.away)}</b><small>${esc(leagueName(l.league, true))} · ${esc(dayShort(l.kickoffAt))}</small></span></button>
    <span class="pl-pick"><b>${esc(l.label)}</b><small>prudente ${pct(l.pLow)}${l.pApi != null ? ` · API ${pct(l.pApi)}` : ""}</small></span>
    <span class="pl-res">${sc ? `<b>${sc[0]}–${sc[1]}</b>` : `<small>${l.live?.status === "in_progress" ? "in corso" : "da giocare"}</small>`}<span class="af-pill ${PLAY_PILL[l.status]}">${PLAY_IT[l.status]}</span></span></li>`;
}
/** Dettagli di una giocata (pannello espanso): la stessa card del preview (dalla fotografia salvata) senza ripetere squadre ed esito, già visibili nella riga. */
function playBody({ play, legs, status, profit }) {
  const foot = `<p class="pl-foot">Salvata ${esc(dayShort(play.savedAt))}${play.stake ? ` · puntata ${eur(play.stake)}` : ""}${profit != null ? ` · esito <b class="${profit >= 0 ? "pl-gain" : "pl-loss"}">${profit >= 0 ? "+" : ""}${eur(profit)}</b>` : ""}</p>`;
  const del = `<button class="link danger" type="button" data-del-play="${esc(play.id)}">Elimina</button>`;
  const sc = (l) => l.res ?? (l.live?.status === "final" ? [l.live.homeScore, l.live.awayScore] : null);
  if (play.snap && play.kind === "single") {
    const l = legs[0], r = sc(l);
    const item = { id: l.matchId, ...play.snap, status: r ? "final" : play.snap.status, homeScore: r?.[0], awayScore: r?.[1], cornerActual: actualOf(l.matchId) };
    if (!item.corner && !r) item.corner = cornerCache.get(l.matchId) ?? null;          // salvata prima che arrivassero i corner e partita non ancora giocata: si mostra ora
    const bet = isBetItem(item);
    const stake = bet && play.snap.plan ? `<p class="pv-stake">${planLine(play.snap.plan)}</p>` : "";
    return singleCardHtml(item, { head: false, stake, actions: `<span class="pv-btns"><button class="link" type="button" data-open="${esc(l.matchId)}">Scheda partita</button>${del}</span>${foot}` });
  }
  if (play.snap && play.kind === "multiple") {
    const m = play.snap;
    const legExtra = (leg) => { const l = legs.find((x) => x.matchId === leg.item.id); const r = l && sc(l); return l ? `<span class="lg-st ${l.status}">${r ? `${r[0]}–${r[1]} · ` : ""}${PLAY_IT[l.status]}</span>` : ""; };
    const legsOpen = `<span class="pv-btns"><span class="pl-open-legs">${m.legs.map((l) => `<button class="link" type="button" data-open="${esc(l.item.id)}">${esc(l.item.home)}</button>`).join("")}</span>${del}</span>${foot}`;
    return multiCardHtml(m, { head: false, legExtra, stake: multiLine(m), actions: legsOpen });
  }
  return `<div class="pl-legacy"><ul>${legs.map(legHtml).join("")}</ul><p class="pl-foot">Salvata ${esc(dayShort(play.savedAt))}${play.odds ? ` · quota ${num(play.odds)}${play.oddsSource ? ` (${esc(play.oddsSource)})` : ""}` : ""}${play.stake ? ` · puntata ${eur(play.stake)}` : ""}${profit != null ? ` · <b class="${profit >= 0 ? "pl-gain" : "pl-loss"}">${profit >= 0 ? "+" : ""}${eur(profit)}</b>` : ""}</p><span class="pv-btns">${del}</span></div>`;
}
/** Una giocata nell'elenco: riga compatta (squadre, scudetti, esito) + pannello a fisarmonica con tutti i dettagli. */
const playItemHtml = (r) => accordionHtml({ id: `p:${r.play.id}`, open: openAcc.has(`p:${r.play.id}`), cls: `pl st-${r.status}`, headCls: "pl-head", head: playHeadHtml(r), body: `<div class="pl-pane">${playBody(r)}</div>` });
const playUi = { filter: "all" };
const PL_FILTERS = [["all", "Tutte"], ["pending", "In attesa"], ["done", "Concluse"]];
function playListHtml(ev) {
  if (!plays.length) return `<div class="empty"><p>Nessuna giocata salvata. Salvale dal segnalibro nella lista delle partite o dal preview: il giorno dopo le troverai qui, confrontate con i risultati.</p><button class="primary" type="button" data-goto="matches">Vai alle partite</button></div>`;
  const rows = filterRows(ev.rows, playUi.filter);
  if (!rows.length) return `<p class="empty">${playUi.filter === "pending" ? "Nessuna giocata in attesa." : "Nessuna giocata conclusa."}</p>`;
  return groupByDay(rows).map((g) => `<section class="pl-day"><h3 class="grp">${esc(g.label)}</h3>${g.rows.map(playItemHtml).join("")}</section>`).join("");
}
const anyPlayOpen = () => [...openAcc].some((k) => k.startsWith("p:"));
function renderPlays(note = "") {
  const y = window.scrollY, ev = evaluate(plays, playResults), t = ev.total;
  const tile = (k, v, cls = "") => `<div class="${cls}"><small>${k}</small><b>${v}</b></div>`;
  const strip = plays.length ? `<div class="pl-sum pl-strip">${tile("Centrate", t.won + t.lost ? `${t.won} su ${t.won + t.lost}${t.rate != null ? ` · ${pct(t.rate)}` : ""}` : "—", t.won + t.lost && t.rate >= 0.5 ? "good" : "")}${tile("In attesa", String(t.pending))}${tile("Netto", t.staked ? eur(t.profit) : "—", t.staked ? (t.profit >= 0 ? "good" : "bad") : "")}</div>` : "";
  const seg = plays.length ? `<div class="seg" id="pl-seg" role="group" aria-label="Filtro giocate" style="--i:${PL_FILTERS.findIndex(([k]) => k === playUi.filter)}">${PL_FILTERS.map(([k, l]) => `<button type="button" data-plf="${k}" aria-pressed="${playUi.filter === k}">${l}</button>`).join("")}</div>` : "";
  const stats = accordionHtml({ id: "stats", open: openAcc.has("stats"), cls: "stats-acc", headCls: "stats-head",
    head: `<span class="stats-t"><b>Statistiche e affidabilità</b><small>Efficienza dei pronostici e dei BET dell'app</small></span>`,
    body: `<div class="pl-pane"><div id="reliability">${reliabilityState.html}</div>${plays.length ? efficiencyHtml(efficiency(plays, playResults), { esc, pct }) : ""}${t.staked ? `<p class="pl-note">Esito netto calcolato sulle ${eur(t.staked)} puntate delle giocate già concluse (con puntata e quota salvate).</p>` : ""}</div>` });
  $("#plays-body").innerHTML = `<h2 class="d-title">Le mie giocate</h2>${strip}${seg}
    <div class="pl-meta"><span class="pl-status" id="plays-status" aria-live="polite">${esc(note)}</span><button class="link" type="button" data-collapse-all${anyPlayOpen() ? "" : " hidden"}>Comprimi tutte</button></div>
    <div class="pl-list${ev.rows.length > 40 ? " long" : ""}" id="pl-list">${playListHtml(ev)}</div>
    ${stats}
    <p class="foot">Le giocate restano salvate in questo dispositivo (non su Supabase). Tira verso il basso per aggiornare i risultati: se una partita finita risulta ancora “in attesa”, riprova tra qualche minuto.</p>`;
  window.scrollTo({ top: y });
}
/** Cambio filtro: aggiorna solo l'elenco (il selettore scorre senza essere ricreato). */
function setPlayFilter(f) {
  playUi.filter = f;
  const seg = $("#pl-seg");
  seg?.style.setProperty("--i", String(PL_FILTERS.findIndex(([k]) => k === f)));
  for (const b of seg?.querySelectorAll("[data-plf]") ?? []) b.setAttribute("aria-pressed", String(b.dataset.plf === f));
  const list = $("#pl-list"); if (list) list.innerHTML = playListHtml(evaluate(plays, playResults));
  syncCollapseBtn();
}
function syncCollapseBtn() { const b = $("[data-collapse-all]"); if (b) b.hidden = !anyPlayOpen(); }
/** Apre/chiude una fisarmonica: classe (animazione in CSS), aria-expanded e inert; lo stato resta in openAcc. */
function toggleAcc(acc, force) {
  const id = acc.dataset.acc, open = force ?? !acc.classList.contains("open");
  acc.classList.toggle("open", open);
  acc.querySelector(":scope > .acc-head")?.setAttribute("aria-expanded", String(open));
  acc.querySelector(":scope > .acc-panel")?.toggleAttribute("inert", !open);
  open ? openAcc.add(id) : openAcc.delete(id);
  if (id.startsWith("p:")) syncCollapseBtn();
  if (open && id.startsWith("p:")) setTimeout(() => {          // se il pannello finisce sotto la barra inferiore, la pagina scorre il minimo necessario
    const r = acc.getBoundingClientRect(), limit = window.innerHeight - ($(".tabbar")?.offsetHeight ?? 62) - 12;
    if (r.bottom > limit && r.top > 70) window.scrollBy({ top: Math.min(r.bottom - limit, r.top - 70), behavior: reduceMotion() ? "auto" : "smooth" });
  }, 300);
}
/** Elimina con possibilità di annullare: la giocata torna nella stessa posizione. */
function deletePlay(id) {
  const index = plays.findIndex((p) => p.id === id);
  if (index < 0) return;
  const [play] = plays.splice(index, 1);
  openAcc.delete(`p:${id}`); savePlays(plays); updatePlaysBadge(); renderPlays();
  showToast("Giocata eliminata", { action: "Annulla", ms: 6000, onAction: () => { plays.splice(Math.min(index, plays.length), 0, play); savePlays(plays); updatePlaysBadge(); renderPlays(); } });
}
/* Affidabilità di tutti i BET registrati dall'app (non solo quelli salvati): letta dal server, mostrata in cima alla vista Giocate. */
const reliabilityState = { html: `<section class="ef-card"><h3>Affidabilità dei BET dell'app</h3><p class="ef-empty">Calcolo in corso…</p></section>`, at: 0 };
async function loadReliability() {
  if (Date.now() - reliabilityState.at < 60e3) return;
  try {
    reliabilityState.html = reliabilityHtml(await getJson("/api/reliability"), { esc, pct });
    reliabilityState.at = Date.now();
  } catch (e) { reliabilityState.html = `<section class="ef-card"><h3>Affidabilità dei BET dell'app</h3><p class="ef-empty">Non disponibile: ${esc(e.message)}</p></section>`; }
  const el = $("#reliability"); if (el) el.innerHTML = reliabilityState.html;
}
let playsBusy = false;
async function refreshPlays() {
  if (playsBusy) return;
  playsBusy = true; $("#refresh").classList.add("spin");
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
    const cids = pendingCornerIds(plays);
    if (cids.length) {                                          // corner reali delle partite finite, copiati nelle giocate come i risultati
      set("Leggo i corner reali…");
      for (let i = 0, tries = 0; i < cids.length && tries < 6;) {
        const part = cids.slice(i, i + 8);
        try {
          const r = await getJson(`/api/corners?ids=${part.map(encodeURIComponent).join(",")}&actual=1`);
          for (const [id, c] of Object.entries(r.actual ?? {})) if (c) actualCache.set(id, c);
          if (r.retry?.pending) { tries += 1; await sleep(Math.min(30000, r.retry.afterMs || 15000)); continue; }
        } catch (e) { if (RATE_RE.test(e.message)) { tries += 1; await sleep(15000); continue; } break; }
        i += 8;
      }
      if (absorbCorners(plays, Object.fromEntries(actualCache))) savePlays(plays);
    }
    renderPlays(ids.length ? `Risultati aggiornati alle ${fmtTime.format(new Date())}.` : "");
  } catch (e) { renderPlays(`Risultati non disponibili: ${e.message}`); } finally { playsBusy = false; $("#refresh").classList.toggle("spin", state.loading || Boolean(state.syncing)); autoCorners(); }
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
    if (e?.name !== "AbortError") showToast("Non riesco a creare il PDF");
    btn.textContent = label; btn.disabled = false;
    return;
  }
  btn.textContent = label; btn.disabled = false;
}

/* ---------- Eventi ---------- */
document.addEventListener("click", (e) => {
  const t = e.target;
  if (t.closest("[data-close]")) closeDialog(t.closest("dialog"));
  if (t.closest("[data-af-retry]") && detailState) { detailState.afTries = 0; loadAf(detailState.id, 0); }
  if (t.closest("[data-af-extra]") && detailState) { detailState.extra = true; detailState.afTries = 0; t.closest("[data-af-extra]").textContent = "Scarico gli altri dati…"; t.closest("[data-af-extra]").disabled = true; loadAf(detailState.id, 0); }
  if (t.closest("[data-af-refresh]") && detailState) { detailState.afTries = 0; t.closest("[data-af-refresh]").textContent = "Aggiorno…"; loadAf(detailState.id, 0, { refresh: true }); }
  else if (t.tagName === "DIALOG") closeDialog(t);
  const chip = t.closest("[data-league]");
  if (chip) {
    state.league = chip.dataset.league;
    const code = state.league.startsWith("n:") ? state.league.slice(2) : state.leagues.find((l) => l.id === state.league)?.country;
    const l = state.leagues.find((x) => x.country === code);
    if (l) openAcc.add(`nat:${l.continent}:${l.country}`);
    state.navOpen = false; animateNext = true; render();
  }
  if (t.closest("#nav-toggle")) { state.navOpen = !state.navOpen; render(); }
  if (!t.closest(".menu-wrap")) closeSelMenu();
  const day = t.closest("[data-day]"); if (day) { state.day = day.dataset.day; animateNext = true; render(); }
  const open = t.closest("[data-open]"); if (open) openDetail(open.dataset.open);
  if (t.closest("#copy-preview")) navigator.clipboard?.writeText(previewText(lastPreview)).then(() => showToast("Testo copiato"), () => showToast("Non riesco a copiare il testo"));
  if (t.closest("#share-pdf")) sharePdf(t.closest("#share-pdf"));
  const sv = t.closest("[data-save]");
  if (sv) { const item = lastPreview?.items.find((i) => i.id === sv.dataset.save); if (item?.pick) { commitPlay(singleOf(item)); sv.textContent = "✓ Salvata"; sv.classList.add("done"); sv.disabled = true; showToast("Giocata salvata"); } }
  const sm = t.closest("[data-save-multi]");
  if (sm && lastPlan?.multiples[Number(sm.dataset.saveMulti)]) { commitPlay(multiOf(lastPlan.multiples[Number(sm.dataset.saveMulti)])); sm.textContent = "✓ Salvata"; sm.classList.add("done"); sm.disabled = true; showToast("Multipla salvata"); }
  if (t.closest("#save-bets") && lastPreview) {
    const bets = lastPreview.items.filter(isBetItem);
    const n = bets.filter((i) => commitPlay(singleOf(i))).length;
    const sb = t.closest("#save-bets"); sb.textContent = "✓ BET già salvate"; sb.disabled = true; showToast(n ? `${n} ${n === 1 ? "giocata salvata" : "giocate salvate"}` : "Giocate già salvate");
    for (const b of document.querySelectorAll("[data-save]")) if (bets.some((i) => i.id === b.dataset.save)) { b.textContent = "✓ Salvata"; b.classList.add("done"); b.disabled = true; }
  }
  const rs = t.closest("[data-row-save]");
  if (rs && !rs.disabled) {
    const m = state.matches.find((x) => x.id === rs.dataset.rowSave), cand = m && playOfList(m);
    if (cand && commitPlay(cand)) {
      rs.classList.add("done"); rs.disabled = true; rs.setAttribute("aria-pressed", "true"); rs.setAttribute("aria-label", `Giocata salvata: ${cand.label}`);
      showToast(`Giocata salvata: ${cand.label}`, { action: "Vedi", onAction: () => showView("plays") });
    }
  }
  const del = t.closest("[data-del-play]");
  if (del) deletePlay(del.dataset.delPlay);
  const acch = t.closest(".acc-head"); if (acch) toggleAcc(acch.closest(".acc"));
  const plf = t.closest("[data-plf]"); if (plf) setPlayFilter(plf.dataset.plf);
  if (t.closest("[data-collapse-all]")) { for (const a of document.querySelectorAll("#pl-list .acc.open")) toggleAcc(a, false); }
  const go = t.closest("[data-goto]"); if (go) showView(go.dataset.goto);
});
document.addEventListener("change", (e) => {
  const t = e.target;
  if (t.matches("[data-sel]")) { t.checked ? state.selected.add(t.dataset.sel) : state.selected.delete(t.dataset.sel); t.closest(".row")?.classList.toggle("sel", t.checked); syncSelbar(); }   // niente ridisegno della lista: aggiorna solo la riga toccata
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
/* Fogli: chiusura animata, Esc e sfondo passano da qui; sul telefono si chiudono anche trascinando la maniglia verso il basso (solo la maniglia: lo scroll del contenuto non c'entra). */
function closeDialog(d) {
  if (!d?.open || d.classList.contains("closing")) return;
  if (reduceMotion()) { d.close(); return; }
  d.classList.add("closing");
  let done = false;
  const fin = () => { if (done) return; done = true; d.classList.remove("closing"); d.style.removeProperty("--sheet-dy"); d.close(); };
  d.addEventListener("animationend", (e) => { if (e.target === d) fin(); });
  setTimeout(fin, 360);
}
for (const d of document.querySelectorAll("dialog")) {
  d.addEventListener("cancel", (e) => { e.preventDefault(); closeDialog(d); });
  const g = d.querySelector(".grab");
  if (!g) continue;
  let y0 = null, dy = 0, pid = null;
  g.addEventListener("pointerdown", (e) => { y0 = e.clientY; dy = 0; pid = e.pointerId; g.setPointerCapture?.(pid); d.style.transition = "none"; });
  g.addEventListener("pointermove", (e) => { if (y0 == null || e.pointerId !== pid) return; dy = Math.max(0, e.clientY - y0); d.style.setProperty("--sheet-dy", `${dy}px`); });
  const end = (e) => { if (y0 == null || e.pointerId !== pid) return; const go = dy > 90; y0 = null; d.style.transition = ""; if (go) closeDialog(d); else d.style.removeProperty("--sheet-dy"); };
  g.addEventListener("pointerup", end); g.addEventListener("pointercancel", end);
}
$("#detail").addEventListener("close", () => { clearTimeout(afTimer); clearTimeout(anTimer); });
$("#preview").addEventListener("close", () => clearTimeout(pvTimer));
updatePlaysBadge();
/* ---------- Navigazione ---------- */
const VIEWS = ["matches", "plays", "settings"];
function showView(name) {
  closeSelMenu();
  for (const v of VIEWS) {
    const el = $(`#view-${v}`), on = v === name;
    if (on && el.hidden) { el.hidden = false; el.classList.remove("enter"); void el.offsetWidth; el.classList.add("enter"); }
    else if (!on) el.hidden = true;
  }
  for (const b of document.querySelectorAll(".tab-item")) { if (b.dataset.view === name) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); }
  document.body.dataset.view = name;
  $("#selbar").hidden = name !== "matches" || !state.selected.size;
  window.scrollTo({ top: 0 });
  if (name === "plays") { renderPlays(); loadReliability(); refreshPlays(); }
  if (name === "matches") { animateNext = true; render(); }
}
document.querySelector(".tabbar").addEventListener("click", (e) => {
  const b = e.target.closest(".tab-item"); if (!b) return;
  if (document.body.dataset.view === b.dataset.view) window.scrollTo({ top: 0, behavior: "smooth" });
  else showView(b.dataset.view);
});
$("#mode-seg").addEventListener("click", (e) => { const b = e.target.closest("[data-seg]"); if (b) setSeg(b.dataset.seg); });

/* Menu "Seleziona": tutte, i BET (o le filtrate), nessuna */
function closeSelMenu() { $("#sel-menu").hidden = true; $("#sel-more").setAttribute("aria-expanded", "false"); }
$("#sel-more").addEventListener("click", () => { const m = $("#sel-menu"); m.hidden = !m.hidden; $("#sel-more").setAttribute("aria-expanded", String(!m.hidden)); });
$("#select-day").addEventListener("click", () => {
  const open = visibleMatches().filter(isOpen);
  open.forEach((m) => state.selected.add(m.id));
  closeSelMenu(); render();
});
$("#sel-none").addEventListener("click", () => { state.selected.clear(); closeSelMenu(); render(); });

/* Impostazioni */
$("#clear-plays").addEventListener("click", () => {
  if (!plays.length) return;
  if (confirm(`Eliminare le ${plays.length} giocate salvate? Non si può annullare.`)) { plays = []; savePlays(plays); updatePlaysBadge(); renderPlays(); }
});

/* Tira per aggiornare (lista partite e giocate, in cima alla pagina) */
{
  const ptr = $("#ptr"); let y0 = 0, dy = 0, on = false;
  const reset = () => { ptr.style.setProperty("--pull", "0"); ptr.classList.remove("ready"); on = false; dy = 0; };
  document.addEventListener("touchstart", (e) => { const v = document.body.dataset.view; on = (v === "matches" ? !state.loading : v === "plays" && !playsBusy) && window.scrollY <= 0 && !document.querySelector("dialog[open]"); y0 = e.touches[0].clientY; dy = 0; }, { passive: true });
  document.addEventListener("touchmove", (e) => {
    if (!on) return;
    dy = e.touches[0].clientY - y0;
    if (dy <= 0 || window.scrollY > 0) { reset(); return; }
    ptr.style.setProperty("--pull", String(Math.min(dy, 140) / 140));
    ptr.classList.toggle("ready", dy > 100);
  }, { passive: true });
  document.addEventListener("touchend", () => { const go = on && dy > 100; reset(); if (go) { if (document.body.dataset.view === "plays") refreshPlays(); else { state.syncTried = false; load({ fresh: true }); } } });
}

/**
 * Corner automatici: nessun pulsante. A mezzanotte li cerca da solo il workflow "Corner notturni" per tutte le partite della settimana;
 * qui si completano, in secondo piano, quelli che mancano ancora quando si ricarica (aggiornamento a mano o dei risultati).
 * A piccoli passi, e riprova da solo se API-Football limita le richieste.
 */
let cornerBusy = false, cornerLastRun = 0;
async function autoCorners({ force = false } = {}) {
  if (cornerBusy || state.error || !state.matches.length) return;
  if (!force && Date.now() - cornerLastRun < 10 * 60e3) return;       // aperture ripetute della stessa vista: non si riprova subito
  const now = Date.now();
  const ids = state.matches
    .filter((m) => isOpen(m) && Date.parse(m.kickoffAt) > now && Date.parse(m.kickoffAt) <= now + 7 * 86400e3 && !m.corner && m.cornerState !== "none" && m.cornerState !== "missing")
    .sort((x, y) => Date.parse(x.kickoffAt) - Date.parse(y.kickoffAt)).map((m) => m.id).slice(0, 40);
  cornerLastRun = now;
  if (!ids.length) return;
  cornerBusy = true;
  let pending = [...ids], tries = 0;
  try {
    while (pending.length && tries < 10) {
      state.cornerNote = `cerco i corner ${ids.length - pending.length}/${ids.length}`; render();
      const part = pending.slice(0, 6);
      let r;
      try { r = await getJson(`/api/corners?ids=${part.map(encodeURIComponent).join(",")}`); } catch (e) { if (RATE_RE.test(e.message)) { tries += 1; await sleep(15000); continue; } break; }
      for (const [id, pick] of Object.entries(r.corners)) { const m = state.matches.find((x) => x.id === id); if (m) { m.corner = pick; m.cornerState = r.state[id]; } }
      pending = pending.filter((id) => !part.includes(id) || r.state[id] === "waiting");
      if (r.retry?.pending) { tries += 1; await sleep(Math.min(60000, r.retry.afterMs || 20000)); }
    }
  } finally { cornerBusy = false; state.cornerNote = ""; render(); }
}
$("#thr").addEventListener("change", (e) => { state.thr = Number(e.target.value); try { localStorage.setItem(THR_KEY, String(state.thr)); } catch { /* preferenza non salvata */ } render(); });
/* Swipe a destra su una partita = la seleziona, a sinistra = la deseleziona (solo touch; col mouse resta la casella). */
enableSwipe($("#list"), {
  rowSel: ".row", canSwipe: (r) => Boolean(r.querySelector("[data-sel]")),
  onSwipe: (row, dir) => { const id = row.querySelector("[data-sel]").dataset.sel; if (dir === "right") state.selected.add(id); else state.selected.delete(id); navigator.vibrate?.(12); render(); },
});
$("#select-bets").addEventListener("click", () => {
  visibleMatches().filter((m) => isOpen(m) && (isCustom() || m.pick?.verdict === "BET")).forEach((m) => state.selected.add(m.id));
  closeSelMenu(); render();
});
$("#sel-clear").addEventListener("click", () => { state.selected.clear(); render(); });
$("#make-preview").addEventListener("click", makePreview);
$("#refresh").addEventListener("click", () => { if (document.body.dataset.view === "plays") refreshPlays(); else { state.syncTried = false; load({ fresh: true }); } });
setInterval(() => { if (document.visibilityState === "visible" && !state.error) { state.syncTried = false; load(); } }, 5 * 60e3);

// Apertura: prima l'ultimo elenco salvato (istantaneo), poi l'aggiornamento in secondo piano.
{
  const cached = readCache();
  if (cached) { Object.assign(state, { matches: cached.data.matches, leagues: cached.data.leagues, continents: cached.data.continents ?? [], updatedAt: cached.data.updatedAt }); }
}
document.body.dataset.view = "matches";
render();
load();
