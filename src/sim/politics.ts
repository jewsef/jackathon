import type { World, Tribe, Village, FactionId, RegimeType, Policy, Res, Faction } from "./types";
import { FACTIONS, STAGES, yearOf, JOBS } from "./types";
import type { Rng } from "./rng";
import { getTerrain, ISLE_IDS } from "./terrain";
import { living, popOf, chron, relation, tribePop, kill, makeName, remember, rulerOf, has, tribeStock, boatTier, villageName, agentsOf, movePeople } from "./util";
import { newAgent, freeSite, newVillage } from "./world";
import politicsData from "../../data/politics.json";

const P = politicsData as {
  regimes: Record<RegimeType, { name: string; ruler: string; desc: string }>;
  factions: Record<FactionId, { name: string; wants: Policy; regime: RegimeType; head: string }>;
};
export const REGIMES = P.regimes, FACTION_INFO = P.factions;
const MAX_AGENTS = 60;

const capitalOf = (w: World, t: Tribe): Village | undefined => living(w).filter((v) => v.tribe === t.id).sort((a, b) => popOf(b) - popOf(a))[0];
const faction = (t: Tribe, id: FactionId | null) => (id ? t.factions.find((f) => f.id === id) ?? null : null);
const dominant = (t: Tribe) => [...t.factions].sort((a, b) => b.support - a.support)[0];

/** What each faction's share of the people should be, from jobs, beliefs and danger. */
function factionTargets(w: World, t: Tribe): Record<FactionId, number> {
  const sh = Object.fromEntries(JOBS.map((j) => [j, 0])) as Record<string, number>;
  let total = 0, threat = 0;
  for (const v of living(w)) if (v.tribe === t.id) { const p = popOf(v); total += p; threat = Math.max(threat, v.threat); for (const j of JOBS) sh[j] += v.jobs[j] * p; }
  for (const j of JOBS) sh[j] /= total || 1;
  const war = w.relations.some((r) => r.war && (r.a === t.id || r.b === t.id));
  const raw: Record<FactionId, number> = {
    farmers: sh.farmer + sh.gatherer * 0.7 + 0.05,
    seafarers: sh.fisher + sh.boatwright * 1.5 + (t.known.length > 1 ? 0.04 : 0),
    warriors: sh.warrior * 2 + threat * 0.06 + (war ? 0.06 : 0) + t.traits.bold * 0.03,
    priests: sh.priest * 4 + t.belief.awe * 0.15 + t.belief.fear * 0.08,
    crafters: sh.builder + sh.woodcutter + sh.quarrier + sh.miner * 1.4 + sh.smith * 2
  };
  const sum = FACTIONS.reduce((s, f) => s + raw[f], 0) || 1;
  for (const f of FACTIONS) raw[f] = Math.max(0.03, raw[f] / sum);
  return raw;
}

function headFor(w: World, t: Tribe, f: Faction, rng: Rng): number | null {
  const cur = f.head !== null ? w.agents.find((a) => a.id === f.head && a.alive) : null;
  if (cur) return cur.id;
  const cap = capitalOf(w, t);
  if (!cap || w.agents.filter((a) => a.alive).length >= MAX_AGENTS) return null;
  const a = newAgent(w, { name: makeName(rng, t), sex: rng.chance(0.5) ? "m" : "f", role: FACTION_INFO[f.id].head, village: cap.id, tribe: t.id, age: rng.range(28, 50), ambition: rng.range(0.3, 1), goal: `Speak for the ${FACTION_INFO[f.id].name.toLowerCase()}.` }, rng);
  f.head = a.id;
  return a.id;
}

