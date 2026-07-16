import { describe, expect, it } from 'vitest';
import {
  FORMATIONS,
  MENTALITIES,
  POSITIONS,
  familiarity,
  positionGroup,
  tacticsForStyle,
} from '../src/tactics';
import type { ManagerStyle, Position } from '../src/types';

describe('FORMATIONS', () => {
  it('every formation has exactly 11 slots with exactly one GK slot', () => {
    for (const [id, slots] of Object.entries(FORMATIONS)) {
      expect(slots, id).toHaveLength(11);
      const gkCount = slots.filter((s) => s === 'GK').length;
      expect(gkCount, id).toBe(1);
    }
  });
});

describe('positionGroup', () => {
  it('maps every Position to its documented group', () => {
    const expected: Record<Position, string> = {
      GK: 'GK',
      LB: 'DF', CB: 'DF', RB: 'DF',
      DM: 'MF', CM: 'MF', AM: 'MF', LM: 'MF', RM: 'MF',
      LW: 'FW', RW: 'FW', ST: 'FW',
    };
    for (const pos of POSITIONS) {
      expect(positionGroup(pos), pos).toBe(expected[pos]);
    }
  });
});

describe('familiarity', () => {
  it('is 1.0 for a player in their natural position, for every position', () => {
    for (const pos of POSITIONS) {
      expect(familiarity(pos, pos)).toBe(1.0);
    }
  });

  it('is symmetric for every pair of positions', () => {
    for (const a of POSITIONS) {
      for (const b of POSITIONS) {
        expect(familiarity(a, b), `${a}, ${b}`).toBe(familiarity(b, a));
      }
    }
  });

  it('is 0.5 between GK and any outfield position, in both directions', () => {
    for (const pos of POSITIONS) {
      if (pos === 'GK') continue;
      expect(familiarity('GK', pos), pos).toBe(0.5);
      expect(familiarity(pos, 'GK'), pos).toBe(0.5);
    }
  });

  it('resolves explicit documented pairs from FAMILIARITY_PAIRS', () => {
    expect(familiarity('LB', 'RB')).toBe(0.95);
    expect(familiarity('RB', 'LB')).toBe(0.95);
    expect(familiarity('CB', 'LB')).toBe(0.9);
    expect(familiarity('LB', 'CB')).toBe(0.9);
  });

  it('falls back to 0.85 for an unlisted same-group pair (AM/DM, both MF)', () => {
    expect(familiarity('AM', 'DM')).toBe(0.85);
    expect(familiarity('DM', 'AM')).toBe(0.85);
  });

  it('falls back to 0.8 for an unlisted cross-group outfield pair (LB/CM: DF vs MF)', () => {
    expect(familiarity('LB', 'CM')).toBe(0.8);
    expect(familiarity('CM', 'LB')).toBe(0.8);
  });
});

describe('MENTALITIES', () => {
  it('has 5 entries in the documented order', () => {
    expect(MENTALITIES).toEqual(['very-defensive', 'defensive', 'balanced', 'attacking', 'very-attacking']);
  });
});

describe('tacticsForStyle', () => {
  it('attacking style defaults to 4-3-3 / attacking / medium / fast', () => {
    expect(tacticsForStyle('attacking')).toEqual({
      formation: '4-3-3',
      mentality: 'attacking',
      pressing: 'medium',
      tempo: 'fast',
    });
  });

  it('defensive style defaults to 5-3-2 / defensive / low / slow', () => {
    expect(tacticsForStyle('defensive')).toEqual({
      formation: '5-3-2',
      mentality: 'defensive',
      pressing: 'low',
      tempo: 'slow',
    });
  });

  it('pressing style defaults to 4-2-3-1 / balanced / high / fast', () => {
    expect(tacticsForStyle('pressing')).toEqual({
      formation: '4-2-3-1',
      mentality: 'balanced',
      pressing: 'high',
      tempo: 'fast',
    });
  });

  it('counter style defaults to 4-5-1 / defensive / low / fast', () => {
    expect(tacticsForStyle('counter')).toEqual({
      formation: '4-5-1',
      mentality: 'defensive',
      pressing: 'low',
      tempo: 'fast',
    });
  });

  it('balanced style (default case) defaults to 4-4-2 / balanced / medium / normal', () => {
    expect(tacticsForStyle('balanced')).toEqual({
      formation: '4-4-2',
      mentality: 'balanced',
      pressing: 'medium',
      tempo: 'normal',
    });
  });

  it('respects an explicit formation override for every style', () => {
    const styles: ManagerStyle[] = ['attacking', 'defensive', 'pressing', 'counter', 'balanced'];
    for (const style of styles) {
      const t = tacticsForStyle(style, '3-5-2');
      expect(t.formation, style).toBe('3-5-2');
    }
  });
});
