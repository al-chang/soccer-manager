import { describe, expect, it } from 'vitest';
import {
  recordMoney, tvMonthlyIncome, commercialMonthlyIncome, operationsMonthlyOverhead,
  matchAttendance, ticketPriceForTier, processMatchGate, takeFinanceSnapshot,
  payWeeklyWages, payMonthlyFinances,
  prizeFor, boardEnvelope, resplitBudget, weeksRemaining,
  overdraftSeverity, maybeEmitOverdraftWarning, sellPressure,
} from '../src/finance';
import { emptyLedger } from '../src/world';
import { processSeasonEnd } from '../src/season';
import { completeTransfer, aiTransferTick } from '../src/transfers';
import { clubPlayers, totalWages } from '../src/squad';
import { createRng } from '../src/rng';
import { dayOfSeasonYear } from '../src/calendar';
import type { Club, Fixture, GameState, TransferOffer } from '../src/types';
import { makePlayer, makeState } from './helpers';

// ---------------------------------------------------------------------------
// 1. recordMoney — the single choke point every balance change must go
//    through; ledger and balance move together, signed.
// ---------------------------------------------------------------------------

describe('recordMoney', () => {
  function mkClub(overrides: Partial<Club> = {}): Club {
    return {
      id: 1, name: 'Test FC', shortName: 'TFC', nationId: 0, leagueId: 0,
      reputation: 50, budget: 0, wageBudget: 0, balance: 1000, ledger: emptyLedger(),
      financeHistory: [], managerId: 0,
      tactics: { formation: '4-4-2', mentality: 'balanced', pressing: 'medium', tempo: 'normal' },
      lineup: { starters: [], bench: [] }, colors: ['#000', '#fff'], history: [],
      ...overrides,
    };
  }

  it('adds a positive amount to both balance and the matching ledger category', () => {
    const club = mkClub();
    recordMoney(club, 'gate', 5000);
    expect(club.balance).toBe(6000);
    expect(club.ledger.gate).toBe(5000);
  });

  it('subtracts a negative amount from both balance and the matching ledger category', () => {
    const club = mkClub();
    recordMoney(club, 'wages', -400);
    expect(club.balance).toBe(600);
    expect(club.ledger.wages).toBe(-400);
  });

  it('accumulates across repeated calls to the same category', () => {
    const club = mkClub();
    recordMoney(club, 'tv', 100);
    recordMoney(club, 'tv', 250);
    expect(club.ledger.tv).toBe(350);
    expect(club.balance).toBe(1350);
  });

  it('leaves other ledger categories untouched', () => {
    const club = mkClub();
    recordMoney(club, 'commercial', 200);
    expect(club.ledger.gate).toBe(0);
    expect(club.ledger.wages).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 2. Monthly income/overhead curves — tier + reputation scaling shape.
// ---------------------------------------------------------------------------

describe('tvMonthlyIncome', () => {
  it('pays tier 1 substantially more than tier 2', () => {
    expect(tvMonthlyIncome(1)).toBeGreaterThan(tvMonthlyIncome(2) * 2);
  });
});

describe('commercialMonthlyIncome', () => {
  it('increases with reputation', () => {
    expect(commercialMonthlyIncome(80)).toBeGreaterThan(commercialMonthlyIncome(40));
  });

  it('is zero at zero reputation', () => {
    expect(commercialMonthlyIncome(0)).toBe(0);
  });
});

describe('operationsMonthlyOverhead', () => {
  it('scales strongly with reputation and tier (a revenue-tracking cost, WP7)', () => {
    // Unlike the old near-flat overhead, operations is now the balancing cost
    // that pulls a healthy-wage club toward break-even, so it grows steeply
    // with club size (reputation) and is higher in the top flight.
    const low = operationsMonthlyOverhead(30, 1);
    const high = operationsMonthlyOverhead(90, 1);
    expect(high).toBeGreaterThan(low);
    expect(high / low).toBeGreaterThan(3); // steep, not gentle
    // Top flight is a costlier operation than the second tier at equal reputation.
    expect(operationsMonthlyOverhead(70, 1)).toBeGreaterThan(operationsMonthlyOverhead(70, 2));
  });
});

describe('ticketPriceForTier', () => {
  it('charges more for tier 1 than tier 2', () => {
    expect(ticketPriceForTier(1)).toBeGreaterThan(ticketPriceForTier(2));
  });
});

// ---------------------------------------------------------------------------
// 3. matchAttendance — reputation-driven, nudged by position/opponent.
// ---------------------------------------------------------------------------

describe('matchAttendance', () => {
  it('is bigger for a higher-reputation home club, all else equal', () => {
    const state = makeState(5);
    const league = state.leagues[0];
    const [homeA, homeB, away] = league.clubIds;
    state.clubs[homeA].reputation = 90;
    state.clubs[homeB].reputation = 40;
    state.clubs[away].reputation = 50;

    const fxBig: Fixture = { id: 1, leagueId: league.id, round: 1, day: 100, homeClubId: homeA, awayClubId: away, played: false, homeGoals: 0, awayGoals: 0 };
    const fxSmall: Fixture = { id: 2, leagueId: league.id, round: 1, day: 100, homeClubId: homeB, awayClubId: away, played: false, homeGoals: 0, awayGoals: 0 };

    expect(matchAttendance(state, fxBig)).toBeGreaterThan(matchAttendance(state, fxSmall));
  });

  it('gives a bigger crowd to the club at the top of the table than the one at the bottom, all else equal', () => {
    const state = makeState(6);
    const league = state.leagues[0];
    const [topClub, bottomClub, away] = league.clubIds;
    state.clubs[topClub].reputation = 60;
    state.clubs[bottomClub].reputation = 60;
    state.clubs[away].reputation = 60;
    league.table.forEach((e) => {
      e.points = e.clubId === topClub ? 90 : e.clubId === bottomClub ? 0 : 45;
    });

    const fxTop: Fixture = { id: 1, leagueId: league.id, round: 1, day: 100, homeClubId: topClub, awayClubId: away, played: false, homeGoals: 0, awayGoals: 0 };
    const fxBottom: Fixture = { id: 2, leagueId: league.id, round: 1, day: 100, homeClubId: bottomClub, awayClubId: away, played: false, homeGoals: 0, awayGoals: 0 };

    expect(matchAttendance(state, fxTop)).toBeGreaterThan(matchAttendance(state, fxBottom));
  });

  it('never goes negative', () => {
    const state = makeState(7);
    const league = state.leagues[0];
    const [home, away] = league.clubIds;
    state.clubs[home].reputation = 1;
    state.clubs[away].reputation = 1;
    const fx: Fixture = { id: 1, leagueId: league.id, round: 1, day: 100, homeClubId: home, awayClubId: away, played: false, homeGoals: 0, awayGoals: 0 };
    expect(matchAttendance(state, fx)).toBeGreaterThanOrEqual(0);
  });
});

// ---------------------------------------------------------------------------
// 4. processMatchGate — credits the home club only, returns attendance.
// ---------------------------------------------------------------------------

describe('processMatchGate', () => {
  it('credits gate income to the home club and leaves the away club untouched', () => {
    const state = makeState(8);
    const league = state.leagues[0];
    const [home, away] = league.clubIds;
    const homeBalanceBefore = state.clubs[home].balance;
    const awayBalanceBefore = state.clubs[away].balance;

    const fx: Fixture = { id: 1, leagueId: league.id, round: 1, day: 100, homeClubId: home, awayClubId: away, played: false, homeGoals: 0, awayGoals: 0 };
    const attendance = processMatchGate(state, fx);

    expect(attendance).toBeGreaterThan(0);
    expect(state.clubs[home].balance).toBeGreaterThan(homeBalanceBefore);
    expect(state.clubs[home].ledger.gate).toBeGreaterThan(0);
    expect(state.clubs[home].balance - homeBalanceBefore).toBe(state.clubs[home].ledger.gate);
    expect(state.clubs[away].balance).toBe(awayBalanceBefore);
    expect(state.clubs[away].ledger.gate).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 5. takeFinanceSnapshot — monthly deltas, not running totals.
// ---------------------------------------------------------------------------

describe('takeFinanceSnapshot', () => {
  it('captures the full cumulative ledger on the first snapshot of a season', () => {
    const state = makeState(9);
    const club = state.clubs[state.userClubId];
    recordMoney(club, 'gate', 10_000);
    recordMoney(club, 'wages', -4_000);

    takeFinanceSnapshot(club, 100);

    expect(club.financeHistory).toHaveLength(1);
    expect(club.financeHistory[0]).toEqual({ day: 100, balance: club.balance, income: 10_000, expense: -4_000 });
  });

  it('captures only the delta since the previous snapshot on later calls', () => {
    const state = makeState(10);
    const club = state.clubs[state.userClubId];
    recordMoney(club, 'gate', 10_000);
    takeFinanceSnapshot(club, 100);

    recordMoney(club, 'gate', 3_000);
    recordMoney(club, 'wages', -1_500);
    takeFinanceSnapshot(club, 130);

    expect(club.financeHistory).toHaveLength(2);
    expect(club.financeHistory[1].income).toBe(3_000);
    expect(club.financeHistory[1].expense).toBe(-1_500);
    expect(club.financeHistory[1].balance).toBe(club.balance);
  });
});

// ---------------------------------------------------------------------------
// 6. payWeeklyWages / payMonthlyFinances — the per-club, all-clubs sweeps.
// ---------------------------------------------------------------------------

describe('payWeeklyWages', () => {
  it('deducts every club’s summed squad wage bill from balance and the wages ledger', () => {
    const state = makeState(11);
    const club = state.clubs[state.userClubId];
    const bill = totalWages(clubPlayers(state, club.id));
    const balanceBefore = club.balance;

    payWeeklyWages(state);

    expect(club.balance).toBe(balanceBefore - bill);
    expect(club.ledger.wages).toBe(-bill);
  });

  it('pays every club in the world, not just the user’s', () => {
    const state = makeState(12);
    const otherId = state.leagues[2].clubIds[3]; // a club in a different league/nation
    const other = state.clubs[otherId];
    const bill = totalWages(clubPlayers(state, otherId));
    const balanceBefore = other.balance;

    payWeeklyWages(state);

    expect(other.balance).toBe(balanceBefore - bill);
  });
});

describe('payMonthlyFinances', () => {
  it('applies tv, commercial and operations to every club', () => {
    const state = makeState(13);
    const club = state.clubs[state.userClubId];
    const league = state.leagues.find((l) => l.id === club.leagueId)!;
    const balanceBefore = club.balance;

    payMonthlyFinances(state);

    const expectedTv = tvMonthlyIncome(league.tier);
    const expectedCommercial = commercialMonthlyIncome(club.reputation);
    const expectedOps = operationsMonthlyOverhead(club.reputation, league.tier);
    expect(club.ledger.tv).toBe(expectedTv);
    expect(club.ledger.commercial).toBe(expectedCommercial);
    expect(club.ledger.operations).toBe(-expectedOps);
    expect(club.balance).toBe(balanceBefore + expectedTv + expectedCommercial - expectedOps);
  });

  it('posts a board news item for the user club only', () => {
    const state = makeState(14);
    const otherId = state.leagues[0].clubIds.find((id) => id !== state.userClubId)!;
    const newsBefore = state.news.length;

    payMonthlyFinances(state);

    const boardNews = state.news.slice(0, state.news.length - newsBefore);
    expect(boardNews.some((n) => n.category === 'board' && n.title === 'Monthly finance summary')).toBe(true);
    // Only one such item (for the user club, not one per club in the world).
    expect(boardNews.filter((n) => n.title === 'Monthly finance summary')).toHaveLength(1);
    expect(otherId).not.toBe(state.userClubId); // sanity: a genuinely different club exists
  });

  it('gives every club a fresh finance-history entry', () => {
    const state = makeState(15);
    const club = state.clubs[state.userClubId];
    expect(club.financeHistory).toHaveLength(0);

    payMonthlyFinances(state);

    expect(club.financeHistory).toHaveLength(1);
  });
});


// ---------------------------------------------------------------------------
// recordMoney — the reconciliation invariant
// ---------------------------------------------------------------------------

describe('recordMoney', () => {
  it('moves balance and the matching ledger category together (signed)', () => {
    const state = makeState(1);
    const club = state.clubs[state.userClubId];
    const balBefore = club.balance;
    const ledgerBefore = club.ledger.prize;
    recordMoney(club, 'prize', 5_000_000);
    recordMoney(club, 'wages', -1_200_000);
    expect(club.balance).toBe(balBefore + 5_000_000 - 1_200_000);
    expect(club.ledger.prize).toBe(ledgerBefore + 5_000_000);
    expect(club.ledger.wages).toBe(-1_200_000);
  });
});

// ---------------------------------------------------------------------------
// prizeFor
// ---------------------------------------------------------------------------

describe('prizeFor', () => {
  const SIZE = 16;

  it('pays champions > mid-table > bottom, and every position is positive', () => {
    const champ = prizeFor(1, 1, SIZE);
    const mid = prizeFor(1, 8, SIZE);
    const bottom = prizeFor(1, 16, SIZE);
    expect(champ).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(bottom);
    expect(bottom).toBeGreaterThan(0);
  });

  it('pays the top flight far more than the second tier at the same position', () => {
    expect(prizeFor(1, 8, SIZE)).toBeGreaterThan(prizeFor(2, 8, SIZE));
  });

  it('makes promotion a windfall: a promoted tier-2 club out-earns a mid-table tier-2 club', () => {
    const promoted = prizeFor(2, 2, SIZE); // 2nd, promoted
    const midTier2 = prizeFor(2, 8, SIZE);
    expect(promoted).toBeGreaterThan(midTier2);
    // The windfall lump is large relative to the tier-2 pot.
    expect(promoted - midTier2).toBeGreaterThan(5_000_000);
  });
});

// ---------------------------------------------------------------------------
// boardEnvelope
// ---------------------------------------------------------------------------

describe('boardEnvelope', () => {
  it('gives a rich club a positive transfer budget', () => {
    const env = boardEnvelope(30_000_000, 400_000, 1);
    expect(env.budget).toBeGreaterThan(0);
  });

  it('gives a club in the red nothing to spend', () => {
    const env = boardEnvelope(-2_000_000, 400_000, 1);
    expect(env.budget).toBe(0);
  });

  it('gives a club whose cash barely covers its reserve nothing to spend', () => {
    // reserve is 8 weeks of wages = 8 * 400k = 3.2M; balance below that => 0.
    const env = boardEnvelope(3_000_000, 400_000, 1);
    expect(env.budget).toBe(0);
  });

  it('never sets the wage cap below the current wage bill (even when broke)', () => {
    for (const bal of [-5_000_000, 0, 1_000_000, 50_000_000]) {
      const env = boardEnvelope(bal, 500_000, 1);
      expect(env.wageBudget).toBeGreaterThanOrEqual(500_000);
    }
  });

  it('gives a richer club more wage headroom than a poorer one at the same bill', () => {
    const rich = boardEnvelope(40_000_000, 500_000, 1);
    const poor = boardEnvelope(1_000_000, 500_000, 1);
    expect(rich.wageBudget).toBeGreaterThan(poor.wageBudget);
  });
});

// ---------------------------------------------------------------------------
// resplitBudget — the transfer↔wage slider
// ---------------------------------------------------------------------------

/** Build a controllable club with a known budget/wageBudget/squad wage bill. */
function envState(seed: number, budget: number, wageBudget: number, squadWage: number): { state: GameState; club: Club } {
  const state = makeState(seed);
  const club = state.clubs[state.userClubId];
  // Replace the squad with a single player carrying the whole wage bill.
  for (const p of clubPlayers(state, club.id)) delete state.players[p.id];
  const p = makePlayer({ clubId: club.id, contract: { wage: squadWage, expiresDay: 365 * 3 } });
  state.players[p.id] = p;
  club.budget = budget;
  club.wageBudget = wageBudget;
  state.day = 0; // start of season → 52 weeks remaining
  return { state, club };
}

describe('resplitBudget', () => {
  it('converts at ~£52k transfer ↔ £1k/week at the start of a season', () => {
    const { state, club } = envState(101, 1_000_000, 500_000, 100_000);
    expect(weeksRemaining(state.day)).toBe(52);
    const err = resplitBudget(state, club, -52_000); // move 52k out of transfers into wages
    expect(err).toBeNull();
    expect(club.budget).toBe(1_000_000 - 52_000);
    expect(club.wageBudget).toBe(500_000 + 1_000);
  });

  it('round-trips exactly and conserves money (balance untouched)', () => {
    const { state, club } = envState(102, 2_000_000, 600_000, 120_000);
    const budget0 = club.budget;
    const wage0 = club.wageBudget;
    const balance0 = club.balance;

    expect(resplitBudget(state, club, -260_000)).toBeNull(); // transfer → wage
    expect(club.budget).not.toBe(budget0);
    expect(club.wageBudget).not.toBe(wage0);

    expect(resplitBudget(state, club, +260_000)).toBeNull(); // wage → transfer, inverse
    expect(club.budget).toBe(budget0);
    expect(club.wageBudget).toBe(wage0);
    expect(club.balance).toBe(balance0); // slider never touches the bank
  });

  it('rejects a move that would drive the transfer budget negative', () => {
    const { state, club } = envState(103, 100_000, 500_000, 100_000);
    const before = { budget: club.budget, wageBudget: club.wageBudget };
    const err = resplitBudget(state, club, -200_000);
    expect(err).toMatch(/negative/i);
    expect(club.budget).toBe(before.budget); // unchanged on rejection
    expect(club.wageBudget).toBe(before.wageBudget);
  });

  it('rejects a move that would drop the wage cap below the current wage bill', () => {
    // wageBudget 105k, bill 100k: only 5k of wage room to give back to transfers.
    const { state, club } = envState(104, 1_000_000, 105_000, 100_000);
    const before = { budget: club.budget, wageBudget: club.wageBudget };
    // Pull a big lump into transfers → wage cap would fall well under 100k.
    const err = resplitBudget(state, club, +2_000_000);
    expect(err).toMatch(/wage bill/i);
    expect(club.budget).toBe(before.budget);
    expect(club.wageBudget).toBe(before.wageBudget);
  });
});

// ---------------------------------------------------------------------------
// Season rollover: prize hits balance+ledger, envelope invariants
// ---------------------------------------------------------------------------

/** Every fixture played, tables primed to a strict decreasing ranking. */
function primedState(seed = 42): GameState {
  const state = makeState(seed);
  for (const f of state.fixtures) f.played = true;
  for (const league of state.leagues) {
    league.table.forEach((entry, i) => {
      entry.played = 30;
      entry.won = league.table.length - i;
      entry.lost = i;
      entry.goalsFor = 60 - i;
      entry.goalsAgainst = 10 + i;
      entry.points = (league.table.length - i) * 3;
    });
  }
  return state;
}

describe('processSeasonEnd — finances', () => {
  it('pays a prize into every club (balance + prize ledger) at rollover', () => {
    const state = primedState();
    const sample = Object.values(state.clubs)[0].id;
    const balBefore = state.clubs[sample].balance;
    processSeasonEnd(state, createRng(12345));
    // Prize recorded against the ledger and reflected in the balance.
    expect(state.clubs[sample].ledger.prize).toBeGreaterThan(0);
    // Balance rose by at least the prize (other rollover money flows are WP2's).
    expect(state.clubs[sample].balance).toBeGreaterThanOrEqual(balBefore + state.clubs[sample].ledger.prize - 1);
  });

  it('sets a wage cap at or above every club’s post-rollover wage bill', () => {
    const state = primedState();
    processSeasonEnd(state, createRng(12345));
    for (const club of Object.values(state.clubs)) {
      const bill = totalWages(clubPlayers(state, club.id));
      expect(club.wageBudget).toBeGreaterThanOrEqual(bill);
    }
  });

  it('gives a rich club a positive transfer budget and a broke club zero', () => {
    const state = primedState();
    const clubs = Object.values(state.clubs);
    const richId = clubs[0].id;
    const brokeId = clubs[1].id;
    // Force a deep overdraft that the prize cannot rescue.
    state.clubs[brokeId].balance = -500_000_000;
    // Make the rich club unambiguously flush.
    state.clubs[richId].balance = 200_000_000;

    processSeasonEnd(state, createRng(999));

    expect(state.clubs[richId].budget).toBeGreaterThan(0);
    expect(state.clubs[brokeId].budget).toBe(0);
    expect(state.clubs[brokeId].balance).toBeLessThan(0); // still underwater
  });
});

// ---------------------------------------------------------------------------
// completeTransfer moves real cash + ledger on both sides
// ---------------------------------------------------------------------------

describe('completeTransfer — money movement', () => {
  it('debits the buyer and credits the seller on both balance and ledger', () => {
    const state = makeState(31);
    const ids = Object.keys(state.clubs).map(Number);
    const buyer = state.clubs[ids[0]];
    const seller = state.clubs[ids[1]];
    const player = makePlayer({ position: 'CM', clubId: seller.id, attributes: { goalkeeping: 60 } });
    state.players[player.id] = player;

    const buyerBal = buyer.balance;
    const sellerBal = seller.balance;
    const fee = 3_000_000;
    const offer: TransferOffer = {
      id: 900, playerId: player.id, fromClubId: buyer.id, toClubId: seller.id,
      fee, status: 'pending', counterFee: null, day: state.day,
      userInvolved: false, wageDemand: null, stage: 'fee',
    };
    state.offers.push(offer);

    completeTransfer(state, offer, 40_000);

    expect(buyer.balance).toBe(buyerBal - fee);
    expect(seller.balance).toBe(sellerBal + fee);
    expect(buyer.ledger.transferFees).toBe(-fee);
    expect(seller.ledger.playerSales).toBe(fee);
  });

  it('leaves ledgers untouched for a free-agent (fee 0) signing', () => {
    const state = makeState(32);
    const buyer = state.clubs[Object.keys(state.clubs).map(Number)[0]];
    const player = makePlayer({ position: 'CM', clubId: -1, attributes: { goalkeeping: 60 } });
    state.players[player.id] = player;
    const buyerBal = buyer.balance;
    const offer: TransferOffer = {
      id: 901, playerId: player.id, fromClubId: buyer.id, toClubId: -1,
      fee: 0, status: 'accepted', counterFee: null, day: state.day,
      userInvolved: false, wageDemand: 5000, stage: 'contract',
    };
    state.offers.push(offer);
    completeTransfer(state, offer, 5000);
    expect(buyer.balance).toBe(buyerBal);
    expect(buyer.ledger.transferFees).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// AI discipline: a broke club makes no purchases
// ---------------------------------------------------------------------------

describe('AI transfer discipline', () => {
  it('a balance < 0 AI club starts no new purchases', () => {
    const state = makeState(71);
    state.day = 5; // summer window open
    expect(dayOfSeasonYear(state.day)).toBeLessThanOrEqual(61);
    // Put every AI club deep in the red with a healthy transfer allocation, so
    // the only thing keeping them out of the market is the balance gate.
    for (const club of Object.values(state.clubs)) {
      if (club.id === state.userClubId) continue;
      club.balance = -10_000_000;
      club.budget = 50_000_000;
    }
    const offersBefore = state.offers.length;
    // Run several ticks; no AI club should open a bid or complete a free signing.
    for (let i = 0; i < 20; i++) aiTransferTick(state, createRng(1000 + i));
    const aiInitiated = state.offers.filter((o) => o.fromClubId !== state.userClubId);
    expect(aiInitiated.length).toBe(0);
    expect(state.offers.length).toBe(offersBefore);
  });
});

// ---------------------------------------------------------------------------
// Overdraft severity + monthly warning
// ---------------------------------------------------------------------------

describe('overdraftSeverity', () => {
  it('grades none → notice → concern → crisis by weeks of wages underwater', () => {
    const mk = (balance: number) => ({ balance } as Club);
    const bill = 100_000; // weekly
    expect(overdraftSeverity(mk(1), bill)).toBe('none');
    expect(overdraftSeverity(mk(-200_000), bill)).toBe('notice'); // 2 weeks
    expect(overdraftSeverity(mk(-600_000), bill)).toBe('concern'); // 6 weeks
    expect(overdraftSeverity(mk(-2_000_000), bill)).toBe('crisis'); // 20 weeks
  });
});

describe('sellPressure', () => {
  it('extends overdraftSeverity below zero and catches solvent-but-low-runway clubs', () => {
    const mk = (balance: number) => ({ balance } as Club);
    const bill = 100_000; // weekly wage bill
    // Comfortable: balance covers >= 8 weeks (SELL_TRIGGER_WEEKS) of wages.
    expect(sellPressure(mk(1_000_000), bill)).toBe('none'); // 10 weeks
    // Solvent but runway < 8 weeks → trim (pull out of the market, list surplus early).
    expect(sellPressure(mk(500_000), bill)).toBe('trim'); // 5 weeks
    // In the red (notice/concern) → sell (list more, accept below-value bids).
    expect(sellPressure(mk(-200_000), bill)).toBe('sell'); // 2 weeks under (notice)
    expect(sellPressure(mk(-600_000), bill)).toBe('sell'); // 6 weeks under (concern)
    // Deep in the red (crisis) → firesale.
    expect(sellPressure(mk(-2_000_000), bill)).toBe('firesale'); // 20 weeks under
  });

  it('a club with no wage bill and a non-negative balance is never under pressure', () => {
    expect(sellPressure({ balance: 5_000 } as Club, 0)).toBe('none');
    expect(sellPressure({ balance: 0 } as Club, 0)).toBe('none');
  });
});

describe('maybeEmitOverdraftWarning', () => {
  it('emits a board news item on the 1st of a month while overdrawn', () => {
    const state = makeState(1);
    const club = state.clubs[state.userClubId];
    club.balance = -5_000_000;
    // Day 0 is Jul 1 → dayOfMonth === 1.
    const before = state.news.length;
    maybeEmitOverdraftWarning(state);
    expect(state.news.length).toBe(before + 1);
    expect(state.news[0].category).toBe('board');
  });

  it('stays silent when solvent, and on non-first days', () => {
    const state = makeState(1);
    const club = state.clubs[state.userClubId];
    // Solvent on the 1st: silent.
    maybeEmitOverdraftWarning(state);
    expect(state.news.length).toBe(0);
    // Overdrawn but mid-month (day 5 = Jul 6): silent.
    club.balance = -5_000_000;
    state.day = 5;
    maybeEmitOverdraftWarning(state);
    expect(state.news.length).toBe(0);
  });
});