/** A faction takes power: its regime, with its head as ruler. */
function establish(w: World, t: Tribe, fid: FactionId, rng: Rng, how: "rise" | "revolt" | "coup" | "succession") {
  const f = faction(t, fid)!;
  const type = FACTION_INFO[fid].regime;
  const old = rulerOf(w, t);
  let rid = headFor(w, t, f, rng);
  if (rid === null) {
    const cap = capitalOf(w, t);
    if (!cap) return;
    rid = newAgent(w, { name: makeName(rng, t), sex: rng.chance(0.5) ? "m" : "f", role: REGIMES[type].ruler, village: cap.id, tribe: t.id, age: rng.range(30, 50) }, rng).id;
  }
  const ruler = w.agents.find((a) => a.id === rid)!;
  ruler.role = REGIMES[type].ruler;
  ruler.goal = "Hold power and see the tribe prosper.";
  f.head = null;
  const prevType = t.gov.type;
  t.gov = { ...t.gov, type, ruler: ruler.id, rulerFaction: fid, since: w.tick, legitimacy: how === "rise" ? 0.7 : how === "succession" ? Math.max(0.4, t.gov.legitimacy - 0.05) : 0.45, unrest: how === "rise" ? t.gov.unrest : t.gov.unrest * 0.4 };
  const cap = capitalOf(w, t);
  const verb = { rise: `The ${t.name} outgrow their council of elders. The ${FACTION_INFO[fid].name.toLowerCase()} raise ${ruler.name} as ${REGIMES[type].ruler.toLowerCase()}`,
    revolt: `Uprising! The ${FACTION_INFO[fid].name.toLowerCase()} of the ${t.name} overthrow ${old ? `${old.role.toLowerCase()} ${old.name}` : "their rulers"}. ${ruler.name} now rules as ${REGIMES[type].ruler.toLowerCase()}`,
    coup: `Coup: ${ruler.name} and the warriors seize power over the ${t.name}${old ? ` from ${old.name}` : ""}`,
    succession: `${ruler.name} becomes ${REGIMES[type].ruler.toLowerCase()} of the ${t.name}` }[how];
  chron(w, "politics", `${verb}${prevType !== type && how !== "succession" ? ` (${REGIMES[type].name.toLowerCase()})` : ""}.`, cap?.x, cap?.y);
  remember(t, `Y${yearOf(w.tick)}: ${ruler.name} took power (${how})`);
  if (old && old.id !== ruler.id && how !== "succession") {
    if (how === "coup" || rng.chance(0.5)) { old.alive = false; old.died = w.tick; } else { old.role = "Exile"; old.goal = "Win back what was lost."; }
  }
}

function succession(w: World, t: Tribe, rng: Rng) {
  const type = t.gov.type;
  const dom = dominant(t);
  if (type === "warlord") {
    t.gov.unrest = Math.min(1, t.gov.unrest + 0.25);
    const warriors = faction(t, "warriors")!;
    establish(w, t, warriors.support > 0.22 ? "warriors" : dom.id, rng, "succession");
  } else if (type === "chief") {
    const cap = capitalOf(w, t);
    if (!cap) return;
    const heir = newAgent(w, { name: makeName(rng, t), sex: rng.chance(0.5) ? "m" : "f", role: REGIMES.chief.ruler, village: cap.id, tribe: t.id, age: rng.range(20, 35) }, rng);
    t.gov.ruler = heir.id; t.gov.legitimacy = Math.max(0.3, t.gov.legitimacy - 0.08); t.gov.since = w.tick;
    chron(w, "politics", `${heir.name}, heir of the old chief, takes the seat of the ${t.name}.`, cap.x, cap.y);
  } else if (type === "priestking") establish(w, t, "priests", rng, "succession");
  else establish(w, t, dom.id, rng, "succession");
}

