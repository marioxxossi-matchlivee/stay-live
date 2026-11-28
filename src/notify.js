// Stay Live — notifiche sul cambio di pronostico delle giocate salvate (calcio e tennis).
// Le giocate stanno nel telefono (localStorage): qui si legge l'elenco e lo si manda al server, che confronta i pronostici e invia le notifiche push.
import { PLAYS_KEY } from "./plays.js";
import { TPLAYS_KEY } from "./tennis/plays.js";

export const NOTIFY_KEY = "stayLive.notify";
export const NIGHT_KEY = "stayLive.notifyNight";            // notifiche notturne (23:00–07:00): spente di default
const read = (key) => { try { const v = JSON.parse(localStorage.getItem(key) ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; } };

export const supported = () => typeof navigator !== "undefined" && "serviceWorker" in navigator && "PushManager" in globalThis && "Notification" in globalThis;
export const nightEnabled = () => { try { return localStorage.getItem(NIGHT_KEY) === "1"; } catch { return false; } };
export const enabled = () => { try { return supported() && localStorage.getItem(NOTIFY_KEY) === "1" && Notification.permission === "granted"; } catch { return false; } };

/** Giocate da seguire: partite non ancora giocate (calcio: tutte le gambe senza risultato; tennis: giocate senza risultato). Una riga per partita. */
export function collectPicks(now = Date.now(), { football = read(PLAYS_KEY), tennis = read(TPLAYS_KEY) } = {}) {
  const out = [], seen = new Set(), limit = now - 3 * 3600e3;
  const add = (x) => { const k = `${x.sport}:${x.ref}`; if (!x.ref || !x.selection || seen.has(k) || !(Date.parse(x.kickoff) > limit)) return; seen.add(k); out.push(x); };
  for (const p of football) for (const l of p.legs ?? []) if (!l.res) add({ sport: "football", ref: String(l.matchId ?? ""), selection: String(l.key ?? ""), label: l.label ?? "", home: l.home ?? "", away: l.away ?? "", kickoff: l.kickoffAt });
  for (const p of tennis) if (!p.res) add({ sport: "tennis", ref: String(p.matchKey ?? ""), selection: String(p.pick ?? ""), label: (p.pick === 1 ? p.p1?.name : p.p2?.name) ?? "", home: p.p1?.name ?? "", away: p.p2?.name ?? "", kickoff: p.startsAt });
  return out;
}

const b64ToBytes = (s) => { const pad = "=".repeat((4 - (s.length % 4)) % 4), raw = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); };
let lastSig = null;

export async function syncNow(force = false) {
  if (!enabled()) return false;
  const reg = await navigator.serviceWorker.getRegistration("/sw.js") ?? await navigator.serviceWorker.register("/sw.js");
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return false;
  const plays = collectPicks(), night = nightEnabled(), sig = JSON.stringify([night, plays.map((p) => [p.sport, p.ref, p.selection])]);
  if (!force && sig === lastSig) return true;
  const res = await fetch("/api/push", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ subscription: sub.toJSON(), plays, night }) });
  if (res.ok) lastSig = sig;
  return res.ok;
}

export async function enable() {
  if (!supported()) throw new Error("Questo browser non supporta le notifiche. Su iPhone installa prima l'app dalla schermata Home.");
  if ((await Notification.requestPermission()) !== "granted") throw new Error("Permesso negato: abilita le notifiche per Stay Live nelle impostazioni del telefono.");
  const { publicKey } = await (await fetch("/api/push")).json();
  if (!publicKey) throw new Error("Notifiche non ancora configurate sul server (manca la chiave VAPID).");
  const reg = await navigator.serviceWorker.register("/sw.js"); await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription() ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
  localStorage.setItem(NOTIFY_KEY, "1"); lastSig = null;
  if (!(await syncNow(true))) throw new Error("Non riesco a registrare il dispositivo sul server: riprova tra poco.");
  return sub;
}

export async function disable() {
  try {
    const reg = await navigator.serviceWorker.getRegistration("/sw.js"), sub = await reg?.pushManager.getSubscription();
    if (sub) { await fetch("/api/push", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {}); await sub.unsubscribe(); }
  } finally { localStorage.removeItem(NOTIFY_KEY); lastSig = null; }
}

/** Mantiene il server allineato: all'avvio, quando l'app torna visibile e ogni minuto (le giocate salvate cambiano solo nel telefono). */
export function startAutoSync() {
  const tick = () => { if (enabled()) syncNow().catch(() => {}); };
  tick();
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") tick(); });
  setInterval(tick, 60e3);
}

/** Pulsanti nelle Impostazioni (#notify-toggle, #notify-state, #notify-night, #night-state). */
export function initNotifyUi() {
  const btn = document.getElementById("notify-toggle"), st = document.getElementById("notify-state");
  if (!btn) return;
  const paint = (msg = "") => {
    if (!supported()) { btn.disabled = true; btn.textContent = "Non disponibile"; if (st) st.textContent = "Il browser non supporta le notifiche (su iPhone installa l'app dalla schermata Home)."; return; }
    btn.textContent = enabled() ? "Disattiva" : "Attiva";
    if (st) st.textContent = msg || (enabled() ? "Attive: ti avviso se cambia il pronostico di una partita salvata nelle Giocate." : "Disattivate.");
  };
  const nb = document.getElementById("notify-night"), ns = document.getElementById("night-state");
  const paintNight = () => { if (!nb) return; nb.disabled = !enabled(); nb.textContent = nightEnabled() ? "Disattiva" : "Attiva"; if (ns) ns.textContent = nightEnabled() ? "Attive: ricevi avvisi anche tra le 23:00 e le 07:00." : "Disattivate: di notte non ti disturbo, avviso dopo le 07:00."; };
  nb?.addEventListener("click", async () => { try { if (nightEnabled()) localStorage.removeItem(NIGHT_KEY); else localStorage.setItem(NIGHT_KEY, "1"); await syncNow(true); } catch { /* si riprova al prossimo giro */ } paintNight(); });
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try { if (enabled()) await disable(); else await enable(); paint(); } catch (e) { paint(e.message); } finally { btn.disabled = false; paintNight(); }
  });
  paint(); paintNight();
}
