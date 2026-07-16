// Seeded RNG (mulberry32) so generated worlds are reproducible from a seed.

export type Rng = () => number;

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randInt(rng: Rng, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

export function pick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

export function chance(rng: Rng, p: number): boolean {
  return rng() < p;
}

/** Approximate gaussian via central limit, mean 0, sd 1. */
export function gaussian(rng: Rng): number {
  let sum = 0;
  for (let i = 0; i < 6; i++) sum += rng();
  return (sum - 3) / Math.sqrt(0.5);
}

/** Gaussian clamped to [min, max]. */
export function gaussianIn(rng: Rng, mean: number, sd: number, min: number, max: number): number {
  return clamp(mean + gaussian(rng) * sd, min, max);
}

export function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

export function shuffle<T>(rng: Rng, arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// The trailing return below is a float-precision safety net, not dead code:
// for a normal positive-weight array, `total` and the cumulative `r -=
// weight(it)` subtractions can round differently (floating-point addition/
// subtraction isn't associative), so after the last item `r` can land as a
// tiny positive residue instead of <= 0 — without the fallback that would
// fall through the loop and return `undefined`. Separately, if every weight
// is 0 (so `total` is 0), `r` starts at 0 and the first item's `r -= 0`
// already satisfies `r <= 0`, so `items[0]` is returned deterministically —
// not an error, just a degenerate case worth knowing about (no real caller
// in this codebase passes all-zero weights).
export function weightedPick<T>(rng: Rng, items: readonly T[], weight: (item: T) => number): T {
  const total = items.reduce((s, it) => s + weight(it), 0);
  let r = rng() * total;
  for (const it of items) {
    r -= weight(it);
    if (r <= 0) return it;
  }
  return items[items.length - 1];
}
