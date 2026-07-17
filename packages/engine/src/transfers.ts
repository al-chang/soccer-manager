import type { GameState, Club, Player, TransferOffer, AiManager, Position, PositionGroup, OfferStatus } from './types';
import { type Rng, chance, pick, weightedPick, clamp, randInt } from './rng';
import { marketValue, wageDemand, overall, fullName } from './player';
import { clubPlayers, positionCounts, IDEAL_COUNTS, squadStrength, totalWages, refreshClubLineup } from './squad';
import { FORMATIONS, positionGroup, familiarity } from './tactics';
import { isTransferWindowOpen } from './calendar';
import { assignSquadNumbers } from './world';
import { addNews } from './news';
import { recordMoney, sellPressure, type SellPressure } from './finance';

/**
 * Squad size below which an AI club stops selling — even a firesale won't take
 * a club to or below this many players. Sits one clear of the emergency
 * free-agent threshold (`aiEmergencySignings`, squad < 17) so a voluntary sale
 * never forces a £0 panic signing.
 */
export const SALE_SQUAD_FLOOR = 18;

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

/** How an AI club responds to a bid on its player. */
export function aiRespondToBid(state: GameState, rng: Rng, offer: TransferOffer): void {
  const club = state.clubs[offer.toClubId];
  const player = state.players[offer.playerId];
  const manager = state.managers[club.managerId];
  const threshold = sellThreshold(state, club, player);

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
  if (offer.fee >= threshold) {
    offer.status = 'accepted';
    return;
  }
  // Below threshold: counter or reject based on temper.
  const gap = offer.fee / threshold;
  const willCounter = manager?.temper === 'patient' || manager?.temper === 'shrewd'
    ? gap > 0.5
    : gap > 0.65 && chance(rng, 0.7);
  if (willCounter) {
    offer.status = 'countered';
    offer.counterFee = Math.round((threshold * (1 + rng() * 0.08)) / 5000) * 5000;
  } else {
    offer.status = 'rejected';
  }
}

// ---- Executing transfers ----

export function completeTransfer(state: GameState, offer: TransferOffer, wage: number): void {
  const player = state.players[offer.playerId];
  const from = state.clubs[offer.fromClubId]; // buyer
  const to = offer.toClubId >= 0 ? state.clubs[offer.toClubId] : null; // seller

  from.budget -= offer.fee;
  if (to) to.budget += offer.fee;
  // Allocations moved above; now move the real cash. The buyer's balance drops
  // by the fee, the seller's rises by it (free-agent deals have fee 0, a no-op).
  recordMoney(from, 'transferFees', -offer.fee);
  if (to) recordMoney(to, 'playerSales', offer.fee);
  player.clubId = from.id;
  player.contract.wage = wage;
  player.contract.expiresDay = contractEndDay(state, randInt(createRngFromState(state), 2, 4));
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
    fee: offer.fee,
  });

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
    `${from.name} have signed ${fullName(player)} from ${to ? to.name : 'free agency'} for ${formatMoney(offer.fee)}.`,
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
      fee, status: 'pending', counterFee: null, day: state.day,
      userInvolved: false, wageDemand: null, stage: 'fee',
    });
  }
}

// ---- AI transfer activity (daily tick during windows) ----

