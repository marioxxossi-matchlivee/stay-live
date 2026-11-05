import { json, supabaseGet } from "./_lib.js";

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const fixtureId = Number(url.searchParams.get("fixtureId"));
  if (!Number.isInteger(fixtureId) || fixtureId <= 0) {
    return json({ error: "Parametro fixtureId obbligatorio." }, 400);
  }
  try {
    const rows = await supabaseGet(env, "odds_snapshots", {
      select: "provider,bookmaker,market,line,selection,odds,is_live,captured_at",
      fixture_id: `eq.${fixtureId}`,
      order: "captured_at.desc",
      limit: "100",
    });
    const byMarket = new Map();
    for (const row of rows) {
      const key = `${row.market}|${row.line ?? ""}|${row.selection}|${row.is_live}`;
      if (!byMarket.has(key)) byMarket.set(key, { market: row.market, line: row.line, selection: row.selection, live: row.is_live, prices: [] });
      byMarket.get(key).prices.push({ bookmaker: row.bookmaker, provider: row.provider, odds: Number(row.odds), capturedAt: row.captured_at });
    }
    const markets = [...byMarket.values()].map((item) => ({
      ...item,
      averageOdds: item.prices.length ? Number((item.prices.reduce((s, p) => s + p.odds, 0) / item.prices.length).toFixed(3)) : null,
      bookmakerCount: item.prices.length,
    }));
    return json({ fixtureId, source: "supabase-odds-snapshots", available: markets.length > 0, markets });
  } catch (error) {
    console.error("Stay Live odds error:", error.message);
    return json({ error: "Quote non disponibili. Importa prima gli snapshot delle quote in Supabase." }, 503);
  }
}
