import { describe, expect, it } from 'vitest';
import { advanceDay, pendingUserOffers, nextUserFixture } from '../src/sim';
import { dayOfSeasonYear, dayToDate, YEAR_LENGTH } from '../src/calendar';
import { generateWorld } from '../src/world';
import { clubPlayers, totalWages } from '../src/squad';
import type { Fixture, TransferOffer } from '../src/types';
import { makeState } from './helpers';

// A full TransferOffer with sane defaults; only the fields the code under test
// reads (status / toClubId) usually matter, but we build complete objects.
function makeOffer(overrides: Partial<TransferOffer> = {}): TransferOffer {
  return {
    id: overrides.id ?? 1,
    playerId: overrides.playerId ?? 1,
    fromClubId: overrides.fromClubId ?? 999,
    toClubId: overrides.toClubId ?? 999,
    fee: 0,
    status: overrides.status ?? 'pending',
    counterFee: null,
    day: 0,
    userInvolved: false,
    wageDemand: null,
    stage: 'fee',
    ...overrides,
  };
}

// A minimal Fixture with overridable identity/day/participants.
function makeFixture(overrides: Partial<Fixture> = {}): Fixture {
  return {
    id: overrides.id ?? 1,
    leagueId: 0,
    round: 1,
    day: overrides.day ?? 100,
    homeClubId: overrides.homeClubId ?? 0,
    awayClubId: overrides.awayClubId ?? 0,
    played: overrides.played ?? false,
    homeGoals: 0,
    awayGoals: 0,
    ...overrides,
  };
}

// -------------------------------------------------------------------------
// 1. advanceDay increments the absolute day counter.
// -------------------------------------------------------------------------
describe('advanceDay — day counter', () => {
  it('increments state.day by one each call', () => {
    const state = makeState(1);
    expect(state.day).toBe(0);
    advanceDay(state);
    expect(state.day).toBe(1);
    advanceDay(state);
    expect(state.day).toBe(2);
  });
});

// -------------------------------------------------------------------------
// 2. Transfer window boundary news + deadline behavior.
//    advanceDay increments FIRST, then computes seasonDay off the new day,
//    so to land on absolute-day B we set state.day = B - 1.
//    We clear players + fixtures to isolate the window branch from AI
//    transfer news (which would displace news[0]) and from earlier unplayed
//    fixtures being swept in (which would clobber stopReason to 'Match day').
// -------------------------------------------------------------------------
describe('advanceDay — transfer window boundaries', () => {
  function runOnAbsoluteDay(targetDay: number, offers: TransferOffer[]) {
    const state = makeState(1);
    state.players = {};
    state.fixtures = [];
    state.offers = offers;
    state.day = targetDay - 1; // advanceDay bumps to targetDay
    const result = advanceDay(state);
    expect(state.day).toBe(targetDay);
    return { state, result };
  }

  it('season-day 0 (summer window open): stop + window news', () => {
    const targetDay = 0; // dayOfSeasonYear(0) === 0
    expect(dayOfSeasonYear(targetDay)).toBe(0);
    const { state, result } = runOnAbsoluteDay(targetDay, []);
    expect(result.stop).toBe(true);
    expect(result.stopReason).toBe('Transfer window open');
    expect(state.news[0].category).toBe('window');
    expect(state.news[0].title).toBe('Transfer window open');
  });

  it('season-day 184 (winter window open): stop + window news', () => {
    const targetDay = 184; // dayOfSeasonYear(184) === 184
    expect(dayOfSeasonYear(targetDay)).toBe(184);
    const { state, result } = runOnAbsoluteDay(targetDay, []);
    expect(result.stop).toBe(true);
    expect(result.stopReason).toBe('Transfer window open');
    expect(state.news[0].category).toBe('window');
  });

  it('season-day 62 (window closed): stop + withdraws unresolved offers', () => {
    const targetDay = 62; // dayOfSeasonYear(62) === 62, just past summer window
    expect(dayOfSeasonYear(targetDay)).toBe(62);
    const offers = [
      makeOffer({ id: 10, status: 'pending' }),
      makeOffer({ id: 11, status: 'countered' }),
      makeOffer({ id: 12, status: 'accepted' }), // control: should survive
    ];
    const { state, result } = runOnAbsoluteDay(targetDay, offers);
    expect(result.stop).toBe(true);
    expect(result.stopReason).toBe('Transfer window closed');
    expect(state.offers.find((o) => o.id === 10)!.status).toBe('withdrawn');
    expect(state.offers.find((o) => o.id === 11)!.status).toBe('withdrawn');
    expect(state.offers.find((o) => o.id === 12)!.status).toBe('accepted');
  });

  it('season-day 215 (window closed): stop + withdraws unresolved offers', () => {
    const targetDay = 215; // dayOfSeasonYear(215) === 215, just past winter window
    expect(dayOfSeasonYear(targetDay)).toBe(215);
    const offers = [
      makeOffer({ id: 20, status: 'pending' }),
      makeOffer({ id: 21, status: 'countered' }),
      makeOffer({ id: 22, status: 'accepted' }),
    ];
    const { state, result } = runOnAbsoluteDay(targetDay, offers);
    expect(result.stop).toBe(true);
    expect(result.stopReason).toBe('Transfer window closed');
    expect(state.offers.find((o) => o.id === 20)!.status).toBe('withdrawn');
    expect(state.offers.find((o) => o.id === 21)!.status).toBe('withdrawn');
    expect(state.offers.find((o) => o.id === 22)!.status).toBe('accepted');
  });
});

