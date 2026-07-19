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

  it('upgrades a schema-v2 save: seeds balance/ledger and leaves positions untouched', () => {
    // Positions are already detailed here (as a real v2 save would have them).
    // This is the corruption trap: if migrateState re-ran the v1->v2 position
    // pass on a v2 save, these detailed positions would look like unknown
    // groups and get reassigned to MF-cycle positions.
    const lowRepPlayer = makePlayer({ id: 30, position: 'CB' });
    const highRepPlayer = makePlayer({ id: 31, position: 'ST' });

    const state = {
      schemaVersion: 2,
      clubs: {
        1: { id: 1, reputation: 20, tactics: { formation: '4-4-2' }, lineup: { starters: [], bench: [] } },
        2: { id: 2, reputation: 80, tactics: { formation: '4-4-2' }, lineup: { starters: [], bench: [] } },
      },
      players: {
        [lowRepPlayer.id]: lowRepPlayer,
        [highRepPlayer.id]: highRepPlayer,
      },
    } as unknown as GameState;

    migrateState(state);

    // Positions are untouched by the v2->v3 step.
    expect(state.players[lowRepPlayer.id].position).toBe('CB');
    expect(state.players[highRepPlayer.id].position).toBe('ST');

    // Every club gains a balance scaling with reputation, and a zeroed ledger.
    const lowRepClub = state.clubs[1];
    const highRepClub = state.clubs[2];
    expect(lowRepClub.balance).toBeGreaterThan(0);
    expect(highRepClub.balance).toBeGreaterThan(lowRepClub.balance);
    expect(lowRepClub.ledger).toEqual({
      gate: 0, tv: 0, prize: 0, commercial: 0, playerSales: 0,
      wages: 0, transferFees: 0, operations: 0, bonuses: 0,
    });

    expect(state.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('upgrades a schema-v1 save through both steps: positions detailed AND finances present', () => {
    const formation = '4-4-2' as const;
    const player = makePlayer({ id: 40, position: 'FW' as unknown as Position });

    const state = {
      schemaVersion: 1,
      clubs: {
        1: {
          id: 1,
          reputation: 50,
          tactics: { formation, mentality: 'balanced', pressing: 'medium', tempo: 'normal' },
          lineup: { starters: new Array(11).fill(-1), bench: [] },
        },
      },
      players: { [player.id]: player },
    } as unknown as GameState;

    migrateState(state);

    // Position migration ran: coarse 'FW' became a detailed forward role.
    expect(['ST', 'LW', 'RW']).toContain(state.players[player.id].position);
    // Finance migration ran too: balance/ledger are present.
    expect(state.clubs[1].balance).toBeGreaterThan(0);
    expect(state.clubs[1].ledger.gate).toBe(0);
    expect(state.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('is a no-op on a current-version save: balance/ledger/financeHistory left untouched', () => {
    const state = makeState(2);
    const club = state.clubs[state.userClubId];
    club.financeHistory = [{ day: 10, balance: club.balance, income: 500, expense: -200 }];
    const before = { balance: club.balance, ledger: { ...club.ledger }, financeHistory: [...club.financeHistory] };

    migrateState(state);

    expect(club.balance).toBe(before.balance);
    expect(club.ledger).toEqual(before.ledger);
    expect(club.financeHistory).toEqual(before.financeHistory);
  });

  it('upgrades a schema-v3 save: seeds an empty financeHistory and leaves balance/ledger untouched', () => {
    const state = {
      schemaVersion: 3,
      clubs: {
        1: { id: 1, reputation: 60, balance: 5_000_000, ledger: { gate: 1000, tv: 2000, prize: 0, commercial: 0, playerSales: 0, wages: -500, transferFees: 0, operations: 0 } },
      },
      players: {},
    } as unknown as GameState;

    migrateState(state);

    expect(state.schemaVersion).toBe(SCHEMA_VERSION);
    expect(state.clubs[1].financeHistory).toEqual([]);
    // v2->v3 fields untouched by the v3->v4 step.
    expect(state.clubs[1].balance).toBe(5_000_000);
    expect(state.clubs[1].ledger.gate).toBe(1000);
  });

  it('is a no-op for the financeHistory step on a schema-v2 save (financeHistory seeded once, via the v3 step chain)', () => {
    // A v2 save runs both migrateV2toV3 AND migrateV3toV4 in the same call
    // (stepwise, in order) — financeHistory should end up seeded exactly once.
    const lowRepPlayer = makePlayer({ id: 50, position: 'CB' });
    const state = {
      schemaVersion: 2,
      clubs: {
        1: { id: 1, reputation: 45, tactics: { formation: '4-4-2' }, lineup: { starters: [], bench: [] } },
      },
      players: { [lowRepPlayer.id]: lowRepPlayer },
    } as unknown as GameState;

    migrateState(state);

    expect(state.clubs[1].financeHistory).toEqual([]);
    expect(state.clubs[1].balance).toBeGreaterThan(0);
    expect(state.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('upgrades a schema-v4 save: re-derives allocations for a club born over its wage cap', () => {
    const p1 = makePlayer({ id: 60, clubId: 1, contract: { wage: 900_000, expiresDay: 999 } });
    const p2 = makePlayer({ id: 61, clubId: 1, contract: { wage: 700_000, expiresDay: 999 } });
    const state = {
      schemaVersion: 4,
      leagues: [{ id: 0, tier: 1, clubIds: [1] }],
      clubs: {
        // The user-reported state: £1.6M/wk bill against a £923k cap.
        1: { id: 1, leagueId: 0, reputation: 88, balance: 50_000_000, budget: 43_000_000, wageBudget: 923_000 },
      },
      players: { 60: p1, 61: p2 },
    } as unknown as GameState;

    migrateState(state);

    // Repaired through the board envelope: the cap now covers the real bill,
    // and the transfer budget is coverable by the balance.
    expect(state.clubs[1].wageBudget).toBeGreaterThanOrEqual(1_600_000);
    expect(state.clubs[1].budget).toBeLessThanOrEqual(state.clubs[1].balance);
    expect(state.schemaVersion).toBe(SCHEMA_VERSION);
  });

  it('leaves a healthy schema-v4 club\'s allocations untouched', () => {
    const p = makePlayer({ id: 62, clubId: 1, contract: { wage: 100_000, expiresDay: 999 } });
    const state = {
      schemaVersion: 4,
      leagues: [{ id: 0, tier: 1, clubIds: [1] }],
      clubs: {
        1: { id: 1, leagueId: 0, reputation: 50, balance: 8_000_000, budget: 5_000_000, wageBudget: 200_000 },
      },
      players: { 62: p },
    } as unknown as GameState;

    migrateState(state);

    expect(state.clubs[1].budget).toBe(5_000_000);
    expect(state.clubs[1].wageBudget).toBe(200_000);
    expect(state.schemaVersion).toBe(SCHEMA_VERSION);
  });
});
