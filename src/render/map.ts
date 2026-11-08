import { Application, Container, Sprite, Texture, Graphics, Text } from "pixi.js";
import type { World, Village, Agent, Voyage, Fx, PowerId, Tribe } from "../sim/types";
import { WX, WY, KM_PER_UNIT, type Terrain, type IsleId } from "../sim/terrain";
import { fbm } from "../sim/noise";
import { hash3 } from "../sim/rng";
import { popOf } from "../sim/util";
import { renderRegion, type Region } from "./terrainTex";
import { layoutFor, sampleCrowd, figurePos, houseCount, fieldCount, type Figure } from "./crowd";
import { drawCharacter } from "./sprites";
import { voyagePos } from "../sim/voyages";

import { LEVELS, type Selection, type MapLike } from "./common";
export { LEVELS, type Selection };

const hex = (c: string) => parseInt(c.slice(1, 7), 16);
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

interface ActiveFx { fx: Fx; t0: number; }

export class MapView implements MapLike {
  app = new Application();
  el: HTMLElement;
  terrain: Terrain;
  world: Omit<World, "chronicle"> | null = null;
  cam = { x: WX / 2, y: WY / 2, z: 1 };
  W = 800; H = 450;
  armed: { power: PowerId; radius: number } | null = null;
  onCast: (x: number, y: number) => void = () => {};
  onSelect: (s: Selection) => void = () => {};
  onCamera: () => void = () => {};
  selection: Selection = null;
  private worldC = new Container();
  private screenC = new Container();
  private base!: Sprite;
  private detailSprite: Sprite | null = null;
  private detail: Region | null = null;
  private overlayG = new Graphics(); private fieldsG = new Graphics(); private treesG = new Graphics();
  private routesG = new Graphics(); private housesG = new Graphics(); private boatsG = new Graphics();
  private peopleC = new Container(); private ringsG = new Graphics(); private glowC = new Container();
  private cloudSprite!: Sprite; private cloudCanvas = document.createElement("canvas"); private cloudTex!: Texture;
  private rainG = new Graphics(); private fxG = new Graphics(); private ringsS = new Graphics(); private brushG = new Graphics(); private labelsC = new Container();
  private glowTex!: Texture;
  private texCache = new Map<string, Texture>();
  private spritePool: Sprite[] = []; private glowPool: Sprite[] = []; private labelPool: Text[] = [];
  private crowdCache = new Map<string, Figure[]>();
  private fxList: ActiveFx[] = [];
  private lastMove = 0; private fly: { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; t: number } | null = null;
  private mouse: { x: number; y: number } | null = null;
  private t = 0; private frameN = 0; private shake = 0; private flash = 0;
  private drops: { x: number; y: number; l: number; s: number }[] = [];
  private staticDirty = true;
  private pickables: { x: number; y: number; r: number; sel: Selection }[] = [];

  constructor(el: HTMLElement, terrain: Terrain) { this.el = el; this.terrain = terrain; }

  async init() {
    await this.app.init({ resizeTo: this.el, antialias: true, background: "#0f2440", resolution: Math.min(window.devicePixelRatio || 1, 2), autoDensity: true });
    this.el.appendChild(this.app.canvas);
    this.app.canvas.style.touchAction = "none";
    const baseRegion = renderRegion(this.terrain, 0, 0, WX, WY, 1600, 900, false);
    this.base = new Sprite(Texture.from(baseRegion.canvas));
    this.base.width = WX; this.base.height = WY;
    const gc = document.createElement("canvas"); gc.width = gc.height = 64;
    const gg = gc.getContext("2d")!, grad = gg.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(255,226,160,1)"); grad.addColorStop(0.3, "rgba(242,178,87,0.55)"); grad.addColorStop(1, "rgba(242,178,87,0)");
    gg.fillStyle = grad; gg.fillRect(0, 0, 64, 64);
    this.glowTex = Texture.from(gc);
    this.cloudCanvas.width = 160; this.cloudCanvas.height = 90;
    this.cloudTex = Texture.from(this.cloudCanvas);
    this.cloudSprite = new Sprite(this.cloudTex);
    this.glowC.blendMode = "add";
    this.worldC.addChild(this.base, this.overlayG, this.fieldsG, this.treesG, this.routesG, this.housesG, this.boatsG, this.peopleC, this.ringsG, this.glowC);
    this.screenC.addChild(this.cloudSprite, this.ringsS, this.rainG, this.fxG, this.labelsC, this.brushG);
    this.app.stage.addChild(this.worldC, this.screenC);
    this.bindInput();
    this.app.ticker.add((tk) => this.frame(Math.min(0.05, tk.deltaMS / 1000)));
  }

  refresh() { this.staticDirty = true; }
  setWorld(w: Omit<World, "chronicle">, fx: Fx[]) {
    this.world = w; this.staticDirty = true;
    const now = performance.now();
    for (const f of fx) {
      this.fxList.push({ fx: f, t0: now });
      if (f.kind === "quake") this.shake = 1.2;
      if (f.kind === "lightning") this.flash = 1;
    }
    if (this.fxList.length > 60) this.fxList.splice(0, this.fxList.length - 60);
    this.crowdCache.clear();
  }

