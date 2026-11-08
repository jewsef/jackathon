import type { World, Agent, Village, Tribe } from "./types";
import { STAGES } from "./types";
import type { Rng } from "./rng";
import { living, popOf, chron, villageById, agentsOf, makeName, villageName, relation, remember, has, boatTier, movePeople, newGov, newFactions } from "./util";
import { freeSite, newVillage, newAgent } from "./world";
import { STRAINS } from "./powers";
import { getTerrain } from "./terrain";

const MAX_AGENTS = 60;
export const ageOf = (w: World, a: Agent) => Math.floor((w.tick - a.born) / 4);

/** A succession crisis: two heirs, and half the village leaves to found a rival tribe. */
function splinter(w: World, v: Village, rng: Rng) {
  const site = freeSite(w, v.isle, v);
  if (!site) return;
  const parent = w.tribes[v.tribe];
  const nt: Tribe = JSON.parse(JSON.stringify(parent));
  nt.id = w.tribes.length; nt.parent = parent.id; nt.alive = true;
  nt.name = makeName(rng, parent) + " folk";
  nt.home = v.isle; nt.memory = [`Y${Math.floor(w.tick / 4)}: broke away from the ${parent.name}`];
  nt.traits = { ...parent.traits, bold: Math.min(1, parent.traits.bold + 0.15), wary: Math.min(1, parent.traits.wary + 0.1) };
  nt.drivers = { raftLoss: 0, capsize: 0, windSeasons: 0, calmSeasons: 0, plagueSurvived: 0, raids: 0, hunger: 0, omenVoyage: 0, farReturn: 0 };
  w.tribes.push(nt);
  for (const o of w.tribes) if (o.id !== nt.id) { const r = relation(w, nt.id, o.id), pr = relation(w, parent.id, o.id); Object.assign(r, { ...pr, a: Math.min(nt.id, o.id), b: Math.max(nt.id, o.id) }); }
  const r = relation(w, parent.id, nt.id);
  Object.assign(r, { met: true, metTick: w.tick, attitude: -0.35, grudge: 0.3, war: false, warTicks: 0, losses: 0, alliance: false, marriages: 0, trades: 0, speaker: true });
  const nv = newVillage(w, nt, site, villageName(rng, nt));
  const moved = movePeople(v, nv, 0.4, rng);
  nv.food = v.food * 0.4; v.food *= 0.6; nv.blood = { ...v.blood }; nv.kin = v.kin; nv.houses = 3;
  const heir = newAgent(w, { name: makeName(rng, parent), sex: rng.chance(0.5) ? "m" : "f", role: "Chief", village: nv.id, tribe: nt.id, age: rng.range(25, 40), ambition: 0.7 + rng.next() * 0.3 }, rng);
  nt.gov = { ...newGov(w.tick), type: "chief", ruler: heir.id, rulerFaction: "warriors", legitimacy: 0.5 };
  nt.factions = newFactions();
  for (const r of w.relations) if (r.a === nt.id || r.b === nt.id) r.overlord = null;
  chron(w, "village", `Two heirs claim ${v.name}. ${heir.name} leads ${moved} people away to found ${nv.name}, and the ${nt.name} are born.`, nv.x, nv.y);
}

function goalFor(w: World, a: Agent): string {
  const v = villageById(w, a.village), t = w.tribes[a.tribe];
  if (!v) return a.goal;
  const war = w.relations.find((r) => r.war && (r.a === t.id || r.b === t.id));
  const enemy = war ? w.tribes[war.a === t.id ? war.b : war.a].name : "";
  switch (a.role) {
    case "Founder": return popOf(v) < 10 ? "Keep the children fed through the winter." : "Teach the young the old ways.";
    case "Leader":
      if (war) return `Win the war with the ${enemy}.`;
      if (v.hungry > 0) return "Find food before the winter.";
      if (v.kin > 0.35) return "Find partners for the young across the sea.";
      return `Grow ${v.name} into a ${STAGES[Math.min(4, STAGES.indexOf(v.stage) + 1)]}.`;
    case "Sky-speaker": return t.belief.fear > t.belief.love ? "Calm the angry sky with offerings." : "Read the sky's will and tell the people.";
    case "Navigator": return has(t, "navigation") ? "Teach the star roads to the young." : "Count the stars until the way east is clear.";
    case "Captain": return "Bring the crew home alive.";
    case "Doctor": return v.sick ? `Break the ${STRAINS[v.sick.strain].name} in ${v.name}.` : "Gather healing leaves before the sick season.";
    case "War leader": return war ? `Break the ${enemy} before they break us.` : "Keep the warriors ready.";
    case "Speaker": return "Learn the words of the strangers.";
    case "Boatwright": {
      const tier = boatTier(t);
      return tier >= 5 ? "Build ships for the long crossing." : `Build a boat that can cross ${["the reef", "the channel", "rough water", "the open sea", "beyond sight of land"][tier]}.`;
    }
    default: return a.goal || "Live well and be remembered.";
  }
}

