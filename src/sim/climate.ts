import type { World, Effect } from "./types";
import type { Rng } from "./rng";
import { getTerrain, ISLE_IDS } from "./terrain";
import { living, chron, kill, popOf } from "./util";

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

const WARM_STEPS: [number, string][] = [
  [0.5, "Old people say the winters are milder than when they were young. The smoke from the mills drifts out over the sea."],
  [1, "The world is warming. Snow lies higher on the mountains each year, and the summer storms come harder."],
  [2, "The climate is changing fast. Harvests wither in hot summers, and storms tear at the coasts."],
  [3, "The air is a furnace. Droughts and great storms are now ordinary years."]
];

/** Coal smoke and carbon: the air of each town, and the warming of the whole world. */
export function pollution(w: World, rng: Rng) {
  // the sea and forests slowly take carbon back
  w.co2 += (280 - w.co2) * 0.0004;
  const before = w.warming;
  w.warming = Math.max(0, 3 * Math.log2(w.co2 / 280));
  for (const [deg, text] of WARM_STEPS) if (before < deg && w.warming >= deg) chron(w, "climate", text);
  for (const v of living(w)) {
    if (v.smog <= 0.001) { v.smog = 0; continue; }
    // rain washes the air, wind blows the smoke away; your weather helps
    const clean = 0.9 - effectAt(w, "rain", v.x, v.y) * 0.4 - effectAt(w, "wind", v.x, v.y) * 0.35 - effectAt(w, "storm", v.x, v.y) * 0.3;
    v.smog = Math.max(0, v.smog * clean);
    v.morale = Math.max(0, v.morale - v.smog * 0.01);
    if (v.smog > 0.55 && rng.chance(0.15)) {
      const d = kill(v, rng.binom(Math.round(v.elders + popOf(v) * 0.05), 0.04 * v.smog), rng, "weak");
      if (d >= 3) chron(w, "climate", `Choking smog settles over ${v.name}. ${d} die, mostly the old and the very young.`, v.x, v.y);
    }
  }
}

/** Seasons, rain, wind, natural storms. Weather effects from powers age and expire here. */
export function climate(w: World, rng: Rng): World {
  const t = getTerrain(w.seed), season = w.tick % 4;
  const warm = w.warming ?? 0;
  for (const id of ISLE_IDS) {
    const I = t.byId[id], c = w.climate[id];
    const rain = effectAt(w, "rain", I.cx, I.cy), dry = effectAt(w, "drought", I.cx, I.cy);
    const calm = effectAt(w, "calm", I.cx, I.cy) > 0.3, wind = effectAt(w, "wind", I.cx, I.cy);
    const storm = effectAt(w, "storm", I.cx, I.cy) > 0.2;
    c.base = 1 + SEASON_RAIN[season] + rng.range(-0.15, 0.15);
    c.rain = Math.max(0.05, c.base + rain * 0.75 - dry * 0.85);
    c.calm = calm; c.wind = wind; c.storm = storm;
    const natural = !calm && rng.chance((season === 2 ? 0.035 : 0.012) * (1 + 0.3 * warm));
    if (natural) {
      c.storm = true;
      w.effects.push({ id: w.nextId++, power: "storm", x: I.cx + rng.range(-I.rx, I.rx) * 0.5, y: I.cy + rng.range(-I.ry, I.ry) * 0.5, r: 1.3, ticks: 1, age: 0 });
      w.fx.push({ kind: "lightning", x: I.cx, y: I.cy, tick: w.tick });
      if (living(w).some((v) => v.isle === id)) chron(w, "misc", `A gale lashes ${I.name}.`, I.cx, I.cy);
    }
    if (rng.chance(0.004 * (1 + 0.45 * warm)) && !rain) {
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
