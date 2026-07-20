import { create } from 'zustand';
import type { GameState, Tactics, TransferOffer, OfferStatus, DealTerms, ContractTerms } from '@soccer-manager/engine/types';
import { generateWorld } from '@soccer-manager/engine/world';
import { advanceDay, nextUserFixture, STOP_TRANSFER_RESPONSE } from '@soccer-manager/engine/sim';
import { createLiveMatch, simulateMinute, finishMatch, userSub } from '@soccer-manager/engine/match';
import { migrateState } from '@soccer-manager/engine/migrate';
import { saveGame, loadGame } from '../store/persistence';
import { createRng } from '@soccer-manager/engine/rng';
import { wageDemand, overall, marketValue, fullName } from '@soccer-manager/engine/player';
import { completeTransfer, contractEndDay, formatMoney, dealTerms, respondToContractOffer, DEFAULT_PATIENCE } from '@soccer-manager/engine/transfers';
import { pickBestLineup, clubPlayers, totalWages } from '@soccer-manager/engine/squad';
import { addNews } from '@soccer-manager/engine/news';
import { isTransferWindowOpen } from '@soccer-manager/engine/calendar';
import { resplitBudget as engineResplitBudget, maybeEmitOverdraftWarning, processMatchGate, recordMoney } from '@soccer-manager/engine/finance';

/** Days a player refuses to reopen renewal talks after walking away from them. */
const RENEWAL_COOLDOWN_DAYS = 30;

export type Screen =
  | 'title' | 'team-select' | 'home' | 'squad' | 'player' | 'tactics'
  | 'transfers' | 'fixtures' | 'table' | 'inbox' | 'club' | 'match' | 'history'
  | 'finances';

interface GameStore {
  game: GameState | null;
  /** Bumped after every mutation so components re-render. */
  version: number;
  screen: Screen;
  selectedPlayerId: number | null;
  selectedClubId: number | null;
  /** Fixture awaiting kickoff on the match screen. */
  pendingFixtureId: number | null;
  stopReason: string | null;
  /** True while the day-by-day simulation animation is running. */
  advancing: boolean;
  loading: boolean;

  boot: () => Promise<void>;
  newGame: (saveName: string) => void;
  chooseTeam: (clubId: number) => void;
  setScreen: (s: Screen) => void;
  viewPlayer: (id: number) => void;
  viewClub: (id: number) => void;

  advance: () => void;
  advanceOneDay: () => void;
  stopAdvance: () => void;
  kickOff: () => void;
  tickMatch: (minutes: number) => void;
  concludeMatch: () => void;
  setUserMatchTactics: (t: Partial<Tactics>) => void;
  substitute: (outId: number, inId: number) => void;

  setTactics: (t: Partial<Tactics>) => void;
  autoPickLineup: () => void;
  setStarter: (slot: number, playerId: number) => void;
  swapBench: (benchPlayerId: number, otherPlayerId: number) => void;
  addToBench: (playerId: number) => void;
  setTrainingIntensity: (i: GameState['trainingIntensity']) => void;

  bidForPlayer: (playerId: number, terms: DealTerms) => string | null;
  acceptCounter: (offerId: number) => void;
  withdrawOffer: (offerId: number) => void;
  /** Fee-stage counter on an outgoing bid: puts the user's terms back on the
   * table ('pending'); the selling club answers in a day or two via the sim. */
  counterDealTerms: (offerId: number, terms: DealTerms) => { error: string | null; status: OfferStatus };
  /** Contract-stage offer: leaves a full contract with the player's agent; he
   * answers in a day or two via the sim (verdict 'sent' on success). */
  offerContractTerms: (offerId: number, terms: ContractTerms) => { error: string | null; verdict: 'sent' | null };
  respondToOffer: (offerId: number, action: 'accept' | 'reject', counterFee?: number) => void;
  setTransferListed: (playerId: number, listed: boolean) => void;
  signFreeAgent: (playerId: number, wage: number) => string | null;
  /** Renewal-stage instant round for an own squad player: offer a full contract;
   * the player answers synchronously (accept updates his contract in place). */
  offerRenewalTerms: (playerId: number, terms: ContractTerms) => { error: string | null; verdict: 'accept' | 'counter' | 'reject' | null };
  /** Shift the board envelope between transfer budget and wage room. `transferDelta`
   * is the signed change to the transfer budget (negative funds wage room). */
  resplitBudget: (transferDelta: number) => string | null;
  markNewsRead: () => void;
}

