import { describe, it, expect } from 'vitest';
import type { GameState, Player, TransferOffer, OfferStatus } from '../src/types';
import {
  sellThreshold,
  aiRespondToBid,
  completeTransfer,
  contractEndDay,
  analyzeNeeds,
  surplusPlayers,
  formatMoney,
  aiTransferTick,
  aiFollowUpCounters,
  aiEmergencySignings,
  aiManageListings,
  aiClearListedMarket,
  SALE_SQUAD_FLOOR,
} from '../src/transfers';
import { clubPlayers, positionCounts, IDEAL_COUNTS, totalWages } from '../src/squad';
import { overall } from '../src/player';
import { positionGroup } from '../src/tactics';
import { isTransferWindowOpen } from '../src/calendar';
import { createRng } from '../src/rng';
import { makePlayer, makeState } from './helpers';

/** The first AI (non-user) club with a squad comfortably above the sale floor. */
function anAiClub(state: GameState) {
  return Object.values(state.clubs).find(
    (c) => c.id !== state.userClubId && clubPlayers(state, c.id).length > SALE_SQUAD_FLOOR,
  )!;
}

// --- local test helpers (setup only; not player builders) ---

/** Remove every player currently attached to `clubId` so a test can control the
 * squad composition exactly (real clubs come pre-stocked from makeState). */
function clearSquad(state: GameState, clubId: number): void {
  for (const p of clubPlayers(state, clubId)) delete state.players[p.id];
}

/** Create `n` players at a given position on a club and register them in state. */
function addPlayers(
  state: GameState,
  clubId: number,
  position: Player['position'],
  n: number,
  overrides: Partial<Player> = {},
): Player[] {
  const made: Player[] = [];
  for (let i = 0; i < n; i++) {
    // goalkeeping:60 so that GK overall matches outfield overall (weights sum to
    // 1, so every position's overall becomes a flat 60 with all-60 attributes).
    const p = makePlayer({ position, clubId, attributes: { goalkeeping: 60 }, ...overrides });
    state.players[p.id] = p;
    made.push(p);
  }
  return made;
}

/** Build a full, healthy squad at exactly IDEAL_COUNTS (+ optional extras). */
function stockIdealSquad(state: GameState, clubId: number): void {
  addPlayers(state, clubId, 'GK', IDEAL_COUNTS.GK);
  addPlayers(state, clubId, 'CB', IDEAL_COUNTS.DF);
  addPlayers(state, clubId, 'CM', IDEAL_COUNTS.MF);
  addPlayers(state, clubId, 'ST', IDEAL_COUNTS.FW);
}

describe('sellThreshold', () => {
  it('orders thresholds by manager temper: aggressive > patient > impulsive', () => {
    const state = makeState(11);
    const club = state.clubs[state.userClubId];
    const manager = state.managers[club.managerId];
    const player = makePlayer({ position: 'CM', attributes: { goalkeeping: 60 } });
    state.players[player.id] = player;

    manager.temper = 'aggressive';
    const aggressive = sellThreshold(state, club, player);
    manager.temper = 'patient';
    const patient = sellThreshold(state, club, player);
    manager.temper = 'impulsive';
    const impulsive = sellThreshold(state, club, player);

    // Documented ordering: aggressive(1.35) > patient(1.2) > impulsive(0.95).
    expect(aggressive).toBeGreaterThan(patient);
    expect(patient).toBeGreaterThan(impulsive);
  });

  it('a starter costs more to prise away than an identical non-starter', () => {
    const state = makeState(12);
    const club = state.clubs[state.userClubId];
    state.managers[club.managerId].temper = 'aggressive'; // non-loyal starter mult 1.2x
    const player = makePlayer({ position: 'CM', attributes: { goalkeeping: 60 } });
    state.players[player.id] = player;

    const nonStarter = sellThreshold(state, club, player);
    club.lineup.starters = [player.id, ...club.lineup.starters];
    const starter = sellThreshold(state, club, player);

    expect(starter).toBeGreaterThan(nonStarter);
  });

  it('a transfer-listed player has a LOWER threshold (0.7x discount)', () => {
    const state = makeState(13);
    const club = state.clubs[state.userClubId];
    const player = makePlayer({ position: 'CM', attributes: { goalkeeping: 60 }, transferListed: false });
    state.players[player.id] = player;

    const notListed = sellThreshold(state, club, player);
    player.transferListed = true;
    const listed = sellThreshold(state, club, player);

    expect(listed).toBeLessThan(notListed);
  });
});

