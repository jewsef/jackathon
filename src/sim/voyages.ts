import type { World, Voyage, Village, Tribe } from "./types";
import type { Rng } from "./rng";
import { getTerrain, ISLE_IDS, isOuter, type IsleId } from "./terrain";
import { living, popOf, chron, relation, boatTier, has, agentsOf, makeName, remember, villageById, kill, takeAdults, addPeople } from "./util";
import { freeSite, newVillage, newAgent } from "./world";
import { effectAt } from "./climate";
import { seaDesire } from "./society";

const BOAT = ["log", "raft", "dugout canoe", "outrigger", "sail-canoe", "star-guided sail-canoe", "ocean ship"];
const SPEED = [0.45, 0.6, 0.85, 1.1, 1.5, 1.8, 2.6];

export function addRoute(w: World, a: number, b: number, kind: "trade" | "marriage" | "kin", tier: number) {
  const r = w.routes.find((x) => (x.a === a && x.b === b) || (x.a === b && x.b === a));
  if (r) { r.strength = Math.min(1, r.strength + 0.25); if (kind === "marriage") r.kind = "marriage"; return r; }
  const nr = { id: w.nextId++, a, b, kind, strength: 0.4, tier };
  w.routes.push(nr);
  return nr;
}

export function voyagePos(v: Voyage): [number, number] {
  const p = v.leg === "out" ? v.progress : 1 - v.progress;
  return [v.fx + (v.tx - v.fx) * p, v.fy + (v.ty - v.fy) * p];
}

function crossTier(w: World, a: IsleId, b: IsleId) { return a === b ? 0 : getTerrain(w.seed).crossing(a, b).tier; }

function launch(w: World, t: Tribe, v: Village, target: IsleId, purpose: Voyage["purpose"], rng: Rng) {
  const terrain = getTerrain(w.seed);
  const c = terrain.crossing(v.isle, target);
  const tv = living(w).filter((x) => x.isle === target && x.tribe !== t.id && x.coastal).sort((a, b) => Math.hypot(a.x - c.bx, a.y - c.by) - Math.hypot(b.x - c.bx, b.y - c.by))[0] ?? null;
  const own = living(w).filter((x) => x.isle === target && x.tribe === t.id)[0];
  const dest = purpose === "drift" ? null : tv ?? own ?? null;
  const tx = dest ? dest.px : c.bx, ty = dest ? dest.py : c.by;
  const want = Math.min(v.men - 2, purpose === "colony" ? 4 + rng.int(4) : purpose === "drift" ? 2 : 2 + rng.int(3));
  if (want < 1) return;
  const crew = takeAdults(v, "m", want, rng);
  let settlers = 0;
  if (purpose === "colony") settlers = takeAdults(v, "m", Math.round(v.men * 0.1), rng) + takeAdults(v, "f", Math.round(v.women * 0.12), rng);
  const tier = purpose === "drift" ? Math.max(1, Math.min(2, boatTier(t))) : boatTier(t);
  const voy: Voyage = {
    id: w.nextId++, tribe: t.id, from: v.id, fx: v.px, fy: v.py, tx, ty, target, targetVillage: dest ? dest.id : null,
    purpose, crew, tier, dist: Math.max(0.3, Math.hypot(tx - v.px, ty - v.py)), progress: 0, leg: "out", found: false,
    captain: null, sick: v.sick ? v.sick.strain : null, settlers
  };
  if ((tier >= 3 || target === "far") && purpose !== "drift") {
    const cap = newAgent(w, { name: makeName(rng, t), sex: rng.chance(0.6) ? "m" : "f", role: "Captain", village: v.id, tribe: t.id, age: rng.range(24, 42), goal: "Bring the crew home alive." }, rng);
    voy.captain = cap.id;
  }
  w.voyages.push(voy);
  const isleName = terrain.byId[target].name, known = t.known.includes(target);
  const what = { explore: known ? `to explore ${isleName}` : "toward land no one has seen", trade: `to trade with ${isleName}`, marriage: `to find partners on ${isleName}`, colony: `with ${settlers} settlers bound for ${isleName}`, drift: "", raid: `to raid ${isleName}` }[purpose];
  if (purpose !== "drift") chron(w, "voyage", `A ${BOAT[tier]} leaves ${v.name} ${what}, ${crew} aboard.`, v.px, v.py);
}

