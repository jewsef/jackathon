/**
 * Building kits. Every building is a short list of primitive parts (box, cylinder, cone, gable
 * prism, hip pyramid, dome) in a unit footprint, coloured by role. Kits are chosen by island
 * style and era, so each tribe's towns look like its own, and change as the tribe advances.
 *
 * Coordinates: x across the front, z front-to-back, y up. 1 = one house width.
 */

export type Prim = "box" | "cyl" | "cone" | "prism" | "hip" | "dome";
export type Role = "wall" | "roof" | "trim" | "door" | "accent" | "stone" | "wood" | "glow" | "awning" | "pave";
export interface Part { g: Prim; x: number; y: number; z: number; sx: number; sy: number; sz: number; r?: number; c: Role | string; /** tilt about the local x and z axes */ rx?: number; rz?: number; }
export type Style = "hearth" | "kelp" | "thorn" | "gull" | "far";
/** 0 shelter (early humans), 1 hut (Stone Age), 2 house (Bronze Age), 3 town house (planned city), 4 Classical, 5 Age of Sail, 6 Industrial, 7 Electric, 8 Information, 9 Biotech. */
export type Era = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
/** Peoples beyond the horizon build in the manner closest to their land. */
export const STYLE_OF: Record<string, Style> = { hearth: "hearth", kelp: "kelp", thorn: "thorn", gull: "gull", far: "far", great: "far", spice: "kelp", iron: "gull" };

export interface Palette { wall: string; roof: string; trim: string; door: string; stone: string; wood: string; }
export const PALETTE: Record<Style, Palette[]> = {
  //        Early humans                                   Stone Age                                        Bronze Age                                          City
  //        ... Classical (whitewash and terracotta)               Age of Sail (tall town houses)
  hearth: [p("#9c8462", "#6e5a40"), p("#b98a62", "#c9a860"), p("#b5634a", "#8c5a44", "#e2c9a0"), p("#c87a5a", "#7d4a38", "#efdcb8"), p("#efe4cc", "#b4583a", "#c8b48e"), p("#9c4a36", "#4a3a36", "#e8dcc4"), p("#8e3f30", "#3a3a40", "#d8ccb4"), p("#a85a44", "#4a4a50", "#e8dcc4"), p("#9fb6c8", "#d8dde2", "#e8ecef"), p("#e8eee6", "#5f9a5a", "#cfe0cf")],
  kelp: [p("#a89878", "#7e7050"), p("#cbb98a", "#9f8a52"), p("#d8c79a", "#7a6a40", "#5fa8a0"), p("#e2d4ac", "#5f6f4a", "#4fa3a0"), p("#f2ecdc", "#b4583a", "#4fa3a0"), p("#8fc0c8", "#3e4a52", "#f2ecdc"), p("#b8c8c4", "#3a4046", "#f2ecdc"), p("#e0d8c4", "#5a6a6e", "#f2ecdc"), p("#8fc4d0", "#e8ecef", "#f2f4f6"), p("#eef4ee", "#4fa070", "#d6ecdc")],
  thorn: [p("#8a6a4a", "#5a4632"), p("#7a5a3a", "#4a3a2a"), p("#6a4a2e", "#3f3226", "#d8c8a8"), p("#e8dcc4", "#3a2c22", "#4a3424"), p("#e8dcc4", "#9a4a32", "#4a3424"), p("#efe6d4", "#2e2a2c", "#3a2a20"), p("#7e4436", "#2e2c30", "#d8ccb4"), p("#8a5a3c", "#3a3634", "#e0d4bc"), p("#7e8e9a", "#c8ccd0", "#dfe3e6"), p("#e4ebe0", "#4e8a4a", "#c8dcc4")],
  gull: [p("#9a9488", "#6a6458"), p("#a8a29a", "#7a7468"), p("#b4b0aa", "#4e5662", "#8c8680"), p("#c2beb6", "#3e4652", "#8c8680"), p("#e4e0d8", "#a8563a", "#cfc9be"), p("#9a958c", "#3a4250", "#d8d2c6"), p("#8a857c", "#34383e", "#cfc8bc"), p("#b0aaa0", "#4a4e54", "#d8d2c6"), p("#a8b4bc", "#d8dce0", "#e8ebee"), p("#e6ece4", "#5a9460", "#d0e2d0")],
  far: [p("#8a6a50", "#3a2c24"), p("#7a6248", "#5a6a3a"), p("#e6dcc8", "#5a3a2a", "#6a4a32"), p("#efe6d4", "#4a2e22", "#6a4a32"), p("#e8d4b4", "#b0603c", "#6a4a32"), p("#d8b88a", "#5a2e22", "#f2ecdc"), p("#d4c4a4", "#4a3a34", "#f2ecdc"), p("#e4d8bc", "#8a4a34", "#f2ecdc"), p("#c8b89c", "#e4e0d8", "#f0ece4"), p("#f0ece0", "#6a9a4a", "#dcead0")]
};
function p(wall: string, roof: string, trim = "#5a4430"): Palette { return { wall, roof, trim, door: "#2e241c", stone: "#a9a59e", wood: "#6a4a30" }; }

