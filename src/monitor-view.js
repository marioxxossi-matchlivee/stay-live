// Sezione «Affidabilità»: solo HTML (funzioni pure, testabili). I calcoli sono in functions/api/_monitor.js.
import { esc, pct, num } from "./format.js";

export const P = (v, d = 0) => (v == null || !Number.isFinite(v) ? "—" : pct(v, d));
export const pt = (v) => (v == null || !Number.isFinite(v) ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(1).replace(".", ",")} pt`);
const ci = (s) => (s.ci ? `tra ${P(s.ci.lo)} e ${P(s.ci.hi)}` : "");
const dateIt = (iso) => (iso ? new Date(iso).toLocaleDateString("it-IT", { timeZone: "Europe/Rome", day: "numeric", month: "short", year: "numeric" }) : "—");

const bar = (rate, target, label) => `<div class="mn-bar" role="img" aria-label="${esc(label)}"><i style="width:${Math.max(0, Math.min(100, (rate ?? 0) * 100)).toFixed(1)}%"></i>${target != null ? `<b style="left:${Math.max(0, Math.min(100, target * 100)).toFixed(1)}%" title="Dichiarato dal modello"></b>` : ""}</div>`;

/** Scheda di un gruppo (BET o EVITA): percentuale reale, incertezza, dichiarato e soglia prudente. */
export function groupCard(title, s, { note = "", verdict = "", min = 300 } = {}) {
  if (!s.n) return `<section class="mn-card"><h3>${esc(title)}</h3><p class="mn-empty">Ancora nessun caso concluso.</p>${note ? `<p class="mn-note">${esc(note)}</p>` : ""}</section>`;
  return `<section class="mn-card"><h3>${esc(title)}</h3>
    <div class="mn-big"><b>${P(s.rate)}</b><span>${s.won} centrati su ${s.n}</span></div>
    ${bar(s.rate, s.claimed, `Percentuale reale ${P(s.rate)}`)}
    <dl class="mn-kv"><div><dt>Intervallo al 95%</dt><dd>${esc(ci(s))}</dd></div>${s.claimed != null ? `<div><dt>Dichiarato dal modello</dt><dd>${P(s.claimed)}</dd></div>` : ""}${s.floor != null ? `<div><dt>Soglia prudente</dt><dd>${P(s.floor)}</dd></div>` : ""}${s.gap != null ? `<div><dt>Scarto reale − dichiarato</dt><dd>${esc(pt(s.gap))}</dd></div>` : ""}${s.roi != null ? `<div><dt>Rendimento a quota reale (${s.roiN} quotate)</dt><dd>${esc(pt(s.roi))}</dd></div>` : ""}</dl>
    ${s.n < min ? `<p class="mn-prog">Campione: ${s.n} su ${min} necessari per un giudizio solido.<span><i style="width:${Math.min(100, (s.n / min) * 100).toFixed(0)}%"></i></span></p>` : ""}
    ${verdict ? `<p class="mn-verdict">${esc(verdict)}</p>` : ""}${note ? `<p class="mn-note">${esc(note)}</p>` : ""}</section>`;
}

const calRows = (cal) => cal.filter((b) => b.n).map((b) => `<tr><th>${P(b.lo)}–${P(b.hi)}</th><td>${b.n}</td><td>${P(b.claimed, 1)}</td><td>${P(b.rate, 1)}</td><td class="${b.rate - b.claimed < -0.05 ? "bad" : b.rate - b.claimed > 0.05 ? "good" : ""}">${esc(pt(b.rate - b.claimed))}</td></tr>`).join("");
export const calTable = (cal) => (cal.some((b) => b.n) ? `<div class="mn-scroll"><table class="mn-table"><thead><tr><th>Fascia</th><th>Casi</th><th>Dichiarato</th><th>Reale</th><th>Scarto</th></tr></thead><tbody>${calRows(cal)}</tbody></table></div>` : "");

export function liveHtml(d) {
  const r = d.registered, concluded = d.picks.bet.n + d.picks.evita.n;
  const head = `<section class="mn-card"><h3>Pronostici registrati</h3>
    <div class="mn-kpis"><div><b>${r.partite}</b><span>partite registrate</span></div><div><b>${r.concluse}</b><span>concluse</span></div><div><b>${r.in_attesa}</b><span>in attesa</span></div><div><b>${r.rinviate_o_annullate + r.non_valutabili + r.senza_risultato}</b><span>non valutabili</span></div></div>
    <p class="mn-note">Ogni pronostico è salvato prima del calcio d'inizio e non si modifica più. ${d.since ? `Dal ${esc(dateIt(d.since))}.` : ""} Le percentuali contano tutte le versioni del modello (il dettaglio è in fondo).</p></section>`;
  const bet = groupCard("BET · le scelte consigliate", d.picks.bet, { verdict: d.picks.judgeBet, min: d.minSample });
  const evita = groupCard("EVITA · le scelte sconsigliate", d.picks.evita, { note: "EVITA non significa che perde: significa che il modello non la ritiene una giocata conveniente. Si misura se escono meno dei BET.", min: d.minSample });
  const cmp = concluded ? `<section class="mn-card mn-cmp"><h3>BET contro EVITA</h3><p class="mn-verdict">${esc(d.picks.judgeEvita)}</p>${d.picks.betVsEvita != null ? `<p class="mn-note">Differenza BET − EVITA: ${esc(pt(d.picks.betVsEvita))}.</p>` : ""}</section>` : "";
  const t = d.legs.total;
  const all = t.n ? `<section class="mn-card"><h3>Tutte le selezioni (14 esiti per partita)</h3>
    <div class="mn-kpis"><div><b>${t.n}</b><span>esiti valutati</span></div><div><b>${P(t.rate, 1)}</b><span>usciti</span></div><div><b>${P(t.claimed, 1)}</b><span>dichiarato</span></div><div><b>${num(t.brier, 3)}</b><span>Brier</span></div></div>
    <p class="mn-note">Se «usciti» e «dichiarato» sono vicini, le percentuali del modello sono credibili sull'insieme. Riferimenti: Brier 0,250 e log loss 0,693 sono il lancio di moneta.</p>
    <h4>Taratura: dichiarato contro reale</h4>${calTable(d.legs.calibration)}
    <h4>Per tipo di esito</h4><div class="mn-scroll"><table class="mn-table"><thead><tr><th>Esito</th><th>Casi</th><th>Dichiarato</th><th>Reale</th><th>Scarto</th></tr></thead><tbody>${d.legs.byMarket.map((m) => `<tr><th>${esc(m.label)}</th><td>${m.n}</td><td>${P(m.claimed, 1)}</td><td>${P(m.rate, 1)}</td><td>${esc(pt(m.gap))}</td></tr>`).join("")}</tbody></table></div></section>` : "";
  const ver = d.byVersion.length ? `<section class="mn-card"><h3>Per versione del modello</h3><div class="mn-scroll"><table class="mn-table"><thead><tr><th>Versione</th><th>BET</th><th>EVITA</th><th>Esiti</th></tr></thead><tbody>${d.byVersion.map((v) => `<tr><th>${esc(v.ver)}${v.current ? " · attuale" : ""}</th><td>${v.bet.n ? `${v.bet.won}/${v.bet.n} (${P(v.bet.rate)})` : "—"}</td><td>${v.evita.n ? `${v.evita.won}/${v.evita.n} (${P(v.evita.rate)})` : "—"}</td><td>${v.legs.n}</td></tr>`).join("")}</tbody></table></div><p class="mn-note">Ogni modifica al modello cambia la versione: i casi di versioni diverse non sono del tutto confrontabili.</p></section>` : "";
  return head + bet + evita + cmp + all + ver;
}

