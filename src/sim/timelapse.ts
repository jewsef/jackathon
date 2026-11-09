import type { Action, World, ChronEntry, Fx } from "./types";
import { createWorld } from "./world";
import { tick } from "./tick";

/** Chronicle kinds worth a caption during a time-lapse. */
export const CAPTION_KINDS = new Set(["age", "contact", "end", "politics", "climate"]);

export interface Frame { world: World; entries: ChronEntry[]; fx: Fx[]; progress: number; }

/**
 * Replays a world's whole history from its seed and the player's action log, in steps sized so the
 * replay takes about `frames` frames. Deterministic: the last frame is the live world, exactly.
 */
export class TimeLapse {
  readonly target: number; readonly step: number;
  private w: World;
  private byTick = new Map<number, Action[]>();
  constructor(seed: number, log: Action[], target: number, frames = 900) {
    this.target = target;
    this.step = Math.max(1, Math.round(target / frames));
    this.w = createWorld(seed);
    for (const a of log) { const l = this.byTick.get(a.tick) ?? []; l.push(a); this.byTick.set(a.tick, l); }
  }
  get done() { return this.w.tick >= this.target; }
  get world() { return this.w; }
  /** Advance one frame: `step` seasons, collecting the events and effects along the way. */
  next(): Frame {
    const entries: ChronEntry[] = [], fx: Fx[] = [];
    for (let i = 0; i < this.step && this.w.tick < this.target; i++) {
      this.w = tick(this.w, this.byTick.get(this.w.tick) ?? []);
      entries.push(...this.w.events.filter((e) => CAPTION_KINDS.has(e.kind)));
      fx.push(...this.w.fx.filter((f) => f.kind === "age" || f.kind === "found" || f.kind === "battle" || f.kind === "uprising"));
    }
    return { world: this.w, entries, fx, progress: this.target ? this.w.tick / this.target : 1 };
  }
}
