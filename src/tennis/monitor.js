// Stay Live Tennis — scheda «Affidabilità»: stessa struttura e stesse schede di quella del calcio (src/monitor-view.js).
// Calcola tutto dai pronostici registrati prima dell'inizio (history.rows): nessun numero inventato, ciò che manca resta «—».
import { esc, pct, num } from "../format.js";
import { bucket } from "../efficiency.js";
import { groupCard, calTable, P, pt } from "../monitor-view.js";
import { SURFACE_LABEL, CATEGORY_LABEL } from "./board.js";

const favP = (r) => (r.pick === 1 ? r.p1 : 1 - r.p1);
const leg = (r) => ({ status: r.hit ? "won" : "lost", p: favP(r), pLow: null, odds: r.bet?.odds ?? null });
const done = (rows) => rows.filter((r) => r.published && r.hit !== null);

/** Statistiche di un gruppo di righe nel formato di groupCard (claimed = media della probabilità dichiarata). */
export function statOf(rows) {
  const b = bucket(rows.map(leg));
  return { ...b, claimed: b.expected, gap: b.rate != null && b.expected != null ? b.rate - b.expected : null };
}

/** Taratura per fasce di probabilità del favorito. */
export function calibration(rows) {
  const edges = [0.5, 0.6, 0.7, 0.8, 1.0001];
  return edges.slice(0, -1).map((lo, i) => {
    const hi = edges[i + 1], ls = rows.filter((r) => favP(r) >= lo && favP(r) < hi).map(leg), b = bucket(ls);
    return { lo, hi: Math.min(hi, 1), n: b.n, claimed: b.expected, rate: b.rate };
  }).filter((b) => b.n);
}

/** Righe per gruppo (superficie, circuito, categoria): casi, dichiarato, reale, scarto. */
export function breakdown(rows) {
  const out = [];
  const add = (label, list) => { if (list.length) out.push({ label, ...statOf(list) }); };
  for (const [k, l] of Object.entries(SURFACE_LABEL)) add(l, rows.filter((r) => r.surface === k));
  for (const t of ["atp", "wta"]) add(t.toUpperCase(), rows.filter((r) => r.tour === t));
  for (const [k, l] of Object.entries(CATEGORY_LABEL)) add(l, rows.filter((r) => r.category === k));
  return out;
}

const versions = (rows) => {
  const m = new Map();
  for (const r of rows) { const v = r.modelVersion ?? "n.d."; (m.get(v) ?? m.set(v, []).get(v)).push(r); }
  return [...m].map(([ver, list]) => ({ ver, picks: statOf(done(list)), bet: statOf(done(list).filter((r) => r.bet?.verdict === "BET")) }));
};

