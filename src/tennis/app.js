// Stay Live Tennis — schermata tennis (caricata solo quando si sceglie il tennis: un errore qui non tocca il calcio).
// Stessa struttura del calcio: Partite · Giocate · Affidabilità · Impostazioni.
import "./tennis.css";
import "../monitor.css";
import { icon, iconPair, markSvg } from "../icons.js";
import { esc, dayParts, dayKey, fmtTime } from "../format.js";
import { sportMenuHtml } from "../sportmenu.js";
import { enableSheet, closeSheet } from "../sheet.js";
import { showToast } from "../toast.js";
import { accordionHtml } from "../playlist.js";
import { DEFAULT_FILTERS, SURFACE_LABEL, CATEGORY_LABEL, GENDER_LABEL, facets, filterMatches, groupByTournament, sanitizeFilters, sanitizeMatches } from "./board.js";
import { detailHtml, emptyHtml, rowHtml, canSave } from "./view.js";
import { tennisMonitorHtml } from "./monitor.js";
import { playsViewHtml, settingsHtml } from "./playsview.js";
import { absorbTResults, addTPlay, evaluateT, loadTPlays, playFromMatch, removeTPlay, saveTPlays, tSignature } from "./plays.js";

const CACHE_KEY = "sl-tennis-board-v2";
const STALE_MS = 75 * 60e3;   // la snapshot si rinnova ogni 15–30 minuti
const REFRESH_MS = 5 * 60e3;
const TABS = ["matches", "plays", "reliability", "settings"];
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
    tab: "matches", plays: loadTPlays(), playFilter: "all", open: new Set(), mnTab: "live",
    loading: false, error: null, fromCache: false, lastLoad: 0, animate: true,
  };

  root.innerHTML = `
    <header class="tn-top">
      <a class="tn-brand" href="/" aria-label="Stay Live Tennis">${markSvg("tn-mark")}<span>Stay<b>Live</b></span></a>
      <div class="tn-actions">${sportMenuHtml("tennis")}<button class="tn-ic" id="tn-refresh" type="button" aria-label="Aggiorna dati">${icon("refresh")}</button></div>
    </header>
    <main class="tn-main">
      <section class="tn-pane" id="tn-pane-matches">
        <section class="intro"><p class="eyebrow">${icon("tennis-ball")}Tennis · ATP e WTA</p><h1 id="tn-title">Partite di tennis</h1><p id="tn-sum" class="summary" aria-live="polite"></p></section>
        <div id="tn-banner" class="banner" role="status" hidden></div>
        <div class="seg" id="tn-seg" role="group" aria-label="Filtro partite" style="--i:0"><button type="button" data-seg="all" aria-pressed="true">Tutte</button><button type="button" data-seg="bet" aria-pressed="false">Solo BET</button></div>
        <div class="days" id="tn-days" aria-label="Giornata"></div>
        <div class="listbar"><button class="chip-btn" id="tn-ftoggle" type="button" aria-expanded="false" aria-controls="tn-fpanel">Filtri</button></div>
        <div class="tn-fpanel" id="tn-fpanel" hidden></div>
        <div id="tn-list" class="list"></div>
        <p class="foot">Stime statistiche sperimentali. Non sono garanzie né consigli finanziari.</p>
      </section>
      <section class="tn-pane" id="tn-pane-plays" hidden></section>
      <section class="tn-pane" id="tn-pane-reliability" hidden></section>
      <section class="tn-pane" id="tn-pane-settings" hidden></section>
    </main>
    <nav class="sl-nav tn n4" id="tn-tabs" role="group" aria-label="Navigazione"><span class="sl-nav-ind" aria-hidden="true"></span>
      <button type="button" data-tab="matches" aria-pressed="true"><span class="tab-ic">${iconPair("tennis-ball")}</span><span class="tab-lb">Partite</span></button>
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
    const tourney = fx.tournaments.length > 1 ? `<div class="tn-row"><select id="tn-tournament" aria-label="Torneo"><option value="all">Tutti i tornei</option>${fx.tournaments.map((t) => `<option value="${esc(t)}"${t === f.tournament ? " selected" : ""}>${esc(t)}</option>`).join("")}</select></div>` : "";
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
    const f = state.filters, active = [f.tour !== "all", f.category !== "all", f.surface !== "all", f.tournament !== "all", Boolean(f.q)].filter(Boolean).length;
    const tg = $("#tn-ftoggle"); tg.textContent = active ? `Filtri · ${active}` : "Filtri"; tg.setAttribute("aria-expanded", String(state.fOpen));
    const panel = $("#tn-fpanel"); panel.hidden = !state.fOpen || !state.matches.length; if (!panel.hidden && !panel.contains(document.activeElement)) panel.innerHTML = filtersHtml();
    const el = $("#tn-list");
    if (state.animate) { el.classList.add("anim"); state.animate = false; clearTimeout(animTimer); animTimer = setTimeout(() => el.classList.remove("anim"), 700); } else el.classList.remove("anim");
    el.innerHTML = !state.matches.length ? (state.loading ? Array.from({ length: 4 }, () => `<div class="row skel" aria-hidden="true"><i></i><i></i><i></i></div>`).join("") : state.error && !state.fromCache ? emptyHtml("error", state.error) : emptyHtml("nodata")) : listInner(list);
  }

  /* ---------- Altre schede ---------- */
  const evaluated = () => evaluateT(state.plays, state.matches);
  function renderPlays() { $("#tn-pane-plays").innerHTML = playsViewHtml(evaluated(), { filter: state.playFilter, open: state.open, history: state.history }); }
  function renderReliability() { $("#tn-pane-reliability").innerHTML = `<section class="mn-intro"><h1>Affidabilità</h1><p>Quanto sono credibili i pronostici. Ogni numero ha la sua incertezza: con pochi casi non si conclude nulla.</p></section>${state.history ? tennisMonitorHtml(state.history, state.mnTab) : `<div class="mn-emptybox"><h3>Storico non ancora disponibile</h3><p>Comparirà dopo le prime partite concluse con un pronostico registrato prima dell'inizio.</p></div>`}`; }
  function renderSettings() { $("#tn-pane-settings").innerHTML = settingsHtml(state.diagnostics, state.builtAt, state.plays.length); }

  function render() {
    $("#tn-refresh").classList.toggle("spin", state.loading);
    renderMatches();
    const t = state.tab;
    if (t === "plays") renderPlays(); else if (t === "reliability") renderReliability(); else if (t === "settings") renderSettings();
    for (const b of root.querySelectorAll("#tn-tabs button")) b.setAttribute("aria-pressed", String(b.dataset.tab === t));
    $("#tn-tabs").style.setProperty("--i", String(TABS.indexOf(t)));
    for (const id of TABS) $(`#tn-pane-${id}`).hidden = id !== t;
    persistPlays();
  }
  function setTab(t) {
    if (state.tab === t) { window.scrollTo({ top: 0, behavior: "smooth" }); return; }
    state.tab = t; if (t === "matches") state.animate = true;
    render(); window.scrollTo({ top: 0 });
    const pane = $(`#tn-pane-${t}`); pane.classList.remove("enter"); void pane.offsetWidth; pane.classList.add("enter");
  }

  /* ---------- Dati ---------- */
  function apply(data, { cached = false } = {}) {
    const payload = data?.payload ?? {};
    state.matches = sanitizeMatches(payload.matches);
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
    const plf = t.closest("[data-plf]"); if (plf) { state.playFilter = plf.dataset.plf; return renderPlays(); }
    const mn = t.closest("[data-mn]"); if (mn) { state.mnTab = mn.dataset.mn; return renderReliability(); }
    if (t.closest("#tn-clear-plays") && state.plays.length && confirm(`Eliminare le ${state.plays.length} giocate salvate? Non si può annullare.`)) { state.plays = []; render(); }
  });
  root.addEventListener("change", (e) => { if (e.target.id === "tn-tournament") { state.filters.tournament = e.target.value; state.animate = true; render(); } });
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