export function aiTransferTick(state: GameState, rng: Rng): void {
  if (!isTransferWindowOpen(state.day)) return;

  // 1. Respond to pending bids made on AI clubs' players (incl. user bids).
  for (const offer of state.offers) {
    if (offer.status !== 'pending') continue;
    if (offer.toClubId === state.userClubId) continue; // user answers these
    if (offer.day >= state.day) continue; // respond the day after
    aiRespondToBid(state, rng, offer);
    const status = offer.status as OfferStatus; // aiRespondToBid mutates
    if (status === 'accepted' && offer.fromClubId === state.userClubId) {
      // Move to contract stage for the user; player states wage demand.
      const player = state.players[offer.playerId];
      const userClub = state.clubs[state.userClubId];
      offer.stage = 'contract';
      offer.wageDemand = wageDemand(overall(player), player.age, userClub.reputation);
      addNews(state, 'transfer', `Bid accepted for ${fullName(player)}`,
        `${state.clubs[offer.toClubId].name} have accepted your ${formatMoney(offer.fee)} bid for ${fullName(player)}. He wants ${formatMoney(offer.wageDemand)}/week. Complete the deal from the Transfers screen.`, true);
    } else if (status === 'accepted') {
      // AI-to-AI deal: complete immediately.
      const player = state.players[offer.playerId];
      const wage = wageDemand(overall(player), player.age, state.clubs[offer.fromClubId].reputation);
      completeTransfer(state, offer, wage);
    } else if (offer.fromClubId === state.userClubId) {
      const player = state.players[offer.playerId];
      if (status === 'countered') {
        addNews(state, 'transfer', `Counter-offer for ${fullName(player)}`,
          `${state.clubs[offer.toClubId].name} rejected your ${formatMoney(offer.fee)} bid for ${fullName(player)} but would accept ${formatMoney(offer.counterFee!)}.`, true);
      } else {
        addNews(state, 'transfer', `Bid rejected for ${fullName(player)}`,
          `${state.clubs[offer.toClubId].name} have rejected your ${formatMoney(offer.fee)} bid for ${fullName(player)}.`, true);
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
      fee: 0, status: 'accepted', counterFee: null, day: state.day, userInvolved: false,
      wageDemand: wage, stage: 'contract',
    };
    state.offers.push(offer);
    completeTransfer(state, offer, wage);
    return;
  }

  // Don't spam: skip if this club already has a live offer for the player.
  if (state.offers.some((o) => o.playerId === target.id && o.fromClubId === club.id && (o.status === 'pending' || o.status === 'countered'))) return;

  const value = marketValue(target, state.day);
  const boldness = manager.temper === 'aggressive' ? 1.1 : manager.temper === 'shrewd' ? 0.85 : manager.temper === 'impulsive' ? 0.95 + rng() * 0.3 : 1.0;
  const fee = Math.min(club.budget, Math.round((value * boldness * (0.9 + rng() * 0.25)) / 5000) * 5000);
  const offer: TransferOffer = {
    id: state.nextId++, playerId: target.id, fromClubId: club.id, toClubId: target.clubId,
    fee, status: 'pending', counterFee: null, day: state.day,
    userInvolved: target.clubId === state.userClubId, wageDemand: null, stage: 'fee',
  };
  state.offers.push(offer);

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
        fee: 0, status: 'accepted', counterFee: null, day: state.day, userInvolved: false,
        wageDemand: wage, stage: 'contract',
      };
      state.offers.push(offer);
      completeTransfer(state, offer, wage);
      break;
    }
  }
}

/** AI clubs accepting counters they previously made to other AI clubs. */
export function aiFollowUpCounters(state: GameState, rng: Rng): void {
  for (const offer of state.offers) {
    if (offer.status !== 'countered' || offer.fromClubId === state.userClubId) continue;
    if (offer.day >= state.day) continue;
    const buyer = state.clubs[offer.fromClubId];
    const manager = state.managers[buyer.managerId];
    if (!manager || offer.counterFee === null) continue;
    // A club that has slid into financial stress walks away rather than closing
    // a deal it can no longer afford (WP4: same health gate as the buy side, so
    // a club stops chasing counters before it hits the red, not after).
    if (offer.counterFee <= buyer.budget
      && sellPressure(buyer, totalWages(clubPlayers(state, buyer.id))) === 'none'
      && chance(rng, manager.temper === 'aggressive' ? 0.6 : 0.35)) {
      offer.fee = offer.counterFee;
      offer.status = 'accepted';
      const player = state.players[offer.playerId];
      completeTransfer(state, offer, wageDemand(overall(player), player.age, buyer.reputation));
    } else {
      offer.status = 'withdrawn';
      if (offer.toClubId === state.userClubId) {
        addNews(state, 'transfer', `Counter rejected`,
          `${buyer.name} have walked away from the deal for ${fullName(state.players[offer.playerId])} after your counter-offer.`, true);
      }
    }
  }
}

export function formatMoney(n: number): string {
  if (n >= 1_000_000) return `£${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `£${Math.round(n / 1000)}K`;
  return `£${n}`;
}
