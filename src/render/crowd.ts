import type { Village, Job } from "../sim/types";
import { JOBS } from "../sim/types";
import type { Terrain } from "../sim/terrain";
import { hash3 } from "../sim/rng";
import { popOf, adults, kids } from "../sim/util";

export interface HouseSpot { x: number; y: number; v: number; d: number; }
export interface FieldSpot { x: number; y: number; w: number; h: number; r: number; c: number; d: number; }
export interface Layout { houses: HouseSpot[]; fields: FieldSpot[]; ring: { x: number; y: number }[]; R: number; quarry: { x: number; y: number }; mine: { x: number; y: number }; forge: { x: number; y: number }; }
export interface Figure {
  job: Job | "child" | "elder"; sex: "m" | "f"; hx: number; hy: number; tx: number; ty: number; ph: number; sp: number;
}

const layoutCache = new Map<string, Layout>();

/** Where a village's houses and fields go. Pure function of terrain and village position. */
export function layoutFor(t: Terrain, v: Village): Layout {
  const key = t.seed + ":" + v.id;
  const hit = layoutCache.get(key);
  if (hit) return hit;
  const R = 0.2, houses: HouseSpot[] = [], fields: FieldSpot[] = [];
  for (let k = 0; k < 260 && houses.length < 160; k++) {
    const ang = k * 2.39996 + hash3(k, v.id, 6), rr = R * Math.sqrt((k + 0.5) / 160) * (0.85 + hash3(k, v.id, 7) * 0.3);
    const x = v.x + Math.cos(ang) * rr, y = v.y + Math.sin(ang) * rr * 0.85, el = t.elev(x, y, 7);
    if (el > 0.004 && el < 0.27) houses.push({ x, y, d: rr, v: hash3(k, v.id, 8) });
  }
  houses.sort((a, b) => a.d - b.d);
  const rot = hash3(v.id, 1, 5) * 3.1;
  for (let k = 0; k < 140 && fields.length < 80; k++) {
    const fa = k * 2.39996 + hash3(k, v.id, 9) * 0.8, fr = R * (0.55 + hash3(k, v.id, 10) * 1.3) + 0.04 * Math.sqrt(k);
    const x = v.x + Math.cos(fa) * fr, y = v.y + Math.sin(fa) * fr * 0.85, el = t.elev(x, y, 7);
    if (el > 0.006 && el < 0.17) fields.push({ x, y, w: 0.04 + hash3(k, v.id, 11) * 0.035, h: 0.024 + hash3(k, v.id, 12) * 0.016, r: rot + (hash3(k, v.id, 13) - 0.5) * 0.5, c: Math.floor(hash3(k, v.id, 14) * 3), d: fr });
  }
  fields.sort((a, b) => a.d - b.d);
  const ring: { x: number; y: number }[] = [];
  for (let k = 0; k < 48; k++) {
    const a = (k / 48) * 6.283, d = R * (1.15 + hash3(k, v.id, 15) * 0.9);
    const x = v.x + Math.cos(a) * d, y = v.y + Math.sin(a) * d * 0.85;
    if (t.elev(x, y, 6) > 0.006) ring.push({ x, y });
  }
  if (!ring.length) ring.push({ x: v.x, y: v.y });
  // work sites uphill: a quarry, and a mine a little further up
  const hill: { x: number; y: number; e: number; a: number }[] = [];
  for (let k = 0; k < 24; k++) for (const d of [0.3, 0.42]) {
    const a = (k / 24) * 6.283, x = v.x + Math.cos(a) * d, y = v.y + Math.sin(a) * d * 0.85, e = t.elev(x, y, 6);
    if (e > 0.02) hill.push({ x, y, e: e + d * 0.01, a });
  }
  hill.sort((p, q) => q.e - p.e);
  const quarry = hill[0] ?? { x: v.x + 0.25, y: v.y };
  const mine = hill.find((h) => Math.abs(((h.a - (hill[0]?.a ?? 0) + 9.42) % 6.283) - 3.14) < 2.4) ?? hill[1] ?? quarry;
  const forge = { x: v.x + 0.035, y: v.y - 0.035 };
  const out = { houses, fields, ring, R, quarry: { x: quarry.x, y: quarry.y }, mine: { x: mine.x, y: mine.y }, forge };
  layoutCache.set(key, out);
  return out;
}

export function houseCount(v: Village, L: Layout) { return Math.min(L.houses.length, Math.max(1, Math.floor(v.houses))); }
export function fieldCount(v: Village, L: Layout) { return Math.min(L.fields.length, Math.round(v.jobs.farmer * adults(v) / 2.5)); }

/** Split n figures across jobs by largest remainder, so the sample matches the record's shares. */
export function apportion(shares: Record<Job, number>, n: number): Record<Job, number> {
  const out = Object.fromEntries(JOBS.map((j) => [j, 0])) as Record<Job, number>;
  const rem: [Job, number][] = [];
  let used = 0;
  for (const j of JOBS) { const x = shares[j] * n; out[j] = Math.floor(x); used += out[j]; rem.push([j, x - out[j]]); }
  rem.sort((a, b) => b[1] - a[1]);
  for (let i = 0; used < n && i < rem.length; i++, used++) out[rem[i][0]]++;
  return out;
}

/**
 * The crowd sampler. People are never stored: when you zoom in, a sample is drawn from the
 * village record. If 30% of adults fish, 30% of the adult figures walk to the shore.
 */
