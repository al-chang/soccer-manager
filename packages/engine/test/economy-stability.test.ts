import { describe, expect, it } from 'vitest';
import { generateWorld } from '../src/world';
import { advanceDay } from '../src/sim';
import { simulateFullMatch } from '../src/match';
import { clubPlayers, totalWages } from '../src/squad';
import { leaguePosition } from '../src/season';
import { prizeFor } from '../src/finance';
import { dayOfSeasonYear } from '../src/calendar';

const median = (arr: number[]) => [...arr].sort((a, b) => a - b)[Math.floor(arr.length / 2)];

// ---------------------------------------------------------------------------
// WP4 — AI economy guardrails: in-suite stability check.
//
// A headless multi-season run (no user club, every fixture auto-simmed) that
// asserts the WP4 invariants numerically. Kept to 3 seasons so it stays fast
// enough for the unit suite (~7s); the full 10-season version lives in
// apps/web/scripts/finance-sim.ts (see that file's header to run it).
// ---------------------------------------------------------------------------

describe('WP4 economy stability (headless, 3 seasons)', () => {
  it('keeps balances bounded, signings mostly unblocked, squads viable, and rescues a distressed club', () => {
    const state = generateWorld(4242, 2025, 'wp4-stability');
    state.userClubId = -999; // no user club: every fixture auto-sims on the day tick

    // Saddle one strong club with a genuine crisis at kickoff: deep in the red
    // with a heavy wage bill. Sell-to-survive must trade it back toward health
    // rather than let it spiral to -∞.
    const victim = Object.values(state.clubs).sort((a, b) => b.reputation - a.reputation)[8];
    const startBill = totalWages(clubPlayers(state, victim.id));
    victim.balance = -startBill * 16; // ~16 weeks of wages underwater → firesale
    const victimStartBalance = victim.balance;
    const victimId = victim.id;

    const tierOf = (clubId: number) => state.leagues.find((l) => l.id === state.clubs[clubId].leagueId)!.tier;

    let minSquadEver = Infinity;
    let maxBlockedPerLeagueEver = 0;
    let t1MedS1 = 0; // T1 median balance at the end of season 1 (drift baseline)
    const wageToRev: number[] = []; // per-club wage/revenue, snapshotted late in the final season
    const SEASONS = 3;
    let day = 0;
    for (let s = 0; s < SEASONS; s++) {
      const target = (s + 1) * 365;
      for (; day < target; day++) {
        // Snapshot each club's full-season economics the day before the final
        // rollover fires (season ledger holds a complete realized season).
        if (s === SEASONS - 1 && dayOfSeasonYear(state.day + 1) === 364) {
          for (const c of Object.values(state.clubs)) {
            const lg = state.leagues.find((l) => l.id === c.leagueId)!;
            const prize = prizeFor(lg.tier, leaguePosition(lg, c.id), lg.clubIds.length);
            const rev = c.ledger.gate + c.ledger.tv + c.ledger.commercial + prize;
            if (rev > 0) wageToRev.push(-c.ledger.wages / rev);
          }
        }
        advanceDay(state);
        for (const fx of state.fixtures.filter((f) => f.day <= state.day && !f.played)) {
          simulateFullMatch(state, fx);
        }
        for (const c of Object.values(state.clubs)) {
          minSquadEver = Math.min(minSquadEver, clubPlayers(state, c.id).length);
        }
        for (const lg of state.leagues) {
          const blocked = lg.clubIds.filter((id) => state.clubs[id].balance < 0).length;
          maxBlockedPerLeagueEver = Math.max(maxBlockedPerLeagueEver, blocked);
        }
      }
      if (s === 0) {
        t1MedS1 = median(Object.values(state.clubs).filter((c) => tierOf(c.id) === 1).map((c) => c.balance));
      }
    }

    // 1. Every balance stays finite and bounded — no dive to -∞, no runaway
    //    explosion. (The slow upward drift of rich clubs is the structural
    //    income surplus WP7 re-tunes; here we only require it stay in a sane band.)
    for (const c of Object.values(state.clubs)) {
      expect(Number.isFinite(c.balance)).toBe(true);
      expect(c.balance).toBeGreaterThan(-100_000_000);
      expect(c.balance).toBeLessThan(600_000_000);
    }

    // 2. Signing-blocked (balance < 0) clubs stay a small minority of any
    //    16-club league at every point in the run — no signing-block cascade.
    expect(maxBlockedPerLeagueEver).toBeLessThanOrEqual(4);

    // 3. No club is ever stripped below a viable squad: the sale floor plus the
    //    emergency free-agent backstop keep everyone able to field a team.
    expect(minSquadEver).toBeGreaterThanOrEqual(13);

    // 4. Sell-to-survive worked: the distressed club sold players and its
    //    balance recovered off the floor rather than spiralling.
    const soldByVictim = state.transferHistory.filter((t) => t.fromClubId === victimId).length;
    expect(soldByVictim).toBeGreaterThan(0);
    expect(state.clubs[victimId].balance).toBeGreaterThan(victimStartBalance);

    // 5. WP7 wage-to-revenue band: the flattened wage curve + revenue-scaled
    //    operations keep whole-squad wage bills a healthy share of income.
    //    Loosened bounds for the short in-suite run (the 10-season script in
    //    apps/web/scripts/finance-sim.ts holds the tight version). The median
    //    club spends most-but-not-all of its revenue on wages; almost none run
    //    the free-money (< 0.3) or doomed (> 1.1) extremes.
    const medWageToRev = median(wageToRev);
    expect(medWageToRev).toBeGreaterThan(0.45);
    expect(medWageToRev).toBeLessThan(0.90);
    const doomed = wageToRev.filter((r) => r > 1.1).length;
    expect(doomed).toBeLessThanOrEqual(4);

    // 6. WP7 drift bound: top-flight balances accumulate slowly, not divergently.
    //    Over 2 further seasons the median must not blow past ~2× its S1 value.
    const t1MedEnd = median(Object.values(state.clubs).filter((c) => tierOf(c.id) === 1).map((c) => c.balance));
    expect(t1MedEnd).toBeLessThan(t1MedS1 * 2);
  }, 30_000);
});