  // ---------- camera ----------
  scale() { return (this.W / WX) * this.cam.z; }
  toScreen(x: number, y: number): [number, number] { const s = this.scale(); return [(x - this.cam.x) * s + this.W / 2, (y - this.cam.y) * s + this.H / 2]; }
  toWorld(px: number, py: number): [number, number] { const s = this.scale(); return [this.cam.x + (px - this.W / 2) / s, this.cam.y + (py - this.H / 2) / s]; }
  clampCam() {
    this.cam.z = clamp(this.cam.z, 1, 30);
    const s = this.scale(), hw = this.W / 2 / s, hh = this.H / 2 / s;
    this.cam.x = hw * 2 >= WX ? WX / 2 : clamp(this.cam.x, hw, WX - hw);
    this.cam.y = hh * 2 >= WY ? WY / 2 : clamp(this.cam.y, hh, WY - hh);
  }
  fitZoomMin() { return 1; }
  zoomBy(f: number, px = this.W / 2, py = this.H / 2) {
    const before = this.toWorld(px, py);
    this.cam.z = clamp(this.cam.z * f, this.fitZoomMin(), 30);
    const after = this.toWorld(px, py);
    this.cam.x += before[0] - after[0]; this.cam.y += before[1] - after[1];
    this.clampCam(); this.moved(); this.fly = null;
  }
  flyTo(x: number, y: number, z: number) { this.fly = { x0: this.cam.x, y0: this.cam.y, z0: this.cam.z, x1: x, y1: y, z1: Math.max(z, this.fitZoomMin()), t: 0 }; }
  level() { let i = 0; while (this.cam.z > LEVELS[i].max) i++; return i; }
  scaleBar(): { px: number; label: string } {
    const kmPerPx = KM_PER_UNIT / this.scale(), opts = [0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50];
    let best = opts[0];
    for (const o of opts) if (o / kmPerPx <= 120) best = o;
    return { px: Math.round(best / kmPerPx), label: best < 1 ? Math.round(best * 1000) + " m" : best + " km" };
  }
  private moved() { this.lastMove = performance.now(); this.onCamera(); }

