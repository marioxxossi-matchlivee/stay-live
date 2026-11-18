#!/usr/bin/env node
/**
 * Stay Live Tennis — AUDIT dello Strategy Center (Strategy Center 2.0, Fase 1-2-4). SOLA LETTURA.
 * Nessuna chiamata al provider sportivo, nessuna scrittura su Supabase, nessuna modifica a motore, soglie o strategie operative.
 * Rigioca in ordine cronologico (rating di PRIMA di ogni giorno, nessun look-ahead) il Prediction Engine ATTUALE sulle partite concluse
 * che hanno le quote di chiusura (tennis_matches.closing_odds), applica le regole ATTUALI di _tennis-bet.js e produce tabelle per fascia di quota,
 * favoriti/sfavoriti, categoria, scarto dal mercato e filtro ITF degli 8 punti.
 * LIMITE DICHIARATO: le quote sono quelle di CHIUSURA (non quelle disponibili al momento della previsione) e il rigioco riproduce la parte Elo+forma
 * (nessuna statistica di servizio, H2H o ranking storici): è un proxy, non la riproduzione esatta delle giocate passate.
 * Segreti: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (solo GET). Uso: node scripts/tennis-strategy-audit.js
 */
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { supabaseGetAll } from "../functions/api/_lib.js";
import { RatingBook, predictMatch, normalizeSurface, TENNIS_MODEL } from "../functions/api/_tennis-model.js";
import { TENNIS_BET, noVig } from "../functions/api/_tennis-bet.js";

export const BANDS = [[1.2, 1.5, "1,20–1,50"], [1.5, 2, "1,50–2,00"], [2, 3, "2,00–3,00"], [3, 5, "3,00–5,00"], [5, 10, "5,00–10,00"], [10, Infinity, "oltre 10,00"]];
export const bandOf = (odds) => BANDS.find(([a, b]) => odds >= a && odds < b)?.[2] ?? "sotto 1,20";
export const GAP_BANDS = [[-Infinity, 0, "modello ≤ mercato"], [0, 0.04, "0–4 pt"], [0.04, 0.08, "4–8 pt"], [0.08, 0.12, "8–12 pt"], [0.12, 0.15, "12–15 pt"], [0.15, Infinity, "oltre 15 pt"]];
export const gapOf = (g) => GAP_BANDS.find(([a, b]) => g >= a && g < b)?.[2];

/** Etichetta leggibile: circuito (dal provider: atp = maschile, wta = femminile) + categoria + livello dal nome del torneo. */
export function competitionLabel(tour, category, tournament) {
  const lvl = String(tournament ?? "").match(/^\s*([MW]\d{2,3})\b/i)?.[1]?.toUpperCase() ?? null;
  if (category === "itf") return `ITF ${tour === "wta" ? "FEMMINILE" : "MASCHILE"}${lvl ? ` ${lvl}` : ""}`;
  if (category === "challenger") return tour === "wta" ? "CHALLENGER FEMMINILE" : "CHALLENGER";
  if (category === "challenger_itf") return `CHALLENGER/ITF NON DISTINTO (${tour === "wta" ? "femminile" : "maschile"})`;
  if (category === "tour") return tour === "wta" ? "WTA TOUR" : "ATP TOUR";
  return "CATEGORIA SCONOSCIUTA";
}

