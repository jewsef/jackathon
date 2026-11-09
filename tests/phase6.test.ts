import { describe, it, expect, beforeAll } from "vitest";
import { createWorld } from "../src/sim/world";
import { tick } from "../src/sim/tick";
import { economy } from "../src/sim/economy";
import { pollution } from "../src/sim/climate";
import { plague } from "../src/sim/plague";
import { Rng } from "../src/sim/rng";
import { boatTier, weaponTier, addPeople, popOf, TECH } from "../src/sim/util";
import { ageOf, resourceFactor } from "../src/sim/culture";
import { houseKit, eraOf, PALETTE, CIVIC, type Style } from "../src/render3d/kits";
import type { World } from "../src/sim/types";

const run = (seed: number, ticks: number) => { let w = createWorld(seed); for (let i = 0; i < ticks; i++) w = tick(w, []); return w; };

/** A home village set up as a working mill town. */
function millTown(seed = 5) {
  const w = createWorld(seed), t = w.tribes[0], v = w.villages.find((x) => x.tribe === 0)!;
  t.techs.push("stonetools", "bronze", "iron", "printing", "gunpowder", "carrack", "steam", "steel", "factory", "coinage");
  addPeople(v, "m", 150, 30); addPeople(v, "f", 150, 28);
  v.stage = "city"; v.jobs = { ...v.jobs, gatherer: 0, worker: 0.3, miner: 0.1, smith: 0.1, farmer: 0.5 };
  v.stock.coal = 60; v.stock.iron = 60; v.food = 500;
  return { w, t, v };
}

describe("phase 6: the Industrial age", () => {
  it("coal lies under the Iron Coast, the Far Shore and the Great Land, not under the farm islands", () => {
    const w = createWorld(1);
    expect(w.deposits.iron.coal).toBeGreaterThan(1);
    expect(w.deposits.far.coal).toBeGreaterThan(0.3);
    expect(w.deposits.great.coal).toBeGreaterThan(0.5);
    expect(w.deposits.hearth.coal).toBe(0);
    expect(w.deposits.kelp.coal).toBe(0);
  });

  it("the steam engine needs coal and iron, and the ages come strictly in order", () => {
    const w = createWorld(1), t = w.tribes[0];
    expect(resourceFactor(w, t, TECH.steam)).toBe(0);
    t.techs.push("stonetools", "bronze", "iron", "steam");
    expect(ageOf(t)).toBe(3); // steam without ocean ships: still Classical
    t.techs.push("carrack");
    expect(ageOf(t)).toBe(5);
  });

  it("steamships are boat tier 7 and rifles make better armies", () => {
    const t = createWorld(1).tribes[0];
    t.techs.push("carrack", "steamship");
    expect(boatTier(t)).toBe(7);
    const before = weaponTier(t); t.techs.push("rifles");
    expect(weaponTier(t)).toBe(before + 1.5);
  });

  it("factories make steel and goods, burn coal, and foul the air", () => {
    const { w, v } = millTown();
    const co2 = w.co2;
    for (let i = 0; i < 8; i++) economy(w, new Rng(i));
    expect(v.stock.steel).toBeGreaterThan(1);
    expect(v.smog).toBeGreaterThan(0.05);
    expect(w.co2).toBeGreaterThan(co2);
  });

  it("rain and wind clear the smog faster than still air", () => {
    const clearAfter = (power: "rain" | "wind" | null) => {
      const { w, v } = millTown();
      v.smog = 0.6;
      if (power) w.effects.push({ id: 999, power, x: v.x, y: v.y, r: 1, ticks: 9, age: 0 });
      for (let i = 0; i < 3; i++) pollution(w, new Rng(i));
      return v.smog;
    };
    const still = clearAfter(null);
    expect(clearAfter("rain")).toBeLessThan(still * 0.6);
    expect(clearAfter("wind")).toBeLessThan(still * 0.6);
  });

  it("carbon warms the world, and the sea and forests slowly take it back", () => {
    const w = createWorld(1);
    w.co2 = 560; pollution(w, new Rng(1));
    expect(w.warming).toBeGreaterThan(2.9);
    expect(w.co2).toBeLessThan(560);
    expect(w.chronicle.length + w.events.length).toBeGreaterThan(0);
  });

  it("vaccines cut deaths from plague", () => {
    const deaths = (vacc: boolean) => {
      let total = 0;
      for (let k = 0; k < 6; k++) {
        const { w, t, v } = millTown(10 + k);
        if (vacc) t.techs.push("printing", "herbs", "vaccines");
        v.sick = { strain: "grey", t: 0, startPop: popOf(v), from: null };
        const p0 = popOf(v); plague(w, new Rng(k)); total += p0 - popOf(v);
      }
      return total;
    };
    expect(deaths(true)).toBeLessThan(deaths(false) * 0.6);
  });
});

describe("phase 6: a run into the Industrial age", () => {
  let w: World;
  beforeAll(() => { w = run(4127, 4400); }, 400000);

  it("tribes industrialise, and the air and climate change", () => {
    expect(Math.max(...w.tribes.map((t) => t.age))).toBe(5);
    const all = new Set(w.tribes.flatMap((t) => t.techs));
    for (const x of ["steam", "steel", "factory", "railway"]) expect(all).toContain(x);
    expect(w.co2).toBeGreaterThan(300);
    expect(w.warming).toBeGreaterThan(0.3);
    expect(w.villages.some((v) => !v.lost && v.jobs.worker > 0.02)).toBe(true);
  });
});

describe("phase 6: Industrial buildings", () => {
  it("every island has Industrial houses, and mills, pit heads, gasworks and stations exist", () => {
    for (const s of ["hearth", "kelp", "thorn", "gull", "far"] as Style[]) {
      const parts = houseKit(s, 6, 2);
      expect(parts.length).toBeGreaterThan(6);
      expect(PALETTE[s][6]).toBeTruthy();
    }
    for (const c of ["factory", "headframe", "gasholder", "station"] as const) expect(CIVIC[c].length).toBeGreaterThan(3);
    expect(eraOf("town", 5, false)).toBe(6);
  });
});
