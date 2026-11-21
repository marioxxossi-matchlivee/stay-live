#!/usr/bin/env node
/**
 * Stay Live Tennis — AUDIT v5 (storico completo). SOLA LETTURA: nessuna scrittura, nessun provider, nessun effetto su motore, soglie, strategie, probabilità.
 *
 * Domanda: con lo storico COMPLETO (NEW) il modello migliora la previsione del mercato su dati non usati per costruirlo?
 * Tre valutazioni SEPARATE sulle STESSE partite (dopo il limite di 80.000 che l'OLD non vede, pubblicate da OLD e NEW, con quote di chiusura valide):
 *   OLD    = rating congelati al limite (il motore di oggi), NEW = rating aggiornati dallo storico completo, MERCATO = quote di chiusura senza margine.
 * Il rigioco è cronologico, per giorno UTC: ogni partita è prevista con i rating di PRIMA di quel giorno (nessun esito entra nella previsione della stessa
 * partita né di partite dello stesso giorno). Elo e forma sono quelli attuali e non hanno parametri adattati ai risultati: il confronto grezzo è fuori campione per costruzione;
 * i coefficienti della rimodulazione (Strategy Center 2.0) sono adattati solo a mesi precedenti (walk-forward, vedi walkForwardVsMarket).
 * Intervalli: bootstrap per BLOCCHI torneo-settimana (1.000 ripetizioni, seme fisso). Multiplicità: correzione di Holm su TUTTI i gruppi valutati.
 * LIMITI: quote di CHIUSURA (non quelle disponibili alla previsione), niente statistiche di servizio/H2H/ranking storici. Un miglioramento OLD→NEW non è una superiorità sul mercato.
 */
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { supabaseGet } from "../functions/api/_lib.js";
import { loadFinishedKeyset } from "../functions/api/_tennis-history.js";
import { TENNIS_MODEL } from "../functions/api/_tennis-model.js";
import { calibrationBins } from "../functions/api/_tennis-metrics.js";
import { STRATEGY2, replay, clusterBootstrap, clusterOf, holm, competitionLabel, bandOf, summarizeSides, walkForwardVsMarket, strategy2WalkForward } from "./tennis-strategy-audit.js";
import { scoreRows, OPERATIVE_HISTORY_CAP, fingerprintRows, keysetQuery } from "./tennis-history-shadow.js";

export const MIN_GROUP_N = 300, MIN_GROUP_CLUSTERS = 50;
const EPS = 1e-6, clip = (p) => Math.min(1 - EPS, Math.max(EPS, p));
const ll = (p, y) => -(y ? Math.log(clip(p)) : Math.log(clip(1 - p))), br = (p, y) => (p - y) ** 2;
const rd = (x, d = 4) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
const SURFACE = (s) => String(s ?? "").toLowerCase().replace(/indoor|outdoor/g, "").trim() || "sconosciuta";
const PROB_BANDS = [[0.5, 0.6, "favorito mercato 50–60%"], [0.6, 0.7, "favorito mercato 60–70%"], [0.7, 0.8, "favorito mercato 70–80%"], [0.8, 1.0001, "favorito mercato oltre 80%"]];
const probBand = (m) => PROB_BANDS.find(([a, b]) => Math.max(m, 1 - m) >= a && Math.max(m, 1 - m) < b)?.[2];

/** Intervallo (bootstrap per blocchi) della media di contrib(x) = (perdita A − perdita B): >0 = B meglio di A. */
const ci = (rows, contrib) => { const b = clusterBootstrap(rows, (x) => x.g, (x) => [contrib(x), 1], { B: 1000, seed: 12345 }); return { est: rd(b.est, 5), lo: rd(b.lo, 5), hi: rd(b.hi, 5), clusters: b.clusters, pLe0: rd(b.pLe0, 5), n: rows.length }; };