// ───────────── Metriche ─────────────
const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
const r = (x, d = 4) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
const EPS = 1e-6, clip = (p) => Math.min(1 - EPS, Math.max(EPS, p));
/** rows: { p (probabilità del lato), y (1 vince), odds, mkt }. ROI a puntata fissa 1 sulle quote del lato. */
export function summarizeSides(rows) {
  const n = rows.length; if (!n) return { n: 0 };
  const wins = sum(rows, (x) => x.y), withOdds = rows.filter((x) => x.odds > 1), cal = [];
  for (let i = 0; i < 10; i++) { const b = rows.filter((x) => x.p >= i / 10 && x.p < (i + 1) / 10 + (i === 9 ? 1e-9 : 0)); if (b.length) cal.push({ from: i / 10, n: b.length, meanP: r(sum(b, (x) => x.p) / b.length), hit: r(sum(b, (x) => x.y) / b.length) }); }
  const ece = cal.reduce((s, b) => s + (b.n / n) * Math.abs(b.meanP - b.hit), 0);
  return {
    n, wins, hitRate: r(wins / n), avgP: r(sum(rows, (x) => x.p) / n), avgMarket: r(sum(rows, (x) => x.mkt) / n), avgOdds: withOdds.length ? r(sum(withOdds, (x) => x.odds) / withOdds.length, 2) : null,
    avgEv: r(sum(rows, (x) => x.p * x.odds - 1) / n), roi: r(sum(rows, (x) => (x.y ? x.odds - 1 : -1)) / n), brierModel: r(sum(rows, (x) => (x.p - x.y) ** 2) / n), brierMarket: r(sum(rows, (x) => (x.mkt - x.y) ** 2) / n),
    logLossModel: r(sum(rows, (x) => -(x.y ? Math.log(clip(x.p)) : Math.log(clip(1 - x.p)))) / n), ece: r(ece), calibration: cal,
    calibrationGapPt: r((sum(rows, (x) => x.y) / n - sum(rows, (x) => x.p) / n) * 100, 2),
  };
}
export const groupBy = (rows, keyFn) => { const m = new Map(); for (const x of rows) { const k = keyFn(x); if (k == null) continue; (m.get(k) ?? m.set(k, []).get(k)).push(x); } return Object.fromEntries([...m].map(([k, v]) => [k, summarizeSides(v)])); };

// ───────────── Rigioco cronologico senza look-ahead ─────────────
/** history: righe tennis_matches concluse con winner 1|2. Restituisce un record per OGNI lato con quota di chiusura valida. */
export function replay(matches, cfg = TENNIS_MODEL, { freezeAfterMs = null } = {}) {
  const sorted = [...matches].sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at) || String(a.match_key).localeCompare(String(b.match_key)));
  const book = new RatingBook(cfg), out = []; let i = 0;
  const id = (m, s) => (s === 1 ? m.p1_id : m.p2_id);
  while (i < sorted.length) {
    const day = Math.floor(Date.parse(sorted[i].starts_at) / 86400e3); let j = i;
    while (j < sorted.length && Math.floor(Date.parse(sorted[j].starts_at) / 86400e3) === day) j++;
    const batch = sorted.slice(i, j);
    for (const m of batch) {
      const t = Date.parse(m.starts_at), a = String(m.p1_id), b = String(m.p2_id);
      const pred = predictMatch(book, { t, surface: m.surface, tour: m.tour, bestOf: m.best_of ?? undefined, p1: { id: a, name: m.p1_name }, p2: { id: b, name: m.p2_name } }, {}, null, cfg);
      const co = m.closing_odds, o1 = Number(co?.[a]), o2 = Number(co?.[b]), nv = noVig(o1, o2);
      if (!pred.published || !nv) continue;
      for (const s of [1, 2]) {
        const p = s === 1 ? pred.p1 : pred.p2, odds = s === 1 ? o1 : o2, mkt = s === 1 ? nv.p1 : nv.p2;
        out.push({ key: m.match_key, t, tour: m.tour, category: m.category ?? "unknown", tournament: m.tournament, label: competitionLabel(m.tour, m.category, m.tournament), slot: s, p, odds, mkt, gap: p - mkt, y: m.winner === s ? 1 : 0, isUnderdog: p < 0.5, marketUnderdog: mkt < 0.5, reliability: pred.reliability, modelPick: pred.pick === s });
      }
    }
    for (const m of batch) if (freezeAfterMs == null || Date.parse(m.starts_at) <= freezeAfterMs) book.update({ t: Date.parse(m.starts_at), winnerId: m.winner === 1 ? String(m.p1_id) : String(m.p2_id), loserId: m.winner === 1 ? String(m.p2_id) : String(m.p1_id), surface: normalizeSurface(m.surface) });
    i = j;
  }
  return out;
}

/** Regole ATTUALI di _tennis-bet.js applicate a un lato (con le quote di chiusura). */
export function passesCurrentRules(x, cfg = TENNIS_BET) {
  if (x.reliability === "bassa") return false;
  if (cfg.strictCategories.includes(x.category) && x.reliability !== "alta") return false;
  return x.odds >= cfg.minOdds && x.p * x.odds - 1 >= cfg.minEv && Math.abs(x.gap) <= cfg.maxModelGap;
}
/** Un solo lato per partita: quello con EV maggiore (come la graduatoria dello Strategy Center). */
export function pickBestPerMatch(sides) { const m = new Map(); for (const s of sides) { const c = m.get(s.key); if (!c || s.p * s.odds > c.p * c.odds) m.set(s.key, s); } return [...m.values()]; }

