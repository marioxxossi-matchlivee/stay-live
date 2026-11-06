import { errorMessage, json, loadFinals, missingConfig, supabaseGet } from "./_lib.js";
import { analyzeMatch, buildContext, buildMultiples, compactPick, ou25Of } from "./model.js";
import { loadCornerOdds } from "./_corners.js";
import { loadLogoIndex, withLogos } from "./_crests.js";
import { brainStatusOf, loadBrainInputs } from "./_brain.js";

/** GET /api/preview?ids=a,b,c&n=8  ->  consiglio per ogni partita scelta + multipla suggerita. */
export async function onRequest({ request, env }) {
  const url = new URL(request.url);
  const ids = [...new Set((url.searchParams.get("ids") ?? "").split(",").map((s) => s.trim()).filter(Boolean))];
  const n = [5, 8, 10].includes(Number(url.searchParams.get("n"))) ? Number(url.searchParams.get("n")) : 8;
  if (!ids.length || ids.length > 40 || !ids.every((id) => /^[\w-]{3,80}$/.test(id))) {
    return json({ error: "Seleziona da 1 a 40 partite." }, 400);
  }
  const missing = missingConfig(env);
  if (missing.length) return json({ error: `Variabili mancanti: ${missing.join(", ")}` }, 503);
  try {
    const [matches, finals, logos] = await Promise.all([
      supabaseGet(env, "matches", { select: "*", game_id: `in.(${ids.map((i) => `"${i}"`).join(",")})`, order: "kickoff_at.asc", limit: 40 }),
      loadFinals(env),
      loadLogoIndex(env),
    ]);
    const ctx = buildContext(finals);
    // Cervello unico: pronostico di API-Football + quote di mercato per le partite scelte, a piccoli passi (cache = nessuna richiesta).
    // Ciò che non è ancora arrivato si calcola con le fonti disponibili e il browser richiede da solo.
    const none = { byGame: new Map(), state: new Map(), marketState: new Map(), retry: { pending: 0, afterMs: 0 } };
    const br = env.API_FOOTBALL_KEY ? await loadBrainInputs(env, matches, Date.now()).catch((e) => { console.error("Stay Live brain:", errorMessage(e)); return none; }) : none;
    // Modalità personalizzata (mode=ou25): il consiglio è solo Over/Under 2,5, BET se la probabilità finale supera la soglia scelta (thr).
    const params = new URL(request.url).searchParams;
    const custom = params.get("mode") === "ou25";
    const thr = Math.min(0.9, Math.max(0.5, Number(params.get("thr")) || 0.6));
    const cr = custom && env.API_FOOTBALL_KEY ? await loadCornerOdds(env, matches, Date.now(), { live: false, maps: br.maps }).catch(() => null) : null;
    const items = matches.map((m) => {
      let a = analyzeMatch(m, ctx, { n, ...(br.byGame.get(m.game_id) ?? {}) });
      if (custom) {
        const best = ou25Of(a)?.best;
        const sel = best && a.selections.find((s) => s.key === best.key);
        const ok = sel && sel.p >= thr && sel.agree !== "contraddice";
        a = { ...a, pick: sel ? { ...sel, verdict: ok ? "BET" : "EVITA", reason: ok ? `Probabilità ${Math.round(sel.p * 100)}% sopra la soglia del ${Math.round(thr * 100)}%.` : sel.agree === "contraddice" ? "API-Football non è d'accordo." : `Sotto la soglia del ${Math.round(thr * 100)}%.` } : null };
      }
      return {
        id: m.game_id, league: m.league, kickoffAt: m.kickoff_at, status: m.status, home: m.home_name, away: m.away_name, ...withLogos(m, logos),
        pick: compactPick(a), alternatives: a.alternatives.slice(0, 2).map((s) => ({ label: s.label, p: s.p, pLow: s.pLow, minOdds: s.minOdds })),
        topScores: a.topScores, confidence: a.confidence, sample: a.sample, lambda: a.lambda, legs: a.legs, basis: a.basis,
        corner: cr?.byGame.get(m.game_id) ?? null,
        af: br.state.get(m.game_id) ?? "missing", afPercent: a.api?.percent ?? null, afAdvice: a.api?.adviceIt?.label ?? null,
      };
    });
    return json({
      n, generatedAt: new Date().toISOString(), items, afStatus: { ...brainStatusOf(br, matches.map((m) => m.game_id)), off: !env.API_FOOTBALL_KEY },
      summary: { selected: items.length, bets: items.filter((i) => i.pick?.verdict === "BET").length, multiples: buildMultiples(items).length },
    });
  } catch (error) {
    console.error("Stay Live preview:", errorMessage(error));
    return json({ error: errorMessage(error) }, 502);
  }
}
