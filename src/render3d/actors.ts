import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { World, Village, Voyage, Agent, Tribe } from "../sim/types";
import type { Terrain } from "../sim/terrain";
import { WX, WY } from "../sim/terrain";
import { hash3 } from "../sim/rng";
import { popOf } from "../sim/util";
import { voyagePos } from "../sim/voyages";
import { layoutFor, sampleCrowd, figurePos, houseCount, fieldCount, type Figure } from "../render/crowd";
import type { HeightField } from "./heightfield";

type Snap = Omit<World, "chronicle">;
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3(), tmpE = new THREE.Euler(), tmpC = new THREE.Color();

/** House walls follow each island's main material: brick, reed, timber, stone. */
const WALL: Record<string, string> = { hearth: "#c38a6c", kelp: "#d9caa6", thorn: "#9a6a44", gull: "#a9a59e", far: "#7e5c48" };
const CROPS = ["#c6b060", "#849e4a", "#9c7c52"];
const STRAW = "#e6d49a";

function inst(geo: THREE.BufferGeometry, max: number, mat: THREE.Material) {
  const m = new THREE.InstancedMesh(geo, mat, max);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.count = 0; m.frustumCulled = false;
  m.setColorAt(0, new THREE.Color(1, 1, 1));
  return m;
}
function put(m: THREE.InstancedMesh, i: number, x: number, y: number, z: number, rotY: number, sx: number, sy: number, sz: number, color?: string | THREE.Color, rotX = 0, rotZ = 0) {
  tmpE.set(rotX, rotY, rotZ); tmpQ.setFromEuler(tmpE);
  tmpM.compose(tmpP.set(x, y, z), tmpQ, tmpS.set(sx, sy, sz));
  m.setMatrixAt(i, tmpM);
  if (color !== undefined) m.setColorAt(i, typeof color === "string" ? tmpC.set(color) : color);
}
function finish(m: THREE.InstancedMesh, n: number) {
  m.count = n; m.instanceMatrix.needsUpdate = true;
  if (m.instanceColor) m.instanceColor.needsUpdate = true;
}
const lambert = (opts: THREE.MeshLambertMaterialParameters = {}) => new THREE.MeshLambertMaterial({ color: 0xffffff, ...opts });

function glowTexture(inner: string, outer: string) {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d")!, gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, inner); gr.addColorStop(0.35, outer); gr.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function cloudTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 128;
  const g = c.getContext("2d")!;
  for (let k = 0; k < 9; k++) {
    const x = 34 + Math.random() * 60, y = 44 + Math.random() * 40, r = 22 + Math.random() * 18;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, "rgba(255,255,255,0.85)"); gr.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
  return new THREE.CanvasTexture(c);
}

export interface NamedSpot { a: Agent; x: number; y: number; h: number; }

/** Everything that stands on the map. Positions come from the world snapshot and the crowd sampler. */
export class Actors {
  group = new THREE.Group();
  private hf: HeightField; private terrain: Terrain;
  // static-ish
  private trees: { x: number; y: number; s: number; pine: boolean }[] = [];
  private pines: THREE.InstancedMesh; private broad: THREE.InstancedMesh;
  private houseBody: THREE.InstancedMesh; private houseRoof: THREE.InstancedMesh;
  private fields: THREE.InstancedMesh; private posts: THREE.InstancedMesh; private granary: THREE.InstancedMesh; private granaryRoof: THREE.InstancedMesh;
  // people
  private parts: Record<string, THREE.InstancedMesh> = {};
  private rings: THREE.InstancedMesh;
  // boats
  private hull: THREE.InstancedMesh; private raft: THREE.InstancedMesh; private sail: THREE.InstancedMesh; private outrig: THREE.InstancedMesh;
  // lights and sky things
  private glows: THREE.Sprite[] = []; private glowTex = glowTexture("rgba(255,230,170,1)", "rgba(242,178,87,0.5)");
  private clouds: { s: THREE.Sprite; x: number; y: number; h: number; k: number }[] = [];
  private smoke: { s: THREE.Sprite; t0: number }[] = [];
  private smokeTex = glowTexture("rgba(80,70,66,0.9)", "rgba(60,52,50,0.45)");
  private lavaTex = glowTexture("rgba(255,170,90,1)", "rgba(224,90,50,0.6)");
  private lava: THREE.Sprite[] = [];
  private crowdCache = new Map<string, Figure[]>();
  private villageKey = "";
  named: NamedSpot[] = [];

