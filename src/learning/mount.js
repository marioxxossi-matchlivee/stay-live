// Stay Live — CONTINUOUS LEARNING: montaggio autonomo della sezione (stato proprio, nessun legame con lo stato dell'app ospite).
// Legge SOLO /learning/report.json (file statico prodotto dallo script di diagnostica). Nessuna scrittura, nessuna API operativa.
import "./learning.css";
import { learningHtml, TABS } from "./view.js";

export const REPORT_URL = "/learning/report.json";
const S = { open: false, tab: "overview", filter: "all", report: null, loading: false, error: null, el: null, sport: null };

async function load() {
  if (S.loading) return; S.loading = true; S.error = null; draw();
  try {
    const res = await fetch(`${REPORT_URL}?t=${Math.floor(Date.now() / 6e5)}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`risposta ${res.status}`);
    const text = await res.text(); let json; try { json = JSON.parse(text); } catch { throw new Error("il file del report non è valido"); }
    if (!json || typeof json !== "object" || json.schema !== "learning-report-v1") throw new Error("formato del report non riconosciuto");
    S.report = json;
  } catch (e) { S.error = String(e?.message ?? e); }
  finally { S.loading = false; draw(); }
}
function draw() { if (S.el?.isConnected) S.el.innerHTML = learningHtml(S); }
function onClick(e) {
  const t = e.target instanceof Element ? e.target : null; if (!t) return;
  if (t.closest("[data-cl-toggle]")) { S.open = !S.open; draw(); if (S.open && !S.report && !S.loading) void load(); return; }
  const tab = t.closest("[data-cl-tab]"); if (tab && TABS.some(([k]) => k === tab.dataset.clTab)) { S.tab = tab.dataset.clTab; draw(); return; }
  const f = t.closest("[data-cl-filter]"); if (f) { S.filter = f.dataset.clFilter; draw(); }
}
/** Monta la sezione in `el`. `sport` ("tennis" | "football") sceglie la scheda iniziale al primo montaggio. */
export function mountLearning(el, { sport } = {}) {
  if (!el) return;
  if (S.sport == null && (sport === "tennis" || sport === "football")) S.tab = "overview";
  S.sport = sport ?? S.sport; S.el = el; el.onclick = onClick; draw();
  if (S.open && !S.report && !S.loading && !S.error) void load();
}
