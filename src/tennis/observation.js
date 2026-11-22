// Stay Live Tennis — LIVE OBSERVATION dentro «Affidabilità»: modello dei dati e HTML (puri, nessun DOM: si testano con node --test).
// Mostra SOLO ciò che è stato registrato prima dell'inizio; le metriche usano la sola valutazione iniziale (rev 1). Descrittivo: nessuna indicazione di gioco.
import { esc, pct, num, TZ } from "../format.js";
import { observationState, prospectiveMetrics, revisionStats } from "../../functions/api/_tennis-observation.js";

export const LO_TABS = [["overview", "Panoramica"], ["future", "Future"], ["registered", "Registrate"], ["done", "Concluse"], ["metrics", "Metriche"]];
export const STATE_LABEL = { upcoming: "Da giocare", awaiting_result: "In attesa del risultato", live: "In corso", concluded: "Conclusa", postponed: "Rinviata", cancelled: "Annullata", interrupted: "Sospesa", ended_other: "Ritiro o walkover", identity_mismatch: "Incongruenza degli id", unknown: "Stato non noto" };
const REASON_LABEL = { ratings_version: "Rating (storico) aggiornato", initial: "Valutazione iniziale", rescheduled: "Orario cambiato", model_version: "Nuova versione del modello", publication: "Pubblicazione cambiata", probability: "Probabilità cambiata", missing_data: "Dati mancanti cambiati" };
const fmt = new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: TZ });
const when = (t) => (t ? fmt.format(new Date(t)) : "—");
export const DEFAULT_LO = Object.freeze({ open: false, tab: "overview", rows: 25, data: null, loading: false, error: null, openKey: null, f: { state: "all", tournament: "all", surface: "all", model: "all", q: "" } });

/** Dal payload dell'API a righe pronte (iniziale = rev 1, ultima, stato dal collegamento per match_key). */
export function buildModel(payload, now = Date.now()) {
  if (!payload?.available) return { available: false, reason: payload?.reason ?? "Non disponibile.", items: [], diagnostics: payload?.diagnostics ?? null };
  const byKey = new Map(); for (const v of payload.versions ?? []) (byKey.get(v.match_key) ?? byKey.set(v.match_key, []).get(v.match_key)).push(v);
  for (const vs of byKey.values()) vs.sort((a, b) => a.rev - b.rev);
  const items = (payload.observations ?? []).map((o) => {
    const vs = byKey.get(o.match_key) ?? [], initial = vs.find((v) => v.rev === 1) ?? null;
    // La vista SQL calcola già `state`; il ricalcolo locale (stessa regola) tiene lo stato coerente col tempo trascorso dall'ultima lettura.
    const state = o.identity_ok === false ? "identity_mismatch" : observationState(o, { p1_id: o.p1_id, p2_id: o.p2_id, status: o.match_status, winner: o.winner, starts_at: o.match_starts_at }, now);
    return { key: o.match_key, obs: o, versions: vs, initial, last: vs.at(-1) ?? null, state, startsAt: o.match_starts_at ?? o.first_starts_at, winner: o.winner, tournamentId: o.tournament_id, tournament: o.tournament,
      incomplete: !initial || !initial.published || (initial.missing ?? []).length > 0 };
  });
  return { available: true, items, byKey, diagnostics: payload.diagnostics ?? null, total: payload.total ?? null, complete: payload.complete !== false, builtAt: payload.builtAt ?? null };
}

export function filterItems(items, f = DEFAULT_LO.f) {
  const q = String(f.q ?? "").trim().toLowerCase();
  return items.filter((i) => (f.state === "all" || i.state === f.state) && (f.tournament === "all" || i.obs.tournament === f.tournament) && (f.surface === "all" || (i.obs.surface ?? "") === f.surface)
    && (f.model === "all" || i.versions.some((v) => v.model_ver === f.model)) && (!q || `${i.obs.p1_name ?? ""} ${i.obs.p2_name ?? ""}`.toLowerCase().includes(q)));
}

const chip = (s) => `<span class="lo-chip lo-${esc(s)}">${esc(STATE_LABEL[s] ?? s)}</span>`;
const names = (o) => `${esc(o.p1_name ?? o.p1_id)} – ${esc(o.p2_name ?? o.p2_id)}`;
const prob = (v) => (v?.published ? `${pct(v.p1, 0)} / ${pct(v.p2, 0)}` : "astenuta");

