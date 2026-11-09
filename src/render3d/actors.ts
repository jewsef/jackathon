import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { World, Village, Voyage, Agent, Tribe, Fx } from "../sim/types";
import type { Terrain } from "../sim/terrain";
import { WX, WY, inHome } from "../sim/terrain";
import { hash3 } from "../sim/rng";
import { popOf } from "../sim/util";
import { voyagePos } from "../sim/voyages";
import { layoutFor, sampleCrowd, figureState, houseCount, fieldCount, type Figure, type FigureState } from "../render/crowd";
import type { Selection } from "../render/common";
import type { HeightField } from "./heightfield";
import { planFor, isPlanned, roadNetwork, villageTracks, roadTier, type TownPlan } from "../render/plan";
import { houseKit, CIVIC, PALETTE, STYLE_OF, colorOf, eraOf, type Part, type Prim, type Style, type Palette } from "./kits";

type Snap = Omit<World, "chronicle">;
const tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpP = new THREE.Vector3(), tmpE = new THREE.Euler(), tmpC = new THREE.Color();
/** Height of a person in world units: about a third of a house. */
export const PERSON = 0.0045;
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
/** People are simple solid figures, coloured by what they do. */
export const JOB_COLOR: Record<string, string> = {
  gatherer: "#8fbf6a", farmer: "#e0c04a", fisher: "#4fa3d1", builder: "#d08a4b", woodcutter: "#4f7d3a", quarrier: "#a3a7ad",
  miner: "#6d5f7a", smith: "#ff7a3d", boatwright: "#3fc0b0", warrior: "#c83a3a", doctor: "#f4f4f4", priest: "#a98ad8",
  leader: "#f2b257", child: "#efe6cf", elder: "#9b938b", idle: "#cfc6b8"
};
export const RULER_COLOR = "#ffd84d", HEAD_COLOR = "#ff9f40";

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
  private trees: { x: number; y: number; s: number; pine: boolean; isle: string; h: number }[] = [];
  private pines: THREE.InstancedMesh; private broad: THREE.InstancedMesh;
  private B: Record<string, THREE.InstancedMesh> = {};
  private fields: THREE.InstancedMesh; private posts: THREE.InstancedMesh;
  private P: Record<string, THREE.InstancedMesh> = {};
  private rings: THREE.InstancedMesh;
  private hull: THREE.InstancedMesh; private raft: THREE.InstancedMesh; private sail: THREE.InstancedMesh; private outrig: THREE.InstancedMesh; private wakes: THREE.InstancedMesh;
  private shipHull: THREE.InstancedMesh; private shipRig: THREE.InstancedMesh; private shipSail: THREE.InstancedMesh;
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
  private K: Record<Prim, THREE.InstancedMesh> = {} as Record<Prim, THREE.InstancedMesh>;
  private kn: Record<string, number> = {};
  private roads: THREE.Mesh; private roadKey = "";
  private horizon = false; private lastLive: Village[] = []; private lastForest: Record<string, number> = {};
  named: NamedSpot[] = [];

  constructor(hf: HeightField, terrain: Terrain, low = false) {
    this.hf = hf; this.terrain = terrain; this.low = low;
    const G = this.group;
    this.pines = inst(new THREE.ConeGeometry(0.42, 1.1, 6).translate(0, 0.62, 0), 160000, lambert());
    this.broad = inst(new THREE.SphereGeometry(0.5, 7, 5).translate(0, 0.7, 0), 160000, lambert());
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
      granaryRoof: new THREE.ConeGeometry(0.62, 0.5, 10).translate(0, 1.05, 0),
      logs: mergeGeometries([0, 1, 2].map((k) => new THREE.CylinderGeometry(0.16, 0.16, 1, 6).rotateZ(Math.PI / 2).translate(0, 0.16 + (k === 2 ? 0.27 : 0), k === 2 ? 0 : (k - 0.5) * 0.34)))!,
      heap: new THREE.DodecahedronGeometry(0.5).scale(1, 0.55, 1).translate(0, 0.2, 0),
      crate: new THREE.BoxGeometry(1, 0.6, 0.7).translate(0, 0.3, 0),
      pit: new THREE.CylinderGeometry(0.5, 0.42, 0.06, 12).translate(0, 0.01, 0),
      entrance: new THREE.BoxGeometry(0.7, 0.6, 0.5).translate(0, 0.3, 0),
      kiln: new THREE.SphereGeometry(0.5, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2),
      pole: new THREE.CylinderGeometry(0.04, 0.05, 1, 5).translate(0, 0.5, 0),
      flag: new THREE.PlaneGeometry(1, 0.6).translate(0.5, 0, 0),
      step: new THREE.BoxGeometry(1, 0.3, 1).translate(0, 0.15, 0)
    };
    for (const [k, g] of Object.entries(kit)) { this.B[k] = inst(g, 8000, lambert(k === "flag" ? { side: THREE.DoubleSide } : {})); G.add(this.B[k]); }
    // primitives for the building kits (see kits.ts): unit size, standing on y = 0
    const gable = new THREE.BufferGeometry();
    const gv = [-0.5, 0, -0.5, 0.5, 0, -0.5, 0.5, 1, 0, -0.5, 0, -0.5, 0.5, 1, 0, -0.5, 1, 0, // back slope
      -0.5, 0, 0.5, -0.5, 1, 0, 0.5, 1, 0, -0.5, 0, 0.5, 0.5, 1, 0, 0.5, 0, 0.5, // front slope
      -0.5, 0, -0.5, -0.5, 1, 0, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0, 0.5, 0.5, 1, 0]; // gable ends
    gable.setAttribute("position", new THREE.Float32BufferAttribute(gv, 3)); gable.computeVertexNormals();
    const prims: Record<Prim, [THREE.BufferGeometry, number]> = {
      box: [new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), 40000],
      cyl: [new THREE.CylinderGeometry(0.5, 0.5, 1, 10).translate(0, 0.5, 0), 12000],
      cone: [new THREE.ConeGeometry(0.5, 1, 9).translate(0, 0.5, 0), 12000],
      prism: [gable, 20000],
      hip: [new THREE.ConeGeometry(Math.SQRT1_2, 1, 4).rotateY(Math.PI / 4).translate(0, 0.5, 0), 12000],
      dome: [new THREE.SphereGeometry(0.5, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 2, 1), 8000]
    };
    for (const [k, [g, max]] of Object.entries(prims)) { this.K[k as Prim] = inst(g, max, lambert({ side: k === "prism" ? THREE.DoubleSide : THREE.FrontSide })); G.add(this.K[k as Prim]); }
    // roads and streets: one draped ribbon mesh
    this.roads = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshLambertMaterial({ vertexColors: true, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -8 }));
    this.roads.renderOrder = 1; this.roads.frustumCulled = false;
    G.add(this.roads);
    this.fields = inst(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), 8000, lambert({ side: THREE.DoubleSide }));
    this.posts = inst(new THREE.CylinderGeometry(0.5, 0.5, 1, 5).translate(0, 0.5, 0), 12000, lambert());
    G.add(this.pines, this.broad, this.fields, this.posts);
    // people: a simple pawn, one solid colour per figure
    const pawn = mergeGeometries([new THREE.CylinderGeometry(0.17, 0.23, 0.62, 8).translate(0, 0.31, 0), new THREE.SphereGeometry(0.16, 8, 6).translate(0, 0.79, 0)])!;
    this.P.body = inst(pawn, 5000, lambert()); G.add(this.P.body);
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
    // ocean ships (Age of Sail): a deep hull with castles fore and aft, three masts, square sails
    const hullG = mergeGeometries([
      new THREE.CylinderGeometry(0.17, 0.1, 1, 8).rotateZ(Math.PI / 2).scale(1, 0.75, 1).translate(0, 0.06, 0),
      new THREE.BoxGeometry(0.26, 0.14, 0.28).translate(-0.36, 0.18, 0), new THREE.BoxGeometry(0.16, 0.1, 0.2).translate(0.38, 0.16, 0),
      new THREE.BoxGeometry(0.3, 0.025, 0.025).translate(0.62, 0.14, 0)
    ])!;
    const rigG = mergeGeometries([
      new THREE.CylinderGeometry(0.012, 0.016, 0.95, 5).translate(0.08, 0.55, 0), new THREE.CylinderGeometry(0.01, 0.014, 0.75, 5).translate(0.34, 0.45, 0),
      new THREE.CylinderGeometry(0.01, 0.014, 0.62, 5).translate(-0.28, 0.5, 0),
      new THREE.BoxGeometry(0.02, 0.02, 0.5).translate(0.08, 0.62, 0), new THREE.BoxGeometry(0.02, 0.02, 0.42).translate(0.08, 0.92, 0), new THREE.BoxGeometry(0.02, 0.02, 0.38).translate(0.34, 0.68, 0)
    ])!;
    const sailG = mergeGeometries([
      new THREE.BoxGeometry(0.02, 0.26, 0.46).translate(0.09, 0.48, 0), new THREE.BoxGeometry(0.02, 0.2, 0.38).translate(0.09, 0.8, 0),
      new THREE.BoxGeometry(0.02, 0.22, 0.34).translate(0.35, 0.56, 0), new THREE.BoxGeometry(0.22, 0.2, 0.012).translate(-0.28, 0.5, 0)
    ])!;
    this.shipHull = inst(hullG, 300, lambert()); this.shipRig = inst(rigG, 300, lambert()); this.shipSail = inst(sailG, 300, lambert());
    G.add(this.shipHull, this.shipRig, this.shipSail);
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
      this.trees.push({ x, y, s: 0.75 + hash3(gx, gy, 74) * 0.6, pine: el > 0.15 || hash3(gx, gy, 75) < 0.25, isle: t.isleAt(x, y) ?? "", h: hash3(gx, gy, 76) });
    }
    this.layoutTrees([], {});
  }
  /** Clear trees where villages stand; a village's land is cleared for fields. */
  private layoutTrees(villages: Village[], forest: Record<string, number>) {
    let ip = 0, ib = 0;
    this.lastLive = villages; this.lastForest = forest;
    for (const tr of this.trees) {
      if (tr.h > (forest[tr.isle] ?? 1)) continue;
      if (!this.horizon && !inHome(tr.x, tr.y)) continue;
      if (ip >= 160000 || ib >= 160000) break;
      if (villages.some((v) => Math.abs(v.x - tr.x) < 0.42 && Math.abs(v.y - tr.y) < 0.42 && Math.hypot(v.x - tr.x, v.y - tr.y) < 0.21 + Math.min(0.2, Math.sqrt(popOf(v)) / 120))) continue;
      const y = this.hf.groundY(tr.x, tr.y), k = 0.013 * tr.s;
      const shade = 0.75 + hash3(Math.round(tr.x * 100), Math.round(tr.y * 100), 9) * 0.35;
      if (tr.pine) put(this.pines, ip++, tr.x, y, tr.y, 0, k * 0.9, k * 1.3, k * 0.9, tmpC.setRGB(0.18 * shade, 0.33 * shade, 0.24 * shade));
      else put(this.broad, ib++, tr.x, y, tr.y, 0, k, k, k, tmpC.setRGB(0.24 * shade, 0.42 * shade, 0.24 * shade));
    }
    finish(this.pines, ip); finish(this.broad, ib);
  }

  /** Place a building kit: parts rotated with the building, coloured by role. */
  private kit(parts: Part[], x: number, z: number, gy: number, rot: number, s: number, pal: Palette, accent: string) {
    const c = Math.cos(rot), sn = Math.sin(rot);
    for (const q of parts) {
      const m = this.K[q.g], i = this.kn[q.g] ?? 0;
      if (i >= m.instanceMatrix.count) continue;
      this.kn[q.g] = i + 1;
      put(m, i, x + (q.x * c + q.z * sn) * s, gy + q.y * s, z + (-q.x * sn + q.z * c) * s, rot + (q.r ?? 0), q.sx * s, q.sy * s, q.sz * s, colorOf(q.c, pal, accent));
    }
  }

  /** Roads between villages and streets inside planned towns, draped on the ground. */
  private buildRoads(w: Snap, live: Village[]) {
    const key = live.filter((v) => v.stage !== "band").map((v) => `${v.id}${v.stage[0]}${roadTier(w.tribes[v.tribe])}${isPlanned(v, w.tribes[v.tribe]) ? "p" : ""}${v.jobs.quarrier > 0.01 ? "q" : ""}${v.jobs.miner > 0.01 ? "m" : ""}`).join(",");
    if (key === this.roadKey) return;
    this.roadKey = key;
    const P: number[] = [], C: number[] = [];
    const COL = [new THREE.Color("#7d6a4c"), new THREE.Color("#8f7a5a"), new THREE.Color("#948c80")];
    const WID = [0.0028, 0.0038, 0.0048];
    const ribbon = (pts: [number, number][], wd: number, col: THREE.Color) => {
      // resample so the ribbon follows the ground closely
      const rs: [number, number][] = [pts[0]];
      for (let i = 1; i < pts.length; i++) {
        const [x0, y0] = pts[i - 1], [x1, y1] = pts[i], d = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.ceil(d / 0.006));
        for (let k = 1; k <= n; k++) rs.push([x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n]);
      }
      let prev: [number, number, number, number] | null = null;
      for (let i = 0; i < rs.length; i++) {
        const [x, y] = rs[i], [xa, ya] = rs[Math.max(0, i - 1)], [xb, yb] = rs[Math.min(rs.length - 1, i + 1)];
        const tx = xb - xa, ty = yb - ya, tl = Math.hypot(tx, ty) || 1, nx = -ty / tl * wd, ny = tx / tl * wd;
        const cur: [number, number, number, number] = [x + nx, y + ny, x - nx, y - ny];
        if (prev && this.hf.elevAt(x, y) > 0.001) {
          const q = [prev[0], prev[1], prev[2], prev[3], cur[0], cur[1], cur[2], cur[3]];
          const Y = (k: number) => this.hf.groundY(q[k * 2], q[k * 2 + 1]) + (this.low ? 0.004 : 0.0022);
          for (const k of [0, 2, 1, 1, 2, 3]) { P.push(q[k * 2], Y(k), q[k * 2 + 1]); C.push(col.r, col.g, col.b); }
        }
        prev = cur;
      }
    };
    for (const r of roadNetwork(this.terrain, live, w.tribes as Tribe[])) ribbon(r.pts, WID[r.tier], COL[r.tier]);
    for (const v of live) {
      if (v.stage === "band") continue;
      const t = w.tribes[v.tribe], tier = roadTier(t), L = layoutFor(this.terrain, v);
      for (const pts of villageTracks(this.terrain, v, L, { quarry: v.jobs.quarrier > 0.01, mine: v.jobs.miner > 0.01 })) ribbon(pts, WID[Math.max(0, tier - 1)], COL[tier]);
      if (isPlanned(v, t)) {
        const plan = planFor(this.terrain, v, L);
        for (const st of plan.streets) ribbon([[st.ax, st.ay], [st.bx, st.by]], st.main ? 0.0045 : 0.003, COL[Math.max(1, tier)]);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3)); g.setAttribute("color", new THREE.Float32BufferAttribute(C, 3));
    g.computeVertexNormals();
    this.roads.geometry.dispose(); this.roads.geometry = g;
  }

  /** Rebuild villages, routes and the selected tribe's known world. Called when a snapshot arrives or the selection changes. */
  updateStatic(w: Snap, sel: Selection) {
    const live = w.villages.filter((v) => !v.lost);
    const forest: Record<string, number> = {};
    for (const id of Object.keys(w.deposits)) { const b = w.depositBase[id as keyof typeof w.depositBase].wood; forest[id] = b > 0 ? Math.round(Math.min(1, w.deposits[id as keyof typeof w.deposits].wood / b) * 20) / 20 : 1; }
    const key = live.map((v) => v.id + ":" + Math.round(Math.sqrt(popOf(v)))).join(",") + JSON.stringify(forest);
    if (key !== this.villageKey) { this.villageKey = key; this.layoutTrees(live, forest); }
    const n: Record<string, number> = Object.fromEntries(Object.keys(this.B).map((k) => [k, 0]));
    const b = (k: string, x: number, y: number, z: number, rot: number, sx: number, sy: number, sz: number, c: string) => { if (n[k] < 8000) put(this.B[k], n[k]++, x, y, z, rot, sx, sy, sz, c); };
    let ifl = 0, ip = 0;
    this.chimneys = [];
    this.kn = {};
    this.buildRoads(w, live);
    for (const v of live) {
      const L = layoutFor(this.terrain, v), t = w.tribes[v.tribe];
      const style: Style = STYLE_OF[t?.home ?? "hearth"] ?? "hearth";
      const st = STYLE[style] ?? STYLE.hearth;
      const roofTint = t?.top ?? st.roof;
      const band = v.stage === "band" || (t?.age ?? 0) === 0;
      const planned = isPlanned(v, t), era = eraOf(v.stage, t?.age ?? 0, planned);
      const pal = PALETTE[style][era], accent = t?.line ?? "#f2b257";
      const plan: TownPlan | null = planned ? planFor(this.terrain, v, L) : null;
      const capital = !!t && w.agents.find((a) => a.id === t.gov?.ruler)?.village === v.id;
      // houses: organic villages face the centre; planned towns line the streets and grow upward
      const spots = plan ? plan.plots : L.houses;
      const nh = Math.min(spots.length, Math.max(1, Math.floor(v.houses)));
      const levels = plan ? Math.min(3, Math.max(1, Math.ceil(v.houses / Math.max(1, spots.length)))) : 1;
      for (let i = 0; i < nh; i++) {
        const h = spots[i], gy = this.hf.groundY(h.x, h.y);
        const s = plan ? 0.0155 : 0.014 * (0.8 + h.v * 0.5);
        const rot: number = "rot" in h ? (h.rot as number) : Math.atan2(v.x - h.x, v.y - h.y) + (h.v - 0.5) * 0.6;
        const n = plan ? Math.min(3, levels + (h.d < 0.08 && h.v > 0.5 ? 1 : 0)) : 1;
        const hp = h.v > 0.7 && era > 0 ? { ...pal, roof: roofTint } : pal;
        const lift = style === "kelp" && v.coastal && era >= 1 && era < 3 ? s * 0.35 : 0;
        if (lift) for (let k = 0; k < 4; k++) { const a = rot + k * Math.PI / 2 + 0.78; if (ip < 12000) put(this.posts, ip++, h.x + Math.cos(a) * s * 0.4, gy, h.y + Math.sin(a) * s * 0.4, 0, s * 0.06, lift, s * 0.06, "#7a6040"); }
        this.kit(houseKit(style, era, n), h.x, h.y, gy + lift, rot, s, hp, accent);
        if (i % 6 === 0 && !band) this.chimneys.push({ x: h.x, y: h.y, h: gy + s * (0.9 + n * 0.6) });
      }
      // the heart of the town: a palace for the ruler, a market, a well; older villages keep their landmark
      if (plan) {
        const sq = (pt: { x: number; y: number }) => [pt.x, pt.y, this.hf.groundY(pt.x, pt.y)] as const;
        { const [x, y, gy] = sq(plan.plaza); this.kit(CIVIC.plaza, x, y, gy, -plan.angle, 0.018, pal, accent); }
        { const [x, y, gy] = sq(plan.market); this.kit(CIVIC.market, x, y, gy, -plan.angle, 0.018, pal, accent); }
        { const [x, y, gy] = sq(plan.palace); if (capital) this.kit(CIVIC.palace, x, y, gy, -plan.angle, 0.017, { ...pal, roof: roofTint }, accent); else if (era >= 4 && v.stage === "city") this.kit(CIVIC.theatre, x, y, gy, -plan.angle, 0.02, pal, accent); else this.kit(CIVIC.granary2, x, y, gy, -plan.angle, 0.02, pal, accent); }
        if (v.monument <= 0.02) { const [x, y, gy] = sq(plan.temple); this.kit(CIVIC.workshop, x - 0.008, y, gy, -plan.angle, 0.016, pal, accent); this.kit(CIVIC.workshop, x + 0.012, y + 0.01, gy, -plan.angle + Math.PI / 2, 0.014, pal, accent); }
      } else if (!band) {
        const lx = v.x - 0.02, ly = v.y + 0.025, gy = this.hf.groundY(lx, ly), s = 0.02;
        if (capital && era >= 2) this.kit(CIVIC.palace, lx, ly, gy, 0.3, 0.016, { ...pal, roof: roofTint }, accent);
        else if (st.landmark === "barn") { b("gableBody", lx, gy, ly, 0.3, s * 1.6, s * 1.3, s * 1.2, "#9e5a3e"); b("gableRoof", lx, gy, ly, 0.3, s * 1.6, s * 1.3, s * 1.2, "#5b3a28"); }
        else if (st.landmark === "hall") { b("gableBody", lx, gy, ly, 0.6, s * 3.2, s * 1.3, s * 1.3, "#7a5232"); b("gableRoof", lx, gy, ly, 0.6, s * 3.2, s * 1.4, s * 1.3, "#3f3226"); }
        else if (st.landmark === "racks") for (let k = 0; k < 3; k++) { const rx = v.px * 0.7 + v.x * 0.3 + k * 0.02, ry = v.py * 0.7 + v.y * 0.3; b("rack", rx, this.hf.surfaceY(rx, ry), ry, 0.4, s, s, s, "#a08860"); }
        else if (st.landmark === "stones") for (let k = 0; k < 9; k++) { const a = (k / 9) * Math.PI * 2, sx = lx + Math.cos(a) * 0.03, sy = ly + Math.sin(a) * 0.03; b("stone", sx, this.hf.groundY(sx, sy), sy, a, 0.011, 0.016 + (k % 3) * 0.004, 0.011, "#b4b0aa"); }
        else if (st.landmark === "totem") { b("totem", lx, gy, ly, 0, s, s * 2.2, s, "#5a3c2a"); b("totemTop", lx, gy, ly, 0.2, s, s * 2.2, s, t?.tip ?? "#f2b257"); }
        if (era >= 2 && (v.stage === "town" || v.stage === "city")) { const wx = v.x + 0.012, wy = v.y + 0.012; this.kit(CIVIC.well, wx, wy, this.hf.groundY(wx, wy), 0, 0.016, pal, accent); }
      }
      // the harbour: a pier and a boat shed once the tribe builds boats
      if (v.coastal && era >= 1 && (t?.techs.includes("canoe") || v.jobs.boatwright > 0.01)) {
        const dx = v.px - v.x, dy = v.py - v.y, dl = Math.hypot(dx, dy) || 1, rot = Math.atan2(dx, dy);
        const px = v.px - dx / dl * 0.01, py = v.py - dy / dl * 0.01;
        this.kit(CIVIC.pier, px, py, Math.max(0.002, this.hf.groundY(px, py)) + 0.001, rot, era >= 2 ? 0.02 : 0.014, pal, accent);
        const has = (x: string) => !!t?.techs.includes(x), big = v.stage === "town" || v.stage === "city";
        const side = (along: number, off: number): [number, number] | null => {
          const x = v.x + dx * along - dy / dl * off, y = v.y + dy * along + dx / dl * off;
          return this.hf.elevAt(x, y) > 0.002 ? [x, y] : null;
        };
        if (v.jobs.boatwright > 0.01 || has("carrack")) {
          const p = side(0.86, 0.03);
          if (p) this.kit(has("carrack") ? CIVIC.shipyard : CIVIC.boatshed, p[0], p[1], this.hf.groundY(p[0], p[1]), rot, has("carrack") ? 0.018 : 0.014, pal, accent);
        }
        // a lighthouse at the pier head, warehouses on the quay, a star fort guarding the harbour
        if (has("lighthouse") && big) { const lx = v.px + dx / dl * 0.035, ly = v.py + dy / dl * 0.035; this.kit(CIVIC.lighthouse, lx, ly, Math.max(0, this.hf.groundY(lx, ly)), 0, 0.016, pal, accent); }
        if (has("coinage") && big) { const p = side(0.82, -0.035); if (p) this.kit(CIVIC.warehouse, p[0], p[1], this.hf.groundY(p[0], p[1]), rot + Math.PI / 2, 0.016, pal, accent); }
        if (has("gunpowder") && big) { const p = side(0.9, -0.09) ?? side(0.8, 0.1); if (p) this.kit(CIVIC.starfort, p[0], p[1], this.hf.groundY(p[0], p[1]), rot, 0.02, pal, accent); }
      }
      // Classical waterworks: an aqueduct striding in from the hills
      if (t?.techs.includes("aqueduct") && (v.stage === "town" || v.stage === "city")) {
        const ax = L.quarry.x - v.x, ay = L.quarry.y - v.y, al = Math.hypot(ax, ay) || 1, rot = -Math.atan2(ay, ax);
        for (let k = 0; k < 16; k++) {
          const d = L.R * 0.95 + k * 0.014, x = v.x + ax / al * d, y = v.y + ay / al * d;
          if (this.hf.elevAt(x, y) < 0.004 || d > al) break;
          this.kit(CIVIC.arch, x, y, this.hf.groundY(x, y), rot, 0.014, pal, accent);
        }
      }
      // windmills among the fields in the Age of Sail
      if ((t?.age ?? 0) >= 4 && fieldCount(v, L) > 3) for (const i of [2, 7]) {
        const f = L.fields[i]; if (!f || i >= fieldCount(v, L)) continue;
        this.kit(CIVIC.windmill, f.x + f.w * 0.5, f.y, this.hf.groundY(f.x + f.w * 0.5, f.y), 0.6, 0.014, pal, accent);
      }
      // stockpiles: what the village has in store, at a glance
      const piles: [keyof Village["stock"], string, string][] = [["wood", "logs", "#8a6440"], ["stone", "heap", "#a9a59e"], ["brick", "crate", "#c35a3e"], ["clay", "heap", "#b5714a"], ["salt", "heap", "#eef2f4"], ["fiber", "crate", "#c9b77a"], ["flint", "heap", "#3b3540"], ["copper", "heap", "#c87533"], ["tin", "heap", "#b8bcc2"], ["bronze", "crate", "#e2b04f"], ["iron", "heap", "#5a4038"], ["spice", "crate", "#d9792c"]];
      let pk = 0;
      for (const [r, kitName, col] of piles) {
        const amt = v.stock[r];
        if (amt < 3) continue;
        const cnt = Math.min(3, Math.ceil(amt / 40)), size = 0.006 + Math.min(0.007, amt / 500);
        for (let j = 0; j < cnt; j++, pk++) {
          let px = v.x + 0.04 + (pk % 4) * 0.013, py = v.y + 0.035 + Math.floor(pk / 4) * 0.012;
          if (plan) { const a = -plan.angle, u = ((pk % 4) - 1.5) * 0.01, ww = (Math.floor(pk / 4) - 1) * 0.01; px = plan.plaza.x + u * Math.cos(a) + ww * Math.sin(a); py = plan.plaza.y - u * Math.sin(a) + ww * Math.cos(a); }
          else if (this.hf.elevAt(px, py) < 0.003) { px = v.x * 2 - px; py = v.y * 2 - py; }
          if (this.hf.elevAt(px, py) < 0.003) continue;
          b(kitName, px, this.hf.groundY(px, py), py, pk * 0.7, size, size, size, col);
        }
      }
      // work sites: a quarry pit, a mine entrance, kilns and the smithy
      if (v.jobs.quarrier > 0.01 && this.hf.elevAt(L.quarry.x, L.quarry.y) > 0) {
        const gy = this.hf.groundY(L.quarry.x, L.quarry.y);
        b("pit", L.quarry.x, gy, L.quarry.y, 0, 0.04, 0.04, 0.04, "#5a5650");
        b("heap", L.quarry.x + 0.025, gy, L.quarry.y + 0.01, 1, 0.012, 0.012, 0.012, v.isle === "hearth" ? "#b5714a" : "#a9a59e");
      }
      if (v.jobs.miner > 0.01 && this.hf.elevAt(L.mine.x, L.mine.y) > 0) {
        const gy = this.hf.groundY(L.mine.x, L.mine.y), metal = v.stock.copper > v.stock.tin ? "#c87533" : v.stock.tin > 1 ? "#b8bcc2" : "#3b3540";
        b("entrance", L.mine.x, gy, L.mine.y, Math.atan2(v.x - L.mine.x, v.y - L.mine.y), 0.016, 0.016, 0.016, "#2a2622");
        b("heap", L.mine.x + 0.02, gy, L.mine.y + 0.012, 0.4, 0.008, 0.008, 0.008, metal);
      }
      if (t && t.techs.includes("brickmaking") && !band) { const kx = v.x - 0.055, ky = v.y + 0.02, gy = this.hf.groundY(kx, ky); b("kiln", kx, gy, ky, 0, 0.013, 0.013, 0.013, "#9a5a3a"); this.chimneys.push({ x: kx, y: ky, h: gy + 0.012 }); }
      if (v.jobs.smith > 0.005) {
        const fx = plan ? plan.temple.x + 0.004 : L.forge.x, fy = plan ? plan.temple.y - 0.012 : L.forge.y, gy = this.hf.groundY(fx, fy);
        this.kit(CIVIC.smithy, fx, fy, gy, plan ? -plan.angle : 0.5, 0.016, pal, accent);
        this.chimneys.push({ x: fx, y: fy, h: gy + 0.018 });
      }
      // the tribe's flag; red when the people are close to revolt
      if (!band && t) {
        const fx = v.x + 0.01, fy = v.y - 0.02, gy = this.hf.groundY(fx, fy), hgt = capital ? 0.07 : 0.045;
        b("pole", fx, gy, fy, 0, 0.012, hgt, 0.012, "#5a4430");
        b("flag", fx, gy + hgt * 0.82, fy, 0.4, capital ? 0.03 : 0.02, capital ? 0.03 : 0.02, 1, t.gov && t.gov.unrest > 0.6 ? "#d23c2c" : t.line);
      }
      // a ruler's temple or great hall rises step by step
      if (v.monument > 0.02) {
        const mx = plan ? plan.temple.x : v.x + 0.03, my = plan ? plan.temple.y : v.y - 0.065, gy = this.hf.groundY(mx, my), steps = Math.ceil(v.monument * 3);
        const mcol = v.isle === "hearth" ? "#b8705a" : v.isle === "gull" ? "#b4b0aa" : "#9c8b70";
        if ((t?.age ?? 0) >= 3) this.kit(CIVIC.temple, mx, my, gy, plan ? -plan.angle : 0.2, 0.016 * (0.7 + 0.3 * Math.min(1, v.monument)), pal, accent);
        else for (let k = 0; k < steps; k++) b("step", mx, gy + k * 0.012, my, 0, 0.05 - k * 0.012, 0.04, 0.05 - k * 0.012, mcol);
        if (v.monument >= 1 && (t?.age ?? 0) < 3) { b("gableBody", mx, gy + 0.036, my, 0, 0.012, 0.012, 0.012, mcol); b("gableRoof", mx, gy + 0.036, my, 0, 0.012, 0.012, 0.012, roofTint); }
      }
      for (let i = 0; i < fieldCount(v, L); i++) {
        const f = L.fields[i];
        if (plan && Math.hypot(f.x - v.x, (f.y - v.y) / 0.85) < L.R * 1.08) continue;
        put(this.fields, ifl++, f.x, this.hf.surfaceY(f.x, f.y) + 0.0025, f.y, -f.r, f.w, 1, f.h, CROPS[f.c]);
      }
      const def = Math.floor(v.defense);
      if (def >= 1) {
        const cnt = def >= 4 ? 36 : 56, R = 0.24, stone = def >= 4;
        // gates where the avenues, tracks and roads leave the town
        const dirs = plan ? plan.avenues : [Math.atan2(L.quarry.y - v.y, L.quarry.x - v.x), Math.atan2(v.py - v.y, v.px - v.x)];
        const gates = dirs.map((d) => Math.atan2(Math.sin(d) / 0.85, Math.cos(d)));
        const nearGate = (a: number) => gates.some((g) => Math.abs(Math.atan2(Math.sin(a - g), Math.cos(a - g))) < Math.PI / cnt * 1.2);
        const wallPal = stone ? pal : { ...pal, stone: "#6a4a30", roof: "#4a3424" };
        for (const g of gates) {
          const x = v.x + Math.cos(g) * R, y = v.y + Math.sin(g) * R * 0.85;
          if (this.hf.elevAt(x, y) < 0.002 || def < 2) continue;
          this.kit(CIVIC.gatehouse, x, y, this.hf.groundY(x, y), -Math.atan2(Math.cos(g) * 0.85, -Math.sin(g)), stone ? 0.024 : 0.018, wallPal, accent);
        }
        for (let k = 0; k < cnt && ip < 12000; k++) {
          const a = (k / cnt) * Math.PI * 2, x = v.x + Math.cos(a) * R, y = v.y + Math.sin(a) * R * 0.85;
          if (this.hf.elevAt(x, y) < 0.002 || nearGate(a)) continue;
          if (stone) {
            // continuous stone wall: segments laid along the ring, with a tower every ninth
            const tan = Math.atan2(Math.cos(a) * 0.85, -Math.sin(a)), seg = (2 * Math.PI * R) / cnt * 1.08;
            b("stone", x, this.hf.groundY(x, y), y, -tan, seg / 0.3, 0.02, 0.008 / 0.22, "#9a9490");
            if (k % 9 === 4) this.kit(CIVIC.tower, x, y, this.hf.groundY(x, y), 0, 0.022, { ...pal, stone: "#8c8680" }, accent);
          } else put(this.posts, ip++, x, this.hf.groundY(x, y), y, 0, 0.005, 0.02 + (k % 2) * 0.004, 0.005, def >= 2 ? "#6a4a30" : "#7a5a38");
        }
        if (def >= 2 && def < 4) for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + 0.4, x = v.x + Math.cos(a) * R, y = v.y + Math.sin(a) * R * 0.85; if (this.hf.elevAt(x, y) > 0.002) this.kit(CIVIC.tower, x, y, this.hf.groundY(x, y), 0, 0.016, wallPal, accent); }
      }
      if (v.granary >= 1 && !plan) {
        const x = v.x + 0.05, y = v.y - 0.03, gy = this.hf.groundY(x, y);
        if (era >= 2) this.kit(CIVIC.granary2, x, y, gy, 0.4, 0.018, pal, accent); else {
        b("granary", x, gy, y, 0, 0.02, 0.02, 0.02, "#c8a060"); b("granaryRoof", x, gy, y, 0, 0.02, 0.02, 0.02, "#a8803e"); }
      }
    }
    for (const k of Object.keys(this.B)) finish(this.B[k], n[k]);
    for (const k of Object.keys(this.K) as Prim[]) finish(this.K[k], this.kn[k] ?? 0);
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

  /** Place one person: position, facing, a slight lean when working, a bob when walking. */
  private figure(i: number, x: number, z: number, yaw: number, scale: number, color: string, bend: number, bob: number) {
    const y = this.hf.surfaceY(x, z) + bob;
    mBase.makeTranslation(x, y, z).multiply(RY(yaw)).multiply(RX(bend)).multiply(mB.makeScale(scale, scale, scale));
    putM(this.P.body, i, mBase, color);
  }

  /** Per-frame: people, named agents, boats and crews, lights, clouds, rain, lightning and smoke. */
  updateDynamic(w: Snap, time: number, z: number, inView: (x: number, y: number, m: number) => boolean, camY: number, dayLight: number, cam: { x: number; y: number }, viewR: number) {
    let n = 0;
        this.named = [];
    if (z > 4.2) {
      for (const v of w.villages) {
        if (v.lost || !inView(v.x, v.y, 0.5)) continue;
        const t = w.tribes[v.tribe]; if (!t) continue;
        const key = v.id + ":" + popOf(v) + ":" + Math.round(v.jobs.farmer * 50) + ":" + Math.floor(v.houses);
        let crowd = this.crowdCache.get(key);
        if (!crowd) { const L = layoutFor(this.terrain, v), t = w.tribes[v.tribe]; crowd = sampleCrowd(v, isPlanned(v, t) ? { ...L, houses: planFor(this.terrain, v, L).plots } : L, 60); this.crowdCache.set(key, crowd); }
        for (const p of crowd) {
          if (n >= 4900) break;
          const f = figureState(p, time);
          if (!inView(f.x, f.y, 0.05)) continue;
          const moving = f.state === "out" || f.state === "back";
          const yaw = moving && (f.hx || f.hy) ? Math.atan2(f.hx, f.hy) : p.ph * 2;
          const sc = p.job === "child" ? PERSON * 0.72 : PERSON;
          const ps = pose(f.state, p.job, time, p.ph);
          this.figure(n++, f.x, f.y, yaw, sc, JOB_COLOR[p.job] ?? JOB_COLOR.idle, ps.bend * 0.6, ps.bob * sc);
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
      if (z > 4.2 && !voy && n < 4980) {
        const t = w.tribes[a.tribe];
        const isRuler = t?.gov?.ruler === a.id, isHead = t?.factions?.some((f) => f.head === a.id);
        const job = ({ Leader: "leader", "Sky-speaker": "priest", Doctor: "doctor", "War leader": "warrior", Boatwright: "boatwright", Smith: "smith", Toolmaker: "miner", "Master builder": "builder" } as Record<string, string>)[a.role] ?? "leader";
        const color = isRuler ? RULER_COLOR : isHead ? HEAD_COLOR : JOB_COLOR[job] ?? JOB_COLOR.leader;
        this.figure(n++, x, y, Math.sin(time * 0.3 + a.id) * 0.6, PERSON * (isRuler ? 1.35 : 1.15), color, 0, Math.abs(Math.sin(time * 2 + a.id)) * 0.0004);
        put(this.rings, nr++, x, h, y, 0, PERSON * 1.1, PERSON * 1.1, PERSON * 1.1);
      }
    }

    // boats: voyages (with crews), route traffic, fishing boats; moving boats leave a wake
    let nh = 0, nf = 0, ns = 0, no = 0, nw = 0, nsh = 0;
    const sailTint = new THREE.Color();
    const boat = (x: number, y: number, head: number, tier: number, size: number, moving: boolean, crew?: Tribe, crewN = 0) => {
      if (nh + nf > 590) return;
      const rock = Math.sin(time * 1.6 + x * 9) * 0.12, yy = Math.sin(time * 1.3 + x * 7 + y * 5) * 0.002;
      const yaw = -head;
      if (tier >= 6) {
        if (nsh >= 300) return;
        const s = size * 1.7, r = rock * 0.4;
        put(this.shipHull, nsh, x, yy, y, yaw, s, s, s, "#5e4026", r, 0);
        put(this.shipRig, nsh, x, yy, y, yaw, s, s, s, "#3a2a1c", r, 0);
        put(this.shipSail, nsh, x, yy, y, yaw, s, s, s, sailTint.set("#f4ecd8").lerp(tmpC.set(crew?.line ?? "#f4ecd8"), 0.22), r, 0);
        nsh++;
        if (moving) put(this.wakes, nw++, x, 0.004, y, yaw, s * 1.2, s, s * (0.8 + 0.2 * Math.sin(time * 3 + x)));
        return;
      }
      if (tier <= 1) put(this.raft, nf++, x, yy, y, yaw, size, size, size, "#a8865a", 0, rock);
      else {
        put(this.hull, nh++, x, yy, y, yaw, size, size, size, "#8a6440", rock, 0);
        if (tier >= 3) put(this.outrig, no++, x, yy, y, yaw, size, size, size, "#8a6440", rock, 0);
        if (tier >= 4) put(this.sail, ns++, x, yy, y, yaw, size, size, size, "#f6ecd6", rock, 0);
      }
      if (moving) put(this.wakes, nw++, x, 0.004, y, yaw, size, size, size * (0.8 + 0.2 * Math.sin(time * 3 + x)));
      if (crew && z > 6) for (let k = 0; k < crewN; k++) crewSpots.push({ x: x + Math.cos(head) * size * (0.25 - k * 0.22), y: y + Math.sin(head) * size * (0.25 - k * 0.22), yaw: Math.PI / 2 - head, t: crew });
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
      // ships at anchor in the harbours of the Age of Sail
      const T = w.tribes[v.tribe];
      if (T?.techs.includes("carrack") && (v.stage === "town" || v.stage === "city")) for (let k = 0; k < (v.stage === "city" ? 3 : 2); k++) {
        const a = Math.atan2(v.py - v.y, v.px - v.x) + (k - 1) * 0.5, d = 0.07 + k * 0.025;
        const x = v.px + Math.cos(a) * d, y = v.py + Math.sin(a) * d;
        if (this.hf.elevAt(x, y) < -0.008) boat(x, y, a + Math.PI / 2 + Math.sin(time * 0.2 + k) * 0.1, 6, 0.036, false, T);
      }
    }
    // crews: seated, rocking with the paddle stroke
    for (const c of crewSpots) {
      if (n >= 4990) break;
      this.figure(n++, c.x, c.y, c.yaw, PERSON * 0.8, JOB_COLOR.fisher, 0.25 * Math.sin(time * 4), -PERSON * 0.15);
    }
    finish(this.P.body, n); finish(this.rings, nr);
    (this.rings.material as THREE.MeshBasicMaterial).opacity = 0.6 + 0.3 * Math.sin(time * 3);
    finish(this.hull, nh); finish(this.raft, nf); finish(this.sail, ns); finish(this.outrig, no); finish(this.wakes, nw);
    finish(this.shipHull, nsh); finish(this.shipRig, nsh); finish(this.shipSail, nsh);

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
  setVillagesVisible(on: boolean) { for (const m of [...Object.values(this.B), ...Object.values(this.K), this.fields, this.posts, this.roads]) m.visible = on; }
  setRoutesVisible(on: boolean) { this.routes.visible = on; }
  /** Show or hide what lies beyond the horizon. */
  setHorizon(open: boolean) { if (open !== this.horizon) { this.horizon = open; this.layoutTrees(this.lastLive, this.lastForest); } }
}