  private bindInput() {
    const cv = this.app.canvas;
    const ptrs = new Map<number, [number, number]>();
    let drag = 0, pinch = 0;
    cv.addEventListener("wheel", (e) => {
      e.preventDefault();
      const r = cv.getBoundingClientRect();
      this.zoomBy(Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0016)), e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    cv.addEventListener("pointerdown", (e) => {
      try { cv.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      ptrs.set(e.pointerId, [e.clientX, e.clientY]); this.fly = null;
      if (ptrs.size === 1) drag = 0;
      if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = Math.hypot(a[0] - b[0], a[1] - b[1]); drag = 99; }
    });
    cv.addEventListener("pointermove", (e) => {
      const r = cv.getBoundingClientRect();
      this.mouse = { x: e.clientX - r.left, y: e.clientY - r.top };
      const prev = ptrs.get(e.pointerId);
      if (!prev) return;
      ptrs.set(e.pointerId, [e.clientX, e.clientY]);
      if (ptrs.size === 2 && pinch) {
        const [a, b] = [...ptrs.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        this.zoomBy(d / pinch, (a[0] + b[0]) / 2 - r.left, (a[1] + b[1]) / 2 - r.top); pinch = d; return;
      }
      const s = this.scale();
      this.cam.x -= (e.clientX - prev[0]) / s; this.cam.y -= (e.clientY - prev[1]) / s;
      drag += Math.abs(e.clientX - prev[0]) + Math.abs(e.clientY - prev[1]);
      this.clampCam(); this.moved();
    });
    const end = (e: PointerEvent) => {
      if (!ptrs.has(e.pointerId)) return;
      ptrs.delete(e.pointerId);
      if (ptrs.size < 2) pinch = 0;
      if (!ptrs.size && drag < 6 && e.type === "pointerup") {
        const r = cv.getBoundingClientRect();
        this.click(e.clientX - r.left, e.clientY - r.top);
      }
    };
    cv.addEventListener("pointerup", end); cv.addEventListener("pointercancel", end);
    cv.addEventListener("pointerleave", () => { this.mouse = null; });
    cv.tabIndex = 0;
    cv.addEventListener("keydown", (e) => {
      const step = 60 / this.scale();
      if (e.key === "+" || e.key === "=") this.zoomBy(1.4);
      else if (e.key === "-") this.zoomBy(1 / 1.4);
      else if (e.key === "ArrowLeft") this.cam.x -= step; else if (e.key === "ArrowRight") this.cam.x += step;
      else if (e.key === "ArrowUp") this.cam.y -= step; else if (e.key === "ArrowDown") this.cam.y += step;
      else return;
      e.preventDefault(); this.clampCam(); this.moved();
    });
  }

  private click(px: number, py: number) {
    const [x, y] = this.toWorld(px, py);
    if (this.armed) { this.onCast(x, y); return; }
    for (const p of this.pickables) if (Math.hypot(p.x - px, p.y - py) <= p.r) { this.selection = p.sel; this.onSelect(p.sel); return; }
    const isle = this.terrain.isleAt(x, y);
    const sel: Selection = isle && this.terrain.isLand(x, y) ? { kind: "isle", id: isle } : null;
    this.selection = sel; this.onSelect(sel);
  }

  // ---------- drawing ----------
  private tex(t: Tribe, job: string, sex: "m" | "f", age: "adult" | "child" | "elder"): Texture {
    const key = t.id + "|" + job + "|" + sex + "|" + age;
    let tx = this.texCache.get(key);
    if (!tx) { tx = Texture.from(drawCharacter({ tribe: t, sex, job, age }, 72)); this.texCache.set(key, tx); }
    return tx;
  }

  private buildDetail() {
    const s = this.scale(), vw = (this.W / s) * 1.3, vh = (this.H / s) * 1.3;
    const x0 = clamp(this.cam.x - vw / 2, -0.5, WX + 0.5 - vw), y0 = clamp(this.cam.y - vh / 2, -0.5, WY + 0.5 - vh);
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const q = Math.min(dpr, Math.sqrt(1.0e6 / (this.W * 1.3 * this.H * 1.3)));
    const avoid = (this.world?.villages ?? []).filter((v) => !v.lost).map((v) => ({ x: v.x, y: v.y, r: 0.32 }));
    const r = renderRegion(this.terrain, x0, y0, vw, vh, Math.round(this.W * 1.3 * q), Math.round(this.H * 1.3 * q), vw < 4.5, avoid);
    if (this.detailSprite) { this.detailSprite.texture.destroy(true); this.worldC.removeChild(this.detailSprite); this.detailSprite.destroy(); }
    this.detail = r;
    this.detailSprite = new Sprite(Texture.from(r.canvas));
    this.detailSprite.position.set(x0, y0); this.detailSprite.width = vw; this.detailSprite.height = vh;
    this.worldC.addChildAt(this.detailSprite, 1);
    this.treesG.clear();
    for (const tr of r.trees) {
      const rad = 0.011 * tr.s;
      this.treesG.circle(tr.x + rad * 0.35, tr.y + rad * 0.4, rad).fill({ color: 0x0a140e, alpha: 0.3 });
      this.treesG.circle(tr.x, tr.y, rad).fill({ color: tr.pine ? 0x2e543e : 0x3a683e });
      this.treesG.circle(tr.x - rad * 0.3, tr.y - rad * 0.3, rad * 0.45).fill({ color: 0x78aa64, alpha: 0.35 });
    }
  }
  private needDetail() {
    if (this.cam.z < 1.45) return false;
    const s = this.scale(), vw = this.W / s, vh = this.H / s, l = this.cam.x - vw / 2, tp = this.cam.y - vh / 2, d = this.detail;
    if (!d) return true;
    if (l < d.x0 || tp < d.y0 || l + vw > d.x0 + d.ww || tp + vh > d.y0 + d.wh) return true;
    return d.sx > (vw / (this.W * Math.min(window.devicePixelRatio || 1, 1.5))) * 1.6;
  }

  private drawStatic() {
    const w = this.world; if (!w) return;
    const z = this.cam.z, s = this.scale();
    this.overlayG.clear(); this.fieldsG.clear(); this.housesG.clear(); this.routesG.clear();
    for (const e of w.effects) {
      if (e.power === "drought") for (let k = 1; k <= 4; k++) this.overlayG.circle(e.x, e.y, e.r * k / 4).fill({ color: 0xd9a050, alpha: 0.035 });
      if (e.power === "rain") for (let k = 1; k <= 3; k++) this.overlayG.circle(e.x, e.y, e.r * k / 3).fill({ color: 0x6fae5c, alpha: 0.025 });
      if (e.power === "eruption") this.overlayG.circle(e.x, e.y, e.r * (e.age < 8 ? 1 : 0.7)).fill({ color: e.age < 8 ? 0x2a2420 : 0x3a3020, alpha: e.age < 8 ? 0.35 : 0.15 });
      if (e.power === "calm") this.overlayG.circle(e.x, e.y, e.r).stroke({ width: 2 / s, color: 0x8fd0e6, alpha: 0.35 });
    }
    // routes
    if (z < 9) {
      const a = clamp(1 - (z - 5) / 4, 0.15, 1);
      for (const r of w.routes) {
        const A = w.villages.find((v) => v.id === r.a), B = w.villages.find((v) => v.id === r.b);
        if (!A || !B) continue;
        const col = r.kind === "marriage" ? 0xf2b257 : r.kind === "kin" ? 0xa98ad8 : 0xe6f0f8;
        this.dashed(this.routesG, A.px, A.py, B.px, B.py, 4 / s, 5 / s, 1.3 / s, col, 0.55 * a * (0.5 + r.strength / 2));
      }
    }
    // known world: shown for the selected tribe
    const selT = this.selection?.kind === "tribe" ? w.tribes[this.selection.id] : null;
    if (selT && z < 3.4) {
      const ra = clamp(1 - (z - 2) / 1.4, 0, 1);
      for (const id of selT.known) {
        const I = this.terrain.byId[id];
        this.dashed(this.routesG, I.cx - I.rx, I.cy - I.ry - 0.15, I.cx + I.rx, I.cy - I.ry - 0.15, 4 / s, 4 / s, 0.01, hex(selT.line), 0);
        this.routesG.ellipse(I.cx, I.cy, I.rx * 0.95, I.ry * 0.95).stroke({ width: 1.6 / s, color: hex(selT.line), alpha: 0.7 * ra });
      }
    }
    if (z > 2.3) {
      const fa = clamp((z - 2.3) / 1.2, 0, 1), crops = [0xc6b060, 0x849e4a, 0x9c7c52];
      for (const v of w.villages) {
        if (v.lost || !this.inView(v.x, v.y, 0.6)) continue;
        const L = layoutFor(this.terrain, v);
        for (let i = 0; i < fieldCount(v, L); i++) {
          const f = L.fields[i], c = Math.cos(f.r), sn = Math.sin(f.r), hw = f.w / 2, hh = f.h / 2;
          const pts = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]].flatMap(([px, py]) => [f.x + px * c - py * sn, f.y + px * sn + py * c]);
          this.fieldsG.poly(pts).fill({ color: crops[f.c], alpha: 0.85 * fa });
        }
        const hs = Math.max(2.2 / s, 0.014);
        const nh = houseCount(v, L), roofA = hex(w.tribes[v.tribe]?.top ?? "#96543c");
        for (let i = 0; i < nh; i++) {
          const h = L.houses[i], w2 = hs * (0.8 + h.v * 0.5);
          this.housesG.rect(h.x - w2 / 2 + w2 * 0.25, h.y, w2, w2 * 0.7).fill({ color: 0x0a0e14, alpha: 0.35 * fa });
          this.housesG.rect(h.x - w2 / 2, h.y - w2 * 0.3, w2, w2 * 0.7).fill({ color: 0xd6c4a0, alpha: fa });
          this.housesG.poly([h.x - w2 * 0.62, h.y - w2 * 0.3, h.x, h.y - w2 * 0.85, h.x + w2 * 0.62, h.y - w2 * 0.3]).fill({ color: h.v > 0.5 ? 0x96543c : roofA, alpha: fa });
        }
        if (v.granary >= 1) this.housesG.circle(v.x + 0.05, v.y - 0.03, 0.018).fill({ color: 0xc8a060, alpha: fa });
        const def = Math.floor(v.defense);
        if (def >= 1) {
          const R = 0.24;
          this.housesG.circle(v.x, v.y, R).stroke({ width: Math.max(1.5 / s, def >= 4 ? 0.012 : 0.006), color: def >= 4 ? 0x9a9490 : 0x7a5a38, alpha: fa });
          if (def >= 2) for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + 0.4; this.housesG.rect(v.x + Math.cos(a) * R - 0.008, v.y + Math.sin(a) * R - 0.02, 0.016, 0.022).fill({ color: 0x6a4a30, alpha: fa }); }
        }
      }
    }
    this.staticDirty = false;
  }

  private dashed(g: Graphics, x1: number, y1: number, x2: number, y2: number, on: number, off: number, width: number, color: number, alpha: number) {
    const L = Math.hypot(x2 - x1, y2 - y1), n = Math.floor(L / (on + off));
    const dx = (x2 - x1) / L, dy = (y2 - y1) / L;
    for (let i = 0; i <= n; i++) {
      const a = i * (on + off), b = Math.min(L, a + on);
      g.moveTo(x1 + dx * a, y1 + dy * a).lineTo(x1 + dx * b, y1 + dy * b);
    }
    g.stroke({ width, color, alpha });
  }

  private inView(x: number, y: number, m: number) {
    const s = this.scale(), vw = this.W / s, vh = this.H / s;
    return x > this.cam.x - vw / 2 - m && x < this.cam.x + vw / 2 + m && y > this.cam.y - vh / 2 - m && y < this.cam.y + vh / 2 + m;
  }

  private boatShape(g: Graphics, x: number, y: number, a: number, size: number, type: number) {
    const c = Math.cos(a), sn = Math.sin(a);
    const P = (pts: number[][]) => pts.flatMap(([px, py]) => [x + px * size * c - py * size * sn, y + px * size * sn + py * size * c]);
    g.moveTo(...(P([[-0.9, 0]]) as [number, number])).lineTo(...(P([[-2.6, 0]]) as [number, number])).stroke({ width: size * 0.15, color: 0xdceaf2, alpha: 0.35 });
    if (type <= 1) g.poly(P([[-0.5, -0.4], [0.5, -0.4], [0.5, 0.4], [-0.5, 0.4]])).fill({ color: 0xa8865a });
    else {
      g.poly(P([[1, 0], [0.4, 0.3], [-0.9, 0.12], [-0.9, -0.12], [0.4, -0.3]])).fill({ color: 0x8a6440 });
      if (type >= 3) g.poly(P([[-0.5, 0.5], [0.6, 0.5], [0.6, 0.62], [-0.5, 0.62]])).fill({ color: 0x8a6440 });
      if (type >= 4) g.poly(P([[0.35, 0], [-0.5, -0.95], [-0.55, 0.05]])).fill({ color: 0xf6ecd6, alpha: 0.95 });
    }
  }

  private frame(dt: number) {
    this.W = this.el.clientWidth; this.H = this.el.clientHeight;
    this.t += dt; this.frameN++;
    if (this.fly) {
      const f = this.fly; f.t = Math.min(1, f.t + dt / 1.1);
      const e = f.t < 0.5 ? 2 * f.t * f.t : 1 - Math.pow(-2 * f.t + 2, 2) / 2;
      this.cam.x = f.x0 + (f.x1 - f.x0) * e; this.cam.y = f.y0 + (f.y1 - f.y0) * e;
      this.cam.z = Math.exp(Math.log(f.z0) + (Math.log(f.z1) - Math.log(f.z0)) * e);
      this.clampCam(); this.moved();
      if (f.t >= 1) this.fly = null;
    }
    if (this.cam.z < this.fitZoomMin()) { this.cam.z = this.fitZoomMin(); this.clampCam(); }
    if (performance.now() - this.lastMove > 180 && this.needDetail()) { this.buildDetail(); this.staticDirty = true; }
    const s = this.scale(), z = this.cam.z, t = this.t;
    let sx = 0, sy = 0;
    if (this.shake > 0) { this.shake -= dt; sx = (Math.random() - 0.5) * 10 * this.shake; sy = (Math.random() - 0.5) * 10 * this.shake; }
    this.worldC.scale.set(s);
    this.worldC.position.set(this.W / 2 - this.cam.x * s + sx, this.H / 2 - this.cam.y * s + sy);
    if (this.detailSprite) this.detailSprite.visible = z > 1.3;
    this.fieldsG.visible = this.housesG.visible = z > 2.3;
    this.treesG.visible = z > 4 && !!this.detail;
    this.treesG.alpha = clamp((z - 4) / 1.5, 0, 1);
    if (this.staticDirty || this.frameN % 20 === 0) this.drawStatic();
    this.drawDynamic(dt);
  }

  private drawDynamic(dt: number) {
    const w = this.world; if (!w) return;
    const s = this.scale(), z = this.cam.z, t = this.t;
    this.pickables = [];
    // boats
    this.boatsG.clear();
    for (const voy of w.voyages) {
      const [x, y] = voyagePos(voy as Voyage);
      if (!this.inView(x, y, 0.3)) continue;
      const head = voy.leg === "out" ? Math.atan2(voy.ty - voy.fy, voy.tx - voy.fx) : Math.atan2(voy.fy - voy.ty, voy.fx - voy.tx);
      const bob = Math.sin(t * 1.7 + voy.id) * 0.01;
      const size = Math.max((voy.tier >= 4 ? 5.5 : 3.6) / s, voy.tier >= 4 ? 0.06 : 0.035);
      this.boatShape(this.boatsG, x + bob, y, head, size, voy.tier);
      const sp = this.toScreen(x, y);
      if (voy.purpose !== "drift") this.ringsS.circle(sp[0], sp[1], Math.max(9, size * s * 1.8)).stroke({ width: 1.2, color: 0xf2b257, alpha: 0.6 });
      this.pickables.push({ x: sp[0], y: sp[1], r: 16, sel: { kind: "voyage", id: voy.id } });
    }
    // route traffic and fishing boats
    for (const r of w.routes) {
      const A = w.villages.find((v) => v.id === r.a), B = w.villages.find((v) => v.id === r.b);
      if (!A || !B || r.strength < 0.2) continue;
      const L = Math.hypot(B.px - A.px, B.py - A.py) || 1, cyc = (t * 0.12 / L + (r.id % 7) / 7) % 2, u = cyc < 1 ? cyc : 2 - cyc;
      const x = A.px + (B.px - A.px) * u, y = A.py + (B.py - A.py) * u;
      if (!this.inView(x, y, 0.2)) continue;
      const a = Math.atan2(B.py - A.py, B.px - A.px) + (cyc < 1 ? 0 : Math.PI);
      this.boatShape(this.boatsG, x, y, a, Math.max(3.4 / s, 0.035), r.tier);
    }
    if (z > 1.6) {
      for (const v of w.villages) {
        if (v.lost || !v.coastal || !this.inView(v.px, v.py, 0.3)) continue;
        const n = Math.min(4, Math.round(v.jobs.fisher * v.men / 6)), tier = Math.max(1, Math.min(3, (w.tribes[v.tribe]?.techs.includes("canoe") ? 2 : 1)));
        for (let k = 0; k < n; k++) {
          const a = Math.atan2(v.py - v.y, v.px - v.x) + (hash3(k, v.id, 20) - 0.5) * 1.6, d = 0.06 + hash3(k, v.id, 21) * 0.14;
          const x = v.px + Math.cos(a) * d + Math.sin(t * 0.3 + k) * 0.01, y = v.py + Math.sin(a) * d + Math.cos(t * 0.27 + k) * 0.008;
          if (this.terrain.elev(x, y, 5) > -0.006) continue;
          this.boatShape(this.boatsG, x, y, a + Math.sin(t * 0.5 + k) * 0.4, Math.max(3 / s, 0.03), tier);
        }
      }
    }
    // people
    let si = 0;
    const use = (tex: Texture, x: number, y: number, hpx: number) => {
      let sp = this.spritePool[si];
      if (!sp) { sp = new Sprite(); sp.anchor.set(0.5, 0.93); this.spritePool.push(sp); this.peopleC.addChild(sp); }
      sp.texture = tex; sp.visible = true; sp.position.set(x, y);
      const k = (hpx / s) / tex.height; sp.scale.set(k);
      si++;
    };
    const hpx = clamp(0.03 * s, 9, 64);
    if (z > 4.6) {
      for (const v of w.villages) {
        if (v.lost || !this.inView(v.x, v.y, 0.6)) continue;
        const tr = w.tribes[v.tribe]; if (!tr) continue;
        const key = v.id + ":" + popOf(v) + ":" + Math.round(v.jobs.farmer * 50) + ":" + Math.round(v.houses);
        let crowd = this.crowdCache.get(key);
        if (!crowd) { crowd = sampleCrowd(v, layoutFor(this.terrain, v)); this.crowdCache.set(key, crowd); }
        for (const p of crowd) {
          const [x, y, walking] = figurePos(p, t);
          if (!this.inView(x, y, 0.05)) continue;
          const job = p.job === "child" || p.job === "elder" ? (p.job === "elder" ? "elder" : "") : p.job;
          const bob = walking ? Math.abs(Math.sin(t * 6 + p.ph)) * 0.003 : 0;
          use(this.tex(tr, job, p.sex, p.job === "child" ? "child" : p.job === "elder" ? "elder" : "adult"), x, y - bob, hpx * (p.job === "child" ? 0.8 : 1));
        }
      }
    }
    // named agents
    this.ringsG.clear(); this.ringsS.clear();
    const named: { a: Agent; x: number; y: number }[] = [];
    for (const a of w.agents) {
      if (!a.alive) continue;
      const v = w.villages.find((x) => x.id === a.village);
      const voy = w.voyages.find((x) => x.captain === a.id);
      let x: number, y: number;
      if (voy) [x, y] = voyagePos(voy as Voyage);
      else if (v && !v.lost) { const ang = (a.id * 2.39996) % 6.283, d = a.role === "Captain" || a.role === "Boatwright" || a.role === "Voyager" ? 0 : 0.035 + (a.id % 5) * 0.012; x = v.x + Math.cos(ang) * d + (d === 0 ? (v.px - v.x) * 0.8 : 0); y = v.y + Math.sin(ang) * d * 0.8 + (d === 0 ? (v.py - v.y) * 0.8 : 0); }
      else continue;
      if (!this.inView(x, y, 0.1)) continue;
      named.push({ a, x, y });
      if (z > 4.6) {
        const tr = w.tribes[a.tribe];
        const job = { Leader: "leader", "Sky-speaker": "priest", Doctor: "doctor", "War leader": "warrior", Boatwright: "boatwright", Navigator: "priest", Founder: "gatherer", Captain: "boatwright", Voyager: "fisher", Speaker: "", "Village founder": "builder", Veteran: "warrior" }[a.role] ?? "";
        const age = Math.floor((w.tick - a.born) / 4);
        if (!voy && tr) use(this.tex(tr, job, a.sex, age >= 55 ? "elder" : "adult"), x, y, hpx * 1.08);
        const sel = this.selection?.kind === "agent" && this.selection.id === a.id;
        const q = this.toScreen(x, y);
        this.ringsS.circle(q[0], q[1] - (voy ? 0 : hpx * 0.45), Math.max(10, hpx * 0.6)).stroke({ width: sel ? 2.5 : 1.5, color: 0xf2b257, alpha: 0.95 });
      }
      const sp = this.toScreen(x, y);
      if (z > 4.6) this.pickables.unshift({ x: sp[0], y: sp[1] - hpx * 0.45, r: Math.max(14, hpx * 0.6), sel: { kind: "agent", id: a.id } });
    }
    for (let i = si; i < this.spritePool.length; i++) this.spritePool[i].visible = false;
    // village lights and sickness
    let gi = 0;
    for (const v of w.villages) {
      if (v.lost || !this.inView(v.x, v.y, 0.5)) continue;
      const pop = popOf(v), la = clamp(1 - (z - 2.2) / 2.5, 0, 1), sp = this.toScreen(v.x, v.y);
      if (la > 0) {
        let g = this.glowPool[gi];
        if (!g) { g = new Sprite(this.glowTex); g.anchor.set(0.5); this.glowPool.push(g); this.glowC.addChild(g); }
        const fl = 0.85 + 0.15 * Math.sin(t * 2.3 + v.x * 7), r = (5 + Math.sqrt(pop) / 3.2) * (this.W / 900) * fl * Math.min(z, 2) * 2;
        g.visible = true; g.position.set(v.x, v.y); g.width = g.height = r / s; g.alpha = la * (v.hungry > 1 ? 0.5 : 1);
        g.tint = v.sick ? 0xff8a70 : 0xffffff;
        gi++;
      }
      if (v.sick) {
        const pulse = 0.5 + 0.5 * Math.sin(t * 4);
        this.ringsS.circle(sp[0], sp[1], Math.max(12, 0.26 * s)).stroke({ width: 2, color: 0xe0725a, alpha: 0.4 + 0.5 * pulse });
      }
      const sel = this.selection?.kind === "village" && this.selection.id === v.id;
      if (sel) this.ringsS.circle(sp[0], sp[1], Math.max(16, 0.3 * s)).stroke({ width: 2, color: 0xe3e8f0, alpha: 0.9 });
      this.pickables.push({ x: sp[0], y: sp[1], r: Math.max(14, 0.2 * s), sel: { kind: "village", id: v.id } });
    }
    for (let i = gi; i < this.glowPool.length; i++) this.glowPool[i].visible = false;
    // lost villages: cold rings
    for (const v of w.villages) if (v.lost && z < 6 && this.inView(v.x, v.y, 0.3)) { const q = this.toScreen(v.x, v.y); this.ringsS.circle(q[0], q[1], 6).stroke({ width: 1.3, color: 0x8d9ab0, alpha: 0.5 }); }

    this.drawClouds(); this.drawWeather(dt); this.drawFx(); this.drawLabels(named); this.drawBrush();
  }

  private drawClouds() {
    const w = this.world!, z = this.cam.z, s = this.scale();
    const alphaMul = clamp(1.5 - z * 0.33, 0, 1);
    this.cloudSprite.visible = alphaMul > 0.01;
    if (!this.cloudSprite.visible) return;
    this.cloudSprite.width = this.W; this.cloudSprite.height = this.H; this.cloudSprite.alpha = alphaMul;
    if (this.frameN % 3) return;
    const g = this.cloudCanvas.getContext("2d")!, CW = 160, CH = 90, img = g.createImageData(CW, CH), D = img.data;
    const vw = this.W / s, vh = this.H / s, l = this.cam.x - vw / 2, tp = this.cam.y - vh / 2, t = this.t, seed = this.terrain.seed;
    const eff = w.effects;
    for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
      const wx = l + (x + 0.5) / CW * vw, wy = tp + (y + 0.5) / CH * vh;
      let wind = 0.05, add = 0, dark = 0;
      for (const e of eff) {
        const d = Math.hypot(wx - e.x, wy - e.y); if (d > e.r * 1.2) continue;
        const c = clamp(1.2 - d / e.r, 0, 1);
        if (e.power === "rain") add += 0.14 * c;
        else if (e.power === "storm") { add += 0.3 * c; dark += c; }
        else if (e.power === "drought") add -= 0.2 * c;
        else if (e.power === "calm") add -= 0.18 * c;
        else if (e.power === "wind") wind += 0.3 * c;
        else if (e.power === "eruption" && e.age < 10) { const ex = Math.max(0, wx - e.x), off = wy - e.y + ex * 0.08, wd = 0.18 + ex * 0.22; const pl = Math.exp(-(off * off) / (wd * wd)) * Math.exp(-ex * 0.18); add += pl * 0.5; dark += pl; }
      }
      const c = fbm(wx * 0.32 - t * wind, wy * 0.5, seed + 900, 4) * 0.65 + fbm(wx * 0.2 - t * wind * 0.6 + 20, wy * 0.32 + 5, seed + 950, 3) * 0.35 + add;
      const th = 0.6, al = Math.max(0, Math.min(1, (c - th) / 0.16)) * 0.8;
      const lit = 0.86 + Math.max(0, Math.min(1, (c - th) / 0.3)) * 0.14, dk = Math.min(1, dark);
      const o = (y * CW + x) * 4;
      D[o] = (250 - 170 * dk) * lit; D[o + 1] = (250 - 158 * dk) * lit; D[o + 2] = (252 - 138 * dk) * lit; D[o + 3] = al * 255;
    }
    g.putImageData(img, 0, 0);
    this.cloudTex.source.update();
  }

  private drawWeather(dt: number) {
    const w = this.world!, s = this.scale(), g = this.rainG;
    g.clear();
    const wet = w.effects.filter((e) => e.power === "rain" || e.power === "storm");
    if (!wet.length) { this.drops = []; return; }
    if (!this.drops.length) for (let i = 0; i < 260; i++) this.drops.push({ x: Math.random() * this.W * 1.2, y: Math.random() * this.H, l: 8 + Math.random() * 14, s: 0.7 + Math.random() * 0.6 });
    const spd = 700;
    for (const d of this.drops) {
      d.y += d.s * spd * dt; d.x -= d.s * spd * dt * 0.25;
      if (d.y > this.H) { d.y -= this.H + 20; d.x = Math.random() * this.W * 1.2; }
      if (d.x < -20) d.x += this.W * 1.2;
      const [wx, wy] = this.toWorld(d.x, d.y);
      if (!wet.some((e) => Math.hypot(wx - e.x, wy - e.y) < e.r)) continue;
      g.moveTo(d.x, d.y).lineTo(d.x - d.l * 0.25, d.y + d.l);
    }
    g.stroke({ width: 1, color: 0xc8dcec, alpha: 0.4 });
    const windy = w.effects.filter((e) => e.power === "wind");
    if (windy.length && this.cam.z < 6) {
      for (let i = 0; i < 90; i++) {
        const wx = ((hash3(i, 1, 31) * WX + this.t * 0.9 * (0.7 + hash3(i, 3, 31) * 0.6)) % (WX + 1)) - 0.5, wy = hash3(i, 2, 31) * WY;
        if (!windy.some((e) => Math.hypot(wx - e.x, wy - e.y) < e.r)) continue;
        const a1 = this.toScreen(wx, wy), a2 = this.toScreen(wx + 0.45, wy - 0.04);
        g.moveTo(a1[0], a1[1]).quadraticCurveTo((a1[0] + a2[0]) / 2, a1[1] - 4, a2[0], a2[1]);
      }
      g.stroke({ width: 1.2, color: 0xebf5fc, alpha: 0.45 });
    }
    if (w.effects.some((e) => e.power === "storm")) g.rect(0, 0, this.W, this.H).fill({ color: 0x0a1220, alpha: 0.18 });
  }

  private drawFx() {
    const g = this.fxG, now = performance.now();
    g.clear();
    if (this.flash > 0.02) { g.rect(0, 0, this.W, this.H).fill({ color: 0xd7e8ff, alpha: this.flash * 0.3 }); this.flash *= 0.88; }
    this.fxList = this.fxList.filter((f) => now - f.t0 < 3200);
    for (const { fx, t0 } of this.fxList) {
      const age = (now - t0) / 1000, [x, y] = this.toScreen(fx.x, fx.y);
      if (fx.kind === "lightning" && age < 0.5) {
        let bx = x + (hash3(fx.tick, 1, 3) - 0.5) * 80, by = 0;
        g.moveTo(bx, by);
        while (by < y) { by += 26; bx += (Math.random() - 0.5) * 22; g.lineTo(bx, by); }
        g.stroke({ width: 2.4, color: 0xf2f8ff, alpha: 1 - age * 2 });
      } else if (fx.kind === "eruption") {
        g.circle(x, y, 20 + age * 60).stroke({ width: 3, color: 0xe0725a, alpha: Math.max(0, 1 - age / 3) });
        g.circle(x, y, 14).fill({ color: 0xffa060, alpha: Math.max(0, 0.9 - age / 3.2) });
      } else if (fx.kind === "quake") {
        for (let k = 0; k < 3; k++) g.circle(x, y, (age * 120 + k * 30) % 160).stroke({ width: 2, color: 0xc8b28a, alpha: Math.max(0, 0.6 - age / 2) });
      } else if (fx.kind === "omen" && age < 2.6) {
        const u = age / 2.6, cx = -60 + u * (this.W + 120), cy = 40 + u * 80;
        g.moveTo(cx, cy).lineTo(cx - 120, cy - 30).stroke({ width: 3, color: 0xf2b257, alpha: 0.8 * (1 - u) });
        g.circle(cx, cy, 5).fill({ color: 0xfff2d0, alpha: 1 - u });
      } else if (fx.kind === "plague" || fx.kind === "battle") {
        g.circle(x, y, 10 + age * 40).stroke({ width: 3, color: fx.kind === "plague" ? 0x8fb070 : 0xe0725a, alpha: Math.max(0, 0.9 - age / 2) });
      } else if (fx.kind === "found") {
        g.circle(x, y, 10 + age * 50).stroke({ width: 2.5, color: 0xf2b257, alpha: Math.max(0, 1 - age / 2.5) });
      } else if (fx.kind === "lost") {
        g.circle(x, y, 6 + age * 26).stroke({ width: 2, color: 0xdceaf2, alpha: Math.max(0, 0.8 - age / 1.6) });
      }
    }
  }

  private label(i: number, text: string, x: number, y: number, size: number, color: string, family: string) {
    let tx = this.labelPool[i];
    if (!tx) { tx = new Text({ text: "", style: { fontFamily: family, fontSize: size, fill: color, stroke: { color: "#080d16", width: 3 }, align: "center" } }); tx.anchor.set(0.5); this.labelPool.push(tx); this.labelsC.addChild(tx); }
    if (tx.text !== text) tx.text = text;
    tx.style.fontSize = size; tx.style.fill = color; tx.style.fontFamily = family;
    tx.position.set(Math.round(x), Math.round(y)); tx.visible = true;
  }

  private drawLabels(named: { a: Agent; x: number; y: number }[]) {
    const w = this.world!, z = this.cam.z, s = this.scale();
    let i = 0;
    if (z < 3.4) {
      for (const I of this.terrain.isles) {
        const [x, y] = this.toScreen(I.cx, I.cy - I.ry * 0.72);
        this.label(i++, I.name, x, y, I.id === "hearth" || I.id === "far" ? 18 : 14, "#e3e8f0", "Marcellus, Georgia, serif");
      }
    }
    if (z > 1.6 && z < 10) {
      for (const v of w.villages) {
        if (v.lost || !this.inView(v.x, v.y, 0.3)) continue;
        const [x, y] = this.toScreen(v.x, v.y + 0.12);
        this.label(i++, v.name.toUpperCase(), x, y + 10, 11, "#e3e8f0", "JetBrains Mono, monospace");
      }
    }
    if (z > 7) {
      const hpx = clamp(0.03 * s, 9, 64);
      for (const n of named) {
        const [x, y] = this.toScreen(n.x, n.y);
        this.label(i++, `${n.a.name} · ${n.a.role}`, x, y + Math.max(12, hpx * 0.25) + 6, 12, "#f2b257", "Figtree, system-ui, sans-serif");
      }
    }
    for (let k = i; k < this.labelPool.length; k++) this.labelPool[k].visible = false;
  }

  private drawBrush() {
    const g = this.brushG; g.clear();
    if (!this.armed || !this.mouse) return;
    const r = this.armed.radius * this.scale();
    g.circle(this.mouse.x, this.mouse.y, Math.max(8, r)).stroke({ width: 1.5, color: this.armed.power === "plague" || this.armed.power === "storm" || this.armed.power === "quake" || this.armed.power === "eruption" ? 0xe0725a : 0x8fd0e6, alpha: 0.9 });
    g.circle(this.mouse.x, this.mouse.y, 3).fill({ color: 0xe3e8f0 });
  }
}
