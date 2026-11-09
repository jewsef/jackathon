import type { World, Action, PowerId, Village, BeliefKey } from "./types";
import type { Rng } from "./rng";
import { getTerrain } from "./terrain";
import { living, popOf, kill, chron, tribeOf, agentsOf, relation, remember, rulerOf, TECHS } from "./util";
import { stirRevolt, FACTION_INFO } from "./politics";
import powersData from "../../data/powers.json";
import beliefs from "../../data/beliefs.json";
import strains from "../../data/plague.json";

export const POWERS = powersData as { id: PowerId; name: string; cost: number; radius: number; duration: number; kind: string; desc: string; minAge?: number }[];
/** Late-game powers wake only once some people on earth have reached their age. */
export function powerUnlocked(w: Pick<World, "tribes">, id: PowerId) {
  const p = POWER[id];
  return !p?.minAge || w.tribes.some((t) => t.alive && t.age >= p.minAge!);
}
export const POWER = Object.fromEntries(POWERS.map((p) => [p.id, p])) as Record<PowerId, (typeof POWERS)[number]>;
export const STRAINS = strains as Record<string, { name: string; mort: number; spread: number; duration: number }>;

export function nearestVillage(w: World, x: number, y: number, maxD = 0.8): Village | null {
  let best: Village | null = null, bd = maxD;
  for (const v of living(w)) { const d = Math.hypot(v.x - x, v.y - y); if (d < bd) { bd = d; best = v; } }
  return best;
}
function within(w: World, x: number, y: number, r: number) { return living(w).filter((v) => Math.hypot(v.x - x, v.y - y) <= r); }

export function shiftBelief(w: World, tribe: number, power: keyof typeof beliefs, mult = 1) {
  const t = w.tribes[tribe], d = (beliefs as Record<string, Record<BeliefKey, number>>)[power];
  const priests = agentsOf(w, (a) => a.tribe === tribe && a.role === "Sky-speaker").length;
  const m = mult * (1 + priests * 0.25);
  for (const k of ["awe", "fear", "love"] as BeliefKey[]) t.belief[k] = Math.max(0, Math.min(1, t.belief[k] + d[k] * m));
}

