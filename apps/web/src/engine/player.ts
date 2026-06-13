import type { Attributes, AttributeKey, Player, Position, GameState } from './types';
import { type Rng, gaussianIn, randInt, pick, clamp, chance } from './rng';
import { NAME_POOLS } from './names';

/** Position-specific weights used to compute a player's overall rating. */
const POSITION_WEIGHTS: Record<Position, Partial<Record<AttributeKey, number>>> = {
  GK: { goalkeeping: 0.55, composure: 0.15, strength: 0.1, passing: 0.1, vision: 0.1 },
  DF: { defending: 0.35, strength: 0.15, pace: 0.12, composure: 0.1, passing: 0.1, workRate: 0.1, stamina: 0.08 },
  MF: { passing: 0.25, vision: 0.18, dribbling: 0.12, workRate: 0.12, stamina: 0.11, defending: 0.08, shooting: 0.08, composure: 0.06 },
  FW: { shooting: 0.32, pace: 0.18, dribbling: 0.15, composure: 0.13, strength: 0.08, passing: 0.08, vision: 0.06 },
};

export const ATTRIBUTE_KEYS: AttributeKey[] = [
  'pace', 'strength', 'stamina', 'passing', 'shooting', 'dribbling',
  'defending', 'goalkeeping', 'vision', 'composure', 'workRate',
];

export function overall(p: Player): number {
  return overallFor(p.attributes, p.position);
}

export function overallFor(attrs: Attributes, pos: Position): number {
  const weights = POSITION_WEIGHTS[pos];
  let sum = 0;
  for (const key of ATTRIBUTE_KEYS) {
    const w = weights[key] ?? 0;
    sum += attrs[key] * w;
  }
  return Math.round(sum);
}

/** Age multiplier on the physical attributes used for the development curve. */
function ageCurve(age: number): number {
  if (age <= 21) return 1;
  if (age <= 28) return 1;
  if (age <= 31) return 0.97;
  return Math.max(0.7, 1 - (age - 31) * 0.035);
}

export function fullName(p: Player): string {
  return `${p.firstName} ${p.lastName}`;
}

export function generatePlayer(
  rng: Rng,
  id: number,
  nationId: number,
  position: Position,
  targetOverall: number,
  age: number,
  contractEndDay: number,
): Player {
  const pool = NAME_POOLS[nationId % NAME_POOLS.length];
  const attrs = {} as Attributes;
  // Start with noise around the target, then nudge weighted attributes up so
  // the computed overall lands near targetOverall for the position.
  for (const key of ATTRIBUTE_KEYS) {
    attrs[key] = Math.round(gaussianIn(rng, targetOverall - 8, 9, 20, 95));
  }
  attrs.goalkeeping = position === 'GK' ? attrs.goalkeeping : randInt(rng, 5, 20);
  const weights = POSITION_WEIGHTS[position];
  for (const key of ATTRIBUTE_KEYS) {
    if (weights[key]) {
      attrs[key] = Math.round(clamp(targetOverall + gaussianIn(rng, 0, 6, -14, 14), 20, 97));
    }
  }
  if (position !== 'GK') attrs.goalkeeping = randInt(rng, 5, 20);

  const ovr = overallFor(attrs, position);
  const headroom = age <= 23 ? randInt(rng, 4, 18) : age <= 27 ? randInt(rng, 1, 7) : 0;
  const potential = clamp(ovr + headroom, ovr, 96);

  const player: Player = {
    id,
    firstName: pick(rng, pool.first),
    lastName: pick(rng, pool.last),
    nationId,
    age,
    birthDayOfYear: randInt(rng, 0, 364),
    position,
    attributes: attrs,
    potential,
    clubId: -1,
    contract: { wage: wageDemand(ovr, age, 50), expiresDay: contractEndDay },
    squadNumber: 0,
    fitness: randInt(rng, 88, 100),
    sharpness: randInt(rng, 60, 90),
    morale: randInt(rng, 60, 85),
    wellbeing: randInt(rng, 70, 95),
    injuryDays: 0,
    injuryName: null,
    suspendedMatches: 0,
    form: [],
    transferListed: false,
    stats: [],
    retiring: false,
  };
  return player;
}

/** Market value derived from ability, age, potential and contract length. */
export function marketValue(p: Player, day: number): number {
  const ovr = overall(p);
  // Exponential in ability: a 80-rated player is worth far more than 2x a 60.
  let base = Math.pow(Math.max(0, ovr - 40) / 10, 3.1) * 220_000;
  // Age factor: peak value mid-20s, falls off hard in 30s.
  const ageFactor =
    p.age <= 20 ? 1.1 : p.age <= 24 ? 1.25 : p.age <= 28 ? 1.0 : p.age <= 30 ? 0.7 : p.age <= 32 ? 0.4 : 0.2;
  base *= ageFactor;
  // Potential premium for youngsters.
  if (p.age <= 23 && p.potential > ovr) base *= 1 + (p.potential - ovr) * 0.05;
  // Contract running down depresses the fee.
  const yearsLeft = Math.max(0, (p.contract.expiresDay - day) / 365);
  base *= yearsLeft < 0.6 ? 0.45 : yearsLeft < 1.2 ? 0.75 : 1;
  const avgForm = p.form.length ? p.form.reduce((a, b) => a + b, 0) / p.form.length : 6.5;
  base *= 1 + (avgForm - 6.5) * 0.06;
  return Math.max(10_000, Math.round(base / 5000) * 5000);
}