function rowHtml(i, open) {
  const v = i.initial;
  return `<article class="lo-row${open ? " open" : ""}"><button type="button" class="lo-head" data-lo-row="${esc(i.key)}" aria-expanded="${open}">
    <span class="lo-t"><b>${names(i.obs)}</b><small>${esc(i.obs.tournament ?? "Torneo n.d.")} · ${esc(i.obs.surface ?? "superficie n.d.")} · ${when(i.startsAt)}</small></span>
    <span class="lo-r">${chip(i.state)}<small>${v ? prob(v) : "nessuna valutazione"}${i.versions.length > 1 ? ` · ${i.versions.length} versioni` : ""}${i.incomplete ? " · dati incompleti" : ""}</small></span></button>${open ? detailHtml(i) : ""}</article>`;
}

/** Dettaglio: generale, valutazione iniziale, dati usati, dati mancanti, cronologia, risultato, confronto e stato della validazione. */
export function detailHtml(i) {
  const v = i.initial, o = i.obs, inp = v?.inputs ?? {}, p1 = inp.p1 ?? {}, p2 = inp.p2 ?? {};
  const cmp = i.state === "concluded" && v?.published ? (() => { const hit = (v.pick === i.winner); return `Valutazione iniziale: ${prob(v)} (favorito: giocatore ${v.pick}). Vincitore: giocatore ${i.winner}${o.score ? ` (${esc(o.score)})` : ""}. ${hit ? "Il favorito ha vinto." : "Il favorito ha perso."} Un singolo esito non dice nulla sulla qualità del modello.`; })()
    : i.state === "concluded" ? "Partita conclusa, ma la valutazione iniziale era un'astensione: esclusa dalle metriche." : i.state === "awaiting_result" ? "Orario superato senza un risultato verificato: la partita NON è considerata conclusa." : i.state === "identity_mismatch" ? "Gli id dei giocatori non coincidono con la partita: nessun collegamento." : "Nessun esito ancora.";
  const valid = i.state === "concluded" && v?.published ? "Entra nelle metriche (solo la valutazione iniziale)." : "Non entra nelle metriche: " + (i.state === "concluded" ? "valutazione iniziale non pubblicata." : "partita non conclusa con un risultato verificato.");
  const kv = (l, a, b) => `<div><dt>${esc(l)}</dt><dd>${esc(a)}</dd><dd>${esc(b)}</dd></div>`;
  return `<div class="lo-detail">
    <h4>Informazioni generali</h4><p class="mn-note">${esc(o.tour?.toUpperCase())} · ${esc(o.category ?? "categoria n.d.")} · registrata il ${when(o.first_recorded_at)} · inizio programmato iniziale ${when(o.first_starts_at)}</p>
    <h4>Valutazione iniziale (permanente)</h4>${v ? `<p class="mn-note">${prob(v)} · affidabilità ${esc(v.reliability ?? "n.d.")} · modello ${esc(v.model_ver)} · ${when(v.recorded_at)}${v.abstain_reason ? ` · ${esc(v.abstain_reason)}` : ""}</p>` : `<p class="mn-note">Nessuna valutazione registrata.</p>`}
    <h4>Dati usati dal modello</h4>${v ? `<p class="lo-legend"><span><i>1</i>${esc(o.p1_name ?? "Giocatore 1")}</span><span><i>2</i>${esc(o.p2_name ?? "Giocatore 2")}</span></p><dl class="lo-kv">
      ${kv("Elo usato", num(v.elo1, 0), num(v.elo2, 0))}${kv("Forma", num(v.form1, 2), num(v.form2, 2))}${kv("Elo generale / superficie", `${num(p1.eloAll, 0)} · ${num(p1.eloSurface, 0)}`, `${num(p2.eloAll, 0)} · ${num(p2.eloSurface, 0)}`)}${kv("Partite di supporto", p1.matches ?? "—", p2.matches ?? "—")}${kv("Ranking", inp.rank?.p1 ?? "—", inp.rank?.p2 ?? "—")}${kv("Punti vinti al servizio", pct(inp.stats?.p1?.serve, 1), pct(inp.stats?.p2?.serve, 1))}${kv("Punti vinti in risposta", pct(inp.stats?.p1?.ret, 1), pct(inp.stats?.p2?.ret, 1))}${kv("Partite nelle statistiche", inp.stats?.p1?.matches ?? "—", inp.stats?.p2?.matches ?? "—")}</dl>
      <p class="mn-note">Scontri diretti: ${inp.h2h ? `${inp.h2h.p1Wins}–${inp.h2h.p2Wins}` : "non disponibili"} · storico caricato: ${esc(v.history_loader ?? "n.d.")}, ${v.history_matches ?? "n.d."} partite · ultima data nello storico ${when(v.history_last_at)} · rating ${esc((v.ratings_ver ?? "n.d.").slice(0, 12))}</p>` : ""}
    <h4>Dati mancanti</h4><p class="mn-note">${(v?.missing ?? []).length ? esc(v.missing.join("; ")) : v ? "Nessuno dichiarato dal modello." : "—"}</p>
    <h4>Cronologia delle valutazioni</h4><ol class="lo-chron">${i.versions.map((x) => `<li><b>rev ${x.rev}</b> · ${when(x.recorded_at)} · ${esc(REASON_LABEL[x.reason] ?? x.reason)} · ${prob(x)} · ${esc(x.model_ver)}</li>`).join("") || "<li>—</li>"}</ol>
    <h4>Risultato e confronto</h4><p class="mn-note">${chip(i.state)} ${cmp}</p>
    <h4>Stato della validazione</h4><p class="mn-note">${esc(valid)}</p></div>`;
}