const B = (x: number, y: number, z: number, sx: number, sy: number, sz: number, c: Part["c"], r = 0): Part => ({ g: "box", x, y, z, sx, sy, sz, c, r });
const P = (g: Prim, x: number, y: number, z: number, sx: number, sy: number, sz: number, c: Part["c"], r = 0): Part => ({ g, x, y, z, sx, sy, sz, c, r });

/** One storey of the house body, stacked for taller town houses. */
function storeys(n: number, w: number, h: number, d: number, c: Part["c"], jetty = 0): Part[] {
  const out: Part[] = [];
  for (let k = 0; k < n; k++) out.push(B(0, k * h, 0, w + (k ? jetty : 0), h, d + (k ? jetty : 0), c));
  return out;
}

/** A house for this island and era. `n` is the number of storeys (towns grow upward when crowded). */
export function houseKit(style: Style, era: Era, n = 1): Part[] {
  if (era === 4) return classicalHouse(style, n);
  if (era === 5) return sailHouse(style, n);
  if (era === 6) return industrialHouse(style, n);
  if (era === 7) return electricHouse(style, n);
  if (era === 8) return modernHouse(style, n);
  if (era === 9) return biotechHouse(style, n);
  if (era === 0) return style === "kelp" || style === "hearth"
    ? [P("prism", 0, 0, 0, 0.9, 0.6, 0.8, "wall"), B(0, 0, 0.42, 0.9, 0.04, 0.04, "trim")] // a lean-to of poles and thatch
    : [P("cone", 0, 0, 0, 1, 1.0, 1, "wall"), P("cyl", 0, 0.95, 0, 0.08, 0.3, 0.08, "roof")]; // a hide tent
  const H = 0.62;
  switch (style) {
    case "hearth":
      if (era === 1) return [B(0, 0, 0, 0.9, 0.55, 0.9, "wall"), P("prism", 0, 0.55, 0, 1.0, 0.45, 1.0, "roof"), B(0, 0, 0.46, 0.2, 0.35, 0.02, "door")];
      return [...storeys(era === 3 ? n : 1, 1, H, 1, "wall"), B(0, (era === 3 ? n : 1) * H, 0, 1.08, 0.07, 1.08, "roof"),
        B(0, (era === 3 ? n : 1) * H + 0.07, -0.3, 1.08, 0.12, 0.4, "trim"), B(0, 0, 0.51, 0.22, 0.4, 0.02, "door"),
        ...(era === 3 ? [B(0.3, (n - 0.5) * H, 0.51, 0.16, 0.14, 0.02, "door"), B(-0.3, (n - 0.5) * H, 0.51, 0.16, 0.14, 0.02, "door")] : [])];
    case "kelp":
      if (era === 1) return [P("cyl", 0, 0, 0, 0.9, 0.5, 0.9, "wall"), P("cone", 0, 0.5, 0, 1.15, 0.6, 1.15, "roof")];
      return [P("cyl", 0, 0, 0, 1, H * (era === 3 ? n : 1), 1, "wall"), P("cyl", 0, H * (era === 3 ? n : 1) - 0.05, 0, 1.25, 0.05, 1.25, "trim"),
        P("cone", 0, H * (era === 3 ? n : 1), 0, 1.2, 0.45, 1.2, "roof"), P("cone", 0, H * (era === 3 ? n : 1) + 0.35, 0, 0.6, 0.35, 0.6, "roof"), B(0, 0, 0.5, 0.2, 0.38, 0.04, "door")];
    case "thorn":
      if (era === 1) return [B(0, 0, 0, 1.8, 0.5, 0.8, "wall"), P("prism", 0, 0.5, 0, 1.9, 0.5, 0.95, "roof")];
      return [...storeys(era === 3 ? n : 1, 1.3, H, 0.9, "wall", 0.12), B(0, 0.28, 0.46, 1.32, 0.05, 0.02, "trim"), B(-0.55, 0, 0.46, 0.06, H * (era === 3 ? n : 1), 0.03, "trim"), B(0.55, 0, 0.46, 0.06, H * (era === 3 ? n : 1), 0.03, "trim"),
        P("prism", 0, H * (era === 3 ? n : 1), 0, 1.5, 0.75, 1.1, "roof"), B(0, 0, 0.46, 0.22, 0.4, 0.03, "door")];
    case "gull":
      if (era === 1) return [P("cyl", 0, 0, 0, 1, 0.45, 1, "wall"), P("dome", 0, 0.45, 0, 1, 0.4, 1, "roof")];
      return [...storeys(era === 3 ? n : 1, 1.1, H, 0.95, "wall"), P(era === 3 ? "hip" : "prism", 0, H * (era === 3 ? n : 1), 0, 1.2, 0.45, 1.05, "roof"),
        B(0.4, H * (era === 3 ? n : 1), -0.2, 0.14, 0.4, 0.14, "trim"), B(0, 0, 0.48, 0.22, 0.4, 0.03, "door")];
    case "far":
      if (era === 1) return [P("dome", 0, 0, 0, 1.1, 0.55, 1.1, "roof"), B(0, 0, 0.5, 0.3, 0.3, 0.3, "wall")]; // an earth lodge
      return [...storeys(era === 3 ? n : 1, 1, H, 1, "wall"), B(0, 0, 0.51, 1.0, 0.05, 0.02, "trim"), B(-0.48, 0, 0.51, 0.06, H * (era === 3 ? n : 1), 0.02, "trim"), B(0.48, 0, 0.51, 0.06, H * (era === 3 ? n : 1), 0.02, "trim"),
        P(era === 3 ? "hip" : "prism", 0, H * (era === 3 ? n : 1), 0, 1.15, 0.5, 1.15, "roof"), B(0, 0, 0.51, 0.22, 0.4, 0.03, "door")];
  }
}

