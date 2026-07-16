import { describe, expect, it } from 'vitest';
import {
  ATTRIBUTE_KEYS,
  overall,
  overallFor,
  marketValue,
  wageDemand,
  generatePlayer,
  developWeekly,
  dailyCondition,
  effectiveRating,
  effectiveRatingAs,
  recordFormRating,
  currentSeasonStats,
} from '../src/player';
import { POSITIONS } from '../src/tactics';
import { createRng } from '../src/rng';
import type { Attributes, GameState } from '../src/types';
import { makePlayer } from './helpers';

/** Build an Attributes object with every attribute set to the same value. */
function uniformAttrs(v: number): Attributes {
  const attrs = {} as Attributes;
  for (const key of ATTRIBUTE_KEYS) attrs[key] = v;
  return attrs;
}

describe('overall / overallFor', () => {
  it('equals Math.round(V) for every position when every attribute is V, since weights sum to 1.0', () => {
    // NOTE: makePlayer's DEFAULT_ATTRIBUTES is NOT fully uniform (goalkeeping
    // defaults to 20, everything else 60), so we build an explicit uniform
    // attrs object rather than relying on makePlayer's defaults.
    for (const pos of POSITIONS) {
      for (const v of [1, 37, 60, 99]) {
        const p = makePlayer({ position: pos, attributes: uniformAttrs(v) });
        expect(overall(p)).toBe(Math.round(v));
      }
    }
  });

  it('weights position-relevant attributes more than off-role attributes', () => {
    const base = uniformAttrs(50);
    const baseOverall = overallFor(base, 'ST');

    // shooting is core for ST.
    const boostedShooting = { ...base, shooting: 60 };
    const shootingDelta = overallFor(boostedShooting, 'ST') - baseOverall;

    // defending is off-role for ST (not in ST's weight table at all).
    const boostedDefending = { ...base, defending: 60 };
    const defendingDelta = overallFor(boostedDefending, 'ST') - baseOverall;

    expect(shootingDelta).toBeGreaterThan(defendingDelta);
    // defending isn't weighted for ST at all, so it should have zero effect.
    expect(defendingDelta).toBe(0);
  });
});

describe('marketValue', () => {
  const day = 1000;

  it('is monotonic in ability (same age/contract)', () => {
    const low = makePlayer({ age: 25, attributes: uniformAttrs(50), potential: 50, contract: { wage: 1000, expiresDay: day + 365 * 3 } });
    const high = makePlayer({ age: 25, attributes: uniformAttrs(80), potential: 80, contract: { wage: 1000, expiresDay: day + 365 * 3 } });
    expect(marketValue(high, day)).toBeGreaterThan(marketValue(low, day));
  });

  it('values a mid-20s player higher than a mid-30s player with identical attributes/contract', () => {
    // potential === overall for both so the youth potential premium doesn't
    // muddy the comparison; the age curve alone should carry it.
    const attrs = uniformAttrs(75);
    const ovr = overallFor(attrs, 'CM');
    const young = makePlayer({ age: 23, attributes: attrs, potential: ovr, contract: { wage: 1000, expiresDay: day + 365 * 3 } });
    const old = makePlayer({ age: 34, attributes: attrs, potential: ovr, contract: { wage: 1000, expiresDay: day + 365 * 3 } });
    expect(marketValue(young, day)).toBeGreaterThan(marketValue(old, day));
  });

  it('depresses fee when the contract is close to expiring', () => {
    const attrs = uniformAttrs(75);
    const ovr = overallFor(attrs, 'CM');
    const longContract = makePlayer({ age: 27, attributes: attrs, potential: ovr, contract: { wage: 1000, expiresDay: day + 365 * 3 } });
    const shortContract = makePlayer({ age: 27, attributes: attrs, potential: ovr, contract: { wage: 1000, expiresDay: day + 10 } });
    expect(marketValue(shortContract, day)).toBeLessThan(marketValue(longContract, day));
  });

  it('never goes below the 10,000 floor', () => {
    const p = makePlayer({ age: 27, attributes: uniformAttrs(1), potential: 1, contract: { wage: 500, expiresDay: day + 365 } });
    expect(marketValue(p, day)).toBe(10_000);
  });

  it('gives a potential premium for young players whose potential exceeds their overall', () => {
    const attrs = uniformAttrs(60);
    const ovr = overallFor(attrs, 'CM');
    const highPotential = makePlayer({ age: 21, attributes: attrs, potential: 90, contract: { wage: 1000, expiresDay: day + 365 * 3 } });
    const noPotentialHeadroom = makePlayer({ age: 21, attributes: attrs, potential: ovr, contract: { wage: 1000, expiresDay: day + 365 * 3 } });
    expect(marketValue(highPotential, day)).toBeGreaterThan(marketValue(noPotentialHeadroom, day));
  });
});

