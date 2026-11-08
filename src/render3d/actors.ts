import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { World, Village, Voyage, Agent, Tribe, Fx } from "../sim/types";
import type { Terrain } from "../sim/terrain";
import { WX, WY } from "../sim/terrain";
import { hash3 } from "../sim/rng";
import { popOf } from "../sim/util";
import { voyagePos } from "../sim/voyages";
import { layoutFor, sampleCrowd, figureState, houseCount, fieldCount, type Figure, type FigureState } from "../render/crowd";
import type { Selection } from "../render/common";
import type { HeightField } from "./heightfield";

type Snap = Omit<World, "chronicle">;
const tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3(), tmpE = new THREE.Euler(), tmpC = new THREE.Color();
const mA = new THREE.Matrix4(), mB = new THREE.Matrix4(), mR = new THREE.Matrix4(), mBase = new THREE.Matrix4(), mUpper = new THREE.Matrix4(), mArm = new THREE.Matrix4(), mOut = new THREE.Matrix4();

/** Each island builds with its own material and shape. */
const STYLE: Record<string, { kind: "gable" | "round" | "long" | "stone" | "tent"; wall: string; roof: string; stilts?: boolean; landmark: "barn" | "racks" | "hall" | "stones" | "totem" }> = {
  hearth: { kind: "gable", wall: "#c38a6c", roof: "#c9a75a", landmark: "barn" },
  kelp: { kind: "round", wall: "#d9caa6", roof: "#b89a5a", stilts: true, landmark: "racks" },
  thorn: { kind: "long", wall: "#9a6a44", roof: "#5d4a38", landmark: "hall" },
  gull: { kind: "stone", wall: "#a9a59e", roof: "#6d7480", landmark: "stones" },
  far: { kind: "tent", wall: "#8a6a50", roof: "#3a2c24", landmark: "totem" }
};
const CROPS = ["#c6b060", "#849e4a", "#9c7c52"];
const STRAW = "#e6d49a";
const TOOL_JOBS = new Set(["farmer", "fisher", "warrior", "builder", "boatwright", "priest"]);

function inst(geo: THREE.BufferGeometry, max: number, mat: THREE.Material) {
  const m = new THREE.InstancedMesh(geo, mat, max);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.count = 0; m.frustumCulled = false;
  m.setColorAt(0, new THREE.Color(1, 1, 1));
  return m;
}
function compose(out: THREE.Matrix4, x: number, y: number, z: number, rotY: number, sx: number, sy: number, sz: number, rotX = 0, rotZ = 0) {
  tmpE.set(rotX, rotY, rotZ); tmpQ.setFromEuler(tmpE);
  return out.compose(tmpP.set(x, y, z), tmpQ, tmpS.set(sx, sy, sz));
}
function put(m: THREE.InstancedMesh, i: number, x: number, y: number, z: number, rotY: number, sx: number, sy: number, sz: number, color?: string | THREE.Color, rotX = 0, rotZ = 0) {
  m.setMatrixAt(i, compose(mA, x, y, z, rotY, sx, sy, sz, rotX, rotZ));
  if (color !== undefined) m.setColorAt(i, typeof color === "string" ? tmpC.set(color) : color);
}
function putM(m: THREE.InstancedMesh, i: number, mat: THREE.Matrix4, color: string) { m.setMatrixAt(i, mat); m.setColorAt(i, tmpC.set(color)); }
function finish(m: THREE.InstancedMesh, n: number) {
  m.count = n; m.instanceMatrix.needsUpdate = true;
  if (m.instanceColor) m.instanceColor.needsUpdate = true;
}
const lambert = (opts: THREE.MeshLambertMaterialParameters = {}) => new THREE.MeshLambertMaterial({ color: 0xffffff, ...opts });
/** Rig helpers: a translation, or a rotation about X or Y, each in a reused matrix. */
const T = (x: number, y: number, z: number) => mB.makeTranslation(x, y, z);
const RX = (a: number) => mR.makeRotationX(a);
const RY = (a: number) => mR.makeRotationY(a);

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

