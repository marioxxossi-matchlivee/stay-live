// Sezione «Affidabilità» del calcio: caricamento dei dati e interazione. L'HTML è in monitor-view.js (testabile senza browser).
import "./monitor.css";
import { esc } from "./format.js";
import { modelMonitorHtml } from "./monitor-view.js";

const REFRESH_MS = 60e3;   // mentre la scheda è aperta e visibile, i numeri si aggiornano ogni minuto

export function mountMonitor(root) {
  const st = { data: null, loading: false, at: 0 };
  const head = `<section class="mn-intro"><h1>Affidabilità</h1><p>Come sta andando il modello su 1X2, doppia chance e Multigol: Brier e log loss delle ultime 48 ore e da quando è attivo. Con pochi casi non si conclude nulla.</p></section>`;
  const paint = (body) => { root.innerHTML = head + body; };
  const render = () => paint(st.data ? `<p class="mn-note mn-upd">Aggiornato alle ${new Date(st.at).toLocaleTimeString("it-IT", { timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit" })}</p>${modelMonitorHtml(st.data)}` : `<p class="mn-loading">Caricamento…</p>`);
  async function load({ quiet = false } = {}) {
    if (st.loading) return; st.loading = true;
    try {
      const res = await fetch("/api/monitor", { headers: { accept: "application/json" } });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.families) throw new Error(body?.error ?? `Risposta ${res.status}`);
      st.data = body; st.at = Date.now(); render();
    } catch (e) {
      if (!quiet || !st.data) paint(`<div class="mn-emptybox"><h3>Impossibile caricare l'affidabilità</h3><p>${esc(String(e?.message ?? e))}</p><button type="button" class="mn-retry" data-retry>Riprova</button></div>`);
    } finally { st.loading = false; }
  }
  root.addEventListener("click", (e) => {
    const t = e.target instanceof Element ? e.target : null; if (!t) return;
    if (t.closest("[data-retry]")) { st.data = null; render(); void load(); }
  });
  setInterval(() => { if (document.visibilityState === "visible" && root.isConnected && !root.closest("[hidden]")) void load({ quiet: true }); }, REFRESH_MS);
  render(); void load();
  return { reload: () => load({ quiet: Boolean(st.data) }) };
}
