// Edge function: avvisa quando cambia il pronostico di una partita che hai salvato nelle Giocate.
// Si chiama da GitHub Actions (notifiche-pronostici.yml) ogni 15 minuti con l'intestazione x-notify-secret.
// Deploy: supabase functions deploy pick-change-notify --no-verify-jwt
// Segreti: NOTIFY_SECRET, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (es. mailto:tu@esempio.it). SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY sono già presenti.
import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

const LABEL: Record<string, string> = { home: "1", draw: "X", away: "2", dc1x: "1X", dcx2: "X2", dc12: "12" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

type Pick = { id: string; device_id: string; sport: "football" | "tennis"; ref: string; selection: string; label: string | null; home: string | null; away: string | null; kickoff_at: string | null; baseline_set: boolean; baseline_selection: string | null; push_devices: { id: string; endpoint: string; p256dh: string; auth: string; failures: number; night_enabled: boolean } | null };

// Ore notturne (23:00–07:00, ora italiana): senza «notifiche notturne» il cambio resta in attesa e si avvisa al mattino.
const romeHour = () => Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Rome", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
const isNight = (h: number) => h >= 23 || h < 7;

Deno.serve(async (req) => {
  const secret = Deno.env.get("NOTIFY_SECRET");
  if (!secret || req.headers.get("x-notify-secret") !== secret) return json({ error: "non autorizzato" }, 401);
  const pub = Deno.env.get("VAPID_PUBLIC_KEY"), priv = Deno.env.get("VAPID_PRIVATE_KEY"), subject = Deno.env.get("VAPID_SUBJECT");
  if (!pub || !priv || !subject) return json({ error: "chiavi VAPID mancanti" }, 503);
  webpush.setVapidDetails(subject, pub, priv);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

  // Giocate attive di partite non ancora iniziate.
  const { data: picks, error } = await sb.from("saved_picks").select("*, push_devices(id,endpoint,p256dh,auth,failures,night_enabled)").eq("active", true).gt("kickoff_at", new Date().toISOString()).limit(2000);
  if (error) return json({ error: error.message }, 500);
  const list = (picks ?? []) as Pick[];
  if (!list.length) return json({ checked: 0, notified: 0 });

  // Pronostico attuale: calcio = bet_predictions (esito scelto per partita), tennis = tennis_predictions (pick pubblicato).
  const fRefs = [...new Set(list.filter((p) => p.sport === "football").map((p) => p.ref))];
  const tRefs = [...new Set(list.filter((p) => p.sport === "tennis").map((p) => p.ref))];
  const current = new Map<string, string | null>();
  if (fRefs.length) { const { data } = await sb.from("bet_predictions").select("game_id,sel_key").in("game_id", fRefs); for (const r of data ?? []) current.set(`football:${r.game_id}`, r.sel_key); }
  if (tRefs.length) { const { data } = await sb.from("tennis_predictions").select("match_key,pick,published").in("match_key", tRefs); for (const r of data ?? []) current.set(`tennis:${r.match_key}`, r.published && r.pick ? String(r.pick) : null); }

  const night = isNight(romeHour());
  let notified = 0, baselines = 0, failed = 0, gone = 0, held = 0;
  for (const p of list) {
    const key = `${p.sport}:${p.ref}`;
    if (!current.has(key)) continue;                       // nessun dato: non si deduce nulla
    const now = current.get(key) ?? null;
    if (!p.baseline_set) { await sb.from("saved_picks").update({ baseline_set: true, baseline_selection: now }).eq("id", p.id); baselines++; continue; }
    if (now === p.baseline_selection) continue;             // invariato
    if (night && !p.push_devices?.night_enabled) { held++; continue; }   // di notte non si disturba: la base resta, si avvisa dopo le 07:00
    const name = (sel: string | null) => (sel == null ? "nessun pronostico" : p.sport === "football" ? (LABEL[sel] ?? sel) : sel === "1" ? (p.home ?? "giocatore 1") : (p.away ?? "giocatore 2"));
    const body = p.sport === "football"
      ? `${p.home} – ${p.away}: il pronostico passa da ${name(p.baseline_selection)} a ${name(now)}${p.selection !== now ? ` (tu hai salvato ${LABEL[p.selection] ?? p.selection})` : ""}.`
      : `${p.home} – ${p.away}: ${now == null ? "il pronostico è stato ritirato" : `ora si pronostica ${name(now)} (prima ${name(p.baseline_selection)})`}${now != null && String(p.selection) !== now ? `, tu hai salvato ${name(p.selection)}` : ""}.`;
    const payload = JSON.stringify({ title: "Pronostico cambiato", body, tag: key, url: "/" });
    let delivery: "sent" | "failed" | "gone" = "sent";
    const d = p.push_devices;
    if (!d) delivery = "gone";
    else {
      try { await webpush.sendNotification({ endpoint: d.endpoint, keys: { p256dh: d.p256dh, auth: d.auth } }, payload, { TTL: 3600 }); await sb.from("push_devices").update({ failures: 0, last_ok_at: new Date().toISOString() }).eq("id", d.id); }
      catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) { delivery = "gone"; await sb.from("push_devices").delete().eq("id", d.id); }
        else { delivery = "failed"; const f = (d.failures ?? 0) + 1; if (f >= 10) await sb.from("push_devices").delete().eq("id", d.id); else await sb.from("push_devices").update({ failures: f }).eq("id", d.id); }
      }
    }
    if (delivery === "sent") { notified++; await sb.from("saved_picks").update({ baseline_selection: now, last_notified_at: new Date().toISOString() }).eq("id", p.id); }
    else if (delivery === "failed") failed++; else gone++;
    await sb.from("pick_change_log").insert({ saved_pick_id: delivery === "gone" ? null : p.id, sport: p.sport, ref: p.ref, from_selection: p.baseline_selection, to_selection: now, message: body, delivery });
  }
  return json({ checked: list.length, baselines, notified, held, failed, gone });
});
