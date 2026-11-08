import { describe, it, expect } from "vitest";
import { getTerrain, ISLE_IDS } from "../src/sim/terrain";

const SEEDS = [1, 7, 42, 99, 314, 2024, 4127, 8191, 65537, 123456];

describe("archipelago (milestone 1 proof: the island ladder)", () => {
  for (const seed of SEEDS) {
    it(`seed ${seed} has five islands: near, nearer, and one too far to see`, () => {
      const t = getTerrain(seed);
      for (const id of ISLE_IDS) expect(t.sites(id).length, `${id} has village sites`).toBeGreaterThan(0);
      const kelp = t.crossing("hearth", "kelp"), thorn = t.crossing("hearth", "thorn"), gull = t.crossing("hearth", "gull");
      const nearestToFar = Math.min(t.crossing("kelp", "far").dist, t.crossing("thorn", "far").dist, t.crossing("hearth", "far").dist);
      if ((globalThis as any).process?.env?.SHOW) console.log(seed, [kelp, thorn, gull, t.crossing("kelp", "far"), t.crossing("thorn", "far")].map((c) => `${c.b}:${c.dist.toFixed(2)}/${c.maxDepth.toFixed(2)}/t${c.tier}`).join(" "), t.sites("hearth").length);
      expect(kelp.tier).toBe(1);
      expect(thorn.tier).toBeLessThanOrEqual(2);
      expect(gull.tier).toBeLessThanOrEqual(2);
      expect(Math.max(thorn.tier, gull.tier)).toBe(2);
      expect(t.crossing("kelp", "far").tier).toBe(5);
      expect(t.crossing("thorn", "far").tier).toBe(5);
      expect(nearestToFar).toBeGreaterThan(3.4);
    });
  }
});
