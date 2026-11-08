/**
 * Gesture: swipe orizzontale su una riga (seleziona/deseleziona) e trascinamento per riordinare una lista (touch, mouse e tastiera).
 * Le funzioni pure (swipeIntent, reorder, orderBy) sono testate; il resto lavora sul DOM con i Pointer Events.
 */
export const SWIPE = { min: 64, ratio: 1.6 };

/** "right" | "left" | null: swipe orizzontale riconosciuto solo se abbastanza lungo e nettamente più orizzontale che verticale. */
export function swipeIntent(dx, dy, { min = SWIPE.min, ratio = SWIPE.ratio } = {}) {
  if (Math.abs(dx) < min || Math.abs(dx) < Math.abs(dy) * ratio) return null;
  return dx > 0 ? "right" : "left";
}

/** Nuova lista con l'elemento in posizione `from` spostato in `to` (indici limitati ai bordi). Non modifica l'originale. */
export function reorder(list, from, to) {
  const out = [...list];
  if (from < 0 || from >= out.length) return out;
  const [x] = out.splice(from, 1);
  out.splice(Math.max(0, Math.min(out.length, to)), 0, x);
  return out;
}

/** Ordina `list` secondo `ids` (chiave = key(item)); gli elementi non citati restano in coda nel loro ordine. */
export function orderBy(list, ids, key = (x) => x.id) {
  const pos = new Map(ids.map((id, i) => [id, i]));
  return [...list].sort((a, b) => (pos.get(key(a)) ?? Infinity) - (pos.get(key(b)) ?? Infinity) || list.indexOf(a) - list.indexOf(b));
}

/**
 * Swipe sulle righe di `root` (solo touch/penna: col mouse si usa la casella). onSwipe(row, "right"|"left").
 * La riga segue il dito (--dx) e si colora quando il gesto è valido. Dopo uno swipe il click successivo viene ignorato.
 */
export function enableSwipe(root, { rowSel, canSwipe = () => true, onSwipe }) {
  let row = null, x0 = 0, y0 = 0, id = null, active = false, lastSwipe = 0;
  const clear = () => { if (row) { row.classList.remove("swiping", "swipe-ready"); row.style.removeProperty("--dx"); } row = null; active = false; };
  root.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" || !e.isPrimary) return;
    const r = e.target.closest(rowSel);
    if (!r || !canSwipe(r) || e.target.closest("input,select,a,.row-save")) return;
    row = r; x0 = e.clientX; y0 = e.clientY; id = e.pointerId; active = false;
  });
  root.addEventListener("pointermove", (e) => {
    if (!row || e.pointerId !== id) return;
    const dx = e.clientX - x0, dy = e.clientY - y0;
    if (!active) { if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx)) { clear(); return; } if (Math.abs(dx) > 10 && Math.abs(dx) > Math.abs(dy)) active = true; }
    if (!active) return;
    row.classList.add("swiping");
    row.style.setProperty("--dx", `${Math.max(-110, Math.min(110, dx * 0.6))}px`);
    row.classList.toggle("swipe-ready", swipeIntent(dx, dy) !== null);
  });
  const end = (e) => {
    if (!row || e.pointerId !== id) return;
    const dir = e.type === "pointerup" && active ? swipeIntent(e.clientX - x0, e.clientY - y0) : null, r = row;
    clear();
    if (active) lastSwipe = Date.now();
    if (dir) onSwipe(r, dir);
  };
  root.addEventListener("pointerup", end); root.addEventListener("pointercancel", end);
  root.addEventListener("click", (e) => { if (Date.now() - lastSwipe < 400) { e.stopPropagation(); e.preventDefault(); } }, true);
}

/**
 * Riordino per trascinamento (maniglia) o tastiera (frecce su/giù sulla maniglia) degli elementi figli diretti di `container`.
 * itemSel = elementi spostabili, handleSel = maniglia dentro l'elemento, idOf(el) = id, onDone(ids) a fine spostamento.
 */
export function enableReorder(container, { itemSel, handleSel, idOf, onDone }) {
  const items = () => [...container.children].filter((c) => c.matches(itemSel));
  const ids = () => items().map(idOf);
  let item = null, grab = 0, pid = null;
  const place = (y) => {
    item.style.transform = "";
    const h = item.offsetHeight;
    let top = y - grab;
    for (let moved = true; moved;) {
      moved = false;
      const prev = item.previousElementSibling, next = item.nextElementSibling;
      const mid = (el) => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; };
      if (prev?.matches(itemSel) && top + h / 2 < mid(prev)) { container.insertBefore(item, prev); moved = true; }
      else if (next?.matches(itemSel) && top + h / 2 > mid(next)) { container.insertBefore(item, next.nextElementSibling); moved = true; }
      if (moved) item.style.transform = "";
    }
    const now = item.getBoundingClientRect().top;
    item.style.transform = `translateY(${top - now}px)`;
  };
  container.addEventListener("pointerdown", (e) => {
    const h = e.target.closest(handleSel);
    if (!h || !container.contains(h) || !e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
    item = h.closest(itemSel); if (!item) return;
    pid = e.pointerId; grab = e.clientY - item.getBoundingClientRect().top;
    h.setPointerCapture?.(pid); item.classList.add("dragging"); e.preventDefault();
  });
  container.addEventListener("pointermove", (e) => { if (item && e.pointerId === pid) place(e.clientY); });
  const stop = (e) => {
    if (!item || e.pointerId !== pid) return;
    const el = item; item = null; pid = null;
    el.classList.remove("dragging"); el.style.transform = "";
    onDone(ids());
  };
  container.addEventListener("pointerup", stop); container.addEventListener("pointercancel", stop);
  container.addEventListener("keydown", (e) => {
    const h = e.target.closest(handleSel);
    if (!h || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    const el = h.closest(itemSel), sib = e.key === "ArrowUp" ? el.previousElementSibling : el.nextElementSibling;
    if (!el || !sib?.matches(itemSel)) return;
    e.preventDefault();
    container.insertBefore(el, e.key === "ArrowUp" ? sib : sib.nextElementSibling);
    el.querySelector(handleSel)?.focus(); onDone(ids());
  });
}
