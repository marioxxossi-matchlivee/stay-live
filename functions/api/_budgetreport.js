/** Aggregazioni PURE per la dashboard crediti (nessuna rete). Usano il contatore esistente (af_usage) e il registro af_ledger. */
import { romeDay } from "./_policy.js";

/** Partite di oggi/domani complete, con quote mancanti ecc., dalla lista dell'istantanea. */
export function completenessSummary(matches, now = Date.now()) {
  const today = romeDay(now), tomorrow = romeDay(now + 86400e3);
  const out = { today: { total: 0, complete: 0 }, tomorrow: { total: 0, complete: 0 }, week: { total: 0, complete: 0 }, missingOdds: 0, byStatus: {} };
  for (const m of matches ?? []) {
    if (!m.dq) continue;
    const d = romeDay(Date.parse(m.kickoffAt));
    const b = d === today ? out.today : d === tomorrow ? out.tomorrow : out.week;
    b.total += 1; if (m.dq.status === "complete") b.complete += 1;
    out.byStatus[m.dq.status] = (out.byStatus[m.dq.status] ?? 0) + 1;
    if (m.dq.parts?.odds === "missing" || m.dq.parts?.odds === "waiting") out.missingOdds += 1;
  }
  return out;
}

const AVOIDED = ["cache_hit", "dedup_inflight", "skipped_backoff"];
/**
 * usage = riga af_usage di oggi; ledger = righe af_ledger delle ultime 48 ore; tasks = refresh_tasks; completeness = meta.completeness dell'istantanea.
 * Consumo = solo gli esiti che costano (ok, empty, failed, rate_limited): `credits`.
 */
export function summarizeBudget({ usage, ledger = [], tasks = [], completeness = null, now = Date.now(), limit = 7500 }) {
  const lim = usage?.limit_day ?? limit, used = usage?.requests ?? 0;
  const cutoff = now - 24 * 3600e3;
  const inWindow = ledger.filter((r) => Date.parse(`${r.day}T${String(r.hour).padStart(2, "0")}:59:59Z`) > cutoff);
  const spend = (r) => ["ok", "empty", "failed", "rate_limited"].includes(r.outcome);
  const add = (map, key, r) => { const e = map[key] ??= { requests: 0, ok: 0, empty: 0, failed: 0 }; e.requests += r.credits; if (r.outcome === "ok") e.ok += r.n; else if (r.outcome === "empty") e.empty += r.n; else e.failed += r.n; };
  const byEndpoint = {}, bySource = {}, byTier = {};
  const outcomes = { ok: 0, empty: 0, failed: 0, rateLimited: 0, blockedBudget: 0, avoidedDuplicates: 0, bundledSaved: 0 };
  for (const r of inWindow) {
    if (spend(r)) { add(byEndpoint, r.endpoint === "odds" && r.bet !== "-" ? `odds #${r.bet}` : r.endpoint, r); add(bySource, r.source, r); byTier[r.tier] = (byTier[r.tier] ?? 0) + r.credits; }
    if (r.outcome === "ok") outcomes.ok += r.n; else if (r.outcome === "empty") outcomes.empty += r.n; else if (r.outcome === "failed") outcomes.failed += r.n;
    else if (r.outcome === "rate_limited") outcomes.rateLimited += r.n; else if (r.outcome === "blocked_budget") outcomes.blockedBudget += r.n;
    else if (AVOIDED.includes(r.outcome)) outcomes.avoidedDuplicates += r.n; else if (r.outcome === "bundled") outcomes.bundledSaved += r.n;
  }
  const last24h = inWindow.filter(spend).reduce((a, r) => a + r.credits, 0);
  const sixH = inWindow.filter((r) => spend(r) && Date.parse(`${r.day}T${String(r.hour).padStart(2, "0")}:59:59Z`) > now - 6 * 3600e3).reduce((a, r) => a + r.credits, 0);
  const forecast = Math.round(sixH * 4);                 // prossime 24 ore = media oraria delle ultime 6 ore x 24
  return {
    credits: { used, limit: lim, remaining: usage?.remaining ?? Math.max(0, lim - used), pct: lim ? Math.round((used / lim) * 100) : null, last24h },
    byEndpoint, bySource, byTier, outcomes,
    queue: { open: tasks.length, retrying: tasks.filter((t) => (t.attempts ?? 0) > 0 && (t.attempts ?? 0) < 3).length, parked: tasks.filter((t) => (t.attempts ?? 0) >= 3).length },
    completeness, forecast: { next24h: forecast, withinLimit: forecast <= lim },
  };
}
