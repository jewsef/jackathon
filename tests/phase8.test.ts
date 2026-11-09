import { describe, it, expect } from "vitest";
import { createWorld } from "../src/sim/world";
import { tick } from "../src/sim/tick";
import { TimeLapse, CAPTION_KINDS } from "../src/sim/timelapse";
import { orbitShot, flyoutShot, titleCard, PHOTO_FILTERS } from "../src/render/cinema";
import { WX, WY } from "../src/sim/terrain";
import type { Action, World } from "../src/sim/types";

const strip = (w: World) => { const { chronicle, events, fx, contacts, ...rest } = w; void chronicle; void events; void fx; void contacts; return JSON.stringify(rest); };

describe("phase 8: time-lapse", () => {
  it("replays the whole history, acts of the sky included, and ends on exactly the live world", () => {
    const log: Action[] = [
      { tick: 30, power: "rain", x: 4.8, y: 4.7 },
      { tick: 90, power: "storm", x: 7.5, y: 3 },
      { tick: 150, power: "omen", x: 4.8, y: 4.7 }
    ];
    let live = createWorld(77);
    for (let i = 0; i < 400; i++) live = tick(live, log.filter((a) => a.tick === live.tick));
    const tl = new TimeLapse(77, log, live.tick, 50);
    let frames = 0, last = 0;
    while (!tl.done) {
      const f = tl.next(); frames++;
      expect(f.progress).toBeGreaterThanOrEqual(last); last = f.progress;
      for (const e of f.entries) expect(CAPTION_KINDS.has(e.kind)).toBe(true);
    }
    expect(frames).toBeGreaterThanOrEqual(45);
    expect(frames).toBeLessThanOrEqual(55);
    expect(last).toBe(1);
    expect(strip(tl.world)).toBe(strip(live));
  });
});

describe("phase 8: camera shots and title cards", () => {
  it("the age-dawn flyover swoops from high above the capital down to street level, circling it", () => {
    const s = orbitShot(5, 4, 0.3);
    const a = s(0), b = s(1);
    expect(a.x).toBe(5); expect(b.y).toBe(4);
    expect(a.z).toBeCloseTo(2.2, 5); expect(b.z).toBeCloseTo(9, 5);
    expect(b.yaw - a.yaw).toBeGreaterThan(3);
    for (let u = 0; u <= 1; u += 0.05) { const f = s(u); expect(f.z).toBeGreaterThanOrEqual(1); expect(f.z).toBeLessThanOrEqual(60); }
  });

  it("the world-grows shot ends on the whole world, facing north", () => {
    const f = flyoutShot(14, 4, WX, WY)(1);
    expect(f.x).toBeCloseTo(WX / 2); expect(f.y).toBeCloseTo(WY / 2); expect(f.z).toBeCloseTo(1); expect(f.yaw).toBeCloseTo(0);
  });

  it("title cards name the age and the people, skip the Stone Age, and mark the world growing", () => {
    expect(titleCard("The Hearth folk enter the Bronze Age. Copper and tin become bronze.")).toEqual({ title: "The Bronze Age", sub: "The Hearth folk" });
    expect(titleCard("The Kelp folk enter the Stone Age. Knapped flint.")).toBeNull();
    expect(titleCard("The world grows. The Far Folk launch ships...")?.title).toBe("The world grows");
    expect(titleCard("Hunger at Dunmawatch.")).toBeNull();
    expect(PHOTO_FILTERS.none).toBe("none");
    expect(Object.keys(PHOTO_FILTERS).length).toBeGreaterThanOrEqual(4);
  });
});