function contact(w: World, voy: Voyage, tv: Village, rng: Rng) {
  const t = w.tribes[voy.tribe], o = w.tribes[tv.tribe], r = relation(w, t.id, o.id);
  const from = villageById(w, voy.from);
  if (!r.met) {
    r.met = true; r.metTick = w.tick;
    const home = from?.isle ?? t.home;
    if (!o.known.includes(home)) o.known.push(home);
    chron(w, "contact", `First contact: voyagers of the ${t.name} meet the ${o.name} at ${tv.name}.`, tv.x, tv.y);
    remember(t, `Y${Math.floor(w.tick / 4)}: met the ${o.name}`); remember(o, `Y${Math.floor(w.tick / 4)}: strangers came from the sea`);
    w.fx.push({ kind: "found", x: tv.x, y: tv.y, tick: w.tick });
  }
  if (from) w.contacts.push({ a: from.id, b: tv.id, via: "the voyagers" });
  if (r.war) {
    const d = kill(tv, rng.binom(4, 0.3), rng, "men"); voy.crew = Math.max(0, voy.crew - rng.int(3));
    chron(w, "war", `${o.name} warriors attack the boat at ${tv.name}${d ? `; ${d} of them fall` : ""}.`, tv.x, tv.y);
    return;
  }
  const misunderstand = !r.speaker && rng.chance(0.12 + o.traits.wary * 0.25 - (voy.purpose === "trade" ? 0.05 : 0));
  if (misunderstand) {
    r.attitude -= 0.25; r.grudge = Math.min(1, r.grudge + 0.2);
    const lost = Math.min(voy.crew, 1 + rng.int(2)); voy.crew -= lost;
    chron(w, "contact", `At ${tv.name} a gift is taken as an insult. Spears fly and ${lost} voyager${lost > 1 ? "s die" : " dies"}.`, tv.x, tv.y);
    return;
  }
  r.attitude = Math.min(1, r.attitude + 0.1);
  if (voy.purpose === "marriage" && from && r.attitude > -0.2 && voy.crew > 1) {
    r.marriages++;
    voy.crew--; addPeople(tv, "m", 1, 24);
    if (tv.women > 2 && takeAdults(tv, "f", 1, rng)) voy.settlers++;
    for (const [a, b] of [[from, tv], [tv, from]] as [Village, Village][]) {
      for (const k of Object.keys(b.blood)) a.blood[k] = (a.blood[k] ?? 0) + b.blood[k] * 0.06;
      const sum = Object.values(a.blood).reduce((s, x) => s + x, 0);
      for (const k of Object.keys(a.blood)) a.blood[k] /= sum;
      a.kin = Math.max(0, a.kin - 0.1);
    }
    addRoute(w, from.id, tv.id, "marriage", voy.tier);
    chron(w, "contact", `A ${t.name} voyager marries into ${tv.name}. A bride of the ${o.name} sails home to ${from.name}.`, tv.x, tv.y);
  } else if (from) {
    r.trades++;
    from.food += 6; tv.food += 6;
    addRoute(w, from.id, tv.id, "trade", voy.tier);
    if (voy.purpose === "trade") chron(w, "contact", `${from.name} trades with ${tv.name}: ${getTerrain(w.seed).byId[from.isle].resource} for ${getTerrain(w.seed).byId[tv.isle].resource}.`, tv.x, tv.y);
  }
}