function persist(game: GameState) {
  void saveGame(game).catch((err) => console.error('Save failed', err));
}

function actionRng(game: GameState) {
  return createRng((game.seed + game.day * 31337 + game.nextId * 977) >>> 0);
}

export const useGameStore = create<GameStore>((set, get) => {
  /** Run a mutation against the live game, bump version, autosave. */
  function mutate(fn: (game: GameState) => void, save = true) {
    const { game } = get();
    if (!game) return;
    fn(game);
    set((s) => ({ version: s.version + 1 }));
    if (save) persist(game);
  }

  return {
    game: null,
    version: 0,
    screen: 'title',
    selectedPlayerId: null,
    selectedClubId: null,
    pendingFixtureId: null,
    stopReason: null,
    advancing: false,
    loading: true,

    boot: async () => {
      try {
        const saved = await loadGame();
        if (saved) {
          // A live match mid-save resumes at the pre-kickoff screen.
          if (saved.liveMatch) saved.liveMatch = null;
          const game = migrateState(saved);
          set({ game, screen: game.userClubId >= 0 ? 'home' : 'team-select', loading: false, version: 1 });
          return;
        }
      } catch (err) {
        console.error('Load failed', err);
      }
      set({ loading: false });
    },

    newGame: (saveName: string) => {
      const seed = Math.floor(Math.random() * 2 ** 31);
      const game = generateWorld(seed, 2025, saveName || 'My Career');
      set({ game, screen: 'team-select', version: 1, pendingFixtureId: null, stopReason: null });
    },

    chooseTeam: (clubId: number) => {
      mutate((game) => {
        game.userClubId = clubId;
        const club = game.clubs[clubId];
        addNews(game, 'board', `Welcome to ${club.name}`,
          `The board welcomes you as the new manager of ${club.name}. Transfer budget: ${formatMoney(club.budget)}. Wage budget: ${formatMoney(club.wageBudget)}/week. The season kicks off in mid-August — the summer window is open now.`);
      });
      set({ screen: 'home' });
    },

    setScreen: (s) => set({ screen: s }),
    viewPlayer: (id) => set({ selectedPlayerId: id, screen: 'player' }),
    viewClub: (id) => set({ selectedClubId: id, screen: 'club' }),

    // Begin the day-by-day simulation. The UI drives it one day at a time
    // via advanceOneDay() so news scrolls in and the date ticks up; it stops
    // automatically on the next event the manager should see.
    advance: () => {
      const { game, advancing } = get();
      if (!game || game.liveMatch || advancing) return;
      // An unplayed user fixture due today (e.g. after a reload) must be
      // played before time moves on.
      const due = game.fixtures.find((f) =>
        !f.played && f.day <= game.day && (f.homeClubId === game.userClubId || f.awayClubId === game.userClubId));
      if (due) {
        set({ pendingFixtureId: due.id, stopReason: 'Match day', screen: 'match' });
        return;
      }
      set({ advancing: true, stopReason: null });
    },

    // Simulate exactly one day. Called on a timer while `advancing`; clears
    // the flag (and routes to the match screen) when an event interrupts.
    advanceOneDay: () => {
      const { game, advancing } = get();
      if (!game || !advancing || game.liveMatch) return;
      const res = advanceDay(game);
      // Monthly board overdraft warning (self-gating: only fires on the 1st while
      // the user club is in the red). Kept here rather than in the engine day loop
      // (sim.ts) to avoid a merge conflict with WP2's monthly-cadence work.
      maybeEmitOverdraftWarning(game);
      if (res.userFixture) {
        set((s) => ({ version: s.version + 1, advancing: false, pendingFixtureId: res.userFixture!.id, stopReason: 'Match day', screen: 'match' }));
        persist(game);
        return;
      }
      if (res.stop) {
        set((s) => ({
          version: s.version + 1,
          advancing: false,
          stopReason: res.stopReason,
          // A negotiation response lands you where you can act on it (the
          // transfers screen opens on the Negotiations tab).
          screen: res.stopReason === STOP_TRANSFER_RESPONSE ? 'transfers' : s.screen,
        }));
        persist(game);
        return;
      }
      set((s) => ({ version: s.version + 1 }));
      persist(game);
    },

    stopAdvance: () => set({ advancing: false }),

    kickOff: () => {
      const { game, pendingFixtureId } = get();
      if (!game || pendingFixtureId == null) return;
      const fixture = game.fixtures.find((f) => f.id === pendingFixtureId);
      if (!fixture || fixture.played) return;
      mutate((g) => {
        // Replace the user lineup if it contains unavailable players or gaps.
        const club = g.clubs[g.userClubId];
        const squad = clubPlayers(g, club.id);
        const valid = club.lineup.starters.length === 11 && club.lineup.starters.every((id) => {
          if (id < 0) return false; // empty slot
          const p = g.players[id];
          return p && p.clubId === club.id && p.injuryDays === 0 && p.suspendedMatches === 0;
        });
        if (!valid) club.lineup = pickBestLineup(squad, club.tactics.formation);
        g.liveMatch = createLiveMatch(g, fixture);
      }, false);
    },

    tickMatch: (minutes) => {
      mutate((g) => {
        if (!g.liveMatch || g.liveMatch.finished) return;
        for (let i = 0; i < minutes && !g.liveMatch.finished; i++) {
          simulateMinute(g, g.liveMatch);
        }
      }, false);
    },

    concludeMatch: () => {
      mutate((g) => {
        if (!g.liveMatch) return;
        if (!g.liveMatch.finished) {
          while (!g.liveMatch.finished) simulateMinute(g, g.liveMatch);
        }
        const fx = g.fixtures.find((f) => f.id === g.liveMatch!.fixtureId)!;
        // Gate receipts use pre-match state (position/reputation), matching
        // how sim.ts handles AI-vs-AI fixtures — so record before finishMatch.
        const attendance = processMatchGate(g, fx);
        finishMatch(g, g.liveMatch);
        const home = g.clubs[fx.homeClubId];
        const away = g.clubs[fx.awayClubId];
        addNews(g, 'match', `${home.shortName} ${fx.homeGoals} - ${fx.awayGoals} ${away.shortName}`,
          `Full time: ${home.name} ${fx.homeGoals}, ${away.name} ${fx.awayGoals}. Attendance: ${attendance.toLocaleString()}.`);
        g.liveMatch = null;
      });
      set({ pendingFixtureId: null, screen: 'home' });
    },

    setUserMatchTactics: (t) => {
      mutate((g) => {
        if (!g.liveMatch) return;
        const side = g.liveMatch.home.clubId === g.userClubId ? g.liveMatch.home : g.liveMatch.away;
        Object.assign(side.tactics, t);
        g.liveMatch.events.push({
          minute: g.liveMatch.minute, type: 'tactic',
          side: side === g.liveMatch.home ? 0 : 1,
          text: `You adjust your approach (${side.tactics.mentality.replace('-', ' ')}).`,
        });
      }, false);
    },

    substitute: (outId, inId) => {
      mutate((g) => {
        if (!g.liveMatch) return;
        userSub(g, g.liveMatch, outId, inId);
      }, false);
    },

    setTactics: (t) => {
      mutate((g) => {
        const club = g.clubs[g.userClubId];
        const formationChanged = t.formation && t.formation !== club.tactics.formation;
        Object.assign(club.tactics, t);
        if (formationChanged) {
          club.lineup = pickBestLineup(clubPlayers(g, club.id), club.tactics.formation);
        }
      });
    },

    autoPickLineup: () => {
      mutate((g) => {
        const club = g.clubs[g.userClubId];
        club.lineup = pickBestLineup(clubPlayers(g, club.id), club.tactics.formation);
      });
    },

    setStarter: (slot, playerId) => {
      mutate((g) => {
        const club = g.clubs[g.userClubId];
        const { starters, bench } = club.lineup;
        const prev = starters[slot];
        const existingSlot = starters.indexOf(playerId);
        if (existingSlot >= 0) {
          // Swap two starters.
          starters[existingSlot] = prev;
          starters[slot] = playerId;
          return;
        }
        const benchIdx = bench.indexOf(playerId);
        if (benchIdx >= 0) bench.splice(benchIdx, 1);
        starters[slot] = playerId;
        if (prev !== undefined && prev >= 0) bench.unshift(prev);
        if (bench.length > 7) bench.length = 7;
      });
    },

    swapBench: (benchPlayerId, otherPlayerId) => {
      mutate((g) => {
        const { starters, bench } = g.clubs[g.userClubId].lineup;
        const i = bench.indexOf(benchPlayerId);
        if (i < 0) return;
        const j = bench.indexOf(otherPlayerId);
        if (j >= 0) {
          [bench[i], bench[j]] = [bench[j], bench[i]]; // reorder within bench
          return;
        }
        // Starters dropped on the bench go through setStarter instead.
        if (starters.includes(otherPlayerId)) return;
        bench[i] = otherPlayerId;
      });
    },

    addToBench: (playerId) => {
      mutate((g) => {
        const { starters, bench } = g.clubs[g.userClubId].lineup;
        if (starters.includes(playerId) || bench.includes(playerId) || bench.length >= 7) return;
        bench.push(playerId);
      });
    },

    setTrainingIntensity: (i) => mutate((g) => { g.trainingIntensity = i; }),

    bidForPlayer: (playerId, terms) => {
      const { game } = get();
      if (!game) return 'No game';
      if (!isTransferWindowOpen(game.day)) return 'The transfer window is closed.';
      const club = game.clubs[game.userClubId];
      if (terms.fee > club.budget) return 'That bid exceeds your transfer budget.';
      const player = game.players[playerId];
      if (player.clubId === game.userClubId) return 'He already plays for you.';
      if (terms.swapPlayerId !== null) {
        const swap = game.players[terms.swapPlayerId];
        if (!swap || swap.clubId !== game.userClubId) return 'That swap player is not in your squad.';
      }
      const existing = game.offers.find((o) => o.playerId === playerId && o.fromClubId === club.id && (o.status === 'pending' || o.status === 'countered'));
      if (existing) return 'You already have a live bid for this player.';
      mutate((g) => {
        g.offers.push({
          id: g.nextId++, playerId, fromClubId: g.userClubId, toClubId: player.clubId,
          terms, status: 'pending', counterTerms: null, rounds: 0, patience: DEFAULT_PATIENCE,
          day: g.day, userInvolved: true, wageDemand: null, stage: 'fee', contractOffer: null,
        });
        addNews(g, 'transfer', `Bid submitted: ${fullName(player)}`,
          `You bid ${formatMoney(terms.fee)} for ${fullName(player)} (${g.clubs[player.clubId].name}). Expect a response within a day or two.`);
      });
      return null;
    },

    acceptCounter: (offerId) => {
      mutate((g) => {
        const offer = g.offers.find((o) => o.id === offerId);
        if (!offer || offer.status !== 'countered' || offer.counterTerms === null) return;
        const club = g.clubs[g.userClubId];
        if (offer.counterTerms.fee > club.budget) return;
        offer.terms = offer.counterTerms;
        offer.status = 'accepted';
        offer.stage = 'contract';
        const player = g.players[offer.playerId];
        offer.wageDemand = wageDemand(overall(player), player.age, club.reputation);
      });
    },

    withdrawOffer: (offerId) => {
      mutate((g) => {
        const offer = g.offers.find((o) => o.id === offerId);
        if (offer) offer.status = 'withdrawn';
      });
    },

    counterDealTerms: (offerId, terms) => {
      const { game } = get();
      if (!game) return { error: 'No game', status: 'withdrawn' };
      const offer = game.offers.find((o) => o.id === offerId);
      if (!offer || offer.fromClubId !== game.userClubId) return { error: 'No live bid to negotiate.', status: 'withdrawn' };
      if (offer.stage !== 'fee' || (offer.status !== 'pending' && offer.status !== 'countered')) {
        return { error: 'This deal is no longer open to counter.', status: offer.status };
      }
      // An initial bid stays on the table until the selling club answers —
      // no improving it mid-air.
      if (offer.status === 'pending') {
        return { error: 'Wait for the club to respond to your bid first.', status: offer.status };
      }
      if (!isTransferWindowOpen(game.day)) return { error: 'The transfer window is closed.', status: offer.status };
      const club = game.clubs[game.userClubId];
      if (terms.fee > club.budget) return { error: 'That bid exceeds your transfer budget.', status: offer.status };
      if (terms.swapPlayerId !== null) {
        const swap = game.players[terms.swapPlayerId];
        if (!swap || swap.clubId !== game.userClubId) return { error: 'That swap player is not in your squad.', status: offer.status };
      }
      mutate((g) => {
        const o = g.offers.find((x) => x.id === offerId)!;
        // Back on the table awaiting the seller: aiTransferTick answers in a
        // day or two, driving the same concession curve as before.
        o.terms = terms;
        o.counterTerms = null;
        o.rounds++;
        o.day = g.day;
        o.status = 'pending';
      });
      return { error: null, status: 'pending' };
    },

    offerContractTerms: (offerId, terms) => {
      const { game } = get();
      if (!game) return { error: 'No game', verdict: null };
      const offer = game.offers.find((o) => o.id === offerId);
      if (!offer || offer.stage !== 'contract' || offer.status !== 'accepted') {
        return { error: 'Deal not at contract stage.', verdict: null };
      }
      if (offer.contractOffer) return { error: 'Your offer is already with his agent — wait for his answer.', verdict: null };
      const club = game.clubs[game.userClubId];
      const squad = clubPlayers(game, club.id);
      if (totalWages(squad) + terms.wage > club.wageBudget) return { error: 'That would exceed your wage budget.', verdict: null };
      mutate((g) => {
        const o = g.offers.find((x) => x.id === offerId)!;
        o.contractOffer = terms;
        o.day = g.day;
      });
      return { error: null, verdict: 'sent' };
    },

    respondToOffer: (offerId, action, counterFee) => {
      mutate((g) => {
        const offer = g.offers.find((o) => o.id === offerId);
        if (!offer || offer.toClubId !== g.userClubId || offer.status !== 'pending') return;
        const player = g.players[offer.playerId];
        if (action === 'reject') {
          offer.status = 'rejected';
          return;
        }
        if (counterFee !== undefined && counterFee > offer.terms.fee) {
          offer.status = 'countered';
          offer.counterTerms = { ...offer.terms, fee: counterFee };
          offer.day = g.day;
          return;
        }
        // Accept: buying AI club completes the deal.
        const buyer = g.clubs[offer.fromClubId];
        offer.status = 'accepted';
        completeTransfer(g, offer, wageDemand(overall(player), player.age, buyer.reputation));
      });
    },

    setTransferListed: (playerId, listed) => {
      mutate((g) => {
        const p = g.players[playerId];
        if (p.clubId !== g.userClubId) return;
        p.transferListed = listed;
        if (listed) p.morale = Math.max(0, p.morale - 12);
      });
    },

    signFreeAgent: (playerId, wage) => {
      const { game } = get();
      if (!game) return 'No game';
      const player = game.players[playerId];
      if (player.clubId !== -1) return 'He is not a free agent.';
      const club = game.clubs[game.userClubId];
      const squad = clubPlayers(game, club.id);
      if (totalWages(squad) + wage > club.wageBudget) return 'That would exceed your wage budget.';
      const demand = wageDemand(overall(player), player.age, club.reputation);
      if (wage < demand * 0.95) return `He wants at least ${formatMoney(Math.round(demand * 0.95))}/week.`;
      mutate((g) => {
        const offer: TransferOffer = {
          id: g.nextId++, playerId, fromClubId: g.userClubId, toClubId: -1,
          terms: dealTerms(0), status: 'accepted', counterTerms: null, rounds: 0, patience: DEFAULT_PATIENCE,
          day: g.day, userInvolved: true, wageDemand: demand, stage: 'contract', contractOffer: null,
        };
        g.offers.push(offer);
        completeTransfer(g, offer, wage);
      });
      return null;
    },

    offerRenewalTerms: (playerId, terms) => {
      const { game } = get();
      if (!game) return { error: 'No game', verdict: null };
      const player = game.players[playerId];
      if (!player || player.clubId !== game.userClubId) return { error: 'Not your player.', verdict: null };
      const club = game.clubs[game.userClubId];
      const squad = clubPlayers(game, club.id);
      // The new wage replaces his current one, so only the raise counts against the cap.
      if (totalWages(squad) - player.contract.wage + terms.wage > club.wageBudget) {
        return { error: 'That would exceed your wage budget.', verdict: null };
      }
      let verdict: 'accept' | 'counter' | 'reject' = 'reject';
      mutate((g) => {
        const p = g.players[playerId];
        verdict = respondToContractOffer(g, actionRng(g), playerId, terms, 'renewal');
        if (verdict === 'accept') {
          p.contract = {
            wage: terms.wage,
            expiresDay: contractEndDay(g, terms.years),
            releaseClause: terms.releaseClause,
            goalBonus: terms.goalBonus,
          };
          if (terms.signingBonus > 0) recordMoney(g.clubs[g.userClubId], 'bonuses', -terms.signingBonus);
          p.morale = Math.min(100, p.morale + 10);
          p.wellbeing = Math.min(100, p.wellbeing + 5);
          p.renewalCooldownDay = undefined;
          addNews(g, 'squad', `${fullName(p)} signs new deal`,
            `${fullName(p)} has signed a new ${terms.years}-year contract worth ${formatMoney(terms.wage)}/week.`);
        } else if (verdict === 'reject') {
          p.renewalCooldownDay = g.day + RENEWAL_COOLDOWN_DAYS;
        }
      });
      return { error: null, verdict };
    },

    resplitBudget: (transferDelta) => {
      const { game } = get();
      if (!game) return 'No game';
      const club = game.clubs[game.userClubId];
      // The engine validates and only mutates on success, so bump/persist just
      // when it succeeds (mirrors the read-check-then-commit shape of the
      // transfer actions).
      const err = engineResplitBudget(game, club, transferDelta);
      if (err) return err;
      set((s) => ({ version: s.version + 1 }));
      persist(game);
      return null;
    },

    markNewsRead: () => {
      mutate((g) => {
        for (const n of g.news) n.read = true;
      }, false);
    },
  };
});

export function useGame(): GameState {
  const game = useGameStore((s) => s.game);
  useGameStore((s) => s.version); // subscribe to mutations
  if (!game) throw new Error('No game loaded');
  return game;
}

export { nextUserFixture, marketValue, actionRng };
