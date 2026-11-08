import type { Village, Tribe } from "../sim/types";
import type { Terrain } from "../sim/terrain";
import { hash3 } from "../sim/rng";
import type { Layout } from "./crowd";

/**
 * Town planning and roads. Everything here is a pure function of the terrain and the village
 * record, so the same world always draws the same streets.
 */

export interface Street { ax: number; ay: number; bx: number; by: number; main: boolean; }
export interface Plot { x: number; y: number; rot: number; d: number; v: number; }
export interface TownPlan {
  angle: number;
  streets: Street[];
  plots: Plot[];
  plaza: { x: number; y: number };
  palace: { x: number; y: number };
  temple: { x: number; y: number };
  market: { x: number; y: number };
  avenues: number[];
  harbour: { x: number; y: number; a: number } | null;
}

export const BLOCK = 0.05;
const planCache = new Map<string, TownPlan>();
const landOk = (t: Terrain, x: number, y: number) => { const e = t.elev(x, y, 7); return e > 0.004 && e < 0.27; };

/** A grid plan aligned to the harbour: avenues through the centre, blocks of four houses between streets. */
export function planFor(t: Terrain, v: Village, L: Layout): TownPlan {
  const key = t.seed + ":" + v.id;
  const hit = planCache.get(key);
  if (hit) return hit;
  const toSea = Math.atan2(v.py - v.y, v.px - v.x);
  const angle = v.coastal ? toSea : hash3(v.id, 3, 17) * Math.PI;
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const world = (u: number, w: number) => ({ x: v.x + u * ca - w * sa, y: v.y + u * sa + w * ca });
  const R = L.R * 1.02, K = Math.floor(R / BLOCK);
  const streets: Street[] = [];
  // streets along both grid axes, clipped to the town circle and to land
  for (let k = -K; k <= K; k++) for (const axis of [0, 1]) {
    const off = k * BLOCK, half = Math.sqrt(Math.max(0, R * R - off * off));
    if (half < BLOCK * 0.6) continue;
    let run: { x: number; y: number } | null = null, prev: { x: number; y: number } | null = null;
    const steps = Math.ceil((2 * half) / 0.01);
    for (let i = 0; i <= steps; i++) {
      const s = -half + (2 * half * i) / steps;
      const p = axis === 0 ? world(s, off) : world(off, s);
      const ok = t.elev(p.x, p.y, 7) > 0.003;
      if (ok && !run) run = p;
      if ((!ok || i === steps) && run) {
        const end = ok ? p : prev!;
        if (Math.hypot(end.x - run.x, end.y - run.y) > 0.02) streets.push({ ax: run.x, ay: run.y, bx: end.x, by: end.y, main: k === 0 });
        run = null;
      }
      prev = p;
    }
  }
  // plots: four houses per block, facing the street
  const plots: Plot[] = [];
  const q = BLOCK / 4;
  for (let i = -K - 1; i <= K; i++) for (let j = -K - 1; j <= K; j++) {
    const cu = (i + 0.5) * BLOCK, cw = (j + 0.5) * BLOCK;
    if (Math.hypot(cu, cw) > R) continue;
    if ((i === 0 || i === -1) && (j === -1 || j === 0)) continue; // plaza, palace, temple and market blocks
    for (const [du, dw] of [[-q, -q], [q, -q], [-q, q], [q, q]]) {
      const p = world(cu + du, cw + dw);
      if (!landOk(t, p.x, p.y)) continue;
      plots.push({ x: p.x, y: p.y, rot: -angle + (dw < 0 ? Math.PI : 0), d: Math.hypot(cu + du, cw + dw), v: hash3(i * 7 + (du > 0 ? 1 : 0), j * 7 + (dw > 0 ? 1 : 0), v.id) });
    }
  }
  plots.sort((a, b) => a.d - b.d);
  const plaza = world(0.5 * BLOCK, -0.5 * BLOCK), palace = world(-0.5 * BLOCK, -0.5 * BLOCK), temple = world(-0.5 * BLOCK, 0.5 * BLOCK), market = world(0.5 * BLOCK, 0.5 * BLOCK);
  const avenues = [angle, angle + Math.PI / 2, angle + Math.PI, angle - Math.PI / 2];
  let harbour: TownPlan["harbour"] = null;
  if (v.coastal) harbour = { x: v.px, y: v.py, a: toSea };
  const out = { angle, streets, plots, plaza, palace, temple, market, avenues, harbour };
  planCache.set(key, out);
  return out;
}

