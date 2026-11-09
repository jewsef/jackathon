import * as THREE from "three";
import type { World, Fx, PowerId } from "../sim/types";
import { WX, WY, KM_PER_UNIT, HOME, isOuter, type Terrain } from "../sim/terrain";
import { hash3 } from "../sim/rng";
import { renderRegion } from "../render/terrainTex";
import { LEVELS, type MapLike, type Selection } from "../render/common";
import { HeightField } from "./heightfield";
import { buildTerrainMesh, makeSharedUniforms, FX_CODE, MAX_EFFECTS, MAX_LIGHTS, type SharedUniforms } from "./terrainMesh";
import { buildWater } from "./water";
import { SkySystem } from "./sky";
import { Actors } from "./actors";
import { popOf } from "../sim/util";

type Snap = Omit<World, "chronicle">;
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const D0 = 13.5, FOV = 40;
const MOVE_KEYS = new Set(["w", "a", "s", "d", "arrowup", "arrowdown", "arrowleft", "arrowright", "q", "e", "t", "g", "z", "x"]);

/**
 * The 3D view. It reads world snapshots and never changes them (Rule A).
 * Camera state stays in the same shape as the 2D view: a ground target (x, y) and a zoom z.
 */
export class MapView3D implements MapLike {
  cam = { x: HOME.w / 2, y: HOME.h / 2, z: 1 };
  yaw = 0; tilt = 0;
  armed: { power: PowerId; radius: number } | null = null;
  selection: Selection = null;
  onCast: (x: number, y: number) => void = () => {};
  onSelect: (s: Selection) => void = () => {};
  onCamera: () => void = () => {};
  world: Snap | null = null;

  private el: HTMLElement; private terrain: Terrain;
  private renderer!: THREE.WebGLRenderer; private scene = new THREE.Scene(); private camera = new THREE.PerspectiveCamera(FOV, 1, 0.002, 600);
  private hf!: HeightField; private shared: SharedUniforms = makeSharedUniforms();
  private terrainU!: ReturnType<typeof buildTerrainMesh>["uniforms"];
  private skySys!: SkySystem; private actors!: Actors;
  private overlay = document.createElement("canvas"); private octx!: CanvasRenderingContext2D;
  private labels = document.createElement("div"); private labelPool: HTMLDivElement[] = [];
  private W = 800; private H = 450; private dpr = 1;
  private lastT = 0; private t = 0; private frameN = 0; private day = 1;
  private fly: { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; t: number } | null = null;
  private lastMove = 0; private detailBox: { x0: number; y0: number; w: number; h: number; res: number } | null = null; private detailTex: THREE.Texture | null = null;
  private mouse: { x: number; y: number } | null = null;
  private keys = new Set<string>();
  private dragging: () => boolean = () => false;
  private edgeScroll = (() => { try { return localStorage.getItem("bc.edge") !== "off"; } catch { return true; } })();
  private mini = document.createElement("canvas"); private miniBase!: HTMLCanvasElement; private compass = document.createElement("button");
  private trackpadUntil = 0;
  private pendingStrikes: Fx[] = [];
  private followFn: (() => [number, number] | null) | null = null;
  onFollowEnd: () => void = () => {};
  private fxList: { fx: Fx; t0: number }[] = [];
  private shake = 0; private flash = 0;
  private pickables: { x: number; y: number; r: number; sel: Selection }[] = [];
  private drops: { x: number; y: number; l: number; s: number }[] = [];
  private staticDirty = true;
  /** 0 = only the home waters are known; 1 = the whole world. Eases open when the first ocean ships sail. */
  private horizonK = 0; private miniOpen = false; private horizonT = 0;
  private extW() { return HOME.w + (WX - HOME.w) * this.horizonK; }
  private extH() { return HOME.h + (WY - HOME.h) * this.horizonK; }

  readonly low: boolean;
  constructor(el: HTMLElement, terrain: Terrain, quality: "high" | "low" = "high") { this.el = el; this.terrain = terrain; this.low = quality === "low"; }

  async init() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(this.low ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; this.renderer.toneMappingExposure = 0.85;
    this.el.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = "block";
    this.renderer.domElement.tabIndex = 0;
    Object.assign(this.overlay.style, { position: "absolute", inset: "0", pointerEvents: "none" });
    Object.assign(this.labels.style, { position: "absolute", inset: "0", pointerEvents: "none", overflow: "hidden" });
    this.el.append(this.overlay, this.labels);
    this.octx = this.overlay.getContext("2d")!;
    this.scene.fog = new THREE.Fog(0xa0b4c8, 10, 60);

    await new Promise((r) => setTimeout(r, 0));
    this.hf = this.low ? HeightField.build(this.terrain, 701, 395) : HeightField.build(this.terrain, 1601, 901);
    const base = this.low ? renderRegion(this.terrain, 0, 0, WX, WY, 1536, 864, false) : renderRegion(this.terrain, 0, 0, WX, WY, 3072, 1728, false);
    const tex = new THREE.CanvasTexture(base.canvas);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.flipY = false;
    const terr = buildTerrainMesh(this.hf, tex, this.shared);
    this.terrainU = terr.uniforms;
    this.scene.add(terr.mesh, buildWater(this.hf, this.shared));
    this.skySys = new SkySystem(this.scene);
    this.actors = new Actors(this.hf, this.terrain, this.low);
    this.scene.add(this.actors.group);
    this.bindInput();
    this.buildNavUI();
    this.resize();
    new ResizeObserver(() => this.resize()).observe(this.el);
    this.renderer.setAnimationLoop(() => this.frame());
  }

