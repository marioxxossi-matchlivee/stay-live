// Menu dello sport (accordion in alto a destra). Solo HTML: il comportamento (apri/chiudi, scelta) sta in sport.js.
import { icon } from "./icons.js";

export const SPORTS = { football: { label: "Calcio", icon: "soccer-ball" }, tennis: { label: "Tennis", icon: "tennis-ball" } };

export function sportMenuHtml(current = "football") {
  const cur = SPORTS[current] ?? SPORTS.football;
  const items = Object.entries(SPORTS).map(([id, s]) => `<button type="button" role="menuitemradio" aria-checked="${id === current}" data-sport-pick="${id}">${icon(s.icon)}<span>${s.label}</span>${id === current ? icon("check", "sport-ck") : ""}</button>`).join("");
  return `<div class="sport-menu" data-sport-menu><button class="sport-pill" type="button" data-sport-toggle aria-haspopup="menu" aria-expanded="false" aria-label="Cambia sport: ora ${cur.label}">${icon(cur.icon)}<span>${cur.label}</span>${icon("caret-down")}</button><div class="sport-acc" role="menu" aria-label="Sport"><div class="sport-acc-in"><div class="sport-acc-list">${items}</div></div></div></div>`;
}