function arrive(w: World, voy: Voyage, rng: Rng) {
  const t = w.tribes[voy.tribe], terrain = getTerrain(w.seed), isleName = terrain.byId[voy.target].name;
  voy.found = true;
  if (voy.purpose === "drift") {
    if (!rng.chance(0.55)) {
      chron(w, "voyage", `A fishing canoe of the ${t.name} is blown out to sea and never seen again.`, voy.tx, voy.ty);
      voy.crew = 0; return "lost";
    }
    chron(w, "voyage", `A fishing canoe of the ${t.name}, blown off course, washes up on ${isleName}.`, voy.tx, voy.ty);
  }
  const others = living(w).filter((x) => x.isle === voy.target && x.tribe !== t.id).sort((a, b) => Math.hypot(a.x - voy.tx, a.y - voy.ty) - Math.hypot(b.x - voy.tx, b.y - voy.ty));
  if (others.length && Math.hypot(others[0].x - voy.tx, others[0].y - voy.ty) < 2.5) contact(w, voy, others[0], rng);
  else if (!t.known.includes(voy.target) && voy.purpose !== "drift") chron(w, "voyage", `Voyagers of the ${t.name} step onto ${isleName}. No one lives where they land.`, voy.tx, voy.ty);
  if (voy.purpose === "colony") {
    const site = freeSite(w, voy.target, { x: voy.tx, y: voy.ty });
    if (site) {
      const nv = newVillage(w, t, site, voy.target === "far" ? "Newlight" : makeName(rng, t) + "haven");
      addPeople(nv, "m", voy.crew + Math.ceil(voy.settlers / 2), 26); addPeople(nv, "f", Math.floor(voy.settlers / 2), 24); nv.food = 20; nv.houses = 2;
      const from = villageById(w, voy.from);
      if (from) { nv.blood = { ...from.blood }; nv.kin = from.kin; addRoute(w, from.id, nv.id, "kin", voy.tier); }
      if (!t.known.includes(voy.target)) t.known.push(voy.target);
      chron(w, "village", `${popOf(nv)} settlers of the ${t.name} found ${nv.name} on ${isleName}.`, nv.x, nv.y);
      const cap = voy.captain ? w.agents.find((a) => a.id === voy.captain) : null;
      if (cap) { cap.village = nv.id; cap.role = "Leader"; remember(cap, `Founded ${nv.name}`); }
      return "settled";
    }
  }
  voy.leg = "back"; voy.progress = 0;
  return "back";
}

