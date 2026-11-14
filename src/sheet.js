// Fogli a scorrimento dal basso (dettaglio, preview): chiusura animata, Esc, tocco sullo sfondo e trascinamento verso il basso.
// Il trascinamento parte dalla maniglia o da qualsiasi punto del foglio quando il contenuto è già in cima.
const reduce = () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

export const SHEET_CLOSE_DISTANCE = 110;   // px trascinati oltre i quali il foglio si chiude
export const SHEET_CLOSE_SPEED = 0.6;      // px/ms: un colpo veloce chiude anche con poca distanza

/** true se il gesto deve chiudere il foglio: abbastanza lungo oppure abbastanza veloce. Funzione pura. */
export const shouldClose = (dy, speed) => dy > SHEET_CLOSE_DISTANCE || (dy > 24 && speed > SHEET_CLOSE_SPEED);

export function closeSheet(d) {
  if (!d?.open || d.classList.contains("closing")) return;
  if (reduce()) { d.style.removeProperty("--sheet-dy"); d.close(); return; }
  d.classList.add("closing");
  let done = false;
  const fin = () => { if (done) return; done = true; d.classList.remove("closing"); d.style.removeProperty("--sheet-dy"); d.close(); };
  d.addEventListener("animationend", (e) => { if (e.target === d) fin(); });
  setTimeout(fin, 360);
}

/** Primo elemento scorrevole tra `target` e il foglio (o null). */
function scroller(d, target) {
  for (let el = target instanceof Element ? target : null; el && el !== d; el = el.parentElement) {
    if (el.scrollHeight > el.clientHeight + 1 && /(auto|scroll)/.test(getComputedStyle(el).overflowY)) return el;
  }
  return d.scrollHeight > d.clientHeight + 1 ? d : null;
}

export function enableSheet(d) {
  if (!d || d.dataset.sheet) return;
  d.dataset.sheet = "1";
  d.addEventListener("cancel", (e) => { e.preventDefault(); closeSheet(d); });
  d.addEventListener("click", (e) => { if (e.target === d) closeSheet(d); });          // tocco sullo sfondo
  d.addEventListener("click", (e) => { if (e.target instanceof Element && e.target.closest("[data-close]")) closeSheet(d); });

  let y0 = 0, x0 = 0, dy = 0, lastY = 0, lastT = 0, speed = 0, armed = false, drag = false;
  const move = (y) => { dy = Math.max(0, y - y0); d.style.setProperty("--sheet-dy", `${dy}px`); const now = performance.now(); speed = (y - lastY) / Math.max(1, now - lastT); lastY = y; lastT = now; };
  const finish = () => {
    if (!drag) { armed = false; return; }
    drag = false; armed = false; d.classList.remove("sheet-drag"); d.style.transition = "";
    if (shouldClose(dy, speed)) closeSheet(d); else d.style.removeProperty("--sheet-dy");
  };

  // Touch: dalla maniglia o dal contenuto già in cima. Il movimento verso il basso sposta il foglio, quello verso l'alto scorre il contenuto.
  d.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) return;
    const t = e.touches[0], sc = scroller(d, e.target);
    y0 = lastY = t.clientY; x0 = t.clientX; dy = 0; speed = 0; lastT = performance.now(); drag = false;
    armed = Boolean(e.target.closest?.(".grab")) || !sc || sc.scrollTop <= 0;
  }, { passive: true });
  d.addEventListener("touchmove", (e) => {
    if (!armed) return;
    const t = e.touches[0], ddy = t.clientY - y0, ddx = t.clientX - x0;
    if (!drag) {
      if (ddy < -8) { armed = false; return; }
      if (ddy < 8 || ddy < Math.abs(ddx) * 1.2) return;
      const sc = scroller(d, e.target);
      if (sc && sc.scrollTop > 0 && !e.target.closest?.(".grab")) { armed = false; return; }
      drag = true; d.classList.add("sheet-drag"); d.style.transition = "none"; y0 = t.clientY - ddy;
    }
    if (e.cancelable) e.preventDefault();
    move(t.clientY);
  }, { passive: false });
  d.addEventListener("touchend", finish);
  d.addEventListener("touchcancel", finish);

  // Mouse e penna: solo dalla maniglia.
  const g = d.querySelector(".grab");
  if (g) {
    let pid = null;
    g.addEventListener("pointerdown", (e) => { if (e.pointerType === "touch") return; pid = e.pointerId; y0 = lastY = e.clientY; dy = 0; speed = 0; lastT = performance.now(); drag = true; g.setPointerCapture?.(pid); d.classList.add("sheet-drag"); d.style.transition = "none"; });
    g.addEventListener("pointermove", (e) => { if (pid === e.pointerId && drag) move(e.clientY); });
    const end = (e) => { if (pid !== e.pointerId) return; pid = null; finish(); };
    g.addEventListener("pointerup", end); g.addEventListener("pointercancel", end);
  }
}