/** Classical: whitewashed walls, terracotta hip roofs, a columned porch; Kelp-style peoples build round tholoi. */
function classicalHouse(style: Style, n: number): Part[] {
  const H = 0.6, top = H * n;
  if (style === "kelp") return [P("cyl", 0, 0, 0, 1, top, 1, "wall"), ...[0, 1, 2, 3, 4, 5, 6, 7].map((k) => P("cyl", Math.cos(k * 0.785) * 0.58, 0, Math.sin(k * 0.785) * 0.58, 0.07, top, 0.07, "trim")),
    P("cyl", 0, top, 0, 1.3, 0.05, 1.3, "trim"), P("cone", 0, top + 0.05, 0, 1.3, 0.42, 1.3, "roof"), B(0, 0, 0.5, 0.2, 0.4, 0.04, "door")];
  const w = style === "thorn" ? 1.3 : 1.1;
  return [B(0, 0, 0, w + 0.1, 0.06, 1.05, "trim"), ...storeys(n, w, H, 0.9, "wall"), P("hip", 0, top, -0.02, w + 0.18, 0.38, 1.08, "roof"),
    B(-0.35, 0, 0.5, 0.07, H, 0.07, "trim"), B(0.35, 0, 0.5, 0.07, H, 0.07, "trim"), B(0, H, 0.5, w * 0.8, 0.06, 0.12, "trim"), B(0, 0, 0.46, 0.22, 0.4, 0.03, "door"),
    ...(n > 1 ? [B(-0.3, H * 1.4, 0.46, 0.14, 0.16, 0.02, "door"), B(0.3, H * 1.4, 0.46, 0.14, 0.16, 0.02, "door")] : [])];
}
/** Age of Sail: tall narrow town houses, steep roofs, chimneys and rows of windows. */
function sailHouse(style: Style, n: number): Part[] {
  const H = 0.55, k = n + 1, top = H * k, w = 0.82;
  const windows: Part[] = [];
  for (let f = 0; f < k; f++) for (const x of f === 0 ? [0.24] : [-0.22, 0.22]) windows.push(B(x, f * H + 0.2, 0.46, 0.15, 0.2, 0.02, "door"));
  const roof: Part[] = style === "hearth"
    ? [B(0, top, 0, w, 0.18, 0.9, "wall"), B(0, top + 0.18, 0, w * 0.66, 0.16, 0.9, "wall"), B(0, top + 0.34, 0, w * 0.33, 0.14, 0.9, "wall"), P("prism", 0, top, 0, w * 0.98, 0.5, 0.86, "roof", Math.PI / 2)] // stepped gable
    : style === "gull" ? [P("hip", 0, top, 0, w + 0.08, 0.55, 0.98, "roof"), B(0, top + 0.12, 0.38, 0.22, 0.2, 0.12, "wall")] // slate with a dormer
    : [P("prism", 0, top, 0, w + 0.08, 0.6, 0.98, "roof", Math.PI / 2)];
  const frame: Part[] = style === "thorn" ? [B(0, H, 0.46, w + 0.01, 0.05, 0.02, "trim"), B(0, H * 2, 0.46, w + 0.01, 0.05, 0.02, "trim"), B(-0.4, 0, 0.46, 0.05, top, 0.02, "trim"), B(0.4, 0, 0.46, 0.05, top, 0.02, "trim")] : [];
  return [...storeys(k, w, H, 0.9, "wall"), ...frame, ...roof, B(-0.25, top - 0.05, -0.2, 0.12, 0.6, 0.12, "trim"), B(-0.2, 0, 0.46, 0.18, 0.34, 0.03, "door"), ...windows];
}

