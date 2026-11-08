import type { World, Village, Tribe, Job, Stage } from "./types";
import { STAGES, yearOf } from "./types";
import type { Rng } from "./rng";
import { living, popOf, adults, kids, kidsAged, kill, chron, has, boatTier, defenseCap, tribePop, villageName, agentsOf, blankJobs, fertileWomen, ableMen, recount, movePeople, AGE_N } from "./util";
import { freeSite, newVillage, newAgent } from "./world";
import { makeName } from "./util";

const FARM_SEASON = [0.85, 1.1, 1.5, 0.35];
const GATHER_SEASON = [1.0, 1.2, 1.1, 0.55];
const FISH_SEASON = [1.0, 1.1, 1.0, 0.7];

export function stageOf(pop: number): Stage {
  return pop < 15 ? "band" : pop < 60 ? "camp" : pop < 300 ? "village" : "town";
}

/** How strongly a village wants to go to sea: marriage pressure, omens, curiosity, crowding. */
export function seaDesire(t: Tribe, v: Village): number {
  return Math.max(0, Math.min(1, Math.max(0, v.kin - 0.25) * 2 + t.drivers.omenVoyage * 0.2 + (t.traits.curious - 0.4) * 0.6 + (v.hungry > 0 ? 0.15 : 0)));
}

export function jobTargets(w: World, v: Village, t: Tribe): Record<Job, number> {
  const target = blankJobs(), s = STAGES.indexOf(v.stage);
  if (s === 0) {
    target.gatherer = v.coastal ? 0.7 : 1;
    target.fisher = v.coastal ? 0.3 : 0;
    return target;
  }
  let rest = 1;
  const set = (j: Job, x: number) => { target[j] = x; rest -= x; };
  set("builder", 0.07 + 0.08 * v.threat + (v.houses < popOf(v) / 5 ? 0.04 : 0));
  if (v.coastal) set("boatwright", 0.03 + 0.06 * seaDesire(t, v));
  if (s >= 2) {
    set("leader", 0.02);
    set("doctor", 0.03 + (v.sick ? 0.1 : 0));
    set("priest", 0.03 + t.belief.awe * 0.03);
  }
  if (s >= 2 && v.threat > 0) set("warrior", 0.06 + 0.2 * v.threat);
  else if (s >= 3) set("warrior", 0.03);
  if (has(t, "farming")) {
    target.farmer = rest * (v.coastal ? 0.55 : 0.75);
    target.fisher = v.coastal ? rest * 0.25 : 0;
    target.gatherer = rest - target.farmer - target.fisher;
  } else {
    target.fisher = v.coastal ? rest * 0.35 : 0;
    target.gatherer = rest - target.fisher;
  }
  return target;
}

function assignJobs(w: World, v: Village, t: Tribe) {
  const target = jobTargets(w, v, t);
  const hasLeader = agentsOf(w, (a) => a.village === v.id && a.role === "Leader").length > 0;
  const rate = hasLeader ? 0.3 : 0.18;
  let sum = 0;
  for (const j in target) { const k = j as Job; v.jobs[k] += (target[k] - v.jobs[k]) * rate; if (v.jobs[k] < 0.001) v.jobs[k] = 0; sum += v.jobs[k]; }
  for (const j in v.jobs) v.jobs[j as Job] /= sum || 1;
}

function threatOf(w: World, v: Village): number {
  let th = 0;
  for (const r of w.relations) {
    if (r.a !== v.tribe && r.b !== v.tribe) continue;
    if (r.war) th = Math.max(th, 1);
    else if (r.met && r.attitude < -0.3) th = Math.max(th, 0.5);
  }
  return th;
}

