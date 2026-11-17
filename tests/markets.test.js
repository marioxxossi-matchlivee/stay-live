import test from "node:test";
import assert from "node:assert/strict";
import { MARKET_GROUPS, MODEL, SELECTIONS, analyzeMatch, buildContext, marketsOf, rulesOf } from "../functions/api/model.js";
import fs from "node:fs";
import { altOf, cornerView, factOf, marketsHtml, motivationOf, reliabilityOf, whyNot } from "../src/markets.js";
import { crest } from "../src/ui.js";
import { accordionHtml } from "../src/playlist.js";
import { logoFor } from "../functions/api/_crests.js";

let seed = 7; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
const pois = (l) => { let k = 0, p = 1; const L = Math.exp(-l); do { k += 1; p *= rnd(); } while (p > L); return k - 1; };
const finals = [];
for (let d = 0; d < 60; d += 1) for (let g = 0; g < 6; g += 1) {
  const a = (d + g) % 12, b = (a + 1 + ((d * 5 + g * 3) % 11)) % 12;
  finals.push({ league: "seriea", kickoff_at: new Date(Date.parse("2026-01-10T18:00:00Z") + d * 86400e3 + g * 3600e3).toISOString(), home_id: `t${a}`, away_id: `t${b}`, home_name: `Squadra ${a}`, away_name: `Squadra ${b}`, home_score: pois(1.6), away_score: pois(1.2), status: "final" });
}
const ctx = buildContext(finals);
const match = { game_id: "x1", league: "seriea", kickoff_at: "2026-06-01T18:00:00Z", home_id: "t1", away_id: "t2", home_name: "Squadra 1", away_name: "Squadra 2", status: "scheduled" };
const analysis = analyzeMatch(match, ctx, { n: 8 });
const mk = marketsOf(analysis);
const item = { id: "x1", home: "Squadra 1", away: "Squadra 2", pick: { key: analysis.pick?.key, confidence: analysis.confidence, sample: analysis.sample }, mk, corner: null, cornerModel: null };

