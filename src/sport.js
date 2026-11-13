// Stay Live — scelta dello sport. Il calcio (main.js) resta com'è; il tennis è un modulo separato caricato solo su richiesta.
// Un errore nel tennis non può toccare il calcio: il caricamento è dinamico e protetto.
import "./sport.css";
import "./monitor-tab.js";
import { icon, markSvg } from "./icons.js";

const KEY = "sl-sport";
const body = document.body;
let tennis = null;       // controller del tennis (dopo il primo caricamento)
let loadingTennis = false;

const mark = (sport) => { try { sessionStorage.setItem(KEY, sport); } catch { /* modalità privata */ } };
const saved = () => { try { return sessionStorage.getItem(KEY); } catch { return null; } };

const gate = document.createElement("div");
gate.id = "sport-gate";
gate.hidden = true;
gate.innerHTML = `
  <div class="sg-inner">
    ${markSvg("sg-mark")}
    <h1>Stay<span>Live</span></h1>
    <p>Scegli lo sport. Puoi cambiare in qualsiasi momento.</p>
    <div class="sg-cards">
      <button type="button" class="sg-card football" data-sport="football"><span class="sg-ico" aria-hidden="true">${icon("soccer-ball")}</span><b>Stay Live Calcio</b><small>Probabilità, BET o EVITA e preview di giornata</small><span class="sg-go" aria-hidden="true">${icon("caret-right")}</span></button>
      <button type="button" class="sg-card tennis" data-sport="tennis"><span class="sg-ico" aria-hidden="true">${icon("tennis-ball")}</span><b>Stay Live Tennis</b><small>Pronostico del vincitore, ATP e WTA</small><span class="sg-go" aria-hidden="true">${icon("caret-right")}</span></button>
    </div>
  </div>`;
const root = document.createElement("div");
root.id = "tennis-root";
root.hidden = true;
body.append(gate, root);

function showGate() {
  body.dataset.sport = "gate";
  document.documentElement.removeAttribute("data-gate");
  gate.hidden = false;
  tennis?.hide();
  root.hidden = true;
  gate.querySelector(".sg-card")?.focus({ preventScroll: true });
}

async function showTennis() {
  gate.hidden = true;
  body.dataset.sport = "tennis";
  document.documentElement.removeAttribute("data-gate");
  root.hidden = false;
  if (tennis) return tennis.show();
  if (loadingTennis) return;
  loadingTennis = true;
  root.innerHTML = `<div class="sg-loading"><i class="sg-spin"></i>Caricamento del tennis…</div>`;
  try {
    const mod = await import("./tennis/app.js");
    root.innerHTML = "";
    tennis = mod.mountTennis(root, { onSwitch: showGate });
  } catch (e) {
    console.error("Tennis non caricato:", e);
    root.innerHTML = `<div class="sg-loading">Impossibile caricare il tennis.<br><button type="button" class="sg-back" data-sport="football">Torna al calcio</button> <button type="button" class="sg-back" data-reload>Riprova</button></div>`;
  } finally { loadingTennis = false; }
}

function showFootball() {
  gate.hidden = true;
  root.hidden = true;
  tennis?.hide();
  body.dataset.sport = "football";
  document.documentElement.removeAttribute("data-gate");
}

function choose(sport) {
  if (sport === "tennis") { mark("tennis"); void showTennis(); }
  else { mark("football"); showFootball(); }
}

document.addEventListener("click", (e) => {
  const t = e.target instanceof Element ? e.target : null;
  if (!t) return;
  const pick = t.closest("[data-sport]");
  if (pick && (gate.contains(pick) || root.contains(pick))) return choose(pick.dataset.sport);
  if (t.closest("[data-reload]")) { loadingTennis = false; void showTennis(); return; }
  if (t.closest("#sport-switch")) showGate();
});

// All'apertura: scelta sempre; dentro la stessa sessione (ricaricamenti) si torna allo sport scelto.
const s = saved();
if (s === "tennis") choose("tennis");
else if (s === "football") choose("football");
else showGate();
