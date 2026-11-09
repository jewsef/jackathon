import { Rng } from "./rng";
import { fbm, clamp, sstep } from "./noise";

export type IsleId = "hearth" | "kelp" | "thorn" | "gull" | "far" | "iron" | "spice" | "great";
export const ISLE_IDS: IsleId[] = ["hearth", "kelp", "thorn", "gull", "far", "iron", "spice", "great"];
/** Each island's landform: what kind of land it is, which shapes how people can live on it. */
export type Form = "plains" | "lowland" | "hills" | "plateau" | "spine" | "shield" | "highland" | "continent";
export const FORM: Record<IsleId, Form> = { hearth: "plains", kelp: "lowland", thorn: "hills", gull: "plateau", far: "spine", iron: "highland", spice: "shield", great: "continent" };
/** The coast sits at this fraction of each island's nominal radius. */
const COAST = 0.6;
/** Bays and headlands: wobble the distance to the coast instead of roughening the land. */
const coastWobble = (x: number, y: number, s: number) => 1 + (fbm(x * 1.2, y * 1.2, s + 201, 4) - 0.5) * 0.62 + (fbm(x * 4.5, y * 4.5, s + 202, 3) - 0.5) * 0.24;
/** Ridged noise for mountain crests. */
const ridge = (x: number, y: number, s: number) => { const n = 1 - Math.abs(fbm(x, y, s, 4) * 2 - 1); return n * n; };
/** The lands beyond the horizon: only ocean-going ships can reach them. */
export const OUTER: IsleId[] = ["iron", "spice", "great"];
export const isOuter = (i: IsleId) => i === "iron" || i === "spice" || i === "great";

export interface IsleDef {
  id: IsleId; name: string; cx: number; cy: number; rx: number; ry: number; amp: number; sh: number;
  resource: string;
}
export interface Site { x: number; y: number; px: number; py: number; coastal: boolean; fert: number; isle: IsleId; }
export interface Crossing { a: IsleId; b: IsleId; dist: number; maxDepth: number; tier: number; ax: number; ay: number; bx: number; by: number; }

/** The whole world is 28 x 15.75 units. One unit is about 8 km. The home archipelago fills the first 16 x 9. */
export const WX = 28, WY = 15.75, SEA = 0.5, KM_PER_UNIT = 8;
export const HOME = { x0: 0, y0: 0, w: 16, h: 9 };
/** Is a point in the home waters (as opposed to the lands beyond the horizon)? */
export const inHome = (x: number, y: number) => x < HOME.w + 0.8 && y < HOME.h + 0.8;

const BASE: Omit<IsleDef, "cx" | "cy" | "rx" | "ry">[] = [
  { id: "hearth", name: "Hearth", amp: 0.62, sh: 1.8, resource: "grain" },
  { id: "kelp", name: "Kelp Isle", amp: 0.5, sh: 2.0, resource: "fish" },
  { id: "thorn", name: "Thornholm", amp: 0.56, sh: 2.0, resource: "hardwood" },
  { id: "gull", name: "Gull Rock", amp: 0.62, sh: 2.0, resource: "feathers" },
  { id: "far", name: "The Far Shore", amp: 0.66, sh: 1.35, resource: "obsidian" },
  { id: "iron", name: "The Iron Coast", amp: 0.72, sh: 1.5, resource: "iron" },
  { id: "spice", name: "The Spice Isles", amp: 0.55, sh: 1.8, resource: "spice" },
  { id: "great", name: "The Great Land", amp: 0.64, sh: 1.25, resource: "furs and timber" }
];
const LAYOUT: Record<IsleId, [number, number, number, number]> = {
  hearth: [4.8, 4.7, 2.9, 2.2],
  kelp: [7.55, 3.0, 1.05, 0.85],
  thorn: [8.2, 7.1, 1.2, 0.95],
  gull: [2.25, 1.6, 0.85, 0.72],
  far: [13.9, 4.4, 1.95, 3.1],
  iron: [22.6, 3.4, 2.4, 1.9],
  spice: [23.8, 11.8, 1.5, 1.2],
  great: [10.5, 13.75, 5.2, 1.65]
};