/** A province breaks away in civil war: the village joins a new tribe under the rebel faction. */
function secede(w: World, t: Tribe, v: Village, fid: FactionId, rng: Rng) {
  const nt: Tribe = JSON.parse(JSON.stringify(t));
  nt.id = w.tribes.length; nt.parent = t.id; nt.alive = true;
  nt.name = makeName(rng, t) + " folk";
  nt.home = v.isle; nt.memory = [`Y${yearOf(w.tick)}: broke from the ${t.name} in civil war`];
  nt.drivers = { raftLoss: 0, capsize: 0, windSeasons: 0, calmSeasons: 0, plagueSurvived: 0, raids: 0, hunger: 0, omenVoyage: 0, farReturn: 0 };
  nt.factions = nt.factions.map((f) => ({ ...f, head: null, support: f.id === fid ? 0.5 : f.support * 0.6 }));
  w.tribes.push(nt);
  for (const o of w.tribes) if (o.id !== nt.id) { const r = relation(w, nt.id, o.id), pr = relation(w, t.id, o.id); Object.assign(r, { ...pr, a: Math.min(nt.id, o.id), b: Math.max(nt.id, o.id), overlord: null }); }
  const r = relation(w, t.id, nt.id);
  Object.assign(r, { met: true, metTick: w.tick, attitude: -0.6, grudge: 0.6, war: true, warTicks: 0, losses: 0, alliance: false, marriages: 0, trades: 0, speaker: true, overlord: null });
  v.tribe = nt.id;
  for (const a of w.agents) if (a.alive && a.village === v.id) a.tribe = nt.id;
  const f = t.factions.find((x) => x.id === fid)!;
  if (f.head !== null) { const h = w.agents.find((a) => a.id === f.head); if (h) { h.village = v.id; h.tribe = nt.id; } }
  nt.gov = { ...nt.gov, ruler: null, uprisings: 0 };
  establish(w, nt, fid, rng, "revolt");
  f.support *= 0.5; f.head = null;
  chron(w, "politics", `Civil war: ${v.name} breaks away from the ${t.name}. The ${nt.name} are born in blood.`, v.x, v.y);
}

function splitOff(w: World, t: Tribe, cap: Village, fid: FactionId, rng: Rng) {
  const site = freeSite(w, cap.isle, cap);
  if (!site) return false;
  const nv = newVillage(w, t, site, villageName(rng, t));
  const moved = movePeople(cap, nv, 0.35, rng);
  nv.food = cap.food * 0.3; cap.food *= 0.7; nv.blood = { ...cap.blood }; nv.kin = cap.kin; nv.houses = 3;
  secede(w, t, nv, fid, rng);
  chron(w, "politics", `${moved} rebels march out of ${cap.name} and found ${nv.name}.`, nv.x, nv.y);
  return true;
}

function uprising(w: World, t: Tribe, f: Faction, rng: Rng, stirred: boolean) {
  const cap = capitalOf(w, t);
  if (!cap) return;
  const rf = faction(t, t.gov.rulerFaction), war = faction(t, "warriors")!;
  const loyal = (rf ? rf.support : 0.3) * (0.7 + (t.gov.type === "warlord" ? war.support : 0.2)) + t.gov.legitimacy * 0.4 + Math.floor(cap.defense) * 0.03;
  const rebels = f.support * (0.75 + f.militancy) * (stirred ? 1.2 : 1);
  const ratio = (rebels / Math.max(0.05, loyal)) * rng.range(0.8, 1.25);
  const head = w.agents.find((a) => a.id === headFor(w, t, f, rng));
  const dead = kill(cap, rng.binom(popOf(cap), 0.008 + 0.015 * Math.min(2, ratio)), rng, "men");
  w.fx.push({ kind: "uprising", x: cap.x, y: cap.y, tick: w.tick });
  t.gov.uprisings++;
  if (ratio > 1.25) {
    establish(w, t, f.id, rng, "revolt");
    f.militancy *= 0.5;
    if (dead) chron(w, "death", `${dead} die in the fighting at ${cap.name}.`, cap.x, cap.y);
  } else if (ratio > 0.85) {
    const others = living(w).filter((v) => v.tribe === t.id && v !== cap).sort((a, b) => popOf(b) - popOf(a));
    if (others.length) secede(w, t, others[0], f.id, rng);
    else if (!splitOff(w, t, cap, f.id, rng)) { t.gov.legitimacy *= 0.8; chron(w, "politics", `Fighting in the streets of ${cap.name}. Neither side wins.`, cap.x, cap.y); }
  } else {
    f.support *= 0.7; f.militancy *= 0.35; t.gov.unrest *= 0.5; t.gov.legitimacy = Math.min(1, t.gov.legitimacy + 0.05);
    if (head) { head.alive = false; head.died = w.tick; f.head = null; }
    chron(w, "politics", `The ${FACTION_INFO[f.id].name.toLowerCase()} rise against ${rulerOf(w, t)?.name ?? "the elders"} of the ${t.name}, and are crushed${head ? `. ${head.name} is put to death` : ""}${dead ? `; ${dead} dead` : ""}.`, cap.x, cap.y);
  }
}

