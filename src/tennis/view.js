// Stay Live Tennis — HTML dell'interfaccia (stringhe pure, tutto passa da esc()).
import { esc, pct, num, fmtTime, dayKey, dayParts } from "../format.js";
import { surfaceOf, surfaceLabel, SURFACE_LABEL } from "./board.js";

const timeOf = (iso) => fmtTime.format(new Date(iso));
const dateLabel = (iso) => { const d = dayParts(dayKey(iso)); return `${d.wd} ${d.dm}`; };
const rank = (r) => (Number.isFinite(Number(r)) && Number(r) > 0 ? `<i class="tn-rank" title="Ranking">#${Number(r)}</i>` : "");
const when = (iso) => new Date(iso).toLocaleString("it-IT", { timeZone: "Europe/Rome", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export const STATUS_LABEL = { scheduled: "In programma", live: "In corso", finished: "Conclusa", cancelled: "Annullata", unknown: "Stato n.d." };
const statusTag = (m) => `<span class="tn-status ${esc(m.status)}">${m.status === "live" ? "<b></b>" : ""}${esc(STATUS_LABEL[m.status] ?? STATUS_LABEL.unknown)}</span>`;
const surfTag = (m) => `<span class="tn-surf s-${surfaceOf(m) ?? "nd"}">${esc(surfaceLabel(m))}</span>`;

export const RELIABILITY_HINT = "Descrive la quantità di dati usati, non la probabilità di vincere.";
const relTag = (r) => (r ? `<span class="tn-rel r-${esc(r)}" title="${esc(RELIABILITY_HINT)}">Affidabilità ${esc(r)}</span>` : "");

const oddsText = (m) => (m.odds && (m.odds.p1 || m.odds.p2) ? `Quote ${num(m.odds.p1)} · ${num(m.odds.p2)}` : "");
const nameOf = (m, slot) => (slot === 1 ? m.p1.name : m.p2.name);

function pickBlock(m) {
  const p = m.prediction;
  if (!p) return `<div class="tn-pick none">In attesa di analisi</div>`;
  if (!p.published) return `<div class="tn-pick none"><b>Nessun pronostico</b><span>${esc(p.abstainReason ?? "Dati insufficienti.")}</span></div>`;
  const hit = m.status === "finished" && m.winner ? (p.pick === m.winner ? `<span class="tn-res ok">✓ Centrato</span>` : `<span class="tn-res ko">✗ Non centrato</span>`) : "";
  const prob = p.pick === 1 ? p.p1 : p.p2;
  return `<div class="tn-pick yes"><div class="tn-pick-head"><b>Pronostico ${p.pick}</b><span class="tn-pick-name">${esc(nameOf(m, p.pick))}</span><em>${pct(prob)}</em></div><div class="tn-pick-foot">${relTag(p.reliability)}${hit}</div></div>`;
}

export function matchCardHtml(m) {
  const score = m.status === "finished" && m.score ? `<div class="tn-score">${esc(m.score)}</div>` : "";
  const win = (slot) => (m.status === "finished" && m.winner === slot ? " win" : "");
  return `<button class="tn-card s-${surfaceOf(m) ?? "nd"}" type="button" data-key="${esc(m.key)}">
    <div class="tn-meta"><b>${esc(timeOf(m.startsAt))}</b><span>${esc(dateLabel(m.startsAt))}</span>${m.round ? `<span>${esc(m.round)}</span>` : ""}<span class="tn-grow"></span>${statusTag(m)}</div>
    <div class="tn-players"><div class="tn-pl${win(1)}"><span class="tn-n">${esc(m.p1.name)}</span>${rank(m.p1.rank)}</div><div class="tn-vs">contro</div><div class="tn-pl${win(2)}"><span class="tn-n">${esc(m.p2.name)}</span>${rank(m.p2.rank)}</div></div>
    ${score}${pickBlock(m)}
    <div class="tn-foot">${surfTag(m)}<span class="tn-odds">${esc(oddsText(m))}</span></div>
  </button>`;
}

export function listHtml(groups) {
  return groups.map((g) => `<section class="tn-group"><h2 class="tn-gh"><span class="tn-tour">${esc(g.tour.toUpperCase())}</span>${esc(g.tournament)}<small>${esc(g.surface)}</small></h2><div class="tn-list">${g.matches.map(matchCardHtml).join("")}</div></section>`).join("");
}

export function emptyHtml(kind, detail = "") {
  const text = {
    nodata: ["Nessun dato tennis disponibile", "I dati arriveranno dopo la prima sincronizzazione con il provider. Il calcio non è coinvolto."],
    filtered: ["Nessuna partita con questi filtri", "Prova a togliere qualche filtro."],
    error: ["Impossibile caricare il tennis", detail || "Riprova tra poco. Il calcio continua a funzionare."],
  }[kind];
  return `<div class="tn-empty"><div class="tn-ball" aria-hidden="true"></div><h2>${esc(text[0])}</h2><p>${esc(text[1])}</p></div>`;
}

const COMPONENT_LABELS = [
  ["eloDiff", "Differenza di rating (Elo)", (v) => (v > 0 ? "+" : "") + v],
  ["formAdj", "Correzione per la forma recente", (v) => (v > 0 ? "+" : "") + v],
  ["h2hAdj", "Correzione per gli scontri diretti", (v) => (v > 0 ? "+" : "") + num(v, 1)],
  ["fatigueAdj", "Correzione per il carico recente", (v) => (v > 0 ? "+" : "") + v],
  ["pElo", "Probabilità del giocatore 1 dal solo rating", (v) => pct(v, 1)],
  ["pPoint", "Probabilità del giocatore 1 da servizio e risposta", (v) => (v == null ? "non disponibile" : pct(v, 1))],
];

function statsRow(label, a, b, f) { return `<tr><th>${esc(label)}</th><td>${esc(a == null ? "—" : f(a))}</td><td>${esc(b == null ? "—" : f(b))}</td></tr>`; }

export function detailHtml(m) {
  const p = m.prediction;
  const s1 = m.stats?.p1, s2 = m.stats?.p2;
  const c = p?.components ?? {};
  const bar = p?.published ? `<div class="tn-bar" role="img" aria-label="Probabilità ${pct(p.p1)} contro ${pct(p.p2)}"><span class="a" style="width:${(p.p1 * 100).toFixed(1)}%">${pct(p.p1)}</span><span class="b" style="width:${(p.p2 * 100).toFixed(1)}%">${pct(p.p2)}</span></div>` : "";
  const reasons = p?.reasons?.length ? `<h3>Motivazioni</h3><ul class="tn-ul">${p.reasons.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : "";
  const missing = p?.missing?.length ? `<h3>Dati mancanti</h3><p class="tn-note">${esc(p.missing.join(", "))}: il modello li ha ignorati, non inventati.</p>` : "";
  const comps = p ? `<h3>Cosa ha usato il modello</h3><table class="tn-table"><tbody>${COMPONENT_LABELS.filter(([k]) => k in c).map(([k, l, f]) => `<tr><th>${esc(l)}</th><td colspan="2">${esc(f(c[k]))}</td></tr>`).join("")}${"n1" in c ? `<tr><th>Partite nello storico (giocatore 1 · 2)</th><td>${esc(c.n1)}</td><td>${esc(c.n2)}</td></tr>` : ""}${"nSurf1" in c ? `<tr><th>Di cui sulla superficie</th><td>${esc(c.nSurf1)}</td><td>${esc(c.nSurf2)}</td></tr>` : ""}${"load1" in c ? `<tr><th>Partite negli ultimi 7 giorni</th><td>${esc(c.load1)}</td><td>${esc(c.load2)}</td></tr>` : ""}</tbody></table>` : "";
  const stats = s1 || s2 ? `<h3>Statistiche di servizio e risposta</h3><table class="tn-table"><thead><tr><th></th><th>${esc(m.p1.name)}</th><th>${esc(m.p2.name)}</th></tr></thead><tbody>${statsRow("Punti vinti al servizio", s1?.serve, s2?.serve, (v) => pct(v, 1))}${statsRow("Punti vinti in risposta", s1?.ret, s2?.ret, (v) => pct(v, 1))}${statsRow("Partite considerate", s1?.matches, s2?.matches, String)}</tbody></table>` : "";
  const h2h = m.h2h && (m.h2h.p1Wins || m.h2h.p2Wins) ? `<h3>Scontri diretti</h3><p class="tn-note">${esc(m.p1.name)} ${esc(m.h2h.p1Wins)} – ${esc(m.h2h.p2Wins)} ${esc(m.p2.name)}</p>` : "";
  const verdict = !p ? `<p class="tn-note">Il pronostico non è ancora stato calcolato.</p>` : p.published ? `<div class="tn-verdict"><b>Pronostico ${p.pick}: ${esc(nameOf(m, p.pick))}</b>${relTag(p.reliability)}</div>` : `<div class="tn-verdict none"><b>Nessun pronostico</b><span>${esc(p.abstainReason ?? "")}</span></div>`;
  const oddsLine = oddsText(m) ? `<p class="tn-note">${esc(oddsText(m))}${m.odds?.source ? ` (${esc(m.odds.source)})` : ""}</p>` : "";
  return `<h2 class="tn-dt">${esc(m.p1.name)} <i>contro</i> ${esc(m.p2.name)}</h2>
    <p class="tn-ds">${esc(m.tour.toUpperCase())} · ${esc(m.tournament ?? "")}${m.round ? ` · ${esc(m.round)}` : ""} · ${esc(when(m.startsAt))}</p>
    <div class="tn-chips">${surfTag(m)}${statusTag(m)}${m.p1.rank || m.p2.rank ? `<span class="tn-chip">Ranking ${esc(m.p1.rank ?? "n.d.")} · ${esc(m.p2.rank ?? "n.d.")}</span>` : ""}</div>
    ${m.status === "finished" && m.score ? `<p class="tn-final"><b>${esc(m.score)}</b>${m.winner ? ` · ha vinto ${esc(nameOf(m, m.winner))}` : ""}</p>` : ""}
    ${verdict}${bar}${reasons}${comps}${stats}${h2h}${missing}${oddsLine}
    <p class="tn-disc">Stima statistica, non una garanzia di vittoria. ${p?.computedAt ? `Pronostico registrato il ${esc(when(p.computedAt))} (modello ${esc(p.modelVersion ?? "n.d.")}) e non modificato dopo l'inizio della partita.` : ""}</p>`;
}

// ───────── Storico e backtest ─────────
const row = (label, s) => `<tr><th>${esc(label)}</th><td>${esc(s.n)}</td><td>${pct(s.accuracy, 1)}</td><td>${num(s.brier, 3)}</td><td>${num(s.logLoss, 3)}</td></tr>`;
const groupTable = (title, obj, labelOf = (k) => k) => (obj && Object.keys(obj).length ? `<h3>${esc(title)}</h3><div class="tn-scroll"><table class="tn-table"><thead><tr><th></th><th>Partite</th><th>Esatti</th><th>Brier</th><th>Log loss</th></tr></thead><tbody>${Object.entries(obj).map(([k, s]) => row(labelOf(k), s)).join("")}</tbody></table></div>` : "");

export function historyHtml(h) {
  if (!h?.summary || !h.summary.n) return `<div class="tn-empty"><div class="tn-ball" aria-hidden="true"></div><h2>Storico non ancora disponibile</h2><p>Comparirà dopo le prime partite concluse con un pronostico registrato prima dell'inizio.</p></div>`;
  const s = h.summary;
  const bins = (s.calibration ?? []).filter((b) => b.n).map((b) => `<tr><th>${Math.round(b.from * 100)}–${Math.round(b.to * 100)}%</th><td>${b.n}</td><td>${pct(b.meanP, 1)}</td><td>${pct(b.hitRate, 1)}</td></tr>`).join("");
  return `<div class="tn-kpis"><div><b>${s.n}</b><span>pronostici conclusi</span></div><div><b>${pct(s.accuracy, 1)}</b><span>esatti</span></div><div><b>${num(s.brier, 3)}</b><span>Brier</span></div><div><b>${num(s.logLoss, 3)}</b><span>Log loss</span></div></div>
    <p class="tn-note">${esc(h.verdict ?? "")}. Riferimenti: un lancio di moneta dà Brier 0,250 e log loss 0,693. Sotto le 300 partite i numeri non dimostrano nulla.</p>
    ${groupTable("Per superficie", h.bySurface, (k) => SURFACE_LABEL[k] ?? k)}${groupTable("ATP e WTA", h.byTour, (k) => k.toUpperCase())}${groupTable("Per fascia di probabilità", h.byBand)}
    ${bins ? `<h3>Calibrazione</h3><div class="tn-scroll"><table class="tn-table"><thead><tr><th>Fascia</th><th>Partite</th><th>Dichiarata</th><th>Reale</th></tr></thead><tbody>${bins}</tbody></table></div><p class="tn-note">Se “Dichiarata” e “Reale” sono vicine, le probabilità sono credibili.</p>` : ""}
    ${h.abstained != null ? `<p class="tn-note">Partite in cui il modello si è astenuto: ${esc(h.abstained)}.</p>` : ""}`;
}
