// Sezione «Affidabilità»: caricamento dei dati e interazione. L'HTML è in monitor-view.js (testabile senza browser).
import "./monitor.css";
import { esc } from "./format.js";
import { monitorHtml } from "./monitor-view.js";

export function mountMonitor(root) {
  const st = { data: null, tab: "live", loading: false };
  const head = `<section class="mn-intro"><h1>Affidabilità</h1><p>Quanto sono credibili BET ed EVITA. Ogni numero ha la sua incertezza: con pochi casi non si conclude nulla.</p></section>`;
  const paint = (body) => { root.innerHTML = head + body; };
  const render = () => paint(st.data ? monitorHtml(st.data, st.tab) : `<p class="mn-loading">Caricamento…</p>`);
  async function load() {
    if (st.loading) return; st.loading = true;
    try {
      const res = await fetch("/api/monitor", { headers: { accept: "application/json" } });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.picks) throw new Error(body?.error ?? `Risposta ${res.status}`);
      st.data = body; render();
    } catch (e) { paint(`<div class="mn-emptybox"><h3>Impossibile caricare l'affidabilità</h3><p>${esc(String(e?.message ?? e))}</p><button type="button" class="mn-retry" data-retry>Riprova</button></div>`); }
    finally { st.loading = false; }
  }
  root.addEventListener("click", (e) => {
    const t = e.target instanceof Element ? e.target : null; if (!t) return;
    const tab = t.closest("[data-mn]"); if (tab) { st.tab = tab.dataset.mn; return render(); }
    if (t.closest("[data-retry]")) { st.data = null; render(); void load(); }
  });
  render(); void load();
  return { reload: () => { st.data = null; render(); return load(); } };
}
