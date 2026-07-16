import { describe, expect, it } from 'vitest';
import { sortedTable, leaguePosition, seasonFixturesDone, processSeasonEnd } from '../src/season';
import { createRng } from '../src/rng';
import { clubPlayers } from '../src/squad';
import type { League, LeagueEntry, TransferOffer } from '../src/types';
import { makeState } from './helpers';

// ---------------------------------------------------------------------------
// Test helpers for hand-built leagues (pure sortedTable / leaguePosition tests)
// ---------------------------------------------------------------------------

function mkEntry(
  clubId: number,
  points: number,
  goalsFor: number,
  goalsAgainst: number,
): LeagueEntry {
  return { clubId, played: 30, won: 0, drawn: 0, lost: 0, goalsFor, goalsAgainst, points };
}

/** Minimal League wrapping a hand-built table. clubIds mirror the table order. */
function mkLeague(table: LeagueEntry[]): League {
  return {
    id: 1,
    name: 'Test League',
    nationId: 0,
    tier: 1,
    clubIds: table.map((e) => e.clubId),
    table,
    reputation: 50,
    promotionSpots: 0,
    relegationSpots: 2,
  };
}

// ---------------------------------------------------------------------------
// 1. sortedTable — tiebreak chain: points > GD > goalsFor > clubId(asc)
// ---------------------------------------------------------------------------

describe('sortedTable', () => {
  it('orders by points descending first', () => {
    const league = mkLeague([
      mkEntry(1, 20, 40, 10),
      mkEntry(2, 30, 5, 5),
      mkEntry(3, 10, 90, 0),
    ]);
    expect(sortedTable(league).map((e) => e.clubId)).toEqual([2, 1, 3]);
  });

  it('breaks a points tie by goal difference (lower-priority keys point the other way)', () => {
    // Equal points. Winner has higher GD but the HIGHER clubId and equal goalsFor,
    // so neither goalsFor nor clubId can be silently doing the sorting.
    const winner = mkEntry(20, 6, 5, 0); // GD +5
    const loser = mkEntry(10, 6, 5, 3); // GD +2
    const league = mkLeague([loser, winner]);
    // clubId-asc alone would put 10 first; GD correctly puts 20 first.
    expect(sortedTable(league).map((e) => e.clubId)).toEqual([20, 10]);
  });

  it('breaks a points+GD tie by goalsFor (winner given the higher clubId as a trap)', () => {
    // Equal points AND equal GD (+5). Winner has more goalsFor but the higher clubId,
    // so clubId-asc cannot be masking the goalsFor comparison.
    const winner = mkEntry(20, 6, 30, 25); // GD +5, GF 30
    const loser = mkEntry(10, 6, 10, 5); // GD +5, GF 10
    const league = mkLeague([loser, winner]);
    expect(sortedTable(league).map((e) => e.clubId)).toEqual([20, 10]);
  });

  it('breaks a points+GD+goalsFor tie by clubId ascending', () => {
    // All three sort keys identical. clubId 7 placed FIRST in the input so a stable
    // sort would leave it first unless the clubId clause actually fires.
    const league = mkLeague([mkEntry(7, 6, 10, 5), mkEntry(3, 6, 10, 5)]);
    expect(sortedTable(league).map((e) => e.clubId)).toEqual([3, 7]);
  });

  it('does not mutate the input table', () => {
    const table = [mkEntry(1, 10, 5, 5), mkEntry(2, 20, 5, 5)];
    const league = mkLeague(table);
    sortedTable(league);
    expect(league.table.map((e) => e.clubId)).toEqual([1, 2]);
  });
});

// ---------------------------------------------------------------------------
// 2. leaguePosition — 1-based, with the -1+1=0 "not found" edge case
// ---------------------------------------------------------------------------