/** Each year the ruler sets an objective; it steers jobs, building, voyages and war. */
function chooseObjective(w: World, t: Tribe) {
  const vs = living(w).filter((v) => v.tribe === t.id);
  const cap = capitalOf(w, t);
  if (!cap) return;
  const terrain = getTerrain(w.seed);
  const enemies = w.relations.filter((r) => (r.war || (r.met && r.attitude < -0.35)) && (r.a === t.id || r.b === t.id)).map((r) => (r.a === t.id ? r.b : r.a));
  const hungry = vs.filter((v) => v.hungry > 0).length / Math.max(1, vs.length);
  const rf = t.gov.rulerFaction;
  let policy: Policy = rf ? FACTION_INFO[rf].wants : "growth";
  if (hungry > 0.3) { t.objective = { kind: "feed", text: "Feed the hungry before the next winter.", village: null }; t.gov.policy = "growth"; return; }
  if (enemies.length) {
    const foeVs = living(w).filter((v) => enemies.includes(v.tribe));
    let best = cap, bd = 1e9;
    for (const v of vs) {
      const d = Math.min(...foeVs.map((f) => Math.hypot(f.x - v.x, f.y - v.y) + (f.isle === v.isle ? 0 : 3)), 1e9);
      const value = popOf(v) + Object.values(v.stock).reduce((s, x) => s + x, 0) * 0.3;
      const score = d - value / 400;
      if (score < bd) { bd = score; best = v; }
    }
    t.objective = { kind: "defend", text: `Fortify ${best.name} against the ${w.tribes[enemies[0]].name}.`, village: best.id, tribe: enemies[0] };
    t.gov.policy = "defense";
    return;
  }
  const allyAtWar = w.relations.find((r) => (r.alliance || r.overlord !== null) && (r.a === t.id || r.b === t.id) && w.relations.some((q) => q.war && (q.a === (r.a === t.id ? r.b : r.a) || q.b === (r.a === t.id ? r.b : r.a))));
  if (allyAtWar) {
    const ally = w.tribes[allyAtWar.a === t.id ? allyAtWar.b : allyAtWar.a];
    t.objective = { kind: "ally", text: `Stand with the ${ally.name}: raise walls and spears.`, village: cap.id, tribe: ally.id };
    t.gov.policy = "defense";
    return;
  }
  // the metals of the Bronze Age
  if (has(t, "copperworking") && !has(t, "bronze")) {
    const lacking: Res | null = tribeStock(w, t.id, "tin") < 5 ? "tin" : tribeStock(w, t.id, "copper") < 10 ? "copper" : null;
    if (lacking) {
      const holder = ISLE_IDS.filter((i) => w.deposits[i][lacking] > 0.2 && t.known.includes(i)).map((i) => ({ i, people: living(w).filter((v) => v.isle === i && v.tribe !== t.id) }))[0];
      if (holder) {
        const owner = holder.people[0] ? w.tribes[holder.people[0].tribe] : null;
        const r = owner ? relation(w, t.id, owner.id) : null;
        if (owner && r && r.attitude > 0) { t.objective = { kind: "secure", text: `Trade for ${lacking} with the ${owner.name}.`, village: null, res: lacking, tribe: owner.id }; t.gov.policy = "sea"; return; }
        if (owner && r && (t.gov.type === "warlord" || t.gov.type === "chief")) {
          r.attitude -= 0.08; r.grudge = Math.min(1, r.grudge + 0.05);
          t.objective = { kind: "secure", text: `Take the ${lacking} of ${terrain.byId[holder.i].name} from the ${owner.name}.`, village: null, res: lacking, tribe: owner.id }; t.gov.policy = "defense"; return;
        }
        t.objective = { kind: "secure", text: `Bring ${lacking} from ${terrain.byId[holder.i].name}.`, village: null, res: lacking }; t.gov.policy = "sea"; return;
      }
      t.objective = { kind: "reach", text: `Find ${lacking} across the sea.`, village: null, res: lacking }; t.gov.policy = "sea"; return;
    }
  }
  // unite the island
  const rivals = w.tribes.filter((o) => o.alive && o.id !== t.id && living(w).some((v) => v.tribe === o.id && v.isle === cap.isle));
  if (rivals.length && (t.gov.type === "warlord" || t.gov.type === "chief")) {
    const rival = rivals.sort((a, b) => tribePop(w, b.id) - tribePop(w, a.id))[0];
    const r = relation(w, t.id, rival.id);
    if (r.overlord !== t.id) {
      t.objective = { kind: "unite", text: `Unite ${terrain.byId[cap.isle].name} under one rule: bring the ${rival.name} to heel.`, village: cap.id, tribe: rival.id };
      r.attitude -= 0.04; t.gov.policy = "defense"; return;
    }
  }
  if (t.known.length < 5 && boatTier(t) >= 2) { t.objective = { kind: "reach", text: "Find what lies beyond the sea.", village: null }; t.gov.policy = policy === "growth" ? "sea" : policy; return; }
  t.objective = { kind: "grow", text: `Grow ${cap.name} and fill the granaries.`, village: cap.id };
  t.gov.policy = policy;
}

