import test from "node:test";
import assert from "node:assert/strict";
import { topLevel } from "../functions/api/_html.js";
import { discoverLineupUrl, parseDate, parsePremierInjuries, parseProbableLineups, parseTransfermarkt, parseValue, roleOf } from "../functions/api/_sources.js";
import { SCRAPE_TTL, backoffMs, bestTeam, buildRows, coverageOf, mergeSources, planJobs, samePlayer, scrapeDue } from "../functions/api/_scrape.js";

// Frammenti ricostruiti sulla struttura nota delle pagine (tabella annidata "inline-table" di Transfermarkt, ecc.).
const TM = `<table class="items"><thead><tr><th>Player</th><th>Club</th><th>Injury</th><th>since</th><th>until</th><th>Market value</th></tr></thead><tbody>
<tr class="odd"><td><table class="inline-table"><tr><td rowspan="2"><a href="/x/profil/spieler/1"><img src="a.jpg"></a></td><td class="hauptlink"><a href="/lautaro-martinez/profil/spieler/406625">Lautaro Martínez</a></td></tr><tr><td>Centre-Forward</td></tr></table></td>
 <td class="zentriert"><a title="Inter Milan" href="/inter/startseite/verein/46"><img class="tiny_wappen" alt="Inter Milan"></a></td><td>Hamstring injury</td><td class="zentriert">Oct 20, 2026</td><td class="zentriert">Nov 10, 2026</td><td class="rechts hauptlink">€90.00m</td></tr>
<tr class="even"><td><table class="inline-table"><tr><td><a href="/k/profil/spieler/2">Yann Sommer</a></td></tr><tr><td>Goalkeeper</td></tr></table></td>
 <td><a title="Inter Milan" href="/inter/startseite/verein/46">Inter</a></td><td>Yellow card suspension</td><td>10/10/2026</td><td>Unknown</td><td>€8.00m</td></tr>
<tr><td><table class="inline-table"><tr><td><a href="/p/profil/spieler/3">Rafael Leão</a></td></tr><tr><td>Left Winger</td></tr></table></td>
 <td><a title="AC Milan" href="/milan/startseite/verein/5">Milan</a></td><td>Knee problems</td><td>01.10.2026</td><td>?</td><td>€800k</td></tr></tbody></table>`;

test("topLevel rispetta le tabelle annidate", () => {
  const rows = topLevel(TM, "tr");
  assert.equal(rows.filter((r) => /inline-table/.test(r.html)).length, 3);
  assert.equal(topLevel(rows[1].html, "td").length, 6);
});

test("Transfermarkt: giocatore, ruolo, club, date, valore; squalifica riconosciuta", () => {
  const p = parseTransfermarkt(TM);
  assert.equal(p.length, 3);
  assert.deepEqual([p[0].name, p[0].team, p[0].role, p[0].detail, p[0].since, p[0].until, p[0].value, p[0].kind],
    ["Lautaro Martínez", "Inter Milan", "F", "Hamstring injury", "2026-10-20", "2026-11-10", 90_000_000, "injury"]);
  assert.equal(p[1].kind, "suspension");
  assert.equal(p[1].role, "G");
  assert.equal(p[1].until, null);
  assert.equal(p[2].team, "AC Milan");
  assert.equal(p[2].value, 800_000);
});

test("Transfermarkt: pagina senza tabella o sfida anti-bot -> nessun dato, nessuna eccezione", () => {
  assert.deepEqual(parseTransfermarkt("<html><body>Just a moment...</body></html>"), []);
  assert.deepEqual(parseTransfermarkt(""), []);
});

test("date, valori e ruoli", () => {
  assert.equal(parseDate("Oct 12, 2026"), "2026-10-12");
  assert.equal(parseDate("12 ott 2026"), "2026-10-12");
  assert.equal(parseDate("12/10/2026"), "2026-10-12");
  assert.equal(parseDate("Unknown"), null);
  assert.equal(parseValue("25,00 mln €"), 25_000_000);
  assert.equal(parseValue("€1.20bn"), 1_200_000_000);
  assert.equal(parseValue("12"), null);
  assert.equal(roleOf("Defensive Midfield"), "M");
  assert.equal(roleOf("Centre-Back"), "D");
  assert.equal(roleOf("Attaccante"), "F");
});

