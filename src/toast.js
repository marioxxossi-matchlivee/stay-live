/**
 * Messaggio breve di feedback (salvata, eliminata con "Annulla", copiato, errore). Uno solo alla volta.
 * Usa un popover manuale (livello superiore del browser) così resta visibile anche sopra i fogli (<dialog>).
 */
let el = null, timer = null;

export function hideToast() { clearTimeout(timer); el?.classList.remove("show"); }

export function showToast(message, { action = "", onAction = null, ms = 5000 } = {}) {
  if (typeof document === "undefined") return;
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    el.setAttribute("role", "status");
    el.setAttribute("aria-live", "polite");
    el.setAttribute("popover", "manual");
    document.body.append(el);
  }
  clearTimeout(timer);
  el.textContent = "";
  const text = document.createElement("span");
  text.textContent = message;
  el.append(text);
  if (action) {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = action;
    b.addEventListener("click", () => { hideToast(); onAction?.(); }, { once: true });
    el.append(b);
  }
  try { el.hidePopover?.(); el.showPopover?.(); } catch { /* senza popover resta un elemento fisso */ }
  el.classList.remove("show"); void el.offsetWidth; el.classList.add("show");
  timer = setTimeout(hideToast, ms);
}