/** Named people: aging, death, promotion when the story needs a face, and succession crises. */
export function agents(w: World, rng: Rng): World {
  for (const a of w.agents) {
    if (!a.alive) continue;
    const v = villageById(w, a.village);
    const age = ageOf(w, a);
    let p = age < 45 ? 0.0015 : age < 60 ? 0.008 : age < 72 ? 0.03 : 0.08;
    if (v?.sick) p += STRAINS[v.sick.strain].mort * 0.4;
    const atSea = a.role === "Captain" && w.voyages.some((x) => x.captain === a.id);
    if ((!v || v.lost) && !atSea) p = 1;
    if (rng.chance(p)) {
      a.alive = false; a.died = w.tick;
      const how = v?.lost ? `with ${v.name}` : v?.sick ? `of ${STRAINS[v.sick.strain].name}` : `at ${age}`;
      chron(w, "death", `${a.name} the ${a.role.toLowerCase()} dies ${how}.${a.founder ? " A founder of the " + w.tribes[a.tribe].name + " is gone." : ""}`, v?.x, v?.y);
      remember(w.tribes[a.tribe], `Y${Math.floor(w.tick / 4)}: ${a.name} the ${a.role.toLowerCase()} died`);
      if (w.tribes[a.tribe].gov.ruler === a.id) w.tribes[a.tribe].gov.ruler = null;
      if (a.role === "Leader" && v && !v.lost && popOf(v) > 150 && rng.chance(0.3)) splinter(w, v, rng);
    } else a.goal = goalFor(w, a);
  }
  const alive = () => w.agents.filter((a) => a.alive).length;
  const promote = (v: Village, role: string, extra: Partial<Agent> = {}, ageR: [number, number] = [25, 45]) => {
    if (alive() >= MAX_AGENTS) return null;
    const t = w.tribes[v.tribe];
    const a = newAgent(w, { name: makeName(rng, t), sex: rng.chance(0.5) ? "m" : "f", role, village: v.id, tribe: t.id, age: rng.range(ageR[0], ageR[1]), ...extra }, rng);
    a.goal = goalFor(w, a);
    return a;
  };
  for (const v of living(w)) {
    const s = STAGES.indexOf(v.stage);
    if (s >= 2 && !agentsOf(w, (a) => a.village === v.id && a.role === "Leader").length) {
      const a = promote(v, "Leader", {}, [30, 45]);
      if (a) chron(w, "village", `${a.name} is chosen to lead ${v.name}.`, v.x, v.y);
    }
    if (v.sick && popOf(v) > 40 && !agentsOf(w, (a) => a.village === v.id && a.role === "Doctor").length) {
      const a = promote(v, "Doctor");
      if (a) chron(w, "plague", `${a.name} tends the sick of ${v.name} with leaves and boiled water.`, v.x, v.y);
    }
  }
  for (const t of w.tribes) {
    if (!t.alive) continue;
    const vs = living(w).filter((v) => v.tribe === t.id).sort((a, b) => popOf(b) - popOf(a));
    if (!vs.length) continue;
    const big = vs[0], coastal = vs.find((v) => v.coastal) ?? big;
    if (STAGES.indexOf(big.stage) >= 2 && !agentsOf(w, (a) => a.tribe === t.id && a.role === "Sky-speaker").length) {
      const a = promote(big, "Sky-speaker", {}, [35, 55]);
      if (a) chron(w, "omen", `${a.name} of ${big.name} begins to speak for the sky.`, big.x, big.y);
    }
    if ((t.progress.navigation ?? 0) > 0.3 && !has(t, "navigation") && !agentsOf(w, (a) => a.tribe === t.id && a.role === "Navigator").length) {
      const a = promote(coastal, "Navigator", {}, [30, 50]);
      if (a) chron(w, "voyage", `${a.name} of ${coastal.name} starts counting the stars and watching where the birds fly.`, coastal.x, coastal.y);
    }
  }
  for (const r of w.relations) {
    if (r.met && !r.speaker && w.tick - r.metTick > 8) {
      const t = w.tribes[r.a], v = living(w).find((x) => x.tribe === t.id && x.coastal) ?? living(w).find((x) => x.tribe === t.id);
      if (!v) continue;
      const a = promote(v, "Speaker", {}, [18, 30]);
      r.speaker = true;
      if (a) chron(w, "contact", `${a.name} of ${v.name} learns the words of the ${w.tribes[r.b].name}. Now the two peoples can talk.`, v.x, v.y);
    }
  }
  return w;
}

export const _agentTest = { getTerrain };
