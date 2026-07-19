import type { GameState, Position, PositionGroup, Contract, TransferOffer } from './types';
import { SCHEMA_VERSION } from './types';
import { FORMATIONS, positionGroup } from './tactics';
import { emptyLedger } from './world';
import { clubPlayers, totalWages } from './squad';
import { boardEnvelope } from './finance';
import { DEFAULT_PATIENCE } from './transfers';

/**
 * Round-robin fallbacks used to spread schema-v1 group positions across the new
 * detailed roles. The first entry is the most common role in the group, so it
 * recurs as the cycle wraps (DF → CB, LB, RB, CB, …).
 */
const ROUND_ROBIN: Record<PositionGroup, Position[]> = {
  GK: ['GK'],
  DF: ['CB', 'LB', 'RB'],
  MF: ['CM', 'DM', 'AM', 'LM', 'RM'],
  FW: ['ST', 'LW', 'RW'],
};

/**
 * Upgrade a save to the current schema version, running each intervening
 * step exactly once and in order. Stepwise (rather than "if version <
 * SCHEMA_VERSION run everything") matters: a v2 save must NOT re-enter the
 * v1->v2 position migration, whose pass 2 would treat already-detailed
 * positions ('CB', 'ST', …) as unrecognized groups and reassign every player
 * to MF-cycle positions, corrupting the save. Safe (no-op) on a save already
 * at the current schema version.
 */
export function migrateState(state: GameState): GameState {
  if (state.schemaVersion >= SCHEMA_VERSION) return state;

  if (state.schemaVersion < 2) migrateV1toV2(state);
  if (state.schemaVersion < 3) migrateV2toV3(state);
  if (state.schemaVersion < 4) migrateV3toV4(state);
  if (state.schemaVersion < 5) migrateV4toV5(state);
  if (state.schemaVersion < 6) migrateV5toV6(state);
  if (state.schemaVersion < 7) migrateV6toV7(state);

  state.schemaVersion = SCHEMA_VERSION;
  return state;
}

/**
 * v1 -> v2: coarse 'GK'/'DF'/'MF'/'FW' positions become detailed roles.
 * Lineup starters take the detailed position of the slot they occupy when
 * the group matches; everyone else is assigned round-robin within their old
 * group, deterministically by player id.
 */
function migrateV1toV2(state: GameState): void {
  const assigned = new Set<number>();

  // Pass 1: starters inherit their formation slot's detailed position.
  for (const club of Object.values(state.clubs)) {
    const slots = FORMATIONS[club.tactics.formation];
    club.lineup.starters.forEach((pid, i) => {
      if (pid < 0) return;
      const p = state.players[pid];
      if (!p || i >= slots.length) return;
      const slotPos = slots[i];
      const oldGroup = p.position as unknown as PositionGroup;
      if (positionGroup(slotPos) === oldGroup) {
        p.position = slotPos;
        assigned.add(pid);
      }
    });
  }

  // Pass 2: everyone else (bench, reserves, free agents) round-robins within
  // their old group. Deterministic ordering by id.
  const cursors: Record<PositionGroup, number> = { GK: 0, DF: 0, MF: 0, FW: 0 };
  const remaining = Object.values(state.players)
    .filter((p) => !assigned.has(p.id))
    .sort((a, b) => a.id - b.id);
  for (const p of remaining) {
    const raw = p.position as unknown as PositionGroup;
    const group: PositionGroup = raw in cursors ? raw : 'MF';
    const cycle = ROUND_ROBIN[group];
    p.position = cycle[cursors[group] % cycle.length];
    cursors[group]++;
  }
}

/**
 * v2 -> v3: seed the finance fields introduced for the Finances & budgets
 * feature. `balance` is derived deterministically from reputation, using the
 * midpoint of the world-gen `budgetFor()` curve (rng factor fixed at 1.0
 * instead of the 0.7-1.3 random spread, since migration must be
 * deterministic) times 1.5, rounded to the nearest 50k like `budgetFor`.
 * Existing `budget`/`wageBudget` are left untouched — they become the club's
 * current allocations under the new (board-envelope) meaning.
 */
