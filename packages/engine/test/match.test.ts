import { describe, it, expect } from 'vitest';
import type { Fixture, LiveMatch, MatchSide, MatchPlayerState } from '../src/types';
import { createLiveMatch, simulateFullMatch, finishMatch } from '../src/match';
import { FORMATIONS } from '../src/tactics';
import { currentSeasonStats } from '../src/player';
import { clubPlayers } from '../src/squad';
import { makeState } from './helpers';

// Guardrail suite over the existing match simulator. We assert invariants and
// same-seed reproducibility, never specific stochastic scorelines.

function firstUnplayed(state: ReturnType<typeof makeState>): Fixture {
  const f = state.fixtures.find((fx) => !fx.played);
  if (!f) throw new Error('no unplayed fixture in generated world');
  return f;
}

describe('createLiveMatch', () => {
  it('sets up a fresh, consistent live match from a real fixture', () => {
    const state = makeState(11);
    const fixture = firstUnplayed(state);
    const match = createLiveMatch(state, fixture);

    expect(match.finished).toBe(false);

    // Exactly one kickoff event, and it's the first one.
    expect(match.events[0].type).toBe('kickoff');
    expect(match.events.filter((e) => e.type === 'kickoff')).toHaveLength(1);

    // buildSide refreshes AI lineups (and mutates club.lineup), so read the
    // lineup AFTER createLiveMatch. A pid < 0 starter slot is skipped
    // ("team plays short-handed"), so expected = real starters + bench.
    for (const [side, clubId] of [
      [match.home, fixture.homeClubId],
      [match.away, fixture.awayClubId],
    ] as const) {
      const lineup = state.clubs[clubId].lineup;
      const expected =
        lineup.starters.filter((id) => id >= 0).length + lineup.bench.length;
      expect(side.players).toHaveLength(expected);
    }

    // On-pitch players hold a real slot; bench players are slot -1. (This strict
    // pairing only holds at kickoff, before any cards/injuries move players off.)
    for (const side of [match.home, match.away]) {
      for (const mp of side.players) {
        if (mp.onPitch) expect(mp.slot).toBeGreaterThanOrEqual(0);
        else expect(mp.slot).toBe(-1);
      }
    }
  });
});

describe('simulateFullMatch invariants', () => {
  it('holds all invariants across several real fixtures', () => {
    const state = makeState(7);
    const fixtures = state.fixtures.filter((f) => !f.played).slice(0, 5);
    expect(fixtures.length).toBe(5);

    for (const fixture of fixtures) {
      const league = state.leagues.find((l) => l.id === fixture.leagueId)!;
      const homeEntry = league.table.find((e) => e.clubId === fixture.homeClubId)!;
      const awayEntry = league.table.find((e) => e.clubId === fixture.awayClubId)!;
      // Clubs recur across fixtures, so snapshot immediately before each sim.
      const homePlayedBefore = homeEntry.played;
      const awayPlayedBefore = awayEntry.played;
      const homePointsBefore = homeEntry.points;
      const awayPointsBefore = awayEntry.points;

      const match = simulateFullMatch(state, fixture);

      expect(match.finished).toBe(true);
      // Full time = minute >= 90 + 3 (or +4 with a goal after minute 80).
      expect(match.minute).toBeGreaterThanOrEqual(90);
      expect(match.minute).toBeLessThanOrEqual(94);

      for (const g of [match.home.goals, match.away.goals]) {
        expect(Number.isInteger(g)).toBe(true);
        expect(g).toBeGreaterThanOrEqual(0);
      }

      // Every on-target attempt is also a shot.
      expect(match.home.onTarget).toBeLessThanOrEqual(match.home.shots);
      expect(match.away.onTarget).toBeLessThanOrEqual(match.away.shots);

      for (const side of [match.home, match.away]) {
        const slotCount = FORMATIONS[side.tactics.formation].length;
        for (const mp of side.players) {
          expect(mp.rating).toBeGreaterThanOrEqual(1);
          expect(mp.rating).toBeLessThanOrEqual(10);
          if (mp.sentOff) expect(mp.onPitch).toBe(false);
          // Loose form only: a sent-off / injured-not-subbed player is off the
          // pitch but keeps his slot index, so we can't require bench => -1 here.
          expect(mp.slot === -1 || (mp.slot >= 0 && mp.slot < slotCount)).toBe(true);
        }
        expect(side.subsUsed).toBeLessThanOrEqual(5); // MAX_SUBS
      }

      // Fixture object mutated to match the result.
      expect(fixture.played).toBe(true);
      expect(fixture.homeGoals).toBe(match.home.goals);
      expect(fixture.awayGoals).toBe(match.away.goals);

      // League table updated consistently for this fixture.
      expect(homeEntry.played).toBe(homePlayedBefore + 1);
      expect(awayEntry.played).toBe(awayPlayedBefore + 1);
      const hg = match.home.goals;
      const ag = match.away.goals;
      const homePts = hg > ag ? 3 : hg === ag ? 1 : 0;
      const awayPts = ag > hg ? 3 : ag === hg ? 1 : 0;
      expect(homeEntry.points).toBe(homePointsBefore + homePts);
      expect(awayEntry.points).toBe(awayPointsBefore + awayPts);
    }
  });
});

