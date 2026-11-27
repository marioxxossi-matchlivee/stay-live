// Stay Live Tennis — schermata tennis (caricata solo quando si sceglie il tennis: un errore qui non tocca il calcio).
// Stessa struttura del calcio: Partite · Giocate · Affidabilità · Impostazioni.
import "./tennis.css";
import "./strategy.css";
import "../monitor.css";
import { icon, iconPair, markSvg } from "../icons.js";
import { saveDayState } from "../dataquality.js";
import { esc, dayParts, dayKey, fmtTime } from "../format.js";
import { sportMenuHtml } from "../sportmenu.js";
import { enableSheet, closeSheet } from "../sheet.js";
import { showToast } from "../toast.js";
import { accordionHtml } from "../playlist.js";
import { DEFAULT_FILTERS, SURFACE_LABEL, CATEGORY_LABEL, GENDER_LABEL, facets, filterMatches, groupByTournament, sanitizeFilters, sanitizeMatches, hasCompleteData } from "./board.js";
import { detailHtml, emptyHtml, rowHtml, canSave } from "./view.js";
import { tennisMonitorHtml } from "./monitor.js";
import { valueCardHtml } from "./value.js";
import { PL_FILTERS, listHtml as playsListHtml, playsViewHtml, settingsHtml } from "./playsview.js";
import { buildDashboard, sanitizeTab, DEFAULT_STRATEGY } from "./strategy.js";
import { strategyHtml } from "./strategyview.js";
import "./observation.css";
import { liveObservationHtml, DEFAULT_LO } from "./observation.js";
import { mountLearning } from "../learning/mount.js";
import { absorbTResults, addTPlay, evaluateT, loadTPlays, playFromMatch, removeTPlay, saveTPlays, tSignature } from "./plays.js";

const CACHE_KEY = "sl-tennis-board-v2";
const STALE_MS = 75 * 60e3;   // la snapshot si rinnova ogni 15–30 minuti
const REFRESH_MS = 5 * 60e3;
const TABS = ["matches", "strategy", "plays", "reliability", "settings"];
const isOpen = (m) => m.status === "scheduled" || m.status === "live";

async function getJson(url, ms = 15000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctl.signal, headers: { accept: "application/json" } });
    let body = null; try { body = await res.json(); } catch { /* corpo non JSON */ }
    return { status: res.status, ok: res.ok, body };
  } finally { clearTimeout(t); }
}
const readCache = () => { try { return JSON.parse(localStorage.getItem(CACHE_KEY) ?? "null"); } catch { return null; } };
const writeCache = (data) => { try { localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data })); } catch { /* spazio esaurito */ } };