describe('wageDemand', () => {
  it('is monotonic in overall', () => {
    expect(wageDemand(80, 25, 50)).toBeGreaterThan(wageDemand(60, 25, 50));
  });

  it('bumps wage for age >= 30', () => {
    expect(wageDemand(70, 30, 50)).toBeGreaterThan(wageDemand(70, 29, 50));
  });

  it('increases with club reputation', () => {
    expect(wageDemand(70, 25, 90)).toBeGreaterThan(wageDemand(70, 25, 10));
  });

  it('never goes below the 500 floor', () => {
    expect(wageDemand(1, 20, 0)).toBe(500);
  });
});

describe('generatePlayer', () => {
  it('produces players with potential >= overall, potential <= 96, in-bounds attributes, and correct passthrough fields', () => {
    const rng = createRng(42);
    for (let i = 0; i < 20; i++) {
      const pos = POSITIONS[i % POSITIONS.length];
      const contractEndDay = 500 + i * 10;
      const p = generatePlayer(rng, i, i % 5, pos, 65, 24, contractEndDay);
      expect(p.potential).toBeGreaterThanOrEqual(overall(p));
      expect(p.potential).toBeLessThanOrEqual(96);
      for (const key of ATTRIBUTE_KEYS) {
        const v = p.attributes[key];
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(1);
        expect(v).toBeLessThanOrEqual(99);
      }
      expect(p.clubId).toBe(-1);
      expect(p.contract.expiresDay).toBe(contractEndDay);
    }
  });

  it('gives GK-position players a meaningfully higher goalkeeping attribute than non-GK players at the same target overall', () => {
    const rng = createRng(7);
    const gkKeeping: number[] = [];
    const cmKeeping: number[] = [];
    for (let i = 0; i < 15; i++) {
      gkKeeping.push(generatePlayer(rng, i, 0, 'GK', 70, 26, 1000).attributes.goalkeeping);
      cmKeeping.push(generatePlayer(rng, i, 0, 'CM', 70, 26, 1000).attributes.goalkeeping);
    }
    const avg = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
    expect(avg(gkKeeping)).toBeGreaterThan(avg(cmKeeping) + 30);
  });
});

describe('developWeekly', () => {
  it('increases overall on net for a young player well below potential, over many iterations', () => {
    const rng = createRng(11);
    const p = makePlayer({ age: 20, attributes: uniformAttrs(40), potential: 90 });
    const initial = overall(p);
    for (let i = 0; i < 300; i++) {
      developWeekly(rng, p, 1.0, true);
    }
    expect(overall(p)).toBeGreaterThan(initial);
  });

  it('never increases overall for an older player (decline only touches pace/stamina/strength downward)', () => {
    const rng = createRng(23);
    const p = makePlayer({ age: 33, attributes: uniformAttrs(60), potential: 60 });
    const initial = overall(p);
    for (let i = 0; i < 300; i++) {
      developWeekly(rng, p, 1.0, true);
    }
    expect(overall(p)).toBeLessThanOrEqual(initial);
  });

  // Regression test for a boundary-value gap: ages 28-29 fell into none of the
  // three branches (age <= 23, age >= 30, age <= 27), so players in that band
  // got no growth AND no decline for two full years. Fixed by extending the
  // slow-growth branch's ceiling from <= 27 to <= 29.
  it('still grows a player aged 28-29 who is below potential (28-29 boundary gap, now closed)', () => {
    const rng = createRng(29);
    const p = makePlayer({ age: 29, attributes: uniformAttrs(40), potential: 90, wellbeing: 90 });
    const initial = overall(p);
    for (let i = 0; i < 300; i++) {
      developWeekly(rng, p, 1.0, true);
    }
    expect(overall(p)).toBeGreaterThan(initial);
  });
});

describe('dailyCondition', () => {
  it('does not decrease fitness for a healthy player training light below full fitness', () => {
    const rng = createRng(3);
    const p = makePlayer({ injuryDays: 0, fitness: 90 });
    const before = p.fitness;
    dailyCondition(rng, p, 'light');
    expect(p.fitness).toBeGreaterThanOrEqual(before);
  });

  it('decrements injuryDays by 1 per call, and clears the injury with sharpness clamped into [20, 55] on recovery', () => {
    const rng = createRng(4);
    const p = makePlayer({ injuryDays: 5, injuryName: 'Hamstring strain', sharpness: 80 });
    dailyCondition(rng, p, 'normal');
    expect(p.injuryDays).toBe(4);
    expect(p.injuryName).toBe('Hamstring strain'); // not yet recovered

    // Advance to the final day of injury; sharpness (80, out of [20,55]) should clamp down to 55.
    p.injuryDays = 1;
    dailyCondition(rng, p, 'normal');
    expect(p.injuryDays).toBe(0);
    expect(p.injuryName).toBeNull();
    expect(p.sharpness).toBeGreaterThanOrEqual(20);
    expect(p.sharpness).toBeLessThanOrEqual(55);
    expect(p.sharpness).toBe(55); // clamp(80, 20, 55) === 55
  });
});

