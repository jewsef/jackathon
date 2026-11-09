import { describe, it, expect } from "vitest";
import { Rng } from "../src/sim/rng";
import { createWorld, newVillage } from "../src/sim/world";
import { tick, replay } from "../src/sim/tick";
import { plague } from "../src/sim/plague";
import { ecology } from "../src/sim/ecology";
import { popOf, living, adults, addPeople, tribePop } from "../src/sim/util";
import { getTerrain } from "../src/sim/terrain";
import { layoutFor, sampleCrowd } from "../src/render/crowd";
import type { Action, World } from "../src/sim/types";
import { JOBS } from "../src/sim/types";

function run(seed: number, ticks: number, acts: Action[] = []) {
  let w = createWorld(seed);
  for (let i = 0; i < ticks; i++) w = tick(w, acts.filter((a) => a.tick === w.tick));
  return w;
}

describe("milestone 0: the empty clock", () => {
  it("the RNG is deterministic", () => {
    const a = new Rng(5), b = new Rng(5);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });
  it("two runs from the same seed and actions are identical after 1,000 ticks", () => {
    const acts: Action[] = [{ tick: 10, power: "rain", x: 4.8, y: 4.7 }, { tick: 300, power: "storm", x: 8, y: 7 }, { tick: 500, power: "plague", x: 4.8, y: 4.7, strain: "cough" }];
    const a = run(4127, 1000, acts), b = run(4127, 1000, acts);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
  it("replay() rebuilds a run from its seed and action log", () => {
    const acts: Action[] = [{ tick: 40, power: "wind", x: 7, y: 4 }];
    const live = run(99, 600, acts), rep = replay(createWorld, 99, acts, 600);
    expect(JSON.stringify(rep)).toBe(JSON.stringify(live));
  });
});

describe("milestone 3: founding pairs and the hybrid civilization", () => {
  it("every inhabited island starts with exactly one man and one woman", () => {
    const w = createWorld(7);
    expect(w.villages).toHaveLength(7); // five home islands and two peoples beyond the horizon
    for (const v of w.villages) { expect(v.men).toBe(1); expect(v.women).toBe(1); expect(popOf(v)).toBe(2); }
    expect(new Set(w.villages.map((v) => v.isle)).size).toBe(7);
    expect(w.agents.filter((a) => a.founder)).toHaveLength(14);
  });
  it("tribes grow from their founders", () => {
    const w = run(4127, 600);
    expect(living(w).reduce((s, v) => s + popOf(v), 0)).toBeGreaterThan(200);
  });
  it("the people you see match the village's job shares", () => {
    const w = run(4127, 600), t = getTerrain(4127);
    const vs = living(w).filter((v) => popOf(v) > 60);
    expect(vs.length).toBeGreaterThan(0);
    for (const v of vs) {
      const crowd = sampleCrowd(v, layoutFor(t, v));
      const adultFigs = crowd.filter((f) => f.job !== "child" && f.job !== "elder");
      for (const j of JOBS) {
        const seen = adultFigs.filter((f) => f.job === j).length, expected = v.jobs[j] * adultFigs.length;
        expect(Math.abs(seen - expected)).toBeLessThanOrEqual(1);
      }
      expect(Math.abs(adultFigs.length / crowd.length - adults(v) / popOf(v))).toBeLessThan(0.15);
    }
  });
});

describe("milestone 2: weather you can hold", () => {
  it("rain on dry land raises the harvest within one season", () => {
    const base = createWorld(42), v = base.villages[0];
    base.effects.push({ id: 900, power: "drought", x: v.x, y: v.y, r: 2, ticks: 4, age: 0 });
    const dry = ecology(JSON.parse(JSON.stringify(base)) as World).villages[0].mods.farm;
    const wet = JSON.parse(JSON.stringify(base)) as World;
    wet.effects.push({ id: 901, power: "rain", x: v.x, y: v.y, r: 2, ticks: 4, age: 0 });
    expect(ecology(wet).villages[0].mods.farm).toBeGreaterThan(dry * 1.5);
  });
});

describe("milestone 4: boats, routes and the Far Shore", () => {
  it("with no player input the Far Shore is reached on some seeds and not on others", () => {
    const outcomes = [11, 23, 37, 51, 64, 77, 88, 95, 102, 131].map((s) => run(s, 1200).endings.some((e) => e.id === "farshore"));
    expect(outcomes.some((x) => x)).toBe(true);
    expect(outcomes.some((x) => !x)).toBe(true);
  });
});

describe("milestone 5: disasters and plague", () => {
  it("an isolated settlement survives a plague that wipes out a well-connected one", () => {
    const w = createWorld(4127), t = getTerrain(4127);
    const hearth = w.villages.find((v) => v.isle === "hearth")!, gull = w.villages.find((v) => v.isle === "gull")!;
    addPeople(hearth, "m", 150, 30); addPeople(hearth, "f", 150, 28);
    addPeople(gull, "m", 40, 30); addPeople(gull, "f", 40, 28);
    const site = t.sites("hearth").find((s) => Math.hypot(s.x - hearth.x, s.y - hearth.y) > 0.6 && Math.hypot(s.x - hearth.x, s.y - hearth.y) < 1.2)!;
    const near = newVillage(w, w.tribes[0], site, "Nearby");
    addPeople(near, "m", 100, 30); addPeople(near, "f", 100, 28);
    hearth.sick = { strain: "grey", t: 0, startPop: popOf(hearth), from: null };
    w.routes.push({ id: 999, a: hearth.id, b: near.id, kind: "trade", strength: 1, tier: 0 });
    const gullPop = popOf(gull), rng = new Rng(1);
    let nearSick = false;
    for (let i = 0; i < 12; i++) { w.events = []; w.fx = []; w.contacts = []; plague(w, rng); nearSick ||= near.sick !== null; }
    expect(hearth.lost).toBe(true);
    expect(nearSick).toBe(true);
    expect(gull.sick).toBeNull();
    expect(popOf(gull)).toBe(gullPop);
  });
});

describe("milestone 6: a culture shaped by you", () => {
  it("a gentle sky and a cruel sky produce different beliefs from the same seed", () => {
    const shape = (gentle: boolean) => {
      let w = createWorld(314);
      const h = w.tribes[0], home = w.villages[0];
      for (let i = 0; i < 400; i++) {
        const acts: Action[] = i % 8 === 0 ? [{ tick: w.tick, power: gentle ? (i % 16 ? "rain" : "calm") : (i % 16 ? "drought" : "storm"), x: home.x, y: home.y }] : [];
        w.energy = 40;
        w = tick(w, acts);
      }
      return w.tribes[h.id].belief;
    };
    const kind = shape(true), cruel = shape(false);
    expect(kind.love).toBeGreaterThan(cruel.love);
    expect(cruel.fear).toBeGreaterThan(kind.fear);
  });
});

describe("golden run", () => {
  it("a 500-year run without input keeps a living civilization on seed 4127", () => {
    const w = run(4127, 2000);
    expect(w.tribes.some((t) => t.alive && tribePop(w, t.id) > 100)).toBe(true);
    expect(w.chronicle.length).toBeGreaterThan(100);
  });
});
