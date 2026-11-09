import type { World, Village, Tribe, Res } from "./types";
import { RES } from "./types";
import type { Rng } from "./rng";
import { living, popOf, has, defenseCap, chron, villageById, relation } from "./util";
import { workforce, toolFactor } from "./society";

/** Which material each island builds its houses from, by its main resource. */
export function houseMaterial(t: Tribe, isle: string): Res {
  if (isle === "hearth") return has(t, "brickmaking") ? "brick" : "wood";
  if (isle === "gull") return has(t, "masonry") ? "stone" : "wood";
  if (isle === "kelp") return "fiber";
  return "wood";
}
const cap = (v: Village) => 60 + v.houses * 6 + v.granary * 40;

function take(v: Village, r: Res, n: number): number {
  const got = Math.min(v.stock[r], n);
  v.stock[r] -= got;
  return got;
}

/**
 * Resources: extraction from each island's deposits, crafting (bricks, bronze), construction,
 * sharing between a tribe's villages and trade along routes. Forests regrow; mines run down.
 */
export function economy(w: World, rng: Rng): World {
  const season = w.tick % 4;
  for (const v of living(w)) {
    const t = w.tribes[v.tribe], dep = w.deposits[v.isle], base = w.depositBase[v.isle];
    const work = workforce(v), tools = toolFactor(w, t, v), winter = season === 3 ? 0.6 : 1;
    const n = (j: keyof Village["jobs"]) => v.jobs[j] * work;
    const sat = (x: number, k: number) => x * k / (k + x);
    // foragers bring firewood, fibre, herbs and flint nodules; fishers rake salt
    const g = n("gatherer");
    v.stock.wood += sat(g, 30) * 0.18 * dep.wood * winter;
    v.stock.fiber += sat(g, 30) * 0.12 * dep.fiber;
    v.stock.herbs += sat(g, 30) * 0.08 * dep.herbs;
    v.stock.flint += sat(g, 30) * 0.05 * dep.flint;
    if (v.coastal) v.stock.salt += sat(n("fisher"), 30) * 0.08 * dep.salt;
    v.stock.spice += sat(g + n("farmer") * 0.5, 30) * 0.06 * dep.spice;
    // dedicated extraction
    const wc = sat(n("woodcutter"), 40) * 1.6 * dep.wood * tools * winter;
    v.stock.wood += wc;
    dep.wood = Math.max(0.05, dep.wood - wc * 0.0005);
    const q = sat(n("quarrier"), 40) * 1.3 * tools;
    const sw = dep.stone / Math.max(0.01, dep.stone + dep.clay * (has(t, "pottery") ? 1.4 : 0.3));
    v.stock.stone += q * sw * dep.stone;
    v.stock.clay += q * (1 - sw) * dep.clay * 1.4;
    const mi = sat(n("miner"), 40) * tools;
    if (mi > 0) {
      v.stock.flint += mi * 0.7 * dep.flint;
      // native copper nuggets and tin stones can be picked before anyone knows how to work them
      const metal = has(t, "copperworking") ? 1 : 0.25;
      v.stock.copper += mi * 0.5 * dep.copper * metal; dep.copper = Math.max(base.copper * 0.2, dep.copper - mi * 0.5 * dep.copper * metal * 0.0004);
      v.stock.tin += mi * 0.4 * dep.tin * metal; dep.tin = Math.max(base.tin * 0.2, dep.tin - mi * 0.4 * dep.tin * metal * 0.0004);
      dep.flint = Math.max(base.flint * 0.3, dep.flint - mi * 0.0002);
      // iron ore: dug out once the Bronze Age smiths know what it is, smelted once they know iron
      const ironK = has(t, "iron") ? 1 : has(t, "bronze") ? 0.3 : 0;
      // coal: dug for the iron furnaces, then by the ton once there are steam pumps
      const coalK = has(t, "steam") ? 1.2 : has(t, "iron") ? 0.3 : 0;
      v.stock.coal += mi * 0.6 * dep.coal * coalK; dep.coal = Math.max(base.coal * 0.3, dep.coal - mi * 0.6 * dep.coal * coalK * 0.00025);
      v.stock.iron += mi * 0.45 * dep.iron * ironK; dep.iron = Math.max(base.iron * 0.25, dep.iron - mi * 0.45 * dep.iron * ironK * 0.0003);
    }
    // crafting
    if (has(t, "brickmaking") && v.stock.clay > 2 && v.stock.wood > 2) {
      const b = Math.min(v.stock.clay / 2, v.stock.wood / 2, 0.6 * (n("quarrier") + n("builder")) * tools);
      v.stock.clay -= b * 2; v.stock.wood -= b; v.stock.brick += b * 1.5;
    }
    if (has(t, "bronze") && v.stock.copper > 1 && v.stock.tin > 0.5) {
      const b = Math.min(v.stock.copper / 3, v.stock.tin, 0.5 * n("smith") + 0.1);
      v.stock.copper -= b * 3; v.stock.tin -= b; v.stock.bronze += b * 2;
    }
    // the Industrial age: steel from iron and coal; factories multiply output and burn coal
    let burn = 0;
    if (has(t, "steel") && v.stock.iron > 2 && v.stock.coal > 2) {
      const b = Math.min(v.stock.iron / 2, v.stock.coal / 2, 0.4 * n("smith") + 0.6 * n("worker") + 0.1);
      v.stock.iron -= b * 2; v.stock.coal -= b; v.stock.steel += b * 1.5; burn += b;
    }
    if (has(t, "factory") && n("worker") > 0) {
      const fuel = Math.min(v.stock.coal, n("worker") * 0.22);
      v.stock.coal -= fuel; burn += fuel;
      const power = Math.min(1, fuel / Math.max(0.1, n("worker") * 0.22));
      // powered mills spin fibre, fire bricks and forge iron faster
      v.stock.fiber += n("worker") * 0.08 * power; v.stock.brick += has(t, "brickmaking") ? n("worker") * 0.06 * power : 0;
      v.stock.iron += n("worker") * 0.03 * power * dep.iron;
    }
    if (has(t, "steam")) { const pump = Math.min(v.stock.coal, n("miner") * 0.04); v.stock.coal -= pump; burn += pump; }
    v.smog = Math.min(1, v.smog + burn * 0.012);
    w.co2 += burn * 0.0035;
    // tools and weapons wear out
    v.stock.flint *= 0.99; v.stock.bronze *= 0.995; v.stock.iron *= 0.997; v.stock.spice *= 0.99; v.stock.steel *= 0.998;
    // spice is a luxury: it lifts spirits wherever it reaches
    if (v.stock.spice > 3) v.morale = Math.min(1, v.morale + 0.004);
    const c = cap(v);
    for (const r of RES) v.stock[r] = Math.max(0, Math.min(c, v.stock[r]));

    // construction: houses, granaries, defences and monuments all cost materials
    const pop = popOf(v);
    const builders = (v.jobs.builder * work + (v.stage === "band" ? 0.4 : 0)) * (1 + (tools - 1) * 0.8) * (has(t, "wheel") ? 1.15 : 1) * (has(t, "roads") ? 1.1 : 1) * (has(t, "railway") ? 1.15 : 1) * (has(t, "factory") ? 1.2 : 1);
    const mat = houseMaterial(t, v.isle);
    if (v.houses < Math.ceil(pop / 5) + 1) {
      const want = builders * 0.2;
      const used = take(v, mat, want * 3) + (mat !== "wood" ? take(v, "wood", Math.max(0, want * 3 - v.stock[mat])) : 0);
      v.houses += Math.min(want, used / 3 + (v.stage === "band" ? 0.05 : 0));
    }
    if (has(t, "granary") && v.granary < 1 + Math.floor(pop / 150) && v.food > pop * 0.4) {
      const m = v.stock.brick > 4 ? "brick" : v.stock.stone > 4 ? "stone" : "wood";
      const used = take(v, m, builders * 0.25);
      v.granary += used * 0.06;
    }
    if (v.threat > 0 && v.defense < defenseCap(t)) {
      const tier = Math.floor(v.defense);
      const m: Res = tier >= 2 && has(t, "masonry") ? "stone" : "wood";
      const used = take(v, m, builders * 0.3 * v.threat);
      v.defense = Math.min(defenseCap(t), v.defense + used * (m === "stone" ? 0.035 : 0.05));
    }
    // a ruler's monument: a great hall, a temple or a palace in the capital (Bronze Age)
    if (t.age >= 2 && t.gov.ruler !== null && v.stage !== "band" && v.stage !== "camp") {
      const ruler = w.agents.find((a) => a.id === t.gov.ruler);
      if (ruler && ruler.village === v.id && v.monument < 1) {
        const m: Res = v.stock.brick > 5 ? "brick" : v.stock.stone > 5 ? "stone" : "wood";
        const used = take(v, m, builders * 0.15);
        const before = v.monument;
        v.monument = Math.min(1, v.monument + used * 0.006);
        if (before < 1 && v.monument >= 1) {
          t.gov.legitimacy = Math.min(1, t.gov.legitimacy + 0.15);
          chron(w, "politics", `${ruler.name} finishes a great ${t.gov.type === "priestking" ? "temple" : "hall"} at ${v.name}. The people are awed.`, v.x, v.y);
        }
      }
    }
  }

  // forests regrow
  for (const id of Object.keys(w.deposits) as (keyof World["deposits"])[]) {
    const d = w.deposits[id], b = w.depositBase[id];
    d.wood = Math.min(b.wood, d.wood + (b.wood - d.wood) * 0.004 + 0.0003);
  }

  // villages of one tribe on one island share their stores
  // roads and carts move stores between a tribe's villages faster
  const groups = new Map<string, Village[]>();
  for (const v of living(w)) { const k = v.tribe + ":" + v.isle; groups.set(k, [...(groups.get(k) ?? []), v]); }
  for (const vs of groups.values()) {
    if (vs.length < 2) continue;
    for (const r of RES) {
      const mean = vs.reduce((s, v) => s + v.stock[r], 0) / vs.length;
      const T = w.tribes[vs[0].tribe];
      const rate = has(T, "railway") ? 0.35 : has(T, "roads") ? 0.22 : has(T, "wheel") ? 0.13 : 0.08;
      for (const v of vs) v.stock[r] += (mean - v.stock[r]) * rate;
    }
  }

  // trade along routes: surplus flows to where it is scarce; tribute flows to overlords
  for (const r of w.routes) {
    const a = villageById(w, r.a), b = villageById(w, r.b);
    if (!a || !b || a.lost || b.lost) continue;
    const rel = a.tribe === b.tribe ? null : relation(w, a.tribe, b.tribe);
    if (rel && (rel.war || rel.attitude < -0.2)) continue;
    let moved = 0;
    for (const res of RES) {
      const [hi, lo] = a.stock[res] > b.stock[res] ? [a, b] : [b, a];
      if (hi.stock[res] < 12 || lo.stock[res] > hi.stock[res] * 0.5) continue;
      const coin = has(w.tribes[a.tribe], "coinage") || has(w.tribes[b.tribe], "coinage") ? 1.5 : 1;
      const amt = Math.min(4 * coin, (hi.stock[res] - lo.stock[res]) * 0.15 * coin) * r.strength;
      hi.stock[res] -= amt; lo.stock[res] += amt; moved += amt;
    }
    if (rel && moved > 2) { rel.trades++; rel.attitude = Math.min(1, rel.attitude + 0.002); }
  }
  for (const rel of w.relations) {
    if (rel.overlord === null) continue;
    const vassal = rel.overlord === rel.a ? rel.b : rel.a;
    const lordCap = living(w).filter((v) => v.tribe === rel.overlord).sort((x, y) => popOf(y) - popOf(x))[0];
    if (!lordCap) continue;
    for (const v of living(w)) if (v.tribe === vassal) for (const res of RES) {
      const amt = v.stock[res] * (has(w.tribes[rel.overlord], "coinage") ? 0.05 : 0.04);
      v.stock[res] -= amt; lordCap.stock[res] += amt;
    }
  }
  void rng;
  return w;
}
