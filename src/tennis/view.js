// Stay Live Tennis — HTML dell'interfaccia (stringhe pure, tutto passa da esc()).
import { icon, iconFill } from "../icons.js";
import { esc, pct, num, fmtTime, dayKey, dayParts } from "../format.js";
import { crest, matchHeader } from "../ui.js";
import { surfaceOf, surfaceLabel, categoryLabel, flag, CATEGORY_LABEL } from "./board.js";
import { pickOdds } from "./plays.js";

const timeOf = (iso) => fmtTime.format(new Date(iso));
const dateLabel = (iso) => { const d = dayParts(dayKey(iso)); return `${d.wd} ${d.dm}`; };
const rank = (r) => (Number.isFinite(Number(r)) && Number(r) > 0 ? `<i class="tn-rank" title="Ranking">#${Number(r)}</i>` : "");
const when = (iso) => new Date(iso).toLocaleString("it-IT", { timeZone: "Europe/Rome", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export const STATUS_LABEL = { scheduled: "In programma", live: "In corso", finished: "Conclusa", cancelled: "Annullata", unknown: "Esito non ricevuto", ended_other: "Conclusa (non regolare)", postponed: "Rinviata", interrupted: "Interrotta" };
const statusTag = (m) => `<span class="tn-status ${esc(m.status)}">${m.status === "live" ? "<b></b>" : ""}${esc(STATUS_LABEL[m.status] ?? STATUS_LABEL.unknown)}</span>`;
const surfTag = (m) => `<span class="tn-surf s-${surfaceOf(m) ?? "nd"}">${esc(surfaceLabel(m))}</span>`;

export const RELIABILITY_HINT = "Descrive la quantità di dati usati, non la probabilità di vincere.";
const relTag = (r) => (r ? `<span class="tn-rel r-${esc(r)}" title="${esc(RELIABILITY_HINT)}">Affidabilità ${esc(r)}</span>` : "");

const oddsText = (m) => (m.odds && (m.odds.p1 || m.odds.p2) ? `Quote ${num(m.odds.p1)} · ${num(m.odds.p2)}` : "");
const nameOf = (m, slot) => (slot === 1 ? m.p1.name : m.p2.name);

const RESULT_TYPE_LABEL = (t) => (/walk|w\/o|wo\b/i.test(t ?? "") ? "walkover" : /retir/i.test(t ?? "") ? "ritiro" : t ? String(t) : "esito non regolare");
const nm = (p) => `${flag(p.country) ? `<span class="tn-flag" aria-hidden="true">${flag(p.country)}</span>` : ""}${esc(p.name)}`;
const catTag = (m) => `<span class="tn-cat c-${esc(m.category ?? "unknown")}">${esc(categoryLabel(m))}</span>`;
const betTag = (m) => (m.bet ? `<span class="tn-bet ${m.bet.verdict === "BET" ? "yes" : "no"}" title="${esc((m.bet.reasons ?? []).join(" "))}">${esc(m.bet.verdict)}</span>` : "");
const liveScore = (m) => (m.live?.sets?.length ? `<div class="tn-score live">${esc(m.live.sets.map(([a, b]) => `${a}-${b}`).join("  "))}${m.live.points ? ` <small>punti ${esc(m.live.points)}</small>` : ""}</div>` : m.status === "live" ? `<div class="tn-score live"><small>Punteggio non disponibile</small></div>` : "");

const timeOf2 = (m) => fmtTime.format(new Date(m.startsAt));
const pickName = (m, slot) => (slot === 1 ? m.p1.name : m.p2.name);

/** Set giocati (uno per giocatore): dal feed live o dal punteggio finale "6-4 6-3". null se non ci sono. */
export function setsOf(m) {
  if (m.live?.sets?.length) return m.live.sets.map(([a, b]) => [a, b]);
  if ((m.status === "finished" || m.status === "ended_other") && m.score) {
    const out = [...String(m.score).matchAll(/(\d+)-(\d+)/g)].map((x) => [Number(x[1]), Number(x[2])]);
    return out.length ? out : null;
  }
  return null;
}
const sideHtml = (m, slot) => {
  const p = slot === 1 ? m.p1 : m.p2, sets = setsOf(m), win = m.status === "finished" && m.winner === slot;
  return `<span class="side${win ? " win" : ""}">${crest(p.name, null)}<b>${flag(p.country) ? `<span class="tn-flag" aria-hidden="true">${flag(p.country)}</span>` : ""}${esc(p.name)}</b>${rank(p.rank)}${sets ? `<span class="score sets">${esc(sets.map((x) => x[slot - 1]).join(" "))}</span>` : ""}</span>`;
};

/** Il consiglio dentro la riga: lo stesso «chip» del calcio (esito in primo piano, BET o EVITA, quota reale o avviso). */
export function pickChip(m) {
  const p = m.prediction;
  if (!p) return `<span class="pick none"><span class="pk-main"><span class="pk-label">In attesa di analisi</span></span></span>`;
  if (!p.published) return `<span class="pick none"><span class="pk-main"><span class="pk-label">Nessun pronostico</span></span><span class="pk-sub"><span class="pk-q none">${esc(p.abstainReason ?? "Dati insufficienti.")}</span></span></span>`;
  const bet = m.bet?.verdict === "BET", verdict = m.bet ? (bet ? "BET" : "EVITA") : null, odds = pickOdds(m), prob = p.pick === 1 ? p.p1 : p.p2;
  const hit = m.status === "finished" && m.winner ? (p.pick === m.winner ? `<span class="tn-res ok">${icon("check")}Centrato</span>` : `<span class="tn-res ko">${icon("close")}Non centrato</span>`) : "";
  return `<span class="pick ${bet ? "bet" : "skip"}"><span class="pk-main"><span class="pk-label">Vince ${esc(pickName(m, p.pick))}</span>${verdict ? `<b class="vd-pill">${bet ? icon("check") : ""}${verdict}</b>` : ""}</span><span class="pk-sub">${odds ? `<span class="pk-q real">quota ${num(odds)}</span>` : `<span class="pk-q none">quota reale non disponibile</span>`}${hit}<em class="pk-pct" title="Probabilità stimata">${pct(prob)}</em></span></span>`;
};

export const canSave = (m) => m.prediction?.published === true && (m.status === "scheduled" || m.status === "live");
export function rowSaveHtml(m, saved) {
  if (!canSave(m)) return "";
  const label = `${saved ? "Giocata salvata" : "Salva giocata"}: ${pickName(m, m.prediction.pick)}`;
  return `<button class="row-save${saved ? " done" : ""}" type="button" data-row-save="${esc(m.key)}" aria-label="${esc(label)}" aria-pressed="${saved}"${saved ? " disabled" : ""}>${saved ? iconFill("bookmark") : icon("bookmark")}</button>`;
}

/** Riga partita: identica a quella del calcio (stesse classi), con i due giocatori al posto delle squadre. */
export function rowHtml(m, { saved = false, k = 0 } = {}) {
  const live = m.status === "live" ? `<span class="live-tag">In corso</span>` : "";
  const isBet = m.bet?.verdict === "BET" && m.prediction?.published;
  return `<div class="row${isBet ? " is-bet" : ""}" style="--i:${Math.min(k, 9)}"><span></span>
    <button class="row-main" type="button" data-key="${esc(m.key)}">
      <span class="meta"><b>${esc(timeOf2(m))}</b><span>${esc(surfaceLabel(m))}</span><span class="tn-tourn">${esc(m.tournament ?? categoryLabel(m))}</span>${live}</span>
      <span class="fx">${sideHtml(m, 1)}${sideHtml(m, 2)}</span>
      ${pickChip(m)}
    </button>${rowSaveHtml(m, saved)}</div>`;
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
  ["rankAdj", "Correzione per il ranking (solo con pochi dati)", (v) => (v > 0 ? "+" : "") + v],
  ["h2hAdj", "Correzione per gli scontri diretti", (v) => (v > 0 ? "+" : "") + num(v, 1)],
  ["fatigueAdj", "Correzione per il carico recente", (v) => (v > 0 ? "+" : "") + v],
  ["pElo", "Probabilità del giocatore 1 dal solo rating", (v) => pct(v, 1)],
  ["pPoint", "Probabilità del giocatore 1 da servizio e risposta", (v) => (v == null ? "non disponibile" : pct(v, 1))],
];

function statsRow(label, a, b, f) { return `<tr><th>${esc(label)}</th><td>${esc(a == null ? "—" : f(a))}</td><td>${esc(b == null ? "—" : f(b))}</td></tr>`; }


const sec = (title, body, open = false) => (body ? `<details class="tn-dsec"${open ? " open" : ""}><summary>${esc(title)}</summary><div class="tn-dbody">${body}</div></details>` : "");
const ago = (iso) => (iso ? when(iso) : "n.d.");

function betBlock(m) {
  const b = m.bet, o = m.odds;
  if (!b && !o) return `<p class="tn-note">Il provider non ha restituito quote per questa partita: senza quote non si calcolano EV né BET.</p>`;
  const rows = [];
  if (o) {
    rows.push(`<tr><th>Quota ${esc(m.p1.name)}</th><td>${esc(num(o.p1))}</td></tr><tr><th>Quota ${esc(m.p2.name)}</th><td>${esc(num(o.p2))}</td></tr>`);
    rows.push(`<tr><th>Fonte</th><td>${esc(o.source ?? "n.d.")}${o.sources?.length > 1 ? ` (+${o.sources.length - 1})` : ""}</td></tr><tr><th>Quote lette</th><td>${esc(ago(o.at))}</td></tr>`);
  }
  if (b?.odds != null) rows.push(`<tr><th>Quota del pronostico</th><td>${esc(num(b.odds))} (${esc(b.book ?? "")})</td></tr><tr><th>Probabilità implicita</th><td>${pct(b.rawImplied, 1)} (${pct(b.implied, 1)} senza margine)</td></tr>`);
  if (b?.ev != null) rows.push(`<tr><th>EV</th><td>${b.ev > 0 ? "+" : ""}${num(b.ev * 100, 1)}%</td></tr>`);
  const verdict = b ? `<div class="tn-verdict ${b.verdict === "BET" ? "bet" : "none"}"><b>${esc(b.verdict)}</b><span>${esc((b.reasons ?? []).join(" "))}</span></div>` : "";
  return `${verdict}${rows.length ? `<table class="tn-table"><tbody>${rows.join("")}</tbody></table>` : ""}<p class="tn-note">Solo quote pre-partita reali del provider; mai stimate. A partita iniziata non si usano.</p>`;
}

export function detailHtml(m, { saved = false } = {}) {
  const p = m.prediction;
  const s1 = m.stats?.p1, s2 = m.stats?.p2;
  const c = p?.components ?? {};
  const bar = p?.published ? `<div class="tn-bar" role="img" aria-label="Probabilità ${pct(p.p1)} contro ${pct(p.p2)}"><span class="a" style="width:${(p.p1 * 100).toFixed(1)}%">${pct(p.p1)}</span><span class="b" style="width:${(p.p2 * 100).toFixed(1)}%">${pct(p.p2)}</span></div>` : "";
  const reasons = p?.reasons?.length ? `<h4>Motivazioni</h4><ul class="tn-ul">${p.reasons.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>` : "";
  const missing = p?.missing?.length ? `<p class="tn-note"><b>Dati mancanti:</b> ${esc(p.missing.join(", "))}: il modello li ha ignorati, non inventati.</p>` : "";
  const comps = p ? `<table class="tn-table"><tbody>${COMPONENT_LABELS.filter(([k]) => k in c && c[k] != null).map(([k, l, f]) => `<tr><th>${esc(l)}</th><td colspan="2">${esc(f(c[k]))}</td></tr>`).join("")}${"n1" in c ? `<tr><th>Partite nello storico</th><td>${esc(c.n1)}</td><td>${esc(c.n2)}</td></tr>` : ""}</tbody></table>` : "";
  const stats = s1 || s2 ? `<table class="tn-table"><thead><tr><th></th><th>${esc(m.p1.name)}</th><th>${esc(m.p2.name)}</th></tr></thead><tbody>${statsRow("Punti vinti al servizio", s1?.serve, s2?.serve, (v) => pct(v, 1))}${statsRow("Punti vinti in risposta", s1?.ret, s2?.ret, (v) => pct(v, 1))}</tbody></table><p class="tn-note">Statistiche di carriera lette il ${esc(ago(s1?.fetchedAt ?? s2?.fetchedAt))} (valori di oggi, non storici).</p>` : `<p class="tn-note">Statistiche di servizio e risposta non disponibili per questi giocatori.</p>`;
  const h2h = m.h2h && (m.h2h.p1Wins || m.h2h.p2Wins) ? `<p class="tn-note">${esc(m.p1.name)} ${esc(m.h2h.p1Wins)} – ${esc(m.h2h.p2Wins)} ${esc(m.p2.name)}</p>` : `<p class="tn-note">Nessuno scontro diretto registrato dal provider.</p>`;
  const verdict = !p ? `<p class="tn-note">Il pronostico non è ancora stato calcolato.</p>` : p.published ? `<div class="tn-verdict"><b>Pronostico ${p.pick}: ${esc(nameOf(m, p.pick))}</b>${relTag(p.reliability)}</div>` : `<div class="tn-verdict none"><b>Nessun pronostico</b><span>${esc(p.abstainReason ?? "Dati insufficienti.")}</span></div>`;
  const pl = (x) => `<tr><th>${nm(x)}</th><td>${x.rank ? `#${esc(x.rank)}` : "n.d."}</td><td>${x.points != null ? esc(x.points) : "n.d."}</td><td>${x.seed ? esc(x.seed) : "—"}</td></tr>`;
  const players = `<table class="tn-table"><thead><tr><th>Giocatore</th><th>Ranking</th><th>Punti</th><th>Testa di serie</th></tr></thead><tbody>${pl(m.p1)}${pl(m.p2)}</tbody></table>`;
  const prov = m.provenance ? `<p class="tn-note">Fonte: SportsAPI365 (${esc(m.provenance.endpoint ?? "n.d.")}), letto il ${esc(ago(m.provenance.fetchedAt))}.</p>` : "";
  const live = m.status === "live" ? liveScore(m) : "";
  const final = (m.status === "finished" && m.score) || m.status === "ended_other" ? `<p class="tn-final"><b>${esc(m.score ?? RESULT_TYPE_LABEL(m.resultType))}</b>${m.status === "finished" && m.winner ? ` · ha vinto ${esc(nameOf(m, m.winner))}` : ` · ${esc(RESULT_TYPE_LABEL(m.resultType))}: non conta come vittoria regolare`}</p>` : "";
  const done = m.status === "finished" || m.status === "ended_other";
  const centre = done && m.score ? `<strong class="af-big sm">${esc(m.score)}</strong>` : `<strong class="af-big">${esc(timeOf2(m))}</strong>`;
  const hero = matchHeader({ home: m.p1.name, away: m.p2.name, chips: [`${m.tour.toUpperCase()} · ${categoryLabel(m)}`, surfaceLabel(m), m.tournament, m.round].filter(Boolean), centre, sub: dateLabel(m.startsAt) });
  const saveBtn = canSave(m) ? `<button class="save${saved ? " done" : ""}" type="button" data-save-detail="${esc(m.key)}"${saved ? " disabled" : ""}>${saved ? "✓ Salvata" : "Salva giocata"}</button>` : "";
  return `${hero}
    <div class="tn-chips">${statusTag(m)}${betTag(m)}${relTag(p?.reliability)}${m.p1.rank || m.p2.rank ? `<span class="tn-chip">Ranking ${esc(m.p1.rank ?? "n.d.")} · ${esc(m.p2.rank ?? "n.d.")}</span>` : ""}</div>
    ${live}${final}<section class="rec-sec"><h4>Cosa giocare</h4>${verdict}${bar}${saveBtn ? `<div class="pv-btns">${saveBtn}</div>` : ""}</section>
    ${sec("Motivazioni e dati usati", `${reasons}${comps}${missing}`, true)}
    ${sec("Quote, EV e BET / EVITA", betBlock(m), true)}
    ${sec("Giocatori", players)}
    ${sec("Statistiche di servizio e risposta", stats)}
    ${sec("Scontri diretti", h2h)}
    ${sec("Provenienza dei dati", prov)}
    <p class="tn-disc">Stima statistica, non una garanzia di vittoria. ${p?.computedAt ? `Pronostico registrato il ${esc(when(p.computedAt))} (modello ${esc(p.modelVersion ?? "n.d.")}) e non modificato dopo l'inizio della partita.` : ""}</p>`;
}

// ───────── Diagnostica ─────────
const kv = (k, v) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`;
const dt = (iso) => (iso ? esc(when(iso)) : "mai");
const age = (min) => (min == null ? "" : min < 90 ? ` (${min} min fa)` : ` (${Math.round(min / 60)} h fa)`);
export function diagnosticsHtml(d, builtAt) {
  if (!d) return `<div class="tn-empty"><div class="tn-ball" aria-hidden="true"></div><h2>Diagnostica non disponibile</h2><p>Compare dopo la prima sincronizzazione.</p></div>`;
  const pr = d.provider ?? {}, q = pr.quota, c = d.counts ?? {}, jobs = d.jobs ?? {};
  const jobRow = (label, j) => kv(label, j ? `${j.lastOk ? `ultimo successo ${dt(j.lastOk)}${age(j.okAgeMin)}` : "nessun successo"}${j.lastError ? `<br><small class="tn-bad">Ultimo errore: ${esc(j.lastError)}</small>` : ""}` : "mai eseguito");
  const cats = Object.entries(c.byCategory ?? {}).map(([k, v]) => `${esc(CATEGORY_LABEL[k] ?? k)}: ${esc(v)}`).join(" · ") || "—";
  const errs = (d.errors ?? []).length ? `<ul class="tn-ul">${d.errors.map((e) => `<li><small>${dt(e.at)} · ${esc(e.job)}</small> ${esc(e.message)}</li>`).join("")}</ul>` : `<p class="tn-note">Nessun errore recente registrato.</p>`;
  return `<div class="tn-dg">
    <h4>Provider</h4><table class="tn-table"><tbody>${kv("Stato", esc(pr.status ?? "n.d."))}${kv("Provider", esc(pr.name ?? ""))}${kv("Ultima richiesta", dt(pr.lastRequestAt))}${kv("Ultima sincronizzazione riuscita", dt(pr.lastOkAt))}${kv("Quota residua", q?.remaining != null ? `${esc(q.remaining)} su ${esc(q.limit ?? "n.d.")}${q.resetAt ? `<br><small>rinnovo ${dt(q.resetAt)}</small>` : ""}` : "non ancora letta")}${kv("Richieste registrate oggi", esc(pr.requestsToday ?? 0))}</tbody></table>
    <h4>Aggiornamenti automatici</h4><table class="tn-table"><tbody>${jobRow("Live (ogni 15 min)", jobs.live)}${jobRow("Partite e pronostici (ogni 30 min)", jobs.refresh)}${jobRow("Ranking e statistiche (ogni giorno)", jobs.static)}${kv("Ultima snapshot", dt(d.snapshot?.builtAt ?? builtAt))}</tbody></table>
    <h4>Dati disponibili</h4><table class="tn-table"><tbody>${kv("Partite nella finestra", esc(c.matchesWindow ?? 0))}${kv("Per categoria", cats)}${kv("Uomini · Donne", `${esc(c.byTour?.atp ?? 0)} · ${esc(c.byTour?.wta ?? 0)}`)}${kv("Live · programmate · concluse", `${esc(c.live ?? 0)} · ${esc(c.scheduled ?? 0)} · ${esc(c.finished ?? 0)}`)}${kv("Con quote", esc(c.withOdds ?? 0))}${kv("Pronostici · astensioni · BET", `${esc(c.predictionsPublished ?? 0)} · ${esc(c.abstained ?? 0)} · ${esc(c.bet ?? 0)}`)}${kv("Giocatori noti", esc(c.players ?? "n.d."))}${kv("Con statistiche di servizio", esc(c.playersWithStats ?? "n.d."))}${kv("Ranking ATP · WTA", `${esc(c.rankedAtp ?? 0)} · ${esc(c.rankedWta ?? 0)}`)}</tbody></table>
    <h4>Errori recenti</h4>${errs}
    <h4>Limitazioni</h4><ul class="tn-ul">${(d.limits ?? []).map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
    <p class="tn-note">Nessuna credenziale è mostrata o inviata al browser: il provider si interroga solo dagli aggiornamenti automatici.</p></div>`;
}