describe('simulateFullMatch determinism', () => {
  it('same seed reproduces the same result', () => {
    const seed = 42;
    const stateA = makeState(seed);
    const stateB = makeState(seed);

    const fA = firstUnplayed(stateA);
    const fB = stateB.fixtures.find(
      (f) =>
        f.round === fA.round &&
        f.homeClubId === fA.homeClubId &&
        f.awayClubId === fA.awayClubId,
    )!;
    // Deterministic generation => matching fixture ids => matching match.seed.
    expect(fB.id).toBe(fA.id);

    const mA = simulateFullMatch(stateA, fA);
    const mB = simulateFullMatch(stateB, fB);

    expect(mA.home.goals).toBe(mB.home.goals);
    expect(mA.away.goals).toBe(mB.away.goals);
    expect(mA.events.length).toBe(mB.events.length);
  });
});

describe('finishMatch bookkeeping', () => {
  it('applies exact stat/form/injury/suspension bookkeeping', () => {
    const state = makeState(3);
    const fixture = firstUnplayed(state);
    const homeClubId = fixture.homeClubId;
    const awayClubId = fixture.awayClubId;

    const homeSquad = clubPlayers(state, homeClubId);
    const awaySquad = clubPlayers(state, awayClubId);
    expect(homeSquad.length).toBeGreaterThanOrEqual(4);
    expect(awaySquad.length).toBeGreaterThanOrEqual(1);

    // Four home-club players with hand-set match outcomes.
    const pScorer = homeSquad[0]; // goals + assists
    const pBooked = homeSquad[1]; // yellow
    const pRed = homeSquad[2]; // sent off
    const pInjured = homeSquad[3]; // injured
    const scorerRating = 7.46; // 2-decimal to exercise recordFormRating rounding

    // A "played" player needs fatigue>0 || onPitch || sentOff. injured/yellow are
    // NOT in that predicate, so mark those players played explicitly.
    const mk = (o: Partial<MatchPlayerState> & { playerId: number }): MatchPlayerState => ({
      rating: 6.3, goals: 0, assists: 0, yellow: false, sentOff: false,
      injured: false, fatigue: 0, onPitch: false, slot: -1, ...o,
    });

    const home: MatchSide = {
      clubId: homeClubId,
      tactics: { ...state.clubs[homeClubId].tactics },
      players: [
        mk({ playerId: pScorer.id, goals: 2, assists: 1, onPitch: true, rating: scorerRating, slot: 9 }),
        mk({ playerId: pBooked.id, yellow: true, onPitch: true, rating: 6.0, slot: 5 }),
        mk({ playerId: pRed.id, sentOff: true, onPitch: false, rating: 5.0, slot: 3 }),
        mk({ playerId: pInjured.id, injured: true, onPitch: true, rating: 6.5, slot: 2 }),
      ],
      subsUsed: 0, goals: 2, shots: 5, onTarget: 3, possessionTicks: 30,
    };
    const away: MatchSide = {
      clubId: awayClubId,
      tactics: { ...state.clubs[awayClubId].tactics },
      // A single not-played away player keeps the side well-formed.
      players: [mk({ playerId: awaySquad[0].id, onPitch: false, fatigue: 0 })],
      subsUsed: 0, goals: 0, shots: 0, onTarget: 0, possessionTicks: 30,
    };

    const match: LiveMatch = {
      fixtureId: fixture.id,
      minute: 90,
      home,
      away,
      events: [],
      finished: true,
      seed: 12345,
    };

    // Baseline season-stat values (currentSeasonStats creates the entry lazily).
    const base = (pid: number) => {
      const p = state.players[pid];
      const s = currentSeasonStats(p, state);
      return { apps: s.apps, goals: s.goals, assists: s.assists, yellows: s.yellows, reds: s.reds };
    };
    const scorerBase = base(pScorer.id);
    const bookedBase = base(pBooked.id);
    const redBase = base(pRed.id);
    const scorerFormLen = state.players[pScorer.id].form.length;

    finishMatch(state, match);

    // Scorer: apps +1, goals +2, assists +1.
    const scorerStats = currentSeasonStats(state.players[pScorer.id], state);
    expect(scorerStats.apps).toBe(scorerBase.apps + 1);
    expect(scorerStats.goals).toBe(scorerBase.goals + 2);
    expect(scorerStats.assists).toBe(scorerBase.assists + 1);

    // Booked: yellows +1.
    const bookedStats = currentSeasonStats(state.players[pBooked.id], state);
    expect(bookedStats.yellows).toBe(bookedBase.yellows + 1);

    // Sent off: reds +1 and a 2-match suspension.
    const redStats = currentSeasonStats(state.players[pRed.id], state);
    expect(redStats.reds).toBe(redBase.reds + 1);
    expect(state.players[pRed.id].suspendedMatches).toBe(2);

    // recordFormRating: one new entry equal to rating rounded to 1 decimal.
    const scorerForm = state.players[pScorer.id].form;
    expect(scorerForm.length).toBe(scorerFormLen + 1);
    expect(scorerForm[scorerForm.length - 1]).toBe(Math.round(scorerRating * 10) / 10);

    // Injured player: injuryDays in [4, 35] and a named injury.
    const injured = state.players[pInjured.id];
    expect(injured.injuryDays).toBeGreaterThanOrEqual(4);
    expect(injured.injuryDays).toBeLessThanOrEqual(35);
    expect(injured.injuryName).not.toBeNull();

    // Fixture flagged played.
    expect(fixture.played).toBe(true);
  });
});
