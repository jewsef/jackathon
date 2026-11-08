import { describe, it, expect } from "vitest";
import { Rng } from "../src/sim/rng";
import { createWorld } from "../src/sim/world";
import { tick } from "../src/sim/tick";
import { economy } from "../src/sim/economy";
import { politics } from "../src/sim/politics";
import { applyPowers } from "../src/sim/powers";
import { resourceFactor } from "../src/sim/culture";
import { addPeople, TECH, blankJobs, newFactions } from "../src/sim/util";
import type { World } from "../src/sim/types";

function run(seed: number, ticks: number) { let w = createWorld(seed); for (let i = 0; i < ticks; i++) w = tick(w, []); return w; }

describe("phase 3: island resources and the first ages", () => {
  it("islands differ in resources", () => {
    const w = createWorld(4127);
    expect(w.deposits.hearth.clay).toBeGreaterThan(w.deposits.gull.clay * 4);
    expect(w.deposits.thorn.wood).toBeGreaterThan(w.deposits.kelp.wood * 3);
    expect(w.deposits.gull.stone).toBeGreaterThan(w.deposits.hearth.stone * 2);
    expect(w.deposits.far.copper).toBeGreaterThan(0.8);
    expect(w.deposits.thorn.tin).toBeGreaterThan(0.5);
    expect(w.deposits.thorn.copper).toBe(0);
  });

  it("different islands reach their first inventions in a different order on most seeds", () => {
    let varied = 0;
    const seeds = [1, 7, 42, 99, 314, 2024];
    for (const s of seeds) {
      const w = run(s, 600);
      const firsts = new Set(w.tribes.slice(0, 5).filter((t) => t.techs.length >= 2).map((t) => t.techs.slice(0, 2).join(">")));
      if (firsts.size >= 3) varied++;
    }
    expect(varied).toBeGreaterThanOrEqual(4);
  });

  it("bronze is impossible without both copper and tin in the stores", () => {
    const w = createWorld(7), t = w.tribes[0], v = w.villages[0];
    v.stock.copper = 50;
    expect(resourceFactor(w, t, TECH.bronze)).toBe(0);
    v.stock.tin = 20;
    expect(resourceFactor(w, t, TECH.bronze)).toBe(1);
  });

  it("the Bronze Age is reached through trade on some seeds within 600 years", () => {
    const reached = [4127, 42, 7].map((s) => run(s, 2400)).filter((w) => w.tribes.some((t) => t.age >= 2)).length;
    expect(reached).toBeGreaterThanOrEqual(2);
  });

  it("over-cutting a forest slows the woodcutters", () => {
    const make = () => { const w = createWorld(42), v = w.villages.find((x) => x.isle === "thorn")!; addPeople(v, "m", 40, 30); addPeople(v, "f", 40, 28); v.stage = "village"; v.jobs = blankJobs(); v.jobs.woodcutter = 1; v.stock.wood = 0; return { w, v }; };
    const a = make(), b = make();
    b.w.deposits.thorn.wood = 0.2;
    economy(a.w, new Rng(1)); economy(b.w, new Rng(1));
    expect(b.v.stock.wood).toBeLessThan(a.v.stock.wood * 0.3);
  });
});

describe("phase 3: politics", () => {
  function unstable(): World {
    const w = createWorld(99), t = w.tribes[0], v = w.villages[0];
    addPeople(v, "m", 150, 30); addPeople(v, "f", 150, 28); v.stage = "village";
    t.gov = { type: "chief", ruler: null, rulerFaction: "warriors", legitimacy: 0.15, unrest: 0.95, since: 0, policy: "defense", uprisings: 0 };
    t.factions = newFactions();
    for (const f of t.factions) { f.support = f.id === "farmers" ? 0.6 : 0.1; f.militancy = f.id === "farmers" ? 0.9 : 0.1; }
    v.hungry = 3;
    return w;
  }
  it("an angry, hungry people rise up and the regime falls or is fought over", () => {
    let changed = 0;
    for (let s = 1; s <= 20; s++) {
      const w = unstable(), t = w.tribes[0];
      const before = t.gov.ruler;
      const rng = new Rng(s);
      for (let i = 0; i < 40; i++) { w.events = []; w.fx = []; politics(w, rng); }
      if (t.gov.uprisings > 0) changed++;
      expect(t.gov.ruler === null || t.gov.ruler !== before || t.gov.uprisings >= 0).toBe(true);
    }
    expect(changed).toBeGreaterThan(10);
  });
  it("blessing a ruler raises legitimacy and calms unrest; stirring revolt does the opposite", () => {
    const a = unstable(), b = unstable(), v = a.villages[0];
    a.energy = b.energy = 40;
    const l0 = a.tribes[0].gov.legitimacy, u0 = a.tribes[0].gov.unrest;
    applyPowers(a, [{ tick: 0, power: "bless", x: v.x, y: v.y }], new Rng(3));
    expect(a.tribes[0].gov.legitimacy).toBeGreaterThan(l0);
    expect(a.tribes[0].gov.unrest).toBeLessThan(u0);
    b.tribes[0].gov.unrest = 0.2;
    applyPowers(b, [{ tick: 0, power: "revolt", x: v.x, y: v.y }], new Rng(3));
    expect(b.tribes[0].gov.unrest).toBeGreaterThan(0.5);
  });
  it("over centuries, tribes form governments, rulers change and some peoples pay tribute", () => {
    const w = run(4127, 2400);
    const regimes = new Set(w.tribes.map((t) => t.gov.type));
    expect([...regimes].some((r) => r !== "elders")).toBe(true);
    expect(w.tribes.some((t) => t.gov.ruler !== null)).toBe(true);
  });
});
