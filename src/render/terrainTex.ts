import type { Terrain } from "../sim/terrain";
import { SEA } from "../sim/terrain";
import { hash3 } from "../sim/rng";

type RGB = [number, number, number];
const P: Record<string, RGB> = {
  abyss: [15, 36, 64], shoal: [44, 104, 136], reef: [86, 170, 170], foam: [205, 228, 232],
  strand: [214, 196, 150], meadow: [136, 168, 92], grove: [64, 112, 72], upland: [150, 140, 98],
  scree: [132, 124, 118], cap: [236, 238, 240]
};
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const sstep = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export interface Tree { x: number; y: number; s: number; pine: boolean; }
export interface Region { canvas: HTMLCanvasElement; x0: number; y0: number; ww: number; wh: number; sx: number; trees: Tree[]; }

/**
 * Paint a region of the world as a hand-tinted relief map: contour bands, hillshade, sea depth.
 * Detail octaves grow with zoom, so a zoomed chunk has more coastline than the world map.
 */
export function renderRegion(t: Terrain, x0: number, y0: number, ww: number, wh: number, pw: number, ph: number, wantTrees: boolean, avoid: { x: number; y: number; r: number }[] = []): Region {
  const sx = ww / pw, sy = wh / ph, gw = pw + 2, gh = ph + 2;
  const oct = clamp(Math.round(6 + Math.log2(Math.max(1, 1 / (sx * 60)))), 6, 11);
  const C = 8, cw = Math.ceil(gw / C) + 2, ch = Math.ceil(gh / C) + 2;
  const B = new Float32Array(cw * ch), MO = new Float32Array(cw * ch);
  for (let j = 0; j < ch; j++) for (let i = 0; i < cw; i++) {
    const qx = x0 + (i * C - 0.5) * sx, qy = y0 + (j * C - 0.5) * sy;
    B[j * cw + i] = t.islandBase(qx, qy); MO[j * cw + i] = t.moistAt(qx, qy);
  }
  const G = new Float32Array(gw * gh), MM = new Float32Array(gw * gh);
  for (let j = 0; j < gh; j++) {
    const fj = j / C, j0 = Math.floor(fj), tj = fj - j0;
    for (let i = 0; i < gw; i++) {
      const fi = i / C, i0 = Math.floor(fi), ti = fi - i0, a = j0 * cw + i0;
      const w00 = (1 - ti) * (1 - tj), w10 = ti * (1 - tj), w01 = (1 - ti) * tj, w11 = ti * tj;
      MM[j * gw + i] = MO[a] * w00 + MO[a + 1] * w10 + MO[a + cw] * w01 + MO[a + cw + 1] * w11;
      G[j * gw + i] = B[a] * w00 + B[a + 1] * w10 + B[a + cw] * w01 + B[a + cw + 1] * w11 + t.detail(x0 + (i - 0.5) * sx, y0 + (j - 0.5) * sy, oct);
    }
  }
  const canvas = document.createElement("canvas"); canvas.width = pw; canvas.height = ph;
  const g = canvas.getContext("2d")!, img = g.createImageData(pw, ph), D = img.data;
  for (let j = 1; j <= ph; j++) for (let i = 1; i <= pw; i++) {
    const k = j * gw + i, h = G[k], el = h - SEA, m = MM[k];
    const hl = G[k - 1], hr = G[k + 1], hu = G[k - gw], hd = G[k + gw];
    let c: RGB;
    if (el < 0) {
      const dep = -el;
      c = dep < 0.04 ? mix(P.reef, P.shoal, dep / 0.04) : mix(P.shoal, P.abyss, Math.pow(clamp((dep - 0.04) / 0.26, 0, 1), 0.8));
      if (hl >= SEA || hr >= SEA || hu >= SEA || hd >= SEA) c = mix(c, P.foam, 0.5);
    } else {
      if (el < 0.015) c = P.strand;
      else if (el < 0.15) c = mix(P.meadow, P.grove, clamp((m - 0.35) * 2.2, 0, 1));
      else if (el < 0.24) c = mix(P.grove, P.upland, sstep(0.15, 0.21, el));
      else if (el < 0.36) c = P.scree;
      else c = P.cap;
      const shade = clamp(1 + ((hl - hr) / sx + (hu - hd) / sy) * 0.11, 0.6, 1.35);
      c = [c[0] * shade, c[1] * shade, c[2] * shade];
      const band = Math.floor(h * 30);
      if (band !== Math.floor(hr * 30) || band !== Math.floor(hd * 30)) c = [c[0] * 0.85, c[1] * 0.85, c[2] * 0.85];
    }
    const o = ((j - 1) * pw + (i - 1)) * 4;
    D[o] = c[0]; D[o + 1] = c[1]; D[o + 2] = c[2]; D[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const trees: Tree[] = [];
  if (wantTrees) {
    const cs = 0.02;
    for (let gy = Math.floor(y0 / cs); gy < Math.ceil((y0 + wh) / cs) && trees.length < 9000; gy++)
      for (let gx = Math.floor(x0 / cs); gx < Math.ceil((x0 + ww) / cs); gx++) {
        const tx = (gx + hash3(gx, gy, 71)) * cs, ty = (gy + hash3(gx, gy, 73)) * cs;
        const pi = Math.floor((tx - x0) / sx) + 1, pj = Math.floor((ty - y0) / sy) + 1;
        if (pi < 1 || pj < 1 || pi > pw || pj > ph) continue;
        const kk = pj * gw + pi, tel = G[kk] - SEA, tm = MM[kk];
        if (tel < 0.02 || tel > 0.24 || hash3(gx, gy, 72) > (tm - 0.3) * 1.15) continue;
        if (avoid.some((a) => Math.hypot(tx - a.x, ty - a.y) < a.r)) continue;
        trees.push({ x: tx, y: ty, s: 0.7 + hash3(gx, gy, 74) * 0.6, pine: tel > 0.15 });
      }
  }
  return { canvas, x0, y0, ww, wh, sx, trees };
}
