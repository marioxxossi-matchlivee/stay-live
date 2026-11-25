// Dati SINTETICI SOLO PER I TEST (mai usati dall'app): generatore di record normalizzati con calibrazione nota.
import { rng, weekOf } from "../functions/api/_learning-core.js";
export const T0 = Date.parse("2026-10-01T00:00:00Z"), H = 36e5;
export function synth(n, { seed = 1, truth = 1.0, sport = "tennis", step = 2 * H, surfaces = ["clay", "hard"], truthBy = null, market = false, version = "v1", noise = 0, gsize = 1 } = {}) {
  const r = rng(seed), out = [];
  for (let i = 0; i < n; i++) {
    const surface = surfaces[i % surfaces.length], slope = truthBy?.[surface] ?? truth, p = 0.1 + 0.8 * r(), y = r() < Math.min(0.98, Math.max(0.02, 0.5 + (p - 0.5) * slope)) ? 1 : 0, t = T0 + i * step, g = `g${Math.floor(i / gsize)}`;
    const m = market ? Math.min(0.97, Math.max(0.03, 0.5 + (p - 0.5) * slope + (r() - 0.5) * noise)) : null;
    out.push({ id: `${sport}-${i}`, sport, t, p, y, group: g, block: `${sport === "tennis" ? "T" : "L"}${i % 25}|${weekOf(t)}`, version, prospective: true, segs: sport === "tennis" ? { surface, tour: i % 3 ? "atp" : "wta" } : { market: surface, league: `lg${i % 4}`, basis: "api+mercato", verdict: "EVITA" }, flags: sport === "tennis" ? { h2h: i % 2 === 0, ranking: false, serveStats: i % 7 === 0, history: false, format: false, form: false } : { noApi: false, noMarket: m == null, reconstructed: false }, missing: [], sources: { model: p, api: null, market: m, marketNormalized: m != null } });
  }
  return out;
}