describe('leaguePosition', () => {
  const league = mkLeague([
    mkEntry(1, 30, 40, 10), // pos 1
    mkEntry(2, 20, 30, 20), // pos 2
    mkEntry(3, 10, 20, 30), // pos 3
  ]);

  it('returns the 1-based position of a club', () => {
    expect(leaguePosition(league, 1)).toBe(1);
    expect(leaguePosition(league, 2)).toBe(2);
    expect(leaguePosition(league, 3)).toBe(3);
  });

  it('returns 0 for a club not in the table (findIndex -1 + 1 = 0)', () => {
    expect(leaguePosition(league, 999)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 3. seasonFixturesDone
// ---------------------------------------------------------------------------

describe('seasonFixturesDone', () => {
  it('is false while fixtures remain unplayed and true once all are played', () => {
    const state = makeState(1);
    expect(state.fixtures.length).toBeGreaterThan(0);
    expect(seasonFixturesDone(state)).toBe(false);
    for (const f of state.fixtures) f.played = true;
    expect(seasonFixturesDone(state)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 4. processSeasonEnd — invariants + same-seed reproducibility (stochastic)
// ---------------------------------------------------------------------------

const WORLD_SEED = 42;
const ROLLOVER_SEED = 12345;

/**
 * Build a fresh pre-rollover state: mark every fixture played and prime every
 * league's table with a strict, unambiguous ranking. Points decrease with the
 * table-array index, so sortedTable order === clubIds order (position p club is
 * league.table[p-1].clubId). Deterministic given WORLD_SEED.
 */
function primedState(seed = WORLD_SEED) {
  const state = makeState(seed);
  for (const f of state.fixtures) f.played = true;
  for (const league of state.leagues) {
    league.table.forEach((entry, i) => {
      entry.played = 30;
      entry.won = league.table.length - i;
      entry.drawn = 0;
      entry.lost = i;
      entry.goalsFor = 60 - i;
      entry.goalsAgainst = 10 + i;
      entry.points = (league.table.length - i) * 3; // strictly decreasing, distinct
    });
  }
  return state;
}

describe('processSeasonEnd', () => {
  it('advances the season and enforces structural invariants', () => {
    const state = primedState();
    const seasonBefore = state.season;
    const leagueSizesBefore = state.leagues.map((l) => l.clubIds.length);
    const totalClubsBefore = Object.keys(state.clubs).length;

    // A nation's tier-1 + tier-2 total, for the conservation check.
    const nation0 = state.nations[0];
    const t1 = state.leagues.find((l) => l.nationId === nation0.id && l.tier === 1)!;
    const t2 = state.leagues.find((l) => l.nationId === nation0.id && l.tier === 2)!;
    const nationTotalBefore = t1.clubIds.length + t2.clubIds.length;

    processSeasonEnd(state, createRng(ROLLOVER_SEED));

    // season incremented by exactly 1
    expect(state.season).toBe(seasonBefore + 1);

    // each league keeps its size; promotion/relegation is a same-count swap
    state.leagues.forEach((l, i) => {
      expect(l.clubIds.length).toBe(leagueSizesBefore[i]);
    });
    expect(t1.clubIds.length + t2.clubIds.length).toBe(nationTotalBefore);
    // no clubs created/destroyed overall
    expect(Object.keys(state.clubs).length).toBe(totalClubsBefore);

    // every table reset to emptyTableEntry shape, one row per club
    for (const league of state.leagues) {
      expect(league.table.length).toBe(league.clubIds.length);
      for (const e of league.table) {
        expect(e.played).toBe(0);
        expect(e.won).toBe(0);
        expect(e.drawn).toBe(0);
        expect(e.lost).toBe(0);
        expect(e.goalsFor).toBe(0);
        expect(e.goalsAgainst).toBe(0);
        expect(e.points).toBe(0);
      }
    }

    // fixtures repopulated, all unplayed
    expect(state.fixtures.length).toBeGreaterThan(0);
    expect(state.fixtures.every((f) => f.played === false)).toBe(true);

    // phase reset (note: generateWorld already sets 'preseason', so this is a
    // weak assertion — kept because the task requires it).
    expect(state.phase).toBe('preseason');

    // world stays populated after retirements/regens
    expect(Object.keys(state.players).length).toBeGreaterThan(0);
    // sample a few clubs across both nations/tiers: each still fields a squad
    const sampleClubs = [
      state.leagues[0].clubIds[0],
      state.leagues[1].clubIds[0],
      state.leagues[2].clubIds[0],
      state.leagues[3].clubIds[5],
    ];
    for (const clubId of sampleClubs) {
      expect(clubPlayers(state, clubId).length).toBeGreaterThan(0);
    }
  });

  it('clears state.offers unconditionally after rollover', () => {
    const state = primedState();
    // A 'pending' offer WOULD survive the filter on line 177, but line 178
    // (`state.offers = []`) unconditionally throws it away — see BUG note below.
    state.offers = [
      {
        id: 1,
        playerId: 1,
        fromClubId: 1,
        toClubId: 2,
        fee: 1_000_000,
        status: 'pending',
        counterFee: null,
        day: 0,
        userInvolved: false,
        wageDemand: null,
        stage: 'fee',
      } as TransferOffer,
    ];
    processSeasonEnd(state, createRng(ROLLOVER_SEED));
    // BUG (documented, not fixed): season.ts:177 filters offers to keep
    // pending/countered, but season.ts:178 immediately reassigns `state.offers = []`,
    // discarding the filter result. The filter line is dead code.
    expect(state.offers).toEqual([]);
  });

  it('records relegation/promotion in club history and moves promoted clubs up a tier', () => {
    const state = primedState();
    const finishedSeason = state.season;

    const nation0 = state.nations[0];
    const t1 = state.leagues.find((l) => l.nationId === nation0.id && l.tier === 1)!;
    const t2 = state.leagues.find((l) => l.nationId === nation0.id && l.tier === 2)!;

    // Derived from primed tables (points decrease with index): position 16 in the
    // tier-1 table is the bottom club (pos > 16-2 => relegated); positions 1 & 2 in
    // the tier-2 table are promoted (pos <= promotionSpots=2).
    const bottomTier1Club = t1.table[t1.table.length - 1].clubId;
    const topTier2Club = t2.table[0].clubId;

    processSeasonEnd(state, createRng(ROLLOVER_SEED));

    // Relegated club: history entry for the finished season
    const relRec = state.clubs[bottomTier1Club].history.find((r) => r.season === finishedSeason);
    expect(relRec).toBeDefined();
    expect(relRec!.relegated).toBe(true);
    expect(relRec!.promoted).toBe(false);
    expect(state.clubs[bottomTier1Club].leagueId).toBe(t2.id); // moved down a tier

    // Promoted club: history flag + leagueId now points at the tier-1 league
    const proRec = state.clubs[topTier2Club].history.find((r) => r.season === finishedSeason);
    expect(proRec).toBeDefined();
    expect(proRec!.promoted).toBe(true);
    expect(proRec!.relegated).toBe(false);
    expect(state.clubs[topTier2Club].leagueId).toBe(t1.id);
  });

  it('is reproducible for the same world seed and rollover seed', () => {
    const a = primedState();
    const b = primedState();

    processSeasonEnd(a, createRng(ROLLOVER_SEED));
    processSeasonEnd(b, createRng(ROLLOVER_SEED));

    expect(a.season).toBe(b.season);
    expect(a.leagues.map((l) => l.clubIds)).toEqual(b.leagues.map((l) => l.clubIds));
    expect(Object.keys(a.players).length).toBe(Object.keys(b.players).length);
    // nextId is consumed for regen player ids during the run; it must also match.
    expect(a.nextId).toBe(b.nextId);
  });
});