describe('aiRespondToBid', () => {
  it('rejects when the squad is too thin in the player group (and not listed)', () => {
    const state = makeState(21);
    const club = state.clubs[state.userClubId];
    clearSquad(state, club.id);
    expect(clubPlayers(state, club.id).length).toBe(0);

    // Understaff FW down to 1, giving a thin group (and a thin overall squad).
    const [striker] = addPlayers(state, club.id, 'ST', 1);
    addPlayers(state, club.id, 'CB', 4);
    addPlayers(state, club.id, 'CM', 4);
    addPlayers(state, club.id, 'GK', 2);
    striker.transferListed = false;

    const rng = createRng(999);
    const offer = makeOffer(state, striker.id, 42, club.id, 5_000_000);
    aiRespondToBid(state, rng, offer);
    expect(offer.status).toBe('rejected');
  });

  it('accepts a bid at/above sellThreshold with a well-stocked squad', () => {
    const state = makeState(22);
    const club = state.clubs[state.userClubId];
    clearSquad(state, club.id);
    expect(clubPlayers(state, club.id).length).toBe(0);
    stockIdealSquad(state, club.id); // 22 players, healthy group counts
    state.managers[club.managerId].temper = 'aggressive';

    const target = clubPlayers(state, club.id).find((p) => p.position === 'ST')!;
    const threshold = sellThreshold(state, club, target);
    const offer = makeOffer(state, target.id, 88, club.id, threshold);
    const rng = createRng(7);
    aiRespondToBid(state, rng, offer);
    expect(offer.status).toBe('accepted');
  });

  it('counters (deterministically) a >50%-of-threshold bid for a patient manager', () => {
    const state = makeState(23);
    const club = state.clubs[state.userClubId];
    clearSquad(state, club.id);
    expect(clubPlayers(state, club.id).length).toBe(0);
    stockIdealSquad(state, club.id);
    state.managers[club.managerId].temper = 'patient';

    const target = clubPlayers(state, club.id).find((p) => p.position === 'ST')!;
    const threshold = sellThreshold(state, club, target);
    const fee = Math.round(threshold * 0.7); // gap 0.7 > 0.5 -> counter for patient/shrewd

    // patient/shrewd counter decision is deterministic (no chance() roll), so two
    // different rng seeds must both produce 'countered'. Fresh offer per run so
    // each decision starts from a clean slate.
    const o1 = makeOffer(state, target.id, 91, club.id, fee);
    aiRespondToBid(state, createRng(1), o1);
    const o2 = makeOffer(state, target.id, 92, club.id, fee);
    aiRespondToBid(state, createRng(1000), o2);

    expect(o1.status).toBe('countered');
    expect(o2.status).toBe('countered');
    expect(o1.counterFee).not.toBeNull();
    expect(typeof o1.counterFee).toBe('number');
    expect(o1.counterFee!).toBeGreaterThan(0);
  });
});

/** Build a minimal TransferOffer where `toClubId` is the selling club. */
function makeOffer(
  state: GameState,
  playerId: number,
  id: number,
  sellingClubId: number,
  fee: number,
  buyingClubId = -2,
): TransferOffer {
  return {
    id,
    playerId,
    fromClubId: buyingClubId, // buying club (per type comment)
    toClubId: sellingClubId, // selling club
    fee,
    status: 'pending',
    counterFee: null,
    day: state.day,
    userInvolved: false,
    wageDemand: null,
    stage: 'fee',
  };
}

