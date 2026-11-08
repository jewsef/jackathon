import type { World, Action } from "./types";
import { Rng } from "./rng";
import { applyPowers } from "./powers";
import { climate, terrainStep } from "./climate";
import { ecology } from "./ecology";
import { society } from "./society";
import { plague } from "./plague";
import { conflict } from "./conflict";
import { agents } from "./agents";
import { voyages } from "./voyages";
import { culture } from "./culture";
import { stamp } from "./util";

const CHRONICLE_MAX = 800;

/** Turns this tick's events into chronicle entries. */
export function narrate(w: World): World {
  w.chronicle.push(...w.events);
  if (w.chronicle.length > CHRONICLE_MAX) w.chronicle.splice(0, w.chronicle.length - CHRONICLE_MAX);
  return w;
}

/**
 * The whole game in one function. One tick is one season.
 * Each system is a step over the world: (world, rng) -> world. All randomness comes from the
 * seeded Rng whose state is stored in the world, so a seed plus an action log replays exactly.
 */
export function tick(w: World, acts: Action[] = []): World {
  const rng = new Rng(w.rngState);
  w.events = []; w.fx = []; w.contacts = [];
  w = applyPowers(w, acts, rng);   // player edits sky + ground
  w = climate(w, rng);             // season, wind, weather cells
  w = ecology(w);                  // soil, crops, forests, fish
  w = society(w, rng);             // villages: growth, hunger, jobs
  w = plague(w, rng);              // sickness along contact
  w = conflict(w, rng);            // grudges, raids, wars
  w = agents(w, rng);              // named people: goals, choices
  w = voyages(w, rng);             // boats at sea, discovery
  w = culture(w, rng);             // tech, belief, memory
  w = terrainStep(w);              // floods, ash, effects expire
  w = narrate(w);
  w.tick++;
  w.rngState = rng.s;
  return w;
}

/** Rebuild any run from its seed and action log (Rule C). */
export function replay(createWorldFn: (seed: number) => World, seed: number, log: Action[], toTick: number): World {
  let w = createWorldFn(seed);
  const byTick = new Map<number, Action[]>();
  for (const a of log) { const l = byTick.get(a.tick) ?? []; l.push(a); byTick.set(a.tick, l); }
  while (w.tick < toTick) w = tick(w, byTick.get(w.tick) ?? []);
  return w;
}

export { stamp };
