import type { World, Tribe, Job, Ending } from "./types";
import { JOBS, yearOf } from "./types";
import type { Rng } from "./rng";
import { living, popOf, chron, has, TECHS, TECH, tribePop, agentsOf, villageById, remember, relation, makeName, tribeStock } from "./util";
import type { Res } from "./types";
import agesData from "../../data/ages.json";
const AGES = agesData as { id: number; name: string; requires: string[]; desc: string }[];
import { newAgent } from "./world";

function shares(w: World, t: Tribe): Record<Job, number> {
  const out = Object.fromEntries(JOBS.map((j) => [j, 0])) as Record<Job, number>;
  let total = 0;
  for (const v of living(w)) if (v.tribe === t.id) { const p = popOf(v); total += p; for (const j of JOBS) out[j] += v.jobs[j] * p; }
  for (const j of JOBS) out[j] /= total || 1;
  return out;
}

/** Per-season progress toward a tech. Adversity and your weather push these. */
function drive(w: World, t: Tribe, id: string, sh: Record<Job, number>, pop: number): number {
  const d = t.drivers, coastal = living(w).some((v) => v.tribe === t.id && v.coastal);
  const threat = living(w).filter((v) => v.tribe === t.id).reduce((m, v) => Math.max(m, v.threat), 0);
  const war = w.relations.some((r) => r.war && (r.a === t.id || r.b === t.id));
  const kin = Math.max(0, ...living(w).filter((v) => v.tribe === t.id).map((v) => v.kin));
  const rainHome = w.climate[t.home].rain > 1.3 ? 1 : 0;
  const nav = agentsOf(w, (a) => a.tribe === t.id && a.role === "Navigator").length;
  switch (id) {
    case "farming": return pop >= 6 ? 0.006 + sh.gatherer * 0.01 + (d.hunger > 0.5 ? 0.008 : 0) : 0;
    case "stonetools": return pop >= 4 ? 0.008 + sh.gatherer * 0.008 + sh.miner * 0.04 : 0;
    case "weaving": return 0.004 + sh.gatherer * 0.004 + sh.boatwright * 0.02;
    case "pottery": return 0.003 + (has(t, "farming") ? 0.004 : 0) + sh.quarrier * 0.03;
    case "salting": return coastal ? 0.004 + sh.fisher * 0.015 : 0;
    case "masonry": return 0.002 + sh.quarrier * 0.05 + threat * 0.004;
    case "brickmaking": return 0.002 + sh.quarrier * 0.04 + sh.builder * 0.02;
    case "copperworking": return 0.003 + sh.miner * 0.06;
    case "bronze": return 0.002 + sh.miner * 0.03 + sh.smith * 0.05;
    case "writing": return 0.001 + sh.priest * 0.03 + Math.min(0.006, d.raids * 0.0005 + t.known.length * 0.0008);
    case "granary": return 0.004 + sh.builder * 0.05 + (d.hunger > 0.5 ? 0.005 : 0);
    case "raft": return coastal && pop >= 8 ? 0.004 + sh.fisher * 0.02 + Math.min(1, d.hunger) * 0.003 + kin * 0.01 : 0;
    case "canoe": return 0.002 + d.raftLoss * 0.01 + sh.boatwright * 0.04 + rainHome * 0.002;
    case "outrigger": return 0.0015 + d.capsize * 0.012 + sh.boatwright * 0.03;
    case "sail": return 0.001 + d.windSeasons * 0.0025 + sh.boatwright * 0.025;
    case "navigation": return 0.0006 + d.calmSeasons * 0.0016 + sh.priest * 0.02 + nav * 0.006;
    case "fleet": return t.known.includes("far") ? 0.002 + d.farReturn * 0.03 : 0;
    case "herbs": return 0.0008 + sh.doctor * 0.02 + d.plagueSurvived * 0.05;
    case "quarantine": return d.plagueSurvived > 0 ? 0.02 * d.plagueSurvived : 0;
    case "bow": return threat * 0.02 + d.raids * 0.004;
    case "palisade": return threat * 0.025;
    case "shields": return war ? 0.012 : 0;
    case "warcanoe": return war ? 0.01 : threat * 0.004;
    case "stonefort": return war && w.relations.some((r) => r.war && r.warTicks > 12 && (r.a === t.id || r.b === t.id)) ? 0.008 : 0;
  }
  return 0;
}

