import type { GameState, Club, Player, TransferOffer, AiManager, ManagerTemper, Position, PositionGroup, OfferStatus, DealTerms, ContractTerms } from './types';
import { type Rng, chance, pick, weightedPick, clamp, randInt } from './rng';
import { marketValue, wageDemand, overall, fullName } from './player';
import { clubPlayers, positionCounts, IDEAL_COUNTS, squadStrength, totalWages, refreshClubLineup } from './squad';
import { FORMATIONS, positionGroup, familiarity } from './tactics';
import { isTransferWindowOpen } from './calendar';
import { assignSquadNumbers } from './world';
import { addNews } from './news';
import { recordMoney, sellPressure, type SellPressure, WEEKS_PER_SEASON } from './finance';

/**
 * Squad size below which an AI club stops selling — even a firesale won't take
 * a club to or below this many players. Sits one clear of the emergency
 * free-agent threshold (`aiEmergencySignings`, squad < 17) so a voluntary sale
 * never forces a £0 panic signing.
 */
export const SALE_SQUAD_FLOOR = 18;

/** Negotiation rounds a selling side entertains before walking away. */
export const DEFAULT_PATIENCE = 3;

/** Rounds a player entertains a contract before rejecting outright. */
export const CONTRACT_PATIENCE = 3;

/** How far above its reservation (sellThreshold) a seller opens the bidding,
 * keyed by manager temper. A concession curve decays the ask back to the
 * reservation over the rounds. */
const ASK_PREMIUM: Record<ManagerTemper, number> = {
  aggressive: 1.3, loyal: 1.22, shrewd: 1.2, patient: 1.15, impulsive: 1.05,
};

/** Each round the seller's ask closes this share of the remaining gap to its
 * reservation, so the counter converges to the reservation as rounds mount. */
const CONCESSION_DECAY = 0.5;

/** A package worth less than this fraction of the reservation is an insult: the
 * seller walks away (or rejects a first-round lowball) rather than haggle. */
const INSULT_RATIO = 0.5;

/** A cash-only fee stage with no sell-on clause or swap. */
export function dealTerms(fee: number, sellOnPct = 0, swapPlayerId: number | null = null): DealTerms {
  return { fee, sellOnPct, swapPlayerId };
}

/** True when a bid meets a player's release clause, which any seller must honor. */
export function meetsReleaseClause(player: Player, fee: number): boolean {
  return player.contract.releaseClause !== null && fee >= player.contract.releaseClause;
}

// ---- Valuation & negotiation thresholds ----

/** Minimum fee at which this AI club will accept a bid for the player. */
export function sellThreshold(state: GameState, club: Club, player: Player): number {
  const manager = state.managers[club.managerId];
  const value = marketValue(player, state.day);
  let mult = 1.1;
  switch (manager?.temper) {
    case 'aggressive': mult = 1.35; break;
    case 'patient': mult = 1.2; break;
    case 'shrewd': mult = 1.25; break;
    case 'impulsive': mult = 0.95; break;
    case 'loyal': mult = 1.15; break;
  }
  // Key starters cost much more to prise away.
  const isStarter = club.lineup.starters.includes(player.id);
  if (isStarter && manager?.temper === 'loyal') mult *= 1.45;
  else if (isStarter) mult *= 1.2;
  if (player.transferListed) mult *= 0.7;
  // Squad depth: surplus players go cheaper.
  const squad = clubPlayers(state, club.id);
  const counts = positionCounts(squad);
  const group = positionGroup(player.position);
  if (counts[group] > IDEAL_COUNTS[group]) mult *= 0.85;
  // Distress discount (WP4): the more desperate the seller is for cash, the
  // lower the fee it will accept. A club that needs the money now can't hold
  // out for full value — getting the wage off the books matters more than the
  // last few percent of the fee. Stacks with the transfer-listed discount.
  mult *= DISTRESS_DISCOUNT[sellPressure(club, totalWages(squad))];
  return Math.round((value * mult) / 5000) * 5000;
}

/** Fee multiplier a distressed seller will drop to, keyed by financial stress. */
const DISTRESS_DISCOUNT: Record<SellPressure, number> = {
  none: 1,
  trim: 1, // still solvent: list surplus but hold out near full value
  sell: 0.85, // in the red: take ~15% under
  firesale: 0.6, // deep in the red: move players fast at a steep cut
};

/**
 * How an AI club responds to a bid on its player. Personality-driven instant
 * negotiation: the seller accepts once the *package* (fee + swap + sell-on
 * upside) clears its reservation (`sellThreshold`); otherwise it concedes down a
 * temper-shaped curve, spending a round of `patience` each time, and walks away
 * once patience is spent or the bid is an outright insult. Deterministic given
 * the offer's round/patience counters; `counterBid` drives the rounds.
 */
