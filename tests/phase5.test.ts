import { describe, it, expect, beforeAll } from "vitest";
import { createWorld } from "../src/sim/world";
import { tick } from "../src/sim/tick";
import { getTerrain, ISLE_IDS, OUTER, isOuter, inHome } from "../src/sim/terrain";
import { boatTier, weaponTier, tribePop } from "../src/sim/util";
import { resourceFactor, ageOf } from "../src/sim/culture";
import { TECH } from "../src/sim/util";
import { visibleWorld, hiddenNames, tribeHidden } from "../src/render/common";
import { houseKit, eraOf, PALETTE, CIVIC, STYLE_OF, type Era, type Style } from "../src/render3d/kits";
import type { World } from "../src/sim/types";

const run = (seed: number, ticks: number) => { let w = createWorld(seed); for (let i = 0; i < ticks; i++) w = tick(w, []); return w; };
const HOME_ISLES = ISLE_IDS.filter((i) => !isOuter(i));

describe("phase 5: the world beyond the horizon", () => {
  it("three new lands lie outside the home waters, and only ocean ships can reach them", () => {
    for (const seed of [1, 42, 4127]) {
      const t = getTerrain(seed);
      for (const id of OUTER) {
        const I = t.byId[id];
        expect(inHome(I.cx, I.cy)).toBe(false);
        expect(t.sites(id).length).toBeGreaterThan(2);
        for (const h of HOME_ISLES) expect(t.crossing(h, id).tier).toBe(6);
      }
      // the home ladder is unchanged: every home crossing is possible before ocean ships
      for (const a of HOME_ISLES) for (const b of HOME_ISLES) if (a !== b) expect(t.crossing(a, b).tier).toBeLessThanOrEqual(5);
    }
  });

  it("two peoples start beyond the horizon with one man and one woman each", () => {
    const w = createWorld(7);
    const natives = w.tribes.filter((t) => isOuter(t.home));
    expect(natives.map((t) => t.home).sort()).toEqual(["great", "spice"]);
    for (const t of natives) expect(tribePop(w, t.id)).toBe(2);
  });

  it("before ocean ships, the two worlds never meet", () => {
    const w = run(42, 2000);
    expect(w.horizon).toBe(false);
    for (const t of w.tribes) {
      if (isOuter(t.home)) expect(t.known.every((k) => isOuter(k))).toBe(true);
      else expect(t.known.some((k) => isOuter(k))).toBe(false);
    }
    for (const r of w.relations) if (r.met) expect(isOuter(w.tribes[r.a].home)).toBe(isOuter(w.tribes[r.b].home));
    expect(w.villages.some((v) => !v.lost && isOuter(v.isle) && !isOuter(w.tribes[v.tribe].home))).toBe(false);
  }, 120000);

  it("iron is strict, and iron and gunpowder make better weapons; ocean ships are boat tier 6", () => {
    const w = createWorld(1), t = w.tribes[0];
    expect(resourceFactor(w, t, TECH.iron)).toBe(0);
    const base = weaponTier(t);
    t.techs.push("iron"); expect(weaponTier(t)).toBe(base + 1);
    t.techs.push("gunpowder"); expect(weaponTier(t)).toBe(base + 2.5);
    t.techs.push("carrack"); expect(boatTier(t)).toBe(6);
    t.techs.push("stonetools", "bronze"); // ages come in order
    expect(ageOf(t)).toBe(4);
  });

  it("the hidden peoples stay out of sight until the horizon opens", () => {
    const w = run(3, 200);
    const seen = visibleWorld(w);
    expect(seen.villages.every((v) => inHome(v.x, v.y))).toBe(true);
    expect(seen.villages.length).toBeLessThan(w.villages.length);
    const natives = w.tribes.filter((t) => isOuter(t.home));
    for (const t of natives) { expect(tribeHidden(w, t.home)).toBe(true); expect(hiddenNames(w)).toContain(t.name); }
    const open = { ...w, horizon: true };
    expect(visibleWorld(open).villages.length).toBe(w.villages.length);
    expect(hiddenNames(open)).toEqual([]);
  }, 60000);
});

describe("phase 5: the Classical age and the Age of Sail", () => {
  let w: World;
  beforeAll(() => { w = run(1, 3600); }, 300000);

  it("tribes reach the Classical age and the Age of Sail, and the world grows", () => {
    expect(Math.max(...w.tribes.map((t) => t.age))).toBe(4);
    expect(w.tribes.some((t) => t.age >= 3 && !isOuter(t.home))).toBe(true);
    expect(w.horizon).toBe(true);
    const all = new Set(w.tribes.flatMap((t) => t.techs));
    for (const x of ["iron", "coinage", "law", "philosophy", "compass", "carrack"]) expect(all).toContain(x);
  });

  it("ocean ships carry settlers to the new lands and bring the peoples together", () => {
    const colonies = w.villages.filter((v) => !v.lost && isOuter(v.isle) && !isOuter(w.tribes[v.tribe].home));
    expect(colonies.length).toBeGreaterThan(0);
    const met = w.relations.some((r) => r.met && isOuter(w.tribes[r.a].home) !== isOuter(w.tribes[r.b].home));
    const homeKnowsOuter = w.tribes.some((t) => !isOuter(t.home) && t.known.some((k) => isOuter(k)));
    expect(met || homeKnowsOuter).toBe(true);
  });
});

describe("phase 5: Classical and Age of Sail buildings", () => {
  const STYLES: Style[] = ["hearth", "kelp", "thorn", "gull", "far"];
  it("every island has Classical and Age of Sail houses", () => {
    for (const s of STYLES) for (const e of [4, 5] as Era[]) {
      const parts = houseKit(s, e, 2);
      expect(parts.length).toBeGreaterThan(3);
      for (const p of parts) for (const k of [p.x, p.y, p.z, p.sx, p.sy, p.sz]) expect(Number.isFinite(k)).toBe(true);
      expect(PALETTE[s][e]).toBeTruthy();
    }
    for (const c of ["temple", "theatre", "lighthouse", "shipyard", "starfort", "windmill", "warehouse", "arch"] as const) expect(CIVIC[c].length).toBeGreaterThan(0);
    expect(STYLE_OF.great).toBeTruthy(); expect(STYLE_OF.spice).toBeTruthy();
  });
  it("buildings follow the tribe's age", () => {
    expect(eraOf("town", 3, false)).toBe(4);
    expect(eraOf("city", 4, true)).toBe(5);
    expect(eraOf("band", 4, true)).toBe(0);
  });
});
