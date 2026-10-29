import { PAGE, Pdf, textWidth, wrap } from "./pdf.js";
import { TZ, dayKey, dayParts, eur, fmtTime, num, pct } from "./format.js";

const C = { ink: "#0e1a2b", mute: "#6b7686", line: "#dde2e8", bet: "#0f7b4b", betTint: "#e1f3e9", skip: "#6b7686", skipTint: "#eceff3", blue: "#2f5bea" };

export function buildPreviewPdf(pv, leagueName, plan = null) {
  const pdf = new Pdf();
  const M = 40, W = PAGE.w - M * 2, FOOT = 46, BASE_CARD = 84;
  const items = [...pv.items].sort((a, b) => Date.parse(a.kickoffAt) - Date.parse(b.kickoffAt));
  const acc = pv.summary.accumulator;
  const byId = new Map(items.map((i) => [i.id, i]));
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

  header(true);
  // Riepilogo
  pdf.text(M, y + 4, `${pv.summary.bets} BET su ${pv.summary.selected} partite`, { size: 16, bold: true });
  y += 18;
  const accText = acc
    ? `Multipla più solida (${acc.ids.length} gare): ${acc.ids.map((id) => `${byId.get(id)?.home} – ${byId.get(id)?.away}`).join(" + ")}. Probabilità prudente ${pct(acc.pLow)}, quota minima ${num(acc.minOdds)}.`
    : "Servono almeno 2 BET per proporre una multipla.";
  const accLines = wrap(accText, 10, W - 24);
  const accH = accLines.length * 13 + 16;
  pdf.rect(M, y, W, accH, C.betTint);
  pdf.lines(M + 12, y + 18, accLines, { size: 10, color: "#0b5c38" });
  y += accH + 10;
  if (plan) {
    const t = plan.totals, a = plan.acc;
    const planText = t.count
      ? `${plan.hypothetical ? "Piano se trovi almeno le quote minime indicate" : "Piano"} · Budget ${eur(plan.bankroll)} · ${t.count} giocate · Puntata totale ${eur(t.stake)} (${pct(t.stake / plan.bankroll, 1)} del budget) · Vincita netta se entrano tutte ${eur(t.win)} · Esito atteso prudente ${eur(t.ev)}.`
        + (a?.eff ? ` Multipla: ${a.plan.play ? `quota ${num(a.plan.odds)} (${a.plan.source})` : `solo se la quota è almeno ${num(a.plan.need)}`}, punta ${eur(a.eff.stake)}, vincita netta ${eur(a.eff.win)}.` : "")
      : `Budget ${eur(plan.bankroll)} · Nessuna puntata consigliata con le quote attuali.`;
    const planLines = wrap(planText, 10, W - 24);
    const planH = planLines.length * 13 + 16;
    pdf.rect(M, y, W, planH, "#e8eefc");
    pdf.lines(M + 12, y + 18, planLines, { size: 10, color: "#1d3a8a" });
    y += planH + 4;
  }
  y += 10;

  let lastDay = null;
  for (const i of items) {
    const dk = dayKey(i.kickoffAt);
    const needDay = dk !== lastDay;
    const row = plan?.rows.get(i.id);
    const CARD = BASE_CARD + (row ? 18 : 0);
    if (y + CARD + (needDay ? 24 : 0) > PAGE.h - FOOT) header(false);
    if (needDay) {
      pdf.text(M, y + 12, dayParts(dk).long.replace(/^./, (c) => c.toUpperCase()), { size: 11, bold: true, color: C.blue });
      y += 22; lastDay = dk;
    }
    const p = i.pick;
    const enough = p && i.confidence !== "insufficiente";
    const isBet = enough && p.verdict === "BET";
    pdf.rect(M, y, W, CARD - 8, "#ffffff");
    pdf.strokeRect(M, y, W, CARD - 8, C.line);
    pdf.rect(M, y, 4, CARD - 8, isBet ? C.bet : "#b9c2cf");
    pdf.text(M + 14, y + 17, `${fmtTime.format(new Date(i.kickoffAt))} · ${leagueName(i.league)}`, { size: 9, color: C.mute });
    pdf.text(M + 14, y + 34, `${i.home} – ${i.away}`, { size: 13, bold: true });
    // Badge verdetto
    const badge = enough ? p.verdict : "EVITA";
    const bw = textWidth(badge, 9, true) + 16;
    pdf.rect(M + W - 12 - bw, y + 8, bw, 16, isBet ? C.bet : C.skip);
    pdf.text(M + W - 12 - bw / 2, y + 19.5, badge, { size: 9, bold: true, color: "#ffffff", align: "center" });
    if (enough) {
      pdf.text(M + 14, y + 52, `${p.label}`, { size: 11, bold: true, color: isBet ? "#0b5c38" : C.ink });
      pdf.text(M + W - 12, y + 52, `prudente ${pct(p.pLow)}`, { size: 11, bold: true, align: "right", color: isBet ? "#0b5c38" : C.ink });
      const bits = [`Quota minima ${num(p.minOdds)}`, `Gol attesi ${num(i.lambda.total)}`, `Più probabile ${i.topScores[0]?.score ?? "—"}`];
      if (i.alternatives[0]) bits.push(`Alternativa: ${i.alternatives[0].label} ${pct(i.alternatives[0].pLow)}`);
      const more = wrap(bits.join("   ·   "), 8.5, W - 28);
      pdf.lines(M + 14, y + 66, more.slice(0, 1), { size: 8.5, color: C.mute });
    } else {
      pdf.text(M + 14, y + 52, `Dati insufficienti: ${i.sample} gare di storico`, { size: 10, color: C.mute });
    }
    if (row) {
      const { plan: pl, eff: e } = row;
      const line = !e ? "Nessuna puntata consigliata a queste quote."
        : pl.play ? `Quota ${num(pl.odds)} (${pl.source}) · Punta ${eur(e.stake)} · Vincita netta ${eur(e.win)}`
          : `Quota ${pl.source} ${num(pl.odds)} sotto la minima · Solo se il bookmaker paga almeno ${num(pl.need)}: punta ${eur(e.stake)}, vincita netta ${eur(e.win)}`;
      pdf.text(M + 14, y + 80, line, { size: 9, bold: true, color: e ? "#1d3a8a" : C.mute });
    }
    y += CARD;
  }

  y += 4;
  const note = wrap("Le quote minime sono quelle sotto cui non c’è margine secondo il modello. Controlla sempre la quota reale prima di giocare. Le quote stimate usano un margine medio del bookmaker del 6%. Gioca solo ciò che puoi permetterti di perdere. Stime statistiche sperimentali basate solo sui gol: non sono garanzie né consigli finanziari.", 8.5, W);
  if (y + note.length * 12 > PAGE.h - FOOT) header(false);
  pdf.lines(M, y + 8, note, { size: 8.5, color: C.mute });

  // Piè di pagina con numerazione
  pdf.pages.forEach((_, idx) => {
    pdf.text(M, PAGE.h - 24, "stay-live · analisi pre-partita", { size: 8, color: C.mute, page: idx });
    pdf.text(PAGE.w - M, PAGE.h - 24, `Pagina ${idx + 1} di ${pdf.pages.length}`, { size: 8, color: C.mute, align: "right", page: idx });
  });
  return pdf.build({ title: `Stay Live · preview ${dayKey(items[0].kickoffAt)}` });
}