/** Strong tribes press weaker neighbours into tribute; allies and vassals share military knowledge. */
function influence(w: World, rng: Rng) {
  for (const r of w.relations) {
    const A = w.tribes[r.a], B = w.tribes[r.b];
    if (!A?.alive || !B?.alive || !r.met || r.war) continue;
    const pa = tribePop(w, A.id), pb = tribePop(w, B.id);
    if (r.overlord === null) {
      const [big, small, ps, pl] = pa > pb ? [A, B, pb, pa] : [B, A, pa, pb];
      if (pl > ps * 2.5 && ps > 0 && ["chief", "warlord", "priestking"].includes(big.gov.type) && r.attitude > -0.4 && rng.chance(0.12)) {
        const accept = rng.chance(0.35 + (1 - small.gov.legitimacy) * 0.4 + (pl / (pl + ps)) * 0.2 - small.traits.bold * 0.3);
        const cap = capitalOf(w, small);
        if (accept) {
          r.overlord = big.id; r.attitude = Math.min(1, r.attitude + 0.1);
          chron(w, "politics", `The ${small.name} bow to the ${big.name} and send tribute each season.`, cap?.x, cap?.y);
          remember(small, `Y${yearOf(w.tick)}: began paying tribute to the ${big.name}`);
        } else {
          r.attitude -= 0.3; r.grudge = Math.min(1, r.grudge + 0.3);
          chron(w, "politics", `The ${small.name} refuse to pay tribute to the ${big.name}. Spears are sharpened on both sides.`, cap?.x, cap?.y);
        }
      }
    } else {
      const lord = w.tribes[r.overlord], vassal = r.overlord === A.id ? B : A;
      const pl = tribePop(w, lord.id), pv = tribePop(w, vassal.id);
      if ((pv > pl * 0.8 || vassal.gov.unrest > 0.6) && rng.chance(0.15)) {
        r.overlord = null; r.attitude -= 0.3; r.grudge = Math.min(1, r.grudge + 0.2);
        const cap = capitalOf(w, vassal);
        chron(w, "politics", `The ${vassal.name} throw off the rule of the ${lord.name} and stop paying tribute.`, cap?.x, cap?.y);
      }
    }
    // partners teach each other how to defend themselves
    if ((r.alliance || r.overlord !== null) && rng.chance(0.2)) {
      const [src, dst] = rng.chance(0.5) ? [A, B] : [B, A];
      const cand = src.techs.filter((x) => ["bow", "palisade", "shields", "masonry", "stonefort", "warcanoe"].includes(x) && !dst.techs.includes(x));
      if (cand.length) { const tech = rng.pick(cand); dst.techs.push(tech); chron(w, "tech", `The ${src.name} teach their partners the ${dst.name} how to build ${tech === "palisade" ? "palisades" : tech === "masonry" ? "in stone" : tech === "stonefort" ? "stone forts" : tech}.`); }
    }
  }
}