  private low: boolean;
  constructor(hf: HeightField, terrain: Terrain, low = false) {
    this.hf = hf; this.terrain = terrain; this.low = low;
    const G = this.group;
    this.pines = inst(new THREE.ConeGeometry(0.42, 1.1, 6).translate(0, 0.62, 0), 60000, lambert());
    this.broad = inst(new THREE.SphereGeometry(0.5, 7, 5).translate(0, 0.7, 0), 60000, lambert());
    this.houseBody = inst(new THREE.BoxGeometry(1, 0.7, 1).translate(0, 0.35, 0), 8000, lambert());
    this.houseRoof = inst(new THREE.ConeGeometry(0.82, 0.62, 4).rotateY(Math.PI / 4).translate(0, 1.0, 0), 8000, lambert());
    this.fields = inst(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), 8000, lambert({ side: THREE.DoubleSide }));
    this.posts = inst(new THREE.CylinderGeometry(0.5, 0.5, 1, 5).translate(0, 0.5, 0), 8000, lambert());
    this.granary = inst(new THREE.CylinderGeometry(0.5, 0.55, 0.8, 10).translate(0, 0.4, 0), 400, lambert());
    this.granaryRoof = inst(new THREE.ConeGeometry(0.62, 0.5, 10).translate(0, 1.05, 0), 400, lambert());
    G.add(this.pines, this.broad, this.houseBody, this.houseRoof, this.fields, this.posts, this.granary, this.granaryRoof);
    // Tailfolk in 3D: legs, torso, sash, arms, head, straw hat, two-tone tail, tool
    const arms = mergeGeometries([new THREE.BoxGeometry(0.1, 0.34, 0.12).translate(-0.27, 0.56, 0), new THREE.BoxGeometry(0.1, 0.34, 0.12).translate(0.27, 0.56, 0)])!;
    const defs: Record<string, THREE.BufferGeometry> = {
      legs: new THREE.BoxGeometry(0.34, 0.38, 0.24).translate(0, 0.19, 0),
      torso: new THREE.BoxGeometry(0.42, 0.32, 0.26).translate(0, 0.54, 0),
      sash: new THREE.BoxGeometry(0.45, 0.08, 0.29).translate(0, 0.41, 0),
      arms,
      head: new THREE.SphereGeometry(0.17, 10, 8).translate(0, 0.83, 0),
      hat: new THREE.ConeGeometry(0.38, 0.2, 14).translate(0, 1.0, 0),
      tail: new THREE.SphereGeometry(0.15, 8, 6).scale(1, 1, 2.3).rotateX(0.55).translate(0, 0.36, -0.28),
      tip: new THREE.SphereGeometry(0.11, 8, 6).translate(0, 0.53, -0.52),
      tool: new THREE.CylinderGeometry(0.025, 0.025, 0.95, 5).translate(0.33, 0.5, 0.05)
    };
    for (const [k, g] of Object.entries(defs)) { this.parts[k] = inst(g, 4000, lambert()); G.add(this.parts[k]); }
    this.rings = inst(new THREE.RingGeometry(0.55, 0.7, 28).rotateX(-Math.PI / 2).translate(0, 0.03, 0), 64, new THREE.MeshBasicMaterial({ color: 0xf2b257, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
    G.add(this.rings);
    // boats, facing +x
    this.hull = inst(new THREE.CylinderGeometry(0.16, 0.06, 1, 7).rotateZ(Math.PI / 2).scale(1, 0.55, 1).translate(0, 0.05, 0), 600, lambert());
    this.raft = inst(new THREE.BoxGeometry(0.7, 0.08, 0.5).translate(0, 0.04, 0), 600, lambert());
    const sailGeo = new THREE.BufferGeometry();
    sailGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0.12, 0.1, 0, -0.32, 1.0, 0, -0.38, 0.1, 0]), 3));
    sailGeo.computeVertexNormals();
    this.sail = inst(sailGeo, 600, lambert({ side: THREE.DoubleSide }));
    this.outrig = inst(mergeGeometries([new THREE.BoxGeometry(0.8, 0.06, 0.06).translate(0, 0.04, 0.42), new THREE.BoxGeometry(0.05, 0.05, 0.42).translate(0.2, 0.1, 0.21), new THREE.BoxGeometry(0.05, 0.05, 0.42).translate(-0.2, 0.1, 0.21)])!, 600, lambert());
    G.add(this.hull, this.raft, this.sail, this.outrig);
    this.plantTrees();
    const ctex = cloudTexture();
    for (let i = 0; i < (low ? 90 : 230); i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: ctex, transparent: true, depthWrite: false, opacity: 0.6, fog: false }));
      const k = 0.8 + Math.random() * 1.4;
      s.scale.set(k * 1.6, k, 1);
      this.clouds.push({ s, x: -3 + Math.random() * (WX + 6), y: -3 + Math.random() * (WY + 6), h: 1.25 + Math.random() * 0.45, k: Math.random() });
      s.renderOrder = 5;
      G.add(s);
    }
  }

  private plantTrees() {
    const cs = this.low ? 0.06 : 0.034, t = this.terrain;
    for (let gy = 0; gy < WY / cs; gy++) for (let gx = 0; gx < WX / cs; gx++) {
      const x = (gx + hash3(gx, gy, 71)) * cs, y = (gy + hash3(gx, gy, 73)) * cs;
      const el = this.hf.elevAt(x, y);
      if (el < 0.02 || el > 0.25) continue;
      const m = t.moistAt(x, y);
      if (hash3(gx, gy, 72) > (m - 0.28) * 1.2) continue;
      this.trees.push({ x, y, s: 0.75 + hash3(gx, gy, 74) * 0.6, pine: el > 0.15 || hash3(gx, gy, 75) < 0.25 });
    }
    this.layoutTrees([]);
  }
  /** Clear trees where villages stand; a village's land is cleared for fields. */
  private layoutTrees(villages: Village[]) {
    let ip = 0, ib = 0;
    for (const tr of this.trees) {
      if (villages.some((v) => Math.abs(v.x - tr.x) < 0.42 && Math.abs(v.y - tr.y) < 0.42 && Math.hypot(v.x - tr.x, v.y - tr.y) < 0.21 + Math.min(0.2, Math.sqrt(popOf(v)) / 120))) continue;
      const y = this.hf.groundY(tr.x, tr.y), k = 0.013 * tr.s;
      const shade = 0.75 + hash3(Math.round(tr.x * 100), Math.round(tr.y * 100), 9) * 0.35;
      if (tr.pine) put(this.pines, ip++, tr.x, y, tr.y, 0, k * 0.9, k * 1.3, k * 0.9, tmpC.setRGB(0.18 * shade, 0.33 * shade, 0.24 * shade));
      else put(this.broad, ib++, tr.x, y, tr.y, 0, k, k, k, tmpC.setRGB(0.24 * shade, 0.42 * shade, 0.24 * shade));
    }
    finish(this.pines, ip); finish(this.broad, ib);
  }

  /** Rebuild villages: houses, fields, walls, granaries. Called when a new snapshot arrives. */
  updateStatic(w: Snap) {
    const live = w.villages.filter((v) => !v.lost);
    const key = live.map((v) => v.id + ":" + Math.round(Math.sqrt(popOf(v)))).join(",");
    if (key !== this.villageKey) { this.villageKey = key; this.layoutTrees(live); }
    let ih = 0, ifl = 0, ip = 0, ig = 0;
    for (const v of live) {
      const L = layoutFor(this.terrain, v), t = w.tribes[v.tribe];
      const wall = WALL[t?.home ?? "hearth"] ?? WALL.hearth, roof = t?.top ?? "#96543c";
      for (let i = 0; i < houseCount(v, L); i++) {
        const h = L.houses[i], s = 0.014 * (0.8 + h.v * 0.5), y = this.hf.groundY(h.x, h.y);
        put(this.houseBody, ih, h.x, y, h.y, h.v * 3, s, s, s, wall);
        put(this.houseRoof, ih, h.x, y, h.y, h.v * 3, s, s, s, h.v > 0.6 ? "#b89a5a" : roof);
        ih++;
      }
      for (let i = 0; i < fieldCount(v, L); i++) {
        const f = L.fields[i];
        put(this.fields, ifl++, f.x, this.hf.surfaceY(f.x, f.y) + 0.0025, f.y, -f.r, f.w, 1, f.h, CROPS[f.c]);
      }
      const def = Math.floor(v.defense);
      if (def >= 1) {
        const n = 44, R = 0.24, stone = def >= 4;
        for (let k = 0; k < n; k++) {
          const a = (k / n) * Math.PI * 2, x = v.x + Math.cos(a) * R, y = v.y + Math.sin(a) * R * 0.85;
          if (this.hf.elevAt(x, y) < 0.002) continue;
          put(this.posts, ip++, x, this.hf.groundY(x, y), y, 0, stone ? 0.016 : 0.006, stone ? 0.02 : 0.024, stone ? 0.016 : 0.006, stone ? "#9a9490" : "#7a5a38");
        }
      }
      if (v.granary >= 1) {
        const x = v.x + 0.05, y = v.y - 0.03, gy = this.hf.groundY(x, y);
        put(this.granary, ig, x, gy, y, 0, 0.02, 0.02, 0.02, "#c8a060"); put(this.granaryRoof, ig, x, gy, y, 0, 0.02, 0.02, 0.02, "#a8803e"); ig++;
      }
    }
    finish(this.houseBody, ih); finish(this.houseRoof, ih); finish(this.fields, ifl); finish(this.posts, ip); finish(this.granary, ig); finish(this.granaryRoof, ig);
    this.crowdCache.clear();
  }

  private figure(n: number, x: number, z: number, yaw: number, scale: number, t: Tribe, sex: "m" | "f", job: string, bob: number, sway: number) {
    const y = this.hf.surfaceY(x, z) + bob, P = this.parts, sash = job === "doctor" ? "#5d7a4a" : job === "priest" ? "#5a8fb0" : job === "warrior" ? "#8f2f2a" : t.sash;
    put(P.legs, n, x, y, z, yaw, scale, scale, scale, t.cloth);
    put(P.torso, n, x, y, z, yaw, scale, scale, scale, sex === "f" ? t.top : t.skin);
    put(P.sash, n, x, y, z, yaw, scale, scale, scale, sash);
    put(P.arms, n, x, y, z, yaw, scale, scale, scale, t.skin);
    put(P.head, n, x, y, z, yaw, scale, scale, scale, t.skin);
    put(P.hat, n, x, y, z, yaw, scale, scale, scale, STRAW);
    put(P.tail, n, x, y, z, yaw + sway, scale, scale, scale, t.tail);
    put(P.tip, n, x, y, z, yaw + sway, scale, scale, scale, t.tip);
  }

  /** Per-frame: people, named agents, boats, lights, clouds and smoke. */
  updateDynamic(w: Snap, time: number, z: number, inView: (x: number, y: number, m: number) => boolean, camY: number, dayLight: number) {
    let n = 0, nt = 0;
    const tools = new Set(["farmer", "fisher", "warrior", "builder", "boatwright", "priest"]);
    this.named = [];
    if (z > 4.2) {
      for (const v of w.villages) {
        if (v.lost || !inView(v.x, v.y, 0.5)) continue;
        const t = w.tribes[v.tribe]; if (!t) continue;
        const key = v.id + ":" + popOf(v) + ":" + Math.round(v.jobs.farmer * 50) + ":" + Math.floor(v.houses);
        let crowd = this.crowdCache.get(key);
        if (!crowd) { crowd = sampleCrowd(v, layoutFor(this.terrain, v), 60); this.crowdCache.set(key, crowd); }
        for (const p of crowd) {
          if (n >= 3900) break;
          const [x, y, walking] = figurePos(p, time), [x2, y2] = figurePos(p, time + 0.05);
          if (!inView(x, y, 0.05)) continue;
          const yaw = walking ? Math.atan2(x2 - x, y2 - y) : p.ph;
          const bob = walking ? Math.abs(Math.sin(time * 7 + p.ph)) * 0.0012 : 0;
          const sc = p.job === "child" ? 0.0078 : 0.011;
          this.figure(n, x, y, yaw, sc, t, p.sex, p.job, bob, Math.sin(time * (walking ? 6 : 2) + p.ph) * 0.35);
          if (tools.has(p.job)) put(this.parts.tool, nt++, x, this.hf.surfaceY(x, y) + bob, y, yaw, sc, sc, sc, "#7a5532");
          n++;
        }
      }
    }
    let nr = 0;
    for (const a of w.agents) {
      if (!a.alive) continue;
      const voy = w.voyages.find((x) => x.captain === a.id);
      const v = w.villages.find((x) => x.id === a.village);
      let x: number, y: number;
      if (voy) [x, y] = voyagePos(voy as Voyage);
      else if (v && !v.lost) {
        const ang = (a.id * 2.39996) % 6.283, shore = ["Captain", "Boatwright", "Voyager"].includes(a.role);
        const d = shore ? 0 : 0.035 + (a.id % 5) * 0.012;
        x = v.x + Math.cos(ang) * d + (shore ? (v.px - v.x) * 0.8 : 0); y = v.y + Math.sin(ang) * d * 0.8 + (shore ? (v.py - v.y) * 0.8 : 0);
        if (this.hf.elevAt(x, y) < 0) { x = v.x + Math.cos(ang) * 0.02; y = v.y + Math.sin(ang) * 0.02; }
      } else continue;
      if (!inView(x, y, 0.1)) continue;
      const h = this.hf.surfaceY(x, y);
      this.named.push({ a, x, y, h });
      if (z > 4.2 && !voy && n < 3990) {
        const t = w.tribes[a.tribe];
        const job = { Leader: "leader", "Sky-speaker": "priest", Doctor: "doctor", "War leader": "warrior" }[a.role] ?? "";
        this.figure(n++, x, y, Math.sin(time * 0.3 + a.id) * 0.6, 0.0125, t, a.sex, job, 0, Math.sin(time * 2 + a.id) * 0.3);
        put(this.rings, nr++, x, h, y, 0, 0.012, 0.012, 0.012);
      }
    }
    for (const k of Object.keys(this.parts)) if (k !== "tool") finish(this.parts[k], n);
    finish(this.parts.tool, nt); finish(this.rings, nr);
    (this.rings.material as THREE.MeshBasicMaterial).opacity = 0.6 + 0.3 * Math.sin(time * 3);

    // boats: voyages, route traffic, fishing boats
    let nh = 0, nf = 0, ns = 0, no = 0;
    const boat = (x: number, y: number, head: number, tier: number, size: number) => {
      if (nh + nf > 590) return;
      const rock = Math.sin(time * 1.6 + x * 9) * 0.12, yy = Math.sin(time * 1.3 + x * 7 + y * 5) * 0.002;
      const yaw = -head;
      if (tier <= 1) put(this.raft, nf++, x, yy, y, yaw, size, size, size, "#a8865a", 0, rock);
      else {
        put(this.hull, nh++, x, yy, y, yaw, size, size, size, "#8a6440", rock, 0);
        if (tier >= 3) put(this.outrig, no++, x, yy, y, yaw, size, size, size, "#8a6440", rock, 0);
        if (tier >= 4) put(this.sail, ns++, x, yy, y, yaw, size, size, size, "#f6ecd6", rock, 0);
      }
    };
    for (const voy of w.voyages) {
      const [x, y] = voyagePos(voy as Voyage);
      if (!inView(x, y, 0.3)) continue;
      const head = voy.leg === "out" ? Math.atan2(voy.ty - voy.fy, voy.tx - voy.fx) : Math.atan2(voy.fy - voy.ty, voy.fx - voy.tx);
      boat(x, y, head, voy.tier, voy.tier >= 4 ? 0.05 : 0.038);
    }
    for (const r of w.routes) {
      const A = w.villages.find((v) => v.id === r.a), B = w.villages.find((v) => v.id === r.b);
      if (!A || !B || r.strength < 0.2) continue;
      const L = Math.hypot(B.px - A.px, B.py - A.py) || 1, cyc = (time * 0.12 / L + (r.id % 7) / 7) % 2, u = cyc < 1 ? cyc : 2 - cyc;
      const x = A.px + (B.px - A.px) * u, y = A.py + (B.py - A.py) * u;
      if (inView(x, y, 0.2)) boat(x, y, Math.atan2(B.py - A.py, B.px - A.px) + (cyc < 1 ? 0 : Math.PI), r.tier, 0.034);
    }
    if (z > 1.6) for (const v of w.villages) {
      if (v.lost || !v.coastal || !inView(v.px, v.py, 0.3)) continue;
      const cnt = Math.min(4, Math.round(v.jobs.fisher * v.men / 6)), tier = w.tribes[v.tribe]?.techs.includes("canoe") ? 2 : 1;
      for (let k = 0; k < cnt; k++) {
        const a = Math.atan2(v.py - v.y, v.px - v.x) + (hash3(k, v.id, 20) - 0.5) * 1.6, d = 0.06 + hash3(k, v.id, 21) * 0.14;
        const x = v.px + Math.cos(a) * d + Math.sin(time * 0.3 + k) * 0.01, y = v.py + Math.sin(a) * d + Math.cos(time * 0.27 + k) * 0.008;
        if (this.hf.elevAt(x, y) > -0.006) continue;
        boat(x, y, a + Math.sin(time * 0.5 + k) * 0.4, tier, 0.026);
      }
    }
    finish(this.hull, nh); finish(this.raft, nf); finish(this.sail, ns); finish(this.outrig, no);

    // village lights: bright from afar and at night
    let gi = 0;
    for (const v of w.villages) {
      if (v.lost) continue;
      let g = this.glows[gi];
      if (!g) { g = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })); this.glows.push(g); this.group.add(g); }
      const pop = popOf(v), far = THREE.MathUtils.clamp(1 - (z - 2.2) / 2.5, 0, 1), night = 1 - dayLight;
      const a = Math.max(far * 0.9, night * 0.85);
      g.visible = a > 0.02;
      const size = (0.05 + Math.sqrt(pop) / 90) * (far > 0 ? Math.max(1, 3 / Math.max(z, 1)) : 1) * (0.9 + 0.1 * Math.sin(time * 2.3 + v.x * 7));
      g.position.set(v.x, this.hf.surfaceY(v.x, v.y) + 0.03, v.y);
      g.scale.set(size, size, 1);
      const m = g.material as THREE.SpriteMaterial;
      m.opacity = a * (v.hungry > 1 ? 0.5 : 1);
      m.color.set(v.sick ? 0xff8a70 : 0xffffff);
      gi++;
    }
    for (let i = gi; i < this.glows.length; i++) this.glows[i].visible = false;

    // clouds drift; storms darken and thicken them, drought and calm thin them out
    const fade = THREE.MathUtils.smoothstep(camY, 1.6, 3.2);
    for (const c of this.clouds) {
      let wind = 0.03, add = 0, dark = 0;
      for (const e of w.effects) {
        const d = Math.hypot(c.x - e.x, c.y - e.y); if (d > e.r * 1.3) continue;
        const k = 1 - d / (e.r * 1.3);
        if (e.power === "rain") add += 0.5 * k; else if (e.power === "storm") { add += 0.9 * k; dark += k; }
        else if (e.power === "drought" || e.power === "calm") add -= 0.8 * k; else if (e.power === "wind") wind += 0.4 * k;
      }
      c.x += wind * 0.016; if (c.x > WX + 3) c.x -= WX + 6;
      c.s.position.set(c.x, c.h, c.y);
      const base = c.k < 0.3 ? 0.42 : 0.06;
      const m = c.s.material as THREE.SpriteMaterial;
      m.opacity = THREE.MathUtils.clamp(base + add, 0, 0.9) * fade;
      c.s.visible = m.opacity > 0.01;
      const dk = Math.min(1, dark), lit = 0.35 + 0.65 * dayLight;
      m.color.setRGB((1 - 0.65 * dk) * lit, (1 - 0.6 * dk) * lit, (1 - 0.52 * dk) * lit);
    }

    // eruption: lava glow and an ash column drifting east
    const young = w.effects.filter((e) => e.power === "eruption" && e.age < 12);
    for (let i = 0; i < young.length; i++) {
      let l = this.lava[i];
      if (!l) { l = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.lavaTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })); this.lava.push(l); this.group.add(l); }
      const e = young[i];
      l.visible = true; l.position.set(e.x, this.hf.surfaceY(e.x, e.y) + 0.05, e.y); l.scale.setScalar(0.35 + 0.05 * Math.sin(time * 5));
      if (Math.random() < 0.3) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.smokeTex, transparent: true, depthWrite: false }));
        s.position.copy(l.position); this.smoke.push({ s, t0: time }); this.group.add(s);
      }
    }
    for (let i = young.length; i < this.lava.length; i++) this.lava[i].visible = false;
    this.smoke = this.smoke.filter((p) => {
      const age = time - p.t0;
      if (age > 6) { this.group.remove(p.s); p.s.material.dispose(); return false; }
      p.s.position.y += 0.004; p.s.position.x += 0.003;
      p.s.scale.setScalar(0.12 + age * 0.12); p.s.material.opacity = Math.max(0, 0.8 - age / 7);
      return true;
    });
  }

  setPeopleVisible(on: boolean) { for (const k of Object.keys(this.parts)) this.parts[k].visible = on; this.rings.visible = on; }
  setVillagesVisible(on: boolean) { for (const m of [this.houseBody, this.houseRoof, this.fields, this.posts, this.granary, this.granaryRoof]) m.visible = on; }
}