export function analyze(sides) {
  const eligible = pickBestPerMatch(sides.filter((x) => passesCurrentRules(x)));
  const itf = eligible.filter((x) => x.category === "itf");
  return {
    allSides: summarizeSides(sides),
    allByBand: groupBy(sides, (x) => bandOf(x.odds)),
    allByCategory: groupBy(sides, (x) => x.label),
    allByGapBand: groupBy(sides.filter((x) => passesCurrentRules({ ...x, gap: 0 })), (x) => gapOf(x.gap)),
    currentRules: { selections: summarizeSides(eligible), byBand: groupBy(eligible, (x) => bandOf(x.odds)), byUnderdog: groupBy(eligible, (x) => (x.isUnderdog ? "sfavorito (modello)" : "favorito (modello)")), byCategory: groupBy(eligible, (x) => x.label), byGapBand: groupBy(eligible, (x) => gapOf(x.gap)) },
    itf8: { kept: summarizeSides(itf.filter((x) => x.gap * 100 <= 8)), excluded: summarizeSides(itf.filter((x) => x.gap * 100 > 8)), threshold: 8 },
  };
}

/**
 * ESPERIMENTO A (isolato, solo audit): oggi il motore legge le prime 80.000 partite concluse e ignora le più recenti (tetto di 80 pagine).
 * Qui si confrontano, sulle SOLE partite successive al punto di taglio, i rating congelati al taglio (come il motore attuale) con rating aggiornati ogni giorno.
 * Nessuna modifica al motore: serve a misurare quanto pesa la mancanza delle partite recenti sullo scarto dal mercato, su Brier ed ECE e sulle selezioni.
 */
export function staleExperiment(matches, cutoffMs) {
  if (!Number.isFinite(cutoffMs)) return { available: false, reason: "Meno partite del tetto: nessun taglio da confrontare." };
  const after = (x) => x.t > cutoffMs, meanAbsGapPt = (a) => (a.length ? r((sum(a, (x) => Math.abs(x.gap)) / a.length) * 100, 2) : null);
  const idOf = (x) => `${x.key}|${x.slot}`;
  const fz = replay(matches, TENNIS_MODEL, { freezeAfterMs: cutoffMs }).filter(after), fr = replay(matches).filter(after);
  // Stesse partite e stessi lati nei due rigiochi (il modello può astenersi in una versione e non nell'altra): il confronto è sull'intersezione.
  const frIds = new Set(fr.map(idOf)), common = new Set(fz.map(idOf).filter((k) => frIds.has(k)));
  const A = fz.filter((x) => common.has(idOf(x))), B = fr.filter((x) => common.has(idOf(x)));
  const byId = new Map(B.map((x) => [idOf(x), x]));
  const pDiffMeanPt = A.length ? r((sum(A, (x) => Math.abs(x.p - byId.get(idOf(x)).p)) / A.length) * 100, 2) : null;
  const one = (sides) => { const el = pickBestPerMatch(sides.filter((x) => passesCurrentRules(x))), sel = summarizeSides(el); return { sides: summarizeSides(sides), meanAbsGapPt: meanAbsGapPt(sides), selections: sel, selectionsUnderdogShare: el.length ? r(el.filter((x) => x.isUnderdog).length / el.length) : null, selectionsAvgOdds: sel.avgOdds ?? null }; };
  return { available: true, cutoff: new Date(cutoffMs).toISOString(), comparedSides: A.length, onlyFrozen: fz.length - A.length, onlyFresh: fr.length - A.length, pDiffMeanPt, frozen: one(A), fresh: one(B) };
}

