// Stay Live Tennis — giocate di valore e multiple consigliate. Funzioni pure (le multiple le costruisce solo da giocate già «BET»).
import { esc, pct, num, dayKey, fmtTime, dayParts } from "../format.js";

/** Per le multiple si usano solo gambe molto probabili: tre gambe al 75% valgono circa il 42%, per questo massimo tre e probabilità congiunta almeno 50%. */
export const VALUE = { multiMinProb: 0.75, maxLegs: 3, minJointProb: 0.5, minTotalOdds: 1.7, minEv: 0.03, horizonH: 30, poolSize: 7 };

const slotName = (m) => (m.prediction?.pick === 1 ? m.p1.name : m.p2.name);
const slotProb = (m) => (m.prediction?.pick === 1 ? m.prediction.p1 : m.prediction.p2);

/** Singole di valore: pronostico pubblicato, verdetto BET, partita non ancora iniziata. */
export function valueSingles(matches, now = Date.now()) {
  return (matches ?? []).filter((m) => m.status === "scheduled" && Date.parse(m.startsAt) > now && m.prediction?.published && m.bet?.verdict === "BET" && m.bet.odds > 1 && slotProb(m) > 0)
    .map((m) => ({ key: m.key, name: slotName(m), vs: m.prediction.pick === 1 ? m.p2.name : m.p1.name, tournament: m.tournament, startsAt: m.startsAt, p: slotProb(m), odds: m.bet.odds, ev: m.bet.ev }))
    .sort((a, b) => b.p - a.p || b.odds - a.odds);
}

const combos = (list, k) => (k === 0 ? [[]] : list.flatMap((x, i) => combos(list.slice(i + 1), k - 1).map((r) => [x, ...r])));

/** Multiple (doppia e tripla): gambe molto probabili, entro l'orizzonte, tornei diversi se possibile; si sceglie la più probabile con valore atteso positivo. */
export function valueMultiples(singles, now = Date.now(), cfg = VALUE) {
  const pool = singles.filter((s) => s.p >= cfg.multiMinProb && Date.parse(s.startsAt) - now <= cfg.horizonH * 3600e3).slice(0, cfg.poolSize);
  const out = [];
  for (const k of [2, 3]) {
    if (k > cfg.maxLegs) continue;
    const best = combos(pool, k).map((legs) => {
      const joint = legs.reduce((a, l) => a * l.p, 1), odds = legs.reduce((a, l) => a * l.odds, 1), sameTournament = new Set(legs.map((l) => l.tournament)).size < legs.length;
      return { legs, joint, odds, ev: joint * odds - 1, sameTournament };
    }).filter((c) => c.joint >= cfg.minJointProb && c.odds >= cfg.minTotalOdds && c.ev >= cfg.minEv)
      .sort((a, b) => Number(a.sameTournament) - Number(b.sameTournament) || b.joint - a.joint)[0];
    if (best) out.push({ kind: k === 2 ? "Doppia" : "Tripla", ...best });
  }
  return out;
}

const when = (iso) => `${dayParts(dayKey(iso)).dm} ${fmtTime.format(new Date(iso))}`;
const legHtml = (l) => `<li><span>${esc(l.name)} <small>contro ${esc(l.vs)} · ${esc(l.tournament ?? "")} · ${esc(when(l.startsAt))}</small></span><b>${pct(l.p)} · ${num(l.odds)}</b></li>`;

/** Scheda «Giocate di valore» (in cima alla scheda Strategia). */
export function valueCardHtml(matches, now = Date.now()) {
  const singles = valueSingles(matches, now), multi = valueMultiples(singles, now);
  const empty = `<p class="sd-p">Nessuna giocata di valore al momento. Compaiono solo con probabilità almeno del 70%, quota sopra 1,30 e valore atteso positivo; si aggiornano a ogni giro.</p>`;
  const singlesHtml = singles.length ? `<h4>Singole</h4><ul class="sd-rows">${singles.slice(0, 8).map(legHtml).join("")}</ul>` : "";
  const multiHtml = multi.map((c) => `<h4>${esc(c.kind)} consigliata</h4><ul class="sd-rows">${c.legs.map(legHtml).join("")}</ul><p class="sd-meta">Probabilità che escano tutte <b>${pct(c.joint)}</b> · quota totale <b>${num(c.odds)}</b> · valore atteso <b>+${(c.ev * 100).toFixed(1).replace(".", ",")}%</b>${c.sameTournament ? " · gambe dello stesso torneo" : ""}</p>`).join("");
  const note = singles.length && !multi.length ? `<p class="sd-meta">Nessuna multipla: servono gambe almeno al 75% con probabilità congiunta almeno del 50%.</p>` : "";
  return `<section class="sd-card"><header><h3>Giocate di valore</h3></header>${singles.length ? singlesHtml + multiHtml + note : empty}<p class="sd-meta">Probabilità dal mercato corretta per la sottostima dei favoriti; stima su due settimane di dati, non una garanzia.</p></section>`;
}
