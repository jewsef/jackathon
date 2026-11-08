import type { Terrain } from "../sim/terrain";
import { WX, WY, SEA } from "../sim/terrain";

/** Vertical exaggeration: elevation units to world units. The islands read as a tilted diorama. */
export const VSCALE = 1.4;

/**
 * A sampled copy of the terrain's elevation (height minus sea level) on a regular grid,
 * built once from the same deterministic function the simulation uses.
 */
export class HeightField {
  readonly nx: number; readonly ny: number; readonly data: Float32Array;
  readonly dx: number; readonly dy: number;

  constructor(nx: number, ny: number, data: Float32Array) {
    this.nx = nx; this.ny = ny; this.data = data;
    this.dx = WX / (nx - 1); this.dy = WY / (ny - 1);
  }

  static build(t: Terrain, nx = 961, ny = 541, oct = 6): HeightField {
    const data = new Float32Array(nx * ny), C = 6;
    const dx = WX / (nx - 1), dy = WY / (ny - 1);
    const cw = Math.ceil(nx / C) + 2, ch = Math.ceil(ny / C) + 2, B = new Float32Array(cw * ch);
    for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) B[j * cw + i] = t.islandBase(i * C * dx, j * C * dy);
    for (let j = 0; j < ny; j++) {
      const fj = j / C, j0 = Math.floor(fj), tj = fj - j0;
      for (let i = 0; i < nx; i++) {
        const fi = i / C, i0 = Math.floor(fi), ti = fi - i0, a = j0 * cw + i0;
        const b = B[a] * (1 - ti) * (1 - tj) + B[a + 1] * ti * (1 - tj) + B[a + cw] * (1 - ti) * tj + B[a + cw + 1] * ti * tj;
        data[j * nx + i] = b + t.detail(i * dx, j * dy, oct) - SEA;
      }
    }
    return new HeightField(nx, ny, data);
  }

  /** Bilinear elevation at a world point. Outside the map it is deep ocean. */
  elevAt(x: number, y: number): number {
    if (x < 0 || y < 0 || x > WX || y > WY) return -0.33;
    const fx = x / this.dx, fy = y / this.dy;
    const i = Math.min(this.nx - 2, Math.floor(fx)), j = Math.min(this.ny - 2, Math.floor(fy));
    const tx = fx - i, ty = fy - j, k = j * this.nx + i, d = this.data;
    return d[k] * (1 - tx) * (1 - ty) + d[k + 1] * tx * (1 - ty) + d[k + this.nx] * (1 - tx) * ty + d[k + this.nx + 1] * tx * ty;
  }
  /** Height of the ground (or sea floor) in world units. */
  groundY(x: number, y: number): number { return this.elevAt(x, y) * VSCALE; }
  /** Height of whatever you would stand on: land, or the sea surface. */
  surfaceY(x: number, y: number): number { return Math.max(0, this.groundY(x, y)); }
}
