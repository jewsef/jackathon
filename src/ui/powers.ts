import { POWERS } from "../sim/powers";
import agesData from "../../data/ages.json";
import type { PowerId, StrainId } from "../sim/types";

const HOT = new Set(["storm", "quake", "plague", "eruption", "drought", "revolt", "risingseas", "solarflare"]);

/** The power palette. Selecting a power arms the map; the next click casts it. */
export class PowersBar {
  armed: PowerId | null = null;
  strain: StrainId = "cough";
  onArm: (p: PowerId | null) => void = () => {};
  private el: HTMLElement;
  constructor(el: HTMLElement) {
    this.el = el;
    el.innerHTML = POWERS.map((p) =>
      `<button type="button" class="pw${HOT.has(p.id) ? " hot" : ""}" data-p="${p.id}" aria-pressed="false" title="${p.name}: ${p.desc} (${p.cost} energy)">
        <svg aria-hidden="true"><use href="#g-${p.id}"/></svg><span class="nm">${p.name}</span><span class="cost">${p.cost ? p.cost + " ⚡" : "free"}</span></button>`
    ).join("") + `<div class="strains" role="group" aria-label="Plague strain" hidden>
        <button type="button" data-s="fever" aria-pressed="false" title="Mild. Few die.">Fever</button>
        <button type="button" data-s="cough" aria-pressed="true" title="Serious. Many die.">Red cough</button>
        <button type="button" data-s="grey" aria-pressed="false" title="Can wipe out a whole village.">Grey death</button></div>`;
    el.querySelectorAll<HTMLButtonElement>(".pw").forEach((b) => b.addEventListener("click", () => this.arm(this.armed === b.dataset.p ? null : (b.dataset.p as PowerId))));
    el.querySelectorAll<HTMLButtonElement>(".strains button").forEach((b) => b.addEventListener("click", () => {
      this.strain = b.dataset.s as StrainId;
      el.querySelectorAll(".strains button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    }));
  }
  arm(p: PowerId | null) {
    this.armed = p;
    this.el.querySelectorAll(".pw").forEach((b) => b.setAttribute("aria-pressed", String((b as HTMLElement).dataset.p === p)));
    (this.el.querySelector(".strains") as HTMLElement).hidden = p !== "plague";
    this.onArm(p);
  }
  /** Enable what can be afforded; late-game powers stay locked until someone reaches their age. */
  setEnergy(e: number, maxAge = 99) {
    this.el.querySelectorAll<HTMLButtonElement>(".pw").forEach((b) => {
      const p = POWERS.find((x) => x.id === b.dataset.p)!;
      const locked = !!p.minAge && maxAge < p.minAge;
      b.disabled = e < p.cost || locked;
      b.classList.toggle("locked", locked);
      b.title = locked ? `${p.name}: unlocks when a people reaches the ${agesData[p.minAge!]?.name ?? "next age"}.` : `${p.name}: ${p.desc} (${p.cost} energy)`;
    });
  }
}
