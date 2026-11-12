// Stay Live Tennis — schermata tennis (caricata solo quando si sceglie il tennis: un errore qui non tocca il calcio).
import "./tennis.css";
import { esc, dayParts } from "../format.js";
import { DEFAULT_FILTERS, SURFACE_LABEL, facets, filterMatches, groupByTournament, sanitizeFilters, sanitizeMatches } from "./board.js";
import { detailHtml, emptyHtml, historyHtml, listHtml } from "./view.js";


const CACHE_KEY = "sl-tennis-board-v1";
const STALE_MS = 12 * 3600e3;
const REFRESH_MS = 5 * 60e3;
const refreshIcon = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v5h-5"/></svg>`;

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

export function mountTennis(root, { onSwitch = () => {} } = {}) {
  const state = { matches: [], history: null, builtAt: null, filters: { ...DEFAULT_FILTERS }, tab: "matches", loading: false, error: null, fromCache: false, lastLoad: 0 };

  root.innerHTML = `
    <header class="tn-top">
      <a class="tn-brand" href="/" aria-label="Stay Live Tennis"><svg class="tn-mark" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="10" fill="#0b1a2a"/><circle cx="16" cy="16" r="9" fill="#c6e03b"/><path d="M8.5 11.5c4 2 11 2 15 0M8.5 20.5c4-2 11-2 15 0" fill="none" stroke="#0b1a2a" stroke-width="1.6" stroke-linecap="round"/></svg><span>Stay<b>Live</b></span><em>Tennis</em></a>
      <div class="tn-actions"><button class="tn-pill" id="tn-switch" type="button" aria-label="Cambia sport">Tennis ▾</button><button class="tn-ic" id="tn-refresh" type="button" aria-label="Aggiorna dati">${refreshIcon}</button></div>
    </header>
    <main class="tn-main">
      <section class="tn-intro"><h1>Partite di tennis</h1><p id="tn-sum" class="tn-sum" aria-live="polite">Caricamento…</p></section>
      <div id="tn-banner" class="tn-banner" role="status" hidden></div>
      <div class="tn-seg" id="tn-tabs" role="group" aria-label="Sezione"><button type="button" data-tab="matches" aria-pressed="true">Partite</button><button type="button" data-tab="history" aria-pressed="false">Storico</button></div>
      <div id="tn-pane-matches">
        <div id="tn-filters" class="tn-filters"></div>
        <div id="tn-body"></div>
      </div>
      <div id="tn-pane-history" hidden></div>
    </main>
    <dialog id="tn-detail" aria-label="Dettaglio partita"><span class="grab" aria-hidden="true"></span><button class="close" data-close aria-label="Chiudi">×</button><div id="tn-detail-body" class="tn-detail-body"></div></dialog>`;

  const $ = (s) => root.querySelector(s);
  const dlg = $("#tn-detail");

  function setBanner(text, kind = "") {
    const b = $("#tn-banner");
    b.hidden = !text; b.textContent = text ?? ""; b.className = `tn-banner ${kind}`;
  }

  function filtersHtml() {
    const fx = facets(state.matches), f = state.filters;
    const btn = (attr, val, label, cur) => `<button type="button" ${attr}="${esc(val)}" aria-pressed="${cur === val}">${esc(label)}</button>`;
    const tours = `<div class="tn-seg2" role="group" aria-label="Circuito">${btn("data-tour", "all", "Tutti", f.tour)}${fx.tours.map((t) => btn("data-tour", t, t.toUpperCase(), f.tour)).join("")}</div>`;
    const surfaces = `<div class="tn-chips-row" role="group" aria-label="Superficie">${btn("data-surface", "all", "Tutte", f.surface)}${fx.surfaces.map((s) => btn("data-surface", s, SURFACE_LABEL[s], f.surface)).join("")}</div>`;
    const tourney = fx.tournaments.length > 1 ? `<select id="tn-tournament" aria-label="Torneo"><option value="all">Tutti i tornei</option>${fx.tournaments.map((t) => `<option value="${esc(t)}"${t === f.tournament ? " selected" : ""}>${esc(t)}</option>`).join("")}</select>` : "";
    const picks = `<label class="tn-check"><input type="checkbox" id="tn-onlypicks"${f.onlyPicks ? " checked" : ""}> Solo con pronostico</label>`;
    const days = fx.days.length > 1 ? `<div class="tn-days" role="group" aria-label="Data">${btn("data-day", "all", "Tutti", f.day).replace(">Tutti<", "><b>Tutti</b><small>i giorni</small><")}${fx.days.map((k) => { const d = dayParts(k); return `<button type="button" data-day="${k}" aria-pressed="${f.day === k}"><b>${esc(d.wd)}</b><small>${esc(d.dm)}</small></button>`; }).join("")}</div>` : "";
    return `${tours}${surfaces}<div class="tn-row">${tourney}${picks}</div>${days}`;
  }

  function summaryText() {
    if (state.loading && !state.matches.length) return "Caricamento…";
    if (!state.matches.length) return "Nessuna partita disponibile.";
    const shown = filterMatches(state.matches, state.filters);
    const picks = shown.filter((m) => m.prediction?.published).length;
    const upd = state.builtAt ? ` Ultimo aggiornamento: ${new Date(state.builtAt).toLocaleString("it-IT", { timeZone: "Europe/Rome", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}.` : "";
    return `${shown.length} partite, ${picks} con pronostico.${upd}`;
  }

  function render() {
    state.filters = sanitizeFilters(state.filters, state.matches);
    $("#tn-sum").textContent = summaryText();
    $("#tn-refresh").classList.toggle("spin", state.loading);
    $("#tn-filters").innerHTML = state.matches.length ? filtersHtml() : "";
    const body = $("#tn-body");
    if (!state.matches.length) body.innerHTML = state.error && !state.fromCache ? emptyHtml("error", state.error) : state.loading ? "" : emptyHtml("nodata");
    else {
      const shown = filterMatches(state.matches, state.filters);
      body.innerHTML = shown.length ? listHtml(groupByTournament(shown)) : emptyHtml("filtered");
    }
    $("#tn-pane-history").innerHTML = historyHtml(state.history);
    for (const b of root.querySelectorAll("#tn-tabs button")) b.setAttribute("aria-pressed", String(b.dataset.tab === state.tab));
    $("#tn-tabs").style.setProperty("--i", state.tab === "matches" ? 0 : 1);
    $("#tn-pane-matches").hidden = state.tab !== "matches";
    $("#tn-pane-history").hidden = state.tab !== "history";
  }

  function apply(data, { cached = false } = {}) {
    const payload = data?.payload ?? {};
    state.matches = sanitizeMatches(payload.matches);
    state.history = payload.history ?? null;
    state.builtAt = data?.built_at ?? payload.updatedAt ?? null;
    state.fromCache = cached;
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
      if (r.status === 404) { state.matches = []; state.history = null; state.builtAt = null; setBanner(""); }
      else if (r.ok && r.body?.payload) { apply(r.body); writeCache(r.body); }
      else throw new Error(r.body?.error ?? `Risposta ${r.status}`);
    } catch (e) {
      state.error = e?.name === "AbortError" ? "Tempo scaduto." : String(e?.message ?? e);
      const c = readCache();
      if (c?.data) { apply(c.data, { cached: true }); }
      else setBanner(`Errore: ${state.error}`, "error");
    } finally { state.loading = false; render(); }
  }

  function openDetail(key) {
    const m = state.matches.find((x) => x.key === key);
    if (!m) return;
    $("#tn-detail-body").innerHTML = detailHtml(m);
    if (!dlg.open) dlg.showModal();
    dlg.scrollTop = 0; $("#tn-detail-body").scrollTop = 0;
  }

  root.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof Element)) return;
    const card = t.closest("[data-key]"); if (card && root.contains(card)) return openDetail(card.dataset.key);
    if (t.closest("#tn-switch")) return onSwitch();
    if (t.closest("#tn-refresh")) return void load();
    if (t.closest("[data-close]")) return dlg.close();
    if (t === dlg) return dlg.close(); // tocco sullo sfondo
    const tab = t.closest("[data-tab]"); if (tab) { state.tab = tab.dataset.tab; return render(); }
    const tour = t.closest("[data-tour]"); if (tour) { state.filters.tour = tour.dataset.tour; return render(); }
    const surf = t.closest("[data-surface]"); if (surf) { state.filters.surface = surf.dataset.surface; return render(); }
    const day = t.closest("[data-day]"); if (day) { state.filters.day = day.dataset.day; return render(); }
  });
  root.addEventListener("change", (e) => {
    if (e.target.id === "tn-tournament") { state.filters.tournament = e.target.value; render(); }
    if (e.target.id === "tn-onlypicks") { state.filters.onlyPicks = e.target.checked; render(); }
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
    hide() { if (dlg.open) dlg.close(); root.hidden = true; },
    reload: load,
  };
}
