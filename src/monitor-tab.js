// Collega la scheda «Affidabilità» alla barra del calcio senza toccare main.js: main.js nasconde le sue viste, qui si mostra/nasconde la nostra.
const tabbar = document.querySelector(".tabbar");
const view = document.querySelector("#view-reliability");
let ctl = null, lrCtl = null, loading = false;

async function open() {
  if (!view) return;
  view.hidden = false;
  if (ctl) { void lrCtl?.reload(); return void ctl.reload(); }
  if (loading) return;
  loading = true;
  try {
    const mod = await import("./monitor.js");
    ctl = mod.mountMonitor(view.querySelector("#rel-root"));
    // Campionati con la percentuale di affidabilità più alta in ogni mercato: sotto il monitor, sopra la sezione di osservazione.
    try {
      const [lr, fmt] = await Promise.all([import("./leaguereliability.js"), import("./format.js")]);
      let lrHost = view.querySelector("#lr-root");
      if (!lrHost) { lrHost = document.createElement("div"); lrHost.id = "lr-root"; view.querySelector("#rel-root").after(lrHost); }
      lrCtl = lr.mountLeagueReliability(lrHost, { esc: fmt.esc, pct: fmt.pct, leagueName: globalThis.stayLiveLeagueName ?? ((id) => id) });
    } catch (e) { console.error("Affidabilità per campionato non caricata:", e); }
    // CONTINUOUS LEARNING (sola osservazione): sezione autonoma sotto il monitor del calcio; se non carica, il monitor resta com'è.
    try { const learn = await import("./learning/mount.js"); let host = view.querySelector("#cl-root"); if (!host) { host = document.createElement("div"); host.id = "cl-root"; view.append(host); } learn.mountLearning(host, { sport: "football" }); } catch (e) { console.warn("CONTINUOUS LEARNING non caricato:", e); }
  } catch (e) {
    console.error("Affidabilità non caricata:", e);
    view.querySelector("#rel-root").innerHTML = `<p style="padding:24px;text-align:center;color:var(--mute)">Impossibile caricare la sezione. Riprova più tardi: il resto dell'app funziona.</p>`;
  } finally { loading = false; }
}

tabbar?.addEventListener("click", (e) => {
  const b = e.target instanceof Element ? e.target.closest(".tab-item") : null;
  if (!b || !view) return;
  if (b.dataset.view === "reliability") void open();   // main.js ha già nascosto le sue viste
  else view.hidden = true;                              // si torna a una vista del calcio
});
// Collegamenti interni che aprono altre viste (data-goto) chiudono la nostra.
document.addEventListener("click", (e) => { if (e.target instanceof Element && e.target.closest("[data-goto]") && view) view.hidden = true; });