/** Una riga per partita (giocatore 1): OLD, NEW e mercato sulle stesse partite. oldSides/newSides = uscita di replay(). */
export function comparableRows(oldSides, newSides, surfaceByKey = new Map(), afterMs = -Infinity) {
  const by = (sides, slot) => new Map(sides.filter((x) => x.slot === slot).map((x) => [x.key, x])), o1 = by(oldSides, 1), n2 = by(newSides, 2), out = [];
  for (const s of newSides) {
    if (s.slot !== 1 || s.t <= afterMs) continue; const o = o1.get(s.key), s2 = n2.get(s.key); if (!o || !s2) continue;
    out.push({ key: s.key, t: s.t, g: clusterOf(s), tournament: s.tournament, label: s.label, surface: SURFACE(surfaceByKey.get(s.key)), y: s.y, pOld: o.p, pNew: s.p, mkt: s.mkt, favOdds: Math.min(s.odds, s2.odds) });
  }
  return out.sort((a, b) => a.t - b.t || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
}

/** Metriche di un gruppo per OLD, NEW e mercato + differenze con intervalli (delta > 0: il secondo è meglio del primo). */
export function evalGroup(rows) {
  const models = { old: (r) => r.pOld, new: (r) => r.pNew, market: (r) => r.mkt }, metrics = {};
  for (const [k, f] of Object.entries(models)) metrics[k] = { ...scoreRows(rows, (r) => f(r)), calibration: calibrationBins(rows.map((r) => ({ p: f(r), y: r.y }))) };
  const d = (a, b, loss) => ci(rows, (x) => loss(a(x), x.y) - loss(b(x), x.y));
  return {
    n: rows.length, metrics,
    newVsMarket: { logLoss: d(models.market, models.new, ll), brier: d(models.market, models.new, br) },   // >0: NEW meglio del mercato
    oldVsMarket: { logLoss: d(models.market, models.old, ll), brier: d(models.market, models.old, br) },
    newVsOld: { logLoss: d(models.old, models.new, ll), brier: d(models.old, models.new, br) },            // >0: NEW meglio di OLD
  };
}
/** Stato di un gruppo rispetto al mercato (regola fissata a priori, Holm su tutti i gruppi). */
export function verdictVsMarket(g, holmP) {
  const c = g.newVsMarket.logLoss;
  if (g.n < MIN_GROUP_N || (c.clusters ?? 0) < MIN_GROUP_CLUSTERS || c.lo == null) return `non validata: campione insufficiente (n=${g.n}/${MIN_GROUP_N}, blocchi=${c.clusters ?? 0}/${MIN_GROUP_CLUSTERS})`;
  if (c.lo > 0 && holmP < 0.05) return "NEW migliore del mercato: prova che regge Holm (log loss)";
  if (c.lo > 0) return "intervallo > 0 ma NON regge la correzione di Holm: non validata";
  if (c.hi < 0) return "NEW PEGGIORE del mercato (intervallo interamente < 0)";
  return "non distinguibile dal mercato: nessuna prova di informazione aggiuntiva";
}

/** Confronto completo: complessivo + per categoria/circuito, superficie, fascia di probabilità e di quota; Holm globale. */
export function threeWayComparison(rows) {
  const fams = { categoria: (r) => r.label, superficie: (r) => r.surface, probabilitaMercato: (r) => probBand(r.mkt), quotaFavorito: (r) => bandOf(r.favOdds) }, groups = [];
  groups.push({ family: "complessivo", name: "tutte", rows });
  for (const [fam, fn] of Object.entries(fams)) { const m = new Map(); for (const r of rows) { const k = fn(r); if (k == null) continue; (m.get(k) ?? m.set(k, []).get(k)).push(r); } for (const [k, v] of [...m].sort((a, b) => b[1].length - a[1].length)) groups.push({ family: fam, name: k, rows: v }); }
  const evald = groups.map((g) => ({ family: g.family, name: g.name, ...evalGroup(g.rows) })), ps = evald.map((g) => (g.n >= MIN_GROUP_N ? g.newVsMarket.logLoss.pLe0 ?? 1 : 1)), hp = holm(ps);
  evald.forEach((g, i) => { g.holmP = rd(hp[i], 4); g.verdictVsMarket = verdictVsMarket(g, hp[i]); });
  return { groups: evald, testedGroups: evald.filter((g) => g.n >= MIN_GROUP_N).length, note: "Holm applicato a tutti i gruppi con almeno 300 partite (p unilaterale: NEW meglio del mercato). Il verdetto «PEGGIORE» usa l'intervallo al 95% non corretto per multiplicità." };
}

/** Classi A/B/C/D di Strategy Center 2.0: n, criteri, risultato fuori campione, intervallo, stato. Nessuna soglia viene cambiata. */
export function classValidation(picksByTier, cfg = STRATEGY2) {
  const criteria = { A: `quota ≥ ${cfg.minOdds}; vantaggio ≥ ${cfg.strongEv * 100}% sulla probabilità rimodulata; scarto dal mercato ≤ ${cfg.maxGap * 100} pt; prova per categoria c − ${cfg.zStrong}·ES > 0 con ≥ ${cfg.minClusters} blocchi`, B: `come A ma vantaggio ≥ ${cfg.minEv * 100}% e prova c − ${cfg.zInteresting}·ES > 0`, C: "categoria senza prova sufficiente (o campione insufficiente): da monitorare, non giocabile", D: "esclusa da quota, vantaggio, scarto anomalo, affidabilità o dati non validi" };
  const out = {};
  for (const [tier, picks] of Object.entries({ ...picksByTier, "A+B": [...(picksByTier.A ?? []), ...(picksByTier.B ?? [])] })) {
    const n = picks.length, llv = n ? ci(picks, (x) => ll(x.mkt, x.y) - ll(x.p, x.y)) : null, brv = n ? ci(picks, (x) => br(x.mkt, x.y) - br(x.p, x.y)) : null, roi = n ? ci(picks, (x) => (x.y ? x.odds - 1 : -1)) : null;
    let status = "non validata";
    const why = [];
    if (tier === "C") why.push("classe «da monitorare»: per definizione senza prova");
    if (!n) why.push("nessuna selezione fuori campione"); else {
      if (n < MIN_GROUP_N) why.push(`campione insufficiente (${n}/${MIN_GROUP_N})`);
      if ((llv.clusters ?? 0) < MIN_GROUP_CLUSTERS) why.push(`blocchi insufficienti (${llv.clusters}/${MIN_GROUP_CLUSTERS})`);
      if (llv.lo != null && !(llv.lo > 0)) why.push("la probabilità rimodulata non batte il mercato sulle stesse selezioni (intervallo comprende 0 o è negativo)");
    }
    if (!why.length && (tier === "A" || tier === "B" || tier === "A+B")) status = "validata (informazione aggiuntiva sul mercato fuori campione)";
    out[tier] = { criteria: criteria[tier] ?? "unione di A e B", n, selections: n ? summarizeSides(picks) : { n: 0 }, logLossVsMarket: llv, brierVsMarket: brv, roi, status, why, nota: "Il ROI è riportato ma NON è usato per la validazione (quote di chiusura, simulazione retrospettiva)." };
  }
  return out;
}

/**
 * Le doppie moltiplicano le probabilità singole (indipendenza). Controllo EMPIRICO sulle selezioni fuori campione: si formano coppie dello stesso giorno, di tornei diversi
 * (come una doppia ammessa) e si confronta la frequenza osservata di «entrambe vincenti» con il prodotto delle probabilità previste, più la correlazione dei residui.
 * Un intervallo che comprende 0 NON dimostra indipendenza (potenza limitata): le doppie restano NON validate.
 */
export function jointIndependenceCheck(picks) {
  const byDay = new Map(); for (const p of [...picks].sort((a, b) => a.t - b.t || (a.key < b.key ? -1 : 1))) { const d = Math.floor(p.t / 864e5); (byDay.get(d) ?? byDay.set(d, []).get(d)).push(p); }
  const pairs = [];
  for (const list of byDay.values()) { const used = new Set(); for (let i = 0; i < list.length; i++) { if (used.has(i)) continue; for (let j = i + 1; j < list.length; j++) { if (used.has(j) || list[j].g === list[i].g || (list[i].tournament && list[i].tournament === list[j].tournament)) continue; used.add(i); used.add(j); pairs.push({ a: list[i], b: list[j], g: `${Math.floor(list[i].t / (7 * 864e5))}` }); break; } } }
  const base = { pairs: pairs.length, validated: false, limitation: "Indipendenza non dimostrata: tornei diversi non bastano. Nessun vantaggio statistico attribuibile alle doppie finché non esiste una stima validata delle probabilità congiunte." };
  if (pairs.length < 30) return { ...base, observedBothWin: null, expectedBothWin: null, note: "Coppie insufficienti per qualunque conclusione." };
  const exp = pairs.reduce((s, q) => s + q.a.p * q.b.p, 0) / pairs.length, obs = pairs.reduce((s, q) => s + q.a.y * q.b.y, 0) / pairs.length;
  return { ...base, observedBothWin: rd(obs), expectedBothWin: rd(exp), difference: ci(pairs, (q) => q.a.y * q.b.y - q.a.p * q.b.p), residualCovariance: ci(pairs, (q) => (q.a.y - q.a.p) * (q.b.y - q.b.p)), note: "Intervalli per blocchi settimanali. Un intervallo che include 0 = indipendenza non rifiutata, non dimostrata." };
}

/** Report completo (funzione pura, deterministica): rows = righe tennis_matches concluse (winner 1|2) con closing_odds; cap = tetto del percorso OLD. */
export function buildReportV5(rows, { cap = OPERATIVE_HISTORY_CAP, hist = {}, withWalkForward = true } = {}) {
  const ok = rows.filter((m) => m.winner === 1 || m.winner === 2), cutoffMs = ok.length > cap ? Date.parse(ok[cap - 1].starts_at) : null;
  const rep = { generatedFor: "audit v5 — storico completo", engine: TENNIS_MODEL.version, strategyVersion: STRATEGY2.version, matches: ok.length, firstMatch: ok[0]?.starts_at ?? null, lastMatch: ok.at(-1)?.starts_at ?? null, history: { rows: rows.length, pages: hist.pages ?? null, duplicatesDiscarded: hist.duplicates ?? null, truncated: hist.truncated ?? null, fingerprint: fingerprintRows(rows) }, cap, cutoff: cutoffMs ? new Date(cutoffMs).toISOString() : null };
  const newSides = replay(ok);
  if (cutoffMs == null) rep.threeWay = { available: false, reason: `Storico non oltre il tetto di ${cap} partite: nessuna differenza OLD/NEW da valutare.` };
  else {
    const oldSides = replay(ok, TENNIS_MODEL, { freezeAfterMs: cutoffMs }), surf = new Map(ok.map((m) => [m.match_key, m.surface])), cmp = comparableRows(oldSides, newSides, surf, cutoffMs);
    rep.threeWay = { available: true, afterCutoff: rep.cutoff, comparableMatches: cmp.length, ...threeWayComparison(cmp) };
  }
  if (withWalkForward) {
    const wf = walkForwardVsMarket(newSides), s2 = strategy2WalkForward(newSides), picks = s2._picks;
    rep.walkForward = { firstTestMonth: wf.firstTestMonth, testedMatches: wf.testedMatches, oos: { logLoss: wf.oos.logLoss, brier: wf.oos.brier, infoLogLoss: wf.oos.infoLogLoss, infoBrier: wf.oos.infoBrier, rawModelVsMarketLL: wf.oos.rawModelVsMarketLL, byCategory: wf.oos.byCategory, informativeOverall: wf.oos.informativeOverall }, limits: wf.limits };
    rep.classes = classValidation(picks); rep.doubles = jointIndependenceCheck([...picks.A, ...picks.B, ...picks.C]);
    rep.strategy2 = { firstTestMonth: s2.firstTestMonth, testedMatches: s2.testedMatches, tiers: s2.tiers };
  }
  const tw = rep.threeWay, all = tw?.available ? tw.groups[0] : null;
  rep.conclusion = all ? `Sulle ${all.n} partite perse dall'OLD: NEW vs OLD Δlog loss ${all.newVsOld.logLoss.est} [${all.newVsOld.logLoss.lo} ; ${all.newVsOld.logLoss.hi}]; NEW vs mercato Δlog loss (perdita mercato − perdita NEW; < 0 = NEW peggiore) ${all.newVsMarket.logLoss.est} [${all.newVsMarket.logLoss.lo} ; ${all.newVsMarket.logLoss.hi}] → ${all.verdictVsMarket}.` : "Confronto OLD/NEW non disponibile.";
  rep.limits = "Quote di CHIUSURA; rigioco Elo+forma senza statistiche di servizio, H2H e ranking storici; differenze OLD→NEW misurano la disponibilità dei dati, non un vantaggio sul mercato. L'astensione resta il comportamento corretto finché non c'è prova robusta di informazione aggiuntiva.";
  return rep;
}

const f = (x) => (x == null ? "n.d." : x), cell = (c) => (c ? `${f(c.est)} [${f(c.lo)} ; ${f(c.hi)}]` : "n.d.");
export function renderReportV5(rep) {
  const tw = rep.threeWay; let md = `## Audit v5 — storico completo (sola lettura)\nPartite: ${rep.matches} (${rep.firstMatch} → ${rep.lastMatch}); righe lette ${rep.history.rows} in ${f(rep.history.pages)} pagine; troncato: ${rep.history.truncated ? "SÌ" : "no"}; impronta ${String(rep.history.fingerprint).slice(0, 12)}.\n> ${rep.limits}\n\n`;
  if (tw?.available) {
    md += `### OLD (congelato) · NEW (storico completo) · MERCATO — stesse ${tw.comparableMatches} partite dopo ${tw.afterCutoff}\n| gruppo | n | Brier OLD / NEW / mercato | log loss OLD / NEW / mercato | ECE OLD / NEW / mercato | accuratezza OLD / NEW / mercato | Δ log loss = perdita mercato − perdita NEW [IC 95%] (>0: NEW meglio) | blocchi | p Holm | stato |\n|---|---|---|---|---|---|---|---|---|---|\n`;
    for (const g of tw.groups) { const m = g.metrics, t = (k) => `${f(m.old[k])} / ${f(m.new[k])} / ${f(m.market[k])}`; md += `| ${g.family}: ${g.name} | ${g.n} | ${t("brier")} | ${t("logLoss")} | ${t("ece")} | ${t("accuracy")} | ${cell(g.newVsMarket.logLoss)} | ${f(g.newVsMarket.logLoss.clusters)} | ${f(g.holmP)} | ${g.verdictVsMarket} |\n`; }
    md += `\nConvenzione dei segni (tutti i Δ): Δ = perdita del primo termine − perdita del secondo; Δ > 0 = vince il secondo. Qui: Δ = perdita del mercato − perdita di NEW, quindi Δ > 0 = NEW migliore del mercato e Δ < 0 = NEW peggiore del mercato. «NEW contro OLD»: Δ = perdita OLD − perdita NEW (> 0 = NEW migliore). ${tw.note}\nNEW contro OLD (complessivo; Δ = perdita OLD − perdita NEW): Δ log loss ${cell(tw.groups[0].newVsOld.logLoss)}, Δ Brier ${cell(tw.groups[0].newVsOld.brier)}.\n`;
  } else md += `### OLD / NEW / MERCATO\n${tw?.reason ?? "non disponibile"}\n`;
  if (rep.classes) {
    md += `\n### Classi Strategy Center 2.0 (walk-forward da ${rep.walkForward.firstTestMonth}, ${rep.walkForward.testedMatches} partite)\n| classe | selezioni | Δ log loss = perdita mercato − perdita probabilità rimodulata [IC] (>0: meglio del mercato) | ROI [IC] (non usato) | stato |\n|---|---|---|---|---|\n`;
    for (const [k, v] of Object.entries(rep.classes)) md += `| ${k} | ${v.n} | ${cell(v.logLossVsMarket)} | ${cell(v.roi)} | ${v.status}${v.why.length ? ` — ${v.why.join("; ")}` : ""} |\n`;
    md += `\n### Doppie\nCoppie ${rep.doubles.pairs}; osservato ${f(rep.doubles.observedBothWin)} contro atteso ${f(rep.doubles.expectedBothWin)} (prodotto delle singole); Δ ${cell(rep.doubles.difference)}. **Non validate.** ${rep.doubles.limitation}\n`;
    md += `\n### Walk-forward: il modello aggiunge informazione al mercato?\nConvenzione: Δ = perdita del primo termine − perdita del secondo; > 0 = vince il secondo. Δ log loss (solo mercato ricalibrato − mercato+modello): ${cell(rep.walkForward.oos.infoLogLoss)} (> 0: il modello aggiunge informazione); Δ log loss (mercato − modello grezzo): ${cell(rep.walkForward.oos.rawModelVsMarketLL)} (< 0: il modello grezzo è peggiore del mercato).\n`;
  }
  return md + `\n**Conclusione:** ${rep.conclusion}\n`;
}

async function main() {
  for (const k of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) if (!process.env[k]) { console.error(`Variabile mancante: ${k}`); process.exit(1); }
  const env = process.env, hist = await loadFinishedKeyset((params) => supabaseGet(env, "tennis_matches", params), { query: { ...keysetQuery(Date.now()), select: "match_key,p1_id,p2_id,p1_name,p2_name,winner,starts_at,surface,best_of,tour,category,tournament,closing_odds" }, retries: 2 });
  const rep = buildReportV5(hist.rows, { hist }), md = renderReportV5(rep);
  fs.mkdirSync("audit-out", { recursive: true }); fs.writeFileSync("audit-out/tennis-strategy-audit-v5.json", JSON.stringify(rep, null, 2)); fs.writeFileSync("audit-out/tennis-strategy-audit-v5.md", md);
  console.log(md.slice(0, 6000)); if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, md);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