function filtersHtml(model, f) {
  const opts = (vals, cur, all) => `<option value="all">${all}</option>${vals.map((x) => `<option value="${esc(x)}"${x === cur ? " selected" : ""}>${esc(STATE_LABEL[x] ?? x)}</option>`).join("")}`;
  const models = [...new Set(model.items.flatMap((i) => i.versions.map((v) => v.model_ver)))].sort();
  const uniq = (fn) => [...new Set(model.items.map(fn).filter(Boolean))].sort();
  return `<div class="lo-filters"><select data-lo-f="state" aria-label="Stato">${opts(uniq((i) => i.state), f.state, "Tutti gli stati")}</select><select data-lo-f="tournament" aria-label="Torneo">${opts(uniq((i) => i.obs.tournament), f.tournament, "Tutti i tornei")}</select>
    <select data-lo-f="surface" aria-label="Superficie">${opts(uniq((i) => i.obs.surface), f.surface, "Tutte le superfici")}</select><select data-lo-f="model" aria-label="Versione del modello"><option value="all">Tutte le versioni</option>${models.map((x) => `<option value="${esc(x)}"${x === f.model ? " selected" : ""}>${esc(x)}</option>`).join("")}</select>
    <input type="search" data-lo-f="q" value="${esc(f.q)}" placeholder="Giocatore" aria-label="Giocatore" /></div>`;
}

export const ROWS_STEP = 25;
function listHtml(items, openKey, empty, rows = ROWS_STEP) {
  if (!items.length) return `<div class="mn-emptybox"><h3>${esc(empty)}</h3></div>`;
  const shown = items.slice(0, rows), rest = items.length - shown.length;
  const open = openKey && !shown.some((i) => i.key === openKey) ? items.find((i) => i.key === openKey) : null;   // la riga aperta resta visibile
  return `<div class="lo-list">${shown.concat(open ? [open] : []).map((i) => rowHtml(i, i.key === openKey)).join("")}</div>${rest > 0 ? `<div class="lo-more"><button type="button" data-lo-rows>Mostra altre ${Math.min(ROWS_STEP, rest)} (${rest} nascoste)</button></div>` : `<p class="mn-note">${items.length} ${items.length === 1 ? "partita" : "partite"}.</p>`}`;
}