const PI = `<h1>Premier League Injury Table</h1><h2>Arsenal</h2><table><tr><th>Player</th><th>Reason</th><th>Further Detail</th><th>Potential Return</th><th>Status</th></tr>
<tr><td>Bukayo Saka</td><td>Hamstring</td><td>Strain</td><td>04/11/2026</td><td>Doubt - 25% chance</td></tr>
<tr><td>Gabriel Jesus</td><td>Knee</td><td></td><td>Unknown</td><td>Out</td></tr></table>
<h2>Chelsea Injuries</h2><table><tr><th>Player</th><th>Reason</th><th>Potential Return</th><th>Status</th></tr>
<tr><td>Reece James</td><td>Suspended</td><td>-</td><td>Suspended</td></tr></table>`;

test("PremierInjuries: club dall'intestazione, probabilità di giocare e stato", () => {
  const p = parsePremierInjuries(PI);
  assert.equal(p.length, 3);
  assert.deepEqual([p[0].team, p[0].name, p[0].playChance, p[0].status, p[0].until], ["Arsenal", "Bukayo Saka", 0.25, "doubt", "2026-11-04"]);
  assert.deepEqual([p[1].playChance, p[1].status], [0, "out"]);
  assert.deepEqual([p[2].team, p[2].kind], ["Chelsea", "suspension"]);
});

const SKY = `<div><h3>INTER-TORINO</h3><p>INTER (3-5-2): Sommer; Pavard, Acerbi, Bastoni; Darmian, Barella, Calhanoglu, Mkhitaryan, Dimarco; Thuram, Lautaro. All. Inzaghi</p>
<p>Squalificati: nessuno</p><p>Indisponibili: Zielinski, Frattesi</p><p>Ballottaggi: Darmian-Dumfries 55-45%</p>
<p>TORINO (3-5-2): Paleari; Ismajli, Maripan, Tameze; Pedersen, Asllani, Gineitis, Vlasic, Lazaro; Zapata, Adams</p>
<p>Squalificati: Ismajli | Indisponibili: Schuurs, Savva</p></div>`;

test("probabili formazioni: XI, squalificati, indisponibili e ballottaggi (formato testuale Sky/Goal)", () => {
  const b = parseProbableLineups(SKY);
  assert.equal(b.length, 2);
  assert.equal(b[0].team, "INTER");
  assert.equal(b[0].formation, "3-5-2");
  assert.equal(b[0].xi.length, 11);
  assert.equal(b[0].complete, true);
  assert.deepEqual(b[0].suspended, []);
  assert.deepEqual(b[0].unavailable, ["Zielinski", "Frattesi"]);
  assert.deepEqual(b[0].doubts, ["Darmian-Dumfries 55-45%"]);
  assert.deepEqual(b[1].suspended, ["Ismajli"]);
  assert.deepEqual(b[1].unavailable, ["Schuurs", "Savva"]);
  assert.deepEqual(parseProbableLineups("<html>pagina vuota</html>"), []);
});

test("ricerca dell'URL più recente delle formazioni nella home", () => {
  const hub = `<a href="/calcio/serie-a/2026/10/23/probabili-formazioni-serie-a-giornata-9">a</a><a href="https://sport.sky.it/calcio/serie-a/2026/10/30/probabili-formazioni-serie-a-giornata-10?card=1">b</a><a href="/calcio/serie-a/2026/12/30/probabili-formazioni-futuro">c</a>`;
  assert.equal(discoverLineupUrl(hub, Date.parse("2026-10-30T10:00:00Z")), "https://sport.sky.it/calcio/serie-a/2026/10/30/probabili-formazioni-serie-a-giornata-10");
  assert.equal(discoverLineupUrl("<html></html>"), null);
});