function migrateV2toV3(state: GameState): void {
  for (const club of Object.values(state.clubs)) {
    const base = Math.pow(club.reputation / 10, 3.2) * 32_000;
    club.balance = Math.round((base * 1.5) / 50_000) * 50_000;
    club.ledger = emptyLedger();
  }
}

/**
 * v3 -> v4: seed the monthly finance-history trend introduced for the
 * Finances screen's cash-flow chart. Every club simply starts with an empty
 * season-scoped history — there's no way to reconstruct past months from a
 * save that never tracked them, so the trend just starts fresh from here.
 */
function migrateV3toV4(state: GameState): void {
  for (const club of Object.values(state.clubs)) {
    club.financeHistory = [];
  }
}

/**
 * v4 -> v5: repair saves generated while world-gen seeded the wage cap from a
 * reputation curve that ignored the actual squad's wages — strong clubs were
 * born with a wage bill far above their cap, a financially impossible state
 * the budget slider could never fix. Any club whose cap sits below its real
 * bill gets both allocations re-derived through the live board-envelope
 * logic, exactly as a season rollover would set them. Healthy clubs are left
 * untouched. (Unlike the frozen formulas in earlier steps, this deliberately
 * calls the live `boardEnvelope`: it is a repair to current board policy,
 * not a historical transform.)
 */
function migrateV4toV5(state: GameState): void {
  for (const club of Object.values(state.clubs)) {
    const bill = totalWages(clubPlayers(state, club.id));
    if (club.wageBudget >= bill) continue;
    const tier = state.leagues?.find((l) => l.id === club.leagueId)?.tier ?? 1;
    const envelope = boardEnvelope(club.balance, bill, tier);
    club.budget = envelope.budget;
    club.wageBudget = envelope.wageBudget;
  }
}

/**
 * v5 -> v6: seed the Transfers v2 deal & contract model. Contracts gain a null
 * release clause and a zero goal bonus; players start with no sell-on
 * obligation. Live offers move from the flat `fee`/`counterFee` pair to
 * the `terms`/`counterTerms` deal-terms shape (cash-only, no sell-on/swap) plus
 * the new round/patience counters. Every club ledger gains the `bonuses`
 * expense category so `recordMoney` doesn't add to `undefined`.
 */
function migrateV5toV6(state: GameState): void {
  for (const p of Object.values(state.players)) {
    const contract = p.contract as Contract & { releaseClause?: number | null };
    if (contract && contract.releaseClause === undefined) {
      contract.releaseClause = null;
      contract.goalBonus = 0;
    }
    if (p.sellOn === undefined) p.sellOn = null;
    if (p.contractTalk === undefined) p.contractTalk = null;
  }

  for (const o of state.offers ?? []) {
    const legacy = o as TransferOffer & { fee?: number; counterFee?: number | null };
    if (legacy.terms === undefined) {
      o.terms = { fee: legacy.fee ?? 0, sellOnPct: 0, swapPlayerId: null };
      o.counterTerms = legacy.counterFee != null
        ? { fee: legacy.counterFee, sellOnPct: 0, swapPlayerId: null }
        : null;
      o.rounds = 0;
      o.patience = DEFAULT_PATIENCE;
      delete legacy.fee;
      delete legacy.counterFee;
    }
  }

  for (const club of Object.values(state.clubs)) {
    if (club.ledger && club.ledger.bonuses === undefined) club.ledger.bonuses = 0;
  }
}

/**
 * v6 -> v7: appearance fees are gone from the contract model (they muddied the
 * player's mental model of a deal's cost). Strip the stale field from every
 * signed contract and any in-flight contract counter so saves don't carry a
 * dead perk that nothing pays out anymore.
 */
function migrateV6toV7(state: GameState): void {
  for (const p of Object.values(state.players)) {
    delete (p.contract as { appearanceFee?: number }).appearanceFee;
    if (p.contractTalk?.counter) {
      delete (p.contractTalk.counter as { appearanceFee?: number }).appearanceFee;
    }
  }
}