export function sampleCrowd(v: Village, L: Layout, max = 48): Figure[] {
  const pop = popOf(v);
  if (!pop) return [];
  const n = Math.min(max, Math.max(2, Math.round(pop / 6)));
  const A = adults(v), nA = Math.max(pop > 0 && A > 0 ? 1 : 0, Math.round(n * A / pop));
  const nK = Math.round(n * kids(v) / pop), nE = Math.max(0, n - nA - nK);
  const counts = apportion(v.jobs, nA);
  const nh = Math.max(1, houseCount(v, L)), nf = fieldCount(v, L);
  const home = (k: number) => L.houses[Math.floor(hash3(k, 3, v.id) * nh)] ?? { x: v.x, y: v.y };
  const shore = { x: v.x + (v.px - v.x) * 0.85, y: v.y + (v.py - v.y) * 0.85 };
  const out: Figure[] = [];
  let k = 0;
  for (const job of JOBS) {
    for (let i = 0; i < counts[job]; i++, k++) {
      const h = home(k), r1 = hash3(k, 4, v.id), r2 = hash3(k, 5, v.id);
      let tx = h.x, ty = h.y;
      if (job === "farmer" && nf) { const f = L.fields[Math.floor(r1 * nf)]; tx = f.x; ty = f.y; }
      else if (job === "fisher" || job === "boatwright") { tx = shore.x + (r1 - 0.5) * 0.05; ty = shore.y + (r2 - 0.5) * 0.05; }
      else if (job === "gatherer") { const g = L.ring[Math.floor(r1 * L.ring.length)]; tx = g.x; ty = g.y; }
      else if (job === "warrior") { const g = L.ring[Math.floor(r1 * L.ring.length)]; tx = v.x + (g.x - v.x) * 0.7; ty = v.y + (g.y - v.y) * 0.7; }
      else if (job === "leader" || job === "priest") { tx = v.x + (r1 - 0.5) * 0.02; ty = v.y + (r2 - 0.5) * 0.02; }
      else if (job === "builder") { const b = L.houses[Math.min(nh, L.houses.length - 1)] ?? h; tx = b.x; ty = b.y; }
      else if (job === "woodcutter") { const g = L.ring[Math.floor(r1 * L.ring.length)]; tx = v.x + (g.x - v.x) * 1.25; ty = v.y + (g.y - v.y) * 1.25; }
      else if (job === "quarrier") { tx = L.quarry.x + (r1 - 0.5) * 0.03; ty = L.quarry.y + (r2 - 0.5) * 0.03; }
      else if (job === "miner") { tx = L.mine.x + (r1 - 0.5) * 0.02; ty = L.mine.y + (r2 - 0.5) * 0.02; }
      else if (job === "worker") { const a = Math.atan2(v.y - v.py, v.x - v.px) + (r1 - 0.5) * 0.9; tx = v.x + Math.cos(a) * L.R * 1.1; ty = v.y + Math.sin(a) * L.R * 0.94; }
      else if (job === "scientist") { tx = v.x + (r1 - 0.5) * 0.06; ty = v.y + (r2 - 0.5) * 0.06; }
      else if (job === "smith") { tx = L.forge.x + (r1 - 0.5) * 0.01; ty = L.forge.y + (r2 - 0.5) * 0.01; }
      out.push({ job, sex: hash3(k, 6, v.id) < 0.5 ? "m" : "f", hx: h.x, hy: h.y, tx, ty, ph: hash3(k, 7, v.id) * 10, sp: 0.06 + hash3(k, 8, v.id) * 0.05 });
    }
  }
  for (let i = 0; i < nK; i++, k++) {
    const h = home(k), a = hash3(k, 4, v.id) * 6.283;
    out.push({ job: "child", sex: hash3(k, 6, v.id) < 0.5 ? "m" : "f", hx: h.x, hy: h.y, tx: h.x + Math.cos(a) * 0.03, ty: h.y + Math.sin(a) * 0.03, ph: hash3(k, 7, v.id) * 10, sp: 0.15 });
  }
  for (let i = 0; i < nE; i++, k++) {
    const h = home(k);
    out.push({ job: "elder", sex: hash3(k, 6, v.id) < 0.5 ? "m" : "f", hx: h.x, hy: h.y, tx: h.x + 0.006, ty: h.y + 0.004, ph: hash3(k, 7, v.id) * 10, sp: 0.03 });
  }
  return out;
}

/** Where a figure is at time t: rest at home, walk out, work, walk back. */
export function figurePos(p: Figure, t: number): [number, number, boolean] {
  const cyc = (t * p.sp + p.ph) % 4;
  let u = cyc < 1 ? 0 : cyc < 2 ? cyc - 1 : cyc < 3 ? 1 : 4 - cyc;
  u = u * u * (3 - 2 * u);
  let x = p.hx + (p.tx - p.hx) * u, y = p.hy + (p.ty - p.hy) * u;
  const idle = cyc < 1 || (cyc >= 2 && cyc < 3);
  if (idle) { x += Math.sin(t * 0.8 + p.ph) * 0.004; y += Math.cos(t * 0.6 + p.ph) * 0.003; }
  return [x, y, !idle];
}

export type FigureState = "home" | "out" | "work" | "back";
/** Position plus what the figure is doing, for animation: resting at home, walking out, working, walking back. */
export function figureState(p: Figure, t: number): { x: number; y: number; state: FigureState; hx: number; hy: number } {
  const cyc = (t * p.sp + p.ph) % 4;
  const [x, y] = figurePos(p, t);
  const state: FigureState = cyc < 1 ? "home" : cyc < 2 ? "out" : cyc < 3 ? "work" : "back";
  const tx = state === "back" ? p.hx : p.tx, ty = state === "back" ? p.hy : p.ty;
  return { x, y, state, hx: tx - x, hy: ty - y };
}