  /** Keep the camera on a moving target (a person, a boat, a village) until the player moves the camera. */
  follow(fn: (() => [number, number] | null) | null) { this.followFn = fn; this.fly = null; }
  following() { return this.followFn !== null; }
  private stopFollow() { if (this.followFn) { this.followFn = null; this.onFollowEnd(); } }
  setDayCycle(on: boolean) { this.skySys.locked = !on; }
  dayCycleOn() { return !this.skySys.locked; }
  refresh() { this.staticDirty = true; }
  setWorld(w: Snap, fx: Fx[]) {
    this.world = w; this.staticDirty = true;
    const now = performance.now();
    for (const f of fx) {
      this.fxList.push({ fx: f, t0: now });
      if (f.kind === "quake") this.shake = 1.2;
      if (f.kind === "lightning") { this.flash = 0.6; this.pendingStrikes.push(f); }
    }
    if (this.fxList.length > 60) this.fxList.splice(0, this.fxList.length - 60);
    this.shared.season.value = w.tick % 4;
  }

  // ---------- camera ----------
  private dist() { return (D0 * this.extW() / HOME.w) / this.cam.z; }
  private pitch() { const k = clamp(Math.log(this.cam.z) / Math.log(14), 0, 1); return clamp((62 - 30 * k + this.tilt) * Math.PI / 180, 0.12, 1.45); }
  private placeCamera() {
    const d = this.dist(), p = this.pitch();
    const ty = Math.max(0, this.hf.groundY(this.cam.x, this.cam.y));
    let sx = 0, sy = 0;
    if (this.shake > 0) { sx = (Math.random() - 0.5) * 0.02 * this.shake * d; sy = (Math.random() - 0.5) * 0.02 * this.shake * d; }
    this.camera.position.set(this.cam.x + sx - Math.sin(this.yaw) * Math.cos(p) * d, ty + Math.sin(p) * d, this.cam.y + sy + Math.cos(this.yaw) * Math.cos(p) * d);
    this.camera.lookAt(this.cam.x + sx, ty, this.cam.y + sy);
    this.camera.updateMatrixWorld();
  }
  private clampCam() { this.cam.z = clamp(this.cam.z, 1, 60); this.cam.x = clamp(this.cam.x, -0.5, this.extW() + 0.5); this.cam.y = clamp(this.cam.y, -0.5, this.extH() + 0.5); }
  private moved() { this.lastMove = performance.now(); this.onCamera(); }
  flyTo(x: number, y: number, z: number) { this.fly = { x0: this.cam.x, y0: this.cam.y, z0: this.cam.z, x1: x, y1: y, z1: clamp(z, 1, 60), t: 0 }; }
  zoomBy(f: number, px?: number, py?: number) {
    const g = px !== undefined && py !== undefined ? this.groundAt(px, py) : null;
    const old = this.cam.z;
    this.cam.z = clamp(this.cam.z * f, 1, 60);
    if (g) { const k = 1 - old / this.cam.z; this.cam.x += (g[0] - this.cam.x) * k; this.cam.y += (g[1] - this.cam.y) * k; }
    this.clampCam(); this.moved(); this.fly = null;
  }
  level() { let i = 0; while (this.cam.z > LEVELS[i].max) i++; return i; }
  scaleBar() {
    const unitsPerPx = (2 * this.dist() * Math.tan((FOV / 2) * Math.PI / 180)) / this.H, kmPerPx = unitsPerPx * KM_PER_UNIT;
    const opts = [0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50];
    let best = opts[0]; for (const o of opts) if (o / kmPerPx <= 120) best = o;
    return { px: Math.round(best / kmPerPx), label: best < 1 ? Math.round(best * 1000) + " m" : best + " km" };
  }
  private proj = new THREE.Vector3();
  toScreen(x: number, y: number, h?: number): [number, number] {
    this.proj.set(x, h ?? this.hf.surfaceY(x, y), y).project(this.camera);
    return [(this.proj.x * 0.5 + 0.5) * this.W, (-this.proj.y * 0.5 + 0.5) * this.H];
  }
  private visible3(x: number, y: number, h: number) { this.proj.set(x, h, y).project(this.camera); return this.proj.z < 1 && Math.abs(this.proj.x) < 1.2 && Math.abs(this.proj.y) < 1.2; }
  private ray = new THREE.Raycaster();
  /** Where a screen pixel hits the ground or sea: ray-march against the height field. */
  groundAt(px: number, py: number): [number, number] | null {
    this.ray.setFromCamera(new THREE.Vector2((px / this.W) * 2 - 1, -(py / this.H) * 2 + 1), this.camera);
    const o = this.ray.ray.origin, d = this.ray.ray.direction;
    const step = Math.max(0.002, this.dist() * 0.004);
    let prev = 0;
    for (let s = 0; s < 4000; s++) {
      const t = s * step, x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t;
      if (y <= this.hf.surfaceY(x, z)) {
        let lo = prev, hi = t;
        for (let k = 0; k < 12; k++) { const m = (lo + hi) / 2; if (o.y + d.y * m <= this.hf.surfaceY(o.x + d.x * m, o.z + d.z * m)) hi = m; else lo = m; }
        return [o.x + d.x * hi, o.z + d.z * hi];
      }
      prev = t;
      if (y < -1) break;
    }
    if (d.y < 0) { const t = -o.y / d.y; return [o.x + d.x * t, o.z + d.z * t]; }
    return null;
  }
  /** Cheap pick against sea level, for masking rain to the storm area. */
  private seaAt(px: number, py: number): [number, number] | null {
    this.ray.setFromCamera(new THREE.Vector2((px / this.W) * 2 - 1, -(py / this.H) * 2 + 1), this.camera);
    const o = this.ray.ray.origin, d = this.ray.ray.direction;
    if (d.y >= 0) return null;
    const t = -o.y / d.y;
    return [o.x + d.x * t, o.z + d.z * t];
  }
  private inView = (x: number, y: number, m: number) => {
    const d = this.dist() * 1.15 + m;
    return Math.abs(x - this.cam.x) < d * 1.4 && Math.abs(y - this.cam.y) < d * 1.4;
  };

