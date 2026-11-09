import { describe, it, expect, beforeAll } from "vitest";
import { createWorld } from "../src/sim/world";
import { tick } from "../src/sim/tick";
import { economy } from "../src/sim/economy";
import { Rng } from "../src/sim/rng";
import { getTerrain } from "../src/sim/terrain";
import { popOf } from "../src/sim/util";
import { layoutFor } from "../src/render/crowd";
import { planFor, landPath, roadNetwork, isPlanned, roadTier } from "../src/render/plan";
import { houseKit, CIVIC, eraOf, PALETTE, type Era, type Style } from "../src/render3d/kits";
import type { World } from "../src/sim/types";

const STYLES: Style[] = ["hearth", "kelp", "thorn", "gull", "far"];
const ERAS: Era[] = [0, 1, 2, 3];

describe("phase 4: building kits", () => {
  it("every island has a kit for every era, built from valid parts", () => {
    for (const s of STYLES) for (const e of ERAS) {
      const parts = houseKit(s, e, 2);
      expect(parts.length).toBeGreaterThanOrEqual(2);
      for (const p of parts) {
        expect(["box", "cyl", "cone", "prism", "hip", "dome"]).toContain(p.g);
        for (const k of [p.x, p.y, p.z, p.sx, p.sy, p.sz]) expect(Number.isFinite(k)).toBe(true);
        expect(Math.min(p.sx, p.sy, p.sz)).toBeGreaterThan(0);
      }
      expect(PALETTE[s][e]).toBeTruthy();
    }
    for (const parts of Object.values(CIVIC)) expect(parts.length).toBeGreaterThan(0);
  });

  it("islands look different from each other in the same era", () => {
    const sig = (s: Style) => JSON.stringify(houseKit(s, 2).map((p) => p.g)) + PALETTE[s][2].wall;
    expect(new Set(STYLES.map(sig)).size).toBe(5);
  });

  it("town houses grow upward with more storeys", () => {
    const top = (n: number) => Math.max(...houseKit("gull", 3, n).map((p) => p.y + p.sy));
    expect(top(3)).toBeGreaterThan(top(1) + 1);
  });

  it("the era follows the tribe's age and town planning", () => {
    expect(eraOf("band", 2, false)).toBe(0);
    expect(eraOf("village", 0, false)).toBe(0);
    expect(eraOf("village", 1, false)).toBe(1);
    expect(eraOf("town", 2, false)).toBe(2);
    expect(eraOf("city", 2, true)).toBe(3);
  });
});

describe("phase 4: towns and roads", () => {
  let w: World;
  beforeAll(() => { w = createWorld(1); for (let i = 0; i < 2400; i++) w = tick(w, []); }, 180000);

  it("tribes invent the wheel, roads and town planning, and towns become cities", () => {
    const techs = new Set(w.tribes.flatMap((t) => t.techs));
    for (const x of ["wheel", "roads", "planning"]) expect(techs).toContain(x);
    const cities = w.villages.filter((v) => !v.lost && v.stage === "city");
    expect(cities.length).toBeGreaterThan(0);
    for (const v of cities) expect(isPlanned(v, w.tribes[v.tribe])).toBe(true);
    expect(Math.max(...w.tribes.map(roadTier))).toBe(2);
  });

  it("a planned town's houses sit on land, between the streets, never on them", () => {
    const t = getTerrain(w.seed);
    const v = w.villages.filter((x) => !x.lost).sort((a, b) => popOf(b) - popOf(a))[0];
    const plan = planFor(t, v, layoutFor(t, v));
    expect(plan.plots.length).toBeGreaterThan(30);
    expect(plan.streets.length).toBeGreaterThan(4);
    const segDist = (px: number, py: number, s: (typeof plan.streets)[number]) => {
      const dx = s.bx - s.ax, dy = s.by - s.ay, l2 = dx * dx + dy * dy;
      const u = Math.max(0, Math.min(1, ((px - s.ax) * dx + (py - s.ay) * dy) / l2));
      return Math.hypot(px - s.ax - u * dx, py - s.ay - u * dy);
    };
    for (const p of plan.plots) {
      expect(t.elev(p.x, p.y, 7)).toBeGreaterThan(0);
      for (const s of plan.streets) expect(segDist(p.x, p.y, s)).toBeGreaterThan(0.009);
    }
    // the same world always draws the same plan
    expect(planFor(t, v, layoutFor(t, v))).toBe(plan);
  });

  it("roads follow the land between villages and join every village on an island", () => {
    const t = getTerrain(w.seed);
    const live = w.villages.filter((v) => !v.lost && v.stage !== "band");
    const roads = roadNetwork(t, live, w.tribes);
    expect(roads.length).toBeGreaterThan(3);
    for (const r of roads) {
      const a = live.find((v) => v.id === r.a)!, b = live.find((v) => v.id === r.b)!;
      expect(a.isle).toBe(b.isle);
      const wet = r.pts.filter(([x, y]) => t.elev(x, y, 5) < -0.002).length;
      expect(wet / r.pts.length).toBeLessThan(0.05);
      let len = 0; for (let i = 1; i < r.pts.length; i++) len += Math.hypot(r.pts[i][0] - r.pts[i - 1][0], r.pts[i][1] - r.pts[i - 1][1]);
      expect(len).toBeLessThan(Math.hypot(a.x - b.x, a.y - b.y) * 2.2 + 0.1);
    }
    // a spanning tree: each island with k villages gets at most k - 1 roads
    const per = new Map<string, number>();
    for (const v of live) per.set(v.isle, (per.get(v.isle) ?? 0) + 1);
    for (const [isle, k] of per) expect(roads.filter((r) => live.find((v) => v.id === r.a)!.isle === isle).length).toBeLessThanOrEqual(k - 1);
  });

  it("a path never crosses open sea", () => {
    const t = getTerrain(w.seed);
    expect(landPath(t, t.byId.hearth.cx, t.byId.hearth.cy, t.byId.far.cx, t.byId.far.cy)).toBeNull();
  });

  it("roads move stores between a tribe's villages faster", () => {
    const gap = (roads: boolean) => {
      const x: World = structuredClone(createWorld(7));
      const t = x.tribes[0];
      t.techs = roads ? ["wheel", "roads"] : [];
      const a = x.villages.find((v) => v.tribe === 0)!;
      const b = structuredClone(a); b.id = 999; b.stock = { ...a.stock, stone: 0 }; a.stock.stone = 50;
      x.villages.push(b);
      economy(x, new Rng(1));
      return Math.abs(a.stock.stone - b.stock.stone);
    };
    expect(gap(true)).toBeLessThan(gap(false) - 5);
  });
});