/** Is a town laid out on a grid? Towns and cities of a tribe that knows town planning. */
export function isPlanned(v: Village, t: Tribe | undefined) {
  return !!t && (v.stage === "city" || (v.stage === "town" && t.techs.includes("planning")));
}

/** Road quality: 0 footpath, 1 cart track (the wheel), 2 paved road. */
export function roadTier(t: Tribe | undefined) {
  if (!t) return 0;
  return t.techs.includes("roads") ? 2 : t.techs.includes("wheel") ? 1 : 0;
}

// ---------- roads between villages ----------

const pathCache = new Map<string, [number, number][] | null>();

/** Cheapest path across land, avoiding steep slopes and water. A* on a coarse grid, then smoothed. */
export function landPath(t: Terrain, ax: number, ay: number, bx: number, by: number, step = 0.025): [number, number][] | null {
  const key = `${t.seed}:${ax.toFixed(3)},${ay.toFixed(3)}>${bx.toFixed(3)},${by.toFixed(3)}`;
  if (pathCache.has(key)) return pathCache.get(key)!;
  const m = 0.35;
  const x0 = Math.min(ax, bx) - m, y0 = Math.min(ay, by) - m;
  const W = Math.ceil((Math.abs(ax - bx) + 2 * m) / step) + 1, H = Math.ceil((Math.abs(ay - by) + 2 * m) / step) + 1;
  const N = W * H, el = new Float32Array(N);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) el[j * W + i] = t.elev(x0 + i * step, y0 + j * step, 5);
  const idx = (x: number, y: number) => Math.round((y - y0) / step) * W + Math.round((x - x0) / step);
  const s = idx(ax, ay), g = idx(bx, by), gi = g % W, gj = Math.floor(g / W);
  const cost = new Float32Array(N).fill(Infinity), from = new Int32Array(N).fill(-1), done = new Uint8Array(N);
  const heap = new MinHeap();
  cost[s] = 0; heap.push(0, s);
  const D = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.414], [1, -1, 1.414], [-1, 1, 1.414], [-1, -1, 1.414]];
  let found = false, guard = 0;
  while (heap.size && guard++ < N * 4) {
    const n = heap.pop();
    if (done[n]) continue;
    done[n] = 1;
    if (n === g) { found = true; break; }
    const i = n % W, j = Math.floor(n / W);
    for (const [di, dj, dl] of D) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
      const nn = nj * W + ni;
      if (done[nn]) continue;
      const e = el[nn];
      if (e < 0.003 && nn !== g) continue;
      const slope = Math.abs(e - el[n]) / (step * dl);
      const c = cost[n] + dl * (1 + slope * 6 + slope * slope * 40 + (e > 0.22 ? 3 : 0));
      if (c < cost[nn]) { cost[nn] = c; from[nn] = n; heap.push(c + Math.hypot(ni - gi, nj - gj) * 0.9, nn); }
    }
  }
  if (!found) { pathCache.set(key, null); return null; }
  let pts: [number, number][] = [];
  for (let n = g; n !== -1; n = from[n]) pts.push([x0 + (n % W) * step, y0 + Math.floor(n / W) * step]);
  pts.reverse();
  pts[0] = [ax, ay]; pts[pts.length - 1] = [bx, by];
  for (let k = 0; k < 2; k++) pts = chaikin(pts);
  pathCache.set(key, pts);
  return pts;
}

