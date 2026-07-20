import type { GameState, Fixture, TransferOffer } from './types';
import { createRng, chance, type Rng } from './rng';
import { dailyCondition, developWeekly } from './player';
import { aiTransferTick, aiFollowUpCounters, aiEmergencySignings, agentContractTick } from './transfers';
import { simulateFullMatch } from './match';
import { processSeasonEnd, seasonFixturesDone } from './season';
import { dayOfSeasonYear, dayToDate, isTransferWindowOpen, YEAR_LENGTH, formatDay } from './calendar';
import { addNews } from './news';
import { payWeeklyWages, payMonthlyFinances, processMatchGate } from './finance';

/** Stop reason for a response in one of the user's live negotiations; the UI
 * routes straight to the transfers screen when a day ends with it. */
export const STOP_TRANSFER_RESPONSE = 'Transfer response';

export interface DayResult {
  /** The user's fixture today, if any (not yet simulated). */
  userFixture: Fixture | null;
  /** True when something happened the user should stop and look at. */
  stop: boolean;
  stopReason: string | null;
}

function dayRng(state: GameState): Rng {
  return createRng((state.seed + state.day * 104729) >>> 0);
}

/**
 * Advance the world by one day. Simulates AI fixtures, training, transfers
 * and season rollover. Returns whether the user should be interrupted.
 */
export function advanceDay(state: GameState): DayResult {
  state.day += 1;
  const rng = dayRng(state);
  const result: DayResult = { userFixture: null, stop: false, stopReason: null };
  const seasonDay = dayOfSeasonYear(state.day);

  // Weekly wage bill for every club (all clubs, not just the user's).
  if (state.day % 7 === 0) payWeeklyWages(state);

  // Monthly TV/commercial income + operations overhead, on the 1st of each
  // calendar month; also snapshots the month just completed for the
  // Finances screen's cash-flow trend. Runs before the transfer-window news
  // below so a window-boundary day (which can coincide with a month
  // boundary, e.g. Jul 1 / Jan 1) still surfaces the window news as the most
  // recent (news is unshifted, so whichever addNews runs last ends up first).
  if (dayToDate(state.day, state.startYear).dayOfMonth === 1) payMonthlyFinances(state);

  // Transfer window boundary news.
  if (seasonDay === 0 || seasonDay === 184) {
    addNews(state, 'window', 'Transfer window open',
      `The ${seasonDay === 0 ? 'summer' : 'winter'} transfer window is now open.`, true);
    result.stop = true;
    result.stopReason = 'Transfer window open';
  } else if (seasonDay === 62 || seasonDay === 215) {
    addNews(state, 'window', 'Transfer window closed', 'The transfer window has closed.', true);
    // Withdraw unresolved offers at deadline.
    for (const o of state.offers) {
      if (o.status === 'pending' || o.status === 'countered') o.status = 'withdrawn';
    }
    result.stop = true;
    result.stopReason = 'Transfer window closed';
  }

  // Daily player condition & birthdays (day-of-year: day 0 is Jul 1 = 181).
  const dayOfYear = (state.day + 181) % YEAR_LENGTH;
  for (const p of Object.values(state.players)) {
    dailyCondition(rng, p, p.clubId === state.userClubId ? state.trainingIntensity : 'normal');
    if (p.birthDayOfYear === dayOfYear) p.age += 1;
  }

  // Weekly development tick.
  if (state.day % 7 === 0) {
    for (const p of Object.values(state.players)) {
      const intensity = p.clubId === state.userClubId
        ? (state.trainingIntensity === 'heavy' ? 1.3 : state.trainingIntensity === 'light' ? 0.75 : 1)
        : 1;
      developWeekly(rng, p, intensity, p.sharpness > 65);
    }
    // Squad players unhappy without minutes drift down in wellbeing.
    for (const p of Object.values(state.players)) {
      if (p.clubId < 0) continue;
      if (p.sharpness < 45 && p.age >= 22) {
        p.wellbeing = Math.max(0, p.wellbeing - 1.5);
        if (p.clubId === state.userClubId && p.wellbeing < 35 && chance(rng, 0.15)) {
          addNews(state, 'squad', 'Unhappy player',
            `A player in your squad is unhappy with his lack of playing time. Check the squad screen for players with low wellbeing.`, true);
        }
      }
    }
  }

  // Transfer market activity. A response to any of the user's live
  // negotiations (bid accepted/countered/rejected, counter answered, agent's
  // contract verdict, deal withdrawn) pauses the sim so the manager can act.
  const watched = state.offers.filter((o) =>
    (o.fromClubId === state.userClubId || o.toClubId === state.userClubId) &&
    (o.status === 'pending' || o.status === 'countered' || (o.status === 'accepted' && o.stage === 'contract')));
  const negState = (o: TransferOffer) => `${o.status}:${o.contractOffer ? 'awaiting' : ''}`;
  const before = new Map(watched.map((o) => [o.id, negState(o)]));
  if (isTransferWindowOpen(state.day)) {
    aiTransferTick(state, rng);
    aiFollowUpCounters(state, rng);
  }
  // Agent answers arrive any day — a fee agreed in the window can still
  // conclude after the deadline.
  agentContractTick(state, rng);
  if (watched.some((o) => negState(o) !== before.get(o.id))) {
    result.stop = true;
    result.stopReason = STOP_TRANSFER_RESPONSE;
  }
  // Thin AI squads top up from the free-agent pool any day of the year.
  aiEmergencySignings(state, rng);

  // Today's fixtures (<= catches any unplayed stragglers after a reload).
  const todays = state.fixtures.filter((f) => f.day <= state.day && !f.played);
  if (todays.length) {
    state.phase = 'season';
    for (const fx of todays) {
      const isUserMatch = fx.homeClubId === state.userClubId || fx.awayClubId === state.userClubId;
      if (isUserMatch) {
        // Left for the UI's match flow to simulate (see match.ts / the web
        // app's concludeMatch): gate receipts for the user's own fixtures
        // aren't processed here — see the note on processMatchGate.
        result.userFixture = fx;
        result.stop = true;
        result.stopReason = 'Match day';
      } else {
        // Gate receipts are derived from pre-match state (reputation,
        // standings), so they're recorded before the result is simulated.
        processMatchGate(state, fx);
        simulateFullMatch(state, fx);
      }
    }
  }

  // Season end: all fixtures played → postseason; rollover on Jun 30.
  if (state.phase === 'season' && seasonFixturesDone(state)) {
    state.phase = 'postseason';
    addNews(state, 'league', 'Season complete',
      `The season has finished. The league year rolls over on 30 Jun (${formatDay((state.season) * YEAR_LENGTH - 1, state.startYear)}).`, true);
    result.stop = true;
    result.stopReason = 'Season complete';
  }
  if (seasonDay === YEAR_LENGTH - 1) {
    processSeasonEnd(state, rng);
    result.stop = true;
    result.stopReason = 'New season';
  }

  return result;
}

/** Pending incoming offers the user must respond to. */
export function pendingUserOffers(state: GameState): number {
  return state.offers.filter((o) => o.status === 'pending' && o.toClubId === state.userClubId).length;
}

/** The user's next unplayed fixture. */
export function nextUserFixture(state: GameState): Fixture | null {
  const fx = state.fixtures
    .filter((f) => !f.played && (f.homeClubId === state.userClubId || f.awayClubId === state.userClubId))
    .sort((a, b) => a.day - b.day);
  return fx[0] ?? null;
}
