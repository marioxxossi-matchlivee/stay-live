/**
 * Scheda partita del calcio: tutti i mercati in un solo posto (1X2, Gol, Over/Under, Corner), con stato, affidabilità e motivazione.
 * Funzioni pure: leggono SOLO i dati già calcolati dal motore (`match.mk`, `match.corner`, `match.cornerModel`, `payload.rules`).
 * Nessuna probabilità viene calcolata o inventata qui; se un dato manca, il mercato è «non disponibile».
 *
 * Stati di un esito (distinzione visiva):
 *   bet         = verdetto BET del motore (stesse regole di «Solo BET»)
 *   interesting = probabilità >= soglia scelta dall'utente, non contraddetta da API-Football, non troppo scontata
 *   analysed    = tutto il resto
 * Affidabilità (alta / media / bassa): campione di partite + accordo tra le fonti − incertezza (distanza tra probabilità e prudente).
 */
import { esc, num, pct } from "./format.js";
import { icon } from "./icons.js";
import { SHORT_PICK } from "./pickview.js";

export const THR_DEFAULT = 0.6;
const MARKET_GROUPS = [
  { id: "esito", label: "1X2", keys: ["home", "draw", "away"] },
  { id: "gol", label: "Gol", keys: ["btts", "nobtts"] },
  { id: "ou", label: "Over/Under", keys: ["over05", "over15", "under15", "over25", "under25", "over35", "under35"] },
];
const DC = { id: "dc", label: "Doppia chance", keys: ["dc1x", "dcx2", "dc12"] };
const RULES = { thr: 0.6, maxUseful: 0.8, minEdge: 0.08, minPlay: 1.3, betSample: 5, margin: 1.03 };
const sign = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(Math.round(v * 100))}`;

/* ---------- Stato e affidabilità ---------- */
export function statusOf(x, thr = THR_DEFAULT, rules = RULES) {
  if (!x) return "none";
  if (x.v) return "bet";
  return x.p >= thr && x.g >= 0 && (x.o || x.p <= rules.maxUseful) ? "interesting" : "analysed";
}
export function reliabilityOf(x, mk) {
  if (!x || !mk) return null;
  const conf = mk.c === "buona" ? 2 : mk.c === "media" ? 1 : 0;
  const score = conf + (x.g === 1 ? 1 : 0) - (x.g === -1 ? 2 : 0) - ((x.sp ?? 0) >= 0.12 || x.p - x.l > 0.12 ? 1 : 0);
  return score >= 3 ? "alta" : score >= 1 ? "media" : "bassa";
}
export const STATUS_LABEL = { bet: "BET", interesting: "Interessante", analysed: "" };

/* ---------- Corner: quote dei bookmaker (se scaricate) e modello Stay Live (non tarato, mai BET) ---------- */
const sideName = (s) => (s === "over" ? "Over" : "Under");
export function cornerView(m, thr = THR_DEFAULT, rules = RULES, cornerOverride = null) {
  const market = cornerOverride ?? m.corner ?? null, model = m.cornerModel?.ok ? m.cornerModel : null;
  const mk = market?.best ? { source: "market", side: market.best.side, line: market.best.line, p: market.best.p, odd: market.best.odd ?? null } : null;
  let md = null;
  if (model) {
    const lines = model.lines, at = Math.max(0, lines.findIndex((l) => l.line === model.mainLine));
    const opts = lines.slice(Math.max(0, at - 1), at + 2).flatMap((l) => [{ side: "over", line: l.line, p: l.over }, { side: "under", line: l.line, p: l.under }]);
    const useful = opts.filter((o) => o.p <= rules.maxUseful).sort((a, b) => b.p - a.p);
    const best = useful[0] ?? [...opts].sort((a, b) => b.p - a.p)[0];
    if (best) md = { source: "model", ...best, others: opts.filter((o) => o !== best && o.side === best.side).sort((a, b) => b.p - a.p).slice(0, 2) };
  }
  const main = mk ?? md;
  if (!main) return { state: "none", why: m.cornerState === "none" || m.cornerState === "missing" ? "nessuna quota e nessun dato storico" : "dati non ancora disponibili" };
  const status = main.p >= thr && main.p <= rules.maxUseful ? "interesting" : "analysed";
  return { state: main.source, main, market: mk, model: md, status, reliability: main.source === "market" ? "media" : "bassa", note: main.source === "market" ? "Probabilità dalle quote dei bookmaker (margine tolto)." : "Modello Stay Live sui corner storici reali: non ancora tarato, non è un BET.", raw: { market, model } };
}

/* ---------- Motivazioni: solo da dati realmente usati dal motore ---------- */
const f1 = (v) => num(v, 1), f2 = (v) => num(v, 2);
const GOAL_KEYS = /^(over|under|btts|nobtts)/;

/** Una frase specifica per la partita. Stringa vuota se mancano i dati (mai testo generico inventato). */
export function motivationOf(m, key) {
  const mk = m.mk, st = mk?.st, x = mk?.x?.[key];
  if (!st || !x) return "";
  const H = m.home, A = m.away, bits = [];
  const haveForm = st.h?.n >= 1 && st.a?.n >= 1 && st.h.gf != null && st.a.gf != null;
  if (GOAL_KEYS.test(key)) {
    const line = key.startsWith("over") || key.startsWith("under") ? Number(key.slice(-2)) / 10 : null;
    bits.push(`gol attesi ${f1(st.tot)} (${esc(H)} ${f1(st.lh)}, ${esc(A)} ${f1(st.la)})${st.lg ? ` contro una media di ${f1(st.lg)} nel campionato` : ""}`);
    if (line != null && Math.abs(st.tot - line) < 0.4) bits.push("vicini alla soglia: esito meno netto");
    if (haveForm) bits.push(`${esc(H)} segna ${f1(st.h.gf)} e subisce ${f1(st.h.ga)} a gara, ${esc(A)} ${f1(st.a.gf)} e ${f1(st.a.ga)}`);
    if (key === "btts" || key === "nobtts") bits.push(Math.min(st.lh, st.la) >= 1 ? "entrambe hanno almeno un gol atteso" : `una squadra ha solo ${f1(Math.min(st.lh, st.la))} gol attesi`);
  } else {
    bits.push(`gol attesi ${esc(H)} ${f1(st.lh)} contro ${esc(A)} ${f1(st.la)}`);
    if (st.h?.f && st.a?.f) bits.push(`forma recente (dalla più recente): ${esc(H)} ${esc(st.h.f)}, ${esc(A)} ${esc(st.a.f)}`);
    if (haveForm) bits.push(`${esc(H)} segna ${f1(st.h.gf)} e subisce ${f1(st.h.ga)} a gara, ${esc(A)} ${f1(st.a.gf)} e ${f1(st.a.ga)}`);
  }
  if (x.g === 1) bits.push("API-Football conferma");
  else if (x.g === -1) bits.push("API-Football non è d'accordo");
  return `${bits.join(". ")}.`;
}

/** Motivazione dei corner (modello: dati reali delle ultime partite; mercato: quote). */
export function cornerMotivation(m, cv) {
  const mod = cv.raw?.model ? m.cornerModel : null;
  if (cv.state === "market") return `Quote dei bookmaker${cv.raw.market.favorite?.books ? ` (${cv.raw.market.favorite.books} bookmaker)` : ""}: ${sideName(cv.main.side)} ${num(cv.main.line, 1)} corner${cv.main.odd ? `, quota ${num(cv.main.odd)}` : ""}.`;
  if (!mod) return "";
  return `Corner attesi ${f1(mod.lambda.total)} (${esc(m.home)} ${f1(mod.lambda.home)}, ${esc(m.away)} ${f1(mod.lambda.away)}) su ${mod.sample.home} e ${mod.sample.away} partite con dati reali; modello non ancora tarato.`;
}

/** Perché un esito NON è il più interessante: dal codice del verdetto del motore, con i suoi numeri. */
export function whyNot(key, x, mk, rules = RULES) {
  if (!x) return "";
  if (x.v) return "BET: supera le regole del motore";
  if (!x.o && x.p > rules.maxUseful) return `troppo probabile (${pct(x.p)}): la quota equa sarebbe sotto 1,25`;
  const e = x.e == null ? "" : ` (${sign(x.e)} punti sulla media del campionato)`;
  switch (x.c) {
    case "S": return `campione troppo piccolo (${mk.s} gare, ne servono ${rules.betSample})`;
    case "A": return "API-Football non conferma questo esito";
    case "Q": return `quota sotto il minimo di ${num(rules.minPlay)}`;
    case "L": return "probabilità prudente troppo bassa";
    case "E": return "la quota reale non lascia valore";
    case "R": return "quota reale non disponibile: il valore non si può verificare";
    case "T": return `probabilità prudente ${pct(x.l)}, sotto la soglia del ${pct(rules.thr)}`;
    case "M": return `esito probabile ma in linea con la media del campionato${e}`;
    default: return "";
  }
}

/* ---------- HTML ---------- */
const optLabel = (k) => SHORT_PICK[k] ?? k;
const tag = (status) => (status === "bet" ? `<b class="mk-tag bet">${icon("check")}BET</b>` : status === "interesting" ? `<b class="mk-tag int">Interessante</b>` : "");
const bestOf = (mk, g) => mk.b?.[g] ?? null;

function groupRow(m, g, opts) {
  const { thr, rules } = opts, mk = m.mk, key = bestOf(mk, g.id), x = key ? mk.x[key] : null;
  if (!x) return `<div class="mk none"><span class="mk-name">${g.label}</span><span class="mk-na">non disponibile</span></div>`;
  const st = statusOf(x, thr, rules);
  const rest = g.keys.filter((k) => k !== key && mk.x[k]);
  // Over/under: accanto all'esito scelto, gli altri lati favoriti (Over 0,5 è quasi sempre scontato e sta solo nel dettaglio).
  const near = g.id === "ou" ? rest.filter((k) => k !== "over05" && mk.x[k].p >= 0.5).sort((a, b) => mk.x[b].p - mk.x[a].p).slice(0, 2) : rest;
  return `<div class="mk ${st}" data-g="${g.id}"><span class="mk-name">${g.label}</span><span class="mk-pick"><b>${esc(optLabel(key))}</b><em>${pct(x.p)}</em></span><span class="mk-rest">${near.map((k) => `${esc(optLabel(k))} ${pct(mk.x[k].p)}`).join(" · ")}</span>${tag(st)}</div>`;
}
function cornerRow(m, cv) {
  if (cv.state === "none") return `<div class="mk none"><span class="mk-name">Corner</span><span class="mk-na">${esc(cv.why)}</span></div>`;
  const c = cv.main, rest = c.others?.map((o) => `${sideName(o.side)} ${num(o.line, 1)} ${pct(o.p)}`).join(" · ") ?? "";
  return `<div class="mk ${cv.status}" data-g="corner"><span class="mk-name">Corner</span><span class="mk-pick"><b>${sideName(c.side)} ${num(c.line, 1)}</b><em>${pct(c.p)}</em></span><span class="mk-rest">${esc(rest || (c.odd ? `quota ${num(c.odd)}` : cv.state === "model" ? "modello" : ""))}</span>${tag(cv.status)}</div>`;
}

/** Tabella completa di un gruppo (dentro «Mercati e motivazioni»). */
function detailGroup(m, g, opts) {
  const { thr, rules } = opts, mk = m.mk, best = bestOf(mk, g.id);
  const rows = g.keys.filter((k) => mk.x[k]).map((k) => {
    const x = mk.x[k], st = statusOf(x, thr, rules), rel = reliabilityOf(x, mk);
    return `<tr class="${k === best ? "top" : ""}"><th>${esc(optLabel(k))}</th><td>${pct(x.p)}</td><td>${pct(x.l)}</td><td>${rel ?? "—"}</td><td>${tag(st) || "—"}</td></tr>`;
  }).join("");
  const why = g.keys.filter((k) => k !== best && mk.x[k]).map((k) => [k, whyNot(k, mk.x[k], mk, rules)]).filter(([, t]) => t).map(([k, t]) => `<li><b>${esc(optLabel(k))}</b> ${esc(t)}</li>`).join("");
  return `<section class="mk-grp"><h5>${g.label}</h5><div class="mk-scroll"><table class="mk-table"><thead><tr><th></th><th>Probabilità</th><th>Prudente</th><th>Affidabilità</th><th>Stato</th></tr></thead><tbody>${rows}</tbody></table></div>${why ? `<p class="mk-whyh">Perché gli altri esiti sono meno interessanti</p><ul class="mk-why">${why}</ul>` : ""}</section>`;
}
function cornerDetail(m, cv) {
  if (cv.state === "none") return `<section class="mk-grp"><h5>Corner</h5><p class="mk-note">Non valutabile: ${esc(cv.why)}.</p></section>`;
  const mkt = cv.raw.market, mod = cv.raw.model ? m.cornerModel : null;
  const parts = [];
  if (mod) parts.push(`<p><b>Modello Stay Live</b> · attesi ${f1(mod.lambda.total)}: ${mod.lines.filter((l) => Math.abs(l.line - mod.mainLine) <= 1).map((l) => `${num(l.line, 1)} → Over ${pct(l.over)} · Under ${pct(l.under)}`).join(" · ")}</p>`);
  if (mkt?.best) parts.push(`<p><b>Quote dei bookmaker</b> · ${sideName(mkt.best.side)} ${num(mkt.best.line, 1)}: ${pct(mkt.best.p)}${mkt.best.odd ? `, quota ${num(mkt.best.odd)}` : ""}</p>`);
  if (mkt?.favorite && mkt.favorite.side !== "even") parts.push(`<p>Più corner: <b>${esc(mkt.favorite.side === "home" ? m.home : m.away)}</b> ${pct(mkt.favorite.p[mkt.favorite.side])} (quote)</p>`);
  const mot = cornerMotivation(m, cv);
  return `<section class="mk-grp"><h5>Corner <small>affidabilità ${cv.reliability}</small></h5>${parts.join("")}${mot ? `<p class="mk-note">${mot}</p>` : ""}<p class="mk-note">${esc(cv.note)} I corner non diventano mai BET: non esiste un modello tarato.</p></section>`;
}

/** Il blocco completo sotto le squadre. mode: "all" (tutti i mercati) | "bet" (solo i mercati BET). */
export function marketsHtml(m, { mode = "all", thr = THR_DEFAULT, rules = RULES, open = false, cornerOverride = null } = {}) {
  const mk = m.mk, opts = { thr, rules }, cv = cornerView(m, thr, rules, cornerOverride);
  if (!mk) {
    const reason = m.pick?.confidence === "insufficiente" ? `Pochi dati: ${m.pick.sample} gare di storico, mercati non valutabili.` : "Mercati non ancora disponibili per questa partita.";
    return `<div class="mkts"><div class="mk none"><span class="mk-name">Mercati</span><span class="mk-na">${esc(reason)}</span></div>${cv.state !== "none" ? cornerRow(m, cv) : ""}</div>`;
  }
  const dcKey = bestOf(mk, "dc"), recDc = mk.rec.some((k) => MARKET_GROUPS.every((g) => !g.keys.includes(k)));
  if (mode === "bet") {
    const keys = (mk.rec.length ? mk.rec : Object.keys(mk.x).filter((k) => mk.x[k].v)).filter((k) => mk.x[k]);
    const rows = keys.map((k) => { const x = mk.x[k]; return `<div class="mk bet" data-g="rec"><span class="mk-name">${esc(groupName(k))}</span><span class="mk-pick"><b>${esc(optLabel(k))}</b><em>${pct(x.p)}</em></span><span class="mk-rest">prudente ${pct(x.l)}${x.o ? ` · quota ${num(x.o)}` : ""} · affidabilità ${reliabilityOf(x, mk)}</span>${tag("bet")}</div>`; }).join("");
    const mot = keys[0] ? motivationOf(m, keys[0]) : "";
    return `<div class="mkts">${rows}</div>${mot ? `<p class="mk-mot"><b>Perché</b> ${mot}</p>` : ""}${detailsHtml(m, opts, cv, open)}`;
  }
  const rows = MARKET_GROUPS.map((g) => groupRow(m, g, opts)).join("") + cornerRow(m, cv) + (dcKey && (recDc || (mk.x[dcKey].v)) ? groupRow(m, DC, opts) : "");
  const headKey = m.pick?.key && mk.x[m.pick.key] ? m.pick.key : bestInteresting(mk, thr, rules);
  const mot = headKey ? motivationOf(m, headKey) : "";
  const rel = headKey ? reliabilityOf(mk.x[headKey], mk) : null;
  return `<div class="mkts">${rows}</div>${mot ? `<p class="mk-mot"><b>${esc(optLabel(headKey))}</b> ${mot}${rel ? ` <span class="mk-rel ${rel}">affidabilità ${rel}</span>` : ""}</p>` : ""}${detailsHtml(m, opts, cv, open)}`;
}
const groupName = (k) => (MARKET_GROUPS.concat(DC).find((g) => g.keys.includes(k))?.label ?? "Mercato");
function bestInteresting(mk, thr, rules) {
  const keys = Object.keys(mk.x).filter((k) => statusOf(mk.x[k], thr, rules) !== "analysed");
  return keys.sort((a, b) => (mk.x[b].v - mk.x[a].v) || mk.x[b].l - mk.x[a].l)[0] ?? null;
}
function detailsHtml(m, opts, cv, open) {
  const mk = m.mk;
  return `<details class="mk-more" data-mk="${esc(m.id)}"${open ? " open" : ""}><summary>Mercati e motivazioni</summary><div class="mk-body">${MARKET_GROUPS.map((g) => detailGroup(m, g, opts)).join("")}${detailGroup(m, DC, opts)}${cornerDetail(m, cv)}<p class="mk-note">Stati: <b>BET</b> = selezionato dal motore · <b>Interessante</b> = probabilità ≥ ${pct(opts.thr)} e non contraddetta · altrimenti solo analizzato. Forma: V vinta, N pari, P persa. Dati: ${mk.s} gare di storico, fonti ${esc(mk.ba)}.</p></div></details>`;
}
