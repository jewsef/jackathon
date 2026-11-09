import type { Tribe } from "../sim/types";

/** The Tailfolk: straw hat with an island glyph, two-tone tail, wrist wraps, sash, bare feet. */
const OUT = "#2a2230";
export const GLYPH: Record<string, string> = {
  hearth: "M-5 3 L-1.5 -3.5 L0.5 -0.5 L2.5 -2.5 L5.5 3 Z",
  kelp: "M-5.5 -0.5 Q-3 -4 -0.5 -0.5 T4.5 -0.5 M-5 3 Q-2.5 0 0 3 T5 3",
  thorn: "M0 -5 L4 2 L-4 2 Z M0 2 L0 5",
  gull: "M-5.5 -0.5 Q-3 -3.5 0 0.5 Q3 -3.5 5.5 -0.5",
  far: "M-2 0 A2 2 0 1 0 2 0 A2 2 0 1 0 -2 0 M0 -5 L0 -3.5 M0 3.5 L0 5 M-5 0 L-3.5 0 M3.5 0 L5 0",
  great: "M-5.5 2.5 L-2 -2 L0 0.5 L2.5 -3 L5.5 2.5 Z M-4 4.5 L4 4.5",
  spice: "M0 -5 L1.5 -1.5 L5 0 L1.5 1.5 L0 5 L-1.5 1.5 L-5 0 L-1.5 -1.5 Z"
};

export interface Look {
  tribe: Pick<Tribe, "tail" | "tip" | "skin" | "cloth" | "top" | "sash" | "hair" | "home">;
  sex: "m" | "f"; job?: string; age?: "adult" | "child" | "elder"; tail?: string; stripe?: string;
}

function mix(a: string, b: string, t: number) {
  const p = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
  const A = p(a), B = p(b);
  return "#" + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, "0")).join("");
}

type Op = [string, string | null, string | null, number?];

