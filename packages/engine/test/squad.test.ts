import { describe, expect, it } from 'vitest';
import {
  isAvailable, pickBestLineup, positionCounts, squadStrength, totalWages,
} from '../src/squad';
import { FORMATIONS } from '../src/tactics';
import type { Attributes, FormationId } from '../src/types';
import { makePlayer } from './helpers';

function uniformAttrs(v: number): Attributes {
  return {
    pace: v, strength: v, stamina: v, passing: v, shooting: v,
    dribbling: v, defending: v, goalkeeping: v, vision: v, composure: v, workRate: v,
  };
}

describe('isAvailable', () => {
  it('is true when not injured and not suspended', () => {
    expect(isAvailable(makePlayer({ injuryDays: 0, suspendedMatches: 0 }))).toBe(true);
  });

  it('is false when injured', () => {
    expect(isAvailable(makePlayer({ injuryDays: 3, suspendedMatches: 0 }))).toBe(false);
  });

  it('is false when suspended', () => {
    expect(isAvailable(makePlayer({ injuryDays: 0, suspendedMatches: 1 }))).toBe(false);
  });

  it('is false when both injured and suspended', () => {
    expect(isAvailable(makePlayer({ injuryDays: 5, suspendedMatches: 2 }))).toBe(false);
  });
});

describe('pickBestLineup', () => {
  const formation: FormationId = '4-4-2';
  const slots = FORMATIONS[formation]; // ['GK','LB','CB','CB','RB','LM','CM','CM','RM','ST','ST']

  it('first pass: fills every slot with the player whose natural position matches it exactly', () => {
    const players = [
      makePlayer({ id: 1, position: 'GK' }),
      makePlayer({ id: 2, position: 'LB' }),
      makePlayer({ id: 3, position: 'CB' }),
      makePlayer({ id: 4, position: 'CB' }),
      makePlayer({ id: 5, position: 'RB' }),
      makePlayer({ id: 6, position: 'LM' }),
      makePlayer({ id: 7, position: 'CM' }),
      makePlayer({ id: 8, position: 'CM' }),
      makePlayer({ id: 9, position: 'RM' }),
      makePlayer({ id: 10, position: 'ST' }),
      makePlayer({ id: 11, position: 'ST' }),
    ];
    const byId = new Map(players.map((p) => [p.id, p]));

    const { starters, bench } = pickBestLineup(players, formation);

    expect(starters).toHaveLength(slots.length);
    starters.forEach((pid, i) => {
      expect(pid).not.toBe(-1);
      expect(byId.get(pid)!.position).toBe(slots[i]);
    });
    expect(new Set(starters).size).toBe(slots.length); // every slot got a distinct player
    expect(bench).toHaveLength(0); // exactly 11 players, none left over
  });

  it('second pass: gap-fills a slot with an off-position player when no natural fit remains', () => {
    const players = [
      makePlayer({ id: 1, position: 'GK' }),
      makePlayer({ id: 2, position: 'LB' }),
      makePlayer({ id: 3, position: 'CB' }),
      makePlayer({ id: 4, position: 'CB' }),
      makePlayer({ id: 5, position: 'RB' }),
      makePlayer({ id: 6, position: 'LM' }),
      makePlayer({ id: 7, position: 'CM' }),
      makePlayer({ id: 8, position: 'CM' }),
      // deliberately no natural 'RM' player
      makePlayer({ id: 10, position: 'ST' }),
      makePlayer({ id: 11, position: 'ST' }),
      makePlayer({ id: 99, position: 'LW' }), // only remaining candidate for the RM slot
    ];
    const rmSlotIndex = slots.indexOf('RM');

    const { starters } = pickBestLineup(players, formation);

    expect(starters[rmSlotIndex]).not.toBe(-1);
    expect(starters[rmSlotIndex]).toBe(99);
  });

  it('never selects injured or suspended players as starters or bench', () => {
    const healthyStarters = [
      makePlayer({ id: 1, position: 'GK' }),
      makePlayer({ id: 2, position: 'LB' }),
      makePlayer({ id: 3, position: 'CB' }),
      makePlayer({ id: 4, position: 'CB' }),
      makePlayer({ id: 5, position: 'RB' }),
      makePlayer({ id: 6, position: 'LM' }),
      makePlayer({ id: 7, position: 'CM' }),
      makePlayer({ id: 8, position: 'CM' }),
      makePlayer({ id: 9, position: 'RM' }),
      makePlayer({ id: 10, position: 'ST' }),
      makePlayer({ id: 11, position: 'ST' }),
    ];
    const healthyExtras = [
      makePlayer({ id: 12, position: 'CM' }),
      makePlayer({ id: 13, position: 'CB' }),
      makePlayer({ id: 14, position: 'ST' }),
    ];
    const unavailable = [
      makePlayer({ id: 15, position: 'CM', injuryDays: 5 }),
      makePlayer({ id: 16, position: 'CB', suspendedMatches: 2 }),
    ];
    const players = [...healthyStarters, ...healthyExtras, ...unavailable];

    const { starters, bench } = pickBestLineup(players, formation);

    expect(starters).not.toContain(15);
    expect(starters).not.toContain(16);
    expect(bench).not.toContain(15);
    expect(bench).not.toContain(16);
    expect(bench.length).toBeLessThanOrEqual(7);
  });

  it('caps the bench at 7 and puts a backup GK in the bench first when one is available', () => {
    const players = [
      makePlayer({ id: 1, position: 'GK', attributes: { goalkeeping: 85 } }), // strong starting keeper
      makePlayer({ id: 2, position: 'LB' }),
      makePlayer({ id: 3, position: 'CB' }),
      makePlayer({ id: 4, position: 'CB' }),
      makePlayer({ id: 5, position: 'RB' }),
      makePlayer({ id: 6, position: 'LM' }),
      makePlayer({ id: 7, position: 'CM' }),
      makePlayer({ id: 8, position: 'CM' }),
      makePlayer({ id: 9, position: 'RM' }),
      makePlayer({ id: 10, position: 'ST' }),
      makePlayer({ id: 11, position: 'ST' }),
      makePlayer({ id: 50, position: 'GK', attributes: { goalkeeping: 40 } }), // weaker backup keeper
      makePlayer({ id: 51, position: 'CM' }),
      makePlayer({ id: 52, position: 'CM' }),
      makePlayer({ id: 53, position: 'CM' }),
      makePlayer({ id: 54, position: 'CM' }),
      makePlayer({ id: 55, position: 'CM' }),
      makePlayer({ id: 56, position: 'CM' }),
      makePlayer({ id: 57, position: 'CM' }),
      makePlayer({ id: 58, position: 'CM' }),
    ];

    const { starters, bench } = pickBestLineup(players, formation);

    expect(starters[0]).toBe(1); // the stronger keeper starts, not the backup
    expect(bench).toHaveLength(7);
    expect(bench[0]).toBe(50); // backup GK slotted in first per the "backup GK first" behavior
  });
});