export function mountTennis(root) {
  const state = {
    matches: [], history: null, diagnostics: null, builtAt: null, filters: { ...DEFAULT_FILTERS }, day: null, onlyBet: false, fOpen: false,
    tab: "matches", sTab: DEFAULT_STRATEGY.tab, plays: loadTPlays(), playFilter: "all", open: new Set(), mnTab: "live", lo: { ...DEFAULT_LO, f: { ...DEFAULT_LO.f } },
    loading: false, error: null, fromCache: false, lastLoad: 0, animate: true,
  };

  root.innerHTML = `
    <header class="tn-top">
      <a class="tn-brand" href="/" aria-label="Stay Live Tennis">${markSvg("tn-mark")}<span data-text="StayLive">Stay<b>Live</b></span></a>
      <div class="tn-actions">${sportMenuHtml("tennis")}<button class="tn-ic" id="tn-refresh" type="button" aria-label="Aggiorna dati">${icon("refresh")}</button></div>
    </header>
    <main class="tn-main">
      <section class="tn-pane" id="tn-pane-matches">
        <section class="intro"><p class="eyebrow">${icon("tennis-ball")}Tennis · ATP e WTA</p><h1 id="tn-title">Partite di tennis</h1><p id="tn-sum" class="summary" aria-live="polite"></p></section>
        <div id="tn-banner" class="banner" role="status" hidden></div>
        <div class="seg" id="tn-seg" role="group" aria-label="Filtro partite" style="--segn:2;--i:0"><button type="button" data-seg="all" aria-pressed="true">Tutte</button><button type="button" data-seg="bet" aria-pressed="false">Solo BET</button></div>
        <div class="days" id="tn-days" aria-label="Giornata"></div>
        <div class="daybar"><button class="chip-btn save-day" id="tn-save-day" type="button" hidden></button></div><div class="listbar"><button class="chip-btn" id="tn-ftoggle" type="button" aria-expanded="false" aria-controls="tn-facc">Filtri</button></div>
        <div class="tn-facc" id="tn-facc" inert><div class="tn-fclip"><div class="tn-fpanel" id="tn-fpanel"></div></div></div>
        <div id="tn-list" class="list"></div>
        <p class="foot">Stime statistiche sperimentali. Non sono garanzie né consigli finanziari.</p>
      </section>
      <section class="tn-pane" id="tn-pane-strategy" hidden></section>
      <section class="tn-pane" id="tn-pane-plays" hidden></section>
      <section class="tn-pane" id="tn-pane-reliability" hidden></section>
      <section class="tn-pane" id="tn-pane-settings" hidden></section>
    </main>
    <nav class="sl-nav tn n5" id="tn-tabs" role="group" aria-label="Navigazione"><span class="sl-nav-ind" aria-hidden="true"></span>
      <button type="button" data-tab="matches" aria-pressed="true"><span class="tab-ic">${iconPair("tennis-ball")}</span><span class="tab-lb">Partite</span></button>
      <button type="button" data-tab="strategy" aria-pressed="false"><span class="tab-ic">${iconPair("target")}</span><span class="tab-lb">Strategia</span></button>
      <button type="button" data-tab="plays" aria-pressed="false"><span class="tab-ic">${iconPair("receipt")}<i class="badge" id="tn-plays-badge" hidden>0</i></span><span class="tab-lb">Giocate</span></button>
      <button type="button" data-tab="reliability" aria-pressed="false"><span class="tab-ic">${iconPair("chart-bar")}</span><span class="tab-lb">Affidabilità</span></button>
      <button type="button" data-tab="settings" aria-pressed="false"><span class="tab-ic">${iconPair("gear")}</span><span class="tab-lb">Impostazioni</span></button>
    </nav>
    <dialog id="tn-detail" aria-label="Dettaglio partita"><span class="grab" aria-hidden="true"></span><button class="close" data-close aria-label="Chiudi">${icon("close")}</button><div id="tn-detail-body" class="tn-detail-body"></div></dialog>`;

  const $ = (s) => root.querySelector(s);
  const dlg = $("#tn-detail");
  enableSheet(dlg);
  let detailKey = null, animTimer = null;

  const isSaved = (m) => { const c = playFromMatch(m); return Boolean(c) && state.plays.some((p) => tSignature(p) === tSignature(c)); };
  const setBanner = (text, kind = "") => { const b = $("#tn-banner"); b.hidden = !text; b.textContent = text ?? ""; b.className = `banner${kind ? ` ${kind}` : ""}`; };
  const persistPlays = () => { saveTPlays(state.plays); const b = $("#tn-plays-badge"); b.hidden = !state.plays.length; b.textContent = String(state.plays.length); };

  /* ---------- Elenco ---------- */
  const scope = () => filterMatches(state.matches, { ...state.filters, day: "all", status: "all", onlyBet: state.onlyBet });
  function visible() {
    const pool = scope();
    if (state.day === "results") return pool.filter((m) => m.status === "finished" || m.status === "ended_other").sort((a, b) => new Date(b.startsAt) - new Date(a.startsAt));
    return pool.filter((m) => isOpen(m) && dayKey(m.startsAt) === state.day);
  }
  function renderDays() {
    const base = filterMatches(state.matches, { ...state.filters, day: "all", status: "all", onlyBet: false });
    const counts = new Map();
    for (const m of base.filter(isOpen)) counts.set(dayKey(m.startsAt), (counts.get(dayKey(m.startsAt)) ?? 0) + 1);
    const keys = [...counts.keys()].sort();
    const hasResults = base.some((m) => m.status === "finished" || m.status === "ended_other");
    if (state.day !== "results" && !keys.includes(state.day)) state.day = keys[0] ?? (hasResults ? "results" : null);
    $("#tn-days").innerHTML = keys.map((k) => { const d = dayParts(k); return `<button class="day" type="button" data-day="${k}" aria-pressed="${k === state.day}"><b>${d.wd}</b><span>${d.dm}</span><small>${counts.get(k)} gare</small></button>`; }).join("")
      + (hasResults ? `<button class="day" type="button" data-day="results" aria-pressed="${state.day === "results"}"><b>Ultimi</b><span>Risultati</span></button>` : "");
  }
  const freshChip = () => {
    if (!state.builtAt) return "";
    const age = Date.now() - new Date(state.builtAt).getTime(), cls = age > 6 * 3600e3 ? "bad" : age > STALE_MS ? "warn" : "";
    return `<button class="stat fresh ${cls}" type="button" data-tab="settings" title="Apri lo stato dei dati"><i class="dot"></i>Aggiornato ${esc(fmtTime.format(new Date(state.builtAt)))}</button>`;
  };
  function filtersHtml() {
    const fx = facets(state.matches), f = state.filters;
    const btn = (attr, val, label, cur) => `<button type="button" ${attr}="${esc(val)}" aria-pressed="${cur === val}">${esc(label)}</button>`;
    const search = `<input id="tn-q" class="tn-search" type="search" inputmode="search" placeholder="Cerca giocatore o torneo" aria-label="Cerca giocatore o torneo" value="${esc(f.q)}">`;
    const tours = `<div class="tn-seg2" role="group" aria-label="Genere e circuito">${btn("data-tour", "all", "Tutti", f.tour)}${fx.tours.map((t) => btn("data-tour", t, GENDER_LABEL[t] ?? t.toUpperCase(), f.tour)).join("")}</div>`;
    const cats = fx.categories.length > 1 ? `<div class="tn-chips-row" role="group" aria-label="Categoria">${btn("data-cat", "all", "Tutte", f.category)}${fx.categories.map((c) => btn("data-cat", c, CATEGORY_LABEL[c] ?? c, f.category)).join("")}</div>` : "";
    const surfaces = fx.surfaces.length > 1 ? `<div class="tn-chips-row" role="group" aria-label="Superficie">${btn("data-surface", "all", "Tutte", f.surface)}${fx.surfaces.map((s) => btn("data-surface", s, SURFACE_LABEL[s], f.surface)).join("")}</div>` : "";
    const tourney = fx.tournaments.length > 1 ? `<div class="tn-row"><select id="tn-tournament" class="${f.tournament !== "all" ? "on" : ""}" aria-label="Torneo"><option value="all">Tutti i tornei</option>${fx.tournaments.map((t) => `<option value="${esc(t)}"${t === f.tournament ? " selected" : ""}>${esc(t)}</option>`).join("")}</select></div>` : "";
    return `${search}${tours}${cats}${surfaces}${tourney}`;
  }
  function listInner(shown) {
    if (!shown.length) return `<div class="empty">${state.loading ? "Carico i dati…" : state.onlyBet ? "Nessun BET in questa giornata con i filtri scelti." : "Nessuna partita con questi filtri."}</div>`;
    let k = 0;
    return groupByTournament(shown).map((g) => `<section class="tn-group"><h3 class="tn-gh"><span class="tn-tour">${esc(g.tour.toUpperCase())}</span>${esc(g.tournament)}<small>${esc(g.surface)}</small></h3><div class="tn-list">${g.matches.map((m) => rowHtml(m, { saved: isSaved(m), k: k++ })).join("")}</div></section>`).join("");
  }
  function renderMatches() {
    state.filters = sanitizeFilters(state.filters, state.matches);
    renderDays();
    const list = state.matches.length ? visible() : [];
    const bets = list.filter((m) => m.bet?.verdict === "BET" && m.prediction?.published).length, n = list.length;
    const long = state.day && state.day !== "results" ? dayParts(state.day).long : "";
    $("#tn-title").textContent = state.day === "results" ? "Ultimi risultati" : long ? long[0].toUpperCase() + long.slice(1) : "Partite di tennis";
    $("#tn-sum").innerHTML = state.loading && !state.matches.length ? `<span class="stat">Caricamento…</span>` : !state.matches.length ? `<span class="stat">Nessuna partita disponibile</span>`
      : `<span class="stat"><b>${n}</b> ${n === 1 ? "partita" : "partite"}</span>${state.day === "results" ? "" : `<span class="stat bet"><b>${bets}</b> con BET</span>`}${freshChip()}`;
    const seg = $("#tn-seg"), cur = state.onlyBet ? "bet" : "all";
    seg.style.setProperty("--i", String(cur === "bet" ? 1 : 0));
    for (const b of seg.querySelectorAll("[data-seg]")) b.setAttribute("aria-pressed", String(b.dataset.seg === cur));
    const dayBetsT = state.day === "results" ? [] : list.filter((m) => canSave(m)), doneT = dayBetsT.filter((m) => isSaved(m)).length, sdState = saveDayState(dayBetsT.length - doneT, doneT);
    const sdBtn = $("#tn-save-day"); sdBtn.hidden = sdState.hidden || state.day === "results" || !state.matches.length; sdBtn.disabled = sdState.disabled; sdBtn.textContent = sdState.label;
    const f = state.filters, active = [f.tour !== "all", f.category !== "all", f.surface !== "all", f.tournament !== "all", Boolean(f.q)].filter(Boolean).length;
    const tg = $("#tn-ftoggle"); tg.textContent = active ? `Filtri · ${active}` : "Filtri"; tg.setAttribute("aria-expanded", String(state.fOpen));
    // Tendina dei filtri: il contenitore resta lo stesso (l'altezza si anima), il contenuto si ridisegna sempre così lo stato visivo segue quello reale.
    // Si lascia intatto solo il campo di testo mentre si scrive e si conserva lo scorrimento delle file di chip.
    const facc = $("#tn-facc"), panel = $("#tn-fpanel");
    facc.classList.toggle("open", state.fOpen && state.matches.length > 0);
    facc.toggleAttribute("inert", !facc.classList.contains("open"));
    if (state.matches.length && document.activeElement?.id !== "tn-q") {
      const scroll = [...panel.querySelectorAll(".tn-chips-row")].map((r) => r.scrollLeft);
      panel.innerHTML = filtersHtml();
      panel.querySelectorAll(".tn-chips-row").forEach((r, i) => { r.scrollLeft = scroll[i] ?? 0; });
    }
    const el = $("#tn-list");
    if (state.animate) { el.classList.add("anim"); state.animate = false; clearTimeout(animTimer); animTimer = setTimeout(() => el.classList.remove("anim"), 700); } else el.classList.remove("anim");
    el.innerHTML = !state.matches.length ? (state.loading ? Array.from({ length: 4 }, () => `<div class="row skel" aria-hidden="true"><i></i><i></i><i></i></div>`).join("") : state.error && !state.fromCache ? emptyHtml("error", state.error) : emptyHtml("nodata")) : listInner(list);
  }

  /* ---------- Altre schede ---------- */
  const evaluated = () => evaluateT(state.plays, state.matches);
  /** Cambio filtro delle giocate: si aggiorna il selettore esistente (così scorre) e solo l'elenco. */
  function setPlayFilter(f) {
    state.playFilter = f;
    const seg = $("#tn-pl-seg");
    if (!seg) return renderPlays();
    seg.style.setProperty("--i", String(PL_FILTERS.findIndex(([k]) => k === f)));
    for (const b of seg.querySelectorAll("[data-plf]")) b.setAttribute("aria-pressed", String(b.dataset.plf === f));
    const list = $("#tn-pl-list"); if (list) list.innerHTML = playsListHtml(evaluated().rows, f, state.open);
  }
  function renderStrategy() {
    const pane = $("#tn-pane-strategy"), y = window.scrollY;
    const dash = state.lo.data ? buildDashboard(state.lo.data, Date.now()) : null;
    pane.innerHTML = strategyHtml(dash, { tab: sanitizeTab(state.sTab) }, { loading: state.lo.loading, error: state.lo.error }, valueCardHtml(state.matches));
    window.scrollTo({ top: y });
  }
  function renderPlays() { $("#tn-pane-plays").innerHTML = playsViewHtml(evaluated(), { filter: state.playFilter, open: state.open, history: state.history }); }
  /** LIVE OBSERVATION: sola lettura da /api/tennis-observation, a pagine (cursore). Si carica solo all'apertura; «Carica altre»/«Carica tutto» recuperano il resto dello storico. */
  /** Ridisegna le schede che leggono il registro LIVE OBSERVATION (Strategia e Affidabilità), solo se visibili. */
  function renderObservationViews() { if (state.tab === "strategy") renderStrategy(); else if (state.tab === "reliability") renderReliability(); }
  async function loadObservation({ more = false, all = false } = {}) {
    if (state.lo.loading) return;
    state.lo.loading = true; state.lo.error = null; renderObservationViews();
    try {
      let first = !state.lo.data || !(more || all);
      do {
        const prev = state.lo.data, cur = first ? null : prev?.nextCursor;
        if (!first && !cur) break;
        first = false;
        const r = await getJson(`/api/tennis-observation?limit=100${cur ? `&before=${encodeURIComponent(cur)}` : ""}`, 30000);
        if (!r.ok) throw new Error(r.body?.error ?? `Risposta ${r.status}`);
        const b = r.body;
        state.lo.data = prev && cur ? { ...b, observations: [...prev.observations, ...b.observations], versions: [...prev.versions, ...b.versions], total: prev.total ?? b.total, diagnostics: prev.diagnostics, builtAt: prev.builtAt } : b;
        if (!b.available) break;
        if (all) renderObservationViews();   // avanzamento visibile: «caricate X di Y»
      } while (all && state.lo.data?.nextCursor);
    } catch (e) { state.lo.error = String(e?.message ?? e); }
    finally { state.lo.loading = false; renderObservationViews(); }
  }
  function renderReliability() { $("#tn-pane-reliability").innerHTML = `<section class="mn-intro"><h1>Affidabilità</h1><p>Quanto sono credibili i pronostici. Ogni numero ha la sua incertezza: con pochi casi non si conclude nulla.</p></section>${state.history ? tennisMonitorHtml(state.history, state.mnTab) : `<div class="mn-emptybox"><h3>Storico non ancora disponibile</h3><p>Comparirà dopo le prime partite concluse con un pronostico registrato prima dell'inizio.</p></div>`}${liveObservationHtml(state.lo, state.matches)}<div id="tn-learning"></div>`; mountLearning($("#tn-learning"), { sport: "tennis" }); }
  function renderSettings() { $("#tn-pane-settings").innerHTML = settingsHtml(state.diagnostics, state.builtAt, state.plays.length); }

  function render() {
    $("#tn-refresh").classList.toggle("spin", state.loading);
    renderMatches();
    const t = state.tab;
    if (t === "strategy") renderStrategy(); else if (t === "plays") renderPlays(); else if (t === "reliability") renderReliability(); else if (t === "settings") renderSettings();
    for (const b of root.querySelectorAll("#tn-tabs button")) b.setAttribute("aria-pressed", String(b.dataset.tab === t));
    $("#tn-tabs").style.setProperty("--i", String(TABS.indexOf(t)));
    for (const id of TABS) $(`#tn-pane-${id}`).hidden = id !== t;
    persistPlays();
  }
  function setTab(t) {
    if (state.tab === t) { window.scrollTo({ top: 0, behavior: "smooth" }); return; }
    state.tab = t; if (t === "matches") state.animate = true;
    render(); window.scrollTo({ top: 0 });
    if (t === "strategy" && !state.lo.loading && (!state.lo.data || (state.lo.data.available && state.lo.data.nextCursor))) void loadObservation({ all: true });
    const pane = $(`#tn-pane-${t}`); pane.classList.remove("enter"); void pane.offsetWidth; pane.classList.add("enter");
  }

  /* ---------- Dati ---------- */
  function apply(data, { cached = false } = {}) {
    const payload = data?.payload ?? {};
    state.matches = sanitizeMatches(payload.matches).filter(hasCompleteData);
    state.history = payload.history ?? null;
    state.diagnostics = payload.diagnostics ?? null;
    state.builtAt = data?.built_at ?? payload.updatedAt ?? null;
    state.fromCache = cached;
    if (absorbTResults(state.plays, state.matches)) saveTPlays(state.plays);
    const old = state.builtAt && Date.now() - new Date(state.builtAt).getTime() > STALE_MS;
    if (cached) setBanner("Dati salvati sul dispositivo: la connessione non è disponibile.", "warn");
    else if (old) setBanner("I dati non sono recenti: l'aggiornamento automatico potrebbe essersi fermato.", "warn");
    else setBanner("");
  }
  async function load() {
    if (state.loading) return;
    state.loading = true; state.error = null; render();
    try {
      const r = await getJson("/api/tennis-board");
      state.lastLoad = Date.now();
      if (r.status === 404) { state.matches = []; state.history = null; state.diagnostics = null; state.builtAt = null; setBanner(""); }
      else if (r.ok && r.body?.payload) { apply(r.body); writeCache(r.body); }
      else throw new Error(r.body?.error ?? `Risposta ${r.status}`);
    } catch (e) {
      state.error = e?.name === "AbortError" ? "Tempo scaduto." : String(e?.message ?? e);
      const c = readCache();
      if (c?.data) apply(c.data, { cached: true }); else setBanner(`Errore: ${state.error}`, "error");
    } finally { state.loading = false; render(); if (dlg.open && detailKey) openDetail(detailKey, true); }
  }

  /* ---------- Dettaglio e salvataggio ---------- */
  function openDetail(key, keep = false) {
    const m = state.matches.find((x) => x.key === key);
    if (!m) { showToast("Partita non più nel tabellone"); return; }
    detailKey = key;
    const body = $("#tn-detail-body"), y = body.scrollTop;
    body.innerHTML = detailHtml(m, { saved: isSaved(m) });
    if (!dlg.open) dlg.showModal();
    body.scrollTop = keep ? y : 0;
  }
  function savePlay(key) {
    const m = state.matches.find((x) => x.key === key), cand = m && canSave(m) ? playFromMatch(m) : null;
    if (!cand) return;
    const r = addTPlay(state.plays, cand);
    if (r.added) { state.plays = r.plays; persistPlays(); }
    showToast(r.added ? "Giocata salvata" : "Giocata già salvata");
    navigator.vibrate?.(10);
    render();
    if (dlg.open && detailKey === key) openDetail(key, true);
  }
  /** Salva tutte le giocate della giornata mostrata (con le stesse regole del segnalibro di ogni riga). */
  function saveDayBets() {
    const cands = visible().filter((m) => canSave(m) && !isSaved(m)).map((m) => playFromMatch(m));
    let n = 0;
    for (const c of cands) { const r = addTPlay(state.plays, c); if (r.added) { state.plays = r.plays; n += 1; } }
    if (n) persistPlays();
    showToast(n ? `${n} ${n === 1 ? "giocata salvata" : "giocate salvate"}` : "Giocate già salvate", n ? { action: "Vedi", onAction: () => setTab("plays") } : undefined);
    navigator.vibrate?.(10);
    render();
  }
  function deletePlay(id) {
    const index = state.plays.findIndex((p) => p.id === id);
    if (index < 0) return;
    const [play] = state.plays.splice(index, 1);
    state.open.delete(`p:${id}`); render();
    showToast("Giocata eliminata", { action: "Annulla", ms: 6000, onAction: () => { state.plays.splice(Math.min(index, state.plays.length), 0, play); render(); } });
  }
  function toggleAcc(acc) {
    const id = acc.dataset.acc, open = !acc.classList.contains("open");
    acc.classList.toggle("open", open);
    acc.querySelector(":scope > .acc-head")?.setAttribute("aria-expanded", String(open));
    acc.querySelector(":scope > .acc-panel")?.toggleAttribute("inert", !open);
    open ? state.open.add(id) : state.open.delete(id);
  }

  /* ---------- Eventi ---------- */
  root.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    if (t.closest("[data-sport-menu]") || t.closest("[data-close]") || t === dlg) return;   // menu sport e chiusura fogli: gestiti altrove
    if (t.closest("#tn-refresh")) return void load();
    if (t.closest("#tn-save-day")) return saveDayBets();
    const tab = t.closest("[data-tab]"); if (tab) return setTab(tab.dataset.tab);
    if (t.closest("[data-goto]")) return setTab("matches");
    const sv = t.closest("[data-row-save]"); if (sv) return savePlay(sv.dataset.rowSave);
    const sd = t.closest("[data-save-detail]"); if (sd) return savePlay(sd.dataset.saveDetail);
    const del = t.closest("[data-del-play]"); if (del) return deletePlay(del.dataset.delPlay);
    const head = t.closest(".acc-head"); if (head) return toggleAcc(head.closest(".acc"));
    const key = t.closest("[data-key]"); if (key && root.contains(key)) return openDetail(key.dataset.key);
    const seg = t.closest("[data-seg]"); if (seg) { state.onlyBet = seg.dataset.seg === "bet"; state.animate = true; return render(); }
    const day = t.closest("[data-day]"); if (day) { state.day = day.dataset.day; state.animate = true; return render(); }
    if (t.closest("#tn-ftoggle")) { state.fOpen = !state.fOpen; return render(); }
    for (const [attr, k] of [["data-tour", "tour"], ["data-cat", "category"], ["data-surface", "surface"]]) { const el = t.closest(`[${attr}]`); if (el) { state.filters[k] = el.getAttribute(attr); state.animate = true; return render(); } }
    const plf = t.closest("[data-plf]"); if (plf) return setPlayFilter(plf.dataset.plf);
    if (t.closest("[data-lo-toggle]")) { state.lo.open = !state.lo.open; renderReliability(); if (state.lo.open && !state.lo.data) loadObservation(); return; }
    const stb = t.closest("[data-stab]"); if (stb) { state.sTab = sanitizeTab(stb.dataset.stab); return renderStrategy(); }
    if (t.closest("[data-lo-more]")) return loadObservation({ more: true });
    if (t.closest("[data-lo-all]")) return loadObservation({ all: true });
    if (t.closest("[data-lo-rows]")) { state.lo.rows += 25; return renderReliability(); }
    const lot = t.closest("[data-lo-tab]"); if (lot) { state.lo.tab = lot.dataset.loTab; state.lo.openKey = null; state.lo.rows = 25; return renderReliability(); }
    const lor = t.closest("[data-lo-row]"); if (lor) { state.lo.openKey = state.lo.openKey === lor.dataset.loRow ? null : lor.dataset.loRow; return renderReliability(); }
    const mn = t.closest("[data-mn]"); if (mn) { state.mnTab = mn.dataset.mn; return renderReliability(); }
    if (t.closest("#tn-clear-plays") && state.plays.length && confirm(`Eliminare le ${state.plays.length} giocate salvate? Non si può annullare.`)) { state.plays = []; render(); }
  });
  root.addEventListener("change", (e) => {
    const lof = e.target.closest?.("[data-lo-f]"); if (lof) { state.lo.f = { ...state.lo.f, [lof.dataset.loF]: lof.value || "all" }; state.lo.rows = 25; if (lof.dataset.loF === "q") state.lo.f.q = lof.value; return renderReliability(); }
    if (e.target.id === "tn-tournament") { state.filters.tournament = e.target.value; state.animate = true; render(); } });
  let qTimer;
  root.addEventListener("input", (e) => {
    if (e.target.id !== "tn-q") return;
    clearTimeout(qTimer); const v = e.target.value;
    qTimer = setTimeout(() => { state.filters.q = v; state.animate = true; renderMatches(); }, 200);
  });
  document.addEventListener("visibilitychange", () => {
    if (!root.hidden && document.visibilityState === "visible" && Date.now() - state.lastLoad > REFRESH_MS) void load();
  });

  const c = readCache();
  if (c?.data) { apply(c.data, { cached: false }); setBanner(""); }
  render();
  void load();

  return {
    show() { root.hidden = false; if (Date.now() - state.lastLoad > REFRESH_MS) void load(); },
    hide() { if (dlg.open) closeSheet(dlg); root.hidden = true; },
    reload: load,
  };
}