// -------------------------------------------------------------------------
// 3. Birthdays: a player ages on the day matching (state.day + 181) % 365,
//    computed off the NEW (post-increment) day.
// -------------------------------------------------------------------------
describe('advanceDay — birthdays', () => {
  it('ages exactly the players whose birthDayOfYear matches the day', () => {
    const state = makeState(1);
    // Starting day 0; the next advanceDay makes day = 1, dayOfYear = (1+181)%365.
    const targetDoy = (state.day + 1 + 181) % YEAR_LENGTH;
    expect(targetDoy).toBe(182);

    const players = Object.values(state.players);
    const birthdayPlayer = players[0];
    const otherPlayer = players[1];
    birthdayPlayer.birthDayOfYear = targetDoy;
    otherPlayer.birthDayOfYear = (targetDoy + 1) % YEAR_LENGTH; // guaranteed non-match

    const ageBefore = birthdayPlayer.age;
    const otherAgeBefore = otherPlayer.age;

    advanceDay(state);

    expect(birthdayPlayer.age).toBe(ageBefore + 1);
    expect(otherPlayer.age).toBe(otherAgeBefore);
  });
});

// -------------------------------------------------------------------------
// 4. Weekly development tick is gated on state.day % 7 === 0 (post-increment).
//    Indirectly verified: advancing a small consecutive range crosses at
//    least one multiple of 7 without throwing and keeps the counter correct.
// -------------------------------------------------------------------------
describe('advanceDay — weekly tick gate', () => {
  it('advances across a multiple of 7 without throwing', () => {
    const state = makeState(1);
    for (let i = 1; i <= 10; i++) {
      expect(() => advanceDay(state)).not.toThrow();
      expect(state.day).toBe(i); // passes through day 7 (a weekly tick)
    }
  });
});

// -------------------------------------------------------------------------
// 5. Match day: the user's fixture is surfaced (stop) but NOT auto-simulated;
//    other clubs' fixtures on the same day ARE simulated.
// -------------------------------------------------------------------------
describe('advanceDay — match day', () => {
  it('surfaces the user fixture unplayed and sims other fixtures that day', () => {
    const state = makeState(1);
    const userFx = state.fixtures
      .filter((f) => !f.played && (f.homeClubId === state.userClubId || f.awayClubId === state.userClubId))
      .sort((a, b) => a.day - b.day)[0];
    expect(userFx).toBeDefined();

    state.day = userFx.day - 1;
    const result = advanceDay(state);

    expect(result.userFixture).not.toBeNull();
    expect(result.userFixture!.id).toBe(userFx.id);
    expect(result.stop).toBe(true);
    expect(result.stopReason).toBe('Match day');
    // The user's match is left for the UI to drive — not auto-simulated.
    expect(userFx.played).toBe(false);

    // Other clubs' fixtures on the same day are auto-simulated.
    const otherSameDay = state.fixtures.filter(
      (f) => f.day === userFx.day &&
        f.homeClubId !== state.userClubId && f.awayClubId !== state.userClubId,
    );
    expect(otherSameDay.length).toBeGreaterThan(0);
    for (const f of otherSameDay) expect(f.played).toBe(true);
  });
});