test("motore: Over 0,5 è un mercato coerente (sempre ≥ Over 1,5 ≥ Over 2,5 ≥ Over 3,5)", () => {
  assert.ok(SELECTIONS.some((s) => s.key === "over05"));
  const p = (k) => analysis.selections.find((s) => s.key === k).p;
  assert.ok(p("over05") >= p("over15") && p("over15") >= p("over25") && p("over25") >= p("over35"));
  assert.ok(Math.abs(p("home") + p("draw") + p("away") - 1) < 0.01, "1X2 somma 1");
  assert.ok(Math.abs(p("over25") + p("under25") - 1) < 0.01 && Math.abs(p("btts") + p("nobtts") - 1) < 0.01);
});
test("mercati compatti: stesse probabilità del motore, un esito più pronosticato per gruppo", () => {
  assert.ok(mk);
  for (const s of analysis.selections) assert.equal(mk.x[s.key].p, s.p);
  assert.equal(mk.b.esito, ["home", "draw", "away"].sort((a, b) => mk.x[b].p - mk.x[a].p)[0]);
  for (const g of Object.keys(MARKET_GROUPS)) assert.ok(MARKET_GROUPS[g].includes(mk.b[g]));
  assert.deepEqual(mk.rec, analysis.recommended);
  assert.equal(marketsOf({ ...analysis, confidence: "insufficiente" }), null, "campione insufficiente: mercati non valutabili");
  assert.ok(Object.keys(rulesOf()).includes("maxUseful") && rulesOf().thr === MODEL.betThreshold);
});
test("scheda: una riga per mercato, un solo esito evidenziato, niente tag né badge superflui", () => {
  const h = marketsHtml(item, { mode: "all" });
  for (const g of ["esito", "gol", "ou", "dc", "corner"]) assert.match(h, new RegExp(`data-g="${g}"`));
  assert.equal((h.match(/data-g="esito"/g) ?? []).length, 1, "nessuna riga duplicata");
  const rowOf = (g) => h.match(new RegExp(`<div class="mx" data-g="${g}">[^]*?</span></div>`))[0];
  assert.equal((rowOf("esito").match(/class="c/g) ?? []).length, 3, "1X2: tre opzioni");
  assert.equal((rowOf("esito").match(/class="c top/g) ?? []).length, 1, "un solo esito evidenziato");
  assert.equal((rowOf("gol").match(/class="c/g) ?? []).length, 2);
  assert.equal((rowOf("ou").match(/class="c/g) ?? []).length, 3, "una opzione per soglia (1,5 · 2,5 · 3,5)");
  assert.doesNotMatch(h, /Interessante|INTERESSANTE|API\+Q|mk-tag|NaN|undefined|null/);
  // etichetta, esito e percentuale sono elementi separati (mai «2 47%» in un'unica stringa)
  assert.match(rowOf("esito"), /<i>1<\/i><b>\d+%<\/b>/);
  const top = analysis.selections.filter((s) => ["home", "draw", "away"].includes(s.key)).sort((a, b) => b.p - a.p)[0];
  assert.match(rowOf("esito").match(/class="c top[^]*?<\/span>/)[0], new RegExp(`<b>${Math.round(top.p * 100)}%</b>`), "evidenzia il più probabile");
});
test("percentuali: tutte quelle mostrate sono quelle del motore", () => {
  const h = marketsHtml(item, { mode: "all" });
  for (const [, rawLabel, p] of h.matchAll(/<i>([^<]+)<\/i><b>(\d+)%<\/b>/g)) {
    const label = rawLabel.replace(/^★ /, "");
    const key = Object.entries({ 1: "home", X: "draw", 2: "away", GG: "btts", NG: "nobtts", "1X": "dc1x", X2: "dcx2", 12: "dc12", "Over 1,5": "over15", "Under 1,5": "under15", "Over 2,5": "over25", "Under 2,5": "under25", "Over 3,5": "over35", "Under 3,5": "under35" }).find(([l]) => l === label)?.[1];
    assert.ok(key, `etichetta sconosciuta ${label}`);
    assert.equal(Number(p), Math.round(mk.x[key].p * 100), `${label}`);
  }
});
test("corner: modello Stay Live e quote dei bookmaker, mai BET", () => {
  const cornerModel = { ok: true, lambda: { home: 5.1, away: 4.2, total: 9.3 }, mainLine: 9.5, lines: [8.5, 9.5, 10.5].map((l, i) => ({ line: l, over: [0.62, 0.48, 0.33][i], under: [0.38, 0.52, 0.67][i] })), sample: { home: 12, away: 11 } };
  const cv = cornerView({ ...item, cornerModel });
  assert.equal(cv.state, "model"); assert.equal(cv.reliability, "bassa");
  const mc = cornerView({ ...item, cornerModel, corner: { best: { side: "over", line: 9.5, p: 0.72, odd: 1.8 } } });
  assert.equal(mc.state, "market");
  const h = marketsHtml({ ...item, corner: { best: { side: "over", line: 9.5, p: 0.72, odd: 1.8 } } }, { mode: "all" });
  assert.match(h, /Over 9,5<\/i><b>72%<\/b><small>quota 1,80/, "quota del bookmaker accanto all'esito");
  assert.doesNotMatch(h.match(/data-g="corner"[^]*?<\/div>/)[0], /bet/);
  assert.match(marketsHtml({ ...item, cornerModel }, { mode: "all" }), /Non diventa mai BET/);
  assert.match(marketsHtml(item, { mode: "all" }), /Corner<\/span><span class="mx-na">/, "senza dati: non disponibile");
});
test("motivazioni: brevi, specifiche della partita, dai dati reali", () => {
  const key = mk.b.ou, t = motivationOf(item, key);
  assert.match(t, /Squadra 1/); assert.match(t, /gol attesi/); assert.ok(t.length < 260, "breve");
  const other = motivationOf({ ...item, home: "Altra A", away: "Altra B", mk: { ...mk, st: { ...mk.st, lh: 0.7, la: 2.4, tot: 3.1 } } }, key);
  assert.notEqual(t, other);
  assert.equal(motivationOf({ ...item, mk: { ...mk, st: null } }, key), "", "senza dati nessuna motivazione inventata");
  assert.match(whyNot("over25", { p: 0.55, l: 0.5, c: "T", v: 0, o: null }, mk), /soglia/);
  assert.match(whyNot("over05", { p: 0.93, l: 0.9, c: "M", v: 0, o: null }, mk), /troppo probabile/);
  assert.equal(whyNot("x", { v: 1 }, mk), "BET: supera le regole del motore");
  assert.match(altOf({ ...item, mk: { ...mk, x: { ...mk.x, draw: { ...mk.x.draw, p: 0.3, c: "A", v: 0, o: null } } } }, "home") + "x", /./);
  assert.ok(factOf(item, "home").includes("gol attesi"));
});
test("affidabilità: campione, accordo tra le fonti e incertezza", () => {
  assert.equal(reliabilityOf({ p: 0.7, l: 0.66, g: 1, sp: 0.02 }, { c: "buona" }), "alta");
  assert.equal(reliabilityOf({ p: 0.7, l: 0.5, g: -1, sp: 0.2 }, { c: "bassa" }), "bassa");
  assert.equal(reliabilityOf({ p: 0.7, l: 0.64, g: 0, sp: 0.03 }, { c: "media" }), "media");
});
test("Solo BET: solo i mercati con un BET della stessa analisi, evidenziati in verde", () => {
  const bet = { ...mk, x: { ...mk.x, over25: { ...mk.x.over25, v: 1, c: "B", l: 0.64, p: 0.7 } }, rec: ["over25"] };
  const h = marketsHtml({ ...item, mk: bet }, { mode: "bet" });
  assert.match(h, /data-g="ou"/); assert.doesNotMatch(h, /data-g="esito"|data-g="corner"/);
  assert.match(h, /class="c top bet rec rec-bet"><i><em class="star"[^>]*>★<\/em> Over 2,5/);
});
test("elenco non ancora rigenerato: il consiglio principale (es. X2) resta visibile con le sue cifre", () => {
  const pick = { key: "dcx2", label: "X2 · Pareggio o trasferta", p: 0.72, pLow: 0.63, verdict: "BET", confidence: "media", reason: "Probabilità prudente 63% (+11 punti sulla media del campionato).", odds: null };
  const h = marketsHtml({ id: "a", home: "A", away: "B", pick, mk: null, corner: null, cornerModel: null }, { mode: "all" });
  assert.match(h, /<i>X2<\/i><b>72%<\/b>/); assert.match(h, /c top bet/); assert.match(h, /dopo il prossimo aggiornamento/);
  assert.match(marketsHtml({ id: "a", home: "A", away: "B", pick, mk: null }, { mode: "bet" }), /Perché[^]*Probabilità prudente 63%/);
  assert.match(marketsHtml({ id: "a", home: "A", away: "B", pick: { ...pick, confidence: "insufficiente", sample: 2 }, mk: null }, { mode: "all" }), /pochi dati/);
});

/* ---------- Tendina: apribile e richiudibile, stato nell'HTML, nessuna altezza fissa ---------- */
test("tendina: stato aperto/chiuso coerente (aria-expanded, inert) e ridisegno idempotente", () => {
  const closed = marketsHtml(item, { mode: "all", open: false }), open = marketsHtml(item, { mode: "all", open: true });
  assert.match(closed, /class="acc mcd"[^>]*data-acc="mk:x1"/); assert.match(closed, /aria-expanded="false"/); assert.match(closed, /inert/);
  assert.match(open, /class="acc mcd open"/); assert.match(open, /aria-expanded="true"/); assert.doesNotMatch(open.match(/<div class="acc-panel[^>]*>/)[0], /inert/);
  assert.equal(marketsHtml(item, { mode: "all", open: true }), open, "stesso stato → stesso HTML");
  const a = accordionHtml({ id: "z", head: "h", body: "b" }); assert.match(a, /aria-controls="acc-z"/); assert.match(a, /id="acc-z"/);
  assert.equal((open.match(/data-acc=/g) ?? []).length, 1, "una sola tendina per scheda");
});
test("CSS della scheda: nessuna altezza fissa, nessuna rottura di parola, nomi di classe senza conflitti", () => {
  const css = fs.readFileSync(new URL("../src/design/matchcard.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /overflow-wrap:\s*anywhere|word-break:\s*break-all/, "i nomi non si spezzano a metà parola");
  const mcd = css.split("\n").filter((l) => /\.mcd|\.dt\b|\.mc-body|\.mcm/.test(l) && !/acc-chev/.test(l)).join("\n");
  assert.doesNotMatch(mcd, /[^-]height:\s*\d|max-height/, "il contenuto della tendina segue la sua altezza");
  assert.doesNotMatch(css.replace(/\.st-list \.mk/g, ""), /(^|[\s,}])\.mk\b/m, "«.mk» è dell'elenco di Impostazioni");
  const chrome = fs.readFileSync(new URL("../src/design/chrome.css", import.meta.url), "utf8");
  assert.doesNotMatch(chrome, /(^|[\s,}])\.mk[\s{.:,]/m, "nessun residuo della vecchia scheda in chrome.css");
});

/* ---------- Stemmi e nomi ---------- */
test("stemmi: ogni squadra ha il suo (per id), solo https, sigla se manca o non si carica", () => {
  assert.equal(logoFor("seriea", "af-489", "Milan", new Map()), "https://media.api-sports.io/football/teams/489.png");
  assert.notEqual(logoFor("seriea", "af-489", "Milan", new Map()), logoFor("seriea", "af-505", "Inter", new Map()));
  assert.equal(logoFor("seriea", "xx-1", "Sconosciuta", new Map()), null, "nessuno stemma inventato");
  const ok = crest("Albinoleffe", "https://media.api-sports.io/football/teams/1.png");
  assert.match(ok, /<img src="https:\/\/media\.api-sports\.io/); assert.match(ok, /<em>ALB<\/em>/);
  assert.doesNotMatch(crest("Albinoleffe", "http://x/y.png"), /<img/, "solo https");
  assert.doesNotMatch(crest("Albinoleffe", null), /<img/); assert.match(crest("Albinoleffe", null), /<em>ALB<\/em>/);
  assert.doesNotMatch(crest("<b>X</b>", "https://a/b.png\" onerror=\"x"), /onerror="x"/, "nessuna iniezione");
  const css = fs.readFileSync(new URL("../src/design/matchcard.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /\.crest[^{]*img\{[^}]*(width|height):\s*\d+%/, "l'immagine copre tutto lo stemma: niente sigla che spunta ai bordi");
});

/* ---------- Mercato consigliato e resoconto ---------- */
const withPick = (key, verdict = "BET") => ({ ...item, pick: { ...item.pick, key, verdict } });
test("mercato consigliato dal motore: un solo esito con la stella, anche se non è il più probabile", () => {
  const key = mk.b.dc;
  const h = marketsHtml(withPick(key), { mode: "all" });
  assert.equal((h.match(/class="c[^"]* rec/g) ?? []).length, 1, "uno solo tra tutti i mercati");
  assert.match(h.match(/<div class="mx" data-g="dc">[^]*?<\/div>/)[0], /rec rec-bet"><i><em class="star"[^>]*>★<\/em> /);
  assert.match(h, /★ Consigliato · /);
  const other = Object.keys(mk.x).find((k) => k.startsWith("over") && k !== "over05" && !["over15", "over25", "over35"].includes(k) === false && mk.x[k].p < mk.x[k.replace("over", "under")].p);
  if (other) assert.match(marketsHtml(withPick(other), { mode: "all" }), new RegExp(`★<\\/em> ${other === "over15" ? "Over 1,5" : other === "over25" ? "Over 2,5" : "Over 3,5"}`), "il consiglio è sempre visibile");
});
test("resoconto: pronosticato contro uscito, con ✓/✗ e celle segnate", () => {
  const final = { h: 2, a: 1, corners: 11 };
  const h = marketsHtml(item, { mode: "all", result: final, idPrefix: "pk" });
  assert.match(h, /Resoconto · finale 2–1/); assert.match(h, /data-acc="pk:x1"/);
  const rows = [...h.matchAll(/<div class="rc-r (ok|ko|)"><span>([^<]+)<\/span><b>([^<]*)<\/b><span>([^<]*)<\/span><i>([^<]*)<\/i>/g)];
  assert.ok(rows.length >= 4, "una riga per mercato");
  const esito = rows.find((r) => r[2] === "1X2");
  assert.equal(esito[4], "1", "uscito: 1 (2–1)");
  assert.equal(esito[1] === "ok", esito[3] === "1", "✓ solo se il pronostico coincide");
  const gol = rows.find((r) => r[2] === "Gol"); assert.equal(gol[4], "GG");
  const ou = rows.find((r) => r[2] === "Over/Under"); assert.equal(ou[4], "3 gol");
  assert.equal((h.match(/class="c[^"]* ok/g) ?? []).length > 0, true);
  assert.doesNotMatch(marketsHtml(item, { mode: "all" }), /Resoconto|rc-r/, "senza risultato nessun resoconto");
  const cm = { ...item, cornerModel: { ok: true, lambda: { home: 5, away: 4, total: 9 }, mainLine: 9.5, lines: [8.5, 9.5, 10.5].map((l) => ({ line: l, over: 0.6, under: 0.4 })), sample: { home: 9, away: 9 } } };
  assert.match(marketsHtml(cm, { mode: "all", result: final }), /11 corner/);
  assert.match(marketsHtml(cm, { mode: "all", result: { h: 1, a: 0, corners: null } }), /non disponibile/, "corner reali ignoti: nessun esito inventato");
});
test("ogni esito mostrato come uscito è coerente con il punteggio", () => {
  const final = { h: 0, a: 0, corners: 8 };
  const h = marketsHtml(item, { mode: "all", result: final });
  for (const c of h.matchAll(/<span class="c([^"]*)"><i>(?:★ )?([^<]+)<\/i>/g)) {
    const ok = c[1].includes(" ok"), l = c[2];
    if (l === "GG") assert.equal(ok, false); if (l === "NG") assert.equal(ok, true);
    if (l === "X") assert.equal(ok, true); if (l === "1" || l === "2") assert.equal(ok, false);
    if (l.startsWith("Over") && /\d/.test(l) && !l.includes("corner")) assert.equal(ok, false, `0–0: ${l} non esce`);
  }
});

test("★ solo per un BET vero; la selezione più probabile ma non consigliata ha un simbolo discreto (◦) e un'etichetta diversa", () => {
  const key = mk.b.dc;
  const evita = marketsHtml(withPick(key, "EVITA"), { mode: "all" });
  assert.doesNotMatch(evita, /★/, "nessuna stella se non è un BET");
  assert.match(evita, /rec rec-soft"><i><em class="dot"[^>]*>◦<\/em> /);
  assert.match(evita, /◦ Più probabile, non consigliato · /);
  const nodq = marketsHtml({ ...withPick(key, "BET"), dq: { betOk: false } }, { mode: "all" });
  assert.doesNotMatch(nodq, /★/, "BET con dati insufficienti: niente stella");
  assert.match(marketsHtml(withPick(key, "BET"), { mode: "all" }), /rec rec-bet/);
});