/** Villages: food, births, aging, kinship, jobs, building and splitting. The crowd lives here as numbers. */
export function society(w: World, rng: Rng): World {
  const season = w.tick % 4;
  for (const v of living(w)) {
    const t = w.tribes[v.tribe];
    let pop = popOf(v);
    const prevStage = v.stage;
    v.stage = stageOf(pop);
    if (STAGES.indexOf(v.stage) > STAGES.indexOf(prevStage) && pop > 14)
      chron(w, "village", `${v.name} grows from a ${prevStage} into a ${v.stage}.`, v.x, v.y);
    v.threat = threatOf(w, v);
    assignJobs(w, v, t);

    // food
    const A = adults(v), K = kids(v), older = kidsAged(v, 12, 16), mid = kidsAged(v, 8, 12);
    const work = A + v.elders * 0.25 + older * 0.45 + mid * 0.2 + (pop <= 6 ? 0.6 : 0);
    const farming = has(t, "farming");
    const nFarm = farming ? v.jobs.farmer * work : 0;
    const nGather = (v.jobs.gatherer + (farming ? 0 : v.jobs.farmer)) * work + (v.coastal ? 0 : v.jobs.fisher * work);
    const nFish = v.coastal ? v.jobs.fisher * work : 0;
    const landCap = 110 * v.fert * (has(t, "granary") ? 1.25 : 1);
    const gatherCap = 20 * v.fert + 6, fishCap = 12 + 6 * boatTier(t);
    const prod =
      4.2 * FARM_SEASON[season] * v.mods.farm * nFarm * landCap / (landCap + nFarm) +
      2.2 * GATHER_SEASON[season] * v.mods.gather * nGather * gatherCap / (gatherCap + nGather) +
      2.1 * FISH_SEASON[season] * v.mods.fish * nFish * fishCap / (fishCap + nFish);
    const cons = A + v.elders * 0.8 + K * 0.45;
    v.food += prod - cons;
    v.food *= 0.96;
    v.food = Math.min(v.food, 15 + v.houses * 4 + v.granary * 80);
    if (v.food < 0) {
      const deficit = -v.food;
      const deaths = rng.binom(pop, Math.min(0.3, (deficit / Math.max(1, pop)) * 0.3));
      const d = kill(v, deaths, rng, "weak");
      v.food = 0; v.hungry = Math.min(8, v.hungry + 1); t.drivers.hunger += 1;
      if (d >= 3 || (d > 0 && pop < 30)) chron(w, "death", `Hunger at ${v.name}: ${d} die before the next harvest.`, v.x, v.y);
    } else v.hungry = Math.max(0, v.hungry - 0.5);

    // births: women 16-44 with a partner
    pop = popOf(v);
    const couples = Math.min(fertileWomen(v), ableMen(v));
    const foodF = v.hungry > 0 ? 0.3 : v.food / Math.max(1, pop) > 0.4 ? 1 : 0.6;
    const kinF = 1 - 0.6 * Math.max(0, v.kin - 0.35);
    const houseF = v.houses >= pop / 6 ? 1 : 0.7;
    const births = rng.binom(couples, 0.09 * foodF * kinF * (0.6 + 0.4 * v.morale) * houseF);
    for (let i = 0; i < births; i++) (rng.chance(0.5) ? v.m : v.f)[0]++;
    if (births && v.peak < 8) {
      const founders = agentsOf(w, (a) => a.founder && a.village === v.id);
      chron(w, "birth", founders.length >= 2 ? `A child is born to ${founders[0].name} and ${founders[1].name} at ${v.name}. The ${t.name} now number ${pop + births}.` : `A child is born at ${v.name}.`, v.x, v.y);
    }

    // deaths by age
    const kinRisk = 0.008 * Math.max(0, v.kin - 0.4);
    for (const a of [v.m, v.f]) for (let i = 0; i < AGE_N; i++) {
      if (!a[i]) continue;
      const p = (i < 5 ? 0.005 + kinRisk : i < 16 ? 0.0015 + kinRisk * 0.5 : i < 45 ? 0.0012 : i < 55 ? 0.003 : i < 65 ? 0.009 : i < 75 ? 0.025 : 0.07);
      a[i] -= rng.binom(a[i], p);
    }

    // aging, once a year
    if (season === 0) {
      for (const a of [v.m, v.f]) { for (let i = AGE_N - 1; i > 0; i--) a[i] = a[i - 1]; a[0] = 0; }
      // kinship: small isolated populations become one family
      const tp = w.villages.reduce((s, x) => s + (!x.lost && x.tribe === v.tribe && x.isle === v.isle ? popOf(x) : 0), 0);
      const outside = 1 - (v.blood[String(v.tribe)] ?? 0);
      const target = pop <= 3 ? 0 : Math.max(0, Math.min(0.95, 2.2 / Math.sqrt(tp + 4) - outside * 0.9));
      v.kin += (target - v.kin) * 0.12;
    }
    recount(v);

    // building
    pop = popOf(v);
    const builders = v.jobs.builder * work + (v.stage === "band" ? 0.4 : 0);
    if (v.houses < Math.ceil(pop / 5) + 1) v.houses += builders * 0.2;
    if (has(t, "granary") && v.granary < 1 + Math.floor(pop / 150) && v.food > pop * 0.4) v.granary += builders * 0.02;
    if (v.threat > 0 && v.defense < defenseCap(t)) v.defense = Math.min(defenseCap(t), v.defense + builders * 0.012 * v.threat);

    // morale
    const target = 0.75 - v.hungry * 0.08 - (v.sick ? 0.3 : 0) - v.threat * 0.12 + t.belief.love * 0.15 - t.belief.fear * 0.1;
    v.morale += (Math.max(0.05, Math.min(1, target)) - v.morale) * 0.2;

    // splitting: a crowded village sends young families to found a new one
    if ((pop > 220 || (v.hungry >= 3 && pop > 45)) && rng.chance(0.06)) {
      const site = freeSite(w, v.isle, v);
      if (site) {
        const nv = newVillage(w, t, site, villageName(rng, t));
        const moved = movePeople(v, nv, 0.25, rng);
        nv.food = v.food * 0.25; v.food *= 0.75; nv.kin = v.kin; nv.blood = { ...v.blood }; nv.immune = v.immune;
        nv.houses = 2;
        const founder = newAgent(w, { name: makeName(rng, t), sex: rng.chance(0.5) ? "m" : "f", role: "Village founder", village: nv.id, tribe: t.id, age: rng.range(22, 34), goal: `Clear land for ${nv.name}.` }, rng);
        chron(w, "village", `${founder.name} leads ${moved} people from ${v.name} to found ${nv.name}.`, nv.x, nv.y);
      }
    }

    pop = popOf(v);
    v.peak = Math.max(v.peak, pop);
    if (pop === 0) {
      v.lost = true;
      v.lostReason = v.lostReason ?? "empty";
      chron(w, "death", `${v.name} stands empty. The last of its people are gone.`, v.x, v.y);
    }
  }
  return w;
}

export const _test = { yearOf, tribePop };
