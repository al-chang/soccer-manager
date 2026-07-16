import { describe, expect, it } from 'vitest';
import { migrateState } from '../src/migrate';
import { FORMATIONS } from '../src/tactics';
import type { GameState, Position } from '../src/types';
import { SCHEMA_VERSION } from '../src/types';
import { makePlayer, makeState } from './helpers';

describe('migrateState', () => {
  it('is a no-op when the state is already at the current schema version', () => {
    const state = makeState(1);
    expect(state.schemaVersion).toBe(SCHEMA_VERSION);
    const positionsBefore = Object.fromEntries(Object.values(state.players).map((p) => [p.id, p.position]));

    const result = migrateState(state);

    expect(result).toBe(state); // same object, returned unchanged
    const positionsAfter = Object.fromEntries(Object.values(state.players).map((p) => [p.id, p.position]));
    expect(positionsAfter).toEqual(positionsBefore);
  });

  it('upgrades a schema-v1 save: starters inherit the detailed slot position, others round-robin', () => {
    const formation = '4-4-2' as const;
    const slots = FORMATIONS[formation]; // ['GK','LB','CB','CB','RB','LM','CM','CM','RM','ST','ST']
    const cbSlotIndex = slots.indexOf('CB'); // index 2

    // Minimal hand-crafted schema-v1 state: coarse group strings stashed
    // directly in the `position` field, mimicking a pre-migration save.
    const starterDf = makePlayer({ id: 7, position: 'DF' as unknown as Position });
    const nonStarterMf1 = makePlayer({ id: 20, position: 'MF' as unknown as Position });
    const nonStarterMf2 = makePlayer({ id: 21, position: 'MF' as unknown as Position });
    const nonStarterMf3 = makePlayer({ id: 22, position: 'MF' as unknown as Position });

    const starters: number[] = new Array(slots.length).fill(-1);
    starters[cbSlotIndex] = starterDf.id;

    const state = {
      schemaVersion: 1,
      clubs: {
        1: {
          id: 1,
          tactics: { formation, mentality: 'balanced', pressing: 'medium', tempo: 'normal' },
          lineup: { starters, bench: [] },
        },
      },
      players: {
        [starterDf.id]: starterDf,
        [nonStarterMf1.id]: nonStarterMf1,
        [nonStarterMf2.id]: nonStarterMf2,
        [nonStarterMf3.id]: nonStarterMf3,
      },
    } as unknown as GameState;

    migrateState(state);

    // (a) The starter's coarse 'DF' position becomes the exact detailed slot position.
    expect(state.players[starterDf.id].position).toBe('CB');
    // (b) Schema version bumped to current.
    expect(state.schemaVersion).toBe(SCHEMA_VERSION);
    // (c) Non-starters in the same group round-robin through ROUND_ROBIN.MF
    // (['CM','DM','AM','LM','RM']) deterministically by ascending id, rather
    // than being left as the coarse 'MF' string.
    expect(state.players[nonStarterMf1.id].position).toBe('CM');
    expect(state.players[nonStarterMf2.id].position).toBe('DM');
    expect(state.players[nonStarterMf3.id].position).toBe('AM');
  });
});
