import type { World } from "./types";
import { effectAt, coverage } from "./climate";
import { living } from "./util";

/** How good this season is for farming, fishing and foraging at each village. */
export function ecology(w: World): World {
  for (const v of living(w)) {
    const c = w.climate[v.isle];
    const rain = Math.max(0.05, c.base + effectAt(w, "rain", v.x, v.y) * 0.75 - effectAt(w, "drought", v.x, v.y) * 0.85);
    let farm = rain < 1 ? 0.25 + 0.75 * rain : rain < 1.6 ? 1 + (rain - 1) * 0.3 : 1.18 - (rain - 1.6) * 1.2;
    for (const e of w.effects) if (e.power === "eruption") {
      const cov = coverage(e, v.x, v.y);
      if (cov > 0) farm *= e.age < 8 ? 1 - 0.75 * cov : 1 + 0.5 * cov;
    }
    const storm = effectAt(w, "storm", v.x, v.y) > 0.2;
    const fish = storm ? 0.25 : effectAt(w, "calm", v.x, v.y) > 0.3 ? 1.15 : 1;
    v.mods = { farm: Math.max(0.05, farm), fish, gather: 0.55 + 0.45 * Math.min(rain, 1.3) / 1.3 };
  }
  return w;
}