/** Player edits to sky and ground. Invalid or unaffordable actions are ignored. */
export function applyPowers(w: World, acts: Action[], rng: Rng): World {
  const terrain = getTerrain(w.seed);
  for (const a of acts) {
    const p = POWER[a.power];
    if (!p || w.energy < p.cost || !powerUnlocked(w, a.power)) continue;
    const affected = new Set<number>();
    switch (a.power) {
      case "calm": case "rain": case "wind": case "drought": {
        w.effects.push({ id: w.nextId++, power: a.power, x: a.x, y: a.y, r: p.radius, ticks: p.duration, age: 0 });
        within(w, a.x, a.y, p.radius).forEach((v) => affected.add(v.tribe));
        const where = terrain.isleAt(a.x, a.y);
        const label = { calm: "A great calm settles", rain: "Rain clouds gather", wind: "A steady east wind rises", drought: "The rains stop" }[a.power];
        chron(w, "power", `${label}${where ? " over " + terrain.byId[where].name : " over the open sea"}.`, a.x, a.y);
        break;
      }
      case "storm": {
        w.effects.push({ id: w.nextId++, power: "storm", x: a.x, y: a.y, r: p.radius, ticks: p.duration, age: 0 });
        w.fx.push({ kind: "lightning", x: a.x, y: a.y, tick: w.tick });
        let dead = 0;
        for (const v of within(w, a.x, a.y, p.radius)) {
          affected.add(v.tribe);
          const coast = v.coastal ? 1 : 0.4;
          v.houses = Math.max(1, Math.round(v.houses * (1 - 0.15 * coast)));
          v.food *= 1 - 0.25 * coast;
          dead += kill(v, rng.binom(popOf(v), 0.012 * coast), rng);
        }
        for (const voy of w.voyages) {
          const vx = voy.fx + (voy.tx - voy.fx) * voy.progress, vy = voy.fy + (voy.ty - voy.fy) * voy.progress;
          if (Math.hypot(vx - a.x, vy - a.y) < p.radius * 1.3 && rng.chance(voy.tier >= 3 ? 0.35 : 0.7)) (voy as any).doomed = true;
        }
        chron(w, "power", `A storm tears across ${terrain.isleAt(a.x, a.y) ? terrain.byId[terrain.isleAt(a.x, a.y)!].name : "the sea"}${dead ? `. ${dead} drowned or crushed` : ""}.`, a.x, a.y);
        break;
      }
      case "quake": {
        w.fx.push({ kind: "quake", x: a.x, y: a.y, tick: w.tick });
        let dead = 0;
        for (const v of within(w, a.x, a.y, p.radius)) {
          affected.add(v.tribe);
          v.houses = Math.max(1, Math.round(v.houses * 0.6)); v.defense = Math.max(0, v.defense - 1); v.granary = Math.max(0, v.granary - 1);
          dead += kill(v, rng.binom(popOf(v), 0.04), rng);
        }
        chron(w, "power", `The ground shakes. Houses fall${dead ? ` and ${dead} die` : ""}.`, a.x, a.y);
        break;
      }
      case "eruption": {
        const isle = terrain.isleAt(a.x, a.y) ?? "hearth";
        const vol = terrain.volcano(isle);
        w.effects.push({ id: w.nextId++, power: "eruption", x: vol.x, y: vol.y, r: 2.2, ticks: p.duration, age: 0 });
        w.fx.push({ kind: "eruption", x: vol.x, y: vol.y, tick: w.tick });
        let dead = 0;
        for (const v of within(w, vol.x, vol.y, 2.2)) {
          affected.add(v.tribe);
          const d = Math.hypot(v.x - vol.x, v.y - vol.y);
          if (d < p.radius) { dead += kill(v, rng.binom(popOf(v), 0.45), rng); v.houses = Math.max(1, Math.round(v.houses * 0.3)); v.food *= 0.2; }
          else v.food *= 0.5;
        }
        chron(w, "power", `The peak of ${terrain.byId[isle].name} wakes in fire. Ash falls for a season${dead ? `; ${dead} are lost` : ""}.`, vol.x, vol.y);
        break;
      }
      case "plague": {
        const v = nearestVillage(w, a.x, a.y);
        if (!v || v.sick) continue;
        const strain = a.strain ?? "cough";
        v.sick = { strain, t: 0, startPop: popOf(v), from: null };
        affected.add(v.tribe);
        w.fx.push({ kind: "plague", x: v.x, y: v.y, tick: w.tick });
        chron(w, "plague", `${STRAINS[strain].name} appears in ${v.name}. No one knows where it came from.`, v.x, v.y);
        remember(tribeOf(w, v.tribe), `Y${Math.floor(w.tick / 4)}: the sky's sickness at ${v.name}`);
        break;
      }
      case "bless": case "revolt": {
        const v = nearestVillage(w, a.x, a.y, 1.2);
        if (!v) continue;
        const t = tribeOf(w, v.tribe);
        affected.add(v.tribe);
        w.fx.push({ kind: "omen", x: v.x, y: v.y, tick: w.tick });
        const ruler = rulerOf(w, t);
        if (a.power === "bless") {
          t.gov.legitimacy = Math.min(1, t.gov.legitimacy + 0.2); t.gov.unrest = Math.max(0, t.gov.unrest - 0.15);
          chron(w, "politics", ruler ? `A halo of light crowns ${ruler.name}, ${ruler.role.toLowerCase()} of the ${t.name}. The people take it as the sky's blessing.` : `A warm light rests over ${v.name}. The elders of the ${t.name} are heeded.`, v.x, v.y);
        } else {
          const rival = stirRevolt(w, t, rng);
          chron(w, "politics", `Whispers spread through ${v.name}: the sky has turned from ${ruler ? ruler.name : "the elders"}. ${rival ? `The ${FACTION_INFO[rival.id].name.toLowerCase()} grow bold.` : ""}`, v.x, v.y);
        }
        break;
      }
      case "genius": {
        const v = nearestVillage(w, a.x, a.y, 1.4);
        if (!v) continue;
        const t = tribeOf(w, v.tribe);
        affected.add(v.tribe);
        const cand = TECHS.filter((x) => !t.techs.includes(x.id) && x.prereq.every((q) => t.techs.includes(q))).sort((p1, p2) => (t.progress[p2.id] ?? 0) - (t.progress[p1.id] ?? 0))[0];
        w.fx.push({ kind: "omen", x: v.x, y: v.y, tick: w.tick });
        if (cand) { t.progress[cand.id] = (t.progress[cand.id] ?? 0) + 0.35; chron(w, "power", `A child of ${v.name} grows up seeing what no one else can. The ${t.name} are suddenly close to ${cand.name.toLowerCase()}.`, v.x, v.y); }
        else chron(w, "power", `A brilliant mind is born in ${v.name}, but finds nothing left to invent yet.`, v.x, v.y);
        break;
      }
      case "risingseas": {
        let drowned = 0, towns = 0;
        for (const v of within(w, a.x, a.y, p.radius)) {
          if (!v.coastal) continue;
          affected.add(v.tribe); towns++;
          drowned += kill(v, rng.binom(popOf(v), 0.03), rng);
          v.houses = Math.max(1, v.houses * 0.8); v.food *= 0.7; v.morale = Math.max(0, v.morale - 0.15);
        }
        w.fx.push({ kind: "quake", x: a.x, y: a.y, tick: w.tick });
        chron(w, "climate", towns ? `The sea rises in a great surge. ${towns} harbour town${towns > 1 ? "s flood" : " floods"} and ${drowned} people drown.` : "The sea surges against empty shores.", a.x, a.y);
        break;
      }
      case "solarflare": {
        w.effects.push({ id: w.nextId++, power: "solarflare", x: a.x, y: a.y, r: p.radius, ticks: p.duration, age: 0 });
        const hit = new Set<string>();
        for (const v of within(w, a.x, a.y, p.radius)) {
          const t = tribeOf(w, v.tribe);
          affected.add(v.tribe);
          if (t.age >= 6 && !hit.has(t.name)) { hit.add(t.name); t.gov.unrest = Math.min(1, t.gov.unrest + 0.15); }
        }
        w.fx.push({ kind: "omen", x: a.x, y: a.y, tick: w.tick });
        chron(w, "power", hit.size ? `The sky burns green and red. Wires melt and the lights go out across the lands of the ${[...hit].join(" and the ")}.` : "Curtains of green fire dance across the sky. No one below has wires to burn.", a.x, a.y);
        break;
      }
      case "omen": {
        const v = nearestVillage(w, a.x, a.y, 1.2);
        if (!v) continue;
        affected.add(v.tribe);
        w.fx.push({ kind: "omen", x: v.x, y: v.y, tick: w.tick });
        interpretOmen(w, v, rng);
        break;
      }
    }
    w.energy -= p.cost;
    affected.forEach((tid) => shiftBelief(w, tid, a.power as keyof typeof beliefs));
  }
  return w;
}