export function liveHtml(h) {
  const rows = h?.rows ?? [], conc = done(rows), pending = rows.filter((r) => r.published && r.hit === null).length, abst = rows.filter((r) => !r.published).length;
  const head = `<section class="mn-card"><h3>Pronostici registrati</h3>
    <div class="mn-kpis"><div><b>${rows.length}</b><span>partite registrate</span></div><div><b>${conc.length}</b><span>concluse</span></div><div><b>${pending}</b><span>in attesa</span></div><div><b>${abst}</b><span>astenute</span></div></div>
    <p class="mn-note">Ogni pronostico è salvato prima dell'inizio e non si modifica più. Il modello si astiene quando i dati non bastano: le astensioni non contano né come vinte né come perse.</p></section>`;
  if (!conc.length) return head + `<div class="mn-emptybox"><h3>Ancora nessun caso concluso</h3><p>Le percentuali compaiono man mano che le partite finiscono.</p></div>`;
  const picks = groupCard("Pronostici · il vincitore", statOf(conc), { verdict: h.verdict ?? "" , min: h.minSample ?? 300 });
  const betRows = conc.filter((r) => r.bet?.verdict === "BET" && Number.isFinite(r.bet.odds));
  const bet = groupCard("BET · le scelte con quota conveniente", statOf(betRows), { min: 300, note: betRows.length ? "" : "Nessun BET concluso con quota reale." });
  const avoidRows = conc.filter((r) => r.bet && r.bet.verdict !== "BET");
  const avoid = avoidRows.length ? groupCard("EVITA · le scelte sconsigliate", statOf(avoidRows), { note: "EVITA non significa che perde: significa che a quella quota non conviene. Si misura se escono meno dei BET.", min: 300 }) : "";
  const cal = calibration(conc), bd = breakdown(conc);
  const all = `<section class="mn-card"><h3>Tutti i pronostici</h3>
    <div class="mn-kpis"><div><b>${conc.length}</b><span>valutati</span></div><div><b>${P(statOf(conc).rate, 1)}</b><span>centrati</span></div><div><b>${P(statOf(conc).claimed, 1)}</b><span>dichiarato</span></div><div><b>${num(h.summary?.brier, 3)}</b><span>Brier</span></div></div>
    <p class="mn-note">Se «centrati» e «dichiarato» sono vicini, le percentuali del modello sono credibili. Riferimenti: Brier 0,250 e log loss 0,693 sono il lancio di moneta.</p>
    ${cal.length ? `<h4>Taratura: dichiarato contro reale</h4>${calTable(cal)}` : ""}
    ${bd.length ? `<h4>Per tipo di partita</h4><div class="mn-scroll"><table class="mn-table"><thead><tr><th>Gruppo</th><th>Casi</th><th>Dichiarato</th><th>Reale</th><th>Scarto</th></tr></thead><tbody>${bd.map((m) => `<tr><th>${esc(m.label)}</th><td>${m.n}</td><td>${P(m.claimed, 1)}</td><td>${P(m.rate, 1)}</td><td>${esc(pt(m.gap))}</td></tr>`).join("")}</tbody></table></div>` : ""}</section>`;
  const vs = versions(rows).filter((v) => v.picks.n);
  const ver = vs.length > 1 || (vs.length === 1 && vs[0].ver !== "n.d.") ? `<section class="mn-card"><h3>Per versione del modello</h3><div class="mn-scroll"><table class="mn-table"><thead><tr><th>Versione</th><th>Pronostici</th><th>BET</th></tr></thead><tbody>${vs.map((v) => `<tr><th>${esc(v.ver)}</th><td>${v.picks.won}/${v.picks.n} (${P(v.picks.rate)})</td><td>${v.bet.n ? `${v.bet.won}/${v.bet.n} (${P(v.bet.rate)})` : "—"}</td></tr>`).join("")}</tbody></table></div><p class="mn-note">Ogni modifica al modello cambia la versione: i casi di versioni diverse non sono del tutto confrontabili.</p></section>` : "";
  const cmp = betRows.length && avoidRows.length ? `<section class="mn-card mn-cmp"><h3>BET contro EVITA</h3><p class="mn-verdict">${esc(statOf(betRows).rate > statOf(avoidRows).rate ? "I BET escono più spesso degli EVITA: la distinzione funziona." : "I BET non escono più spesso degli EVITA: per ora la distinzione non aggiunge nulla.")}</p><p class="mn-note">Differenza BET − EVITA: ${esc(pt(statOf(betRows).rate - statOf(avoidRows).rate))}.</p></section>` : "";
  return head + picks + bet + avoid + cmp + all + ver;
}

export function backtestHtml(b) {
  if (!b || !b.published) return `<div class="mn-emptybox"><h3>Rapporto storico non ancora calcolato</h3><p>Riproduce il modello sulle partite già giocate, una alla volta, vedendo solo il passato. Compare dopo il primo scaricamento dello storico${b?.matches ? ` (${b.matches} partite finora)` : ""}.</p></div>`;
  const s = b.summary ?? {};
  return `<section class="mn-card"><h3>Archivio storico</h3>
    <div class="mn-kpis"><div><b>${Number(b.matches ?? 0).toLocaleString("it-IT")}</b><span>partite scaricate</span></div><div><b>${Number(b.published).toLocaleString("it-IT")}</b><span>con pronostico</span></div><div><b>${Number(b.abstained ?? 0).toLocaleString("it-IT")}</b><span>astenute</span></div><div><b>${P(s.accuracy, 1)}</b><span>centrati</span></div></div>
    <p class="mn-note">Modello ${esc(b.modelVersion ?? "n.d.")}, ${esc(b.verdict ?? "")}. Brier ${num(s.brier, 3)} · log loss ${num(s.logLoss, 3)} (lancio di moneta: 0,250 e 0,693). Ogni partita è prevista con i soli dati precedenti: nessuna informazione dal futuro.</p></section>`;
}

export function tennisMonitorHtml(h, tab = "live") {
  const n = (h?.rows ?? []).length;
  const hist = h?.backtest?.matches ? `Storico · ${Number(h.backtest.matches).toLocaleString("it-IT")}` : "Storico";
  return `<div class="mn-seg" id="tn-mn-tabs" style="--i:${tab === "live" ? 0 : 1}" role="group" aria-label="Sezione"><button type="button" data-mn="live" aria-pressed="${tab === "live"}">Dal vivo · ${n}</button><button type="button" data-mn="hist" aria-pressed="${tab === "hist"}">${esc(hist)}</button></div>${tab === "live" ? liveHtml(h) : backtestHtml(h?.backtest)}`;
}

/** Scheda breve per la vista Giocate: BET dell'app, stessa di quella del calcio. */
export function betSummaryHtml(h) {
  const rows = done(h?.rows ?? []), bets = rows.filter((r) => r.bet?.verdict === "BET" && Number.isFinite(r.bet.odds));
  return groupCard("Affidabilità dei BET dell'app", statOf(bets), { min: 300, note: bets.length ? "" : "Nessun BET concluso con quota reale: le percentuali compaiono man mano che le partite finiscono." });
}
