/**
 * Budget Manager centralizzato delle richieste ad API-Football.
 *
 * Sta nel punto in cui la richiesta parte davvero (`afFetch` in _apifootball.js): ogni chiamata, da qualunque cron, script o
 * funzione dell'app, deve prima ottenere un credito. Non sostituisce il contatore ufficiale `af_usage` (che resta com'è e continua a
 * rappresentare il consumo): lo affianca con un contatore di PRENOTAZIONE (`af_budget_state`) che si prende in modo atomico su Supabase,
 * così richieste parallele (due giri, app + script) non possono superare il tetto.
 *
 * - Tetto giornaliero: DAILY_LIMIT (7.500) meno un margine di sicurezza (SAFETY_MARGIN).
 * - Riserva per priorità: le partite imminenti possono usare tutto; oggi, domani, settimana e lavori di fondo lasciano crediti
 *   a chi ha priorità più alta (RESERVE).
 * - Distribuzione nelle 24 ore (UTC, come il reset dei crediti): settimana e lavori di fondo seguono una curva (PACE) e non possono
 *   consumare di mattina i crediti che servono alla sera.
 * - Se Supabase non risponde o la migrazione non è applicata, il manager NON blocca l'app: conta in locale e usa il residuo
 *   comunicato dal provider (fail-open con tetto), e lo dichiara nel registro.
 */
import { supabaseRpc } from "./_lib.js";
import { TIERS } from "./_policy.js";

export const DAILY_LIMIT = 7500;
export const SAFETY_MARGIN = 250;
export const RESERVE = { imminent: 0, today: 120, tomorrow: 400, week: 900, background: 2200 };   // crediti lasciati a chi ha priorità più alta
export const PACE = { week: [0.30, 0.90], background: [0.15, 0.60] };                            // quota del tetto usabile = base + pendenza x frazione di giornata

export class AfBudgetBlocked extends Error {
  constructor(message, reason = "budget") { super(message); this.budgetBlocked = true; this.reason = reason; }
}

const iso = (ms) => new Date(ms).toISOString();
export const budgetDay = (ms) => iso(ms).slice(0, 10);
const hourOf = (ms) => new Date(ms).getUTCHours();
const dayFraction = (ms) => { const d = new Date(ms); return (d.getUTCHours() + d.getUTCMinutes() / 60) / 24; };

/** Crediti totali usabili in un giorno (tetto meno margine di sicurezza). */
export const ceilingOf = ({ limit = DAILY_LIMIT, margin = SAFETY_MARGIN } = {}) => Math.max(0, limit - margin);

/**
 * Soglia di consumo cumulato (crediti già usati nel giorno) sotto la quale una richiesta di questa priorità può partire.
 * extraReserve = crediti ancora attesi per oggi/imminenti (calcolati dal giro): tolti alle priorità basse.
 */
export function capFor(tier, now, { limit = DAILY_LIMIT, margin = SAFETY_MARGIN, extraReserve = 0 } = {}) {
  const t = TIERS.includes(tier) ? tier : "today";
  const ceiling = ceilingOf({ limit, margin });
  let cap = ceiling - RESERVE[t] - (t === "tomorrow" || t === "week" || t === "background" ? Math.max(0, extraReserve) : 0);
  if (PACE[t]) { const [base, slope] = PACE[t]; cap = Math.min(cap, ceiling * Math.min(1, base + slope * dayFraction(now))); }
  return Math.max(0, Math.floor(cap));
}

/** Decisione pura (per test e dashboard): una richiesta di questa priorità, con questo consumo, può partire? */
export function allowance({ tier, used, cost = 1, now, limit, margin, extraReserve = 0 }) {
  const cap = capFor(tier, now, { limit, margin, extraReserve });
  const ceiling = ceilingOf({ limit, margin });
  if (used + cost > ceiling) return { ok: false, reason: "ceiling", cap };
  return used + cost <= cap ? { ok: true, cap } : { ok: false, reason: PACE[tier] && cap < ceiling - RESERVE[tier] ? "pace" : "reserve", cap };
}

/* ---------- Depositi (dove vive il contatore di prenotazione) ---------- */
/** Deposito in memoria: test e ambienti senza Supabase. `official` simula il contatore ufficiale. */
export function memoryStore({ official = 0 } = {}) {
  const s = { reserved: 0, official, ledger: [], calls: 0 };
  return {
    state: s,
    async reserve(day, n, cap) { s.calls += 1; const used = Math.max(s.reserved, s.official); const granted = Math.max(0, Math.min(n, cap - used)); s.reserved = used + granted; return { granted, used: s.reserved }; },
    async release(day, n) { s.reserved = Math.max(0, s.reserved - n); },
    async ledgerAdd(rows) { s.ledger.push(...rows); },
  };
}

/** Deposito su Supabase: funzioni af_budget_reserve / af_budget_release / af_ledger_add (migrazione 202611160001). */
export function supabaseStore(env) {
  return {
    async reserve(day, n, cap) {
      const r = await supabaseRpc(env, "af_budget_reserve", { p_day: day, p_credits: n, p_cap: cap });
      if (!r || !Number.isFinite(Number(r.granted))) throw new Error("risposta non valida da af_budget_reserve (migrazione 202611160001 applicata?)");   // funzione assente o risposta anomala: si passa al conteggio locale
      return { granted: Number(r.granted), used: Number(r.used ?? 0) };
    },
    async release(day, n) { await supabaseRpc(env, "af_budget_release", { p_day: day, p_credits: n }); },
    async ledgerAdd(rows) { await supabaseRpc(env, "af_ledger_add", { p_rows: rows }); },
  };
}

