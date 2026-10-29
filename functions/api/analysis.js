import { json } from "./_lib.js";
import { average, confidence, poissonProbabilityOver } from "./model.js";

const API_URL = "https://api.api-ninjas.com/v1/soccermatches";
const LEAGUE = "seriea";
const SEASON = "2026";
const PAGE_SIZE = 50;
const MAX_PAGES = 12;

function cleanName(value) {
  return String(value ?? "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().replace(/\b(fc|afc|ac|as|ssc|cf)\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

function matchTeam(item, target) {
  const name = cleanName(target);
  const providerName = cleanName(item?.name);
  const providerId = cleanName(item?.team_id);
  return Boolean(name && (
    providerName === name ||
    providerName.includes(name) ||
    name.includes(providerName) ||
    providerId === name ||
    providerId.endsWith(name)
  ));
}

async function getPage(env, offset) {
  const url = new URL(API_URL);
  url.searchParams.set("league", LEAGUE);
  url.searchParams.set("season", SEASON);
  url.searchParams.set("offset", String(offset));
  const response = await fetch(url.toString(), {
    headers: { "X-Api-Key": env.API_NINJAS_KEY, accept: "application/json" },
    cf: { cacheTtl: 600, cacheEverything: true },
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error(`Risposta API Ninjas non valida (HTTP ${response.status}).`); }
  if (!response.ok) {
    const detail = typeof data?.error === "string" ? data.error : JSON.stringify(data);
    throw new Error(`API Ninjas HTTP ${response.status}: ${detail.slice(0, 220)}`);
  }
  if (!Array.isArray(data)) throw new Error("Formato inatteso restituito da API Ninjas.");
  return data;
}

async function loadSeason(env) {
  if (!env.API_NINJAS_KEY) throw new Error("Manca il secret API_NINJAS_KEY su Cloudflare.");
  const all = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const rows = await getPage(env, page * PAGE_SIZE);
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  const byId = new Map();
  for (const item of all) {
    const id = item.game_id ?? `${item.date}-${item.home_team?.team_id}-${item.away_team?.team_id}`;
    byId.set(String(id), item);
  }
  return [...byId.values()];
}

function isFinished(item) {
  return String(item.status ?? "").toLowerCase() === "final" &&
    Number.isFinite(item.home_score) && Number.isFinite(item.away_score);
}

function teamHistory(rows, teamName, limit) {
  return rows
    .filter(isFinished)
    .filter((item) => matchTeam(item.home_team, teamName) || matchTeam(item.away_team, teamName))
    .sort((a, b) => String(b.start_time ?? b.date ?? "").localeCompare(String(a.start_time ?? a.date ?? "")))
    .slice(0, limit)
    .map((item) => {
      const isHome = matchTeam(item.home_team, teamName);
      return {
        goalsFor: Number(isHome ? item.home_score : item.away_score),
        goalsAgainst: Number(isHome ? item.away_score : item.home_score),
        corners: null,
        date: item.start_time ?? item.date ?? null,
      };
    });
}

export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const homeName = url.searchParams.get("homeName") ?? "";
  const awayName = url.searchParams.get("awayName") ?? "";
  const requested = Number(url.searchParams.get("matches") ?? 5);
  const limit = requested === 10 ? 10 : 5;

  if (!homeName || !awayName || cleanName(homeName) === cleanName(awayName)) {
    return json({ error: "Non riesco a identificare entrambe le squadre per l'analisi." }, 400);
  }

  try {
    const rows = await loadSeason(env);
    const homeRows = teamHistory(rows, homeName, limit);
    const awayRows = teamHistory(rows, awayName, limit);
    if (!homeRows.length || !awayRows.length) {
      return json({
        error: `Storico insufficiente per ${!homeRows.length ? homeName : awayName}. Verifica i nomi restituiti da API Ninjas e riprova.`,
      }, 404);
    }

    const homeGoalsFor = average(homeRows.map((r) => r.goalsFor));
    const homeGoalsAgainst = average(homeRows.map((r) => r.goalsAgainst));
    const awayGoalsFor = average(awayRows.map((r) => r.goalsFor));
    const awayGoalsAgainst = average(awayRows.map((r) => r.goalsAgainst));
    const expectedHome = homeGoalsFor == null || awayGoalsAgainst == null ? null : (homeGoalsFor + awayGoalsAgainst) / 2;
    const expectedAway = awayGoalsFor == null || homeGoalsAgainst == null ? null : (awayGoalsFor + homeGoalsAgainst) / 2;
    const expectedTotal = expectedHome == null || expectedAway == null ? null : expectedHome + expectedAway;

    return json({
      source: "api-ninjas-season-history",
      teams: { home: homeName, away: awayName },
      sampleSize: { home: homeRows.length, away: awayRows.length, requested: limit },
      confidence: confidence(Math.min(homeRows.length, awayRows.length)),
      recentMatches: {
        home: homeRows,
        away: awayRows,
      },
      goals: {
        homeAverageFor: homeGoalsFor,
        awayAverageFor: awayGoalsFor,
        expectedHome,
        expectedAway,
        homeConcededAverage: homeGoalsAgainst,
        awayConcededAverage: awayGoalsAgainst,
        expectedTotal,
        over15: expectedTotal == null ? null : Number((poissonProbabilityOver(expectedTotal, 1.5) * 100).toFixed(1)),
        over25: expectedTotal == null ? null : Number((poissonProbabilityOver(expectedTotal, 2.5) * 100).toFixed(1)),
        over35: expectedTotal == null ? null : Number((poissonProbabilityOver(expectedTotal, 3.5) * 100).toFixed(1)),
      },
      corners: {
        homeAverageFor: null,
        awayAverageFor: null,
        expectedTotal: null,
        over75: null,
        over85: null,
        over95: null,
      },
      disclaimer: "Analisi sperimentale basata sulle ultime partite concluse disponibili nella stagione 2026 di API Ninjas. Il provider non restituisce statistiche corner in questo endpoint; le stime non sono un consiglio di scommessa.",
    });
  } catch (error) {
    console.error("Stay Live API Ninjas analysis:", error instanceof Error ? error.message : error);
    return json({ error: error instanceof Error ? error.message : "Errore durante l'analisi." }, 503);
  }
}
