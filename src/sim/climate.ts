import type { World, Effect } from "./types";
import type { Rng } from "./rng";
import { getTerrain, ISLE_IDS } from "./terrain";
import { living, chron } from "./util";

/** Fraction of an effect's area that covers a point (soft edge). */
export function coverage(e: Effect, x: number, y: number): number {
  const d = Math.hypot(x - e.x, y - e.y);
  return d >= e.r ? 0 : d < e.r * 0.6 ? 1 : 1 - (d - e.r * 0.6) / (e.r * 0.4);
}
export function effectAt(w: World, power: Effect["power"], x: number, y: number): number {
  let m = 0;
  for (const e of w.effects) if (e.power === power) m = Math.max(m, coverage(e, x, y));
  return m;
}

const SEASON_RAIN = [0.15, -0.15, 0.1, 0.0];

/** Seasons, rain, wind, natural storms. Weather effects from powers age and expire here. */
export function climate(w: World, rng: Rng): World {
  const t = getTerrain(w.seed), season = w.tick % 4;
  for (const id of ISLE_IDS) {
    const I = t.byId[id], c = w.climate[id];
    const rain = effectAt(w, "rain", I.cx, I.cy), dry = effectAt(w, "drought", I.cx, I.cy);
    const calm = effectAt(w, "calm", I.cx, I.cy) > 0.3, wind = effectAt(w, "wind", I.cx, I.cy);
    const storm = effectAt(w, "storm", I.cx, I.cy) > 0.2;
    c.base = 1 + SEASON_RAIN[season] + rng.range(-0.15, 0.15);
    c.rain = Math.max(0.05, c.base + rain * 0.75 - dry * 0.85);
    c.calm = calm; c.wind = wind; c.storm = storm;
    const natural = !calm && rng.chance(season === 2 ? 0.035 : 0.012);
    if (natural) {
      c.storm = true;
      w.effects.push({ id: w.nextId++, power: "storm", x: I.cx + rng.range(-I.rx, I.rx) * 0.5, y: I.cy + rng.range(-I.ry, I.ry) * 0.5, r: 1.3, ticks: 1, age: 0 });
      w.fx.push({ kind: "lightning", x: I.cx, y: I.cy, tick: w.tick });
      if (living(w).some((v) => v.isle === id)) chron(w, "misc", `A gale lashes ${I.name}.`, I.cx, I.cy);
    }
    if (rng.chance(0.004) && !rain) {
      w.effects.push({ id: w.nextId++, power: "drought", x: I.cx, y: I.cy, r: Math.max(I.rx, I.ry), ticks: 4, age: 0 });
      if (living(w).some((v) => v.isle === id)) chron(w, "misc", `A dry year begins on ${I.name}.`, I.cx, I.cy);
    }
  }
  for (const tr of w.tribes) {
    const c = w.climate[tr.home];
    if (c.calm) tr.drivers.calmSeasons += 1;
    if (c.wind > 0.3) tr.drivers.windSeasons += 1;
  }
  return w;
}

/** Land changes: storms flood coasts, ash buries fields then enriches them. Expired effects are removed. */
export function terrainStep(w: World): World {
  for (const e of w.effects) { e.ticks--; e.age++; }
  w.effects = w.effects.filter((e) => e.ticks > 0);
  return w;
}
