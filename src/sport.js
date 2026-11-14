// Stay Live — scelta dello sport. Il calcio (main.js) resta com'è; il tennis è un modulo separato caricato solo su richiesta.
// Un errore nel tennis non può toccare il calcio: il caricamento è dinamico e protetto.
// Il cambio sport avviene dal menu a tendina in alto a destra e mostra un finto caricamento (palla che rimbalza + skeleton).
import "./sport.css";
import "./monitor-tab.js";
import { icon } from "./icons.js";
import { SPORTS, sportMenuHtml } from "./sportmenu.js";

const KEY = "sl-sport";
const body = document.body;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LOADER_MS = 1000;           // durata minima del finto caricamento
let tennis = null;                // controller del tennis (dopo il primo caricamento)
let loadingTennis = null;         // promessa del caricamento in corso
let current = "football";
let switching = false;

const saved = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const mark = (sport) => { try { localStorage.setItem(KEY, sport); } catch { /* modalità privata */ } };

const root = document.createElement("div");
root.id = "tennis-root";
root.hidden = true;
const loader = document.createElement("div");
loader.id = "sport-loader";
loader.setAttribute("aria-hidden", "true");
body.append(root, loader);

/* Menu del calcio: la testata del calcio è in index.html (segnaposto), quella del tennis la crea tennis/app.js. */
const slot = document.querySelector("#sport-slot");
if (slot) slot.innerHTML = sportMenuHtml("football");

/* ---------- Finto caricamento ---------- */
const skeletonRows = (n) => Array.from({ length: n }, () => `<div class="row skel" aria-hidden="true"><i></i><i></i><i></i></div>`).join("");
function showLoader(sport) {
  const header = document.querySelector(body.dataset.sport === "tennis" ? ".tn-top" : ".top");
  loader.style.setProperty("--ld-top", `${Math.max(0, Math.round(header?.getBoundingClientRect().bottom ?? 0))}px`);
  loader.dataset.sport = sport;
  loader.innerHTML = `<div class="ld-stage"><span class="ld-ball">${icon(SPORTS[sport].icon)}</span><span class="ld-shadow"></span></div><div class="ld-skel">${skeletonRows(3)}</div>`;
  void loader.offsetWidth;
  loader.classList.add("on");
}
const hideLoader = () => loader.classList.remove("on");

/* ---------- Viste ---------- */
function showFootball() {
  root.hidden = true;
  tennis?.hide();
  body.dataset.sport = "football";
  document.documentElement.removeAttribute("data-boot");
  current = "football";
}

function mountTennis() {
  if (tennis) return Promise.resolve(true);
  if (loadingTennis) return loadingTennis;
  root.hidden = false;
  root.innerHTML = `<div class="sg-loading"><i class="sg-spin"></i>Caricamento del tennis…</div>`;
  loadingTennis = import("./tennis/app.js").then((mod) => {
    root.innerHTML = "";
    tennis = mod.mountTennis(root);
    return true;
  }).catch((e) => {
    console.error("Tennis non caricato:", e);
    root.innerHTML = `<div class="sg-loading">Impossibile caricare il tennis.<br><button type="button" class="sg-back" data-sport-pick="football">Torna al calcio</button> <button type="button" class="sg-back" data-reload>Riprova</button></div>`;
    return false;
  }).finally(() => { loadingTennis = null; });
  return loadingTennis;
}

async function showTennis() {
  body.dataset.sport = "tennis";
  document.documentElement.removeAttribute("data-boot");
  current = "tennis";
  root.hidden = false;
  if (tennis) tennis.show(); else await mountTennis();
}

async function switchTo(sport) {
  if (switching || sport === current || !SPORTS[sport]) return;
  switching = true;
  mark(sport);
  showLoader(sport);
  try {
    await sleep(380);                               // la palla è già in aria: sotto si cambia vista
    if (sport === "tennis") await showTennis(); else showFootball();
    window.scrollTo({ top: 0 });
    await sleep(Math.max(0, LOADER_MS - 380));
  } finally { hideLoader(); switching = false; }
}

/* ---------- Menu a tendina ---------- */
function closeMenus(except = null) {
  for (const m of document.querySelectorAll("[data-sport-menu].open")) {
    if (m === except) continue;
    m.classList.remove("open");
    m.querySelector("[data-sport-toggle]")?.setAttribute("aria-expanded", "false");
  }
}
document.addEventListener("click", (e) => {
  const t = e.target instanceof Element ? e.target : null;
  if (!t) return;
  const toggle = t.closest("[data-sport-toggle]");
  if (toggle) {
    const menu = toggle.closest("[data-sport-menu]");
    const open = !menu.classList.contains("open");
    closeMenus(open ? menu : null);
    menu.classList.toggle("open", open);
    toggle.setAttribute("aria-expanded", String(open));
    return;
  }
  const pick = t.closest("[data-sport-pick]");
  if (pick) { closeMenus(); void switchTo(pick.dataset.sportPick); return; }
  if (t.closest("[data-reload]")) { void showTennis(); return; }
  if (!t.closest("[data-sport-menu]")) closeMenus();
});
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenus(); });

/* ---------- Apertura: si torna allo sport usato l'ultima volta ---------- */
if (saved() === "tennis") void showTennis(); else showFootball();
