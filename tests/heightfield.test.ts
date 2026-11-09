import { describe, it, expect } from "vitest";
import { getTerrain, WX, WY } from "../src/sim/terrain";
import { HeightField } from "../src/render3d/heightfield";

describe("3D height field (phase 1)", () => {
  it("matches the simulation's terrain, so the 3D world is the same world", () => {
    const t = getTerrain(4127), hf = HeightField.build(t, 961, 541);
    let worst = 0, landAgree = 0, n = 0;
    for (let k = 0; k < 400; k++) {
      const x = ((k * 37) % 400) / 400 * WX, y = ((k * 91) % 400) / 400 * WY;
      const a = hf.elevAt(x, y), b = t.elev(x, y, 6);
      worst = Math.max(worst, Math.abs(a - b));
      if (Math.abs(b) > 0.03) { n++; if (Math.sign(a) === Math.sign(b)) landAgree++; }
    }
    expect(worst).toBeLessThan(0.06);
    expect(landAgree / n).toBeGreaterThan(0.98);
  });
  it("puts every founding village on dry land", () => {
    const t = getTerrain(4127), hf = HeightField.build(t, 961, 541);
    for (const id of ["hearth", "kelp", "thorn", "gull", "far"] as const) {
      const s = t.sites(id)[0];
      expect(hf.surfaceY(s.x, s.y)).toBeGreaterThan(0);
    }
  });
});