export function makeIsles(seed: number): IsleDef[] {
  const r = new Rng(seed ^ 0x51ed27);
  return BASE.map((b) => {
    const [cx, cy, rx, ry] = LAYOUT[b.id];
    const j = b.id === "far" ? 0.3 : b.id === "hearth" ? 0.2 : b.id === "kelp" ? 0.1 : b.id === "great" ? 0.12 : 0.16;
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

  /**
   * The land's large-scale shape at a point, and how rough the ground is there (0.1 on plains,
   * up to 1 in mountains). Every island has its own landform: farm plains, an atoll with a lagoon,
   * rolling hills, a cliff plateau, a mountain spine, highlands, an old volcano, a prairie.
   */
  shape(x: number, y: number): [number, number] {
    const S = this.seed;
    const wx = x + (fbm(x * 0.32 + 3, y * 0.32, S + 11, 3) - 0.5) * 0.8;
    const wy = y + (fbm(x * 0.32, y * 0.32 + 9, S + 12, 3) - 0.5) * 0.8;
    const wob = coastWobble(x, y, S);
    let best = -0.33, rough = 0.15;
    for (const I of this.isles) {
      const dx = (wx - I.cx) / I.rx / COAST, dy = (wy - I.cy) / I.ry / COAST;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) continue;
      const d = Math.sqrt(dx * dx + dy * dy) * wob;
      let e: number, r = 0.12;
      if (d >= 1) {
        // a narrow shelf of shallow water, then the deep sea
        e = -0.008 - 0.07 * sstep(1, 1.2, d) - 0.25 * sstep(1.12, 1.55 + (I.sh / COAST - 1) * 0.15, d);
      } else {
        const u = 1 - d, beach = sstep(0, 0.07, u), rg = ridge(x * 1.1, y * 1.1, S + 77);
        // gentle rolling ground everywhere: walkable, but never a table top
        const swell = (fbm(x * 0.9, y * 0.9, S + 303, 3) - 0.5) * 0.04 * sstep(0.08, 0.3, u);
        switch (FORM[I.id]) {
          case "plains": { // wide farmland, low downs in the middle
            const hills = sstep(0.3, 0.9, u);
            e = beach * (0.016 + 0.04 * u) + hills * (0.03 + 0.08 * rg + 0.05 * fbm(x * 2.2, y * 2.2, S + 404, 3)); r = 0.1 + 0.4 * hills; break;
          }
          case "lowland": { // sand and grass around a shallow lagoon
            const lag = sstep(0.5, 0.68, u);
            e = beach * (0.014 + 0.03 * u) * (1 - lag) - 0.022 * lag; r = 0.08; break;
          }
          case "hills": { // rolling forested hills and valleys
            e = beach * (0.02 + 0.08 * u + 0.07 * fbm(x * 1.6, y * 1.6, S + 91, 3) * sstep(0.15, 0.6, u)); r = 0.3; break;
          }
          case "plateau": { // sea cliffs, then a flat grassy top
            e = sstep(0, 0.16, u) * 0.095 + 0.02 * u; r = 0.1 + 0.25 * (1 - sstep(0, 0.2, u)); break;
          }
          case "spine": { // coastal plains either side of a mountain range
            const a = Math.abs(dx) / Math.max(0.2, Math.sqrt(Math.max(0, 1 - dy * dy)));
            const mtn = sstep(0.2, 0.75, 1 - a) * sstep(0.05, 0.4, u);
            e = beach * (0.016 + 0.04 * u) + mtn * (0.1 + 0.24 * rg); r = 0.1 + 0.9 * mtn; break;
          }
          case "shield": { // a gentle old volcano with a crater lake
            e = beach * (0.014 + 0.2 * Math.pow(u, 2.2)) - 0.05 * sstep(0.9, 1, u); r = 0.15 + 0.3 * sstep(0.6, 1, u); break;
          }
          case "highland": { // upland moors and ore-bearing ridges
            const up = sstep(0.1, 0.5, u);
            e = beach * 0.022 + up * (0.08 + 0.14 * rg * sstep(0.35, 1, u)); r = 0.2 + 0.7 * up; break;
          }
          default: { // the Great Land: prairie, with a mountain range in the east
            const east = sstep(0.15, 0.65, dx) * sstep(0.12, 0.5, u);
            e = beach * (0.016 + 0.04 * u) + east * (0.1 + 0.22 * rg); r = 0.1 + 0.8 * east; break;
          }
        }
        if (FORM[I.id] !== "lowland") e += swell;
      }
      if (e > best) { best = e; rough = r; }
    }
    return [SEA + best, rough];
  }
  islandBase(x: number, y: number): number { return this.shape(x, y)[0]; }
  /** Inland water (Kelp Isle's lagoon, crater lakes): wet, but no way out to sea. */
  inland(x: number, y: number): boolean {
    const id = this.isleAt(x, y);
    if (!id) return false;
    const I = this.byId[id], dx = (x - I.cx) / I.rx / COAST, dy = (y - I.cy) / I.ry / COAST;
    return Math.sqrt(dx * dx + dy * dy) < 0.75;
  }
  /** Open sea: water that boats can sail out of. */
  openSea(x: number, y: number): boolean { return this.elev(x, y, 5) < 0 && !this.inland(x, y); }
  detail(x: number, y: number, oct: number): number { return (fbm(x * 0.6, y * 0.6, this.seed, oct) - 0.5) * 0.42; }
  heightAt(x: number, y: number, oct = 6): number { const [b, r] = this.shape(x, y); return b + this.detail(x, y, oct) * r; }
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
  findSpot(x: number, y: number, lo: number, hi: number, maxR = 1.8, sea = false): [number, number] | null {
    for (let r = 0; r < maxR; r += 0.025) {
      const steps = Math.max(1, Math.round(r * 50));
      for (let s = 0; s < steps; s++) {
        const a = (s / steps) * Math.PI * 2 + r * 3, px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
        const el = this.elev(px, py, 6);
        if (el > lo && el < hi && (!sea || !this.inland(px, py))) return [px, py];
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
          if (this.openSea(x + Math.cos(a) * 0.16, y + Math.sin(a) * 0.16)) coastal = true;
        }
        const m = this.moistAt(x, y), fert = clamp(0.45 + m * 0.5 - Math.max(0, el - 0.09) * 3, 0.2, 1);
        cands.push({ x, y, px: x, py: y, coastal, fert, isle: id, q: fert + (coastal ? 0.25 : 0) + (el < 0.07 ? 0.1 : 0) });
      }
    }
    cands.sort((a, b) => b.q - a.q);
    const out: Site[] = [], minD = id === "gull" || id === "kelp" ? 0.42 : 0.6;
    for (const c of cands) {
      if (out.every((o) => Math.hypot(o.x - c.x, o.y - c.y) >= minD)) {
        const p = c.coastal ? this.findSpot(c.x, c.y, -0.06, -0.012, 0.6, true) : null;
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
    // the wide ocean between the home waters and the lands beyond needs ocean-going ships
    const tier = isOuter(a) || isOuter(b) ? 6 : dist <= 1.45 ? 1 : dist <= 2.6 ? 2 : dist <= 3.4 ? 3 : 5;
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
