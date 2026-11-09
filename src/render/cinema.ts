/** Camera state for one frame of a cinematic shot. */
export interface ShotFrame { x: number; y: number; z: number; yaw: number; tilt: number; }
export type Shot = (u: number) => ShotFrame;

const ease = (u: number) => u * u * (3 - 2 * u);
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/**
 * The age-dawn flyover: start high above the capital, swoop down while circling it, and settle
 * close enough to see its streets. `u` runs from 0 to 1 over the shot.
 */
export function orbitShot(cx: number, cy: number, yaw0 = 0): Shot {
  return (u) => {
    const e = ease(clamp(u, 0, 1));
    return { x: cx, y: cy, z: Math.exp(Math.log(2.2) + (Math.log(9) - Math.log(2.2)) * e), yaw: yaw0 + e * Math.PI * 1.1, tilt: 10 - 14 * e };
  };
}

/** The world grows: pull back from a harbour until the whole map fits, turning to face north. */
export function flyoutShot(cx: number, cy: number, wx: number, wy: number, yaw0 = 0.8): Shot {
  return (u) => {
    const e = ease(clamp(u, 0, 1));
    return { x: cx + (wx / 2 - cx) * e, y: cy + (wy / 2 - cy) * e, z: Math.exp(Math.log(8) + (Math.log(1) - Math.log(8)) * e), yaw: yaw0 * (1 - e), tilt: 6 * (1 - e) };
  };
}

/** Photo mode filters, as CSS filters for the live view and the saved picture alike. */
export const PHOTO_FILTERS: Record<string, string> = {
  none: "none",
  golden: "sepia(0.35) saturate(1.25) brightness(1.05) contrast(1.05)",
  vivid: "saturate(1.6) contrast(1.12)",
  noir: "grayscale(1) contrast(1.3) brightness(0.95)",
  faded: "saturate(0.6) contrast(0.9) brightness(1.1) sepia(0.15)"
};

/** Which entries deserve an age-dawn shot, and the title card for them. */
export function titleCard(text: string): { title: string; sub: string } | null {
  if (text.startsWith("The world grows")) return { title: "The world grows", sub: "Ocean ships sail beyond the edge of the map" };
  const m = /^The (.+?) enter the (.+?)\./.exec(text);
  if (!m || m[2] === "Stone Age") return null;
  return { title: `The ${m[2]}`, sub: `The ${m[1]}` };
}