/** Industrial: terraced houses and tenements, rows of sash windows, chimney stacks along the ridge. */
function industrialHouse(style: Style, n: number): Part[] {
  const H = 0.5, k = Math.min(4, n + 1), top = H * k, w = 0.98;
  const win: Part[] = [];
  for (let f = 0; f < k; f++) for (const x of [-0.28, 0, 0.28]) if (!(f === 0 && x === 0)) win.push(B(x, f * H + 0.16, 0.46, 0.13, 0.22, 0.02, "door"));
  const roof: Part[] = style === "gull"
    ? [B(0, top, 0, w + 0.04, 0.08, 0.94, "trim"), B(0, top + 0.08, 0.44, w + 0.04, 0.12, 0.06, "wall")] // flat-roofed stone tenement
    : [P("prism", 0, top, 0, w + 0.04, 0.42, 0.96, "roof")];
  return [...storeys(k, w, H, 0.9, "wall"), B(0, H * 0.98, 0.46, w + 0.02, 0.04, 0.03, "trim"), ...roof,
    B(-0.38, top - 0.05, 0, 0.14, 0.62, 0.22, "wall"), B(0.38, top - 0.05, 0, 0.14, 0.62, 0.22, "wall"), B(0, 0, 0.46, 0.18, 0.34, 0.03, "door"), ...win];
}

/** Electric age: brick apartment blocks in towns (n > 1), bungalows with porches in villages. */
function electricHouse(style: Style, n: number): Part[] {
  if (n <= 1) return [B(0, 0, 0, 1, 0.5, 0.85, "wall"), P("hip", 0, 0.5, 0, 1.12, 0.32, 0.98, "roof"), B(0, 0, 0.55, 0.9, 0.04, 0.25, "trim"),
    B(-0.38, 0, 0.66, 0.05, 0.4, 0.05, "trim"), B(0.38, 0, 0.66, 0.05, 0.4, 0.05, "trim"), B(0.25, 0.14, 0.43, 0.22, 0.2, 0.02, "door"), B(-0.2, 0, 0.43, 0.18, 0.34, 0.02, "door")];
  const k = Math.min(6, n + 2), H = 0.46, top = k * H, win: Part[] = [];
  for (let f = 0; f < k; f++) for (const x of [-0.33, -0.11, 0.11, 0.33]) win.push(B(x, f * H + 0.15, 0.46, 0.13, 0.2, 0.02, "door"));
  return [...storeys(k, 1, H, 0.9, "wall"), B(0, top, 0, 1.04, 0.1, 0.94, "trim"), ...[1, 3].filter((f) => f < k).map((f) => B(0, f * H, 0.49, 0.9, 0.04, 0.12, "trim")), ...win, B(0, 0, 0.46, 0.2, 0.34, 0.03, "door")];
}
/** Information age: glass towers in towns, white flat-roofed houses with a garage in villages. */
function modernHouse(style: Style, n: number): Part[] {
  if (n <= 1) return [B(-0.1, 0, 0, 0.8, 0.5, 0.85, "trim"), B(0.42, 0, 0.1, 0.36, 0.34, 0.6, "trim"), B(-0.1, 0.5, 0, 0.86, 0.04, 0.9, "#7a7e84"),
    B(-0.1, 0.12, 0.43, 0.6, 0.28, 0.02, "wall"), B(0.42, 0, 0.41, 0.28, 0.26, 0.02, "#6a6e74")];
  const k = Math.min(10, 2 + n * 3), H = 0.42, top = k * H, round = style === "kelp" || style === "far";
  const body: Part[] = round ? [P("cyl", 0, 0, 0, 1, top, 1, "wall")] : [B(0, 0, 0, 1, top, 0.95, "wall")];
  const bands: Part[] = [];
  for (let f = 1; f < k; f++) bands.push(round ? P("cyl", 0, f * H, 0, 1.03, 0.05, 1.03, "roof") : B(0, f * H, 0, 1.02, 0.05, 0.97, "roof"));
  return [...body, ...bands, round ? P("cyl", 0, top, 0, 0.8, 0.2, 0.8, "#7a7e84") : B(0.2, top, -0.15, 0.4, 0.22, 0.4, "#7a7e84"), B(0, 0, 0.48, 0.3, 0.36, 0.03, "door")];
}
/** Biotech age: stepped towers with gardens on every terrace; green-roofed domes in villages. */
function biotechHouse(style: Style, n: number): Part[] {
  if (n <= 1) return [P("dome", 0, 0, 0, 1.1, 0.6, 1.1, "wall"), P("dome", 0, 0.46, 0, 0.7, 0.18, 0.7, "roof"), B(0, 0, 0.5, 0.3, 0.32, 0.12, "door")];
  const k = Math.min(9, 2 + n * 2), H = 0.44, out: Part[] = [];
  for (let f = 0; f < k; f++) {
    const w = 1.1 - f * 0.06;
    out.push(B(0, f * H, 0, w, H * 0.9, w * 0.92, "wall"), B(0, f * H + H * 0.9, 0, w + 0.04, 0.06, w * 0.92 + 0.04, "roof"));
    if (f % 2 === 0) out.push(P("cone", w * 0.42, f * H + H * 0.96, w * 0.38, 0.14, 0.2, 0.14, "#3e7a3e"));
  }
  return [...out, P("dome", 0, k * H, 0, 0.6, 0.3, 0.6, "#a8d8b0"), B(0, 0, 0.5, 0.26, 0.36, 0.03, "door")];
}