const INVENTOR: Record<string, string> = { raft: "Boatwright", canoe: "Boatwright", outrigger: "Boatwright", sail: "Boatwright", herbs: "Doctor", stonetools: "Toolmaker", bronze: "Smith", copperworking: "Smith", masonry: "Master builder", brickmaking: "Master builder", writing: "Scribe" };

/**
 * Inventions need the right materials in the tribe's stores. Missing materials slow research;
 * for strict techs (bronze) they make it impossible. This is what makes islands advance differently.
 */
export function resourceFactor(w: World, t: Tribe, tech: { needs?: Record<string, number>; strict?: boolean }): number {
  if (!tech.needs) return 1;
  let f = 1;
  for (const [r, amt] of Object.entries(tech.needs)) {
    const have = tribeStock(w, t.id, r as Res);
    f = Math.min(f, tech.strict ? (have >= amt ? 1 : 0) : 0.15 + 0.85 * Math.min(1, have / amt));
  }
  return f;
}

/** The highest age whose required inventions the tribe has. */
export function ageOf(t: Tribe): number {
  let a = 0;
  for (const age of AGES) if (age.requires.every((r) => has(t, r))) a = Math.max(a, age.id);
  return a;
}

function checkEndings(w: World) {
  const done = (id: Ending["id"]) => w.endings.some((e) => e.id === id);
  const add = (e: Omit<Ending, "tick">) => { w.endings.push({ ...e, tick: w.tick }); chron(w, "end", e.title + ". " + e.text); };
  const alive = w.tribes.filter((t) => t.alive);
  if (!done("silence") && living(w).length === 0)
    add({ id: "silence", title: "Silence", text: "No fire burns on any island. The sky has no one left to watch." });
  if (!done("farshore")) {
    const far = w.tribes.find((t) => t.home === "far");
    const reached = living(w).some((v) => v.isle === "far" && w.tribes[v.tribe].home !== "far") ||
      w.relations.some((r) => r.met && far && (r.a === far.id || r.b === far.id) && w.tribes[r.a === far.id ? r.b : r.a].home !== "far");
    if (reached) add({ id: "farshore", title: "Beyond the horizon", text: "The near islands and the Far Shore have found each other. The civilization has crossed the deep sea." });
  }
  if (!done("unity") && alive.length > 1) {
    const ok = alive.every((a) => alive.every((b) => a === b || (() => { const r = relation(w, a.id, b.id); return r.met && (r.alliance || r.attitude > 0.5); })()));
    if (ok) add({ id: "unity", title: "One people", text: "Every living tribe is bound to every other by marriage and trust." });
  }
  if (!done("longage") && yearOf(w.tick) >= 1000) add({ id: "longage", title: "The long age", text: "A thousand years have passed under your sky." });
}

