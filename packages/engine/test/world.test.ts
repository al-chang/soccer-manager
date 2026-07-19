import { describe, expect, it } from 'vitest';
import { generateWorld, assignSquadNumbers } from '../src/world';
import { makeState } from './helpers';

describe('generateWorld', () => {
  const state = generateWorld(12345, 2025, 'test-world');

  it('creates exactly 4 leagues, each with exactly 16 clubs', () => {
    expect(state.leagues).toHaveLength(4);
    for (const league of state.leagues) {
      expect(league.clubIds).toHaveLength(16);
    }
  });

  it('creates 64 distinct clubs total across all leagues', () => {
    expect(Object.keys(state.clubs).length).toBe(64);
  });

  it('gives every club a 22-player squad (matches SQUAD_TEMPLATE totals)', () => {
    for (const clubId of Object.keys(state.clubs).map(Number)) {
      const squad = Object.values(state.players).filter((p) => p.clubId === clubId);
      expect(squad).toHaveLength(22);
    }
  });

  it('creates exactly 40 free agents', () => {
    const freeAgents = Object.values(state.players).filter((p) => p.clubId === -1);
    expect(freeAgents).toHaveLength(40);
  });

  it('gives every club a positive balance and a zeroed season ledger', () => {
    for (const club of Object.values(state.clubs)) {
      expect(club.balance).toBeGreaterThan(0);
      expect(club.ledger).toEqual({
        gate: 0, tv: 0, prize: 0, commercial: 0, playerSales: 0,
        wages: 0, transferFees: 0, operations: 0, bonuses: 0,
      });
    }
  });

  it('board allocations are coherent: wage cap covers the real bill, budget within balance', () => {
    // Regression: caps were once seeded from a reputation curve that ignored
    // the actual squad, leaving strong clubs born over their own wage cap.
    for (const club of Object.values(state.clubs)) {
      const bill = Object.values(state.players)
        .filter((p) => p.clubId === club.id)
        .reduce((s, p) => s + p.contract.wage, 0);
      expect(club.wageBudget).toBeGreaterThanOrEqual(bill);
      expect(club.budget).toBeGreaterThanOrEqual(0);
      expect(club.budget).toBeLessThanOrEqual(club.balance);
    }
  });

  it('balances roughly track reputation: higher-rep leagues average a bigger balance', () => {
    // Compare tier-1 (higher reputation baseline) vs tier-2 leagues per nation.
    const avgBalance = (leagueId: number) => {
      const league = state.leagues.find((l) => l.id === leagueId)!;
      const balances = league.clubIds.map((id) => state.clubs[id].balance);
      return balances.reduce((a, b) => a + b, 0) / balances.length;
    };
    const premier = state.leagues.find((l) => l.tier === 1 && l.nationId === 0)!;
    const championship = state.leagues.find((l) => l.tier === 2 && l.nationId === 0)!;
    expect(avgBalance(premier.id)).toBeGreaterThan(avgBalance(championship.id));
  });

  it('produces a non-empty fixture list where every fixture belongs to its league', () => {
    expect(state.fixtures.length).toBeGreaterThan(0);
    const leagueById = new Map(state.leagues.map((l) => [l.id, l]));
    for (const fx of state.fixtures) {
      const league = leagueById.get(fx.leagueId)!;
      expect(league.clubIds).toContain(fx.homeClubId);
      expect(league.clubIds).toContain(fx.awayClubId);
    }
  });

  it('is a full double round-robin for a league: every pair meets exactly twice (home and away)', () => {
    const league = state.leagues[0];
    const leagueFixtures = state.fixtures.filter((f) => f.leagueId === league.id);
    // 16 clubs -> 30 fixtures/club -> 240 fixtures total for the league.
    expect(leagueFixtures).toHaveLength(240);

    const meetings = new Map<string, number>();
    for (const fx of leagueFixtures) {
      const key = `${fx.homeClubId}->${fx.awayClubId}`;
      meetings.set(key, (meetings.get(key) ?? 0) + 1);
    }
    for (const a of league.clubIds) {
      for (const b of league.clubIds) {
        if (a === b) continue;
        expect(meetings.get(`${a}->${b}`)).toBe(1);
      }
    }
  });
});

describe('generateWorld determinism', () => {
  it('produces a deep-equal state for the same seed/startYear/name', () => {
    const a = generateWorld(777, 2030, 'same-seed');
    const b = generateWorld(777, 2030, 'same-seed');
    expect(a).toEqual(b);
  });

  it('produces a different state for a different seed', () => {
    const a = generateWorld(1, 2030, 'same-name');
    const b = generateWorld(2, 2030, 'same-name');
    expect(a).not.toEqual(b);
  });
});

describe('assignSquadNumbers', () => {
  it('gives every player in the club a unique, positive squad number', () => {
    const state = makeState(3);
    const clubId = state.userClubId;
    // Simulate a club whose numbers haven't been assigned yet.
    for (const p of Object.values(state.players)) {
      if (p.clubId === clubId) p.squadNumber = 0;
    }

    assignSquadNumbers(state, clubId);

    const squad = Object.values(state.players).filter((p) => p.clubId === clubId);
    const numbers = squad.map((p) => p.squadNumber);
    expect(numbers.every((n) => n > 0)).toBe(true);
    expect(new Set(numbers).size).toBe(numbers.length);
  });
});
