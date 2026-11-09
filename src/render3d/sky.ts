import * as THREE from "three";
import { Sky } from "three/examples/jsm/objects/Sky.js";
import { WX, WY } from "../sim/terrain";
import type { SharedUniforms } from "./terrainMesh";

/** Sky dome, stars, sun and moonlight. A day lasts `period` seconds of real time. */
export class SkySystem {
  sky = new Sky();
  stars: THREE.Points;
  sun = new THREE.DirectionalLight(0xfff1dc, 1.6);
  hemi = new THREE.HemisphereLight(0xbcd4ea, 0x3a4630, 0.9);
  period = 150;
  locked = false;
  /** A fixed time of day (0..1 of the cycle) for photo mode, or null to follow the cycle. */
  fixed: number | null = null;
  phase = 0.32;
  constructor(scene: THREE.Scene) {
    this.sky.scale.setScalar(400);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 4; u.rayleigh.value = 1.4; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.8;
    scene.add(this.sky);
    const n = 2200, pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const th = Math.random() * Math.PI * 2, ph = Math.acos(Math.random() * 0.95);
      pos[i * 3] = Math.sin(ph) * Math.cos(th) * 180 + WX / 2; pos[i * 3 + 1] = Math.cos(ph) * 180; pos[i * 3 + 2] = Math.sin(ph) * Math.sin(th) * 180 + WY / 2;
    }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false }));
    scene.add(this.stars);
    scene.add(this.sun, this.sun.target, this.hemi);
  }
  /** Advance the clock and update every light and shader that depends on the sun. */
  /** Coal haze in the air, 0..1: it browns the fog and thickens the sky. */
  haze = 0;
  update(dt: number, shared: SharedUniforms, scene: THREE.Scene) {
    if (!this.locked) this.phase = (this.phase + dt / this.period) % 1;
    const p = this.fixed ?? (this.locked ? 0.12 : this.phase);
    const ang = p * Math.PI * 2;
    const elev = Math.sin(ang) * 1.15 - 0.1;
    const dir = new THREE.Vector3(Math.cos(ang) * 0.8, Math.max(-0.4, elev), 0.45).normalize();
    const day = THREE.MathUtils.smoothstep(dir.y, -0.08, 0.25);
    this.sky.material.uniforms.sunPosition.value.copy(dir);
    this.sun.position.set(WX / 2 + dir.x * 20, dir.y * 20, WY / 2 + dir.z * 20);
    this.sun.target.position.set(WX / 2, 0, WY / 2);
    this.sun.intensity = 0.15 + 1.6 * day;
    const warm = 1 - THREE.MathUtils.smoothstep(dir.y, 0.05, 0.45);
    this.sun.color.setRGB(1, 0.94 - warm * 0.25, 0.86 - warm * 0.45);
    this.hemi.intensity = 0.25 + 0.75 * day;
    (this.stars.material as THREE.PointsMaterial).opacity = (1 - day) * 0.9;
    const lightDir = day > 0.05 ? dir.clone() : new THREE.Vector3(-0.3, 0.8, -0.2).normalize();
    shared.sunDir.value.copy(lightDir);
    shared.sunColor.value.copy(day > 0.05 ? this.sun.color : new THREE.Color(0.45, 0.55, 0.8));
    shared.dayLight.value = day;
    const sky = new THREE.Color(0.55, 0.66, 0.8).lerp(new THREE.Color(0.08, 0.11, 0.2), 1 - day);
    shared.skyColor.value.copy(sky);
    const fog = new THREE.Color(0.66, 0.75, 0.84).lerp(new THREE.Color(0.05, 0.08, 0.14), 1 - day).lerp(new THREE.Color(0.95, 0.7, 0.5), warm * day * 0.35)
      .lerp(new THREE.Color(0.5, 0.46, 0.4).multiplyScalar(0.2 + 0.8 * day), this.haze);
    this.sky.material.uniforms.turbidity.value = 4 + this.haze * 14;
    shared.fogColor.value.copy(fog);
    if (scene.fog) (scene.fog as THREE.Fog).color.copy(fog);
    this.sky.visible = day > 0.02;
    scene.background = day > 0.02 ? null : new THREE.Color(0.02, 0.03, 0.07);
    return day;
  }
}