describe('effectiveRating / effectiveRatingAs', () => {
  it('equals overall exactly at max condition with no form history (conditionMultiplier === 1)', () => {
    // fit maxes at 1.0 (fitness=100), sharp maxes at 1.0 (sharpness=100), mood
    // maxes at 1.0 (morale=wellbeing=100), and formFactor is exactly 1 when
    // form is empty (falls back to the neutral avgForm of 6.5) — so the
    // combined multiplier is exactly 1.0 at this specific condition.
    const p = makePlayer({ fitness: 100, sharpness: 100, morale: 100, wellbeing: 100, form: [] });
    expect(effectiveRating(p)).toBe(overall(p));
  });

  it('can exceed overall slightly with strong recent form, but stays within a sane bound', () => {
    const p = makePlayer({ fitness: 100, sharpness: 100, morale: 100, wellbeing: 100, form: [9, 9.5, 9, 10, 9.5] });
    const o = overall(p);
    expect(effectiveRating(p)).toBeGreaterThan(o);
    // fit/sharp/mood are each capped at 1.0 at these stat values, so the only
    // headroom above `overall` comes from formFactor = 1 + (avgForm-6.5)*0.012.
    // avgForm here is 9.4, giving a multiplier of ~1.0348.
    expect(effectiveRating(p)).toBeLessThanOrEqual(o * 1.05);
  });

  it('is meaningfully lower for a player in poor condition than the same player at max condition', () => {
    const good = makePlayer({ fitness: 100, sharpness: 100, morale: 100, wellbeing: 100, form: [] });
    const bad = makePlayer({ fitness: 20, sharpness: 20, morale: 20, wellbeing: 20, form: [] });
    expect(effectiveRating(bad)).toBeLessThan(effectiveRating(good) * 0.8);
  });

  it('effectiveRatingAs rates attributes for the given slot position rather than the natural one', () => {
    // A player whose attributes favor ST but whose natural position is CB:
    // filling the ST slot should be rated differently than filling his own CB slot.
    const attrs = uniformAttrs(60);
    attrs.shooting = 95;
    attrs.defending = 20;
    const p = makePlayer({ position: 'CB', attributes: attrs, fitness: 100, sharpness: 100, morale: 100, wellbeing: 100, form: [] });
    expect(effectiveRatingAs(p, 'CB')).toBe(effectiveRating(p));
    expect(effectiveRatingAs(p, 'ST')).not.toBe(effectiveRatingAs(p, 'CB'));
  });
});

describe('recordFormRating', () => {
  it('rounds ratings to 1 decimal and caps the array at length 5, dropping the oldest (shift, not pop)', () => {
    const p = makePlayer({ form: [] });
    const ratings = [6.111, 7.249, 8.0, 5.55, 9.999, 4.4, 7.77];
    for (const r of ratings) recordFormRating(p, r);

    expect(p.form).toHaveLength(5);
    // The first two pushes (6.1, 7.2) should have been dropped from the front.
    // (5.55 * 10 === 55.5 exactly in IEEE-754, and Math.round is half-up, so
    // it rounds to 56 -> 5.6, not 5.5 as naive decimal rounding would suggest.)
    expect(p.form).toEqual([8.0, 5.6, 10.0, 4.4, 7.8]);
  });
});

describe('currentSeasonStats', () => {
  it('creates a zeroed entry on first call and returns the same reference on a subsequent call for the same season/club', () => {
    const p = makePlayer({ clubId: 5, stats: [] });
    const state = { season: 3 } as unknown as GameState;

    expect(p.stats).toHaveLength(0);
    const first = currentSeasonStats(p, state);
    expect(p.stats).toHaveLength(1);
    expect(first).toEqual({ season: 3, clubId: 5, apps: 0, goals: 0, assists: 0, yellows: 0, reds: 0, ratingSum: 0, motm: 0 });

    const second = currentSeasonStats(p, state);
    expect(second).toBe(first); // same reference, no duplicate created
    expect(p.stats).toHaveLength(1);
  });
});