async function main() {
  for (const k of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]) if (!process.env[k]) { console.error(`Variabile mancante: ${k}`); process.exit(1); }
  const env = process.env, since = new Date(Date.now() - 400 * 86400e3).toISOString();
  // NESSUN tetto a 80 pagine (è il limite che oggi lascia fuori le partite più recenti dal motore): qui si legge tutto, 200 pagine = 200.000 righe.
  const rows = await supabaseGetAll(env, "tennis_matches", { select: "match_key,p1_id,p2_id,p1_name,p2_name,winner,starts_at,surface,best_of,tour,category,tournament,closing_odds", status: "eq.finished", winner: "not.is.null", starts_at: `gte.${since}`, order: "starts_at.asc,match_key.asc" }, 1000, 200);
  const ok = rows.filter((m) => m.winner === 1 || m.winner === 2);
  const cats = Object.fromEntries(Object.entries(ok.reduce((o, m) => ((o[competitionLabel(m.tour, m.category, m.tournament)] = (o[competitionLabel(m.tour, m.category, m.tournament)] ?? 0) + 1), o), {})).sort((a, b) => b[1] - a[1]));
  const sides = replay(ok);
  const CAP = 80000, cutoffMs = ok.length > CAP ? Date.parse(ok[CAP - 1].starts_at) : null;
  const rep = { generatedAt: new Date().toISOString(), engine: TENNIS_MODEL.version, matchesLoaded: ok.length, firstMatch: ok[0]?.starts_at ?? null, lastMatch: ok.at(-1)?.starts_at ?? null, matchesWithClosingOdds: new Set(sides.map((s) => s.key)).size, classification: cats, limits: "Quote di CHIUSURA (non quelle al momento della previsione); rigioco Elo+forma senza statistiche di servizio, H2H, ranking.", ...analyze(sides), experimentA: staleExperiment(ok, cutoffMs) };
  fs.mkdirSync("audit-out", { recursive: true });
  fs.writeFileSync("audit-out/tennis-strategy-audit.json", JSON.stringify(rep, null, 2));
  const row = (k, v) => `| ${k} | ${v.n} | ${v.avgP ?? ""} | ${v.hitRate ?? ""} | ${v.calibrationGapPt ?? ""} | ${v.avgEv ?? ""} | ${v.roi ?? ""} | ${v.brierModel ?? ""} | ${v.brierMarket ?? ""} | ${v.ece ?? ""} |`;
  const table = (t, o) => `\n### ${t}\n| gruppo | n | P modello | vittorie | scarto pt | EV medio | ROI | Brier mod. | Brier merc. | ECE |\n|---|---|---|---|---|---|---|---|---|---|\n${Object.entries(o).map(([k, v]) => row(k, v)).join("\n")}\n`;
  const md = `## Audit Strategy Center (sola lettura)\nPartite: ${rep.matchesLoaded} (${rep.firstMatch} → ${rep.lastMatch}); con quote di chiusura: ${rep.matchesWithClosingOdds}.\n> ${rep.limits}\n${table("Tutti i lati per fascia di quota", rep.allByBand)}${table("Selezioni con le regole ATTUALI, per fascia", rep.currentRules.byBand)}${table("Selezioni attuali: favoriti/sfavoriti", rep.currentRules.byUnderdog)}${table("Selezioni attuali per scarto modello−mercato", rep.currentRules.byGapBand)}${table("Selezioni attuali per categoria", rep.currentRules.byCategory)}${table("Filtro ITF 8 punti (rigioco)", { "ITF mantenute (≤8)": rep.itf8.kept, "ITF escluse (>8)": rep.itf8.excluded })}${rep.experimentA.available ? table(`Esperimento A — dopo il ${rep.experimentA.cutoff.slice(0, 10)}: rating congelati (come oggi) contro aggiornati`, { "congelati: tutti i lati": rep.experimentA.frozen.sides, "aggiornati: tutti i lati": rep.experimentA.fresh.sides, "congelati: selezioni attuali": rep.experimentA.frozen.selections, "aggiornati: selezioni attuali": rep.experimentA.fresh.selections }) + `\nScarto medio assoluto modello−mercato (punti): congelati ${rep.experimentA.frozen.meanAbsGapPt}, aggiornati ${rep.experimentA.fresh.meanAbsGapPt}. Quota media delle selezioni: ${rep.experimentA.frozen.selectionsAvgOdds} contro ${rep.experimentA.fresh.selectionsAvgOdds}. Differenza media assoluta di probabilità tra le due versioni: ${rep.experimentA.pDiffMeanPt} punti su ${rep.experimentA.comparedSides} lati (solo in una versione: ${rep.experimentA.onlyFrozen} congelati, ${rep.experimentA.onlyFresh} aggiornati).\n` : `\nEsperimento A: ${rep.experimentA.reason}\n`}\n### Classificazione tornei\n${Object.entries(cats).map(([k, v]) => `- ${k}: ${v}`).join("\n")}\n`;
  console.log(md.slice(0, 6000));
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => { console.error(String(e?.message ?? e)); process.exit(1); });