describe('positionCounts', () => {
  it('buckets players into GK/DF/MF/FW groups', () => {
    const players = [
      makePlayer({ position: 'GK' }),
      makePlayer({ position: 'GK' }),
      makePlayer({ position: 'CB' }),
      makePlayer({ position: 'LB' }),
      makePlayer({ position: 'RB' }),
      makePlayer({ position: 'CM' }),
      makePlayer({ position: 'DM' }),
      makePlayer({ position: 'AM' }),
      makePlayer({ position: 'ST' }),
    ];
    expect(positionCounts(players)).toEqual({ GK: 2, DF: 3, MF: 3, FW: 1 });
  });
});

describe('squadStrength', () => {
  it('equals the plain average of overall() when the squad has fewer than 16 players', () => {
    const values = [50, 52, 54, 56, 58, 60, 62, 64, 66, 68];
    const players = values.map((v) => makePlayer({ position: 'CM', attributes: uniformAttrs(v) }));
    const expected = values.reduce((a, b) => a + b, 0) / values.length;
    expect(squadStrength(players)).toBeCloseTo(expected, 5);
  });

  it('only counts the top 16 by overall, unaffected by additional weaker players', () => {
    const topValues = Array.from({ length: 16 }, (_, i) => 70 + i); // 70..85, all distinct
    const topPlayers = topValues.map((v) => makePlayer({ position: 'CM', attributes: uniformAttrs(v) }));
    const expected = topValues.reduce((a, b) => a + b, 0) / 16;
    const baseline = squadStrength(topPlayers);
    expect(baseline).toBeCloseTo(expected, 5);

    const weakerExtras = Array.from({ length: 5 }, () => makePlayer({ position: 'CM', attributes: uniformAttrs(30) }));
    const withExtras = squadStrength([...topPlayers, ...weakerExtras]);
    expect(withExtras).toBeCloseTo(baseline, 5);
  });
});

describe('totalWages', () => {
  it('sums contract.wage across all players', () => {
    const players = [
      makePlayer({ contract: { wage: 1000, expiresDay: 100 } }),
      makePlayer({ contract: { wage: 2500, expiresDay: 200 } }),
      makePlayer({ contract: { wage: 750, expiresDay: 50 } }),
    ];
    expect(totalWages(players)).toBe(1000 + 2500 + 750);
  });
});
