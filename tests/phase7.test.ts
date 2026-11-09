import { describe, it, expect, beforeAll } from "vitest";
import { createWorld } from "../src/sim/world";
import { tick } from "../src/sim/tick";
import { applyPowers, powerUnlocked } from "../src/sim/powers";
import { pollution } from "../src/sim/climate";
import { culture, ageOf, resourceFactor } from "../src/sim/culture";
import { Rng } from "../src/sim/rng";
import { boatTier, weaponTier, popOf, TECH, addPeople } from "../src/sim/util";
import { houseKit, eraOf, PALETTE, CIVIC, type Style } from "../src/render3d/kits";
import type { World } from "../src/sim/types";

const run = (seed: number, ticks: number) => { let w = createWorld(seed); for (let i = 0; i < ticks; i++) w = tick(w, []); return w; };
const MODERN = ["stonetools", "bronze", "iron", "carrack", "steam", "electricity", "computers", "genetics"];

describe("phase 7: the modern ages", () => {
  it("oil lies under the Great Land and the Spice Isles; Kelp Isle's sand makes silicon", () => {
    const w = createWorld(1);
    expect(w.deposits.great.oil).toBeGreaterThan(1);
    expect(w.deposits.spice.oil).toBeGreaterThan(0.4);
    expect(w.deposits.kelp.silicon).toBeGreaterThan(Math.max(...(["hearth", "thorn", "far"] as const).map((i) => w.deposits[i].silicon)));
  });

  it("electricity, computers and genetics open the Electric, Information and Biotech ages, in order", () => {
    const t = createWorld(1).tribes[0];
    t.techs.push(...MODERN.slice(0, 6)); expect(ageOf(t)).toBe(6);
    t.techs.push("computers"); expect(ageOf(t)).toBe(7);
    t.techs.push("genetics"); expect(ageOf(t)).toBe(8);
    const u = createWorld(1).tribes[0]; u.techs.push("genetics");
    expect(ageOf(u)).toBe(0);
    expect(resourceFactor(createWorld(1), u, TECH.computers)).toBe(0); // strict: needs silicon
  });

  it("aircraft are tier 8 and missiles make the deadliest armies", () => {
    const t = createWorld(1).tribes[0];
    t.techs.push("flight"); expect(boatTier(t)).toBe(8);
    const b = weaponTier(t); t.techs.push("missiles"); expect(weaponTier(t)).toBe(b + 2);
  });

  it("carbon capture pulls carbon out of the air much faster than the sea alone", () => {
    const drop = (capture: boolean) => {
      const w = createWorld(1); w.co2 = 500;
      if (capture) for (const t of w.tribes.slice(0, 3)) t.techs.push("carboncapture");
      for (let i = 0; i < 40; i++) pollution(w, new Rng(i));
      return 500 - w.co2;
    };
    expect(drop(true)).toBeGreaterThan(drop(false) * 5);
  });
});

describe("phase 7: late-game powers", () => {
  it("late powers stay locked until a people reaches their age", () => {
    const w = createWorld(1);
    expect(powerUnlocked(w, "solarflare")).toBe(false);
    expect(powerUnlocked(w, "calm")).toBe(true);
    w.energy = 40;
    applyPowers(w, [{ tick: 0, power: "solarflare", x: 5, y: 5 }], new Rng(1));
    expect(w.energy).toBe(40);
    w.tribes[0].age = 6;
    expect(powerUnlocked(w, "solarflare")).toBe(true);
  });

  it("a spark of genius brings a tribe much closer to its next invention", () => {
    const w = createWorld(1), v = w.villages[0], t = w.tribes[v.tribe];
    t.techs.push("stonetools", "bronze", "iron"); t.age = 3; w.energy = 40;
    const before = { ...t.progress };
    applyPowers(w, [{ tick: 0, power: "genius", x: v.x, y: v.y }], new Rng(1));
    const gained = Object.keys(t.progress).some((k) => (t.progress[k] ?? 0) - (before[k] ?? 0) >= 0.35);
    expect(gained).toBe(true);
  });

  it("rising seas flood harbour towns", () => {
    const w = createWorld(1), v = w.villages.find((x) => x.coastal)!;
    addPeople(v, "m", 200, 30); addPeople(v, "f", 200, 30); v.houses = 60;
    w.tribes.forEach((t) => (t.age = 5)); w.energy = 40;
    const p0 = popOf(v);
    applyPowers(w, [{ tick: 0, power: "risingseas", x: v.x, y: v.y }], new Rng(3));
    expect(v.houses).toBeLessThan(60);
    expect(popOf(v)).toBeLessThan(p0);
  });

  it("a solar flare stalls research in the modern ages", () => {
    const gain = (flare: boolean) => {
      const w = createWorld(1), t = w.tribes[0], v = w.villages.find((x) => x.tribe === 0)!;
      t.techs.push(...MODERN.slice(0, 6), "telegraph"); t.age = 6;
      addPeople(v, "m", 100, 30); addPeople(v, "f", 100, 30);
      if (flare) w.effects.push({ id: 9999, power: "solarflare", x: v.x, y: v.y, r: 3, ticks: 4, age: 0 });
      const p0 = t.progress.radio ?? 0;
      culture(w, new Rng(1));
      return (t.progress.radio ?? 0) - p0;
    };
    expect(gain(true)).toBeLessThan(gain(false) * 0.5);
  });
});

describe("phase 7: a run to the end of history", () => {
  let w: World;
  beforeAll(() => { w = run(4127, 5600); }, 900000);
  it("tribes reach the Biotech age, and the story reaches a modern ending", () => {
    expect(Math.max(...w.tribes.map((t) => t.age))).toBe(8);
    const ids = w.endings.map((e) => e.id);
    expect(ids.some((id) => id === "space" || id === "green" || id === "hothouse")).toBe(true);
  });
});

describe("phase 7: modern buildings", () => {
  it("every island has Electric, Information and Biotech houses, for villages and for cities", () => {
    for (const s of ["hearth", "kelp", "thorn", "gull", "far"] as Style[]) for (const e of [7, 8, 9] as const) {
      expect(houseKit(s, e, 1).length).toBeGreaterThan(2);
      expect(houseKit(s, e, 3).length).toBeGreaterThan(houseKit(s, e, 1).length);
      expect(PALETTE[s][e]).toBeTruthy();
    }
    for (const c of ["powerplant", "nuclear", "turbine", "solarfield", "airport", "mast", "lab", "greenhouse", "launchpad"] as const) expect(CIVIC[c].length).toBeGreaterThan(0);
    expect([eraOf("city", 6, true), eraOf("city", 7, true), eraOf("city", 8, true)]).toEqual([7, 8, 9]);
  });
});