/* ---------- Manager ---------- */
/**
 * store: { reserve, release, ledgerAdd }; leaseSize: crediti prenotati per volta (script lunghi: 20; funzioni dell'app: 1).
 * Le prenotazioni sono per priorità: un credito prenotato da una richiesta urgente non viene speso da una a bassa priorità.
 */
export function createBudget({ store, now = () => Date.now(), limit = DAILY_LIMIT, margin = SAFETY_MARGIN, leaseSize = 1, extraReserve = 0, source = "app", flushAt = 150, onWarn = () => {} } = {}) {
  const st = { day: null, leases: {}, observedRemaining: null, localSpent: 0, failOpen: false, extraReserve };
  const ledger = new Map();
  let chain = Promise.resolve();
  const totals = { granted: 0, blocked: 0 };

  const note = (outcome, { src = source, endpoint = "?", bet = null, tier = "today", credits = 0, n = 1 } = {}) => {
    const t = now();
    const key = [budgetDay(t), hourOf(t), src, endpoint, bet ?? "-", tier, outcome].join("|");
    const e = ledger.get(key) ?? ledger.set(key, { day: budgetDay(t), hour: hourOf(t), source: src, endpoint, bet: bet ?? "-", tier, outcome, n: 0, credits: 0 }).get(key);
    e.n += n; e.credits += credits;
  };

  async function flushLedger() {
    if (!ledger.size) return;
    const rows = [...ledger.values()]; ledger.clear();
    try { await store.ledgerAdd(rows); } catch (e) { onWarn(`registro crediti non salvato: ${e?.message ?? e}`); }
  }

  async function doAcquire({ tier = "today", endpoint = "?", bet = null, src = source, cost = 1 }) {
    const t = now(), day = budgetDay(t);
    if (st.day !== day) { st.day = day; st.leases = {}; st.localSpent = 0; st.observedRemaining = null; }
    const tr = TIERS.includes(tier) ? tier : "today";
    const ceiling = ceilingOf({ limit, margin });
    if (st.observedRemaining != null && st.observedRemaining - cost < Math.max(0, limit - ceiling)) {
      note("blocked_budget", { src, endpoint, bet, tier: tr }); totals.blocked += 1;
      return { ok: false, reason: "provider_remaining" };
    }
    const have = st.leases[tr] ?? 0;
    if (have >= cost) { st.leases[tr] = have - cost; totals.granted += cost; return { ok: true }; }
    let granted = 0;
    try {
      const r = await store.reserve(day, Math.max(cost, leaseSize), capFor(tr, t, { limit, margin, extraReserve: st.extraReserve }));
      granted = r.granted; st.failOpen = false;
    } catch (e) {
      if (!st.failOpen) onWarn(`contatore di prenotazione non raggiungibile (${String(e?.message ?? e).slice(0, 120)}): conteggio locale`);
      st.failOpen = true;
      const room = Math.min(ceiling - RESERVE[tr] - st.localSpent, st.observedRemaining != null ? st.observedRemaining - (limit - ceiling) - RESERVE[tr] : Infinity);
      granted = room >= cost ? Math.min(Math.max(cost, leaseSize), room) : 0;
      st.localSpent += granted;
    }
    if (granted >= cost) { st.leases[tr] = (st.leases[tr] ?? 0) + granted - cost; totals.granted += cost; return { ok: true }; }
    st.leases[tr] = (st.leases[tr] ?? 0) + granted;
    note("blocked_budget", { src, endpoint, bet, tier: tr }); totals.blocked += 1;
    return { ok: false, reason: "budget" };
  }

  return {
    /** Chiede un credito. Le richieste in uno stesso processo sono messe in fila (nessun superamento del tetto per parallelismo). */
    acquire(req) { const p = chain.then(() => doAcquire(req)); chain = p.catch(() => {}); return p; },
    /** Esito di una richiesta partita: ok | empty | failed | rate_limited. */
    done(outcome, meta = {}) { note(outcome, { ...meta, credits: meta.credits ?? 1 }); if (ledger.size >= flushAt) void flushLedger(); },
    /** Evento senza costo: cache_hit | dedup_inflight | skipped_backoff | blocked_budget (richiesta evitata). */
    saved(outcome, meta = {}) { note(outcome, { ...meta, credits: 0, n: meta.n ?? 1 }); },
    observe(meta) { if (meta?.remaining != null) st.observedRemaining = meta.remaining; },
    setExtraReserve(n) { st.extraReserve = Math.max(0, Number(n) || 0); },
    async flush() {
      const left = Object.values(st.leases).reduce((a, b) => a + b, 0);
      st.leases = {};
      if (left > 0 && st.day) await store.release(st.day, left).catch((e) => onWarn(`rilascio crediti non riuscito: ${e?.message ?? e}`));
      await flushLedger();
    },
    stats: () => ({ ...totals, failOpen: st.failOpen, leases: { ...st.leases }, observedRemaining: st.observedRemaining }),
    _ledger: ledger,
  };
}

/* ---------- Un manager per ambiente ---------- */
const BY_ENV = new WeakMap();
export function budgetFor(env) {
  if (!env || typeof env !== "object") return null;
  if (env.AF_BUDGET === "off") return null;
  if (env.__budget) return env.__budget;
  let b = BY_ENV.get(env);
  if (!b) {
    const hasDb = Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
    b = createBudget({
      store: hasDb ? supabaseStore(env) : memoryStore(),
      limit: Number(env.API_FOOTBALL_DAILY_LIMIT) || DAILY_LIMIT,
      margin: Number(env.AF_BUDGET_MARGIN) || SAFETY_MARGIN,
      leaseSize: Math.max(1, Number(env.AF_LEASE) || 1),
      source: env.AF_SOURCE || "app",
      onWarn: (m) => console.warn("Stay Live budget:", m),
    });
    BY_ENV.set(env, b);
  }
  return b;
}
