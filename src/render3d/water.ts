import * as THREE from "three";
import { WX, WY } from "../sim/terrain";
import type { HeightField } from "./heightfield";
import { MAX_EFFECTS, type SharedUniforms } from "./terrainMesh";

/** Encode the sea floor as a texture so the water knows how deep it is (foam, colour, transparency). */
function depthTexture(hf: HeightField) {
  const w = Math.ceil(hf.nx / 2), h = Math.ceil(hf.ny / 2), px = new Uint8Array(w * h * 4);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const el = hf.data[Math.min(hf.ny - 1, j * 2) * hf.nx + Math.min(hf.nx - 1, i * 2)];
    const v = Math.max(0, Math.min(255, Math.round((el + 0.5) * 255)));
    const k = (j * w + i) * 4; px[k] = v; px[k + 1] = v; px[k + 2] = v; px[k + 3] = 255;
  }
  const t = new THREE.DataTexture(px, w, h, THREE.RGBAFormat);
  t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter; t.needsUpdate = true;
  return t;
}

const vert = /* glsl */ `
  uniform float time; uniform vec4 effects[${MAX_EFFECTS}]; uniform int effectCount;
  varying vec3 vWorld; varying float vRough;
  float waves(vec2 p, float t) {
    return sin(p.x * 9.0 + t * 1.3) * 0.5 + sin(p.y * 7.0 - t * 1.1) * 0.5 + sin((p.x + p.y) * 13.0 + t * 2.1) * 0.25;
  }
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    float rough = 0.25;
    for (int i = 0; i < ${MAX_EFFECTS}; i++) {
      if (i >= effectCount) break;
      vec4 e = effects[i];
      float c = 1.0 - smoothstep(abs(e.z) * 0.5, abs(e.z) * 1.2, distance(wp.xz, e.xy));
      if (e.w > 4.5 && e.w < 5.5) rough += 2.5 * c;
      if (e.w > 5.5 && e.w < 6.5) rough -= 0.2 * c;
      if (e.w > 6.5) rough += 0.8 * c;
    }
    rough = max(0.05, rough);
    wp.y += waves(wp.xz, time) * 0.004 * rough;
    vWorld = wp.xyz; vRough = rough;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

const frag = /* glsl */ `
  uniform sampler2D depthMap; uniform float time;
  uniform vec3 sunDir; uniform vec3 sunColor; uniform vec3 skyColor; uniform float dayLight;
  uniform vec3 fogColor; uniform float fogNear; uniform float fogFar;
  varying vec3 vWorld; varying float vRough;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float vnoise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y); }
  void main() {
    vec2 uv = vWorld.xz / vec2(${WX.toFixed(1)}, ${WY.toFixed(1)});
    bool inside = uv.x > 0.0 && uv.y > 0.0 && uv.x < 1.0 && uv.y < 1.0;
    float el = inside ? texture2D(depthMap, uv).r - 0.5 : -0.33;
    float depth = max(0.0, -el);
    vec3 shallow = vec3(0.34, 0.68, 0.68), deep = vec3(0.04, 0.12, 0.24);
    vec3 col = mix(shallow, deep, smoothstep(0.0, 0.22, depth));
    // ripples for light play
    vec2 q = vWorld.xz * 22.0;
    float n1 = vnoise(q + vec2(time * 0.6, time * 0.4)), n2 = vnoise(q * 1.7 - vec2(time * 0.5, -time * 0.3));
    vec3 n = normalize(vec3((n1 - 0.5) * 0.35 * vRough, 1.0, (n2 - 0.5) * 0.35 * vRough));
    vec3 view = normalize(cameraPosition - vWorld);
    float fres = pow(1.0 - max(dot(view, n), 0.0), 3.0);
    float spec = pow(max(dot(reflect(-sunDir, n), view), 0.0), 80.0) * dayLight;
    col = col * (skyColor * 0.6 + sunColor * 0.45 * dayLight + 0.1) + fres * skyColor * 0.35 + spec * sunColor * 0.9;
    // foam at the shore and on stormy water
    float shore = 1.0 - smoothstep(0.0, 0.018, depth);
    float caps = step(0.84, vnoise(q * 4.0 + vec2(time * 1.4, -time))) * step(0.5, vnoise(q * 0.7 - time * 0.2));
    float foam = shore * (0.55 + 0.45 * sin(depth * 400.0 - time * 2.5)) + smoothstep(1.2, 2.5, vRough) * caps;
    col = mix(col, vec3(0.92, 0.96, 0.97) * (0.4 + 0.6 * dayLight), clamp(foam, 0.0, 1.0) * 0.8);
    float alpha = inside ? clamp(0.3 + depth * 4.5, 0.3, 1.0) : 1.0;
    alpha = max(alpha, foam * 0.85);
    float fog = smoothstep(fogNear, fogFar, length(vWorld - cameraPosition));
    gl_FragColor = vec4(mix(col, fogColor, fog), mix(alpha, 1.0, fog));
  }`;

export function buildWater(hf: HeightField, shared: SharedUniforms) {
  const geo = new THREE.PlaneGeometry(WX * 5, WY * 6, 320, 240);
  geo.rotateX(-Math.PI / 2);
  geo.translate(WX / 2, 0, WY / 2);
  const uniforms = { ...shared, depthMap: { value: depthTexture(hf) } };
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 2;
  return mesh;
}