export function aiRespondToBid(state: GameState, rng: Rng, offer: TransferOffer): void {
  const club = state.clubs[offer.toClubId];
  const player = state.players[offer.playerId];
  const manager = state.managers[club.managerId];

  // A bid at or above the release clause is honored no matter the squad state.
  if (meetsReleaseClause(player, offer.terms.fee)) {
    offer.status = 'accepted';
    return;
  }

  // Squad too thin to sell at all?
  const squad = clubPlayers(state, club.id);
  const counts = positionCounts(squad);
  const group = positionGroup(player.position);
  const groupThin = counts[group] <= Math.max(1, IDEAL_COUNTS[group] - 2);

  // Hard viability floor (WP4): never sell below `SALE_SQUAD_FLOOR`, even for a
  // transfer-listed player and even in a firesale. This keeps a distressed club
  // from being stripped to a husk, and keeps it clear of the emergency
  // free-agent threshold (`aiEmergencySignings`, squad < 17) so a self-inflicted
  // sale never forces a £0 panic signing. A listed player may still be sold when
  // his position group is merely thin (that's the point of listing him), but not
  // when the whole squad is at the floor.
  if (squad.length <= SALE_SQUAD_FLOOR || (groupThin && !player.transferListed)) {
    offer.status = 'rejected';
    return;
  }

  const reservation = sellThreshold(state, club, player);
  // Wage-budget sanity: an AI seller only values a swap it can actually carry —
  // taking on the swap player's wage (net of the wage it sheds selling `player`)
  // must not blow its wage cap. A swap it can't afford simply doesn't count
  // toward the package, so the club responds on cash + sell-on alone.
  const evalTerms = affordableTerms(state, club, player, offer.terms);
  const value = packageValue(state, club, player, evalTerms);
  if (value >= reservation) {
    offer.status = 'accepted';
    return;
  }

  // Below the reservation: walk away on an insult or once patience is spent,
  // otherwise concede down the curve. A first-round insult is a flat rejection;
  // a later one is a walk-away.
  const ratio = value / reservation;
  if (ratio < INSULT_RATIO || offer.patience <= 0) {
    offer.status = offer.rounds > 0 ? 'withdrawn' : 'rejected';
    return;
  }
  // Patient/shrewd negotiators always engage above the insult floor; the rest
  // need a respectable opening and a little luck.
  const engages = manager?.temper === 'patient' || manager?.temper === 'shrewd'
    ? true
    : ratio > 0.6 && chance(rng, 0.75);
  if (!engages) {
    offer.status = 'rejected';
    return;
  }

  offer.patience--;
  offer.status = 'countered';
  offer.counterTerms = { ...offer.terms, fee: concededFee(state, club, player, offer, reservation, evalTerms) };
}

/**
 * The deal terms an AI seller will actually price: `terms` as offered, except a
 * swap player whose wage the seller can't absorb is dropped for valuation
 * purposes (an unaffordable swap adds nothing to the package). The user's own
 * club is never wage-gated here — it makes its own choices. Cheap by design.
 */
function affordableTerms(state: GameState, seller: Club, mainPlayer: Player, terms: DealTerms): DealTerms {
  if (terms.swapPlayerId === null || seller.id === state.userClubId) return terms;
  const swap = state.players[terms.swapPlayerId];
  if (!swap) return terms;
  const squad = clubPlayers(state, seller.id);
  const newWages = totalWages(squad) - mainPlayer.contract.wage + swapContractWage(seller, swap);
  return newWages <= seller.wageBudget * 1.1 ? terms : { ...terms, swapPlayerId: null };
}

/** The weekly wage a club would put a swap player on: his market-driven demand,
 * but never a cut below his current wage — he won't take less to be traded. */
function swapContractWage(club: Club, swap: Player): number {
  return Math.max(wageDemand(overall(swap), swap.age, club.reputation), swap.contract.wage);
}

/**
 * The fee the seller counters with this round: its reservation plus a
 * temper-driven premium that decays toward the reservation as rounds mount,
 * minus the non-cash value already on the table (swap player + sell-on upside),
 * so a richer package leaves less cash for the seller to demand. Never dips
 * below the fee already offered.
 */
function concededFee(state: GameState, club: Club, player: Player, offer: TransferOffer, reservation: number, evalTerms: DealTerms): number {
  const manager = state.managers[club.managerId];
  const premium = ASK_PREMIUM[manager?.temper ?? 'patient'];
  const ask = reservation + reservation * (premium - 1) * Math.pow(CONCESSION_DECAY, offer.rounds);
  const nonCash = packageValue(state, club, player, { ...evalTerms, fee: 0 });
  const feeAsk = Math.max(offer.terms.fee, ask - nonCash);
  return Math.round(feeAsk / 5000) * 5000;
}

// ---- Executing transfers ----