// -------------------------------------------------------------------------
// 6. Season-end trigger on season-day 364. With all fixtures played AND
//    phase === 'season', BOTH end-of-season branches fire in one call:
//    the 'Season complete' branch first, then the seasonDay===364 branch
//    overwrites stopReason with 'New season' (later in source order wins).
// -------------------------------------------------------------------------
describe('advanceDay — season end', () => {
  it('runs processSeasonEnd and lands on the New season stopReason', () => {
    const state = makeState(1);
    expect(state.season).toBe(1);
    // phase='season' is load-bearing: it lets the seasonFixturesDone branch
    // fire so we actually exercise the two-branch ordering, not just one.
    state.phase = 'season';
    for (const f of state.fixtures) f.played = true;

    // Land on season-day YEAR_LENGTH-1 (364) of season 1: absolute day 364.
    const targetDay = state.season * YEAR_LENGTH - 1; // 364
    expect(dayOfSeasonYear(targetDay)).toBe(YEAR_LENGTH - 1);
    state.day = targetDay - 1;

    const result = advanceDay(state);

    expect(state.day).toBe(targetDay);
    expect(result.stop).toBe(true);
    expect(result.stopReason).toBe('New season'); // later branch wins
    expect(state.season).toBe(2); // processSeasonEnd ran
  });
});

// -------------------------------------------------------------------------
// 6b. Weekly wages: deducted from every club on multiples of 7, and only then.
// -------------------------------------------------------------------------
describe('advanceDay — weekly wages', () => {
  it('deducts the wage bill from balance/ledger on day 7, not on the days around it', () => {
    const state = makeState(21);
    const club = state.clubs[state.userClubId];
    const bill = totalWages(clubPlayers(state, club.id));
    expect(bill).toBeGreaterThan(0);

    state.day = 6;
    const balanceBefore = club.balance;
    advanceDay(state);
    expect(state.day).toBe(7);
    expect(club.balance).toBe(balanceBefore - bill);
    expect(club.ledger.wages).toBe(-bill);

    // Day 8 is not a multiple of 7 — no further deduction.
    const balanceAfterWeek1 = club.balance;
    advanceDay(state);
    expect(state.day).toBe(8);
    expect(club.balance).toBe(balanceAfterWeek1);
    expect(club.ledger.wages).toBe(-bill);
  });

  it('pays every club in the world on the weekly boundary, not just the user club', () => {
    const state = makeState(22);
    const otherId = state.leagues[2].clubIds[3];
    const other = state.clubs[otherId];
    const bill = totalWages(clubPlayers(state, otherId));
    state.day = 6;
    const balanceBefore = other.balance;
    advanceDay(state);
    expect(other.balance).toBe(balanceBefore - bill);
  });
});

// -------------------------------------------------------------------------
// 6c. Monthly tv/commercial/operations + finance-history snapshot: fire only
//     on the 1st of the calendar month (dayToDate), not on other days.
// -------------------------------------------------------------------------
describe('advanceDay — monthly finance boundaries', () => {
  it('bumps ledger.tv and adds exactly one financeHistory entry only on the 1st of the month', () => {
    const state = makeState(23);
    const club = state.clubs[state.userClubId];
    let boundariesSeen = 0;

    for (let i = 0; i < 100; i++) {
      const historyLenBefore = club.financeHistory.length;
      const tvBefore = club.ledger.tv;
      advanceDay(state);
      const isBoundary = dayToDate(state.day, state.startYear).dayOfMonth === 1;
      if (isBoundary) {
        boundariesSeen++;
        expect(club.financeHistory.length).toBe(historyLenBefore + 1);
        expect(club.ledger.tv).toBeGreaterThan(tvBefore);
      } else {
        expect(club.financeHistory.length).toBe(historyLenBefore);
        expect(club.ledger.tv).toBe(tvBefore);
      }
    }
    // ~100 days crosses at least 3 calendar month-starts.
    expect(boundariesSeen).toBeGreaterThanOrEqual(3);
  });
});

// -------------------------------------------------------------------------
// 6d. Gate receipts: a played (non-user) home fixture credits the home club.
// -------------------------------------------------------------------------
describe('advanceDay — gate receipts', () => {
  it('credits the home club’s gate ledger when its fixture is auto-simulated', () => {
    const state = makeState(24);
    // Pick a fixture not involving the user club, and not itself a month
    // boundary (so the assertion isn't muddied by the same-day tv/commercial
    // income landing on the home club too).
    const fx = state.fixtures.find((f) =>
      f.homeClubId !== state.userClubId && f.awayClubId !== state.userClubId &&
      dayToDate(f.day, state.startYear).dayOfMonth !== 1);
    expect(fx).toBeDefined();
    const home = state.clubs[fx!.homeClubId];
    const balanceBefore = home.balance;

    state.day = fx!.day - 1;
    advanceDay(state);

    expect(fx!.played).toBe(true);
    expect(home.ledger.gate).toBeGreaterThan(0);
    expect(home.balance).toBe(balanceBefore + home.ledger.gate);
  });

  it('does not credit gate income to the user club’s own fixtures (left for the UI match flow)', () => {
    const state = makeState(25);
    const userFx = state.fixtures
      .filter((f) => f.homeClubId === state.userClubId || f.awayClubId === state.userClubId)
      .sort((a, b) => a.day - b.day)[0];
    const userClub = state.clubs[state.userClubId];

    state.day = userFx.day - 1;
    advanceDay(state);

    expect(userFx.played).toBe(false);
    expect(userClub.ledger.gate).toBe(0);
  });
});

