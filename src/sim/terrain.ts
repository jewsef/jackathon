import { Rng } from "./rng";
import { fbm, clamp, sstep } from "./noise";

export type IsleId = "hearth" | "kelp" | "thorn" | "gull" | "far";
export const ISLE_IDS: IsleId[] = ["hearth", "kelp", "thorn", "gull", "far"];

export interface IsleDef {
  id: IsleId; name: string; cx: number; cy: number; rx: number; ry: number; amp: number; sh: number;
  resource: string;
}
export interface Site { x: number; y: number; px: number; py: number; coastal: boolean; fert: number; isle: IsleId; }
export interface Crossing { a: IsleId; b: IsleId; dist: number; maxDepth: number; tier: number; ax: number; ay: number; bx: number; by: number; }

/** World is 16 x 9 units. One unit is about 8 km. */
export const WX = 16, WY = 9, SEA = 0.5, KM_PER_UNIT = 8;

const BASE: Omit<IsleDef, "cx" | "cy" | "rx" | "ry">[] = [
  { id: "hearth", name: "Hearth", amp: 0.62, sh: 1.8, resource: "grain" },
  { id: "kelp", name: "Kelp Isle", amp: 0.5, sh: 2.0, resource: "fish" },
  { id: "thorn", name: "Thornholm", amp: 0.56, sh: 2.0, resource: "hardwood" },
  { id: "gull", name: "Gull Rock", amp: 0.62, sh: 2.0, resource: "feathers" },
  { id: "far", name: "The Far Shore", amp: 0.66, sh: 1.35, resource: "obsidian" }
];
const LAYOUT: Record<IsleId, [number, number, number, number]> = {
  hearth: [4.8, 4.7, 2.9, 2.2],
  kelp: [7.55, 3.0, 1.05, 0.85],
  thorn: [8.2, 7.1, 1.2, 0.95],
  gull: [2.25, 1.6, 0.85, 0.72],
  far: [13.9, 4.4, 1.95, 3.1]
};

export function makeIsles(seed: number): IsleDef[] {
  const r = new Rng(seed ^ 0x51ed27);
  return BASE.map((b) => {
    const [cx, cy, rx, ry] = LAYOUT[b.id];
    const j = b.id === "far" ? 0.3 : b.id === "hearth" ? 0.2 : b.id === "kelp" ? 0.1 : 0.16;
    return { ...b, cx: cx + r.range(-j, j), cy: cy + r.range(-j, j), rx: rx * r.range(0.93, 1.07), ry: ry * r.range(0.93, 1.07) };
  });
}