export function completeTransfer(state: GameState, offer: TransferOffer, wage: number, contract?: ContractTerms): void {
  const player = state.players[offer.playerId];
  const from = state.clubs[offer.fromClubId]; // buyer
  const to = offer.toClubId >= 0 ? state.clubs[offer.toClubId] : null; // seller
  const fee = offer.terms.fee;

  // Pay out a sell-on obligation left by the player's PREVIOUS move: the club
  // that holds it takes its cut of this sale's fee out of the seller's proceeds.
  if (to && fee > 0 && player.sellOn) {
    const beneficiary = state.clubs[player.sellOn.clubId];
    if (beneficiary && beneficiary.id !== to.id) {
      const payout = Math.round((fee * player.sellOn.pct) / 100);
      if (payout > 0) {
        recordMoney(to, 'playerSales', -payout);
        recordMoney(beneficiary, 'playerSales', payout);
      }
    }
  }

  from.budget -= fee;
  if (to) to.budget += fee;
  // Allocations moved above; now move the real cash. The buyer's balance drops
  // by the fee, the seller's rises by it (free-agent deals have fee 0, a no-op).
  recordMoney(from, 'transferFees', -fee);
  if (to) recordMoney(to, 'playerSales', fee);

  // One-time signing bonus paid to the player by the buyer.
  const signingBonus = contract?.signingBonus ?? 0;
  if (signingBonus > 0) recordMoney(from, 'bonuses', -signingBonus);

  player.clubId = from.id;
  const years = contract?.years ?? randInt(createRngFromState(state), 2, 4);
  player.contract = {
    wage,
    expiresDay: contractEndDay(state, years),
    releaseClause: contract?.releaseClause ?? null,
    goalBonus: contract?.goalBonus ?? 0,
  };
  // Record (or clear) the sell-on obligation created by THIS deal: the selling
  // club is owed a cut of the player's next sale.
  player.sellOn = to && offer.terms.sellOnPct > 0
    ? { clubId: to.id, pct: offer.terms.sellOnPct }
    : null;
  player.transferListed = false;
  player.morale = clamp(player.morale + 10, 0, 100);
  offer.status = 'completed';
  offer.stage = 'done';

  state.transferHistory.push({
    season: state.season,
    day: state.day,
    playerId: player.id,
    playerName: fullName(player),
    fromClubId: offer.toClubId,
    toClubId: offer.fromClubId,
    fee,
  });

  // Player swap (Transfers v2 P5): a player from the buying club, priced into the
  // package, moves the other way to the selling club on a fresh contract. Runs
  // only for a real seller (a free-agent deal has nowhere to send him) and only
  // if he still belongs to the buyer — if he was sold or moved between agreement
  // and completion the deal falls back to cash-only (the agreed fee stands; no
  // extra compensation, since a swap vanishing mid-deal is a rare user action).
  if (to && offer.terms.swapPlayerId !== null) {
    const swap = state.players[offer.terms.swapPlayerId];
    const gksLeft = swap
      ? clubPlayers(state, from.id).filter((p) => p.id !== swap.id && positionGroup(p.position) === 'GK').length
      : 0;
    // Never strip the buyer of its last keeper: such a swap completes cash-only.
    const leavesNoKeeper = !!swap && positionGroup(swap.position) === 'GK' && gksLeft === 0;
    if (swap && swap.clubId === from.id && !leavesNoKeeper) {
      // His valued component in the package is his effective fee — for the
      // sell-on math and the transfer record — since no cash changes hands for
      // him directly. The ledger is untouched by this notional fee; only a real
      // sell-on payout moves money, so the balance still reconciles.
      const swapFee = Math.round(swapValueToClub(state, to, swap));
      if (swapFee > 0 && swap.sellOn) {
        const beneficiary = state.clubs[swap.sellOn.clubId];
        if (beneficiary && beneficiary.id !== from.id) {
          const payout = Math.round((swapFee * swap.sellOn.pct) / 100);
          if (payout > 0) {
            recordMoney(from, 'playerSales', -payout);
            recordMoney(beneficiary, 'playerSales', payout);
          }
        }
      }
      const swapWage = swapContractWage(to, swap);
      const swapContract = aiContractTerms(swap, swapWage);
      swap.clubId = to.id;
      swap.contract = {
        wage: swapWage,
        expiresDay: contractEndDay(state, swapContract.years),
        releaseClause: swapContract.releaseClause,
        goalBonus: swapContract.goalBonus,
      };
      swap.sellOn = null;
      swap.transferListed = false;
      state.transferHistory.push({
        season: state.season,
        day: state.day,
        playerId: swap.id,
        playerName: fullName(swap),
        fromClubId: from.id,
        toClubId: to.id,
        fee: swapFee,
      });
      assignSquadNumbers(state, to.id);
      addNews(state, 'transfer',
        `${fullName(swap)} joins ${to.name}`,
        `${fullName(swap)} moves to ${to.name} in the deal that takes ${fullName(player)} to ${from.name}.`,
        from.id === state.userClubId || to.id === state.userClubId);
    }
  }

  assignSquadNumbers(state, from.id);
  refreshClubLineup(state, from);
  if (to) refreshClubLineup(state, to);

  // Withdraw any other live offers for this player.
  for (const o of state.offers) {
    if (o.playerId === player.id && o.id !== offer.id && (o.status === 'pending' || o.status === 'countered')) {
      o.status = 'withdrawn';
    }
  }

  const involvesUser = from.id === state.userClubId || offer.toClubId === state.userClubId;
  addNews(state, 'transfer',
    `${fullName(player)} joins ${from.name}`,
    `${from.name} have signed ${fullName(player)} from ${to ? to.name : 'free agency'} for ${formatMoney(fee)}.`,
    involvesUser);
}