export function backtestHtml(b) {
  if (!b) return `<div class="mn-emptybox"><h3>Rapporto storico non ancora calcolato</h3><p>Riproduce il modello sull'intero archivio di partite finali, giorno per giorno, vedendo solo il passato. Si genera da GitHub Actions («Backtest affidabilità (BET + EVITA)»): ogni domenica in automatico, oppure a mano.</p></div>`;
  const r = b.evitaByReason ?? {};
  const reason = (label, s) => `<tr><th>${esc(label)}</th><td>${s.n}</td><td>${P(s.rate, 1)}</td><td>${s.ci ? `${P(s.ci.lo)}–${P(s.ci.hi)}` : "—"}</td><td>${P(s.claimed, 1)}</td><td>${P(s.base, 1)}</td></tr>`;
  return `<section class="mn-card"><h3>Archivio storico</h3>
    <div class="mn-kpis"><div><b>${b.matches.toLocaleString("it-IT")}</b><span>partite finali</span></div><div><b>${b.analyzed.toLocaleString("it-IT")}</b><span>analizzate</span></div><div><b>${b.bet.n}</b><span>BET</span></div><div><b>${b.evita.n}</b><span>EVITA</span></div></div>
    <p class="mn-note">Dal ${esc(dateIt(b.from))} al ${esc(dateIt(b.to))}. Primo ${Math.round((b.warmup ?? 0) * 100)}% dell'archivio usato solo per il rodaggio. Calcolato il ${esc(dateIt(b.builtAt ?? b.generatedAt))}. ${esc(b.method ?? "")}.</p></section>
    ${groupCard("BET nello storico", b.bet, { min: 300 })}${groupCard("EVITA nello storico", b.evita, { min: 300 })}
    <section class="mn-card"><h3>EVITA per motivo</h3><div class="mn-scroll"><table class="mn-table"><thead><tr><th>Motivo</th><th>Casi</th><th>Reale</th><th>Int. 95%</th><th>Dichiarato</th><th>Media camp.</th></tr></thead><tbody>${reason("Probabilità prudente sotto soglia", r.soglia ?? { n: 0 })}${reason("In linea con la media del campionato", r.edge ?? { n: 0 })}${reason("Campione troppo piccolo", r.campione ?? { n: 0 })}</tbody></table></div></section>
    <section class="mn-card"><h3>Taratura sull'archivio</h3><p class="mn-note">${b.calibration.n.toLocaleString("it-IT")} esiti · errore di taratura medio ${num(b.calibration.ece, 3)} · Brier ${num(b.calibration.brier, 3)}.</p>
    <div class="mn-scroll"><table class="mn-table"><thead><tr><th>Fascia</th><th>Casi</th><th>Dichiarato</th><th>Reale</th><th>Scarto</th></tr></thead><tbody>${b.calibration.table.map((x) => `<tr><th>${P(x.lo)}–${P(x.hi)}</th><td>${x.n}</td><td>${P(x.predicted, 1)}</td><td>${P(x.observed, 1)}</td><td>${esc(pt(x.observed - x.predicted))}</td></tr>`).join("")}</tbody></table></div></section>
    ${b.byConfidence?.length ? `<section class="mn-card"><h3>Per livello di fiducia</h3><div class="mn-scroll"><table class="mn-table"><thead><tr><th>Livello</th><th>Casi</th><th>Reale</th><th>Dichiarato</th></tr></thead><tbody>${b.byConfidence.map((x) => `<tr><th>${esc(x.label)}</th><td>${x.n}</td><td>${P(x.rate, 1)}</td><td>${P(x.claimed, 1)}</td></tr>`).join("")}</tbody></table></div></section>` : ""}
    <p class="mn-note mn-limit">${esc(b.limits ?? "")}</p>`;
}

export function monitorHtml(d, tab = "live") {
  const hist = d.backtest ? `Storico · ${d.backtest.matches.toLocaleString("it-IT")}` : "Storico";
  return `<div class="mn-seg" id="mn-tabs" style="--i:${tab === "live" ? 0 : 1}" role="group" aria-label="Sezione"><button type="button" data-mn="live" aria-pressed="${tab === "live"}">Dal vivo · ${d.registered.partite}</button><button type="button" data-mn="hist" aria-pressed="${tab === "hist"}">${esc(hist)}</button></div>${tab === "live" ? liveHtml(d) : backtestHtml(d.backtest)}`;
}