/** Pose of one figure: body bend, leg and arm swings, tail motion, bob. */
interface Pose { bend: number; legL: number; legR: number; armL: number; armR: number; bob: number; tail: number; lift: number; }
export function pose(state: FigureState | "idle", job: string, t: number, ph: number): Pose {
  const p: Pose = { bend: 0, legL: 0, legR: 0, armL: 0.05, armR: 0.05, bob: 0, tail: Math.sin(t * 2 + ph) * 0.3, lift: 0 };
  if (state === "out" || state === "back") {
    const speed = job === "child" ? 11 : job === "elder" ? 4 : 7, s = Math.sin(t * speed + ph);
    p.legL = s * 0.6; p.legR = -s * 0.6; p.armL = -s * 0.5; p.armR = s * 0.5;
    p.bob = Math.abs(Math.cos(t * speed + ph)) * (job === "child" ? 0.06 : 0.035);
    p.tail = Math.sin(t * speed * 0.5 + ph) * 0.55; p.bend = job === "elder" ? 0.2 : 0.05;
    return p;
  }
  if (state === "work") {
    const w = t + ph;
    switch (job) {
      case "farmer": p.bend = 0.35; p.armR = -0.3 - 0.9 * Math.abs(Math.sin(w * 3)); p.armL = p.armR * 0.8; break;
      case "builder": case "boatwright": p.bend = 0.15; p.armR = -1.6 + 1.0 * Math.abs(Math.sin(w * 6)); break;
      case "gatherer": p.bend = 0.75 + 0.1 * Math.sin(w * 2); p.armL = -0.7 + 0.2 * Math.sin(w * 4); p.armR = -0.7 - 0.2 * Math.sin(w * 4); break;
      case "fisher": { const c = (((w * 0.6) % 1) + 1) % 1; p.armR = c < 0.2 ? -2.6 * (c / 0.2) : -2.6 + 2.4 * Math.min(1, (c - 0.2) / 0.15); p.armL = -0.4; break; }
      case "priest": p.armL = -2.7 + 0.2 * Math.sin(w); p.armR = -2.7 - 0.2 * Math.sin(w); break;
      case "leader": p.armR = -1.2 + 0.4 * Math.sin(w * 2); break;
      case "doctor": p.bend = 0.45; p.armL = -0.9; p.armR = -1.0 + 0.2 * Math.sin(w * 3); break;
      case "warrior": p.armR = -0.4; p.armL = -0.2; p.tail = Math.sin(w * 1.5) * 0.2; break;
      case "child": p.bob = Math.abs(Math.sin(w * 8)) * 0.08; p.armL = -2 * Math.abs(Math.sin(w * 8)); p.armR = p.armL; break;
      default: p.armR = -0.3 * Math.abs(Math.sin(w)); break;
    }
    return p;
  }
  // resting: breathing and a slow tail
  p.bend = job === "elder" ? 0.25 : 0.02 + 0.02 * Math.sin(t * 1.3 + ph);
  return p;
}

/** Everything that stands on the map. Positions come from the world snapshot and the crowd sampler. */
export class Actors {
  group = new THREE.Group();
  private hf: HeightField; private terrain: Terrain; private low: boolean;
  private trees: { x: number; y: number; s: number; pine: boolean }[] = [];
  private pines: THREE.InstancedMesh; private broad: THREE.InstancedMesh;
  private B: Record<string, THREE.InstancedMesh> = {};
  private fields: THREE.InstancedMesh; private posts: THREE.InstancedMesh;
  private P: Record<string, THREE.InstancedMesh> = {};
  private rings: THREE.InstancedMesh;
  private hull: THREE.InstancedMesh; private raft: THREE.InstancedMesh; private sail: THREE.InstancedMesh; private outrig: THREE.InstancedMesh; private wakes: THREE.InstancedMesh;
  private routes: THREE.LineSegments; private known: THREE.LineSegments;
  private glows: THREE.Sprite[] = []; private glowTex = glowTexture("rgba(255,230,170,1)", "rgba(242,178,87,0.5)");
  private clouds: { s: THREE.Sprite; x: number; y: number; h: number; k: number }[] = [];
  private stormClouds: THREE.Sprite[] = []; private cloudTex = cloudTexture();
  private smoke: { s: THREE.Sprite; t0: number; ash: boolean }[] = [];
  private smokeTex = glowTexture("rgba(80,70,66,0.9)", "rgba(60,52,50,0.45)");
  private hearthSmokeTex = glowTexture("rgba(205,205,212,0.75)", "rgba(170,170,180,0.3)");
  private lavaTex = glowTexture("rgba(255,170,90,1)", "rgba(224,90,50,0.6)");
  private lava: THREE.Sprite[] = [];
  private rain: THREE.LineSegments; private rainPos: Float32Array; private rainN: number;
  private bolts: { line: THREE.Line; t0: number }[] = [];
  private flashLight = new THREE.PointLight(0xdfe9ff, 0, 6, 1.5);
  private crowdCache = new Map<string, Figure[]>();
  private villageKey = "";
  private chimneys: { x: number; y: number; h: number }[] = [];
  named: NamedSpot[] = [];