/** Weekly wage a player will demand, scaled by club reputation. */
export function wageDemand(ovr: number, age: number, clubReputation: number): number {
  let wage = Math.pow(Math.max(1, ovr - 35) / 10, 2.6) * 1800;
  if (age >= 30) wage *= 1.15; // veterans want security
  wage *= 0.8 + clubReputation / 250;
  return Math.max(500, Math.round(wage / 100) * 100);
}

/**
 * Weekly development tick: young players grow toward potential (faster with
 * playing time), older players decline. Mutates the player.
 */
export function developWeekly(rng: Rng, p: Player, intensityFactor: number, playedRecently: boolean): void {
  const ovr = overall(p);
  if (p.age <= 23 && ovr < p.potential) {
    const drive = (p.potential - ovr) / 60;
    let growth = drive * intensityFactor * (playedRecently ? 1.5 : 0.8);
    growth *= 0.55 + p.wellbeing / 200; // unhappy players stagnate
    if (chance(rng, clamp(growth, 0, 0.5))) {
      bumpRandomWeightedAttribute(rng, p, +1);
    }
  } else if (p.age >= 30) {
    const declineChance = (p.age - 29) * 0.025 * (2 - ageCurve(p.age));
    if (chance(rng, declineChance)) {
      const key = pick(rng, ['pace', 'stamina', 'strength'] as AttributeKey[]);
      p.attributes[key] = clamp(p.attributes[key] - 1, 10, 99);
    }
  } else if (p.age <= 27 && ovr < p.potential && chance(rng, 0.06 * intensityFactor)) {
    bumpRandomWeightedAttribute(rng, p, +1);
  }
}

function bumpRandomWeightedAttribute(rng: Rng, p: Player, delta: number): void {
  const weights = POSITION_WEIGHTS[p.position];
  const keys = ATTRIBUTE_KEYS.filter((k) => (weights[k] ?? 0) > 0);
  const key = pick(rng, keys);
  p.attributes[key] = clamp(p.attributes[key] + delta, 10, 99);
}

/** Daily fitness/sharpness/wellbeing recovery & decay. Mutates the player. */
export function dailyCondition(rng: Rng, p: Player, intensity: 'light' | 'normal' | 'heavy'): void {
  if (p.injuryDays > 0) {
    p.injuryDays -= 1;
    p.fitness = clamp(p.fitness + 1, 0, 100);
    if (p.injuryDays === 0) {
      p.injuryName = null;
      p.sharpness = clamp(p.sharpness, 20, 55); // returns rusty
    }
    return;
  }
  const recover = intensity === 'light' ? 4.5 : intensity === 'normal' ? 3.5 : 2.5;
  const sharpen = intensity === 'light' ? 0.6 : intensity === 'normal' ? 1.2 : 2.0;
  p.fitness = clamp(p.fitness + recover, 0, 100);
  p.sharpness = clamp(p.sharpness + sharpen - 0.4, 0, 100);
  // Heavy training grinds wellbeing down slightly; light lets players breathe.
  const wbDrift = intensity === 'heavy' ? -0.25 : intensity === 'light' ? 0.2 : 0.05;
  p.wellbeing = clamp(p.wellbeing + wbDrift, 0, 100);
  // Morale and wellbeing slowly pull toward each other.
  p.morale = clamp(p.morale + (p.wellbeing - p.morale) * 0.01, 0, 100);
  if (intensity === 'heavy' && p.fitness < 60 && chance(rng, 0.004)) {
    p.injuryDays = randInt(rng, 5, 21);
    p.injuryName = 'Training injury';
  }
}

/** Effective on-pitch quality after condition modifiers (0-99 scale). */
export function effectiveRating(p: Player): number {
  const ovr = overall(p);
  const fit = 0.75 + (p.fitness / 100) * 0.25;
  const sharp = 0.88 + (p.sharpness / 100) * 0.12;
  const mood = 0.9 + ((p.morale * 0.6 + p.wellbeing * 0.4) / 100) * 0.1;
  const avgForm = p.form.length ? p.form.reduce((a, b) => a + b, 0) / p.form.length : 6.5;
  const formFactor = 1 + (avgForm - 6.5) * 0.012;
  return ovr * fit * sharp * mood * formFactor;
}

export function recordFormRating(p: Player, rating: number): void {
  p.form.push(Math.round(rating * 10) / 10);
  if (p.form.length > 5) p.form.shift();
}

export function currentSeasonStats(p: Player, state: GameState) {
  let s = p.stats.find((st) => st.season === state.season && st.clubId === p.clubId);
  if (!s) {
    s = { season: state.season, clubId: p.clubId, apps: 0, goals: 0, assists: 0, yellows: 0, reds: 0, ratingSum: 0, motm: 0 };
    p.stats.push(s);
  }
  return s;
}
