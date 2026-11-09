import type { World, Village, Tribe, Relation, ChronKind, Agent, Job } from "./types";
import { JOBS, RES, FACTIONS, yearOf, seasonOf } from "./types";
import type { Res, Faction, Gov } from "./types";
import type { Rng } from "./rng";
import techs from "../../data/techs.json";

export const TECHS = techs as { id: string; name: string; group: string; tier?: number; age?: number; prereq: string[]; needs?: Record<string, number>; strict?: boolean; desc: string }[];
export const TECH = Object.fromEntries(TECHS.map((t) => [t.id, t]));

export const sumArr = (a: number[]) => a.reduce((s, v) => s + v, 0);
export const AGE_N = 80, ADULT = 16, ELDER = 55;
const range = (a: number[], lo: number, hi: number) => { let s = 0; for (let i = lo; i < hi; i++) s += a[i]; return s; };
export const kids = (v: Village) => range(v.m, 0, ADULT) + range(v.f, 0, ADULT);
export const kidsAged = (v: Village, lo: number, hi: number) => range(v.m, lo, hi) + range(v.f, lo, hi);
export const adults = (v: Village) => v.men + v.women;
export const popOf = (v: Village) => (v.lost ? 0 : sumArr(v.m) + sumArr(v.f));
export const fertileWomen = (v: Village) => range(v.f, ADULT, 45);
export const ableMen = (v: Village) => range(v.m, ADULT, 61);
/** Refresh the derived men / women / elders counts after the age arrays change. */
export function recount(v: Village) {
  v.men = range(v.m, ADULT, ELDER); v.women = range(v.f, ADULT, ELDER);
  v.elders = range(v.m, ELDER, AGE_N) + range(v.f, ELDER, AGE_N);
}
export function addPeople(v: Village, sex: "m" | "f", n: number, age: number) {
  if (n <= 0) return;
  (sex === "m" ? v.m : v.f)[Math.max(0, Math.min(AGE_N - 1, Math.round(age)))] += n;
  recount(v);
}
/** Take up to n working-age people of one sex (ages 16-45). Returns how many were taken. */
export function takeAdults(v: Village, sex: "m" | "f", n: number, rng: Rng): number {
  const a = sex === "m" ? v.m : v.f;
  let taken = 0;
  for (let k = 0; k < n; k++) {
    const total = range(a, ADULT, 46);
    if (total <= 0) break;
    let r = rng.next() * total, i = ADULT;
    for (; i < 46; i++) { r -= a[i]; if (r < 0) break; }
    if (i >= 46) i = 45;
    if (a[i] > 0) { a[i]--; taken++; }
  }
  recount(v);
  return taken;
}
/** Move a share of every age group from one village to another (young families favoured). */
export function movePeople(from: Village, to: Village, frac: number, rng: Rng): number {
  let moved = 0;
  for (const sex of ["m", "f"] as const) {
    const a = from[sex], b = to[sex];
    for (let i = 0; i < AGE_N; i++) {
      const fr = i >= ELDER ? frac * 0.3 : frac;
      const k = a[i] < 30 ? rng.binom(a[i], fr) : Math.round(a[i] * fr);
      a[i] -= k; b[i] += k; moved += k;
    }
  }
  recount(from); recount(to);
  return moved;
}
export const living = (w: World) => w.villages.filter((v) => !v.lost);
export const tribeOf = (w: World, id: number): Tribe => w.tribes[id];
export const villageById = (w: World, id: number): Village | undefined => w.villages.find((v) => v.id === id);
export const tribePop = (w: World, t: number) => w.villages.reduce((s, v) => s + (v.tribe === t ? popOf(v) : 0), 0);
export const has = (t: Tribe, tech: string) => t.techs.includes(tech);
export function boatTier(t: Tribe): number {
  if (has(t, "flight")) return 8;
  if (has(t, "steamship")) return 7;
  if (has(t, "carrack")) return 6;
  if (has(t, "navigation")) return 5;
  if (has(t, "sail")) return 4;
  if (has(t, "outrigger")) return 3;
  if (has(t, "canoe")) return 2;
  if (has(t, "raft")) return 1;
  return 0;
}
export function weaponTier(t: Tribe): number {
  return (has(t, "bow") ? 1 : 0) + (has(t, "shields") ? 1 : 0) + (has(t, "warcanoe") ? 0.5 : 0) + (has(t, "iron") ? 1 : 0) + (has(t, "gunpowder") ? 1.5 : 0) + (has(t, "rifles") ? 1.5 : 0) + (has(t, "flight") ? 1 : 0) + (has(t, "missiles") ? 2 : 0);
}
export function defenseCap(t: Tribe): number {
  return (has(t, "palisade") ? 1 : 0) + (has(t, "palisade") && has(t, "bow") ? 1 : 0) + (has(t, "shields") ? 1 : 0) + (has(t, "warcanoe") ? 1 : 0) + (has(t, "stonefort") ? 1 : 0) + (has(t, "gunpowder") && has(t, "masonry") ? 1 : 0);
}