class MinHeap {
  private f: number[] = []; private n: number[] = [];
  get size() { return this.n.length; }
  push(f: number, n: number) {
    const F = this.f, Nn = this.n;
    let c = F.length; F.push(f); Nn.push(n);
    while (c > 0) { const p = (c - 1) >> 1; if (F[p] <= f) break; F[c] = F[p]; Nn[c] = Nn[p]; c = p; }
    F[c] = f; Nn[c] = n;
  }
  pop(): number {
    const F = this.f, Nn = this.n, top = Nn[0];
    const lf = F.pop()!, ln = Nn.pop()!, L = F.length;
    if (L) {
      let c = 0;
      for (;;) { const l = c * 2 + 1, r = l + 1; let m = c, mf = lf; if (l < L && F[l] < mf) { m = l; mf = F[l]; } if (r < L && F[r] < mf) m = r; if (m === c) break; F[c] = F[m]; Nn[c] = Nn[m]; c = m; }
      F[c] = lf; Nn[c] = ln;
    }
    return top;
  }
}

function chaikin(p: [number, number][]): [number, number][] {
  if (p.length < 3) return p;
  const out: [number, number][] = [p[0]];
  for (let i = 0; i < p.length - 1; i++) {
    const [x0, y0] = p[i], [x1, y1] = p[i + 1];
    out.push([x0 * 0.75 + x1 * 0.25, y0 * 0.75 + y1 * 0.25], [x0 * 0.25 + x1 * 0.75, y0 * 0.25 + y1 * 0.75]);
  }
  out.push(p[p.length - 1]);
  return out;
}

export interface Road { pts: [number, number][]; tier: number; a: number; b: number; }

/** Roads between the villages of each island: a minimum spanning tree, so every village is joined once. */
export function roadNetwork(t: Terrain, villages: Village[], tribes: Tribe[]): Road[] {
  const out: Road[] = [];
  const byIsle = new Map<string, Village[]>();
  for (const v of villages) if (!v.lost && v.stage !== "band") byIsle.set(v.isle, [...(byIsle.get(v.isle) ?? []), v]);
  for (const vs of byIsle.values()) {
    if (vs.length < 2) continue;
    vs.sort((a, b) => a.id - b.id);
    const inTree = new Set([vs[0].id]);
    while (inTree.size < vs.length) {
      let best: [Village, Village, number] | null = null;
      for (const a of vs) if (inTree.has(a.id)) for (const b of vs) if (!inTree.has(b.id)) {
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (!best || d < best[2]) best = [a, b, d];
      }
      if (!best) break;
      const [a, b] = best;
      inTree.add(b.id);
      if (best[2] > 2.5) continue;
      const pts = landPath(t, a.x, a.y, b.x, b.y);
      if (!pts) continue;
      const ta = tribes[a.tribe], tb = tribes[b.tribe];
      out.push({ pts, tier: Math.min(roadTier(ta), roadTier(tb)), a: a.id, b: b.id });
    }
  }
  return out;
}

/** Short tracks from the village to its work sites and harbour. */
export function villageTracks(t: Terrain, v: Village, L: Layout, sites: { quarry: boolean; mine: boolean }): [number, number][][] {
  const out: [number, number][][] = [];
  const add = (x: number, y: number) => { const p = landPath(t, v.x, v.y, x, y, 0.02); if (p) out.push(p); };
  if (sites.quarry && t.elev(L.quarry.x, L.quarry.y, 6) > 0) add(L.quarry.x, L.quarry.y);
  if (sites.mine && t.elev(L.mine.x, L.mine.y, 6) > 0) add(L.mine.x, L.mine.y);
  if (v.coastal) { const hx = v.x + (v.px - v.x) * 0.9, hy = v.y + (v.py - v.y) * 0.9; if (t.elev(hx, hy, 6) > 0) out.push([[v.x, v.y], [hx, hy]]); }
  return out;
}