describe('completeTransfer', () => {
  it('moves money, ownership, contract, and records the (inverted) history entry', () => {
    const state = makeState(31);
    const clubIds = Object.keys(state.clubs).map(Number);
    const buyer = state.clubs[clubIds[0]];
    const seller = state.clubs[clubIds[1]];

    const player = makePlayer({ position: 'CM', clubId: seller.id, attributes: { goalkeeping: 60 } });
    state.players[player.id] = player;

    const buyerBefore = buyer.budget;
    const sellerBefore = seller.budget;
    const fee = 2_000_000;
    const wage = 45_000;

    const offer: TransferOffer = {
      id: 500,
      playerId: player.id,
      fromClubId: buyer.id, // buying club
      toClubId: seller.id, // selling club
      fee,
      status: 'pending',
      counterFee: null,
      day: state.day,
      userInvolved: false,
      wageDemand: null,
      stage: 'fee',
    };
    state.offers.push(offer);

    completeTransfer(state, offer, wage);

    expect(buyer.budget).toBe(buyerBefore - fee);
    expect(seller.budget).toBe(sellerBefore + fee);
    expect(player.clubId).toBe(buyer.id);
    expect(player.contract.wage).toBe(wage);
    expect(player.transferListed).toBe(false);
    // completeTransfer no longer resets squadNumber to 0 before calling
    // assignSquadNumbers — that line was dead code (assignSquadNumbers always
    // reassigned a fresh positive number anyway) and has been removed. This
    // assertion still exercises the real observable behavior.
    expect(player.squadNumber).toBeGreaterThan(0);
    expect(offer.status).toBe('completed');

    // TransferRecord field mapping is the intentional REVERSE of TransferOffer's
    // (documented on the TransferRecord type in types.ts): record.fromClubId :=
    // offer.toClubId (the SELLER), record.toClubId := offer.fromClubId (the
    // BUYER). Verify that exact inversion.
    const record = state.transferHistory[state.transferHistory.length - 1];
    expect(record.playerId).toBe(player.id);
    expect(record.fee).toBe(fee);
    expect(record.fromClubId).toBe(offer.toClubId); // == seller.id
    expect(record.toClubId).toBe(offer.fromClubId); // == buyer.id
    expect(record.fromClubId).toBe(seller.id);
    expect(record.toClubId).toBe(buyer.id);
  });

  it('handles free-agent purchases (toClubId -1): only the buyer pays', () => {
    const state = makeState(32);
    const buyer = state.clubs[Object.keys(state.clubs).map(Number)[0]];
    const player = makePlayer({ position: 'CM', clubId: -1, attributes: { goalkeeping: 60 } });
    state.players[player.id] = player;

    const buyerBefore = buyer.budget;
    const fee = 0;
    const offer: TransferOffer = {
      id: 600,
      playerId: player.id,
      fromClubId: buyer.id,
      toClubId: -1, // no selling club
      fee,
      status: 'accepted',
      counterFee: null,
      day: state.day,
      userInvolved: false,
      wageDemand: 5000,
      stage: 'contract',
    };
    state.offers.push(offer);

    expect(() => completeTransfer(state, offer, 5000)).not.toThrow();
    expect(buyer.budget).toBe(buyerBefore - fee);
    expect(player.clubId).toBe(buyer.id);
    expect(offer.status).toBe('completed');
  });

  it('withdraws other live offers for the same player', () => {
    const state = makeState(33);
    const clubIds = Object.keys(state.clubs).map(Number);
    const buyer = state.clubs[clubIds[0]];
    const seller = state.clubs[clubIds[1]];
    const rival = state.clubs[clubIds[2]];

    const player = makePlayer({ position: 'CM', clubId: seller.id, attributes: { goalkeeping: 60 } });
    state.players[player.id] = player;

    const winning: TransferOffer = {
      id: 700, playerId: player.id, fromClubId: buyer.id, toClubId: seller.id,
      fee: 1_000_000, status: 'pending', counterFee: null, day: state.day,
      userInvolved: false, wageDemand: null, stage: 'fee',
    };
    const rivalPending: TransferOffer = {
      id: 701, playerId: player.id, fromClubId: rival.id, toClubId: seller.id,
      fee: 900_000, status: 'pending', counterFee: null, day: state.day,
      userInvolved: false, wageDemand: null, stage: 'fee',
    };
    const rivalCountered: TransferOffer = {
      id: 702, playerId: player.id, fromClubId: rival.id, toClubId: seller.id,
      fee: 800_000, status: 'countered', counterFee: 1_100_000, day: state.day,
      userInvolved: false, wageDemand: null, stage: 'fee',
    };
    state.offers.push(winning, rivalPending, rivalCountered);

    completeTransfer(state, winning, 20_000);

    expect(rivalPending.status).toBe('withdrawn');
    expect(rivalCountered.status).toBe('withdrawn');
  });
});

describe('contractEndDay', () => {
  it('follows season*365 + (years-1)*365', () => {
    const state = makeState(41);
    state.season = 1;
    expect(contractEndDay(state, 3)).toBe(1 * 365 + (3 - 1) * 365); // 1095
    expect(contractEndDay(state, 1)).toBe(1 * 365 + 0); // 365
    state.season = 2;
    expect(contractEndDay(state, 1)).toBe(2 * 365 + 0); // 730
    expect(contractEndDay(state, 4)).toBe(2 * 365 + 3 * 365); // 1825
  });
});