export function relation(w: World, a: number, b: number): Relation {
  const lo = Math.min(a, b), hi = Math.max(a, b);
  let r = w.relations.find((x) => x.a === lo && x.b === hi);
  if (!r) {
    r = { a: lo, b: hi, met: false, metTick: -1, attitude: 0, grudge: 0, war: false, warTicks: 0, losses: 0, alliance: false, marriages: 0, trades: 0, speaker: false, overlord: null };
    w.relations.push(r);
  }
  return r;
}

export function chron(w: World, kind: ChronKind, text: string, x?: number, y?: number) {
  const e = { tick: w.tick, kind, text, x, y };
  w.events.push(e);
}
export function stamp(tick: number) { return `Y${yearOf(tick)} ${seasonOf(tick)}`; }

export function makeName(rng: Rng, t: Tribe): string {
  const n = rng.chance(0.3) ? 1 : 2;
  let s = "";
  for (let i = 0; i < n; i++) s += rng.pick(t.syllables);
  if (n === 1 && s.length < 3) s += rng.pick(t.syllables);
  return s.charAt(0).toUpperCase() + s.slice(1);
}
export function villageName(rng: Rng, t: Tribe): string {
  const suffix = ["mouth", "fold", "mere", "reach", "holm", "ford", "hollow", "watch", "grove", "stead", "cliff", "haven"];
  const s = rng.pick(t.syllables) + rng.pick(t.syllables);
  return s.charAt(0).toUpperCase() + s.slice(1) + rng.pick(suffix);
}

/** Remove n people, chosen at random. 'weak' favours infants and the old, 'men' favours fighting-age men. */
export function kill(v: Village, n: number, rng: Rng, prefer: "any" | "weak" | "men" = "any"): number {
  let left = Math.min(Math.round(n), popOf(v)), died = 0;
  const wt = (sex: "m" | "f", i: number) => prefer === "weak" ? (i < 5 || i >= ELDER ? 3 : 1) : prefer === "men" ? (sex === "m" && i >= ADULT && i < ELDER ? 6 : 0.3) : 1;
  while (left > 0) {
    let total = 0;
    for (const sex of ["m", "f"] as const) for (let i = 0; i < AGE_N; i++) total += v[sex][i] * wt(sex, i);
    if (total <= 0) break;
    let r = rng.next() * total, done = false;
    for (const sex of ["m", "f"] as const) {
      for (let i = 0; i < AGE_N; i++) {
        r -= v[sex][i] * wt(sex, i);
        if (r < 0 && v[sex][i] > 0) { v[sex][i]--; done = true; break; }
      }
      if (done) break;
    }
    if (!done) break;
    left--; died++;
  }
  recount(v);
  return died;
}

export function blankJobs(): Record<Job, number> { return Object.fromEntries(JOBS.map((j) => [j, 0])) as Record<Job, number>; }
export function workers(v: Village, job: Job): number { return v.jobs[job] * adults(v); }

export function agentsOf(w: World, pred: (a: Agent) => boolean) { return w.agents.filter((a) => a.alive && pred(a)); }
export function remember(a: { memory: string[] }, text: string, max = 6) { a.memory.unshift(text); if (a.memory.length > max) a.memory.length = max; }

export function blankStock(): Record<Res, number> { return Object.fromEntries(RES.map((r) => [r, 0])) as Record<Res, number>; }
export function newGov(tick: number): Gov { return { type: "elders", ruler: null, rulerFaction: null, legitimacy: 0.7, unrest: 0.05, since: tick, policy: "growth", uprisings: 0 }; }
export function newFactions(): Faction[] { return FACTIONS.map((id) => ({ id, support: 0.2, militancy: 0.2, head: null })); }
/** Total of one resource across a tribe's villages. */
export function tribeStock(w: World, tribe: number, r: Res) { let s = 0; for (const v of w.villages) if (!v.lost && v.tribe === tribe) s += v.stock[r]; return s; }
export const rulerOf = (w: World, t: Tribe) => (t.gov.ruler !== null ? w.agents.find((a) => a.id === t.gov.ruler && a.alive) ?? null : null);
