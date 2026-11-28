/**
 * Scheda partita del calcio: i mercati (1X2, Gol, Over/Under, Doppia chance, Corner) in forma compatta.
 * Funzioni pure: leggono SOLO i dati già calcolati dal motore (`match.mk`, `match.corner`, `match.cornerModel`, `match.pick`, `payload.rules`).
 * Nessuna probabilità viene calcolata o inventata qui; se un dato manca, il mercato è «non disponibile».
 *
 * Schermata principale: per ogni mercato le opzioni con la loro probabilità; l'esito più probabile (o, per over/under e doppia chance,
 * quello che il motore giudica più interessante) è evidenziato; verde se è un BET. Quota del bookmaker accanto all'esito, se esiste.
 * Sotto: una motivazione breve. Tutto il resto (affidabilità, perché gli altri esiti sono meno solidi, corner in dettaglio) sta nella tendina.
 */
import { esc, num, pct } from "./format.js";
import { icon } from "./icons.js";
import { accordionHtml } from "./playlist.js";
import { SHORT_PICK, shortPick } from "./pickview.js";
import { MULTIGOL_BANDS, multigolOf as multigolFromGoals, outcomes } from "../functions/api/model.js";

const RULES = { thr: 0.6, maxUseful: 0.8, minEdge: 0.08, minPlay: 1.2, betSample: 5, margin: 1.03 };
const sign = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(Math.round(v * 100))}`;
const f1 = (v) => num(v, 1);
const optLabel = (k) => SHORT_PICK[k] ?? k;
const sideName = (s) => (s === "over" ? "Over" : "Under");

/** Gruppi mostrati nella scheda, nell'ordine di lettura. `shown` = opzioni visibili nella schermata principale. */
const GROUPS = [
  { id: "esito", label: "1X2", keys: ["home", "draw", "away"], shown: ["home", "draw", "away"] },
  { id: "gol", label: "Gol", keys: ["btts", "nobtts"], shown: ["btts", "nobtts"] },
  { id: "ou", label: "Over/Under", keys: ["over05", "over15", "under15", "over25", "under25", "over35", "under35"], shown: null },
  { id: "dc", label: "Doppia chance", keys: ["dc1x", "dcx2", "dc12"], shown: ["dc1x", "dcx2", "dc12"] },
];
export { MULTIGOL_BANDS };
/** Multigol dai gol attesi del motore (nessuna quota, nessuna fusione con API-Football): { lambda, bands, pick } oppure null. */
export function multigolOf(mk) { return multigolFromGoals(mk?.st?.lh, mk?.st?.la); }
const OU_LINES = ["15", "25", "35"];
/** Per ogni soglia over/under il lato favorito dal motore (probabilità maggiore): una sola opzione per soglia. */
const ouShown = (mk) => OU_LINES.map((l) => { const o = mk.x[`over${l}`], u = mk.x[`under${l}`]; return o && u ? (o.p >= u.p ? `over${l}` : `under${l}`) : (o ? `over${l}` : u ? `under${l}` : null); }).filter(Boolean);
/** Opzioni visibili nella schermata principale; il consiglio del motore, se è di questo mercato, è sempre visibile (sostituisce l'altro lato della stessa soglia). */
const shownOf = (g, mk, pickKey = null) => {
  const base = g.id === "ou" ? ouShown(mk) : g.shown;
  if (!pickKey || !g.keys.includes(pickKey) || base.includes(pickKey) || !mk.x[pickKey]) return base;
  const line = pickKey.replace(/^(over|under)/, "");
  return g.id === "ou" ? base.map((k) => (k.endsWith(line) ? pickKey : k)) : base;
};

/* ---------- Affidabilità (nella tendina) ---------- */
export function reliabilityOf(x, mk) {
  if (!x || !mk) return null;
  const conf = mk.c === "buona" ? 2 : mk.c === "media" ? 1 : 0;
  const score = conf + (x.g === 1 ? 1 : 0) - (x.g === -1 ? 2 : 0) - ((x.sp ?? 0) >= 0.12 || x.p - x.l > 0.12 ? 1 : 0);
  return score >= 3 ? "alta" : score >= 1 ? "media" : "bassa";
}

/* ---------- Corner: quote dei bookmaker (se scaricate) e modello Stay Live (non tarato, mai BET) ---------- */
export function cornerView(m, rules = RULES, cornerOverride = null) {
  const market = cornerOverride ?? m.corner ?? null, model = m.cornerModel?.ok ? m.cornerModel : null;
  const mkt = market?.best ? { source: "market", side: market.best.side, line: market.best.line, p: market.best.p, odd: market.best.odd ?? null } : null;
  let mod = null;
  if (model) {
    const lines = model.lines, at = Math.max(0, lines.findIndex((l) => l.line === model.mainLine));
    const opts = lines.slice(Math.max(0, at - 1), at + 2).flatMap((l) => [{ side: "over", line: l.line, p: l.over }, { side: "under", line: l.line, p: l.under }]);
    const useful = opts.filter((o) => o.p <= rules.maxUseful).sort((a, b) => b.p - a.p);
    const best = useful[0] ?? [...opts].sort((a, b) => b.p - a.p)[0];
    if (best) mod = { source: "model", ...best, others: opts.filter((o) => o !== best && o.side === best.side).sort((a, b) => b.p - a.p).slice(0, 2) };
  }
  const main = mkt ?? mod;
  if (!main) return { state: "none", why: m.cornerState === "none" || m.cornerState === "missing" ? "nessuna quota e nessun dato storico" : "dati non ancora disponibili" };
  return { state: main.source, main, market: mkt, model: mod, reliability: main.source === "market" ? "media" : "bassa", note: main.source === "market" ? "Probabilità dalle quote dei bookmaker (margine tolto)." : "Modello Stay Live sui corner storici reali: non ancora tarato, non è un BET.", raw: { market, model } };
}

/* ---------- Perché un esito NON è il più solido: dal codice del verdetto del motore, con i suoi numeri ---------- */
export function whyNot(key, x, mk, rules = RULES) {
  if (!x) return "";
  if (x.v) return "BET: supera le regole del motore";
  if (!x.o && x.p > rules.maxUseful) return "troppo probabile: la quota equa sarebbe sotto 1,25";
  const e = x.e == null ? "" : x.e >= 0 ? ` (${sign(x.e)} punti, ne servono ${Math.round(rules.minEdge * 100)})` : ` (${sign(x.e)} punti)`;
  switch (x.c) {
    case "S": return `campione troppo piccolo (${mk.s} gare, ne servono ${rules.betSample})`;
    case "A": return "API-Football non lo conferma";
    case "Q": return `quota sotto il minimo di ${num(rules.minPlay)}`;
    case "L": return "probabilità prudente troppo bassa";
    case "E": return "la quota non lascia valore";
    case "R": return "quota reale non disponibile";
    case "T": return `prudente ${pct(x.l)}, sotto la soglia del ${pct(rules.thr)}`;
    case "M": return `vantaggio sulla media del campionato troppo piccolo${e}`;
    default: return "";
  }
}

/* ---------- Motivazioni brevi: solo da dati realmente usati dal motore ---------- */
const GOAL_KEYS = /^(over|under|btts|nobtts)/;
const groupOf = (key) => GROUPS.find((g) => g.keys.includes(key));

/** Il dato che spiega l'esito, in una frase. Vuota se mancano i dati (niente testo generico). */
export function factOf(m, key) {
  const mk = m.mk, st = mk?.st, x = mk?.x?.[key];
  if (!st || !x) return "";
  const H = esc(m.home), A = esc(m.away);
  let t;
  if (key === "btts" || key === "nobtts") t = `gol attesi ${H} ${f1(st.lh)}, ${A} ${f1(st.la)}`;
  else if (GOAL_KEYS.test(key)) t = `${f1(st.tot)} gol attesi${st.lg ? ` contro ${f1(st.lg)} di media nel campionato` : ""} (${H} ${f1(st.lh)}, ${A} ${f1(st.la)})`;
  else t = `gol attesi ${H} ${f1(st.lh)}, ${A} ${f1(st.la)}${st.h?.f && st.a?.f ? `; forma ${H} ${esc(st.h.f)}, ${A} ${esc(st.a.f)}` : ""}`;
  if (x.g === 1) t += "; API-Football conferma";
  else if (x.g === -1) t += "; API-Football non conferma";
  return t;
}

/** Il motivo per cui l'alternativa più vicina è meno solida (stesso mercato), in una frase. */
export function altOf(m, key, rules = RULES) {
  const mk = m.mk, g = groupOf(key);
  if (!mk || !g) return "";
  const shown = new Set(shownOf(g, mk));
  const alt = g.keys.filter((k) => k !== key && mk.x[k]).map((k) => [k, mk.x[k]]).filter(([, x]) => x.p >= 0.2 && x.p <= rules.maxUseful).sort((a, b) => b[1].p - a[1].p)[0];
  if (!alt) return "";
  const why = whyNot(alt[0], alt[1], mk, rules);
  return why ? `${optLabel(alt[0])}${shown.has(alt[0]) ? "" : ` ${pct(alt[1].p)}`}: ${why}.` : "";
}

/** Motivazione completa della scheda: dato + alternativa. */
export function motivationOf(m, key, rules = RULES) {
  const f = factOf(m, key);
  if (!f) return "";
  const alt = altOf(m, key, rules);
  return `${f[0].toUpperCase()}${f.slice(1)}.${alt ? ` ${alt}` : ""}`;
}

/** Motivazione dei corner (quote o modello). */
export function cornerMotivation(m, cv) {
  if (cv.state === "market") return `Quote dei bookmaker${cv.raw.market.favorite?.books ? ` (${cv.raw.market.favorite.books} bookmaker)` : ""}: ${sideName(cv.main.side)} ${num(cv.main.line, 1)} corner.`;
  const mod = cv.raw?.model ? m.cornerModel : null;
  return mod ? `Corner attesi ${f1(mod.lambda.total)} (${esc(m.home)} ${f1(mod.lambda.home)}, ${esc(m.away)} ${f1(mod.lambda.away)}) su ${mod.sample.home} e ${mod.sample.away} partite con dati reali.` : "";
}

/* ---------- HTML ---------- */
const cell = (label, p, { top = false, bet = false, odd = null, rec = false, recBet = false, res = null } = {}) => `<span class="c${top ? " top" : ""}${top && bet ? " bet" : ""}${rec ? (recBet ? " rec rec-bet" : " rec rec-soft") : ""}${res === true ? " ok" : res === false ? " ko" : ""}"><i>${rec ? (recBet ? `<em class="star" aria-label="Consigliato">★</em> ` : `<em class="dot" aria-label="Più probabile, non consigliato">◦</em> `) : ""}${esc(label)}</i><b>${pct(p)}</b>${(top || rec) && odd > 1 ? `<small>quota ${num(odd)}</small>` : ""}</span>`;
const row = (g, cells) => `<div class="mx" data-g="${g.id ?? g}"><span class="mx-l">${esc(g.label ?? "").replace("/", "/<wbr>")}</span><span class="mx-c">${cells}</span></div>`;
const none = (label, why, g = "") => `<div class="mx none" data-g="${g}"><span class="mx-l">${esc(label)}</span><span class="mx-na">${esc(why)}</span></div>`;

function groupRow(m, g, mode, ctx = {}) {
  const mk = m.mk, shown = shownOf(g, mk, ctx.recKey).filter((k) => mk.x[k]);
  if (!shown.length) return none(g.label, "non disponibile", g.id);
  const top = mk.b?.[g.id] ?? null;
  // Solo BET: nel mercato si evidenzia l'esito BET (se diverso dal più probabile).
  const betKey = shown.find((k) => mk.x[k].v) ?? null, hi = mode === "bet" && betKey ? betKey : top;
  return row(g, shown.map((k) => cell(optLabel(k), mk.x[k].p, { top: k === hi, bet: Boolean(mk.x[k].v), odd: mk.x[k].o, rec: k === ctx.recKey, recBet: ctx.recBet, res: ctx.final ? outcomes(ctx.final.h, ctx.final.a)[k] === 1 : null })).join(""));
}
function multigolRow(m, final) {
  const mg = multigolOf(m.mk);
  if (!mg) return none("Multigol", "non disponibile", "multigol");
  const total = final ? final.h + final.a : null;
  const cells = mg.bands.map((b) => cell(`${b.lo}-${b.hi}`, b.p, { top: b.key === mg.pick.key, res: total == null ? null : total >= b.lo && total <= b.hi })).join("");
  return row({ id: "multigol", label: "Multigol" }, cells)
    + `<p class="mx-note">Gol attesi <b>${f1(mg.lambda)}</b> · il modello si aspetta <b>${mg.pick.lo}-${mg.pick.hi}</b> (${pct(mg.pick.p)})</p>`;
}
/** Un corner (over/under su una soglia) è uscito? null se i corner reali non sono noti. */
const cornerHit = (o, total) => (Number.isFinite(total) ? (o.side === "over" ? total > o.line : total < o.line) : null);
function cornerRow(m, cv, final = null) {
  if (cv.state === "none") return none("Corner", cv.why, "corner");
  const c = cv.main, cells = [{ ...c, top: true }, ...(c.others ?? [])].sort((a, b) => a.line - b.line);
  return row({ id: "corner", label: "Corner" }, cells.map((o) => cell(`${sideName(o.side)} ${num(o.line, 1)}`, o.p, { top: o === cells.find((x) => x.top), odd: o.odd ?? null, res: final ? cornerHit(o, final.corners) : null })).join(""));
}

/* ---------- Resoconto a partita finita: pronosticato contro reale ---------- */
const RESULT_LABEL = { home: "1", draw: "X", away: "2" };
export function recapHtml(m, final, cv, rules = RULES, vis = null) {
  const mk = m.mk;
  if (!mk || !final) return "";
  const o = outcomes(final.h, final.a), total = final.h + final.a, rows = [];
  const add = (label, pred, actual, ok) => rows.push(`<div class="rc-r ${ok === true ? "ok" : ok === false ? "ko" : ""}"><span>${esc(label)}</span><b>${esc(pred)}</b><span>${esc(actual)}</span><i>${ok === true ? "✓" : ok === false ? "✗" : "–"}</i></div>`);
  const real1x2 = RESULT_LABEL[["home", "draw", "away"].find((k) => o[k])];
  const bests = mk.b ?? {};
  if (bests.esito) add("1X2", optLabel(bests.esito), real1x2, o[bests.esito] === 1);
  if (bests.gol) add("Gol", optLabel(bests.gol), o.btts ? "GG" : "NG", o[bests.gol] === 1);
  if (bests.ou) add("Over/Under", optLabel(bests.ou), `${total} gol`, o[bests.ou] === 1);
  if (bests.dc) add("Doppia chance", optLabel(bests.dc), real1x2, o[bests.dc] === 1);
  if (cv?.state && cv.state !== "none" && (!vis || vis.has("corner"))) { const hit = cornerHit(cv.main, final.corners); add("Corner", `${sideName(cv.main.side)} ${num(cv.main.line, 1)}`, Number.isFinite(final.corners) ? `${final.corners} corner` : "non disponibile", hit); }
  return `<div class="rc"><h5>Resoconto · finale ${esc(final.h)}–${esc(final.a)}<small>pronosticato · uscito</small></h5>${rows.join("")}</div>`;
}

/** Righe con almeno un esito BET dentro il gruppo (per «Solo BET»). */
const betGroups = (mk) => GROUPS.filter((g) => g.keys.some((k) => mk.x[k]?.v));

/** La motivazione spiega un esito evidenziato nella scheda: il consiglio del motore se è evidenziato, altrimenti il più solido tra gli evidenziati. */
function headlineKey(m, rules) {
  const mk = m.mk, hl = Object.values(mk.b ?? {}).filter((k) => k && mk.x[k]);
  if (m.pick?.key && hl.includes(m.pick.key)) return m.pick.key;
  const useful = hl.filter((k) => mk.x[k].o || mk.x[k].p <= rules.maxUseful);
  return (useful.length ? useful : hl).sort((a, b) => (mk.x[b].v - mk.x[a].v) || mk.x[b].l - mk.x[a].l)[0] ?? null;
}

function detailsBody(m, cv, rules, vis = null) {
  const mk = m.mk, parts = [];
  for (const g of GROUPS.filter((x) => !vis || vis.has(x.id))) {
    const keys = g.keys.filter((k) => mk.x[k]);
    if (!keys.length) continue;
    const top = mk.b?.[g.id], shown = new Set(shownOf(g, mk)), rel = top ? reliabilityOf(mk.x[top], mk) : null;
    const fact = top ? factOf(m, top) : "";
    const items = keys.filter((k) => k !== top).map((k) => {
      const why = whyNot(k, mk.x[k], mk, rules), inMain = shown.has(k);
      return why || !inMain ? `<li><b>${esc(optLabel(k))}</b>${inMain ? "" : ` ${pct(mk.x[k].p)}`}${why ? ` · ${esc(why)}` : ""}</li>` : "";
    }).join("");
    parts.push(`<section class="dt"><h5>${g.label}${rel ? `<small>affidabilità ${rel}</small>` : ""}</h5>${fact ? `<p>${esc(optLabel(top))}: ${fact}.</p>` : ""}${items ? `<ul>${items}</ul>` : ""}</section>`);
  }
  if (vis?.has("multigol") && mk.st) { const g = multigolOf(mk); if (g) parts.push(`<section class="dt"><h5>Multigol<small>solo modello</small></h5><p>Gol attesi ${f1(mk.st.lh)} + ${f1(mk.st.la)} = <b>${f1(g.lambda)}</b>. Le percentuali sono la probabilità che i gol totali cadano nella fascia. La fascia evidenziata, <b>${g.pick.lo}-${g.pick.hi}</b>, è quella che il modello si aspetta: ha la probabilità più alta per gol coperto, non in assoluto (una fascia più larga esce sempre più spesso). Nessuna quota e nessun dato API-Football.</p></section>`); }
  if (cv.state !== "none" && (!vis || vis.has("corner"))) parts.push(`<section class="dt"><h5>Corner<small>affidabilità ${cv.reliability}</small></h5><p>${cornerMotivation(m, cv)}</p><p class="dt-note">${esc(cv.note)} Non diventa mai BET.</p></section>`);
  return `${parts.join("")}<p class="dt-foot">${mk.s} gare di storico · fonti ${esc(mk.ba)} · forma: V vinta, N pari, P persa</p>`;
}

/** Il blocco sotto le squadre. mode: "all" (tutti i mercati) | "bet" (solo i mercati con un BET). `open` = tendina aperta. */
export function marketsHtml(m, { mode = "all", rules = RULES, open = false, cornerOverride = null, result = null, idPrefix = "mk", visible = null } = {}) {
  const vis = visible ? new Set(visible) : null, showCorner = !vis || vis.has("corner");
  const mk = m.mk, cv = cornerView(m, rules, cornerOverride), final = result && Number.isFinite(result.h) && Number.isFinite(result.a) ? result : null;
  if (!mk) {
    // Elenco partite non ancora rigenerato (o pochi dati): resta visibile il consiglio principale del motore, con le sue cifre reali.
    const pick = m.pick && m.pick.confidence !== "insufficiente" ? m.pick : null;
    const corner = mode === "bet" || cv.state === "none" || !showCorner ? "" : cornerRow(m, cv);
    if (!pick) return `<div class="mcm">${none("Mercati", m.pick?.confidence === "insufficiente" ? `pochi dati: ${m.pick.sample} gare di storico` : "non ancora disponibili")}${corner}</div>`;
    const bet = pick.verdict === "BET";
    const one = row({ id: "rec", label: bet ? "Consigliato" : "Pronostico" }, `<span class="c top${bet ? " bet" : ""}"><i>${esc(shortPick(pick))}</i><b>${pct(pick.p)}</b>${pick.odds?.median > 1 ? `<small>quota ${num(pick.odds.median)}</small>` : ""}</span>`);
    return `<div class="mcm">${one}${corner}</div>${bet && pick.reason ? `<p class="mc-why"><b>Perché</b> ${esc(pick.reason)}</p>` : ""}<p class="mc-why mc-wait">Gli altri mercati compaiono dopo il prossimo aggiornamento completo.</p>`;
  }
  const groups = (mode === "bet" ? betGroups(mk) : GROUPS).filter((g) => !vis || vis.has(g.id));
  // Il mercato consigliato dal motore tra tutti: il suo consiglio principale (in «Solo BET»: il primo BET).
  const recKey = mode === "bet" ? (mk.rec.find((k) => mk.x[k]) ?? null) : (m.pick?.key && mk.x[m.pick.key] ? m.pick.key : null);
  // ★ (in evidenza) solo per un BET vero: value bet su quota reale con dati sufficienti. ◦ (discreto) = la selezione più probabile, ma NON consigliata.
  const recBet = mode === "bet" || (m.pick?.verdict === "BET" && m.dq?.betOk !== false);
  const rows = groups.map((g) => groupRow(m, g, mode, { recKey, recBet, final })).join("") + (mode !== "bet" && vis?.has("multigol") ? multigolRow(m, final) : "") + (mode === "bet" || !showCorner ? "" : cornerRow(m, cv, final));
  const hk = recKey ?? headlineKey(m, rules);
  const why = hk ? motivationOf(m, hk, rules) : "";
  const tendina = accordionHtml({ id: `${idPrefix}:${m.id}`, open, cls: "mcd", headCls: "mcd-head", head: "<span>Mercati e motivazioni</span>", body: `<div class="mcd-body">${detailsBody(m, cv, rules, vis)}</div>` });
  const recap = final ? recapHtml(m, final, cv, rules, vis) : "";
  return `${recap}<div class="mcm">${rows}</div>${why ? `<p class="mc-why"><b>${recKey ? (recBet ? "★ Consigliato · " : "◦ Più probabile, non consigliato · ") : ""}${esc(optLabel(hk))}</b> ${why}</p>` : ""}${tendina}`;
}
