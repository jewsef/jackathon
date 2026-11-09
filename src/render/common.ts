import type { World, Fx, PowerId } from "../sim/types";
import { inHome, isOuter, type IsleId } from "../sim/terrain";

export type Selection =
  | { kind: "village"; id: number } | { kind: "agent"; id: number } | { kind: "voyage"; id: number }
  | { kind: "isle"; id: IsleId } | { kind: "tribe"; id: number } | null;

export const LEVELS = [
  { name: "Archipelago", z: 1, max: 2.2 },
  { name: "Island", z: 2.8, max: 4.6 },
  { name: "Village", z: 7, max: 10 },
  { name: "Hearthside", z: 16, max: 99 }
];

/** What the game needs from a map view. The 2D (PixiJS) and 3D (Three.js) views both provide it. */
export interface MapLike {
  cam: { x: number; y: number; z: number };
  armed: { power: PowerId; radius: number } | null;
  selection: Selection;
  onCast: (x: number, y: number) => void;
  onSelect: (s: Selection) => void;
  onCamera: () => void;
  init(): Promise<void>;
  setWorld(w: Omit<World, "chronicle">, fx: Fx[]): void;
  refresh(): void;
  flyTo(x: number, y: number, z: number): void;
  zoomBy(f: number): void;
  level(): number;
  scaleBar(): { px: number; label: string };
  toScreen(x: number, y: number): [number, number];
}

/**
 * What the player can see. Until the first ocean ships, the lands beyond the horizon (and the
 * peoples living there) stay hidden in the mist, even though the simulation runs them all along.
 */
export function visibleWorld<T extends Omit<World, "chronicle">>(w: T): T {
  if (w.horizon) return w;
  const villages = w.villages.filter((v) => inHome(v.x, v.y));
  const ids = new Set(villages.map((v) => v.id));
  return {
    ...w, villages,
    voyages: w.voyages.filter((v) => inHome(v.fx, v.fy) && inHome(v.tx, v.ty)),
    agents: w.agents.filter((a) => ids.has(a.village)),
    routes: w.routes.filter((r) => ids.has(r.a) && ids.has(r.b)),
    effects: w.effects
  };
}
/** Is this tribe still hidden beyond the horizon? */
export const tribeHidden = (w: Omit<World, "chronicle">, home: IsleId) => !w.horizon && isOuter(home);
/** Names that would give away the hidden peoples, for keeping them out of the chronicle. */
export function hiddenNames(w: Omit<World, "chronicle">): string[] {
  if (w.horizon) return [];
  const out: string[] = [];
  for (const t of w.tribes) if (isOuter(t.home)) out.push(t.name);
  for (const v of w.villages) if (!inHome(v.x, v.y)) out.push(v.name);
  for (const a of w.agents) { const v = w.villages.find((x) => x.id === a.village); if (v && !inHome(v.x, v.y)) out.push(a.name); }
  return out;
}