function metricsHtml(model, lo) {
  const m = prospectiveMetrics(model.items.map((i) => ({ initial: i.initial, state: i.state, winner: i.winner, startsAt: i.startsAt, tournamentId: i.tournamentId, tournament: i.tournament })));
  const ci = (x, d = 3) => (x ? `${num(x.est, d)}${x.lo != null ? ` [${num(x.lo, d)} ; ${num(x.hi, d)}]` : ""}` : "—");
  const rs = revisionStats(model.byKey ?? new Map()), ex = m.excluded;
  const partial = model.complete ? "" : `<p class="mn-verdict">Metriche PARZIALI: calcolate su ${model.items.length}${model.total != null ? ` di ${model.total}` : ""} osservazioni caricate. Carica tutto lo storico per la validazione completa.</p>${moreHtml(model, lo)}`;
  return `<section class="mn-card"><h3>Validazione prospettica</h3>${partial}
    <div class="mn-kpis mn-kpis--5"><div><b>${m.valid}</b><span>valide</span></div><div><b>${m.blocks}</b><span>blocchi</span></div><div><b>${ci(m.brier)}</b><span>Brier</span></div><div><b>${ci(m.logLoss)}</b><span>log loss</span></div><div><b>${m.accuracy ? pct(m.accuracy.est, 1) : "—"}</b><span>accuratezza</span></div></div>
    <p class="mn-verdict">${esc(m.note)}</p><p class="mn-note">${esc(m.basis)}. Intervalli al 95% per blocchi torneo-settimana. Riferimenti: Brier 0,250 e log loss 0,693 sono il lancio di moneta. Soglie: ${m.minSample} osservazioni e ${m.minBlocks} blocchi.</p>
    ${m.calibration.bins.length ? `<h4>Taratura (ECE ${num(m.calibration.ece, 3)})</h4><div class="mn-scroll"><table class="mn-table"><thead><tr><th>Fascia</th><th>Casi</th><th>Dichiarato</th><th>Osservato</th></tr></thead><tbody>${m.calibration.bins.map((b) => `<tr><th>${Math.round(b.lo * 100)}–${Math.round(b.hi * 100)}%</th><td>${b.n}</td><td>${pct(b.claimed, 1)}</td><td>${pct(b.observed, 1)}</td></tr>`).join("")}</tbody></table></div>` : ""}
    <h4>Escluse</h4><p class="mn-note">Astenute ${ex.abstained} · non concluse ${ex.notConcluded} · ritiri/walkover ${ex.retiredOrWalkover} · rinviate/annullate ${ex.cancelledOrPostponed} · incongruenza id ${ex.identityMismatch} · senza valutazione iniziale ${ex.noInitial}</p>
    <h4>Dati mancanti nelle valutazioni iniziali</h4><p class="mn-note">${Object.keys(m.missingData).length ? Object.entries(m.missingData).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${esc(k)}: ${n}`).join(" · ") : "Nessuno."}</p></section>
    <section class="mn-card"><h3>Stabilità delle valutazioni (analisi separata)</h3><p class="mn-note">${rs.observed} partite osservate, ${rs.withRevisions} con revisioni${rs.meanAbsShift != null ? `, scarto medio tra prima e ultima versione ${pct(rs.meanAbsShift, 1)} (massimo ${pct(rs.maxAbsShift, 1)})` : ""}. ${Object.entries(rs.reasons).map(([k, n]) => `${esc(REASON_LABEL[k] ?? k)}: ${n}`).join(" · ")}</p></section>`;
}

function moreHtml(model, lo) {
  if (model.complete) return `<p class="mn-note">Storico completo: ${model.items.length} osservazioni${model.total != null ? ` su ${model.total}` : ""}.</p>`;
  return `<p class="mn-note">Mostrate ${model.items.length}${model.total != null ? ` di ${model.total}` : ""} osservazioni (dalle più recenti).</p><div class="lo-more"><button type="button" data-lo-more ${lo.loading ? "disabled" : ""}>${lo.loading ? "Carico…" : "Carica altre"}</button><button type="button" data-lo-all ${lo.loading ? "disabled" : ""}>Carica tutto lo storico</button></div>`;
}

function diagHtml(d) {
  if (!d) return "";
  const st = d.unavailable ? "diagnostica non leggibile" : d.blocked ? `REGISTRAZIONE BLOCCATA (${esc(d.blocked.reason)}): ${d.blocked.reason === "history_future_date" ? `${esc(d.blocked.count ?? "?")} partite concluse con data dopo l'elaborazione (ultima ${esc(d.blocked.latestAt ?? "n.d.")}); nessuna osservazione registrata, nulla è stato corretto` : "storico vuoto"}` : d.error ? `ERRORE nell'ultimo giro: ${esc(d.error)} (il refresh ordinario non è stato toccato)` : d.enabled === false ? "registrazione spenta (nessuna nuova osservazione)" : `ultimo giro ok: ${d.newObservations ?? 0} nuove osservazioni, ${d.newVersions ?? 0} nuove versioni${d.skipped ? `, ${d.skipped} saltate` : ""}`;
  return `<p class="mn-note lo-diag${d.error || d.blocked ? " bad" : ""}">Sistema: ${st}.</p>`;
}

