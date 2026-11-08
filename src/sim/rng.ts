/** Seeded PRNG (mulberry32). Its whole state is one number, so it lives inside the World and replays exactly. */
export class Rng {
  s: number;
  constructor(seed: number) { this.s = (seed >>> 0) || 0x9e3779b9; }
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number { return a + (b - a) * this.next(); }
  int(n: number): number { return Math.floor(this.next() * n); }
  chance(p: number): boolean { return this.next() < p; }
  pick<T>(arr: readonly T[]): T { return arr[Math.floor(this.next() * arr.length)]; }
  /** Binomial draw. Exact for small n, normal approximation for large n. */
  binom(n: number, p: number): number {
    n = Math.max(0, Math.floor(n)); p = Math.min(1, Math.max(0, p));
    if (n === 0 || p === 0) return 0;
    if (n < 40) { let k = 0; for (let i = 0; i < n; i++) if (this.next() < p) k++; return k; }
    const mean = n * p, sd = Math.sqrt(n * p * (1 - p));
    const u = Math.max(1e-9, this.next()), v = this.next();
    const z = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    return Math.max(0, Math.min(n, Math.round(mean + sd * z)));
  }
}

/** Stateless hash to [0,1). Used for deterministic visual variety without consuming RNG state. */
export function hash3(x: number, y: number, s: number): number {
  let h = (x * 374761393 + y * 668265263 + s * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