  private bindInput() {
    const cv = this.renderer.domElement;
    const ptrs = new Map<number, [number, number]>();
    let drag = 0, pinch = 0, orbit = false, panFrom: [number, number] | null = null;
    cv.addEventListener("contextmenu", (e) => e.preventDefault());
    cv.addEventListener("wheel", (e) => {
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      // Trackpad two-finger scroll pans (it sends sideways deltas); pinch (ctrl+wheel) and a mouse wheel zoom.
      if (!e.ctrlKey && e.deltaMode === 0 && Math.abs(e.deltaX) > 0.5) this.trackpadUntil = performance.now() + 400;
      if (!e.ctrlKey && performance.now() < this.trackpadUntil) { const u = this.unitsPerPx(); this.fly = null; this.panBy(e.deltaX * u, e.deltaY * u); return; }
      const k = e.ctrlKey ? 0.01 : e.deltaMode === 1 ? 0.05 : 0.0016;
      this.zoomBy(Math.exp(-e.deltaY * k), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    cv.addEventListener("pointerdown", (e) => {
      try { cv.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      const r = cv.getBoundingClientRect();
      ptrs.set(e.pointerId, [e.clientX, e.clientY]); this.fly = null;
      orbit = e.button === 2 || e.button === 1 || e.shiftKey;
      if (ptrs.size === 1) { drag = 0; panFrom = this.groundAt(e.clientX - r.left, e.clientY - r.top); }
      if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = Math.hypot(a[0] - b[0], a[1] - b[1]); drag = 99; }
    });
    cv.addEventListener("pointermove", (e) => {
      const r = cv.getBoundingClientRect();
      this.mouse = { x: e.clientX - r.left, y: e.clientY - r.top };
      const prev = ptrs.get(e.pointerId);
      if (!prev) return;
      ptrs.set(e.pointerId, [e.clientX, e.clientY]);
      const dx = e.clientX - prev[0], dy = e.clientY - prev[1];
      drag += Math.abs(dx) + Math.abs(dy);
      if (ptrs.size === 2 && pinch) {
        const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        this.zoomBy(d / pinch, (a[0] + b[0]) / 2 - r.left, (a[1] + b[1]) / 2 - r.top); pinch = d; return;
      }
      if (orbit) { this.yaw -= dx * 0.006; this.tilt = clamp(this.tilt + dy * 0.15, -40, 25); this.moved(); return; }
      if (panFrom) {
        const now = this.groundAt(this.mouse.x, this.mouse.y);
        if (now) { this.stopFollow(); this.cam.x += panFrom[0] - now[0]; this.cam.y += panFrom[1] - now[1]; this.clampCam(); this.placeCamera(); }
        this.moved();
      }
    });
    const end = (e: PointerEvent) => {
      if (!ptrs.has(e.pointerId)) return;
      ptrs.delete(e.pointerId);
      if (ptrs.size < 2) pinch = 0;
      if (!ptrs.size && drag < 6 && e.type === "pointerup" && !orbit) { const r = cv.getBoundingClientRect(); this.click(e.clientX - r.left, e.clientY - r.top); }
      if (!ptrs.size) { panFrom = null; orbit = false; }
    };
    cv.addEventListener("pointerup", end); cv.addEventListener("pointercancel", end);
    cv.addEventListener("pointerleave", () => { this.mouse = null; });
    cv.addEventListener("dblclick", (e) => {
      if (this.armed) return;
      const r = cv.getBoundingClientRect(), g = this.groundAt(e.clientX - r.left, e.clientY - r.top);
      if (g) this.flyTo(g[0], g[1], Math.min(60, Math.max(this.cam.z * 2, 3)));
    });
    // Keys work anywhere on the page (except while typing). Held keys move smoothly every frame.
    window.addEventListener("keydown", (e) => {
      const tg = e.target as HTMLElement | null;
      if (tg && (tg.tagName === "INPUT" || tg.tagName === "TEXTAREA" || tg.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if (MOVE_KEYS.has(k)) { this.keys.add(k); e.preventDefault(); this.fly = null; }
      if (k === "r") { this.yaw = 0; this.tilt = 0; this.moved(); }
      if (k === "+" || k === "=") this.zoomBy(1.4);
      if (k === "-" || k === "_") this.zoomBy(1 / 1.4);
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener("blur", () => this.keys.clear());
    this.dragging = () => ptrs.size > 0;
  }

  /** Pan in screen directions: +right / +down, in world units. */
  private panBy(right: number, down: number) {
    this.stopFollow();
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    this.cam.x += right * c - down * s;
    this.cam.y += right * s + down * c;
    this.clampCam(); this.moved();
  }
  private unitsPerPx() { return (2 * this.dist() * Math.tan((FOV / 2) * Math.PI / 180)) / Math.max(1, this.H); }

  /** Continuous movement: keys and edge scrolling. Speed scales with zoom so the screen moves at the same pace. */
  private motion(dt: number) {
    const k = this.keys, sp = this.dist() * 0.9 * dt;
    let r = 0, d = 0;
    if (k.has("a") || k.has("arrowleft")) r -= 1;
    if (k.has("d") || k.has("arrowright")) r += 1;
    if (k.has("w") || k.has("arrowup")) d -= 1;
    if (k.has("s") || k.has("arrowdown")) d += 1;
    if (this.edgeScroll && this.mouse && !this.dragging()) {
      const m = 22;
      if (this.mouse.x < m) r -= 1 - this.mouse.x / m; else if (this.mouse.x > this.W - m) r += 1 - (this.W - this.mouse.x) / m;
      if (this.mouse.y < m) d -= 1 - this.mouse.y / m; else if (this.mouse.y > this.H - m) d += 1 - (this.H - this.mouse.y) / m;
    }
    if (r || d) this.panBy(r * sp, d * sp);
    if (k.has("q")) { this.yaw += 1.6 * dt; this.moved(); }
    if (k.has("e")) { this.yaw -= 1.6 * dt; this.moved(); }
    if (k.has("t")) { this.tilt = clamp(this.tilt - 40 * dt, -40, 25); this.moved(); }
    if (k.has("g")) { this.tilt = clamp(this.tilt + 40 * dt, -40, 25); this.moved(); }
    if (k.has("z")) this.zoomBy(Math.exp(1.6 * dt));
    if (k.has("x")) this.zoomBy(Math.exp(-1.6 * dt));
  }

  // ---------- minimap and compass ----------
  private buildNavUI() {
    const wrap = document.createElement("div");
    wrap.className = "nav3d";
    this.mini.width = 216 * 2; this.mini.height = 122 * 2; this.mini.className = "minimap";
    this.mini.title = "Click or drag to move the camera";
    const edge = document.createElement("button");
    edge.type = "button"; edge.className = "edgebtn";
    const syncEdge = () => { edge.textContent = this.edgeScroll ? "Edge scroll: on" : "Edge scroll: off"; edge.setAttribute("aria-pressed", String(this.edgeScroll)); };
    syncEdge();
    edge.addEventListener("click", () => { this.edgeScroll = !this.edgeScroll; try { localStorage.setItem("bc.edge", this.edgeScroll ? "on" : "off"); } catch { /* ignore */ } syncEdge(); });
    wrap.append(this.mini, edge);
    this.compass.type = "button"; this.compass.className = "compass"; this.compass.title = "Face north (R)";
    this.compass.innerHTML = '<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="18" fill="rgba(12,19,31,0.85)" stroke="#26344c"/><g class="needle"><path d="M20 5 L25 20 L20 18 L15 20 Z" fill="#e0725a"/><path d="M20 35 L25 20 L20 22 L15 20 Z" fill="#8d9ab0"/><text x="20" y="13" text-anchor="middle" font-size="7" fill="#fff" font-family="sans-serif">N</text></g></svg>';
    this.compass.addEventListener("click", () => { this.yaw = 0; this.tilt = 0; this.moved(); });
    this.el.append(wrap, this.compass);
    const go = (e: PointerEvent) => {
      const r = this.mini.getBoundingClientRect();
      const [mw, mh] = this.miniExt();
      const x = ((e.clientX - r.left) / r.width) * (mw + 2) - 1, y = ((e.clientY - r.top) / r.height) * (mh + 1.125) - 0.5625;
      this.fly = null; this.stopFollow(); this.cam.x = x; this.cam.y = y; this.clampCam(); this.moved();
    };
    this.mini.addEventListener("pointerdown", (e) => { try { this.mini.setPointerCapture(e.pointerId); } catch { /* ignore */ } go(e); });
    this.mini.addEventListener("pointermove", (e) => { if (e.buttons) go(e); });
    this.buildMiniBase();
  }
  private miniExt(): [number, number] { return this.miniOpen ? [WX, WY] : [HOME.w, HOME.h]; }
  private buildMiniBase() {
    const [mw, mh] = this.miniExt();
    this.miniBase = renderRegion(this.terrain, -1, -0.5625, mw + 2, mh + 1.125, 216, 122, false).canvas;
  }
  private drawMinimap() {
    const g = this.mini.getContext("2d")!, W = this.mini.width, H = this.mini.height;
    const [mw, mh] = this.miniExt();
    const mx = (x: number) => ((x + 1) / (mw + 2)) * W, my = (y: number) => ((y + 0.5625) / (mh + 1.125)) * H;
    g.imageSmoothingEnabled = true;
    g.drawImage(this.miniBase, 0, 0, W, H);
    if (this.world) for (const v of this.world.villages) {
      if (v.lost) continue;
      g.fillStyle = this.world.tribes[v.tribe]?.line ?? "#f2b257";
      g.beginPath(); g.arc(mx(v.x), my(v.y), 2.2 + Math.min(3, Math.sqrt(popOf(v)) / 12), 0, Math.PI * 2); g.fill();
    }
    const corner = (px: number, py: number): [number, number] => {
      const p = this.seaAt(px, py);
      const fx = Math.sin(this.yaw), fy = -Math.cos(this.yaw), far: [number, number] = [this.cam.x + fx * this.dist() * 3, this.cam.y + fy * this.dist() * 3];
      if (!p || Math.hypot(p[0] - this.cam.x, p[1] - this.cam.y) > this.dist() * 3) return far;
      return p;
    };
    const pts = [corner(0, 0), corner(this.W, 0), corner(this.W, this.H), corner(0, this.H)];
    g.strokeStyle = "#f2f6fa"; g.lineWidth = 2; g.fillStyle = "rgba(143,208,230,0.15)";
    g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(mx(x), my(y)) : g.moveTo(mx(x), my(y)))); g.closePath(); g.fill(); g.stroke();
    g.fillStyle = "#f2b257"; g.beginPath(); g.arc(mx(this.cam.x), my(this.cam.y), 3, 0, Math.PI * 2); g.fill();
    const needle = this.compass.querySelector(".needle") as SVGGElement | null;
    if (needle) needle.setAttribute("transform", `rotate(${(-this.yaw * 180) / Math.PI} 20 20)`);
  }

  private click(px: number, py: number) {
    const g = this.groundAt(px, py);
    if (this.armed) { if (g) this.onCast(g[0], g[1]); return; }
    for (const p of this.pickables) if (Math.hypot(p.x - px, p.y - py) <= p.r) { this.selection = p.sel; this.onSelect(p.sel); return; }
    let isle = g ? this.terrain.isleAt(g[0], g[1]) : null;
    if (isle && isOuter(isle) && this.horizonK < 0.5) isle = null;
    const sel: Selection = g && isle && this.hf.elevAt(g[0], g[1]) > 0 ? { kind: "isle", id: isle } : null;
    this.selection = sel; this.onSelect(sel);
  }

  private resize() {
    this.W = this.el.clientWidth; this.H = this.el.clientHeight; this.dpr = this.low ? 1 : Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setSize(this.W, this.H, false);
    this.renderer.domElement.style.width = this.W + "px"; this.renderer.domElement.style.height = this.H + "px";
    this.camera.aspect = this.W / Math.max(1, this.H); this.camera.updateProjectionMatrix();
    this.overlay.width = this.W * this.dpr; this.overlay.height = this.H * this.dpr;
    this.overlay.style.width = this.W + "px"; this.overlay.style.height = this.H + "px";
  }

  /** Detail on demand (Rule D): a sharper painted texture for the area in view once the camera settles. */
  private updateDetail() {
    if (this.cam.z < 2.6) { this.terrainU.detailOn.value = 0; this.detailBox = null; return; }
    const span = this.dist() * 1.6, x0 = clamp(this.cam.x - span / 2, 0, WX - span), y0 = clamp(this.cam.y - span * 0.45, 0, WY - span * 0.9);
    const w = Math.min(WX, span), h = Math.min(WY, span * 0.9);
    const b = this.detailBox;
    const inside = b && this.cam.x - span * 0.3 > b.x0 && this.cam.x + span * 0.3 < b.x0 + b.w && this.cam.y - span * 0.3 > b.y0 && this.cam.y + span * 0.3 < b.y0 + b.h;
    if (b && inside && b.w <= span * 1.6) return;
    const res = this.low ? 700 : 1400, ph = Math.round(res * h / w);
    const r = renderRegion(this.terrain, x0, y0, w, h, res, ph, false);
    this.detailTex?.dispose();
    const tex = new THREE.CanvasTexture(r.canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; tex.flipY = false;
    this.detailTex = tex;
    this.terrainU.detailMap.value = tex;
    this.terrainU.detailRect.value.set(x0 / WX, y0 / WY, w / WX, h / WY);
    this.terrainU.detailOn.value = 1;
    this.detailBox = { x0, y0, w, h, res };
  }

  private pushEffects(w: Snap) {
    let n = 0;
    const arr = this.shared.effects.value;
    for (const e of w.effects) {
      if (n >= MAX_EFFECTS) break;
      const code = e.power === "eruption" ? (e.age < 8 ? FX_CODE.ashYoung : FX_CODE.ashOld) : FX_CODE[e.power];
      if (!code) continue;
      arr[n++].set(e.x, e.y, e.r, code);
    }
    this.shared.effectCount.value = n;
    let m = 0;
    const L = this.shared.lights.value;
    for (const v of w.villages) {
      if (v.lost || m >= MAX_LIGHTS) continue;
      const pop = popOf(v);
      L[m++].set(v.x, v.y, 0.08 + Math.sqrt(pop) / 150, v.sick ? 0.6 : 0.9);
    }
    this.shared.lightCount.value = m;
  }

  private frame() {
    const nowT = performance.now(), dt = this.lastT ? Math.min(0.05, (nowT - this.lastT) / 1000) : 0.016; this.lastT = nowT;
    this.t += dt;
    if (this.fly) {
      const f = this.fly; f.t = Math.min(1, f.t + dt / 1.2);
      const e = f.t < 0.5 ? 2 * f.t * f.t : 1 - Math.pow(-2 * f.t + 2, 2) / 2;
      this.cam.x = f.x0 + (f.x1 - f.x0) * e; this.cam.y = f.y0 + (f.y1 - f.y0) * e;
      this.cam.z = Math.exp(Math.log(f.z0) + (Math.log(f.z1) - Math.log(f.z0)) * e);
      this.moved();
      if (f.t >= 1) this.fly = null;
    }
    if (this.shake > 0) this.shake -= dt;
    this.motion(dt);
    if (this.followFn && !this.fly) {
      const p = this.followFn();
      if (!p) this.stopFollow();
      else { const k = Math.min(1, dt * 4); this.cam.x += (p[0] - this.cam.x) * k; this.cam.y += (p[1] - this.cam.y) * k; this.moved(); }
    }
    const hz = this.world?.horizon ? 1 : 0;
    if (Math.abs(hz - this.horizonK) > 0.001) {
      const before = this.horizonK;
      const now = performance.now(), real = Math.min(0.5, (now - (this.horizonT || now)) / 1000); this.horizonT = now;
      this.horizonK = hz > this.horizonK ? Math.min(1, this.horizonK + Math.max(dt, real) * 0.35) : 0;
      if (this.cam.z < 1.5 && !this.followFn && !this.fly) { this.cam.x = HOME.w / 2 + (WX - HOME.w) / 2 * this.horizonK; this.cam.y = HOME.h / 2 + (WY - HOME.h) / 2 * this.horizonK; }
      if (before < 0.5 && this.horizonK >= 0.5 || before >= 0.5 && this.horizonK < 0.5) { this.actors.setHorizon(this.horizonK >= 0.5); this.staticDirty = true; }
      this.clampCam(); this.onCamera();
    }
    this.shared.horizon.value = this.horizonK;
    if ((this.horizonK >= 0.5) !== this.miniOpen) { this.miniOpen = this.horizonK >= 0.5; this.buildMiniBase(); }
    this.placeCamera();
    this.shared.time.value = this.t;
    this.day = this.skySys.update(dt, this.shared, this.scene);
    const fogFar = Math.max(6, this.dist() * 4.5);
    this.shared.fogNear.value = fogFar * 0.45; this.shared.fogFar.value = fogFar;
    const fog = this.scene.fog as THREE.Fog; fog.near = fogFar * 0.45; fog.far = fogFar;
    if (performance.now() - this.lastMove > 250) this.updateDetail();
    const w = this.world;
    if (w) {
      this.pushEffects(w);
      if (this.staticDirty) { this.actors.updateStatic(w, this.selection); this.staticDirty = false; }
      const z = this.cam.z;
      this.actors.setVillagesVisible(z > 1.7);
      this.actors.setPeopleVisible(z > 4.2);
      this.actors.setRoutesVisible(z < 9);
      for (const f of this.pendingStrikes.splice(0)) this.actors.strike(f, w, this.t);
      this.actors.updateDynamic(w, this.t, z, this.inView, this.camera.position.y, this.day, this.cam, this.dist());
    }
    this.renderer.render(this.scene, this.camera);
    this.drawOverlay(dt);
    if (this.frameN++ % 3 === 0) this.drawMinimap();
  }

  // ---------- overlay: rings, effects, rain, brush, labels ----------
  private drawOverlay(dt: number) {
    const g = this.octx, w = this.world;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.W, this.H);
    this.pickables = [];
    let li = 0;
    const label = (text: string, x: number, y: number, cls: string) => {
      let el = this.labelPool[li];
      if (!el) { el = document.createElement("div"); el.className = "lbl3d"; this.labels.appendChild(el); this.labelPool.push(el); }
      if (el.textContent !== text) el.textContent = text;
      if (el.dataset.cls !== cls) { el.className = "lbl3d " + cls; el.dataset.cls = cls; }
      el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px) translate(-50%, -50%)`;
      el.style.display = "block";
      li++;
    };
    const z = this.cam.z;
    if (z < 3.4) for (const I of this.terrain.isles) {
      if (isOuter(I.id) && this.horizonK < 0.5) continue;
      const h = Math.max(0.05, this.hf.groundY(I.cx, I.cy)) + 0.25;
      if (!this.visible3(I.cx, I.cy, h)) continue;
      const [x, y] = this.toScreen(I.cx, I.cy, h);
      label(I.name, x, y, I.id === "hearth" || I.id === "far" || I.id === "great" ? "isle big" : "isle");
    }
    if (w) {
      for (const v of w.villages) {
        if (v.lost || !this.inView(v.x, v.y, 0.3)) continue;
        const h = this.hf.surfaceY(v.x, v.y);
        if (!this.visible3(v.x, v.y, h)) continue;
        const [sx, sy] = this.toScreen(v.x, v.y, h);
        if (z > 1.6 && z < 10) label(v.name.toUpperCase(), sx, sy + 18, "village");
        if (v.sick) { const pulse = 0.5 + 0.5 * Math.sin(this.t * 4); g.strokeStyle = `rgba(224,114,90,${0.4 + 0.5 * pulse})`; g.lineWidth = 2; g.beginPath(); g.arc(sx, sy, 16 + z, 0, Math.PI * 2); g.stroke(); }
        if (this.selection?.kind === "village" && this.selection.id === v.id) { g.strokeStyle = "rgba(227,232,240,0.9)"; g.lineWidth = 2; g.beginPath(); g.arc(sx, sy, 20 + z * 1.5, 0, Math.PI * 2); g.stroke(); }
        this.pickables.push({ x: sx, y: sy, r: Math.max(16, 6 * z), sel: { kind: "village", id: v.id } });
      }
      for (const v of w.villages) if (v.lost && z < 6 && this.inView(v.x, v.y, 0.3)) {
        const [sx, sy] = this.toScreen(v.x, v.y); g.strokeStyle = "rgba(141,154,176,0.5)"; g.lineWidth = 1.3; g.beginPath(); g.arc(sx, sy, 6, 0, Math.PI * 2); g.stroke();
      }
      for (const voy of w.voyages) {
        const vx = voy.leg === "out" ? voy.fx + (voy.tx - voy.fx) * voy.progress : voy.tx + (voy.fx - voy.tx) * voy.progress;
        const vy = voy.leg === "out" ? voy.fy + (voy.ty - voy.fy) * voy.progress : voy.ty + (voy.fy - voy.ty) * voy.progress;
        if (!this.visible3(vx, vy, 0)) continue;
        const [sx, sy] = this.toScreen(vx, vy, 0);
        if (voy.purpose !== "drift") { g.strokeStyle = "rgba(242,178,87,0.65)"; g.lineWidth = 1.3; g.beginPath(); g.arc(sx, sy, 10 + z * 0.6, 0, Math.PI * 2); g.stroke(); }
        this.pickables.push({ x: sx, y: sy, r: 16, sel: { kind: "voyage", id: voy.id } });
      }
      for (const n of this.actors.named) {
        if (!this.visible3(n.x, n.y, n.h)) continue;
        const [sx, sy] = this.toScreen(n.x, n.y, n.h + 0.012);
        if (z > 7) label(`${n.a.name} · ${n.a.role}`, sx, sy - 14, "agent");
        if (z > 4.2) this.pickables.unshift({ x: sx, y: sy + 6, r: 14, sel: { kind: "agent", id: n.a.id } });
        if (this.selection?.kind === "agent" && this.selection.id === n.a.id) { g.strokeStyle = "rgba(242,178,87,1)"; g.lineWidth = 2.5; g.beginPath(); g.arc(sx, sy + 6, 16, 0, Math.PI * 2); g.stroke(); }
      }
      this.drawWeather(g, w, dt);
    }
    for (let k = li; k < this.labelPool.length; k++) this.labelPool[k].style.display = "none";
    this.drawFx(g);
    if (this.armed && this.mouse) {
      const c = this.groundAt(this.mouse.x, this.mouse.y);
      if (c) {
        const hot = ["plague", "storm", "quake", "eruption", "drought"].includes(this.armed.power);
        g.strokeStyle = hot ? "rgba(224,114,90,0.95)" : "rgba(143,208,230,0.95)"; g.lineWidth = 1.8; g.beginPath();
        for (let k = 0; k <= 48; k++) {
          const a = (k / 48) * Math.PI * 2, x = c[0] + Math.cos(a) * this.armed.radius, y = c[1] + Math.sin(a) * this.armed.radius;
          const [sx, sy] = this.toScreen(x, y);
          if (k) g.lineTo(sx, sy); else g.moveTo(sx, sy);
        }
        g.stroke();
      }
    }
  }

  private drawWeather(g: CanvasRenderingContext2D, w: Snap, dt: number) {
    if (w.effects.some((e) => e.power === "storm")) { g.fillStyle = "rgba(10,18,32,0.16)"; g.fillRect(0, 0, this.W, this.H); }
    const windy = w.effects.filter((e) => e.power === "wind");
    if (windy.length && this.cam.z < 6) {
      g.strokeStyle = "rgba(235,245,252,0.45)"; g.lineWidth = 1.2; g.beginPath();
      for (let i = 0; i < 90; i++) {
        const wx = ((hash3(i, 1, 31) * WX + this.t * 0.9 * (0.7 + hash3(i, 3, 31) * 0.6)) % (WX + 1)) - 0.5, wy = hash3(i, 2, 31) * WY;
        if (!windy.some((e) => Math.hypot(wx - e.x, wy - e.y) < e.r)) continue;
        const a1 = this.toScreen(wx, wy, 0.15), a2 = this.toScreen(wx + 0.45, wy - 0.04, 0.15);
        g.moveTo(a1[0], a1[1]); g.quadraticCurveTo((a1[0] + a2[0]) / 2, a1[1] - 4, a2[0], a2[1]);
      }
      g.stroke();
    }
  }

  private drawFx(g: CanvasRenderingContext2D) {
    const now = performance.now();
    if (this.flash > 0.02) { g.fillStyle = `rgba(215,232,255,${this.flash * 0.3})`; g.fillRect(0, 0, this.W, this.H); this.flash *= 0.88; }
    this.fxList = this.fxList.filter((f) => now - f.t0 < 3200);
    for (const { fx, t0 } of this.fxList) {
      const age = (now - t0) / 1000, [x, y] = this.toScreen(fx.x, fx.y);
      g.lineWidth = 2.5;
      if (fx.kind === "eruption") { g.strokeStyle = `rgba(224,114,90,${Math.max(0, 1 - age / 3)})`; g.beginPath(); g.arc(x, y, 20 + age * 70, 0, Math.PI * 2); g.stroke(); }
      else if (fx.kind === "quake") { g.strokeStyle = `rgba(200,178,138,${Math.max(0, 0.6 - age / 2)})`; for (let k = 0; k < 3; k++) { g.beginPath(); g.arc(x, y, (age * 120 + k * 30) % 160, 0, Math.PI * 2); g.stroke(); } }
      else if (fx.kind === "omen" && age < 2.6) {
        const u = age / 2.6, cx = -60 + u * (this.W + 120), cy = 40 + u * 80;
        g.strokeStyle = `rgba(242,178,87,${0.8 * (1 - u)})`; g.lineWidth = 3; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx - 120, cy - 30); g.stroke();
      } else if (fx.kind === "plague" || fx.kind === "battle") { g.strokeStyle = fx.kind === "plague" ? `rgba(143,176,112,${Math.max(0, 0.9 - age / 2)})` : `rgba(224,114,90,${Math.max(0, 0.9 - age / 2)})`; g.beginPath(); g.arc(x, y, 10 + age * 40, 0, Math.PI * 2); g.stroke(); }
      else if (fx.kind === "found") { g.strokeStyle = `rgba(242,178,87,${Math.max(0, 1 - age / 2.5)})`; g.beginPath(); g.arc(x, y, 10 + age * 50, 0, Math.PI * 2); g.stroke(); }
      else if (fx.kind === "uprising") { g.strokeStyle = `rgba(230,70,60,${Math.max(0, 1 - age / 3)})`; g.setLineDash([6, 5]); for (let k = 0; k < 2; k++) { g.beginPath(); g.arc(x, y, 12 + age * 36 + k * 14, 0, Math.PI * 2); g.stroke(); } g.setLineDash([]); }
      else if (fx.kind === "age") { g.strokeStyle = `rgba(255,216,77,${Math.max(0, 1 - age / 3.2)})`; g.lineWidth = 3.5; g.beginPath(); g.arc(x, y, 14 + age * 90, 0, Math.PI * 2); g.stroke(); }
      else if (fx.kind === "lost") { g.strokeStyle = `rgba(220,234,242,${Math.max(0, 0.8 - age / 1.6)})`; g.beginPath(); g.arc(x, y, 6 + age * 26, 0, Math.PI * 2); g.stroke(); }
    }
  }
}
