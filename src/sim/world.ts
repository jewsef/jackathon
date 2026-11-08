import type { World, Village, Tribe, Agent } from "./types";
import { getTerrain, ISLE_IDS, type IsleId, type Site } from "./terrain";
import { Rng } from "./rng";
import { blankJobs, villageName, chron, addPeople } from "./util";
import tribesData from "../../data/tribes.json";

type TribeData = (typeof tribesData)[number];

export function newVillage(w: World, tribe: Tribe, site: Site, name: string): Village {
  const v: Village = {
    id: w.nextId++, name, tribe: tribe.id, isle: site.isle,
    x: site.x, y: site.y, px: site.px, py: site.py, coastal: site.coastal, fert: site.fert, founded: w.tick,
    m: new Array(80).fill(0), f: new Array(80).fill(0), men: 0, women: 0, elders: 0,
    food: 0, jobs: blankJobs(), stage: "band", kin: 0, blood: { [tribe.id]: 1 },
    houses: 1, granary: 0, defense: 0, morale: 0.7, hungry: 0, threat: 0,
    sick: null, immune: 0, mods: { farm: 1, fish: 1, gather: 1 }, lost: false, peak: 0
  };
  v.jobs.gatherer = 1;
  w.villages.push(v);
  return v;
}

export function freeSite(w: World, isle: IsleId, near?: { x: number; y: number }): Site | null {
  const t = getTerrain(w.seed);
  const taken = w.villages.filter((v) => !v.lost && v.isle === isle);
  const minD = isle === "gull" || isle === "kelp" ? 0.42 : 0.6;
  const free = t.sites(isle).filter((s) => taken.every((v) => Math.hypot(v.x - s.x, v.y - s.y) >= minD));
  if (!free.length) return null;
  if (near) free.sort((a, b) => Math.hypot(a.x - near.x, a.y - near.y) - Math.hypot(b.x - near.x, b.y - near.y));
  return free[0];
}

export function newAgent(w: World, o: Partial<Agent> & { name: string; sex: "m" | "f"; role: string; village: number; tribe: number; age?: number }, rng: Rng): Agent {
  const a: Agent = {
    id: w.nextId++, name: o.name, sex: o.sex, born: w.tick - Math.round((o.age ?? 25) * 4), role: o.role,
    village: o.village, tribe: o.tribe, alive: true, died: null, goal: o.goal ?? "", memory: o.memory ?? [],
    founder: o.founder ?? false, ambition: o.ambition ?? rng.next()
  };
  w.agents.push(a);
  return a;
}

/** Year 0: five islands, five tribes, one man and one woman on each. */
export function createWorld(seed: number): World {
  seed = seed >>> 0;
  const terrain = getTerrain(seed);
  const rng = new Rng(seed ^ 0xa5a5a5);
  const w: World = {
    seed, tick: 0, rngState: 0, nextId: 1,
    tribes: [], villages: [], relations: [], routes: [], voyages: [], agents: [], effects: [],
    climate: Object.fromEntries(ISLE_IDS.map((i) => [i, { base: 1, rain: 1, storm: false, calm: false, wind: 0 }])) as World["climate"],
    energy: 12, faith: 0, chronicle: [], events: [], fx: [], contacts: [], endings: []
  };
  (tribesData as TribeData[]).forEach((d, i) => {
    const t: Tribe = {
      id: i, name: d.name, home: d.home as IsleId, parent: null, alive: true,
      tail: d.tail, tip: d.tip, line: d.line, skin: d.skin, cloth: d.cloth, top: d.top, sash: d.sash, hair: d.hair,
      traits: { ...d.traits }, syllables: [...d.syllables],
      techs: [], progress: {}, belief: { awe: 0.2, fear: 0.1, love: 0.2 }, known: [d.home as IsleId],
      drivers: { raftLoss: 0, capsize: 0, windSeasons: 0, calmSeasons: 0, plagueSurvived: 0, raids: 0, hunger: 0, omenVoyage: 0, farReturn: 0 },
      memory: []
    };
    w.tribes.push(t);
    const site = terrain.sites(t.home)[0];
    const v = newVillage(w, t, site, villageName(rng, t));
    addPeople(v, "m", 1, 20); addPeople(v, "f", 1, 19); v.food = 12;
    const isleName = terrain.byId[t.home].name;
    newAgent(w, { name: d.founders[0], sex: "m", role: "Founder", village: v.id, tribe: t.id, age: 20, founder: true, goal: "Keep the fire lit and the children fed." }, rng);
    newAgent(w, { name: d.founders[1], sex: "f", role: "Founder", village: v.id, tribe: t.id, age: 19, founder: true, goal: "Raise a family that outlives the first winter." }, rng);
    chron(w, "village", `${d.founders[0]} and ${d.founders[1]} wake on ${isleName} and light the first fire at ${v.name}.`, v.x, v.y);
  });
  w.chronicle.push(...w.events);
  w.events = [];
  w.rngState = rng.s;
  return w;
}
