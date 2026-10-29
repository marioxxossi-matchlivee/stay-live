import "./style.css";

const DEMO_MATCHES = [
  { id: "demo-1", home: "Inter", away: "Juventus", homeLogo: "https://media.api-sports.io/football/teams/505.png", awayLogo: "https://media.api-sports.io/football/teams/496.png", kickoff: "Esempio", status: "upcoming", goals: "—", corners: "—" },
  { id: "demo-2", home: "Milan", away: "Roma", homeLogo: "https://media.api-sports.io/football/teams/489.png", awayLogo: "https://media.api-sports.io/football/teams/497.png", kickoff: "Esempio", status: "upcoming", goals: "—", corners: "—" },
  { id: "demo-3", home: "Napoli", away: "Atalanta", homeLogo: "https://media.api-sports.io/football/teams/492.png", awayLogo: "https://media.api-sports.io/football/teams/499.png", kickoff: "Esempio", status: "finished", goals: "2 – 1", corners: "6 – 4" },
];
const $ = (selector) => document.querySelector(selector);
const state = { matches: [], filter: "all", demo: true, source: "demo", updatedAt: null, loading: false };

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
function safeLogo(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && parsed.hostname === "media.api-sports.io" ? parsed.href : "";
  } catch { return ""; }
}
function crest(url, name) {
  const logo = safeLogo(url);
  return `${logo ? `<img class="crest" src="${escapeHtml(logo)}" alt="" loading="lazy" onerror="this.remove()">` : `<span class="crest-placeholder" aria-hidden="true">${escapeHtml(String(name ?? "?").slice(0, 1))}</span>`}<span>${escapeHtml(name)}</span>`;
}
function statusLabel(match) {
  if (match.status === "live") return `● LIVE${match.elapsed ? ` ${match.elapsed}′` : ""}`;
  if (match.status === "finished") return "Terminata";
  return "In programma";
}
function formatUpdated(value) {
  if (!value) return "Aggiornamento non disponibile";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Aggiornamento non disponibile";
  return `Ultimo aggiornamento: ${new Intl.DateTimeFormat("it-IT", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Rome" }).format(date)}`;
}
function totalFromScore(score) {
  if (typeof score !== "string" || !score.includes("–")) return null;
  const parts = score.split("–").map((part) => Number(part.trim()));
  return parts.length === 2 && parts.every(Number.isFinite) ? parts[0] + parts[1] : null;
}
function render() {
  const visible = state.matches.filter((match) => state.filter === "all" || match.status === state.filter);
  $("#matches").innerHTML = visible.length ? visible.map((match) => `
    <tr>
      <td><div class="teams"><div class="team">${crest(match.homeLogo, match.home)}</div><div class="team">${crest(match.awayLogo, match.away)}</div></div><small class="kickoff">${escapeHtml(match.kickoff || "Orario da definire")}</small></td>
      <td><span class="status ${match.status === "live" ? "live" : ""}">${statusLabel(match)}</span></td>
      <td class="score">${escapeHtml(match.goals ?? "—")}</td>
      <td class="score">${escapeHtml(match.corners ?? "—")}</td>
      <td><button class="details-button" data-id="${escapeHtml(match.id)}">Dettagli <span>↗</span></button></td>
    </tr>`).join("") : `<tr><td colspan="5" class="empty">${state.demo ? "Dati reali non configurati: gli esempi demo non corrispondono a partite reali." : "Nessuna partita trovata per questo filtro."}</td></tr>`;

  $("#metric-fixtures").textContent = state.demo ? "—" : String(state.matches.filter((m) => m.status !== "finished").length);
  const cornerTotals = state.demo ? [] : state.matches.map((m) => totalFromScore(m.corners)).filter((v) => v !== null);
  const goalTotals = state.demo ? [] : state.matches.map((m) => totalFromScore(m.goals)).filter((v) => v !== null);
  $("#metric-corners").textContent = cornerTotals.length ? (cornerTotals.reduce((a, b) => a + b, 0) / cornerTotals.length).toFixed(1) : "—";
  $("#metric-goals").textContent = goalTotals.length ? (goalTotals.reduce((a, b) => a + b, 0) / goalTotals.length).toFixed(1) : "—";
  $("#data-source").textContent = state.demo ? "DEMO" : state.source === "api-football" ? "API" : "DB";
  $("#source-note").textContent = state.demo ? "Dati dimostrativi" : state.source === "api-football" ? "API-Football" : "Supabase";
  $("#status-note").textContent = state.demo
    ? "Nessun dato reale disponibile. Configura API-Football e/o Supabase. Le partite mostrate sono solo esempi."
    : `Dati ricevuti da ${state.source === "api-football" ? "API-Football" : "Supabase"}. Corner e analisi dettagliata richiedono lo storico importato.`;
  $("#updated-at").textContent = formatUpdated(state.updatedAt);
  $("#refresh").disabled = state.loading;
  $("#refresh").innerHTML = state.loading ? 'Aggiornamento… <span>↻</span>' : 'Aggiorna dati <span>↻</span>';
}
let selectedMatch = null;
async function loadMatchAnalysis() {
  const match = selectedMatch;
  if (!match || state.demo || String(match.id).startsWith("demo-")) {
    $("#analysis-state").textContent = "Analisi non disponibile sui dati dimostrativi.";
    $("#analysis-values").hidden = true;
    return;
  }
  $("#analysis-state").textContent = "Calcolo delle statistiche in corso…";
  $("#analysis-values").hidden = true;
  try {
    const count = $("#history-count").value;
    const teamQuery = match.homeId && match.awayId
      ? `homeProviderId=${encodeURIComponent(match.homeId)}&awayProviderId=${encodeURIComponent(match.awayId)}`
      : `fixtureId=${encodeURIComponent(match.providerId ?? match.id)}`;
    const response = await fetch(`/api/analysis?${teamQuery}&matches=${count}`);
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Storico non disponibile.");
    const format = (value, suffix = "") => value == null || !Number.isFinite(Number(value)) ? "—" : `${Number(value).toFixed(1)}${suffix}`;
    $("#analysis-values").innerHTML = `
      <div><small>MEDIA GOL ATTESI</small><strong>${format(data.goals.expectedTotal)}</strong></div>
      <div><small>OVER 2,5 GOL</small><strong>${format(data.goals.over25, "%")}</strong></div>
      <div><small>MEDIA CORNER ATTESI</small><strong>${format(data.corners.expectedTotal)}</strong></div>
      <div><small>OVER 8,5 CORNER</small><strong>${format(data.corners.over85, "%")}</strong></div>
      <div class="analysis-foot">Campione: ${data.sampleSize.home} gare casa selezionata · ${data.sampleSize.away} gare trasferta selezionata. Affidabilità: ${escapeHtml(data.confidence)}.</div>`;
    $("#analysis-values").hidden = false;
    $("#analysis-state").textContent = data.disclaimer;
  } catch (error) {
    $("#analysis-state").textContent = error.message || "Analisi non disponibile.";
  }
}
function openMatch(match) {
  selectedMatch = match;
  $("#modal-title").textContent = `${match.home} – ${match.away}`;
  $("#modal-status").textContent = `${statusLabel(match)}${match.kickoff ? ` · ${match.kickoff}` : ""}`;
  $("#modal-goals").textContent = match.goals ?? "—";
  $("#modal-corners").textContent = match.corners ?? "—";
  $("#modal-note").textContent = state.demo
    ? "Questa è una partita dimostrativa. Non contiene quote, dati reali o pronostici."
    : "Le percentuali sono stime sperimentali e non sono pronostici validati. Le quote sono mostrate solo se importate da una fonte autorizzata.";
  $("#analysis-state").textContent = "Analisi disponibile dopo la sincronizzazione dello storico.";
  $("#analysis-values").hidden = true;
  $("#match-modal").showModal();
  loadMatchAnalysis();
}
async function loadMatches() {
  if (state.loading) return;
  state.loading = true;
  $("#status-note").textContent = "Aggiornamento dei dati in corso…";
  render();
  try {
    const response = await fetch("/api/fixtures", { headers: { accept: "application/json" } });
    if (!response.ok) throw new Error(`Backend HTTP ${response.status}`);
    const payload = await response.json();
    state.source = payload.source ?? "demo";
    state.demo = Boolean(payload.demo);
    state.updatedAt = payload.updatedAt ?? null;
    state.matches = Array.isArray(payload.fixtures) && payload.fixtures.length ? payload.fixtures : DEMO_MATCHES;
    if (!payload.fixtures?.length) state.demo = true;
  } catch {
    state.matches = DEMO_MATCHES;
    state.demo = true;
    state.source = "demo";
    state.updatedAt = null;
  } finally {
    state.loading = false;
    render();
  }
}
document.querySelectorAll(".filter").forEach((button) => button.addEventListener("click", () => {
  document.querySelectorAll(".filter").forEach((item) => item.classList.toggle("active", item === button));
  state.filter = button.dataset.filter;
  render();
}));
$("#matches").addEventListener("click", (event) => {
  const button = event.target.closest("[data-id]");
  if (!button) return;
  const match = state.matches.find((item) => String(item.id) === button.dataset.id);
  if (match) openMatch(match);
});
$("#close-modal").addEventListener("click", () => $("#match-modal").close());
$("#history-count").addEventListener("change", loadMatchAnalysis);
$("#match-modal").addEventListener("click", (event) => {
  if (event.target === $("#match-modal")) $("#match-modal").close();
});
$("#refresh").addEventListener("click", loadMatches);
$("#today").textContent = new Intl.DateTimeFormat("it-IT", {
  day: "2-digit", month: "short", year: "numeric", timeZone: "Europe/Rome",
}).format(new Date()).toUpperCase();
loadMatches();