  constructor(hf: HeightField, terrain: Terrain, low = false) {
    this.hf = hf; this.terrain = terrain; this.low = low;
    const G = this.group;
    this.pines = inst(new THREE.ConeGeometry(0.42, 1.1, 6).translate(0, 0.62, 0), 60000, lambert());
    this.broad = inst(new THREE.SphereGeometry(0.5, 7, 5).translate(0, 0.7, 0), 60000, lambert());
    // building kits: one set of shapes per island style
    const prism = new THREE.CylinderGeometry(0.72, 0.72, 1.08, 3).rotateZ(Math.PI / 2).rotateX(-Math.PI / 2).scale(1, 0.62, 1).translate(0, 0.9, 0);
    const kit: Record<string, THREE.BufferGeometry> = {
      gableBody: new THREE.BoxGeometry(1, 0.7, 1).translate(0, 0.35, 0),
      gableRoof: prism,
      roundBody: new THREE.CylinderGeometry(0.5, 0.5, 0.6, 10).translate(0, 0.3, 0),
      roundRoof: new THREE.ConeGeometry(0.66, 0.55, 10).translate(0, 0.87, 0),
      stoneBody: new THREE.CylinderGeometry(0.55, 0.6, 0.5, 9).translate(0, 0.25, 0),
      stoneRoof: new THREE.ConeGeometry(0.7, 0.35, 9).translate(0, 0.67, 0),
      tent: new THREE.ConeGeometry(0.55, 1.0, 7).translate(0, 0.5, 0),
      tentTip: new THREE.CylinderGeometry(0.02, 0.06, 0.35, 5).translate(0, 1.05, 0),
      stone: new THREE.BoxGeometry(0.3, 1, 0.22).translate(0, 0.5, 0),
      totem: new THREE.CylinderGeometry(0.16, 0.2, 1, 8).translate(0, 0.5, 0),
      totemTop: new THREE.BoxGeometry(0.7, 0.14, 0.18).translate(0, 0.95, 0),
      rack: mergeGeometries([new THREE.BoxGeometry(0.06, 0.6, 0.06).translate(-0.5, 0.3, 0), new THREE.BoxGeometry(0.06, 0.6, 0.06).translate(0.5, 0.3, 0), new THREE.BoxGeometry(1.1, 0.05, 0.05).translate(0, 0.58, 0), new THREE.BoxGeometry(0.9, 0.25, 0.02).translate(0, 0.42, 0)])!,
      granary: new THREE.CylinderGeometry(0.5, 0.55, 0.8, 10).translate(0, 0.4, 0),
      granaryRoof: new THREE.ConeGeometry(0.62, 0.5, 10).translate(0, 1.05, 0)
    };
    for (const [k, g] of Object.entries(kit)) { this.B[k] = inst(g, 8000, lambert()); G.add(this.B[k]); }
    this.fields = inst(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), 8000, lambert({ side: THREE.DoubleSide }));
    this.posts = inst(new THREE.CylinderGeometry(0.5, 0.5, 1, 5).translate(0, 0.5, 0), 12000, lambert());
    G.add(this.pines, this.broad, this.fields, this.posts);
    // the Tailfolk rig: each part is built around its own pivot (hip, shoulder, tail root)
    const rig: Record<string, THREE.BufferGeometry> = {
      leg: new THREE.BoxGeometry(0.15, 0.38, 0.22).translate(0, -0.19, 0),
      torso: new THREE.BoxGeometry(0.42, 0.32, 0.26).translate(0, 0.16, 0),
      sash: new THREE.BoxGeometry(0.45, 0.08, 0.29).translate(0, 0.03, 0),
      arm: new THREE.BoxGeometry(0.1, 0.34, 0.12).translate(0, -0.17, 0),
      wrap: new THREE.BoxGeometry(0.12, 0.07, 0.14).translate(0, -0.28, 0),
      head: new THREE.SphereGeometry(0.17, 10, 8).translate(0, 0.45, 0),
      hat: new THREE.ConeGeometry(0.38, 0.2, 14).translate(0, 0.62, 0),
      tail: new THREE.SphereGeometry(0.15, 8, 6).scale(1, 1, 2.3).rotateX(0.55).translate(0, 0.06, -0.16),
      tip: new THREE.SphereGeometry(0.11, 8, 6).translate(0, 0.23, -0.4),
      tool: new THREE.CylinderGeometry(0.025, 0.025, 0.9, 5).rotateX(Math.PI / 2.4).translate(0, -0.36, 0.25)
    };
    const twice = new Set(["leg", "arm", "wrap"]);
    for (const [k, g] of Object.entries(rig)) { this.P[k] = inst(g, twice.has(k) ? 8000 : 4000, lambert()); G.add(this.P[k]); }
    this.rings = inst(new THREE.RingGeometry(0.55, 0.7, 28).rotateX(-Math.PI / 2).translate(0, 0.03, 0), 64, new THREE.MeshBasicMaterial({ color: 0xf2b257, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
    G.add(this.rings);
    // boats, facing +x, with a fading V wake behind them
    this.hull = inst(new THREE.CylinderGeometry(0.16, 0.06, 1, 7).rotateZ(Math.PI / 2).scale(1, 0.55, 1).translate(0, 0.05, 0), 600, lambert());
    this.raft = inst(new THREE.BoxGeometry(0.7, 0.08, 0.5).translate(0, 0.04, 0), 600, lambert());
    const sailGeo = new THREE.BufferGeometry();
    sailGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0.12, 0.1, 0, -0.32, 1.0, 0, -0.38, 0.1, 0]), 3));
    sailGeo.computeVertexNormals();
    this.sail = inst(sailGeo, 600, lambert({ side: THREE.DoubleSide }));
    this.outrig = inst(mergeGeometries([new THREE.BoxGeometry(0.8, 0.06, 0.06).translate(0, 0.04, 0.42), new THREE.BoxGeometry(0.05, 0.05, 0.42).translate(0.2, 0.1, 0.21), new THREE.BoxGeometry(0.05, 0.05, 0.42).translate(-0.2, 0.1, 0.21)])!, 600, lambert());
    const wake = new THREE.BufferGeometry();
    wake.setAttribute("position", new THREE.BufferAttribute(new Float32Array([-0.45, 0.01, 0, -2.6, 0.01, 0.6, -2.6, 0.01, 0.42, -0.45, 0.01, 0, -2.6, 0.01, -0.42, -2.6, 0.01, -0.6]), 3));
    wake.setAttribute("color", new THREE.BufferAttribute(new Float32Array([0.9, 0.95, 1, 0, 0, 0, 0, 0, 0, 0.9, 0.95, 1, 0, 0, 0, 0, 0, 0]), 3));
    this.wakes = inst(wake, 600, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    G.add(this.hull, this.raft, this.sail, this.outrig, this.wakes);
    // routes and known-world rings, drawn on the sea
    this.routes = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineDashedMaterial({ vertexColors: true, dashSize: 0.06, gapSize: 0.06, transparent: true, opacity: 0.7, depthWrite: false }));
    this.known = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75, depthWrite: false }));
    this.routes.renderOrder = 3; this.known.renderOrder = 3;
    G.add(this.routes, this.known);
    // 3D rain
    this.rainN = low ? 600 : 2200;
    this.rainPos = new Float32Array(this.rainN * 6);
    const rg = new THREE.BufferGeometry(); rg.setAttribute("position", new THREE.BufferAttribute(this.rainPos, 3));
    this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xc8dcec, transparent: true, opacity: 0.45, depthWrite: false }));
    this.rain.frustumCulled = false;
    G.add(this.rain, this.flashLight);
    this.plantTrees();
    for (let i = 0; i < (low ? 90 : 230); i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.cloudTex, transparent: true, depthWrite: false, opacity: 0.6, fog: false }));
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

  /** Rebuild villages, routes and the selected tribe's known world. Called when a snapshot arrives or the selection changes. */
  updateStatic(w: Snap, sel: Selection) {
    const live = w.villages.filter((v) => !v.lost);
    const key = live.map((v) => v.id + ":" + Math.round(Math.sqrt(popOf(v)))).join(",");
    if (key !== this.villageKey) { this.villageKey = key; this.layoutTrees(live); }
    const n: Record<string, number> = Object.fromEntries(Object.keys(this.B).map((k) => [k, 0]));
    const b = (k: string, x: number, y: number, z: number, rot: number, sx: number, sy: number, sz: number, c: string) => { if (n[k] < 8000) put(this.B[k], n[k]++, x, y, z, rot, sx, sy, sz, c); };
    let ifl = 0, ip = 0;
    this.chimneys = [];
    for (const v of live) {
      const L = layoutFor(this.terrain, v), t = w.tribes[v.tribe];
      const st = STYLE[t?.home ?? "hearth"] ?? STYLE.hearth;
      const roofTint = t?.top ?? st.roof;
      const band = v.stage === "band";
      for (let i = 0; i < houseCount(v, L); i++) {
        const h = L.houses[i], s = 0.014 * (0.8 + h.v * 0.5), gy = this.hf.groundY(h.x, h.y), rot = h.v * 3;
        const roof = h.v > 0.7 && (st.kind === "gable" || st.kind === "round") ? roofTint : st.roof;
        if (band || st.kind === "tent") { b("tent", h.x, gy, h.y, rot, s, s * 1.1, s, st.kind === "tent" ? st.wall : "#9c8462"); if (st.kind === "tent") b("tentTip", h.x, gy, h.y, rot, s, s, s, st.roof); }
        else if (st.kind === "gable" || st.kind === "long") {
          const len = st.kind === "long" ? 1.9 : 1;
          b("gableBody", h.x, gy, h.y, rot, s * len, s, s, st.wall); b("gableRoof", h.x, gy, h.y, rot, s * len, s, s, roof);
        } else if (st.kind === "round") {
          const lift = st.stilts && v.coastal ? s * 0.35 : 0;
          if (lift) for (let k = 0; k < 4; k++) { const a = rot + k * Math.PI / 2 + 0.78; if (ip < 12000) put(this.posts, ip++, h.x + Math.cos(a) * s * 0.4, gy, h.y + Math.sin(a) * s * 0.4, 0, s * 0.06, lift, s * 0.06, "#7a6040"); }
          b("roundBody", h.x, gy + lift, h.y, rot, s, s, s, st.wall); b("roundRoof", h.x, gy + lift, h.y, rot, s, s, s, roof);
        } else {
          b("stoneBody", h.x, gy, h.y, rot, s, s, s, st.wall); b("stoneRoof", h.x, gy, h.y, rot, s, s, s, roof);
        }
        if (i % 6 === 0 && !band) this.chimneys.push({ x: h.x, y: h.y, h: gy + s * 1.1 });
      }
      // landmark at the heart of a grown village
      if (!band) {
        const lx = v.x - 0.02, ly = v.y + 0.025, gy = this.hf.groundY(lx, ly), s = 0.02;
        if (st.landmark === "barn") { b("gableBody", lx, gy, ly, 0.3, s * 1.6, s * 1.3, s * 1.2, "#9e5a3e"); b("gableRoof", lx, gy, ly, 0.3, s * 1.6, s * 1.3, s * 1.2, "#5b3a28"); }
        else if (st.landmark === "hall") { b("gableBody", lx, gy, ly, 0.6, s * 3.2, s * 1.3, s * 1.3, "#7a5232"); b("gableRoof", lx, gy, ly, 0.6, s * 3.2, s * 1.4, s * 1.3, "#3f3226"); }
        else if (st.landmark === "racks") for (let k = 0; k < 3; k++) { const rx = v.px * 0.7 + v.x * 0.3 + k * 0.02, ry = v.py * 0.7 + v.y * 0.3; b("rack", rx, this.hf.surfaceY(rx, ry), ry, 0.4, s, s, s, "#a08860"); }
        else if (st.landmark === "stones") for (let k = 0; k < 9; k++) { const a = (k / 9) * Math.PI * 2, sx = lx + Math.cos(a) * 0.03, sy = ly + Math.sin(a) * 0.03; b("stone", sx, this.hf.groundY(sx, sy), sy, a, 0.011, 0.016 + (k % 3) * 0.004, 0.011, "#b4b0aa"); }
        else if (st.landmark === "totem") { b("totem", lx, gy, ly, 0, s, s * 2.2, s, "#5a3c2a"); b("totemTop", lx, gy, ly, 0.2, s, s * 2.2, s, t?.tip ?? "#f2b257"); }
      }
      for (let i = 0; i < fieldCount(v, L); i++) {
        const f = L.fields[i];
        put(this.fields, ifl++, f.x, this.hf.surfaceY(f.x, f.y) + 0.0025, f.y, -f.r, f.w, 1, f.h, CROPS[f.c]);
      }
      const def = Math.floor(v.defense);
      if (def >= 1) {
        const cnt = def >= 4 ? 36 : 56, R = 0.24, stone = def >= 4;
        for (let k = 0; k < cnt && ip < 12000; k++) {
          const a = (k / cnt) * Math.PI * 2, x = v.x + Math.cos(a) * R, y = v.y + Math.sin(a) * R * 0.85;
          if (this.hf.elevAt(x, y) < 0.002) continue;
          if (stone) {
            // continuous stone wall: segments laid along the ring, with a tower every ninth
            const tan = Math.atan2(Math.cos(a) * 0.85, -Math.sin(a)), seg = (2 * Math.PI * R) / cnt * 1.08;
            b("stone", x, this.hf.groundY(x, y), y, -tan, seg / 0.3, 0.02, 0.008 / 0.22, "#9a9490");
            if (k % 9 === 0) b("stoneBody", x, this.hf.groundY(x, y), y, 0, 0.016, 0.06, 0.016, "#8c8680");
          } else put(this.posts, ip++, x, this.hf.groundY(x, y), y, 0, 0.005, 0.02 + (k % 2) * 0.004, 0.005, def >= 2 ? "#6a4a30" : "#7a5a38");
        }
        if (def >= 2 && def < 4) for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + 0.4, x = v.x + Math.cos(a) * R, y = v.y + Math.sin(a) * R * 0.85; if (this.hf.elevAt(x, y) > 0.002) put(this.posts, ip++, x, this.hf.groundY(x, y), y, 0, 0.009, 0.05, 0.009, "#5a3e28"); }
      }
      if (v.granary >= 1) {
        const x = v.x + 0.05, y = v.y - 0.03, gy = this.hf.groundY(x, y);
        b("granary", x, gy, y, 0, 0.02, 0.02, 0.02, "#c8a060"); b("granaryRoof", x, gy, y, 0, 0.02, 0.02, 0.02, "#a8803e");
      }
    }
    for (const k of Object.keys(this.B)) finish(this.B[k], n[k]);
    finish(this.fields, ifl); finish(this.posts, ip);
    this.crowdCache.clear();
    // trade, marriage and kin routes as dashed lines on the water
    const rp: number[] = [], rc: number[] = [];
    for (const r of w.routes) {
      const A = w.villages.find((v) => v.id === r.a), Bv = w.villages.find((v) => v.id === r.b);
      if (!A || !Bv) continue;
      const c = new THREE.Color(r.kind === "marriage" ? "#f2b257" : r.kind === "kin" ? "#a98ad8" : "#e6f0f8").multiplyScalar(0.5 + r.strength / 2);
      rp.push(A.px, 0.012, A.py, Bv.px, 0.012, Bv.py); rc.push(c.r, c.g, c.b, c.r, c.g, c.b);
    }
    const rg = new THREE.BufferGeometry();
    rg.setAttribute("position", new THREE.Float32BufferAttribute(rp, 3)); rg.setAttribute("color", new THREE.Float32BufferAttribute(rc, 3));
    this.routes.geometry.dispose(); this.routes.geometry = rg; this.routes.computeLineDistances();
    // the selected tribe's known world
    const kp: number[] = [];
    if (sel?.kind === "tribe" && w.tribes[sel.id]) {
      const tr = w.tribes[sel.id];
      (this.known.material as THREE.LineBasicMaterial).color.set(tr.line);
      for (const id of tr.known) {
        const I = this.terrain.byId[id];
        for (let k = 0; k < 64; k++) {
          const a0 = (k / 64) * Math.PI * 2, a1 = ((k + 1) / 64) * Math.PI * 2;
          kp.push(I.cx + Math.cos(a0) * I.rx, 0.015, I.cy + Math.sin(a0) * I.ry, I.cx + Math.cos(a1) * I.rx, 0.015, I.cy + Math.sin(a1) * I.ry);
        }
      }
    }
    const kg = new THREE.BufferGeometry(); kg.setAttribute("position", new THREE.Float32BufferAttribute(kp, 3));
    this.known.geometry.dispose(); this.known.geometry = kg;
  }

  /** Place one rigged figure. Every part hangs off the hip or shoulder pivots, so poses bend naturally. */
  private figure(i: number, x: number, z: number, yaw: number, scale: number, t: Tribe, sex: "m" | "f", job: string, ps: Pose, tool: boolean, ti: { n: number }) {
    const P = this.P, y = this.hf.surfaceY(x, z) + ps.bob * scale;
    const sash = job === "doctor" ? "#5d7a4a" : job === "priest" ? "#5a8fb0" : job === "warrior" ? "#8f2f2a" : t.sash;
    compose(mBase, x, y, z, yaw, scale, scale, scale);
    mOut.copy(mBase).multiply(T(-0.09, 0.38, 0)).multiply(RX(ps.legL)); putM(P.leg, i * 2, mOut, t.cloth);
    mOut.copy(mBase).multiply(T(0.09, 0.38, 0)).multiply(RX(ps.legR)); putM(P.leg, i * 2 + 1, mOut, t.cloth);
    mUpper.copy(mBase).multiply(T(0, 0.38, 0)).multiply(RX(ps.bend));
    putM(P.torso, i, mUpper, sex === "f" ? t.top : t.skin);
    putM(P.sash, i, mUpper, sash);
    putM(P.head, i, mUpper, t.skin);
    putM(P.hat, i, mUpper, STRAW);
    const sides: [number, number, number][] = [[-1, ps.armL, 0], [1, ps.armR, 1]];
    for (const [side, sw, k] of sides) {
      mArm.copy(mUpper).multiply(T(0.27 * side, 0.32, 0)).multiply(RX(sw));
      putM(P.arm, i * 2 + k, mArm, t.skin); putM(P.wrap, i * 2 + k, mArm, "#c4473a");
      if (side === 1 && tool) putM(P.tool, ti.n++, mArm, "#7a5532");
    }
    mOut.copy(mBase).multiply(T(0, 0.3, -0.12)).multiply(RY(ps.tail)).multiply(RX(ps.lift));
    putM(P.tail, i, mOut, t.tail); putM(P.tip, i, mOut, t.tip);
  }

  /** Per-frame: people, named agents, boats and crews, lights, clouds, rain, lightning and smoke. */
  updateDynamic(w: Snap, time: number, z: number, inView: (x: number, y: number, m: number) => boolean, camY: number, dayLight: number, cam: { x: number; y: number }, viewR: number) {
    let n = 0;
    const ti = { n: 0 };
    this.named = [];
    if (z > 4.2) {
      for (const v of w.villages) {
        if (v.lost || !inView(v.x, v.y, 0.5)) continue;
        const t = w.tribes[v.tribe]; if (!t) continue;
        const key = v.id + ":" + popOf(v) + ":" + Math.round(v.jobs.farmer * 50) + ":" + Math.floor(v.houses);
        let crowd = this.crowdCache.get(key);
        if (!crowd) { crowd = sampleCrowd(v, layoutFor(this.terrain, v), 60); this.crowdCache.set(key, crowd); }
        for (const p of crowd) {
          if (n >= 3950) break;
          const f = figureState(p, time);
          if (!inView(f.x, f.y, 0.05)) continue;
          const moving = f.state === "out" || f.state === "back";
          const yaw = moving && (f.hx || f.hy) ? Math.atan2(f.hx, f.hy) : p.ph * 2;
          const sc = p.job === "child" ? 0.0078 : 0.011;
          this.figure(n++, f.x, f.y, yaw, sc, t, p.sex, p.job, pose(f.state, p.job, time, p.ph), TOOL_JOBS.has(p.job), ti);
        }
      }
    }
    let nr = 0;
    const crewSpots: { x: number; y: number; yaw: number; t: Tribe }[] = [];
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
        const job = ({ Leader: "leader", "Sky-speaker": "priest", Doctor: "doctor", "War leader": "warrior", Boatwright: "boatwright" } as Record<string, string>)[a.role] ?? "";
        const ps = pose("work", job || "idle", time * 0.8, a.id);
        this.figure(n++, x, y, Math.sin(time * 0.3 + a.id) * 0.6, 0.0125, t, a.sex, job, ps, job === "boatwright" || job === "warrior" || job === "priest", ti);
        put(this.rings, nr++, x, h, y, 0, 0.012, 0.012, 0.012);
      }
    }

    // boats: voyages (with crews), route traffic, fishing boats; moving boats leave a wake
    let nh = 0, nf = 0, ns = 0, no = 0, nw = 0;
    const boat = (x: number, y: number, head: number, tier: number, size: number, moving: boolean, crew?: Tribe, crewN = 0) => {
      if (nh + nf > 590) return;
      const rock = Math.sin(time * 1.6 + x * 9) * 0.12, yy = Math.sin(time * 1.3 + x * 7 + y * 5) * 0.002;
      const yaw = -head;
      if (tier <= 1) put(this.raft, nf++, x, yy, y, yaw, size, size, size, "#a8865a", 0, rock);
      else {
        put(this.hull, nh++, x, yy, y, yaw, size, size, size, "#8a6440", rock, 0);
        if (tier >= 3) put(this.outrig, no++, x, yy, y, yaw, size, size, size, "#8a6440", rock, 0);
        if (tier >= 4) put(this.sail, ns++, x, yy, y, yaw, size, size, size, "#f6ecd6", rock, 0);
      }
      if (moving) put(this.wakes, nw++, x, 0.004, y, yaw, size, size, size * (0.8 + 0.2 * Math.sin(time * 3 + x)));
      if (crew && z > 4.2) for (let k = 0; k < crewN; k++) crewSpots.push({ x: x + Math.cos(head) * size * (0.25 - k * 0.22), y: y + Math.sin(head) * size * (0.25 - k * 0.22), yaw: Math.PI / 2 - head, t: crew });
    };
    for (const voy of w.voyages) {
      const [x, y] = voyagePos(voy as Voyage);
      if (!inView(x, y, 0.3)) continue;
      const head = voy.leg === "out" ? Math.atan2(voy.ty - voy.fy, voy.tx - voy.fx) : Math.atan2(voy.fy - voy.ty, voy.fx - voy.tx);
      boat(x, y, head, voy.tier, voy.tier >= 4 ? 0.05 : 0.038, true, w.tribes[voy.tribe], Math.min(3, voy.crew));
    }
    for (const r of w.routes) {
      const A = w.villages.find((v) => v.id === r.a), Bv = w.villages.find((v) => v.id === r.b);
      if (!A || !Bv || r.strength < 0.2) continue;
      const L = Math.hypot(Bv.px - A.px, Bv.py - A.py) || 1, cyc = (time * 0.12 / L + (r.id % 7) / 7) % 2, u = cyc < 1 ? cyc : 2 - cyc;
      const x = A.px + (Bv.px - A.px) * u, y = A.py + (Bv.py - A.py) * u;
      if (inView(x, y, 0.2)) boat(x, y, Math.atan2(Bv.py - A.py, Bv.px - A.px) + (cyc < 1 ? 0 : Math.PI), r.tier, 0.034, true, w.tribes[A.tribe], 2);
    }
    if (z > 1.6) for (const v of w.villages) {
      if (v.lost || !v.coastal || !inView(v.px, v.py, 0.3)) continue;
      const cnt = Math.min(4, Math.round(v.jobs.fisher * v.men / 6)), tier = w.tribes[v.tribe]?.techs.includes("canoe") ? 2 : 1;
      for (let k = 0; k < cnt; k++) {
        const a = Math.atan2(v.py - v.y, v.px - v.x) + (hash3(k, v.id, 20) - 0.5) * 1.6, d = 0.06 + hash3(k, v.id, 21) * 0.14;
        const x = v.px + Math.cos(a) * d + Math.sin(time * 0.3 + k) * 0.01, y = v.py + Math.sin(a) * d + Math.cos(time * 0.27 + k) * 0.008;
        if (this.hf.elevAt(x, y) > -0.006) continue;
        boat(x, y, a + Math.sin(time * 0.5 + k) * 0.4, tier, 0.026, false, w.tribes[v.tribe], 1);
      }
    }
    // crews: seated, paddling
    for (const c of crewSpots) {
      if (n >= 3995) break;
      const ps: Pose = { bend: 0.25, legL: -1.4, legR: -1.4, armL: -0.9 + 0.5 * Math.sin(time * 4), armR: -0.9 - 0.5 * Math.sin(time * 4), bob: -0.25, tail: 0.3, lift: 0 };
      this.figure(n++, c.x, c.y, c.yaw, 0.0085, c.t, "m", "", ps, false, ti);
    }
    for (const k of ["torso", "sash", "head", "hat", "tail", "tip"]) finish(this.P[k], n);
    finish(this.P.leg, n * 2); finish(this.P.arm, n * 2); finish(this.P.wrap, n * 2); finish(this.P.tool, ti.n); finish(this.rings, nr);
    (this.rings.material as THREE.MeshBasicMaterial).opacity = 0.6 + 0.3 * Math.sin(time * 3);
    finish(this.hull, nh); finish(this.raft, nf); finish(this.sail, ns); finish(this.outrig, no); finish(this.wakes, nw);

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
      const m = g.material;
      m.opacity = a * (v.hungry > 1 ? 0.5 : 1);
      m.color.set(v.sick ? 0xff8a70 : 0xffffff);
      gi++;
    }
    for (let i = gi; i < this.glows.length; i++) this.glows[i].visible = false;

    // fair-weather clouds drift; storms darken and thicken them, drought and calm thin them out
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
      const m = c.s.material;
      m.opacity = THREE.MathUtils.clamp(base + add, 0, 0.9) * fade;
      c.s.visible = m.opacity > 0.01;
      const dk = Math.min(1, dark), lit = 0.35 + 0.65 * dayLight;
      m.color.setRGB((1 - 0.65 * dk) * lit, (1 - 0.6 * dk) * lit, (1 - 0.52 * dk) * lit);
    }
    // storm columns: low, dark cloud stacks over each storm, visible even when zoomed in
    const storms = w.effects.filter((e) => e.power === "storm");
    let sc = 0;
    for (const e of storms) for (let k = 0; k < 14; k++) {
      let s = this.stormClouds[sc];
      if (!s) { s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.cloudTex, transparent: true, depthWrite: false, fog: false })); this.stormClouds.push(s); this.group.add(s); }
      const a = hash3(k, e.id, 1) * 6.283, d = Math.sqrt(hash3(k, e.id, 2)) * e.r * 0.8;
      s.position.set(e.x + Math.cos(a) * d + Math.sin(time * 0.3 + k) * 0.05, 0.55 + hash3(k, e.id, 3) * 0.45, e.y + Math.sin(a) * d);
      const k2 = 0.9 + hash3(k, e.id, 4) * 0.9; s.scale.set(k2 * 1.5, k2, 1);
      s.material.opacity = 0.5 * THREE.MathUtils.smoothstep(camY, 1.0, 2.2) + 0.15; s.material.color.setRGB(0.22 + 0.15 * dayLight, 0.26 + 0.15 * dayLight, 0.32 + 0.15 * dayLight);
      s.visible = true; sc++;
    }
    for (let i = sc; i < this.stormClouds.length; i++) this.stormClouds[i].visible = false;

    // 3D rain inside rain and storm areas near the camera
    const wet = w.effects.filter((e) => (e.power === "rain" || e.power === "storm") && Math.hypot(e.x - cam.x, e.y - cam.y) < e.r + viewR * 1.5);
    this.rain.visible = wet.length > 0;
    if (wet.length) {
      const stormy = wet.some((e) => e.power === "storm");
      const len = Math.max(0.01, viewR * 0.03), fall = Math.max(0.3, viewR * 0.9) * 0.016 * (stormy ? 1.6 : 1);
      const P = this.rainPos;
      for (let i = 0; i < this.rainN; i++) {
        const o = i * 6;
        let x = P[o], y = P[o + 1], zz = P[o + 2];
        if (y <= 0 || y < this.hf.surfaceY(x, zz) || Math.random() < 0.002) {
          const e = wet[i % wet.length], inside = Math.hypot(e.x - cam.x, e.y - cam.y) < e.r;
          const ang = Math.random() * 6.283, d = Math.sqrt(Math.random()) * Math.min(e.r, viewR * 1.6);
          x = (inside ? cam.x : e.x) + Math.cos(ang) * d; zz = (inside ? cam.y : e.y) + Math.sin(ang) * d; y = 0.25 + Math.random() * Math.max(0.3, viewR * 0.6);
          if (Math.hypot(x - e.x, zz - e.y) > e.r) { x = e.x + Math.cos(ang) * e.r * 0.5; zz = e.y + Math.sin(ang) * e.r * 0.5; }
        } else { y -= fall; x -= fall * 0.25; }
        P[o] = x; P[o + 1] = y; P[o + 2] = zz; P[o + 3] = x + len * 0.25; P[o + 4] = y + len; P[o + 5] = zz;
      }
      (this.rain.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
    }
    this.bolts = this.bolts.filter((b) => {
      const age = time - b.t0;
      if (age > 0.6) { this.group.remove(b.line); b.line.geometry.dispose(); return false; }
      (b.line.material as THREE.LineBasicMaterial).opacity = 1 - age / 0.6;
      return true;
    });
    this.flashLight.intensity *= 0.85;

    // hearth smoke from chimneys
    if (z > 2.2 && this.chimneys.length && Math.random() < (this.low ? 0.15 : 0.5)) {
      const c = this.chimneys[Math.floor(Math.random() * this.chimneys.length)];
      if (inView(c.x, c.y, 0.1)) {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.hearthSmokeTex, transparent: true, depthWrite: false, opacity: 0.5 }));
        s.position.set(c.x, c.h, c.y); this.smoke.push({ s, t0: time, ash: false }); this.group.add(s);
      }
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
        s.position.copy(l.position); this.smoke.push({ s, t0: time, ash: true }); this.group.add(s);
      }
    }
    for (let i = young.length; i < this.lava.length; i++) this.lava[i].visible = false;
    this.smoke = this.smoke.filter((p) => {
      const age = time - p.t0, life = p.ash ? 6 : 3.5;
      if (age > life) { this.group.remove(p.s); p.s.material.dispose(); return false; }
      p.s.position.y += p.ash ? 0.004 : 0.0006; p.s.position.x += p.ash ? 0.003 : 0.0004;
      p.s.scale.setScalar(p.ash ? 0.12 + age * 0.12 : 0.006 + age * 0.006);
      p.s.material.opacity = Math.max(0, (p.ash ? 0.8 : 0.45) - age / (life + 1));
      return true;
    });
  }

  /** A lightning bolt from the storm cloud to the ground, with a flash of light. */
  strike(fx: Fx, w: Snap, time: number) {
    const storm = w.effects.filter((e) => e.power === "storm").sort((a, b) => Math.hypot(a.x - fx.x, a.y - fx.y) - Math.hypot(b.x - fx.x, b.y - fx.y))[0];
    const cx = storm ? storm.x : fx.x, cy = storm ? storm.y : fx.y, r = storm ? storm.r * 0.8 : 0.6;
    const a = Math.random() * 6.283, d = Math.random() * r, gx = cx + Math.cos(a) * d, gy = cy + Math.sin(a) * d;
    const ground = this.hf.surfaceY(gx, gy), pts: THREE.Vector3[] = [];
    let x = gx + (Math.random() - 0.5) * 0.2, z = gy + (Math.random() - 0.5) * 0.2;
    for (let k = 0; k <= 10; k++) {
      pts.push(new THREE.Vector3(x, 0.9 - (0.9 - ground) * (k / 10), z));
      x += (gx - x) * 0.3 + (Math.random() - 0.5) * 0.05; z += (gy - z) * 0.3 + (Math.random() - 0.5) * 0.05;
    }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0xf2f8ff, transparent: true, opacity: 1, fog: false }));
    this.group.add(line); this.bolts.push({ line, t0: time });
    this.flashLight.position.set(gx, ground + 0.3, gy); this.flashLight.intensity = 6;
  }

  setPeopleVisible(on: boolean) { for (const k of Object.keys(this.P)) this.P[k].visible = on; this.rings.visible = on; }
  setVillagesVisible(on: boolean) { for (const m of [...Object.values(this.B), this.fields, this.posts]) m.visible = on; }
  setRoutesVisible(on: boolean) { this.routes.visible = on; }
}
