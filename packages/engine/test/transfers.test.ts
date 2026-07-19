import { describe, it, expect } from 'vitest';
import type { GameState, Player, TransferOffer, OfferStatus, ContractTerms } from '../src/types';
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
  dealTerms,
  meetsReleaseClause,
  counterBid,
  packageValue,
  playerContractDemand,
  respondToContractOffer,
  DEFAULT_PATIENCE,
  CONTRACT_PATIENCE,
  SALE_SQUAD_FLOOR,
} from '../src/transfers';
import { migrateState } from '../src/migrate';
import { clubPlayers, positionCounts, IDEAL_COUNTS, totalWages } from '../src/squad';
import { overall, marketValue } from '../src/player';
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
    expect(o1.counterTerms).not.toBeNull();
    expect(typeof o1.counterTerms!.fee).toBe('number');
    expect(o1.counterTerms!.fee).toBeGreaterThan(0);
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
    terms: dealTerms(fee),
    status: 'pending',
    counterTerms: null,
    rounds: 0,
    patience: DEFAULT_PATIENCE,
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
      terms: dealTerms(fee),
      status: 'pending',
      counterTerms: null,
      rounds: 0,
      patience: DEFAULT_PATIENCE,
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
      terms: dealTerms(fee),
      status: 'accepted',
      counterTerms: null,
      rounds: 0,
      patience: DEFAULT_PATIENCE,
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
      terms: dealTerms(1_000_000), status: 'pending', counterTerms: null, rounds: 0, patience: DEFAULT_PATIENCE,
      day: state.day, userInvolved: false, wageDemand: null, stage: 'fee',
    };
    const rivalPending: TransferOffer = {
      id: 701, playerId: player.id, fromClubId: rival.id, toClubId: seller.id,
      terms: dealTerms(900_000), status: 'pending', counterTerms: null, rounds: 0, patience: DEFAULT_PATIENCE,
      day: state.day, userInvolved: false, wageDemand: null, stage: 'fee',
    };
    const rivalCountered: TransferOffer = {
      id: 702, playerId: player.id, fromClubId: rival.id, toClubId: seller.id,
      terms: dealTerms(800_000), status: 'countered', counterTerms: dealTerms(1_100_000), rounds: 0, patience: DEFAULT_PATIENCE,
      day: state.day, userInvolved: false, wageDemand: null, stage: 'fee',
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

describe('completeTransfer — sell-on obligations (Transfers v2)', () => {
  it('pays a pre-existing sell-on out of the seller proceeds and records both ledgers', () => {
    const state = makeState(91);
    const clubIds = Object.keys(state.clubs).map(Number);
    const buyer = state.clubs[clubIds[0]];
    const seller = state.clubs[clubIds[1]];
    const origin = state.clubs[clubIds[2]]; // holds a 20% sell-on from a past deal

    const player = makePlayer({ position: 'CM', clubId: seller.id, attributes: { goalkeeping: 60 } });
    player.sellOn = { clubId: origin.id, pct: 20 };
    state.players[player.id] = player;

    const sellerBalance = seller.balance;
    const originBalance = origin.balance;
    const fee = 5_000_000;
    const payout = 1_000_000; // 20% of 5M

    const offer = makeOffer(state, player.id, 910, seller.id, fee, buyer.id);
    completeTransfer(state, offer, 30_000);

    // Beneficiary receives its cut; seller nets fee minus the payout.
    expect(origin.balance).toBe(originBalance + payout);
    expect(origin.ledger.playerSales).toBe(payout);
    expect(seller.balance).toBe(sellerBalance + fee - payout);
    // The obligation is cleared once paid (no sell-on carried on this deal).
    expect(player.sellOn).toBeNull();
  });

  it('records a new sell-on obligation from the deal terms', () => {
    const state = makeState(92);
    const clubIds = Object.keys(state.clubs).map(Number);
    const buyer = state.clubs[clubIds[0]];
    const seller = state.clubs[clubIds[1]];

    const player = makePlayer({ position: 'CM', clubId: seller.id, attributes: { goalkeeping: 60 } });
    state.players[player.id] = player;

    const offer = makeOffer(state, player.id, 920, seller.id, 3_000_000, buyer.id);
    offer.terms.sellOnPct = 15;
    completeTransfer(state, offer, 25_000);

    expect(player.sellOn).toEqual({ clubId: seller.id, pct: 15 });
  });
});

describe('completeTransfer — signing bonus (Transfers v2)', () => {
  it('debits the signing bonus to the buyer bonuses ledger', () => {
    const state = makeState(93);
    const clubIds = Object.keys(state.clubs).map(Number);
    const buyer = state.clubs[clubIds[0]];
    const seller = state.clubs[clubIds[1]];

    const player = makePlayer({ position: 'CM', clubId: seller.id, attributes: { goalkeeping: 60 } });
    state.players[player.id] = player;

    const buyerBalance = buyer.balance;
    const fee = 2_000_000;
    const contract: ContractTerms = {
      wage: 40_000, years: 4, signingBonus: 500_000,
      goalBonus: 5_000, releaseClause: 12_000_000,
    };

    const offer = makeOffer(state, player.id, 930, seller.id, fee, buyer.id);
    completeTransfer(state, offer, contract.wage, contract);

    expect(buyer.ledger.bonuses).toBe(-500_000);
    expect(buyer.balance).toBe(buyerBalance - fee - 500_000);
    // Contract clauses land on the signed player for the sim to pay out later.
    expect(player.contract.goalBonus).toBe(5_000);
    expect(player.contract.releaseClause).toBe(12_000_000);
  });
});

describe('completeTransfer — player swaps (Transfers v2 P5)', () => {
  it('moves both players to opposite clubs; the swap player joins on a fresh contract with no pay cut', () => {
    const state = makeState(301);
    const buyer = state.clubs[state.userClubId];
    const seller = Object.values(state.clubs).find((c) => c.id !== buyer.id)!;

    const player = makePlayer({ position: 'ST', clubId: seller.id, attributes: { goalkeeping: 60 } });
    const swap = makePlayer({
      position: 'CM', clubId: buyer.id, age: 24,
      contract: { wage: 200_000, expiresDay: 365, releaseClause: null, goalBonus: 0 },
      attributes: { goalkeeping: 60 },
    });
    state.players[player.id] = player;
    state.players[swap.id] = swap;

    const offer = makeOffer(state, player.id, 3010, seller.id, 1_000_000, buyer.id);
    offer.terms.swapPlayerId = swap.id;
    completeTransfer(state, offer, 30_000);

    expect(player.clubId).toBe(buyer.id);
    expect(swap.clubId).toBe(seller.id);
    // He won't take a pay cut to be traded: his current wage is a floor.
    expect(swap.contract.wage).toBe(200_000);
    expect(swap.contract.expiresDay).toBeGreaterThan(state.day);
    expect(swap.transferListed).toBe(false);
    expect(swap.sellOn).toBeNull();
    expect(swap.squadNumber).toBeGreaterThan(0);
  });

  it('records transfer history and news naming both players', () => {
    const state = makeState(302);
    const buyer = state.clubs[state.userClubId];
    const seller = Object.values(state.clubs).find((c) => c.id !== buyer.id)!;

    const player = makePlayer({ position: 'ST', clubId: seller.id, attributes: { goalkeeping: 60 } });
    const swap = makePlayer({ position: 'CM', clubId: buyer.id, attributes: { goalkeeping: 60 } });
    state.players[player.id] = player;
    state.players[swap.id] = swap;
    const newsBefore = state.news.length;

    const offer = makeOffer(state, player.id, 3020, seller.id, 800_000, buyer.id);
    offer.terms.swapPlayerId = swap.id;
    completeTransfer(state, offer, 25_000);

    const mainRecord = state.transferHistory.find((r) => r.playerId === player.id)!;
    expect(mainRecord.fromClubId).toBe(seller.id);
    expect(mainRecord.toClubId).toBe(buyer.id);

    const swapRecord = state.transferHistory.find((r) => r.playerId === swap.id)!;
    expect(swapRecord).toBeDefined();
    expect(swapRecord.fromClubId).toBe(buyer.id); // his old club
    expect(swapRecord.toClubId).toBe(seller.id); // his new club
    expect(swapRecord.fee).toBeGreaterThan(0); // valued component, not free

    // Two news items were stored (user is the buyer), one per player.
    expect(state.news.length).toBe(newsBefore + 2);
    expect(state.news.some((n) => n.title.includes(swap.lastName))).toBe(true);
  });

  it('settles a sell-on obligation on the swap player and keeps every ledger balanced', () => {
    const state = makeState(303);
    const buyer = state.clubs[state.userClubId];
    const others = Object.values(state.clubs).filter((c) => c.id !== buyer.id);
    const seller = others[0];
    const origin = others[1]; // holds a 20% sell-on on the swap player

    const player = makePlayer({ position: 'ST', clubId: seller.id, attributes: { goalkeeping: 60 } });
    const swap = makePlayer({
      position: 'CM', clubId: buyer.id,
      attributes: { goalkeeping: 60, passing: 78, vision: 78, dribbling: 78, shooting: 78, defending: 78, composure: 78, stamina: 78, workRate: 78 },
    });
    swap.sellOn = { clubId: origin.id, pct: 20 };
    state.players[player.id] = player;
    state.players[swap.id] = swap;

    const buyerBefore = buyer.balance;
    const sellerBefore = seller.balance;
    const originBefore = origin.balance;
    const fee = 1_500_000;

    const offer = makeOffer(state, player.id, 3030, seller.id, fee, buyer.id);
    offer.terms.swapPlayerId = swap.id;
    completeTransfer(state, offer, 30_000);

    // The buyer (the swap player's seller here) funds the sell-on payout.
    const payout = origin.balance - originBefore;
    expect(payout).toBeGreaterThan(0);
    expect(origin.ledger.playerSales).toBe(payout);
    expect(buyer.balance).toBe(buyerBefore - fee - payout);
    expect(seller.balance).toBe(sellerBefore + fee);
    expect(swap.sellOn).toBeNull(); // obligation cleared once settled
  });

  it('falls back to cash-only when the swap player no longer belongs to the buyer', () => {
    const state = makeState(304);
    const buyer = state.clubs[state.userClubId];
    const seller = Object.values(state.clubs).find((c) => c.id !== buyer.id)!;

    const player = makePlayer({ position: 'ST', clubId: seller.id, attributes: { goalkeeping: 60 } });
    state.players[player.id] = player;

    const buyerBefore = buyer.balance;
    const fee = 900_000;
    const historyBefore = state.transferHistory.length;

    const offer = makeOffer(state, player.id, 3040, seller.id, fee, buyer.id);
    offer.terms.swapPlayerId = 999_999; // vanished / never existed
    expect(() => completeTransfer(state, offer, 25_000)).not.toThrow();

    expect(player.clubId).toBe(buyer.id); // main deal still completes
    expect(buyer.balance).toBe(buyerBefore - fee); // no extra compensation, agreed fee stands
    expect(state.transferHistory.length).toBe(historyBefore + 1); // only the main move recorded
  });

  it('completes cash-only rather than strip the buyer of its last goalkeeper', () => {
    const state = makeState(305);
    const buyer = state.clubs[state.userClubId];
    clearSquad(state, buyer.id);
    const [keeper] = addPlayers(state, buyer.id, 'GK', 1);
    addPlayers(state, buyer.id, 'CB', 6);
    addPlayers(state, buyer.id, 'CM', 6);
    addPlayers(state, buyer.id, 'ST', 5);
    const seller = Object.values(state.clubs).find((c) => c.id !== buyer.id)!;

    const player = makePlayer({ position: 'ST', clubId: seller.id, attributes: { goalkeeping: 60 } });
    state.players[player.id] = player;

    const offer = makeOffer(state, player.id, 3050, seller.id, 700_000, buyer.id);
    offer.terms.swapPlayerId = keeper.id;
    completeTransfer(state, offer, 20_000);

    expect(keeper.clubId).toBe(buyer.id); // last keeper stays put
    expect(player.clubId).toBe(buyer.id); // main deal still completes
    expect(state.transferHistory.some((r) => r.playerId === keeper.id)).toBe(false);
  });
});

describe('release clause (Transfers v2)', () => {
  it('meetsReleaseClause is true only at or above a set clause', () => {
    const p = makePlayer({ contract: { wage: 1000, expiresDay: 365, releaseClause: 10_000_000, goalBonus: 0 } });
    expect(meetsReleaseClause(p, 9_999_999)).toBe(false);
    expect(meetsReleaseClause(p, 10_000_000)).toBe(true);
    p.contract.releaseClause = null;
    expect(meetsReleaseClause(p, 999_000_000)).toBe(false);
  });

  it('aiRespondToBid auto-accepts a clause-meeting bid even when the squad is too thin to sell', () => {
    const state = makeState(101);
    const club = state.clubs[state.userClubId];
    clearSquad(state, club.id);
    const [striker] = addPlayers(state, club.id, 'ST', 1); // thin FW group + thin squad
    addPlayers(state, club.id, 'CB', 4);
    addPlayers(state, club.id, 'CM', 4);
    addPlayers(state, club.id, 'GK', 2);
    striker.contract.releaseClause = 3_000_000;

    // A bid below the clause on this thin squad is rejected...
    const low = makeOffer(state, striker.id, 1, club.id, 2_000_000);
    aiRespondToBid(state, createRng(1), low);
    expect(low.status).toBe('rejected');

    // ...but one meeting the clause is accepted regardless of squad depth.
    const atClause = makeOffer(state, striker.id, 2, club.id, 3_000_000);
    aiRespondToBid(state, createRng(1), atClause);
    expect(atClause.status).toBe('accepted');
  });
});

describe('migrateState v5 -> v6 (Transfers v2 shape)', () => {
  it('backfills contract/sell-on/offer/ledger defaults on an old-shape save', () => {
    const state = makeState(111);
    state.schemaVersion = 5;

    // Strip a player back to the v5 contract shape (no clause/bonuses/sellOn).
    const player = Object.values(state.players)[0];
    const legacyContract = player.contract as { releaseClause?: unknown; goalBonus?: unknown };
    delete legacyContract.releaseClause;
    delete legacyContract.goalBonus;
    delete (player as { sellOn?: unknown }).sellOn;

    // A v5-shape offer with the flat fee/counterFee pair and no terms.
    state.offers.push({
      id: 9999, playerId: player.id, fromClubId: state.userClubId, toClubId: player.clubId,
      fee: 4_000_000, status: 'countered', counterFee: 5_000_000, day: state.day,
      userInvolved: true, wageDemand: null, stage: 'fee',
    } as unknown as TransferOffer);

    // A v5-shape ledger with no bonuses category.
    const club = state.clubs[state.userClubId];
    delete (club.ledger as { bonuses?: unknown }).bonuses;

    migrateState(state);

    expect(state.schemaVersion).toBeGreaterThanOrEqual(6);
    expect(player.contract.releaseClause).toBeNull();
    expect(player.contract.goalBonus).toBe(0);
    expect(player.sellOn).toBeNull();

    const migrated = state.offers.find((o) => o.id === 9999)!;
    expect(migrated.terms).toEqual({ fee: 4_000_000, sellOnPct: 0, swapPlayerId: null });
    expect(migrated.counterTerms).toEqual({ fee: 5_000_000, sellOnPct: 0, swapPlayerId: null });
    expect(migrated.rounds).toBe(0);
    expect(migrated.patience).toBe(DEFAULT_PATIENCE);
    expect((migrated as unknown as { fee?: number }).fee).toBeUndefined();

    expect(club.ledger.bonuses).toBe(0);
  });
});

// --- P2: package valuation & instant negotiation ---

/** A well-stocked selling club with a patient (deterministic) negotiator, and
 * the striker a bid will be made for. */
function sellerWithStriker(seed: number) {
  const state = makeState(seed);
  const club = state.clubs[state.userClubId];
  clearSquad(state, club.id);
  stockIdealSquad(state, club.id);
  state.managers[club.managerId].temper = 'patient';
  const target = clubPlayers(state, club.id).find((p) => p.position === 'ST')!;
  return { state, club, target };
}

describe('packageValue', () => {
  it('a sell-on % raises the value of a package to the seller', () => {
    const { state, club, target } = sellerWithStriker(201);
    const cash = packageValue(state, club, target, dealTerms(2_000_000, 0));
    const withSellOn = packageValue(state, club, target, dealTerms(2_000_000, 20));
    expect(withSellOn).toBeGreaterThan(cash);
  });

  it('a swap player adds his value-to-the-club on top of the cash fee', () => {
    const { state, club, target } = sellerWithStriker(202);
    const swap = makePlayer({ position: 'CM', attributes: { goalkeeping: 60 } });
    state.players[swap.id] = swap;
    const cash = packageValue(state, club, target, dealTerms(1_000_000));
    const withSwap = packageValue(state, club, target, dealTerms(1_000_000, 0, swap.id));
    expect(withSwap).toBeGreaterThan(cash);
    // The uplift is around the swap's market value, not wildly more.
    expect(withSwap - cash).toBeLessThan(marketValue(swap, state.day) * 1.3);
  });
});

describe('instant fee negotiation (aiRespondToBid / counterBid)', () => {
  it('a swap player turns a below-reservation cash bid into an accepted one', () => {
    const { state, club, target } = sellerWithStriker(203);
    const reservation = sellThreshold(state, club, target);
    const cashFee = Math.round(reservation * 0.7);

    const cashOnly = makeOffer(state, target.id, 1, club.id, cashFee);
    aiRespondToBid(state, createRng(1), cashOnly);
    expect(cashOnly.status).toBe('countered'); // cash alone falls short

    // A valuable swap on the same cash closes the gap.
    const strongSwap = makePlayer({
      position: 'CM',
      attributes: { goalkeeping: 60, passing: 78, vision: 78, dribbling: 78, stamina: 78, workRate: 78, defending: 78, composure: 78, shooting: 78 },
    });
    state.players[strongSwap.id] = strongSwap;
    const withSwap = makeOffer(state, target.id, 2, club.id, cashFee);
    withSwap.terms.swapPlayerId = strongSwap.id;
    aiRespondToBid(state, createRng(1), withSwap);
    expect(withSwap.status).toBe('accepted');
  });

  it('an AI seller ignores a swap whose wage it cannot afford', () => {
    const state = makeState(207);
    const seller = anAiClub(state);
    clearSquad(state, seller.id);
    stockIdealSquad(state, seller.id);
    state.managers[seller.managerId].temper = 'patient';
    const target = clubPlayers(state, seller.id).find((p) => p.position === 'ST')!;
    const reservation = sellThreshold(state, seller, target);
    const cashFee = Math.round(reservation * 0.7);

    const buyer = state.clubs[state.userClubId];
    const strongSwap = makePlayer({
      position: 'CM', clubId: buyer.id,
      contract: { wage: 400_000, expiresDay: 365 * 3, releaseClause: null, goalBonus: 0 },
      attributes: { goalkeeping: 60, passing: 78, vision: 78, dribbling: 78, stamina: 78, workRate: 78, defending: 78, composure: 78, shooting: 78 },
    });
    state.players[strongSwap.id] = strongSwap;

    // Tight cap: absorbing the swap's wage would blow the budget → swap ignored,
    // so the below-reservation cash bid only earns a counter.
    seller.wageBudget = totalWages(clubPlayers(state, seller.id));
    const tight = makeOffer(state, target.id, 1, seller.id, cashFee, buyer.id);
    tight.terms.swapPlayerId = strongSwap.id;
    aiRespondToBid(state, createRng(1), tight);
    expect(tight.status).toBe('countered');

    // Roomy cap: the same swap now counts and clears the reservation.
    seller.wageBudget = 100_000_000;
    const roomy = makeOffer(state, target.id, 2, seller.id, cashFee, buyer.id);
    roomy.terms.swapPlayerId = strongSwap.id;
    aiRespondToBid(state, createRng(1), roomy);
    expect(roomy.status).toBe('accepted');
  });

  it('a sell-on % lowers the cash fee a seller will accept', () => {
    const { state, club, target } = sellerWithStriker(204);
    const reservation = sellThreshold(state, club, target);
    const fee = Math.round(reservation * 0.95); // just short on cash

    const cashOnly = makeOffer(state, target.id, 1, club.id, fee);
    aiRespondToBid(state, createRng(1), cashOnly);
    expect(cashOnly.status).toBe('countered');

    const withSellOn = makeOffer(state, target.id, 2, club.id, fee);
    withSellOn.terms.sellOnPct = 25;
    aiRespondToBid(state, createRng(1), withSellOn);
    expect(withSellOn.status).toBe('accepted');
  });

  it('the concession curve converges: each counter drops toward the reservation', () => {
    const { state, club, target } = sellerWithStriker(205);
    const reservation = sellThreshold(state, club, target);
    const lowball = dealTerms(Math.round(reservation * 0.55)); // above the insult floor

    const offer = makeOffer(state, target.id, 1, club.id, lowball.fee);
    offer.patience = 8; // room to watch several rounds
    aiRespondToBid(state, createRng(1), offer);

    const fees: number[] = [];
    while (offer.status === 'countered' && fees.length < 5) {
      fees.push(offer.counterTerms!.fee);
      counterBid(state, createRng(1), offer, lowball);
    }

    expect(fees.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < fees.length; i++) {
      expect(fees[i]).toBeLessThan(fees[i - 1]); // strictly decreasing
      expect(fees[i]).toBeGreaterThanOrEqual(reservation); // never below the floor
    }
    // Converging: the later gap to the reservation is a fraction of the first.
    const firstGap = fees[0] - reservation;
    const lastGap = fees[fees.length - 1] - reservation;
    expect(lastGap).toBeLessThan(firstGap * 0.6);
  });

  it('walks away (withdrawn) once patience is exhausted by repeated lowballs', () => {
    const { state, club, target } = sellerWithStriker(206);
    const reservation = sellThreshold(state, club, target);
    const lowball = dealTerms(Math.round(reservation * 0.7));

    const offer = makeOffer(state, target.id, 1, club.id, lowball.fee);
    expect(offer.patience).toBe(DEFAULT_PATIENCE);
    aiRespondToBid(state, createRng(1), offer);

    let guard = 0;
    while (offer.status === 'countered' && guard++ < 10) {
      counterBid(state, createRng(1), offer, lowball);
    }
    expect(offer.status).toBe('withdrawn');
  });
});

describe('playerContractDemand', () => {
  it('transfer demands exceed renewal demands for a settled player', () => {
    const state = makeState(211);
    const club = state.clubs[state.userClubId];
    const player = makePlayer({
      position: 'ST', clubId: club.id, age: 25, morale: 70,
      attributes: { goalkeeping: 60, shooting: 78, pace: 78, composure: 78, dribbling: 78, strength: 78, passing: 78, vision: 78 },
    });
    state.players[player.id] = player;

    const transfer = playerContractDemand(state, player, 'transfer');
    const renewal = playerContractDemand(state, player, 'renewal');

    expect(transfer.wage).toBeGreaterThan(renewal.wage); // a move needs a raise
    expect(transfer.signingBonus).toBeGreaterThan(renewal.signingBonus);
    // Contract length follows age (25 -> 4 yrs) regardless of kind.
    expect(transfer.years).toBe(renewal.years);
    expect(renewal.years).toBe(4);
  });

  it('the young want long deals; veterans want short ones', () => {
    const state = makeState(212);
    const young = makePlayer({ age: 20, clubId: state.userClubId });
    const veteran = makePlayer({ age: 34, clubId: state.userClubId });
    state.players[young.id] = young;
    state.players[veteran.id] = veteran;
    expect(playerContractDemand(state, young, 'renewal').years).toBeGreaterThan(
      playerContractDemand(state, veteran, 'renewal').years,
    );
  });

  it('an unhappy player renews for more than a happy one', () => {
    const state = makeState(213);
    const club = state.clubs[state.userClubId];
    const base = { position: 'CM' as const, clubId: club.id, age: 26, attributes: { goalkeeping: 60 } };
    const unhappy = makePlayer({ ...base, morale: 20 });
    const happy = makePlayer({ ...base, morale: 90 });
    state.players[unhappy.id] = unhappy;
    state.players[happy.id] = happy;
    expect(playerContractDemand(state, unhappy, 'renewal').wage).toBeGreaterThan(
      playerContractDemand(state, happy, 'renewal').wage,
    );
  });
});

describe('respondToContractOffer', () => {
  function contractPlayer(seed: number) {
    const state = makeState(seed);
    const club = state.clubs[state.userClubId];
    const player = makePlayer({
      position: 'ST', clubId: club.id, age: 26, morale: 70,
      attributes: { goalkeeping: 60, shooting: 76, pace: 76, composure: 76, dribbling: 76, strength: 76, passing: 76, vision: 76 },
    });
    state.players[player.id] = player;
    return { state, player };
  }

  it('accepts the player’s own stated demand', () => {
    const { state, player } = contractPlayer(221);
    const demand = playerContractDemand(state, player, 'transfer');
    expect(respondToContractOffer(state, createRng(1), player.id, demand, 'transfer')).toBe('accept');
    expect(player.contractTalk).toBeNull(); // talks cleared on acceptance
  });

  it('a release clause lets a below-demand wage clear (lowers the wage demand)', () => {
    const { state, player } = contractPlayer(222);
    const demand = playerContractDemand(state, player, 'transfer');
    const lean: ContractTerms = { ...demand, wage: Math.round((demand.wage * 0.9) / 100) * 100 };

    // The lean wage alone doesn't clear...
    expect(respondToContractOffer(state, createRng(1), player.id, lean, 'transfer')).not.toBe('accept');
    player.contractTalk = null; // reset the negotiation
    // ...but adding a tight release clause makes the same wage acceptable.
    const withClause: ContractTerms = { ...lean, releaseClause: marketValue(player, state.day) };
    expect(respondToContractOffer(state, createRng(1), player.id, withClause, 'transfer')).toBe('accept');
  });

  it('richer bonuses let a below-demand wage clear', () => {
    const { state, player } = contractPlayer(223);
    const demand = playerContractDemand(state, player, 'transfer');
    const lean: ContractTerms = { ...demand, wage: Math.round((demand.wage * 0.9) / 100) * 100 };

    expect(respondToContractOffer(state, createRng(1), player.id, lean, 'transfer')).not.toBe('accept');
    player.contractTalk = null;
    const richBonuses: ContractTerms = {
      ...lean,
      signingBonus: lean.signingBonus + demand.wage * 40,
      goalBonus: lean.goalBonus + 20_000,
    };
    expect(respondToContractOffer(state, createRng(1), player.id, richBonuses, 'transfer')).toBe('accept');
  });

  it('counters a middling offer, then rejects once patience is exhausted', () => {
    const { state, player } = contractPlayer(224);
    const demand = playerContractDemand(state, player, 'transfer');
    const middling: ContractTerms = { ...demand, wage: Math.round((demand.wage * 0.85) / 100) * 100 };

    // Each call spends a round of patience; the (patience+1)th walks away. (A
    // reject clears contractTalk, so calling further would reopen fresh talks.)
    const outcomes: string[] = [];
    for (let i = 0; i < CONTRACT_PATIENCE + 1; i++) {
      outcomes.push(respondToContractOffer(state, createRng(1), player.id, middling, 'transfer'));
    }
    expect(outcomes.slice(0, CONTRACT_PATIENCE)).toEqual(Array(CONTRACT_PATIENCE).fill('counter'));
    expect(outcomes[CONTRACT_PATIENCE]).toBe('reject'); // walked away
    expect(player.contractTalk).toBeNull();
  });

  it('rejects an insulting lowball outright', () => {
    const { state, player } = contractPlayer(225);
    const demand = playerContractDemand(state, player, 'transfer');
    const insult: ContractTerms = { ...demand, wage: Math.round((demand.wage * 0.4) / 100) * 100, signingBonus: 0, goalBonus: 0 };
    expect(respondToContractOffer(state, createRng(1), player.id, insult, 'transfer')).toBe('reject');
  });

  it('a counter keeps the club’s structure and only raises the wage', () => {
    const { state, player } = contractPlayer(226);
    const demand = playerContractDemand(state, player, 'transfer');
    const middling: ContractTerms = { ...demand, wage: Math.round((demand.wage * 0.85) / 100) * 100 };
    respondToContractOffer(state, createRng(1), player.id, middling, 'transfer');
    const counter = player.contractTalk!.counter!;
    expect(counter.years).toBe(middling.years);
    expect(counter.signingBonus).toBe(middling.signingBonus);
    expect(counter.wage).toBeGreaterThan(middling.wage);
  });
});