/** Tech, belief, memory, faith and divine energy. Ideas travel along routes. */
export function culture(w: World, rng: Rng): World {
  for (const t of w.tribes) {
    if (!t.alive) continue;
    const pop = tribePop(w, t.id);
    if (pop === 0) {
      t.alive = false;
      chron(w, "death", `The last of the ${t.name} are gone. Their fires are cold.`);
      continue;
    }
    const sh = shares(w, t);
    for (const tech of TECHS) {
      if (has(t, tech.id) || !tech.prereq.every((p) => has(t, p))) continue;
      const trait = tech.group === "sea" ? 0.7 + t.traits.curious * 0.3 + t.traits.bold * 0.3 : tech.group === "war" ? 0.7 + t.traits.wary * 0.3 + t.traits.bold * 0.3 : 0.8 + t.traits.patient * 0.4;
      t.progress[tech.id] = (t.progress[tech.id] ?? 0) + drive(w, t, tech.id, sh, pop) * trait * resourceFactor(w, t, tech);
      if (t.progress[tech.id] >= 1) {
        t.techs.push(tech.id);
        const v = living(w).filter((x) => x.tribe === t.id).sort((a, b) => popOf(b) - popOf(a))[0];
        const role = INVENTOR[tech.id];
        let who = `The ${t.name}`;
        if (role && v) {
          const a = newAgent(w, { name: makeName(rng, t), sex: rng.chance(0.5) ? "m" : "f", role, village: v.id, tribe: t.id, age: rng.range(22, 45), goal: "" }, rng);
          remember(a, `First of the ${t.name} to make: ${tech.name.toLowerCase()}`);
          who = `${a.name} of ${v.name}`;
        }
        chron(w, "tech", `${who} ${role ? "invents" : "learn"}: ${tech.name}. ${tech.desc}`, v?.x, v?.y);
        remember(t, `Y${yearOf(w.tick)}: learned ${tech.name.toLowerCase()}`);
      }
    }
    const newAge = ageOf(t);
    if (newAge > t.age) {
      t.age = newAge;
      const v = living(w).filter((x) => x.tribe === t.id).sort((a, b) => popOf(b) - popOf(a))[0];
      chron(w, "age", `The ${t.name} enter the ${AGES[newAge].name}. ${AGES[newAge].desc}`, v?.x, v?.y);
      if (v) w.fx.push({ kind: "age", x: v.x, y: v.y, tick: w.tick });
      remember(t, `Y${yearOf(w.tick)}: entered the ${AGES[newAge].name}`);
      t.gov.legitimacy = Math.min(1, t.gov.legitimacy + 0.1);
    }
    const d = t.drivers;
    d.raftLoss *= 0.995; d.capsize *= 0.995; d.windSeasons *= 0.99; d.calmSeasons *= 0.99; d.omenVoyage *= 0.97; d.hunger *= 0.97; d.raids *= 0.98;
    t.belief.fear *= 0.995; t.belief.love *= 0.997; t.belief.awe = Math.max(0.05, t.belief.awe * 0.998);
  }
  // ideas, marriages and kinship flow along routes
  const keep = [];
  for (const r of w.routes) {
    const a = villageById(w, r.a), b = villageById(w, r.b);
    if (!a || !b || a.lost || b.lost) continue;
    const A = w.tribes[a.tribe], B = w.tribes[b.tribe];
    const rel = A.id === B.id ? null : relation(w, A.id, B.id);
    r.strength += rel && (rel.war || rel.attitude < -0.2) ? -0.08 : 0.004;
    r.strength = Math.min(1, r.strength - 0.006);
    if (r.strength <= 0.02) continue;
    if (A.id !== B.id && rng.chance(0.03 * r.strength)) {
      const [src, dst] = rng.chance(0.5) ? [A, B] : [B, A];
      const cand = src.techs.filter((x) => !has(dst, x) && TECH[x].prereq.every((p) => has(dst, p)));
      if (cand.length) {
        const tech = rng.pick(cand);
        dst.techs.push(tech);
        chron(w, "tech", `The ${dst.name} learn ${TECH[tech].name.toLowerCase()} from the ${src.name}.`, (a.x + b.x) / 2, (a.y + b.y) / 2);
      }
    }
    if (r.kind === "marriage") { a.kin = Math.max(0, a.kin - 0.004 * r.strength); b.kin = Math.max(0, b.kin - 0.004 * r.strength); }
    if (rel) rel.attitude = Math.min(1, rel.attitude + 0.004 * r.strength);
    keep.push(r);
  }
  w.routes = keep;
  // faith refills divine energy
  let faith = 0;
  for (const t of w.tribes) {
    if (!t.alive) continue;
    const priests = agentsOf(w, (a) => a.tribe === t.id && a.role === "Sky-speaker").length;
    faith += (tribePop(w, t.id) / 10) * (t.belief.awe * 0.6 + t.belief.love * 0.3 + t.belief.fear * 0.2) * (1 + priests * 0.3);
  }
  w.faith = faith;
  w.energy = Math.min(40, w.energy + 0.3 + Math.min(2.5, faith * 0.01));
  checkEndings(w);
  return w;
}
