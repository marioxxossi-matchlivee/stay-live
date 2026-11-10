import test from "node:test";
import assert from "node:assert/strict";
import { MIN_GAMES, backfillCorners, buildCornerContext, cornerModel, cornerRow, cornersFromStatistics, nbPmf, selectBackfill } from "../functions/api/_cornerstats.js";

const stats = (h, a) => [{ team: { id: 1 }, statistics: [{ type: "Shots on Goal", value: 3 }, { type: "Corner Kicks", value: h }] }, { team: { id: 2 }, statistics: [{ type: "Corner Kicks", value: a }] }];

test("corner dalle statistiche API-Football", () => {
  assert.deepEqual(cornersFromStatistics(stats(7, 3), 1, 2), { home: 7, away: 3, total: 10 });
  assert.deepEqual(cornersFromStatistics(stats(7, 3).reverse(), 1, 2), { home: 7, away: 3, total: 10 }, "ordine delle squadre irrilevante");
  assert.equal(cornersFromStatistics([], 1, 2), null);
  assert.equal(cornersFromStatistics([{ team: { id: 1 }, statistics: [] }, { team: { id: 2 }, statistics: [] }], 1, 2), null);
  assert.equal(cornersFromStatistics(stats(null, 3), 1, 2), null);
});

test("distribuzioni: sommano a 1 e hanno la media richiesta", () => {
  for (const disp of [1, 1.4]) {
    const p = nbPmf(5, disp), sum = p.reduce((s, x) => s + x, 0), mean = p.reduce((s, x, i) => s + x * i, 0);
    assert.ok(Math.abs(sum - 1) < 1e-4 && Math.abs(mean - 5) < 0.01, `disp ${disp}: somma ${sum}, media ${mean}`);
  }
  const v = (p) => { const m = p.reduce((s, x, i) => s + x * i, 0); return p.reduce((s, x, i) => s + x * (i - m) ** 2, 0); };
  assert.ok(v(nbPmf(5, 1.5)) > v(nbPmf(5, 1)), "dispersione maggiore = varianza maggiore");
});

// storico sintetico: la squadra 10 fa molti corner (8 fatti, 3 subiti), la 20 pochi (3 fatti, 8 subiti), le altre 5-5
function history() {
  const rows = []; let t = Date.parse("2026-09-01T15:00:00Z");
  const add = (h, a, hc, ac) => { rows.push({ game_id: `af-${rows.length + 1}`, league: "seriea", kickoff_at: new Date(t).toISOString(), home_id: `af-${h}`, away_id: `af-${a}`, home_corners: hc, away_corners: ac, available: true }); t += 86400e3; };
  for (let i = 0; i < 8; i += 1) { add(10, 30 + (i % 3), 8, 3); add(30 + (i % 3), 10, 4, 7); add(20, 30 + (i % 3), 3, 8); add(30 + (i % 3), 20, 8, 4); add(30, 31, 5, 5); add(31, 30, 5, 5); }
  return rows;
}

test("modello corner: la squadra da molti corner ne ha di più, probabilità coerenti", () => {
  const ctx = buildCornerContext(history());
  const m = cornerModel(ctx, { league: "seriea", kickoff_at: "2026-12-01T15:00:00Z", home_id: "af-10", away_id: "af-20" });
  assert.equal(m.ok, true);
  assert.ok(m.lambda.home > m.lambda.away + 2, `${m.lambda.home} vs ${m.lambda.away}`);
  assert.equal(m.moreCorners.side, "home"); assert.ok(m.moreCorners.home > 0.7);
  assert.ok(Math.abs(m.moreCorners.home + m.moreCorners.away + m.moreCorners.even - 1) < 0.002);
  for (let i = 1; i < m.lines.length; i += 1) assert.ok(m.lines[i].over <= m.lines[i - 1].over, "Over decrescente al crescere della linea");
  for (const l of m.lines) assert.ok(Math.abs(l.over + l.under - 1) < 0.001);
  assert.equal(m.verified, false); assert.equal(m.source, "stay-live");
  const flip = cornerModel(ctx, { league: "seriea", kickoff_at: "2026-12-01T15:00:00Z", home_id: "af-20", away_id: "af-10" });
  assert.ok(m.lambda.home > flip.lambda.home, "il fattore campo e le squadre contano");
});

test("modello corner: dati insufficienti = nessuna stima inventata", () => {
  const ctx = buildCornerContext(history());
  const few = cornerModel(ctx, { league: "seriea", kickoff_at: "2026-12-01T15:00:00Z", home_id: "af-10", away_id: "af-999" });
  assert.equal(few.ok, false); assert.match(few.reason, new RegExp(`almeno ${MIN_GAMES}`));
  assert.equal(cornerModel(ctx, { league: "laliga", kickoff_at: "2026-12-01T15:00:00Z", home_id: "af-10", away_id: "af-20" }).ok, false);
  assert.equal(cornerModel(buildCornerContext([{ ...history()[0], available: false }]), { league: "seriea", kickoff_at: "2026-12-01T15:00:00Z", home_id: "af-10", away_id: "af-20" }).ok, false, "partite senza statistiche non contano");
  // nessun uso di partite future rispetto al calcio d'inizio
  const early = cornerModel(ctx, { league: "seriea", kickoff_at: "2026-09-02T15:00:00Z", home_id: "af-10", away_id: "af-20" });
  assert.equal(early.ok, false);
});

test("scarico dello storico: squadre che giocano a breve, ultime partite, niente doppioni, solo id API-Football", () => {
  const now = Date.parse("2026-11-09T12:00:00Z");
  const fin = (id, h, a, daysAgo, league = "seriea") => ({ game_id: id, league, home_id: `af-${h}`, away_id: `af-${a}`, kickoff_at: new Date(now - daysAgo * 86400e3).toISOString() });
  const finals = [fin("af-1", 1, 2, 3), fin("af-2", 1, 3, 10), fin("af-3", 5, 6, 4), fin("legacy-9", 1, 2, 5), fin("af-4", 1, 2, 0.1), fin("af-5", 1, 3, 20)];
  const open = [{ game_id: "af-100", league: "seriea", home_id: "af-1", away_id: "af-2", kickoff_at: new Date(now + 5 * 3600e3).toISOString() }];
  const q = selectBackfill(open, finals, new Set(["af-5"]), { now, perTeam: 15 });
  assert.deepEqual(q.map((f) => f.game_id).sort(), ["af-1", "af-2"], "af-3 non riguarda le squadre in campo, legacy escluso, af-4 troppo recente, af-5 già presente");
  assert.equal(selectBackfill(open, finals, new Set(), { now, perTeam: 1 }).length, 1);
  assert.equal(cornerRow({ game_id: "af-1", league: "seriea", kickoff_at: "x", home_id: "a", away_id: "b" }, null).available, false);
  assert.equal(typeof backfillCorners, "function");
});

test("scarico corner: si saltano i campionati per cui il provider non fornisce statistiche", () => {
  const now = Date.parse("2026-11-09T12:00:00Z");
  const fin = (id, league) => ({ game_id: id, league, home_id: "af-1", away_id: "af-2", kickoff_at: new Date(now - 3 * 86400e3).toISOString() });
  const open = [{ game_id: "af-100", league: "seriea", home_id: "af-1", away_id: "af-2", kickoff_at: new Date(now + 5 * 3600e3).toISOString() }];
  const q = selectBackfill(open, [fin("af-1", "seriea"), fin("af-2", "serie_c_a")], new Set(), { now, skipLeagues: new Set(["serie_c_a"]) });
  assert.deepEqual(q.map((f) => f.game_id), ["af-1"]);
});