function createRngFromState(state: GameState): Rng {
  return () => {
    // Cheap deterministic-enough stream keyed off mutating nextId.
    state.nextId++;
    let t = (state.seed + state.nextId * 0x9e3779b9) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Contract that expires at the end of the season `years` seasons from now. */
export function contractEndDay(state: GameState, years: number): number {
  return state.season * 365 + (years - 1) * 365;
}

/**
 * The contract an AI club offers a player it is signing. Keeps the wage the AI
 * has already budgeted (buyer-reputation scaled) but structures it coherently:
 * an age-appropriate length plus modest performance bonuses (a goal bonus for
 * attackers). No signing bonus or release clause — AI clubs stay conservative.
 */
function aiContractTerms(player: Player, wage: number): ContractTerms {
  const group = positionGroup(player.position);
  return {
    wage,
    years: preferredYears(player),
    signingBonus: 0,
    goalBonus: group === 'FW' ? Math.round((wage * 0.05) / 100) * 100 : 0,
    releaseClause: null,
  };
}

// ---- AI squad analysis ----

export interface SquadNeed {
  position: Position;
  severity: number; // higher = more urgent
}

/**
 * The detailed position a club most lacks within a group: of the group's slots
 * in the current formation, the slot with the fewest squad players who can
 * plausibly fill it (familiarity ≥ 0.9). Falls back to the group itself if it
 * has no slots in the formation.
 */
function neediestSlot(squad: Player[], group: PositionGroup, formation: Club['tactics']['formation']): Position {
  if (group === 'GK') return 'GK';
  const slots = FORMATIONS[formation].filter((s) => positionGroup(s) === group);
  if (!slots.length) return group === 'DF' ? 'CB' : group === 'MF' ? 'CM' : 'ST';
  const distinct = [...new Set(slots)];
  let best = distinct[0];
  let bestCount = Infinity;
  for (const slot of distinct) {
    const n = squad.filter((p) => familiarity(p.position, slot) >= 0.9).length;
    if (n < bestCount) { bestCount = n; best = slot; }
  }
  return best;
}

export function analyzeNeeds(state: GameState, club: Club): SquadNeed[] {
  const squad = clubPlayers(state, club.id);
  const counts = positionCounts(squad);
  const strength = squadStrength(squad);
  const needs: SquadNeed[] = [];
  for (const group of ['GK', 'DF', 'MF', 'FW'] as PositionGroup[]) {
    const position = neediestSlot(squad, group, club.tactics.formation);
    const deficit = IDEAL_COUNTS[group] - counts[group];
    if (deficit > 0) {
      needs.push({ position, severity: deficit * 2 });
      continue;
    }
    // Quality need: group notably weaker than squad average.
    const inGroup = squad.filter((p) => positionGroup(p.position) === group);
    const groupBest = inGroup.length ? Math.max(...inGroup.map((p) => overall(p))) : 0;
    if (groupBest < strength - 5) needs.push({ position, severity: 1 });
    // Aging group: mostly players in their 30s.
    const aging = inGroup.filter((p) => p.age >= 31).length;
    if (aging >= Math.ceil(inGroup.length / 2) && inGroup.length > 0) needs.push({ position, severity: 1 });
  }
  return needs.sort((a, b) => b.severity - a.severity);
}

/** Players an AI club is happy to move on (surplus / aging / unhappy). */
export function surplusPlayers(state: GameState, club: Club): Player[] {
  const squad = clubPlayers(state, club.id);
  const counts = positionCounts(squad);
  if (squad.length <= 17) return [];
  const strength = squadStrength(squad);
  return squad.filter((p) => {
    if (club.lineup.starters.includes(p.id)) return false;
    const group = positionGroup(p.position);
    const surplusCount = counts[group] > IDEAL_COUNTS[group];
    const wellBelow = overall(p) < strength - 10;
    const oldAndFading = p.age >= 32 && overall(p) < strength - 4;
    return surplusCount && (wellBelow || oldAndFading || p.transferListed);
  });
}

// ---- Sell-to-survive: distressed AI clubs list players (WP4) ----

/**
 * How many transfer-listed players an AI club keeps up while under financial
 * stress. Nothing is force-listed under 'none'; the more desperate the club,
 * the more of its squad goes in the window to raise fees and shed wages.
 */
const LISTING_TARGET: Record<SellPressure, number> = { none: 0, trim: 1, sell: 2, firesale: 3 };

/**
 * Sell-to-survive (WP4). Every transfer-window tick, reconcile each AI club's
 * transfer list against its financial stress (`sellPressure`):
 *   - a club under pressure lists its most *sheddable* players — high wage
 *     relative to what they contribute (benched, overstocked, aging), never the
 *     spine's best player — up to `LISTING_TARGET`, and never below the squad
 *     floor;
 *   - a club that has recovered to 'none' de-lists the players it had put up, so
 *     a club that trades its way back to health stops dumping.
 *
 * This is only the *seller* side. `aiClearListedMarket` runs right after it and
 * actively finds buyers for these listings, and `aiClubAct`'s need-driven buyers
 * strongly favour (and cheaply land) listed players via the distress discount —
 * so a listing actually converts to a sale (income now, wage relief forever).
 *
 * The user's club is never auto-managed: AI transfer listings are only ever set
 * here, so de-listing can't clobber a user decision.
 */
export function aiManageListings(state: GameState): void {
  for (const club of Object.values(state.clubs)) {
    if (club.id === state.userClubId) continue;
    const squad = clubPlayers(state, club.id);
    const target = LISTING_TARGET[sellPressure(club, totalWages(squad))];
    const listed = squad.filter((p) => p.transferListed);

    if (target === 0) {
      for (const p of listed) p.transferListed = false; // recovered: clear the list
      continue;
    }
    if (listed.length >= target || squad.length <= SALE_SQUAD_FLOOR) continue;

    const toList = shedCandidates(club, squad).slice(0, target - listed.length);
    for (const p of toList) p.transferListed = true;
  }
}

/**
 * Un-listed players a struggling club should put up first, best candidate
 * first. Ranked by a "shed score" that rewards a high wage carried by a
 * marginal contributor — the player who frees the most wage for the least
 * on-pitch loss. Protects a viable spine: never a group's single best player,
 * never a player whose group is already at/below its thin threshold.
 */
function shedCandidates(club: Club, squad: Player[]): Player[] {
  const counts = positionCounts(squad);
  const strength = squadStrength(squad);
  const bestInGroup: Partial<Record<PositionGroup, number>> = {};
  for (const p of squad) {
    const g = positionGroup(p.position);
    if (bestInGroup[g] === undefined || overall(p) > bestInGroup[g]!) bestInGroup[g] = overall(p);
  }
  return squad
    .filter((p) => {
      if (p.transferListed) return false;
      const g = positionGroup(p.position);
      if (counts[g] <= Math.max(1, IDEAL_COUNTS[g] - 2)) return false; // group already thin
      if (overall(p) >= bestInGroup[g]!) return false; // keep the group's best
      return true;
    })
    .sort((a, b) => shedScore(club, b, counts, strength) - shedScore(club, a, counts, strength));
}

/** Higher = more attractive to list: wage weighed against on-pitch contribution,
 * biased toward benched, overstocked-position and aging earners. */
function shedScore(club: Club, p: Player, counts: Record<PositionGroup, number>, strength: number): number {
  // Contribution above a low "squad filler" baseline, floored so a fringe
  // player doesn't divide by ~0 and top the list on rating noise alone.
  const contribution = Math.max(6, overall(p) - (strength - 16));
  let score = p.contract.wage / contribution;
  if (!club.lineup.starters.includes(p.id)) score *= 1.6; // prefer to keep the XI intact
  if (counts[positionGroup(p.position)] > IDEAL_COUNTS[positionGroup(p.position)]) score *= 1.3;
  if (p.age >= 31) score *= 1.3; // aging earners are prime candidates to move on
  return score;
}

/**
 * Market-clearing for distressed sales (WP4). The ordinary buy AI (`aiClubAct`)
 * only shops for a positional *need*, and needs are rare, so a distressed club's
 * transfer-listed players can otherwise sit unsold for a whole window while its
 * wages bleed — sell-to-survive is useless if nobody bids. This pass actively
 * finds buyers for those listings so they convert to sales.
 *
 * Talent flows *downward* by construction: a listed player is only offered to a
 * club he would actually improve (at least as good as that club's current best
 * in his group), so already-strong clubs — which have better players — don't
 * bid, and the player lands where he strengthens the squad. Buyers are then
 * weighted toward the biggest positional gap, not the deepest pockets. So
 * distress selling *helps* league competitiveness (weaker clubs restock from the
 * strugglers) instead of concentrating stars at the top, while clearing the
 * seller's wage bill.
 *
 * Only genuinely distressed AI sellers are cleared this way; the user's club and
 * healthy clubs' voluntary listings are left to the ordinary market.
 */
export function aiClearListedMarket(state: GameState, rng: Rng): void {
  const listings: Player[] = [];
  for (const club of Object.values(state.clubs)) {
    if (club.id === state.userClubId) continue;
    const squad = clubPlayers(state, club.id);
    if (squad.length <= SALE_SQUAD_FLOOR) continue;
    if (sellPressure(club, totalWages(squad)) === 'none') continue;
    for (const p of squad) {
      if (!p.transferListed) continue;
      if (state.offers.some((o) => o.playerId === p.id && (o.status === 'pending' || o.status === 'countered'))) continue;
      listings.push(p);
    }
  }
  if (!listings.length) return;

  for (const player of listings.slice(0, 4)) {
    const ovr = overall(player);
    const group = positionGroup(player.position);
    const value = marketValue(player, state.day);
    const buyers = Object.values(state.clubs).filter((c) => {
      if (c.id === state.userClubId || c.id === player.clubId) return false;
      const sq = clubPlayers(state, c.id);
      if (sq.length >= 24 || c.budget < value) return false; // no room / can't afford
      const counts = positionCounts(sq);
      if (counts[group] >= IDEAL_COUNTS[group] + 1) return false; // overstocked
      if (sellPressure(c, totalWages(sq)) !== 'none') return false; // buyers must be healthy
      const best = sq.reduce((m, q) => (positionGroup(q.position) === group ? Math.max(m, overall(q)) : m), 0);
      return ovr >= best - 1; // only a club the player would actually improve
    });
    if (!buyers.length) continue;
    const buyer = weightedPick(rng, buyers, (c) => {
      const counts = positionCounts(clubPlayers(state, c.id));
      return 1 + Math.max(0, IDEAL_COUNTS[group] - counts[group]) * 2; // biggest gap first
    });
    const fee = Math.min(buyer.budget, Math.round((value * (0.92 + rng() * 0.16)) / 5000) * 5000);
    state.offers.push({
      id: state.nextId++, playerId: player.id, fromClubId: buyer.id, toClubId: player.clubId,
      terms: dealTerms(fee), status: 'pending', counterTerms: null, rounds: 0, patience: DEFAULT_PATIENCE,
      day: state.day, userInvolved: false, wageDemand: null, stage: 'fee', contractOffer: null,
    });
  }
}

// ---- AI transfer activity (daily tick during windows) ----

/**
 * True once enough days have passed for the other side of a negotiation to
 * answer: never same-day, usually the next day, occasionally the day after —
 * so responses take "a day or two".
 */
function responseDue(state: GameState, rng: Rng, sinceDay: number): boolean {
  const waited = state.day - sinceDay;
  return waited >= 2 || (waited === 1 && chance(rng, 0.6));
}

export function aiTransferTick(state: GameState, rng: Rng): void {
  if (!isTransferWindowOpen(state.day)) return;

  // 1. Respond to pending bids made on AI clubs' players (incl. user bids).
  for (const offer of state.offers) {
    if (offer.status !== 'pending') continue;
    if (offer.toClubId === state.userClubId) continue; // user answers these
    if (!responseDue(state, rng, offer.day)) continue;
    aiRespondToBid(state, rng, offer);
    const status = offer.status as OfferStatus; // aiRespondToBid mutates
    if (status === 'accepted' && offer.fromClubId === state.userClubId) {
      // Move to contract stage for the user; player states wage demand.
      const player = state.players[offer.playerId];
      const userClub = state.clubs[state.userClubId];
      offer.stage = 'contract';
      offer.wageDemand = wageDemand(overall(player), player.age, userClub.reputation);
      addNews(state, 'transfer', `Bid accepted for ${fullName(player)}`,
        `${state.clubs[offer.toClubId].name} have accepted your ${formatMoney(offer.terms.fee)} bid for ${fullName(player)}. He wants ${formatMoney(offer.wageDemand)}/week. Complete the deal from the Transfers screen.`, true);
    } else if (status === 'accepted') {
      // AI-to-AI deal: complete immediately.
      const player = state.players[offer.playerId];
      const wage = wageDemand(overall(player), player.age, state.clubs[offer.fromClubId].reputation);
      completeTransfer(state, offer, wage, aiContractTerms(player, wage));
    } else if (offer.fromClubId === state.userClubId) {
      const player = state.players[offer.playerId];
      if (status === 'countered') {
        addNews(state, 'transfer', `Counter-offer for ${fullName(player)}`,
          `${state.clubs[offer.toClubId].name} rejected your ${formatMoney(offer.terms.fee)} bid for ${fullName(player)} but would accept ${formatMoney(offer.counterTerms!.fee)}.`, true);
      } else {
        addNews(state, 'transfer', `Bid rejected for ${fullName(player)}`,
          `${state.clubs[offer.toClubId].name} have rejected your ${formatMoney(offer.terms.fee)} bid for ${fullName(player)}.`, true);
      }
    }
  }

  // 2. Distressed clubs (re)list players to sell; recovered clubs de-list.
  aiManageListings(state);
  // 2b. Actively find buyers for distressed clubs' listings so they convert.
  aiClearListedMarket(state, rng);

  // 3. A few AI clubs act on their needs each day.
  const aiClubs = Object.values(state.clubs).filter((c) => c.id !== state.userClubId);
  const actors = randInt(rng, 2, 6);
  for (let i = 0; i < actors; i++) {
    const club = pick(rng, aiClubs);
    const manager = state.managers[club.managerId];
    if (!manager || !chance(rng, manager.activity * 0.35)) continue;
    aiClubAct(state, rng, club, manager);
  }
}

function aiClubAct(state: GameState, rng: Rng, club: Club, manager: AiManager): void {
  const squad = clubPlayers(state, club.id);
  const needs = analyzeNeeds(state, club);
  // Financially stressed clubs are frozen out of the buy side — they must sell,
  // not buy (WP4). Using `sellPressure` rather than a raw `balance < 0` check
  // stops discretionary buying *before* the club hits the red: the 'trim' band
  // fires while the balance is still positive but eating into the board's
  // operating reserve, so the club pulls out of the market early instead of
  // spending its way to insolvency.
  if (!needs.length || club.budget < 50_000 || sellPressure(club, totalWages(squad)) !== 'none') return;
  const need = needs[0];

  // Candidate pool: players at other clubs (or free agents) in that position
  // the club can plausibly afford and attract. A transfer-listed player (usually
  // from a struggling club selling to survive) is the exception to the
  // "move sideways or up in reputation" rule and is priced cheaply by the
  // seller's distress discount, so a listing from a distressed club actually
  // converts to a sale here rather than sitting in the window forever.
  const strength = squadStrength(squad);
  const needGroup = positionGroup(need.position);
  const candidates = Object.values(state.players).filter((p) => {
    if (positionGroup(p.position) !== needGroup || p.clubId === club.id || p.retiring) return false;
    if (p.clubId === -1) return true;
    const owner = state.clubs[p.clubId];
    // Players generally move sideways or up in reputation, unless listed.
    if (owner.reputation > club.reputation + 8 && !p.transferListed) return false;
    const value = marketValue(p, state.day);
    if (value > club.budget) return false;
    const ovr = overall(p);
    if (ovr < strength - 12) return false; // not good enough to bother
    if (manager.youthBias > 0.6 && p.age > 28) return false;
    return true;
  });
  if (!candidates.length) return;

  const target = weightedPick(rng, candidates, (p) => {
    let w = Math.max(1, overall(p) - (strength - 12));
    if (p.transferListed) w *= 2.5; // strongly prefer clearing the market's listed players
    if (manager.youthBias > 0.5 && p.age <= 23) w *= 1.6;
    if (p.clubId === -1) w *= 1.5; // free is good
    return w;
  });

  if (target.clubId === -1) {
    // Sign free agent directly.
    const wage = wageDemand(overall(target), target.age, club.reputation);
    if (wage + totalWages(squad) > club.wageBudget * 1.05) return;
    const offer: TransferOffer = {
      id: state.nextId++, playerId: target.id, fromClubId: club.id, toClubId: -1,
      terms: dealTerms(0), status: 'accepted', counterTerms: null, rounds: 0, patience: DEFAULT_PATIENCE,
      day: state.day, userInvolved: false, wageDemand: wage, stage: 'contract', contractOffer: null,
    };
    state.offers.push(offer);
    completeTransfer(state, offer, wage, aiContractTerms(target, wage));
    return;
  }

  // Don't spam: skip if this club already has a live offer for the player.
  if (state.offers.some((o) => o.playerId === target.id && o.fromClubId === club.id && (o.status === 'pending' || o.status === 'countered'))) return;

  const value = marketValue(target, state.day);
  const boldness = manager.temper === 'aggressive' ? 1.1 : manager.temper === 'shrewd' ? 0.85 : manager.temper === 'impulsive' ? 0.95 + rng() * 0.3 : 1.0;
  const fee = Math.min(club.budget, Math.round((value * boldness * (0.9 + rng() * 0.25)) / 5000) * 5000);
  const offer: TransferOffer = {
    id: state.nextId++, playerId: target.id, fromClubId: club.id, toClubId: target.clubId,
    terms: dealTerms(fee), status: 'pending', counterTerms: null, rounds: 0, patience: DEFAULT_PATIENCE,
    day: state.day, userInvolved: target.clubId === state.userClubId, wageDemand: null, stage: 'fee', contractOffer: null,
  };
  state.offers.push(offer);

  // A bid meeting a user player's release clause is honored at once — the user
  // can't refuse it. Mirrors the AI-to-AI accepted path (complete immediately).
  if (target.clubId === state.userClubId && meetsReleaseClause(target, fee)) {
    offer.status = 'accepted';
    const wage = wageDemand(overall(target), target.age, club.reputation);
    completeTransfer(state, offer, wage, aiContractTerms(target, wage));
    addNews(state, 'transfer', `Release clause triggered: ${fullName(target)}`,
      `${club.name} have met the ${formatMoney(fee)} release clause in ${fullName(target)}'s contract and signed him.`, true);
    return;
  }

  if (offer.userInvolved) {
    addNews(state, 'transfer', `Bid received: ${fullName(target)}`,
      `${club.name} have bid ${formatMoney(fee)} for ${fullName(target)} (valued at ${formatMoney(value)}). Respond from the Transfers screen.`, true);
  }
}

/**
 * AI clubs with dangerously thin squads sign free agents. Runs daily, even
 * outside windows (free agents can sign anytime), so no club ever becomes
 * unable to field a team.
 */
export function aiEmergencySignings(state: GameState, rng: Rng): void {
  for (const club of Object.values(state.clubs)) {
    if (club.id === state.userClubId) continue;
    const squad = clubPlayers(state, club.id);
    const counts = positionCounts(squad);
    const thin = squad.length < 17 ||
      counts.GK < 2 || counts.DF < 5 || counts.MF < 5 || counts.FW < 3;
    if (!thin || !chance(rng, 0.6)) continue;
    // Most needed group first.
    const needOrder = (['GK', 'DF', 'MF', 'FW'] as PositionGroup[])
      .sort((a, b) => (counts[a] / IDEAL_COUNTS[a]) - (counts[b] / IDEAL_COUNTS[b]));
    const frees = Object.values(state.players).filter((p) => p.clubId === -1 && !p.retiring);
    for (const group of needOrder) {
      const pool = frees.filter((p) => positionGroup(p.position) === group).sort((a, b) => overall(b) - overall(a));
      if (!pool.length) continue;
      const target = pool[0];
      const wage = wageDemand(overall(target), target.age, club.reputation);
      const offer: TransferOffer = {
        id: state.nextId++, playerId: target.id, fromClubId: club.id, toClubId: -1,
        terms: dealTerms(0), status: 'accepted', counterTerms: null, rounds: 0, patience: DEFAULT_PATIENCE,
        day: state.day, userInvolved: false, wageDemand: wage, stage: 'contract', contractOffer: null,
      };
      state.offers.push(offer);
      completeTransfer(state, offer, wage, aiContractTerms(target, wage));
      break;
    }
  }
}

/** AI clubs accepting counters they previously made to other AI clubs. */
export function aiFollowUpCounters(state: GameState, rng: Rng): void {
  for (const offer of state.offers) {
    if (offer.status !== 'countered' || offer.fromClubId === state.userClubId) continue;
    if (!responseDue(state, rng, offer.day)) continue;
    const buyer = state.clubs[offer.fromClubId];
    const manager = state.managers[buyer.managerId];
    if (!manager || offer.counterTerms === null) continue;
    // A club that has slid into financial stress walks away rather than closing
    // a deal it can no longer afford (WP4: same health gate as the buy side, so
    // a club stops chasing counters before it hits the red, not after).
    if (offer.counterTerms.fee <= buyer.budget
      && sellPressure(buyer, totalWages(clubPlayers(state, buyer.id))) === 'none'
      && chance(rng, manager.temper === 'aggressive' ? 0.6 : 0.35)) {
      offer.terms = offer.counterTerms;
      offer.status = 'accepted';
      const player = state.players[offer.playerId];
      const wage = wageDemand(overall(player), player.age, buyer.reputation);
      completeTransfer(state, offer, wage, aiContractTerms(player, wage));
    } else {
      offer.status = 'withdrawn';
      if (offer.toClubId === state.userClubId) {
        addNews(state, 'transfer', `Counter rejected`,
          `${buyer.name} have walked away from the deal for ${fullName(state.players[offer.playerId])} after your counter-offer.`, true);
      }
    }
  }
}

/**
 * Answers to user contract offers left with a player's agent (the async
 * personal-terms stage of an outgoing deal). Runs daily, even outside the
 * window — a fee agreed before the deadline can still conclude after it.
 * Accept completes the transfer; a counter lands in `player.contractTalk` for
 * the UI; reject kills the deal.
 */
export function agentContractTick(state: GameState, rng: Rng): void {
  for (const offer of state.offers) {
    if (offer.fromClubId !== state.userClubId || offer.stage !== 'contract' || offer.status !== 'accepted') continue;
    const terms = offer.contractOffer;
    if (!terms || !responseDue(state, rng, offer.day)) continue;
    offer.contractOffer = null;
    const player = state.players[offer.playerId];
    const verdict = respondToContractOffer(state, rng, offer.playerId, terms, 'transfer');
    if (verdict === 'accept') {
      completeTransfer(state, offer, terms.wage, terms);
    } else if (verdict === 'counter') {
      addNews(state, 'transfer', `Contract talks: ${fullName(player)}`,
        `${fullName(player)}'s agent has countered your contract offer. Review the deal from the Transfers screen.`, true);
    } else {
      offer.status = 'rejected';
      addNews(state, 'transfer', `Talks collapse: ${fullName(player)}`,
        `${fullName(player)} has turned down your contract offer and the deal is off.`, true);
    }
  }
}

// ---- Engine API: package valuation, fee negotiation, contracts ----
//
// The signatures are the agreed contract between P2 (this logic) and P3 (UI),
// so they must stay exact.

/**
 * Apply a counter to a live offer and have the selling side respond at once.
 * The user's flow no longer goes through this — a user counter goes back to
 * 'pending' and is answered a day or two later by `aiTransferTick` — but it
 * remains the synchronous round driver for the concession-curve logic.
 */
export function counterBid(state: GameState, rng: Rng, offer: TransferOffer, terms: DealTerms): void {
  offer.terms = terms;
  offer.rounds++;
  offer.day = state.day;
  aiRespondToBid(state, rng, offer);
}

/**
 * Cash-equivalent value of a deal package to the selling club:
 *   - the cash fee;
 *   - the swap player's worth *to this club* — market value adjusted for whether
 *     the club needs the position (a gap-filler is worth more than a body in an
 *     already-stocked group, a squad-strengthening upgrade more than a reserve);
 *   - the expected value of the sell-on % the buyer grants: a probability- and
 *     time-discounted slice of the player's likely future resale, so a seller
 *     will take a lower fee now in exchange for a cut of the upside.
 */
export function packageValue(state: GameState, club: Club, player: Player, terms: DealTerms): number {
  let value = terms.fee;
  if (terms.swapPlayerId !== null) {
    const swap = state.players[terms.swapPlayerId];
    if (swap) value += swapValueToClub(state, club, swap);
  }
  if (terms.sellOnPct > 0) {
    value += marketValue(player, state.day) * (terms.sellOnPct / 100) * SELLON_RESALE_FACTOR;
  }
  return Math.round(value);
}

/** Expected discounted worth of a sell-on clause as a fraction of current value:
 * a probability-weighted, time-discounted slice of a likely future resale. */
const SELLON_RESALE_FACTOR = 0.4;

/** A swap player's cash-equivalent worth to a club, weighting his market value
 * by that club's need for his position and his standing in the squad. */
function swapValueToClub(state: GameState, club: Club, swap: Player): number {
  const base = marketValue(swap, state.day);
  const squad = clubPlayers(state, club.id);
  const counts = positionCounts(squad);
  const group = positionGroup(swap.position);
  const strength = squadStrength(squad);
  let mult = 1;
  if (counts[group] > IDEAL_COUNTS[group]) mult *= 0.6; // already overstocked
  else if (counts[group] < IDEAL_COUNTS[group]) mult *= 1.1; // fills a gap
  if (overall(swap) >= strength) mult *= 1.1; // an upgrade on what's there
  else if (overall(swap) < strength - 8) mult *= 0.65; // wouldn't get in the side
  return base * mult;
}

// ---- Player-side contract demands & negotiation ----

/** Weekly-wage-equivalent value of a contract's guaranteed and performance pay,
 * from the player's view: bonuses are worth less than guaranteed wage, upfront
 * cash a touch more. */
function offerWeeklyValue(player: Player, terms: ContractTerms): number {
  const weeks = Math.max(1, terms.years * WEEKS_PER_SEASON);
  const signingWeekly = (terms.signingBonus / weeks) * SIGNING_PREMIUM;
  const goalWeekly = (terms.goalBonus * expectedGoals(player) / WEEKS_PER_SEASON) * BONUS_DISCOUNT;
  return terms.wage + signingWeekly + goalWeekly;
}

/** The weekly comp the player insists on for a specific package: his base
 * anchor, dearer for a longer-than-preferred commitment, cheaper when a
 * (tight) release clause lets him leave. */
function requiredWeeklyValue(state: GameState, player: Player, terms: ContractTerms, kind: 'transfer' | 'renewal'): number {
  let req = contractWageAnchor(state, player, kind);
  req *= 1 + (terms.years - preferredYears(player)) * LENGTH_SENSITIVITY;
  if (terms.releaseClause !== null) {
    const tightness = clamp(marketValue(player, state.day) / Math.max(1, terms.releaseClause), 0, 1);
    req *= 1 - RELEASE_MAX_DISCOUNT * tightness;
  }
  return req;
}

/** The player's base weekly-wage anchor before length/clause/bonus tradeoffs:
 * driven by ability/age/club reputation, never below his current wage, lifted
 * for a move, and (on a renewal) nudged by form and morale. */
function contractWageAnchor(state: GameState, player: Player, kind: 'transfer' | 'renewal'): number {
  const reputation = player.clubId >= 0 ? state.clubs[player.clubId].reputation : 50;
  let wage = Math.max(wageDemand(overall(player), player.age, reputation), player.contract.wage);
  if (kind === 'transfer') {
    wage *= 1.12; // a move needs a raise
  } else {
    const avgForm = player.form.length ? player.form.reduce((a, b) => a + b, 0) / player.form.length : 6.5;
    wage *= 1 + (avgForm - 6.5) * 0.03; // in-form players push for more
    if (player.morale < 40) wage *= 1.12; // unhappy: takes more to keep him
    else if (player.morale > 75) wage *= 0.97; // settled: a touch cheaper
  }
  return wage;
}

/** Contract length a player prefers: the young want long deals, veterans short. */
function preferredYears(player: Player): number {
  if (player.age <= 23) return 5;
  if (player.age <= 27) return 4;
  if (player.age <= 30) return 3;
  if (player.age <= 33) return 2;
  return 1;
}

/** Expected goals a season by position group, for valuing a goal bonus. */
function expectedGoals(player: Player): number {
  switch (positionGroup(player.position)) {
    case 'FW': return 14;
    case 'MF': return 6;
    case 'DF': return 2;
    default: return 0;
  }
}

const SIGNING_PREMIUM = 1.4; // upfront cash valued above its spread-out weekly rate
const BONUS_DISCOUNT = 0.6; // performance pay discounted against guaranteed wage
const LENGTH_SENSITIVITY = 0.05; // wage swing per year either side of preferred length
const RELEASE_MAX_DISCOUNT = 0.15; // most wage a tight release clause buys off

/**
 * The contract a player wants for a transfer or renewal. Length follows age;
 * the wage is his anchor net of the modest bonuses he asks for (so the package
 * as a whole sits at his reservation); attackers value a goal bonus, a move
 * earns a signing bonus. No release clause is demanded — it's a lever the club
 * can offer to shave the wage (see `respondToContractOffer`).
 */
export function playerContractDemand(state: GameState, player: Player, kind: 'transfer' | 'renewal'): ContractTerms {
  const years = preferredYears(player);
  const anchor = contractWageAnchor(state, player, kind); // == requiredWeeklyValue at preferred years, no clause
  const group = positionGroup(player.position);
  const signingBonus = Math.round((anchor * (kind === 'transfer' ? 4 : 2)) / 1000) * 1000;
  const goalBonus = group === 'FW' ? Math.round((anchor * 0.06) / 100) * 100
    : group === 'MF' ? Math.round((anchor * 0.03) / 100) * 100 : 0;
  const bonusWeekly = offerWeeklyValue(player, { wage: 0, years, signingBonus, goalBonus, releaseClause: null });
  const wage = Math.max(500, Math.round((anchor - bonusWeekly) / 100) * 100);
  return { wage, years, signingBonus, goalBonus, releaseClause: null };
}

/**
 * The player's verdict on a contract offer, scored holistically (not field by
 * field): the whole package's weekly value against what this structure requires.
 * Accepts when it clears, rejects an insulting lowball outright, otherwise
 * counters — meeting partway on wage while keeping the club's chosen years,
 * bonuses and clause — and spends a round of patience each time, walking away
 * (reject) once it's gone. The counter is written to `player.contractTalk` for
 * the UI; talks reset (patience refills) once cleared to null.
 */
export function respondToContractOffer(
  state: GameState, _rng: Rng, playerId: number, terms: ContractTerms, kind: 'transfer' | 'renewal',
): 'accept' | 'counter' | 'reject' {
  const player = state.players[playerId];
  if (!player) return 'reject';

  const required = requiredWeeklyValue(state, player, terms, kind);
  const offered = offerWeeklyValue(player, terms);
  const ratio = offered / required;

  if (ratio >= 0.98) {
    player.contractTalk = null;
    return 'accept';
  }
  if (ratio < CONTRACT_INSULT_RATIO) {
    player.contractTalk = null;
    return 'reject';
  }
  const talk = player.contractTalk ?? { patience: CONTRACT_PATIENCE, counter: null };
  if (talk.patience-- <= 0) {
    player.contractTalk = null;
    return 'reject';
  }
  // Ask for most of the shortfall on top of the offered wage — a meet-in-the-
  // middle counter that keeps the club's structure and just names a higher wage.
  const shortfall = required - offered;
  const wage = Math.round((terms.wage + shortfall * 0.6) / 100) * 100;
  talk.counter = { ...terms, wage: Math.max(terms.wage, wage) };
  player.contractTalk = talk;
  return 'counter';
}

/** A contract package worth less than this fraction of the player's reservation
 * is an insult he rejects outright rather than counter. */
const CONTRACT_INSULT_RATIO = 0.75;

export function formatMoney(n: number): string {
  if (n >= 1_000_000) return `£${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `£${Math.round(n / 1000)}K`;
  return `£${n}`;
}
