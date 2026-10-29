export const TZ = "Europe/Rome";
export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
export const pct = (p, d = 0) => (p == null ? "—" : `${(p * 100).toFixed(d).replace(".", ",")}%`);
export const num = (v, d = 2) => (v == null || !Number.isFinite(Number(v)) ? "—" : Number(v).toFixed(d).replace(".", ","));
export const fmtTime = new Intl.DateTimeFormat("it-IT", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
export const fmtDay = new Intl.DateTimeFormat("en-CA", { timeZone: TZ });
export const dayKey = (iso) => fmtDay.format(new Date(iso));
export const dayParts = (key) => {
  const d = new Date(`${key}T12:00:00Z`);
  return {
    wd: new Intl.DateTimeFormat("it-IT", { weekday: "short", timeZone: "UTC" }).format(d).replace(".", ""),
    dm: new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short", timeZone: "UTC" }).format(d).replace(".", ""),
    long: new Intl.DateTimeFormat("it-IT", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(d),
  };
};

export const eur = (v) => (v == null || !Number.isFinite(Number(v)) ? "—" : `${Number(v).toFixed(2).replace(".", ",")} €`);
