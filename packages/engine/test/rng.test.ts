import { describe, expect, it } from 'vitest';
import { chance, clamp, createRng, gaussianIn, pick, randInt, shuffle, weightedPick } from '../src/rng';

describe('createRng', () => {
  it('is a pure function of seed: same seed -> identical sequence', () => {
    const a = createRng(12345);
    const b = createRng(12345);
    const seqA = Array.from({ length: 50 }, () => a());
    const seqB = Array.from({ length: 50 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it('different seeds diverge', () => {
    const a = createRng(1);
    const b = createRng(2);
    const seqA = Array.from({ length: 20 }, () => a());
    const seqB = Array.from({ length: 20 }, () => b());
    expect(seqA).not.toEqual(seqB);
  });

  it('returns values in [0, 1)', () => {
    const rng = createRng(7);
    for (let i = 0; i < 500; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('randInt', () => {
  it('always returns an integer within [min, max] inclusive', () => {
    const rng = createRng(42);
    for (let i = 0; i < 1000; i++) {
      const v = randInt(rng, -5, 5);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(-5);
      expect(v).toBeLessThanOrEqual(5);
    }
  });

  it('handles min === max by always returning that value', () => {
    const rng = createRng(3);
    for (let i = 0; i < 50; i++) {
      expect(randInt(rng, 4, 4)).toBe(4);
    }
  });
});

describe('pick', () => {
  it('always returns an element === one of the input array elements', () => {
    const rng = createRng(9);
    const items = [{ n: 1 }, { n: 2 }, { n: 3 }, { n: 4 }];
    for (let i = 0; i < 200; i++) {
      const picked = pick(rng, items);
      expect(items).toContain(picked);
    }
  });
});

describe('chance', () => {
  it('chance(rng, 0) is always false (rng() < 0 never holds since rng() >= 0)', () => {
    const rng = createRng(11);
    for (let i = 0; i < 500; i++) {
      expect(chance(rng, 0)).toBe(false);
    }
  });

  it('chance(rng, 1) is always true (rng() < 1 always holds since rng() is in [0, 1))', () => {
    const rng = createRng(13);
    for (let i = 0; i < 500; i++) {
      expect(chance(rng, 1)).toBe(true);
    }
  });
});

describe('gaussianIn', () => {
  it('never leaves [min, max] over many draws', () => {
    const rng = createRng(21);
    for (let i = 0; i < 1000; i++) {
      const v = gaussianIn(rng, 50, 20, 0, 100);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });

  it('stays within a tight clamp range even with a large sd', () => {
    const rng = createRng(22);
    for (let i = 0; i < 1000; i++) {
      const v = gaussianIn(rng, 0, 1000, -1, 1);
      expect(v).toBeGreaterThanOrEqual(-1);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});

describe('clamp', () => {
  it('returns min when value is below min', () => {
    expect(clamp(-10, 0, 100)).toBe(0);
  });

  it('returns max when value is above max', () => {
    expect(clamp(150, 0, 100)).toBe(100);
  });

  it('returns the value unchanged when inside range', () => {
    expect(clamp(42, 0, 100)).toBe(42);
  });

  it('returns boundary values unchanged', () => {
    expect(clamp(0, 0, 100)).toBe(0);
    expect(clamp(100, 0, 100)).toBe(100);
  });
});

describe('shuffle', () => {
  it('returns an array with the same multiset of elements', () => {
    const rng = createRng(5);
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const result = shuffle(rng, input);
    expect(result.length).toBe(input.length);
    expect([...result].sort((a, b) => a - b)).toEqual([...input].sort((a, b) => a - b));
  });

  it('does not mutate the input array', () => {
    const rng = createRng(6);
    const input = [1, 2, 3, 4, 5];
    const snapshot = [...input];
    shuffle(rng, input);
    expect(input).toEqual(snapshot);
  });

  it('is deterministic for a given seed', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const resultA = shuffle(createRng(99), input);
    const resultB = shuffle(createRng(99), input);
    expect(resultA).toEqual(resultB);
  });
});

describe('weightedPick', () => {
  it('always returns the single item when the array has one element', () => {
    const rng = createRng(1);
    for (let i = 0; i < 20; i++) {
      expect(weightedPick(rng, ['only'], () => 5)).toBe('only');
    }
  });

  it('returns the single item even when its weight is 0', () => {
    const rng = createRng(2);
    expect(weightedPick(rng, ['only'], () => 0)).toBe('only');
  });

  // Characterization of actual behavior (not a spec): with all-zero weights,
  // total = 0, so r = rng() * 0 = 0, and the very first item's running
  // remainder (0 - 0 = 0) satisfies `r <= 0` immediately. The loop therefore
  // always returns items[0] regardless of rng draws, never falling through to
  // the `items[items.length - 1]` tail case.
  it('with all-zero weights, always returns the first item', () => {
    const rng = createRng(3);
    const items = ['a', 'b', 'c'];
    for (let i = 0; i < 100; i++) {
      expect(weightedPick(rng, items, () => 0)).toBe('a');
    }
  });

  it('favors a much-more-heavily-weighted item over many trials', () => {
    const rng = createRng(4);
    const items = ['low1', 'low2', 'high', 'low3'];
    const weights: Record<string, number> = { low1: 1, low2: 1, high: 100, low3: 1 };
    let highCount = 0;
    const trials = 200;
    for (let i = 0; i < trials; i++) {
      const result = weightedPick(rng, items, (it) => weights[it]);
      if (result === 'high') highCount++;
    }
    expect(highCount / trials).toBeGreaterThan(0.7);
  });
});