/** Sezione completa. lo = stato dell'interfaccia; board = partite della snapshot (per contare quelle non ancora elaborate). */
export function liveObservationHtml(lo, board = [], now = Date.now()) {
  const head = `<section class="mn-card lo-card"><button type="button" class="lo-toggle" data-lo-toggle aria-expanded="${lo.open}"><span><b>LIVE OBSERVATION</b><small>Valutazioni registrate prima dell'inizio e confrontate con i risultati · Shadow Mode</small></span><i aria-hidden="true">${lo.open ? "−" : "+"}</i></button>`;
  if (!lo.open) return `${head}</section>`;
  if (lo.loading && !lo.data) return `${head}<p class="mn-note">Caricamento…</p></section>`;
  if (lo.error && !lo.data) return `${head}<div class="mn-emptybox"><h3>Impossibile leggere LIVE OBSERVATION</h3><p>${esc(lo.error)}</p></div></section>`;
  const model = buildModel(lo.data, now);
  const tabs = `<div class="lo-tabs" role="group" aria-label="Sezioni">${LO_TABS.map(([k, l]) => `<button type="button" data-lo-tab="${k}" aria-pressed="${lo.tab === k}">${l}</button>`).join("")}</div>`;
  if (!model.available) return `${head}${tabs}<div class="mn-emptybox"><h3>Registro non ancora attivo</h3><p>${esc(model.reason)}</p></div>${diagHtml(model.diagnostics)}</section>`;
  const it = model.items, observed = new Set(it.map((i) => i.key));
  const upcoming = it.filter((i) => i.state === "upcoming"), unobs = board.filter((m) => m.status === "scheduled" && Date.parse(m.startsAt) > now && !observed.has(m.key)).length;
  let body;
  if (lo.tab === "overview") {
    const last = it.flatMap((i) => i.versions.map((v) => v.recorded_at)).sort().at(-1);
    body = `<div class="mn-kpis mn-kpis--5"><div><b>${upcoming.length}</b><span>future osservate</span></div><div><b>${unobs}</b><span>non ancora elaborate</span></div><div><b>${it.length}</b><span>registrate</span></div><div><b>${it.filter((i) => i.state === "concluded").length}</b><span>concluse</span></div><div><b>${it.filter((i) => i.incomplete).length}</b><span>dati incompleti</span></div></div>
      <p class="mn-note">Ultima registrazione: ${when(last)} · ${it.filter((i) => i.state === "awaiting_result").length} in attesa del risultato (non considerate concluse) · ${model.items.length} osservazioni caricate${model.total != null ? ` su ${model.total}` : ""}.</p>${diagHtml(model.diagnostics)}`;
  } else if (lo.tab === "future") body = listHtml(upcoming.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt)), lo.openKey, "Nessuna partita futura osservata", lo.rows) + moreHtml(model, lo);
  else if (lo.tab === "registered") body = filtersHtml(model, lo.f) + listHtml(filterItems(it, lo.f), lo.openKey, "Nessuna osservazione con questi filtri", lo.rows) + moreHtml(model, lo);
  else if (lo.tab === "done") body = listHtml(it.filter((i) => i.state === "concluded"), lo.openKey, "Nessuna partita conclusa tra quelle osservate", lo.rows) + moreHtml(model, lo);
  else body = metricsHtml(model, lo);
  return `${head}${tabs}${body}</section>`;
}
