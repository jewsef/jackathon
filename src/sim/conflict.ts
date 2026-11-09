import type { World, Tribe, Village } from "./types";
import type { Rng } from "./rng";
import { getTerrain } from "./terrain";
import { living, popOf, kill, chron, relation, workers, weaponTier, boatTier, agentsOf, makeName, remember, has } from "./util";
import { newAgent } from "./world";

/** Pairs of villages (attacker, defender) that can reach each other by land or by boat. */
export function reachablePairs(w: World, a: Tribe, b: Tribe): [Village, Village][] {
  const t = getTerrain(w.seed), tier = boatTier(a), out: [Village, Village][] = [];
  const av = living(w).filter((v) => v.tribe === a.id), bv = living(w).filter((v) => v.tribe === b.id);
  for (const x of av) for (const y of bv) {
    if (x.isle === y.isle || (x.coastal && y.coastal && tier >= t.crossing(x.isle, y.isle).tier)) out.push([x, y]);
  }
  return out;
}

function battle(w: World, att: Tribe, def: Tribe, rng: Rng) {
  const pairs = reachablePairs(w, att, def);
  if (!pairs.length) return;
  pairs.sort((p, q) => (p[0].isle === p[1].isle ? 0 : 1) - (q[0].isle === q[1].isle ? 0 : 1) || popOf(q[0]) - popOf(p[0]));
  const [ov, tv] = pairs[rng.int(Math.min(2, pairs.length))];
  const r = relation(w, att.id, def.id);
  const fleet = ov.isle !== tv.isle && has(att, "galley") ? 1.25 : 1;
  const aStr = (workers(ov, "warrior") + ov.men * 0.15) * (1 + 0.35 * weaponTier(att)) * fleet + 0.5;
  const walls = 0.35 * Math.floor(tv.defense) * (has(att, "siegecraft") ? 0.5 : 1);
  const dStr = (workers(tv, "warrior") + tv.men * 0.3) * (1 + 0.35 * weaponTier(def)) * (1 + walls) + 0.5;
  const ratio = aStr / dStr;
  const aLoss = kill(ov, rng.binom(Math.round(aStr), Math.min(0.4, Math.max(0.02, 0.12 / ratio))), rng, "men");
  const dLoss = kill(tv, rng.binom(Math.round(dStr), Math.min(0.4, Math.max(0.02, 0.12 * ratio))), rng, "men");
  r.losses += aLoss + dLoss; att.drivers.raids++; def.drivers.raids++;
  w.fx.push({ kind: "battle", x: tv.x, y: tv.y, tick: w.tick });
  w.contacts.push({ a: ov.id, b: tv.id, via: "the raiders" });
  if (ratio > 2.8 && ov.isle === tv.isle && popOf(tv) < popOf(ov) * 0.8) {
    tv.tribe = att.id;
    chron(w, "war", `Warriors of ${ov.name} take ${tv.name}. It now answers to the ${att.name}.`, tv.x, tv.y);
    remember(def, `Y${Math.floor(w.tick / 4)}: ${tv.name} was taken by the ${att.name}`);
  } else if (ratio > 1.6) {
    const stolen = tv.food * 0.5;
    tv.food -= stolen; ov.food += stolen; tv.houses = Math.max(1, tv.houses * 0.65);
    chron(w, "war", `Raiders from ${ov.name} burn ${tv.name}. ${dLoss} defenders and ${aLoss} raiders die.`, tv.x, tv.y);
    r.grudge = Math.min(1, r.grudge + 0.15);
  } else {
    chron(w, "war", `${tv.name} drives off raiders from ${ov.name}. ${aLoss} raiders and ${dLoss} defenders die.`, tv.x, tv.y);
  }
}

