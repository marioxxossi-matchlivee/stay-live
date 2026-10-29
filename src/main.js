import "./style.css";
import { MODEL, verdictFor } from "../functions/api/model.js";

const $ = (s, r = document) => r.querySelector(s);
const TZ = "Europe/Rome";
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const pct = (p, d = 0) => (p == null ? "—" : `${(p * 100).toFixed(d).replace(".", ",")}%`);
const num = (v, d = 2) => (v == null || !Number.isFinite(Number(v)) ? "—" : Number(v).toFixed(d).replace(".", ","));
const fmtTime = new Intl.DateTimeFormat("it-IT", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
const fmtDay = new Intl.DateTimeFormat("en-CA", { timeZone: TZ });
const dayKey = (iso) => fmtDay.format(new Date(iso));
const dayParts = (key) => {
  const d = new Date(`${key}T12:00:00Z`);
  return {
    wd: new Intl.DateTimeFormat("it-IT", { weekday: "short", timeZone: "UTC" }).format(d).replace(".", ""),
    dm: new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short", timeZone: "UTC" }).format(d).replace(".", ""),
    long: new Intl.DateTimeFormat("it-IT", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(d),
  };
};

const state = {
  matches: [], leagues: [], league: "all", day: null, onlyBet: false, selected: new Set(),
  n: 8, loading: false, error: null, banner: null, syncTried: false, updatedAt: null,
};
const leagueName = (id, short = false) => state.leagues.find((l) => l.id === id)?.[short ? "short" : "name"] ?? id;
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
    Object.assign(state, { matches: data.matches, leagues: data.leagues, updatedAt: data.updatedAt });
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
    if (state.league !== "all" && m.league !== state.league) return false;
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
  const pool = state.matches.filter((m) => state.league === "all" || m.league === state.league);
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
function render() {
  $("#league-chips").innerHTML = [{ id: "all", short: "Tutti" }, ...state.leagues]
    .map((l) => `<button class="chip" type="button" data-league="${l.id}" aria-pressed="${state.league === l.id}">${esc(l.short)}</button>`).join("");
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
async function makePreview() {
  const ids = [...state.selected];
  if (!ids.length) return;
  $("#preview").showModal();
  $("#preview-body").innerHTML = `<p class="empty">Genero la preview…</p>`;
  $("#make-preview").disabled = true;
  try {
    lastPreview = await getJson(`/api/preview?ids=${ids.map(encodeURIComponent).join(",")}&n=${state.n}`);
    renderPreview();
  } catch (e) {
    $("#preview-body").innerHTML = `<h2 class="d-title">Preview non disponibile</h2><p class="d-sub">${esc(e.message)}</p>`;
  } finally { $("#make-preview").disabled = false; }
}
function previewText(pv) {
  const lines = pv.items.map((i) => {
    const t = fmtTime.format(new Date(i.kickoffAt));
    const p = i.pick;
    return p && i.confidence !== "insufficiente"
      ? `${t} ${i.home} – ${i.away} → ${p.verdict} ${p.label} (prudente ${pct(p.pLow)}, quota min ${num(p.minOdds)})`
      : `${t} ${i.home} – ${i.away} → EVITA (dati insufficienti)`;
  });
  const acc = pv.summary.accumulator;
  const accLine = acc ? `\nMultipla (${acc.ids.length} gare): prob. prudente ${pct(acc.pLow)}, quota minima ${num(acc.minOdds)}` : "";
  return `Stay Live · preview ${dayParts(dayKey(pv.items[0].kickoffAt)).long}\n${lines.join("\n")}${accLine}\nStime statistiche, non garanzie.`;
}
function renderPreview() {
  const pv = lastPreview;
  if (!pv.items.length) { $("#preview-body").innerHTML = `<p class="empty">Nessuna partita trovata.</p>`; return; }
  const acc = pv.summary.accumulator;
  const byId = new Map(pv.items.map((i) => [i.id, i]));
  $("#preview-body").innerHTML = `
    <h2 class="d-title">Preview delle partite scelte</h2>
    <div class="pv-sum">
      <strong>${pv.summary.bets} BET su ${pv.summary.selected} partite</strong>
      <span>${acc ? `Multipla più solida: ${acc.ids.map((id) => esc(byId.get(id).home)).join(" + ")}. Probabilità prudente ${pct(acc.pLow)}, quota minima ${num(acc.minOdds)}.` : "Servono almeno 2 BET per proporre una multipla."}</span>
    </div>
    <div class="pv-actions"><button class="primary" id="copy-preview" type="button">Copia riepilogo</button>${navigator.share ? `<button class="ghost" id="share-preview" type="button">Condividi</button>` : ""}</div>
    ${pv.items.map((i) => `<article class="pv-card">
      <span class="meta"><b>${fmtTime.format(new Date(i.kickoffAt))}</b><span>${esc(leagueName(i.league, true))}</span></span>
      <span class="teams">${esc(i.home)}<i>–</i>${esc(i.away)}</span>
      ${i.pick ? pickChip({ ...i.pick, confidence: i.confidence, sample: i.sample }) : ""}
      <span class="pv-more"><span>Quota minima ${num(i.pick?.minOdds)}</span><span>Gol attesi ${num(i.lambda.total)}</span><span>Più probabile ${esc(i.topScores[0]?.score ?? "—")}</span>${i.alternatives[0] ? `<span>Alternativa: ${esc(i.alternatives[0].label)} ${pct(i.alternatives[0].pLow)}</span>` : ""}</span>
      <button class="link" type="button" data-open="${esc(i.id)}" style="justify-self:start">Vedi il calcolo</button>
    </article>`).join("")}
    <p class="foot">Le quote minime sono quelle sotto cui non c’è margine secondo il modello. Controlla sempre la quota reale prima di giocare.</p>`;
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
    <li><b>Multipla</b><span>Fino a 4 BET di partite diverse con le probabilità prudenti più alte; la probabilità combinata è il prodotto (partite considerate indipendenti).</span></li>
  </ol>
  <p><b>Limiti.</b> Le soglie sono scelte ragionevoli ma non calibrate su uno storico lungo. I bookmaker conoscono molto più di questo modello e applicano un margine: senza la quota reale, un BET significa solo “alta probabilità”, non “scommessa di valore”.</p></div>`;
}

/* ---------- Eventi ---------- */
document.addEventListener("click", (e) => {
  const t = e.target;
  if (t.closest("[data-close]")) t.closest("dialog").close();
  else if (t.tagName === "DIALOG") t.close();
  const chip = t.closest("[data-league]"); if (chip) { state.league = chip.dataset.league; render(); }
  const day = t.closest("[data-day]"); if (day) { state.day = day.dataset.day; render(); }
  const open = t.closest("[data-open]"); if (open) openDetail(open.dataset.open);
  if (t.closest("#copy-preview")) navigator.clipboard?.writeText(previewText(lastPreview)).then(() => { t.textContent = "Copiato"; });
  if (t.closest("#share-preview")) navigator.share?.({ text: previewText(lastPreview) }).catch(() => {});
});
document.addEventListener("change", (e) => {
  const t = e.target;
  if (t.matches("[data-sel]")) { t.checked ? state.selected.add(t.dataset.sel) : state.selected.delete(t.dataset.sel); render(); }
  if (t.id === "only-bet") { state.onlyBet = t.checked; render(); }
  if (t.id === "history-count") { state.n = Number(t.value); load({ sync: false }); }
  if (t.id === "detail-n") { state.n = Number(t.value); $("#history-count").value = String(state.n); openDetailKeep(); }
});
document.addEventListener("input", (e) => {
  const t = e.target;
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