export class Terrain {
  readonly seed: number;
  readonly isles: IsleDef[];
  readonly byId: Record<IsleId, IsleDef>;
  private siteCache = new Map<IsleId, Site[]>();
  private crossCache = new Map<string, Crossing>();
  private _volcanoes?: Record<IsleId, { x: number; y: number }>;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.isles = makeIsles(this.seed);
    this.byId = Object.fromEntries(this.isles.map((i) => [i.id, i])) as Record<IsleId, IsleDef>;
  }

  /** Smooth large-scale shape: island domes plus continental shelves. */
  islandBase(x: number, y: number): number {
    const S = this.seed;
    const wx = x + (fbm(x * 0.32 + 3, y * 0.32, S + 11, 3) - 0.5) * 1.1;
    const wy = y + (fbm(x * 0.32, y * 0.32 + 9, S + 12, 3) - 0.5) * 1.1;
    let land = 0, shelf = 0;
    for (const I of this.isles) {
      const dx = (wx - I.cx) / I.rx, dy = (wy - I.cy) / I.ry, d = Math.sqrt(dx * dx + dy * dy);
      const s = sstep(0, 1, 1 - d) * I.amp; if (s > land) land = s;
      const sh = sstep(0, 1, 1 - d / I.sh); if (sh > shelf) shelf = sh;
    }
    return 0.17 + land + shelf * 0.13;
  }
  detail(x: number, y: number, oct: number): number { return (fbm(x * 0.6, y * 0.6, this.seed, oct) - 0.5) * 0.42; }
  heightAt(x: number, y: number, oct = 6): number { return this.islandBase(x, y) + this.detail(x, y, oct); }
  moistAt(x: number, y: number): number { return clamp((fbm(x * 0.45 + 30, y * 0.45 + 4, this.seed + 500, 3) - 0.3) / 0.4, 0, 1); }
  elev(x: number, y: number, oct = 6): number { return this.heightAt(x, y, oct) - SEA; }
  isLand(x: number, y: number): boolean { return this.elev(x, y, 5) > 0; }

  /** Which island a point belongs to (nearest island in normalised distance). */
  isleAt(x: number, y: number): IsleId | null {
    let best: IsleId | null = null, bd = 1e9;
    for (const I of this.isles) {
      const dx = (x - I.cx) / I.rx, dy = (y - I.cy) / I.ry, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = I.id; }
    }
    return bd < 1.6 ? best : null;
  }

  /** Spiral search for the nearest point whose elevation lies in [lo, hi]. */
  findSpot(x: number, y: number, lo: number, hi: number, maxR = 1.8): [number, number] | null {
    for (let r = 0; r < maxR; r += 0.025) {
      const steps = Math.max(1, Math.round(r * 50));
      for (let s = 0; s < steps; s++) {
        const a = (s / steps) * Math.PI * 2 + r * 3, px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
        const el = this.elev(px, py, 6);
        if (el > lo && el < hi) return [px, py];
      }
    }
    return null;
  }

  /** Candidate village sites on an island, best first, spaced apart. */
  sites(id: IsleId): Site[] {
    const cached = this.siteCache.get(id);
    if (cached) return cached;
    const I = this.byId[id], cands: (Site & { q: number })[] = [];
    for (let y = I.cy - I.ry; y <= I.cy + I.ry; y += 0.09) {
      for (let x = I.cx - I.rx; x <= I.cx + I.rx; x += 0.09) {
        if (this.isleAt(x, y) !== id) continue;
        const el = this.elev(x, y, 6);
        if (el < 0.012 || el > 0.16) continue;
        let coastal = false;
        for (let k = 0; k < 8 && !coastal; k++) {
          const a = (k / 8) * Math.PI * 2;
          if (this.elev(x + Math.cos(a) * 0.16, y + Math.sin(a) * 0.16, 5) < 0) coastal = true;
        }
        const m = this.moistAt(x, y), fert = clamp(0.45 + m * 0.5 - Math.max(0, el - 0.09) * 3, 0.2, 1);
        cands.push({ x, y, px: x, py: y, coastal, fert, isle: id, q: fert + (coastal ? 0.25 : 0) + (el < 0.07 ? 0.1 : 0) });
      }
    }
    cands.sort((a, b) => b.q - a.q);
    const out: Site[] = [], minD = id === "gull" || id === "kelp" ? 0.42 : 0.6;
    for (const c of cands) {
      if (out.every((o) => Math.hypot(o.x - c.x, o.y - c.y) >= minD)) {
        const p = c.coastal ? this.findSpot(c.x, c.y, -0.06, -0.012, 0.6) : null;
        out.push({ x: c.x, y: c.y, px: p ? p[0] : c.x, py: p ? p[1] : c.y, coastal: c.coastal, fert: c.fert, isle: id });
      }
      if (out.length >= 12) break;
    }
    this.siteCache.set(id, out);
    return out;
  }

  /** Sea crossing between two islands along the line joining their centres. */
  crossing(a: IsleId, b: IsleId): Crossing {
    const key = a < b ? a + ":" + b : b + ":" + a;
    const hit = this.crossCache.get(key);
    if (hit) return hit.a === a ? hit : { ...hit, a, b, ax: hit.bx, ay: hit.by, bx: hit.ax, by: hit.ay };
    const A = this.byId[a], B = this.byId[b], N = 240;
    let exitT = 0, entryT = 1, maxDepth = 0;
    let lastLandA = 0, firstLandB = 1;
    for (let i = 0; i <= N; i++) {
      const t = i / N, x = A.cx + (B.cx - A.cx) * t, y = A.cy + (B.cy - A.cy) * t;
      if (this.elev(x, y, 5) > 0 && this.isleAt(x, y) === a) lastLandA = t;
    }
    for (let i = N; i >= 0; i--) {
      const t = i / N, x = A.cx + (B.cx - A.cx) * t, y = A.cy + (B.cy - A.cy) * t;
      if (this.elev(x, y, 5) > 0 && this.isleAt(x, y) === b) firstLandB = t;
    }
    exitT = lastLandA; entryT = Math.max(firstLandB, exitT);
    for (let i = 0; i <= N; i++) {
      const t = exitT + (entryT - exitT) * (i / N), x = A.cx + (B.cx - A.cx) * t, y = A.cy + (B.cy - A.cy) * t;
      maxDepth = Math.max(maxDepth, -this.elev(x, y, 5));
    }
    const len = Math.hypot(B.cx - A.cx, B.cy - A.cy), dist = (entryT - exitT) * len;
    const tier = dist <= 1.45 ? 1 : dist <= 2.6 ? 2 : dist <= 3.4 ? 3 : 5;
    const c: Crossing = {
      a, b, dist, maxDepth, tier,
      ax: A.cx + (B.cx - A.cx) * exitT, ay: A.cy + (B.cy - A.cy) * exitT,
      bx: A.cx + (B.cx - A.cx) * entryT, by: A.cy + (B.cy - A.cy) * entryT
    };
    this.crossCache.set(key, c);
    return c;
  }

  /** Highest point of each island: where an eruption happens. */
  volcano(id: IsleId): { x: number; y: number } {
    if (!this._volcanoes) {
      const v = {} as Record<IsleId, { x: number; y: number }>;
      for (const I of this.isles) {
        let best = -1, bx = I.cx, by = I.cy;
        for (let y = I.cy - I.ry * 0.7; y <= I.cy + I.ry * 0.7; y += 0.08)
          for (let x = I.cx - I.rx * 0.7; x <= I.cx + I.rx * 0.7; x += 0.08) {
            const h = this.heightAt(x, y, 5); if (h > best) { best = h; bx = x; by = y; }
          }
        v[I.id] = { x: bx, y: by };
      }
      this._volcanoes = v;
    }
    return this._volcanoes[id];
  }
}

const terrainCache = new Map<number, Terrain>();
export function getTerrain(seed: number): Terrain {
  let t = terrainCache.get(seed >>> 0);
  if (!t) { t = new Terrain(seed); terrainCache.set(seed >>> 0, t); }
  return t;
}
