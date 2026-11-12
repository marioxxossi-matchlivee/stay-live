// Collega la scheda «Affidabilità» alla barra del calcio senza toccare main.js: main.js nasconde le sue viste, qui si mostra/nasconde la nostra.
const tabbar = document.querySelector(".tabbar");
const view = document.querySelector("#view-reliability");
let ctl = null, loading = false;

async function open() {
  if (!view) return;
  view.hidden = false;
  if (ctl) return void ctl.reload();
  if (loading) return;
  loading = true;
  try {
    const mod = await import("./monitor.js");
    ctl = mod.mountMonitor(view.querySelector("#rel-root"));
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