test("politica di aggiornamento: 60 min tra 24 e 48 h, 30 min nelle ultime 24 h, niente fuori finestra, backoff", () => {
  const now = Date.parse("2026-10-30T12:00:00Z");
  const h = 3600e3;
  const fresh = (min) => ({ scraped_at: new Date(now - min * 60e3).toISOString() });
  assert.equal(scrapeDue(null, now + 30 * h, now), true);
  assert.equal(scrapeDue(fresh(45), now + 30 * h, now), false);   // lontano: TTL 60
  assert.equal(scrapeDue(fresh(61), now + 30 * h, now), true);
  assert.equal(scrapeDue(fresh(20), now + 5 * h, now), false);    // vicino: TTL 30
  assert.equal(scrapeDue(fresh(31), now + 5 * h, now), true);
  assert.equal(scrapeDue({ ...fresh(120), blocked_until: new Date(now + 600e3).toISOString() }, now + 5 * h, now), false);
  assert.equal(SCRAPE_TTL.near, 30 * 60e3);
  assert.deepEqual([1, 2, 3, 20].map(backoffMs), [600e3, 1200e3, 2400e3, 6 * h]);
  const m = (id, league, dh, status = "scheduled") => ({ game_id: id, league, status, kickoff_at: new Date(now + dh * h).toISOString() });
  const jobs = planJobs([m("a", "seriea", 5), m("b", "seriea", 30), m("c", "epl", 60), m("d", "mls", 3), m("e", "laliga", 2, "final")], [], now);
  assert.deepEqual(jobs.map((j) => `${j.source}/${j.league}`).sort(), ["lineups/seriea", "transfermarkt/seriea"]);   // epl a 60 h fuori finestra, mls senza fonti, partita finita ignorata
  const epl = planJobs([m("c", "epl", 10)], [], now).map((j) => j.source).sort();
  assert.deepEqual(epl, ["premierinjuries", "transfermarkt"]);
});

test("abbinamento squadre: 'Milan' non diventa 'Inter Milan'", () => {
  const teams = ["Inter Milan", "AC Milan", "Torino FC"];
  assert.equal(bestTeam("AC Milan", teams), "AC Milan");
  assert.equal(bestTeam("Milan", teams), "AC Milan");
  assert.equal(bestTeam("Internazionale", teams), "Inter Milan");
  assert.equal(bestTeam("Torino", teams), "Torino FC");
  assert.equal(bestTeam("Lazio", teams), null);
  assert.equal(bestTeam("Inter", ["Inter Milan"], "Inter Milan"), null);
  assert.ok(samePlayer("Bukayo Saka", "B. Saka") && samePlayer("Saka", "Bukayo Saka") && !samePlayer("Bukayo Saka", "Ethan Saka"));
});

test("righe: fonti diverse si fondono senza cancellarsi e il quadro resta coerente", () => {
  const now = Date.parse("2026-10-30T12:00:00Z");
  const match = { game_id: "g1", league: "seriea", home_name: "Internazionale", away_name: "Torino" };
  const tm = buildRows({ source: "transfermarkt", parsed: parseTransfermarkt(TM), matches: [match], existing: new Map(), now });
  assert.equal(tm[0].injuries.home.length, 1);
  assert.equal(tm[0].suspensions.home.length, 1);
  assert.equal(tm[0].injuries.away.length, 0);               // Torino non è nell'elenco: nessun assente segnalato
  assert.equal(coverageOf(tm[0]), "full");
  const lu = buildRows({ source: "lineups", parsed: parseProbableLineups(SKY), matches: [match], existing: new Map([["g1", tm[0]]]), now: now + 60e3 });
  assert.ok(lu[0].sources.transfermarkt && lu[0].sources.lineups);
  assert.equal(lu[0].probable_lineups.home.formation, "3-5-2");
  assert.equal(lu[0].probable_lineups.away.src, "lineups");
  const names = lu[0].injuries.home.map((i) => i.name);
  assert.ok(names.includes("Lautaro Martínez") && names.includes("Zielinski"));
  assert.equal(lu[0].suspensions.away[0].name, "Ismajli");
  assert.equal(coverageOf(lu[0]), "full");
  assert.equal(coverageOf({ sources: {} }), "none");
  const merged = mergeSources({ transfermarkt: { at: "2026-10-30T12:00:00Z", injuries: { home: [{ name: "Bukayo Saka", role: "F", value: 90e6, playChance: 0, status: "out" }], away: [] } }, premierinjuries: { at: "2026-10-30T12:05:00Z", injuries: { home: [{ name: "B. Saka", role: null, playChance: 0.25, status: "doubt" }], away: [] } } });
  assert.equal(merged.injuries.home.length, 1);                // stesso giocatore in due fonti
  assert.deepEqual([merged.injuries.home[0].role, merged.injuries.home[0].value, merged.injuries.home[0].src], ["F", 90e6, ["premierinjuries", "transfermarkt"]]);
  assert.equal(merged.last_scraped_at, "2026-10-30T12:05:00.000Z");
});
