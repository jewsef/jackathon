/// <reference lib="webworker" />
import type { Action, World, ChronEntry, Fx } from "./types";
import { createWorld } from "./world";
import { tick, replay } from "./tick";
import { applyPowers } from "./powers";
import { Rng } from "./rng";
import { TimeLapse } from "./timelapse";

/** Seasons per real second at each speed setting: pause, 1x, 4x, 16x, 64x. */
export const RATES = [0, 0.5, 2, 8, 32];

export type ToWorker =
  | { type: "init"; seed: number; log?: Action[]; toTick?: number }
  | { type: "speed"; value: number }
  | { type: "act"; action: Omit<Action, "tick"> }
  | { type: "save" }
  | { type: "timelapse"; seconds?: number }
  | { type: "tl-stop" };
export type FromWorker =
  | { type: "snap"; world: Omit<World, "chronicle">; entries: ChronEntry[]; fx: Fx[]; reset: boolean; chronicle?: ChronEntry[] }
  | { type: "saved"; seed: number; log: Action[]; tick: number }
  | { type: "tl"; world: Omit<World, "chronicle">; entries: ChronEntry[]; fx: Fx[]; progress: number }
  | { type: "tl-end" };

let w: World | null = null;
let log: Action[] = [];
const applied = new WeakSet<Action>();
let speed = 1, acc = 0, last = 0;
let pendingEntries: ChronEntry[] = [], pendingFx: Fx[] = [];
/** A time-lapse in progress: the live world waits while history replays. */
let tl: TimeLapse | null = null;

const ctx = self as unknown as DedicatedWorkerGlobalScope;

function post(reset = false) {
  if (!w) return;
  const { chronicle, ...rest } = w;
  const msg: FromWorker = { type: "snap", world: rest, entries: pendingEntries, fx: pendingFx, reset, chronicle: reset ? chronicle : undefined };
  ctx.postMessage(msg);
  pendingEntries = []; pendingFx = [];
}

function step(n: number) {
  if (!w) return;
  for (let i = 0; i < n; i++) {
    const acts = log.filter((a) => a.tick === w!.tick && !applied.has(a));
    w = tick(w, acts);
    pendingEntries.push(...w.events);
    pendingFx.push(...w.fx);
  }
}

ctx.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  if (m.type === "init") {
    log = m.log ? [...m.log] : [];
    w = m.log && m.toTick ? replay(createWorld, m.seed, log, m.toTick) : createWorld(m.seed);
    pendingEntries = []; pendingFx = [];
    post(true);
  } else if (m.type === "speed") {
    speed = m.value;
  } else if (m.type === "act" && w) {
    const a: Action = { ...m.action, tick: w.tick };
    log.push(a);
    if (speed === 0) {
      // Paused: apply now. tick() applies powers first with the same RNG state, so replays match.
      const rng = new Rng(w.rngState);
      w.events = []; w.fx = [];
      applyPowers(w, [a], rng);
      w.rngState = rng.s;
      w.chronicle.push(...w.events);
      pendingEntries.push(...w.events); pendingFx.push(...w.fx);
      applied.add(a);
      post();
    }
  } else if (m.type === "timelapse" && w && !tl) {
    // replay all of history in about `seconds` seconds, at 20 frames a second
    tl = new TimeLapse(w.seed, log, w.tick, Math.max(60, (m.seconds ?? 45) * 20));
  } else if (m.type === "tl-stop" && tl) {
    endTimeLapse();
  } else if (m.type === "save" && w) {
    ctx.postMessage({ type: "saved", seed: w.seed, log: log.map((a) => ({ ...a })), tick: w.tick } satisfies FromWorker);
  }
};

function endTimeLapse() {
  tl = null; last = 0; acc = 0;
  ctx.postMessage({ type: "tl-end" } satisfies FromWorker);
  pendingEntries = []; pendingFx = [];
  post(true);
}

setInterval(() => {
  if (tl) {
    const f = tl.next();
    const { chronicle, ...rest } = f.world;
    void chronicle;
    ctx.postMessage({ type: "tl", world: rest, entries: f.entries, fx: f.fx, progress: f.progress } satisfies FromWorker);
    if (tl.done) endTimeLapse();
    return;
  }
  const now = performance.now();
  const dt = last ? Math.min(0.5, (now - last) / 1000) : 0;
  last = now;
  if (!w || speed === 0) return;
  acc += dt * RATES[speed];
  const n = Math.min(64, Math.floor(acc));
  acc -= n;
  if (n > 0) { step(n); post(); }
}, 50);