/** The sky-speaker decides what a sign means, based on what the tribe needs. */
function interpretOmen(w: World, v: Village, rng: Rng) {
  const t = tribeOf(w, v.tribe);
  const speaker = agentsOf(w, (a) => a.tribe === t.id && a.role === "Sky-speaker")[0];
  const who = speaker ? `${speaker.name} the sky-speaker` : `The elders of ${v.name}`;
  const wars = w.relations.filter((r) => r.war && (r.a === t.id || r.b === t.id));
  const sign = rng.pick(["A comet crosses the sky", "The moon rises red", "A double rainbow stands over the sea", "Stars fall like rain"]);
  if (wars.length) {
    const r = wars[0];
    r.attitude += 0.35; r.grudge *= 0.6;
    if (rng.chance(0.5)) { r.war = false; r.warTicks = 0; }
    chron(w, "omen", `${sign} over ${v.name}. ${who} says the sky wants peace${r.war ? "" : ", and the war ends"}.`, v.x, v.y);
  } else if (v.kin > 0.35 || t.known.length < 5) {
    t.drivers.omenVoyage += 1.5;
    chron(w, "omen", `${sign} over ${v.name}. ${who} says it points across the sea, and young people look to the boats.`, v.x, v.y);
  } else {
    for (const x of w.villages) if (x.tribe === t.id) x.morale = Math.min(1, x.morale + 0.2);
    chron(w, "omen", `${sign} over ${v.name}. ${who} calls a festival of thanks.`, v.x, v.y);
  }
  if (speaker) remember(speaker, `Read the sign of Y${Math.floor(w.tick / 4)}`);
}