/** Relations between tribes: attitude, grudges, raids, wars, truces and alliances. */
export function conflict(w: World, rng: Rng): World {
  for (const r of w.relations) {
    const A = w.tribes[r.a], B = w.tribes[r.b];
    if (!r.met || !A.alive || !B.alive) continue;
    const ra = w.routes.filter((x) => {
      const va = w.villages.find((v) => v.id === x.a), vb = w.villages.find((v) => v.id === x.b);
      return va && vb && ((va.tribe === A.id && vb.tribe === B.id) || (va.tribe === B.id && vb.tribe === A.id));
    }).reduce((s, x) => s + x.strength, 0);
    r.attitude = Math.max(-1, Math.min(1, r.attitude + 0.015 * ra - 0.012 * r.grudge + (r.alliance ? 0.01 : 0) - (r.war ? 0.01 : 0)));
    r.grudge *= 0.995;
    if (!r.war) {
      const reach = reachablePairs(w, A, B).length > 0 || reachablePairs(w, B, A).length > 0;
      if (!reach) continue;
      const ambition = Math.max(0, ...agentsOf(w, (a) => (a.tribe === A.id || a.tribe === B.id) && a.role === "Leader").map((a) => a.ambition));
      const hungry = living(w).some((v) => (v.tribe === A.id || v.tribe === B.id) && v.hungry >= 2);
      let p = 0;
      if (r.attitude < -0.4) p += 0.04;
      if (r.grudge > 0.6) p += 0.02;
      if (hungry && r.attitude < 0.15) p += 0.03;
      p *= 0.5 + ambition * (0.5 + Math.max(A.traits.bold, B.traits.bold));
      const regimeMul = (x: typeof A) => ({ warlord: 1.6, chief: 1.1, priestking: 0.9, council: 0.6, elders: 0.8 } as Record<string, number>)[x.gov?.type ?? "elders"] ?? 1;
      p *= Math.max(regimeMul(A), regimeMul(B));
      if (A.objective?.tribe === B.id || B.objective?.tribe === A.id) p *= 1.5;
      if (r.overlord !== null) p *= 0.3;
      if (r.alliance) p *= 0.1;
      if (r.marriages > 2) p *= 0.5;
      if (rng.chance(p)) {
        r.war = true; r.warTicks = 0; r.losses = 0;
        const aggressor = A.traits.bold + rng.next() * 0.3 > B.traits.bold + rng.next() * 0.3 ? A : B;
        const other = aggressor === A ? B : A;
        const home = living(w).filter((v) => v.tribe === aggressor.id).sort((x, y) => popOf(y) - popOf(x))[0];
        if (home) newAgent(w, { name: makeName(rng, aggressor), sex: rng.chance(0.7) ? "m" : "f", role: "War leader", village: home.id, tribe: aggressor.id, age: rng.range(24, 40), ambition: 0.8, goal: `Break the ${other.name} before they break us.` }, rng);
        chron(w, "war", `War: the ${aggressor.name} take up arms against the ${other.name}${hungry ? " over food" : r.grudge > 0.5 ? " over an old grudge" : ""}.`, home?.x, home?.y);
        remember(A, `Y${Math.floor(w.tick / 4)}: war with the ${B.name}`); remember(B, `Y${Math.floor(w.tick / 4)}: war with the ${A.name}`);
      }
    } else {
      r.warTicks++;
      if (rng.chance(0.45)) {
        const attFirst = A.traits.bold + rng.next() * 0.4 > B.traits.bold + rng.next() * 0.4;
        battle(w, attFirst ? A : B, attFirst ? B : A, rng);
      }
      if (rng.chance(0.004 * r.warTicks + (r.losses > 40 ? 0.03 : 0) + (r.marriages > 0 ? 0.01 : 0))) {
        r.war = false; r.attitude = -0.15; r.warTicks = 0;
        chron(w, "war", `The ${A.name} and the ${B.name} make a truce. The dead are counted: ${r.losses}.`);
        for (const a of agentsOf(w, (x) => x.role === "War leader" && (x.tribe === A.id || x.tribe === B.id))) a.role = "Veteran";
      }
    }
    if (!r.alliance && !r.war && r.attitude > 0.6 && r.marriages >= 2) {
      r.alliance = true;
      chron(w, "contact", `The ${A.name} and the ${B.name} swear an alliance, sealed by marriages.`);
    }
  }
  return w;
}