describe('analyzeNeeds', () => {
  it('reports a DF quantity need (severity = deficit*2) and none for at-ideal groups', () => {
    const state = makeState(51);
    const club = state.clubs[state.userClubId];
    clearSquad(state, club.id);
    expect(clubPlayers(state, club.id).length).toBe(0);

    // DF short by 3 (4 vs ideal 7); other groups exactly at ideal with young
    // players so no quality/aging need is triggered.
    addPlayers(state, club.id, 'CB', IDEAL_COUNTS.DF - 3, { age: 25 });
    addPlayers(state, club.id, 'GK', IDEAL_COUNTS.GK, { age: 25 });
    addPlayers(state, club.id, 'CM', IDEAL_COUNTS.MF, { age: 25 });
    addPlayers(state, club.id, 'ST', IDEAL_COUNTS.FW, { age: 25 });

    const needs = analyzeNeeds(state, club);
    // Only the understaffed DF group should produce a need.
    expect(needs).toHaveLength(1);
    expect(positionGroup(needs[0].position)).toBe('DF');
    expect(needs[0].severity).toBe(3 * 2); // deficit * 2
  });
});

describe('surplusPlayers', () => {
  it('includes a clearly-surplus non-starter in an over-staffed group', () => {
    const state = makeState(61);
    const club = state.clubs[state.userClubId];
    clearSquad(state, club.id);
    expect(clubPlayers(state, club.id).length).toBe(0);

    // 22 solid players (overall 60) + 1 weak surplus FW (group FW overstaffed).
    stockIdealSquad(state, club.id);
    const [weak] = addPlayers(state, club.id, 'ST', 1, { attributes: { goalkeeping: 60, shooting: 30, pace: 30, composure: 30, dribbling: 30, strength: 30, passing: 30, vision: 30 } });
    club.lineup.starters = []; // ensure the weak player is not a starter

    // sanity: the FW group is overstaffed (surplusCount gate) and squad > 17
    const counts = positionCounts(clubPlayers(state, club.id));
    expect(counts.FW).toBeGreaterThan(IDEAL_COUNTS.FW);
    expect(clubPlayers(state, club.id).length).toBeGreaterThan(17);

    const surplus = surplusPlayers(state, club);
    expect(surplus.some((p) => p.id === weak.id)).toBe(true);
  });

  it('excludes a starter even if otherwise surplus', () => {
    const state = makeState(62);
    const club = state.clubs[state.userClubId];
    clearSquad(state, club.id);
    stockIdealSquad(state, club.id);
    const [weak] = addPlayers(state, club.id, 'ST', 1, { attributes: { goalkeeping: 60, shooting: 30, pace: 30, composure: 30, dribbling: 30, strength: 30, passing: 30, vision: 30 } });
    club.lineup.starters = [weak.id];

    const surplus = surplusPlayers(state, club);
    expect(surplus.some((p) => p.id === weak.id)).toBe(false);
  });

  it('returns [] when the squad is 17 or fewer regardless of composition', () => {
    const state = makeState(63);
    const club = state.clubs[state.userClubId];
    clearSquad(state, club.id);
    // 17 players including a would-be surplus weak FW.
    addPlayers(state, club.id, 'ST', 7, { attributes: { goalkeeping: 60, shooting: 30 } });
    addPlayers(state, club.id, 'CB', 5);
    addPlayers(state, club.id, 'CM', 3);
    addPlayers(state, club.id, 'GK', 2);
    expect(clubPlayers(state, club.id).length).toBe(17);

    expect(surplusPlayers(state, club)).toEqual([]);
  });
});

describe('sellThreshold — distress discount (WP4)', () => {
  it('a distressed firesale club accepts far less than it would when healthy', () => {
    const state = makeState(81);
    const club = state.clubs[state.userClubId];
    clearSquad(state, club.id);
    stockIdealSquad(state, club.id);
    const player = clubPlayers(state, club.id).find((p) => p.position === 'ST')!;

    club.balance = 100_000_000; // comfortable → no discount
    const healthy = sellThreshold(state, club, player);
    club.balance = -totalWages(clubPlayers(state, club.id)) * 20; // ~20 weeks under → crisis → firesale
    const firesale = sellThreshold(state, club, player);

    expect(firesale).toBeLessThan(healthy);
  });
});

