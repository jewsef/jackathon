import type { World, Fx, PowerId } from "../sim/types";
import type { IsleId } from "../sim/terrain";

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