/** Factions, legitimacy, unrest, uprisings, coups, civil war, succession, objectives and tribute. */
export function politics(w: World, rng: Rng): World {
  const season = w.tick % 4;
  for (const t of w.tribes) {
    if (!t.alive) continue;
    const pop = tribePop(w, t.id), cap = capitalOf(w, t);
    if (!cap || pop === 0) continue;
    if (!t.factions?.length) continue;
    const targets = factionTargets(w, t);
    for (const f of t.factions) {
      f.support += (targets[f.id] - f.support) * 0.08;
      const baseMil = f.id === "warriors" ? 0.45 : 0.2;
      f.militancy += (baseMil + t.gov.unrest * 0.4 - f.militancy) * 0.05;
      if (f.head !== null && !w.agents.some((a) => a.id === f.head && a.alive)) f.head = null;
    }
    const sum = t.factions.reduce((s, f) => s + f.support, 0) || 1;
    for (const f of t.factions) f.support /= sum;

    // a ruler emerges when the band becomes a people
    if (t.gov.type === "elders" && pop >= 120 && STAGES.indexOf(cap.stage) >= 2 && rng.chance(0.06)) establish(w, t, dominant(t).id, rng, "rise");
    if (t.gov.type !== "elders" && !rulerOf(w, t)) succession(w, t, rng);

    // faction heads appear when the tribe is big enough to argue
    if (pop >= 80 && season === 1) for (const f of [...t.factions].sort((a, b) => b.support - a.support).slice(0, 2)) if (f.id !== t.gov.rulerFaction) headFor(w, t, f, rng);

    // legitimacy and unrest
    const vs = living(w).filter((v) => v.tribe === t.id);
    const hungry = vs.filter((v) => v.hungry > 0).length / vs.length;
    const sick = vs.some((v) => v.sick);
    const atWar = w.relations.some((r) => r.war && (r.a === t.id || r.b === t.id));
    const vassal = w.relations.some((r) => r.overlord !== null && r.overlord !== t.id && (r.a === t.id || r.b === t.id));
    const rf = faction(t, t.gov.rulerFaction), ruler = rulerOf(w, t);
    const legitTarget = 0.58 + 0.35 * (rf ? rf.support : 0.3) + 0.15 * t.belief.love + 0.1 * Math.max(0, ...vs.map((v) => v.monument)) - 0.3 * hungry
      - (t.gov.type === "warlord" ? 0.1 : 0) - (ruler ? ruler.ambition * 0.08 : 0) - (vassal ? 0.08 : 0);
    t.gov.legitimacy += (Math.max(0.05, Math.min(1, legitTarget)) - t.gov.legitimacy) * 0.04;
    const unrestTarget = hungry * 0.45 + (sick ? 0.15 : 0) + (atWar ? 0.08 : 0) + t.belief.fear * 0.15 + (1 - t.gov.legitimacy) * 0.35 + (t.age >= 2 ? 0.06 : 0) + (vassal ? 0.08 : 0);
    t.gov.unrest += (Math.max(0, Math.min(1, unrestTarget)) - t.gov.unrest) * 0.08;

    if (season === 0) chooseObjective(w, t);

    // rebellion, coups
    if (t.gov.type !== "elders" || pop >= 60) {
      const rebels = t.factions.filter((f) => f.id !== t.gov.rulerFaction && f.support > 0.22 && f.militancy > 0.25).sort((a, b) => b.support * b.militancy - a.support * a.militancy);
      if (rebels.length && t.gov.unrest > 0.5 && rng.chance((t.gov.unrest - 0.45) * 0.12 * (0.5 + rebels[0].militancy))) uprising(w, t, rebels[0], rng, false);
      else {
        const war = faction(t, "warriors")!;
        if (t.gov.rulerFaction !== "warriors" && war.support > 0.3 && war.militancy > 0.5 && t.gov.legitimacy < 0.35 && rng.chance(0.03)) establish(w, t, "warriors", rng, "coup");
      }
    }
  }
  if (season === 0) influence(w, rng);
  return w;
}

/** Player power: stir discontent in a tribe. */
export function stirRevolt(w: World, t: Tribe, rng: Rng) {
  t.gov.unrest = Math.min(1, t.gov.unrest + 0.35);
  const rival = t.factions.filter((f) => f.id !== t.gov.rulerFaction).sort((a, b) => b.support - a.support)[0];
  if (rival) { rival.militancy = Math.min(1, rival.militancy + 0.35); rival.support = Math.min(0.9, rival.support + 0.05); }
  if (rival && t.gov.unrest > 0.6 && rng.chance(0.35)) uprising(w, t, rival, rng, true);
  return rival;
}
export const _politics = { agentsOf };
