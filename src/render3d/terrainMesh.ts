import * as THREE from "three";
import { WX, WY } from "../sim/terrain";
import { HeightField, VSCALE } from "./heightfield";

export const MAX_EFFECTS = 16, MAX_LIGHTS = 64;

/** Uniforms shared by every lit surface: sun, sky, fog, season, power effects, village lights. */
export function makeSharedUniforms() {
  return {
    sunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() },
    sunColor: { value: new THREE.Color(1, 0.96, 0.88) },
    skyColor: { value: new THREE.Color(0.55, 0.65, 0.78) },
    dayLight: { value: 1 },
    season: { value: 0 },
    time: { value: 0 },
    fogColor: { value: new THREE.Color(0.62, 0.72, 0.82) },
    fogNear: { value: 8 },
    fogFar: { value: 40 },
    effects: { value: Array.from({ length: MAX_EFFECTS }, () => new THREE.Vector4()) },
    effectCount: { value: 0 },
    lights: { value: Array.from({ length: MAX_LIGHTS }, () => new THREE.Vector4()) },
    lightCount: { value: 0 },
    horizon: { value: 0 }
  };
}
export type SharedUniforms = ReturnType<typeof makeSharedUniforms>;

/** Effect type codes passed to shaders. */
export const FX_CODE: Record<string, number> = { drought: 1, rain: 2, ashYoung: 3, ashOld: 4, storm: 5, calm: 6, wind: 7 };

const vert = /* glsl */ `
  varying vec2 vUv; varying vec3 vNormal; varying vec3 vWorld; varying float vEl;
  void main() {
    vUv = uv; vNormal = normal; vEl = position.y / ${VSCALE.toFixed(2)};
    vec4 wp = modelMatrix * vec4(position, 1.0); vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

const frag = /* glsl */ `
  uniform sampler2D map; uniform sampler2D detailMap; uniform vec4 detailRect; uniform float detailOn;
  uniform vec3 sunDir; uniform vec3 sunColor; uniform vec3 skyColor; uniform float dayLight; uniform float season;
  uniform vec3 fogColor; uniform float fogNear; uniform float fogFar; uniform float horizon;
  uniform vec4 effects[${MAX_EFFECTS}]; uniform int effectCount;
  uniform vec4 lights[${MAX_LIGHTS}]; uniform int lightCount;
  varying vec2 vUv; varying vec3 vNormal; varying vec3 vWorld; varying float vEl;
  void main() {
    vec3 col = texture2D(map, vUv).rgb;
    if (detailOn > 0.5) {
      vec2 d = (vUv - detailRect.xy) / detailRect.zw;
      if (d.x > 0.0 && d.y > 0.0 && d.x < 1.0 && d.y < 1.0) {
        float edge = smoothstep(0.0, 0.04, min(min(d.x, d.y), min(1.0 - d.x, 1.0 - d.y)));
        col = mix(col, texture2D(detailMap, d).rgb, edge);
      }
    }
    float land = step(0.0, vEl);
    // seasons: golden autumn lowlands, snow creeping down in winter
    if (season > 1.5 && season < 2.5) col = mix(col, col * vec3(1.18, 1.0, 0.72), 0.35 * land * (1.0 - smoothstep(0.12, 0.2, vEl)));
    if (season > 2.5) {
      float gray = dot(col, vec3(0.3, 0.59, 0.11));
      col = mix(col, vec3(gray), 0.2 * land);
      col = mix(col, vec3(0.93, 0.95, 0.97), land * smoothstep(0.29, 0.34, vEl));
    }
    // your powers, painted onto the land
    for (int i = 0; i < ${MAX_EFFECTS}; i++) {
      if (i >= effectCount) break;
      vec4 e = effects[i];
      float r = abs(e.z), c = 1.0 - smoothstep(r * 0.6, r, distance(vWorld.xz, e.xy));
      if (c <= 0.0) continue;
      if (e.w < 1.5) { float g = dot(col, vec3(0.33)); col = mix(col, vec3(g) * vec3(1.25, 1.05, 0.72), 0.45 * c * land); }
      else if (e.w < 2.5) col = mix(col, col * vec3(0.85, 1.12, 0.88), 0.35 * c * land);
      else if (e.w < 3.5) col = mix(col, vec3(0.17, 0.15, 0.14), 0.6 * c * land);
      else if (e.w < 4.5) col = mix(col, col * vec3(0.78, 0.95, 0.72), 0.3 * c * land);
    }
    vec3 n = normalize(vNormal);
    float diff = max(dot(n, sunDir), 0.0);
    vec3 lit = col * (skyColor * 0.55 + sunColor * diff * 0.62 * dayLight + 0.12);
    // village hearths glow at night
    vec3 glow = vec3(0.0);
    for (int i = 0; i < ${MAX_LIGHTS}; i++) {
      if (i >= lightCount) break;
      vec4 L = lights[i];
      float d = distance(vWorld.xz, L.xy);
      glow += vec3(1.0, 0.7, 0.35) * L.w * exp(-(d * d) / (L.z * L.z));
    }
    lit += glow * (1.0 - dayLight) * 0.9 * land + glow * 0.08;
    float fog = smoothstep(fogNear, fogFar, length(vWorld - cameraPosition));
    // beyond the horizon: the unknown lies in mist until the first ocean ships
    float beyond = (1.0 - horizon) * smoothstep(-0.6, 1.4, max(vWorld.x - 16.8, vWorld.z - 9.8));
    vec3 mist = vec3(0.6, 0.66, 0.73) * (0.35 + 0.65 * dayLight);
    gl_FragColor = vec4(mix(mix(lit, fogColor, fog), mist, beyond * 0.96), 1.0);
  }`;

/** The island mesh: one grid over the whole map, displaced by the height field. */
export function buildTerrainMesh(hf: HeightField, baseTex: THREE.Texture, shared: SharedUniforms) {
  const { nx, ny, data } = hf;
  const pos = new Float32Array(nx * ny * 3), uv = new Float32Array(nx * ny * 2), nor = new Float32Array(nx * ny * 3);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i, x = i * hf.dx, z = j * hf.dy, el = data[k];
    pos[k * 3] = x; pos[k * 3 + 1] = Math.max(el, -0.36) * VSCALE; pos[k * 3 + 2] = z;
    uv[k * 2] = x / WX; uv[k * 2 + 1] = z / WY;
    const l = data[j * nx + Math.max(0, i - 1)], r = data[j * nx + Math.min(nx - 1, i + 1)];
    const u = data[Math.max(0, j - 1) * nx + i], d = data[Math.min(ny - 1, j + 1) * nx + i];
    const gx = ((r - l) * VSCALE) / (2 * hf.dx), gz = ((d - u) * VSCALE) / (2 * hf.dy);
    const len = Math.hypot(gx, 1, gz);
    nor[k * 3] = -gx / len; nor[k * 3 + 1] = 1 / len; nor[k * 3 + 2] = -gz / len;
  }
  const idx = new Uint32Array((nx - 1) * (ny - 1) * 6);
  let p = 0;
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    idx[p++] = a; idx[p++] = c; idx[p++] = b; idx[p++] = b; idx[p++] = c; idx[p++] = d;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  geo.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  const uniforms = {
    ...shared,
    map: { value: baseTex },
    detailMap: { value: baseTex },
    detailRect: { value: new THREE.Vector4(0, 0, 1, 1) },
    detailOn: { value: 0 }
  };
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: vert, fragmentShader: frag });
  const mesh = new THREE.Mesh(geo, mat);
  return { mesh, uniforms };
}
