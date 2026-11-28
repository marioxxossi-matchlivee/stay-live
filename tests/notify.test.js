import test from "node:test";
import assert from "node:assert/strict";
import { collectPicks } from "../src/notify.js";
import { onRequest } from "../functions/api/push.js";

const NOW = Date.parse("2026-11-27T12:00:00Z"), ko = (h) => new Date(NOW + h * 3600e3).toISOString();

test("collectPicks: solo partite non ancora giocate, una riga per partita, calcio e tennis", () => {
  const football = [{ legs: [{ matchId: "g1", key: "dc1x", label: "1X", home: "A", away: "B", kickoffAt: ko(5) }, { matchId: "g2", key: "home", label: "1", home: "C", away: "D", kickoffAt: ko(-8), res: [1, 0] }, { matchId: "g1", key: "home", label: "1", home: "A", away: "B", kickoffAt: ko(5) }] }];
  const tennis = [{ matchKey: "t1", pick: 2, p1: { name: "X" }, p2: { name: "Y" }, startsAt: ko(2) }, { matchKey: "t2", pick: 1, p1: { name: "Z" }, p2: { name: "W" }, startsAt: ko(1), res: { score: "6-4" } }];
  const out = collectPicks(NOW, { football, tennis });
  assert.deepEqual(out.map((p) => [p.sport, p.ref, p.selection]), [["football", "g1", "dc1x"], ["tennis", "t1", "2"]]);
});

test("/api/push: GET dà la chiave pubblica; POST valida, scarta le giocate non valide e chiama sync_saved_picks", async () => {
  const env = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "k", VAPID_PUBLIC_KEY: "PUB" };
  assert.equal((await (await onRequest({ request: new Request("https://a/api/push"), env })).json()).publicKey, "PUB");
  const calls = [], real = globalThis.fetch, base = Date.now(), k2 = (h) => new Date(base + h * 3600e3).toISOString();
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), body: JSON.parse(init.body) }); return new Response(JSON.stringify({ device: "d1", picks: 2, removed: 0 }), { status: 200 }); };
  try {
    const sub = { endpoint: "https://push.example/abc", keys: { p256dh: "p", auth: "a" } };
    const plays = [{ sport: "football", ref: "g1", selection: "dc1x", label: "1X", home: "A", away: "B", kickoff: k2(4) }, { sport: "tennis", ref: "t1", selection: "2", kickoff: k2(3) },
      { sport: "football", ref: "g9", selection: "over25", kickoff: k2(4) }, { sport: "tennis", ref: "t2", selection: "1", kickoff: k2(-10) }, { sport: "football", ref: "g1", selection: "home", kickoff: k2(4) }];
    const res = await onRequest({ request: new Request("https://a/api/push", { method: "POST", body: JSON.stringify({ subscription: sub, plays }) }), env });
    assert.equal(res.status, 200);
    assert.match(calls[0].url, /rpc\/sync_saved_picks$/);
    assert.equal(calls[0].body.p_night, false, "notifiche notturne spente di default");
    assert.deepEqual(calls[0].body.p_picks.map((p) => `${p.sport}:${p.ref}:${p.selection}`), ["football:g1:dc1x", "tennis:t1:2"]);
    const bad = await onRequest({ request: new Request("https://a/api/push", { method: "POST", body: JSON.stringify({ subscription: { endpoint: "http://x" }, plays: [] }) }), env });
    assert.equal(bad.status, 400);
  } finally { globalThis.fetch = real; }
});