describe('aiManageListings (sell-to-survive)', () => {
  it('lists sheddable players (never the squad\'s best) up to the firesale target', () => {
    const state = makeState(82);
    const club = anAiClub(state);
    club.balance = -totalWages(clubPlayers(state, club.id)) * 20; // crisis → firesale target 3
    aiManageListings(state);

    const listed = clubPlayers(state, club.id).filter((p) => p.transferListed);
    expect(listed.length).toBe(3);
    // The spine is protected: the club's single best player is never force-listed.
    const best = clubPlayers(state, club.id).reduce((m, p) => (overall(p) > overall(m) ? p : m));
    expect(listed.some((p) => p.id === best.id)).toBe(false);
  });

  it('de-lists everything once the club recovers to no pressure', () => {
    const state = makeState(83);
    const club = anAiClub(state);
    club.balance = -totalWages(clubPlayers(state, club.id)) * 20;
    aiManageListings(state);
    expect(clubPlayers(state, club.id).some((p) => p.transferListed)).toBe(true);

    club.balance = 100_000_000; // recovered
    aiManageListings(state);
    expect(clubPlayers(state, club.id).filter((p) => p.transferListed).length).toBe(0);
  });

  it('never lists into a squad already at the sale floor', () => {
    const state = makeState(84);
    const club = Object.values(state.clubs).find((c) => c.id !== state.userClubId)!;
    clearSquad(state, club.id);
    addPlayers(state, club.id, 'GK', 2);
    addPlayers(state, club.id, 'CB', 7);
    addPlayers(state, club.id, 'CM', 6);
    addPlayers(state, club.id, 'ST', 3);
    expect(clubPlayers(state, club.id).length).toBe(SALE_SQUAD_FLOOR);

    club.balance = -10_000_000; // deep crisis, but the squad can't be thinned further
    aiManageListings(state);
    expect(clubPlayers(state, club.id).filter((p) => p.transferListed).length).toBe(0);
  });
});

describe('aiClearListedMarket (buyers for distressed sales)', () => {
  it('routes a distressed club\'s listed player to a healthy club it would improve', () => {
    const state = makeState(85);
    const seller = anAiClub(state);
    seller.balance = -totalWages(clubPlayers(state, seller.id)) * 20; // firesale

    // A buyer with a weak, roomy DF group, cash to spend, and a healthy balance.
    const buyer = Object.values(state.clubs).find(
      (c) => c.id !== state.userClubId && c.id !== seller.id,
    )!;
    clearSquad(state, buyer.id);
    addPlayers(state, buyer.id, 'GK', 3);
    addPlayers(state, buyer.id, 'CB', 5, {
      attributes: { goalkeeping: 60, defending: 40, strength: 40, composure: 40 },
    });
    addPlayers(state, buyer.id, 'CM', 7);
    addPlayers(state, buyer.id, 'ST', 5);
    buyer.balance = 100_000_000;
    buyer.budget = 100_000_000;

    // A strong, listed CB at the distressed seller — a clear upgrade for the buyer.
    const star = makePlayer({
      position: 'CB', clubId: seller.id, transferListed: true,
      attributes: { goalkeeping: 60, defending: 80, strength: 80, composure: 80, pace: 75, passing: 70, workRate: 70, stamina: 70 },
    });
    state.players[star.id] = star;

    aiClearListedMarket(state, createRng(5));

    const bid = state.offers.find((o) => o.playerId === star.id && o.status === 'pending');
    expect(bid).toBeDefined();
    expect(bid!.toClubId).toBe(seller.id); // a bid ON the distressed seller's player
    expect(bid!.fromClubId).not.toBe(seller.id);
  });
});

describe('formatMoney', () => {
  it('formats across the documented branches', () => {
    expect(formatMoney(500)).toBe('£500');
    expect(formatMoney(1500)).toBe('£2K'); // Math.round(1500/1000) = 2
    expect(formatMoney(999_000)).toBe('£999K');
    expect(formatMoney(1_000_000)).toBe('£1.0M'); // < 10M -> 1 decimal
    expect(formatMoney(12_000_000)).toBe('£12M'); // >= 10M -> 0 decimals
  });
});

describe('AI transfer activity (invariants only)', () => {
  const VALID_STATUSES: OfferStatus[] = ['pending', 'accepted', 'rejected', 'countered', 'withdrawn', 'completed'];

  function assertWellFormed(state: GameState): void {
    for (const o of state.offers) {
      expect(VALID_STATUSES).toContain(o.status);
    }
    for (const c of Object.values(state.clubs)) {
      expect(Number.isFinite(c.budget)).toBe(true);
    }
  }

  it('aiTransferTick runs cleanly in an open window', () => {
    const state = makeState(71);
    state.day = 5; // summer window (season-year days 0-61) is open
    expect(isTransferWindowOpen(state.day)).toBe(true);
    const rng = createRng(123);
    expect(() => aiTransferTick(state, rng)).not.toThrow();
    assertWellFormed(state);
  });

  it('aiFollowUpCounters runs cleanly', () => {
    const state = makeState(72);
    state.day = 5;
    const rng = createRng(456);
    expect(() => aiFollowUpCounters(state, rng)).not.toThrow();
    assertWellFormed(state);
  });

  it('aiEmergencySignings runs cleanly', () => {
    const state = makeState(73);
    state.day = 5;
    const rng = createRng(789);
    expect(() => aiEmergencySignings(state, rng)).not.toThrow();
    assertWellFormed(state);
  });
});