// -------------------------------------------------------------------------
// 6e. Reconciliation: over a transfer-fee-free stretch, every club's balance
//     delta equals the sum of its season ledger (the recordMoney invariant,
//     exercised end-to-end through a real day-advance run). No user club, so
//     every fixture auto-sims (mirrors apps/web/scripts/simtest.ts).
// -------------------------------------------------------------------------
describe('advanceDay — reconciliation', () => {
  it('keeps balance - startBalance === sum(ledger) for every club across a stretch', () => {
    const state = generateWorld(999, 2025, 'reconciliation-test');
    state.userClubId = -1;
    const startBalances = new Map(Object.values(state.clubs).map((c) => [c.id, c.balance]));

    for (let i = 0; i < 200; i++) advanceDay(state);

    for (const club of Object.values(state.clubs)) {
      const ledgerSum = Object.values(club.ledger).reduce((a, b) => a + b, 0);
      expect(club.balance - startBalances.get(club.id)!).toBe(ledgerSum);
    }
  });
});

// -------------------------------------------------------------------------
// 7. pendingUserOffers: count of pending offers targeting the user's club.
// -------------------------------------------------------------------------
describe('pendingUserOffers', () => {
  it('counts only pending offers whose toClubId is the user club', () => {
    const state = makeState(1);
    const user = state.userClubId;
    const other = state.leagues[0].clubIds[1];
    state.offers = [
      makeOffer({ id: 1, status: 'pending', toClubId: user }), // counts
      makeOffer({ id: 2, status: 'pending', toClubId: user }), // counts
      makeOffer({ id: 3, status: 'pending', toClubId: other }), // wrong club
      makeOffer({ id: 4, status: 'accepted', toClubId: user }), // wrong status
      makeOffer({ id: 5, status: 'countered', toClubId: user }), // wrong status
      makeOffer({ id: 6, status: 'withdrawn', toClubId: user }), // wrong status
    ];
    expect(pendingUserOffers(state)).toBe(2);
  });

  it('is 0 when no offers target the user club', () => {
    const state = makeState(1);
    state.offers = [makeOffer({ status: 'pending', toClubId: state.userClubId + 12345 })];
    expect(pendingUserOffers(state)).toBe(0);
  });
});

// -------------------------------------------------------------------------
// 8. nextUserFixture: earliest unplayed fixture involving the user's club,
//    or null if none.
// -------------------------------------------------------------------------
describe('nextUserFixture', () => {
  it('returns the earliest-day unplayed fixture involving the user club', () => {
    const state = makeState(1);
    const user = state.userClubId;
    const other = state.leagues[0].clubIds[1];
    const fxEarlierPlayed = makeFixture({ id: 1, day: 30, homeClubId: user, awayClubId: other, played: true });
    const fxNext = makeFixture({ id: 2, day: 50, homeClubId: other, awayClubId: user, played: false });
    const fxNonUser = makeFixture({ id: 3, day: 40, homeClubId: other, awayClubId: other, played: false });
    const fxLater = makeFixture({ id: 4, day: 100, homeClubId: user, awayClubId: other, played: false });
    state.fixtures = [fxLater, fxEarlierPlayed, fxNext, fxNonUser];

    const next = nextUserFixture(state);
    expect(next).not.toBeNull();
    expect(next!.id).toBe(2); // day 50, earliest unplayed involving user
  });

  it('returns null when all user fixtures are played', () => {
    const state = makeState(1);
    const user = state.userClubId;
    const other = state.leagues[0].clubIds[1];
    state.fixtures = [
      makeFixture({ id: 1, day: 50, homeClubId: user, awayClubId: other, played: true }),
      makeFixture({ id: 2, day: 100, homeClubId: other, awayClubId: user, played: true }),
      makeFixture({ id: 3, day: 40, homeClubId: other, awayClubId: other, played: false }), // no user
    ];
    expect(nextUserFixture(state)).toBeNull();
  });
});