function shapes(o: Look): Op[] {
  const T = o.tribe, skin = T.skin, tail = o.tail || T.tail, f = o.sex === "f", job = o.job || "";
  const hair = o.age === "elder" ? "#cfc8bf" : T.hair;
  const sash = job === "doctor" ? "#5d7a4a" : job === "priest" ? "#5a8fb0" : T.sash;
  const ops: Op[] = [];
  const P = (d: string, fill: string | null, stroke: string | null = OUT, w = 2) => ops.push([d, fill, stroke, w]);
  const ell = (cx: number, cy: number, rx: number, ry: number) => `M${cx - rx} ${cy} A${rx} ${ry} 0 1 0 ${cx + rx} ${cy} A${rx} ${ry} 0 1 0 ${cx - rx} ${cy} Z`;
  const stick = (d: string, col: string, w: number) => { P(d, null, OUT, w + 2.4); P(d, null, col, w); };
  P(ell(50, 132, 27, 4.5), "rgba(0,0,0,0.3)", null);
  if (job === "leader") P("M35 66 L25 110 L75 110 L65 66 Z", "#8f2f2a");
  P("M58 98 C 82 96, 97 114, 88 128 C 82 137, 67 135, 69 125 C 71 116, 64 107, 56 104 Z", tail);
  if (o.stripe) P("M71 102 C 79 106, 84 112, 85 118 L 77 121 C 76 115, 73 110, 67 106 Z", o.stripe, null);
  P("M88 128 C 82 137, 67 135, 69 125 C 74 128, 82 127, 89 121 Z", T.tip);
  P("M38 96 L36 124 L46 124 L49 105 L51 105 L54 124 L64 124 L62 96 Z", T.cloth);
  P(ell(41, 127, 6.5, 3.2), skin); P(ell(59, 127, 6.5, 3.2), skin);
  P("M36 67 Q50 61 64 67 L63 96 L37 96 Z", skin);
  if (f) P("M37 72 Q50 68 63 72 L63 82 Q50 85 37 82 Z", T.top);
  else P("M44 76 Q47 78 49 76 M51 76 Q53 78 56 76 M50 84 L50 89", null, mix(skin, "#000000", 0.25), 1.3);
  P("M36 89 L64 89 L64 97 L36 97 Z", sash); P("M58 95 L64 108 L57 105 Z", sash);
  stick("M36 68 Q27 79 29 92", skin, 6); stick("M64 68 Q73 79 71 92", skin, 6);
  P("M25.5 84 h7.5 v5.5 h-7.5 Z", "#c4473a"); P("M67 84 h7.5 v5.5 h-7.5 Z", "#c4473a");
  switch (job) {
    case "gatherer": P("M17 88 L36 88 L33 104 L20 104 Z", "#b08a52"); P(ell(22, 86, 2.6, 2.6), "#a8325a", OUT, 1); P(ell(27.5, 84.5, 2.6, 2.6), "#5a3a8a", OUT, 1); break;
    case "farmer": stick("M75 56 L69 120", "#8a6440", 2.6); P("M74 55 L86 58 L84 65 L73 62 Z", "#9aa3ad"); break;
    case "fisher": stick("M73 30 L69 122", "#8a6440", 2.6); P("M68 22 L68 31 L78 31 L78 22 M73 20 L73 31", null, OUT, 2); break;
    case "builder": stick("M70 92 L77 64", "#8a6440", 2.6); P("M70 57 L84 54 L86 63 L72 66 Z", "#8a6440"); break;
    case "leader": P("M41 68 Q50 76 59 68", null, "#f3e7bd", 2.6); break;
    case "doctor": P("M61 92 h11 v10 h-11 Z", "#5d7a4a"); P("M28 92 Q22 82 25 74", null, "#4f8a4a", 2); P(ell(24.5, 76, 4, 2), "#6fae5c", OUT, 1); break;
    case "priest": stick("M73 44 L69 124", "#7a5532", 2.6); P(ell(73.5, 38, 7, 7), "#8fd0e6"); break;
    case "warrior": stick("M73 30 L69 122", "#8a6440", 2.6); P("M73 18 L78 31 L68 31 Z", "#2a2230", OUT, 1.5); P(ell(27, 90, 12.5, 12.5), "#a8865a"); P("M27 77.5 L27 102.5 M14.5 90 L39.5 90", null, "#7a5532", 1.2); break;
    case "boatwright": stick("M74 52 L70 104", "#9a7048", 2.6); P(ell(69, 112, 4.5, 10), "#9a7048"); break;
    case "elder": stick("M76 52 Q81 57 76 61 L71 124", "#7a5532", 2.8); break;
  }
  P(ell(50, 49, 15, 14), skin);
  P("M35.5 45 Q38 53 42 47 Q46 54 50 47 Q54 54 58 47 Q62 53 64.5 45 Z", hair, null);
  if (f) stick("M63 50 Q71 62 65 78", hair, 4);
  P(ell(44.5, 52.5, 1.9, 2.5), OUT, null); P(ell(55.5, 52.5, 1.9, 2.5), OUT, null);
  P("M47.5 58 Q50 60 52.5 58", null, OUT, 1.4);
  if (job === "warrior" || job === "priest") P("M38.5 54.5 L42 55.5 M38.5 57 L42 58 M58 55.5 L61.5 54.5 M58 58 L61.5 57", null, job === "priest" ? "#8fd0e6" : "#c4473a", 1.5);
  if (o.age === "elder" && !f) P("M43 59 Q50 70 57 59 Q50 63 43 59 Z", hair, OUT, 1.2);
  P("M13 43 L50 14 L87 43 Q50 51 13 43 Z", "#e6d49a");
  P("M50 15 L31 45 M50 15 L69 45 M50 15 L50 48 M50 15 L22 44 M50 15 L78 44", null, "#c8b273", 0.9);
  P(ell(50, 34, 6.5, 6.5), "#f3e7bd", "#8a7440", 1);
  if (job === "leader") { P("M52 16 Q57 2 67 3 Q60 8 55 18 Z", "#c4473a"); P("M50 16 Q50 4 57 0 Q54 8 53 17 Z", "#f2b257"); }
  return ops;
}

/** Draw one Tailfolk figure into a new canvas. Height in pixels; width is 100/140 of it. */
export function drawCharacter(o: Look, height = 140): HTMLCanvasElement {
  const c = document.createElement("canvas");
  const s = height / 140, child = o.age === "child";
  c.width = Math.ceil(100 * s); c.height = Math.ceil(140 * s);
  const g = c.getContext("2d")!;
  g.scale(s, s);
  if (child) { g.translate(11, 29); g.scale(0.78, 0.78); }
  g.lineJoin = "round"; g.lineCap = "round";
  for (const [d, fill, stroke, w] of shapes(o)) {
    const p = new Path2D(d);
    if (fill) { g.fillStyle = fill; g.fill(p); }
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = w ?? 2; g.stroke(p); }
  }
  g.save(); g.translate(50, 34); g.scale(0.85, 0.85);
  g.strokeStyle = "#3b2f22"; g.lineWidth = 1.6; g.stroke(new Path2D(GLYPH[o.tribe.home] ?? GLYPH.hearth));
  g.restore();
  return c;
}

const portraitCache = new Map<string, string>();
export function portraitURL(o: Look, height = 140): string {
  const key = JSON.stringify([o.tribe.tail, o.tribe.home, o.sex, o.job, o.age, o.tail, o.stripe, height]);
  let u = portraitCache.get(key);
  if (!u) { u = drawCharacter(o, height).toDataURL(); portraitCache.set(key, u); }
  return u;
}
