import { PAGE, Pdf, textWidth, wrap } from "./pdf.js";
import { TZ, dayKey, dayParts, eur, fmtTime, num, pct } from "./format.js";

const C = { ink: "#0e1a2b", mute: "#6b7686", line: "#dde2e8", bet: "#0f7b4b", skip: "#6b7686", blue: "#2f5bea", navy: "#1d3a8a" };

/** Accorcia il testo con "…" finché sta in max punti. */
function fit(str, size, bold, max) {
  let s = String(str);
  if (textWidth(s, size, bold) <= max) return s;
  while (s.length > 1 && textWidth(`${s}…`, size, bold) > max) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}

/** PDF del resoconto: totali, MULTIPLE consigliate, SINGOLE consigliate, partite DA EVITARE. */
export function buildPreviewPdf(pv, leagueName, plan = null) {
  const pdf = new Pdf();
  const M = 40, W = PAGE.w - M * 2, FOOT = 46;
  const items = [...pv.items].sort((a, b) => Date.parse(a.kickoffAt) - Date.parse(b.kickoffAt));
  const multiDay = new Set(items.map((i) => dayKey(i.kickoffAt))).size > 1;
  const when = (iso) => {
    const d = dayParts(dayKey(iso));
    return multiDay ? `${d.wd} ${d.dm} ${fmtTime.format(new Date(iso))}` : fmtTime.format(new Date(iso));
  };
  const isBetRow = (i) => Boolean(i.pick) && i.confidence !== "insufficiente" && i.pick.verdict === "BET";
  const bets = items.filter(isBetRow), rest = items.filter((i) => !isBetRow(i));
  let y = 0;

  const header = (first) => {
    pdf.addPage();
    pdf.rect(0, 0, PAGE.w, first ? 92 : 40, C.ink);
    pdf.text(M, first ? 40 : 26, "Stay Live", { size: first ? 24 : 15, bold: true, color: "#ffffff" });
    if (first) {
      pdf.text(M, 62, `Preview partite scelte · ${dayParts(dayKey(items[0].kickoffAt)).long}`, { size: 11, color: "#c9d6ee" });
      pdf.text(M, 78, `Generato il ${new Intl.DateTimeFormat("it-IT", { dateStyle: "short", timeStyle: "short", timeZone: TZ }).format(new Date(pv.generatedAt))} · storico ${pv.n} gare`, { size: 9, color: "#8fb0ff" });
    }
    y = first ? 112 : 58;
  };
  const ensure = (h) => { if (y + h > PAGE.h - FOOT) header(false); };
  const section = (title, sub, color) => {
    ensure(60);
    pdf.rect(M, y, 4, 18, color);
    pdf.text(M + 12, y + 14, title, { size: 13, bold: true, color });
    if (sub) pdf.text(PAGE.w - M, y + 14, sub, { size: 9, color: C.mute, align: "right" });
    y += 30;
  };
  const planSentence = (p, e, what) => {
    if (!e) return `Nessuna puntata consigliata${p.need ? `: servirebbe ${what} di almeno ${num(p.need)}` : ""}.`;
    if (p.play) return `Quota ${num(p.odds)} (${p.source}) · Punta ${eur(e.stake)} · Vincita netta ${eur(e.win)}`;
    return `Quota ${p.source} ${num(p.odds)} sotto la minima · Solo se ${what} è almeno ${num(p.need)}: punta ${eur(e.stake)}, vincita netta ${eur(e.win)}`;
  };

  header(true);
  pdf.text(M, y + 4, `${pv.summary.bets} BET su ${pv.summary.selected} partite`, { size: 16, bold: true });
  y += 18;

  if (plan) {
    const t = plan.totals, ts = plan.totalsSingles, tm = plan.totalsMultiples;
    const part = (label, x) => (x.count ? `${label}: ${x.count} ${x.count === 1 ? "giocata" : "giocate"}, puntata ${eur(x.stake)}, vincita netta se entrano tutte ${eur(x.win)}` : `${label}: nessuna puntata`);
    const text = t.count
      ? `${plan.hypothetical ? "Piano se trovi almeno le quote minime indicate" : "Piano"} · Budget ${eur(plan.bankroll)}. ${part("Multiple", tm)}. ${part("Singole", ts)}. Totale puntato ${eur(t.stake)} (${pct(t.stake / plan.bankroll, 1)} del budget) · Esito atteso prudente ${eur(t.ev)}.`
      : `Budget ${eur(plan.bankroll)} · Nessuna puntata consigliata con le quote attuali.`;
    const lines = wrap(text, 10, W - 24);
    const h = lines.length * 13 + 16;
    pdf.rect(M, y, W, h, "#e8eefc");
    pdf.lines(M + 12, y + 18, lines, { size: 10, color: C.navy });
    y += h + 14;
  }

  // ---- MULTIPLE ----
  if (plan) {
    section("Multiple consigliate", plan.multiples.length ? `${plan.multiples.length} proposte` : "", C.blue);
    if (!plan.multiples.length) {
      pdf.text(M, y, "Servono almeno 2 BET per comporre una multipla.", { size: 10, color: C.mute });
      y += 22;
    }
    for (const m of plan.multiples) {
      const sentence = wrap(planSentence(m.plan, m.eff, "la quota combinata"), 9, W - 28, true);
      const h = 24 + m.legs.length * 15 + 20 + sentence.length * 12 + 14;
      ensure(h + 10);
      pdf.rect(M, y, W, h, "#f3f6ff");
      pdf.strokeRect(M, y, W, h, "#c9d6ee");
      pdf.rect(M, y, 4, h, C.blue);
      pdf.text(M + 14, y + 18, m.label, { size: 12, bold: true, color: C.navy });
      pdf.text(M + W - 12, y + 18, `${m.items.length} gare`, { size: 9, bold: true, color: C.blue, align: "right" });
      let yy = y + 38;
      const teamX = M + (multiDay ? 96 : 54), pickRight = M + W - 96;
      for (const l of m.legs) {
        pdf.text(M + 14, yy, when(l.item.kickoffAt), { size: 8.5, color: C.mute });
        pdf.text(pickRight, yy, l.item.pick.label, { size: 9.5, bold: true, color: "#0b5c38", align: "right" });
        pdf.text(teamX, yy, fit(`${l.item.home} – ${l.item.away}`, 9.5, true, pickRight - textWidth(l.item.pick.label, 9.5, true) - teamX - 10), { size: 9.5, bold: true });
        pdf.text(M + W - 12, yy, `${num(l.odds)} ${l.source}`, { size: 8.5, color: C.mute, align: "right" });
        yy += 15;
      }
      pdf.text(M + 14, yy + 6, `Probabilità prudente ${pct(m.plan.pLow)}   ·   Quota minima ${num(m.minOdds)}`, { size: 9, color: C.ink });
      pdf.lines(M + 14, yy + 22, sentence, { size: 9, bold: true, color: m.eff ? C.navy : C.mute });
      y += h + 10;
    }
    y += 6;
  }

  // ---- SINGOLE ----
  section("Singole consigliate", `${bets.length}`, C.bet);
  if (!bets.length) { pdf.text(M, y, "Nessun BET tra le partite scelte.", { size: 10, color: C.mute }); y += 22; }
  for (const i of bets) {
    const p = i.pick, row = plan?.rows.get(i.id);
    const CARD = 84 + (row ? 18 : 0);
    ensure(CARD);
    pdf.rect(M, y, W, CARD - 8, "#ffffff");
    pdf.strokeRect(M, y, W, CARD - 8, C.line);
    pdf.rect(M, y, 4, CARD - 8, C.bet);
    pdf.text(M + 14, y + 17, `${when(i.kickoffAt)} · ${leagueName(i.league)}`, { size: 9, color: C.mute });
    pdf.text(M + 14, y + 34, fit(`${i.home} – ${i.away}`, 13, true, W - 90), { size: 13, bold: true });
    const bw = textWidth("BET", 9, true) + 16;
    pdf.rect(M + W - 12 - bw, y + 8, bw, 16, C.bet);
    pdf.text(M + W - 12 - bw / 2, y + 19.5, "BET", { size: 9, bold: true, color: "#ffffff", align: "center" });
    pdf.text(M + 14, y + 52, p.label, { size: 11, bold: true, color: "#0b5c38" });
    pdf.text(M + W - 12, y + 52, `prudente ${pct(p.pLow)}`, { size: 11, bold: true, align: "right", color: "#0b5c38" });
    const bits = [`Quota minima ${num(p.minOdds)}`, `Gol attesi ${num(i.lambda.total)}`, `Più probabile ${i.topScores[0]?.score ?? "—"}`];
    if (i.alternatives[0]) bits.push(`Alternativa: ${i.alternatives[0].label} ${pct(i.alternatives[0].pLow)}`);
    pdf.lines(M + 14, y + 66, wrap(bits.join("   ·   "), 8.5, W - 28).slice(0, 1), { size: 8.5, color: C.mute });
    if (row) pdf.text(M + 14, y + 80, fit(planSentence(row.plan, row.eff, "il bookmaker paga"), 9, true, W - 28), { size: 9, bold: true, color: row.eff ? C.navy : C.mute });
    y += CARD;
  }

  // ---- DA EVITARE ----
  if (rest.length) {
    y += 6;
    section("Da evitare", `${rest.length}`, C.skip);
    for (const i of rest) {
      ensure(24);
      const why = i.pick && i.confidence !== "insufficiente" ? `${i.pick.label} · prudente ${pct(i.pick.pLow)}` : `dati insufficienti (${i.sample} gare)`;
      pdf.text(M + 4, y + 10, `${when(i.kickoffAt)} · ${leagueName(i.league)}`, { size: 8.5, color: C.mute });
      pdf.text(M + 4, y + 22, fit(`${i.home} – ${i.away}`, 10, true, W * 0.62), { size: 10, bold: true, color: C.ink });
      pdf.text(M + W - 4, y + 22, why, { size: 9, color: C.mute, align: "right" });
      y += 30;
    }
  }

  y += 8;
  const note = wrap("Le quote minime sono quelle sotto cui non c’è margine secondo il modello. Controlla sempre la quota reale prima di giocare. Le quote stimate usano un margine medio del bookmaker del 6%. Nelle multiple il margine si moltiplica: le puntate consigliate sono più basse. Gioca solo ciò che puoi permetterti di perdere. Stime statistiche sperimentali basate solo sui gol: non sono garanzie né consigli finanziari.", 8.5, W);
  ensure(note.length * 12 + 10);
  pdf.lines(M, y + 8, note, { size: 8.5, color: C.mute });

  pdf.pages.forEach((_, idx) => {
    pdf.text(M, PAGE.h - 24, "stay-live · analisi pre-partita", { size: 8, color: C.mute, page: idx });
    pdf.text(PAGE.w - M, PAGE.h - 24, `Pagina ${idx + 1} di ${pdf.pages.length}`, { size: 8, color: C.mute, align: "right", page: idx });
  });
  return pdf.build({ title: `Stay Live · preview ${dayKey(items[0].kickoffAt)}` });
}