/** Boats: launching, sailing, losses at sea, discovery, contact and colonies. */
export function voyages(w: World, rng: Rng): World {
  const terrain = getTerrain(w.seed);
  for (const t of w.tribes) {
    if (!t.alive) continue;
    const tier = boatTier(t);
    const ports = living(w).filter((v) => v.tribe === t.id && v.coastal && v.stage !== "band" && v.men >= 3);
    const active = w.voyages.filter((x) => x.tribe === t.id && x.purpose !== "drift").length;
    // fishing boats blown off course by your wind or storms: the accidental discovery
    for (const v of living(w).filter((x) => x.tribe === t.id && x.coastal && x.men >= 5 && x.stage !== "band" && x.jobs.fisher > 0.1)) {
      const push = effectAt(w, "wind", v.x, v.y) * 0.035 + effectAt(w, "storm", v.x, v.y) * 0.05;
      if (push > 0 && rng.chance(push)) {
        const east = ISLE_IDS.filter((i) => i !== v.isle && isOuter(i) === isOuter(v.isle) && terrain.byId[i].cx > v.x).sort((a, b) => Math.abs(terrain.byId[a].cy - v.y) - Math.abs(terrain.byId[b].cy - v.y) + (terrain.byId[a].cx - terrain.byId[b].cx) * 0.3)[0];
        if (east) launch(w, t, v, east, "drift", rng);
        break;
      }
    }
    if (tier === 0 || !ports.length || active >= Math.max(1, Math.ceil(ports.length / 2))) continue;
    const v = ports.sort((a, b) => popOf(b) - popOf(a))[0];
    const fear = t.belief.fear * 0.5;
    const isles = new Set(living(w).filter((x) => x.tribe === t.id).map((x) => x.isle));
    const reach = (i: IsleId, slack = 0) => Math.min(...[...isles].map((h) => crossTier(w, h, i))) <= tier + slack;
    const kinP = Math.max(0, v.kin - 0.25) * 2.2;
    const crowd = (v.hungry > 0 ? 0.3 : 0) + popOf(v) / 400;
    const curious = t.traits.curious * 0.35 + t.drivers.omenVoyage * 0.25;
    const options: { p: Voyage["purpose"]; i: IsleId; d: number }[] = [];
    for (const i of ISLE_IDS) {
      if (isles.has(i) && i === v.isle) continue;
      const known = t.known.includes(i);
      const people = living(w).filter((x) => x.isle === i && x.tribe !== t.id);
      if (!known && reach(i, isOuter(i) !== isOuter(v.isle) ? 0 : 1)) options.push({ p: "explore", i, d: curious + crowd * 0.5 + kinP * 0.4 });
      if (known && reach(i)) {
        if (people.length) {
          const r = relation(w, t.id, people[0].tribe);
          if (!r.war) options.push({ p: "marriage", i, d: kinP + (r.met ? 0.1 : 0) });
          if (r.met && r.attitude > -0.1 && !r.war) options.push({ p: "trade", i, d: 0.15 + t.traits.bold * 0.15 });
        }
        if (freeSite(w, i) && (has(t, "fleet") || (tier >= 2 && crowd > 0.5)) && !people.some((x) => relation(w, t.id, x.tribe).war))
          options.push({ p: "colony", i, d: crowd * 0.6 + (has(t, "fleet") ? 0.45 : 0) });
      }
    }
    if (!options.length) continue;
    options.sort((a, b) => b.d - a.d);
    const best = options[0];
    if (rng.chance(0.07 * best.d * (1 - fear) * (0.6 + seaDesire(t, v)))) {
      launch(w, t, v, best.i, best.p, rng);
      t.drivers.omenVoyage *= 0.5;
    }
  }

  const keep: Voyage[] = [];
  for (const voy of w.voyages) {
    const t = w.tribes[voy.tribe];
    const [x, y] = voyagePos(voy);
    const heading = voy.leg === "out" ? voy.tx - voy.fx : voy.fx - voy.tx;
    const wind = effectAt(w, "wind", x, y), storm = effectAt(w, "storm", x, y) > 0.2 || (voy as any).doomed;
    const speed = SPEED[voy.tier] * (has(t, "compass") ? 1.1 : 1) * (heading > 0 ? 1 + wind * 0.6 : 1 - wind * 0.3) * (storm ? 0.6 : 1);
    voy.progress += speed / voy.dist;
    const from = villageById(w, voy.from);
    const req = from ? crossTier(w, from.isle, voy.target) : 2;
    let risk = 0.008 + Math.max(0, req - voy.tier) * 0.12;
    if (storm) risk += voy.tier >= 3 ? 0.12 : 0.35;
    if ((voy as any).doomed) risk += 0.5;
    if (effectAt(w, "calm", x, y) > 0.3) risk *= 0.4;
    if (voy.captain) risk *= 0.8;
    if (voy.target === "far" && has(t, "navigation")) risk *= 0.6;
    if (has(t, "lighthouse")) risk *= 0.75;
    if (has(t, "compass")) risk *= 0.8;
    if (voy.purpose === "drift") risk *= 0.5;
    if (rng.chance(risk) || voy.crew <= 0) {
      if (voy.tier <= 1) t.drivers.raftLoss++; else t.drivers.capsize++;
      t.belief.fear = Math.min(1, t.belief.fear + 0.03);
      w.fx.push({ kind: "lost", x, y, tick: w.tick });
      if (voy.purpose !== "drift") chron(w, "voyage", `The ${BOAT[voy.tier]} from ${from?.name ?? "home"} is lost at sea${storm ? " in the storm" : ""}. ${voy.crew + voy.settlers} drown.`, x, y);
      const cap = voy.captain ? w.agents.find((a) => a.id === voy.captain) : null;
      if (cap && cap.alive) { cap.alive = false; cap.died = w.tick; }
      continue;
    }
    if (voy.progress >= 1) {
      if (voy.leg === "out") {
        const res = arrive(w, voy, rng);
        if (res === "lost" || res === "settled") continue;
      } else {
        if (from && !from.lost) { addPeople(from, "m", voy.crew, 30); addPeople(from, "f", voy.settlers, 24); }
        const isleName = terrain.byId[voy.target].name;
        if (voy.found && !t.known.includes(voy.target)) {
          t.known.push(voy.target);
          chron(w, "voyage", `The voyagers return to ${from?.name ?? "home"} with news: there is land at ${isleName}.`, voy.fx, voy.fy);
          if (voy.target === "far") t.drivers.farReturn++;
          w.fx.push({ kind: "found", x: voy.fx, y: voy.fy, tick: w.tick });
        }
        const cap = voy.captain ? w.agents.find((a) => a.id === voy.captain) : null;
        if (cap) { cap.role = "Voyager"; remember(cap, `Sailed to ${isleName} and back`); }
        continue;
      }
    }
    keep.push(voy);
  }
  w.voyages = keep;
  return w;
}

export const _voy = { agentsOf };