/** A ring of stepped seats: the theatre of a Classical city. */
function amphitheatre(): Part[] {
  const out: Part[] = [B(0, 0, 0, 1.1, 0.02, 0.7, "pave")];
  for (let row = 0; row < 3; row++) for (let k = 0; k < 14; k++) {
    const a = Math.PI * 0.05 + (k / 13) * Math.PI * 0.9, r = 0.7 + row * 0.22;
    out.push({ g: "box", x: Math.cos(a) * r, y: 0, z: -Math.sin(a) * r * 0.9, sx: 0.32, sy: 0.08 + row * 0.08, sz: 0.2, r: -a + Math.PI / 2, c: "stone" });
  }
  return out;
}

export type Civic = "palace" | "market" | "smithy" | "boatshed" | "pier" | "gatehouse" | "tower" | "well" | "workshop" | "granary2" | "plaza"
  | "temple" | "theatre" | "lighthouse" | "shipyard" | "starfort" | "windmill" | "warehouse" | "arch"
  | "factory" | "headframe" | "gasholder" | "station"
  | "powerplant" | "nuclear" | "turbine" | "solarfield" | "airport" | "mast" | "lab" | "greenhouse" | "launchpad";
/** Civic and work buildings. Unit = one house width. */
export const CIVIC: Record<Civic, Part[]> = {
  // a walled court with a great hall at the back and banners at the gate
  palace: [B(0, 0, -0.9, 2.6, 1.1, 1.2, "wall"), P("hip", 0, 1.1, -0.9, 2.8, 0.7, 1.4, "roof"),
    B(-1.25, 0, 0.3, 0.2, 0.5, 2.2, "wall"), B(1.25, 0, 0.3, 0.2, 0.5, 2.2, "wall"), B(-0.8, 0, 1.3, 0.9, 0.5, 0.2, "wall"), B(0.8, 0, 1.3, 0.9, 0.5, 0.2, "wall"),
    B(-0.38, 0, 1.3, 0.16, 0.9, 0.24, "stone"), B(0.38, 0, 1.3, 0.16, 0.9, 0.24, "stone"), B(-0.38, 0.9, 1.3, 0.04, 0.5, 0.04, "wood"), B(0.38, 0.9, 1.3, 0.04, 0.5, 0.04, "wood"),
    B(-0.3, 1.15, 1.3, 0.14, 0.22, 0.01, "accent"), B(0.46, 1.15, 1.3, 0.14, 0.22, 0.01, "accent"), B(0, 0.02, 0.3, 2.3, 0.02, 1.9, "pave")],
  // stalls with coloured awnings around a paved square
  market: [B(0, 0, 0, 2.2, 0.03, 2.2, "pave"),
    ...[[-0.7, -0.7], [0, -0.75], [0.7, -0.7], [-0.75, 0.05], [0.75, 0.05], [-0.7, 0.75], [0.7, 0.75]].flatMap(([x, z], k) => [
      B(x, 0, z, 0.36, 0.22, 0.28, "wood"), P("prism", x, 0.32, z, 0.46, 0.14, 0.36, k % 3 === 0 ? "#c84a3a" : k % 3 === 1 ? "#e0c04a" : "#4fa3d1"),
      B(x - 0.2, 0, z, 0.03, 0.34, 0.03, "wood"), B(x + 0.2, 0, z, 0.03, 0.34, 0.03, "wood")])],
  smithy: [B(0, 0, 0, 1, 0.5, 0.8, "stone"), P("prism", 0, 0.5, 0, 1.1, 0.3, 0.9, "roof"), P("cyl", 0.35, 0.5, -0.2, 0.18, 0.55, 0.18, "stone"), B(0, 0, 0.42, 0.4, 0.22, 0.03, "glow"), B(-0.6, 0, 0.3, 0.2, 0.14, 0.14, "#3d3430")],
  workshop: [B(0, 0, 0, 1.2, 0.45, 0.8, "wall"), P("prism", 0, 0.45, 0, 1.3, 0.3, 0.9, "roof"), B(0.75, 0, 0.1, 0.3, 0.2, 0.3, "wood")],
  boatshed: [B(0, 0, 0, 0.9, 0.5, 2.0, "wood"), P("prism", 0, 0.5, 0, 1.0, 0.45, 2.1, "roof", Math.PI / 2)],
  pier: [B(0, 0, 0, 0.25, 0.06, 3, "wood"), ...[-1.2, -0.4, 0.4, 1.2].flatMap((z) => [B(-0.13, -0.3, z, 0.05, 0.36, 0.05, "wood"), B(0.13, -0.3, z, 0.05, 0.36, 0.05, "wood")])],
  gatehouse: [B(-0.45, 0, 0, 0.4, 1.2, 0.5, "stone"), B(0.45, 0, 0, 0.4, 1.2, 0.5, "stone"), B(0, 0.8, 0, 1.3, 0.4, 0.55, "stone"), P("hip", -0.45, 1.2, 0, 0.5, 0.3, 0.6, "roof"), P("hip", 0.45, 1.2, 0, 0.5, 0.3, 0.6, "roof")],
  tower: [P("cyl", 0, 0, 0, 0.6, 1.5, 0.6, "stone"), P("cyl", 0, 1.5, 0, 0.75, 0.15, 0.75, "stone"), P("cone", 0, 1.65, 0, 0.8, 0.5, 0.8, "roof")],
  well: [P("cyl", 0, 0, 0, 0.4, 0.18, 0.4, "stone"), B(-0.2, 0, 0, 0.04, 0.45, 0.04, "wood"), B(0.2, 0, 0, 0.04, 0.45, 0.04, "wood"), P("prism", 0, 0.45, 0, 0.5, 0.15, 0.3, "roof")],
  granary2: [B(0, 0, 0, 1.6, 0.8, 1, "wall"), P("prism", 0, 0.8, 0, 1.7, 0.4, 1.1, "roof"), B(0, 0, 0.51, 0.3, 0.5, 0.02, "door")],
  plaza: [B(0, 0, 0, 2.3, 0.025, 2.3, "pave")],
  // a Classical temple: a stepped base, a peristyle of columns, a pediment
  temple: [B(0, 0, 0, 2.2, 0.12, 1.5, "#d8d2c4"), B(0, 0.12, 0, 2.0, 0.1, 1.3, "#d8d2c4"),
    ...[-0.85, -0.51, -0.17, 0.17, 0.51, 0.85].flatMap((x) => [P("cyl", x, 0.22, 0.55, 0.12, 0.9, 0.12, "#eeeae0"), P("cyl", x, 0.22, -0.55, 0.12, 0.9, 0.12, "#eeeae0")]),
    B(0, 0.22, 0, 1.4, 0.8, 0.8, "#e2dccc"), B(0, 1.12, 0, 2.0, 0.14, 1.3, "#eeeae0"), P("prism", 0, 1.26, 0, 2.05, 0.32, 1.35, "#b4583a")],
  theatre: amphitheatre(),
  lighthouse: [B(0, 0, 0, 0.7, 0.3, 0.7, "stone"), P("cyl", 0, 0.3, 0, 0.5, 1.6, 0.5, "#e8e2d6"), P("cyl", 0, 1.9, 0, 0.62, 0.08, 0.62, "stone"), P("cyl", 0, 1.98, 0, 0.36, 0.3, 0.36, "glow"), P("cone", 0, 2.28, 0, 0.5, 0.35, 0.5, "roof")],
  // a slipway with a ship's ribs on it
  shipyard: [B(0, 0, 0, 0.9, 0.04, 2.6, "wood"), B(0, 0.04, 0, 0.5, 0.36, 1.9, "#7a5432"),
    ...[-0.8, -0.3, 0.2, 0.7].map((z) => B(0, 0.04, z, 0.62, 0.5, 0.04, "#5a3e28")), B(-0.6, 0, 0.9, 0.04, 1.2, 0.04, "wood"), B(-0.6, 1.2, 0.5, 0.04, 0.04, 0.9, "wood")],
  // a star fort for the age of cannon
  starfort: [B(0, 0, 0, 2, 0.35, 2, "stone"), B(0, 0.35, 0, 1.7, 0.06, 1.7, "#7a8a5a"),
    ...[[1, 1], [-1, 1], [1, -1], [-1, -1]].map(([x, z]) => P("hip", x, 0, z, 0.9, 0.4, 0.9, "stone", Math.PI / 4)), P("cyl", 0, 0.41, 0, 0.04, 0.6, 0.04, "wood"), B(0.14, 0.86, 0, 0.26, 0.16, 0.01, "accent")],
  windmill: [P("cyl", 0, 0, 0, 0.55, 1.1, 0.55, "wall"), P("cone", 0, 1.1, 0, 0.66, 0.4, 0.66, "roof"),
    B(0, 1.05, 0.34, 0.08, 1.6, 0.03, "wood", 0.78), B(0, 1.05, 0.34, 0.08, 1.6, 0.03, "wood", -0.78)],
  warehouse: [B(0, 0, 0, 1.8, 0.7, 0.9, "wall"), P("prism", 0, 0.7, 0, 1.85, 0.4, 0.95, "roof"), B(-0.4, 0, 0.46, 0.3, 0.45, 0.02, "door"), B(0.4, 0, 0.46, 0.3, 0.45, 0.02, "door")],
  // a mill: a long shed with a sawtooth roof and two tall brick stacks
  factory: [B(0, 0, 0, 2.6, 0.7, 1.4, "#8e4a38"), ...[-1.0, -0.5, 0, 0.5, 1.0].map((x) => P("prism", x, 0.7, 0, 0.5, 0.3, 1.4, "#3c3a3e")),
    P("cyl", -0.9, 0, -0.9, 0.3, 2.4, 0.3, "#7e3e2e"), P("cyl", 0.5, 0, -0.9, 0.26, 2.0, 0.26, "#7e3e2e"), B(1.5, 0, 0.3, 0.5, 0.5, 0.6, "#8e4a38"), B(0, 0, 0.71, 0.4, 0.45, 0.02, "door")],
  // a pit head: the winding tower over the shaft and the engine house
  headframe: [...[[-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]].map(([x, z]) => B(x, 0, z, 0.06, 1.5, 0.06, "#4a4a50")), B(0, 0.6, 0, 0.66, 0.05, 0.66, "#4a4a50"),
    B(0, 1.5, 0, 0.7, 0.12, 0.7, "#4a4a50"), B(0, 1.62, 0, 0.06, 0.4, 0.5, "#2e2e34"), B(0.9, 0, 0, 0.8, 0.6, 0.6, "#8e4a38"), P("prism", 0.9, 0.6, 0, 0.84, 0.25, 0.64, "#3c3a3e"), P("cyl", 1.15, 0.6, -0.2, 0.12, 0.8, 0.12, "#7e3e2e"),
    P("cone", -0.8, 0, 0.3, 0.9, 0.4, 0.9, "#2b2826")],
  // a gasholder: a squat drum inside a ring of iron columns
  gasholder: [P("cyl", 0, 0, 0, 1.6, 0.9, 1.6, "#6e7a72"), ...[0, 1, 2, 3, 4, 5, 6, 7].map((k) => P("cyl", Math.cos(k * 0.785) * 0.9, 0, Math.sin(k * 0.785) * 0.9, 0.06, 1.2, 0.06, "#4a4a50")), P("cyl", 0, 1.15, 0, 1.85, 0.05, 1.85, "#4a4a50")],
  // a railway station: the booking hall and a long platform canopy
  station: [B(0, 0, -0.3, 1.4, 0.6, 0.6, "wall"), P("hip", 0, 0.6, -0.3, 1.5, 0.3, 0.7, "roof"), B(0, 0.2, 0.4, 2.6, 0.04, 0.6, "#3c3a3e"), ...[-1.1, -0.4, 0.4, 1.1].map((x) => B(x, 0, 0.6, 0.04, 0.2, 0.04, "#4a4a50")), B(0, 0, 0.4, 2.6, 0.05, 0.7, "pave"), P("cyl", 0, 0.62, 0.05, 0.12, 0.12, 0.04, "#f2ecdc")],
  // a coal power station: turbine hall and a tall stack
  powerplant: [B(0, 0, 0, 2.2, 0.9, 1.1, "#8a8478"), P("prism", 0, 0.9, 0, 2.2, 0.3, 1.1, "#4a4a50"), P("cyl", 0.8, 0, -0.9, 0.4, 3.0, 0.4, "#9a9488"), P("cyl", 0.8, 2.8, -0.9, 0.44, 0.2, 0.44, "#c84a3a"),
    B(-1.4, 0, 0.4, 0.5, 0.5, 0.5, "#7a7468")],
  // a nuclear plant: cooling towers and a domed reactor
  nuclear: [P("cyl", -0.8, 0, -0.5, 1.1, 1.6, 1.1, "#d8d4cc"), P("cyl", 0.6, 0, -0.6, 1.0, 1.4, 1.0, "#d8d4cc"), P("cyl", 0, 0, 0.8, 0.8, 0.7, 0.8, "#c8c4bc"), P("dome", 0, 0.7, 0.8, 0.8, 0.5, 0.8, "#b8b4ac"), B(1.2, 0, 0.6, 0.8, 0.5, 0.6, "#a8a49c")],
  // a wind turbine: a white tower, a nacelle, three blades
  turbine: [P("cyl", 0, 0, 0, 0.12, 3, 0.12, "#f0f2f4"), B(0, 3, 0.05, 0.16, 0.16, 0.36, "#e6e8ea"),
    { g: "box", x: 0, y: 3.08, z: 0.26, sx: 0.08, sy: 1.4, sz: 0.03, c: "#f4f6f8", rz: 0.3 }, { g: "box", x: 0, y: 3.08, z: 0.26, sx: 0.08, sy: 1.4, sz: 0.03, c: "#f4f6f8", rz: 0.3 + 2.094 },
    { g: "box", x: 0, y: 3.08, z: 0.26, sx: 0.08, sy: 1.4, sz: 0.03, c: "#f4f6f8", rz: 0.3 + 4.189 }],
  // rows of tilted solar panels
  solarfield: [0, 1, 2, 3, 4].flatMap((row) => [-1, 0, 1].map((col) => ({ g: "box" as const, x: col * 0.9, y: 0.08, z: row * 0.42 - 0.84, sx: 0.8, sy: 0.03, sz: 0.34, c: "#24345a", rx: -0.5 }))),
  // an airport: runway, terminal and control tower
  airport: [B(0, 0, 0, 6, 0.02, 0.5, "#3a3c40"), B(0, 0.021, 0, 5.6, 0.004, 0.04, "#e8e4d8"), B(0.6, 0, 1.1, 2.2, 0.4, 0.8, "#c8ccd0"), B(0.6, 0.4, 1.1, 2.2, 0.06, 0.8, "#7a8088"),
    P("cyl", -0.9, 0, 1.2, 0.18, 1.1, 0.18, "#c8ccd0"), P("cyl", -0.9, 1.1, 1.2, 0.36, 0.22, 0.36, "#5a7a9a")],
  // a radio mast with a red light on top
  mast: [B(0, 0, 0, 0.06, 3.2, 0.06, "#8a8e94"), B(0, 3.2, 0, 0.1, 0.1, 0.1, "#e04030"), B(0, 0, 0, 0.5, 0.3, 0.5, "#a8aeb4")],
  // a research laboratory: white blocks and a glass band
  lab: [B(0, 0, 0, 1.6, 0.7, 1, "#eef0f2"), B(0, 0.25, 0.51, 1.6, 0.2, 0.02, "#5a7a9a"), B(0.9, 0, -0.2, 0.6, 1.2, 0.6, "#e4e6e8"), P("dome", -0.4, 0.7, 0, 0.6, 0.3, 0.6, "#c8ccd0")],
  // a biotech greenhouse: a glass dome full of green
  greenhouse: [P("dome", 0, 0, 0, 1.8, 0.9, 1.8, "#a8d8c0"), P("cone", 0, 0, 0, 0.9, 0.7, 0.9, "#3e7a3e")],
  // a launch pad: the gantry tower and the rocket
  launchpad: [B(0, 0, 0, 1.4, 0.06, 1.4, "#8a8e94"), B(-0.45, 0, 0, 0.18, 3.4, 0.18, "#c84a3a"), P("cyl", 0.1, 0.06, 0, 0.4, 2.6, 0.4, "#f2f2f0"), P("cone", 0.1, 2.66, 0, 0.4, 0.6, 0.4, "#f2f2f0"),
    B(-0.2, 2.2, 0, 0.5, 0.06, 0.08, "#c84a3a"), B(-0.2, 1.2, 0, 0.5, 0.06, 0.08, "#c84a3a")],
  // one span of an aqueduct: two piers and the water channel
  arch: [B(-0.42, 0, 0, 0.16, 1, 0.24, "#cfc6b4"), B(0.42, 0, 0, 0.16, 1, 0.24, "#cfc6b4"), B(0, 0.86, 0, 1.0, 0.16, 0.26, "#cfc6b4")]
};

/** Resolve a part's colour from its role. */
export function colorOf(c: Part["c"], pal: Palette, accent: string): string {
  switch (c) {
    case "wall": return pal.wall; case "roof": return pal.roof; case "trim": return pal.trim; case "door": return pal.door;
    case "stone": return pal.stone; case "wood": return pal.wood; case "accent": return accent; case "glow": return "#ff7a2e";
    case "awning": return accent; case "pave": return "#9c958a";
    default: return c;
  }
}

/** Which era of kit a village builds in. */
export function eraOf(stage: string, age: number, planned: boolean): Era {
  if (stage === "band" || age <= 0) return 0;
  if (age === 1) return 1;
  if (age >= 8) return 9;
  if (age >= 7) return 8;
  if (age >= 6) return 7;
  if (age >= 5) return 6;
  if (age >= 4) return 5;
  if (age === 3) return 4;
  return planned ? 3 : 2;
}
